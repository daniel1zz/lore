/**
 * Regression guard (task-skill-test-regression-guard-a-github-close-cannot-yield-a,
 * AC-GI-13) — locks in EXISTING `computeIssueResolution` behaviour BEFORE any
 * GitHub-intake code (P1-P5 of
 * plan-land-the-github-intake-defect-channel-runner-cap-removal) moves.
 *
 * Per the governing spec's Per-Field Authority table
 * (spec-the-defect-channel-reaches-no-machine-but-its-own-github): GitHub's
 * `state`/`state_reason` is advisory only, ratified into a corpus verdict
 * SOLELY via `lore issue resolve`. GitHub's "Close as completed" maps
 * naturally onto `fixed` (R6), and `adapters/cli/commands/issue.ts` rejects
 * `--state fixed` UNCONDITIONALLY, before any doc lookup — the only path to
 * `fixed` is a `resolves` edge to a terminal source doc
 * (`issue-resolution.ts` rules 2/3). This guard exercises the ONE OTHER place
 * a back door could open: `computeIssueResolution` itself, if it were ever
 * taught to read a GitHub-side field directly.
 *
 * This is a GREEN-first guard, not red-first (plan Decisions Log D-4): it
 * must pass on unmodified HEAD and stay green through every later phase. A
 * red here at any future point is, by construction, a regression — the guard
 * has no paired implementation task.
 *
 * Three scenarios (task doc `Scenarios`):
 *   1. No explicit resolution, no resolves edge, no adoption + a GitHub
 *      close-as-completed represented in `extra` => still `open`, never
 *      `fixed`.
 *   2. A GitHub close with `state_reason: "not_planned"` leaves the result
 *      UNCHANGED from the identical input with no GitHub close info at all —
 *      proven by computing the same baseline twice and diffing, not by
 *      asserting a single literal.
 *   3. A REAL `resolves` edge to an ARCHIVED source doc DOES yield `fixed` —
 *      the scenario that stops this guard from passing vacuously. Without
 *      it, a "guard" that rejected every input regardless of shape (e.g. one
 *      that always asserted `!== "fixed"` off broken plumbing) would also be
 *      green; this scenario forces the guard to actually distinguish the
 *      legitimate path from the GitHub back door.
 *
 * @spec_ref spec-the-defect-channel-reaches-no-machine-but-its-own-github AC-GI-13
 */

import { describe, it, expect } from "vitest";
import {
  computeIssueResolution,
  type IssueTaskLike,
  type ResolvesInEdgeLike,
  type ResolutionSourceDocLike,
} from "../../../src/service/issue-resolution.js";

/**
 * A GitHub "Close as completed" is represented ONLY as opaque data nested
 * under `extra.issue_report.github` — no export in `issue-resolution.ts`
 * reads this shape today (`readExplicitResolutionState` consults ONLY
 * `extra.issue_report.resolution.state`), and this helper's shape is what
 * this guard pins down as inert. `state_reason` is GitHub's own vocabulary
 * (`completed` | `not_planned`, among others) — it is not a member of
 * `EXPLICIT_RESOLUTIONS` and must never be conflated with
 * `extra.issue_report.resolution.state`.
 */
function withGithubClose(
  extra: Record<string, unknown>,
  stateReason: "completed" | "not_planned",
): Record<string, unknown> {
  const issueReport = (extra["issue_report"] as Record<string, unknown> | undefined) ?? {};
  return {
    ...extra,
    issue_report: {
      ...issueReport,
      github: { state: "closed", state_reason: stateReason },
    },
  };
}

describe("computeIssueResolution — a GitHub close cannot yield a corpus `fixed` resolution (AC-GI-13)", () => {
  it("HAPPY/REGRESSION: no explicit resolution, no resolves edge, no adoption + a GitHub close-as-completed => still `open`, never `fixed`", () => {
    const issue: IssueTaskLike = {
      extra: withGithubClose({ issue_report: { reporter_project: "consumer-a" } }, "completed"),
    };

    const result = computeIssueResolution(issue, [], []);

    expect(result).toBe("open");
    expect(result).not.toBe("fixed");
  });

  it("NEGATIVE: a GitHub close with state_reason `not_planned` leaves the result unchanged from the pre-close computation", () => {
    const resolvesInEdges: ResolvesInEdgeLike[] = [{ from_id: "spec-1" }];
    const sourceDocs: ResolutionSourceDocLike[] = [{ id: "spec-1", status: "draft" }];
    const baseExtra = { issue_report: { reporter_project: "consumer-a" } };

    const preCloseResult = computeIssueResolution({ extra: baseExtra }, resolvesInEdges, sourceDocs);
    const postCloseResult = computeIssueResolution(
      { extra: withGithubClose(baseExtra, "not_planned") },
      resolvesInEdges,
      sourceDocs,
    );

    expect(postCloseResult).toBe(preCloseResult);
    expect(postCloseResult).toBe("resolving");
    expect(postCloseResult).not.toBe("fixed");
  });

  it("BOUNDARY/STATE: a resolves edge to an ARCHIVED source doc DOES yield `fixed` — the legitimate path this guard must distinguish from the GitHub back door, or it would pass vacuously", () => {
    const issue: IssueTaskLike = { extra: { issue_report: { reporter_project: "consumer-a" } } };
    const resolvesInEdges: ResolvesInEdgeLike[] = [{ from_id: "spec-1" }];
    const sourceDocs: ResolutionSourceDocLike[] = [{ id: "spec-1", status: "archived" }];

    const result = computeIssueResolution(issue, resolvesInEdges, sourceDocs);

    expect(result).toBe("fixed");
  });

  it("ERROR/BOUNDARY: a GitHub close-as-completed on an issue whose doc status is already `archived` still computes `closed`, never `fixed`", () => {
    const issue: IssueTaskLike = {
      extra: withGithubClose({ issue_report: { reporter_project: "consumer-a" } }, "completed"),
      status: "archived",
    };

    const result = computeIssueResolution(issue, [], []);

    expect(result).toBe("closed");
    expect(result).not.toBe("fixed");
  });
});
