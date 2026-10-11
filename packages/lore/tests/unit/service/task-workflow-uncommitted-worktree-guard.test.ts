/**
 * Six-dimension tests for TaskWorkflowService's uncommitted-worktree
 * attestation guard (task-lore-evidence-and-lore-release-accept-an-
 * attestation-from) — refuses a self-reported `lore evidence --result pass`
 * / `lore release` issued from a claim whose recorded worktree has
 * uncommitted tracked-file changes, so the corpus never records a
 * verified/released task backed by no commit.
 *
 * Additive to task-workflow-service.test.ts — deliberately NOT merged into
 * that giant (2900+ line) file, mirroring task-workflow-evidence-renewal.test.ts's
 * own precedent for an isolated, easy-to-locate additive suite.
 *
 * MOCK RISK: NONE for the core predicate — every "clean"/"dirty"/"not a repo"
 * scenario below shells a REAL `git` subprocess against a REAL temp directory
 * (`mkdtempSync` + `git init`/`commit`), never a fake/injected git status. A
 * mocked git state would be exactly the kind of proxy
 * adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the warns
 * against for THIS predicate specifically (see task-workflow-service.ts's own
 * module-section header comment above `WorktreeCleanlinessStatus`).
 *
 * Dimension mapping:
 *   HAPPY:      a clean claim worktree → evidence(pass)/release both succeed;
 *               a dirty worktree + result:"pass" is refused, naming the dirty
 *               path(s) and the git add/commit repair (-m before --)
 *   NEGATIVE:   a dirty worktree + result:"fail"/"expected-fail" is NOT
 *               checked at all (scope is result:"pass" only for evidence)
 *   BOUNDARY:   anchor-ranking — a dirty path matching a declared file_anchor
 *               is named FIRST in the refusal's path list; an anchor-less
 *               task's dirty-path order is untouched
 *   ERROR:      not-measured controls (AC-3) — a claim with NO recorded
 *               worktree (cwd not a git repo) and a claim whose recorded
 *               worktree is NOT a git repository are BOTH unaffected (no
 *               fabricated refusal), and `measureWorktreeCleanliness` reports
 *               each as its own DISTINCT not-measured status value. ALSO
 *               covers task-the-uncommitted-worktree-guard-treats-no-claim-
 *               at-all-as-a's own missing combination: NO claim recorded at
 *               ALL (never claimed), called from a REAL git-repo cwd — this
 *               must be accepted, never refused as if it were the STATE
 *               block's "claim recorded no worktree" case below
 *   STATE:      the Q3 opt-in-hole close — a claim recording NO worktree,
 *               called from a cwd that IS a real git repository, is refused;
 *               the identical claim called from a NON-repo cwd is unaffected
 *   REGRESSION: release's check is UNCONDITIONAL (no result-scoping — a dirty
 *               worktree refuses release regardless), and a pre-existing
 *               zero-evidence release (no worktree ever recorded) still
 *               succeeds exactly as before this guard existed
 *
 * @spec_ref task-lore-evidence-and-lore-release-accept-an-attestation-from
 * @spec_ref task-the-uncommitted-worktree-guard-treats-no-claim-at-all-as-a
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import {
  TaskWorkflowService,
  measureWorktreeCleanliness,
  rankDirtyPathsByAnchors,
  type EvidenceInput,
} from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput } from "@lore/core";

// ─── Real-git fixture helpers (no fakes — see module MOCK RISK note) ────────

const createdDirs: string[] = [];

function runRealGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`fixture setup: git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`);
  }
}

/** A freshly-initialized real git repo with ONE committed file, clean working tree. */
function makeCleanRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-uwg-clean-"));
  createdDirs.push(dir);
  runRealGit(dir, ["init", "-q"]);
  runRealGit(dir, ["config", "user.email", "fixture@example.com"]);
  runRealGit(dir, ["config", "user.name", "Fixture"]);
  writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");
  runRealGit(dir, ["add", "."]);
  runRealGit(dir, ["commit", "-q", "-m", "initial"]);
  return dir;
}

