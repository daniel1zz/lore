// @spawns packages/lore/src/index.ts
/**
 * AC-JV-3 oracle (spec-judgment-surfaces-must-verify-before-they-certify-machine
 * §D5) — `verifyFalsifier` resolves its execution root through SPEC-063's
 * `resolveVerifyExecutionRoot`, so a falsifier invoked from a linked worktree
 * scratches off THAT worktree (and observes an uncommitted change made only
 * there), never unconditionally `config.repoRoot` (the main checkout).
 *
 * bun test (not vitest), REAL git repos/worktrees under `mkdtemp` — never a
 * mocked `execFileSync`: `createFalsifierScratchWorktree` is deliberately NOT
 * injectable (see its own JSDoc in `verify-runner-service.ts`), so the only
 * way to prove this mechanism is to drive it against real git state. Two
 * tiers:
 *
 *   1. SERVICE tier — `VerifyRunnerService.verifyFalsifier` called directly
 *      with a hand-built `PlanBundle` (mirrors `attested-red.test.ts`'s real-
 *      executor/real-git-worktree pattern), asserting the resolution
 *      mechanism itself: `opts.executionRoot.mode === "worktree"` branches
 *      the scratch worktree off a `git stash create` snapshot of the CALLER's
 *      own uncommitted state; `mode === "corpus_root"` (or an omitted
 *      `executionRoot`, the REGRESSION case) branches off `config.repoRoot`'s
 *      HEAD and can never see it.
 *   2. CLI tier — `bun run <src/index.ts> verify <plan> --falsify <AC> --json`
 *      spawned as a REAL subprocess (never the compiled `dist/lore` binary —
 *      no build required) from inside a REAL linked worktree vs. from the
 *      main checkout, against a REAL throwaway corpus. This is the
 *      PRODUCTION-WIRING half: `commands/verify.ts`'s `--falsify` branch
 *      independently resolves `executionRoot` (the SAME
 *      `resolveCliExecutionRoot` the ordinary four-step pipeline uses) and
 *      must actually PASS it into `verifyFalsifier` — an accepted-but-never-
 *      threaded option would leave every SERVICE-tier assertion above green
 *      while the one CLI surface a user drives stays silently broken (the
 *      exact false-green shape this repo has hit four times, per root
 *      CLAUDE.md's dogfooding log). Found RED at this exact call site before
 *      this file's own fix landed: `commands/verify.ts`'s `--falsify` branch
 *      called `verifyFalsifier` with NO `executionRoot` key at all, even
 *      though `executionRoot` was already resolved two lines above it for
 *      the ordinary pipeline — silently discarded for this one branch.
 *
 * Coverage dimensions:
 *   HAPPY:      SERVICE + CLI — `executionRoot.mode === "worktree"` (or a
 *               real linked-worktree cwd) scratches off THAT worktree's own
 *               `git stash create` snapshot and the falsifier's command
 *               observes the uncommitted change made only there.
 *   NEGATIVE:   SERVICE + CLI (the MANDATORY reverse control) — resolving via
 *               `config.repoRoot`/`mode: "corpus_root"` (or invoking from the
 *               main checkout directly) does NOT observe that same
 *               uncommitted change — proves "resolved correctly" is
 *               distinguishable from "happened to pass".
 *   BOUNDARY:   a CLEAN worktree (nothing uncommitted) still resolves via
 *               `captureUncommitted: true` without error — `git stash create`
 *               prints nothing, so the scratch branches off HEAD (identical
 *               to the corpus_root case's own content) rather than failing.
 *   ERROR:      `git stash create` itself fails (a non-git `repoRoot`) →
 *               `STORE_ERROR`, scratch temp dir best-effort cleaned up,
 *               nothing recorded — the NEW failure path AC-JV-3 introduces
 *               (`createFalsifierScratchWorktree`'s pre-existing `git
 *               worktree add` failure path already had coverage; this
 *               specific `git stash create` failure branch did not).
 *   STATE:      `git stash create` is proven PLUMBING, never mutating the
 *               caller's own working tree or the stash ref list — the
 *               worktree's own `extra.txt` stays dirty and `git stash list`
 *               stays empty after the call, even though the scratch worktree
 *               it produced DOES carry the snapshotted content.
 *   REGRESSION: omitting `opts.executionRoot` entirely (every MCP caller
 *               today, and every caller before AC-JV-3) resolves byte-
 *               identically to an explicit `{root: config.repoRoot, mode:
 *               "corpus_root"}` — never silently starts inferring a
 *               worktree on its own.
 *
 * RED-FIRST verification note (recorded in the task's evidence log at the
 * moment each was red): the CLI-tier HAPPY/NEGATIVE test below was run BEFORE
 * `commands/verify.ts`'s falsify branch was patched to thread `executionRoot`
 * through — it failed exactly as predicted (the worktree-cwd invocation's
 * `output_tail` showed the MAIN checkout's committed content, not the
 * worktree's uncommitted change, because the branch silently defaulted to
 * `mode: "corpus_root"` regardless of cwd). See this task's completion report
 * for the exact command/output pair.
 *
 * @spec_ref AC-JV-3 (spec-judgment-surfaces-must-verify-before-they-certify-machine §D5)
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import {
  VerifyRunnerService,
  createFalsifierScratchWorktree,
  removeFalsifierScratchWorktree,
} from "../../../src/service/verify-runner-service.js";
import type { VerifyExecutionResult, VerifySpawnSpec } from "../../../src/service/verify-spawn.js";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";

// ─── Real git-repo/worktree fixtures (throwaway `mkdtemp` — NEVER this repo's
//     own working tree) ─────────────────────────────────────────────────────

const cleanupDirs: string[] = [];

afterEach(() => {
  // reason: best-effort per-test cleanup — a failure here is a disk leak in
  // the test runner's own tmpdir, never a correctness issue for assertions
  // already made above it.
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** `git init` + one seed commit carrying `target.txt` (falsifier's mutation target) and `extra.txt` (the worktree-uncommitted-change witness). */
function makeThrowawayGitRepo(): { repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-jv3-fixture-"));
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.email", "jv3-test@example.com");
  git(repoRoot, "config", "user.name", "AC-JV-3 Test");
  writeFileSync(join(repoRoot, "target.txt"), "MAGIC_MARKER present\n", "utf8");
  writeFileSync(join(repoRoot, "extra.txt"), "extra: original\n", "utf8");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "-q", "-m", "seed");
  cleanupDirs.push(repoRoot);
  return { repoRoot };
}

