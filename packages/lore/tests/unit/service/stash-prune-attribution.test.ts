/**
 * AU-T20 — a stash is attributed to the run whose lifetime and checkout contain it, never to an unrelated open claim.
 *
 * Fake git + fake store (no repo, no corpus): every fact the service measures is an input here, so "live" / "ended"
 * / "no provable owner" are exact. Red-first half: an old stash on main plus an unrelated open claim recording
 * branch main (no run) used to be reported "live"; control: a stash made during a still-live run in the checkout
 * that has main checked out stays live.
 *
 */
import { describe, expect, it } from "vitest";
import { ok } from "@lore/core";
import type { RunId } from "@lore/core";
import { StashPruneService, stashDecisionVersion, type GitRunner } from "../../../src/service/stash-prune-service.js";
import type { RunLifecycle } from "../../../src/store/store-interface.js";

const SHA = "a".repeat(40);
const CHECKOUT = "/work/repo";
const STASH_TIME = "2026-10-10T12:00:00.000Z";

function gitFor(opts: { branch?: string; worktrees?: string }): GitRunner {
  const branch = opts.branch ?? "main";
  const worktrees = opts.worktrees ?? `worktree ${CHECKOUT}\nHEAD abc\nbranch refs/heads/main\n\n`;
  return (args) => {
    const joined = args.join(" ");
    if (joined.startsWith("stash list")) return { status: 0, stdout: `${SHA}\0On ${branch}: wip\n`, stderr: "" };
    if (joined.startsWith("worktree list")) return { status: 0, stdout: worktrees, stderr: "" };
    if (joined.startsWith("show -s --format=%ct")) return { status: 0, stdout: `${Date.parse(STASH_TIME) / 1000}\n`, stderr: "" };
    return { status: 1, stdout: "", stderr: "fake git: unsupported" };
  };
}

function lifecycle(id: string, over: Partial<RunLifecycle> & { worktree?: string | null }): RunLifecycle {
  const { worktree, ...rest } = over;
  return {
    id: id as RunId,
    registeredAt: "2026-10-10T00:00:00.000Z",
    endedAt: null,
    endReason: null,
    parentRunId: null,
    agentRef: null,
    process: { pid: 1, startTime: "2026-10-10T00:00:00Z", worktree: worktree === undefined ? CHECKOUT : worktree },
    ...rest,
  };
}

function serviceWith(runs: RunLifecycle[], git: GitRunner, claims: Array<{ worktree: string; harness_run?: string }> = []) {
  const store = {
    listRunsByAgentRef: async () => ok([]),
    getRunEnd: async (id: RunId) => {
      const run = runs.find((r) => r.id === id);
      return ok(run === undefined ? null : { endedAt: run.endedAt, endReason: run.endReason });
    },
    findMany: async () => ok(claims.map((claim, i) => ({ id: `t${i}`, extra: { claim } }))),
    listRunLifecycles: async () => ok(runs),
  };
  return new StashPruneService({ git, store: store as never, decisions: undefined as never });
}

async function attributionOf(service: StashPruneService) {
  const listed = await service.list();
  if (!listed.ok) throw new Error(`list failed: ${JSON.stringify(listed.error)}`);
  return listed.value[0]!.attribution;
}

describe("AU-T20 stash attribution by lifetime and checkout", () => {
  it("RED-FIRST: an old stash on main plus an unrelated open claim on main (no run) has no provable owner, not live", async () => {
    const service = serviceWith([lifecycle("cc:old", { endedAt: "2026-10-05T00:00:00.000Z", registeredAt: "2026-10-04T00:00:00.000Z" })], gitFor({}), [{ worktree: "main" }]);
    const attribution = await attributionOf(service);
    expect(attribution.state).toBe("no-provable-owner");
    expect(attribution.runs).toEqual([]);
  });

  it("control: a stash made on main during a still-live run in the checkout that has main is live", async () => {
    const attribution = await attributionOf(serviceWith([lifecycle("cc:live", {})], gitFor({})));
    expect(attribution.state).toBe("live");
    expect(attribution.runs).toEqual(["cc:live"]);
  });

  it("a run that contained the stash time in that checkout and has since ended is the ended owner", async () => {
    const attribution = await attributionOf(serviceWith([lifecycle("cc:done", { endedAt: "2026-10-11T00:00:00.000Z" })], gitFor({})));
    expect(attribution.state).toBe("ended");
    expect(attribution.endedRuns).toEqual(["cc:done"]);
  });

  it("a live run in a DIFFERENT checkout is not the owner", async () => {
    const attribution = await attributionOf(serviceWith([lifecycle("cc:other", { worktree: "/work/other" })], gitFor({})));
    expect(attribution.state).toBe("no-provable-owner");
  });

  it("a live run registered AFTER the stash was made is not the owner", async () => {
    const attribution = await attributionOf(serviceWith([lifecycle("cc:late", { registeredAt: "2026-10-12T00:00:00.000Z" })], gitFor({})));
    expect(attribution.state).toBe("no-provable-owner");
  });

  it("a run with no recorded worktree (legacy) is never proven the owner", async () => {
    const attribution = await attributionOf(serviceWith([lifecycle("cc:legacy", { worktree: null })], gitFor({})));
    expect(attribution.state).toBe("no-provable-owner");
  });

  it("a branch checked out in no working copy has no provable owner", async () => {
    const attribution = await attributionOf(serviceWith([lifecycle("cc:live", {})], gitFor({ branch: "feature-x" })));
    expect(attribution.state).toBe("no-provable-owner");
  });

  it("a failing `git worktree list` leaves ownership unmeasured (escalates), never guessed", async () => {
    const failing: GitRunner = (args, stdin) => (args[0] === "worktree" ? { status: 1, stdout: "", stderr: "boom" } : gitFor({})(args, stdin));
    const attribution = await attributionOf(serviceWith([lifecycle("cc:live", {})], failing));
    expect(attribution.state).toBe("unmeasured");
  });

  it("decision version follows the attribution: owner run id and its ended state are part of it", async () => {
    const live = await attributionOf(serviceWith([lifecycle("cc:r", {})], gitFor({})));
    const ended = await attributionOf(serviceWith([lifecycle("cc:r", { endedAt: "2026-10-11T00:00:00.000Z" })], gitFor({})));
    const none = await attributionOf(serviceWith([], gitFor({})));
    expect(stashDecisionVersion(SHA, live)).toBe(`${SHA}|live|cc:r=live`);
    expect(stashDecisionVersion(SHA, ended)).toBe(`${SHA}|ended|cc:r=ended`);
    expect(stashDecisionVersion(SHA, none)).toBe(`${SHA}|no-provable-owner|`);
  });
});
