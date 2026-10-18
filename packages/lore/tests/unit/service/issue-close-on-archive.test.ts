/**
 * AC-IC-1 — the post-archive step that closes the GitHub issue of every defect report a just-archived
 * spec / plan / task resolves (spec-archiving-the-work-that-resolves-a-defect-report-closes D1-D4, D6).
 *
 * Real services over InMemoryStore + a RECORDING FAKE `IssueCloser` — nothing here can reach GitHub.
 *   HAPPY:      plan close, `lore done`, archive sweep and the plan-close cascade each close the issue.
 *   NEGATIVE:   an explicit `wontfix` verdict, an active-only source and a link-less doc close nothing.
 *   ERROR:      close / label / comment failures keep the archive, are audited and reported.
 *   BOUNDARY:   already-closed issue, absent closer, local-only report, two archived sources.
 *   STATE:      the issue task's own status and version are never changed.
 *   REGRESSION: mutation "call the step only from CorpusService.set" is caught by the done / sweep cases.
 */

import { describe, expect, it } from "vitest";
import { err, ok } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";

import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import {
  IssueCloseOnArchive,
  ISSUE_CLOSE_FAILED_AUDIT_ACTION,
} from "../../../src/service/issue-close-on-archive.js";
import type { GithubIssueSnapshot, IssueCloser } from "../../../src/service/issue-closer-port.js";
import type { GithubIssueRef } from "../../../src/service/resolution-projector.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { actedStore } from "../../live-invocation.js";

const NOW = "2026-10-12T10:00:00.000Z";

/** Recording fake — the ONLY GitHub surface any test in this file touches. */
class RecordingCloser implements IssueCloser {
  readonly calls: string[] = [];
  state: "open" | "closed" = "open";
  closeError: LoreError | undefined;
  commentError: LoreError | undefined;
  labelError: LoreError | undefined;

