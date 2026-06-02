/**
 * Tool registrations for the OffSec MCP server.
 *
 * All tools operate on YOUR OWN authenticated OffSec session and only perform
 * actions you are authorized to perform on your own account (list, inspect,
 * start/stop/revert, walkthrough access). Nothing here scrapes other users'
 * data or redistributes content.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  ENDPOINTS,
  TYPESENSE_QUERY_BY,
} from "../constants.js";
import {
  callEndpoint,
  handleApiError,
  typesenseSearch,
  TypesenseResult,
} from "../services/client.js";
import {
  buildLabFilter,
  extractCredentials,
  extractObjectives,
  labsFromResult,
  normalizeActionAck,
  normalizeLabDoc,
  normalizeMachineDetails,
  normalizeProfile,
  normalizeWalkthroughs,
  parseHostId,
} from "../services/normalize.js";
import { getRunningInstances } from "../services/ws.js";
import { errorResult, kv, lines, toolResult } from "../services/format.js";
import { LabSummary, ResponseFormat, RunningInstance } from "../types.js";
import {
  InstanceActionSchema,
  ListLabsSchema,
  ListRunningLabsSchema,
  ListWalkthroughsSchema,
  MachineIdSchema,
  StartMachineSchema,
  WhoAmISchema,
} from "../schemas.js";

const TYPESENSE_PAGE = 250; // Typesense per_page hard cap.
const FETCH_CAP = 1000; // safety: never page past this many catalog rows.

/** Page through the Typesense catalog for a group, returning all lab summaries. */
async function fetchLabs(
  group: string,
  query: string | undefined
): Promise<LabSummary[]> {
  const filter = buildLabFilter(group);
  const q = query && query.trim() ? query.trim() : "*";
  const out: LabSummary[] = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const result: TypesenseResult = await typesenseSearch({
      q,
      query_by: TYPESENSE_QUERY_BY,
      filter_by: filter,
      per_page: TYPESENSE_PAGE,
      page,
    });
    out.push(...labsFromResult(result));
    const found = result.found ?? out.length;
    if (out.length >= found || out.length >= FETCH_CAP || !result.hits?.length) {
      break;
    }
    page += 1;
  }
  return out;
}

/** Resolve a user machine identifier to a numeric host id + catalog doc. */
async function resolveMachine(
  machineId: string
): Promise<{ hostId: string; doc?: Record<string, unknown> }> {
  const parsed = parseHostId(machineId);
  if (parsed) {
    // Try to pull the catalog doc for richer details (best-effort).
    const result = await typesenseSearch({
      q: "*",
      query_by: "name",
      filter_by: `labType:host && contentId:=${parsed}`,
      per_page: 1,
    });
    return { hostId: parsed, doc: result.hits?.[0]?.document };
  }
  // Bare name — resolve via search.
  const result = await typesenseSearch({
    q: machineId,
    query_by: "name,code,longName",
    filter_by: "labType:host",
    per_page: 1,
  });
  const doc = result.hits?.[0]?.document;
  const summary = doc ? normalizeLabDoc(doc) : undefined;
  if (!summary) {
    throw new Error(
      `No machine matched '${machineId}'. Try offsec_list_labs to find the id.`
    );
  }
  return { hostId: summary.id, doc };
}

/**
 * Resolve the instance id + context host id for a stop/revert call. Uses an
 * explicit instance_id if given; otherwise discovers running instances over the
 * WebSocket (filtered by machine_id when provided).
 */
