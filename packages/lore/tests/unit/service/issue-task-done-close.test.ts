/**
 * AC-IT-1 — completing a filed report's OWN task with `lore done` closes its GitHub issue
 * (spec-completing-an-adopted-report-s-own-task-closes-its-github D1-D3).
 *
 * Real services over InMemoryStore + a RECORDING FAKE `IssueCloser` — nothing here can reach GitHub.
 *   HAPPY:      done on the report task -> close + comment naming the task + label.
 *   NEGATIVE:   sweep / plain status change -> no close, no comment; an explicit wontfix verdict -> no close.
 *   ERROR:      close failure -> task stays archived, one issue_close_failed audit row, result names it.
 *   BOUNDARY:   no github ref -> no call + one line; already closed -> no-op success.
 *   STATE:      sync closes a done-archived report, only labels a sweep-archived one.
 *   REGRESSION: mutation "close from the sweep path" fails the NEGATIVE cases.
 */

import { describe, expect, it } from "vitest";
import { err, ok } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";

import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { IssueCloseOnArchive, ISSUE_CLOSE_FAILED_AUDIT_ACTION } from "../../../src/service/issue-close-on-archive.js";
import type { GithubIssueSnapshot, IssueCloser } from "../../../src/service/issue-closer-port.js";
import type { GithubIssueRef } from "../../../src/service/resolution-projector.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";

const NOW = "2026-10-12T10:00:00.000Z";

/** Recording fake with per-issue-number state — the ONLY GitHub surface any test in this file touches. */
class RecordingCloser implements IssueCloser {
  readonly calls: string[] = [];
  readonly closedNumbers = new Set<number>();
  readonly labelsByNumber = new Map<number, string[]>();
  closeError: LoreError | undefined;

  async readIssue(ref: GithubIssueRef): Promise<Result<GithubIssueSnapshot, LoreError>> {
    this.calls.push(`read:${ref.issueNumber}`);
    return ok({
      state: this.closedNumbers.has(ref.issueNumber) ? "closed" : "open",
      labels: [...(this.labelsByNumber.get(ref.issueNumber) ?? [])],
    });
  }
  async closeIssue(ref: GithubIssueRef): Promise<Result<{ alreadyClosed: boolean }, LoreError>> {
    this.calls.push(`close:${ref.issueNumber}`);
    if (this.closedNumbers.has(ref.issueNumber)) return ok({ alreadyClosed: true });
    if (this.closeError !== undefined) return err(this.closeError);
    this.closedNumbers.add(ref.issueNumber);
    return ok({ alreadyClosed: false });
  }
  async commentIssue(ref: GithubIssueRef, body: string): Promise<Result<void, LoreError>> {
    this.calls.push(`comment:${ref.issueNumber}:${body}`);
    return ok(undefined);
  }
  async labelIssue(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>> {
    this.calls.push(`label:${ref.issueNumber}:${label}`);
    this.labelsByNumber.set(ref.issueNumber, [...(this.labelsByNumber.get(ref.issueNumber) ?? []), label]);
    return ok(undefined);
  }
  /** Calls that mutate GitHub (everything but the drift read). */
  get writes(): string[] {
    return this.calls.filter((call) => !call.startsWith("read:"));
  }
}

async function must<T>(promise: Promise<Result<T, LoreError>>, what: string): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(`${what}: ${JSON.stringify(result.error)}`);
  return result.value;
}

interface World {
  readonly store: InMemoryStore;
  readonly cs: CorpusService;
  readonly tw: TaskWorkflowService;
  readonly closer: RecordingCloser;
  readonly step: IssueCloseOnArchive;
}

async function buildWorld(): Promise<World> {
  const store = new InMemoryStore();
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const tw = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  const closer = new RecordingCloser();
  const step = new IssueCloseOnArchive(store, closer, "acme/widget", () => NOW);
  cs.setArchiveIssueClosePort(step);
  tw.setArchiveIssueClosePort(step);
  await must(cs.create({ type: "prd", title: "Root PRD", content: "root" } as CreateDocInput), "prd");
  return { store, cs, tw, closer, step };
}

/** A filed report task (the shape `lore issue adopt` mints), GitHub #N unless `github: false`. */
async function createReportTask(
  w: World,
  opts: { number?: number; github?: boolean; explicit?: string } = {},
): Promise<DocRecord> {
  const number = opts.number ?? 9;
  return must(
    w.cs.create({
      type: "task",
      title: `Filed defect ${number}`,
      extra: {
        adhoc: true,
        issue_report: {
          reporter_project: "consumer",
          reporter_actor: "agent:x",
          lore_version: "0.0.0",
          expected: "exit 0",
          actual: "exit 4",
          reported_at: "2026-01-01T00:00:00.000Z",
          ...(opts.github === false ? {} : { github: { repo: "acme/widget", number, repo_id: 123 } }),
          ...(opts.explicit !== undefined
            ? { resolution: { state: opts.explicit, reason: "r", resolved_at: NOW, resolved_by: "t" } }
            : {}),
        },
      },
    } as CreateDocInput),
    "report task",
  );
}

async function passEvidence(w: World, taskId: string): Promise<void> {
  await must(
    w.tw.recordVerifiedEvidence(
      taskId,
      {
        oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_by: "runner",
        capture_source: "runner",
        attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
      },
      NOW,
    ),
    "evidence",
  );
}

