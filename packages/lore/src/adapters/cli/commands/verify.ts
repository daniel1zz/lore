/**
 * lore verify <plan> [--ac <id> repeatable] [--task <t>] [--json] [--by]
 *   [--allow-new-commands|--yes] [--execution-root <path>]
 *
 * Trusted runner (SPEC-039): actually EXECUTES a plan's declared script-mode
 * acceptance criteria (via `VerifyRunnerService.verifyPlan`) and records the
 * outcome as runner-attested evidence — `result` is derived from the command's
 * exit code, not a caller assertion (contrast `lore evidence`, which is
 * self-reported). Thin pipe only: this file resolves args, calls the service,
 * renders the per-AC outcome table, and maps the result to an exit code.
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
 *   2. Interactive TTY (no `--json`, `process.stdin.isTTY`) — prompt
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
 *       has both an inconclusive AND a genuinely-failed AC.
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
 * `duration_ms`), NOT a synthesized marker. ONE known, NAMED gap remains: the
 * recorded evidence omits `ac_ref` (see `VerifyRunnerService._runVerification`'s
 * `recordAcRef` param JSDoc) — `TaskWorkflowService.appendEvidenceEntry`'s
 * cross-entity `ac_ref` check independently requires `task.parent_id` to
 * resolve to a `plan`, which is structurally impossible for an ad-hoc task;
 * closing that needs a `task-workflow-service.ts`/`corpus-service.ts` change
 * outside this task's file anchors (see the completion report for the
 * follow-up shape) — so an ad-hoc task's attested evidence does not (yet)
 * contribute to AC-coverage aggregation, though it IS genuinely attested.
 * Omitting `<PLAN>` with no `--task`, or naming a non-ad-hoc task, is a usage
 * error (exit 2) naming the requirement explicitly — never the internal
 * `getPlanBundle` leak. The `<PLAN>`-given path is BYTE-IDENTICAL to
 * pre-SPEC-069 behavior (REGRESSION — `verify-runner-service.test.ts`'s
 * pre-existing suite passes unmodified).
 *
 * Source: SPEC-039 §2, §3, §4 AC-VRF-10; §M2; SPEC-061 §Scope D3; SPEC-063
 *   §Design Decisions D1-D4; SPEC-069 §Design Decisions D2
 */

import { spawnSync } from "node:child_process";
import { resolve as resolvePath } from "node:path";
import { createInterface } from "node:readline/promises";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { formatAcResultLine, buildVerifyHeaderLines } from "../verify-render.js";
import { resolveVerifyExecutionRoot } from "@lore/core";
import type { VerifyGitFacts, VerifyExecutionRootResolution, LoreError, Result } from "@lore/core";
import type { VerifyRunnerService, VerifyPlanResult } from "../../../service/verify-runner-service.js";
import type { App } from "../../../app.js";

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
): { resolution: VerifyExecutionRootResolution; explicitOverride: boolean } {
  if (explicitRootArg !== undefined) {
    const explicitRoot = resolvePath(explicitRootArg);
    return {
      resolution: resolveVerifyExecutionRoot({
        corpusRoot,
        callerCwd: explicitRoot,
        gitFacts: { resolved: true, isLinkedWorktree: true, worktreeRoot: explicitRoot },
      }),
      explicitOverride: true,
    };
  }

  const callerCwd = process.cwd();
  return {
    resolution: resolveVerifyExecutionRoot({
      corpusRoot,
      callerCwd,
      gitFacts: gatherVerifyGitFacts(callerCwd),
    }),
    explicitOverride: false,
  };
}

/**
 * Interactive y/N confirmation prompt (SPEC-039 §M2) — used ONLY when
 * `process.stdin.isTTY` and `--json` was not passed (see `run` below). Any
 * answer other than a case-insensitive "y"/"yes" is treated as "no".
 */
async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

export default defineCommand({
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
    by: {
      type: "string",
      description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
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
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      const acIds = normalizeRepeatableFlag(args.ac);
      const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
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
      process.stderr.write(
        "Warning: lore verify executes this plan's declared script-mode acceptance-criteria " +
          "commands (npm-scripts trust tier, no sandbox). Env passthrough is allowlisted by " +
          "default and new/changed commands require approval — see SPEC-039 §M2.\n",
      );

      // SPEC-039 §M2 — interactive TTY confirm hook, ONLY when a human can actually see
      // and answer the prompt (no --json: that surface's stdout must stay clean JSON, and
      // a prompt reading stdin while the caller expects a machine-parseable envelope would
      // hang or corrupt output).
      const confirmUnapprovedCommand =
        process.stdin.isTTY && args.json !== true
          ? async (info: { ac_id: string; command: string }): Promise<boolean> =>
              promptYesNo(`Run new/changed verify command "${info.command}" for ${info.ac_id}? [y/N] `)
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
      );

      // SPEC-069 ad-hoc-task runner path (module header) — the PLAN positional is
      // now OPTIONAL; branch on its presence rather than casting `args.plan` as a
      // guaranteed string.
      const planArg = typeof args.plan === "string" ? args.plan : undefined;
      const taskArg = typeof args.task === "string" ? args.task : undefined;

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
          process.stderr.write(
            "Error: PLAN positional is required unless --task names a SPEC-069 --adhoc task " +
              "(the ad-hoc runner path omits PLAN entirely; see 'lore verify --help').\n",
          );
          process.exitCode = 2;
          return;
        }

        // Resolved directly via app.corpusService (no new VerifyRunnerService
        // constructor port needed) — mirrors this adapter's existing direct
        // corpusService reads elsewhere (e.g. task-feed-wiring.ts, gate.ts).
        const taskResult = await app.corpusService.get(taskArg);
        if (!taskResult.ok) {
          process.stderr.write(formatError(taskResult.error) + "\n");
          process.exitCode = exitCode(taskResult.error);
          return;
        }

        const specsResult = await app.corpusService.listFull({ type: "spec" });
        if (!specsResult.ok) {
          process.stderr.write(formatError(specsResult.error) + "\n");
          process.exitCode = exitCode(specsResult.error);
          return;
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
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      const { task, results, skipped, warnings } = result.value;
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
        process.stderr.write(`Warning: ${warning}\n`);
      }

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              data: {
                task,
                results,
                skipped,
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
        process.exitCode = verifyExitCode;
        return;
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
        console.log(line);
      }

      if (results.length === 0 && skipped.length === 0) {
        console.log("  (no declared acceptance criteria matched the selection)");
      } else if (results.length === 0) {
        console.log("  No script-mode acceptance criteria to run (all declared ACs are ai/human-mode).");
      } else {
        for (const r of results) console.log(formatAcResultLine(r));
      }

      if (skipped.length > 0) {
        console.log(
          `  Skipped (non-script): ${skipped.map((s) => `${s.ac_id} (${s.mode})`).join(", ")}`,
        );
      }

      const passedCount = results.length - failedCount - inconclusiveCount;
      const inconclusiveSuffix = inconclusiveCount > 0 ? `, ${inconclusiveCount} inconclusive` : "";
      console.log(`${passedCount} passed, ${failedCount} failed${inconclusiveSuffix}.`);

      process.exitCode = verifyExitCode;
    } finally {
      app.close();
    }
  },
});
