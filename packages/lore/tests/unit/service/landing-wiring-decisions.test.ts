/**
 * Decisions of task-every-closer-and-reader-uses-landingof-integrate-plan (spec-lore-done-closes-a-commitless-task-through-an-audited-no, AC-ND-8, BR-1468):
 *
 *   1. An anchor cannot be added while a NO-BRANCH claim is open (exit 4, nothing written); removing anchors and anchoring a
 *      task whose claim names a branch or worktree stay allowed. Every anchor writer (`addAnchors`, `setAnchors`, which
 *      `lore_anchor_set` calls) ends in one commit step, so both verbs are proved here.
 *   2. The git probe is a required dependency: a claim that records a branch whose start cannot be read fails loud (exit 4),
 *      and writes nothing; a start that can be read is stored on the claim.
 *   3. Readers: a no-change landing adds no commit range to a milestone review's input or to assess's recorded ranges.
 *
 * Coverage: HAPPY (allowed paths), NEGATIVE (refusals), BOUNDARY (removal, branch-only claim), ERROR (unreadable start), STATE (nothing written).
 */

import { describe, expect, it } from "vitest";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { latestLandingCommit } from "../../../src/service/milestone-review.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { actedStore } from "../../live-invocation.js";
import { runOfName } from "../../helpers/test-run-identity.js";
import { FAKE_HEAD_SHA, fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
import type { WorktreeGitProbe } from "../../../src/service/worktree-cleanup.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
function makeServices(probe: WorktreeGitProbe = fakeWorktreeProbe()) {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const service = new TaskWorkflowService(
    store, undefined, { claimTtlMinutes: 120 },
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    probe,
  );
  return { store, corpus, service };
}

async function createTask(corpus: CorpusService, anchors: string[] = []): Promise<string> {
  const plan = await corpus.create({ parent_id: await ensureRequirementsDocId(corpus), type: "plan", title: "Plan", content: "# Plan" } as CreateDocInput);
  if (!plan.ok) throw new Error(JSON.stringify(plan.error));
  const task = await corpus.create({
    type: "task", title: "Task", parent_id: plan.value.id, content: "# Task",
    extra: { plan_id: plan.value.id, ...(anchors.length > 0 ? { file_anchors: anchors } : {}) },
  } as CreateDocInput);
  if (!task.ok) throw new Error(JSON.stringify(task.error));
  return task.value.id;
}

async function anchorsOf(store: InMemoryStore, id: string): Promise<unknown> {
  const found = await store.find(id);
  if (!found.ok || found.value === null) throw new Error("task not found");
  return found.value.extra["file_anchors"];
}

describe("anchor add under an open no-branch claim (BR-1468)", () => {
  it("NEGATIVE: addAnchors and setAnchors are refused with exit-4 VALIDATION_ERROR and write nothing", async () => {
    const { store, corpus, service } = makeServices();
    const id = await createTask(corpus);
    expect((await service.claim(id, { by: "alice", harnessRun: runOfName("alice") })).ok).toBe(true);
    const versionBefore = (await store.find(id)) as { ok: true; value: DocRecord };

    const added = await service.addAnchors(id, ["src/a.ts"], { by: "alice" });
    const replaced = await service.setAnchors(id, ["src/a.ts"], { by: "alice" });

    for (const refused of [added, replaced]) {
      expect(refused.ok).toBe(false);
      if (refused.ok) continue;
      expect(refused.error.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(refused.error)).toContain("lore claim");
      expect(JSON.stringify(refused.error)).toContain("--worktree");
    }
    expect(await anchorsOf(store, id)).toBeUndefined();
    const versionAfter = (await store.find(id)) as { ok: true; value: DocRecord };
    expect(versionAfter.value.version).toBe(versionBefore.value.version);
  });

  it("HAPPY: with no claim, or a claim that names a worktree, the same anchor is added", async () => {
    const { store, corpus, service } = makeServices();
    const unclaimed = await createTask(corpus);
    expect((await service.addAnchors(unclaimed, ["src/a.ts"], { by: "alice" })).ok).toBe(true);
    expect(await anchorsOf(store, unclaimed)).toEqual(["src/a.ts"]);

    const onBranch = await createTask(corpus);
    expect((await service.claim(onBranch, { by: "alice", harnessRun: runOfName("alice"), worktree: "feature-x" })).ok).toBe(true);
    expect((await service.addAnchors(onBranch, ["src/b.ts"], { by: "alice" })).ok).toBe(true);
    expect(await anchorsOf(store, onBranch)).toEqual(["src/b.ts"]);
  });

  it("BOUNDARY: releasing the no-branch claim, then re-claiming on a branch, lets the anchor in; removal is never refused", async () => {
    const { store, corpus, service } = makeServices();
    const id = await createTask(corpus, ["src/keep.ts", "src/drop.ts"]);
    // an anchored task cannot hold a no-branch claim at all (BR-1468 at claim time), so claim a corpus-only one
    const corpusOnly = await createTask(corpus);
    expect((await service.claim(corpusOnly, { by: "alice", harnessRun: runOfName("alice") })).ok).toBe(true);
    expect((await service.addAnchors(corpusOnly, ["src/a.ts"], { by: "alice" })).ok).toBe(false);
    expect((await service.release(corpusOnly, { by: "alice", harnessRun: runOfName("alice") })).ok).toBe(true);
    expect((await service.claim(corpusOnly, { by: "alice", harnessRun: runOfName("alice"), worktree: "feature-y" })).ok).toBe(true);
    expect((await service.addAnchors(corpusOnly, ["src/a.ts"], { by: "alice" })).ok).toBe(true);

    // an anchored task claimed on a branch may drop an anchor
    expect((await service.claim(id, { by: "bob", harnessRun: runOfName("bob"), worktree: "feature-z" })).ok).toBe(true);
    expect((await service.removeAnchors(id, ["src/drop.ts"], { by: "bob" })).ok).toBe(true);
    expect(await anchorsOf(store, id)).toEqual(["src/keep.ts"]);
  });
});

describe("a claim that records a branch needs a readable start (required git probe)", () => {
  const unreadable = (): WorktreeGitProbe =>
    fakeWorktreeProbe({
      headSha: () => ({ ok: false, reason: "fatal: not a git repository" }),
      branchTip: () => ({ ok: false, reason: "fatal: Needed a single revision" }),
    });

  it("ERROR: a branch whose start cannot be read is refused (exit 4) and no claim is written", async () => {
    const { store, corpus, service } = makeServices(unreadable());
    const id = await createTask(corpus);

    const refused = await service.claim(id, { by: "alice", harnessRun: runOfName("alice"), branch: "ghost" });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(refused.error)).toContain("start of the work cannot be measured");
    const found = await store.find(id);
    expect(found.ok && found.value !== null ? found.value.extra["claim"] : "unreadable").toBeUndefined();
  });

  it("HAPPY: a readable start is stored on the claim as start_head", async () => {
    const { store, corpus, service } = makeServices();
    const id = await createTask(corpus);

    const claimed = await service.claim(id, { by: "alice", harnessRun: runOfName("alice"), branch: "feature-x", worktree: "feature-x" });

    expect(claimed.ok).toBe(true);
    const found = await store.find(id);
    const claim = found.ok && found.value !== null ? (found.value.extra["claim"] as Record<string, unknown>) : {};
    expect(claim["start_head"]).toBe(FAKE_HEAD_SHA);
  });

  it("BOUNDARY: a claim that records no branch needs no start, even when git cannot answer", async () => {
    const { corpus, service } = makeServices(unreadable());
    const id = await createTask(corpus);
    expect((await service.claim(id, { by: "alice", harnessRun: runOfName("alice") })).ok).toBe(true);
  });
});

