/**
 * Pure closed-value-set restriction for `lore set --decision-status`
 * (spec-adr-decision-status-has-a-create-surface-and-no-cli-update, D1/D6).
 * Extracted as a standalone module for the same reason as
 * `create-task-validation.ts` and `handoff-input.ts`: `commands/set.ts`
 * transitively imports `loader.ts` (`bun:sqlite`), which vitest cannot
 * resolve, so the actual value-restriction decision — and its refusal
 * messages — must live somewhere vitest CAN reach.
 *
 * `lore set --decision-status` is a single-value writer: the only legal
 * write through this surface is the literal value `"accepted"`.
 *   - `"deprecated"` / `"superseded"` are refused BY DESIGN, not omission —
 *     `ValidityService.invalidate` (`lore invalidate`) is the sole writer for
 *     those two, because it writes `extra.validity` and `decision_status`
 *     TOGETHER; a second writer that moved only `decision_status` would leave
 *     the doc's validity bookkeeping contradicting its own decision status.
 *   - Every other string (including `"proposed"`, the empty string,
 *     whitespace, and wrong-case variants like `"Accepted"`) is refused as an
 *     unrecognised value. This module does NOT give `"proposed"` its own
 *     distinct wording — this task's scope (AC-DS-8) is exactly three
 *     outcomes: accepted, owned-transition, unrecognised-value. Whether
 *     `"proposed"` deserves proposed-specific wording is a decision for the
 *     (separate, blocked) CLI-wiring task, not this module.
 *
 * Public surface:
 *   - ACCEPTED_DECISION_STATUS_VALUE — the one value this writer accepts.
 *   - checkDecisionStatusValue(value) — classifies a raw `--decision-status`
 *     value into accepted / refused (carrying the refusal reason and the
 *     offending value verbatim), never a message string itself — see the
 *     check/format split below, mirroring `create-task-validation.ts`'s
 *     `checkTaskCreateRequiredFlags` / `formatTaskCreateMissingFlagsError`
 *     separation.
 *   - formatDecisionStatusRefusal(refusal) — renders a
 *     `DecisionStatusRefusal` into the exact stderr message the CLI prints.
 *     The `"owned-transition"` branch names `lore invalidate`; the
 *     `"unrecognised-value"` branch lists ACCEPTED_DECISION_STATUS_VALUE.
 *     Takes the narrowed `DecisionStatusRefusal` type (not the full
 *     `DecisionStatusCheckResult` union), so passing an accepted result is a
 *     compile-time error, not a runtime one — no defensive throw needed.
 *
 * Side-effect class: pure (no store, no IO, no process access) — vitest-safe.
 *
 * Source: spec-adr-decision-status-has-a-create-surface-and-no-cli-update
 * D1, D6; AC-DS-3, AC-DS-7, AC-DS-8.
 */

import type { DecisionStatus } from "@lore/core";

/** The sole value `lore set --decision-status` is permitted to write. */
export const ACCEPTED_DECISION_STATUS_VALUE: DecisionStatus = "accepted";

/**
 * Decision-status values already owned by `lore invalidate`
 * (`ValidityService.invalidate` writes `extra.validity` and
 * `decision_status` together — see this module's header). Refused by
 * {@link checkDecisionStatusValue} BY DESIGN, not omission.
 */
const OWNED_TRANSITION_VALUES = ["deprecated", "superseded"] as const;

/** One of {@link OWNED_TRANSITION_VALUES}. */
type OwnedTransitionValue = (typeof OWNED_TRANSITION_VALUES)[number];

/** True when `value` is exactly `"deprecated"` or `"superseded"`. */
function isOwnedTransitionValue(value: string): value is OwnedTransitionValue {
  return (OWNED_TRANSITION_VALUES as readonly string[]).includes(value);
}

/** Why {@link checkDecisionStatusValue} refused a value. */
export type DecisionStatusRefusalReason = "owned-transition" | "unrecognised-value";

