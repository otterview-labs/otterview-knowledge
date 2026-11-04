from __future__ import annotations

import asyncio
import copy
import importlib
import threading
from types import SimpleNamespace
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
        VLM_IMAGE_CACHE_ENABLED="true",
        VLM_IMAGE_CACHE_TTL_SECONDS="86400",
        VLM_REUSE_IMAGE_ANALYSIS="true",
    )
    clear_modules()
    cache = importlib.import_module("app.services.image_parse_cache")
    queue = importlib.import_module("app.services.enrichment_service")
    models = importlib.import_module("app.db.models.rag")
    base = importlib.import_module("app.db.base_class").Base
    base.metadata.create_all(
        bind=queue.engine,
        tables=[
            models.RAGCollection.__table__,
            models.RAGContent.__table__,
            models.RAGCollectionContent.__table__,
            queue.RAGEnrichmentJob.__table__,
        ],
    )
    rag = importlib.import_module("app.services.enhanced_rag_service")
    fake = SimpleNamespace(add_document_to_vector_db=AsyncMock(return_value=True))
    monkeypatch.setattr(rag, "EnhancedRAGService", lambda: fake)
    module = importlib.import_module("app.services.multimodal_upload_service")
    uploader = module.MultimodalUploadService()
    body = "水泵PUMP-A01温度68°C，压力0.42MPa，转速1450rpm。"
    parsed = {
        "success": True,
        "markdown_content": body,
        "metadata": {
            "type": "image",
            "file_path": "/old/private.png",
            "vlm_events_count": 1,
            "image_analysis": {
                "summary": "水泵运行正常。",
                "tags": ["水泵"],
                "key_points": ["压力0.42MPa"],
                "content_category": "巡检",
            },
            "resource_id": "must-not-be-reused",
            "bindings": ["source-only"],
        },
    }
    calls = []

    def convert(*args, **kwargs):
        calls.append(args[0])
        return copy.deepcopy(parsed)

    uploader._converter = SimpleNamespace(convert_image_to_markdown=convert)
    uploader.content_analysis_service.analyze_content_smart = AsyncMock(
        side_effect=AssertionError("second AI request")
    )
    path = tmp_path / "pump.png"
    Image.new("RGB", (100, 80), "white").save(path)
    return SimpleNamespace(
        cache=cache,
        queue=queue,
        models=models,
        uploader=uploader,
        path=path,
        body=body,
        parsed=parsed,
        calls=calls,
        rag=fake,
    )


async def ingest(r, rid, *, user="tester", collection=None, options=None):
    with r.queue.SessionLocal() as db:
        return await r.uploader.process_uploaded_file_with_progress(
            str(r.path),
            "image/png",
            user,
            db,
            title="目标资源标题",
            resource_id=rid,
            collection_id=collection,
            parse_options=options,
        )


@pytest.mark.asyncio
async def test_duplicate_reuses_immutable_parse_without_copying_resource_metadata(
    runtime,
):
    r = runtime
    first = await ingest(r, "first")
    with r.queue.SessionLocal() as db:
        doc = db.get(r.models.RAGContent, first["content_id"])
        doc.content_text = "人工修改的正文，不是原始识别结果"
        db.commit()
    second = await ingest(r, "second")
    assert first["success"] and second["success"]
    assert len(r.calls) == 1
    with r.queue.SessionLocal() as db:
        doc = db.get(r.models.RAGContent, second["content_id"])
        assert doc.content_text == r.body
        assert doc.content_metadata["image_cache_hit"] is True
        assert doc.content_metadata["file_path"] == str(r.path)
        assert "bindings" not in doc.content_metadata
        assert "resource_id" not in doc.content_metadata
        assert doc.content_metadata["enrichment"]["status"] == "pending"
        assert doc.file_sha256
    r.uploader.content_analysis_service.analyze_content_smart.assert_not_awaited()


