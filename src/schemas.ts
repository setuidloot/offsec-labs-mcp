import { z } from "zod";
import { ResponseFormat } from "./types.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PG_PLAY_GROUP } from "./constants.js";

const responseFormat = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe(
    "Output format: 'markdown' for human-readable (default) or 'json' for machine-readable structured data."
  );

const machineId = z
  .string()
  .min(1, "Machine id/slug is required")
  .max(200)
  .describe(
    "The machine's numeric host id (e.g. '189'), its portal slug (e.g. " +
      "'kevin-189'), or its name (e.g. 'Kevin'). Numeric id is most reliable."
  );

const instanceId = z
  .string()
  .min(1, "Instance id is required")
  .max(200)
  .describe(
    "The running instance id returned by offsec_start_machine (NOT the machine id)."
  );

export const WhoAmISchema = z
  .object({ response_format: responseFormat })
  .strict();

export const ListLabsSchema = z
  .object({
    group: z
      .string()
      .max(100)
      .default(PG_PLAY_GROUP)
      .describe(
        "Lab group to list. 'Play' (PG Play, the default), 'Practice', " +
          "'Offensive Cyber Range', or 'all' for every host-backed lab."
      ),
    search: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Optional full-text query (matched against code, name, longName, description)."
      ),
    os: z
      .string()
      .max(100)
      .optional()
      .describe("Optional case-insensitive substring filter on the machine OS."),
    difficulty: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Optional exact difficulty filter (1=Easy … 5=Insane)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE)
      .describe(`Maximum labs to return (1-${MAX_PAGE_SIZE}).`),
    offset: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe("Number of labs to skip for pagination."),
    response_format: responseFormat,
  })
  .strict();

export const MachineIdSchema = z
  .object({ machine_id: machineId, response_format: responseFormat })
  .strict();

const walkthroughId = z
  .number()
  .int()
  .positive()
  .describe(
    "The walkthrough's OWN id (e.g. 563) — a different number from the machine/" +
      "host id (e.g. 559). Normally resolved automatically from machine_id; pass " +
      "it only to override that lookup."
  );

export const GetWalkthroughSchema = z
  .object({
    machine_id: machineId,
    unblock: z
      .boolean()
      .default(false)
      .describe(
        "If true and the walkthrough is still locked, unblock it first — the same " +
          "action the portal's walkthrough 'Unlock'/'Unblock' button performs — " +
          "then return its content. This MUTATES your account (it unlocks the " +
          "walkthrough); leave false (default) to only read an already-unblocked one."
      ),
    response_format: responseFormat,
  })
  .strict();

export const UnblockWalkthroughSchema = z
  .object({
    machine_id: machineId
      .optional()
      .describe(
        "The machine whose walkthrough to unblock (host id, slug, or name). Its " +
          "walkthrough id is resolved automatically. Provide this OR walkthrough_id."
      ),
    walkthrough_id: walkthroughId.optional(),
    response_format: responseFormat,
  })
  .strict();

export const ListWalkthroughsSchema = z
  .object({
    category: z
      .string()
      .max(100)
      .optional()
      .describe(
        "Optional category filter, e.g. 'PLAY' or 'PRACTICE' " +
          "(matches top_level_learning_unit_code)."
      ),
    search: z
      .string()
      .max(200)
      .optional()
      .describe("Optional case-insensitive substring filter on walkthrough name."),
    unblocked_only: z
      .boolean()
      .default(false)
      .describe("If true, only return walkthroughs you've unblocked (with content)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE)
      .describe(`Maximum walkthroughs to return (1-${MAX_PAGE_SIZE}).`),
    offset: z.number().int().min(0).default(0).describe("Results to skip."),
    response_format: responseFormat,
  })
  .strict();

export const StartMachineSchema = z
  .object({ machine_id: machineId, response_format: responseFormat })
  .strict();

export const InstanceActionSchema = z
  .object({
    instance_id: instanceId
      .optional()
      .describe(
        "The running instance id. OPTIONAL: if omitted, the server discovers " +
          "the running instance over the WebSocket (filtered by machine_id if " +
          "given; OffSec allows only one concurrent machine, so omitting both " +
          "targets the single running instance)."
      ),
    machine_id: z
      .string()
      .max(200)
      .optional()
      .describe(
        "The machine's numeric host id (e.g. '189'), slug ('kevin-189'), or name " +
          "('Kevin'). Used to auto-discover the instance id and as " +
          "context_learning_unit_id in the request."
      ),
    response_format: responseFormat,
  })
  .strict();

export const ListRunningLabsSchema = z
  .object({ response_format: responseFormat })
  .strict();
