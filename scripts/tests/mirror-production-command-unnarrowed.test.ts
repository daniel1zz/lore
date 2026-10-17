// @reads package.json
/**
 * AC-MOS-5 — `spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by`,
 * `task-a-real-argv-parser-for-export-spec-mirror-unknown-flags`.
 *
 * Pins `package.json`'s `check:spec-mirror` to the UNNARROWED
 * `bun scripts/export-spec-mirror.ts --check`.
 *
 * ## ⛔ This criterion is VACUOUSLY GREEN, and saying so is part of it
 *
 * Measured 2026-08-25, BEFORE any work on the task that introduces `--type`: the script value in
 * `package.json` was already byte-identical to the expected string, so this suite passed on
 * arrival. It is therefore a REGRESSION GUARD over the narrowing that task introduces — ⛔ not
 * work delivered, and ⛔ its pass MUST NOT be banked as coverage of AC-MOS-3 (the argv parser) or
 * AC-MOS-4 (`--type`'s behaviour), which are proven by their own suites against real invocations.
 *
 * What it does protect is real: `check:spec-mirror` is the link `bun run test` invokes, so if the
 * narrowed variant ever became what the chain runs, every other type's drift behaviour would be
 * exercised by nothing at all — the exact shape of
 * `knowledge-an-attested-pass-is-not-evidence-of-production-wiring`.
 *
 * ## Why fixed-string EQUALITY and never containment
 *
 * Containment stays true after someone appends `--type spec` — the very mutation this guard
 * exists to catch. The BOUNDARY case below runs that mutation through both comparison forms in
 * memory and shows containment accepting what equality rejects, so the choice of matcher is itself
 * falsifiable rather than asserted in prose.
 *
 * Coverage: HAPPY (the script value equals the unnarrowed invocation) / BOUNDARY (a `--type
 * spec`-appended variant fails equality while passing containment — the guard's discriminating
 * power, measured, not claimed) / ERROR (the read is loud: a missing `scripts` map or a missing
 * `check:spec-mirror` key fails by name rather than comparing `undefined`).
 *
 * Side-effect class: pure read — parses this repo's `package.json` and asserts on strings. Spawns
 * nothing, writes nothing.
 *
 * @spec_ref spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by AC-MOS-5
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

/** The script name `bun run test`'s chain reaches — the one whose narrowing would go unnoticed. */
const SCRIPT_NAME = "check:spec-mirror";

/** The exact, UNNARROWED invocation. ⛔ No `--type`, no narrowing of any kind. */
const UNNARROWED_INVOCATION = "bun scripts/export-spec-mirror.ts --check";

/** Reads `scripts["check:spec-mirror"]`, failing by name rather than yielding `undefined` into a comparison. */
function readCheckMirrorScript(): string {
  const raw = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
  const scripts = parsed.scripts;
  if (scripts === undefined) {
    throw new Error("package.json declares no `scripts` map");
  }
  const value = scripts[SCRIPT_NAME];
  if (typeof value !== "string") {
    throw new Error(`package.json has no string script named '${SCRIPT_NAME}' (got ${JSON.stringify(value)})`);
  }
  return value;
}

describe("the chain-wired mirror command is never narrowed", () => {
  it(`AC-MOS-5: package.json's ${SCRIPT_NAME} is byte-identical to the unnarrowed invocation`, () => {
    expect(readCheckMirrorScript()).toBe(UNNARROWED_INVOCATION);
  });

  it("BOUNDARY: equality rejects a `--type spec`-appended value that containment would accept", () => {
    const narrowed = `${UNNARROWED_INVOCATION} --type spec`;
    // Containment — the matcher this criterion deliberately does NOT use — is satisfied by the
    // narrowed value, which is why the assertion above is an equality.
    expect(narrowed).toContain(UNNARROWED_INVOCATION);
    expect(narrowed).not.toBe(UNNARROWED_INVOCATION);
  });
});
