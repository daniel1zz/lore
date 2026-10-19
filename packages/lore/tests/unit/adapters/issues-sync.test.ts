/**
 * `lore issues --sync [--json]` — the PUSH-ONLY repair
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D5). Real `IssueCloseOnArchive` over
 * InMemoryStore + a RECORDING FAKE closer, the COMPLETE listing handed in as data; the render + exit-code half is
 * driven through `runIssuesSync`. Moved here from the mirror model (`issue_report` seeds, `--apply`, drift rows):
 * the repair is now keyed on carriers (`extra.issues`) and always applies.
 *   HAPPY:      an open issue named by an archived carrier is closed, commented and labelled resolution:fixed; an
 *               open issue carrying a resolution:* label and no carrier has only the label removed.
 *   NEGATIVE:   a closed-and-labelled fixed issue, an open issue with a live carrier, a verdict-closed issue and
 *               an issue whose only carrier is deprecated get NO write.
 *   BOUNDARY:   a closed/completed issue with an archived carrier but no resolution:fixed label is only labelled,
 *               never touched otherwise.
 *   STATE:      nothing to repair prints `clean` and exits 0 with zero writes; planning alone writes nothing.
 *   ERROR:      the failing call's own kind decides the exit (transport 9, auth 8), the other repairs still run;
 *               an unconfigured closer exits 4; a missing driver exits 1.
 *   REGRESSION: `clean` is only reachable through a listing the caller already holds in full.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";

import { runIssuesSync } from "../../../src/adapters/cli/issues-sync.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { GithubListedIssue } from "../../../src/service/github-intake-port.js";
import { IssueCloseOnArchive, type IssueSyncListing } from "../../../src/service/issue-close-on-archive.js";
import type { GithubIssueSnapshot, IssueCloser } from "../../../src/service/issue-closer-port.js";
import type { GithubIssueRef } from "../../../src/service/resolution-projector.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { actedStore, liveInvocation } from "../../live-invocation.js";

const REPO_ID = 123;
const REPO = "acme/widget";

/** Recording fake — the only GitHub surface this file touches. */
class FakeGithub implements IssueCloser {
  readonly writes: string[] = [];
  readonly closeFailures = new Map<number, LoreError>();

  async readIssue(): Promise<Result<GithubIssueSnapshot, LoreError>> {
    return ok({ state: "open", stateReason: null, labels: [] });
  }
  async closeIssue(ref: GithubIssueRef): Promise<Result<{ alreadyClosed: boolean }, LoreError>> {
    this.writes.push(`close:${ref.issueNumber}@${ref.repo}`);
    const failure = this.closeFailures.get(ref.issueNumber);
    return failure === undefined ? ok({ alreadyClosed: false }) : err(failure);
  }
  async commentIssue(ref: GithubIssueRef): Promise<Result<void, LoreError>> {
    this.writes.push(`comment:${ref.issueNumber}`);
    return ok(undefined);
  }
  async labelIssue(ref: GithubIssueRef, label: string): Promise<Result<void, LoreError>> {
    this.writes.push(`label:${ref.issueNumber}:${label}`);
    return ok(undefined);
  }
  async removeLabels(ref: GithubIssueRef, names: readonly string[]): Promise<Result<void, LoreError>> {
    this.writes.push(`unlabel:${ref.issueNumber}:${names.join(",")}`);
    return ok(undefined);
  }
}

const transport: LoreError = { code: "TRANSPORT_UNAVAILABLE", message: "could not resolve host", retryable: true };
const auth: LoreError = { code: "AUTH_REQUIRED", message: "run gh auth login", retryable: false };

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
  const step = new IssueCloseOnArchive(store, configured ? github : undefined, configured ? REPO : undefined);
  await must(cs.create({ type: "prd", title: "Root PRD", content: "root" } as CreateDocInput), "prd");
  return { store, cs, github, step };
}

/** A task carrier naming `number`, optionally moved to `status` straight in the store (no archive step runs). */
async function carrier(w: World, number: number, status: "draft" | "archived" | "deprecated"): Promise<DocRecord> {
  const task = await must(
    w.cs.create({
      type: "task",
      title: `Carrier of ${number} (${status})`,
      content: "body",
      extra: { adhoc: true, issues: [{ repo_id: REPO_ID, number }] },
    } as CreateDocInput),
    "carrier",
  );
  if (status === "draft") return task;
  await must(w.store.update(task.id, { status, version: task.version + 1 }, { expected_version: task.version }), "status");
  return task;
}

const issue = (number: number, over: Partial<GithubListedIssue> = {}): GithubListedIssue => ({
  number,
  title: `Issue ${number}`,
  state: "open",
  body: "",
  labels: [],
  state_reason: null,
  ...over,
});

const listingOf = (...issues: GithubListedIssue[]): IssueSyncListing => ({ issues, repoId: REPO_ID });

let stdout: string[] = [];
let stderr: string[] = [];
beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    stdout.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as never);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    stderr.push(String(chunk).replace(/\n$/, ""));
    return true;
  }) as never);
});
afterEach(() => vi.restoreAllMocks());

interface SyncJson {
  ok: boolean;
  data: {
    clean: boolean;
    changes: Array<{ number: number; action: string }>;
    applied: Array<{ number: number; action: string; failed?: boolean }>;
  };
}

async function sync(w: World, listing: IssueSyncListing, json = true): Promise<number> {
  stdout = [];
  stderr = [];
  return await runIssuesSync(liveInvocation(), w.step, listing, { json });
}

