"""Cold-import the actual application in an isolated process, with local auth DB only."""
from __future__ import annotations

import os
import secrets
import subprocess
import sys

import pytest

from tests.helpers import REPO_ROOT

pytestmark = pytest.mark.api


def test_real_runtime_file_aliases_and_management_require_auth(tmp_path):
    env = os.environ.copy()
    env_file = tmp_path / 'empty.env'
    env_file.touch()
    env.update({'JETLINKS_KNOWLEDGE_ENV': str(env_file), 'JETLINKS_KNOWLEDGE_HOME': str(tmp_path),
                'ENVIRONMENT': 'production', 'DEV_MODE': 'true', 'SKIP_AUTH': 'true',
                'SECURITY_SECRET_KEY': secrets.token_urlsafe(48), 'DB_DATABASE_TYPE': 'sqlite',
                'SQLITE_DATABASE': str(tmp_path / 'auth.db'), 'VECTOR_DB_TYPE': 'pgvector',
                'GRAPH_DB_ENABLED': 'false', 'REDIS_HOST': '', 'REDIS_URL': '',
                'API_LOGGING_ENABLED': 'false', 'STARTUP_CHECK_DATABASE_ON_STARTUP': 'true',
                'STARTUP_INITIALIZE_DATABASE_ON_STARTUP': 'false',
                'STARTUP_RUN_DATABASE_MIGRATIONS_ON_STARTUP': 'false',
                'STARTUP_SEED_LLM_CONFIG_ON_STARTUP': 'false', 'HEALTH_CHECK_VECTOR_DB': 'false',
                'HEALTH_CHECK_REDIS': 'false', 'HEALTH_CHECK_GRAPH_DB': 'false'})
    # Build only the users table. This verifies HTTP authorization, not full SQLite
    # schema support or external PostgreSQL/vector/model integrations.
    code = '''
from app.db.models.user import User
from app.db.session import engine, SessionLocal
User.__table__.create(engine)
with SessionLocal() as db:
    db.add_all([User(username='admin', email='admin@example.invalid', hashed_password='!', is_superuser=True),
                User(username='reader', email='reader@example.invalid', hashed_password='!', is_superuser=False)])
    db.commit()
import main
from app.api.v1.rag.router import get_route_import_errors
assert get_route_import_errors() == {}, get_route_import_errors()
from app.config import settings
from pathlib import Path
uploads = Path(settings.storage.STATIC_DIR) / 'uploads'
uploads.mkdir(parents=True, exist_ok=True)
(uploads / 'probe.txt').write_text('sample upload')
outside = uploads.parent / 'private.txt'
outside.write_text('private file')
(uploads / 'escape.txt').symlink_to(outside)
from datetime import datetime, timedelta, timezone
import jwt
from starlette.testclient import TestClient
def headers(user_id):
    token = jwt.encode({'user_id': user_id, 'exp': datetime.now(timezone.utc) + timedelta(minutes=1)},
                       settings.security.SECRET_KEY, algorithm='HS256')
    return {'Authorization': 'Bearer ' + token}
with TestClient(main.app) as client:
    assert client.get('/health').status_code == 200
    for prefix in ['/uploads', '/static/uploads', '/temp/uploads', '/api/file']:
        for method in ('GET', 'HEAD'):
            assert client.request(method, prefix + '/probe.txt').status_code == 401
            assert client.request(method, prefix + '/probe.txt', headers=headers(2)).status_code == 403
            result = client.request(method, prefix + '/probe.txt', headers=headers(1))
            assert result.status_code == 200
            assert result.headers['Content-Disposition'] == 'attachment'
            assert result.headers['Cache-Control'] == 'private, no-store'
        assert client.get(prefix + '/escape.txt', headers=headers(1)).status_code == 404
    assert client.post('/api/v1/rag/collections', json={}).status_code == 401
    assert client.post('/api/v1/rag/collections', json={}, headers=headers(2)).status_code == 403
    assert client.post('/knowledge/resource/_search', json={'text': 'sample'}).status_code == 401
    assert client.post('/api/knowledge/resource/_search', json={'text': 'sample'}).status_code == 401
    assert client.post('/knowledge/resource/defaultAi/cmd/queryKnowledgeGraph', json={}, headers=headers(2)).status_code == 403
    assert client.post('/api/v1/rag/search/unified', json={'query':'sample'}, headers={'Authorization':'Bearer invalid'}).status_code == 401
print('runtime authorization smoke passed')
'''
    completed = subprocess.run([sys.executable, '-c', code], env=env, cwd=REPO_ROOT,
                               capture_output=True, text=True, timeout=60)
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert 'runtime authorization smoke passed' in completed.stdout
