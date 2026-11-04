from __future__ import annotations

import asyncio
import importlib
import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from tests.helpers import clear_modules, configure_runtime_env

pytestmark = pytest.mark.unit


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    configure_runtime_env(monkeypatch, tmp_path)
    clear_modules()
    module = importlib.import_module("app.services.enrichment_service")
    models = importlib.import_module("app.db.models.rag")
    base = importlib.import_module("app.db.base_class").Base
    base.metadata.create_all(
        bind=module.engine,
        tables=[
            models.RAGCollection.__table__,
            models.RAGContent.__table__,
            models.RAGCollectionContent.__table__,
            module.RAGEnrichmentJob.__table__,
        ],
    )
    rag = importlib.import_module("app.services.enhanced_rag_service")
    fake_rag = SimpleNamespace(
        add_document_to_vector_db=AsyncMock(return_value=True),
        upsert_doc_profile_vector=AsyncMock(return_value=True),
    )
    monkeypatch.setattr(rag, "EnhancedRAGService", lambda: fake_rag)
    analysis = importlib.import_module("app.services.content_analysis_service")
    analyze = AsyncMock(
        return_value={
            "success": True,
            "ai_summary": "AI生成摘要",
            "ai_tags": ["AI标签"],
            "key_points": ["压力0.42MPa"],
            "content_category": "巡检",
            "analysis_method": "llm_enhanced",
        }
    )
    monkeypatch.setattr(
        analysis.ContentAnalysisService, "analyze_content_smart", analyze
    )
    graph_module = importlib.import_module("app.core.kg.manager")
    manager = SimpleNamespace(
        is_enabled=lambda: True,
        add_document_to_graph=AsyncMock(
            return_value={
                "graph_result": {
                    "node_count": 2,
                    "edge_count": 1,
                    "method": "llm_chunked",
                }
            }
        ),
        finalize=AsyncMock(),
    )
    monkeypatch.setattr(graph_module, "KnowledgeGraphManager", lambda **kwargs: manager)
    config = importlib.import_module("app.config")
    monkeypatch.setattr(config.settings.kg_pipeline, "ENABLED", True)
    upload_module = importlib.import_module("app.services.multimodal_upload_service")
    service = upload_module.MultimodalUploadService()
    body = "水泵PUMP-A01运行正常，温度68°C，压力0.42MPa，转速1450rpm，无报警。"
    service._converter = SimpleNamespace(
        convert_document_to_markdown=lambda *args, **kwargs: {
            "success": True,
            "markdown_content": body,
            "metadata": {},
        }
    )
    path = tmp_path / "inspection.txt"
    path.write_text(body)
    return SimpleNamespace(
        queue=module,
        models=models,
        uploader=service,
        path=path,
        analyze=analyze,
        graph=manager,
        rag=fake_rag,
        body=body,
    )


async def ingest(runtime, options=None, resource_id="test-resource"):
    with runtime.queue.SessionLocal() as db:
        result = await runtime.uploader.process_uploaded_file_with_progress(
            str(runtime.path),
            "text/plain",
            "tester",
            db,
            parse_options=options,
            resource_id=resource_id,
        )
    return result