describe("sync repairs GitHub from the carriers", () => {
  it("HAPPY: an open issue named by an archived carrier is closed, commented and labelled fixed, in that order", async () => {
    const w = await buildWorld();
    await carrier(w, 1, "archived");

    const exit = await sync(w, listingOf(issue(1)));

    expect(exit).toBe(0);
    expect(w.github.writes).toHaveLength(3);
    expect(w.github.writes[0]).toBe(`close:1@${REPO}`);
    expect(w.github.writes[1]).toBe("comment:1");
    expect(w.github.writes[2]).toBe("label:1:resolution:fixed");
    const json = JSON.parse(stdout.join("\n")) as SyncJson;
    expect(json.ok).toBe(true);
    expect(json.data.clean).toBe(false);
    expect(json.data.changes).toEqual([expect.objectContaining({ number: 1, action: "close" })]);
  });

  it("HAPPY: an open issue with resolution:* labels and no carrier has only those labels removed — never closed", async () => {
    const w = await buildWorld();

    const exit = await sync(w, listingOf(issue(2, { labels: ["resolution:adopted", "resolution:fixed", "bug"] })));

    expect(exit).toBe(0);
    expect(w.github.writes).toEqual(["unlabel:2:resolution:adopted,resolution:fixed"]);
  });

  it("BOUNDARY: a closed/completed issue with an archived carrier but no resolution:fixed label is only labelled", async () => {
    const w = await buildWorld();
    await carrier(w, 3, "archived");

    const exit = await sync(w, listingOf(issue(3, { state: "closed", state_reason: "completed" })));

    expect(exit).toBe(0);
    expect(w.github.writes).toEqual(["label:3:resolution:fixed"]);
  });

  it("NEGATIVE: fixed+labelled, live-carrier, verdict-closed and dead-carrier issues get NO write", async () => {
    const w = await buildWorld();
    await carrier(w, 4, "archived");
    await carrier(w, 5, "draft");
    await carrier(w, 6, "archived");
    await carrier(w, 7, "deprecated");

    const exit = await sync(
      w,
      listingOf(
        issue(4, { state: "closed", state_reason: "completed", labels: ["resolution:fixed"] }),
        issue(5),
        issue(6, { state: "closed", state_reason: "not_planned", labels: ["resolution:rejected"] }),
        issue(7),
      ),
    );

    expect(exit).toBe(0);
    expect(w.github.writes).toEqual([]);
  });
});

describe("sync says clean only for work it saw in full", () => {
  it("STATE: nothing to repair prints `clean`, exits 0 and writes nothing", async () => {
    const w = await buildWorld();

    const exit = await sync(w, listingOf(issue(1), issue(2, { state: "closed", state_reason: "completed" })), false);

    expect(exit).toBe(0);
    expect(stdout.join("\n")).toContain("clean");
    expect(w.github.writes).toEqual([]);
  });

  it("STATE: a run with changes never prints `clean`, and says what it did per issue", async () => {
    const w = await buildWorld();
    await carrier(w, 1, "archived");

    const exit = await sync(w, listingOf(issue(1)), false);

    expect(exit).toBe(0);
    expect(stdout.join("\n")).not.toContain("clean");
    expect(stdout.join("\n")).toContain("issue #1: closed on GitHub");
  });

  it("STATE: planning alone (planSync) writes nothing and names the change", async () => {
    const w = await buildWorld();
    await carrier(w, 1, "archived");

    const outcome = await w.step.planSync(listingOf(issue(1), issue(2, { labels: ["resolution:open"] })));

    expect(w.github.writes).toEqual([]);
    expect(outcome.kind).toBe("planned");
    if (outcome.kind !== "planned") return;
    expect(outcome.plan.changes.map((c) => [c.number, c.action])).toEqual([
      [1, "close"],
      [2, "strip_labels"],
    ]);
    expect(outcome.applied).toBeUndefined();
  });
});

describe("sync failure kinds decide the exit", () => {
  it("ERROR: a transport failure on one close exits 9 and the OTHER repairs still run", async () => {
    const w = await buildWorld();
    await carrier(w, 1, "archived");
    await carrier(w, 2, "archived");
    w.github.closeFailures.set(1, transport);

    const exit = await sync(w, listingOf(issue(1), issue(2)), false);

    expect(exit).toBe(9);
    expect(w.github.writes).toContain(`close:2@${REPO}`);
    expect(w.github.writes).toContain("label:2:resolution:fixed");
    expect(stderr.join("\n")).toContain("issue #1: close FAILED");
    expect(stdout.join("\n")).not.toContain("clean");
  });

  it("ERROR: an auth failure exits 8 (the failing call's own kind, not a generic 1)", async () => {
    const w = await buildWorld();
    await carrier(w, 1, "archived");
    w.github.closeFailures.set(1, auth);

    const exit = await sync(w, listingOf(issue(1)));

    expect(exit).toBe(8);
    const json = JSON.parse(stdout.join("\n")) as SyncJson;
    expect(json.ok).toBe(false);
    expect(json.data.applied[0]?.failed).toBe(true);
  });

  it("ERROR: no GitHub closer configured exits 4 and says so on stderr (never a silent clean)", async () => {
    const w = await buildWorld(false);

    const exit = await sync(w, listingOf(issue(1)), false);

    expect(exit).toBe(4);
    expect(stderr.join("\n")).toContain("GitHub not configured");
    expect(stdout.join("\n")).not.toContain("clean");
  });

  it("ERROR: a missing sync driver exits 1", async () => {
    const exit = await runIssuesSync(liveInvocation(), undefined, listingOf(), { json: false });
    expect(exit).toBe(1);
  });
});