async function resolveInstance(params: {
  instance_id?: string;
  machine_id?: string;
}): Promise<{ instanceId: string; hostId?: string }> {
  const hostHint = params.machine_id ? parseHostId(params.machine_id) : undefined;
  if (params.instance_id) {
    return { instanceId: params.instance_id, hostId: hostHint };
  }
  const running = await getRunningInstances();
  if (!running.length) {
    throw new Error(
      "No running instances found to act on. Start a machine first, or pass an " +
        "explicit instance_id."
    );
  }
  let candidates = running;
  if (hostHint) {
    candidates = running.filter((r) => String(r.host) === hostHint);
    if (!candidates.length) {
      throw new Error(
        `No running instance matches machine ${params.machine_id}. Running: ` +
          running.map((r) => `${r.name} (host ${r.host}, instance ${r.instanceId})`).join("; ")
      );
    }
  }
  if (candidates.length > 1) {
    throw new Error(
      "Multiple running instances; specify instance_id. Running: " +
        candidates
          .map((r) => `${r.name} (host ${r.host}, instance ${r.instanceId})`)
          .join("; ")
    );
  }
  const inst = candidates[0];
  const ctxHost = hostHint ?? (inst.host != null ? String(inst.host) : undefined);
  return { instanceId: inst.instanceId, hostId: ctxHost };
}

