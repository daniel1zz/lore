/**
 * AC-FR-12 (spec-falsifiability-reachability-a-feedable-checkpoint-an) — the
 * SURFACE + PERSISTENCE oracle for `lore verify --falsify`'s green-control path
 * that AC-FR-11's own oracle (`attested-red.test.ts`) does NOT reach: that suite
 * calls `VerifyRunnerService.verifyFalsifier` directly and asserts against an
 * injected `recorder.calls[0].entry` spy — proving the SERVICE logic, never that
 * a real CLI invocation actually persists a readable row or exits the process
 * correctly. `grep -rln falsify packages/lore/tests scripts/tests` returned ZERO
 * CLI/integration files before this task (measured 2026-08-21, `lore assess`
 * MAJOR on `knowledge-assessment-close-the-falsify-green-control-gap-an`).
 *
 * This file closes that gap two ways:
 *
 *   1. `describe("AC-FR-12 — SURFACE + PERSISTENCE ...")` drives the REAL CLI
 *      (`bun run src/index.ts`, same subprocess pattern as
 *      `tests/integration/cli/verify.test.ts`) against a THROWAWAY corpus
 *      (`mkdtemp` + `lore init`, cwd inside it — never this repo's own `.lore/`,
 *      see root CLAUDE.md's 2026-07-07 pollution-incident rule) that is ALSO a
 *      real git repo, because the falsifier's scratch worktree is created via
 *      `git worktree add --detach <dir> HEAD`. The scratch environment is made
 *      "unusable" the same way AC-FR-11's own HAPPY case does: a file the AC's
 *      command depends on is created AFTER the corpus's one commit and never
 *      `git add`-ed, so `git worktree add`'s checkout of HEAD never carries it —
 *      the green control (the AC's own UNMUTATED command) then exits nonzero in
 *      the scratch copy, with no mutation ever applied. Every assertion reads
 *      the persisted evidence row back via a SEPARATE real `lore get --json`
 *      subprocess call and `@lore/core`'s own `extractEvidence` parser — never
 *      an injected recorder spy, which is exactly the gap this task closes.
 *
 *   2. `describe("MINOR fix — ...")` covers the SECOND finding from the same
 *      assessment: a green control that fails to LAUNCH (not merely exits
 *      nonzero) used to return `err(STORE_ERROR)` from `_runFalsifier` and
 *      record NOTHING — an unusable-environment shape with no corpus trace,
 *      inconsistent with every OTHER unusable-environment shape (nonzero exit,
 *      timeout), which DO record `inconclusive`. `verify-runner-service.ts`'s
 *      `_runFalsifier` was fixed in the SAME task this test file ships in
 *      (unify the launch-failure and nonzero-exit branches into one
 *      `inconclusive` recording path). A genuine spawn-level LAUNCH failure
 *      cannot be forced through a real `sh -c <command>` invocation in this
 *      sandbox — empirically verified while building this suite: an empty
 *      `PATH` env var does not stop Bun from resolving `sh` (it falls back to a
 *      built-in default), and the scratch worktree's `cwd` cannot be made to not
 *      exist from outside a single synchronous CLI invocation. So THIS describe
 *      block constructs `VerifyRunnerService` directly (no `bun:sqlite` — this
 *      file runs under vitest, per its own declared oracle command below) wired
 *      to a REAL `CorpusService`/`AcService`/`TaskWorkflowService` over a REAL
 *      (in-memory) `StoreInterface` — `recordVerifiedEvidence` is the SAME
 *      production method `app.ts` binds, never a hand-rolled double — with only
 *      the `executor` port faked to return `err(STORE_ERROR)`, exactly the shape
 *      `verify-executor.ts` documents for a genuine ENOENT/EACCES launch
 *      failure. The read-back is the REAL `CorpusService.get` + `extractEvidence`
 *      path, not a spy on the write call. `executor` is the one port this
 *      class's own JSDoc calls out as injectable-by-design (unlike
 *      `createFalsifierScratchWorktree`, deliberately NOT injectable) — using it
 *      here is the same seam `verify-runner-service.test.ts`'s pre-existing
 *      suite already exercises for the ordinary (non-falsifier) launch-failure
 *      case.
 *
 * RED-first discipline (root CLAUDE.md): the MINOR-fix describe block's ONE
 * test was run against the PRE-fix `_runFalsifier` (via `git stash push --
 * packages/lore/src/service/verify-runner-service.ts`, leaving this file
 * untouched) and observed failing on `expect(result.ok).toBe(true)` — pre-fix,
 * `verifyFalsifier` returned `err(STORE_ERROR)` and the corpus row was never
 * written. The genuine failing command + tail is recorded via `lore evidence
 * --result expected-fail` at the moment it was red; the fix was then restored
 * (`git stash pop`) and this test re-run green.
 *
 * Dimension mapping:
 *   HAPPY:      AC-FR-12's own scenario — an untracked-only dependency makes the
 *               real CLI's green control exit nonzero in the scratch worktree;
 *               exit 3, message names "Green control failed", and the persisted
 *               row reads back `result: "inconclusive"`, no `attestation`,
 *               `capture_source: "runner"` (SURFACE + PERSISTENCE, both real)
 *   NEGATIVE:   n/a at the CLI layer for this task (AC-FR-11's own NEGATIVE/
 *               reverse-control case — a TRACKED dependency making the green
 *               control pass and the falsifier proceed to a genuine
 *               `expected-fail` — is already pinned in `attested-red.test.ts`;
 *               duplicating it here would re-test AC-FR-2/3, not AC-FR-12)
 *   BOUNDARY:   the read-back locates the row by `ac_ref` inside a real,
 *               `extractEvidence`-parsed array — a runner that appended zero
 *               rows leaves `.find(...)` returning `undefined`, which the
 *               `toBeDefined()` assertion below turns into a loud failure
 *               rather than a vacuous pass (RED direction (b) from AC-FR-12's
 *               own declared falsifiability clause)
 *   ERROR:      the MINOR-fix describe block — the green control's spawn itself
 *               fails to LAUNCH (`executor` returns `err(STORE_ERROR)`,
 *               genuinely un-reachable via a real `sh` spawn in this sandbox —
 *               see the header above) — records the SAME `inconclusive` shape,
 *               `exit_code: -1` (no process ever exited), never a second
 *               executor call (the mutation is never attempted)
 *   STATE:      the persisted evidence row's ABSENCE of an `attestation` key is
 *               asserted directly (`toBeUndefined()`), not merely "some field is
 *               falsy" — an implementation that started attaching a fabricated
 *               `attestation` to an inconclusive row would fail this
 *   REGRESSION: n/a — this is new coverage, not a re-pin of pre-existing
 *               behavior (see AC-FR-2/AC-FR-3's own regression duty, covered by
 *               this task's separately-recorded evidence, not by this file)
 *
 * RED (both required by AC-FR-12, exact discriminating mechanism named):
 *   (a) "the CLI branch prints success and exits 0" — the HAPPY test's
 *       `expect(result.exitCode).toBe(3)` is an EXACT equality, not a
 *       truthiness/non-zero check; a CLI branch hardcoding exit 0 fails it
 *       immediately, and the follow-on `stdout` substring assertions
 *       ("Green control failed", "result:inconclusive") fail independently too.
 *   (b) "the runner skips the inconclusive record entirely" — the read-back's
 *       `evidence.find((e) => e.ac_ref === acId)` returns `undefined` when
 *       nothing was recorded, and `expect(row).toBeDefined()` turns that into a
 *       loud, named failure rather than a vacuous pass over an empty array.
 *
 * @spec_ref spec-falsifiability-reachability-a-feedable-checkpoint-an AC-FR-12
 * @spec_ref task-drive-the-falsify-cli-branch-and-assert-the-persisted
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { VerifyRunnerService } from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec } from "../../../src/service/verify-spawn.js";
import { NoOpTelemetry, err, extractEvidence } from "@lore/core";
import type { CreateDocInput, DocRecord } from "@lore/core";

// ─── Git identity (local, per-commit — never touches the machine's real git config) ──

const GIT_AUTHOR_ARGS = ["-c", "user.email=lore-test@example.com", "-c", "user.name=Lore Test"] as const;

// ══════════════════════════════════════════════════════════════════════════════
// describe 1 — AC-FR-12 itself: real CLI subprocess against a throwaway corpus
// ══════════════════════════════════════════════════════════════════════════════

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir — same shape `verify.test.ts::runLore` uses. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/**
 * Disables every `lore gate` service-layer checkpoint for this fixture's corpus —
 * same shape `verify.test.ts::disableAllGates` uses. This task's fixture spec
 * deliberately stays "draft" (never approved/promoted), so `spec-create`/
 * `plan-promote`/`task-create` must not block its plan/task/AC creation.
 */
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

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function createPrd(dir: string, title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], dir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createSpec(dir: string, title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "spec", "--title", title,"--no-ai", "--content", "body"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createPlan(dir: string, title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createTask(dir: string, planSlug: string, title: string, acScope: readonly string[]): string {
  const args = ["create", "task", "--title", title, "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"];
  for (const acId of acScope) args.push("--ac-scope", acId);
  const r = runLore(args, dir);
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

/** Declares a script-mode AC carrying a DECLARED falsifier (spec-falsifiability-reachability-a-feedable-checkpoint-an §D2). */
function declareScriptAcWithFalsifier(
  dir: string,
  specSlug: string,
  acId: string,
  command: string,
  falsifier: { path: string; find: string; replace: string; exitCode: number },
): void {
  const r = runLore(
    [
      "ac",
      "add",
      specSlug,
      acId,
      "--statement",
      "A dogfood AC exercising the --falsify green-control path.",
      "--mode",
      "script",
      "--oracle",
      "other",
      "--command",
      command,
      "--falsifier-path",
      falsifier.path,
      "--falsifier-find",
      falsifier.find,
      "--falsifier-replace",
      falsifier.replace,
      "--falsifier-exit-code",
      String(falsifier.exitCode),
    ],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`ac add (falsifier) failed: ${r.stderr}`);
}

describe("AC-FR-12 — SURFACE + PERSISTENCE: lore verify --falsify green-control inconclusive", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-falsify-green-control-"));
    // The falsifier's scratch worktree is `git worktree add --detach <dir> HEAD` off
    // THIS directory — it must be a real git repo with at least one commit.
    execFileSync("git", ["init", "-q"], { cwd: tmpDir });

    const init = runLore(["init"], tmpDir);
    if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
    disableAllGates(tmpDir);
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it(
    "AC-FR-12: exit 3, message names the green control, and the persisted row reads back inconclusive with no attestation",
    // reason: 20s budget (spec-a-test-case-s-timeout-budget-must-be-declared-when-its D1) —
    // this test spawns 7 real `bun run` CLI subprocesses (create prd/spec/plan/task, ac
    // add, verify, get) plus 2 git commands; mirrors `verify.test.ts`'s AC-VRF-10.N1 own
    // 15s budget for its comparable 9-subprocess fixture, sized up slightly for the extra
    // `git init`/`git add`/`git commit` calls this fixture also performs.
    { timeout: 20_000 },
    () => {
      const acId = "AC-FR-12-GREEN";
      const prdSlug = createPrd(tmpDir, "Falsify Green Control PRD");
      const specSlug = createSpec(tmpDir, "Falsify Green Control Spec", prdSlug);
      // command depends on a file that will be created AFTER this fixture's one commit
      // and NEVER `git add`-ed — see the file header for why this reliably makes the
      // scratch worktree's copy of the command fail (it never carries untracked content).
      declareScriptAcWithFalsifier(tmpDir, specSlug, acId, "cat dependency.txt", {
        path: "dependency.txt",
        find: "hello",
        replace: "goodbye",
        exitCode: 1,
      });
      const planSlug = createPlan(tmpDir, "Falsify Green Control Plan", specSlug);
      const taskSlug = createTask(tmpDir, planSlug, "Falsify Green Control Task", [acId]);

      // Commit the corpus's current state — `dependency.txt` does not exist on disk yet,
      // so it is absent from HEAD entirely (not merely uncommitted).
      execFileSync("git", ["add", "-A"], { cwd: tmpDir });
      execFileSync("git", [...GIT_AUTHOR_ARGS, "commit", "-q", "-m", "initial corpus state"], { cwd: tmpDir });

      // Create it now, and deliberately never `git add` it — untracked.
      writeFileSync(join(tmpDir, "dependency.txt"), "hello\n");

      // ⛔ Measured WITHOUT a pipe — `RunResult.exitCode` comes straight from
      // `spawnSync`'s own `.status`, never through a shell pipeline that would report a
      // downstream command's exit status instead of this one's.
      const result = runLore(
        ["verify", planSlug, "--task", taskSlug, "--falsify", acId, "--by", "falsify-oracle-test"],
        tmpDir,
      );

      // RED (a) — an EXACT equality, not `!== 0` / truthy: a CLI branch hardcoding
      // "success, exit 0" fails this immediately.
      expect(result.exitCode).toBe(3);
      expect(result.stdout).toContain("Green control failed");
      expect(result.stdout).toContain(acId);
      expect(result.stdout).toContain("result:inconclusive");
      expect(result.stdout).toContain("no attestation recorded");

      // Read the row back out of the corpus via a SEPARATE real `lore get --json`
      // subprocess call — never an injected recorder spy.
      const readBack = runLore(["get", taskSlug, "--json"], tmpDir);
      expect(readBack.exitCode).toBe(0);
      const parsed = JSON.parse(readBack.stdout) as { data: { doc: DocRecord } };
      const evidence = extractEvidence(parsed.data.doc);

      // RED (b) — a runner that skipped the record entirely leaves `evidence` with no
      // matching row; `.find` returns `undefined` and `toBeDefined()` fails loud.
      const row = evidence.find((e) => e.ac_ref === acId);
      expect(row).toBeDefined();
      expect(row?.result).toBe("inconclusive");
      expect(row?.attestation).toBeUndefined();
      expect(row?.capture_source).toBe("runner");
      expect(row?.recorded_by).toBe("falsify-oracle-test");
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// describe 2 — the MINOR fix: the green control's own LAUNCH failure
// ══════════════════════════════════════════════════════════════════════════════

/**
 * A throwaway, real git repo with exactly one commit — used ONLY as the
 * `config.repoRoot` `_runFalsifier`'s `createFalsifierScratchWorktree` branches a
 * scratch worktree off. Never touches this repo's own `.lore/` or working tree.
 */
function makeThrowawayGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-falsify-launch-fail-repo-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "placeholder\n");
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", [...GIT_AUTHOR_ARGS, "commit", "-q", "-m", "initial"], { cwd: dir });
  return dir;
}

interface InMemoryFixture {
  readonly corpusService: CorpusService;
  readonly taskWorkflowService: TaskWorkflowService;
  readonly taskId: string;
  readonly planId: string;
  readonly acId: string;
}

/**
 * Wires a REAL `CorpusService`/`AcService`/`TaskWorkflowService` graph over a REAL
 * (in-memory) `StoreInterface` — `recordVerifiedEvidence` below is bound to the SAME
 * production method `app.ts` binds for the compiled CLI, never a hand-rolled double.
 * `InMemoryStore` carries no `bun:sqlite` dependency, so this stays vitest-safe (this
 * file's own declared oracle command runs under `bunx vitest`).
 */
async function buildInMemoryFixture(): Promise<InMemoryFixture> {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const acService = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(
    store,
    new NoOpTelemetry(),
    { claimTtlMinutes: 120 },
    corpusService.resolveDeclaredAcIds.bind(corpusService),
    undefined,
    undefined,
    {},
    corpusService.resolveDeclaredAcCriteria.bind(corpusService),
  );

  const prd = await corpusService.create({ type: "prd", title: "Launch-Fail PRD", content: "body" } as CreateDocInput);
  if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);
  const spec = await corpusService.create({
    type: "spec",
    title: "Launch-Fail Spec",
    content: "body",
  } as CreateDocInput);
  if (!spec.ok) throw new Error(`spec create failed: ${JSON.stringify(spec.error)}`);

  const acId = "AC-FR-12-LAUNCH";
  const addResult = await acService.addCriterion(spec.value.id, {
    id: acId,
    statement: "A dogfood AC exercising the green control's own launch-failure path.",
    verify: {
      mode: "script",
      oracle: "other",
      command: "true",
      falsifier: { path: "whatever.txt", find: "x", replace: "y", expected_exit_code: 1 },
    },
  });
  if (!addResult.ok) throw new Error(`ac add failed: ${JSON.stringify(addResult.error)}`);

  const plan = await corpusService.create({
    type: "plan",
    title: "Launch-Fail Plan",
    parent_id: spec.value.id,
    content: "body",
  } as CreateDocInput);
  if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);

  const task = await corpusService.create({
    type: "task",
    title: "Launch-Fail Task",
    parent_id: plan.value.id,
    content: "body",
    extra: { plan_id: plan.value.id },
  } as CreateDocInput);
  if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);

  return {
    corpusService,
    taskWorkflowService,
    taskId: task.value.id,
    planId: plan.value.id,
    acId,
  };
}

describe("MINOR fix — the green control's own LAUNCH failure records inconclusive too (never a silent STORE_ERROR)", () => {
  let repoDir: string;

  beforeEach(() => {
    repoDir = makeThrowawayGitRepo();
  });

  afterEach(() => {
    try {
      rmSync(repoDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("a green-control spawn that fails to LAUNCH (executor returns err) records inconclusive with exit_code -1 and no attestation, read back from a real corpus", async () => {
    const fixture = await buildInMemoryFixture();
    const launchFailureMessage = "ENOENT: no such file or directory, posix_spawn 'sh'";
    const executorCalls: VerifySpawnSpec[] = [];

    const service = new VerifyRunnerService(
      fixture.corpusService.getPlanBundle.bind(fixture.corpusService),
      fixture.taskWorkflowService.recordVerifiedEvidence.bind(fixture.taskWorkflowService),
      async (spec) => {
        executorCalls.push(spec);
        return err({ code: "STORE_ERROR", message: launchFailureMessage });
      },
      {
        repoRoot: repoDir,
        defaultTimeoutMs: 5000,
        claimTtlMinutes: 120,
        requireCommandApproval: false,
        envAllowlist: [],
        envPassthroughAll: true,
        processEnv: {},
      },
    );

    const result = await service.verifyFalsifier(fixture.planId, fixture.acId, {
      explicitTaskIdOrSlug: fixture.taskId,
      by: "falsify-oracle-test",
      nowIso: "2026-08-21T00:00:00.000Z",
    });

    // Exactly ONE spawn attempt (the green control) — never a second call for a
    // mutation that this fix correctly never applies.
    expect(executorCalls).toHaveLength(1);

    // Pre-fix, this was `err({code: "STORE_ERROR", ...})` and recorded nothing — the
    // exact RED this sub-test was run against before the fix (see file header).
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.result).toBe("inconclusive");
    expect(result.value.exit_code).toBe(-1);
    expect(result.value.output_tail).toContain("FAILED TO LAUNCH");
    expect(result.value.output_tail).toContain(launchFailureMessage);

    // Read the row back out of the corpus via the REAL `CorpusService.get` +
    // `extractEvidence` path — never an injected recorder spy.
    const readBack = await fixture.corpusService.get(fixture.taskId);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) return;
    const evidence = extractEvidence(readBack.value.doc);
    const row = evidence.find((e) => e.ac_ref === fixture.acId);
    expect(row).toBeDefined();
    expect(row?.result).toBe("inconclusive");
    expect(row?.attestation).toBeUndefined();
    expect(row?.capture_source).toBe("runner");
  });
});
