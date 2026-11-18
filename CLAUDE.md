# Oksskolten

See `README.md` for project overview and `docs/spec/` for detailed specs.

## Deployment

The production instance runs directly on the host (Node + `npm start`), **not in Docker**. Run scripts there from the project directory with `npm run <script>`; do not suggest `docker` / `docker compose` commands for it.

## Database

SQLite (libsql, WAL mode) at `./data/rss.db`.

- **Reads:** `sqlite3 ./data/rss.db` works fine while the server is running (WAL allows concurrent readers).
- **Writes:** Direct sqlite3 CLI writes do not work while the server is running. WAL mode causes the server process to hold the DB connection, so external writes are silently lost. Use API endpoints instead, or add a temporary admin endpoint in `server/routes/admin.ts` for one-off data injection.
- **API keys:** Create from Settings → Security → API Tokens. Use `read,write` scope for mutation endpoints. Example: `curl -H "Authorization: Bearer ok_..." http://localhost:3000/api/...`

## Language

- **Chat:** Respond in the same language the user speaks.
- **Issues, PRs, and commit messages:** Always use English.
