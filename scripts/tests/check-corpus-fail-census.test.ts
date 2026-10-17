// @spawns packages/lore/src/index.ts
/**
 * AC-OX-11 (spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a): the corpus fail
 * census reports how many live script acceptance criteria are in coverage state `fail`,
 * naming each, and reads that state from `lore ac list --json` (the single
 * `deriveAcCoverageState` derivation) - it holds no precedence logic of its own.
 *
 * Six-dimension coverage:
 *   HAPPY:      no criterion in state fail -> exit 0, count 0
 *   NEGATIVE:   one criterion in state fail -> exit 1, named by spec and AC id (the RED of the AC)
 *   BOUNDARY:   fail_superseded and not_measured are not `fail`; deprecated specs are skipped and counted
 *   ERROR:      zero script ACs visible -> exit 1 (never a clean 0 over nothing, AS-17); a malformed lister output throws
 *   STATE:      only script-mode criteria count; human/ai criteria in state fail are not part of the script census
 *   REGRESSION: end to end against a throwaway corpus (mkdtemp + lore init), exact exit codes
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectFailCensus, runCensus, type CensusJsonRunner } from "../check-corpus-fail-census.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const CHECKER = join(REPO_ROOT, "scripts", "check-corpus-fail-census.ts");

interface FixtureAc {
  readonly id: string;
  readonly mode: string;
  readonly state: string;
}

/** A fake `lore list` / `lore ac list` pair: `specs[slug] = {status, acs}`. */
function fakeRunner(specs: Record<string, { status: string; acs: readonly FixtureAc[] }>): CensusJsonRunner {
  return ((args: readonly string[]) => {
    if (args[0] === "list") {
      return { ok: true, data: { docs: Object.entries(specs).map(([slug, s]) => ({ slug, status: s.status })) } };
    }
    const spec = specs[args[2] as string];
    if (spec === undefined) throw new Error(`fixture: unknown spec ${args[2]}`);
    return {
      ok: true,
      data: {
        criteria: spec.acs.map((a) => ({ id: a.id, verify: { mode: a.mode } })),
        coverage: spec.acs.map((a) => ({ ac_id: a.id, mode: a.mode, state: a.state })),
      },
    };
  }) as unknown as CensusJsonRunner;
}

describe("check-corpus-fail-census - AC-OX-11 pure census", () => {
  it("HAPPY: no criterion in state fail -> zero offenders", () => {
    const r = collectFailCensus(
      fakeRunner({ "spec-a": { status: "approved", acs: [{ id: "AC-A-1", mode: "script", state: "attested_pass" }] } }),
    );
    expect(r.offenders).toEqual([]);
    expect(r.scannedScriptAcs).toBe(1);
  });

  it("NEGATIVE (RED): a criterion in state fail is reported, named by spec and AC id", () => {
    const r = collectFailCensus(
      fakeRunner({
        "spec-a": {
          status: "approved",
          acs: [
            { id: "AC-A-1", mode: "script", state: "fail" },
            { id: "AC-A-2", mode: "script", state: "attested_pass" },
          ],
        },
      }),
    );
    expect(r.offenders).toEqual([{ spec: "spec-a", acId: "AC-A-1" }]);
  });

  it("BOUNDARY: fail_superseded and not_measured are not state fail", () => {
    const r = collectFailCensus(
      fakeRunner({
        "spec-a": {
          status: "approved",
          acs: [
            { id: "AC-A-1", mode: "script", state: "fail_superseded" },
            { id: "AC-A-2", mode: "script", state: "not_measured" },
          ],
        },
      }),
    );
    expect(r.offenders).toEqual([]);
  });

  it("BOUNDARY: a deprecated spec is skipped, counted and named, even holding a fail", () => {
    const r = collectFailCensus(
      fakeRunner({
        "spec-live": { status: "approved", acs: [{ id: "AC-L-1", mode: "script", state: "attested_pass" }] },
        "spec-dead": { status: "deprecated", acs: [{ id: "AC-D-1", mode: "script", state: "fail" }] },
      }),
    );
    expect(r.offenders).toEqual([]);
    expect(r.skippedDeprecatedSpecs).toEqual(["spec-dead"]);
  });

  it("STATE: only script-mode criteria are in the census", () => {
    const r = collectFailCensus(
      fakeRunner({ "spec-a": { status: "approved", acs: [{ id: "AC-A-1", mode: "human", state: "fail" }] } }),
    );
    expect(r.offenders).toEqual([]);
    expect(r.scannedScriptAcs).toBe(0);
  });

  it("ERROR: an unexpected lister shape throws instead of reading as zero offenders", () => {
    const bad = (() => ({ ok: true, data: {} })) as unknown as CensusJsonRunner;
    expect(() => collectFailCensus(bad)).toThrow();
  });
});

