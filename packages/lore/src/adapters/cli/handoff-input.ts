/**
 * Pure candidate-assembly + parsing for `lore handoff`'s two authoring paths
 * (SPEC-041 §3 D6). Extracted from `commands/handoff.ts` into its own module so it
 * can be unit-tested directly under vitest (`session-roundtrip.test.ts`, AC-SL-7) —
 * `commands/handoff.ts` transitively imports `loader.ts` (`bun:sqlite`), which
 * vitest cannot resolve, but this module imports only `@lore/core` (vitest-safe).
 * Mirrors `status-stamp-verdict.ts`'s split for the identical reason.
 *
 * Public surface:
 *   - parseDecisionFlag(raw) — "<judgment>[@<confidence>]" → HandoffKeyDecision
 *   - assembleHandoffInput(flags) — human-path flag bundle → HandoffExtra candidate
 *   - parseHandoffJsonFile(raw, overrides?) — --json-file payload → validated
 *     HandoffExtra (or a field-precise parse error), with optional --plan/--by overrides
 *
 * Invariants:
 *   - No IO, no wall-clock reads — every function here takes already-read strings
 *     (file IO stays in `commands/handoff.ts`'s `run()`).
 *   - Neither `assembleHandoffInput` nor `parseHandoffJsonFile` silently defaults a
 *     REQUIRED field (`next_steps`) — an empty/absent `next_steps` always surfaces
 *     as a `handoffExtraSchema` violation at the caller's final validation point
 *     (module header: "a handoff naming no next step is a status report, not a
 *     handoff", SPEC-041 §3 D3).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-041 §3 D6.
 */

import { handoffExtraSchema } from "@lore/core";
import type { HandoffExtra, HandoffKeyDecision } from "@lore/core";

/**
 * Parses a `--decision "<judgment>[@<confidence>]"` flag value. A trailing
 * `@<1-3 digits>` is split off as `confidence`; an out-of-range value (e.g.
 * `@150`) is deliberately left for `handoffExtraSchema` to reject at validation
 * time, not re-checked here — single validation point (module header).
 *
 * @example parseDecisionFlag("Chose InMemoryStore proxy@90") // => { judgment: "Chose InMemoryStore proxy", confidence: 90 }
 * @example parseDecisionFlag("No score given") // => { judgment: "No score given" }
 */
export function parseDecisionFlag(raw: string): HandoffKeyDecision {
  const match = /^(.*)@(\d{1,3})$/.exec(raw);
  if (match === null) return { judgment: raw };
  const judgment = match[1]!.trimEnd();
  if (judgment.length === 0) return { judgment: raw };
  return { judgment, confidence: Number(match[2]) };
}

/**
 * Flag bundle the human-convenience authoring path assembles into a `HandoffExtra`
 * candidate. `failingTail`, when present, is ALREADY read from disk — file IO
 * stays in `commands/handoff.ts`'s `run()`; this shape (and
 * {@link assembleHandoffInput}) is pure.
 */
export interface HandoffFlagInput {
  readonly by: string;
  readonly plan?: string;
  readonly files: readonly string[];
  readonly decisions: readonly string[];
  readonly next: readonly string[];
  readonly failingCommand?: string;
  readonly failingTail?: string;
}

/**
 * Pure assembly: CLI flag values → an (unvalidated-shape) `HandoffExtra`
 * candidate. Shared by the flags-authoring path (`commands/handoff.ts::run()`)
 * and `session-roundtrip.test.ts` (AC-SL-7), so the flags path and the
 * `--json-file` path are comparable for equivalent input without spawning a
 * subprocess. Does NOT itself enforce `next_steps.min(1)` etc. — the caller
 * always re-validates the result via `handoffExtraSchema` before writing
 * (module header).
 *
 * @example
 * assembleHandoffInput({ by: "claude", files: [], decisions: [], next: ["ship it"] });
 * // => { by: "claude", task_refs: [], modified_files: [], key_decisions: [], next_steps: ["ship it"] }
 */
export function assembleHandoffInput(flags: HandoffFlagInput): HandoffExtra {
  const key_decisions = flags.decisions.map(parseDecisionFlag);
  const failing_oracle =
    flags.failingCommand !== undefined && flags.failingTail !== undefined
      ? { command: flags.failingCommand, output_tail: flags.failingTail }
      : undefined;
  return {
    by: flags.by,
    ...(flags.plan !== undefined ? { plan_ref: flags.plan } : {}),
    task_refs: [],
    modified_files: [...flags.files],
    key_decisions,
    ...(failing_oracle !== undefined ? { failing_oracle } : {}),
    next_steps: [...flags.next],
  };
}

/** Optional `--plan`/`--by` overrides applied on top of a `--json-file` payload (D6: "work with both"). */
export interface HandoffJsonFileOverrides {
  readonly by?: string;
  readonly plan?: string;
}

/** Result of {@link parseHandoffJsonFile} — a local CLI-presentation-boundary parse outcome (not a `LoreError` Result; this never reaches the service layer on failure). */
export type HandoffJsonParseResult =
  | { readonly ok: true; readonly value: HandoffExtra }
  | { readonly ok: false; readonly error: string };

/**
 * Parses a `--json-file` payload — the raw string ALREADY read from disk (this
 * function never touches fs) — and validates it against `handoffExtraSchema`
 * after applying optional `--plan`/`--by` overrides. Pure — used by both
 * `commands/handoff.ts::run()` and `session-roundtrip.test.ts` (AC-SL-7) so the
 * json-file authoring path is testable without spawning a subprocess.
 *
 * @param raw - Raw file contents (UTF-8 text expected to be JSON).
 * @param overrides - `--plan`/`--by`, when explicitly passed on the CLI — replace
 *   the JSON's own `plan_ref`/`by` only when present here (D6: an override, never
 *   a silent substitution).
 * @returns `{ok: true, value}` on success; `{ok: false, error}` with a
 *   field-precise message on invalid JSON or a `handoffExtraSchema` violation.
 */
export function parseHandoffJsonFile(
  raw: string,
  overrides: HandoffJsonFileOverrides = {},
): HandoffJsonParseResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const base = typeof parsedJson === "object" && parsedJson !== null ? (parsedJson as Record<string, unknown>) : {};
  const candidate = {
    ...base,
    ...(overrides.by !== undefined ? { by: overrides.by } : {}),
    ...(overrides.plan !== undefined ? { plan_ref: overrides.plan } : {}),
  };
  const parsed = handoffExtraSchema.safeParse(candidate);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue !== undefined ? issue.path.join(".") : "(root)";
    return { ok: false, error: `field '${field}': ${issue?.message ?? "invalid handoff payload"}` };
  }
  return { ok: true, value: parsed.data };
}
