/**
 * Pure normalizers mapping the portal's real JSON into our typed interfaces.
 * These are deliberately dependency-free so they can be unit-tested directly
 * against captured fixtures.
 */

import {
  ActionAck,
  LabSummary,
  MachineDetails,
  Profile,
  RunningInstance,
  Walkthrough,
} from "../types.js";
import { PG_PLAY_GROUP, PORTAL_WEB_BASE } from "../constants.js";

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null;
}

function pick<T = unknown>(o: Obj, keys: string[]): T | undefined {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k] as T;
  }
  return undefined;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) {
    const arr = v.map(asString).filter((x): x is string => Boolean(x));
    return arr.length ? arr : undefined;
  }
  const s = asString(v);
  return s ? [s] : undefined;
}

/** Kebab-case a machine name for slug building (e.g. "Empire breakout"). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Portal-style slug "name-id" (e.g. "kevin-189"). */
export function labSlug(name: string | undefined, id: string): string {
  const base = name ? slugify(name) : "";
  return base ? `${base}-${id}` : id;
}

function machineUrl(slug: string): string {
  return `${PORTAL_WEB_BASE}/machine/${slug}/overview/details`;
}

/**
 * Map OffSec's numeric difficulty to a human label. The portal renders 1..5 as
 * Easy..Insane; we keep the number too for callers who want to sort/filter.
 */
export function difficultyLabel(n: number | undefined): string | undefined {
  if (n === undefined) return undefined;
  const labels: Record<number, string> = {
    1: "Easy",
    2: "Intermediate",
    3: "Hard",
    4: "Very Hard",
    5: "Insane",
  };
  return labels[n] ?? `Level ${n}`;
}

/** Extract lab-group names from a Typesense document's labGroups array. */
export function extractGroups(doc: Obj): string[] {
  const lg = doc.labGroups;
  if (!Array.isArray(lg)) return [];
  return lg
    .map((g) => (isObj(g) ? asString(g.name) : asString(g)))
    .filter((x): x is string => Boolean(x));
}

/** Normalize one Typesense lab document into a LabSummary. */
export function normalizeLabDoc(doc: Obj): LabSummary {
  const id = asString(pick(doc, ["contentId", "id"])) ?? "unknown";
  const name = asString(pick(doc, ["name", "longName"])) ?? id;
  const slug = labSlug(name, id);
  const difficulty = asNumber(doc.difficulty);
  return {
    id,
    name,
    slug,
    os: asString(doc.primaryOsName) ?? undefined,
    osVersion: asString(doc.primaryOsVersion) ?? undefined,
    difficulty,
    difficultyLabel: difficultyLabel(difficulty),
    points: asNumber(doc.points),
    groups: extractGroups(doc),
    releaseDate: asString(doc.releaseDate),
    hasWalkthrough:
      typeof doc.hasWalkthroughs === "boolean" ? doc.hasWalkthroughs : undefined,
    url: machineUrl(slug),
  };
}

/** Pull the documents out of a Typesense result block into LabSummaries. */
export function labsFromResult(result: {
  hits?: { document: Obj }[];
}): LabSummary[] {
  return (result.hits ?? []).map((h) => normalizeLabDoc(h.document));
}

/** Build the Typesense filter_by string for a given group (or all hosts). */
export function buildLabFilter(group?: string): string {
  const parts = ["labType:host"];
  if (group && group.toLowerCase() !== "all") {
    // Escape quotes defensively; group names are simple words in practice.
    parts.push(`labGroups.name:${group.replace(/"/g, "")}`);
  }
  return parts.join(" && ");
}

/** Normalize the authenticated profile. */
export function normalizeProfile(payload: unknown): Profile {
  const o: Obj = isObj(payload) ? payload : {};
  return {
    username: asString(pick(o, ["username", "user_name"])),
    firstName: asString(pick(o, ["first_name", "firstName"])),
    lastName: asString(pick(o, ["last_name", "lastName"])),
    email: extractPrimaryEmail(o),
    type: asNumber(o.type),
    status: asNumber(o.status),
  };
}

function extractPrimaryEmail(o: Obj): string | undefined {
  const emails = o.emails;
  if (Array.isArray(emails)) {
    const primary =
      emails.find((e) => isObj(e) && e.is_primary) ??
      emails.find((e) => isObj(e));
    if (isObj(primary)) return asString(primary.email_address);
  }
  return asString(pick(o, ["email", "email_address"]));
}

/**
 * Combine a catalog doc (may be undefined) with objectives/credentials text
 * into full MachineDetails.
 */
export function normalizeMachineDetails(
  doc: Obj | undefined,
  objectives: string | undefined,
  credentials: string | undefined,
  idHint: string
): MachineDetails {
  const base: LabSummary = doc
    ? normalizeLabDoc(doc)
    : {
        id: idHint,
        name: idHint,
        slug: idHint,
        url: machineUrl(idHint),
      };
  return {
    ...base,
    description: doc ? asString(doc.description) : undefined,
    authors: doc ? asStringArray(doc.authors) : undefined,
    duration: doc ? asNumber(doc.duration) : undefined,
    objectives: objectives && objectives.trim() ? objectives : undefined,
    credentials: credentials && credentials.trim() ? credentials : undefined,
  };
}

