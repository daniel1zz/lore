/**
 * RED-first scenarios for AC-GI-12 — no `lore issues` read surface issues
 * one GitHub network call per issue, and a read-side filter's printed total
 * must reflect the FILTERED count, never the unfiltered one
 * (spec-the-defect-channel-reaches-no-machine-but-its-own-github, Scope
 * entries "Read-side --severity/--category filters on lore issues, plus
 * lore issues --verify" and `GitHubIntakePort`'s "listIssues (batch)";
 * AC-GI-12).
 *
 * `commands/issues.ts` recognises neither `--severity`/`--category` nor any
 * batched-gh-read path yet — this file is authored RED, before the paired
 * implementation task (`task-skill-implement-lore-issues-verify-plus-
 * batched-read-side`) lands. Every assertion below is expected to fail
 * TODAY at the ASSERTION level (an unrecognised flag is silently ignored by
 * citty when `run()` is invoked directly with a raw `args` object, so the
 * command falls back to its current, unfiltered/never-batched behaviour) —
 * never a module-resolution failure, since `commands/issues.ts` already
 * exists.
 *
 * ## The contract this file pins for the implementer
 *
 *   - `lore issues --verify` performs exactly ONE `GhRunner.run(...)` call
 *     REGARDLESS of how many issue-report tasks it covers — "one batched
 *     listing call per read surface" (the paired implementation task's own
 *     Approach note). Scenario 4 below proves this at TWO different N (1
 *     and 50) rather than merely asserting "a small constant", because an
 *     implementation that issues a large-but-fixed constant would also
 *     satisfy a bare bound — equality across two different N is what makes
 *     N-independence actually falsifiable.
 *   - `--severity <level>` filters rows to exactly those whose severity
 *     (this file's fixture supplies it identically via BOTH plausible
 *     sources so this test does not have to guess which one the
 *     implementation reads: `extra.issue_report.severity`, this repo's
 *     EXISTING corpus-side triage field already surfaced by
 *     `readIssueTriageLabels`, AND the GitHub issue body's front-matter
 *     block, `@lore/core`'s `assembleIssueBody`/`parseIssueBody`, the
 *     `frontMatterCodec` the spec's Scope names as severity/category's
 *     "sole copy" going forward) matches exactly. `--json`'s `data.total`
 *     MUST equal the FILTERED row count, never the unfiltered total — the
 *     exact census defect this repo's own North Star names ("filtering
 *     leaves a trace in the count... hiding invalidated docs behind a
 *     self-consistent total made a census wrong by 21x").
 *
 * ## Why this file mocks `gh-runner.js` and `loader.js`
 *
 * See the sibling `resolution-label-non-authority.test.ts`'s header for the
 * full reasoning (AC-GI-7's single-spawn-site constraint plus the paired
 * task's single-file anchor forcing `GhRunner` to be constructed directly
 * inside `issues.ts`; `bun:sqlite` unresolvable under vitest). This file
 * reuses the identical mocking shape.
 *
 * Scenarios (task doc, verbatim, this file covers the two AC-GI-12 ones):
 *   4. 50 issues vs 1 issue: the gh invocation COUNT is equal (and, more
 *      specifically, exactly 1 for both — "one batched listing call").
 *   5. `--severity critical`: only matching rows appear, and the printed
 *      total reflects the filtered count, not the unfiltered one
 *      (MANDATORY per this task's own AC).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 *
 * @spec_ref AC-GI-12 — spec-the-defect-channel-reaches-no-machine-but-its-own-github
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ok, assembleIssueBody, type DocRecord, type IssueFrontMatterFields } from "@lore/core";
import { resolutionToLabel } from "../../../src/service/resolution-projector.js";

// ─── Hoisted mock handles ────────────────────────────────────────────────────

const { listMock, getMock, setMock, closeMock, ghRunMock, loadLoreAppMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  getMock: vi.fn(),
  setMock: vi.fn(),
  closeMock: vi.fn(),
  ghRunMock: vi.fn(),
  loadLoreAppMock: vi.fn(),
}));

vi.mock("../../../src/adapters/cli/loader.js", () => ({
  loadLoreApp: loadLoreAppMock,
}));

// See the sibling `resolution-label-non-authority.test.ts`'s header for why
// this mock is kept (historically load-bearing pre-P4 of spec-the-defect-
// channel-reaches-no-machine-but-its-own-github, harmless now). Every
// fixture here configures `config: {}`, so the local read path always runs.
vi.mock("bun:sqlite", () => ({
  Database: class {},
}));

vi.mock("../../../src/service/gh-runner.js", () => ({
  GhRunner: class {
    run(args: readonly string[]) {
      return ghRunMock(args);
    }
  },
  createNodeGhExecFile: vi.fn(() => vi.fn()),
}));

import issuesCommand from "../../../src/adapters/cli/commands/issues.js";

// ═══════════════════════════════════════════════════════════════════════════
// Shared fixture plumbing
// ═══════════════════════════════════════════════════════════════════════════

const FIXED_FRONT_MATTER_FIELDS_BASE: Omit<IssueFrontMatterFields, "severity" | "category"> = {
  tags: [],
  reporter_corpus: "fixture (~/fixture)",
  reporter_root_prd: "prd-fixture",
  idempotency_key: "01FIXTUREKEY0000000000001",
};

/** Builds a single fixture issue task: a github ref, an explicit terminal resolution, and a declared severity written to BOTH plausible read sources. */
function makeSeverityTaggedIssueDoc(opts: {
  id: string;
  slug: string;
  issueNumber: number;
  severity: "critical" | "high" | "medium" | "low";
}): DocRecord {
  return {
    id: opts.id,
    slug: opts.slug,
    type: "task",
    role: "plan",
    title: `Fixture issue report (${opts.severity})`,
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
        // Corpus-side source (EXISTING mechanism, `readIssueTriageLabels`).
        severity: opts.severity,
        github: { repo: "acme/widget", number: opts.issueNumber },
      },
    },
  } as DocRecord;
}

