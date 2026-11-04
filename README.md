# OtterView Knowledge

[简体中文](README.zh-CN.md) · [Apache License 2.0](LICENSE)

OtterView Knowledge is a self-hosted workspace for searching your documents. Upload files, search by keyword or meaning, and read the original beside the search results. Documents become searchable after ingestion; AI summaries and, when enabled, document relationships are generated in the background.

- Organize documents in collections and upload multiple files at once.
- Open the original text, AI summary, and related knowledge from a search result.
- Connect your own OpenAI-compatible chat and embedding endpoints. OCR and visual analysis are optional.

The standalone workspace uses one shared operator account. It is intended for a personal workspace or a trusted team; it does not provide per-user accounts or multi-tenant isolation.

## Quick start

Requirements: Docker with Compose, Python 3.11 or newer for the account setup script, and access to chat and embedding endpoints. The database is included in the Compose stack and is not published on the host.

1. Create the local configuration and the workspace account:

   ```sh
   cp .env.example .env
   install -d -m 700 .workspace-auth
   python3 scripts/configure_workspace_auth.py .workspace-auth/account.json \
     --origin http://127.0.0.1:18006 --username workspace-admin
   ```

2. Edit `.env`:

   | Setting | What to enter |
   | --- | --- |
   | `DB_MYSQL_PASSWORD` | A new PostgreSQL password; the variable name is retained for compatibility. |
   | `SECURITY_SECRET_KEY` | A different random value of at least 32 characters. You can generate each secret with `openssl rand -hex 32`. |
   | `STARTUP_INITIALIZE_DATABASE_ON_STARTUP` | Set to `true` for a new database, then return it to `false` after the first successful start. |
   | `OPENAI_API_BASE`, `OPENAI_API_KEY`, `OPENAI_MODEL_NAME` | The endpoint, credential, and chat model of your OpenAI-compatible provider. |
   | `EMBEDDING_OPENAI_EMBEDDING_MODEL`, `VECTOR_DB_DIMENSION` | The embedding model and its output dimensions. Choose before indexing documents. |

   The default configuration uses the same endpoint for chat and embeddings. If they are separate, use the `EMBEDDING_LOCAL_EMBEDDING_*` settings and set `EMBEDDING_PROVIDER=local`. Model endpoints must be reachable from the application container. See [the environment template](.env.example) for optional providers, graph and OCR settings.

3. Run `docker compose up -d --build`, open [the local login page](http://127.0.0.1:18006/login), and sign in with the account you created. Create a collection, upload a file, and search for a phrase from its text. Use the **AI Summary** tab to check background progress.

The application port is bound to loopback. For access from another machine, use an SSH tunnel or configure a trusted HTTPS origin and proxy as described in the [standalone deployment guide](docs/operations/STANDALONE_WORKSPACE.md). The [background processing guide](docs/operations/DEFERRED_ENRICHMENT.md) covers job states and optional OCR.

## Development

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements-test.txt
python -m pytest -q
python scripts/scan_secrets.py
```

See [source provenance](docs/PROVENANCE.md), [third-party notices](THIRD_PARTY_NOTICES.md) and [security reporting](SECURITY.md).
