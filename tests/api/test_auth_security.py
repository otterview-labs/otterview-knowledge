from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
import jwt

from tests.helpers import clear_modules, configure_runtime_env


def deps_module(monkeypatch, tmp_path, **env):
    configure_runtime_env(monkeypatch, tmp_path, **env)
    clear_modules()
    return importlib.import_module('app.api.v1.deps')


@pytest.mark.parametrize('dev,skip', [(False, False), (False, True), (True, False), (True, True)])
def test_production_always_requires_auth(monkeypatch, tmp_path, dev, skip):
    deps = deps_module(monkeypatch, tmp_path, ENVIRONMENT='production', DEV_MODE=dev, SKIP_AUTH=skip)
    assert deps.is_auth_enforced()
    for token in (None, 'invalid.token.value'):
        with pytest.raises(HTTPException) as error:
            deps.get_compat_request_user(token)
        assert error.value.status_code == 401


def test_production_rejects_default_signing_key(monkeypatch, tmp_path):
    with pytest.raises(ValueError, match='SECURITY_SECRET_KEY'):
        deps_module(monkeypatch, tmp_path, ENVIRONMENT='production', SECURITY_SECRET_KEY='')


def test_tokens_require_expiration_and_valid_signature(monkeypatch, tmp_path):
    deps = deps_module(monkeypatch, tmp_path, ENVIRONMENT='production')
    key = deps.settings.security.SECRET_KEY
    payloads = [({'user_id': 1}, key),
                ({'user_id': 1, 'exp': datetime.now(timezone.utc) - timedelta(seconds=2)}, key),
                ({'user_id': 1, 'exp': datetime.now(timezone.utc) + timedelta(minutes=1)}, 'test-other-key-with-at-least-32-characters')]
    for payload, signing_key in payloads:
        token = jwt.encode(payload, signing_key, algorithm='HS256')
        with pytest.raises(HTTPException) as error:
            deps._authenticate_user(None, token)
        assert error.value.status_code == 401


def test_active_local_identity_and_admin_policy(monkeypatch, tmp_path):
    deps = deps_module(monkeypatch, tmp_path, ENVIRONMENT='production')
    admin = SimpleNamespace(id=1, is_active=True, is_superuser=True)
    token = jwt.encode({'user_id': 1, 'exp': datetime.now(timezone.utc) + timedelta(minutes=1)},
                       deps.settings.security.SECRET_KEY, algorithm='HS256')
    db = SimpleNamespace(query=lambda *a: SimpleNamespace(filter=lambda *a: SimpleNamespace(first=lambda: admin)))
    assert deps._authenticate_user(db, token) is admin
    assert deps.get_runtime_admin(admin) is admin
    with pytest.raises(HTTPException) as error:
        deps.get_runtime_admin(SimpleNamespace(is_superuser=False))
    assert error.value.status_code == 403
    admin.is_active = False
    with pytest.raises(HTTPException) as error:
        deps._authenticate_user(db, token)
    assert error.value.status_code == 401
