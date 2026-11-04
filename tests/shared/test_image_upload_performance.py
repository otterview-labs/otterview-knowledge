from __future__ import annotations

import base64
import importlib
import io
import json
from unittest.mock import AsyncMock

import pytest
from PIL import Image

from tests.helpers import clear_modules, configure_runtime_env

pytestmark = pytest.mark.unit


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    configure_runtime_env(
        monkeypatch,
        tmp_path,
        VLM_PROVIDER="local",
        VLM_API_BASE="http://127.0.0.1:18038/v1",
        VLM_MODEL_NAME="test-vision",
        VLM_REUSE_IMAGE_ANALYSIS="true",
        VLM_IMAGE_MAX_EDGE=0,
        VLM_MAX_OUTPUT_TOKENS=0,
    )
    clear_modules()
    return importlib.import_module("app.shared.parsers.unified_markdown_converter")


def _structured_result():
    return {
        "events": [{"type": "content", "description": "水泵A01运行中，压力0.42MPa。"}],
        "analysis": {
            "summary": "水泵A01运行正常。",
            "tags": ["水泵", "巡检"],
            "key_points": ["压力0.42MPa"],
            "content_category": "设备巡检",
        },
    }


def _model_response(value, *, status=200, finish_reason="stop"):
    class Response:
        status_code = status
        text = "test response"

        def json(self):
            return {
                "choices": [
                    {
                        "finish_reason": finish_reason,
                        "message": {"content": json.dumps(value, ensure_ascii=False)},
                    }
                ]
            }

    return Response()


@pytest.mark.asyncio
async def test_image_conversion_reuses_analysis_without_second_model_call(
    runtime, monkeypatch, tmp_path
):
    analyzer = importlib.import_module("app.shared.vlm.vision_analyzer")
    calls = []

    def post(url, **kwargs):
        calls.append(kwargs["json"])
        return _model_response(_structured_result())

    monkeypatch.setattr(analyzer.requests, "post", post)
    image = tmp_path / "pump.png"
    Image.new("RGB", (100, 80), "white").save(image)
    result = runtime.UnifiedMarkdownConverter().convert_image_to_markdown(str(image))
    service = importlib.import_module(
        "app.services.content_analysis_service"
    ).ContentAnalysisService()
    service.analyze_content_smart = AsyncMock(
        side_effect=AssertionError("unexpected second model call")
    )
    analysis = await service.analyze_parsed_content(result, "image")

    assert result["success"] is True
    assert "0.42MPa" in result["markdown_content"]
    assert analysis["ai_tags"] == ["水泵", "巡检"]
    assert analysis["analysis_method"] == "vlm_single_pass"
    assert len(calls) == 1
    assert calls[0]["model"] == "test-vision"
    service.analyze_content_smart.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "case", ["missing_analysis", "malformed_tags", "vlm_error", "fallback", "document"]
)
async def test_incomplete_or_failed_image_analysis_falls_back(runtime, case):
    value = {
        "success": True,
        "markdown_content": "正文内容",
        "metadata": {"image_analysis": _structured_result()["analysis"]},
    }
    if case == "missing_analysis":
        value["metadata"] = {}
    elif case == "malformed_tags":
        value["metadata"]["image_analysis"]["tags"] = "不是标签数组"
    elif case in {"vlm_error", "fallback"}:
        value["metadata"][case] = True
    service = importlib.import_module(
        "app.services.content_analysis_service"
    ).ContentAnalysisService()
    service.analyze_content_smart = AsyncMock(
        return_value={"success": True, "ai_summary": "回退摘要"}
    )
    result = await service.analyze_parsed_content(
        value, "document" if case == "document" else "image"
    )
    assert result["ai_summary"] == "回退摘要"
    service.analyze_content_smart.assert_awaited_once()


