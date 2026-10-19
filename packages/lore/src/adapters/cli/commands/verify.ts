/**
 * lore verify <plan> [--ac <id> repeatable] [--task <t>] [--json]
 *   [--allow-new-commands|--yes] [--execution-root <path>] [--falsify <AC-ID>]
 *
 * Trusted runner (SPEC-039): actually EXECUTES a plan's declared script-mode
 * acceptance criteria (via `VerifyRunnerService.verifyPlan`) and records the
 * outcome as runner-attested evidence — `result` is derived from the command's
 * exit code, not a caller assertion (contrast `lore evidence`, which is
 * self-reported). Thin pipe only: this file resolves args, calls the service,
 * renders the per-AC outcome table, and maps the result to an exit code.
 *
 * `--falsify <AC-ID>` (spec-falsifiability-reachability-a-feedable-checkpoint-an
 * §D2/D3/D4) is the ATTESTED-RED runner — a SEPARATE code path (see `run`'s own
 * early-return branch below), landed on THIS command rather than a sibling
 * subcommand because every piece of context it needs (plan/spec/task
 * resolution, the M2 env-allowlist, the injected `executor` port) is already
 * resolved here, and a sibling would have had to re-derive all of it. It
 * creates a SCRATCH git worktree off the RESOLVED execution root's `HEAD` —
 * or, when that root is itself a linked worktree, off a `git stash create`
 * snapshot of THAT worktree's own uncommitted state (AC-JV-3,
 * spec-judgment-surfaces-must-verify-before-they-certify-machine §D5 — see the
 * branch's own inline comment below) — via
 * `VerifyRunnerService.verifyFalsifier` → `createFalsifierScratchWorktree`,
 * runs a GREEN CONTROL — the named AC's own command, UNMUTATED, in that
 * scratch worktree (AC-FR-11, spec-falsifiability-reachability-a-feedable-
 * checkpoint-an §AC-FR-11) — BEFORE applying anything: a scratch environment
 * missing `node_modules`, an untracked file the command depends on, or a
 * gitignored `dist/lore` binary exits nonzero on its OWN, with no mutation
 * involved, and prints "Green control failed ... result:inconclusive, no
 * attestation recorded" (exit 3) rather than a proven red. Only once that
 * control exits 0 does it apply the named AC's declared `verify.falsifier`
 * mutation there (NEVER the caller's working tree), run the AC's command
 * again in that isolated copy, and record a runner-issued
 * `result: "expected-fail"` / `capture_source: "runner"` evidence row ONLY
 * when the observed exit code equals the falsifier's declared value exactly
 * (printed as "Attested red recorded ... result:expected-fail", exit 0) — a
 * mismatch or a missing/stale declaration refuses loud (exit per
 * `exitCode(error)`) and records NOTHING. Requires the PLAN positional
 * (refuses `--task`-only ad-hoc invocations, exit 2) and skips ONLY the
 * ordinary four-step pipeline's M2 approval gate (a falsifier run always
 * executes a mutated tree, so "already-seen command" never applies) — the
 * SAME `executionRoot` the ordinary pipeline resolves and threads into
 * `verifyPlan` is threaded into this branch's `verifyFalsifier` call too, not
 * skipped.
 *
 * `--ac <id>` may repeat (citty collapses repeated `--ac` flags into a string
 * array at the raw-args layer — see `normalizeRepeatableFlag` below) to
 * restrict the run to a subset of the spec's declared ACs. Omitted = every
 * declared AC. `--task` overrides the plan's claim-based task resolution
 * (`resolveTargetTask`, `@lore/core`) — required when zero or more than one
 * task on the plan holds a fresh claim (ambiguous → VALIDATION_ERROR, exit 4,
 * message lists every candidate slug).
 *
 * SPEC-039 §M2 trust-hardening — command-provenance approval: a script AC's
 * command that is NEW or CHANGED relative to the target task's evidence
 * history requires explicit approval before it runs (`verify.
 * require_command_approval` config, default true). This CLI surface resolves
 * that approval in one of three ways:
 *   1. `--allow-new-commands` (alias `--yes`) — approve every new/changed
 *      command for this run without prompting (also the required escape for
 *      non-interactive/CI invocations).
 *   2. Interactive TTY (no `--json`, `inv.io.stdinIsTTY`) — prompt
 *      `Run new/changed verify command "<cmd>"? [y/N]` per unapproved AC via
 *      `promptYesNo`; a non-"y"/"yes" answer aborts the run at that AC.
 *   3. Neither of the above (non-interactive, no flag) — the run aborts at the
 *      first unapproved AC with `NEEDS_APPROVAL` (exit 7), naming the exact
 *      `--allow-new-commands` flag in the error message.
 * A command already present in the task's evidence history never triggers any
 * of the above (SPEC-039 §M2 — "don't re-prompt for known commands"). Disable
 * the whole gate via `verify.require_command_approval: false` in config.
 *
 * SPEC-063 execution-root correctness — a linked git worktree carries no
 * `.lore/` of its own, so the corpus's `repoRoot` (`findLoreDbPath` walks UP
 * from `process.cwd()`) always resolves to the MAIN checkout, even when this
 * command is invoked from inside a worktree. Before SPEC-063, `lore verify`
 * unconditionally spawned every AC command from that corpus root — an agent
 * running it from its own worktree silently attested against the main
 * checkout's tree, not the code it just wrote. This surface now:
 *   1. Gathers git facts about `process.cwd()` (`git rev-parse
 *      --git-common-dir`/`--git-dir`/`--show-toplevel`, `gatherVerifyGitFacts`
 *      below) and resolves the execution root via `@lore/core`'s pure
 *      `resolveVerifyExecutionRoot({corpusRoot, callerCwd, gitFacts})` — a
 *      git-facts probe failure fails SAFE to the corpus root (never guesses).
 *   2. `--execution-root <path>` overrides the inference entirely: the run
 *      spawns from EXACTLY that path, resolved via the SAME core function fed
 *      a synthetic fact set (`callerCwd`/`worktreeRoot` both the given path,
 *      so containment trivially holds) — this ALWAYS prints the
 *      execution-root line (point 3), even when the override happens to
 *      coincide with the corpus root.
 *   3. When the resolved mode is `"worktree"` (or an explicit override was
 *      given), prints `Execution root: <path>` on its own line BEFORE the
 *      "Verifying ..." header and any AC result line
 *      (`verify-render.ts::buildVerifyHeaderLines`) — a silent switch would
 *      trade one invisible wrong root for another. `mode === "corpus_root"`
 *      with no override prints nothing extra (byte-identical to pre-SPEC-063
 *      output).
 *   4. Threads the resolved `{root, mode}` into `VerifyRunnerService.verifyPlan`'s
 *      `opts.executionRoot` — every AC's command spawns from it, and every
 *      recorded evidence's `attestation` carries `execution_root`/
 *      `execution_mode` (SPEC-063 §Design Decisions D2, D3).
 *   5. The SAME resolved `{root, mode}` also feeds `verifyFalsifier`'s
 *      `opts.executionRoot` on the `--falsify` branch below (AC-JV-3,
 *      spec-judgment-surfaces-must-verify-before-they-certify-machine §D5) —
 *      before that fix this branch silently dropped the resolution and always
 *      scratched off `config.repoRoot` regardless of point 1's result.
 *
 * Exit codes (SPEC-003 §5 `exitCode()` SSOT covers the LoreError branch; the
 * "some AC failed"/"some AC inconclusive" branches below are NOT LoreErrors —
 * they're business outcomes, mapped independently, INCONCLUSIVE taking
 * precedence over FAILED when a run has both):
 *   0 = success — every executed script-mode AC passed (or there were none to
 *       run, e.g. every declared AC is ai/human-mode; a clear notice prints in
 *       that case, per SPEC-039 §3's "ai/human mode ACs are skipped and
 *       reported, never silently dropped")
 *   1 = at least one executed AC's command exited non-zero (or timed out) —
 *       "ran fine, an assertion failed", the SAME bucket `exitCode()` already
 *       reserves for STORE_ERROR/generic failure (SPEC-003 §5's CLAUDE.md:
 *       "1 = STORE_ERROR / unknown"); mirrors how `tsc`/`vitest`/`grep -c`
 *       distinguish "invocation was invalid" (2/3/4/5/6/7, see below) from
 *       "the thing I ran reported failure" (1) — chosen so a CI wrapper's
 *       single `$? -ne 0` check covers both a launch abort and a failed AC
 *       uniformly
 *   3 = DOC_NOT_FOUND (plan or explicit --task not found) — OR at least one
 *       executed `oracle: "test"` AC's attestation-completeness guard (SPEC-061)
 *       downgraded its result to `"inconclusive"` (a zero/under-match: the
 *       command exited 0 but did not actually execute every test-file path it
 *       declared) — the SAME "oracle found a problem" bucket `status
 *       --check-drift` already uses. Takes precedence over exit 1 when a run
 *       has both an inconclusive AND a genuinely-failed AC. ALSO the
 *       `--falsify` branch's own AC-FR-11 outcome: the green control (the
 *       AC's own UNMUTATED command) exited nonzero/timed out in the scratch
 *       worktree, so no mutation was ever attempted — printed as "Green
 *       control failed ... result:inconclusive" rather than a silent 0.
 *   4 = VALIDATION_ERROR (plan has no parent spec / spec has no structured ACs
 *       / unknown --ac id / ambiguous target task)
 *   5 = STALE_VERSION (a concurrent writer raced an evidence write)
 *   1 = STORE_ERROR (a script command's LAUNCH failed, e.g. ENOENT — the run
 *       aborts; distinct from an executed-but-failing command, but shares the
 *       same exit code per the SSOT table — the message names every AC
 *       already recorded before the abort)
 *   7 = NEEDS_APPROVAL (SPEC-039 §M2 — a new/changed command was rejected by
 *       the command-provenance approval gate; the message names the exact
 *       `--allow-new-commands` recovery flag)
 *
 * SPEC-069 ad-hoc-task runner path (task-the-ad-hoc-task-channel-has-no-
 * attested-evidence-path-lore) — the `<PLAN>` positional is OPTIONAL. Omit it
 * ONLY when `--task` names a `--adhoc` task (SPEC-069 §Design Decisions D2): no
 * `plan_id` exists to resolve, so `getPlanBundle` structurally cannot reach a
 * governing spec for it (confirmed RED: `lore verify <that-task-id>` — passing
 * the task's own id as `<PLAN>` — refuses `Expected a plan document; got type
 * 'task'`, the exact leaky message this path exists to avoid). This adapter
 * resolves the named task + every corpus spec directly via `app.corpusService`
 * (no new constructor port on `VerifyRunnerService` — the same "adapter
 * resolves IO, service decides" split `getPlanBundle` itself already uses) and
 * calls `VerifyRunnerService.verifyAdhocTask`, which searches for the ONE spec
 * whose `acceptance_criteria` fully declares the task's `extra.ac_scope` ids —
 * zero or multiple matches refuse loud, never guessed. Every step after that
 * (declared-scope selection, M2 approval, execution, attested evidence write)
 * is the IDENTICAL shared pipeline `<PLAN>`-mode runs — a GENUINE runner
 * attestation (real command execution, real `attestation.runner`/`exit_code`/
 * `duration_ms`), NOT a synthesized marker. The recorded evidence is now
 * SHAPE-IDENTICAL to the plan-owned path, `ac_ref` included:
 * `TaskWorkflowService.appendEvidenceEntry`'s cross-entity check no longer
 * walks a plan-only `parent_id` for an ad-hoc task — it branches on
 * `extra.adhoc` and resolves declared ids through the injected
 * `CorpusService.resolveDeclaredAcIdsForAdhocTask` port (wired in `app.ts`),
 * so an ad-hoc task's attested evidence DOES contribute to AC-coverage
 * aggregation (`AcService.listCriteria`). Oracle:
 * `tests/integration/cli/verify.test.ts`'s ad-hoc GREEN case asserts
 * `attestation.runner` AND `ac_ref` on the same recorded entry.
 * Omitting `<PLAN>` with no `--task`, or naming a non-ad-hoc task, is a usage
 * error (exit 2) naming the requirement explicitly — never the internal
 * `getPlanBundle` leak. The `<PLAN>`-given path is BYTE-IDENTICAL to
 * pre-SPEC-069 behavior (REGRESSION — `verify-runner-service.test.ts`'s
 * pre-existing suite passes unmodified).
 *
 * Source: SPEC-039 §2, §3, §4 AC-VRF-10; §M2; SPEC-061 §Scope D3; SPEC-063
 *   §Design Decisions D1-D4; SPEC-069 §Design Decisions D2;
 *   spec-falsifiability-reachability-a-feedable-checkpoint-an §D2/D3/D4 AC-FR-2/3
 *   (`--falsify` attested-red runner)
 */