@pytest.mark.asyncio
async def test_searchable_ingestion_returns_before_ai_then_durable_worker_finishes(
    runtime,
):
    result = await ingest(runtime)
    assert result["success"] is True
    cid = result["content_id"]
    runtime.analyze.assert_not_awaited()
    runtime.graph.add_document_to_graph.assert_not_awaited()
    runtime.rag.add_document_to_vector_db.assert_awaited_once()
    with runtime.queue.SessionLocal() as db:
        doc = db.get(runtime.models.RAGContent, cid)
        assert doc.processing_status == "completed"
        assert "已入库可检索" in doc.processing_message
        assert doc.content_text == runtime.body
        assert doc.content_metadata["enrichment"]["status"] == "pending"
        assert db.get(runtime.queue.RAGEnrichmentJob, cid).status == "pending"

    # A new worker/session can resume durable work after the uploader has returned.
    assert await runtime.queue.run_next() is True
    with runtime.queue.SessionLocal() as db:
        doc = db.get(runtime.models.RAGContent, cid)
        assert doc.content_summary == "AI生成摘要"
        assert doc.content_metadata["enrichment"]["status"] == "completed"
        assert doc.content_metadata["knowledge_graph"]["edge_count"] == 1
        assert doc.content_metadata["knowledge_graph"]["method"] == "llm_chunked"
        assert doc.content_metadata["knowledge_graph"]["degraded"] is False
        assert doc.processing_status == "completed"
        assert db.get(runtime.queue.RAGEnrichmentJob, cid).status == "completed"
    runtime.rag.upsert_doc_profile_vector.assert_awaited_once()
    runtime.graph.finalize.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid_summary", [False, True])
async def test_long_upload_analyzes_all_sections_after_ingestion(
    runtime, monkeypatch, invalid_summary,
):
    sections = [f"第{i}节：" + "设备运行参数。" * 420 + f"段末标记{i}\n" for i in range(6)]
    body = "".join(sections)
    runtime.uploader._converter.convert_document_to_markdown = lambda *args, **kwargs: {
        "success": True, "markdown_content": body, "metadata": {},
    }
    runtime.path.write_text(body)
    parser = importlib.import_module("app.shared.parsers.llm_enhanced_parser")
    section_inputs = []
    final_input = []

    def model(_self, prompt, *_args):
        instruction, source = prompt.split("\n\n", 1)
        if instruction.startswith("概括这一段"):
            section_inputs.append(source)
            return {"success": True, "content": f"片段{len(section_inputs)}：" + source[-10:]}
        if instruction.startswith("合并这些"):
            return {"success": True, "content": source}
        final_input.append(source)
        value = "模型没有返回 JSON" if invalid_summary else json.dumps({
            "summary": "包含末段的全文摘要", "tags": ["设备"], "key_points": ["末段参数"],
        })
        return {"success": True, "content": value}

    monkeypatch.setattr(parser.LLMEnhancedParser, "call_llm_api", model)
    monkeypatch.setenv("UPLOAD_ENRICHMENT_MAX_ATTEMPTS", "1")
    result = await ingest(runtime)
    assert result["success"]
    assert section_inputs == []
    runtime.analyze.assert_not_awaited()
    with runtime.queue.SessionLocal() as db:
        doc = db.get(runtime.models.RAGContent, result["content_id"])
        assert doc.processing_status == "completed"
        assert doc.content_text == body
        assert doc.content_metadata["enrichment"]["summary"] == {
            "status": "pending", "scope": "full_document",
        }
        basic_summary = doc.content_summary
    assert await runtime.queue.run_next()
    assert "".join(section_inputs) == body
    assert len(section_inputs) > 4
    assert all(len(section) <= 3000 for section in section_inputs)
    assert "段末标记5" in final_input[0]
    with runtime.queue.SessionLocal() as db:
        doc = db.get(runtime.models.RAGContent, result["content_id"])
        stage = doc.content_metadata["enrichment"]["summary"]
        assert doc.processing_status == "completed"
        if invalid_summary:
            assert doc.content_metadata["enrichment"]["status"] == "failed"
            assert stage["status"] != "completed"
            assert doc.content_summary == basic_summary
        else:
            assert stage["status"] == "completed"
            assert stage["section_count"] == len(section_inputs)
            assert doc.content_summary == "包含末段的全文摘要"


