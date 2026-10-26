/**
 * @task task-skill-refactor-gs-t4-close-on-archive-keyed-on-carriers
 *
 * Unit companion of the carrier-close oracle (owned by integration/cli/issue-close-on-archive-carrier.bun.test.ts).
 * The post-archive step closes every GitHub issue a just-archived CARRIER names in `extra.issues`.
 * Real services over InMemoryStore + a RECORDING FAKE `IssueCloser` — nothing here can reach GitHub.
 *   HAPPY:      plan close, `lore done`, archive sweep and the plan-close cascade each close ALL named issues.
 *   NEGATIVE:   a task with no carrier, a verdict-closed issue, a doc type that is no carrier touch nothing.
 *   ERROR:      read / close / comment / label failures keep the archive, are audited and reported, and never
 *               stop the issues after the failing one.
 *   BOUNDARY:   absent closer, already-completed issue, malformed `extra.issues` entry, no configured repo.
 *   STATE:      the step never writes the carrier (version unchanged by the step itself).
 *   REGRESSION: mutation "read only extra.issues[0]" is caught by every multi-issue case.
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
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
const NOW = "2026-10-12T10:00:00.000Z";
const REPO_ID = 123;
const REPO = "acme/widget";

/** Recording fake — the ONLY GitHub surface any test in this file touches. Issue state is per number. */
class RecordingCloser implements IssueCloser {
  readonly calls: string[] = [];
  readonly issues = new Map<number, GithubIssueSnapshot>();
  readError = new Map<number, LoreError>();
  closeError = new Map<number, LoreError>();
  commentError: LoreError | undefined;
  labelError: LoreError | undefined;

  seed(number: number, snapshot: GithubIssueSnapshot): void {
    this.issues.set(number, snapshot);
  }
  private snapshotOf(number: number): GithubIssueSnapshot {
    return this.issues.get(number) ?? { state: "open", stateReason: null, labels: [] };
  }