  async readIssue(ref: GithubIssueRef): Promise<Result<GithubIssueSnapshot, LoreError>> {
    this.calls.push(`read:${ref.issueNumber}`);
    return ok({ state: this.state, labels: [] });
  }
  async closeIssue(ref: GithubIssueRef): Promise<Result<{ alreadyClosed: boolean }, LoreError>> {
    this.calls.push(`close:${ref.issueNumber}@${ref.repo}`);
    if (this.state === "closed") return ok({ alreadyClosed: true });
    if (this.closeError !== undefined) return err(this.closeError);
    this.state = "closed";
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
}

function transportError(message: string): LoreError {
  return { code: "VALIDATION_ERROR", field: "gh", message, value: message };
}

interface World {
  readonly store: InMemoryStore;
  readonly cs: CorpusService;
  readonly tw: TaskWorkflowService;
  readonly closer: RecordingCloser;
  readonly reportId: string;
  readonly reportSlug: string;
}

async function must<T>(promise: Promise<Result<T, LoreError>>, what: string): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error(`${what}: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Builds services, a filed report for GitHub #7, and wires the step into BOTH services. */
async function buildWorld(opts: { closer?: RecordingCloser | null; github?: boolean; explicit?: string } = {}): Promise<World> {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const tw = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  const closer = opts.closer === null ? undefined : (opts.closer ?? new RecordingCloser());
  const step = new IssueCloseOnArchive(store, closer, closer === undefined ? undefined : "acme/widget", () => NOW);
  cs.setArchiveIssueClosePort(step);
  tw.setArchiveIssueClosePort(step);

  await must(cs.create({ type: "prd", title: "Root PRD", content: "root" } as CreateDocInput), "prd");
  const report = await must(
    cs.create({
      type: "task",
      title: "Filed defect",
      extra: {
        adhoc: true,
        issue_report: {
          reporter_project: "consumer",
          reporter_actor: "agent:x",
          lore_version: "0.0.0",
          expected: "exit 0",
          actual: "exit 4",
          reported_at: "2026-01-01T00:00:00.000Z",
          ...(opts.github === false ? {} : { github: { repo: "acme/widget", number: 7, repo_id: 123 } }),
          ...(opts.explicit !== undefined
            ? { resolution: { state: opts.explicit, reason: "r", resolved_at: NOW, resolved_by: "t" } }
            : {}),
        },
      },
    } as CreateDocInput),
    "report",
  );
  return { store, cs, tw, closer: closer ?? new RecordingCloser(), reportId: report.id, reportSlug: report.slug };
}

async function createPlan(w: World, title: string, content = "body"): Promise<DocRecord> {
  return must(w.cs.create({ type: "plan", title, content } as CreateDocInput), "plan");
}

async function createTask(w: World, plan: DocRecord, title: string): Promise<DocRecord> {
  return must(
    w.cs.create({
      type: "task", title, parent_id: plan.id, content: "body", extra: { plan_id: plan.id },
    } as CreateDocInput),
    "task",
  );
}

async function resolvesLink(w: World, fromId: string): Promise<void> {
  await must(w.cs.link(fromId, w.reportId, "resolves"), "link");
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

async function expectReportUntouched(w: World, before: DocRecord): Promise<void> {
  const after = await must(w.cs.get(w.reportId), "get report");
  expect(after.doc.status).toBe(before.status);
  expect(after.doc.version).toBe(before.version);
}

async function snapshotReport(w: World): Promise<DocRecord> {
  return (await must(w.cs.get(w.reportId), "get report")).doc;
}

const FIXED_COMMENT = (type: string, slug: string): string => `comment:7:Fixed by ${type} ${slug} (archived 2026-10-12)`;

describe("AC-IC-1 (a): archiving a plan that resolves a filed report closes its issue", () => {
  it("calls close once, then comment naming the plan, then label resolution:fixed — and says so", async () => {
    const w = await buildWorld();
    const before = await snapshotReport(w);
    const plan = await createPlan(w, "Fix the defect");
    await resolvesLink(w, plan.id);

    const archived = await archivePlan(w, plan);

    expect(w.closer.calls.filter((c) => !c.startsWith("read:"))).toEqual([
      "close:7@acme/widget",
      FIXED_COMMENT("plan", plan.slug),
      "label:7:resolution:fixed",
    ]);
    expect(archived.issueClose?.map((i) => i.message)).toContain(`issue #7: closed on GitHub (fixed by ${plan.slug})`);
    expect(archived.issueClose?.find((i) => i.kind === "closed")?.stream).toBe("stdout");
    await expectReportUntouched(w, before); // (k)
  });

  it("a spec archived through set closes it the same way", async () => {
    const w = await buildWorld();
    const spec = await must(w.cs.create({ type: "spec", title: "Spec fix", content: "body" } as CreateDocInput), "spec");
    await resolvesLink(w, spec.id);
    // reason: approving a spec runs the rule-citation gate, which is not what this test is about — put the
    // spec at `active` directly in the store, then archive it through the real CorpusService.set path.
    await must(w.store.update(spec.id, { status: "active", version: spec.version + 1 }, { expected_version: spec.version }), "activate");
    const archived = await must(w.cs.set(spec.id, { status: "archived" }), "archive");
    expect(archived.issueClose?.map((i) => i.kind)).toEqual(["closed"]);
    expect(w.closer.calls).toContain("close:7@acme/widget");
    expect(w.closer.calls).toContain(FIXED_COMMENT("spec", spec.slug));
  });
});

describe("AC-IC-1 (b): every archive path reaches the step", () => {
  it("TaskWorkflowService.done on a task that resolves the report", async () => {
    const w = await buildWorld();
    const before = await snapshotReport(w);
    const plan = await createPlan(w, "Plan for done");
    const task = await createTask(w, plan, "Fixer task");
    await resolvesLink(w, task.id);
    await passEvidence(w, task.id);

    const done = await must(w.tw.done(task.id, { by: "alice" }), "done");

    expect(done.issue_close?.map((i) => i.kind)).toEqual(["closed"]);
    expect(w.closer.calls).toContain("close:7@acme/widget");
    expect(w.closer.calls).toContain(FIXED_COMMENT("task", task.slug));
    expect(w.closer.calls).toContain("label:7:resolution:fixed");
    await expectReportUntouched(w, before);
  });

  it("the archive sweep (lore archive --apply) — archiveSweepCandidate", async () => {
    const w = await buildWorld();
    const plan = await createPlan(w, "Plan for sweep");
    const task = await createTask(w, plan, "Straggler fixer");
    await resolvesLink(w, task.id);
    await activate(w, task.id);
    const doc = await must(w.cs.get(task.id), "get task");

    const swept = await must(w.cs.archiveSweepCandidate(doc.doc, "done_plan_straggler", "plan closed"), "sweep");

    expect(swept.issueClose?.map((i) => i.kind)).toEqual(["closed"]);
    expect(w.closer.calls).toContain(FIXED_COMMENT("task", task.slug));
  });

  it("the plan-close cascade archives a member task that resolves the report", async () => {
    const w = await buildWorld();
    const plan = await createPlan(w, "Plan with cascade");
    const task = await createTask(w, plan, "Cascaded fixer");
    await resolvesLink(w, task.id);
    await activate(w, task.id);

    const archived = await archivePlan(w, plan);

    expect(archived.cascade?.archived.map((a) => a.slug)).toContain(task.slug);
    expect(w.closer.calls).toContain(FIXED_COMMENT("task", task.slug));
    expect(archived.issueClose?.some((i) => i.kind === "closed")).toBe(true);
  });
});

