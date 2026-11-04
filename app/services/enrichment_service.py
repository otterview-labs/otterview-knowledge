"""Persist AI enrichment independently of searchable document ingestion."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import and_, or_, text

from app.db.models.enrichment_job import RAGEnrichmentJob
from app.db.models.rag import RAGContent
from app.db.session import SessionLocal, engine
from app.services.content_analysis_service import TEXT_ANALYSIS_LIMIT

logger = logging.getLogger(__name__)
_task: asyncio.Task | None = None
LEASE_SECONDS = 120


def _now() -> datetime:
    # Queue columns store naive UTC consistently across PostgreSQL and SQLite.
    return datetime.now(UTC).replace(tzinfo=None)


def _metadata(content: RAGContent) -> dict[str, Any]:
    value = content.content_metadata
    if isinstance(value, str):
        import json

        value = json.loads(value)
    return dict(value or {})


def enqueue_enrichment(db, content: RAGContent) -> None:
    """Called in the transaction that marks vector ingestion complete."""
    revision = uuid.uuid4().hex
    metadata = _metadata(content)
    full_document = len(content.content_text or "") > TEXT_ANALYSIS_LIMIT
    summary_ready = not full_document and (metadata.get("ai_analysis") or {}).get(
        "analysis_method"
    ) == "vlm_single_pass"
    metadata["enrichment"] = {
        "status": "pending",
        "revision": revision,
        "summary": {
            "status": "completed" if summary_ready else "pending",
            "scope": "full_document" if full_document else "parsed_text",
        },
        "knowledge_graph": {"status": "pending"},
    }
    content.content_metadata = metadata
    job = db.get(RAGEnrichmentJob, content.id)
    if job is None:
        job = RAGEnrichmentJob(content_id=content.id)
        db.add(job)
    job.revision = revision
    job.status = "pending"
    job.attempts = 0
    job.available_at = _now()
    job.lease_until = None
    job.lease_owner = None
    job.last_error = None


@dataclass(frozen=True)
class Claim:
    content_id: str
    revision: str
    owner: str


def _eligible(now):
    return or_(
        RAGEnrichmentJob.status == "pending",
        and_(
            RAGEnrichmentJob.status == "running",
            RAGEnrichmentJob.lease_until < now,
        ),
    )


def claim_next() -> Claim | None:
    now = _now()
    max_attempts = int(os.getenv("UPLOAD_ENRICHMENT_MAX_ATTEMPTS", "3"))
    with SessionLocal() as db:
        # One background model consumer across PostgreSQL application workers.
        if (
            db.bind.dialect.name == "postgresql"
            and not db.execute(
                text("SELECT pg_try_advisory_xact_lock(742193601)")
            ).scalar()
        ):
            return None
        if (
            db.query(RAGEnrichmentJob)
            .filter(
                RAGEnrichmentJob.status == "running",
                RAGEnrichmentJob.lease_until >= now,
            )
            .first()
            is not None
        ):
            return None
        job = (
            db.query(RAGEnrichmentJob)
            .join(RAGContent)
            .filter(
                _eligible(now),
                RAGEnrichmentJob.available_at <= now,
                RAGContent.processing_status == "completed",
            )
            .order_by(RAGEnrichmentJob.available_at)
            .first()
        )
        if job is None:
            return None
        if job.attempts >= max_attempts:
            job.status = "failed"
            job.last_error = "后台处理重试次数已用尽"
            document = db.get(RAGContent, job.content_id)
            metadata = _metadata(document)
            metadata["enrichment"] = {
                **metadata.get("enrichment", {}),
                "status": "failed",
                "error": job.last_error,
            }
            document.content_metadata = metadata
            db.commit()
            return None
        claim = Claim(job.content_id, job.revision, uuid.uuid4().hex)
        changed = (
            db.query(RAGEnrichmentJob)
            .filter(
                RAGEnrichmentJob.content_id == claim.content_id,
                RAGEnrichmentJob.revision == claim.revision,
                _eligible(now),
            )
            .update(
                {
                    "status": "running",
                    "attempts": RAGEnrichmentJob.attempts + 1,
                    "lease_owner": claim.owner,
                    "lease_until": now + timedelta(seconds=LEASE_SECONDS),
                },
                synchronize_session=False,
            )
        )
        db.commit()
        return claim if changed else None


class StaleClaim(Exception):
    pass


def _owned(db, claim: Claim):
    content = (
        db.query(RAGContent)
        .filter(RAGContent.id == claim.content_id)
        .with_for_update()
        .first()
    )
    job = (
        db.query(RAGEnrichmentJob)
        .filter(RAGEnrichmentJob.content_id == claim.content_id)
        .with_for_update()
        .first()
    )
    if (
        job is None
        or content is None
        or job.status != "running"
        or job.revision != claim.revision
        or job.lease_owner != claim.owner
        or content.processing_status != "completed"
    ):
        raise StaleClaim()
    return job, content


def _checkpoint(claim: Claim, stage: str, result: dict, analysis: dict | None = None):
    with SessionLocal() as db:
        _, content = _owned(db, claim)
        metadata = _metadata(content)
        enrichment = dict(metadata["enrichment"])
        enrichment["status"] = "running"
        enrichment[stage] = {**result, "updated_at": _now().isoformat()}
        metadata["enrichment"] = enrichment
        if stage == "knowledge_graph":
            metadata["knowledge_graph"] = enrichment[stage]
        if analysis:
            if not content.summary_manually_modified:
                content.content_summary = analysis["ai_summary"]
            if not content.tags_manually_modified:
                content.content_tags = analysis.get("ai_tags", [])
            metadata["ai_analysis"] = {
                "analysis_method": analysis.get("analysis_method", "background_ai"),
                "generated_summary": analysis["ai_summary"],
                "key_points": analysis.get("key_points", []),
                "content_category": analysis.get("content_category", ""),
            }
        content.content_metadata = metadata
        db.commit()


async def _process(claim: Claim):
    with SessionLocal() as db:
        _, content = _owned(db, claim)
        metadata = _metadata(content)
        stages = metadata["enrichment"]
        text, content_type = content.content_text, content.content_type
        graph_metadata = {
            key: getattr(content, key, None)
            for key in (
                "vector_collection",
                "resource_id",
                "resource_type",
                "file_name",
                "content_type",
                "user_id",
            )
        }
    if stages["summary"]["status"] != "completed":
        from app.services.content_analysis_service import ContentAnalysisService

        full_document = len(text or "") > TEXT_ANALYSIS_LIMIT
        scope = "full_document" if full_document else "parsed_text"
        _checkpoint(claim, "summary", {"status": "running", "scope": scope})
        analyzer = ContentAnalysisService()
        if full_document:
            analysis = await analyzer.analyze_full_text(text, content_type)
        else:
            analysis = await analyzer.analyze_parsed_content(
                {"success": True, "markdown_content": text, "metadata": metadata},
                content_type,
            )
        if (
            not analysis.get("success")
            or not analysis.get("ai_summary")
            or analysis.get("analysis_method") == "simple_fallback"
        ):
            raise RuntimeError("AI摘要未完成，等待重试")
        summary_stage = {"status": "completed", "scope": scope}
        if full_document:
            summary_stage["section_count"] = analysis["section_count"]
        _checkpoint(claim, "summary", summary_stage, analysis)

    # The document profile vector uses the new summary; body chunks remain searchable throughout.
    if stages.get("profile", {}).get("status") != "completed":
        from app.services.enhanced_rag_service import EnhancedRAGService

        with SessionLocal() as db:
            _, content = _owned(db, claim)
            db.expunge(content)
        # Model/network work must not hold document locks and delay a re-upload.
        if not await EnhancedRAGService().upsert_doc_profile_vector(content):
            raise RuntimeError("AI摘要概要向量更新失败，等待重试")
        _checkpoint(claim, "profile", {"status": "completed"})

    if stages["knowledge_graph"]["status"] not in {"completed", "skipped"}:
        from app.config import settings

        reason = None
        if not settings.kg_pipeline.ENABLED:
            reason = "配置禁用知识图谱"
        elif len(text or "") < int(settings.kg_pipeline.MIN_TEXT_LENGTH or 0):
            reason = "正文未达到图谱最小长度"
        if reason:
            _checkpoint(
                claim, "knowledge_graph", {"status": "skipped", "reason": reason}
            )
        else:
            from app.core.kg.manager import KnowledgeGraphManager

            namespace = (
                settings.graph_db.GRAPH_NAMESPACE or "default"
            ).strip() or "default"
            manager = KnowledgeGraphManager(namespace=namespace)
            try:
                if not manager.is_enabled():
                    _checkpoint(
                        claim,
                        "knowledge_graph",
                        {"status": "skipped", "reason": "图谱未启用或未配置"},
                    )
                else:
                    # Re-check ownership before sending a potentially long model request.
                    with SessionLocal() as db:
                        _owned(db, claim)
                    _checkpoint(claim, "knowledge_graph", {"status": "running"})
                    result = await manager.add_document_to_graph(
                        claim.content_id, text, metadata=graph_metadata
                    )
                    graph = (result or {}).get("graph_result") or {}
                    if (
                        not result
                        or result.get("error")
                        or not graph
                        or graph.get("error")
                    ):
                        raise RuntimeError("知识图谱构建失败")
                    _checkpoint(
                        claim,
                        "knowledge_graph",
                        {
                            "status": "completed",
                            "node_count": graph.get("node_count", 0),
                            "edge_count": graph.get("edge_count", 0),
                            "kg_namespace": namespace,
                            "method": graph.get("method"),
                            "degraded": graph.get("method")
                            == "keyword_quality_fallback",
                        },
                    )
            finally:
                await manager.finalize()


def _finish(claim: Claim, error: Exception | None = None, cancelled: bool = False):
    with SessionLocal() as db:
        job, content = _owned(db, claim)
        job.lease_owner = None
        job.lease_until = None
        if error or cancelled:
            if cancelled:
                job.attempts = max(0, job.attempts - 1)
            exhausted = (
                job.attempts >= int(os.getenv("UPLOAD_ENRICHMENT_MAX_ATTEMPTS", "3"))
                and not cancelled
            )
            job.status = "failed" if exhausted else "pending"
            job.last_error = str(error)[:500] if error else "服务关闭，等待恢复"
            job.available_at = _now() + timedelta(
                seconds=2 if cancelled else min(60, 5 * 2**job.attempts)
            )
        else:
            job.status = "completed"
            job.last_error = None
        metadata = _metadata(content)
        metadata["enrichment"] = {
            **metadata["enrichment"],
            "status": job.status,
            "attempts": job.attempts,
            "error": job.last_error,
        }
        content.content_metadata = metadata
        content.processing_message = (
            "已入库可检索，后台AI处理完成"
            if job.status == "completed"
            else "已入库可检索，后台AI处理"
            + ("失败" if job.status == "failed" else "等待重试")
        )
        db.commit()


async def _heartbeat(claim: Claim, work: asyncio.Task):
    try:
        while True:
            await asyncio.sleep(20)
            with SessionLocal() as db:
                changed = (
                    db.query(RAGEnrichmentJob)
                    .filter(
                        RAGEnrichmentJob.content_id == claim.content_id,
                        RAGEnrichmentJob.revision == claim.revision,
                        RAGEnrichmentJob.lease_owner == claim.owner,
                        RAGEnrichmentJob.status == "running",
                    )
                    .update(
                        {"lease_until": _now() + timedelta(seconds=LEASE_SECONDS)},
                        synchronize_session=False,
                    )
                )
                db.commit()
            if not changed:
                work.cancel()
                return
    except Exception:
        logger.exception("后台AI任务续租失败，停止当前任务")
        work.cancel()


async def run_next() -> bool:
    claim = claim_next()
    if claim is None:
        return False
    work = asyncio.create_task(_process(claim))
    heartbeat = asyncio.create_task(_heartbeat(claim, work))
    try:
        await work
        _finish(claim)
    except StaleClaim:
        pass
    except asyncio.CancelledError:
        with suppress(StaleClaim):
            _finish(claim, cancelled=True)
        # Losing a lease cancels this document, not the queue consumer itself.
        if asyncio.current_task().cancelling():
            raise
    except Exception as exc:
        logger.exception("后台AI处理失败，content_id=%s", claim.content_id)
        with suppress(StaleClaim):
            _finish(claim, error=exc)
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat
    return True


async def _worker():
    while True:
        try:
            await run_next()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("后台AI队列轮询失败")
        await asyncio.sleep(
            max(0.1, float(os.getenv("UPLOAD_ENRICHMENT_POLL_SECONDS", "2")))
        )


async def start_enrichment_worker():
    global _task
    if os.getenv("UPLOAD_ENRICHMENT_WORKER_ENABLED", "true").lower() not in {
        "true",
        "1",
        "yes",
        "on",
    }:
        return
    if _task is None or _task.done():
        # Only the queue's own table is created; other schema and seed data are untouched.
        RAGEnrichmentJob.__table__.create(bind=engine, checkfirst=True)
        _task = asyncio.create_task(_worker(), name="knowledge-enrichment")


async def stop_enrichment_worker():
    global _task
    if _task is not None:
        _task.cancel()
        with suppress(asyncio.CancelledError):
            await _task
        _task = None
