// @spawns packages/lore/src/index.ts -- the claim-run fixture runs the lore entry point as a child process
// @spawns-external git the run-end fixture builds a git repository
/**
 * A terminal task holds no claim by definition, and `lore gate task-claim` reaches the verdict `lore claim` reaches.
 *
 * @spec_ref task-skill-fix-a-terminal-task-holds-no-claim-by-definition (SPEC-042 D5, BR-1040)
 *
 * Throwaway corpus (mkdtemp + createApp), never the repo's `.lore/`. Ad-hoc task A (anchor `x/a.md`) holds a
 * claim from another run; candidate ad-hoc task B declares anchor `x/`. The claim and the gate run through the
 * real CLI in-process, so the gate-context builder each of them uses is the one under test.
 *
 * Coverage dimensions:
 *   REGRESSION — archived sibling with an orphaned_dirty claim on a dirty worktree does not block B (the bug)
 *   NEGATIVE   — live fresh foreign claim blocks B; live orphaned_dirty claim on a dirty worktree blocks B
 *   BOUNDARY   — live stale claim (older than TTL, clean worktree) does not block B
 *   STATE      — for every sibling state the gate verdict (exit code) equals the real claim verdict
 *   HAPPY      — terminal predicate: archived/deprecated hold nothing, a draft with a claim holds it
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import type { App } from "../../../src/app.js";
import { extractHeldClaim } from "@lore/core";
import type { CreateDocInput, DocRecord, RunId } from "@lore/core";
import { CorpusWriteAuthority } from "../../../src/service/foreign-corpus-write-guard.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { cleanupWorktrees, makeWorktree } from "../../integration/support/run-end-fixture.js";
import { liveAmbient, liveWriteContext } from "../../live-invocation.js";
import { runLoreInProcess } from "../../helpers/run-lore-in-process.js";

setDefaultTimeout(120_000);

let tmpDir: string;
let originalCwd: string;
let runCounter = 0;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-terminal-claim-")));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  (createApp(dbPath(), undefined, liveAmbient(), liveWriteContext()) as App).close();
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

afterAll(() => cleanupWorktrees());

function dbPath(): string {
  return join(tmpDir, ".lore", "lore.db");
}

async function withApp<T>(fn: (app: App) => Promise<T>): Promise<T> {
  const app = createApp(dbPath(), undefined, liveAmbient(), liveWriteContext()) as App;
  try {
    return await fn(app);
  } finally {
    app.close();
  }
}

async function newRun(): Promise<RunId> {
  runCounter += 1;
  return withApp(async (app) => {
    const result = await app.runService!.register({
      harness: "claude-code",
      sessionId: `terminal-claim-${runCounter}`,
      composition: { schemaVersion: 1 as const, fragments: [] },
    });
    if (!result.ok) throw new Error(`register failed: ${JSON.stringify(result.error)}`);
    return result.value.id;
  });
}

/** Root PRD (ad-hoc tasks auto-parent to it), then ad-hoc tasks A (anchor x/a.md) and B (anchor x/). */
async function createAdhocPair(): Promise<{ a: DocRecord; b: DocRecord }> {
  return withApp(async (app) => {
    const prd = await app.corpusService.create({ type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
    if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);
    const make = async (title: string, anchor: string): Promise<DocRecord> => {
      const task = await app.corpusService.create({
        type: "task",
        title,
        content: `# ${title}`,
        extra: { adhoc: true, file_anchors: [anchor] },
      } as CreateDocInput);
      if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
      return task.value;
    };
    return { a: await make("Sibling A", "x/a.md"), b: await make("Candidate B", "x/") };
  });
}

/** Overwrites the stored claim with `patch` merged over it, and optionally the doc status. */
function patchRow(taskId: string, claimPatch: Record<string, unknown>, status?: string): void {
  const db = new Database(dbPath());
  try {
    const row = db.query("SELECT extra FROM docs WHERE id = ?").get(taskId) as { extra: string } | null;
    if (row === null) throw new Error(`no doc ${taskId}`);
    const extra = JSON.parse(row.extra) as { claim?: Record<string, unknown> };
    if (extra.claim === undefined) throw new Error(`no claim to patch on ${taskId}`);
    extra.claim = { ...extra.claim, ...claimPatch };
    db.query("UPDATE docs SET extra = ? WHERE id = ?").run(JSON.stringify(extra), taskId);
    if (status !== undefined) db.query("UPDATE docs SET status = ? WHERE id = ?").run(status, taskId);
  } finally {
    db.close();
  }
}

type SiblingState =
  | "terminal-with-claim"
  | "live-fresh-foreign"
  | "live-orphaned-dirty"
  | "live-orphaned-dirty-aged"
  | "live-stale";

/** Puts sibling A into `state`; every state starts from a REAL service-written claim of another run. */
async function arrangeSibling(aId: string, state: SiblingState): Promise<void> {
  const foreignRun = await newRun();
  const dirtyWorktree = makeWorktree({ dirty: true });
  const cleanWorktree = makeWorktree({ dirty: false });
  const worktree = state === "live-stale" ? cleanWorktree : dirtyWorktree;
  const claimed = await withApp((app) =>
    app.taskWorkflowService.claim(aId, { by: "agent:foreign-holder", harnessRun: foreignRun, worktree }),
  );
  if (!claimed.ok) throw new Error(`arrange claim failed: ${JSON.stringify(claimed.error)}`);
  const orphaned = { orphaned_dirty: { worktree: dirtyWorktree, at: new Date().toISOString() } };
  if (state === "terminal-with-claim") patchRow(aId, orphaned, "archived");
  if (state === "live-orphaned-dirty") patchRow(aId, orphaned);
  // reason: BR-1058 — an orphaned_dirty claim never ages out; the TTL-only builder judged this one stale, the
  // run-aware path (which the real claim uses) does not. This state is what separates the two builders.
  if (state === "live-orphaned-dirty-aged") patchRow(aId, { ...orphaned, at: new Date(Date.now() - 500 * 60_000).toISOString() });
  if (state === "live-stale") patchRow(aId, { at: new Date(Date.now() - 500 * 60_000).toISOString() });
}

const SESSION_ENV = () => ({ ...process.env, HOME: tmpDir, CLAUDE_CODE_SESSION_ID: "5b1e4c70-candidate", EDITOR: "true" });

function runLore(args: string[]) {
  return runLoreInProcess(args, { cwd: tmpDir, home: tmpDir, env: SESSION_ENV() as Record<string, string> });
}

/** Gate verdict first (read-only), then the real claim of B; both exit codes. */
async function gateAndClaimExitCodes(bSlug: string): Promise<{ gate: number; claim: number; claimErr: string }> {
  const gate = await runLore(["gate", "task-claim", "--task", bSlug]);
  const claim = await runLore(["claim", bSlug, "--worktree", "cgt-wt-candidate"]);
  return { gate: gate.exitCode, claim: claim.exitCode, claimErr: claim.stderr };
}

describe("a terminal task holds no claim; gate and claim share one verdict", () => {
  it("REGRESSION: an archived sibling with an orphaned_dirty claim on a dirty worktree does not block the candidate", async () => {
    const { a, b } = await createAdhocPair();
    await arrangeSibling(a.id, "terminal-with-claim");

    const { gate, claim, claimErr } = await gateAndClaimExitCodes(b.slug);

    expect(claimErr).not.toContain("anchor-overlap");
    expect(claim).toBe(0);
    expect(gate).toBe(0);
  });

  it("NEGATIVE: a live sibling with a fresh foreign claim blocks the candidate, gate and claim alike", async () => {
    const { a, b } = await createAdhocPair();
    await arrangeSibling(a.id, "live-fresh-foreign");

    const { gate, claim, claimErr } = await gateAndClaimExitCodes(b.slug);

    expect(claim).not.toBe(0);
    expect(claimErr).toContain("anchor-overlap");
    expect(gate).toBe(claim);
  });

  it("NEGATIVE: a live sibling with an orphaned_dirty claim on a dirty worktree blocks the candidate, gate and claim alike", async () => {
    const { a, b } = await createAdhocPair();
    await arrangeSibling(a.id, "live-orphaned-dirty");

    const { gate, claim, claimErr } = await gateAndClaimExitCodes(b.slug);

    expect(claim).not.toBe(0);
    expect(claimErr).toContain("anchor-overlap");
    expect(gate).toBe(claim);
  });

  it("STATE: an orphaned_dirty claim aged far past the TTL still blocks, and the gate agrees with the claim (BR-1058)", async () => {
    const { a, b } = await createAdhocPair();
    await arrangeSibling(a.id, "live-orphaned-dirty-aged");

    const { gate, claim, claimErr } = await gateAndClaimExitCodes(b.slug);

    expect(claim).not.toBe(0);
    expect(claimErr).toContain("anchor-overlap");
    expect(gate).toBe(claim);
  });

  it("BOUNDARY: a live sibling whose claim is older than the TTL (clean worktree) does not block, gate and claim alike", async () => {
    const { a, b } = await createAdhocPair();
    await arrangeSibling(a.id, "live-stale");

    const { gate, claim } = await gateAndClaimExitCodes(b.slug);

    expect(claim).toBe(0);
    expect(gate).toBe(0);
  });

  it("HAPPY: extractHeldClaim — terminal statuses hold nothing, a non-terminal task with a claim holds it", async () => {
    const { a } = await createAdhocPair();
    await arrangeSibling(a.id, "live-fresh-foreign");
    const live = await withApp(async (app) => {
      const got = await app.corpusService.get(a.id);
      if (!got.ok) throw new Error("get failed");
      return got.value.doc;
    });

    expect(extractHeldClaim(live)).toBeDefined();
    expect(extractHeldClaim({ ...live, status: "archived" })).toBeUndefined();
    expect(extractHeldClaim({ ...live, status: "deprecated" })).toBeUndefined();
    expect(extractHeldClaim({ ...live, extra: {} })).toBeUndefined();
  });
});

describe("a terminal task's stored claim authorizes no corpus-scoped write (write guard)", () => {
  const callerDir = tmpdir();
  const baseline = { id: "bl-leaf", slug: "bl-leaf", type: "baseline", status: "approved", parent_id: null, extra: {} } as unknown as DocRecord;

  function taskWithScopedClaim(status: string): DocRecord {
    return {
      id: "t-1",
      slug: "scoped-task",
      type: "task",
      status,
      parent_id: null,
      extra: { claim: { by: "agent:holder", at: new Date().toISOString(), worktree: callerDir, corpus_scope: "bl-leaf" } },
    } as unknown as DocRecord;
  }

  function authority(task: DocRecord): CorpusWriteAuthority {
    const store = {
      findMany: async () => ({ ok: true, value: [task] }),
      find: async () => ({ ok: true, value: null }),
      appendAuditEntry: async () => ({ ok: true, value: undefined }),
    } as unknown as StoreInterface;
    return new CorpusWriteAuthority(store, {
      foreign: { provenance: "git_common_dir", enabled: true },
      callerDir,
      claimTtlMinutes: 120,
    });
  }

  it("HAPPY control: a live task's fresh scoped claim grants the write", async () => {
    const verdict = await authority(taskWithScopedClaim("active")).authorize([baseline], "rule-add", "agent:caller");
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.value?.task).toBe("scoped-task");
  });

  it("NEGATIVE: an archived task's stored claim does not grant the write; the foreign-write refusal stands", async () => {
    const verdict = await authority(taskWithScopedClaim("archived")).authorize([baseline], "rule-add", "agent:caller");
    expect(verdict.ok).toBe(false);
  });
});
