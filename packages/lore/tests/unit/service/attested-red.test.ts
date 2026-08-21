/**
 * Attested-red runner oracle for AC-FR-2 / AC-FR-3 / AC-FR-11
 * (spec-falsifiability-reachability-a-feedable-checkpoint-an §D2/D3/D4,
 * task-build-the-attested-red-runner-a-declared-falsifier-applied,
 * task-run-the-unmutated-green-control-before-the-mutation-and).
 *
 * Unlike the pre-existing `verify-runner-service.test.ts` suite, this file
 * exercises `VerifyRunnerService.verifyFalsifier` with a REAL `executor`
 * (spawns `sh -c <command>` via `node:child_process.spawnSync`, never a
 * scripted double) and REAL git worktree mechanics
 * (`createFalsifierScratchWorktree` / `applyFalsifierMutation` /
 * `removeFalsifierScratchWorktree`, all plain exported functions from
 * `verify-runner-service.ts` — never injectable, see their own JSDoc for
 * why). Only `getPlanBundle`/`recordVerifiedEvidence` stay hand-written test
 * doubles — those two ports' OWN contracts are already covered by the
 * pre-existing suite; what is under test HERE is whether a declared
 * falsifier can be driven to a REAL, runner-captured red through REAL git
 * isolation. Every fixture is a THROWAWAY `mkdtemp` + `git init` repo — NEVER
 * this repo's own working tree (this file's own `git status --porcelain`
 * assertions would be meaningless against a repo already carrying unrelated
 * diffs).
 *
 * Dimension mapping:
 *   HAPPY:      a real mutated command exits exactly the falsifier's
 *               declared code → ONE `result:"expected-fail"` /
 *               `capture_source:"runner"` evidence row recorded, output_tail
 *               names the AC id and the mutation (AC-FR-2)
 *   NEGATIVE:   AC carries no `falsifier` at all → refused, nothing recorded
 *   ERROR:      falsifier declares an exit code the mutation does NOT
 *               actually produce → refused loud, nothing recorded (AC-FR-2's
 *               own RED case, permanently pinned as a regression here)
 *   STATE:      the falsifier's mutation is applied and observable INSIDE
 *               the scratch worktree, while the ORIGINAL repo's file is
 *               provably untouched both by content hash and
 *               `git status --porcelain` (AC-FR-3)
 *   BOUNDARY:   the isolation guarantee holds even when the orchestrating
 *               process is SIGKILLed between "mutation applied" and "cleanup
 *               ever runs" — the worst-case crash point (AC-FR-3's own RED
 *               case: a naive in-place-mutate-then-finally-revert
 *               implementation is deliberately NOT reachable via any
 *               production code path — the isolation instead holds
 *               STRUCTURALLY, because the mutation is never applied to the
 *               original tree in the first place)
 *   REGRESSION: a successful, fully-completed `verifyFalsifier` call (no
 *               crash) ALSO leaves the original repo untouched — the
 *               isolation guarantee is not an accident of an unfinished run
 *
 * AC-FR-11 dimension mapping (`describe("AC-FR-11 — green-control", ...)`
 * below — a SEPARATE feature from AC-FR-2/AC-FR-3 above: the green control
 * this task adds runs the AC's UNMUTATED command BEFORE any mutation exists):
 *   HAPPY:      a scratch worktree missing an UNTRACKED-only dependency file
 *               (measured defect vector — `git worktree add`/`git stash
 *               create` never carry untracked content) makes the green
 *               control itself exit nonzero → records `result:"inconclusive"`
 *               with NO `attestation`, and NEVER applies the mutation —
 *               EVEN THOUGH that failure's exit code numerically COINCIDES
 *               with the falsifier's own declared `expected_exit_code`
 *               (deliberately, so this test doubles as the permanently-pinned
 *               RED case: an implementation that skips the green control, or
 *               compares it against the declared code instead of `=== 0`,
 *               would wrongly record `"expected-fail"` here)
 *   NEGATIVE:   mandatory reverse control, same command/falsifier — the
 *               SAME dependency file, this time TRACKED and committed, makes
 *               the green control exit 0 and the run proceeds to a normal
 *               mutated `"expected-fail"` — proving the HAPPY failure above
 *               is really about the file being untracked, not a broken
 *               fixture
 *   ERROR:      a DIFFERENT genuine cause — a green control command that
 *               fails via Node module resolution (`require()` of a package
 *               nobody installed, mirroring the measured "no usable
 *               node_modules" defect vector) — also downgrades to
 *               `inconclusive`, proving the green control is a generic exit-
 *               code check, not special-cased to the file-presence shape
 *               HAPPY/NEGATIVE use
 *   STATE:      after a green-control-failure run, the ORIGINAL repo is
 *               STILL byte-identical and `git status --porcelain` STILL
 *               empty (AC-FR-3's isolation guarantee extends to this new,
 *               earlier-exiting path — recording evidence is not exempt)
 *   BOUNDARY:   a green control that TIMES OUT (never exits at all, rather
 *               than exiting nonzero) is treated exactly like a nonzero exit
 *               — `!timedOut && exitCode === 0` is the ONE usability
 *               condition, not "any observed exit code at all"
 *   REGRESSION: a green-control failure records EXACTLY one evidence row —
 *               the mutate/spawn/compare/record sequence never partially
 *               fires a second write attempt after the early return
 *
 * RED-FIRST verification note (recorded in the task's evidence log at the
 * moment each was red, not re-derived here):
 *   - AC-FR-2's "declare an exit code the mutation does not actually
 *     produce" RED is the `mismatched-exit-code` test below — pinned
 *     permanently as a regression, not a one-time manual exercise, since a
 *     future implementer weakening the exact-match check would otherwise
 *     ship a passing red silently.
 *   - AC-FR-3's "apply the falsifier in-place with a finally-block revert,
 *     then kill the process mid-run" RED was verified MANUALLY once, by
 *     temporarily swapping `applyFalsifierMutation`'s target to the ORIGINAL
 *     repo's own working-tree path (instead of the scratch `worktreeDir`)
 *     inside the SIGKILL probe script below, confirming the hash-comparison
 *     assertion failed, then reverting — see this task's final report for
 *     the exact command/output.
 *   - AC-FR-11's RED is the `green-control: HAPPY` test below, run against
 *     the pre-fix `_runFalsifier` (no green control at all): it recorded
 *     `result:"expected-fail"` with a full `attestation` block for a scratch
 *     worktree that never had a chance to run the real command — see this
 *     task's completion report for the exact command/output pair.
 *
 * @spec_ref AC-FR-2, AC-FR-3, AC-FR-11
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ok, err } from "@lore/core";
import type { AcceptanceCriterion, AcFalsifier, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import {
  VerifyRunnerService,
  createFalsifierScratchWorktree,
  applyFalsifierMutation,
  removeFalsifierScratchWorktree,
} from "../../../src/service/verify-runner-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";

// ─── Real git-repo fixtures (throwaway `mkdtemp` + `git init` — NEVER this
//     repo's own working tree) ──────────────────────────────────────────────

const createdRepos: string[] = [];

function makeThrowawayGitRepo(): { repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-attested-red-fixture-"));
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Attested Red Test"], { cwd: repoRoot });
  writeFileSync(join(repoRoot, "target.txt"), "MAGIC_MARKER present\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-q", "-m", "seed target.txt"], { cwd: repoRoot });
  createdRepos.push(repoRoot);
  return { repoRoot };
}

afterEach(() => {
  // reason: best-effort per-test cleanup of throwaway fixture repos — a
  // failure here is a disk leak in the test runner's own tmpdir, never a
  // correctness issue for the assertions already made above it.
  while (createdRepos.length > 0) {
    const repoRoot = createdRepos.pop();
    if (repoRoot === undefined) continue;
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitStatusPorcelain(repoRoot: string): string {
  return execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
}

// ─── Doc/bundle fixture builders (mirrors verify-runner-service.test.ts's
//     own makeDoc/makePlan/makeSpec/makeTask shapes) ────────────────────────

function makeDoc(overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
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

/** A REAL executor — spawns `sh -c <command>` synchronously via `node:child_process.spawnSync`, never a scripted double. */
async function realExecutor(spec: VerifySpawnSpec): Promise<Result<VerifyExecutionResult, LoreError>> {
  const { spawnSync } = await import("node:child_process");
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

/** A script-mode AC whose command is GREEN against the unmutated fixture repo (grep finds MAGIC_MARKER → exit 0) but goes red once the declared falsifier removes it (grep finds nothing → exit 7). */
function makeFalsifiableCriterion(overrides: { falsifier?: AcFalsifier } = {}): AcceptanceCriterion {
  return {
    id: "AC-FALSIFY-1",
    statement: "target.txt contains MAGIC_MARKER",
    verify: {
      mode: "script",
      oracle: "test",
      command: "grep -q MAGIC_MARKER target.txt && exit 0 || exit 7",
      ...(overrides.falsifier !== undefined ? { falsifier: overrides.falsifier } : {}),
    },
  };
}

const STANDARD_FALSIFIER: AcFalsifier = {
  path: "target.txt",
  find: "MAGIC_MARKER",
  replace: "",
  expected_exit_code: 7,
};

// ─── AC-FR-11 fixtures (green control) ─────────────────────────────────────

/**
 * Same seed as {@link makeThrowawayGitRepo} (tracked `target.txt` containing
 * MAGIC_MARKER), PLUS a second file, `only-in-worktree.txt`, whose presence
 * {@link makeGreenControlCriterion}'s command depends on.
 *
 * `trackDependency: false` (AC-FR-11's own measured defect vector — "absent
 * untracked file") leaves it UNTRACKED: `createFalsifierScratchWorktree`'s
 * default `git worktree add --detach <dir> HEAD` checks out only COMMITTED
 * content, so the scratch worktree structurally cannot see an untracked
 * file, no matter how the AC's command is written.
 *
 * `trackDependency: true` is the MANDATORY reverse control (mirrors
 * `falsifier-execution-root.bun.test.ts`'s own HAPPY+NEGATIVE pairing
 * convention) — the IDENTICAL command and falsifier, in a scratch worktree
 * that DOES carry the dependency, proving a green-control failure in the
 * sibling test genuinely comes from the file being untracked, not from some
 * unrelated command mistake.
 */
function makeThrowawayGitRepoWithDependency(trackDependency: boolean): { repoRoot: string } {
  const { repoRoot } = makeThrowawayGitRepo();
  writeFileSync(join(repoRoot, "only-in-worktree.txt"), "dependency present\n", "utf8");
  if (trackDependency) {
    execFileSync("git", ["add", "-A"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-q", "-m", "track only-in-worktree.txt too"], { cwd: repoRoot });
  }
  return { repoRoot };
}

/**
 * The green-control fixtures' AC (AC-FR-11): green (unmutated) iff BOTH
 * `only-in-worktree.txt` exists AND `target.txt` still contains
 * MAGIC_MARKER; red (mutated) once the mutation removes MAGIC_MARKER —
 * either way landing on the SAME `exit 5` fallback branch.
 *
 * That fallback is DELIBERATELY reused for both failure shapes: the
 * falsifier's own `expected_exit_code` below is ALSO `5`, so a scratch
 * worktree that's merely missing the untracked dependency produces a
 * green-control exit code that numerically COINCIDES with the falsifier's
 * declared value. An implementation that skips the green control (or
 * compares its exit code against `falsifier.expected_exit_code` instead of
 * strictly `=== 0`) would see exit 5 and wrongly record `"expected-fail"` —
 * asserting `result: "inconclusive"` against this exact coincidence is what
 * makes the `green-control: HAPPY` test below a permanently-pinned RED case.
 */
function makeGreenControlCriterion(): AcceptanceCriterion {
  return {
    id: "AC-GREEN-1",
    statement: "only-in-worktree.txt exists AND target.txt contains MAGIC_MARKER",
    verify: {
      mode: "script",
      oracle: "test",
      command: "test -f only-in-worktree.txt && grep -q MAGIC_MARKER target.txt && exit 0 || exit 5",
      falsifier: { path: "target.txt", find: "MAGIC_MARKER", replace: "", expected_exit_code: 5 },
    },
  };
}

// ─── AC-FR-2 ────────────────────────────────────────────────────────────────

describe("AC-FR-2 — falsifier-produces-attested-fail", () => {
  it("falsifier-produces-attested-fail: HAPPY — a real mutated command exits the declared code and records a runner-captured expected-fail row", async () => {
    const { repoRoot } = makeThrowawayGitRepo();
    const criterion = makeFalsifiableCriterion({ falsifier: STANDARD_FALSIFIER });
    const plan = makePlan();
    const spec = makeSpec([criterion]);
    const task = makeTask();
    const bundle: PlanBundle = { plan, spec, tasks: [task] };

    const recorder = makeRecordVerifiedEvidence();
    const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
      ...BASE_CONFIG,
      repoRoot,
    });

    const result = await service.verifyFalsifier(plan.id, criterion.id, {
      explicitTaskIdOrSlug: task.id,
      by: "attested-red-tester",
      nowIso: "2026-08-10T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.exit_code).toBe(7);
    expect(result.value.expected_exit_code).toBe(7);
    expect(result.value.ac_id).toBe("AC-FALSIFY-1");

    expect(recorder.calls).toHaveLength(1);
    const entry = recorder.calls[0]!.entry;
    expect(entry.result).toBe("expected-fail");
    expect(entry.capture_source).toBe("runner");
    expect(entry.ac_ref).toBe("AC-FALSIFY-1");
    expect(entry.attestation?.exit_code).toBe(7);
    expect(entry.attestation?.runner).toBe("lore-cli");
    // D4 — "output MUST contain a token naming what failed".
    expect(entry.output_tail).toContain("[attested-red]");
    expect(entry.output_tail).toContain("AC-FALSIFY-1");

    // Bonus (AC-FR-3 has its own dedicated tests below): even this HAPPY run
    // never touched the original repo's own target.txt.
    expect(readFileSync(join(repoRoot, "target.txt"), "utf8")).toContain("MAGIC_MARKER");
  });

  it("falsifier-produces-attested-fail: NEGATIVE — an AC with no declared falsifier is refused and records nothing", async () => {
    const { repoRoot } = makeThrowawayGitRepo();
    const criterion = makeFalsifiableCriterion(); // no falsifier
    const plan = makePlan();
    const spec = makeSpec([criterion]);
    const task = makeTask();
    const bundle: PlanBundle = { plan, spec, tasks: [task] };

    const recorder = makeRecordVerifiedEvidence();
    const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
      ...BASE_CONFIG,
      repoRoot,
    });

    const result = await service.verifyFalsifier(plan.id, criterion.id, {
      explicitTaskIdOrSlug: task.id,
      by: "attested-red-tester",
      nowIso: "2026-08-10T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("verify.falsifier");
    expect(recorder.calls).toHaveLength(0);
  });

  it("falsifier-produces-attested-fail: ERROR (RED, permanently pinned) — a falsifier declaring an exit code the mutation does not actually produce refuses loud and records nothing", async () => {
    const { repoRoot } = makeThrowawayGitRepo();
    // reason: the mutation genuinely produces exit 7 (verified by the HAPPY
    // case above) — this criterion LIES about it (claims 99), proving the
    // runner asserts the EXACT declared value rather than "any nonzero exit
    // counts as a match" (D4's whole point).
    const criterion = makeFalsifiableCriterion({
      falsifier: { ...STANDARD_FALSIFIER, expected_exit_code: 99 },
    });
    const plan = makePlan();
    const spec = makeSpec([criterion]);
    const task = makeTask();
    const bundle: PlanBundle = { plan, spec, tasks: [task] };

    const recorder = makeRecordVerifiedEvidence();
    const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
      ...BASE_CONFIG,
      repoRoot,
    });

    const result = await service.verifyFalsifier(plan.id, criterion.id, {
      explicitTaskIdOrSlug: task.id,
      by: "attested-red-tester",
      nowIso: "2026-08-10T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("falsifier.expected_exit_code");
    expect(recorder.calls).toHaveLength(0);

    // The original repo is untouched by this refused run too (D3 holds even
    // on the "declaration was wrong" refusal path, not just the success path).
    expect(readFileSync(join(repoRoot, "target.txt"), "utf8")).toContain("MAGIC_MARKER");
    expect(gitStatusPorcelain(repoRoot).trim()).toBe("");
  });

  it(
    "falsifier-produces-attested-fail: NEGATIVE — a stale falsifier whose declared text no longer exists is refused and records nothing",
    async () => {
      const { repoRoot } = makeThrowawayGitRepo();
      const criterion = makeFalsifiableCriterion({
        falsifier: { path: "target.txt", find: "TEXT_THAT_IS_NOT_IN_THE_FILE", replace: "", expected_exit_code: 7 },
      });
      const plan = makePlan();
      const spec = makeSpec([criterion]);
      const task = makeTask();
      const bundle: PlanBundle = { plan, spec, tasks: [task] };

      const recorder = makeRecordVerifiedEvidence();
      const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
      const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
        ...BASE_CONFIG,
        repoRoot,
      });

      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "attested-red-tester",
        nowIso: "2026-08-10T00:00:00.000Z",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_ERROR");
      if (result.error.code !== "VALIDATION_ERROR") return;
      expect(result.error.field).toBe("falsifier.find");
      expect(recorder.calls).toHaveLength(0);
    },
  );
});

// ─── AC-FR-3 ────────────────────────────────────────────────────────────────

describe("AC-FR-3 — working-tree-untouched", () => {
  it("working-tree-untouched: REGRESSION — a full, successfully-completed verifyFalsifier run leaves the original repo byte-identical", async () => {
    const { repoRoot } = makeThrowawayGitRepo();
    const targetPath = join(repoRoot, "target.txt");
    const hashBefore = sha256OfFile(targetPath);

    const criterion = makeFalsifiableCriterion({ falsifier: STANDARD_FALSIFIER });
    const plan = makePlan();
    const spec = makeSpec([criterion]);
    const task = makeTask();
    const bundle: PlanBundle = { plan, spec, tasks: [task] };

    const recorder = makeRecordVerifiedEvidence();
    const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
    const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
      ...BASE_CONFIG,
      repoRoot,
    });

    const result = await service.verifyFalsifier(plan.id, criterion.id, {
      explicitTaskIdOrSlug: task.id,
      by: "attested-red-tester",
      nowIso: "2026-08-10T00:00:00.000Z",
    });
    expect(result.ok).toBe(true); // sanity — the run itself succeeded and recorded

    const hashAfter = sha256OfFile(targetPath);
    expect(hashAfter).toBe(hashBefore);
    expect(gitStatusPorcelain(repoRoot).trim()).toBe("");
  });

  it("working-tree-untouched: BOUNDARY (RED case) — mutation applied but cleanup NEVER runs (the worst-case crash point) still leaves the original repo untouched", () => {
    const { repoRoot } = makeThrowawayGitRepo();
    const targetPath = join(repoRoot, "target.txt");
    const hashBefore = sha256OfFile(targetPath);

    // Steps 3-4 only (create scratch worktree + apply mutation) — deliberately
    // NEVER calling removeFalsifierScratchWorktree, simulating a process that
    // died the instant after the mutation landed, before ANY cleanup step
    // (the `finally` block in `_runFalsifier`) ever got a chance to run.
    const createResult = createFalsifierScratchWorktree(repoRoot);
    expect(createResult.ok).toBe(true);
    if (!createResult.ok) return;
    const scratch = createResult.value;

    const mutateResult = applyFalsifierMutation(scratch.worktreeDir, STANDARD_FALSIFIER);
    expect(mutateResult.ok).toBe(true);

    // The mutation DID happen — just never in the original repo.
    const mutatedContent = readFileSync(join(scratch.worktreeDir, "target.txt"), "utf8");
    expect(mutatedContent).not.toContain("MAGIC_MARKER");

    // The ORIGINAL repo is untouched — proven by content hash AND git status,
    // exactly as AC-FR-3 requires, with the cleanup step never having run.
    const hashAfter = sha256OfFile(targetPath);
    expect(hashAfter).toBe(hashBefore);
    expect(gitStatusPorcelain(repoRoot).trim()).toBe("");

    // Test hygiene only (not part of the assertion above) — clean up the
    // orphaned scratch worktree so this test doesn't leak disk.
    removeFalsifierScratchWorktree(repoRoot, scratch);
  });

  it(
    "working-tree-untouched: BOUNDARY (RED case) — a SIGKILLed subprocess mid-run leaves the original repo untouched",
    { timeout: 20000 },
    async () => {
      const { repoRoot } = makeThrowawayGitRepo();
      const targetPath = join(repoRoot, "target.txt");
      const hashBefore = sha256OfFile(targetPath);

      // Probe script (plain ESM, run in a SEPARATE process via `bun`) —
      // dynamically imports THIS repo's real `verify-runner-service.ts`,
      // creates a scratch worktree, applies the SAME falsifier mutation,
      // announces "MUTATED", then sleeps well past when the parent test
      // will have already sent SIGKILL. It NEVER calls the cleanup function
      // — the parent kills it before it gets the chance, proving the
      // isolation guarantee survives a genuine, unrecoverable process death.
      const serviceModulePath = new URL("../../../src/service/verify-runner-service.ts", import.meta.url).pathname;
      const probeDir = mkdtempSync(join(tmpdir(), "lore-attested-red-probe-"));
      const probeScriptPath = join(probeDir, "probe.mjs");
      writeFileSync(
        probeScriptPath,
        [
          "import { pathToFileURL } from 'node:url';",
          "async function main() {",
          "  const mod = await import(pathToFileURL(process.argv[2]).href);",
          "  const created = mod.createFalsifierScratchWorktree(process.argv[3]);",
          "  if (!created.ok) { console.error('CREATE_FAILED ' + JSON.stringify(created.error)); process.exit(2); }",
          "  const falsifier = JSON.parse(process.argv[4]);",
          "  const applied = mod.applyFalsifierMutation(created.value.worktreeDir, falsifier);",
          "  if (!applied.ok) { console.error('APPLY_FAILED ' + JSON.stringify(applied.error)); process.exit(3); }",
          "  console.log('MUTATED ' + created.value.worktreeDir);",
          "  await new Promise((r) => setTimeout(r, 10000));",
          "  console.log('SHOULD_NEVER_REACH_HERE');",
          "}",
          "main();",
        ].join("\n"),
        "utf8",
      );

      const child = spawn(
        "bun",
        [probeScriptPath, serviceModulePath, repoRoot, JSON.stringify(STANDARD_FALSIFIER)],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      let stdoutBuf = "";
      let stderrBuf = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf8");
      });

      const killedBySignal = await new Promise<boolean>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`probe never printed MUTATED within budget. stdout=${stdoutBuf} stderr=${stderrBuf}`));
        }, 10000);
        const poll = setInterval(() => {
          if (stdoutBuf.includes("MUTATED")) {
            clearInterval(poll);
            clearTimeout(timer);
            child.kill("SIGKILL");
            child.once("exit", (_code, signal) => resolve(signal === "SIGKILL"));
          }
        }, 20);
      });

      expect(killedBySignal).toBe(true);
      expect(stdoutBuf).not.toContain("SHOULD_NEVER_REACH_HERE");

      const hashAfter = sha256OfFile(targetPath);
      expect(hashAfter).toBe(hashBefore);
      expect(gitStatusPorcelain(repoRoot).trim()).toBe("");

      // Test hygiene: the probe's scratch worktree is orphaned (by design —
      // that IS what "killed mid-run" means) — prune it via `git worktree
      // prune` from the original repo rather than reaching into the probe's
      // own tmp dir (whose exact path was only ever printed to the killed
      // child's stdout, and is not load-bearing for the assertions above).
      try {
        execFileSync("git", ["worktree", "prune"], { cwd: repoRoot });
      } catch {
        /* best-effort */
      }
      try {
        rmSync(probeDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  );
});

