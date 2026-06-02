/**
 * API client for the OffSec portal.
 *
 * AUTH: a logged-in session token/cookie that YOU grab from your browser after
 * logging into portal.offsec.com. No password is handled. Provide it via env:
 *
 *   OFFSEC_BEARER_TOKEN   -> sent as "Authorization: Bearer <token>"
 *   OFFSEC_COOKIE         -> sent as the raw "Cookie:" header
 *
 * The bearer token is what the portal SPA itself uses, and it works on every
 * /api/* endpoint. You only need one of the two.
 *
 * The lab catalog lives in a Typesense cluster. The portal fetches a *scoped*
 * search key from its service gateway and then queries Typesense directly; we
 * reproduce that exact flow. The Typesense node + gateway base come from the
 * portal's own /config.json (cached), so we track the live deployment.
 */

import axios, { AxiosError, AxiosInstance, Method } from "axios";
import {
  API_BASE_URL,
  CONFIG_JSON_PATH,
  ENDPOINTS,
  FALLBACK_TYPESENSE_HOST,
  REQUEST_TIMEOUT,
  SCOPED_KEY_COLLECTIONS,
  TYPESENSE_COLLECTION,
} from "../constants.js";
import { TypesenseNode } from "../types.js";

let cachedRestClient: AxiosInstance | null = null;

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const bearer = process.env.OFFSEC_BEARER_TOKEN;
  const cookie = process.env.OFFSEC_COOKIE;
  if (bearer) headers["Authorization"] = `Bearer ${bearer.trim()}`;
  if (cookie) headers["Cookie"] = cookie.trim();
  return headers;
}

export function hasCredentials(): boolean {
  return Boolean(process.env.OFFSEC_BEARER_TOKEN || process.env.OFFSEC_COOKIE);
}

function userAgent(): string {
  return (
    process.env.OFFSEC_USER_AGENT ||
    "Mozilla/5.0 (compatible; offsec-mcp-server/2.0)"
  );
}

function getRestClient(): AxiosInstance {
  if (cachedRestClient) return cachedRestClient;
  cachedRestClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: REQUEST_TIMEOUT,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": userAgent(),
      ...getAuthHeaders(),
    },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  return cachedRestClient;
}

/** Substitute {id} (and any {key}) placeholders in an endpoint template. */
export function buildPath(
  template: string,
  params: Record<string, string> = {}
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params[key];
    if (v === undefined) {
      throw new Error(`Missing path parameter '${key}' for endpoint ${template}`);
    }
    return encodeURIComponent(v);
  });
}

export class MissingCredentialsError extends Error {
  constructor() {
    super(
      "No OffSec credentials configured. Set OFFSEC_BEARER_TOKEN and/or " +
        "OFFSEC_COOKIE (copied from your logged-in browser session) in the " +
        "server environment."
    );
    this.name = "MissingCredentialsError";
  }
}

/** Make a request to the portal REST API. Returns parsed JSON. Throws on non-2xx. */
export async function makeApiRequest<T = unknown>(
  endpoint: string,
  method: Method = "GET",
  data?: unknown,
  queryParams?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  if (!hasCredentials()) throw new MissingCredentialsError();
  const client = getRestClient();
  const response = await client.request<T>({
    url: endpoint,
    method,
    data,
    params: queryParams,
  });
  return response.data;
}

/** Convenience: resolve a templated endpoint and call it. */
export async function callEndpoint<T = unknown>(
  template: string,
  opts: {
    method?: Method;
    pathParams?: Record<string, string>;
    data?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<T> {
  const path = buildPath(template, opts.pathParams);
  return makeApiRequest<T>(path, opts.method ?? "GET", opts.data, opts.query);
}

// ---------------------------------------------------------------------------
// Runtime config (/config.json) — gives us the gateway base + Typesense nodes.
// ---------------------------------------------------------------------------

interface RuntimeConfig {
  apiGateway: string; // e.g. https://portal.offsec.com/services
  typesenseHost: string; // nearest node host
  typesenseProtocol: string;
  typesensePort: string;
}

let cachedConfig: RuntimeConfig | null = null;

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedConfig) return cachedConfig;

  // Allow full env override so the server keeps working offline / if config moves.
  const envGateway = process.env.OFFSEC_API_GATEWAY;
  const envTsHost = process.env.OFFSEC_TYPESENSE_HOST;

  let apiGateway = envGateway || `${API_BASE_URL}/services`;
  let typesenseHost = envTsHost || FALLBACK_TYPESENSE_HOST;
  let typesenseProtocol = "https";
  let typesensePort = "443";

  if (!envGateway || !envTsHost) {
    try {
      const { data } = await axios.get<Record<string, unknown>>(
        `${API_BASE_URL}${CONFIG_JSON_PATH}`,
        { timeout: REQUEST_TIMEOUT, headers: { "User-Agent": userAgent() } }
      );
      if (!envGateway && typeof data.API_GATEWAY === "string") {
        apiGateway = data.API_GATEWAY;
      }
      const ts = data.TYPESENSE_CONFIG as
        | { nearestNode?: TypesenseNode; nodes?: TypesenseNode[] }
        | undefined;
      const node = ts?.nearestNode || ts?.nodes?.[0];
      if (!envTsHost && node?.host) {
        typesenseHost = node.host;
        typesenseProtocol = node.protocol || typesenseProtocol;
        typesensePort = node.port || typesensePort;
      }
    } catch {
      // Fall back to the baked-in defaults; the tools still work.
    }
  }

  cachedConfig = { apiGateway, typesenseHost, typesenseProtocol, typesensePort };
  return cachedConfig;
}

