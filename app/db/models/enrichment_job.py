"""Durable, leased work for AI enrichment after searchable ingestion."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text

from app.db.base_class import Base


class RAGEnrichmentJob(Base):
    __tablename__ = "rag_enrichment_jobs"

    content_id = Column(
        String(64), ForeignKey("rag_contents.id", ondelete="CASCADE"), primary_key=True
    )
    revision = Column(String(64), nullable=False)
    status = Column(String(20), nullable=False, default="pending", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    available_at = Column(DateTime, nullable=False, index=True)
    lease_until = Column(DateTime, nullable=True, index=True)
    lease_owner = Column(String(64), nullable=True)
    last_error = Column(Text, nullable=True)