describe("AC-IC-1 (c)(d)(j): GitHub failures never undo the archive", () => {
  it("(c) close failure: plan stays archived, one issue_close_failed audit row with number and error, result names it", async () => {
    const w = await buildWorld();
    w.closer.closeError = transportError("HTTP 502 bad gateway");
    const plan = await createPlan(w, "Plan close fails");
    await resolvesLink(w, plan.id);

    const archived = await archivePlan(w, plan);

    expect(archived.status).toBe("archived");
    expect(w.closer.calls.some((c) => c.startsWith("comment:"))).toBe(false);
    const failure = archived.issueClose?.find((i) => i.kind === "close_failed");
    expect(failure?.stream).toBe("stderr");
    expect(failure?.message).toContain("#7");
    expect(failure?.message).toContain("HTTP 502 bad gateway");
    expect(failure?.message).toContain("lore issues --sync");
    const audit = await must(w.store.queryAudit({ action: ISSUE_CLOSE_FAILED_AUDIT_ACTION }), "audit");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toMatchObject({ issue: 7, step: "close", error: "HTTP 502 bad gateway" });
    expect((await must(w.cs.get(plan.id), "get plan")).doc.status).toBe("archived");
  });

  it("(d) label failure after a successful close: close kept, failure reported and audited", async () => {
    const w = await buildWorld();
    w.closer.labelError = transportError("HTTP 403 forbidden");
    const plan = await createPlan(w, "Plan label fails");
    await resolvesLink(w, plan.id);

    const archived = await archivePlan(w, plan);

    expect(w.closer.state).toBe("closed");
    const kinds = archived.issueClose?.map((i) => i.kind);
    expect(kinds).toContain("closed");
    expect(kinds).toContain("label_failed");
    expect(archived.issueClose?.find((i) => i.kind === "label_failed")?.message).toContain("HTTP 403 forbidden");
    const audit = await must(w.store.queryAudit({ action: ISSUE_CLOSE_FAILED_AUDIT_ACTION }), "audit");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.details).toMatchObject({ issue: 7, step: "label" });
  });

  it("(j) comment failure after a successful close: close kept, comment failure reported, label still attempted", async () => {
    const w = await buildWorld();
    w.closer.commentError = transportError("HTTP 500 on comment");
    const plan = await createPlan(w, "Plan comment fails");
    await resolvesLink(w, plan.id);

    const archived = await archivePlan(w, plan);

    expect(w.closer.state).toBe("closed");
    expect(archived.issueClose?.map((i) => i.kind)).toEqual(["closed", "comment_failed"]);
    expect(w.closer.calls).toContain("label:7:resolution:fixed");
  });
});

