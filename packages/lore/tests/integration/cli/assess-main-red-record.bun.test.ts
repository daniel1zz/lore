/**
 * @spec_ref spec-delivery-concurrency-and-autonomy-metrics (AC-DC-6, BR-1412, BR-1414)
 *
 * The milestone review records main red locally at detection, independent of issue filing, and records the green time
 * on the open record later. Everything runs on a throwaway corpus store (`mkdtemp`, never the repo's `.lore`): the
 * real `MilestoneReviewService` over a real `SQLiteStore` audit chain, an injected suite result, and an injected issue
 * port that always fails. No network is touched.
 *
 * Dimensions: HAPPY (red recorded once with range + both files; green stamps the open record), NEGATIVE (a failing
 * issue filer does not remove the record; a not-measured suite records nothing), BOUNDARY (a second red review while
 * the record is open adds no record; the range starts at the last checked commit), ERROR (a corrupt ledger row fails
 * the review loudly), STATE (red -> green -> red again opens a second record), REGRESSION (green with no open record
 * writes no main-red row).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { actedStore } from "../../live-invocation.js";
import { IssueFilingService, type IssuePort } from "../../../src/service/issue-filing-service.js";
import { MilestoneReviewService, type MilestoneReviewDeps } from "../../../src/service/milestone-review-service.js";
import {
  MAIN_CHECKED_ACTION,
  MAIN_RED_ACTION,
  MAIN_RED_GREEN_ACTION,
  foldMainRedRecords,
  type MainRedLedgerPort,
} from "../../../src/service/milestone-review.js";
import type { SuiteRun } from "../../../src/service/milestone-review-inputs.js";

const DIMENSIONS = ["correctness_vs_acs", "spec_conformance", "regression", "design_necessity", "snapshot_accuracy", "concurrency_safety", "security"];
const JUDGE_PASS = JSON.stringify({
  dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, { verdict: "pass", reason: `${d} holds`, reference: "Google engineering code review guide" }])),
});
const FILE_A = "packages/x/tests/a.test.ts";
const FILE_B = "packages/x/tests/b.test.ts";
const DIFF = `diff --git a/${FILE_A} b/${FILE_A}\n+x\ndiff --git a/${FILE_B} b/${FILE_B}\n+y\n`;

let dir: string;
let store: SQLiteStore;
let clock: string;

function redSuite(commit: string): SuiteRun {
  return {
    status: "measured",
    commit,
    commands: [{ command: "bun run test", exit_code: 1, output_tail: "FAIL" }],
    skipped: [],
    failing_test_files: [FILE_A, FILE_B].map((file) => ({ file, imports: [] })),
  };
}

function greenSuite(commit: string): SuiteRun {
  return { status: "measured", commit, commands: [{ command: "bun run test", exit_code: 0, output_tail: "ok" }], skipped: [], failing_test_files: [] };
}

function ledger(): MainRedLedgerPort {
  return {
    now: () => clock,
    listRows: async () => {
      const rows = [];
      for (const action of [MAIN_CHECKED_ACTION, MAIN_RED_ACTION, MAIN_RED_GREEN_ACTION]) {
        const listed = await store.listAuditRowsByAction(action);
        if (!listed.ok) return listed;
        rows.push(...listed.value);
      }
      return ok(rows.sort((a, b) => a.id - b.id).map((r) => ({ action: r.action, timestamp: r.timestamp, details: r.details ?? {} })));
    },
    appendRow: (row) =>
      store.appendAuditEntry({ timestamp: row.timestamp, actor: "agent:main-red-test", session_id: "main-red", action: row.action, details: { ...row.details } }),
  };
}

function serviceWith(port: MainRedLedgerPort | undefined): MilestoneReviewService {
  const bundle = {
    plan: { id: "plan-1", slug: "plan-one", title: "Plan one", content: "", extra: {}, version: 1 },
    tasks: [{ id: "task-1", slug: "task-one", title: "T", status: "archived", content: "", extra: {}, version: 1 }],
    spec: undefined,
  };
  const deps = {
    getPlanBundle: async () => ok(bundle),
    getCitedRuleStates: async () => ok([]),
    listDecisionLog: async () => ok([]),
    judge: async () => ok(JUDGE_PASS),
    createReviewDoc: async () => ok({ id: "review-1", slug: "review-one" }),
    link: async () => ok(undefined),
    ...(port !== undefined ? { mainRedLedger: port } : {}),
  } as unknown as MilestoneReviewDeps;
  return new MilestoneReviewService(deps);
}

async function review(service: MilestoneReviewService, suite: SuiteRun | undefined) {
  return service.review("plan-one", { diffText: DIFF, diffSource: "fixture", maxDiffChars: 100000, ...(suite !== undefined ? { suite } : {}) });
}

async function records() {
  const rows = await ledger().listRows();
  if (!rows.ok) throw new Error(JSON.stringify(rows.error));
  const folded = foldMainRedRecords(rows.value);
  if (!folded.ok) throw new Error(JSON.stringify(folded.error));
  return folded.value.records;
}

async function rawCount(action: string): Promise<number> {
  const listed = await store.listAuditRowsByAction(action);
  if (!listed.ok) throw new Error(JSON.stringify(listed.error));
  return listed.value.length;
}

const failing = (error: LoreError): Promise<Result<never, LoreError>> => Promise.resolve(err(error));
const FAILING_PORT: IssuePort = {
  findOpenByFingerprint: () => failing({ code: "STORE_ERROR", message: "tracker unreachable" }),
  file: () => failing({ code: "STORE_ERROR", message: "tracker unreachable" }),
  recordKnownDefects: () => failing({ code: "STORE_ERROR", message: "tracker unreachable" }),
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-main-red-"));
  store = actedStore(new SQLiteStore(join(dir, "lore.db")));
  clock = "2026-10-01T10:00:00.000Z";
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("AC-DC-6: main red is recorded locally at detection independent of issue filing", () => {
  it("AC-DC-6 records exactly one main-red record naming the range and both files, also when issue filing fails", async () => {
    const service = serviceWith(ledger());
    const reviewed = await review(service, redSuite("c1"));
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    // the regression finding is real, so filing is attempted — and fails
    const findings = (Object.entries(reviewed.value.review.dimensions) as [string, { verdict: string; reason: string; reference: string }][])
      .filter(([, j]) => j.verdict === "fail")
      .map(([dimension, j]) => ({
        plan: "plan-one",
        dimension: dimension as "regression",
        reason: j.reason,
        reference: j.reference,
        reviewSlug: reviewed.value.doc.slug,
        causes: reviewed.value.review.causes,
      }));
    expect(findings.length).toBe(1);
    const filed = await new IssueFilingService(FAILING_PORT).fileFindings(findings);
    const filingFailed = !filed.ok || filed.value.some((g) => g.error !== undefined);
    expect(filingFailed).toBe(true);

    const all = await records();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      range_from: null,
      range_to: "c1",
      failing_files: [FILE_A, FILE_B],
      failing_checks: ["bun run test"],
      detected_at: "2026-10-01T10:00:00.000Z",
    });
    expect(all[0]?.green_at).toBeUndefined();
    expect(await rawCount(MAIN_RED_ACTION)).toBe(1);
  });

  it("AC-DC-6 a later green review records the green time on that record and writes no new main-red row", async () => {
    const service = serviceWith(ledger());
    await review(service, redSuite("c1"));
    clock = "2026-10-01T13:00:00.000Z";
    const green = await review(service, greenSuite("c2"));
    expect(green.ok).toBe(true);
    const all = await records();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ detected_at: "2026-10-01T10:00:00.000Z", green_at: "2026-10-01T13:00:00.000Z", green_commit: "c2" });
    expect(await rawCount(MAIN_RED_ACTION)).toBe(1);
    expect(await rawCount(MAIN_RED_GREEN_ACTION)).toBe(1);
  });

  it("AC-DC-6 a second red review while the record is open adds no record", async () => {
    const service = serviceWith(ledger());
    await review(service, redSuite("c1"));
    clock = "2026-10-02T10:00:00.000Z";
    await review(service, redSuite("c2"));
    expect(await rawCount(MAIN_RED_ACTION)).toBe(1);
    expect(await records()).toHaveLength(1);
  });

  it("AC-DC-6 red again after green opens a second record whose range starts at the last green check", async () => {
    const service = serviceWith(ledger());
    await review(service, redSuite("c1"));
    clock = "2026-10-01T13:00:00.000Z";
    await review(service, greenSuite("c2"));
    clock = "2026-10-03T09:00:00.000Z";
    await review(service, redSuite("c3"));
    const all = await records();
    expect(all).toHaveLength(2);
    expect(all[1]).toMatchObject({ range_from: "c2", range_to: "c3", last_green_at: "2026-10-01T13:00:00.000Z", detected_at: "2026-10-03T09:00:00.000Z" });
    expect(all[0]?.green_at).toBe("2026-10-01T13:00:00.000Z");
  });

  it("AC-DC-6 green with no open record writes no main-red row and a not-measured suite records nothing", async () => {
    const service = serviceWith(ledger());
    await review(service, greenSuite("c1"));
    await review(service, { status: "not_measured", reason: "no main" });
    await review(service, undefined);
    expect(await rawCount(MAIN_RED_ACTION)).toBe(0);
    expect(await rawCount(MAIN_RED_GREEN_ACTION)).toBe(0);
    expect(await rawCount(MAIN_CHECKED_ACTION)).toBe(1);
  });

  it("AC-DC-6 a corrupt ledger row fails the review loudly instead of being skipped", async () => {
    await store.appendAuditEntry({ timestamp: clock, actor: "agent:main-red-test", session_id: "main-red", action: MAIN_RED_ACTION, details: { record_id: 7 } });
    const reviewed = await review(serviceWith(ledger()), redSuite("c1"));
    expect(reviewed.ok).toBe(false);
  });

  it("AC-DC-6 the same detection written twice folds to one record (concurrent writers)", async () => {
    const port = ledger();
    const service = serviceWith(port);
    await review(service, redSuite("c1"));
    const rows = await port.listRows();
    if (!rows.ok) throw new Error("rows");
    const red = rows.value.find((r) => r.action === MAIN_RED_ACTION);
    if (red === undefined) throw new Error("no red row");
    await port.appendRow(red);
    expect(await rawCount(MAIN_RED_ACTION)).toBe(2);
    expect(await records()).toHaveLength(1);
  });
});