// ─── AC-FR-11 ───────────────────────────────────────────────────────────────

describe("AC-FR-11 — green-control", () => {
  it(
    "green-control: HAPPY (also the permanently-pinned RED case) — a scratch worktree missing an untracked-only dependency file records inconclusive, never expected-fail, even though the observed exit code coincides with the falsifier's declared value",
    async () => {
      // reason: dependency left UNTRACKED (trackDependency: false) — the
      // measured defect vector this AC exists to close.
      const { repoRoot } = makeThrowawayGitRepoWithDependency(false);
      const criterion = makeGreenControlCriterion();
      const plan = makePlan();
      const spec = makeSpec([criterion]);
      const task = makeTask();
      const bundle: PlanBundle = { plan, spec, tasks: [task] };
      if (criterion.verify.mode !== "script" || criterion.verify.falsifier === undefined) {
        throw new Error("fixture invariant violated — see makeGreenControlCriterion");
      }
      const falsifier = criterion.verify.falsifier;

      const recorder = makeRecordVerifiedEvidence();
      const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
      const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
        ...BASE_CONFIG,
        repoRoot,
      });

      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "attested-red-tester",
        nowIso: "2026-08-21T00:00:00.000Z",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The green control's OWN exit code (the missing-dependency fallback
      // branch) — numerically equal to `falsifier.expected_exit_code` by
      // deliberate fixture construction (see makeGreenControlCriterion), yet
      // the outcome below must still be "inconclusive", never "expected-fail".
      expect(result.value.exit_code).toBe(5);
      expect(falsifier.expected_exit_code).toBe(5);
      expect(result.value.result).toBe("inconclusive");
      expect(result.value.ac_id).toBe("AC-GREEN-1");

      expect(recorder.calls).toHaveLength(1);
      const entry = recorder.calls[0]!.entry;
      expect(entry.result).toBe("inconclusive");
      expect(entry.capture_source).toBe("runner");
      expect(entry.ac_ref).toBe("AC-GREEN-1");
      // AC-FR-11 — NO attestation block on an inconclusive green-control row.
      expect(entry.attestation).toBeUndefined();
      expect(entry.output_tail).toContain("green control");
      expect(entry.output_tail).toContain("AC-GREEN-1");

      // The mutation was never applied — target.txt (the falsifier's own
      // target) is untouched both in spirit (D3) and in fact.
      expect(readFileSync(join(repoRoot, "target.txt"), "utf8")).toContain("MAGIC_MARKER");
    },
  );

  it(
    "green-control: NEGATIVE (mandatory reverse control) — the SAME command and falsifier with the dependency file TRACKED passes the green control and records the mutated expected-fail exactly as before",
    async () => {
      const { repoRoot } = makeThrowawayGitRepoWithDependency(true);
      const criterion = makeGreenControlCriterion();
      const plan = makePlan();
      const spec = makeSpec([criterion]);
      const task = makeTask();
      const bundle: PlanBundle = { plan, spec, tasks: [task] };

      const recorder = makeRecordVerifiedEvidence();
      const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
      const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
        ...BASE_CONFIG,
        repoRoot,
      });

      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "attested-red-tester",
        nowIso: "2026-08-21T00:00:00.000Z",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.result).toBe("expected-fail");
      expect(result.value.exit_code).toBe(5);

      expect(recorder.calls).toHaveLength(1);
      const entry = recorder.calls[0]!.entry;
      expect(entry.result).toBe("expected-fail");
      expect(entry.capture_source).toBe("runner");
      expect(entry.attestation?.exit_code).toBe(5);
      expect(entry.attestation?.runner).toBe("lore-cli");
    },
  );

  it(
    "green-control: ERROR — a green control that fails via Node module resolution (a DIFFERENT genuine cause than the HAPPY/NEGATIVE pair's file presence) also records inconclusive, never expected-fail",
    async () => {
      const { repoRoot } = makeThrowawayGitRepo();
      const criterion: AcceptanceCriterion = {
        id: "AC-GREEN-MODULE-1",
        statement: "a package nobody installed can be required",
        verify: {
          mode: "script",
          oracle: "test",
          // reason: mirrors the measured "no usable node_modules" defect
          // vector genuinely — `node -e "require(...)"` against a package
          // name that certainly does not exist fails with a real
          // MODULE_NOT_FOUND, exit 1, never a scripted/stubbed exit code.
          command: 'node -e "require(\'lore-attested-red-nonexistent-pkg-xyz\')"',
          falsifier: { path: "target.txt", find: "MAGIC_MARKER", replace: "", expected_exit_code: 1 },
        },
      };
      const plan = makePlan();
      const spec = makeSpec([criterion]);
      const task = makeTask();
      const bundle: PlanBundle = { plan, spec, tasks: [task] };

      const recorder = makeRecordVerifiedEvidence();
      const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
      const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
        ...BASE_CONFIG,
        repoRoot,
      });

      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "attested-red-tester",
        nowIso: "2026-08-21T00:00:00.000Z",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.result).toBe("inconclusive");

      expect(recorder.calls).toHaveLength(1);
      const entry = recorder.calls[0]!.entry;
      expect(entry.result).toBe("inconclusive");
      expect(entry.attestation).toBeUndefined();
      expect(entry.output_tail).toContain("Cannot find module");
    },
  );

  it(
    "green-control: STATE — after a green-control-failure run, the ORIGINAL repo is byte-identical and git status stays clean (AC-FR-3's isolation guarantee extends to this earlier-exiting path)",
    async () => {
      const { repoRoot } = makeThrowawayGitRepoWithDependency(false);
      const targetPath = join(repoRoot, "target.txt");
      const hashBefore = sha256OfFile(targetPath);
      // reason: `only-in-worktree.txt` is DELIBERATELY untracked (the fixture
      // under test) — it legitimately shows up as `?? only-in-worktree.txt`
      // in `repoRoot`'s OWN status both before and after this run, so the
      // isolation proof below compares against THIS baseline (captured before
      // the falsifier run touches anything) rather than asserting a
      // hardcoded-empty status, which would conflate "this repo carries
      // untracked fixture noise" with "the falsifier run modified something".
      const statusBefore = gitStatusPorcelain(repoRoot);

      const criterion = makeGreenControlCriterion();
      const plan = makePlan();
      const spec = makeSpec([criterion]);
      const task = makeTask();
      const bundle: PlanBundle = { plan, spec, tasks: [task] };

      const recorder = makeRecordVerifiedEvidence();
      const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
      const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
        ...BASE_CONFIG,
        repoRoot,
      });

      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "attested-red-tester",
        nowIso: "2026-08-21T00:00:00.000Z",
      });
      expect(result.ok).toBe(true); // sanity — the run itself succeeded and recorded
      if (!result.ok) return;
      expect(result.value.result).toBe("inconclusive");

      expect(sha256OfFile(targetPath)).toBe(hashBefore);
      expect(gitStatusPorcelain(repoRoot)).toBe(statusBefore);
    },
  );

  it(
    "green-control: BOUNDARY — a green control that TIMES OUT (rather than exiting nonzero) is treated exactly like a nonzero exit, never like a proven red",
    async () => {
      const { repoRoot } = makeThrowawayGitRepo();
      const criterion: AcceptanceCriterion = {
        id: "AC-GREEN-TIMEOUT-1",
        statement: "the command completes within the configured timeout",
        verify: {
          mode: "script",
          oracle: "test",
          command: "sleep 5", // reason: genuinely never exits within the tiny timeout below
          falsifier: { path: "target.txt", find: "MAGIC_MARKER", replace: "", expected_exit_code: 124 },
        },
      };
      const plan = makePlan();
      const spec = makeSpec([criterion]);
      const task = makeTask();
      const bundle: PlanBundle = { plan, spec, tasks: [task] };

      const recorder = makeRecordVerifiedEvidence();
      const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
      const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
        ...BASE_CONFIG,
        repoRoot,
        defaultTimeoutMs: 300, // reason: far shorter than `sleep 5` — a genuine timeout, not a stub
      });

      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "attested-red-tester",
        nowIso: "2026-08-21T00:00:00.000Z",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.result).toBe("inconclusive");

      expect(recorder.calls).toHaveLength(1);
      const entry = recorder.calls[0]!.entry;
      expect(entry.result).toBe("inconclusive");
      expect(entry.attestation).toBeUndefined();
    },
    10_000,
  );

  it(
    "green-control: REGRESSION — a green-control failure records EXACTLY one evidence row, never a partial second write from the mutate/spawn/compare sequence it short-circuits",
    async () => {
      const { repoRoot } = makeThrowawayGitRepoWithDependency(false);
      const criterion = makeGreenControlCriterion();
      const plan = makePlan();
      const spec = makeSpec([criterion]);
      const task = makeTask();
      const bundle: PlanBundle = { plan, spec, tasks: [task] };

      const recorder = makeRecordVerifiedEvidence();
      const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
      const service = new VerifyRunnerService(getPlanBundle, recorder.fn, realExecutor, {
        ...BASE_CONFIG,
        repoRoot,
      });

      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "attested-red-tester",
        nowIso: "2026-08-21T00:00:00.000Z",
      });

      expect(result.ok).toBe(true);
      // EXACTLY one — never zero (the outcome IS recordable) and never two
      // (no leftover second write attempt from a mutate/spawn that never ran).
      expect(recorder.calls).toHaveLength(1);
    },
  );
});
