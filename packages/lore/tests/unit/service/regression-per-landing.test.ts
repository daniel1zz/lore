/**
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-1, BR-1496)
 *
 * Regression per landing with a fake suite runner (scripted suite results per commit and per-file exits per commit) and
 * the real SuiteResultService over the in-memory store.
 *
 * Dimensions: HAPPY (a regression is charged to its landing), NEGATIVE (red-before, flaky, a non-landing commit's failure
 * are not charged), BOUNDARY (no failing files, no-change landing, several landings), ERROR (unrunnable landing suite,
 * failing re-run, failing clearing lookup are not-measured, never pass), STATE (cleared against the newest main result;
 * second review reads stored re-runs and runs nothing), REGRESSION (unlanded task is not-measured).
 */

import { describe, expect, it } from "vitest";
import { err, ok, type LoreError, type MilestoneFacts, type Result } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SuiteResultService, type CommitSuiteRunnerPort, type FileRunOutcome } from "../../../src/service/suite-result-service.js";
import type { SuiteRun } from "../../../src/service/milestone-review-inputs.js";
import { factsDimensions } from "../../../src/service/milestone-review-judgment.js";
import {
  regressionPerLanding,
  type RegressionClearingSource,
  type RegressionLandingInput,
  type RegressionPorts,
} from "../../../src/service/regression-per-landing.js";

const sha = (c: string): string => c.repeat(40);
const BEFORE = sha("b");
const LAND = sha("a");
const BEFORE_2 = sha("c");
const LAND_2 = sha("d");
const LATER_MAIN = sha("e");
const FILE = "packages/x/tests/x.test.ts";
const OTHER = "packages/x/tests/other.test.ts";

const landing = (landing_commit: string, main_before: string): RegressionLandingInput => ({
  landing_commit,
  main_before,
  task_slugs: ["task-1"],
});

function suiteRun(commit: string, files: readonly string[]): SuiteRun {
  return {
    status: "measured",
    commit,
    commands: [{ command: "bun run test", exit_code: files.length > 0 ? 1 : 0, output_tail: "" }],
    skipped: [],
    failing_test_files: files.map((file) => ({ file, imports: [] })),
  };
}

interface Script {
  /** Failing files of the full suite per commit; a commit not listed has an unrunnable suite. */
  readonly suites: Record<string, readonly string[]>;
  /** Exit codes of successive runs of `<commit>:<file>`; the last repeats; unlisted = 0. */
  readonly files?: Record<string, readonly number[]>;
  readonly failRunFiles?: boolean;
}

interface Fixture {
  readonly ports: RegressionPorts;
  readonly service: SuiteResultService;
  readonly suiteRuns: string[];
  readonly fileRuns: { commit: string; files: readonly string[] }[];
  setClearing: (source: () => Promise<Result<RegressionClearingSource | null, LoreError>>) => void;
}

function build(script: Script): Fixture {
  const store = new InMemoryStore();
  let n = 0;
  const service = new SuiteResultService({ store, now: () => `2026-10-28T10:00:${String(++n).padStart(2, "0")}.000Z`, newId: () => `suite-rpl-${String(++n)}`, clockMs: () => n * 10 });
  const suiteRuns: string[] = [];
  const fileRuns: { commit: string; files: readonly string[] }[] = [];
  const calls = new Map<string, number>();
  const runner: CommitSuiteRunnerPort = {
    resolveCommit: async (ref) => (ref === "unknown" ? err({ code: "STORE_ERROR", message: "no such commit" }) : ok({ commit: ref, tree: sha("1") })),
    runSuite: async (commit) => {
      suiteRuns.push(commit);
      const failing = script.suites[commit];
      return ok(failing === undefined ? { status: "not_measured" as const, reason: "checkout failed" } : suiteRun(commit, failing));
    },
    runFiles: async (commit, files) => {
      fileRuns.push({ commit, files });
      if (script.failRunFiles === true) return err({ code: "STORE_ERROR", message: "no test:file script" });
      return ok(
        files.map((file): FileRunOutcome => {
          const key = `${commit}:${file}`;
          const seen = calls.get(key) ?? 0;
          calls.set(key, seen + 1);
          const seq = script.files?.[key] ?? [0];
          return { file, exit_code: seq[Math.min(seen, seq.length - 1)] ?? 0, output_tail: `out ${key}`, duration_ms: 1 };
        }),
      );
    },
  };
  let clearing: () => Promise<Result<RegressionClearingSource | null, LoreError>> = async () => ok(null);
  const fixture: Fixture = {
    ports: { suites: service, runner, findClearingSource: () => clearing() },
    service,
    suiteRuns,
    fileRuns,
    setClearing: (source) => {
      clearing = source;
    },
  };
  return fixture;
}

const dimensionOf = (rows: NonNullable<MilestoneFacts["regression"]>) => factsDimensions({ regression: rows }, []).regression;