@pytest.mark.asyncio
async def test_document_reader_endpoints_keep_enrichment_and_relations_document_scoped(
    runtime,
):
    import httpx
    from fastapi import FastAPI

    result = await ingest(runtime)
    cid = result["content_id"]
    endpoint = importlib.import_module("app.api.v1.rag.endpoints.document_operations")
    with runtime.queue.SessionLocal() as db:
        doc = db.get(runtime.models.RAGContent, cid)
        doc.is_public = False
        db.commit()
    actor = SimpleNamespace(id="someone-else")
    app = FastAPI()
    app.include_router(endpoint.router, prefix="/documents")
    app.dependency_overrides[endpoint.get_optional_request_user] = lambda: actor

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        for suffix in ["enrichment", "relations"]:
            assert (await client.get(f"/documents/{cid}/{suffix}")).status_code == 404
        actor.id = "tester"
        response = await client.post("/documents/get", json={"document_id": cid})
        detail = response.json()["result"]
        assert detail["raw_content"] == runtime.body
        assert detail["enrichment"]["summary"]["status"] == "pending"
        assert detail["enrichment"]["processing_status"] == "completed"
        pending = (await client.get(f"/documents/{cid}/relations")).json()["result"]
        assert pending == {"status": "pending", "relations": []}

        assert await runtime.queue.run_next()
        runtime.graph.query_edges = AsyncMock(return_value=[
            {"source": "水泵", "target": "压力", "type": "监测",
             "properties": {"source_doc": cid, "evidence": "压力0.42MPa"}},
            {"source": "水泵", "target": "其他文档的数据", "source_doc": cid, "properties": {}},
            {"source": "水泵", "target": "其他文档的关系",
             "properties": {"source_doc": "other-doc", "evidence": "其他证据"}},
        ])
        updated = (await client.get(f"/documents/{cid}/enrichment")).json()["result"]
        assert updated["summary"]["generated_text"] == "AI生成摘要"
        assert updated["summary"]["key_points"] == ["压力0.42MPa"]
        relations = (await client.get(f"/documents/{cid}/relations")).json()["result"]
        assert relations == {"status": "completed", "relations": [{
            "source": "水泵", "target": "压力", "type": "监测", "evidence": "压力0.42MPa",
        }]}


@pytest.mark.asyncio
async def test_vector_failure_does_not_claim_searchable_or_enqueue_ai(runtime):
    runtime.rag.add_document_to_vector_db.return_value = False
    result = await ingest(runtime)
    assert result["success"] is False
    with runtime.queue.SessionLocal() as db:
        assert db.query(runtime.queue.RAGEnrichmentJob).count() == 0
        assert (
            db.get(runtime.models.RAGContent, result["content_id"]).processing_status
            == "failed"
        )
    runtime.analyze.assert_not_awaited()
    runtime.graph.add_document_to_graph.assert_not_awaited()


@pytest.mark.asyncio
async def test_sync_mode_waits_for_ai_and_does_not_enqueue(runtime):
    result = await ingest(runtime, {"processing_mode": "sync"})
    assert result["success"] is True
    runtime.analyze.assert_awaited_once()
    runtime.graph.add_document_to_graph.assert_awaited_once()
    with runtime.queue.SessionLocal() as db:
        assert db.query(runtime.queue.RAGEnrichmentJob).count() == 0


@pytest.mark.asyncio
async def test_claim_is_exclusive_and_expired_lease_can_resume(runtime):
    result = await ingest(runtime)
    first = runtime.queue.claim_next()
    assert first is not None
    assert runtime.queue.claim_next() is None
    with runtime.queue.SessionLocal() as db:
        job = db.get(runtime.queue.RAGEnrichmentJob, result["content_id"])
        job.lease_until = runtime.queue._now() - timedelta(seconds=1)
        db.commit()
    second = runtime.queue.claim_next()
    assert second is not None and second.owner != first.owner
    with pytest.raises(runtime.queue.StaleClaim):
        runtime.queue._checkpoint(
            first, "summary", {"status": "completed"}, {"ai_summary": "过期结果"}
        )


@pytest.mark.asyncio
async def test_reupload_invalidates_old_job_and_preserves_primary_key(runtime):
    first_result = await ingest(runtime)
    first = runtime.queue.claim_next()
    second_result = await ingest(runtime)
    assert second_result["content_id"] == first_result["content_id"]
    with pytest.raises(runtime.queue.StaleClaim):
        runtime.queue._finish(first)
    assert await runtime.queue.run_next()


