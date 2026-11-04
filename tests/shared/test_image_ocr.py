from __future__ import annotations

import importlib
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import requests

from tests.helpers import clear_modules, configure_runtime_env

pytestmark = pytest.mark.unit


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    configure_runtime_env(monkeypatch, tmp_path, IMAGE_OCR_ENABLED=True)
    clear_modules()
    module = importlib.import_module("app.shared.parsers.image_ocr")
    path = tmp_path / "new.png"
    path.write_bytes(b"new image bytes")
    payload = {
        "success": True,
        "engine": "rapidocr",
        "model_version": "v4",
        "seconds": 1.2,
        "blocks": [
            {"text": "设备编号：PUMP-A01", "confidence": 0.99},
            {"text": "温度68°C，压力0.42MPa，转速1450rpm", "confidence": 0.98},
        ],
    }
    response = SimpleNamespace(
        content=b"{}", json=lambda: payload, raise_for_status=lambda: None
    )
    session = Mock()
    session.__enter__ = Mock(return_value=session)
    session.__exit__ = Mock(return_value=False)
    session.post.return_value = response
    monkeypatch.setattr(module.requests, "Session", lambda: session)
    vision = Mock(
        return_value={
            "success": True,
            "markdown_content": "完整视觉正文",
            "metadata": {},
        }
    )
    return SimpleNamespace(
        module=module, payload=payload, path=path, session=session, vision=vision
    )


def convert(r, mode="auto"):
    return r.module.convert_image_for_ingestion(
        str(r.path), title="new title", vision_converter=r.vision, image_mode=mode
    )


def test_new_image_uses_ocr_preserving_identifiers_without_vision(runtime):
    r = runtime
    result = convert(r)
    assert result["success"] and "PUMP-A01" in result["markdown_content"]
    assert "0.42MPa" in result["markdown_content"]
    assert r.module.reusable_ocr_parse(result)
    assert "image_analysis" not in result["metadata"]
    assert result["metadata"]["image_content_scope"] == "recognized_text"
    r.vision.assert_not_called()
    assert r.session.trust_env is False
    assert r.session.post.call_args.kwargs["data"] == r.path.read_bytes()
    assert r.session.post.call_args.kwargs["timeout"] == (1, 20)


@pytest.mark.parametrize(
    "kind",
    [
        "empty",
        "short",
        "low_id_confidence",
        "nan",
        "bad_confidence",
        "truncated",
        "malformed",
    ],
)
def test_uncertain_ocr_returns_to_vision_without_indexing_partial_text(runtime, kind):
    r = runtime
    if kind == "empty":
        r.payload["blocks"] = []
    elif kind == "short":
        r.payload["blocks"] = [{"text": "少", "confidence": 0.99}] * 2
    elif kind == "low_id_confidence":
        r.payload["blocks"][0]["confidence"] = 0.7
    elif kind == "nan":
        r.payload["blocks"][0]["confidence"] = float("nan")
    elif kind == "bad_confidence":
        r.payload["blocks"][0]["confidence"] = "bad"
    elif kind == "truncated":
        r.payload["truncated"] = True
    else:
        r.payload["blocks"][0] = None
    result = convert(r)
    r.vision.assert_called_once_with(str(r.path), title="new title")
    assert result["markdown_content"] == "完整视觉正文"
    assert result["metadata"]["ocr_attempt"]["accepted"] is False


def test_ocr_timeout_falls_back_to_vision(runtime):
    r = runtime
    r.session.post.side_effect = requests.Timeout("busy")
    result = convert(r)
    r.vision.assert_called_once()
    assert result["metadata"]["ocr_attempt"]["reason"] == "ocr_unavailable_or_invalid"


@pytest.mark.parametrize("mode,enabled", [("vision", True), ("auto", False)])
def test_disabled_or_explicit_vision_skips_ocr(runtime, monkeypatch, mode, enabled):
    monkeypatch.setenv("IMAGE_OCR_ENABLED", str(enabled).lower())
    convert(runtime, mode)
    runtime.session.post.assert_not_called()
    runtime.vision.assert_called_once()


def test_oversized_image_skips_http_and_preserves_vision_fallback(runtime, monkeypatch):
    monkeypatch.setenv("IMAGE_OCR_MAX_BYTES", "1")
    convert(runtime)
    runtime.session.post.assert_not_called()
    runtime.vision.assert_called_once()