describe("a no-change landing adds no commit range to a review's input", () => {
  const landed = (kind: "no-change" | "commits", commit: string): Pick<DocRecord, "extra"> => ({
    extra: {
      landing: {
        branch: "b", branch_head: `${commit}-head`, main_before: kind === "no-change" ? commit : `${commit}-before`, main_after: commit, landing_commit: commit,
        recorded_at: "2026-10-26T00:00:00.000Z", kind, start_head: "s", tip: "t", integration_head: "i", measured_at: "2026-10-26T00:00:00.000Z",
      },
    },
  });

  it("HAPPY + NEGATIVE: the commits landing counts, the no-change landing does not (milestone fingerprint input and assess ranges)", () => {
    expect(latestLandingCommit([landed("commits", "c1")])).toBe("c1");
    expect(latestLandingCommit([landed("no-change", "n1")])).toBe("none");
    expect(latestLandingCommit([landed("no-change", "n1"), landed("commits", "c1")])).toBe("c1");
  });

  it("REGRESSION: a landing labelled no-change whose main_before..landing_commit is a real range still counts (the label is never trusted)", () => {
    const mislabelled = landed("commits", "m1");
    const landing = mislabelled.extra["landing"] as Record<string, unknown>;
    expect(latestLandingCommit([{ extra: { landing: { ...landing, kind: "no-change" } } }])).toBe("m1");
  });
});