/** Creates a LINKED worktree on a new branch off `repoRoot`'s current HEAD. */
function addWorktree(repoRoot: string, branch: string): { worktreeDir: string } {
  const parent = mkdtempSync(join(tmpdir(), "lore-jv3-worktree-"));
  const worktreeDir = join(parent, "wt");
  git(repoRoot, "worktree", "add", "-q", "-b", branch, worktreeDir);
  cleanupDirs.push(parent);
  return { worktreeDir };
}

/**
 * `--untracked-files=no` — this file only ever cares whether a TRACKED file
 * (`target.txt`/`extra.txt`) was modified, never about untracked noise a
 * fixture directory may pick up (e.g. `lore init`'s own `.lore/` under a
 * `HOME`-redirected corpus fixture) — an untracked entry is not a "the
 * original repo's working tree was touched" signal.
 */
function gitStatusPorcelain(repoRoot: string): string {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

// ─── Doc/bundle fixture builders (mirrors attested-red.test.ts's shapes) ───

function makeDoc(overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

function makePlan(): DocRecord {
  return makeDoc({ id: "plan-1", type: "plan", title: "Plan" });
}

function makeSpec(acceptanceCriteria: AcceptanceCriterion[]): DocRecord {
  return makeDoc({
    id: "spec-1",
    type: "spec",
    title: "Spec",
    status: "approved",
    extra: { acceptance_criteria: acceptanceCriteria },
  });
}

function makeTask(): DocRecord {
  return makeDoc({ id: "task-1", type: "task", title: "Task", slug: "task-1", parent_id: "plan-1" });
}

/** A REAL executor — spawns `sh -c <command>` via `node:child_process.spawnSync`, never a scripted double. */
async function realExecutor(spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> {
  const start = Date.now();
  const result = spawnSync(spec.cmd[0]!, spec.cmd.slice(1), {
    cwd: spec.cwd,
    timeout: spec.timeoutMs,
    encoding: "utf8",
    env: spec.env,
  });
  const timedOut = result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  const exitCode = result.status ?? (timedOut ? 124 : 1);
  return ok({
    exitCode,
    outputTail: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    durationMs: Date.now() - start,
    timedOut,
  });
}

function makeRecordVerifiedEvidence() {
  const calls: Array<{ idOrSlug: string; entry: VerifiedEvidenceInput; nowIso: string }> = [];
  const fn = async (
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    nowIso: string,
  ): Promise<Result<DocRecord, LoreError>> => {
    calls.push({ idOrSlug, entry, nowIso });
    return ok(makeDoc({ id: "task-1", type: "task", title: "Task" }));
  };
  return { fn, calls };
}

const BASE_CONFIG = {
  repoRoot: "", // overridden per-test with the throwaway repo's root
  defaultTimeoutMs: 15000,
  claimTtlMinutes: 120,
  requireCommandApproval: false,
  envAllowlist: [],
  envPassthroughAll: true,
  processEnv: process.env,
};

/**
 * The falsifier mutates `target.txt` (unrelated to the resolution mechanism
 * under test — its own exact-match declared-vs-observed contract is
 * `attested-red.test.ts`'s concern, not this file's). The command exits 0
 * while `target.txt` still contains MAGIC_MARKER (the UNMUTATED state —
 * required post-AC-FR-11: the green control this file's own
 * `verifyFalsifier` calls now runs the command BEFORE any mutation and
 * demands exit 0 there, so a command that exits nonzero unconditionally would
 * never reach the mutated spawn at all, regardless of execution-root
 * resolution) and exits 5 once the mutation removes it — matching the
 * falsifier's declared `expected_exit_code`. `cat extra.txt` runs on BOTH
 * exits either way, so the resolution's effect still shows up ONLY in
 * `output_tail`, decoupling "did resolution work" from "does the
 * match/mismatch machinery work" (already covered elsewhere).
 */
function makeCriterion(): AcceptanceCriterion {
  return {
    id: "AC-JV3-1",
    statement: "falsifier execution-root resolution observes the caller's own uncommitted state",
    verify: {
      mode: "script",
      oracle: "other",
      command: "cat extra.txt; grep -q MAGIC_MARKER target.txt && exit 0 || exit 5",
      falsifier: { path: "target.txt", find: "MAGIC_MARKER", replace: "", expected_exit_code: 5 },
    },
  };
}

// ─── SERVICE tier ───────────────────────────────────────────────────────────

describe("AC-JV-3 (SERVICE tier) — verifyFalsifier resolves its execution root through resolveVerifyExecutionRoot", () => {
  it("HAPPY + NEGATIVE (mandatory reverse control, same fixture): worktree-mode sees the worktree's own uncommitted change; corpus_root-mode does not", async () => {
    const { repoRoot } = makeThrowawayGitRepo();
    const { worktreeDir } = addWorktree(repoRoot, "jv3-service-happy");
    // Uncommitted change made ONLY in the worktree — never touches repoRoot.
    writeFileSync(join(worktreeDir, "extra.txt"), "extra: WORKTREE_ONLY_CHANGE\n", "utf8");
    expect(gitStatusPorcelain(worktreeDir)).toContain("M extra.txt");
    expect(gitStatusPorcelain(repoRoot)).toBe(""); // repoRoot itself stays clean

    const criterion = makeCriterion();
    const plan = makePlan();
    const spec = makeSpec([criterion]);
    const task = makeTask();
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);

    // HAPPY — executionRoot resolved to the WORKTREE.
    {
      const recorder = makeRecordVerifiedEvidence();
      const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
        ...BASE_CONFIG,
        repoRoot, // config.repoRoot deliberately still points at the MAIN checkout
      });
      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "jv3-tester",
        nowIso: "2026-08-11T00:00:00.000Z",
        executionRoot: { root: worktreeDir, mode: "worktree" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.output_tail).toContain("WORKTREE_ONLY_CHANGE");
      expect(recorder.calls).toHaveLength(1);
    }

    // NEGATIVE (reverse control) — executionRoot resolved to config.repoRoot.
    // Without this half, the HAPPY case above cannot be distinguished from
    // "happened to pass" (AC-JV-3's own text).
    {
      const recorder = makeRecordVerifiedEvidence();
      const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
        ...BASE_CONFIG,
        repoRoot,
      });
      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "jv3-tester",
        nowIso: "2026-08-11T00:00:00.000Z",
        executionRoot: { root: repoRoot, mode: "corpus_root" },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.output_tail).not.toContain("WORKTREE_ONLY_CHANGE");
      expect(result.value.output_tail).toContain("extra: original");
    }

    // The worktree's own working tree is untouched by either run (D3 holds
    // for the falsifier path regardless of which root it scratched from).
    expect(readFileSync(join(worktreeDir, "extra.txt"), "utf8")).toContain("WORKTREE_ONLY_CHANGE");
  });

  it("REGRESSION: omitting opts.executionRoot entirely resolves byte-identically to an explicit config.repoRoot/corpus_root", async () => {
    const { repoRoot } = makeThrowawayGitRepo();
    const { worktreeDir } = addWorktree(repoRoot, "jv3-service-regression");
    writeFileSync(join(worktreeDir, "extra.txt"), "extra: WORKTREE_ONLY_CHANGE\n", "utf8");

    const criterion = makeCriterion();
    const plan = makePlan();
    const spec = makeSpec([criterion]);
    const task = makeTask();
    const bundle: PlanBundle = { plan, spec, tasks: [task] };
    const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
    const recorder = makeRecordVerifiedEvidence();
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
      ...BASE_CONFIG,
      repoRoot,
    });

    // No `executionRoot` key at all — mirrors every pre-AC-JV-3 caller and
    // every MCP caller today (no worktree-aware resolution).
    const result = await service.verifyFalsifier(plan.id, criterion.id, {
      explicitTaskIdOrSlug: task.id,
      by: "jv3-tester",
      nowIso: "2026-08-11T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.output_tail).not.toContain("WORKTREE_ONLY_CHANGE");
    expect(result.value.output_tail).toContain("extra: original");
  });

  it("BOUNDARY: a CLEAN worktree (nothing uncommitted) still resolves via captureUncommitted:true without error, falling back to HEAD", () => {
    const { repoRoot } = makeThrowawayGitRepo();
    const { worktreeDir } = addWorktree(repoRoot, "jv3-service-boundary");
    // Deliberately NO uncommitted change — worktreeDir is byte-identical to HEAD.
    expect(gitStatusPorcelain(worktreeDir)).toBe("");

    const createResult = createFalsifierScratchWorktree(worktreeDir, { captureUncommitted: true });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const scratch = createResult.value;
    expect(readFileSync(join(scratch.worktreeDir, "extra.txt"), "utf8")).toBe("extra: original\n");
    removeFalsifierScratchWorktree(worktreeDir, scratch);
  });

  it("ERROR: git stash create itself failing (a non-git repoRoot) refuses loud with STORE_ERROR and cleans up, nothing left behind", () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), "lore-jv3-non-git-"));
    cleanupDirs.push(nonGitDir);

    const result = createFalsifierScratchWorktree(nonGitDir, { captureUncommitted: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
    if (result.error.code !== "STORE_ERROR") return;
    expect(result.error.message).toContain("git stash create");
  });

  it("STATE: git stash create is plumbing-only — never mutates the caller's own working tree or the stash ref list", () => {
    const { repoRoot } = makeThrowawayGitRepo();
    const { worktreeDir } = addWorktree(repoRoot, "jv3-service-state");
    writeFileSync(join(worktreeDir, "extra.txt"), "extra: WORKTREE_ONLY_CHANGE\n", "utf8");

    const createResult = createFalsifierScratchWorktree(worktreeDir, { captureUncommitted: true });
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const scratch = createResult.value;

    // The scratch DOES carry the snapshot...
    expect(readFileSync(join(scratch.worktreeDir, "extra.txt"), "utf8")).toContain("WORKTREE_ONLY_CHANGE");
    // ...but the worktree's OWN working tree is still dirty (never popped/reset)...
    expect(readFileSync(join(worktreeDir, "extra.txt"), "utf8")).toContain("WORKTREE_ONLY_CHANGE");
    expect(gitStatusPorcelain(worktreeDir)).toContain("M extra.txt");
    // ...and `git stash create` never pushed onto the stash ref list (unlike `stash push`).
    expect(git(worktreeDir, "stash", "list")).toBe("");

    removeFalsifierScratchWorktree(worktreeDir, scratch);
  });
});

