/**
 * TypeScript type definitions for the OffSec MCP server.
 *
 * These interfaces describe the SHAPES actually returned by the live portal
 * (mapped via a logged-in session). The normalization helpers in
 * services/normalize.ts map the raw JSON into these.
 */

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json",
}

/** Authenticated user profile (GET /api/users/current/profile). */
export interface Profile {
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  type?: number;
  status?: number;
}

/** A lab/machine as it appears in the Typesense catalog. */
export interface LabSummary {
  /** Numeric host/content id (e.g. "189"). Use this with the host-* endpoints. */
  id: string;
  /** Display name (e.g. "Kevin"). */
  name: string;
  /** Portal-style slug "name-id" (e.g. "kevin-189"). */
  slug: string;
  os?: string;
  osVersion?: string;
  /** Numeric difficulty as returned (1=easy … higher=harder). */
  difficulty?: number;
  difficultyLabel?: string;
  points?: number;
  /** Lab groups this machine belongs to (e.g. ["Play","Practice"]). */
  groups?: string[];
  releaseDate?: string;
  hasWalkthrough?: boolean;
  url?: string;
}

/** Full metadata for a single machine (catalog doc + objectives + credentials). */
export interface MachineDetails extends LabSummary {
  description?: string;
  objectives?: string;
  credentials?: string;
  authors?: string[];
  duration?: number;
}

/** One walkthrough row (GET /api/walkthroughs/ and .../unblocked). */
export interface Walkthrough {
  id: number;
  name: string;
  /** Numeric host id this walkthrough belongs to. */
  host: number;
  content: string | null;
  isUnblocked: boolean;
  category?: string; // top_level_learning_unit_code, e.g. "PLAY" | "PRACTICE"
  url?: string;
}

/**
 * Result of a start/stop/revert action. These endpoints are asynchronous: they
 * return only an acknowledgement message (the deploy/stop/revert proceeds in the
 * background). The resulting instance id and IP are NOT returned here — the
 * portal delivers them over its cookie-authenticated WebSocket, so a bearer-only
 * client cannot read them. See README "Instance ids & the WebSocket limitation".
 */
export interface ActionAck {
  message?: string;
  code?: string;
  raw?: unknown;
}

/** The Typesense node config from /config.json. */
export interface TypesenseNode {
  host: string;
  port: string;
  protocol: string;
}
