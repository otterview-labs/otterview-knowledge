"""Optional standalone workspace session boundary for the web UI and its APIs."""

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

from starlette.concurrency import run_in_threadpool
from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, RedirectResponse

SESSION_AGE = 8 * 60 * 60
LOGIN_WINDOW = 5 * 60
PUBLIC_ASSETS = frozenset(("/static/css/workspace-login.css", "/static/js/workspace-login.js"))
TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}\Z")
UNSAFE = frozenset(("POST", "PUT", "PATCH", "DELETE"))
PASSWORD_ITERATIONS = 600_000


def password_digest(password: str, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PASSWORD_ITERATIONS)


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class WorkspaceAuth:
    """Cookie authentication for one shared operator workspace; optional machine access is scoped."""

    def __init__(self, app, *, config: Path, static_dir: Path):
        self.app = app
        self.static_dir = static_dir
        if config.stat().st_mode & 0o077:
            raise ValueError("Workspace authentication config must be readable only by the service user")
        values = json.loads(config.read_text())
        self.username = values["username"]
        self.account = SimpleNamespace(id=str(values.get("owner_id", "anonymous")), username=self.username, is_superuser=True, is_active=True)
        self.salt = bytes.fromhex(values["salt"])
        self.password_hash = bytes.fromhex(values["password_hash"])
        self.origin = values["origin"]
        parsed = urlsplit(self.origin)
        if (
            not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
            or (parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost")))
        ):
            raise ValueError("Set an HTTPS workspace origin (HTTP is allowed on loopback only)")
        if not self.username or len(self.salt) != 16 or len(self.password_hash) != 32:
            raise ValueError("Invalid workspace account configuration")
        self.secure = parsed.scheme == "https"
        self.cookie = "__Host-jetlinks-knowledge" if self.secure else "jetlinks-knowledge-local"
        self.service_token = values.get("service_token_sha256", "")
        if self.service_token and not re.fullmatch(r"[0-9a-f]{64}", self.service_token):
            raise ValueError("Invalid service token digest")
        self.db = config.with_name("workspace-sessions.sqlite3")
        fd = os.open(self.db, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.executescript(
                "CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL);"
                "CREATE TABLE IF NOT EXISTS attempts (peer TEXT PRIMARY KEY, until INTEGER NOT NULL, count INTEGER NOT NULL);"
            )

    def _reserve_attempt(self, peer):
        now = int(time.time())
        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.execute("DELETE FROM attempts WHERE until <= ?", (now,))
            conn.execute(
                "INSERT INTO attempts VALUES (?, ?, 1) ON CONFLICT(peer) DO UPDATE SET count = count + 1",
                (peer, now + LOGIN_WINDOW),
            )
            return conn.execute("SELECT count FROM attempts WHERE peer=?", (peer,)).fetchone()[0] <= 8

    def _valid_session(self, token):
        if not TOKEN_PATTERN.fullmatch(token or ""):
            return False
        with closing(sqlite3.connect(self.db)) as conn:
            return conn.execute(
                "SELECT 1 FROM sessions WHERE token=? AND expires>?", (_digest(token), int(time.time()))
            ).fetchone() is not None

    def _issue(self, peer, previous):
        token = secrets.token_urlsafe(32)
        now = int(time.time())
        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.execute("DELETE FROM sessions WHERE expires<=? OR token=?", (now, _digest(previous or "")))
            conn.execute("DELETE FROM attempts WHERE peer=?", (peer,))
            conn.execute("INSERT INTO sessions VALUES (?, ?)", (_digest(token), now + SESSION_AGE))
        return token

    def _revoke(self, token):
        with closing(sqlite3.connect(self.db)) as conn, conn:
            conn.execute("DELETE FROM sessions WHERE token=?", (_digest(token or ""),))

    def _service_access(self, request):
        token = request.headers.get("X-Knowledge-Service-Token", "")
        return (
            bool(self.service_token)
            and bool(TOKEN_PATTERN.fullmatch(token))
            and request.method == "POST"
            and request.url.path in ("/api/v1/rag/resource-parse/batch-parse", "/api/v1/rag/resource-parse/batch-status",
                                    "/api/v1/rag/collections/", "/api/v1/rag/search/unified", "/knowledge/resource/_search")
            and hmac.compare_digest(_digest(token), self.service_token)
        )

    def _same_origin(self, request):
        origin = request.headers.get("origin")
        return request.headers.get("sec-fetch-site") not in ("cross-site", "same-site") and (
            not origin or origin == self.origin
        )

    async def _login(self, request, previous):
        if not self._same_origin(request):
            return JSONResponse({"message": "请求来源不匹配"}, status_code=403)
        if request.headers.get("content-type", "").split(";")[0] != "application/x-www-form-urlencoded":
            return JSONResponse({"message": "登录请求格式错误"}, status_code=415)
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > 4096:
                return JSONResponse({"message": "登录内容过长"}, status_code=413)
            data.extend(chunk)
        try:
            fields = parse_qs(data.decode(), keep_blank_values=True, max_num_fields=2)
        except ValueError:
            fields = {}
        username = fields.get("username", [""])[0]
        password = fields.get("password", [""])[0]
        peer = request.client.host if request.client else "unknown"
        if not await run_in_threadpool(self._reserve_attempt, peer):
            return RedirectResponse("/login?error=rate", status_code=303, headers={"Retry-After": str(LOGIN_WINDOW)})
        if (
            len(password) > 512
            or not hmac.compare_digest(await run_in_threadpool(password_digest, password, self.salt), self.password_hash)
            or not hmac.compare_digest(username.encode(), self.username.encode())
        ):
            return RedirectResponse("/login?error=credentials", status_code=303)
        token = await run_in_threadpool(self._issue, peer, previous)
        response = RedirectResponse("/", status_code=303)
        response.set_cookie(self.cookie, token, max_age=SESSION_AGE, httponly=True, secure=self.secure, samesite="strict")
        return response

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            if scope["type"] == "websocket":
                await send({"type": "websocket.close", "code": 1008})
                return
            await self.app(scope, receive, send)
            return
        request = Request(scope, receive=receive)
        method = request.method
        path = scope["path"]
        previous = request.cookies.get(self.cookie, "")
        safe = method in ("GET", "HEAD")
        if safe and (path == "/health" or path in PUBLIC_ASSETS):
            await self.app(scope, receive, send)
            return

        async def private_send(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["Cache-Control"] = "no-store"
                headers["X-Content-Type-Options"] = "nosniff"
                headers["Referrer-Policy"] = "same-origin"
                headers["X-Frame-Options"] = "DENY"
                if path.startswith(("/uploads/", "/temp/uploads/", "/static/uploads/", "/static/images/", "/api/file/")):
                    headers["Content-Security-Policy"] = "sandbox; default-src 'none'"
            await send(message)

        # The public listener must use the configured HTTPS origin. Host can be
        # forwarded by the TLS terminator, but clients cannot override its scheme.
        internal = self._service_access(request)
        correct_origin = str(request.base_url).rstrip("/") == self.origin
        if not internal and not correct_origin:
            if safe and path in ("/", "/login"):
                response = RedirectResponse(self.origin + path, status_code=307)
            else:
                response = JSONResponse({"message": "请使用知识库 HTTPS 入口"}, status_code=400)
        elif path == "/login" and safe:
            response = RedirectResponse("/", status_code=303) if await run_in_threadpool(self._valid_session, previous) else FileResponse(
                self.static_dir / "workspace-login.html", headers={"Content-Security-Policy": "default-src 'none'; style-src 'self'; script-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}
            )
        elif path == "/login" and method == "POST":
            response = await self._login(request, previous)
        elif internal and path not in ("/login", "/logout"):
            scope["state"] = {**scope.get("state", {}), "workspace_account": self.account}
            await self.app(scope, receive, private_send)
            return
        elif not await run_in_threadpool(self._valid_session, previous):
            page = safe and (path == "/" or "text/html" in request.headers.get("accept", "")) and not path.startswith(("/api/", "/knowledge/resource/"))
            response = RedirectResponse("/login", status_code=303) if page else JSONResponse({"message": "请先登录"}, status_code=401)
        elif path == "/workspace/session" and safe:
            response = JSONResponse({"username": self.username})
        elif method in UNSAFE and not self._same_origin(request):
            response = JSONResponse({"message": "请求来源不匹配"}, status_code=403)
        elif path == "/logout" and method == "POST":
            await run_in_threadpool(self._revoke, previous)
            response = RedirectResponse("/login", status_code=303)
            response.delete_cookie(self.cookie, secure=self.secure, httponly=True, samesite="strict")
        else:
            scope["state"] = {**scope.get("state", {}), "workspace_account": self.account}
            await self.app(scope, receive, private_send)
            return
        await response(scope, receive, private_send)