import { spawnSync } from "node:child_process";

import { resolve as resolvePath } from "node:path";
import { promptYesNo } from "../prompt.js";
import { defineLoreCommand } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { VERIFY_NO_SCRIPT_ACS } from "../cli-refusal-messages.js";
import { formatAcResultLine, buildVerifyHeaderLines } from "../verify-render.js";
import { resolveVerifyExecutionRoot } from "@lore/core";
import type { VerifyGitFacts, VerifyExecutionRootResolution, LoreError, Result } from "@lore/core";
import type { VerifyRunnerService, VerifyPlanResult } from "../../../service/verify-runner-service.js";
import type { App } from "../../../app.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/**
 * `App.verifyRunnerService` is typed optional only to keep pre-existing
 * hand-built App test stubs (outside this task's file anchors) compiling —
 * see its JSDoc in app.ts. `loadLoreApp()` (this adapter's only App source)
 * always returns a fully-wired App from `createApp`, so this assertion never
 * actually fires in the CLI.
 */
function requireVerifyRunnerService(app: App): VerifyRunnerService {
  if (app.verifyRunnerService === undefined) {
    throw new Error("Internal error: VerifyRunnerService not wired on App");
  }
  return app.verifyRunnerService;
}

/**
 * `App.repoRoot` is typed optional for the same pre-existing-test-stub reason
 * as `verifyRunnerService` above (SPEC-063 §Design Decisions D1) — never
 * actually undefined in the CLI, which only ever receives a fully-wired App
 * from `createApp`.
 */
function requireRepoRoot(app: App): string {
  if (app.repoRoot === undefined) {
    throw new Error("Internal error: App.repoRoot not wired");
  }
  return app.repoRoot;
}

/**
 * citty's raw-arg parser collapses a flag passed more than once into a string
 * array (a single occurrence stays a plain string) — see `parseRawArgs`'s
 * `toVal` in `node_modules/citty/dist/index.mjs`. Normalize both shapes to a
 * `string[] | undefined` so the rest of this command never branches on it.
 */
function normalizeRepeatableFlag(raw: unknown): string[] | undefined {
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? (raw as string[]) : [raw as string];
}

/**
 * Shells `git rev-parse` from `cwd` to resolve {@link VerifyGitFacts} (SPEC-063
 * §Design). Mirrors `assets/hooks/session-start-resume.mjs`'s Phase D
 * linked-worktree detection (same three-command sequence, same "differ iff
 * linked worktree" fact) and `assess.ts`'s precedent of shelling `git` directly
 * from a CLI command via `node:child_process` — this is IO gathering, not
 * business logic; the DECISION over these facts lives entirely in
 * `resolveVerifyExecutionRoot` (`@lore/core`, pure).
 *
 * ANY probe failure (non-git directory, `git` missing, a nonzero exit, an
 * empty/whitespace-only stdout, a timeout, or a thrown `spawnSync` error)
 * degrades to `{resolved: false, ...}` — the core resolver's own fail-safe
 * branch then defaults to `corpus_root`. This function never throws.
 *
 * @param cwd - Directory to probe from (`process.cwd()` in production).
 * @returns Resolved (or fail-safe-degraded) {@link VerifyGitFacts}.
 */
function gatherVerifyGitFacts(cwd: string): VerifyGitFacts {
  const UNRESOLVED: VerifyGitFacts = { resolved: false, isLinkedWorktree: false, worktreeRoot: null };
  try {
    const commonDirRaw = spawnSync("git", ["rev-parse", "--git-common-dir"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    const gitDirRaw = spawnSync("git", ["rev-parse", "--git-dir"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    if (
      commonDirRaw.status !== 0 ||
      gitDirRaw.status !== 0 ||
      !commonDirRaw.stdout?.trim() ||
      !gitDirRaw.stdout?.trim()
    ) {
      return UNRESOLVED;
    }

    const commonDirAbs = resolvePath(cwd, commonDirRaw.stdout.trim());
    const gitDirAbs = resolvePath(cwd, gitDirRaw.stdout.trim());
    if (commonDirAbs === gitDirAbs) {
      // Main checkout (or a non-worktree repo) — a resolved, non-worktree fact.
      return { resolved: true, isLinkedWorktree: false, worktreeRoot: null };
    }

    const topLevelRaw = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
    });
    if (topLevelRaw.status !== 0 || !topLevelRaw.stdout?.trim()) {
      // Linked worktree confirmed, but its root couldn't be resolved — an
      // anomalous fact set; let the core resolver's fail-safe branch handle it
      // rather than guessing a root here.
      return { resolved: false, isLinkedWorktree: true, worktreeRoot: null };
    }

    return {
      resolved: true,
      isLinkedWorktree: true,
      worktreeRoot: resolvePath(cwd, topLevelRaw.stdout.trim()),
    };
  } catch {
    return UNRESOLVED;
  }
}

/**
 * Resolves the execution root for this `lore verify` invocation (SPEC-063
 * §Design Decisions D1/D4). An explicit `--execution-root <path>` always
 * wins: it is resolved via the SAME core `resolveVerifyExecutionRoot` fed a
 * synthetic fact set (`callerCwd`/`worktreeRoot` both the given path, so
 * containment trivially holds) rather than a separate ad-hoc code path — one
 * decision function, two callers. Otherwise, git facts are gathered from
 * `process.cwd()` via {@link gatherVerifyGitFacts} and resolved against the
 * corpus root.
 *
 * @param corpusRoot - `App.repoRoot` (`requireRepoRoot(app)`).
 * @param explicitRootArg - The raw `--execution-root` flag value, or `undefined`.
 * @returns `{resolution, explicitOverride}` — `explicitOverride` feeds
 *   `buildVerifyHeaderLines`'s D4 "always print" rule.
 */
function resolveCliExecutionRoot(
  corpusRoot: string,
  explicitRootArg: string | undefined,
  cwd: string,
): { resolution: VerifyExecutionRootResolution; explicitOverride: boolean } {
  if (explicitRootArg !== undefined) {
    const explicitRoot = resolvePath(cwd, explicitRootArg);
    return {
      resolution: resolveVerifyExecutionRoot({
        corpusRoot,
        callerCwd: explicitRoot,
        gitFacts: { resolved: true, isLinkedWorktree: true, worktreeRoot: explicitRoot },
      }),
      explicitOverride: true,
    };
  }

  const callerCwd = cwd;
  return {
    resolution: resolveVerifyExecutionRoot({
      corpusRoot,
      callerCwd,
      gitFacts: gatherVerifyGitFacts(callerCwd),
    }),
    explicitOverride: false,
  };
}

export default defineLoreCommand({
  meta: {
    name: "verify",
    description: "Execute a plan's script-mode acceptance criteria for real and record attested evidence",
  },
  args: {
    plan: {
      type: "positional",
      description:
        "Plan document ID or slug. Optional ONLY when --task names a SPEC-069 --adhoc task " +
        "(the ad-hoc runner path — no PLAN positional, no plan_id to resolve).",
      required: false,
    },
    ac: {
      type: "string",
      description: "Restrict the run to this declared AC id (repeatable). Omitted = every declared AC.",
    },
    task: {
      type: "string",
      description: "Explicit target task id/slug — overrides claim-based resolution",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
    "allow-new-commands": {
      type: "boolean",
      alias: "yes",
      description:
        "Approve every new/changed verify command for this run without prompting (SPEC-039 §M2 " +
        "command-provenance approval gate) — required for non-interactive/CI invocations",
    },
    "execution-root": {
      type: "string",
      description:
        "Explicit override for the directory AC commands spawn from (SPEC-063 §Design Decisions " +
        "D4) — bypasses the linked-worktree inference entirely and always prints the resolved " +
        "execution root",
    },
    falsify: {
      type: "string",
      description:
        "ATTESTED-RED runner (spec-falsifiability-reachability-a-feedable-checkpoint-an §D2/D3/D4): " +
        "restrict this run to the named AC id and drive it through its DECLARED falsifier instead " +
        "of the ordinary green-path command — creates a SCRATCH git worktree, applies the mutation " +
        "there (never the working tree), runs the command, and records a runner-issued " +
        "result:\"expected-fail\" row ONLY when the observed exit code matches the falsifier's " +
        "declared value exactly. Requires the PLAN positional (not the ad-hoc --task path) and an " +
        "AC that actually declares a falsifier (see `lore ac add --falsifier-*`).",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const acIds = normalizeRepeatableFlag(args.ac);
      const by = resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user);
      const allowNewCommands = args["allow-new-commands"] === true;

      // reason: SPEC-039 §M2 trust-hardening advisory — `lore verify` shells out to
      // caller-declared commands (`spec.extra.acceptance_criteria[].verify.script.command`),
      // so a one-time notice belongs on this CLI surface before those commands run. The
      // DEFAULT posture is now hardened (this replaces the pre-§M2 "full env passthrough,
      // no sandbox, no approval" warning): only an ALLOWLISTED subset of the local
      // environment reaches the spawned command (`verify.env.allowlist`/`passthrough_all`
      // escape hatch), and a command NEW/CHANGED relative to the target task's evidence
      // history requires explicit approval (`--allow-new-commands`, an interactive TTY
      // prompt, or `verify.require_command_approval: false` to disable the gate). Still no
      // sandbox: an ALREADY-APPROVED command runs with the same shell privileges as the
      // invoking user (npm-scripts trust tier, SPEC-039 §1). Deliberately NOT a per-command
      // line (would be noise for a multi-AC plan) and NEVER written to stdout — `--json`'s
      // stdout stays a clean, parseable envelope, same split the pre-existing `warnings`
      // loop below already uses.
      inv.io.stderr.write(
        "Warning: lore verify executes this plan's declared script-mode acceptance-criteria " +
          "commands (npm-scripts trust tier, no sandbox). Env passthrough is allowlisted by " +
          "default and new/changed commands require approval — see SPEC-039 §M2.\n",
      );

      // SPEC-039 §M2 — interactive TTY confirm hook, ONLY when a human can actually see
      // and answer the prompt (no --json: that surface's stdout must stay clean JSON, and
      // a prompt reading stdin while the caller expects a machine-parseable envelope would
      // hang or corrupt output).
      const confirmUnapprovedCommand =
        inv.io.stdinIsTTY && args.json !== true
          ? async (info: { ac_id: string; command: string }): Promise<boolean> =>
              promptYesNo(inv.io, `Run new/changed verify command "${info.command}" for ${info.ac_id}? [y/N] `)
          : undefined;

      // SPEC-063 §Design Decisions D1/D4 — resolved BEFORE calling verifyPlan
      // (the service never probes git/process state itself); the CLI's own
      // fallback warning (if any) reaches stderr via the service's `warnings`
      // array below (opts.executionRoot is threaded straight through, so a
      // fallback-triggered warning is surfaced exactly once, not twice).
      const explicitExecutionRootArg =
        typeof args["execution-root"] === "string" ? args["execution-root"] : undefined;
      const { resolution: executionRoot, explicitOverride } = resolveCliExecutionRoot(
        requireRepoRoot(app),
        explicitExecutionRootArg,
        inv.cwd,
      );

      // SPEC-069 ad-hoc-task runner path (module header) — the PLAN positional is
      // now OPTIONAL; branch on its presence rather than casting `args.plan` as a
      // guaranteed string.
      const planArg = typeof args.plan === "string" ? args.plan : undefined;
      const taskArg = typeof args.task === "string" ? args.task : undefined;

      // ATTESTED-RED runner (spec-falsifiability-reachability-a-feedable-checkpoint-an
      // §D2/D3/D4) — a SEPARATE, wholly distinct code path from the four-step
      // pipeline below: no M2 command-provenance gate (a falsifier run always
      // executes a MUTATED tree, so "already-seen command" never applies). Returns
      // EARLY — `FalsifierRunResult` is a different shape from `VerifyPlanResult`,
      // rendered here rather than threaded through the shared per-AC table below.
      //
      // Resolved 2026-08-11 (AC-JV-3, spec-judgment-surfaces-must-verify-before-they-certify-machine
      // §D5) — this branch used to call `verifyFalsifier` with NO `executionRoot` at
      // all, even though `executionRoot` (above) was ALREADY resolved before this
      // branch runs: the falsifier's scratch worktree unconditionally branched off
      // `VerifyRunnerService.config.repoRoot` (the corpus/main-checkout root) —
      // exactly the SAME "main checkout, never the caller's own worktree" defect
      // SPEC-063 closed for the ordinary pipeline. A `--falsify` run invoked from a
      // linked worktree therefore silently scratched off the MAIN checkout's HEAD,
      // never the worktree's own uncommitted work, no matter how correctly
      // `resolveCliExecutionRoot` had already resolved `executionRoot` two lines up
      // — an accepted-but-never-passed option. `executionRoot` is now threaded
      // through the SAME way the four-step pipeline threads it into `verifyPlan`
      // below: the scratch worktree branches off THIS root (and, when its `mode` is
      // `"worktree"`, off a `git stash create` snapshot of that root's OWN
      // uncommitted state — see `createFalsifierScratchWorktree`'s own JSDoc) rather
      // than unconditionally `config.repoRoot`. See
      // `tests/unit/service/falsifier-execution-root.bun.test.ts` for the oracle
      // (positive worktree-rooted case, the mandatory `config.repoRoot` reverse
      // control, AND a CLI-level black-box proof that this exact call site threads
      // the resolved root through).
      const falsifyAcId = typeof args.falsify === "string" ? args.falsify : undefined;
      if (falsifyAcId !== undefined) {
        if (planArg === undefined) {
          inv.io.stderr.write(
            "Error: --falsify requires the PLAN positional (the attested-red runner is not " +
              "reachable from the ad-hoc --task path).\n",
          );
          return 2;
        }
        const falsifyResult = await requireVerifyRunnerService(app).verifyFalsifier(planArg, falsifyAcId, {
          ...(taskArg !== undefined ? { explicitTaskIdOrSlug: taskArg } : {}),
          by,
          nowIso: new Date().toISOString(),
          executionRoot,
        });
        if (!falsifyResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, falsifyResult.error) + "\n");
          return exitCode(falsifyResult.error);
        }
        const {
          task,
          ac_id,
          expected_exit_code,
          exit_code: observedExitCode,
          output_tail,
          result: falsifyOutcome,
        } = falsifyResult.value;
        if (args.json) {
          printLine(inv.io.stdout, 
            JSON.stringify(
              {
                ok: true,
                data: {
                  task,
                  ac_id,
                  expected_exit_code,
                  exit_code: observedExitCode,
                  output_tail,
                  result: falsifyOutcome,
                },
              },
              null,
              2,
            ),
          );
        } else if (falsifyOutcome === "inconclusive") {
          // AC-FR-11 — the green control (the AC's own UNMUTATED command)
          // already exited nonzero in the scratch worktree, so no mutation
          // was ever applied and no expected-fail was recorded. Printed to
          // stdout (not stderr) since this IS the run's successful outcome —
          // a legitimate determination, not a launch error — but the wording
          // and the non-zero exit code below both make unmistakably clear
          // this is NOT a proven red.
          printLine(inv.io.stdout, 
            `Green control failed for ${ac_id} (task ${task.slug}): the UNMUTATED command ` +
              // reason: -1 is the runner's sentinel for a LAUNCH failure (no process ever
              // exited), so rendering it as an exit status would read as a real verdict.
              `${observedExitCode === -1 ? "FAILED TO LAUNCH" : `exited ${observedExitCode}`}` +
              ` in the scratch worktree — result:inconclusive, no ` +
              "attestation recorded. Nothing was mutated. Fix the scratch environment " +
              "(node_modules / untracked files / dist/lore) or the AC's command, then retry.",
          );
        } else {
          printLine(inv.io.stdout, 
            `Attested red recorded for ${ac_id} (task ${task.slug}): exit ${observedExitCode} ` +
              `(declared ${expected_exit_code}) — result:expected-fail, capture_source:runner.`,
          );
        }
        // AC-FR-11 — mirrors the ordinary four-step pipeline's own exit-code
        // convention below (this file's module-header table: "3 = ... OR at
        // least one executed AC's ... guard downgraded its result to
        // inconclusive") rather than inventing a second meaning for 3 on this
        // branch: an inconclusive green control is never a silent success.
        return falsifyOutcome === "inconclusive" ? 3 : 0;
      }

      let result: Result<VerifyPlanResult, LoreError>;
      let planArgForHeader: string;

      if (planArg !== undefined) {
        // REGRESSION — byte-identical to pre-SPEC-069 behavior (same call, same
        // opts shape, `--task` still only overrides claim-based resolution
        // WITHIN this plan, exactly as before).
        result = await requireVerifyRunnerService(app).verifyPlan(planArg, {
          ...(acIds !== undefined ? { acIds } : {}),
          ...(taskArg !== undefined ? { explicitTaskIdOrSlug: taskArg } : {}),
          by,
          nowIso: new Date().toISOString(),
          ...(allowNewCommands ? { allowNewCommands: true } : {}),
          ...(confirmUnapprovedCommand !== undefined ? { confirmUnapprovedCommand } : {}),
          executionRoot,
        });
        planArgForHeader = planArg;
      } else {
        // No PLAN positional — reachable ONLY for a SPEC-069 --adhoc task, named
        // explicitly via --task (there is no plan-wide claim state to resolve
        // against for a single ad-hoc task, so --task is not optional here).
        if (taskArg === undefined) {
          inv.io.stderr.write(
            "Error: PLAN positional is required unless --task names a SPEC-069 --adhoc task " +
              "(the ad-hoc runner path omits PLAN entirely; see 'lore verify --help').\n",
          );
          return 2;
        }

        // Resolved directly via app.corpusService (no new VerifyRunnerService
        // constructor port needed) — mirrors this adapter's existing direct
        // corpusService reads elsewhere (e.g. task-feed-wiring.ts, gate.ts).
        const taskResult = await app.corpusService.get(taskArg);
        if (!taskResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, taskResult.error) + "\n");
          return exitCode(taskResult.error);
        }

        const specsResult = await app.corpusService.listFull({ type: "spec" });
        if (!specsResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, specsResult.error) + "\n");
          return exitCode(specsResult.error);
        }

        result = await requireVerifyRunnerService(app).verifyAdhocTask(
          taskResult.value.doc,
          specsResult.value.docs,
          {
            ...(acIds !== undefined ? { acIds } : {}),
            by,
            nowIso: new Date().toISOString(),
            ...(allowNewCommands ? { allowNewCommands: true } : {}),
            ...(confirmUnapprovedCommand !== undefined ? { confirmUnapprovedCommand } : {}),
            executionRoot,
          },
        );
        planArgForHeader = `${taskResult.value.doc.slug} (ad-hoc, no plan)`;
      }

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
        return exitCode(result.error);
      }

      const { task, results, skipped, superseded, warnings } = result.value;
      const failedCount = results.filter((r) => r.result === "fail").length;
      // SPEC-061 §Scope D3 — the attestation-completeness guard's own outcome
      // class; takes precedence over a plain failed count (see this file's
      // module-header exit-code table for why).
      const inconclusiveCount = results.filter((r) => r.result === "inconclusive").length;
      const verifyExitCode = inconclusiveCount > 0 ? 3 : failedCount > 0 ? 1 : 0;

      // reason: SPEC-039 §3 "draft spec 的 AC → 执行 + stderr 警告行(不硬闸)" — printed
      // to stderr UNCONDITIONALLY (both --json and human mode, mirroring assess.ts's
      // diff-budget warning) so --json's stdout stays a clean, parseable envelope while
      // the advisory is still surfaced. The warning is ALSO included in the --json
      // payload below (`data.warnings`) for machine consumers that don't read stderr.
      for (const warning of warnings) {
        inv.io.stderr.write(`Warning: ${warning}\n`);
      }

      if (args.json) {
        printLine(inv.io.stdout, 
          JSON.stringify(
            {
              ok: true,
              data: {
                task,
                results,
                skipped,
                superseded,
                warnings,
                // SPEC-063 — the SAME resolved root/mode the CLI computed before
                // calling verifyPlan (not re-derived; `VerifyPlanResult` itself
                // stays free of this per-run-constant field to avoid touching
                // every pre-existing hand-built VerifyPlanResult test fixture).
                execution_root: { root: executionRoot.root, mode: executionRoot.mode },
              },
            },
            null,
            2,
          ),
        );
        return verifyExitCode;
      }

      // SPEC-063 §Design Decisions D2/D4 — the execution-root line (when
      // printed) always precedes the "Verifying ..." header line, which
      // itself always precedes the per-AC result lines below (AC-063-4).
      for (const line of buildVerifyHeaderLines({
        mode: executionRoot.mode,
        root: executionRoot.root,
        explicitOverride,
        planArg: planArgForHeader,
        taskSlug: task.slug,
      })) {
        printLine(inv.io.stdout, line);
      }

      if (results.length === 0 && skipped.length === 0 && superseded.length === 0) {
        printLine(inv.io.stdout, "  (no declared acceptance criteria matched the selection)");
      } else if (results.length === 0) {
        printLine(inv.io.stdout, `  ${VERIFY_NO_SCRIPT_ACS} (all declared ACs are ai/human-mode).`);
      } else {
        for (const r of results) printLine(inv.io.stdout, formatAcResultLine(r));
      }

      if (skipped.length > 0) {
        printLine(inv.io.stdout, 
          `  Skipped (non-script): ${skipped.map((s) => `${s.ac_id} (${s.mode})`).join(", ")}`,
        );
      }

      if (superseded.length > 0) {
        printLine(
          inv.io.stdout,
          `  Superseded (not run): ${superseded.map((s) => `${s.ac_id} (by ${s.superseded_by.spec}:${s.superseded_by.ac})`).join(", ")}`,
        );
      }

      const passedCount = results.length - failedCount - inconclusiveCount;
      const inconclusiveSuffix = inconclusiveCount > 0 ? `, ${inconclusiveCount} inconclusive` : "";
      printLine(inv.io.stdout, `${passedCount} passed, ${failedCount} failed${inconclusiveSuffix}.`);

      return verifyExitCode;
    } finally {
      app.close();
    }
  },
});
