"""Bounded asset intake. User URLs never reach private networks by default."""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import mimetypes
import re
import socket
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, unquote_to_bytes, urljoin, urlsplit

import aiofiles
import aiohttp

from app.config import settings


class ResourceAccessError(ValueError):
    pass


def _allowlisted(host: str) -> bool:
    return host.lower().rstrip(".") in {
        value.lower().rstrip(".") for value in settings.security.DOWNLOAD_ALLOWED_HOSTS
    }


def validate_address(address: str, host: str = "") -> None:
    if _allowlisted(host):
        return
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if not ip.is_global or ip.is_multicast:
        raise ResourceAccessError("Resource address must be public")


def validate_remote_url(url: str) -> str:
    if len(url) > 8192:
        raise ResourceAccessError("URL too long")
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ResourceAccessError("Only HTTP(S) resource URLs are supported")
    if parsed.username is not None or parsed.password is not None or "%" in parsed.hostname:
        raise ResourceAccessError("URL credentials and scoped addresses are forbidden")
    try:
        ipaddress.ip_address(parsed.hostname)
    except ValueError:
        if parsed.hostname.lower().rstrip(".") == "localhost" and not _allowlisted(parsed.hostname):
            raise ResourceAccessError("Localhost is forbidden")
    else:
        validate_address(parsed.hostname, parsed.hostname)
    return parsed.hostname


class PublicResolver(aiohttp.abc.AbstractResolver):
    """Validate the actual addresses consumed by the connector, avoiding DNS TOCTOU."""
    def __init__(self):
        self.delegate = aiohttp.resolver.DefaultResolver()

    async def resolve(self, host, port=0, family=socket.AF_INET):
        answers = await self.delegate.resolve(host, port, family)
        if not answers:
            raise ResourceAccessError("Resource host has no addresses")
        for answer in answers:
            validate_address(answer["host"], host)
        return answers

    async def close(self):
        await self.delegate.close()


def confined_upload_path(value: str) -> Path:
    roots = [(Path(settings.storage.STATIC_DIR) / "uploads").resolve(),
             Path(settings.storage.UPLOADS_DIR).resolve()]
    parsed = urlsplit(value)
    if parsed.scheme == "file":
        if parsed.netloc:
            raise ResourceAccessError("File URL hosts are forbidden")
        candidates = [Path(unquote(parsed.path))]
    elif parsed.scheme:
        raise ResourceAccessError("Unsupported local resource scheme")
    else:
        path = unquote(parsed.path)
        relative = None
        for prefix in ("/static/uploads/", "/temp/uploads/", "/uploads/", "uploads/"):
            if path.startswith(prefix):
                relative = path[len(prefix):]
                break
        candidates = [root / relative for root in roots] if relative is not None else [Path(path)]
    for candidate in candidates:
        resolved = candidate.resolve()
        if any(resolved.is_relative_to(root) for root in roots) and resolved.is_file():
            if resolved.stat().st_size > settings.security.MAX_RESOURCE_BYTES:
                raise ResourceAccessError("Resource exceeds size limit")
            return resolved
    raise ResourceAccessError("Local resources must be files inside configured upload directories")


async def prepare_resource(value: str, *, allow_raw_base64: bool = False) -> tuple[Path, dict]:
    max_bytes = settings.security.MAX_RESOURCE_BYTES
    if len(value) > ((max_bytes + 2) // 3) * 4 + 1024:
        raise ResourceAccessError("Resource exceeds size limit")
    temp_dir = Path(settings.storage.TEMP_DIR) / "resource_downloads"
    temp_dir.mkdir(parents=True, exist_ok=True)
    parsed = urlsplit(value)
    suffix = Path(unquote(parsed.path)).suffix.lower() if parsed.scheme != "data" else ""
    if not re.fullmatch(r"\.[a-z0-9]{1,10}", suffix):
        suffix = ".bin"
    target = temp_dir / f"{uuid.uuid4().hex}{suffix}"
    digest, total = hashlib.md5(), 0
    content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"

    async def write_chunk(output, chunk):
        nonlocal total
        total += len(chunk)
        if total > max_bytes:
            raise ResourceAccessError("Resource exceeds size limit")
        digest.update(chunk)
        await output.write(chunk)

    try:
        async with aiofiles.open(target, "xb") as output:
            if parsed.scheme in {"http", "https"}:
                resolver = PublicResolver()
                try:
                    connector = aiohttp.TCPConnector(resolver=resolver, use_dns_cache=False)
                    async with aiohttp.ClientSession(connector=connector, trust_env=False,
                            timeout=aiohttp.ClientTimeout(total=60, connect=10)) as session:
                        current = value
                        for redirect in range(4):
                            validate_remote_url(current)
                            async with session.get(current, allow_redirects=False) as response:
                                if response.status in {301, 302, 303, 307, 308}:
                                    if redirect == 3 or not response.headers.get("Location"):
                                        raise ResourceAccessError("Too many or invalid redirects")
                                    current = urljoin(current, response.headers["Location"])
                                    continue
                                if response.status != 200:
                                    raise ResourceAccessError(f"Resource returned HTTP {response.status}")
                                if response.content_length and response.content_length > max_bytes:
                                    raise ResourceAccessError("Resource exceeds size limit")
                                content_type = response.headers.get("Content-Type", content_type).split(";", 1)[0]
                                async for chunk in response.content.iter_chunked(65536):
                                    await write_chunk(output, chunk)
                                break
                finally:
                    await resolver.close()
            elif parsed.scheme == "data" or (allow_raw_base64 and not parsed.scheme and not value.startswith(("/", "uploads/"))):
                if parsed.scheme == "data":
                    header, encoded = value.split(",", 1)
                    content_type = header[5:].split(";", 1)[0] or "text/plain"
                    data = base64.b64decode(encoded, validate=True) if header.endswith(";base64") else unquote_to_bytes(encoded)
                else:
                    data = base64.b64decode(value, validate=True)
                # Preserve MIME extension for parsers without trusting a supplied filename.
                suffix = {"text/markdown": ".md", "text/plain": ".txt", "application/pdf": ".pdf",
                          "image/png": ".png", "image/jpeg": ".jpg"}.get(content_type, suffix)
                await write_chunk(output, data)
            else:
                source = confined_upload_path(value)
                async with aiofiles.open(source, "rb") as input_file:
                    while chunk := await input_file.read(65536):
                        await write_chunk(output, chunk)
        if total == 0:
            raise ResourceAccessError("Empty resources are not supported")
        if target.suffix != suffix:
            renamed = target.with_suffix(suffix)
            target.rename(renamed)
            target = renamed
        return target, {"file_name": target.name, "file_size": total, "content_type": content_type,
                        "md5": digest.hexdigest(), "download_time": datetime.now().isoformat()}
    except BaseException:
        target.unlink(missing_ok=True)
        raise
