# Usage & Tool Reference

Once the server is connected (see [INSTALLATION.md](./INSTALLATION.md)), you drive
it by talking to your agent in natural language — it picks the right tool — or by
invoking tools directly. This page documents every tool, its arguments, and shows
example prompts and outputs.

- [Identifiers you'll see](#identifiers-youll-see)
- [Common workflow](#common-workflow)
- [Tool reference](#tool-reference)
- [Example prompts](#example-prompts)
- [Output formats](#output-formats)

---

## Identifiers you'll see

| Name | What it is | Example |
|------|------------|---------|
| **host id** | Numeric id of a machine in the catalog | `189` |
| **slug** | `name-hostid`, as in the portal URL | `kevin-189` |
| **machine name** | Display name | `Kevin` |
| **instance id** | Id of a *running* deployment of a machine (different, larger number) | `32134152` |

`machine_id` arguments accept a host id, slug, **or** name. `instance_id`
(for stop/revert) is the running-instance id — but you rarely need it, because
stop/revert can discover it for you.

---

## Common workflow

1. **Find a lab** — `offsec_list_labs` (defaults to the PG Play group).
2. **Read the brief** — `offsec_get_machine_details`.
3. **Start it** — `offsec_start_machine` (asynchronous deploy).
4. **Get its IP** — `offsec_list_running_labs` once it's `started`.
5. Connect over your OpenVPN client and work the box.
6. **Walkthrough** (optional) — `offsec_get_walkthrough` (unlocks after start).
7. **Stop / revert** — `offsec_stop_machine` / `offsec_revert_machine`
   (instance id auto-discovered).

---

## Tool reference

### `offsec_whoami`
Verify the configured token and return your profile. Run this first.
- **Args:** `response_format`
- **Returns:** `{ authenticated, profile: { username, firstName, lastName, email, type, status } }`

### `offsec_list_labs`
List/search the catalog. Defaults to the **Play** group (PG Play).
- **Args:**
  - `group` — `Play` (default), `Practice`, `Offensive Cyber Range`, or `all`
  - `search` — full-text query (code, name, description)
  - `os` — substring filter, e.g. `windows`
  - `difficulty` — `1`–`5` (1 = Easy … 5 = Insane)
  - `limit` (1–100, default 25), `offset` (default 0)
  - `response_format`
- **Returns:** `{ group, total, count, offset, labs: [{ id, name, slug, os, difficulty, difficultyLabel, points, groups, url }], has_more, next_offset? }`

### `offsec_get_machine_details`
Full metadata for one machine, plus objectives/credentials your account can see.
- **Args:** `machine_id`, `response_format`
- **Returns:** a `MachineDetails` object (OS, difficulty, points, groups, description, objectives, credentials, authors, release date, link).

### `offsec_list_walkthroughs`
List walkthrough rows (one per machine) with their unblocked state.
- **Args:** `category` (e.g. `PLAY`/`PRACTICE`), `search`, `unblocked_only` (default false), `limit`, `offset`, `response_format`
- **Returns:** `{ total, count, offset, walkthroughs: [{ id, name, host, isUnblocked, category, hasContent }], has_more }`

### `offsec_get_walkthrough`
Retrieve a walkthrough's content. Walkthroughs unlock after you start the
machine; pass `unblock: true` to unlock a still-locked one first (mutating — the
same action as the portal's Unlock button). For personal study — don't redistribute.
- **Args:** `machine_id`, `unblock` (boolean, default false), `response_format`
- **Returns:** `{ host, unblocked, unblockedNow, title, url, content }`

### `offsec_unblock_walkthrough` *(mutating)*
Unblock (unlock) a machine's walkthrough on your account — the portal's Unlock
button, `POST /api/walkthroughs/unblocked {walkthrough:<id>}`. The walkthrough id
is resolved from `machine_id` automatically (it differs from the host id); pass
`walkthrough_id` to skip the lookup. The machine must have been started at least
once for the walkthrough to exist.
- **Args:** `machine_id` (or `walkthrough_id`), `response_format`
- **Returns:** `{ host, walkthroughId, unblocked, alreadyUnblocked }`

### `offsec_list_running_labs`
Discover the machines currently running on your account — **the only way to get
the running instance id and target IP** (delivered over the portal's WebSocket).
Requires `OFFSEC_BEARER_TOKEN`.
- **Args:** `response_format`
- **Returns:** `{ count, running: [{ instanceId, host, name, ip, state, startedAt }] }`

### `offsec_start_machine` *(mutating)*
Start (power on) a machine. **Asynchronous** — returns a deploy acknowledgement,
not an instance id/IP. Poll `offsec_list_running_labs` for those.
- **Args:** `machine_id`, `response_format`
- **Returns:** `{ action: "start", host, message }`
- **Notes:** one concurrent machine max (`user_has_started_machine` otherwise).

### `offsec_stop_machine` *(mutating)*
Stop the running instance. `instance_id` is **optional** — omit it and the running
instance is auto-discovered (pass `machine_id` to disambiguate).
- **Args:** `instance_id` (optional), `machine_id` (optional), `response_format`
- **Returns:** `{ action: "stop", instanceId, message }`
- **Notes:** returns `host_action_in_progress` while a deploy/action is mid-flight — retry once `started`.

### `offsec_revert_machine` *(mutating)*
Revert the running instance to a clean state. Same auto-discovery as stop.
- **Args:** `instance_id` (optional), `machine_id` (optional), `response_format`
- **Returns:** `{ action: "revert", instanceId, message }`

---

## Example prompts

Natural-language prompts your agent can satisfy with these tools:

- *"Am I authenticated to OffSec?"* → `offsec_whoami`
- *"List the easy Windows boxes in PG Play."* → `offsec_list_labs` `{ group: "Play", os: "windows", difficulty: 1 }`
- *"Show me the details for kevin-189."* → `offsec_get_machine_details` `{ machine_id: "kevin-189" }`
- *"Start Kevin."* → `offsec_start_machine` `{ machine_id: "Kevin" }`
- *"What's running and what's its IP?"* → `offsec_list_running_labs`
- *"Stop my running machine."* → `offsec_stop_machine` `{}` (auto-discovers)
- *"Revert the Kevin box."* → `offsec_revert_machine` `{ machine_id: "kevin-189" }`

### Example: list labs (markdown)

```
# Play Labs (3 of 40)

## ColdBoxEasy (coldboxeasy-207264)
- **Host id:** 207264
- **OS:** Ubuntu 16
- **Difficulty:** Easy (1)
- **Points:** 10
- **Walkthrough:** yes
- **Link:** https://portal.offsec.com/machine/coldboxeasy-207264/overview/details
...
```

### Example: running labs (json)

```json
{
  "count": 1,
  "running": [
    {
      "instanceId": "32134152",
      "host": 189,
      "name": "Kevin",
      "ip": "192.168.180.45",
      "state": "started",
      "startedAt": "2026-06-02T19:11:52.006969"
    }
  ]
}
```

---

## Output formats

Every tool accepts `response_format`:

- `markdown` (default) — human-readable, good for chat.
- `json` — structured data, good for programmatic use or when you want the agent
  to parse fields.

Ask for *"… as JSON"* or pass `response_format: "json"` explicitly.
