# offsec-mcp-server

An MCP server for managing **your own** authorized OffSec Proving Grounds
(PG Play / Practice) labs from an MCP client: list and search the catalog,
inspect machine details, start/stop/revert machines, and pull a machine's
walkthrough into your session for personal study.

> Use this only for your own account, within OffSec's terms. Don't redistribute
> walkthrough content — OffSec's community rules prohibit sharing complete
> solutions/walkthroughs.

## Status — mapped against the live portal

The endpoints in `src/constants.ts` were **verified against the live portal**
(`https://portal.offsec.com`) with a logged-in bearer token, by reading the
SPA's runtime config (`/config.json`), its JS bundle, and the actual JSON
responses. They are no longer guesses.

How the portal is wired (discovered):

| Concern | Source |
|---------|--------|
| Auth | `Authorization: Bearer <token>` works on all `/api/*` endpoints |
| REST API | `https://portal.offsec.com/api/*` |
| Service gateway | `https://portal.offsec.com/services` (from `config.json` → `API_GATEWAY`) |
| Lab catalog | A **Typesense** cluster. The portal fetches a *scoped* search key from the gateway, then queries Typesense directly. This server reproduces that flow. |

The server loads `/config.json` once at runtime to discover the gateway base and
Typesense node, so a deployment change is picked up automatically. Every value
can still be overridden via environment variables.

## Tools

| Tool | What it does | Mutating? |
|------|--------------|-----------|
| `offsec_whoami` | Verify your token works; returns your profile | no |
| `offsec_list_labs` | List/search the catalog (default group `Play`); filter by OS/difficulty, paginate | no |
| `offsec_get_machine_details` | OS, difficulty, points, groups, description, objectives, credentials | no |
| `offsec_list_walkthroughs` | List walkthrough rows (host id, category, unblocked state) | no |
| `offsec_get_walkthrough` | Retrieve an unblocked walkthrough's content | no |
| `offsec_start_machine` | Power a machine on (async deploy; see limitation below) | **yes** |
| `offsec_stop_machine` | Power off a running instance (by instance id) | **yes** |
| `offsec_revert_machine` | Revert a running instance to a clean state (by instance id) | **yes** |

Every tool takes `response_format`: `markdown` (default) or `json`.

### Identifiers

- **machine_id** accepts a numeric host id (`189`), a slug (`kevin-189`), or a
  name (`Kevin`). Numeric id is most reliable.
- **instance_id** (for stop/revert) is the host *instance* id — a different,
  larger number (e.g. `32062625`). See the limitation below for how to get it.

### Instance ids & the WebSocket limitation

Start/stop/revert are **asynchronous** and verified against the live portal:

| Action | Request | Response |
|--------|---------|----------|
| start | `POST /api/host-instances/` `{host:189}` | `201 {"message":"Deploy request in progress"}` |
| stop | `PATCH /api/host-instances/<instanceId>/` `{action:"stop",context_learning_unit_id:189}` | `200 {"message":"Stop action in progress"}` |
| revert | `PATCH /api/host-instances/<instanceId>/` `{action:"revert",context_learning_unit_id:189}` | `200 {"message":"Revert action in progress"}` |

**The API never returns the instance id or the target IP.** Starting a machine
only acknowledges the deploy. The portal learns the resulting instance id and IP
over a **cookie-authenticated WebSocket** (`wss://portal.offsec.com/ws/events`),
which a bearer-token client cannot drive — there is no REST endpoint that lists
running instances (`GET /api/host-instances/` and friends all 405; the machine's
`/api/learning-units/<id>/full` returns `ip:null`).

Practical consequence: after `offsec_start_machine`, open the machine's page in
the portal to read its **IP** and its **instance id** (the Stop button issues
`PATCH /api/host-instances/<instanceId>/`). Pass that instance id to
`offsec_stop_machine` / `offsec_revert_machine` (include `machine_id` for the
`context_learning_unit_id`). OffSec allows only one concurrent machine, so a
second start returns `user_has_started_machine` until you stop the first.

## Setup

```bash
npm install
npm run build
```

### Authentication

No password is handled. Copy a logged-in session value from your browser and
provide **one** of these environment variables:

- `OFFSEC_BEARER_TOKEN` — sent as `Authorization: Bearer <token>` (what the
  portal SPA itself uses; recommended)
- `OFFSEC_COOKIE` — sent as the raw `Cookie:` header

How to get the bearer: log into `portal.offsec.com`, open DevTools (F12) →
**Network** → click any `/api/...` request → **Request Headers** → copy the
`authorization:` value after `Bearer `. Tokens expire — refresh on a 401.

### MCP client config (stdio)

```json
{
  "mcpServers": {
    "offsec": {
      "command": "node",
      "args": ["/absolute/path/to/offsec-mcp-server/dist/index.js"],
      "env": { "OFFSEC_BEARER_TOKEN": "paste-your-token-here" }
    }
  }
}
```

Run `offsec_whoami` first to confirm auth.

### Typical flow

1. `offsec_list_labs` (group `Play`) → pick a machine id/slug.
2. `offsec_get_machine_details` → read the brief.
3. `offsec_start_machine` → deploy begins (async).
4. Open the machine's portal page → read its **IP** and **instance id**.
5. Connect via your OpenVPN client and work the box.
6. `offsec_get_walkthrough` if you want the official walkthrough (unlocks after start).
7. `offsec_stop_machine` (or `offsec_revert_machine`) with the **instance id** when done.

## Testing

Unit tests run the normalizers and client helpers against **real portal
responses** captured under `tests/fixtures/` (PII redacted). No network needed.

```bash
npm test
```

There is also a live, read-only smoke test that hits the real API using your
token (no machines are started):

```bash
node --env-file=.env scripts/live-smoke.mjs
```

## HTTP transport (optional)

```bash
TRANSPORT=http PORT=3000 node dist/index.js   # binds 127.0.0.1:3000/mcp
```

Requires the optional `express` dependency (installed by default).

## Environment variable reference

| Var | Purpose |
|-----|---------|
| `OFFSEC_BEARER_TOKEN` | Bearer auth token (recommended) |
| `OFFSEC_COOKIE` | Raw cookie header (alternative to bearer) |
| `OFFSEC_API_BASE_URL` | Override REST base (default `https://portal.offsec.com`) |
| `OFFSEC_API_GATEWAY` | Override service gateway (default from `config.json`, else `…/services`) |
| `OFFSEC_TYPESENSE_HOST` | Override Typesense node host (default from `config.json`) |
| `OFFSEC_PORTAL_WEB_BASE` | Override web base for generated links |
| `OFFSEC_USER_AGENT` | Override the User-Agent header |
| `TRANSPORT` | `stdio` (default) or `http` |
| `PORT` | HTTP port (default 3000) |
