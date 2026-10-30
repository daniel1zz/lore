/**
 * AC-AQ-1 / BR-1509: a corpus-only task (no file anchors, never claimed on a branch, no landing record) contributes no diff
 * and no landing, never makes regression or security not measured, and is listed as having no code. Any other task with no
 * landing record is still `unlanded`. When every task is corpus-only, regression and security are `na`, never pass.
 *
 * Dimensions: HAPPY (corpus-only listed, never unlanded), NEGATIVE (claimed-on-branch anchor-free and anchored tasks stay
 * unlanded), BOUNDARY (all corpus-only gives na, a mixed plan keeps the unlanded cause), REGRESSION (the `no-change` landing
 * label is never read to decide this, #517).
 */

import { describe, it, expect } from "vitest";
import { deriveLandingDiffForPlan } from "../../../src/adapters/cli/assess-commit-derivation.js";
import { isCorpusOnlyTask, noCodeSecurityJudgment } from "../../../src/service/corpus-only-task.js";
import { regressionAtHead, type RegressionAtHeadPorts } from "../../../src/service/regression-at-head.js";

const NO_LANDING = undefined;

/** Ports that fail the test when touched: a plan with no code must not run a suite or read history. */
const forbiddenPorts = new Proxy({}, {
  get: (_target, name) => {
    throw new Error(`port ${String(name)} must not be used for a plan with no code`);
  },
}) as unknown as RegressionAtHeadPorts;

describe("AC-AQ-1 corpus-only task classification", () => {
  it("AC-AQ-1 an anchor-free task never claimed on a branch with no landing is corpus-only", () => {
    expect(isCorpusOnlyTask({ file_anchors: undefined, claim_rows: [], current_claim: undefined, has_landing: false })).toBe(true);
    expect(isCorpusOnlyTask({ file_anchors: [], claim_rows: [], current_claim: undefined, has_landing: false })).toBe(true);
  });

  it("AC-AQ-1 a no-branch claim (no branch, no worktree) still leaves the task corpus-only", () => {
    expect(isCorpusOnlyTask({ file_anchors: [], claim_rows: [{ details: { by: "agent:x" } }], current_claim: { by: "agent:x" }, has_landing: false })).toBe(true);
  });

  it("AC-AQ-1 an anchor-free task that WAS claimed on a branch is not corpus-only", () => {
    expect(isCorpusOnlyTask({ file_anchors: [], claim_rows: [{ details: { branch: "feat/x" } }], current_claim: undefined, has_landing: false })).toBe(false);
    expect(isCorpusOnlyTask({ file_anchors: [], claim_rows: [{ details: { worktree: "/tmp/wt" } }], current_claim: undefined, has_landing: false })).toBe(false);
    expect(isCorpusOnlyTask({ file_anchors: [], claim_rows: [], current_claim: { worktree: "feat/y" }, has_landing: false })).toBe(false);
  });

  it("AC-AQ-1 an anchored task is not corpus-only", () => {
    expect(isCorpusOnlyTask({ file_anchors: ["src/a.ts"], claim_rows: [], current_claim: undefined, has_landing: false })).toBe(false);
  });

  it("AC-AQ-1 a task with a landing record is not corpus-only (even when the landing is labelled no-change, #517)", () => {
    expect(isCorpusOnlyTask({ file_anchors: [], claim_rows: [], current_claim: undefined, has_landing: true })).toBe(false);
  });
});

describe("AC-AQ-1 landing derivation", () => {
  it("AC-AQ-1 a corpus-only task contributes no landing, is never unlanded and is listed as having no code", () => {
    const derived = deriveLandingDiffForPlan("/nonexistent", [{ slug: "t-docs", landing: NO_LANDING, corpus_only: true }], false);
    expect(derived.unlanded_tasks).toEqual([]);
    expect(derived.tasks_not_measured).toEqual([]);
    expect(derived.landings).toEqual([]);
    expect(derived.no_code_tasks).toEqual(["t-docs"]);
    expect(derived.diff_text).toBe("");
  });

  it("AC-AQ-1 a task not marked corpus-only with no landing (claimed on a branch, or anchored) is still unlanded", () => {
    const derived = deriveLandingDiffForPlan("/nonexistent", [{ slug: "t-branch", landing: NO_LANDING }], false);
    expect(derived.unlanded_tasks).toEqual(["t-branch"]);
    expect(derived.tasks_not_measured).toEqual(["t-branch"]);
    expect(derived.no_code_tasks).toEqual([]);
  });

  it("AC-AQ-1 in a mixed plan only the non-corpus-only task is unlanded", () => {
    const derived = deriveLandingDiffForPlan(
      "/nonexistent",
      [
        { slug: "t-docs", landing: NO_LANDING, corpus_only: true },
        { slug: "t-code", landing: NO_LANDING },
      ],
      false,
    );
    expect(derived.unlanded_tasks).toEqual(["t-code"]);
    expect(derived.no_code_tasks).toEqual(["t-docs"]);
  });
});

describe("AC-AQ-1 regression and security when no task changes code", () => {
  it("AC-AQ-1 regression is na, naming that no task changes code, and runs no suite", async () => {
    const result = await regressionAtHead([], [], forbiddenPorts, ["t-docs"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rows).toHaveLength(1);
    const row = result.value.rows[0];
    expect(row?.verdict).toBe("na");
    expect(row?.detail).toContain("no task of this plan changes code");
    expect(row?.detail).toContain("t-docs");
    expect(result.value.causes).toEqual([]);
    expect(result.value.charged).toEqual([]);
  });

  it("AC-AQ-1 an unlanded task next to corpus-only tasks keeps regression not measured with the unlanded cause", async () => {
    const result = await regressionAtHead([], ["t-code"], {
      ...forbiddenPorts,
      headRef: "main",
      suites: { lookupOrRun: async () => ({ ok: false, error: { code: "VALIDATION_ERROR", field: "x", message: "no suite" } }) },
    } as unknown as RegressionAtHeadPorts, ["t-docs"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.causes).toContain("unlanded");
    expect(result.value.rows.some((r) => r.verdict === "na")).toBe(false);
  });

  it("AC-AQ-1 security is na, naming that no task changes code, never pass", () => {
    const judgment = noCodeSecurityJudgment(["t-docs"]);
    expect(judgment.verdict).toBe("na");
    expect(judgment.reason).toContain("no task of this plan changes code");
  });
});