/** The GitHub-body-front-matter source for the SAME issue — the spec's declared "sole copy" going forward. */
function ghListEntryFor(doc: DocRecord, severity: "critical" | "high" | "medium" | "low"): unknown {
  const extra = doc.extra as { issue_report: { github: { number: number } } };
  const fields: IssueFrontMatterFields = { ...FIXED_FRONT_MATTER_FIELDS_BASE, severity, category: "fixture" };
  return {
    number: extra.issue_report.github.number,
    body: assembleIssueBody(fields, "Fixture description."),
    labels: [{ name: resolutionToLabel("open") }],
  };
}

function callIssuesRun(args: Record<string, unknown>): Promise<void> {
  const run = issuesCommand.run as unknown as (ctx: { args: Record<string, unknown> }) => Promise<void>;
  if (run === undefined) {
    throw new Error("lore issues has no run() handler");
  }
  return run({ args });
}

function wireApp(): void {
  loadLoreAppMock.mockReturnValue({
    app: {
      corpusService: { listFull: listMock, get: getMock, set: setMock },
      close: closeMock,
    },
    dbPath: "/fake/corpus/.lore/lore.db",
    config: {},
  });
}

function parseJsonPayload(logSpy: ReturnType<typeof vi.spyOn>): { ok: boolean; data: Record<string, unknown> } {
  for (const call of logSpy.mock.calls) {
    try {
      return JSON.parse(String(call[0]));
    } catch {
      continue;
    }
  }
  throw new Error(`no console.log call produced parseable JSON (${logSpy.mock.calls.length} calls captured)`);
}

let originalExitCode: typeof process.exitCode;
let stderrSpy: MockInstance;
let logSpy: MockInstance;

beforeEach(() => {
  originalExitCode = process.exitCode;
  process.exitCode = undefined;
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

  listMock.mockReset();
  getMock.mockReset();
  setMock.mockReset();
  closeMock.mockReset();
  ghRunMock.mockReset();
  loadLoreAppMock.mockReset();
  wireApp();
});

afterEach(() => {
  stderrSpy.mockRestore();
  logSpy.mockRestore();
  process.exitCode = originalExitCode;
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 4 — 50 issues vs 1: the gh invocation COUNT is equal
// ═══════════════════════════════════════════════════════════════════════════

/** Builds N issue-report task docs, each with a distinct github issue number, all explicit-terminal so mode filtering never excludes them. */
function makeNIssueDocs(n: number): DocRecord[] {
  const docs: DocRecord[] = [];
  for (let i = 1; i <= n; i += 1) {
    docs.push({
      id: `01HISSUEFIXTUREBATCH${String(i).padStart(5, "0")}`,
      slug: `task-fixture-issue-report-batch-${i}`,
      type: "task",
      role: "plan",
      title: `Fixture issue report ${i}`,
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
          resolution: { state: "rejected" },
          github: { repo: "acme/widget", number: i },
        },
      },
    } as DocRecord);
  }
  return docs;
}

