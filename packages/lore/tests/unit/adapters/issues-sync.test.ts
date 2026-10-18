/**
 * AC-IC-4 (sync half) — `lore issues --sync [--apply] [--json]`
 * (spec-archiving-the-work-that-resolves-a-defect-report-closes D3). Real `IssueCloseOnArchive` over
 * InMemoryStore + a RECORDING FAKE closer; the render + exit-code half is driven through `runIssuesSync`.
 *   HAPPY:      drift (a) fixed + archived source with the issue open / label missing is listed and, with
 *               --apply, closed and labelled; drift (b) a terminal report missing its label is listed and
 *               only labelled.
 *   NEGATIVE:   a fixed report resting only on an ACTIVE source is NOT listed; a clean corpus lists nothing.
 *   BOUNDARY:   without --apply the closer is never asked to write and the exit is 0.
 *   ERROR:      any failed apply exits EXACTLY 1 and names the error in applied[].error; an unconfigured
 *               closer exits 1.
 *   REGRESSION: closing a (b) report would fail the never-closed assertion.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@lore/core";
import type { CreateDocInput, DocRecord, DocStatus, LoreError, Result } from "@lore/core";

import { runIssuesSync } from "../../../src/adapters/cli/issues-sync.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { IssueCloseOnArchive } from "../../../src/service/issue-close-on-archive.js";
import type { GithubIssueSnapshot, IssueCloser } from "../../../src/service/issue-closer-port.js";
import type { GithubIssueRef } from "../../../src/service/resolution-projector.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { actedStore, liveInvocation } from "../../live-invocation.js";

interface FakeIssue {
  state: "open" | "closed";
  labels: string[];
}

/** Recording fake — the only GitHub surface this file touches. */
class FakeGithub implements IssueCloser {
  readonly issues = new Map<number, FakeIssue>();
  readonly writes: string[] = [];
  readonly failClose = new Set<number>();

