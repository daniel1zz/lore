/**
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-2, BR-1497)
 *
 * The full suite runs once per assessed commit: assessing two plans at the same head runs it once, no suite runs at a
 * landing commit, and an incomplete run is stored unrunnable and retried by the next review.
 *
 * Dimensions: HAPPY (two plans, one run), NEGATIVE (no landing commit is ever run), BOUNDARY (five landings, green head),
 * ERROR (an unrunnable head is not-measured and retried), STATE (stored result answers the next review),
 * REGRESSION (the per-landing scheduler would record one run per landing and fail the head-only assertion).
 */

import { describe, expect, it } from "vitest";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { SuiteResultService, type CommitSuiteRunnerPort } from "../../../src/service/suite-result-service.js";
import type { SuiteRun } from "../../../src/service/milestone-review-inputs.js";
import { regressionAtHead, type RegressionAtHeadPorts, type RegressionLandingInput } from "../../../src/service/regression-at-head.js";

const sha = (index: number): string => index.toString(16).padStart(40, "0");
const HEAD_INDEX = 11;
const landingAt = (index: number): RegressionLandingInput => ({ landing_commit: sha(index), main_before: sha(index - 1), task_slugs: [`task-${String(index)}`] });

interface Fixture {
  readonly ports: RegressionAtHeadPorts;
  readonly service: SuiteResultService;
  readonly suiteRuns: string[];
  readonly fileRuns: string[];
  /** Makes the next suite runs fail to complete (`false` restores them). */
  setUnrunnable: (value: boolean) => void;
}

function build(failing: readonly string[] = []): Fixture {
  const store = new InMemoryStore();
  let n = 0;
  const service = new SuiteResultService({ store, now: () => `2026-10-29T11:00:00.${String(++n).padStart(3, "0")}Z`, newId: () => `suite-once-${String(++n)}`, clockMs: () => n * 10 });
  const suiteRuns: string[] = [];
  const fileRuns: string[] = [];
  let unrunnable = false;
  const runner: CommitSuiteRunnerPort = {
    resolveCommit: async (ref) => ok({ commit: ref === "main" ? sha(HEAD_INDEX) : ref, tree: sha(0) }),
    runSuite: async (commit): Promise<Result<SuiteRun, LoreError>> => {
      suiteRuns.push(commit);
      if (unrunnable) return err({ code: "STORE_ERROR", message: "worktree could not be created" });
      return ok({ status: "measured", commit, commands: [], skipped: [], failing_test_files: failing.map((file) => ({ file, imports: [] })) });
    },
    runFiles: async (commit, files) => {
      for (const file of files) fileRuns.push(`${commit}:${file}`);
      return ok(files.map((file) => ({ file, exit_code: 1, output_tail: "", duration_ms: 1 })));
    },
  };
  const ports: RegressionAtHeadPorts = {
    suites: service,
    runner,
    headRef: "main",
    firstParentHistory: async (ref) => ok(Array.from({ length: Number.parseInt(ref === "main" ? sha(HEAD_INDEX) : ref, 16) + 1 }, (_, i) => sha(i))),
    fileExistsAt: async () => ok(true),
    firstParentCommitContaining: async () => ok(undefined),
  };
  return { ports, service, suiteRuns, fileRuns, setUnrunnable: (value) => { unrunnable = value; } };
}

describe("one full suite per assessed commit", () => {
  it("AC-AO-2 assessing two plans at the same head runs the full suite once", async () => {
    const f = build();
    const first = await regressionAtHead([landingAt(2), landingAt(4)], [], f.ports);
    const second = await regressionAtHead([landingAt(7)], [], f.ports);
    expect(first.ok && second.ok).toBe(true);
    expect(f.suiteRuns).toEqual([sha(HEAD_INDEX)]);
  });

  it("AC-AO-2 no suite runs at any landing commit: the runner records only the head, even with five landings", async () => {
    const f = build();
    await regressionAtHead([2, 3, 5, 7, 9].map(landingAt), [], f.ports);
    expect(f.suiteRuns).toEqual([sha(HEAD_INDEX)]);
    expect(f.suiteRuns.filter((commit) => [2, 3, 5, 7, 9].map(sha).includes(commit))).toEqual([]);
    expect(f.fileRuns).toEqual([]);
  });

  it("AC-AO-2 a red head still costs one suite run; the red file is examined by single-file runs only", async () => {
    const f = build(["packages/x/tests/x.test.ts"]);
    await regressionAtHead([landingAt(3), landingAt(8)], [], f.ports);
    expect(f.suiteRuns).toEqual([sha(HEAD_INDEX)]);
    expect(f.fileRuns.length).toBeGreaterThan(0);
  });

  it("AC-AO-2 an incomplete run is stored unrunnable with its cause and the next review runs the suite again as a new attempt", async () => {
    const f = build();
    f.setUnrunnable(true);
    const broken = await regressionAtHead([landingAt(4)], [], f.ports);
    expect(broken.ok && broken.value.rows[0]?.verdict).toBe("not-measured");
    const stored = await f.service.listResults();
    expect(stored.ok && stored.value.map((r) => [r.status, r.attempt])).toEqual([["unrunnable", 1]]);
    f.setUnrunnable(false);
    const retried = await regressionAtHead([landingAt(4)], [], f.ports);
    expect(retried.ok && retried.value.rows[0]?.verdict).toBe("pass");
    expect(f.suiteRuns).toEqual([sha(HEAD_INDEX), sha(HEAD_INDEX)]);
    const after = await f.service.listResults();
    expect(after.ok && after.value.map((r) => [r.status, r.attempt])).toEqual([["unrunnable", 1], ["measured", 2]]);
  });

  it("AC-AO-2 a measured result is never re-run: a later review at the same head reads the store", async () => {
    const f = build();
    await regressionAtHead([landingAt(4)], [], f.ports);
    await regressionAtHead([landingAt(4)], [], f.ports);
    await f.service.lookupOrRun("main", f.ports.runner);
    expect(f.suiteRuns).toHaveLength(1);
  });
});