/** Wires list/get + a single batched gh response covering every doc's ref — the SAME label for all, since this scenario cares about CALL COUNT, not content. */
function wireReadFixture(docs: DocRecord[]): void {
  listMock.mockResolvedValue(ok({ docs, total: docs.length }));
  getMock.mockImplementation(async (id: string) => {
    const doc = docs.find((d) => d.id === id);
    return ok({ doc, navigation: { related: [] } });
  });
  const batchedLabels = docs.map((doc) => {
    const extra = doc.extra as { issue_report: { github: { number: number } } };
    return { number: extra.issue_report.github.number, labels: [{ name: resolutionToLabel("rejected") }] };
  });
  ghRunMock.mockResolvedValue(ok({ stdout: JSON.stringify(batchedLabels) }));
}

describe("AC-GI-12 scenario 4 — the gh invocation count for --verify is independent of N (1 vs 50)", () => {
  it("BOUNDARY/REGRESSION: listing 1 issue costs exactly 1 gh call", async () => {
    wireReadFixture(makeNIssueDocs(1));
    await callIssuesRun({ all: true, verify: true, json: true });
    expect(ghRunMock).toHaveBeenCalledTimes(1);
  });

  it("HAPPY: listing 50 issues costs the SAME gh-call count as listing 1 — not O(N)", async () => {
    wireReadFixture(makeNIssueDocs(1));
    await callIssuesRun({ all: true, verify: true, json: true });
    const callsForOne = ghRunMock.mock.calls.length;

    ghRunMock.mockReset();
    wireReadFixture(makeNIssueDocs(50));
    await callIssuesRun({ all: true, verify: true, json: true });
    const callsForFifty = ghRunMock.mock.calls.length;

    // Non-vacuous: an implementation that never calls gh at all would show
    // 0 === 0 here without proving anything about batching.
    expect(callsForOne).toBeGreaterThan(0);
    expect(callsForFifty).toBe(callsForOne);
    // Stronger pin, matching the approach note's "ONE batched listing call".
    expect(callsForFifty).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scenario 5 (MANDATORY) — --severity filters rows AND the printed total
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-GI-12 scenario 5 (MANDATORY) — --severity critical: filtered rows, filtered TOTAL", () => {
  let critical: DocRecord;
  let high: DocRecord;
  let low: DocRecord;

  beforeEach(() => {
    critical = makeSeverityTaggedIssueDoc({
      id: "01HISSUEFIXTURESEV0000001",
      slug: "task-fixture-issue-report-critical",
      issueNumber: 101,
      severity: "critical",
    });
    high = makeSeverityTaggedIssueDoc({
      id: "01HISSUEFIXTURESEV0000002",
      slug: "task-fixture-issue-report-high",
      issueNumber: 102,
      severity: "high",
    });
    low = makeSeverityTaggedIssueDoc({
      id: "01HISSUEFIXTURESEV0000003",
      slug: "task-fixture-issue-report-low",
      issueNumber: 103,
      severity: "low",
    });
    const docs = [critical, high, low];
    listMock.mockResolvedValue(ok({ docs, total: docs.length }));
    getMock.mockImplementation(async (id: string) => {
      const doc = docs.find((d) => d.id === id);
      return ok({ doc, navigation: { related: [] } });
    });
    ghRunMock.mockResolvedValue(
      ok({
        stdout: JSON.stringify([
          ghListEntryFor(critical, "critical"),
          ghListEntryFor(high, "high"),
          ghListEntryFor(low, "low"),
        ]),
      }),
    );
  });

  it("NEGATIVE (LIVENESS CONTROL): the unfiltered listing genuinely sees all 3 fixture rows", async () => {
    await callIssuesRun({ all: true, json: true });
    const payload = parseJsonPayload(logSpy);
    expect(payload.data["total"]).toBe(3);
    const reports = payload.data["reports"] as unknown[];
    expect(reports).toHaveLength(3);
  });

  it("HAPPY: --severity critical shows exactly the 1 matching row", async () => {
    await callIssuesRun({ all: true, severity: "critical", json: true });
    const payload = parseJsonPayload(logSpy);
    const reports = payload.data["reports"] as Array<{ slug: string; severity?: string }>;
    expect(reports).toHaveLength(1);
    expect(reports[0]?.slug).toBe(critical.slug);
    expect(reports[0]?.severity).toBe("critical");
  });

  it("MANDATORY: the printed total is the FILTERED count (1), never the unfiltered total (3) — the exact census defect the project's North Star names", async () => {
    await callIssuesRun({ all: true, severity: "critical", json: true });
    const payload = parseJsonPayload(logSpy);
    expect(payload.data["total"]).toBe(1);
    expect(payload.data["total"]).not.toBe(3);
  });
});