@pytest.mark.asyncio
async def test_retry_preserves_completed_summary_and_manual_changes(runtime):
    result = await ingest(runtime)
    with runtime.queue.SessionLocal() as db:
        doc = db.get(runtime.models.RAGContent, result["content_id"])
        doc.summary_manually_modified = True
        doc.tags_manually_modified = True
        doc.content_summary = "人工摘要"
        doc.content_tags = ["人工标签"]
        db.commit()
    runtime.graph.add_document_to_graph.side_effect = [
        RuntimeError("temporary"),
        {"graph_result": {"node_count": 2}},
    ]
    await runtime.queue.run_next()
    with runtime.queue.SessionLocal() as db:
        doc = db.get(runtime.models.RAGContent, result["content_id"])
        assert doc.content_summary == "人工摘要"
        assert doc.content_tags == ["人工标签"]
        assert doc.content_metadata["enrichment"]["summary"]["status"] == "completed"
        job = db.get(runtime.queue.RAGEnrichmentJob, doc.id)
        assert job.status == "pending"
        job.available_at = runtime.queue._now() - timedelta(seconds=1)
        db.commit()
    await runtime.queue.run_next()
    runtime.analyze.assert_awaited_once()
    with runtime.queue.SessionLocal() as db:
        assert (
            db.get(runtime.queue.RAGEnrichmentJob, result["content_id"]).status
            == "completed"
        )


@pytest.mark.asyncio
async def test_cancelled_worker_requeues_durable_job(runtime):
    result = await ingest(runtime)
    started = asyncio.Event()

    async def block(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()

    runtime.analyze.side_effect = block
    work = asyncio.create_task(runtime.queue.run_next())
    await started.wait()
    work.cancel()
    with pytest.raises(asyncio.CancelledError):
        await work
    with runtime.queue.SessionLocal() as db:
        job = db.get(runtime.queue.RAGEnrichmentJob, result["content_id"])
        assert job.status == "pending"
        assert job.lease_owner is None
        assert job.attempts == 0
        assert (
            db.get(runtime.models.RAGContent, job.content_id).processing_status
            == "completed"
        )


@pytest.mark.asyncio
async def test_reupload_during_work_does_not_cancel_queue_consumer(
    runtime, monkeypatch
):
    await ingest(runtime)
    started = asyncio.Event()
    superseded = asyncio.Event()

    async def block(*args, **kwargs):
        started.set()
        await asyncio.Event().wait()

    async def lost_lease(claim, work):
        await superseded.wait()
        work.cancel()

    runtime.analyze.side_effect = block
    monkeypatch.setattr(runtime.queue, "_heartbeat", lost_lease)
    work = asyncio.create_task(runtime.queue.run_next())
    await started.wait()
    await ingest(runtime)
    superseded.set()
    assert await work is True
    runtime.analyze.side_effect = None
    assert await runtime.queue.run_next() is True


@pytest.mark.asyncio
async def test_failed_summary_vector_is_retried_without_repeating_ai(runtime):
    result = await ingest(runtime)
    runtime.rag.upsert_doc_profile_vector.return_value = False
    await runtime.queue.run_next()
    runtime.graph.add_document_to_graph.assert_not_awaited()
    with runtime.queue.SessionLocal() as db:
        doc = db.get(runtime.models.RAGContent, result["content_id"])
        assert doc.processing_status == "completed"
        assert doc.content_metadata["enrichment"]["summary"]["status"] == "completed"
        job = db.get(runtime.queue.RAGEnrichmentJob, doc.id)
        assert job.status == "pending"
        job.available_at = runtime.queue._now() - timedelta(seconds=1)
        db.commit()
    runtime.rag.upsert_doc_profile_vector.return_value = True
    await runtime.queue.run_next()
    runtime.analyze.assert_awaited_once()
    runtime.graph.add_document_to_graph.assert_awaited_once()
