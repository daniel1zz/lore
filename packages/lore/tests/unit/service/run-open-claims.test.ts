/**
 * AU-T23: `RunService.openClaimsOfWorkingCopy` matches an open claim whose recorded worktree is a BRANCH NAME
 * (what lore's dispatch protocol records) by resolving it through `resolveClaimWorktree`.
 *
 * HAPPY:    branch-name claim whose worktree is the working copy matches
 * NEGATIVE: control — a branch name resolving to another worktree does not match
 * ERROR:    `git worktree list` failing is reported in `not_measured`, never dropped
 * BOUNDARY: a path-valued claim still matches without any git lookup
 */
import { describe, expect, it } from "vitest";
import type { CreateDocInput } from "@lore/core";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { RunService } from "../../../src/service/run-service.js";
import type { WorktreeGitProbe } from "../../../src/service/worktree-cleanup.js";

const WC = "/wt/agent-w";

type Listed = ReturnType<WorktreeGitProbe["listWorktrees"]>;

function probeOf(listed: Listed): WorktreeGitProbe {
  return { pathExists: () => false, listWorktrees: () => listed } as unknown as WorktreeGitProbe;
}

async function setup(listed: Listed, claimedWorktree: string) {
  const store = new InMemoryStore();
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const plan = await corpus.create({ type: "plan", title: "Plan A", content: "# A" } as CreateDocInput);
  if (!plan.ok) throw new Error(JSON.stringify(plan.error));
  const created = await corpus.create({
    type: "task",
    title: "Task 1",
    parent_id: plan.value.id,
    content: "# T",
    extra: { plan_id: plan.value.id },
  } as CreateDocInput);
  if (!created.ok) throw new Error(JSON.stringify(created.error));
  const extra = { plan_id: plan.value.id, claim: { by: "agent:x", at: new Date().toISOString(), worktree: claimedWorktree } };
  const patched = await store.update(created.value.id, { extra, status: "approved" });
  if (!patched.ok) throw new Error(JSON.stringify(patched.error));
  return new RunService(store, undefined, undefined, (p) => p, probeOf(listed));
}

const LISTED = {
  ok: true,
  value: [
    { path: WC, branch: "worktree-agent-w" },
    { path: "/wt/agent-o", branch: "worktree-agent-o" },
  ],
} as unknown as Listed;

describe("AU-T23 openClaimsOfWorkingCopy resolves branch-name claims", () => {
  it("AU-T23 a claim recording the branch of the working copy matches it", async () => {
    const service = await setup(LISTED, "worktree-agent-w");
    const r = await service.openClaimsOfWorkingCopy(WC);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.tasks).toHaveLength(1);
    expect(r.value.not_measured).toEqual([]);
  });

  it("AU-T23 control: a branch name resolving to a different worktree does not match", async () => {
    const service = await setup(LISTED, "worktree-agent-o");
    const r = await service.openClaimsOfWorkingCopy(WC);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.tasks).toEqual([]);
    expect(r.value.not_measured).toEqual([]);
  });

  it("AU-T23 a failed `git worktree list` is reported in not_measured, not dropped", async () => {
    const service = await setup({ ok: false, reason: "git exploded" } as Listed, "worktree-agent-w");
    const r = await service.openClaimsOfWorkingCopy(WC);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.tasks).toEqual([]);
    expect(r.value.not_measured).toHaveLength(1);
    expect(r.value.not_measured[0]).toContain("git exploded");
  });

  it("AU-T23 a path-valued claim naming the working copy still matches", async () => {
    const service = await setup({ ok: false, reason: "unused" } as Listed, WC);
    const r = await service.openClaimsOfWorkingCopy(WC);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.tasks).toHaveLength(1);
  });
});
