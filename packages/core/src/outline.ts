/**
 * PRD-as-outline contract — structured `prd.extra.outline[]` entry schema,
 * corpus-governed budget schema, and the plan-close sync exemption schema
 * (SPEC-080 C1/C3/C4). Pure, browser-safe leaf module: no IO, no
 * `Date.now()`/`Math.random()` calls.
 *
 * Public surface:
 *   - OUTLINE_ENTRY_TIERS / OutlineEntryTier — the two budget tiers a
 *     declared outline entry may carry (C3).
 *   - OUTLINE_LINK_RELS / OutlineLinkRel — the three link-relation kinds an
 *     outline entry's `links[]` may declare.
 *   - outlineEntrySchema / OutlineEntry — one typed `prd.extra.outline[]`
 *     entry (C1): a bounded per-domain summary with pointers into the full
 *     detail doc, mirroring the proven `requirements[]` / `acceptance_criteria[]`
 *     / `phases[]` shape (typed array + dedicated verb + CAS + version + audit).
 *   - outlineBudgetSchema / OutlineBudget — `prd.extra.outline_budget` (C3):
 *     the corpus-governed tiered char budgets the `--check-prd-budget` oracle
 *     enforces, plus the content-flight scan's free-text threshold.
 *   - prdSyncExemptSchema / PrdSyncExempt — `plan.extra.prd_sync_exempt` (C4):
 *     the audited, required-reason exemption from the plan-close sync
 *     predicate.
 *
 * Invariants:
 *   - `outlineEntrySchema` is the SINGLE-ENTRY shape written by `lore outline
 *     set <prd> --section <key> …` (a dedicated-writer CAS patch, NOT an array
 *     replace) — this module does not itself enforce the dedicated-writer
 *     rule (that lives in `CorpusService.set`'s reject-direct-`extra.outline`
 *     guard, mirroring the validity/handoff precedent); it only shapes one
 *     entry.
 *   - `outlineBudgetSchema`'s three char-count fields (`core_max_chars`,
 *     `domain_max_chars`, `whole_body_max_chars`) are all REQUIRED — SPEC-080
 *     C3 states example values (4000/2000/24000) but only `extra_prose_chars`
 *     carries a stated DEFAULT (1000); a corpus author must explicitly commit
 *     to the three body-budget values rather than silently inheriting an
 *     implicit default.
 *   - Every char-count field on {@link outlineBudgetSchema} rejects zero and
 *     negative values (`.positive()`) — a non-positive budget is nonsensical
 *     (it would reject every non-empty entry/body).
 *   - `prdSyncExemptSchema.reason` requires a NON-EMPTY string — "required"
 *     means "must justify", not merely "key present with an empty value"
 *     (mirrors `attestation_exempt`'s required-reason precedent this schema
 *     is a documented hardening of, SPEC-080 C4).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-080 C1 (OutlineEntry), C2 (SPEC_KINDS domain-overview
 *   extension — see spec-kind.ts, NOT this module), C3 (outline_budget), C4
 *   (prd_sync_exempt)
 */

import { z } from "zod";

// ─── Outline Entry Tiers ────────────────────────────────────────────────────

/**
 * The two budget tiers a declared {@link OutlineEntry} may carry (SPEC-080
 * C3) — `"core"` entries (§1–§13 narrative-core sections) get the larger
 * `outline_budget.core_max_chars` ceiling; `"domain"` entries (§14+ per-domain
 * sections) get the tighter `outline_budget.domain_max_chars` ceiling.
 */
export const OUTLINE_ENTRY_TIERS = ["core", "domain"] as const;

/** Derived TypeScript union for an outline entry's `tier`. */
export type OutlineEntryTier = (typeof OUTLINE_ENTRY_TIERS)[number];

// ─── Outline Link Relations ─────────────────────────────────────────────────

/**
 * The three relation kinds an {@link OutlineEntry}'s `links[]` entries may
 * declare — `"detail"` (the full-prose doc this summary was extracted from,
 * required ≥1 per entry per G2, cross-entity-checked by `--check-prd-budget`,
 * not this schema), `"landing-spec"` (a feature/tech/design spec implementing
 * this domain), `"adr"` (an owner decision extracted from the domain's
 * prose).
 */
export const OUTLINE_LINK_RELS = ["detail", "landing-spec", "adr"] as const;

/** Derived TypeScript union for an outline entry link's `rel`. */
export type OutlineLinkRel = (typeof OUTLINE_LINK_RELS)[number];

// ─── Outline Entry Schema ───────────────────────────────────────────────────

