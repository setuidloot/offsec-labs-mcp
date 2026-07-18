# Installation & Setup

This guide walks through installing the OffSec Labs MCP server and connecting it
to popular MCP clients (Claude Desktop, Claude Code, Cursor, Windsurf, VS Code),
plus the generic stdio/HTTP configuration for any other client.

- [1. Prerequisites](#1-prerequisites)
- [2. Build the server](#2-build-the-server)
- [3. Get your OffSec bearer token](#3-get-your-offsec-bearer-token)
- [4. Connect a client](#4-connect-a-client)
  - [Claude Desktop](#claude-desktop)
  - [Claude Code (CLI)](#claude-code-cli)
  - [Cursor](#cursor)
  - [Windsurf](#windsurf)
  - [VS Code (Copilot agent mode)](#vs-code-copilot-agent-mode)
  - [Any other client (generic stdio)](#any-other-client-generic-stdio)
  - [HTTP transport (remote/streamable)](#http-transport-remotestreamable)
- [5. Verify it works](#5-verify-it-works)
- [6. Updating](#6-updating)
- [7. Uninstalling / removing](#7-uninstalling--removing)
- [8. Troubleshooting](#8-troubleshooting)
- [9. Security notes](#9-security-notes)

---

## 1. Prerequisites

- **Node.js ≥ 18** (the server is tested on Node 20). Check with `node -v`.
- **An OffSec account** with access to Proving Grounds (PG Play / Practice).
- A logged-in **bearer token** from `portal.offsec.com` (see step 3).

> The token is what the portal's own web app uses. It expires periodically —
> when a tool returns a 401, grab a fresh one.

---

## 2. Build the server

Clone the repo and produce `dist/index.js` (the entry point every client runs):

```bash
git clone https://github.com/setuidloot/offsec-labs-mcp.git
cd offsec-labs-mcp
npm install
npm run build
```

Note the **absolute path** to the built entry point — you'll paste it into client
configs:

```bash
# from the repo root
echo "$(pwd)/dist/index.js"
# e.g. /Users/you/offsec-labs-mcp/dist/index.js
```

---

## 3. Get your OffSec bearer token

1. Log into `https://portal.offsec.com` in your browser.
2. Open **DevTools** (`F12` or `Cmd/Ctrl+Shift+I`) → **Network** tab.
3. Filter to **Fetch/XHR** and click around the portal (e.g. open the Labs page)
   so requests appear.
4. Click any request to **`portal.offsec.com/api/...`** → **Headers** →
   **Request Headers**.
5. Copy the **`authorization`** value — everything **after** `Bearer ` (a long
   token string).

That string is your `OFFSEC_BEARER_TOKEN`.

> **Why the bearer token (not a cookie)?** The token authenticates both the REST
> API and the events WebSocket the server uses to discover running instances.
> `OFFSEC_COOKIE` is supported for REST as a fallback, but WebSocket discovery
> (needed by `offsec_list_running_labs` and auto-stop/revert) **requires the
> bearer token**.

---

## 4. Connect a client

Every example below uses the same three pieces:

- **command:** `node`
- **args:** `["<absolute path>/dist/index.js"]`
- **env:** `{ "OFFSEC_BEARER_TOKEN": "<your token>" }`

Replace `/ABSOLUTE/PATH/TO/offsec-labs-mcp` with the path from step 2.

> Config formats occasionally change between client versions. If a snippet doesn't
> match your client, consult its MCP docs — the `command`/`args`/`env` values are
> always the same.

### Claude Desktop

1. Open **Settings → Developer → Edit Config** (this opens
   `claude_desktop_config.json`). Or edit it directly:
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
2. Add the server under `mcpServers`:

```json
{
  "mcpServers": {
    "offsec": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/offsec-labs-mcp/dist/index.js"],
      "env": { "OFFSEC_BEARER_TOKEN": "paste-your-token-here" }
    }
  }
}
```

3. **Fully quit and reopen** Claude Desktop. The `offsec_*` tools appear in the
   tools menu (the slider/plug icon).

### Claude Code (CLI)

Use the `claude mcp add` command — no manual JSON editing needed:

```bash
claude mcp add offsec \
  --env OFFSEC_BEARER_TOKEN=paste-your-token-here \
  -- node /ABSOLUTE/PATH/TO/offsec-labs-mcp/dist/index.js
```

- Everything after `--` is the command Claude Code runs.
- `--env KEY=VALUE` (repeatable) sets environment variables.
- Add `--scope user` to make it available in **all** your projects, or
  `--scope project` to write a shared `.mcp.json` into the current repo (default
  scope is `local` — just you, just this project).

Manage it with:

```bash
claude mcp list            # see configured servers + connection status
claude mcp get offsec      # show this server's config
claude mcp remove offsec   # remove it
```

Inside a session, `/mcp` shows live server status and tools.

### Cursor

1. Create or edit an MCP config file:
   - **Global (all projects):** `~/.cursor/mcp.json`
   - **Project-specific:** `.cursor/mcp.json` in the project root
2. Add:

```json
{
  "mcpServers": {
    "offsec": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/offsec-labs-mcp/dist/index.js"],
      "env": { "OFFSEC_BEARER_TOKEN": "paste-your-token-here" }
    }
  }
}
```

3. Open **Cursor Settings → MCP** (or **Tools & Integrations**). The `offsec`
   server should appear with a green dot; toggle it on if needed. Use it from
   the Agent in Composer.

### Windsurf

1. Edit `~/.codeium/windsurf/mcp_config.json` (Cascade → MCP settings →
   *Configure / View raw config* opens it).
2. Add the same `mcpServers` block as Cursor above.
3. Save and hit **Refresh** in the MCP panel.

### VS Code (Copilot agent mode)

VS Code uses a top-level **`servers`** key (not `mcpServers`) and supports prompted
secret **inputs** so the token isn't stored in plain text.

Create `.vscode/mcp.json` in your workspace:

```json
{
  "inputs": [
    {
      "id": "offsec-token",
      "type": "promptString",
      "description": "OffSec bearer token",
      "password": true
    }
  ],
  "servers": {
    "offsec": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/offsec-labs-mcp/dist/index.js"],
      "env": { "OFFSEC_BEARER_TOKEN": "${input:offsec-token}" }
    }
  }
}
```

Open the file and click **Start** above the server entry, or run
**MCP: List Servers** from the Command Palette. Use it from Copilot Chat in
**Agent** mode.

### Any other client (generic stdio)

Most MCP clients accept this shape (the keys may be nested differently):

```json
{
  "mcpServers": {
    "offsec": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/offsec-labs-mcp/dist/index.js"],
      "env": { "OFFSEC_BEARER_TOKEN": "paste-your-token-here" }
    }
  }
}
```

The server speaks MCP over **stdio** by default.

### HTTP transport (remote/streamable)

For clients that connect to an MCP server over HTTP instead of spawning it:

```bash
TRANSPORT=http PORT=3000 OFFSEC_BEARER_TOKEN=your-token \
  node /ABSOLUTE/PATH/TO/offsec-labs-mcp/dist/index.js
# Serves MCP at http://127.0.0.1:3000/mcp  (bound to localhost)
```

Point your client's "HTTP/streamable" MCP URL at `http://127.0.0.1:3000/mcp`.
This requires the optional `express` dependency (installed by default). Keep it
bound to localhost unless you add your own authentication in front.

---

## 5. Verify it works

In your client, run the **`offsec_whoami`** tool (or ask the agent to "check my
OffSec authentication"). A healthy response shows your username and email.

Then try a read-only call, e.g. ask to **"list the PG Play labs"**
(`offsec_list_labs`). If you have a machine running, **"list my running labs"**
(`offsec_list_running_labs`) should show its instance id and IP.

You can also verify outside any client, from the repo root:

```bash
# unit tests (offline, against captured real responses)
npm test

# live read-only smoke test (uses your token; starts nothing)
node --env-file=.env scripts/live-smoke.mjs
```

For the smoke test, put your token in a local `.env` file (git-ignored):

```
OFFSEC_BEARER_TOKEN=your-token-here
```

---

## 6. Updating

```bash
cd /ABSOLUTE/PATH/TO/offsec-labs-mcp
git pull
npm install
npm run build
```

Then restart your client (or for Claude Code, nothing to do — it spawns the
updated `dist/index.js` on next use). The server auto-discovers the portal's
current gateway/Typesense/WebSocket settings from `/config.json`, so most portal
changes need no config edits.

## 7. Uninstalling / removing

- **Claude Desktop / Cursor / Windsurf / VS Code:** delete the `offsec` entry
  from the relevant config file and restart the client.
- **Claude Code:** `claude mcp remove offsec`.
- Delete the cloned repo directory if you no longer need it.

---

## 8. Troubleshooting

| Symptom | Cause & fix |
|---------|-------------|
| `Unauthorized (401)` | Token missing/expired. Get a fresh bearer token (step 3) and update the client config. |
| Tools don't appear | Wrong path to `dist/index.js`, or you didn't run `npm run build`. Use an **absolute** path. Restart the client. |
| `offsec_list_running_labs` errors / empty when a machine is running | WebSocket discovery needs `OFFSEC_BEARER_TOKEN` specifically (a cookie won't authenticate the socket). Confirm the token is set. |
| `user_has_started_machine` on start | OffSec allows one concurrent machine. Stop the current one first (`offsec_stop_machine`). |
| `host_action_in_progress` on stop/revert | The machine is mid-deploy/mid-action. Wait until it reaches `started`, then retry. |
| Start "succeeds" but no IP | Start is **asynchronous** — it only acknowledges the deploy. Poll `offsec_list_running_labs` until state is `started`; the IP appears then. |
| Request timed out | Transient portal latency (some endpoints return large payloads). Retry. |
| `node: command not found` (Claude Desktop) | The client may not see your shell's `PATH`. Use an absolute path to `node` in `command` (find it with `which node`). |

Enable richer logs in Claude Code with `claude --mcp-debug`. In Claude Desktop,
check the MCP logs (Settings → Developer).

---

## 9. Security notes

- **Never commit your token.** The repo's `.gitignore` already excludes `.env`.
  In shared configs, prefer a prompted secret (see the VS Code `inputs` example).
- The token grants access to **your** OffSec account — treat it like a password.
- This server only acts on your own account (list/inspect/start/stop/revert your
  labs). It does not scrape other users' data.
- Don't redistribute walkthrough content retrieved via `offsec_get_walkthrough` —
  OffSec's rules prohibit sharing complete solutions.
