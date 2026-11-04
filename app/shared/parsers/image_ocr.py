"""Optional local OCR fast path; uncertain results retain the VLM path."""

from __future__ import annotations

import math
import os
import time
from pathlib import Path
from typing import Any

import requests
from pydantic import BaseModel, Field


class ImageOCRConfig(BaseModel):
    enabled: bool = True
    url: str = "http://127.0.0.1:8014/ocr"
    version: str = "rapidocr-v4-1"
    timeout: float = Field(default=20, gt=0, le=120)
    min_chars: int = Field(default=20, ge=1)
    min_blocks: int = Field(default=2, ge=1)
    min_confidence: float = Field(default=0.9, ge=0, le=1)
    min_block_confidence: float = Field(default=0.8, ge=0, le=1)
    max_bytes: int = Field(default=20 * 1024 * 1024, ge=1)

    @classmethod
    def from_env(cls) -> ImageOCRConfig:
        values = {}
        for name in cls.model_fields:
            value = os.getenv(
                "IMAGE_OCR_" + ("API_URL" if name == "url" else name.upper())
            )
            if value is not None:
                values[name] = value
        return cls(**values)

    def signature(self) -> dict[str, Any]:
        return self.model_dump(exclude={"timeout", "max_bytes"})


def reusable_ocr_parse(result: dict) -> bool:
    metadata = result.get("metadata") or {}
    ocr = metadata.get("ocr") if isinstance(metadata, dict) else None
    return bool(
        result.get("success")
        and isinstance(result.get("markdown_content"), str)
        and result["markdown_content"].strip()
        and isinstance(ocr, dict)
        and ocr.get("accepted") is True
        and ocr.get("engine")
        and metadata.get("image_content_scope") == "recognized_text"
    )


def _validated_result(payload: dict, config: ImageOCRConfig, path: str) -> dict | None:
    blocks = payload.get("blocks")
    if (
        not payload.get("success")
        or not isinstance(blocks, list)
        or len(blocks) < config.min_blocks
    ):
        return None
    text_lines = []
    scores = []
    for block in blocks:
        if not isinstance(block, dict) or not isinstance(block.get("text"), str):
            return None
        text = block["text"].strip()
        confidence = float(block.get("confidence", -1))
        if not text or not math.isfinite(confidence) or not 0 <= confidence <= 1:
            return None
        # Keep every detected line. Do not silently discard uncertain identifiers/numbers.
        if confidence < config.min_block_confidence:
            return None
        text_lines.append(text)
        scores.extend([confidence] * len(text))
    if (
        len(scores) < config.min_chars
        or sum(scores) / len(scores) < config.min_confidence
    ):
        return None
    if payload.get("truncated"):
        return None
    body = "\n".join(text_lines)
    return {
        "success": True,
        "markdown_content": body,
        "metadata": {
            "type": "image",
            "file_path": path,
            "image_content_scope": "recognized_text",
            "ocr": {
                "accepted": True,
                "engine": str(payload.get("engine") or "rapidocr"),
                "model_version": str(payload.get("model_version") or config.version),
                "confidence": round(sum(scores) / len(scores), 4),
                "block_count": len(text_lines),
                "seconds": payload.get("seconds"),
                "queue_seconds": payload.get("queue_seconds"),
            },
        },
    }


def convert_image_for_ingestion(
    path: str, *, title: str | None, vision_converter, image_mode: str = "auto"
) -> dict:
    config = ImageOCRConfig.from_env()
    attempt = None
    if image_mode == "auto" and config.enabled and config.url:
        start = time.monotonic()
        try:
            if Path(path).stat().st_size > config.max_bytes:
                raise ValueError("image_too_large_for_ocr")
            with requests.Session() as session:
                session.trust_env = False
                response = session.post(
                    config.url,
                    data=Path(path).read_bytes(),
                    headers={"Content-Type": "application/octet-stream"},
                    timeout=(1, config.timeout),
                )
                response.raise_for_status()
                if len(response.content) > 1024 * 1024:
                    raise ValueError("ocr_response_too_large")
                payload = response.json()
            result = _validated_result(payload, config, path)
            if result is not None:
                result["metadata"]["ocr"]["request_seconds"] = round(
                    time.monotonic() - start, 3
                )
                return result
            reason = "insufficient_text_or_confidence"
        except (
            requests.RequestException,
            OSError,
            TypeError,
            ValueError,
            AttributeError,
            KeyError,
        ):
            reason = "ocr_unavailable_or_invalid"
        attempt = {
            "accepted": False,
            "reason": reason,
            "seconds": round(time.monotonic() - start, 3),
        }
    result = vision_converter(path, title=title)
    if attempt and isinstance(result, dict):
        result.setdefault("metadata", {})["ocr_attempt"] = attempt
    return result
