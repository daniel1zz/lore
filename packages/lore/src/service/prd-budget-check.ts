/**
 * SPEC-080 C3 budget oracle — pure, store-free predicate family backing
 * `lore status --check-prd-budget`. Mirrors `@lore/core`'s `computeDrift`
 * purity convention: this module never touches a `StoreInterface`, the
 * filesystem, or wall-clock time; every fact it needs (rendered body,
 * outline entries, `extra`, corpus-governed budget, pre-resolved detail-link
 * targets) is passed in by the caller (the CLI adapter, `commands/status.ts`)
 * which does the actual doc reads.
 *
 * Public surface:
 *   - checkPrdBudget(input) — the full C3 oracle: whole-doc budget, per-tier
 *     outline-entry budget, content-flight scan, and detail-link presence
 *     (AC-080-10, opt-in via `input.detail_link_targets`).
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
 *     `DEFAULT_OUTLINE_BUDGET` per-field), never hardcoded into a breach's
 *     comparison — `checkPrdBudget` must reflect a caller-supplied
 *     corpus-governed override, not just the SPEC-080 C3 stated defaults.
 *   - A legacy PRD with no `extra.outline` degrades to whole-doc-budget-only
 *     (never throws, never fabricates a tier breach).
 *   - The detail-link check (AC-080-10) is opt-in: it only evaluates when
 *     `input.detail_link_targets` is supplied. The "zero rel=detail links"
 *     half of the check needs no resolved facts at all and always runs once
 *     `detail_link_targets` is present; the "link resolves to an existing,
 *     non-deleted doc" half consults the supplied map. Omitting the map
 *     entirely (as every unit-test fixture in this module's own suite does)
 *     skips the check altogether — mirrors the legacy-PRD degrade posture.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-080 C3 (budget oracle), AC-080-1, AC-080-6, AC-080-10
 */

// ─── Outline Entry (duck-typed against @lore/core's outlineEntrySchema) ────

/**
 * The subset of a `prd.extra.outline[]` entry this module reads. Field names
 * are IDENTICAL to `@lore/core`'s `OutlineEntry` (SPEC-080 C1) by design — a
 * caller holding an already-Zod-validated `OutlineEntry[]` can pass it here
 * with no field remapping. This module declares its own interface (rather
 * than importing the Zod schema) to stay dependency-free and callable from
 * hand-built fixtures without constructing a full corpus doc.
 */
export interface OutlineEntryLike {
  section: string;
  title: string;
  tier: "core" | "domain";
  direction: string;
  decision_pointers: string[];
  constraints: string[];
  links: Array<{ slug: string; rel: "detail" | "landing-spec" | "adr" }>;
}

// ─── Outline Budget (caller maps from @lore/core's OutlineBudget) ─────────

/**
 * The corpus-governed tiered char budgets this oracle enforces. Field names
 * are deliberately SHORTER than `@lore/core`'s `OutlineBudget`
 * (`core_max_chars`/`domain_max_chars`/`whole_body_max_chars`) — this is
 * this module's OWN pure-fn input shape, not a redeclaration of the corpus
 * Zod schema; the CLI adapter maps one to the other when reading a PRD's
 * `extra.outline_budget` (see `commands/status.ts::toOutlineBudgetLike`).
 */
export interface OutlineBudgetLike {
  /** Max rendered chars for a `tier: "core"` outline entry. */
  core_chars: number;
  /** Max rendered chars for a `tier: "domain"` outline entry. */
  domain_chars: number;
  /** Max rendered chars for the WHOLE projected PRD body (G1). */
  whole_doc_chars: number;
  /** Content-flight scan threshold — free-text `extra` string cap. */
  extra_prose_chars: number;
}

/**
 * SPEC-080 C3 stated defaults, applied per-field when `input.budget` omits
 * them — NOT applied wholesale (a caller supplying one custom field must
 * still get the other three spec defaults, see the anti-hardcoding suite's
 * "custom budget" scenarios).
 */
export const DEFAULT_OUTLINE_BUDGET: OutlineBudgetLike = {
  core_chars: 4000,
  domain_chars: 2000,
  whole_doc_chars: 24000,
  extra_prose_chars: 1000,
};

// ─── Check Input / Result ──────────────────────────────────────────────────

