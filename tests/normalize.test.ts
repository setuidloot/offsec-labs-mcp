/**
 * Unit tests for the normalizers, run against REAL portal responses captured
 * under tests/fixtures/ (PII redacted). These prove the MCP correctly parses
 * the actual page/API content of portal.offsec.com.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadFixture } from "./helpers.js";
import {
  buildLabFilter,
  difficultyLabel,
  extractCredentials,
  extractGroups,
  extractObjectives,
  labSlug,
  labsFromResult,
  normalizeActionAck,
  normalizeLabDoc,
  normalizeMachineDetails,
  normalizeProfile,
  normalizeWalkthroughs,
  parseHostId,
  slugify,
} from "../src/services/normalize.js";

type TsFixture = { results: { found?: number; hits?: { document: any }[] }[] };

test("normalizeProfile maps the real profile shape", () => {
  const p = normalizeProfile(loadFixture("profile.json"));
  assert.equal(p.username, "testuser");
  assert.equal(p.firstName, "Test");
  assert.equal(p.lastName, "User");
  assert.equal(p.email, "test.user@example.com");
  assert.equal(p.type, 9);
  assert.equal(p.status, 8);
});

test("normalizeLabDoc maps a real Typesense lab document", () => {
  const fx = loadFixture<TsFixture>("typesense_play_labs.json");
  const doc = fx.results[0].hits![0].document;
  const lab = normalizeLabDoc(doc);
  assert.equal(lab.id, "207264");
  assert.equal(lab.name, "ColdBoxEasy");
  assert.equal(lab.slug, "coldboxeasy-207264");
  assert.equal(lab.os, "Ubuntu");
  assert.equal(lab.osVersion, "16");
  assert.equal(lab.difficulty, 1);
  assert.equal(lab.difficultyLabel, "Easy");
  assert.equal(lab.points, 10);
  assert.ok(lab.groups?.includes("Play"));
  assert.equal(lab.hasWalkthrough, true);
  assert.equal(
    lab.url,
    "https://portal.offsec.com/machine/coldboxeasy-207264/overview/details"
  );
});

test("labsFromResult extracts every hit in the result", () => {
  const fx = loadFixture<TsFixture>("typesense_play_labs.json");
  const labs = labsFromResult(fx.results[0]);
  assert.equal(labs.length, fx.results[0].hits!.length);
  // The captured page reported the true catalog size for the Play group.
  assert.equal(fx.results[0].found, 65);
  for (const l of labs) {
    assert.match(l.id, /^\d+$/);
    assert.ok(l.name.length > 0);
  }
});

test("Kevin resolves to the expected slug and metadata", () => {
  const fx = loadFixture<TsFixture>("typesense_kevin.json");
  const lab = normalizeLabDoc(fx.results[0].hits![0].document);
  assert.equal(lab.name, "Kevin");
  assert.equal(lab.id, "189");
  assert.equal(lab.slug, "kevin-189");
  assert.equal(lab.os, "Windows");
});

test("normalizeWalkthroughs maps the catalog listing", () => {
  const rows = normalizeWalkthroughs(loadFixture("walkthroughs.json"));
  assert.equal(rows.length, 6);
  const first = rows[0];
  assert.equal(first.host, 9);
  assert.equal(first.category, "PLAY");
  assert.equal(first.isUnblocked, false);
  assert.equal(first.content, null);
  assert.equal(
    first.url,
    "https://portal.offsec.com/machine/9/overview/walkthrough"
  );
});

test("normalizeWalkthroughs marks unblocked rows (content present)", () => {
  const rows = normalizeWalkthroughs(loadFixture("walkthroughs_unblocked.json"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].host, 49073);
  assert.equal(rows[0].isUnblocked, true);
  assert.ok((rows[0].content ?? "").length > 0);
});

test("objectives/credentials extraction handles the real shapes", () => {
  // Kevin's objectives come back empty -> undefined.
  assert.equal(extractObjectives(loadFixture("host_objectives.json")), undefined);
  // Kevin's credentials come back as a non-empty 'no credentials' notice.
  const cred = extractCredentials(loadFixture("host_credentials.json"));
  assert.ok(cred && cred.includes("Kevin OS Credentials"));
  // And populated values pass through verbatim.
  assert.equal(extractObjectives({ machine_objectives: "Get root" }), "Get root");
  assert.equal(extractCredentials({ credentials: "user:pass" }), "user:pass");
  assert.equal(extractCredentials({ credentials: "   " }), undefined);
});

test("normalizeMachineDetails merges doc + objectives + credentials", () => {
  const fx = loadFixture<TsFixture>("typesense_kevin.json");
  const doc = fx.results[0].hits![0].document;
  const d = normalizeMachineDetails(doc, "Find the flag", "admin:hunter2", "189");
  assert.equal(d.name, "Kevin");
  assert.equal(d.objectives, "Find the flag");
  assert.equal(d.credentials, "admin:hunter2");
  assert.equal(d.os, "Windows");
});

test("normalizeMachineDetails works with no catalog doc", () => {
  const d = normalizeMachineDetails(undefined, undefined, undefined, "189");
  assert.equal(d.id, "189");
  assert.equal(d.name, "189");
  assert.equal(d.objectives, undefined);
});

test("normalizeActionAck maps the real async-action responses", () => {
  // These fixtures are the actual live responses from start/stop/revert.
  const start = normalizeActionAck(loadFixture("host_instance_start.json"));
  assert.equal(start.message, "Deploy request in progress");
  assert.equal(start.code, undefined);

  const stop = normalizeActionAck(loadFixture("host_instance_stop.json"));
  assert.equal(stop.message, "Stop action in progress");

  const revert = normalizeActionAck(loadFixture("host_instance_revert.json"));
  assert.equal(revert.message, "Revert action in progress");
});

test("normalizeActionAck surfaces error codes (real failure responses)", () => {
  const busy = normalizeActionAck(loadFixture("host_action_in_progress.json"));
  assert.equal(busy.code, "host_action_in_progress");
  assert.equal(busy.message, "Permission denied.");

  const limit = normalizeActionAck(loadFixture("host_concurrent_limit.json"));
  assert.equal(limit.code, "user_has_started_machine");
  assert.match(limit.message ?? "", /maximum concurrent machines/);
});

test("difficultyLabel maps known levels", () => {
  assert.equal(difficultyLabel(1), "Easy");
  assert.equal(difficultyLabel(5), "Insane");
  assert.equal(difficultyLabel(9), "Level 9");
  assert.equal(difficultyLabel(undefined), undefined);
});

test("slugify and labSlug", () => {
  assert.equal(slugify("Empire breakout"), "empire-breakout");
  assert.equal(slugify("  Kevin!! "), "kevin");
  assert.equal(labSlug("Kevin", "189"), "kevin-189");
  assert.equal(labSlug(undefined, "189"), "189");
});

test("extractGroups handles object and string entries", () => {
  assert.deepEqual(
    extractGroups({ labGroups: [{ name: "Play" }, { name: "Practice" }] }),
    ["Play", "Practice"]
  );
  assert.deepEqual(extractGroups({ labGroups: ["X"] }), ["X"]);
  assert.deepEqual(extractGroups({}), []);
});

test("buildLabFilter scopes by group, or all hosts", () => {
  assert.equal(buildLabFilter("Play"), "labType:host && labGroups.name:Play");
  assert.equal(buildLabFilter("all"), "labType:host");
  assert.equal(buildLabFilter(undefined), "labType:host");
});

test("parseHostId accepts numeric ids and slugs, rejects bare names", () => {
  assert.equal(parseHostId("189"), "189");
  assert.equal(parseHostId("kevin-189"), "189");
  assert.equal(parseHostId("empire-breakout-43706"), "43706");
  assert.equal(parseHostId("Kevin"), undefined);
});