describe("check-corpus-fail-census - AC-OX-11 report and exit code", () => {
  it("NEGATIVE: runCensus exits 1 and prints the count and each offender", () => {
    const lines: string[] = [];
    const code = runCensus(
      fakeRunner({ "spec-a": { status: "approved", acs: [{ id: "AC-A-1", mode: "script", state: "fail" }] } }),
      (l) => lines.push(l),
    );
    expect(code).toBe(1);
    const out = lines.join("\n");
    expect(out).toContain("1 in state fail");
    expect(out).toContain("spec=spec-a");
    expect(out).toContain("ac=AC-A-1");
  });

  it("HAPPY: runCensus exits 0 and prints 0 in state fail", () => {
    const lines: string[] = [];
    const code = runCensus(
      fakeRunner({ "spec-a": { status: "approved", acs: [{ id: "AC-A-1", mode: "script", state: "attested_pass" }] } }),
      (l) => lines.push(l),
    );
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("0 in state fail");
  });

  it("ERROR (AS-17): zero script ACs visible exits 1 with nothing-scanned, never a clean 0", () => {
    const lines: string[] = [];
    const code = runCensus(fakeRunner({ "spec-a": { status: "approved", acs: [] } }), (l) => lines.push(l));
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("nothing-scanned");
  });
});

describe("check-corpus-fail-census - AC-OX-11 end to end (mkdtemp + lore init)", () => {
  function lore(args: string[], cwd: string): { status: number; stdout: string; stderr: string } {
    const r = spawnSync("bun", ["run", LORE_ENTRY, ...args], { cwd, encoding: "utf8", env: { ...process.env, CLAUDECODE: "1" } });
    return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  }

  it("REGRESSION: a throwaway corpus with one script AC and no evidence exits 0 with 0 in state fail; an empty corpus exits 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "lore-fail-census-"));
    try {
      expect(lore(["init", "--json"], dir).status).toBe(0);
      const run = (): { status: number; out: string } => {
        const driverPath = join(dir, "driver.mts");
        writeFileSync(
          driverPath,
          `import { main } from ${JSON.stringify(CHECKER)}; process.exit(main(${JSON.stringify(dir)}, ${JSON.stringify(LORE_ENTRY)}));`,
          "utf8",
        );
        const r = spawnSync("bun", [driverPath], { cwd: dir, encoding: "utf8", env: { ...process.env, CLAUDECODE: "1" } });
        return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` };
      };
      const empty = run();
      expect(empty.status).toBe(1);
      expect(empty.out).toContain("nothing-scanned");

      const body = "## Overview/Goal\n\nF.\n\n## Scope\n\nF.\n\n## Acceptance Criteria\n\nSee ac list.\n";
      const created = lore(["create", "spec", "--title", "Census fixture", "--content", body, "--json"], dir);
      const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
      const added = lore(
        ["ac", "add", slug, "AC-CF-1", "--statement", "Fixture exits 0", "--mode", "script", "--oracle", "test", "--command", "bunx vitest run x.test.ts", "--allow-missing-path", "fixture: absent", "--json"],
        dir,
      );
      expect(added.status).toBe(0);
      const ok = run();
      expect(ok.out).toContain("0 in state fail");
      expect(ok.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90000);
});
