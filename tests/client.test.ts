/**
 * Unit tests for client helpers: scoped-key extraction (against a real scoped
 * key response shape), path building, search-body construction, and error
 * mapping. No network is performed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import axios from "axios";

import { loadFixture } from "./helpers.js";
import {
  buildPath,
  buildSearchBody,
  handleApiError,
  MissingCredentialsError,
  pickScopedKey,
} from "../src/services/client.js";

test("pickScopedKey pulls the accessibility key from a real response", () => {
  const fx = loadFixture("scoped_search_keys.json");
  const key = pickScopedKey(fx, "all-content");
  assert.equal(key, "SCOPED_KEY_REDACTED"); // redacted in fixture; shape preserved
});

test("pickScopedKey returns undefined for an unknown collection", () => {
  const fx = loadFixture("scoped_search_keys.json");
  assert.equal(pickScopedKey(fx, "does-not-exist"), undefined);
  assert.equal(pickScopedKey({}, "all-content"), undefined);
});

test("buildPath substitutes templated params", () => {
  assert.equal(
    buildPath("/api/host-details/{id}/objectives", { id: "189" }),
    "/api/host-details/189/objectives"
  );
  assert.equal(
    buildPath("/api/host-instances/{instanceId}/", { instanceId: "ab-1" }),
    "/api/host-instances/ab-1/"
  );
});

test("buildPath throws on a missing param", () => {
  assert.throws(() => buildPath("/x/{id}", {}), /Missing path parameter 'id'/);
});

test("buildSearchBody wraps the search in a multi_search envelope", () => {
  const body = buildSearchBody({ q: "*", per_page: 5 });
  assert.equal(body.searches.length, 1);
  assert.equal(body.searches[0].collection, "all-content");
  assert.equal(body.searches[0].q, "*");
  assert.equal(body.searches[0].per_page, 5);
});

test("handleApiError maps HTTP statuses to actionable messages", () => {
  const mk = (status: number) =>
    new axios.AxiosError(
      "boom",
      "ERR_BAD_RESPONSE",
      undefined,
      undefined,
      { status, data: {}, statusText: "", headers: {}, config: {} as any }
    );
  assert.match(handleApiError(mk(401), "/api/x"), /Unauthorized \(401\)/);
  assert.match(handleApiError(mk(403), "/api/x"), /Forbidden \(403\)/);
  assert.match(handleApiError(mk(404), "/api/x"), /Not found \(404\)/);
  assert.match(handleApiError(mk(429), "/api/x"), /Rate limited \(429\)/);
  // endpoint is surfaced for debugging
  assert.match(handleApiError(mk(401), "/api/x"), /endpoint: \/api\/x/);
  // the walkthrough "1 per day" cap gets a clear, actionable message (not a raw 400 body)
  const dayLimit = new axios.AxiosError("boom", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 400, statusText: "", headers: {}, config: {} as any,
    data: { code: "multiple", errors: { walkthrough: [{ code: "invalid_too_many_per_day" }] } },
  });
  assert.match(handleApiError(dayLimit, "/api/walkthroughs/unblocked"), /ONE walkthrough per day/);
});

test("handleApiError surfaces missing credentials", () => {
  const msg = handleApiError(new MissingCredentialsError());
  assert.match(msg, /No OffSec credentials configured/);
});
