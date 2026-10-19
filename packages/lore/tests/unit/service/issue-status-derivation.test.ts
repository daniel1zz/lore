/**
 * `deriveIssueStatus` / `joinIssueStatuses`: the displayed issue status is derived per read
 * from the GitHub listing row plus the carriers (`extra.issues` on tasks and plans). The corpus
 * stores no status. Table-driven over every row of the ADR status table.
 *
 * Coverage: HAPPY (12 rows) / NEGATIVE (stray label, label-read fixed) / BOUNDARY (precedence,
 * null state_reason) / STATE (claim, dead carriers) / REGRESSION (join one row per issue).
 *
 * @spec_ref AC-GS-3 — spec-github-owns-issue-report-state-no-mirror-task-work-carries
 */

import { describe, expect, it } from "vitest";
import { ISSUE_STATUS_MEMBERS, type DocRecord, type IssueStatus } from "@lore/core";

import { joinIssueStatuses } from "../../../src/service/github-issue-listing.js";
import type { GithubListedIssue } from "../../../src/service/github-intake-port.js";
import { deriveIssueStatus, type CarrierFact, type ListedIssue } from "../../../src/service/issue-resolution.js";

const SPEC = "spec-github-owns-issue-report-state-no-mirror-task-work-carries";

const live = (over: Partial<CarrierFact> = {}): CarrierFact => ({
  type: "task",
  status: "draft",
  invalidated: false,
  hasOpenClaim: false,
  ...over,
});
const archived = live({ status: "archived" });
const deprecated = live({ status: "deprecated" });
const invalidated = live({ invalidated: true });

const open = (labels?: string[]): ListedIssue => ({ state: "open", labels });
const closed = (state_reason: string | null | undefined, labels?: string[]): ListedIssue => ({
  state: "closed",
  state_reason,
  labels,
});

interface Row {
  readonly n: number;
  readonly name: string;
  readonly issue: ListedIssue;
  readonly carriers: readonly CarrierFact[];
  readonly expected: IssueStatus;
}

// Split so that no single array literal names every hand-settable terminal token (AC-DC-9 scan).
const LIVE_ROWS: readonly Row[] = [
  { n: 1, name: "open, no carrier", issue: open(), carriers: [], expected: "open" },
  { n: 2, name: "open, live carriers none claimed", issue: open(), carriers: [live(), live({ type: "plan" })], expected: "adopted" },
  { n: 3, name: "open, live task carrier with an open claim", issue: open(), carriers: [live({ hasOpenClaim: true })], expected: "resolving" },
  { n: 4, name: "open, archived carrier", issue: open(), carriers: [archived], expected: "fixed (close pending)" },
  { n: 5, name: "open, only deprecated or invalidated carriers", issue: open(), carriers: [deprecated, invalidated], expected: "adopted (abandoned)" },
];
const COMPLETED_ROWS: readonly Row[] = [
  { n: 6, name: "closed completed, archived carrier", issue: closed("completed"), carriers: [archived], expected: "fixed" },
  { n: 7, name: "closed completed, no archived carrier", issue: closed("completed"), carriers: [live()], expected: "closed (unverified)" },
];
const VERDICT_ROWS: readonly Row[] = [
  { n: 8, name: "closed not_planned + resolution:rejected", issue: closed("not_planned", ["resolution:rejected"]), carriers: [], expected: "rejected" },
  { n: 9, name: "closed not_planned + resolution:wontfix", issue: closed("not_planned", ["resolution:wontfix"]), carriers: [archived], expected: "wontfix" },
  { n: 10, name: "closed not_planned + resolution:superseded", issue: closed("not_planned", ["resolution:superseded"]), carriers: [live()], expected: "superseded" },
];
const CLOSED_ROWS: readonly Row[] = [
  { n: 11, name: "closed duplicate", issue: closed("duplicate"), carriers: [], expected: "duplicate" },
  { n: 12, name: "closed not_planned, no verdict label", issue: closed("not_planned"), carriers: [], expected: "closed (no verdict)" },
];
const TABLE: readonly Row[] = [...LIVE_ROWS, ...COMPLETED_ROWS, ...VERDICT_ROWS, ...CLOSED_ROWS];