async function completeWithDone(w: World, task: DocRecord) {
  await passEvidence(w, task.id);
  return must(w.tw.done(task.id, { by: "alice" }), "done");
}

async function activate(w: World, id: string): Promise<void> {
  await must(w.cs.set(id, { status: "approved" }), "approve");
  await must(w.cs.set(id, { status: "active" }), "activate");
}

async function sweepArchive(w: World, task: DocRecord): Promise<void> {
  await activate(w, task.id);
  const doc = await must(w.cs.get(task.id), "get");
  await must(w.cs.archiveSweepCandidate(doc.doc, "done_plan_straggler", "plan closed"), "sweep");
}

describe("AC-IT-1 (a): lore done on a report's own task closes its issue", () => {
  it("close once, comment naming the task, then label resolution:closed — and says so", async () => {
    const w = await buildWorld();
    const task = await createReportTask(w);

    const done = await completeWithDone(w, task);

    expect(w.closer.writes).toEqual([
      "close:9",
      `comment:9:Fixed by task ${task.slug} (completed 2026-10-12)`,
      "label:9:resolution:closed",
    ]);
    expect(done.issue_close?.map((item) => item.kind)).toEqual(["closed"]);
    expect(done.issue_close?.[0]?.message).toContain(`issue #9: closed on GitHub (fixed by ${task.slug})`);
  });
});

describe("AC-IT-1 (b): any other archive path is not a completion", () => {
  it("the archive sweep closes nothing and comments nothing", async () => {
    const w = await buildWorld();
    const task = await createReportTask(w);

    await sweepArchive(w, task);

    expect(w.closer.writes).toEqual([]);
  });

  it("a plain status change to archived closes nothing", async () => {
    const w = await buildWorld();
    const task = await createReportTask(w);
    await activate(w, task.id);

    await must(w.cs.set(task.id, { status: "archived" }), "archive");

    expect(w.closer.writes).toEqual([]);
  });

  it("an explicit wontfix verdict outranks completion: done closes nothing", async () => {
    const w = await buildWorld();
    const task = await createReportTask(w, { explicit: "wontfix" });

    const done = await completeWithDone(w, task);

    expect(w.closer.writes).toEqual([]);
    expect(done.issue_close ?? []).toEqual([]);
  });
});

describe("AC-IT-1 (c): a GitHub failure never undoes the archive", () => {
  it("task stays archived, one issue_close_failed audit row, the result names the failure", async () => {
    const w = await buildWorld();
    w.closer.closeError = { code: "VALIDATION_ERROR", field: "gh", message: "HTTP 502", value: "502" };
    const task = await createReportTask(w);

    const done = await completeWithDone(w, task);

    expect(done.task.status).toBe("archived");
    const failure = done.issue_close?.find((item) => item.kind === "close_failed");
    expect(failure?.stream).toBe("stderr");
    expect(failure?.message).toContain("HTTP 502");
    const rows = await must(w.store.queryAudit({ doc_id: task.id, action: ISSUE_CLOSE_FAILED_AUDIT_ACTION }), "audit");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.details).toMatchObject({ issue: 9, step: "close" });
  });
});

describe("AC-IT-1 (d)(e): boundaries", () => {
  it("(d) no github ref: no call, the result says it is local-only", async () => {
    const w = await buildWorld();
    const task = await createReportTask(w, { github: false });

    const done = await completeWithDone(w, task);

    expect(w.closer.calls).toEqual([]);
    expect(done.issue_close?.map((item) => item.kind)).toEqual(["no_github_ref"]);
  });

  it("(e) already closed: no-op success, no second comment", async () => {
    const w = await buildWorld();
    w.closer.closedNumbers.add(9);
    const task = await createReportTask(w);

    const done = await completeWithDone(w, task);

    expect(done.issue_close?.map((item) => item.kind)).toEqual(["already_closed"]);
    expect(w.closer.writes.some((call) => call.startsWith("comment:"))).toBe(false);
  });
});

describe("AC-IT-1 (f): sync closes a done-archived report, only labels a sweep-archived one", () => {
  it("repairs the failed close of the done report; the swept report is labelled and stays open", async () => {
    const w = await buildWorld();
    w.closer.closeError = { code: "VALIDATION_ERROR", field: "gh", message: "HTTP 502", value: "502" };
    const doneTask = await createReportTask(w, { number: 9 });
    await completeWithDone(w, doneTask);
    const sweptTask = await createReportTask(w, { number: 10 });
    await sweepArchive(w, sweptTask);

    const planned = await w.step.planSync();
    expect(planned.kind).toBe("planned");
    if (planned.kind !== "planned") return;
    const bySlug = new Map(planned.plan.drift.map((entry) => [entry.slug, entry]));
    expect(bySlug.get(doneTask.slug)?.completed_via_done).toBe(true);
    expect(bySlug.get(sweptTask.slug)?.completed_via_done).toBeUndefined();

    w.closer.closeError = undefined;
    w.closer.calls.length = 0;
    const outcome = await w.step.applySync();

    expect(outcome.kind).toBe("planned");
    expect(w.closer.calls.filter((call) => call.startsWith("close:"))).toEqual(["close:9"]);
    expect(w.closer.calls).toContain("label:9:resolution:closed");
    expect(w.closer.calls).toContain("label:10:resolution:closed");
    expect(w.closer.closedNumbers.has(10)).toBe(false);
  });
});