def test_legacy_image_output_and_explicit_disable_keep_separate_analysis(
    runtime, monkeypatch, tmp_path
):
    monkeypatch.setenv("VLM_REUSE_IMAGE_ANALYSIS", "false")
    analyzer = importlib.import_module("app.shared.vlm.vision_analyzer")
    prompts = []

    def post(url, **kwargs):
        prompts.append(str(kwargs["json"]["messages"]))
        return _model_response({"events": _structured_result()["events"]})

    monkeypatch.setattr(analyzer.requests, "post", post)
    path = tmp_path / "pump.png"
    Image.new("RGB", (100, 80), "white").save(path)
    result = runtime.UnifiedMarkdownConverter().convert_image_to_markdown(str(path))
    assert result["success"] is True
    assert "image_analysis" not in result["metadata"]
    assert '"analysis"' not in prompts[0]


@pytest.mark.parametrize(
    "response",
    [
        {"description": "水泵压力0.42MPa"},
        {"images": [{"description": "水泵压力0.42MPa"}]},
    ],
)
def test_plain_description_remains_usable_without_structured_analysis(
    runtime, monkeypatch, tmp_path, response
):
    analyzer = importlib.import_module("app.shared.vlm.vision_analyzer")
    monkeypatch.setattr(
        analyzer.requests, "post", lambda *a, **kw: _model_response(response)
    )
    path = tmp_path / "pump.png"
    Image.new("RGB", (100, 80), "white").save(path)
    result = runtime.UnifiedMarkdownConverter().convert_image_to_markdown(str(path))
    assert result["success"] is True
    assert "0.42MPa" in result["markdown_content"]
    assert "image_analysis" not in result["metadata"]


@pytest.mark.parametrize(
    "response",
    [
        {"events": []},
        {"events": [{}]},
        {"events": [{"description": " "}]},
        {"error": "模型不可用"},
    ],
)
def test_failed_image_analysis_is_not_successful_content(
    runtime, monkeypatch, tmp_path, response
):
    analyzer = importlib.import_module("app.shared.vlm.vision_analyzer")
    monkeypatch.setattr(
        analyzer.requests, "post", lambda *a, **kw: _model_response(response)
    )
    path = tmp_path / "pump.png"
    Image.new("RGB", (100, 80), "white").save(path)
    result = runtime.UnifiedMarkdownConverter().convert_image_to_markdown(str(path))
    assert result["success"] is False
    assert result["markdown_content"] == ""
    assert result["error"]


def test_downscale_limits_payload_and_preserves_original(runtime, tmp_path):
    module = importlib.import_module("app.shared.vlm.image_input")
    path = tmp_path / "large.png"
    Image.new("RGBA", (2400, 1200), (0, 0, 0, 0)).save(path)
    original = path.read_bytes()
    result = module.local_image_data_url(str(path), max_edge=1200)
    with Image.open(io.BytesIO(base64.b64decode(result.split(",", 1)[1]))) as image:
        assert image.size == (1200, 600)
        assert image.getpixel((0, 0)) == (255, 255, 255)
    assert path.read_bytes() == original


def test_image_timeout_uses_one_attempt_without_changing_generic_retry_budget(
    runtime, monkeypatch, tmp_path
):
    module = importlib.import_module("app.shared.vlm.vision_analyzer")
    calls = []

    def timeout(*args, **kwargs):
        calls.append(kwargs)
        raise module.requests.ReadTimeout("queued model request")

    monkeypatch.setattr(module.requests, "post", timeout)
    path = tmp_path / "pump.png"
    Image.new("RGB", (100, 80), "white").save(path)
    result = runtime.UnifiedMarkdownConverter().convert_image_to_markdown(str(path))
    assert result["success"] is False
    assert len(calls) == 1
    assert calls[0]["timeout"] == 180
    generic = importlib.import_module("app.shared.vlm.config").VLMConfig.from_env()
    assert generic.batch_timeout == 60 and generic.max_retries == 3


def test_downscale_applies_orientation_before_size_limit(runtime, tmp_path):
    module = importlib.import_module("app.shared.vlm.image_input")
    path = tmp_path / "rotated.jpg"
    image = Image.new("RGB", (400, 200), "white")
    exif = image.getexif()
    exif[274] = 6
    image.save(path, exif=exif)
    result = module.local_image_data_url(str(path), max_edge=200)
    with Image.open(io.BytesIO(base64.b64decode(result.split(",", 1)[1]))) as prepared:
        assert prepared.size == (100, 200)


