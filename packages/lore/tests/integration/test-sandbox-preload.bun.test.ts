/**
 * AC-TG-2 (bun half): the runner is armed AND so are its children. Under bun a child spawned
 * WITHOUT an explicit `env` inherits the STARTUP environment, not runtime `process.env`
 * mutations, so the marker must come from `packages/lore/.env.test` (verified by
 * scripts/test-isolation-bun-preload.ts). Each spawn form below passes no `env` on purpose.
 */
import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

const REPO = realpathSync(resolve(import.meta.dir, "../../../.."));
const PROBE = ["sh", "-c", 'printf "%s|%s" "$LORE_TEST_SANDBOX" "$LORE_TEST_SANDBOX_REPO"'] as const;

function expectArmed(out: string): void {
  const [marker, repo] = out.split("|");
  expect(marker).toBe("1");
  expect(realpathSync(repo!)).toBe(REPO);
}

test("AC-TG-2 bun runner process has the marker and this checkout recorded", () => {
  expect(process.env["LORE_TEST_SANDBOX"]).toBe("1");
  expect(realpathSync(process.env["LORE_TEST_SANDBOX_REPO"]!)).toBe(REPO);
});

test("AC-TG-2 child via node:child_process.spawnSync with NO explicit env sees the marker", () => {
  expectArmed(spawnSync(PROBE[0], PROBE.slice(1), { encoding: "utf8" }).stdout);
});

test("AC-TG-2 child via node:child_process.execFileSync with NO explicit env sees the marker", () => {
  expectArmed(execFileSync(PROBE[0], PROBE.slice(1), { encoding: "utf8" }));
});

test("AC-TG-2 child via Bun.spawnSync with NO explicit env sees the marker", () => {
  expectArmed(Bun.spawnSync([...PROBE]).stdout.toString());
});
