/**
 * PRD budget oracle — pure, store-free predicate family backing the PRD half of
 * `lore status --check-prd-budget`. Mirrors `@lore/core`'s `computeDrift`
 * purity convention: this module never touches a `StoreInterface`, the
 * filesystem, or wall-clock time; every fact it needs (rendered body, `extra`,
 * corpus-governed budget) is passed in by the caller (the CLI adapter,
 * `commands/status.ts`) which does the actual doc reads.
 *
 * Public surface:
 *   - checkPrdBudget(input) — the PRD oracle: whole-doc cap and content-flight scan.
 *   - scanContentFlight(extra, thresholdChars) — the free-text `extra`-prose
 *     sub-check (AC-080-6), also exported standalone since `checkPrdBudget`
 *     wires it in rather than re-implementing it.
 *
 * Invariants:
 *   - Every char-count comparison is STRICTLY GREATER THAN the budget — a
 *     value exactly at the budget is compliant (SPEC-080 C3 "≤" phrasing).
 *   - `TYPED_SCHEMA_KEYS` (requirements/acceptance_criteria/phases/outline)
 *     are NEVER scanned by `scanContentFlight` — those are the corpus's own
 *     proven typed-array shapes (SPEC-055/038/023/080), never free prose.
 *   - Budget values are ALWAYS read from `input.budget` (falling back to
 *     `DEFAULT_PRD_BUDGET` per-field), never hardcoded into a breach's
 *     comparison — `checkPrdBudget` must reflect a caller-supplied
 *     corpus-governed override, not just the stated defaults.
 *   - RETIRED (Baseline slice 3b, D7): the outline-based per-tier entry cap and the detail-link
 *     presence/resolution check. The outline was retired in slice 3a and is read-only history
 *     (BR-694); a stored `extra.outline` is neither measured nor reported. Per-node size caps
 *     now live in `baseline-node-budget.ts`.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-080 C3 (budget oracle, whole-doc + content-flight kept), AC-080-1, AC-080-6;
 *   spec-baseline-slice-3b-specs-belong-to-the-trees-through (AC-BLS3B-8).
 */

// ─── PRD Budget (caller maps from @lore/core's OutlineBudget) ─────────────

/**
 * The corpus-governed PRD char budgets this oracle enforces. Field names are
 * deliberately SHORTER than `@lore/core`'s `OutlineBudget`
 * (`whole_body_max_chars`) — this is this module's OWN pure-fn input shape,
 * not a redeclaration of the corpus Zod schema; the CLI adapter maps one to
 * the other when reading a PRD's `extra.outline_budget` (see
 * `commands/status.ts::toPrdBudgetLike`).
 */
export interface PrdBudgetLike {
  /** Max rendered chars for the WHOLE projected PRD body (G1). */
  whole_doc_chars: number;
  /** Content-flight scan threshold — free-text `extra` string cap. */
  extra_prose_chars: number;
}

/**
 * SPEC-080 C3 stated defaults, applied per-field when `input.budget` omits
 * them — NOT applied wholesale (a caller supplying one custom field must
 * still get the other spec default, see the anti-hardcoding suite's
 * "custom budget" scenarios).
 */
export const DEFAULT_PRD_BUDGET: PrdBudgetLike = {
  whole_doc_chars: 24000,
  extra_prose_chars: 1000,
};

// ─── Check Input / Result ──────────────────────────────────────────────────

/** Input to {@link checkPrdBudget} — a resolved PRD's facts, caller-assembled. */
export interface PrdBudgetCheckInput {
  /** The PRD's rendered body (`doc.content`) — the whole-doc budget target. */
  raw_body: string;
  /** The PRD's `extra` object — scanned by the content-flight check. */
  extra?: Record<string, unknown> | undefined;
  /** Corpus-governed budget override. Missing fields fall back per-field to `DEFAULT_PRD_BUDGET`. */
  budget?: Partial<PrdBudgetLike> | undefined;
}

/** The two breach categories {@link checkPrdBudget} can report. */
export type PrdBudgetBreachKind = "whole_doc" | "extra_prose";

/** One budget violation — always names the offending entity and the breached number. */
export interface PrdBudgetBreach {
  kind: PrdBudgetBreachKind;
  /** Names the offending entity AND the breached budget number. */
  detail: string;
}

/** Output of {@link checkPrdBudget}. */
export interface PrdBudgetCheckResult {
  consistent: boolean;
  breaches: PrdBudgetBreach[];
  whole_doc_chars: number;
}

// ─── Content-Flight Scan (AC-080-6) ────────────────────────────────────────

/**
 * `prd.extra` keys holding the corpus's own proven typed-array shapes
 * (SPEC-055 requirements, SPEC-038 acceptance_criteria, SPEC-023 phases,
 * SPEC-080 outline) — never scanned as free prose, no matter how long their
 * nested string fields are.
 */
const TYPED_SCHEMA_KEYS: ReadonlySet<string> = new Set([
  "requirements",
  "acceptance_criteria",
  "phases",
  "outline",
]);

/**
 * Flags free-text string values in `extra` (outside {@link TYPED_SCHEMA_KEYS})
 * exceeding `extraProseCharsThreshold` chars — the "skinny body, fat extra"
 * evasion vector SPEC-080 C3 closes.
 *
 * @param extra - The PRD's `extra` object.
 * @param extraProseCharsThreshold - Max chars a free-text `extra` string may hold.
 * @returns One {@link PrdBudgetBreach} (`kind: "extra_prose"`) per offending key.
 */
export function scanContentFlight(
  extra: Record<string, unknown>,
  extraProseCharsThreshold: number,
): PrdBudgetBreach[] {
  const breaches: PrdBudgetBreach[] = [];
  for (const [key, value] of Object.entries(extra)) {
    if (TYPED_SCHEMA_KEYS.has(key)) continue;
    if (typeof value !== "string") continue;
    if (value.length > extraProseCharsThreshold) {
      breaches.push({
        kind: "extra_prose",
        detail: `extra.${key} is ${value.length} chars, exceeding the extra_prose_chars budget of ${extraProseCharsThreshold}`,
      });
    }
  }
  return breaches;
}

// ─── Full PRD Budget Oracle (AC-080-1, AC-080-6) ───────────────────────────

/**
 * The PRD budget oracle: whole-doc cap plus content-flight scan.
 *
 * @param input - See {@link PrdBudgetCheckInput}.
 * @returns `consistent: true` iff zero breaches were found.
 * @example
 * checkPrdBudget({ raw_body: "…", extra: doc.extra });
 * // => { consistent: false, breaches: [...], whole_doc_chars: 24501 }
 */
export function checkPrdBudget(input: PrdBudgetCheckInput): PrdBudgetCheckResult {
  const budget: PrdBudgetLike = { ...DEFAULT_PRD_BUDGET, ...input.budget };
  const breaches: PrdBudgetBreach[] = [];

  const wholeDocChars = input.raw_body.length;
  if (wholeDocChars > budget.whole_doc_chars) {
    breaches.push({
      kind: "whole_doc",
      detail: `rendered body is ${wholeDocChars} chars, exceeding the whole-doc budget of ${budget.whole_doc_chars}`,
    });
  }

  if (input.extra !== undefined) {
    breaches.push(...scanContentFlight(input.extra, budget.extra_prose_chars));
  }

  return {
    consistent: breaches.length === 0,
    breaches,
    whole_doc_chars: wholeDocChars,
  };
}
