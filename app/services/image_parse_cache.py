"""Reuse immutable image parses in the same user and collection scope."""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from weakref import WeakValueDictionary

from app.db.models.rag import RAGContent
from app.shared.parsers.image_ocr import ImageOCRConfig, reusable_ocr_parse
from app.shared.vlm.config import VLMConfig
from app.shared.vlm.image_analysis import (
    IMAGE_ANALYSIS_PROMPT,
    IMAGE_SYSTEM_PROMPT,
    reusable_image_analysis,
)

_locks: WeakValueDictionary[tuple, asyncio.Lock] = WeakValueDictionary()


@dataclass(frozen=True)
class ImageCacheContext:
    sha256: str
    signature: str
    ttl: int


@asynccontextmanager
async def parse_lock(document: RAGContent, context: ImageCacheContext | None):
    if context is None:
        yield
        return
    key = (
        document.user_id,
        document.vector_collection,
        context.sha256,
        context.signature,
    )
    lock = _locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _locks[key] = lock
    async with lock:
        yield


def build_context(path: str, *, image_mode: str = "auto") -> ImageCacheContext | None:
    config = VLMConfig.from_env()
    ocr_config = ImageOCRConfig.from_env()
    if (
        not config.image_cache_enabled
        or not config.image_cache_ttl_seconds
        or (
            (not config.reuse_image_analysis or config.provider == "disabled")
            and not (image_mode == "auto" and ocr_config.enabled and ocr_config.url)
        )
    ):
        return None
    with Path(path).open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    # A changed model, prompt or image preparation invalidates the parse.
    signature = hashlib.sha256(
        json.dumps(
            {
                "image_mode": image_mode,
                "ocr": ocr_config.signature() if image_mode == "auto" else None,
                "version": config.image_cache_version,
                "provider": config.provider,
                "endpoint": config.api_base,
                "model": config.model_name,
                "system": IMAGE_SYSTEM_PROMPT,
                "prompt": IMAGE_ANALYSIS_PROMPT,
                "max_edge": config.image_max_edge,
                "quality": config.image_jpeg_quality,
                "max_tokens": config.max_output_tokens,
            },
            sort_keys=True,
            ensure_ascii=False,
        ).encode()
    ).hexdigest()
    return ImageCacheContext(digest, signature, config.image_cache_ttl_seconds)


def find_cached_parse(
    db, document: RAGContent, context: ImageCacheContext
) -> dict | None:
    candidates = (
        db.query(RAGContent)
        .filter(
            RAGContent.user_id == document.user_id,
            RAGContent.vector_collection == document.vector_collection,
            RAGContent.file_sha256 == context.sha256,
        )
        .populate_existing()
        .order_by(RAGContent.update_time.desc())
        .limit(10)
        .all()
    )
    for source in candidates:
        try:
            metadata = source.content_metadata or {}
            if isinstance(metadata, str):
                metadata = json.loads(metadata)
            snapshot = metadata.get("image_parse_cache") or {}
            age = time.time() - float(snapshot.get("created_at", 0))
            if (
                snapshot.get("sha256") != context.sha256
                or snapshot.get("signature") != context.signature
                or not 0 <= age < context.ttl
            ):
                continue
            result = copy.deepcopy(snapshot["result"])
            if (
                not isinstance(result.get("markdown_content"), str)
                or not result["markdown_content"].strip()
                or (
                    reusable_image_analysis(result) is None
                    and not reusable_ocr_parse(result)
                )
            ):
                continue
            result["metadata"].update(
                {
                    "file_path": document.file_path,
                    "image_parse_cache": copy.deepcopy(snapshot),
                    "image_cache_hit": True,
                }
            )
            return result
        except (AttributeError, KeyError, TypeError, ValueError):
            # A malformed/old cache is a miss; it must not block fresh processing.
            continue
    return None


def attach_snapshot(result: dict[str, Any], context: ImageCacheContext) -> None:
    if not (result.get("markdown_content") or "").strip() or (
        reusable_image_analysis(result) is None and not reusable_ocr_parse(result)
    ):
        return
    metadata = result["metadata"]
    if metadata.get("image_cache_hit"):
        return  # Reads do not extend the original expiry.
    # Store only pure parse output, never permissions, resource IDs or graph metadata.
    snapshot_result = {
        "success": True,
        "markdown_content": result["markdown_content"],
        "metadata": {
            "type": "image",
            **(
                {"image_analysis": copy.deepcopy(metadata["image_analysis"])}
                if metadata.get("image_analysis")
                else {}
            ),
            **(
                {
                    "ocr": copy.deepcopy(metadata["ocr"]),
                    "image_content_scope": metadata["image_content_scope"],
                }
                if metadata.get("ocr")
                else {}
            ),
            "vlm_events_count": metadata.get("vlm_events_count"),
        },
    }
    metadata["image_parse_cache"] = {
        "sha256": context.sha256,
        "signature": context.signature,
        "created_at": time.time(),
        "result": snapshot_result,
    }
    metadata["image_cache_hit"] = False


def persist_snapshot(
    db, document: RAGContent, result: dict, context: ImageCacheContext
):
    attach_snapshot(result, context)
    snapshot = (result.get("metadata") or {}).get("image_parse_cache")
    if not snapshot:
        return
    metadata = document.content_metadata or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except ValueError:
            metadata = {}
    if not isinstance(metadata, dict):
        metadata = {}
    document.content_metadata = {
        **metadata,
        "image_parse_cache": copy.deepcopy(snapshot),
    }
    document.file_sha256 = context.sha256
    # Persist the successful parse before releasing an identical upload's lock.
    # Vector ingestion may still be pending; it does not affect parse validity.
    db.commit()
