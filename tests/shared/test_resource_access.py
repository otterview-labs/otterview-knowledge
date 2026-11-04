from __future__ import annotations

import asyncio
import importlib
import sys
from types import SimpleNamespace

import pytest

from tests.helpers import clear_modules, configure_runtime_env


def load_access(monkeypatch, tmp_path, **overrides):
    configure_runtime_env(monkeypatch, tmp_path, **overrides)
    clear_modules()
    return importlib.import_module('app.shared.utils.resource_access')


@pytest.mark.parametrize('url', [
    'http://127.0.0.1/secret', 'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/', 'http://192.168.1.1/', 'http://[::1]/',
    'http://[::ffff:127.0.0.1]/', 'http://[fe80::1]/', 'http://224.0.0.1/',
    'http://localhost/', 'http://user:test-password@example.com/', 'ftp://example.com/a',
])
def test_private_or_credential_urls_rejected(monkeypatch, tmp_path, url):
    access = load_access(monkeypatch, tmp_path)
    with pytest.raises(access.ResourceAccessError):
        access.validate_remote_url(url)


def test_resolver_checks_actual_dns_answers(monkeypatch, tmp_path):
    access = load_access(monkeypatch, tmp_path)

    async def run():
        resolver = access.PublicResolver()
        async def resolve(*args):
            return [{'host': '93.184.216.34'}, {'host': '127.0.0.1'}]
        monkeypatch.setattr(resolver.delegate, 'resolve', resolve)
        try:
            with pytest.raises(access.ResourceAccessError):
                await resolver.resolve('example.com', 80)
        finally:
            await resolver.close()
    asyncio.run(run())


def test_local_paths_reject_traversal_and_symlink_escape(monkeypatch, tmp_path):
    access = load_access(monkeypatch, tmp_path)
    outside = tmp_path / 'private.txt'
    outside.write_text('private content')
    uploads = __import__('pathlib').Path(access.settings.storage.STATIC_DIR) / 'uploads'
    (uploads / 'escape.txt').symlink_to(outside)
    for value in [str(outside), outside.as_uri(), '/uploads/../index.html', '/uploads/escape.txt', '/uploads/%2e%2e/index.html']:
        with pytest.raises(access.ResourceAccessError):
            access.confined_upload_path(value)
    assert access.confined_upload_path('/uploads/hello.txt') == uploads / 'hello.txt'


def test_data_uri_size_limit_and_cleanup(monkeypatch, tmp_path):
    access = load_access(monkeypatch, tmp_path, SECURITY_MAX_RESOURCE_BYTES=4)
    with pytest.raises(access.ResourceAccessError):
        asyncio.run(access.prepare_resource('data:text/plain;base64,SGVsbG8='))
    target = __import__('pathlib').Path(access.settings.storage.TEMP_DIR) / 'resource_downloads'
    assert list(target.iterdir()) == []
    path, info = asyncio.run(access.prepare_resource('data:text/plain;base64,YWJj'))
    assert path.suffix == '.txt'
    assert path.read_bytes() == b'abc'
    assert info['file_size'] == 3


def test_redirect_cannot_enter_private_network(monkeypatch, tmp_path):
    access = load_access(monkeypatch, tmp_path)
    requested = []
    class Response:
        status = 302
        headers = {'Location': 'http://169.254.169.254/metadata'}
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
    class Session:
        def __init__(self, **kwargs): self.connector = kwargs['connector']
        async def __aenter__(self): return self
        async def __aexit__(self, *args): await self.connector.close()
        def get(self, url, **kwargs):
            requested.append(url)
            assert kwargs['allow_redirects'] is False
            return Response()
    monkeypatch.setattr(access.aiohttp, 'ClientSession', Session)
    with pytest.raises(access.ResourceAccessError):
        asyncio.run(access.prepare_resource('https://example.com/file.txt'))
    assert requested == ['https://example.com/file.txt']


def test_exact_allowlist_is_explicit_trust_exception(monkeypatch, tmp_path):
    access = load_access(monkeypatch, tmp_path, SECURITY_DOWNLOAD_ALLOWED_HOSTS='["assets.internal"]')
    access.validate_address('10.0.0.1', 'assets.internal')
    with pytest.raises(access.ResourceAccessError):
        access.validate_address('10.0.0.1', 'assets.internal.attacker.example')