  async readIssue(ref: GithubIssueRef): Promise<Result<GithubIssueSnapshot, LoreError>> {
    const issue = this.issues.get(ref.issueNumber);
    if (issue === undefined) return err({ code: "VALIDATION_ERROR", field: "gh", message: `no #${ref.issueNumber}`, value: ref.issueNumber });
    return ok({ state: issue.state, labels: [...issue.labels] });
  }
  async closeIssue(ref: GithubIssueRef): Promise<Result<{ alreadyClosed: boolean }, LoreError>> {
    this.writes.push(`close:${ref.issueNumber}`);
    if (this.failClose.has(ref.issueNumber)) {
      return err({ code: "VALIDATION_ERROR", field: "gh", message: "HTTP 502", value: "502" });
    }
    const issue = this.issues.get(ref.issueNumber);
    if (issue === undefined) return err({ code: "VALIDATION_ERROR", field: "gh", message: "missing", value: 0 });
    const was = issue.state;
    issue.state = "closed";
    return ok({ alreadyClosed: was === "closed" });
  }
  async commentIssue(ref: GithubIssueRef): Promise<Result<void, LoreError>> {
    this.writes.push(`comment:${ref.issueNumber}`);
    return ok(undefined);
  }
  async labelIssue(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>> {
    this.writes.push(`label:${ref.issueNumber}:${label}`);
    this.issues.get(ref.issueNumber)?.labels.push(label);
    return ok(undefined);
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
  readonly github: FakeGithub;
  readonly step: IssueCloseOnArchive;
}

async function buildWorld(configured = true): Promise<World> {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const github = new FakeGithub();
  // reason: the step is deliberately NOT wired into `cs` — the drift this command repairs is exactly what
  // is left when an archive could not close the issue.
  const step = new IssueCloseOnArchive(store, configured ? github : undefined, configured ? "acme/widget" : undefined);
  await must(cs.create({ type: "prd", title: "Root PRD", content: "root" } as CreateDocInput), "prd");
  return { store, cs, github, step };
}

async function fileReport(
  w: World,
  number: number,
  gh: FakeIssue,
  opts: { explicit?: "wontfix" | "rejected"; archivedIssueTask?: boolean } = {},
): Promise<DocRecord> {
  const report = await must(
    w.cs.create({
      type: "task",
      title: `Defect ${number}`,
      extra: {
        adhoc: true,
        issue_report: {
          reporter_project: "consumer",
          reporter_actor: "agent:x",
          lore_version: "0.0.0",
          expected: "exit 0",
          actual: "exit 4",
          reported_at: "2026-01-01T00:00:00.000Z",
          github: { repo: "acme/widget", number, repo_id: 123 },
          ...(opts.explicit !== undefined
            ? { resolution: { state: opts.explicit, reason: "r", resolved_at: "2026-10-01T00:00:00.000Z", resolved_by: "t" } }
            : {}),
        },
      },
    } as CreateDocInput),
    "report",
  );
  w.github.issues.set(number, gh);
  if (opts.archivedIssueTask === true) await setStatus(w, report, "archived");
  return report;
}

async function setStatus(w: World, doc: DocRecord, status: DocStatus): Promise<void> {
  await must(w.store.update(doc.id, { status, version: doc.version + 1 }, { expected_version: doc.version }), "status");
}

/** A plan resolving `report` and sitting at `status` (written straight to the store — no archive step runs). */
async function resolver(w: World, report: DocRecord, title: string, status: DocStatus): Promise<void> {
  const plan = await must(w.cs.create({ type: "plan", title, content: "b" } as CreateDocInput), "plan");
  await must(w.cs.link(plan.id, report.id, "resolves"), "link");
  await setStatus(w, plan, status);
}

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logged.push(String(line));
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => vi.restoreAllMocks());

interface SyncJson {
  ok: boolean;
  data: {
    drift: Array<{ number: number; slug: string; computed: string; github_state: string; missing_label: boolean }>;
    applied?: Array<{ number: number; closed: boolean; labelled: boolean; error?: string }>;
  };
}

async function syncJson(w: World, apply: boolean): Promise<{ exit: number; json: SyncJson }> {
  logged = [];
  const exit = await runIssuesSync(liveInvocation(), w.step, { apply, json: true });
  return { exit, json: JSON.parse(logged.join("\n")) as SyncJson };
}

/** The standard mixed corpus: #1 drift(a) open+unlabelled, #2 drift(a) closed but unlabelled, #3 fixed+closed+labelled (clean),
 *  #4 fixed on an ACTIVE source only, #5 wontfix unlabelled, #6 closed-by-archive unlabelled, #7 wontfix already labelled. */
async function mixedCorpus(w: World): Promise<void> {
  const r1 = await fileReport(w, 1, { state: "open", labels: [] });
  await resolver(w, r1, "Fixer one", "archived");
  const r2 = await fileReport(w, 2, { state: "closed", labels: [] });
  await resolver(w, r2, "Fixer two", "archived");
  const r3 = await fileReport(w, 3, { state: "closed", labels: ["resolution:fixed"] });
  await resolver(w, r3, "Fixer three", "archived");
  const r4 = await fileReport(w, 4, { state: "open", labels: [] });
  await resolver(w, r4, "Fixer four", "active");
  await fileReport(w, 5, { state: "open", labels: [] }, { explicit: "wontfix" });
  await fileReport(w, 6, { state: "closed", labels: [] }, { archivedIssueTask: true });
  await fileReport(w, 7, { state: "open", labels: ["resolution:wontfix"] }, { explicit: "wontfix" });
}

describe("AC-IC-4: drift detection", () => {
  it("lists drift (a) and (b) exactly — and NOT a fixed report resting only on an active source, nor a clean one", async () => {
    const w = await buildWorld();
    await mixedCorpus(w);

    const { exit, json } = await syncJson(w, false);

    expect(exit).toBe(0);
    expect(json.ok).toBe(true);
    const byNumber = Object.fromEntries(json.data.drift.map((d) => [d.number, d]));
    expect(Object.keys(byNumber).sort()).toEqual(["1", "2", "5", "6"]);
    expect(byNumber[1]).toMatchObject({ computed: "fixed", github_state: "open", missing_label: true });
    expect(byNumber[2]).toMatchObject({ computed: "fixed", github_state: "closed", missing_label: true });
    expect(byNumber[5]).toMatchObject({ computed: "wontfix", missing_label: true });
    expect(byNumber[6]).toMatchObject({ computed: "closed", missing_label: true });
    expect(byNumber[4]).toBeUndefined(); // active-only source: the work has not landed
    expect(byNumber[3]).toBeUndefined();
    expect(byNumber[7]).toBeUndefined();
    expect(json.data.applied).toBeUndefined();
  });

  it("a fixed report whose issue is closed AND labelled is clean: 'sync: clean', exit 0", async () => {
    const w = await buildWorld();
    const r = await fileReport(w, 3, { state: "closed", labels: ["resolution:fixed"] });
    await resolver(w, r, "Fixer", "archived");

    const exit = await runIssuesSync(liveInvocation(), w.step, { apply: false, json: false });

    expect(exit).toBe(0);
    expect(logged.join("\n")).toContain("clean");
  });
});

describe("AC-IC-4: without --apply nothing is written", () => {
  it("the closer is never asked to write, the exit is 0", async () => {
    const w = await buildWorld();
    await mixedCorpus(w);

    const { exit } = await syncJson(w, false);

    expect(exit).toBe(0);
    expect(w.github.writes).toEqual([]);
  });
});

describe("AC-IC-4: --apply repairs", () => {
  it("(a) is closed and labelled, (b) is ONLY labelled and never closed; applied[] carries {number, closed, labelled}", async () => {
    const w = await buildWorld();
    await mixedCorpus(w);

    const { exit, json } = await syncJson(w, true);

    expect(exit).toBe(0);
    const applied = Object.fromEntries((json.data.applied ?? []).map((a) => [a.number, a]));
    expect(applied[1]).toEqual({ number: 1, closed: true, labelled: true });
    expect(applied[2]).toEqual({ number: 2, closed: false, labelled: true }); // already closed: only the label was missing
    expect(applied[5]).toEqual({ number: 5, closed: false, labelled: true });
    expect(applied[6]).toEqual({ number: 6, closed: false, labelled: true });
    // (b) never closed — the (b) reports are #5 and #6.
    expect(w.github.writes).not.toContain("close:5");
    expect(w.github.writes).not.toContain("close:6");
    expect(w.github.writes).toContain("close:1");
    expect(w.github.writes).toContain("label:1:resolution:fixed");
    expect(w.github.writes).toContain("label:5:resolution:wontfix");
    expect(w.github.issues.get(5)?.state).toBe("open");
    expect(w.github.issues.get(4)?.state).toBe("open"); // active-only source untouched

    // a second run finds nothing: the repair converged
    const again = await syncJson(w, false);
    expect(again.json.data.drift).toEqual([]);
  });

  it("any failed apply exits EXACTLY 1 and names the error in applied[].error; the other repairs still run", async () => {
    const w = await buildWorld();
    await mixedCorpus(w);
    w.github.failClose.add(1);

    const { exit, json } = await syncJson(w, true);

    expect(exit).toBe(1);
    expect(json.ok).toBe(false);
    const failed = json.data.applied?.find((a) => a.number === 1);
    expect(failed?.closed).toBe(false);
    expect(failed?.error).toContain("HTTP 502");
    expect(json.data.applied?.find((a) => a.number === 5)).toEqual({ number: 5, closed: false, labelled: true });
  });
});

describe("AC-IC-4: ERROR — no GitHub closer configured", () => {
  it("--sync exits 1 and says so on stderr (never a silent clean)", async () => {
    const w = await buildWorld(false);

    const exit = await runIssuesSync(liveInvocation(), w.step, { apply: false, json: false });

    expect(exit).toBe(1);
    expect(logged.join("\n")).not.toContain("clean");
  });

  it("an App with no step at all exits 1", async () => {
    expect(await runIssuesSync(liveInvocation(), undefined, { apply: false, json: false })).toBe(1);
  });
});
