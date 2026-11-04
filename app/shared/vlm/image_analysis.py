"""Validate reusable image analysis without a second model request."""

from __future__ import annotations

from typing import Any

IMAGE_SYSTEM_PROMPT = (
    "你是一个严格遵循指令的图像分析助手。"
    "所有回答必须是单个 JSON 对象，且不包含任何额外文字、解释、Markdown 围栏或注释。"
    '如无法识别，输出 {"events": []}。'
)

IMAGE_ANALYSIS_PROMPT = (
    "分析图片，只输出一个完整JSON对象，不要Markdown或解释。格式："
    '{"events":[{"type":"content","description":"图片正文描述"}],'
    '"analysis":{"summary":"简短摘要","tags":["标签"],'
    '"key_points":["关键点"],"content_category":"内容分类"}}。'
    "events必须包含实际观察到的内容；图片中的关键文字、数字和表格信息应准确保留，"
    "不要把摘要当作正文，不要编造无法识别的文字。"
    "summary概括主要内容，控制在100字以内；tags最多5个，key_points最多3条。"
    '无法识别时返回{"events":[]}，不要虚构。'
)


def normalize_image_analysis(value: object) -> dict[str, Any] | None:
    """Accept complete structured analysis and reject partial or malformed output."""
    if (
        not isinstance(value, dict)
        or value.get("error")
        or value.get("success") is False
    ):
        return None
    summary = value.get("summary", value.get("ai_summary"))
    tags = value.get("tags", value.get("ai_tags"))
    points = value.get("key_points")
    category = value.get("content_category")
    if not isinstance(summary, str) or not summary.strip():
        return None
    if not isinstance(tags, list) or not tags:
        return None
    if not isinstance(points, list):
        return None
    if any(not isinstance(item, str) or not item.strip() for item in tags + points):
        return None
    if not isinstance(category, str) or not category.strip():
        return None
    return {
        "success": True,
        "ai_summary": summary.strip(),
        "ai_tags": list(dict.fromkeys(item.strip() for item in tags))[:5],
        "key_points": [item.strip() for item in points][:3],
        "content_category": category.strip(),
        "analysis_method": "vlm_single_pass",
    }


def reusable_image_analysis(markdown_result: dict[str, Any]) -> dict[str, Any] | None:
    """Reuse analysis only when the image conversion itself succeeded."""
    if not markdown_result.get("success"):
        return None
    metadata = markdown_result.get("metadata")
    if not isinstance(metadata, dict):
        return None
    if any(
        metadata.get(key) for key in ("error", "vlm_error", "fallback", "vlm_fallback")
    ):
        return None
    return normalize_image_analysis(metadata.get("image_analysis"))