/**
 * One typed `prd.extra.outline[]` entry (SPEC-080 C1) — a bounded per-domain
 * summary (`direction`) plus pointers (`decision_pointers` adr slugs,
 * `constraints` hard invariants, `links[]` detail/landing-spec/adr docs), NOT
 * the full narrative prose (that lives in the linked `domain-overview` spec
 * or `adr` docs).
 *
 * @example
 * outlineEntrySchema.parse({
 *   section: "distribution",
 *   title: "Distribution & Setup",
 *   tier: "core",
 *   direction: "Bounded summary of the distribution model — single binary, installer, assets tree.",
 *   decision_pointers: ["adr-turso-selection"],
 *   constraints: ["Single binary, no external runtime deps"],
 *   links: [{ slug: "spec-046-distribution-part-1", rel: "detail" }],
 * });
 */
export const outlineEntrySchema = z.object({
  /** Stable key identifying this entry within `prd.extra.outline[]`, e.g. "distribution". */
  section: z.string().min(1),
  /** Rendered heading for this entry's projected PRD section. */
  title: z.string().min(1),
  /** Budget tier (SPEC-080 C3) — governs which `outline_budget` ceiling applies. */
  tier: z.enum(OUTLINE_ENTRY_TIERS),
  /** Bounded summary prose — the projected PRD body's per-section text. */
  direction: z.string().min(1),
  /** ADR slugs whose decisions this domain's narrative embeds/depends on. */
  decision_pointers: z.array(z.string().min(1)),
  /** Hard invariants only — not general narrative (that belongs in the linked detail doc). */
  constraints: z.array(z.string().min(1)),
  /** Pointers into the full detail/landing-spec/adr docs this summary was extracted from or informs. */
  links: z.array(
    z.object({
      /** The linked doc's slug. */
      slug: z.string().min(1),
      /** Which relation this link declares — see {@link OUTLINE_LINK_RELS}. */
      rel: z.enum(OUTLINE_LINK_RELS),
    }),
  ),
});

/** Derived TypeScript type for one outline entry. */
export type OutlineEntry = z.infer<typeof outlineEntrySchema>;

// ─── Outline Budget Schema ──────────────────────────────────────────────────

/**
 * `prd.extra.outline_budget` (SPEC-080 C3) — corpus-governed tiered char
 * budgets the `--check-prd-budget` oracle enforces, plus the content-flight
 * scan's free-text threshold. Stored on the PRD itself (version-bumped,
 * review-gated) rather than `.lore/config.yaml` — plain-YAML numeric
 * thresholds demonstrably rot unaudited (`workflow.attestation.min_ratio`
 * precedent, SPEC-080 T4).
 *
 * @example
 * outlineBudgetSchema.parse({
 *   core_max_chars: 4000,
 *   domain_max_chars: 2000,
 *   whole_body_max_chars: 24000,
 * });
 * // => { core_max_chars: 4000, domain_max_chars: 2000, whole_body_max_chars: 24000, extra_prose_chars: 1000 }
 */
export const outlineBudgetSchema = z.object({
  /** Max rendered chars for a `tier: "core"` outline entry. */
  core_max_chars: z.number().int().positive(),
  /** Max rendered chars for a `tier: "domain"` outline entry. */
  domain_max_chars: z.number().int().positive(),
  /** Max rendered chars for the WHOLE projected PRD body (G1). */
  whole_body_max_chars: z.number().int().positive(),
  /**
   * Content-flight scan threshold (SPEC-080 C3): any free-text string value in
   * `extra` outside typed schemas (requirements/acceptance_criteria/phases/
   * outline) exceeding this many chars is flagged. Defaults to 1000 when
   * absent — the SPEC-080 C3 stated default.
   */
  extra_prose_chars: z.number().int().positive().default(1000),
});

/** Derived TypeScript type for the corpus-governed outline budget. */
export type OutlineBudget = z.infer<typeof outlineBudgetSchema>;

// ─── Plan-Close Sync Exemption Schema ───────────────────────────────────────

/**
 * `plan.extra.prd_sync_exempt` (SPEC-080 C4) — an audited, required-reason
 * exemption from the plan-close `prdOutlineSynced` predicate. Mirrors
 * `attestation_exempt` (SPEC-069) with two hardenings the precedent lacks:
 * (a) a dedicated writer verb (`lore outline exempt <plan> --reason …`) —
 * `CorpusService.set` rejects direct patches to this field, same shape as
 * this module does NOT itself enforce for `outlineEntrySchema` above; (b)
 * surfacing — `lore status` lists currently-exempt plans, closing the
 * SPEC-069 field's proven invisibility gap.
 *
 * @example
 * prdSyncExemptSchema.parse({
 *   reason: "Feature landed off-cycle; domain doc update tracked in follow-up plan-042.",
 *   by: "agent:main-orchestrator",
 *   at: "2026-07-26T00:00:00.000Z",
 * });
 */
export const prdSyncExemptSchema = z.object({
  /** Required justification — non-empty (a present-but-empty string is still a rejection). */
  reason: z.string().min(1),
  /** Actor identity that recorded the exemption. */
  by: z.string().min(1),
  /** ISO timestamp the exemption was recorded at. */
  at: z.string(),
});

/** Derived TypeScript type for a plan's sync exemption. */
export type PrdSyncExempt = z.infer<typeof prdSyncExemptSchema>;
