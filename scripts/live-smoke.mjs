/**
 * Live smoke test against the REAL portal.offsec.com, using OFFSEC_BEARER_TOKEN
 * from the environment. Exercises only READ-ONLY tools (no machine start/stop).
 * Run: node --env-file=.env scripts/live-smoke.mjs
 */
import {
  callEndpoint,
  ENDPOINTS,
  typesenseSearch,
} from "../dist/services/client.js";
import {
  buildLabFilter,
  extractCredentials,
  extractObjectives,
  labsFromResult,
  normalizeMachineDetails,
  normalizeProfile,
  normalizeWalkthroughs,
} from "../dist/services/normalize.js";

const ok = (m) => console.log(`  ✓ ${m}`);

console.log("1. offsec_whoami");
const profile = normalizeProfile(await callEndpoint(ENDPOINTS.profile));
if (!profile.username) throw new Error("no username");
ok(`authenticated as ${profile.username}`);

console.log("2. offsec_list_labs (Play)");
const res = await typesenseSearch({
  q: "*",
  query_by: "code,name,longName,description",
  filter_by: buildLabFilter("Play"),
  per_page: 5,
  page: 1,
});
const labs = labsFromResult(res);
if (!labs.length) throw new Error("no labs");
ok(`${res.found} Play labs; first = ${labs[0].name} (${labs[0].slug})`);

console.log("3. offsec_get_machine_details (Kevin / 189)");
const kev = await typesenseSearch({
  q: "*",
  query_by: "name",
  filter_by: "labType:host && contentId:=189",
  per_page: 1,
});
const doc = kev.hits?.[0]?.document;
const objectives = extractObjectives(
  await callEndpoint(ENDPOINTS.hostObjectives, { pathParams: { id: "189" } })
);
const credentials = extractCredentials(
  await callEndpoint(ENDPOINTS.hostCredentials, { pathParams: { id: "189" } })
);
const details = normalizeMachineDetails(doc, objectives, credentials, "189");
if (details.name !== "Kevin") throw new Error(`expected Kevin, got ${details.name}`);
ok(`${details.name}: ${details.os}, ${details.difficultyLabel}, ${details.points} pts`);

console.log("4. offsec_list_walkthroughs");
const wts = normalizeWalkthroughs(await callEndpoint(ENDPOINTS.walkthroughs));
const play = wts.filter((w) => w.category === "PLAY");
ok(`${wts.length} walkthroughs (${play.length} PLAY)`);

console.log("5. offsec_get_walkthrough (unblocked)");
const unblocked = normalizeWalkthroughs(
  await callEndpoint(ENDPOINTS.walkthroughsUnblocked)
);
ok(`${unblocked.length} unblocked walkthrough(s) available`);

console.log("\nALL READ-ONLY TOOLS OK ✅");