  async readIssue(ref: GithubIssueRef): Promise<Result<GithubIssueSnapshot, LoreError>> {
    this.calls.push(`read:${ref.issueNumber}`);
    const failure = this.readError.get(ref.issueNumber);
    if (failure !== undefined) return err(failure);
    return ok(this.snapshotOf(ref.issueNumber));
  }
  async closeIssue(ref: GithubIssueRef): Promise<Result<{ alreadyClosed: boolean }, LoreError>> {
    this.calls.push(`close:${ref.issueNumber}@${ref.repo}`);
    if (this.snapshotOf(ref.issueNumber).state === "closed") return ok({ alreadyClosed: true });
    const failure = this.closeError.get(ref.issueNumber);
    if (failure !== undefined) return err(failure);
    this.issues.set(ref.issueNumber, { state: "closed", stateReason: "completed", labels: [] });
    return ok({ alreadyClosed: false });
  }
  async commentIssue(ref: GithubIssueRef, body: string): Promise<Result<void, LoreError>> {
    this.calls.push(`comment:${ref.issueNumber}:${body}`);
    if (this.commentError !== undefined) return err(this.commentError);
    return ok(undefined);
  }
  async labelIssue(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>> {
    this.calls.push(`label:${ref.issueNumber}:${label}`);
    if (this.labelError !== undefined) return err(this.labelError);
    return ok(undefined);
  }
  async removeLabels(ref: GithubIssueRef, names: readonly string[]): Promise<Result<void, LoreError>> {
    this.calls.push(`unlabel:${ref.issueNumber}:${names.join(",")}`);
    return ok(undefined);
  }
  writes(): string[] {
    return this.calls.filter((call) => !call.startsWith("read:"));
  }
}

function transportError(message: string): LoreError {
  return { code: "VALIDATION_ERROR", field: "gh", message, value: message };
}

interface World {
  readonly store: InMemoryStore;
  readonly cs: CorpusService;
  readonly tw: TaskWorkflowService;
  readonly closer: RecordingCloser;
}

async function must<T>(promise: Promise<Result<T, LoreError>>, what: string): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(`${what}: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Services over one store with the step wired into BOTH, as `app.ts` does. */
async function buildWorld(opts: { closer?: RecordingCloser | null; repo?: string | null } = {}): Promise<World> {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const tw = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  const closer = opts.closer === null ? undefined : (opts.closer ?? new RecordingCloser());
  const repo = opts.repo === null ? undefined : (opts.repo ?? REPO);
  const step = new IssueCloseOnArchive(store, closer, repo, () => NOW);
  cs.setArchiveIssueClosePort(step);
  tw.setArchiveIssueClosePort(step);
  await must(cs.create({ type: "prd", title: "Root PRD", content: "root" } as CreateDocInput), "prd");
  return { store, cs, tw, closer: closer ?? new RecordingCloser() };
}

const refsOf = (...numbers: number[]): Array<{ repo_id: number; number: number }> =>
  numbers.map((number) => ({ repo_id: REPO_ID, number }));

async function createPlan(w: World, title: string, issues?: number[]): Promise<DocRecord> {
  return must(
    w.cs.create({
      type: "plan", title, content: "body", ...(issues === undefined ? {} : { extra: { issues: refsOf(...issues) } }),
    } as CreateDocInput),
    "plan",
  );
}

async function createTask(w: World, plan: DocRecord, title: string, issues?: number[]): Promise<DocRecord> {
  return must(
    w.cs.create({
      type: "task", title, parent_id: plan.id, content: "body",
      extra: { plan_id: plan.id, ...(issues === undefined ? {} : { issues: refsOf(...issues) }) },
    } as CreateDocInput),
    "task",
  );
}

async function activate(w: World, id: string): Promise<void> {
  await must(w.cs.set(id, { status: "approved" }), "approve");
  await must(w.cs.set(id, { status: "active" }), "activate");
}

async function archivePlan(w: World, plan: DocRecord) {
  await activate(w, plan.id);
  return must(w.cs.set(plan.id, { status: "archived" }), "archive plan");
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

const FIXED_COMMENT = (n: number, type: string, slug: string): string => `comment:${n}:Fixed by ${type} ${slug} (archived 2026-10-12)`;

describe("carrier close (a): archiving a plan carrier closes EVERY named issue", () => {
  it("three issues: close, then comment naming the plan, then label resolution:fixed — for each, in declared order", async () => {
    const w = await buildWorld();
    const plan = await createPlan(w, "Fix three", [11, 12, 13]);

    const archived = await archivePlan(w, plan);

    expect(w.closer.writes()).toEqual(
      [11, 12, 13].flatMap((n) => [`close:${n}@${REPO}`, FIXED_COMMENT(n, "plan", plan.slug), `label:${n}:resolution:fixed`]),
    );
    expect(archived.issueClose?.map((i) => i.message)).toEqual(
      [11, 12, 13].map((n) => `issue #${n}: closed on GitHub (fixed by ${plan.slug})`),
    );
    expect(archived.issueClose?.every((i) => i.stream === "stdout")).toBe(true);
  });

  it("the written repo is the configured upstream, not anything derived from repo_id", async () => {
    const w = await buildWorld({ repo: "renamed/widget" });
    const plan = await createPlan(w, "Fix renamed", [11]);
    await archivePlan(w, plan);
    expect(w.closer.calls).toContain("close:11@renamed/widget");
  });
});

describe("carrier close (b): every archive path reaches the step", () => {
  it("TaskWorkflowService.done on a task carrier closes all its issues", async () => {
    const w = await buildWorld();
    const plan = await createPlan(w, "Plan for done");
    const task = await createTask(w, plan, "Carrier task", [11, 12]);
    await passEvidence(w, task.id);

    const done = await must(w.tw.done(task.id, { by: "alice" }), "done");

    expect(done.issue_close?.map((i) => i.kind)).toEqual(["closed", "closed"]);
    expect(w.closer.writes()).toContain(FIXED_COMMENT(11, "task", task.slug));
    expect(w.closer.writes()).toContain(FIXED_COMMENT(12, "task", task.slug));
    expect(w.closer.writes()).toContain("label:12:resolution:fixed");
  });

  it("the archive sweep (archiveSweepCandidate) on a task carrier", async () => {
    const w = await buildWorld();
    const plan = await createPlan(w, "Plan for sweep");
    const task = await createTask(w, plan, "Straggler carrier", [11, 12]);
    await activate(w, task.id);
    const doc = await must(w.cs.get(task.id), "get task");

    const swept = await must(w.cs.archiveSweepCandidate(doc.doc, "done_plan_straggler", "plan closed"), "sweep");

    expect(swept.issueClose?.map((i) => i.kind)).toEqual(["closed", "closed"]);
  });

  it("the plan-close cascade archives a member task carrier and closes its issues", async () => {
    const w = await buildWorld();
    const plan = await createPlan(w, "Plan with cascade");
    const task = await createTask(w, plan, "Cascaded carrier", [11, 12]);
    await activate(w, task.id);

    const archived = await archivePlan(w, plan);

    expect(archived.cascade?.archived.map((a) => a.slug)).toContain(task.slug);
    expect(w.closer.writes()).toContain(FIXED_COMMENT(12, "task", task.slug));
  });
});

