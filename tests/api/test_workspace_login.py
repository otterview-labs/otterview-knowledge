import hashlib
import json
import secrets
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from starlette.testclient import TestClient

from app.shared.workspace_auth import WorkspaceAuth, password_digest


def test_session_boundary_covers_ui_apis_files_and_revocation(tmp_path):
    origin = "https://knowledge.example.test"
    password = secrets.token_urlsafe(24)
    service = secrets.token_urlsafe(32)
    config = tmp_path / "auth.json"
    salt = secrets.token_bytes(16)
    config.write_text(json.dumps({
        "origin": origin, "username": "owner", "salt": salt.hex(),
        "password_hash": password_digest(password, salt).hex(),
        "service_token_sha256": hashlib.sha256(service.encode()).hexdigest(),
    }))
    config.chmod(0o600)
    app = FastAPI()
    app.mount("/static", StaticFiles(directory=Path(__file__).resolve().parents[2] / "storage/static"))
    app.add_middleware(WorkspaceAuth, config=config, static_dir=Path(__file__).resolve().parents[2] / "storage/static")

    @app.get("/")
    @app.get("/uploads/test.html")
    @app.post("/api/v1/rag/search/unified")
    async def protected(request: Request):
        return {"owner": request.state.workspace_account.id}

    @app.get("/health")
    async def health():
        return {"ok": True}

    with TestClient(app, base_url=origin, follow_redirects=False) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/").headers["location"] == "/login"
        assert client.get("/static/index.html").status_code == 401
        assert client.get("/static/css/workspace-login.css").status_code == 200
        assert client.get("/uploads/test.html").status_code == 401
        assert client.post("/api/v1/rag/search/unified").status_code == 401
        assert client.post("/api/v1/rag/search/unified", headers={"X-Knowledge-Service-Token": service}).status_code == 200
        assert client.get("/uploads/test.html", headers={"X-Knowledge-Service-Token": service}).status_code == 401
        assert client.get("/login").status_code == 200
        assert client.post("/login", data={"username": "owner", "password": password}, headers={"Origin": "https://else.test"}).status_code == 403
        assert client.post("/login", data={"username": "owner", "password": "wrong"}).headers["location"] == "/login?error=credentials"
        signed = client.post("/login", data={"username": "owner", "password": password}, headers={"Origin": origin})
        assert signed.status_code == 303 and signed.headers["location"] == "/"
        assert "HttpOnly" in signed.headers["set-cookie"] and "Secure" in signed.headers["set-cookie"]
        assert client.get("/workspace/session").json() == {"username": "owner"}
        assert client.get("/").json() == {"owner": "anonymous"}
        assert client.get("/uploads/test.html").headers["content-security-policy"].startswith("sandbox")
        assert client.post("/api/v1/rag/search/unified", headers={"Origin": "https://else.test"}).status_code == 403
        assert client.post("/api/v1/rag/search/unified", headers={"Origin": origin}).status_code == 200
        token = client.cookies.get("__Host-jetlinks-knowledge")
        assert client.post("/logout", headers={"Origin": origin}).headers["location"] == "/login"
        assert client.post("/api/v1/rag/search/unified", headers={"Cookie": f"__Host-jetlinks-knowledge={token}"}).status_code == 401
        assert client.post("http://knowledge.example.test/login", data={"username": "owner", "password": password}).status_code == 400