// ---------------------------------------------------------------------------
// Typesense scoped key + search.
// ---------------------------------------------------------------------------

export interface ScopedKeyEntry {
  type: string;
  key: string;
  expiresAt?: string;
}
export interface ScopedKeyCollection {
  collection: string;
  apiKeys?: ScopedKeyEntry[];
}

/**
 * Extract the usable search key for a collection from a scoped-search-keys
 * response. Prefers the "accessibility" key (what the SPA uses for the catalog),
 * falling back to the first available key.
 */
export function pickScopedKey(
  payload: unknown,
  collection: string = TYPESENSE_COLLECTION
): string | undefined {
  if (!Array.isArray(payload)) return undefined;
  const col = (payload as ScopedKeyCollection[]).find(
    (c) => c?.collection === collection
  );
  const keys = col?.apiKeys;
  if (!keys?.length) return undefined;
  const preferred = keys.find((k) => k.type === "accessibility") ?? keys[0];
  return preferred?.key;
}

let cachedKey: { key: string; fetchedAt: number } | null = null;
// Scoped keys are short-lived (~24h). Re-fetch hourly to stay well inside that.
const KEY_TTL_MS = 60 * 60 * 1000;

export async function getScopedSearchKey(): Promise<string> {
  if (cachedKey && Date.now() - cachedKey.fetchedAt < KEY_TTL_MS) {
    return cachedKey.key;
  }
  if (!hasCredentials()) throw new MissingCredentialsError();
  const { apiGateway } = await loadRuntimeConfig();
  const url = `${apiGateway}${ENDPOINTS.scopedSearchKeys}`;
  const { data } = await axios.get(url, {
    timeout: REQUEST_TIMEOUT,
    headers: {
      Accept: "application/json",
      "User-Agent": userAgent(),
      ...getAuthHeaders(),
    },
    params: { collections: SCOPED_KEY_COLLECTIONS },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const key = pickScopedKey(data);
  if (!key) {
    throw new Error(
      "Could not obtain a Typesense scoped search key from the gateway " +
        `(${url}). The response shape may have changed.`
    );
  }
  cachedKey = { key, fetchedAt: Date.now() };
  return key;
}

/** Build a Typesense multi_search request body for one collection search. */
export function buildSearchBody(search: Record<string, unknown>): {
  searches: Record<string, unknown>[];
} {
  return { searches: [{ collection: TYPESENSE_COLLECTION, ...search }] };
}

export interface TypesenseHit {
  document: Record<string, unknown>;
}
export interface TypesenseResult {
  found?: number;
  hits?: TypesenseHit[];
  error?: string;
  code?: number;
}

/** Run a Typesense multi_search and return the first result block. */
export async function typesenseSearch(
  search: Record<string, unknown>
): Promise<TypesenseResult> {
  const key = await getScopedSearchKey();
  const { typesenseHost, typesenseProtocol, typesensePort } =
    await loadRuntimeConfig();
  const url = `${typesenseProtocol}://${typesenseHost}:${typesensePort}/multi_search`;
  const { data } = await axios.post<{ results: TypesenseResult[] }>(
    url,
    buildSearchBody(search),
    {
      timeout: REQUEST_TIMEOUT,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent(),
        "x-typesense-api-key": key,
      },
      validateStatus: (s) => s >= 200 && s < 300,
    }
  );
  const result = data?.results?.[0] ?? {};
  if (result.error) {
    throw new Error(`Typesense search failed (${result.code}): ${result.error}`);
  }
  return result;
}

/** Reset cached state (used by tests). */
export function _resetCaches(): void {
  cachedRestClient = null;
  cachedConfig = null;
  cachedKey = null;
}

/**
 * Turn any thrown error into an actionable message string, surfacing the
 * attempted endpoint and HTTP status.
 */
export function handleApiError(error: unknown, attemptedEndpoint?: string): string {
  const where = attemptedEndpoint ? ` (endpoint: ${attemptedEndpoint})` : "";

  if (error instanceof MissingCredentialsError) {
    return `Error: ${error.message}`;
  }

  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError;
    if (ax.response) {
      const status = ax.response.status;
      switch (status) {
        case 401:
          return (
            `Error: Unauthorized (401)${where}. Your session token/cookie is ` +
            `missing, expired, or invalid. Grab a fresh value from your ` +
            `logged-in browser and update OFFSEC_BEARER_TOKEN / OFFSEC_COOKIE.`
          );
        case 403:
          return (
            `Error: Forbidden (403)${where}. Your account may not have access ` +
            `to this lab, or the action isn't permitted on your subscription.`
          );
        case 404:
          return (
            `Error: Not found (404)${where}. The machine/host id may be wrong, ` +
            `or this resource doesn't exist for your account.`
          );
        case 405:
          return `Error: Method not allowed (405)${where}.`;
        case 429:
          return `Error: Rate limited (429)${where}. Wait before retrying.`;
        default: {
          const body =
            typeof ax.response.data === "string"
              ? ax.response.data.slice(0, 300)
              : JSON.stringify(ax.response.data)?.slice(0, 300);
          return `Error: API request failed with status ${status}${where}. Body: ${body}`;
        }
      }
    }
    if (ax.code === "ECONNABORTED") {
      return `Error: Request timed out${where}. Try again.`;
    }
    return `Error: Network error${where}: ${ax.message}`;
  }

  return `Error: Unexpected error${where}: ${
    error instanceof Error ? error.message : String(error)
  }`;
}

export { ENDPOINTS };