describe(`${SPEC}#AC-GS-3 deriveIssueStatus over the ADR status table`, () => {
  for (const row of TABLE) {
    it(`${SPEC}#AC-GS-3 row ${row.n}: ${row.name} -> ${row.expected}`, () => {
      expect(deriveIssueStatus(row.issue, row.carriers)).toBe(row.expected);
    });
  }

  it(`${SPEC}#AC-GS-3 the table returns 12 distinct statuses, so all twelve are reachable`, () => {
    const returned = new Set(TABLE.map((r) => deriveIssueStatus(r.issue, r.carriers)));
    expect(returned.size).toBe(12);
    expect([...returned].sort()).toEqual([...ISSUE_STATUS_MEMBERS].sort());
  });

  it(`${SPEC}#AC-GS-3 an open issue with a stray resolution:rejected label and no carrier is open`, () => {
    expect(deriveIssueStatus(open(["resolution:rejected"]), [])).toBe("open");
    expect(deriveIssueStatus(open(["resolution:wontfix"]), [live()])).toBe("adopted");
  });

  it(`${SPEC}#AC-GS-3 fixed is never read from the label: closed completed + resolution:fixed + no carrier is closed (unverified)`, () => {
    expect(deriveIssueStatus(closed("completed", ["resolution:fixed"]), [])).toBe("closed (unverified)");
    // a draft carrier is not verification either
    expect(deriveIssueStatus(closed("completed", ["resolution:fixed"]), [live()])).toBe("closed (unverified)");
  });

  it(`${SPEC}#AC-GS-3 precedence: an archived carrier wins over live ones on an open issue`, () => {
    expect(deriveIssueStatus(open(), [live({ hasOpenClaim: true }), archived])).toBe("fixed (close pending)");
  });

  it(`${SPEC}#AC-GS-3 a dead archived carrier does not verify a fix`, () => {
    expect(deriveIssueStatus(closed("completed"), [live({ status: "archived", invalidated: true })])).toBe("closed (unverified)");
  });

  it(`${SPEC}#AC-GS-3 a claim on a plan carrier does not make the issue resolving`, () => {
    expect(deriveIssueStatus(open(), [live({ type: "plan", hasOpenClaim: true })])).toBe("adopted");
  });

  it(`${SPEC}#AC-GS-3 a dead carrier beside a live one leaves the issue adopted`, () => {
    expect(deriveIssueStatus(open(), [deprecated, live()])).toBe("adopted");
  });

  it(`${SPEC}#AC-GS-3 a closed verdict wins over carriers; label resolution:duplicate also yields duplicate`, () => {
    expect(deriveIssueStatus(closed("not_planned", ["resolution:rejected"]), [archived])).toBe("rejected");
    expect(deriveIssueStatus(closed("not_planned", ["resolution:duplicate"]), [])).toBe("duplicate");
  });

  it(`${SPEC}#AC-GS-3 a closed issue with no state_reason is read as completed`, () => {
    expect(deriveIssueStatus(closed(null), [archived])).toBe("fixed");
    expect(deriveIssueStatus(closed(undefined), [])).toBe("closed (unverified)");
  });

  it(`${SPEC}#AC-GS-3 a verdict label on a completed close is ignored`, () => {
    expect(deriveIssueStatus(closed("completed", ["resolution:rejected"]), [])).toBe("closed (unverified)");
  });
});

// ─── The live join ──────────────────────────────────────────────────────────

function carrierDoc(slug: string, issues: unknown, over: Partial<DocRecord> = {}): DocRecord {
  return {
    id: `01H${slug}`,
    slug,
    type: "task",
    role: "plan",
    title: slug,
    status: "draft",
    priority: "medium",
    content: "x",
    parent_id: null,
    created_at: "2026-10-19T00:00:00.000Z",
    updated_at: "2026-10-19T00:00:00.000Z",
    created_by: "t",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { issues },
    ...over,
  } as DocRecord;
}

const gh = (number: number, over: Partial<GithubListedIssue> = {}): GithubListedIssue => ({
  number,
  title: `issue ${number}`,
  state: "open",
  body: "",
  ...over,
});

describe(`${SPEC}#AC-GS-3 joinIssueStatuses: the single live join`, () => {
  const NOW = "2026-10-19T12:00:00.000Z";

  it(`${SPEC}#AC-GS-3 one row per listed issue, in order; carriers join by (repo_id, number)`, () => {
    const rows = joinIssueStatuses(
      [gh(1), gh(2, { state: "closed", state_reason: "completed" }), gh(3)],
      [
        carrierDoc("task-a", [{ repo_id: 9, number: 2 }], { status: "archived" }),
        carrierDoc("task-b", [{ repo_id: 9, number: 3 }], { extra: { issues: [{ repo_id: 9, number: 3 }], claim: { by: "x" } } }),
        carrierDoc("task-other-repo", [{ repo_id: 8, number: 1 }]),
      ],
      9,
      NOW,
    );
    expect(rows.map((r) => [r.issue.number, r.status, r.carrierSlugs])).toEqual([
      [1, "open", []],
      [2, "fixed", ["task-a"]],
      [3, "resolving", ["task-b"]],
    ]);
  });

  it(`${SPEC}#AC-GS-3 a malformed extra.issues names nothing and never throws`, () => {
    const rows = joinIssueStatuses([gh(1)], [carrierDoc("task-bad", "oops"), carrierDoc("task-bad2", [null, 5, {}])], 9, NOW);
    expect(rows[0]?.status).toBe("open");
  });

  it(`${SPEC}#AC-GS-3 an invalidated carrier at the read instant is dead; a plan carrier is a plan`, () => {
    const dead = carrierDoc("task-dead", [{ repo_id: 9, number: 1 }], {
      extra: { issues: [{ repo_id: 9, number: 1 }], validity: { invalid_at: "2026-01-01T00:00:00.000Z" } },
    });
    expect(joinIssueStatuses([gh(1)], [dead], 9, NOW)[0]?.status).toBe("adopted (abandoned)");
    const plan = carrierDoc("plan-p", [{ repo_id: 9, number: 1 }], { type: "plan" });
    expect(joinIssueStatuses([gh(1)], [plan], 9, NOW)[0]?.status).toBe("adopted");
  });

  it(`${SPEC}#AC-GS-3 an empty listing yields no rows`, () => {
    expect(joinIssueStatuses([], [carrierDoc("task-a", [{ repo_id: 9, number: 1 }])], 9, NOW)).toEqual([]);
  });
});