describe("carrier close (c): an issue already closed with a verdict is skipped, and only that issue", () => {
  it("not_planned + resolution:rejected: no write at all, a stdout line says closed as rejected; the others still close", async () => {
    const w = await buildWorld();
    w.closer.seed(13, { state: "closed", stateReason: "not_planned", labels: ["resolution:rejected"] });
    const plan = await createPlan(w, "Mixed", [11, 12, 13]);

    const archived = await archivePlan(w, plan);

    expect(w.closer.writes().filter((call) => call.includes(":13") || call.includes("close:13"))).toEqual([]);
    const skipped = archived.issueClose?.find((i) => i.kind === "skipped_verdict");
    expect(skipped?.message).toBe("issue #13 skipped: closed as rejected");
    expect(skipped?.stream).toBe("stdout");
    expect(w.closer.writes()).toContain("close:12@acme/widget");
  });

  it.each([
    ["wontfix", "not_planned", ["resolution:wontfix"]],
    ["superseded", "not_planned", ["resolution:superseded"]],
    ["duplicate", "duplicate", []],
    ["not planned", "not_planned", ["bug"]],
  ])("a %s close is skipped (state_reason %s, labels %j)", async (verdict, stateReason, labels) => {
    const w = await buildWorld();
    w.closer.seed(11, { state: "closed", stateReason, labels });
    const plan = await createPlan(w, "Verdict", [11]);

    const archived = await archivePlan(w, plan);

    expect(w.closer.writes()).toEqual([]);
    expect(archived.issueClose?.map((i) => i.message)).toEqual([`issue #11 skipped: closed as ${verdict}`]);
  });

  it("an issue closed as completed is not a verdict: no second comment, the fixed label converges", async () => {
    const w = await buildWorld();
    w.closer.seed(11, { state: "closed", stateReason: "completed", labels: [] });
    const plan = await createPlan(w, "Already completed", [11]);

    const archived = await archivePlan(w, plan);

    expect(archived.issueClose?.map((i) => i.kind)).toEqual(["already_closed"]);
    expect(w.closer.writes().some((call) => call.startsWith("comment:"))).toBe(false);
    expect(w.closer.writes()).toContain("label:11:resolution:fixed");
  });
});

describe("carrier close (d): GitHub failures never undo the archive and never stop the next issue", () => {
  it("a failed close on #12: archive kept, ONE audit row naming #12, #11 and #13 still closed", async () => {
    const w = await buildWorld();
    w.closer.closeError.set(12, transportError("error connecting to api.github.com"));
    const plan = await createPlan(w, "Close fails", [11, 12, 13]);

    const archived = await archivePlan(w, plan);

    expect(archived.status).toBe("archived");
    expect(w.closer.writes()).toContain("close:11@acme/widget");
    expect(w.closer.writes()).toContain("close:13@acme/widget");
    expect(w.closer.writes().some((call) => call.startsWith("comment:12"))).toBe(false);
    const failure = archived.issueClose?.find((i) => i.kind === "close_failed");
    expect(failure?.stream).toBe("stderr");
    expect(failure?.message).toContain("#12");
    expect(failure?.message).toContain("lore issues --sync");
    const audit = await must(w.store.queryAudit({ action: ISSUE_CLOSE_FAILED_AUDIT_ACTION }), "audit");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toMatchObject({ issue: 12, step: "close", source: plan.slug });
  });

  it("a failed READ of #11: reported and audited as step read; #12 is still processed", async () => {
    const w = await buildWorld();
    w.closer.readError.set(11, transportError("HTTP 502"));
    const plan = await createPlan(w, "Read fails", [11, 12]);

    const archived = await archivePlan(w, plan);

    expect(archived.issueClose?.find((i) => i.kind === "read_failed")?.message).toContain("#11");
    expect(w.closer.writes()).toContain("close:12@acme/widget");
    const audit = await must(w.store.queryAudit({ action: ISSUE_CLOSE_FAILED_AUDIT_ACTION }), "audit");
    expect(audit.map((row) => row.details)).toEqual([expect.objectContaining({ issue: 11, step: "read" })]);
  });

  it("a label failure after a successful close: close kept, failure reported and audited", async () => {
    const w = await buildWorld();
    w.closer.labelError = transportError("HTTP 403 forbidden");
    const plan = await createPlan(w, "Label fails", [11]);

    const archived = await archivePlan(w, plan);

    expect(archived.issueClose?.map((i) => i.kind)).toEqual(["closed", "label_failed"]);
    const audit = await must(w.store.queryAudit({ action: ISSUE_CLOSE_FAILED_AUDIT_ACTION }), "audit");
    expect(audit[0]?.details).toMatchObject({ issue: 11, step: "label" });
  });

  it("a comment failure after a successful close: close kept, label still attempted", async () => {
    const w = await buildWorld();
    w.closer.commentError = transportError("HTTP 500 on comment");
    const plan = await createPlan(w, "Comment fails", [11]);

    const archived = await archivePlan(w, plan);

    expect(archived.issueClose?.map((i) => i.kind)).toEqual(["closed", "comment_failed"]);
    expect(w.closer.writes()).toContain("label:11:resolution:fixed");
  });
});