/**
 * A refused classification from {@link checkDecisionStatusValue}. Split out
 * as its own exported type (rather than inlined in the
 * `DecisionStatusCheckResult` union) so {@link formatDecisionStatusRefusal}
 * can declare it as its parameter type directly — passing an accepted result
 * to the formatter is then a compile-time type error, not something that
 * needs a runtime guard.
 */
export interface DecisionStatusRefusal {
  readonly kind: "refused";
  readonly reason: DecisionStatusRefusalReason;
  /** The exact raw value the caller supplied, verbatim (for message rendering). */
  readonly value: string;
}

/**
 * Classification of a raw `--decision-status` value. A discriminated union
 * (not a boolean pair) — a caller can never observe an impossible
 * `{ kind: "accepted", reason: ... }` combination, and TypeScript narrows
 * `result.reason`/`result.value` as accessible only after checking
 * `result.kind === "refused"`.
 */
export type DecisionStatusCheckResult = { readonly kind: "accepted" } | DecisionStatusRefusal;

/**
 * Classifies a raw `--decision-status` value against the closed value set
 * this writer accepts. Exact string match — no trimming, no case-folding:
 * `" accepted"` / `"Accepted"` / `""` are all refused as unrecognised, since
 * silently normalising a caller's typo would mask it rather than surface it
 * (no silent fallback).
 *
 * @param value - the raw `--decision-status` flag value, exactly as the
 *   caller supplied it
 * @returns `{ kind: "accepted" }` for the literal string `"accepted"`;
 *   otherwise `{ kind: "refused", reason, value }` — `reason` is
 *   `"owned-transition"` for exactly `"deprecated"` / `"superseded"`,
 *   `"unrecognised-value"` for every other string (including `"proposed"`,
 *   `""`, whitespace, and wrong-case variants)
 * @example
 *   checkDecisionStatusValue("accepted")
 *   // => { kind: "accepted" }
 *   checkDecisionStatusValue("deprecated")
 *   // => { kind: "refused", reason: "owned-transition", value: "deprecated" }
 *   checkDecisionStatusValue("bogus")
 *   // => { kind: "refused", reason: "unrecognised-value", value: "bogus" }
 */
export function checkDecisionStatusValue(value: string): DecisionStatusCheckResult {
  if (value === ACCEPTED_DECISION_STATUS_VALUE) {
    return { kind: "accepted" };
  }
  if (isOwnedTransitionValue(value)) {
    return { kind: "refused", reason: "owned-transition", value };
  }
  return { kind: "refused", reason: "unrecognised-value", value };
}

/**
 * Renders a {@link DecisionStatusRefusal} into the exact stderr message
 * `lore set --decision-status` prints. Both refusal reasons map to CLI exit
 * 2 (usage-error convention) — that mapping is the CLI-wiring task's job;
 * this module only decides the text.
 *
 * @param refusal - a refused result from {@link checkDecisionStatusValue}
 * @returns the multi-line refusal message — the `"owned-transition"` branch
 *   names `lore invalidate` (with the specific `--reason` / `--superseded-by`
 *   flag for the offending value); the `"unrecognised-value"` branch lists
 *   {@link ACCEPTED_DECISION_STATUS_VALUE}
 * @example
 *   formatDecisionStatusRefusal({ kind: "refused", reason: "owned-transition", value: "deprecated" })
 *   // => "Error: --decision-status deprecated is not writable through this command.\n..."
 */
export function formatDecisionStatusRefusal(refusal: DecisionStatusRefusal): string {
  if (refusal.reason === "owned-transition") {
    return [
      `Error: --decision-status ${refusal.value} is not writable through this command.`,
      `  '${refusal.value}' is a validity transition owned by 'lore invalidate', which writes`,
      "  extra.validity and decision_status together — use 'lore invalidate --reason <why>'",
      "  for 'deprecated', or 'lore invalidate --superseded-by <doc>' for 'superseded'.",
    ].join("\n");
  }
  return [
    `Error: --decision-status '${refusal.value}' is not a recognised value.`,
    `  The only value this command accepts is '${ACCEPTED_DECISION_STATUS_VALUE}'.`,
  ].join("\n");
}
