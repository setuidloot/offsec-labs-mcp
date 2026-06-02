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
| `offsec_list_running_labs` | Discover running instances (id, IP, state) over the WebSocket | no |
| `offsec_start_machine` | Power a machine on (async deploy; see notes below) | **yes** |
| `offsec_stop_machine` | Power off the running instance (id auto-discovered, or explicit) | **yes** |
| `offsec_revert_machine` | Revert the running instance to a clean state (id auto-discovered, or explicit) | **yes** |

Every tool takes `response_format`: `markdown` (default) or `json`.

### Identifiers

- **machine_id** accepts a numeric host id (`189`), a slug (`kevin-189`), or a
  name (`Kevin`). Numeric id is most reliable.
- **instance_id** (for stop/revert) is the host *instance* id — a different,
  larger number (e.g. `32062625`). See the limitation below for how to get it.

### Instance ids & the WebSocket

Start/stop/revert are **asynchronous** and verified against the live portal:

| Action | Request | Response |
|--------|---------|----------|
| start | `POST /api/host-instances/` `{host:189}` | `201 {"message":"Deploy request in progress"}` |
| stop | `PATCH /api/host-instances/<instanceId>/` `{action:"stop",context_learning_unit_id:189}` | `200 {"message":"Stop action in progress"}` |
| revert | `PATCH /api/host-instances/<instanceId>/` `{action:"revert",context_learning_unit_id:189}` | `200 {"message":"Revert action in progress"}` |

**The REST API never returns the instance id or the target IP** — starting only
acknowledges the deploy, and no REST endpoint lists running instances
(`GET /api/host-instances/` 405; `/api/learning-units/<id>/full` returns `ip:null`).
Those values live only on the events **WebSocket** (`wss://portal.offsec.com/ws/events`).

This server reads them itself. `offsec_list_running_labs` (and the auto-discovery
in stop/revert) connect to the WebSocket and run the portal's own handshake —
**with the bearer token, no cookie required**:

1. The upgrade is unauthenticated → connect.
2. Send `{"action":"sign_in","value":"<bearer token>"}` → `group:"auth"` success.
3. Send `{"action":"subscribe","value":"host_actions"}` → the server immediately
   pushes a `host_actions/started` snapshot of every running instance:
   `host_instance: { id, ip, related_host:{id,name}, host_instance_state }`.

So you normally **don't need the instance id**: `offsec_stop_machine` /
`offsec_revert_machine` with no `instance_id` discover the running instance
automatically (OffSec allows one concurrent machine; pass `machine_id` to
disambiguate). Because discovery authenticates via the `sign_in` message, this
path **requires `OFFSEC_BEARER_TOKEN`** (a cookie alone won't do it). A second
start returns `user_has_started_machine` until the first is stopped, and
stop/revert return `host_action_in_progress` while a deploy is mid-flight — retry
once the machine reaches `started`.

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
4. `offsec_list_running_labs` → read its **IP** and **instance id** (once `started`).
5. Connect via your OpenVPN client and work the box.
6. `offsec_get_walkthrough` if you want the official walkthrough (unlocks after start).
7. `offsec_stop_machine` (or `offsec_revert_machine`) — no instance id needed; it's auto-discovered.

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
| `OFFSEC_WS_URL` | Override events WebSocket URL (default from `config.json`, else `wss://portal.offsec.com/ws/events`) |
| `OFFSEC_PORTAL_WEB_BASE` | Override web base for generated links |
| `OFFSEC_USER_AGENT` | Override the User-Agent header |
| `TRANSPORT` | `stdio` (default) or `http` |
| `PORT` | HTTP port (default 3000) |