/** Input to {@link checkPrdBudget} — a resolved PRD's facts, caller-assembled. */
export interface PrdBudgetCheckInput {
  /** The PRD's rendered body (`doc.content`) — the whole-doc budget target. */
  raw_body: string;
  /**
   * Declared outline entries. Absent (or explicit `undefined` — this
   * module's `tsconfig` runs `exactOptionalPropertyTypes`, so callers that
   * conditionally build this field always pass through this branch) →
   * legacy PRD, whole-doc budget only.
   */
  outline?: OutlineEntryLike[] | undefined;
  /** The PRD's `extra` object — scanned by the content-flight check. */
  extra?: Record<string, unknown> | undefined;
  /** Corpus-governed budget override. Missing fields fall back per-field to `DEFAULT_OUTLINE_BUDGET`. */
  budget?: Partial<OutlineBudgetLike> | undefined;
  /**
   * Pre-resolved detail-link target facts (AC-080-10) — keyed by linked doc
   * slug, `true` when the slug resolves to an existing, non-deleted doc.
   * Caller-injected (mirrors `computeDrift`'s pre-probed-facts-in shape) so
   * this function stays store-free. Omitted → the detail-link check does
   * not run at all (see module header's detail-link invariant).
   */
  detail_link_targets?: Record<string, boolean> | undefined;
}

/** The four breach categories {@link checkPrdBudget} can report. */
export type PrdBudgetBreachKind = "whole_doc" | "tier" | "extra_prose" | "detail_link";

/** One budget violation — always names the offending entity and the breached number. */
export interface PrdBudgetBreach {
  kind: PrdBudgetBreachKind;
  /** Names the offending entity AND the breached budget number. */
  detail: string;
  /** Outline entry section key — present for "tier" and "detail_link" breaches. */
  section?: string;
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

// ─── Full Budget Oracle (AC-080-1, AC-080-6, AC-080-10) ────────────────────

/**
 * The full SPEC-080 C3 budget oracle: whole-doc cap, per-tier outline-entry
 * cap, content-flight scan, and (opt-in) detail-link presence/resolution.
 *
 * @param input - See {@link PrdBudgetCheckInput}.
 * @returns `consistent: true` iff zero breaches were found.
 * @example
 * checkPrdBudget({ raw_body: "…", outline: [...], extra: doc.extra });
 * // => { consistent: false, breaches: [...], whole_doc_chars: 24501 }
 */
export function checkPrdBudget(input: PrdBudgetCheckInput): PrdBudgetCheckResult {
  const budget: OutlineBudgetLike = { ...DEFAULT_OUTLINE_BUDGET, ...input.budget };
  const breaches: PrdBudgetBreach[] = [];

  const wholeDocChars = input.raw_body.length;
  if (wholeDocChars > budget.whole_doc_chars) {
    breaches.push({
      kind: "whole_doc",
      detail: `rendered body is ${wholeDocChars} chars, exceeding the whole-doc budget of ${budget.whole_doc_chars}`,
    });
  }

  if (input.outline !== undefined) {
    for (const entry of input.outline) {
      const cap = entry.tier === "core" ? budget.core_chars : budget.domain_chars;
      const entryChars = entry.direction.length;
      if (entryChars > cap) {
        breaches.push({
          kind: "tier",
          section: entry.section,
          detail: `outline entry "${entry.section}" (tier=${entry.tier}) is ${entryChars} chars, exceeding the ${entry.tier} budget of ${cap}`,
        });
      }

      if (input.detail_link_targets !== undefined) {
        const detailLinks = entry.links.filter((link) => link.rel === "detail");
        if (detailLinks.length === 0) {
          breaches.push({
            kind: "detail_link",
            section: entry.section,
            detail: `outline entry "${entry.section}" declares zero rel="detail" links — every entry must declare >= 1 (G2)`,
          });
        } else {
          const broken = detailLinks.filter((link) => input.detail_link_targets![link.slug] !== true);
          if (broken.length > 0) {
            breaches.push({
              kind: "detail_link",
              section: entry.section,
              detail: `outline entry "${entry.section}" has rel="detail" link(s) not resolving to an existing, non-deleted doc: ${broken.map((link) => link.slug).join(", ")}`,
            });
          }
        }
      }
    }
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
