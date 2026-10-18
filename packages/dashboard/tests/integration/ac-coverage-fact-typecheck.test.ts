// @reads packages/core/src/acceptance.ts
/**
 * TG-52: the real-tsc oracle for the second half of AC-FALS-22 (spec-oracle-tier-falsifiability-
 * a-criterion-never-observed-red): "running the project over a fixture whose AcCoverageFact omits
 * `falsified` terminates with a nonzero status carrying an error that names `falsified`".
 *
 * TG-50 moved the unit-lane assertion of AC-FALS-22 to in-process tsconfig resolution because a
 * unit test must not spawn tsc three times. That left this half with no oracle, since it needs a
 * REAL type-check. This integration test spawns the TypeScript compiler exactly ONCE, on a
 * minimal throwaway project (mkdtemp dir: a tsconfig plus one fixture file). The fixture imports
 * the real `AcCoverageFact` from packages/core/src/acceptance.ts through a `paths` mapping, so a
 * future change that makes `falsified` optional makes this test fail.
 *
 * Verdict comes from the child's exit status (a null status, i.e. a killed or unspawnable tsc,
 * throws instead of reading as "nonzero"), and from the compiler's own diagnostic text.
 *
 * Six-dimension coverage: HAPPY/NEGATIVE are the single assertion pair (nonzero + names
 * `falsified`); ERROR: a spawn failure or signal death throws; STATE: the temp dir is removed in
 * `finally`; BOUNDARY/REGRESSION: the fixture sets every OTHER required field, so the only
 * possible TS2741 is the missing `falsified`.
 *
 * @spec_ref spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, "..", "..", "..", "..");
const ACCEPTANCE_SRC = join(REPO_ROOT, "packages", "core", "src", "acceptance.ts");
const TSC_JS = createRequire(import.meta.url).resolve("typescript/bin/tsc");

/** Every required AcCoverageFact field EXCEPT `falsified` — the fixture's only defect. */
const FIXTURE = [
  'import type { AcCoverageFact } from "@lore/core";',
  "export const broken: AcCoverageFact = {",
  '  ac_id: "AC-PROBE",',
  '  mode: "script",',
  "  pass: 1,",
  "  fail: 0,",
  "  refs: [],",
  "  attested_pass: 0,",
  "  attested_fail: 0,",
  "};",
  "",
].join("\n");

/** One tsc spawn; returns exit status and merged output. Throws when the child has no exit status. */
function typecheckFixture(): { status: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), "tg52-fixture-"));
  try {
    writeFileSync(join(dir, "fixture.ts"), FIXTURE, "utf8");
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          skipLibCheck: true,
          types: [],
          paths: { "@lore/core": [ACCEPTANCE_SRC] },
        },
        files: ["fixture.ts"],
      }),
      "utf8",
    );
    const run = spawnSync("node", [TSC_JS, "-p", join(dir, "tsconfig.json")], { encoding: "utf8" });
    if (run.error) throw run.error;
    if (run.status === null) throw new Error(`tsc ended without an exit status (signal ${String(run.signal)})`);
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("TG-52 AcCoverageFact requires falsified under a real type-check", () => {
  it("TG-52 a fixture AcCoverageFact omitting falsified exits nonzero and the diagnostic names falsified", () => {
    const checked = typecheckFixture();
    expect(checked.status).not.toBe(0);
    expect(checked.output).toContain("falsified");
  }, 120_000);
});
