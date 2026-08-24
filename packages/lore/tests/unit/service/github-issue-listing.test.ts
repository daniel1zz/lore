/**
 * RED-first scenarios for `github-issue-listing.ts` — the READ-time half of
 * GitHub issue ingest (D3): `joinListing` joins a live GitHub issue listing
 * against the corpus tasks already ingested from it
 * (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam, AC-GR-5).
 *
 * `packages/lore/src/service/github-issue-listing.ts` DOES NOT EXIST YET at
 * authoring time — this file's imports below ARE the contract the paired
 * implementation must satisfy (mirrors `resolution-projector.test.ts`'s own
 * RED-first convention in this same directory: the whole file is expected
 * to fail at MODULE RESOLUTION, not at an assertion, until the
 * implementation lands).
 *
 * ## AC-GR-5's central claim
 *
 * Identity survives a GitHub repository rename: a listing whose
 * `owner/repo` string DIFFERS from the string stored on the ingested task,
 * but whose numeric repo id MATCHES, still joins as `ingested`. Falsifier:
 * key the join on the repo string and the row flips to `not_ingested`.
 * Every scenario below therefore seeds a stored `github.repo` string that
 * deliberately does NOT equal the "current" repo string, to prove the
 * string is never consulted for identity.
 *
 * ## Vacuous-pass trap (dispatch bundle)
 *
 * A fresh fixture with zero ingested tasks makes `joinListing` return
 * all-`not_ingested`, satisfying a loose "it returns rows" assertion while
 * proving nothing about the join itself. The BOUNDARY scenario below seeds
 * at least one task that DOES match and one listed issue that does NOT,
 * and asserts both kinds appear.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref AC-GR-5 — spec-a-github-filed-defect-must-be-claimable-one-ingest-seam
 */

import { describe, expect, it, vi } from "vitest";
import type { DocRecord, IssueResolution } from "@lore/core";

// ─── The module under test — DOES NOT EXIST YET; this import is the RED signal ──

import { joinListing, type GithubIssueRow } from "../../../src/service/github-issue-listing.js";
import type { GithubListedIssue } from "../../../src/service/github-intake-port.js";

/** A minimal corpus task carrying a GitHub pointer under `extra.issue_report.github`. */
function makeIngestedTask(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01HISSUEFIXTURE00000000001",
    slug: "task-gh-555-7",
    type: "task",
    role: "plan",
    title: "Fixture ingested issue",
    status: "draft",
    priority: "medium",
    content: "## Issue\n\nFixture.",
    parent_id: "01HPLANFIXTURE0000000000001",
    created_at: "2026-08-23T00:00:00.000Z",
    updated_at: "2026-08-23T00:00:00.000Z",
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {
      issue_report: {
        // Deliberately a DIFFERENT owner/repo string than "acme/widget" (the
        // "current" repo used in every scenario below) — this is AC-GR-5's
        // whole point: a renamed repo's OLD string is provenance only.
        github: { repo: "old-owner/widget", number: 7, repo_id: 555 },
      },
    },
    ...overrides,
  } as DocRecord;
}

function listedIssue(overrides: Partial<GithubListedIssue> = {}): GithubListedIssue {
  return {
    number: 7,
    title: "A listed issue",
    state: "open",
    body: "irrelevant to the join itself",
    ...overrides,
  };
}

const CURRENT_REPO_ID = 555; // "acme/widget" today, post-rename
const NO_OP_RESOLVE = (): IssueResolution => "open";

describe("AC-GR-5: identity survives a GitHub repository rename — the join key is the numeric repo id", () => {
  it("HAPPY: a listing whose owner/repo string differs from the stored task's string still joins as ingested when the numeric repo id matches", () => {
    // Falsifier: key the join on the repo string ("old-owner/widget" vs the
    // current "acme/widget") instead of repo_id, and this row flips to
    // not_ingested even though it is the SAME repository, just renamed.
    const task = makeIngestedTask();
    const rows: readonly GithubIssueRow[] = joinListing(
      [listedIssue({ number: 7 })],
      [task],
      CURRENT_REPO_ID,
      () => "fixed",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("ingested");
    if (rows[0]?.kind === "ingested") {
      expect(rows[0].task.id).toBe(task.id);
      expect(rows[0].resolution).toBe("fixed");
      expect(rows[0].issue.number).toBe(7);
    }
  });

  it("NEGATIVE: a matching issue number but a DIFFERENT repo_id never joins — repo id is the whole identity, never a tiebreaker", () => {
    const task = makeIngestedTask(); // repo_id: 555
    const rows = joinListing([listedIssue({ number: 7 })], [task], 999, NO_OP_RESOLVE);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("not_ingested");
  });

  it("BOUNDARY: a mixed listing (one ingested match, one not_ingested) — the vacuous-pass trap this AC's dispatch bundle names", () => {
    const matchedTask = makeIngestedTask({ id: "01HMATCHED0000000000000001" });
    const rows = joinListing(
      [listedIssue({ number: 7 }), listedIssue({ number: 8 })],
      [matchedTask],
      CURRENT_REPO_ID,
      () => "resolving",
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind)).toEqual(["ingested", "not_ingested"]);
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds.has("ingested")).toBe(true);
    expect(kinds.has("not_ingested")).toBe(true);
  });

  it("ERROR: a task with a malformed/absent GitHub pointer degrades to no-match, never a crash", () => {
    const malformed = makeIngestedTask({ extra: { issue_report: {} } });
    const rows = joinListing([listedIssue({ number: 7 })], [malformed], CURRENT_REPO_ID, NO_OP_RESOLVE);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("not_ingested");
  });

  it("ERROR: a task whose stored ref carries NO repo_id at all (pre-this-spec shape) never matches, rather than falling back to the repo string", () => {
    const legacyTask = makeIngestedTask({
      extra: { issue_report: { github: { repo: "acme/widget", number: 7 } } }, // no repo_id
    });
    const rows = joinListing([listedIssue({ number: 7 })], [legacyTask], CURRENT_REPO_ID, NO_OP_RESOLVE);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("not_ingested");
  });

  it("STATE: resolveOne is invoked ONLY for matched (ingested) rows, never for not_ingested ones", () => {
    const matchedTask = makeIngestedTask();
    const resolveSpy = vi.fn((): IssueResolution => "open");
    joinListing([listedIssue({ number: 7 }), listedIssue({ number: 9 })], [matchedTask], CURRENT_REPO_ID, resolveSpy);

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith(matchedTask);
  });

  it("REGRESSION: joinListing returns exactly one row per listed issue, in the same order, even with zero ingested tasks", () => {
    const rows = joinListing(
      [listedIssue({ number: 1 }), listedIssue({ number: 2 }), listedIssue({ number: 3 })],
      [],
      CURRENT_REPO_ID,
      NO_OP_RESOLVE,
    );
    expect(rows.map((r) => r.issue.number)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.kind === "not_ingested")).toBe(true);
  });
});
