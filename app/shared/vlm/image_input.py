"""Prepare local visual inputs without modifying uploaded originals."""

from __future__ import annotations

import base64
import io
import mimetypes
from pathlib import Path


def local_image_data_url(
    path: str, *, max_edge: int = 0, jpeg_quality: int = 85
) -> str:
    """Optionally downscale oversized images; preserve original bytes otherwise."""
    image_path = Path(path)
    if max_edge > 0:
        # Keep Pillow optional when image resizing is disabled.
        from PIL import Image, ImageOps

        with Image.open(image_path) as source:
            image = ImageOps.exif_transpose(source)
            if max(image.size) > max_edge:
                image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
                if image.mode in {"RGBA", "LA", "P"}:
                    rgba = image.convert("RGBA")
                    background = Image.new("RGB", image.size, "white")
                    background.paste(rgba, mask=rgba.getchannel("A"))
                    image = background
                else:
                    image = image.convert("RGB")
                output = io.BytesIO()
                image.save(output, format="JPEG", quality=jpeg_quality)
                return "data:image/jpeg;base64," + base64.b64encode(
                    output.getvalue()
                ).decode("ascii")
    mime = mimetypes.guess_type(str(image_path))[0] or "image/jpeg"
    return f"data:{mime};base64," + base64.b64encode(image_path.read_bytes()).decode(
        "ascii"
    )
