/**
 * AC-TG-2 (bun half): the `[test] preload` in packages/lore/bunfig.toml runs
 * scripts/test-isolation-setup.ts, so LORE_TEST_SANDBOX and LORE_TEST_SANDBOX_REPO are set
 * inside the bun runner (asserted here, from inside it).
 */
import { expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

test("AC-TG-2 bun preload arms LORE_TEST_SANDBOX and records this checkout", () => {
  expect(process.env["LORE_TEST_SANDBOX"]).toBe("1");
  const repo = resolve(import.meta.dir, "../../../..");
  expect(realpathSync(process.env["LORE_TEST_SANDBOX_REPO"]!)).toBe(realpathSync(repo));
});
