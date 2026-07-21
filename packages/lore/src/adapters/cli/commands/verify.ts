/**
 * lore verify <plan> [--ac <id> repeatable] [--task <t>] [--json] [--by]
 *   [--allow-new-commands|--yes]
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
 * Source: SPEC-039 §2, §3, §4 AC-VRF-10; §M2; SPEC-061 §Scope D3
 */

import { createInterface } from "node:readline/promises";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import type { VerifyPlanResult } from "../../../service/verify-runner-service.js";
import type { VerifyRunnerService } from "../../../service/verify-runner-service.js";
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
 * Render one executed AC's outcome line, e.g. "  ✔ AC-VRF-3 pass (12ms)" or,
 * for an attestation-completeness downgrade (SPEC-061), "  ⚠ AC-x inconclusive
 * (ran 1 of 3 declared paths) (12ms, exit 0)".
 */
function formatAcResultLine(result: VerifyPlanResult["results"][number]): string {
  const timedOutSuffix = result.timed_out ? " [TIMED OUT]" : "";
  // SPEC-039 §M2 command-provenance annotation — surfaced so a human reviewing
  // `lore verify` output can see which commands were newly approved this run.
  const firstSeenSuffix = result.first_seen === true ? " [new]" : "";

  if (result.result === "inconclusive") {
    const executed = result.executed_files ?? "?";
    const declared = result.declared_paths ?? "?";
    return (
      `  ⚠ ${result.ac_id} inconclusive (ran ${executed} of ${declared} declared paths) ` +
      `(${result.duration_ms}ms, exit ${result.exit_code})${timedOutSuffix}${firstSeenSuffix}`
    );
  }

  const mark = result.result === "pass" ? "✔" : "✘";
  return `  ${mark} ${result.ac_id} ${result.result} (${result.duration_ms}ms, exit ${result.exit_code})${timedOutSuffix}${firstSeenSuffix}`;
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
      description: "Plan document ID or slug",
      required: true,
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

      const result = await requireVerifyRunnerService(app).verifyPlan(args.plan as string, {
        ...(acIds !== undefined ? { acIds } : {}),
        ...(typeof args.task === "string" ? { explicitTaskIdOrSlug: args.task } : {}),
        by,
        nowIso: new Date().toISOString(),
        ...(allowNewCommands ? { allowNewCommands: true } : {}),
        ...(confirmUnapprovedCommand !== undefined ? { confirmUnapprovedCommand } : {}),
      });

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
        console.log(JSON.stringify({ ok: true, data: { task, results, skipped, warnings } }, null, 2));
        process.exitCode = verifyExitCode;
        return;
      }

      console.log(`Verifying ${args.plan as string} against task ${task.slug}:`);

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