def test_small_images_are_byte_identical_and_urls_are_not_fetched(runtime, tmp_path):
    module = importlib.import_module("app.shared.vlm.image_input")
    path = tmp_path / "small.png"
    Image.new("RGB", (100, 80), "white").save(path)
    result = module.local_image_data_url(str(path), max_edge=1200)
    assert base64.b64decode(result.split(",", 1)[1]) == path.read_bytes()
    analyzer = importlib.import_module("app.shared.vlm.vision_analyzer")
    assert (
        analyzer.VisionAnalyzer._to_openai_image_url(
            "https://example.com/image.png", max_edge=1200
        )
        == "https://example.com/image.png"
    )


@pytest.mark.parametrize(
    "status,expected_calls", [(400, 1), (401, 1), (422, 1), (429, 3), (503, 3)]
)
def test_permanent_request_errors_are_not_retried(
    runtime, monkeypatch, status, expected_calls
):
    module = importlib.import_module("app.shared.vlm.vision_analyzer")
    config = importlib.import_module("app.shared.vlm.config").VLMConfig.from_env()
    calls = []

    def post(*args, **kwargs):
        calls.append(kwargs)
        return _model_response({}, status=status)

    monkeypatch.setattr(module.requests, "post", post)
    monkeypatch.setattr(module.time, "sleep", lambda delay: None)
    error_type = (
        module.requests.HTTPError if status < 500 and status != 429 else RuntimeError
    )
    with pytest.raises(error_type):
        module.VisionAnalyzer(config)._call_llm_with_retry([])
    assert len(calls) == expected_calls


def test_output_budget_is_sent_and_truncation_fails_without_retry(runtime, monkeypatch):
    module = importlib.import_module("app.shared.vlm.vision_analyzer")
    config = (
        importlib.import_module("app.shared.vlm.config")
        .VLMConfig.from_env()
        .model_copy(update={"max_output_tokens": 512})
    )
    calls = []

    def post(*args, **kwargs):
        calls.append(kwargs["json"])
        return _model_response({}, finish_reason="length")

    monkeypatch.setattr(module.requests, "post", post)
    with pytest.raises(ValueError, match="截断"):
        module.VisionAnalyzer(config)._call_llm_with_retry([])
    assert len(calls) == 1
    assert calls[0]["max_tokens"] == 512


@pytest.mark.asyncio
async def test_failed_conversion_marks_upload_failed_without_analysis(
    runtime, monkeypatch, tmp_path
):
    from types import SimpleNamespace

    session_module = importlib.import_module("app.db.session")
    base = importlib.import_module("app.db.base_class").Base
    module = importlib.import_module("app.services.multimodal_upload_service")
    models = importlib.import_module("app.db.models.rag")
    base.metadata.create_all(
        bind=session_module.engine,
        tables=[models.RAGCollection.__table__, models.RAGContent.__table__],
    )
    service = module.MultimodalUploadService()
    service._converter = SimpleNamespace(
        convert_image_to_markdown=lambda *args, **kwargs: {
            "success": False,
            "error": "VLM输出截断",
            "markdown_content": "",
        },
    )
    service.content_analysis_service.analyze_parsed_content = AsyncMock()
    monkeypatch.setattr(
        service,
        "validate_file",
        lambda *args: {"valid": True, "type": "image", "size": 1},
    )
    path = tmp_path / "upload.png"
    Image.new("RGB", (100, 80), "white").save(path)
    with session_module.SessionLocal() as db:
        result = await service.process_uploaded_file_with_progress(
            str(path),
            "image/png",
            "tester",
            db,
            resource_id="failed-conversion-test",
        )
        content = (
            db.query(module.RAGContent)
            .filter_by(resource_id="failed-conversion-test")
            .one()
        )
        assert result["success"] is False
        assert content.processing_status == "failed"
        assert "截断" in content.processing_message
        assert not content.content_text
        service.content_analysis_service.analyze_parsed_content.assert_not_awaited()
