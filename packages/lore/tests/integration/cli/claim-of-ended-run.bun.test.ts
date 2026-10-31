// @spawns-external git builds a throwaway git repository the test runs against
/**
 * @spec_ref spec-a-lore-call-s-run-identity-is-injected-per-bash-call-and#AC-RV-10
 * @task task-red-tests-export-prefix-ancestry-verification-refusal (RED; implementation lands in a later task of the same plan)
 *
 * #457 / BR-1058: a task claimed by run R1, after R1 ends (ended_at set) and while the claim is younger than the lease TTL,
 * is claimed by another run R2 without a steal, and the output names R1 as ended. A claim of a LIVE run still refuses.
 *
 * The task service's claim (the one path the CLI verb calls; the lore MCP server is gone), real SQLite
 * corpus in a mkdtemp dir. Both runs are registered with the test process as their harness, so the tests stay valid once
 * run ancestry is verified. No new symbol is imported.
 *
 * The worktree cases use a real git repository and a real linked worktree, and call the task service directly so the
 * refusal is checked through the CLI's own exit-code mapping (`exitCode`): a clean or gone worktree of an ended run is
 * claimable and releasable without a steal or force (exit 0); a dirty worktree that still exists stays protected (exit 5).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readClaimRecord, type CreateDocInput, type RunId } from "@lore/core";
import { exitCode } from "../../../src/adapters/cli/utils.js";
import { createApp, type App } from "../../../src/app.js";
import { createRealProcessTablePort } from "../../../src/adapters/process-table-port.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { actedStore, liveAmbient, liveWriteContext } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
const STAMP = "2026-10-27T00:00:00.000Z";
const R1 = "cc:ended-claim-r1";
const R2 = "cc:ended-claim-r2";
const BY_R1 = "agent:ended-claim-r1";
const BY_R2 = "agent:ended-claim-r2";

/** Runs git with Bun.spawnSync (node:child_process.spawnSync is patched twice under Bun); fails loud on a non-zero exit. */
function git(cwd: string, args: string[]): void {
  const proc = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed (${proc.exitCode}): ${proc.stderr.toString()}`);
}

interface ClaimOutcome {
  isError: boolean;
  text: string;
}

type SeedStore = {
  insertRun: (r: unknown) => Promise<{ ok: boolean; error?: unknown }>;
  recordRunProcess: (id: RunId, p: { pid: number | null; startTime: string | null; worktree: string | null }) => Promise<{ ok: boolean; error?: unknown }>;
  endRun: (id: RunId, endedAt: string, reason: string) => Promise<{ ok: boolean; error?: unknown }>;
  close?: () => void;
};

describe("AC-RV-10: a claim ends with its run", () => {
  let tmpRoot: string;
  let dbPath: string;
  let app: App;
  let taskSlug: string;

  async function withStore<T>(body: (store: SeedStore) => Promise<T>): Promise<T> {
    const store = actedStore(new SQLiteStore(dbPath)) as unknown as SeedStore;
    try {
      return await body(store);
    } finally {
      store.close?.();
    }
  }

  async function seedRun(id: string): Promise<void> {
    const inspected = await createRealProcessTablePort({ env: process.env, cwd: process.cwd() }).inspect(process.pid);
    if (inspected === null || inspected.startTime === null) throw new Error("cannot read this process's start time");
    await withStore(async (store) => {
      const inserted = await store.insertRun({
        id,
        kind: "main",
        harness: "claude-code",
        sessionRef: id.replace(/^cc:/, ""),
        agentRef: null,
        agentType: null,
        parentRunId: null,
        branch: "main",
        composition: { schemaVersion: 1, fragments: [{ id: "frag-1", sha256: "a".repeat(64) }] },
        registeredAt: STAMP,
      });
      if (!inserted.ok) throw new Error(`insertRun failed: ${JSON.stringify(inserted.error)}`);
      const recorded = await store.recordRunProcess(id as RunId, { pid: process.pid, startTime: inspected.startTime, worktree: null });
      if (!recorded.ok) throw new Error(`recordRunProcess failed: ${JSON.stringify(recorded.error)}`);
    });
  }

  async function endRun(id: string): Promise<void> {
    await withStore(async (store) => {
      const ended = await store.endRun(id as RunId, new Date().toISOString(), "test-end");
      if (!ended.ok) throw new Error(`endRun failed: ${JSON.stringify(ended.error)}`);
    });
  }

  async function claimAs(run: string, by: string): Promise<ClaimOutcome> {
    const r = await app.taskWorkflowService.claim(taskSlug, { by, harnessRun: run as RunId });
    return r.ok ? { isError: false, text: JSON.stringify(r.value) } : { isError: true, text: JSON.stringify(r.error) };
  }

  // reason: the service call takes the run as an argument while the audit row is stamped by the app's own ambient run,
  // so the holder is read from the claim record the claim wrote.
  async function claimedBy(): Promise<string | null> {
    const doc = await app.corpusService.get(taskSlug);
    if (!doc.ok) throw new Error(`get failed: ${JSON.stringify(doc.error)}`);
    return readClaimRecord(doc.value.doc)?.harness_run ?? null;
  }

  beforeEach(async () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "lore-ended-claim-"));
    mkdirSync(join(tmpRoot, ".lore"), { recursive: true });
    dbPath = join(tmpRoot, ".lore", "lore.db");
    app = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    const plan = await app.corpusService.create({ parent_id: await ensureRequirementsDocId(app.corpusService), type: "plan", title: "Ended Claim Plan", content: "# Plan" } as CreateDocInput);
    if (!plan.ok) throw new Error(`plan: ${JSON.stringify(plan.error)}`);
    const task = await app.corpusService.create({
      type: "task",
      title: "Ended Claim Task",
      parent_id: plan.value.id,
      content: "# Task",
      extra: { plan_id: plan.value.id },
    } as CreateDocInput);
    if (!task.ok) throw new Error(`task: ${JSON.stringify(task.error)}`);
    taskSlug = task.value.slug;
    await seedRun(R1);
    await seedRun(R2);
  });

  afterEach(async () => {
    app.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("R1 ends: R2 claims the task without a steal, young claim included, and the output names R1 as ended", async () => {
    const first = await claimAs(R1, BY_R1);
    expect(first.isError, first.text).not.toBe(true);
    await endRun(R1);

    const second = await claimAs(R2, BY_R2);
    expect(second.isError, second.text).not.toBe(true);
    expect(second.text).toContain(R1);
    expect(second.text).toContain("ended");
    expect(await claimedBy()).toBe(R2);
  });

  it("R1 is live: R2's claim still refuses, naming R1, and nothing changes hands (regression pin)", async () => {
    const first = await claimAs(R1, BY_R1);
    expect(first.isError, first.text).not.toBe(true);

    const second = await claimAs(R2, BY_R2);
    expect(second.isError).toBe(true);
    expect(second.text).toContain(R1);
    expect(await claimedBy()).toBe(R1);
  });

  describe("with a real git worktree recorded on the claim", () => {
    let repoDir: string;
    let worktreeDir: string;

    async function claimInWorktree(): Promise<void> {
      const claimed = await app.taskWorkflowService.claim(taskSlug, { by: BY_R1, harnessRun: R1 as RunId, worktree: worktreeDir });
      if (!claimed.ok) throw new Error(`claim failed: ${JSON.stringify(claimed.error)}`);
    }

    async function heldRun(): Promise<string | null> {
      const doc = await app.corpusService.get(taskSlug);
      if (!doc.ok) throw new Error(`get failed: ${JSON.stringify(doc.error)}`);
      return readClaimRecord(doc.value.doc)?.harness_run ?? null;
    }

    beforeEach(() => {
      repoDir = join(tmpRoot, "repo");
      worktreeDir = join(tmpRoot, "wt");
      mkdirSync(repoDir, { recursive: true });
      git(repoDir, ["init", "-q", "-b", "main"]);
      git(repoDir, ["config", "user.email", "t@example.com"]);
      git(repoDir, ["config", "user.name", "t"]);
      writeFileSync(join(repoDir, "a.txt"), "one\n");
      git(repoDir, ["add", "."]);
      git(repoDir, ["commit", "-q", "-m", "init"]);
      git(repoDir, ["worktree", "add", "-q", "-b", "feat-ended", worktreeDir]);
    });

    it("(i) R1 ends with a clean worktree: another run releases without force (exit 0) and R1 itself releases too", async () => {
      await claimInWorktree();
      await endRun(R1);

      const byOther = await app.taskWorkflowService.release(taskSlug, { by: BY_R2, harnessRun: R2 as RunId });
      expect(byOther.ok, JSON.stringify(byOther)).toBe(true);
      expect(await heldRun()).toBeNull();

      await claimInWorktree();
      const bySelf = await app.taskWorkflowService.release(taskSlug, { by: BY_R1, harnessRun: R1 as RunId });
      expect(bySelf.ok, JSON.stringify(bySelf)).toBe(true);
    });

    it("(i) a LIVE run's claim cannot be released by another run without force (exit 5)", async () => {
      await claimInWorktree();
      const refused = await app.taskWorkflowService.release(taskSlug, { by: BY_R2, harnessRun: R2 as RunId });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(exitCode(refused.error)).toBe(5);
      expect(await heldRun()).toBe(R1);
    });

    it("(ii) R1 ends with uncommitted changes in a worktree that still exists: claim and release both refuse (exit 5), BR-1057", async () => {
      await claimInWorktree();
      writeFileSync(join(worktreeDir, "a.txt"), "dirty\n");
      await endRun(R1);

      const claim = await app.taskWorkflowService.claim(taskSlug, { by: BY_R2, harnessRun: R2 as RunId });
      expect(claim.ok).toBe(false);
      if (!claim.ok) expect(exitCode(claim.error)).toBe(5);

      const release = await app.taskWorkflowService.release(taskSlug, { by: BY_R2, harnessRun: R2 as RunId });
      expect(release.ok).toBe(false);
      if (!release.ok) expect(exitCode(release.error)).toBe(5);
      expect(await heldRun()).toBe(R1);
    });

    it("(iii) R1 ends and its recorded worktree directory is gone: another run claims without a steal (exit 0)", async () => {
      await claimInWorktree();
      rmSync(worktreeDir, { recursive: true, force: true });
      expect(existsSync(worktreeDir)).toBe(false);
      await endRun(R1);

      const claim = await app.taskWorkflowService.claim(taskSlug, { by: BY_R2, harnessRun: R2 as RunId });
      expect(claim.ok, JSON.stringify(claim)).toBe(true);
      expect(await heldRun()).toBe(R2);
    });

    it("(iii) R1 ends and its worktree is gone: another run releases without force (exit 0)", async () => {
      await claimInWorktree();
      rmSync(worktreeDir, { recursive: true, force: true });
      await endRun(R1);

      const release = await app.taskWorkflowService.release(taskSlug, { by: BY_R2, harnessRun: R2 as RunId });
      expect(release.ok, JSON.stringify(release)).toBe(true);
      expect(await heldRun()).toBeNull();
    });
  });
});
