"""Local CPU OCR service. The model is loaded once; no image data is stored."""

from __future__ import annotations

import io
import json
import logging
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
from engine_pool import EnginePool, OCRBusy
from PIL import Image, ImageOps
from rapidocr_onnxruntime import RapidOCR

MAX_BYTES = 20 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 25_000_000
logger = logging.getLogger(__name__)
MODEL_VERSION = os.getenv("OCR_MODEL_VERSION", "rapidocr-v4-1")
pool = None
QUEUE_TIMEOUT = float(os.getenv("OCR_QUEUE_TIMEOUT", "12"))


class OCRHTTPServer(ThreadingHTTPServer):
    request_queue_size = 32


class Handler(BaseHTTPRequestHandler):
    def respond(self, status: int, payload: dict):
        data = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path != "/health":
            return self.respond(404, {"success": False})
        self.respond(
            200,
            {
                "success": pool is not None,
                "engine": "rapidocr",
                "model_version": MODEL_VERSION,
                "workers": pool.workers if pool else 0,
                "max_waiting": pool.max_waiting if pool else 0,
            },
        )

    def do_POST(self):
        if self.path != "/ocr":
            return self.respond(404, {"success": False})
        self.connection.settimeout(20)
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_BYTES:
                return self.respond(413, {"success": False, "reason": "invalid_size"})
            waiting = time.monotonic()
            # Wait before decoding so queued requests do not retain full pixel arrays.
            with pool.borrow(timeout=QUEUE_TIMEOUT) as engine:
                queue_seconds = time.monotonic() - waiting
                data = self.rfile.read(size)
                if len(data) != size:
                    return self.respond(
                        400, {"success": False, "reason": "incomplete_body"}
                    )
                with Image.open(io.BytesIO(data)) as source:
                    if (
                        source.width * source.height > Image.MAX_IMAGE_PIXELS
                        or getattr(source, "n_frames", 1) != 1
                    ):
                        return self.respond(
                            422, {"success": False, "reason": "unsupported_image"}
                        )
                    image = ImageOps.exif_transpose(source)
                    rgba = image.convert("RGBA")
                    rgb = Image.new("RGB", rgba.size, "white")
                    rgb.paste(rgba, mask=rgba.getchannel("A"))
                    pixels = cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2BGR)
                start = time.monotonic()
                result, _ = engine(pixels)
                seconds = time.monotonic() - start
            blocks = [
                {"text": str(row[1]), "confidence": float(row[2]), "box": row[0]}
                for row in result or []
            ]
            self.respond(
                200,
                {
                    "success": True,
                    "engine": "rapidocr",
                    "model_version": MODEL_VERSION,
                    "seconds": round(seconds, 3),
                    "queue_seconds": round(queue_seconds, 3),
                    "blocks": blocks,
                },
            )
        except OCRBusy as exc:
            self.respond(503, {"success": False, "reason": str(exc)})
        except Exception:
            logger.exception("OCR request failed")
            self.respond(422, {"success": False, "reason": "ocr_failed"})

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


if __name__ == "__main__":
    start = time.monotonic()
    opencv_threads = int(os.getenv("OCR_OPENCV_THREADS", "0"))
    if opencv_threads > 0:
        cv2.setNumThreads(opencv_threads)
    workers = int(os.getenv("OCR_WORKERS", "2"))
    if not 1 <= workers <= 8:
        raise ValueError("OCR_WORKERS must be between 1 and 8")
    engines = []
    for _ in range(workers):
        engine = RapidOCR(
            intra_op_num_threads=int(os.getenv("OCR_THREADS", "8")),
            inter_op_num_threads=1,
            det_limit_side_len=int(os.getenv("OCR_DET_MAX_EDGE", "736")),
            det_limit_type="max",
            text_score=0.0,
        )
        engine(np.full((64, 128, 3), 255, dtype=np.uint8))
        engines.append(engine)
    pool = EnginePool(engines, int(os.getenv("OCR_MAX_WAITING", "8")))
    print(
        json.dumps({"ready": True, "init_seconds": round(time.monotonic() - start, 3)}),
        flush=True,
    )
    OCRHTTPServer(
        (os.getenv("OCR_BIND", "127.0.0.1"), int(os.getenv("OCR_PORT", "8014"))),
        Handler,
    ).serve_forever()
