from __future__ import annotations

import asyncio
import hashlib
import importlib
import io
import sys

import pytest
from starlette.datastructures import UploadFile

from tests.helpers import clear_modules, configure_runtime_env, make_stub_module


@pytest.mark.api
def test_simultaneous_uploads_with_same_filename_preserve_each_file(monkeypatch, tmp_path):
    configure_runtime_env(monkeypatch, tmp_path)
    clear_modules()
    service = make_stub_module(
        "app.services.multimodal_upload_service",
        multimodal_service=None,
        process_multimodal_upload=None,
    )
    monkeypatch.setitem(sys.modules, service.__name__, service)
    module = importlib.import_module("app.api.v1.rag.endpoints.multimodal_upload")
    directory = tmp_path / "same-name-uploads"
    directory.mkdir()
    monkeypatch.setattr(module, "UPLOAD_DIR", directory)
    payloads = [bytes([n]) * (512 * 1024 + n) for n in range(4)]

    async def upload_all():
        return await asyncio.gather(*[
            module.upload_file(UploadFile(io.BytesIO(payload), filename="image.png"))
            for payload in payloads
        ])

    responses = asyncio.run(upload_all())
    paths = []
    for payload, response in zip(payloads, responses):
        assert response["success"]
        result = response["result"]
        path = directory / result["file_name"]
        paths.append(path)
        assert path.read_bytes() == payload
        assert result["sha256"] == hashlib.sha256(payload).hexdigest()
        assert result["size"] == len(payload)
    assert len(set(paths)) == 4
    assert not list(directory.glob("._tmp_*"))
