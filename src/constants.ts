/**
 * Shared constants for the OffSec MCP server.
 *
 * These endpoints were mapped against the LIVE portal (https://portal.offsec.com)
 * using a logged-in bearer token, by inspecting the SPA's runtime config
 * (/config.json), its JS bundle, and the actual JSON responses. They are no
 * longer guesses.
 *
 * How the portal is wired (discovered):
 *   - Auth: `Authorization: Bearer <token>` works on all /api/* endpoints.
 *   - REST API base:        https://portal.offsec.com            (the /api/* routes)
 *   - Service gateway base: https://portal.offsec.com/services   (config: API_GATEWAY)
 *   - Lab catalog:          a Typesense cluster. The portal fetches a *scoped*
 *                           search key from the gateway, then queries Typesense
 *                           directly. We reproduce that flow for list/search.
 *
 * The portal serves its own runtime config at GET /config.json (unauthenticated),
 * which yields API_GATEWAY and the Typesense node list. We load it once and cache
 * it, so a future host/cluster change is picked up automatically. Every value can
 * still be overridden via an environment variable for resilience.
 */

// Base of the portal REST API (the /api/* routes). Bearer auth works here.
export const API_BASE_URL =
  process.env.OFFSEC_API_BASE_URL || "https://portal.offsec.com";

// Web base (for constructing human-facing portal links in responses).
export const PORTAL_WEB_BASE =
  process.env.OFFSEC_PORTAL_WEB_BASE || "https://portal.offsec.com";

// The SPA's runtime config endpoint (unauthenticated JSON).
export const CONFIG_JSON_PATH = "/config.json";

/**
 * Real, verified endpoint templates. {id}/{instanceId} are replaced at call time.
 */
export const ENDPOINTS = {
  // GET — current authenticated user profile (used to validate the token).
  profile: "/api/users/current/profile",

  // GET — scoped Typesense search keys. Path is relative to the SERVICE gateway
  // (API_GATEWAY = .../services), so the full URL is .../services/search/...
  scopedSearchKeys: "/search/collections/scoped-search-keys",

  // GET — every walkthrough the account can see (one row per host). `content`
  // is null until unblocked (you unblock by starting the machine).
  walkthroughs: "/api/walkthroughs/",
  // GET — walkthroughs the account has unblocked, WITH their full content.
  walkthroughsUnblocked: "/api/walkthroughs/unblocked",

  // GET — a machine's objectives / credentials by numeric host id.
  hostObjectives: "/api/host-details/{id}/objectives",
  hostCredentials: "/api/host-details/{id}/credentials",

  // POST — start a machine (create a host instance). Body: { host: <numericId> }.
  // The created instance object (id, ip, ...) is returned.
  hostInstances: "/api/host-instances/",
  // DELETE — stop, PATCH — revert, a running instance by its instance id.
  hostInstanceAction: "/api/host-instances/{instanceId}/",
};

// Typesense collection + lab-group constants (from the SPA bundle).
export const TYPESENSE_COLLECTION = "all-content";
// Collections we request scoped keys for (mirrors the SPA's request).
export const SCOPED_KEY_COLLECTIONS = "all-content";
// The lab group shown at /labs/play-1. Other groups: "Practice",
// "Offensive Cyber Range". Filtering by labGroups.name selects a catalog.
export const PG_PLAY_GROUP = "Play";
// Typesense documents we care about are labs backed by a real host (VM).
export const LAB_HOST_FILTER = "labType:host";
// The fields the SPA searches by (and their weights), verbatim.
export const TYPESENSE_QUERY_BY = "code,name,longName,description";

// Fallback Typesense config if /config.json can't be loaded. Overridable via
// OFFSEC_TYPESENSE_HOST. Matches what the live portal served when mapped.
export const FALLBACK_TYPESENSE_HOST = "4aduxq2ngerym1sfp.a1.typesense.net";

// Maximum response size in characters before truncation.
export const CHARACTER_LIMIT = 25000;

// Default and max page sizes for list operations.
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

// HTTP request timeout (ms).
export const REQUEST_TIMEOUT = 30000;

export const SERVER_NAME = "offsec-mcp-server";
export const SERVER_VERSION = "2.0.0";
