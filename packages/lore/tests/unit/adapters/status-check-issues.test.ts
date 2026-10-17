/**
 * AC-IC-4 (status half) — `lore status --check-issues` after
 * spec-archiving-the-work-that-resolves-a-defect-report-closes D6: the former shape (a) "unclosed
 * escalation" (computed `fixed` while the issue task is not archived) is RETIRED — the computed
 * resolution plus the closed GitHub issue are the record — while the stale-open shape (b) is unchanged.
 * `computeIssueCheck` over a real `CorpusService` on InMemoryStore; the retired assertions of the earlier
 * e2e files were deleted there, not skipped.
 *   HAPPY:      a stale open report is still flagged.
 *   NEGATIVE:   a computed-`fixed` report (archived OR active source, issue task not archived) is NOT flagged.
 *   BOUNDARY:   `reported_at` exactly `staleAfterDays` old is flagged (inclusive); one day younger is not.
 *   STATE:      `resolving` and an explicit terminal verdict are not flagged either.
 *   REGRESSION: the payload no longer carries an `unclosed_escalations` key.
 */

import { describe, expect, it } from "vitest";
import type { CreateDocInput, DocRecord, DocStatus, LoreError, Result } from "@lore/core";

import { computeIssueCheck } from "../../../src/adapters/cli/status-issue-check.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";

const NOW_MS = Date.parse("2026-10-12T00:00:00.000Z");
const DAY_MS = 86_400_000;
const isoDaysAgo = (days: number): string => new Date(NOW_MS - days * DAY_MS).toISOString();

async function must<T>(promise: Promise<Result<T, LoreError>>, what: string): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(`${what}: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function buildWorld() {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  await must(cs.create({ type: "prd", title: "Root PRD", content: "root" } as CreateDocInput), "prd");
  return { store, cs };
}
type World = Awaited<ReturnType<typeof buildWorld>>;

async function fileReport(w: World, title: string, reportedDaysAgo: number, resolution?: "wontfix"): Promise<DocRecord> {
  return must(
    w.cs.create({
      type: "task",
      title,
      extra: {
        adhoc: true,
        issue_report: {
          reporter_project: "consumer",
          reporter_actor: "agent:x",
          lore_version: "0.0.0",
          expected: "exit 0",
          actual: "exit 4",
          reported_at: isoDaysAgo(reportedDaysAgo),
          ...(resolution !== undefined
            ? { resolution: { state: resolution, reason: "r", resolved_at: isoDaysAgo(1), resolved_by: "t" } }
            : {}),
        },
      },
    } as CreateDocInput),
    "report",
  );
}

async function linkResolver(w: World, report: DocRecord, status: DocStatus): Promise<void> {
  const plan = await must(w.cs.create({ type: "plan", title: `Fixer of ${report.slug}`, content: "b" } as CreateDocInput), "plan");
  await must(w.cs.link(plan.id, report.id, "resolves"), "link");
  await must(w.store.update(plan.id, { status, version: plan.version + 1 }, { expected_version: plan.version }), "status");
}

describe("spec-archiving-the-work-that-resolves-a-defect-report-closes#AC-IC-4: --check-issues no longer flags a computed-fixed report (D6)", () => {
  it("NEGATIVE: fixed on an ARCHIVED source with the issue task still draft is not flagged — consistent", async () => {
    const w = await buildWorld();
    const report = await fileReport(w, "Fixed and archived fixer", 5);
    await linkResolver(w, report, "archived");

    const result = await must(computeIssueCheck(w.cs, 30, NOW_MS), "check");

    expect(result.checked).toBe(1);
    expect(result.consistent).toBe(true);
    expect(result.stale_open).toEqual([]);
  });

  it("NEGATIVE: fixed on an ACTIVE source is not flagged either", async () => {
    const w = await buildWorld();
    const report = await fileReport(w, "Fixed and active fixer", 400);
    await linkResolver(w, report, "active");

    const result = await must(computeIssueCheck(w.cs, 30, NOW_MS), "check");

    expect(result.consistent).toBe(true);
  });

  it("REGRESSION: the payload carries no unclosed_escalations key any more", async () => {
    const w = await buildWorld();
    const report = await fileReport(w, "Any", 1);
    await linkResolver(w, report, "archived");

    const result = await must(computeIssueCheck(w.cs, 30, NOW_MS), "check");

    expect(Object.keys(result).sort()).toEqual(["checked", "consistent", "stale_open"]);
  });
});

describe("spec-archiving-the-work-that-resolves-a-defect-report-closes#AC-IC-4: --check-issues still flags everything else it flagged", () => {
  it("HAPPY: a stale open report is flagged with its age", async () => {
    const w = await buildWorld();
    const report = await fileReport(w, "Old and open", 100);

    const result = await must(computeIssueCheck(w.cs, 30, NOW_MS), "check");

    expect(result.consistent).toBe(false);
    expect(result.stale_open).toHaveLength(1);
    expect(result.stale_open[0]).toMatchObject({ slug: report.slug, age_days: 100 });
  });

  it("BOUNDARY: exactly staleAfterDays old is flagged (inclusive); one day younger is not", async () => {
    const w = await buildWorld();
    const atBoundary = await fileReport(w, "At the boundary", 30);
    await fileReport(w, "One day short", 29);

    const result = await must(computeIssueCheck(w.cs, 30, NOW_MS), "check");

    expect(result.stale_open.map((r) => r.slug)).toEqual([atBoundary.slug]);
  });

  it("STATE: a resolving report (fix in flight) and an explicit wontfix are not flagged, however old", async () => {
    const w = await buildWorld();
    const resolving = await fileReport(w, "Resolving", 400);
    await linkResolver(w, resolving, "draft");
    await fileReport(w, "Wontfix", 400, "wontfix");

    const result = await must(computeIssueCheck(w.cs, 30, NOW_MS), "check");

    expect(result.stale_open).toEqual([]);
    expect(result.consistent).toBe(true);
  });
});