export function registerTools(server: McpServer): void {
  // ---------------------------------------------------------------------------
  // offsec_whoami — validate credentials
  // ---------------------------------------------------------------------------
  server.registerTool(
    "offsec_whoami",
    {
      title: "Verify OffSec Authentication",
      description: `Verify that the configured OffSec session token/cookie is valid by fetching the current authenticated user profile.

Use this FIRST to confirm credentials work before troubleshooting other tools. Requires OFFSEC_BEARER_TOKEN and/or OFFSEC_COOKIE to be set in the server environment (copied from your logged-in browser session).

Args:
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns: username, name, and primary email for the authenticated account, or an actionable auth error.`,
      inputSchema: WhoAmISchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof WhoAmISchema>) => {
      try {
        const data = await callEndpoint(ENDPOINTS.profile);
        const profile = normalizeProfile(data);
        const structured = { authenticated: true, profile };
        if (params.response_format === ResponseFormat.JSON) {
          return toolResult(JSON.stringify(structured, null, 2), structured);
        }
        const name = [profile.firstName, profile.lastName]
          .filter(Boolean)
          .join(" ");
        return toolResult(
          lines(
            "✅ Authenticated to OffSec.",
            kv("Username", profile.username),
            kv("Name", name || undefined),
            kv("Email", profile.email)
          ),
          structured
        );
      } catch (error) {
        return errorResult(handleApiError(error, ENDPOINTS.profile));
      }
    }
  );

  // ---------------------------------------------------------------------------
  // offsec_list_labs — list labs from the catalog (Typesense)
  // ---------------------------------------------------------------------------
  server.registerTool(
    "offsec_list_labs",
    {
      title: "List Available OffSec Labs",
      description: `List labs/machines from the OffSec catalog. Defaults to the PG Play group (the machines shown at portal.offsec.com/labs/play-1).

Args:
  - group (string): 'Play' (default), 'Practice', 'Offensive Cyber Range', or 'all'.
  - search (string, optional): Full-text query (code, name, description).
  - os (string, optional): Case-insensitive substring filter on OS (e.g. 'windows').
  - difficulty (number, optional): Exact difficulty 1-5 (1=Easy … 5=Insane).
  - limit (number): Max results 1-100 (default 25).
  - offset (number): Results to skip for pagination (default 0).
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns (JSON):
  { "total": number, "count": number, "offset": number,
    "labs": [ { "id": string, "name": string, "slug": string, "os"?: string,
               "difficulty"?: number, "difficultyLabel"?: string,
               "points"?: number, "groups"?: string[], "url"?: string } ],
    "has_more": boolean, "next_offset"?: number }

Use the 'id' (numeric, e.g. '189') or 'slug' (e.g. 'kevin-189') with the other tools.`,
      inputSchema: ListLabsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof ListLabsSchema>) => {
      try {
        let labs = await fetchLabs(params.group, params.search);

        if (params.os) {
          const q = params.os.toLowerCase();
          labs = labs.filter((l) => (l.os ?? "").toLowerCase().includes(q));
        }
        if (params.difficulty !== undefined) {
          labs = labs.filter((l) => l.difficulty === params.difficulty);
        }

        const total = labs.length;
        const page = labs.slice(params.offset, params.offset + params.limit);
        const hasMore = params.offset + page.length < total;
        const structured = {
          group: params.group,
          total,
          count: page.length,
          offset: params.offset,
          labs: page,
          has_more: hasMore,
          ...(hasMore ? { next_offset: params.offset + page.length } : {}),
        };

        if (params.response_format === ResponseFormat.JSON) {
          return toolResult(JSON.stringify(structured, null, 2), structured);
        }
        if (!page.length) {
          return toolResult(
            `No labs matched (group '${params.group}'${
              params.search ? `, search '${params.search}'` : ""
            }).`,
            structured
          );
        }
        const body = page
          .map((l) =>
            lines(
              `## ${l.name} (${l.slug})`,
              kv("Host id", l.id),
              kv("OS", [l.os, l.osVersion].filter(Boolean).join(" ") || undefined),
              kv(
                "Difficulty",
                l.difficultyLabel
                  ? `${l.difficultyLabel}${l.difficulty ? ` (${l.difficulty})` : ""}`
                  : undefined
              ),
              kv("Points", l.points),
              kv("Walkthrough", l.hasWalkthrough ? "yes" : undefined),
              kv("Link", l.url)
            )
          )
          .join("\n\n");
        const header = `# ${params.group} Labs (${structured.count} of ${total})`;
        return toolResult(`${header}\n\n${body}`, structured);
      } catch (error) {
        return errorResult(handleApiError(error, "typesense:all-content"));
      }
    }
  );

  // ---------------------------------------------------------------------------
  // offsec_get_machine_details — catalog doc + objectives + credentials
  // ---------------------------------------------------------------------------
  server.registerTool(
    "offsec_get_machine_details",
    {
      title: "Get OffSec Machine Details",
      description: `Get full metadata for a single machine: OS, difficulty, points, groups, description, plus any objectives and credentials your account can see.

Args:
  - machine_id (string): numeric host id (e.g. '189'), slug ('kevin-189'), or name ('Kevin').
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns (JSON): a MachineDetails object.`,
      inputSchema: MachineIdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof MachineIdSchema>) => {
      try {
        const { hostId, doc } = await resolveMachine(params.machine_id);
        let objectives: string | undefined;
        let credentials: string | undefined;
        try {
          objectives = extractObjectives(
            await callEndpoint(ENDPOINTS.hostObjectives, {
              pathParams: { id: hostId },
            })
          );
        } catch {
          /* objectives are optional */
        }
        try {
          credentials = extractCredentials(
            await callEndpoint(ENDPOINTS.hostCredentials, {
              pathParams: { id: hostId },
            })
          );
        } catch {
          /* credentials are optional */
        }
        const d = normalizeMachineDetails(doc, objectives, credentials, hostId);
        if (params.response_format === ResponseFormat.JSON) {
          return toolResult(
            JSON.stringify(d, null, 2),
            d as unknown as Record<string, unknown>
          );
        }
        const text = lines(
          `# ${d.name} (${d.slug})`,
          kv("Host id", d.id),
          kv("OS", [d.os, d.osVersion].filter(Boolean).join(" ") || undefined),
          kv(
            "Difficulty",
            d.difficultyLabel
              ? `${d.difficultyLabel}${d.difficulty ? ` (${d.difficulty})` : ""}`
              : undefined
          ),
          kv("Points", d.points),
          kv("Groups", d.groups?.join(", ")),
          kv("Authors", d.authors?.join(", ")),
          kv("Released", d.releaseDate),
          kv("Link", d.url),
          d.description ? `\n## Description\n${d.description}` : null,
          d.objectives ? `\n## Objectives\n${d.objectives}` : null,
          d.credentials ? `\n## Credentials\n${d.credentials}` : null
        );
        return toolResult(text, d as unknown as Record<string, unknown>);
      } catch (error) {
        return errorResult(handleApiError(error, ENDPOINTS.hostObjectives));
      }
    }
  );

  // ---------------------------------------------------------------------------
  // offsec_list_walkthroughs — every walkthrough row for the account
  // ---------------------------------------------------------------------------
  server.registerTool(
    "offsec_list_walkthroughs",
    {
      title: "List OffSec Walkthroughs",
      description: `List walkthroughs available to your account (one row per machine). Each row shows the host id, category (PLAY/PRACTICE/...), and whether you've unblocked it.

Walkthroughs unlock once you START the corresponding machine. Use offsec_get_walkthrough to read an unblocked one.

Args:
  - category (string, optional): e.g. 'PLAY' or 'PRACTICE'.
  - search (string, optional): substring filter on walkthrough name.
  - unblocked_only (boolean): only return unblocked walkthroughs (default false).
  - limit (number), offset (number): pagination.
  - response_format ('markdown' | 'json').

Returns (JSON): { total, count, offset, walkthroughs: [...], has_more }.`,
      inputSchema: ListWalkthroughsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof ListWalkthroughsSchema>) => {
      const endpoint = params.unblocked_only
        ? ENDPOINTS.walkthroughsUnblocked
        : ENDPOINTS.walkthroughs;
      try {
        let rows = normalizeWalkthroughs(await callEndpoint(endpoint));
        if (params.category) {
          const c = params.category.toUpperCase();
          rows = rows.filter((r) => (r.category ?? "").toUpperCase() === c);
        }
        if (params.search) {
          const s = params.search.toLowerCase();
          rows = rows.filter((r) => r.name.toLowerCase().includes(s));
        }
        if (params.unblocked_only) {
          rows = rows.filter((r) => r.isUnblocked);
        }
        const total = rows.length;
        const page = rows
          .slice(params.offset, params.offset + params.limit)
          // Drop full content from list view; use offsec_get_walkthrough to read.
          .map(({ content, ...rest }) => ({
            ...rest,
            hasContent: content != null && content !== "",
          }));
        const hasMore = params.offset + page.length < total;
        const structured = {
          total,
          count: page.length,
          offset: params.offset,
          walkthroughs: page,
          has_more: hasMore,
          ...(hasMore ? { next_offset: params.offset + page.length } : {}),
        };
        if (params.response_format === ResponseFormat.JSON) {
          return toolResult(JSON.stringify(structured, null, 2), structured);
        }
        if (!page.length) {
          return toolResult("No walkthroughs matched.", structured);
        }
        const body = page
          .map((w) =>
            lines(
              `## ${w.name}`,
              kv("Host id", w.host),
              kv("Category", w.category),
              kv("Unblocked", w.isUnblocked ? "yes" : "no")
            )
          )
          .join("\n\n");
        return toolResult(
          `# Walkthroughs (${structured.count} of ${total})\n\n${body}`,
          structured
        );
      } catch (error) {
        return errorResult(handleApiError(error, endpoint));
      }
    }
  );

  // ---------------------------------------------------------------------------
  // offsec_get_walkthrough — read one unblocked walkthrough
  // ---------------------------------------------------------------------------
  server.registerTool(
    "offsec_get_walkthrough",
    {
      title: "Get OffSec Machine Walkthrough",
      description: `Retrieve the official walkthrough for a machine into your own authorized session. Walkthroughs unlock only AFTER you start the machine; locked ones return no content.

For YOUR personal study. Do not redistribute walkthrough content — OffSec's rules prohibit sharing complete solutions.

Args:
  - machine_id (string): numeric host id, slug, or name.
  - response_format ('markdown' | 'json').

Returns: the walkthrough content if unblocked, else guidance to start the machine first.`,
      inputSchema: MachineIdSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof MachineIdSchema>) => {
      try {
        const hostId = parseHostId(params.machine_id) ??
          (await resolveMachine(params.machine_id)).hostId;
        const hostNum = Number(hostId);
        const rows = normalizeWalkthroughs(
          await callEndpoint(ENDPOINTS.walkthroughsUnblocked)
        );
        const match = rows.find((r) => r.host === hostNum && r.content);
        const structured = {
          host: hostNum,
          unblocked: Boolean(match),
          title: match?.name,
          url: `${match?.url ?? ""}`,
          content: match?.content ?? "",
        };
        if (params.response_format === ResponseFormat.JSON) {
          return toolResult(JSON.stringify(structured, null, 2), structured);
        }
        if (!match?.content) {
          return toolResult(
            `No unblocked walkthrough for host ${hostNum}. Walkthroughs unlock ` +
              `only after you START the machine (offsec_start_machine), then ` +
              `it appears in offsec_list_walkthroughs with unblocked=yes.`,
            structured
          );
        }
        return toolResult(
          lines(
            `# Walkthrough: ${match.name}`,
            kv("Source", match.url),
            "",
            match.content
          ),
          structured
        );
      } catch (error) {
        return errorResult(handleApiError(error, ENDPOINTS.walkthroughsUnblocked));
      }
    }
  );

  // ---------------------------------------------------------------------------
  // offsec_list_running_labs — discover running instances (id + IP) over the WS
  // ---------------------------------------------------------------------------
  server.registerTool(
    "offsec_list_running_labs",
    {
      title: "List Running OffSec Labs",
      description: `List the machines currently running on your account, with their instance id, target IP, and state.

This is the only way to obtain a running instance's id and IP: the portal delivers them over a WebSocket (no REST endpoint exposes them). This tool connects to that WebSocket, authenticates with your bearer token, and reads the live snapshot. Requires OFFSEC_BEARER_TOKEN.

Use it to get the instance id for offsec_stop_machine / offsec_revert_machine — or just call those without an instance_id and they'll auto-discover.

Args:
  - response_format ('markdown' | 'json').

Returns (JSON): { count, running: [ { instanceId, host, name, ip, state, startedAt } ] }.`,
      inputSchema: ListRunningLabsSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof ListRunningLabsSchema>) => {
      try {
        const running: RunningInstance[] = await getRunningInstances();
        const structured = { count: running.length, running };
        if (params.response_format === ResponseFormat.JSON) {
          return toolResult(JSON.stringify(structured, null, 2), structured);
        }
        if (!running.length) {
          return toolResult("No labs are currently running.", structured);
        }
        const body = running
          .map((r) =>
            lines(
              `## ${r.name ?? "machine"} (host ${r.host})`,
              kv("Instance id", r.instanceId),
              kv("IP", r.ip),
              kv("State", r.state),
              kv("Started", r.startedAt)
            )
          )
          .join("\n\n");
        return toolResult(
          `# Running Labs (${running.length})\n\n${body}`,
          structured
        );
      } catch (error) {
        return errorResult(handleApiError(error, "ws:host_actions"));
      }
    }
  );

  // ---------------------------------------------------------------------------
  // offsec_start_machine — power on (creates a host instance)
  // ---------------------------------------------------------------------------
  server.registerTool(
    "offsec_start_machine",
    {
      title: "Start an OffSec Machine",
      description: `Start (power on) a machine on your account. This is an ASYNCHRONOUS deploy: the API returns an acknowledgement ("Deploy request in progress"), and the machine comes online over the next minute or two.

IMPORTANT: the API does NOT return the instance id or target IP — the portal delivers those over a WebSocket that a token-only client can't read. To stop or revert later, get the instance id from the running machine's portal page (the Stop button calls PATCH /api/host-instances/<instanceId>/), then pass it to offsec_stop_machine. The target IP is shown on that same page.

OffSec allows only one concurrent machine; if one is already running you'll get a "user_has_started_machine" error — stop it first.

This performs an action on YOUR account; it consumes lab time/quota.

Args:
  - machine_id (string): numeric host id, slug, or name.
  - response_format ('markdown' | 'json').

Returns (JSON): { action, host, message }.`,
      inputSchema: StartMachineSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof StartMachineSchema>) => {
      try {
        const { hostId } = await resolveMachine(params.machine_id);
        const payload = await callEndpoint(ENDPOINTS.hostInstances, {
          method: "POST",
          data: { host: Number(hostId) },
        });
        const ack = normalizeActionAck(payload);
        const structured = { action: "start", host: Number(hostId), ...ack };
        if (params.response_format === ResponseFormat.JSON) {
          return toolResult(JSON.stringify(structured, null, 2), structured);
        }
        return toolResult(
          lines(
            `🚀 Start requested for host ${hostId}.`,
            kv("Status", ack.message ?? "Deploy request in progress"),
            "",
            "The machine deploys in the background (~1-2 min). The API does not " +
              "return the instance id or IP — read them from the machine's portal " +
              "page. To stop/revert, pass that instance id to offsec_stop_machine " +
              "(with machine_id for context)."
          ),
          structured
        );
      } catch (error) {
        return errorResult(handleApiError(error, ENDPOINTS.hostInstances));
      }
    }
  );

  // ---------------------------------------------------------------------------
  // offsec_stop_machine — power off an instance
  // ---------------------------------------------------------------------------
  server.registerTool(
    "offsec_stop_machine",
    {
      title: "Stop an OffSec Machine",
      description: `Stop (power off) a running instance.

You do NOT need to know the instance id: omit it and the server discovers the running instance over the WebSocket (OffSec allows one concurrent machine, so it targets that one; pass machine_id to disambiguate). Or pass an explicit instance_id from offsec_list_running_labs.

Asynchronous: returns "Stop action in progress". If a deploy/revert is mid-flight you'll get "host_action_in_progress" — retry shortly.

Args:
  - instance_id (string, optional): the running instance id; auto-discovered if omitted.
  - machine_id (string, optional): host id/slug/name — disambiguates discovery and sets context.
  - response_format ('markdown' | 'json').`,
      inputSchema: InstanceActionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof InstanceActionSchema>) => {
      try {
        // Verified against the live portal: stop is PATCH /api/host-instances/:id/
        // with body { action:"stop", context_learning_unit_id:<hostId> }.
        const { instanceId, hostId } = await resolveInstance(params);
        const payload = await callEndpoint(ENDPOINTS.hostInstanceAction, {
          method: "PATCH",
          pathParams: { instanceId },
          data: {
            action: "stop",
            ...(hostId ? { context_learning_unit_id: Number(hostId) } : {}),
          },
        });
        const ack = normalizeActionAck(payload);
        const structured = { action: "stop", instanceId, ...ack };
        if (params.response_format === ResponseFormat.JSON) {
          return toolResult(JSON.stringify(structured, null, 2), structured);
        }
        return toolResult(
          lines(
            `🛑 Stop requested for instance ${instanceId}.`,
            kv("Status", ack.message)
          ),
          structured
        );
      } catch (error) {
        return errorResult(handleApiError(error, ENDPOINTS.hostInstanceAction));
      }
    }
  );

  // ---------------------------------------------------------------------------
  // offsec_revert_machine — revert an instance to a clean state
  // ---------------------------------------------------------------------------
  server.registerTool(
    "offsec_revert_machine",
    {
      title: "Revert an OffSec Machine",
      description: `Revert (reset to a clean state) a running instance. Useful when a box gets into a bad state.

You do NOT need the instance id: omit it and the server discovers the running instance over the WebSocket (pass machine_id to disambiguate). Or pass an explicit instance_id from offsec_list_running_labs.

Asynchronous: returns "Revert action in progress". If another action is mid-flight you'll get "host_action_in_progress" — retry shortly.

Args:
  - instance_id (string, optional): the running instance id; auto-discovered if omitted.
  - machine_id (string, optional): host id/slug/name — disambiguates discovery and sets context.
  - response_format ('markdown' | 'json').`,
      inputSchema: InstanceActionSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof InstanceActionSchema>) => {
      try {
        // Verified live: PATCH /api/host-instances/:id/ with
        // { action:"revert", context_learning_unit_id:<hostId> }.
        const { instanceId, hostId } = await resolveInstance(params);
        const payload = await callEndpoint(ENDPOINTS.hostInstanceAction, {
          method: "PATCH",
          pathParams: { instanceId },
          data: {
            action: "revert",
            ...(hostId ? { context_learning_unit_id: Number(hostId) } : {}),
          },
        });
        const ack = normalizeActionAck(payload);
        const structured = { action: "revert", instanceId, ...ack };
        if (params.response_format === ResponseFormat.JSON) {
          return toolResult(JSON.stringify(structured, null, 2), structured);
        }
        return toolResult(
          lines(
            `♻️ Revert requested for instance ${instanceId}.`,
            kv("Status", ack.message)
          ),
          structured
        );
      } catch (error) {
        return errorResult(handleApiError(error, ENDPOINTS.hostInstanceAction));
      }
    }
  );
}