@pytest.mark.asyncio
async def test_reupload_same_resource_can_reuse_previous_successful_parse(runtime):
    first = await ingest(runtime, "same")
    second = await ingest(runtime, "same")
    assert first["content_id"] == second["content_id"]
    assert second["success"] and len(runtime.calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change",
    ["bytes", "model", "ttl", "user", "collection", "version", "force", "disabled"],
)
async def test_changed_inputs_scope_expiry_or_force_reprocess_do_not_reuse(
    runtime, monkeypatch, change
):
    r = runtime
    first = await ingest(r, "first")
    kwargs = {}
    if change == "bytes":
        Image.new("RGB", (100, 80), "red").save(r.path)
    elif change == "model":
        monkeypatch.setenv("VLM_MODEL_NAME", "new-model")
    elif change == "version":
        monkeypatch.setenv("VLM_IMAGE_CACHE_VERSION", "2")
    elif change == "disabled":
        monkeypatch.setenv("VLM_IMAGE_CACHE_ENABLED", "false")
    elif change == "user":
        kwargs["user"] = "another-user"
    elif change == "collection":
        kwargs["collection"] = "another-collection"
        with r.queue.SessionLocal() as db:
            db.add(
                r.models.RAGCollection(
                    id="another-collection", name="another-collection", user_id="tester"
                )
            )
            db.commit()
    elif change == "force":
        kwargs["options"] = {"force_reprocess": True}
    elif change == "ttl":
        with r.queue.SessionLocal() as db:
            doc = db.get(r.models.RAGContent, first["content_id"])
            md = copy.deepcopy(doc.content_metadata)
            md["image_parse_cache"]["created_at"] -= 86401
            doc.content_metadata = md
            db.commit()
    assert (await ingest(r, "second", **kwargs))["success"]
    assert len(r.calls) == 2


@pytest.mark.asyncio
async def test_failed_recognition_is_never_cached(runtime):
    r = runtime
    good = copy.deepcopy(r.parsed)
    r.parsed.clear()
    r.parsed.update(success=False, error="model failed", markdown_content="")
    assert not (await ingest(r, "first"))["success"]
    r.parsed.clear()
    r.parsed.update(good)
    assert (await ingest(r, "second"))["success"]
    assert len(r.calls) == 2


@pytest.mark.asyncio
async def test_vector_failure_does_not_require_recognizing_same_image_again(runtime):
    r = runtime
    r.rag.add_document_to_vector_db.return_value = False
    assert not (await ingest(r, "first"))["success"]
    r.rag.add_document_to_vector_db.return_value = True
    assert (await ingest(r, "second"))["success"]
    assert len(r.calls) == 1


@pytest.mark.asyncio
async def test_concurrent_identical_uploads_share_recognition(runtime):
    r = runtime
    started = threading.Event()
    release = threading.Event()

    def block(*args, **kwargs):
        r.calls.append(args[0])
        started.set()
        assert release.wait(5)
        return copy.deepcopy(r.parsed)

    r.uploader._converter.convert_image_to_markdown = block
    first = asyncio.create_task(ingest(r, "first"))
    assert await asyncio.to_thread(started.wait, 3)
    second = asyncio.create_task(ingest(r, "second"))
    try:
        for _ in range(20):
            await asyncio.sleep(0.01)
            with r.queue.SessionLocal() as db:
                if db.query(r.models.RAGContent).count() == 2:
                    break
        assert len(r.calls) == 1
    finally:
        release.set()
    results = await asyncio.gather(first, second)
    assert all(r["success"] for r in results)
    assert len(r.calls) == 1


@pytest.mark.asyncio
async def test_ocr_snapshot_reused_and_ai_summary_remains_pending(runtime):
    r = runtime
    r.parsed["metadata"] = {
        "type": "image",
        "image_content_scope": "recognized_text",
        "ocr": {"accepted": True, "engine": "rapidocr", "confidence": 0.98},
    }
    first = await ingest(r, "ocr-first")
    second = await ingest(r, "ocr-second")
    assert first["success"] and second["success"]
    assert len(r.calls) == 1
    with r.queue.SessionLocal() as db:
        doc = db.get(r.models.RAGContent, second["content_id"])
        metadata = doc.content_metadata
        assert metadata["image_cache_hit"] is True
        assert metadata["ocr"]["accepted"] is True
        assert metadata["enrichment"]["summary"]["status"] == "pending"
        assert metadata["enrichment"]["knowledge_graph"]["status"] == "pending"
        assert doc.content_text == r.body


def test_ocr_configuration_and_explicit_vision_have_distinct_cache_signatures(
    runtime, monkeypatch
):
    r = runtime
    context = r.cache.build_context(str(r.path))
    monkeypatch.setenv("IMAGE_OCR_VERSION", "new-engine")
    changed = r.cache.build_context(str(r.path))
    assert context.signature != changed.signature
    assert (
        changed.signature
        != r.cache.build_context(str(r.path), image_mode="vision").signature
    )
