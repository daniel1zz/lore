/**
 * Pure-predicate and claim-shape coverage for claim-scoped corpus authoring
 * (spec-baseline-slice-2 §C8, AC-BLS2-8). The end-to-end behaviour lives in
 * tests/integration/cli/corpus-scope-lease.bun.test.ts; this file pins the pieces that
 * need no store: the decision table of `checkCorpusScopedWrite`, and the claim fact's
 * "explicit, never carried forward" rule.
 *
 * Runs under vitest (imports no bun:sqlite — the guard's store dependency is type-only).
 */

import { describe, expect, it } from "vitest";
import { buildTaskClaim, taskClaimSchema } from "@lore/core";
import {
  FOREIGN_CORPUS_WRITE_TOKEN,
  checkCorpusScopedWrite,
} from "../../../src/service/foreign-corpus-write-guard.js";

describe("checkCorpusScopedWrite decision table", () => {
  const foreign = { provenance: "git_common_dir", enabled: true } as const;

  it("refuses a worktree baseline write no lease covers, carrying the foreign-write token", () => {
    const verdict = checkCorpusScopedWrite(foreign, false);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.reason).toContain(FOREIGN_CORPUS_WRITE_TOKEN);
  });

  it("allows it once the lease's scope covers the target", () => {
    expect(checkCorpusScopedWrite(foreign, true)).toEqual({ allowed: true });
  });

  it("stays inert for provenance own / undetermined / null", () => {
    for (const provenance of ["own", "undetermined", null] as const) {
      expect(checkCorpusScopedWrite({ provenance, enabled: true }, false)).toEqual({ allowed: true });
    }
  });

  it("stays inert when the gate is disabled by config", () => {
    expect(checkCorpusScopedWrite({ provenance: "git_common_dir", enabled: false }, false)).toEqual({ allowed: true });
  });
});

describe("claim corpus_scope is an explicit lease fact", () => {
  const previous = { by: "a", at: "T0", worktree: "/w", corpus_scope: "branch-x" };

  it("round-trips through the claim schema", () => {
    expect(taskClaimSchema.parse(previous).corpus_scope).toBe("branch-x");
  });

  it("is NOT inherited on a same-holder fresh refresh that omits it (no silent re-grant)", () => {
    const refreshed = buildTaskClaim(previous, { by: "a", at: "T1" }, true);
    expect(refreshed.corpus_scope).toBeUndefined();
    expect(refreshed.worktree).toBe("/w"); // sanity: the sibling fields still carry forward
  });

  it("is written when re-declared on the refresh", () => {
    expect(buildTaskClaim(previous, { by: "a", at: "T1", corpus_scope: "branch-y" }, true).corpus_scope).toBe("branch-y");
  });

  it("rejects an empty scope string", () => {
    expect(taskClaimSchema.safeParse({ ...previous, corpus_scope: "" }).success).toBe(false);
  });
});