/** Pull objectives text out of GET /api/host-details/{id}/objectives. */
export function extractObjectives(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload || undefined;
  if (isObj(payload)) {
    const v = asString(pick(payload, ["machine_objectives", "objectives"]));
    return v && v.trim() ? v : undefined;
  }
  return undefined;
}

/** Pull credentials text out of GET /api/host-details/{id}/credentials. */
export function extractCredentials(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload || undefined;
  if (isObj(payload)) {
    const v = asString(pick(payload, ["credentials"]));
    return v && v.trim() ? v : undefined;
  }
  return undefined;
}

/** Normalize one walkthrough row. */
export function normalizeWalkthrough(o: Obj): Walkthrough {
  const host = asNumber(o.host) ?? 0;
  const content = typeof o.content === "string" ? o.content : null;
  return {
    id: asNumber(o.id) ?? 0,
    name: asString(o.name) ?? "",
    host,
    content,
    isUnblocked:
      typeof o.is_unblocked === "boolean" ? o.is_unblocked : content !== null,
    category: asString(pick(o, ["top_level_learning_unit_code", "category"])),
    url: `${PORTAL_WEB_BASE}/machine/${host}/overview/walkthrough`,
  };
}

/** Normalize an array of walkthrough rows. */
export function normalizeWalkthroughs(payload: unknown): Walkthrough[] {
  if (!Array.isArray(payload)) return [];
  return payload.filter(isObj).map(normalizeWalkthrough);
}

/**
 * Find a machine's own walkthrough id from its host id. The unblock endpoint
 * keys off the walkthrough id (e.g. 563), NOT the host id (e.g. 559), so this
 * is the lookup every unblock path goes through. Returns undefined when the
 * account has no walkthrough row for that host (machine never started).
 */
export function walkthroughIdForHost(
  rows: Walkthrough[],
  host: number
): number | undefined {
  const row = rows.find((r) => r.host === host);
  return row && row.id ? row.id : undefined;
}

/**
 * Normalize the acknowledgement returned by the start/stop/revert endpoints.
 * These are async actions; the body is just a status message (and, on failure,
 * an error code like "host_action_in_progress" or "user_has_started_machine").
 */
export function normalizeActionAck(payload: unknown): ActionAck {
  const o: Obj = isObj(payload) ? payload : {};
  return {
    message: asString(pick(o, ["message", "detail"])),
    code: asString(pick(o, ["code"])),
    raw: payload,
  };
}

/**
 * Parse a user-supplied machine identifier into a numeric host id when possible.
 * Accepts "189", "kevin-189", or "Kevin" (returns undefined for the last — the
 * caller must resolve a bare name via search).
 */
export function parseHostId(machineId: string): string | undefined {
  const trimmed = machineId.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  const m = trimmed.match(/-(\d+)$/);
  if (m) return m[1];
  return undefined;
}

/**
 * Parse running instances out of the WebSocket message stream.
 *
 * Relevant messages are `{group:"host_actions", action:"started"|"state_change",
 * content: <event | event[]>}` where each event has a `host_instance` object:
 * `{ id, ip, related_host:{id,name}, ... }` plus `host_instance_state`.
 *
 * Returns one entry per live host instance, de-duplicated by instance id, with
 * later events overriding earlier ones (so a state_change supersedes the
 * initial started snapshot). Stopped/closed instances are dropped.
 */
export function parseRunningInstances(messages: unknown[]): RunningInstance[] {
  const byId = new Map<string, RunningInstance>();
  for (const msg of messages) {
    if (!isObj(msg)) continue;
    if (msg.group !== "host_actions") continue;
    const content = msg.content;
    const events: unknown[] = Array.isArray(content) ? content : [content];
    for (const ev of events) {
      if (!isObj(ev)) continue;
      const hi = ev.host_instance;
      if (!isObj(hi)) continue;
      const instanceId = asString(pick(hi, ["id", "instance_id"]));
      if (!instanceId) continue;
      const related = isObj(hi.related_host) ? (hi.related_host as Obj) : {};
      const state = asString(
        pick(ev, ["host_instance_state", "state", "action_state"])
      );
      // Drop instances that are no longer live.
      if (state && /stopped|closed|reverted|deleted|error/i.test(state)) {
        byId.delete(instanceId);
        continue;
      }
      if (hi.closed_at) {
        byId.delete(instanceId);
        continue;
      }
      byId.set(instanceId, {
        instanceId,
        host: asNumber(pick(related, ["id"])),
        name: asString(pick(related, ["name"])),
        ip: asString(pick(hi, ["ip", "ip_address"])),
        state,
        startedAt: asString(pick(hi, ["started_at", "startedAt"])),
        scheduledShutdown: asString(
          pick(hi, ["scheduled_shutdown", "scheduledShutdown"])
        ),
      });
    }
  }
  return Array.from(byId.values());
}

export const DEFAULT_GROUP = PG_PLAY_GROUP;
