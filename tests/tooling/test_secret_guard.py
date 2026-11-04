from __future__ import annotations

import importlib.util
import subprocess

from tests.helpers import REPO_ROOT


def guard():
    spec = importlib.util.spec_from_file_location('knowledge_secret_guard', REPO_ROOT / 'scripts/scan_secrets.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_and_deleted_history_credentials_are_reported_redacted(monkeypatch, tmp_path):
    scan = guard()
    monkeypatch.setattr(scan, 'ROOT', tmp_path)
    def git(*args):
        return subprocess.run(['git', '-C', str(tmp_path), *args], check=True, capture_output=True)
    git('init')
    git('config', 'user.name', 'Test Fixture')
    git('config', 'user.email', 'test@example.invalid')
    value = 'credential-' + 'AB12cd34' * 3
    file = tmp_path / 'old_config.py'
    file.write_text('PASSWORD = ' + repr(value))
    git('add', '.')
    git('commit', '-m', 'test fixture')
    assert scan.scan() == [('old_config.py', 1, 'literal-credential')]
    file.unlink()
    git('add', '-u')
    git('commit', '-m', 'remove fixture')
    assert scan.scan() == []
    history = scan.scan(history=True)
    assert len(history) == 1
    assert history[0][2] == 'literal-credential'
    assert value not in repr(history)


def test_provider_tokens_detected_but_examples_exempt():
    scan = guard()
    assert list(scan.findings('token=' + 'sk-' + 'aB12cd34' * 5))
    assert not list(scan.findings('PASSWORD="your_password_placeholder"'))