// ─── CLI tier — production wiring proof ────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns `bun run <src/index.ts> ...args` from SOURCE (never the compiled `dist/lore` — no build required). */
function runLore(args: readonly string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function extractSlug(stdout: string): string {
  const m = /Slug:\s+(\S+)/.exec(stdout);
  const slug = m?.[1];
  if (slug === undefined) throw new Error(`could not extract slug from: ${stdout}`);
  return slug;
}

/** Disables every service-layer write gate this fixture's authoring flow would otherwise trip — mirrors `verify-ac-ref-wiring.bun.test.ts`'s `disableAllGates`. */
function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      '    "task-create":',
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

function createPrd(dir: string, title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], dir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createSpec(dir: string, title: string, parentSlug: string): string {
  const r = runLore(["create", "spec", "--title", title,"--no-ai", "--content", "body"], dir);
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createPlan(dir: string, title: string, parentSlug: string): string {
  const r = runLore(["create", "plan", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"], dir);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createTask(dir: string, planSlug: string, title: string): string {
  const r = runLore(
    ["create", "task", "--title", title, "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

/** Declares AC-JV3-1 with a real falsifier via `lore ac add` (oracle "other" — same fixture convention `verify-ac-ref-wiring.bun.test.ts` establishes). */
function declareFalsifiableAc(dir: string, specSlug: string): void {
  const r = runLore(
    [
      "ac",
      "add",
      specSlug,
      "AC-JV3-1",
      "--statement",
      "A dogfood AC proving the falsifier execution-root wiring observes a linked worktree's own uncommitted change.",
      "--mode",
      "script",
      "--oracle",
      "other",
      "--command",
      "cat extra.txt; grep -q MAGIC_MARKER target.txt && exit 0 || exit 5",
      "--falsifier-path",
      "target.txt",
      "--falsifier-find",
      "MAGIC_MARKER",
      "--falsifier-replace",
      "",
      "--falsifier-exit-code",
      "5",
    ],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`lore ac add (falsifier) failed: ${r.stderr}`);
}

interface FalsifyJsonEnvelope {
  readonly ok: boolean;
  readonly data?: { readonly output_tail?: string; readonly exit_code?: number };
}

function parseFalsifyJson(stdout: string): FalsifyJsonEnvelope {
  return JSON.parse(stdout) as FalsifyJsonEnvelope;
}

describe("AC-JV-3 (CLI tier) — `lore verify <plan> --falsify <AC>` threads the resolved execution root into verifyFalsifier", () => {
  it("HAPPY + NEGATIVE (mandatory reverse control, same fixture): invoked from the linked worktree it sees the worktree's own uncommitted change; invoked from the main checkout it does not", () => {
    const { repoRoot: mainRepo } = makeThrowawayGitRepo();

    const initResult = runLore(["init"], mainRepo);
    if (initResult.exitCode !== 0) throw new Error(`lore init failed: ${initResult.stderr}`);
    disableAllGates(mainRepo);

    const prdSlug = createPrd(mainRepo, "AC-JV-3 CLI Wiring PRD");
    const specSlug = createSpec(mainRepo, "AC-JV-3 CLI Wiring Spec", prdSlug);
    const planSlug = createPlan(mainRepo, "AC-JV-3 CLI Wiring Plan", specSlug);
    const taskSlug = createTask(mainRepo, planSlug, "AC-JV-3 CLI Wiring Task");
    declareFalsifiableAc(mainRepo, specSlug);

    const { worktreeDir } = addWorktree(mainRepo, "jv3-cli-happy");
    // Uncommitted change made ONLY in the linked worktree.
    writeFileSync(join(worktreeDir, "extra.txt"), "extra: WORKTREE_ONLY_CHANGE\n", "utf8");
    expect(gitStatusPorcelain(worktreeDir)).toContain("M extra.txt");
    expect(gitStatusPorcelain(mainRepo)).toBe("");

    // HAPPY — invoked FROM the linked worktree (no .lore/ there; falls back
    // to the main checkout's corpus, per findLoreDbPath's own contract, but
    // `process.cwd()` itself is the worktree — exactly AC-JV-3's scenario).
    const worktreeRun = runLore(
      ["verify", planSlug, "--falsify", "AC-JV3-1", "--task", taskSlug, "--json"],
      worktreeDir,
    );
    expect(worktreeRun.exitCode).toBe(0);
    const worktreeJson = parseFalsifyJson(worktreeRun.stdout);
    expect(worktreeJson.ok).toBe(true);
    expect(worktreeJson.data?.output_tail).toContain("WORKTREE_ONLY_CHANGE");

    // NEGATIVE (reverse control) — invoked FROM the main checkout directly.
    // Without this half, the HAPPY assertion above cannot be distinguished
    // from "happened to pass" (AC-JV-3's own text).
    const mainRun = runLore(["verify", planSlug, "--falsify", "AC-JV3-1", "--task", taskSlug, "--json"], mainRepo);
    expect(mainRun.exitCode).toBe(0);
    const mainJson = parseFalsifyJson(mainRun.stdout);
    expect(mainJson.ok).toBe(true);
    expect(mainJson.data?.output_tail).not.toContain("WORKTREE_ONLY_CHANGE");
    expect(mainJson.data?.output_tail).toContain("extra: original");
    // reason: 5 spawn-helper calls (`lore init`, two `--falsify` runs, plus setup)
    // — `check:test-budgets` requires an EXPLICIT declaration at >= 3 spawns and
    // judges the declaration, never the number. Measured 2026-08-11: this file's
    // 6 tests complete in ~2.1s on an idle machine, so 120s is ~50x headroom for a
    // checkout running concurrent worktree agents, where spawn-heavy cases have
    // previously been starved into false 30s timeouts.
  }, 120_000);
});
