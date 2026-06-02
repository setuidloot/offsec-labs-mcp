/**
 * Test helpers: load the captured real-portal fixtures.
 *
 * The fixtures under tests/fixtures/ are REAL responses captured from
 * portal.offsec.com with a logged-in token (PII redacted). They are the
 * ground truth the normalizers are tested against.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(process.cwd(), "tests", "fixtures");

export function loadFixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;
}