async function measure(f: Fixture, landings: RegressionLandingInput[], unlanded: string[] = []) {
  const r = await regressionPerLanding(landings, unlanded, f.ports);
  if (!r.ok) throw new Error(`regressionPerLanding failed: ${r.error.code}`);
  return r.value;
}

describe("regression per landing", () => {
  it("AC-AF-1 red at the landing, green at main_before and red on the confirm run is the landing's regression and fails the gate", async () => {
    const f = build({ suites: { [LAND]: [FILE] }, files: { [`${BEFORE}:${FILE}`]: [0], [`${LAND}:${FILE}`]: [1] } });
    const r = await measure(f, [landing(LAND, BEFORE)]);
    expect(r.uncleared).toEqual([{ file: FILE, landing: LAND }]);
    expect(r.rows[0]).toMatchObject({ subject: LAND, verdict: "fail" });
    expect(dimensionOf(r.rows).verdict).toBe("fail");
    expect(f.fileRuns).toEqual([
      { commit: BEFORE, files: [FILE] },
      { commit: LAND, files: [FILE] },
    ]);
  });

  it("AC-AF-1 a file red at both the landing and main_before is red-before: reported, not charged, regression passes", async () => {
    const f = build({ suites: { [LAND]: [FILE] }, files: { [`${BEFORE}:${FILE}`]: [1] } });
    const r = await measure(f, [landing(LAND, BEFORE)]);
    expect(r.uncleared).toEqual([]);
    expect(r.landings[0]).toMatchObject({ status: "measured", red_before: [FILE], regressions: [], flaky: [] });
    expect(r.rows[0]?.detail).toContain("red before the landing");
    expect(dimensionOf(r.rows).verdict).toBe("pass");
    expect(f.fileRuns).toEqual([{ commit: BEFORE, files: [FILE] }]);
  });

  it("AC-AF-1 a file red at the landing but green on the confirm run is flaky: reported, not charged", async () => {
    const f = build({ suites: { [LAND]: [FILE] }, files: { [`${BEFORE}:${FILE}`]: [0], [`${LAND}:${FILE}`]: [0] } });
    const r = await measure(f, [landing(LAND, BEFORE)]);
    expect(r.landings[0]).toMatchObject({ status: "measured", flaky: [FILE], regressions: [] });
    expect(r.rows[0]?.detail).toContain("flaky");
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });

  it("AC-AF-1 a file that turned red at a commit that is not one of the plan's landings is not charged", async () => {
    // reason: the other plan's commit LATER_MAIN breaks OTHER; only the plan's landing suite results are consulted.
    const f = build({ suites: { [LAND]: [], [LATER_MAIN]: [OTHER] } });
    const r = await measure(f, [landing(LAND, BEFORE)]);
    expect(r.uncleared).toEqual([]);
    expect(f.suiteRuns).toEqual([LAND]);
    expect(f.fileRuns).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });

  it("AC-AF-1 a landing whose suite cannot run gives regression not-measured naming the landing, never pass", async () => {
    const f = build({ suites: {} });
    const r = await measure(f, [landing(LAND, BEFORE)]);
    expect(r.rows[0]).toMatchObject({ subject: LAND, verdict: "not-measured" });
    expect(r.rows[0]?.detail).toContain("checkout failed");
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
  });

  it("AC-AF-1 a regression passing in the newest stored main suite result at or after the last landing is cleared with that commit and the gate passes", async () => {
    const f = build({ suites: { [LAND]: [FILE] }, files: { [`${BEFORE}:${FILE}`]: [0], [`${LAND}:${FILE}`]: [1] } });
    const later = await f.service.lookupOrRun(LATER_MAIN, { ...f.ports.runner, runSuite: async () => ok(suiteRun(LATER_MAIN, [])) });
    if (!later.ok) throw new Error("later main result failed");
    f.setClearing(async () => ok({ commit: LATER_MAIN, result: later.value }));
    const r = await measure(f, [landing(LAND, BEFORE)]);
    expect(r.uncleared).toEqual([]);
    expect(r.cleared).toEqual([{ file: FILE, landing: LAND, cleared_by: LATER_MAIN }]);
    expect(r.clearing_result_id).toBe(later.value.id);
    expect(r.rows[0]).toMatchObject({ verdict: "pass" });
    expect(r.rows[0]?.detail).toContain(`cleared by ${LATER_MAIN}`);
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });

  it("AC-AF-1 a regression still red in the newest main result stays uncleared and fails the gate", async () => {
    const f = build({ suites: { [LAND]: [FILE] }, files: { [`${BEFORE}:${FILE}`]: [0], [`${LAND}:${FILE}`]: [1] } });
    const later = await f.service.lookupOrRun(LATER_MAIN, { ...f.ports.runner, runSuite: async () => ok(suiteRun(LATER_MAIN, [FILE])) });
    if (!later.ok) throw new Error("later main result failed");
    f.setClearing(async () => ok({ commit: LATER_MAIN, result: later.value }));
    const r = await measure(f, [landing(LAND, BEFORE)]);
    expect(r.uncleared).toEqual([{ file: FILE, landing: LAND }]);
    expect(r.cleared).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("fail");
  });

  it("AC-AF-1 the re-runs are stored with the landing's suite result and a second review runs nothing", async () => {
    const f = build({ suites: { [LAND]: [FILE] }, files: { [`${BEFORE}:${FILE}`]: [0], [`${LAND}:${FILE}`]: [1] } });
    await measure(f, [landing(LAND, BEFORE)]);
    const stored = await f.service.listResults();
    if (!stored.ok) throw new Error("list failed");
    const rows = await f.service.listFileRuns(stored.value[0]?.id ?? "");
    expect(rows.ok && rows.value.map((x) => [x.commit_sha, x.file, x.exit_code])).toEqual([
      [BEFORE, FILE, 0],
      [LAND, FILE, 1],
    ]);
    const suiteRunsBefore = f.suiteRuns.length;
    const fileRunsBefore = f.fileRuns.length;
    const again = await measure(f, [landing(LAND, BEFORE)]);
    expect(again.uncleared).toEqual([{ file: FILE, landing: LAND }]);
    expect(f.suiteRuns.length).toBe(suiteRunsBefore);
    expect(f.fileRuns.length).toBe(fileRunsBefore);
  });

  it("AC-AF-1 several landings are each measured; a regression is charged to its own landing only", async () => {
    const f = build({
      suites: { [LAND]: [], [LAND_2]: [OTHER] },
      files: { [`${BEFORE_2}:${OTHER}`]: [0], [`${LAND_2}:${OTHER}`]: [1] },
    });
    const r = await measure(f, [landing(LAND, BEFORE), landing(LAND_2, BEFORE_2)]);
    expect(r.uncleared).toEqual([{ file: OTHER, landing: LAND_2 }]);
    expect(r.rows.map((x) => x.verdict)).toEqual(["pass", "fail"]);
  });

  it("AC-AF-1 a landing labelled no-change whose main_before..landing_commit is a real change is measured, never skipped by its label", async () => {
    const f = build({ suites: { [LAND]: [FILE] }, files: { [`${BEFORE}:${FILE}`]: [0], [`${LAND}:${FILE}`]: [1] } });
    const mislabelled = { ...landing(LAND, BEFORE), kind: "no-change" } as RegressionLandingInput;
    const r = await measure(f, [mislabelled]);
    expect(f.suiteRuns).toEqual([LAND]);
    expect(r.uncleared).toEqual([{ file: FILE, landing: LAND }]);
    expect(dimensionOf(r.rows).verdict).toBe("fail");
  });

  it("AC-AF-1 a landing whose main_before equals its landing_commit has nothing to measure, is not run and passes", async () => {
    const f = build({ suites: {} });
    const r = await measure(f, [landing(LAND, LAND)]);
    expect(f.suiteRuns).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });

  it("AC-AF-1 a failing re-run at main_before is not-measured naming the landing, never a charge or a pass", async () => {
    const f = build({ suites: { [LAND]: [FILE] }, failRunFiles: true });
    const r = await measure(f, [landing(LAND, BEFORE)]);
    expect(r.rows[0]).toMatchObject({ subject: LAND, verdict: "not-measured" });
    expect(r.rows[0]?.detail).toContain("main_before");
    expect(r.uncleared).toEqual([]);
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
  });

  it("AC-AF-1 a main_before that does not resolve is not-measured", async () => {
    const f = build({ suites: { [LAND]: [FILE] } });
    const r = await measure(f, [landing(LAND, "unknown")]);
    expect(r.rows[0]).toMatchObject({ verdict: "not-measured" });
  });

  it("AC-AF-1 an unlanded task makes regression not-measured even when every landing is clean", async () => {
    const f = build({ suites: { [LAND]: [] } });
    const r = await measure(f, [landing(LAND, BEFORE)], ["task-2"]);
    expect(r.rows.at(-1)).toMatchObject({ subject: "unlanded:task-2", verdict: "not-measured" });
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
  });

  it("AC-AF-1 a clearing lookup that fails is not-measured, never a silent charge or clear", async () => {
    const f = build({ suites: { [LAND]: [FILE] }, files: { [`${BEFORE}:${FILE}`]: [0], [`${LAND}:${FILE}`]: [1] } });
    f.setClearing(async () => err({ code: "STORE_ERROR", message: "landing not on main" }));
    const r = await measure(f, [landing(LAND, BEFORE)]);
    expect(r.rows.at(-1)).toMatchObject({ subject: "clearing", verdict: "not-measured" });
    // the landing's own row still fails: the regression is charged while it cannot be shown cleared
    expect(dimensionOf(r.rows).verdict).toBe("fail");
  });

  it("AC-AF-1 no landings and no unlanded tasks is refused, not a pass", async () => {
    const f = build({ suites: {} });
    const r = await regressionPerLanding([], [], f.ports);
    expect(r.ok).toBe(false);
  });
});