describe("carrier close (e): no carrier, no closer, no repo", () => {
  it("a task and a plan without extra.issues make no GitHub call and return no line", async () => {
    const w = await buildWorld();
    const plan = await createPlan(w, "Plain plan");
    const task = await createTask(w, plan, "Plain task");
    await passEvidence(w, task.id);

    const done = await must(w.tw.done(task.id, { by: "alice" }), "done");
    const archived = await archivePlan(w, plan);

    expect(w.closer.calls).toEqual([]);
    expect(done.issue_close).toEqual([]);
    expect(archived.issueClose).toEqual([]);
  });

  it("closer absent: archive committed, ONE line says GitHub is not configured and names --sync", async () => {
    const w = await buildWorld({ closer: null });
    const plan = await createPlan(w, "No closer", [11, 12]);

    const archived = await archivePlan(w, plan);

    expect(archived.status).toBe("archived");
    const lines = archived.issueClose ?? [];
    expect(lines.map((i) => i.kind)).toEqual(["not_configured"]);
    expect(lines[0]?.message).toContain("lore issues --sync");
  });

  it("closer wired but no upstream repo: one loud read_failed line, no GitHub call", async () => {
    const w = await buildWorld({ repo: null });
    const plan = await createPlan(w, "No repo", [11]);

    const archived = await archivePlan(w, plan);

    expect(w.closer.calls).toEqual([]);
    expect(archived.issueClose?.map((i) => i.kind)).toEqual(["read_failed"]);
    expect(archived.issueClose?.[0]?.stream).toBe("stderr");
  });

  it("a malformed extra.issues entry planted at store level is dropped; the valid entries still close", async () => {
    const w = await buildWorld();
    const plan = await createPlan(w, "Planted", [11]);
    const stored = await must(w.cs.get(plan.id), "get plan");
    await must(
      w.store.update(
        plan.id,
        { extra: { ...stored.doc.extra, issues: [{ repo_id: REPO_ID, number: 11 }, { repo_id: "x", number: 0 }, 7] }, version: stored.doc.version + 1 },
        { expected_version: stored.doc.version },
      ),
      "plant",
    );

    const archived = await archivePlan(w, plan);

    expect(archived.issueClose?.map((i) => i.kind)).toEqual(["closed"]);
  });
});

describe("carrier close REGRESSION: an App without the port behaves as before", () => {
  it("a bare CorpusService archives a plan carrier with no issueClose field", async () => {
    const store = actedStore(new InMemoryStore());
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const plan = await must(
      cs.create({ type: "plan", title: "Bare", content: "b", extra: { issues: refsOf(11) } } as CreateDocInput),
      "plan",
    );
    await must(cs.set(plan.id, { status: "approved" }), "approve");
    await must(cs.set(plan.id, { status: "active" }), "activate");
    const archived = await must(cs.set(plan.id, { status: "archived" }), "archive");
    expect(archived.issueClose).toBeUndefined();
  });
});