describe("AC-IC-1 (e)(f)(g): absent closer, local-only report, already-closed issue", () => {
  it("(e) closer absent: archive committed, one line says GitHub is not configured and names --sync", async () => {
    const w = await buildWorld({ closer: null });
    const plan = await createPlan(w, "Plan no closer");
    await resolvesLink(w, plan.id);

    const archived = await archivePlan(w, plan);

    expect(archived.status).toBe("archived");
    const notConfigured = archived.issueClose?.filter((i) => i.kind === "not_configured") ?? [];
    expect(notConfigured).toHaveLength(1);
    expect(notConfigured[0]?.message).toContain("GitHub not configured");
    expect(notConfigured[0]?.message).toContain("lore issues --sync");
  });

  it("(f) a report without a github ref: no close call, the result says so", async () => {
    const w = await buildWorld({ github: false });
    const plan = await createPlan(w, "Plan local report");
    await resolvesLink(w, plan.id);

    const archived = await archivePlan(w, plan);

    expect(w.closer.calls).toEqual([]);
    expect(archived.issueClose?.map((i) => i.kind)).toEqual(["no_github_ref"]);
  });

  it("(g) an issue already closed on GitHub is a no-op success: no comment, no failure", async () => {
    const w = await buildWorld();
    w.closer.state = "closed";
    const plan = await createPlan(w, "Plan already closed");
    await resolvesLink(w, plan.id);

    const archived = await archivePlan(w, plan);

    expect(archived.issueClose?.map((i) => i.kind)).toEqual(["already_closed"]);
    expect(w.closer.calls.some((c) => c.startsWith("comment:"))).toBe(false);
    expect(await must(w.store.queryAudit({ action: ISSUE_CLOSE_FAILED_AUDIT_ACTION }), "audit")).toHaveLength(0);
  });

  it("two archived documents both resolving #7: the first closes, the second is a no-op", async () => {
    const w = await buildWorld();
    const first = await createPlan(w, "First fixer");
    const second = await createPlan(w, "Second fixer");
    await resolvesLink(w, first.id);
    await resolvesLink(w, second.id);

    const a = await archivePlan(w, first);
    const b = await archivePlan(w, second);

    expect(a.issueClose?.map((i) => i.kind)).toEqual(["closed"]);
    expect(b.issueClose?.map((i) => i.kind)).toEqual(["already_closed"]);
    expect(w.closer.calls.filter((c) => c.startsWith("comment:"))).toHaveLength(1);
  });
});

describe("AC-IC-1 (h): prose says 'closes #N' but no resolves link exists", () => {
  it("warns on stderr naming N and the exact lore link command", async () => {
    const w = await buildWorld();
    const plan = await createPlan(w, "Prose only", "This plan closes #7 once shipped.");

    const archived = await archivePlan(w, plan);

    const warning = archived.issueClose?.find((i) => i.kind === "unlinked_prose");
    expect(warning?.stream).toBe("stderr");
    expect(warning?.message).toContain("#7");
    expect(warning?.message).toContain(`lore link ${plan.slug} ${w.reportSlug} --type resolves`);
    expect(w.closer.calls).toEqual([]);
  });

  it("NEGATIVE: no warning when the document already carries the link, and none for a number that is no filed report", async () => {
    const w = await buildWorld();
    const linked = await createPlan(w, "Linked prose", "This fixes #7.");
    await resolvesLink(w, linked.id);
    const archivedLinked = await archivePlan(w, linked);
    expect(archivedLinked.issueClose?.some((i) => i.kind === "unlinked_prose")).toBe(false);

    const other = await createPlan(w, "Other number", "Resolves #999 someday.");
    const archivedOther = await archivePlan(w, other);
    expect(archivedOther.issueClose?.some((i) => i.kind === "unlinked_prose")).toBe(false);
  });
});

describe("AC-IC-1 (i): only a report whose fix has LANDED (archived source) is closed", () => {
  it("a report whose only resolving source is active is not closed when an unrelated doc is archived", async () => {
    const w = await buildWorld();
    const fixer = await createPlan(w, "Active fixer");
    await resolvesLink(w, fixer.id);
    await activate(w, fixer.id);
    const unrelated = await createPlan(w, "Unrelated");

    const archived = await archivePlan(w, unrelated);

    expect(w.closer.calls).toEqual([]);
    expect(archived.issueClose).toEqual([]);
  });

  it("an explicit wontfix verdict outranks the link: archiving the linked plan closes nothing", async () => {
    const w = await buildWorld({ explicit: "wontfix" });
    const plan = await createPlan(w, "Fixer of a wontfix");
    await resolvesLink(w, plan.id);

    const archived = await archivePlan(w, plan);

    expect(w.closer.calls).toEqual([]);
    expect(archived.issueClose).toEqual([]);
  });
});

describe("AC-IC-1 REGRESSION: an App without the port behaves as before", () => {
  it("a bare CorpusService archives a plan with no issueClose field", async () => {
    const store = actedStore(new InMemoryStore());
    const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const plan = await must(cs.create({ type: "plan", title: "Bare", content: "b" } as CreateDocInput), "plan");
    await must(cs.set(plan.id, { status: "approved" }), "approve");
    await must(cs.set(plan.id, { status: "active" }), "activate");
    const archived = await must(cs.set(plan.id, { status: "archived" }), "archive");
    expect(archived.issueClose).toBeUndefined();
  });
});
