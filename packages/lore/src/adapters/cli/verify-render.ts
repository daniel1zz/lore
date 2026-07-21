/**
 * Pure render helpers for `lore verify`'s terminal output. Split out of
 * `commands/verify.ts` for testability — that file transitively imports
 * `loader.ts` (`bun:sqlite`), unresolvable by vitest — mirroring
 * `assess-render.ts`/`review-render.ts`/`setup-render.ts`/`seat-render.ts`'s
 * identical split. `formatAcResultLine` moved here VERBATIM (byte-identical,
 * REGRESSION) from `commands/verify.ts`, which now imports it rather than
 * defining it inline.
 *
 * Public surface:
 *   - formatAcResultLine(result) — one executed AC's outcome line.
 *   - shouldPrintExecutionRootLine(mode, explicitOverride) — SPEC-063 §Design
 *     Decisions D2/D4 print decision.
 *   - formatExecutionRootLine(root) — the D2 execution-root line's text.
 *   - buildVerifyHeaderLines(input) — assembles the CLI's ordered output-line
 *     PREFIX: the execution-root line (when printed) ALWAYS precedes the
 *     "Verifying ..." header line, which itself always precedes the per-AC
 *     result lines `commands/verify.ts` prints afterward (AC-063-4's
 *     "preceding the first AC result line" — a structural guarantee, not an
 *     incidental one, since both lines come from this ONE function called
 *     before the AC-result loop starts).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-039 §4 (formatAcResultLine's original home); SPEC-063 §Design
 *   Decisions D2, D4.
 */

import type { VerifyPlanResult } from "../../service/verify-runner-service.js";
import type { VerifyExecutionMode } from "@lore/core";

/**
 * Render one executed AC's outcome line, e.g. "  ✔ AC-VRF-3 pass (12ms)" or,
 * for an attestation-completeness downgrade (SPEC-061), "  ⚠ AC-x inconclusive
 * (ran 1 of 3 declared paths) (12ms, exit 0)".
 */
export function formatAcResultLine(result: VerifyPlanResult["results"][number]): string {
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
 * SPEC-063 §Design Decisions D2/D4 — whether `lore verify` must print the
 * execution-root line for this run: whenever the resolved mode is
 * `"worktree"` (D2 — the execution root differs from the corpus root, a
 * silent switch would trade one invisible wrong root for another), OR the
 * caller passed an explicit `--execution-root` override (D4 — "D2's line
 * always prints" regardless of the resulting mode, since the override was a
 * deliberate user action worth confirming even when it happens to coincide
 * with the corpus root).
 *
 * @param mode - The resolved execution mode for this run.
 * @param explicitOverride - `true` iff `--execution-root <path>` was passed.
 * @returns Whether to print the execution-root line.
 * @example
 * shouldPrintExecutionRootLine("worktree", false); // => true
 * @example
 * shouldPrintExecutionRootLine("corpus_root", false); // => false
 * @example
 * shouldPrintExecutionRootLine("corpus_root", true); // => true — D4 override always prints
 */
export function shouldPrintExecutionRootLine(
  mode: VerifyExecutionMode,
  explicitOverride: boolean,
): boolean {
  return explicitOverride || mode === "worktree";
}

/**
 * The SPEC-063 D2 execution-root line's exact text.
 *
 * @param root - The resolved execution root.
 * @returns `"Execution root: <root>"`.
 * @example
 * formatExecutionRootLine("/repo/.worktrees/t1"); // => "Execution root: /repo/.worktrees/t1"
 */
export function formatExecutionRootLine(root: string): string {
  return `Execution root: ${root}`;
}

/** Input to {@link buildVerifyHeaderLines}. */
export interface VerifyHeaderLinesInput {
  readonly mode: VerifyExecutionMode;
  readonly root: string;
  /** `true` iff `--execution-root <path>` was passed for this run (SPEC-063 D4). */
  readonly explicitOverride: boolean;
  /** The plan id/slug argument the caller passed to `lore verify`. */
  readonly planArg: string;
  /** The resolved target task's slug. */
  readonly taskSlug: string;
}

/**
 * Assembles `lore verify`'s ordered output-line PREFIX (SPEC-063 AC-063-4):
 * the execution-root line (when {@link shouldPrintExecutionRootLine} says to
 * print it) ALWAYS comes before the "Verifying ..." header line. Both lines
 * are printed by the caller BEFORE its per-AC result loop starts, so this
 * ordering is a structural guarantee of the two lines' relative position —
 * not an incidental one that could drift if the caller reorders unrelated
 * `console.log` calls elsewhere.
 *
 * @param input - See {@link VerifyHeaderLinesInput}.
 * @returns The ordered line(s) to print before any AC result line.
 * @example
 * buildVerifyHeaderLines({
 *   mode: "worktree", root: "/repo/.worktrees/t1", explicitOverride: false,
 *   planArg: "plan-x", taskSlug: "task-x",
 * });
 * // => ["Execution root: /repo/.worktrees/t1", "Verifying plan-x against task task-x:"]
 * @example
 * buildVerifyHeaderLines({
 *   mode: "corpus_root", root: "/repo", explicitOverride: false,
 *   planArg: "plan-x", taskSlug: "task-x",
 * });
 * // => ["Verifying plan-x against task task-x:"] — no execution-root line
 */
export function buildVerifyHeaderLines(input: VerifyHeaderLinesInput): string[] {
  const lines: string[] = [];
  if (shouldPrintExecutionRootLine(input.mode, input.explicitOverride)) {
    lines.push(formatExecutionRootLine(input.root));
  }
  lines.push(`Verifying ${input.planArg} against task ${input.taskSlug}:`);
  return lines;
}