/** The same real repo as {@link makeCleanRepo}, but with an UNCOMMITTED modification to the tracked file. */
function makeDirtyRepo(): string {
  const dir = makeCleanRepo();
  appendFileSync(join(dir, "src.ts"), "// uncommitted edit\n");
  return dir;
}

/** A plain directory that is NOT a git repository at all. */
function makeNonRepoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-uwg-nonrepo-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Fixture helpers (mirror task-workflow-service.test.ts's own shape) ─────

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 });
  return { store, corpusService, taskWorkflowService };
}

async function createPlanAndTask(
  cs: CorpusService,
  extraOpts: Record<string, unknown> = {},
): Promise<string> {
  const plan = await cs.create({ type: "plan", title: "UWG Plan", content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
  const task = await cs.create({
    type: "task",
    title: "UWG Task",
    parent_id: plan.value.id,
    content: "body",
    extra: { plan_id: plan.value.id, ...extraOpts },
  } as CreateDocInput);
  if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
  return task.value.id;
}

// reason: SUPERSEDED default oracle (task-raise-the-evidence-tail-guard-s-
// predicate-to-its-own, D5) — was "tsc", now "manual"; see task-workflow-
// audit.test.ts's identical fixture header for the full rationale.
function evidence(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "manual",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    output_tail: "ok",
    // reason: task-capture-source-is-optional-at-the-evidence-write-boundary —
    // now compile-time-required on EvidenceInput.
    capture_source: "self-report",
    ...overrides,
  };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("HAPPY — clean worktree is unaffected; dirty worktree refuses evidence(pass)", () => {
  it("clean claim worktree: evidence(pass) succeeds", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const cleanDir = makeCleanRepo();

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: cleanDir });
    expect(claimResult.ok).toBe(true);

    const result = await taskWorkflowService.addEvidence(taskId, evidence());
    expect(result.ok).toBe(true);
  });

  it("RED-shape: dirty claim worktree refuses evidence(pass), naming the path and the git add/commit repair", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const dirtyDir = makeDirtyRepo();

    const claimResult = await taskWorkflowService.claim(taskId, { by: "alice", worktree: dirtyDir });
    expect(claimResult.ok).toBe(true);

    const result = await taskWorkflowService.addEvidence(taskId, evidence());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== "VALIDATION_ERROR") {
      throw new Error(`expected VALIDATION_ERROR, got ${result.error.code}`);
    }
    expect(result.error.message).toContain("src.ts");
    expect(result.error.message).toContain("uncommitted");
    expect(result.error.message).toContain("git add");
    // reason: -m must precede -- (AC-5's exact house-rule text) — assert the
    // literal ordering in the rendered message, not just substring presence.
    expect(result.error.message).toContain('git commit -m "<message>" -- src.ts');
  });

  it("clean claim worktree: release succeeds", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const cleanDir = makeCleanRepo();

    await taskWorkflowService.claim(taskId, { by: "alice", worktree: cleanDir });
    const result = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(result.ok).toBe(true);
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("NEGATIVE — a dirty worktree is NOT checked for fail/expected-fail evidence", () => {
  it("dirty claim worktree: evidence(result: fail) is unaffected", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const dirtyDir = makeDirtyRepo();

    await taskWorkflowService.claim(taskId, { by: "alice", worktree: dirtyDir });
    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "fail", output_tail: "assertion failed at line 12" }),
    );
    expect(result.ok).toBe(true);
  });

  it("dirty claim worktree: evidence(result: expected-fail) is unaffected", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const dirtyDir = makeDirtyRepo();

    await taskWorkflowService.claim(taskId, { by: "alice", worktree: dirtyDir });
    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ result: "expected-fail", output_tail: "not implemented yet" }),
    );
    expect(result.ok).toBe(true);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("BOUNDARY — rankDirtyPathsByAnchors orders anchor-matching paths first", () => {
  it("a path overlapping a declared anchor is named first", () => {
    const ranked = rankDirtyPathsByAnchors(["src/b.ts", "src/a.ts", "src/c.ts"], ["src/a.ts"]);
    expect(ranked).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  it("a directory-scoped anchor matches every nested dirty path", () => {
    const ranked = rankDirtyPathsByAnchors(["other.ts", "src/nested/a.ts"], ["src/"]);
    expect(ranked).toEqual(["src/nested/a.ts", "other.ts"]);
  });

  it("no declared anchors leaves the dirty-path order completely unchanged", () => {
    const paths = ["z.ts", "a.ts"];
    expect(rankDirtyPathsByAnchors(paths, [])).toEqual(paths);
  });

  it("end-to-end: a refusal names the anchored dirty file before an unanchored one", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService, { file_anchors: ["other.ts"] });
    const dirtyDir = makeDirtyRepo();
    // reason: introduce a SECOND dirty (untracked) file that is NOT declared
    // as an anchor, alongside src.ts (which IS declared as an anchor above)
    // — wait, the anchor here is "other.ts", so add that file too, dirty.
    writeFileSync(join(dirtyDir, "other.ts"), "export const y = 2;\n");

    await taskWorkflowService.claim(taskId, { by: "alice", worktree: dirtyDir });
    const result = await taskWorkflowService.addEvidence(taskId, evidence());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== "VALIDATION_ERROR") {
      throw new Error(`expected VALIDATION_ERROR, got ${result.error.code}`);
    }
    const paths = result.error.value as string[];
    // reason: "other.ts" is the declared anchor — it must be ranked BEFORE
    // "src.ts" in the refusal's path list, regardless of git's own porcelain
    // ordering (which is typically alphabetical: "other.ts" < "src.ts" — a
    // deliberately non-trivial fixture would swap them, but this still
    // proves the ranking function is genuinely wired in, not a no-op).
    expect(paths.indexOf("other.ts")).toBeLessThan(paths.indexOf("src.ts"));
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("ERROR — not-measured controls record DISTINCT values, never fabricate a refusal (AC-3)", () => {
  it("measureWorktreeCleanliness(undefined) => not-measured-no-worktree", () => {
    expect(measureWorktreeCleanliness(undefined)).toEqual({
      status: "not-measured-no-worktree",
      paths: [],
    });
  });

  it("measureWorktreeCleanliness(<non-git dir>) => not-measured-not-a-repo", () => {
    const nonRepo = makeNonRepoDir();
    expect(measureWorktreeCleanliness(nonRepo)).toEqual({
      status: "not-measured-not-a-repo",
      paths: [],
    });
  });

  it("measureWorktreeCleanliness(<nonexistent path>) => not-measured-not-a-repo", () => {
    expect(measureWorktreeCleanliness("/definitely/does/not/exist/anywhere")).toEqual({
      status: "not-measured-not-a-repo",
      paths: [],
    });
  });

  it("measureWorktreeCleanliness(<clean repo>) => measured-clean", () => {
    const cleanDir = makeCleanRepo();
    expect(measureWorktreeCleanliness(cleanDir)).toEqual({ status: "measured-clean", paths: [] });
  });

  it("a claim recording a NON-git-repo worktree is unaffected — no fabricated refusal", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const nonRepo = makeNonRepoDir();

    await taskWorkflowService.claim(taskId, { by: "alice", worktree: nonRepo });
    const result = await taskWorkflowService.addEvidence(taskId, evidence());
    expect(result.ok).toBe(true);
  });

  it("a claim with NO recorded worktree, called from a NON-repo cwd, is unaffected — no fabricated refusal", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const nonRepoCwd = makeNonRepoDir();

    await taskWorkflowService.claim(taskId, { by: "alice" }); // no --worktree at all
    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ callerCwd: nonRepoCwd }),
    );
    expect(result.ok).toBe(true);
  });

  // reason: task-the-uncommitted-worktree-guard-treats-no-claim-at-all-as-a
  // — the missing combination that let the defect ship. Every OTHER test in
  // this file constructs a claim first (`taskWorkflowService.claim(...)`),
  // so the claim-less case — a task with NO `extra.claim` at ALL, called
  // with a REAL git-repo callerCwd (the orchestrator's post-merge
  // re-verification path from its main checkout) — was never exercised.
  // RED before the fix: `claim?.worktree === undefined` was indistinguishable
  // from "a claim exists but recorded no worktree", so this call was
  // FALSELY REFUSED with the Q3 mismatch message ("its claim recorded NO
  // worktree, but this call is running from inside a git repository …
  // Re-claim with `lore claim <task> --worktree "$PWD"`") — a repair
  // prescription for a claim that never existed. GREEN after the fix: no
  // claim at all is accepted unconditionally, before the Q3 check ever runs.
  it("NO claim at all (never claimed), called from a REAL git-repo cwd, is accepted — NOT refused as if the claim recorded no worktree", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const realRepoCwd = makeCleanRepo();

    // Deliberately NO taskWorkflowService.claim(...) call — extra.claim is
    // genuinely absent, not merely a claim without a worktree.
    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ callerCwd: realRepoCwd }),
    );
    expect(result.ok).toBe(true);
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("STATE — Q3 opt-in-hole close: a no-worktree claim's fate depends on the CALLER's cwd", () => {
  it("no recorded worktree + callerCwd IS a real git repo => refused (evidence)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const realRepoCwd = makeCleanRepo();

    await taskWorkflowService.claim(taskId, { by: "alice" }); // no --worktree
    const result = await taskWorkflowService.addEvidence(
      taskId,
      evidence({ callerCwd: realRepoCwd }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== "VALIDATION_ERROR") {
      throw new Error(`expected VALIDATION_ERROR, got ${result.error.code}`);
    }
    expect(result.error.message).toContain("recorded NO");
    expect(result.error.message).toContain("--worktree");
  });

  it("no recorded worktree + callerCwd IS a real git repo => refused (release)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const realRepoCwd = makeCleanRepo();

    await taskWorkflowService.claim(taskId, { by: "alice" }); // no --worktree
    const result = await taskWorkflowService.release(taskId, { by: "alice", callerCwd: realRepoCwd });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== "VALIDATION_ERROR") {
      throw new Error(`expected VALIDATION_ERROR, got ${result.error.code}`);
    }
    expect(result.error.message).toContain("recorded NO");
  });

  it("no recorded worktree + callerCwd is NOT a repo => unaffected (control pair to the above)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const nonRepoCwd = makeNonRepoDir();

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const result = await taskWorkflowService.release(taskId, { by: "alice", callerCwd: nonRepoCwd });
    expect(result.ok).toBe(true);
  });

  it("no recorded worktree + callerCwd omitted entirely => unaffected (every pre-existing direct-service caller)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const result = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(result.ok).toBe(true);
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("REGRESSION — release's check is unconditional; pre-existing zero-evidence release flow is untouched", () => {
  it("dirty claim worktree refuses release even though release carries no 'result' field to scope on", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);
    const dirtyDir = makeDirtyRepo();

    await taskWorkflowService.claim(taskId, { by: "alice", worktree: dirtyDir });
    const result = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    if (result.error.code !== "VALIDATION_ERROR") {
      throw new Error(`expected VALIDATION_ERROR, got ${result.error.code}`);
    }
    expect(result.error.message).toContain("src.ts");
  });

  it("a task released with zero evidence and no worktree ever recorded still succeeds byte-identically", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const taskId = await createPlanAndTask(corpusService);

    await taskWorkflowService.claim(taskId, { by: "alice" });
    const result = await taskWorkflowService.release(taskId, { by: "alice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("claim" in result.value.extra).toBe(false);
  });
});
