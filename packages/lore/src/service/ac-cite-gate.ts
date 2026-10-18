/**
 * Module: ac-cite-gate — the pure decision core of the citation gate (baseline slice 2a §C4, AC-BLS2-2).
 *
 * Purpose: decide, from already-loaded data, whether an AC add / revise (or a create's inline criteria)
 *   is admitted, admitted-and-reported, or refused — and, on refusal, build the feeding pack.
 *   The store reads and the in-transaction liveness check live in `ac-write-chokepoint.ts::admitAcWrite`
 *   and the stores; this module has none.
 * Public surface: {@link resolveCiteGateConfig}, {@link CiteGateConfigError}, {@link indexBaseline},
 *   {@link placeSpecInBranch}, {@link isBranchArmed}, {@link changedCriteria}, {@link decideCiteGate},
 *   {@link buildCiteFeedingPack}, {@link maxActiveExemptions}, {@link exemptionHeadroom},
 *   {@link countLiveCriteria}, {@link activeExemptedAcIds}, {@link satisfiedExemptionKeys}, and the config / decision types.
 * Invariants:
 *   - Mode is three-state (`off` | `report` | `enforce`). ⛔ UNLIKE every other gate key, an ABSENT mode
 *     is NOT "enabled": it resolves to `off` when the corpus has no baseline docs (a consumer project
 *     upgraded in place is never refused) and `report` otherwise. An invalid mode THROWS — no silent fallback.
 *   - Only ADDED or REVISED criteria are gated (`changedCriteria`: id new, or its canonical JSON differs).
 *     An untouched legacy uncited criterion is never a candidate, however many siblings change.
 *   - A criterion is refused when it cites nothing OR cites any id that is not live (missing / deprecated /
 *     retired) — EXCEPT that an UNEXPIRED exemption on (spec, ac) waives the "cites nothing" case only
 *     (rule BR-959, #105); a non-live cite is refused regardless of any exemption. The measure is `findAcCiteViolations` (gate-predicates.ts), run through the registered
 *     `ac-cite` checkpoint, so verdict and message cannot disagree.
 *   - `enforce` refuses only on an ARMED branch. A spec's branch is the branch of the leaf most of its
 *     criteria cite; a spec citing nothing is "unplaced" and armed only when EVERY branch is armed
 *     (and at least one branch exists).
 *   - `report` records one would-refuse decision per refused criterion on EVERY branch, armed or not
 *     (orchestrator decision 2026-10-08: would-refuse must be measurable before a branch is armed);
 *     `enforce` + unarmed records nothing.
 *   - Feeding-pack candidate ranking comes from `rule-index-queries.ts::findRules` — one ranking, never a
 *     second implementation here. Candidates are LIVE rules only, at most {@link FEEDING_PACK_MAX_CANDIDATES}.
 * Side-effect class: pure (no store, IO or clock; `nowIso` is passed in).
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation §C4, D3-D6, QA-1, QA-5.
 */

import {
  CITE_GATE_MODES,
  CiteGateConfigSchema,
  ruleIdPrefix,
  specAcceptanceCriteriaSchema,
  type AcCiteFeedingPack,
  type AcCiteViolation,
  type AcceptanceCriterion,
  type CiteGateMode,
  type DocRecord,
} from "@lore/core";
import type { AcCiteRow, AcExemptionRow } from "../store/store-interface.js";
import { exemptionKey, isExemptionActive } from "../store/store-shared.js";
import { AC_CITE_CHECKPOINT, isCheckpointBlocked, type GateContext } from "./checkpoint-registry.js";
import { findAcCiteViolations, type AcCiteCandidate, type AcCiteRuleStates } from "./gate-predicates.js";
import {
  collectLeafRules,
  compareRuleIds,
  findRules,
  stripAnchorSymbol,
  type RuleIndexData,
} from "./rule-index-queries.js";

// ─── Config ──────────────────────────────────────────────────────────────────

/** The resolved `workflow.gates."ac-cite"` configuration. */
export interface CiteGateConfig {
  mode: CiteGateMode;
  /** Slugs of baseline docs with `extra.node === "branch"`. A slug naming no branch arms nothing. */
  armed_branches: string[];
}

/** Thrown by {@link resolveCiteGateConfig} for a malformed `workflow.gates."ac-cite"` entry. */
export class CiteGateConfigError extends Error {
  readonly code = "CITE_GATE_CONFIG_INVALID" as const;
  constructor(
    /** Dotted path of the offending key, e.g. `workflow.gates.ac-cite.mode`. */
    readonly field: string,
    /** The rejected value. */
    readonly value: unknown,
    message: string,
  ) {
    super(message);
    this.name = "CiteGateConfigError";
  }
}

/**
 * Resolve the raw `workflow.gates."ac-cite"` entry into a {@link CiteGateConfig}.
 *
 * @param raw - the untrusted config entry (`undefined` = not configured)
 * @param hasBaselineDocs - whether the corpus holds at least one baseline doc
 * @returns the config; an absent mode is `off` without baseline docs, `report` with them
 * @throws {CiteGateConfigError} on an unknown mode, a non-array / non-string `armed_branches`, an unknown
 *   key, or a non-object entry
 * @example
 * resolveCiteGateConfig(undefined, false); // { mode: "off", armed_branches: [] }
 * resolveCiteGateConfig(undefined, true);  // { mode: "report", armed_branches: [] }
 * resolveCiteGateConfig({ mode: "block" }, true); // throws CiteGateConfigError
 */
export function resolveCiteGateConfig(raw: unknown, hasBaselineDocs: boolean): CiteGateConfig {
  const parsed = CiteGateConfigSchema.safeParse(raw === undefined ? {} : raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const key = issue !== undefined && issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
    const offending =
      issue !== undefined && issue.path.length > 0 && typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)[String(issue.path[0])]
        : raw;
    throw new CiteGateConfigError(
      `workflow.gates.ac-cite${key}`,
      offending,
      `workflow.gates."ac-cite"${key}: ${issue?.message ?? "invalid"} (mode is one of ${CITE_GATE_MODES.join(" | ")})`,
    );
  }
  return {
    mode: parsed.data.mode ?? (hasBaselineDocs ? "report" : "off"),
    armed_branches: [...(parsed.data.armed_branches ?? [])],
  };
}

// ─── Baseline index, placement, arming ───────────────────────────────────────

/** What the gate needs to know about the baseline: rule lifecycles and which branch holds each rule. */
export interface BaselineCiteIndex {
  /** Lifecycle per rule id (first leaf listing an id wins, as everywhere in the rule queries). */
  readonly states: AcCiteRuleStates;
  /** Rule id -> slug of the branch whose leaf lists it (absent when the leaf hangs under no branch). */
  readonly branchOfRule: ReadonlyMap<string, string>;
  /** Slugs of every live branch doc, sorted. */
  readonly branches: readonly string[];
}

/** An id the citing spec's own change set proposes (an `add`), and the slug of the leaf it will land on. */
export interface OwnProposedRule {
  readonly id: string;
  readonly leaf: string;
}

/**
 * Index the baseline docs for the gate. One pass over the leaves' rule lists; no spec is touched.
 *
 * @param baselineDocs - every baseline doc (root, branches, leaves)
 * @param ownProposed - the ids the CITING spec's change set proposes: citable by that spec only, never listed by
 *   a leaf. Another spec's proposal is simply not passed, so it reads "missing" and is refused.
 */
export function indexBaseline(
  baselineDocs: readonly DocRecord[],
  ownProposed: readonly OwnProposedRule[] = [],
): BaselineCiteIndex {
  const slugById = new Map<string, string>();
  const branches: string[] = [];
  for (const doc of baselineDocs) {
    if ((doc.deleted_at ?? null) !== null || doc.extra["node"] !== "branch") continue;
    slugById.set(doc.id as string, doc.slug);
    branches.push(doc.slug);
  }
  const states: Record<string, "live" | "deprecated" | "retired"> = {};
  const branchOfRule = new Map<string, string>();
  for (const rule of collectLeafRules(baselineDocs).values()) {
    // reason: BR-980 — a debt entry (AD-n) is never citable, so it has no gate state: a cite of one is
    // refused earlier (applyAcChange) and would read "missing" here, never "live".
    if (ruleIdPrefix(rule.id) === "AD") continue;
    states[rule.id] = rule.lifecycle;
    const parent = rule.leaf.parent_id;
    const branchSlug = parent === null || parent === undefined ? undefined : slugById.get(parent as string);
    if (branchSlug !== undefined) branchOfRule.set(rule.id, branchSlug);
  }
  // reason: a criterion may cite an id its OWN spec's change set proposes (BR-86, BR-257 as modified by
  // spec-a-spec-carries-its-rule-changes-the-baseline-takes-them). The id is not in any leaf, so it enters the
  // index here as `live` for THIS spec's write only; a tree rule of the same id (landed) keeps its own state.
  for (const proposed of ownProposed) {
    if (Object.prototype.hasOwnProperty.call(states, proposed.id)) continue;
    states[proposed.id] = "live";
    const leaf = baselineDocs.find((doc) => (doc.deleted_at ?? null) === null && doc.slug === proposed.leaf);
    const parent = leaf?.parent_id;
    const branchSlug = parent === null || parent === undefined ? undefined : slugById.get(parent as string);
    if (branchSlug !== undefined) branchOfRule.set(proposed.id, branchSlug);
  }
  return { states, branchOfRule, branches: branches.sort() };
}

/**
 * A spec's branch: the branch whose rules the most of its criteria cite (each criterion counts once per
 * branch it cites into). Ties break on the lexicographically smaller branch slug so the result is stable.
 *
 * @returns the branch slug, or `undefined` when no criterion cites a rule that sits under a branch
 *   ("unplaced")
 */
export function placeSpecInBranch(
  criteria: ReadonlyArray<{ cites?: readonly string[] | undefined }>,
  index: BaselineCiteIndex,
): string | undefined {
  const tally = new Map<string, number>();
  for (const criterion of criteria) {
    const hit = new Set<string>();
    for (const ruleId of criterion.cites ?? []) {
      const branch = index.branchOfRule.get(ruleId);
      if (branch !== undefined) hit.add(branch);
    }
    for (const branch of hit) tally.set(branch, (tally.get(branch) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [branch, count] of tally) {
    if (count > bestCount || (count === bestCount && best !== undefined && branch < best)) {
      best = branch;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Whether the gate is armed for a spec placed in `branch`. An unplaced spec (`branch === undefined`) is
 * armed only when the corpus has at least one branch and EVERY branch is armed.
 */
export function isBranchArmed(
  config: CiteGateConfig,
  branch: string | undefined,
  index: BaselineCiteIndex,
): boolean {
  const armed = new Set(config.armed_branches);
  if (branch !== undefined) return armed.has(branch);
  return index.branches.length > 0 && index.branches.every((b) => armed.has(b));
}

// ─── Change detection ────────────────────────────────────────────────────────

/**
 * The criteria a write adds or revises: ids absent from `before`, plus ids whose canonical JSON differs.
 * Everything else — in particular an untouched legacy criterion — is not a candidate.
 */
export function changedCriteria(
  before: readonly AcceptanceCriterion[],
  after: readonly AcceptanceCriterion[],
): AcCiteCandidate[] {
  const stored = new Map(before.map((c) => [c.id, JSON.stringify(c)] as const));
  const out: AcCiteCandidate[] = [];
  for (const criterion of after) {
    if (stored.get(criterion.id) === JSON.stringify(criterion)) continue;
    out.push({ ac_id: criterion.id, cites: criterion.cites ?? [] });
  }
  return out;
}

/**
 * BR-1007: does any criterion cite at least one LIVE business or architecture standard rule?
 * Liveness is the SAME measure the citation gate uses (`BaselineCiteIndex.states` from
 * {@link indexBaseline}, which holds BR/AS rules only), so "live rule" has one definition.
 *
 * @param criteria - the spec's structured acceptance criteria
 * @param states - lifecycle per rule id from {@link indexBaseline}
 * @returns true iff at least one criterion cites a rule whose state is `live`
 * @example
 * specCitesLiveRule([{ id: "AC-1", cites: ["BR-1"] }], { "BR-1": "live" }); // => true
 */
export function specCitesLiveRule(
  criteria: readonly Pick<AcceptanceCriterion, "cites">[],
  states: AcCiteRuleStates,
): boolean {
  return criteria.some((criterion) =>
    (criterion.cites ?? []).some(
      (ruleId) => Object.prototype.hasOwnProperty.call(states, ruleId) && states[ruleId] === "live",
    ),
  );
}

// ─── The decision ────────────────────────────────────────────────────────────

/** One criterion the gate would refuse (report mode records it; enforce mode refuses with it). */
export interface CiteGateFinding {
  ac_id: string;
  violations: AcCiteViolation[];
}

/** Outcome of {@link decideCiteGate}. */
export type CiteGateDecision =
  /** Gate off, nothing added/revised, or enforce on an unarmed branch: write proceeds, nothing recorded. */
  | { kind: "skip" }
  /**
   * Write proceeds. `requireLiveRules` (enforce + armed only) are re-checked INSIDE the write
   * transaction by the store; `findings` (report mode) are recorded as would-refuse audit rows.
   */
  | { kind: "admit"; requireLiveRules: string[]; findings: CiteGateFinding[] }
  /** Enforce + armed + at least one violation: the write is refused. */
  | { kind: "refuse"; findings: CiteGateFinding[]; context: GateContext; message: string; branch: string | undefined };

function groupFindings(
  violations: ReadonlyArray<{ ac_id: string; rule_id?: string; reason: AcCiteViolation["reason"] }>,
): CiteGateFinding[] {
  const byAc = new Map<string, AcCiteViolation[]>();
  for (const v of violations) {
    const list = byAc.get(v.ac_id) ?? [];
    list.push({ ac_id: v.ac_id, ...(v.rule_id !== undefined ? { rule_id: v.rule_id } : {}), reason: v.reason });
    byAc.set(v.ac_id, list);
  }
  return [...byAc.entries()].map(([ac_id, list]) => ({ ac_id, violations: list }));
}

/**
 * Decide one AC write. Pure: every input is already loaded.
 *
 * @param config - the resolved gate configuration
 * @param existing - the spec's criteria BEFORE the write (`[]` on create)
 * @param next - the spec's criteria AFTER the write
 * @param index - the baseline index (rule lifecycles + branches)
 * @param exemptedAcIds - ids of this spec's criteria holding an ACTIVE exemption (unexpired and uncited),
 *   computed by the caller (see {@link activeExemptedAcIds}); an exempt criterion that cites NOTHING is not
 *   a violation (no refusal, no report-mode would-refuse finding). Exempt criteria that cite anything are
 *   still checked, so a missing / deprecated / retired cite stays refused.
 * @returns skip / admit / refuse — see {@link CiteGateDecision}
 */
export function decideCiteGate(
  config: CiteGateConfig,
  existing: readonly AcceptanceCriterion[],
  next: readonly AcceptanceCriterion[],
  index: BaselineCiteIndex,
  exemptedAcIds: ReadonlySet<string>,
): CiteGateDecision {
  if (config.mode === "off") return { kind: "skip" };
  const changed = changedCriteria(existing, next);
  if (changed.length === 0) return { kind: "skip" };
  // reason: BR-959 / #105 — the exemption waives ONLY the uncited case, so only an exempt candidate with
  // no cites leaves the checked set; an exempt one citing a non-live id stays in and is refused.
  const candidates = changed.filter((c) => !(c.cites.length === 0 && exemptedAcIds.has(c.ac_id)));

  const checkpoint = AC_CITE_CHECKPOINT;
  const context: GateContext = { citeCandidates: candidates, citeRuleStates: index.states };
  const blocked = isCheckpointBlocked(checkpoint.check(context));
  const findings = blocked ? groupFindings(findAcCiteViolations(candidates, index.states)) : [];

  if (config.mode === "report") return { kind: "admit", requireLiveRules: [], findings };

  // enforce: only an armed branch is refused; the spec's branch comes from the criteria it ALREADY had
  // (a create has none yet, so its own criteria place it).
  const branch = placeSpecInBranch(existing.length > 0 ? existing : next, index);
  if (!isBranchArmed(config, branch, index)) return { kind: "skip" };
  if (blocked) {
    const message = `${checkpoint.feed(context, [])}\nNothing was written.`;
    return { kind: "refuse", findings, context, message, branch };
  }
  return { kind: "admit", requireLiveRules: [...new Set(candidates.flatMap((c) => c.cites))], findings: [] };
}

// ─── Exemption budget ────────────────────────────────────────────────────────

/** Active exemptions may not exceed this share of live criteria. */
export const EXEMPTION_CAP_RATIO = 0.1;

/**
 * Largest number of active exemptions allowed for `liveCriteria` live criteria: floor(10% x live).
 * Integer arithmetic (`floor(live / 10)`) so 0.1 float error never shifts the boundary.
 */
export function maxActiveExemptions(liveCriteria: number): number {
  return Math.floor(liveCriteria / 10);
}

/**
 * Live criteria = acceptance criteria declared across the given (non-deleted) spec docs; a spec whose
 * array fails the schema counts 0, like `lore ac list`.
 */
export function countLiveCriteria(specs: readonly DocRecord[]): number {
  let total = 0;
  for (const spec of specs) {
    const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
    if (parsed.success) total += parsed.data.length;
  }
  return total;
}

type ExemptionRef = Pick<AcExemptionRow, "doc_id" | "ac_id" | "expires_at">;

/**
 * The exemptions whose criterion now cites at least one LIVE rule (BR-959: such an exemption has no uncited
 * case left to waive). Returned as `exemptionKey`s. "Live" is the citation gate's own measure
 * (`BaselineCiteIndex.states` from {@link indexBaseline}); a cite of a retired / deprecated / unknown id does
 * not satisfy. The result feeds {@link isExemptionActive} (store-shared.ts), the single activity predicate.
 */
export function satisfiedExemptionKeys(
  exemptions: readonly Pick<AcExemptionRow, "doc_id" | "ac_id">[],
  cites: readonly AcCiteRow[],
  states: AcCiteRuleStates,
): Set<string> {
  const liveCited = new Set<string>();
  for (const cite of cites) {
    if (Object.prototype.hasOwnProperty.call(states, cite.rule_id) && states[cite.rule_id] === "live") {
      liveCited.add(exemptionKey(cite.doc_id as string, cite.ac_id));
    }
  }
  const out = new Set<string>();
  for (const row of exemptions) {
    const key = exemptionKey(row.doc_id as string, row.ac_id);
    if (liveCited.has(key)) out.add(key);
  }
  return out;
}

/**
 * The ac_ids holding an ACTIVE exemption for one spec: `doc_id` matches and the row is active per
 * {@link isExemptionActive} (unexpired AND uncited) - the same predicate as {@link exemptionHeadroom},
 * `AcExemptionService.counts` and the grant cap.
 */
export function activeExemptedAcIds(
  exemptions: readonly ExemptionRef[],
  specId: string,
  nowIso: string,
  satisfiedKeys: ReadonlySet<string>,
): Set<string> {
  return new Set(
    exemptions
      .filter((row) => (row.doc_id as string) === specId && isExemptionActive(row, nowIso, satisfiedKeys))
      .map((row) => row.ac_id),
  );
}

/**
 * Exemptions still grantable: `floor(10% x liveCriteria) - active`, never negative. Active is
 * {@link isExemptionActive}: unexpired AND its criterion cites no live rule.
 */
export function exemptionHeadroom(
  liveCriteria: number,
  exemptions: readonly ExemptionRef[],
  nowIso: string,
  satisfiedKeys: ReadonlySet<string>,
): number {
  const active = exemptions.filter((row) => isExemptionActive(row, nowIso, satisfiedKeys)).length;
  return Math.max(0, maxActiveExemptions(liveCriteria) - active);
}

// ─── Feeding pack ────────────────────────────────────────────────────────────

/** A refusal names at most this many candidate rules. */
export const FEEDING_PACK_MAX_CANDIDATES = 5;

/** Inputs of {@link buildCiteFeedingPack}. */
export interface CiteFeedingPackInput {
  /** The spec whose write was refused; `undefined` on create (no row yet, so nothing to exclude). */
  specId: string | undefined;
  specSlug: string;
  /** The refused criterion — the id the cite line names, and whose statement feeds the text tier. */
  acId: string;
  acStatement: string | undefined;
  /**
   * `true` when the refused criterion does NOT exist yet (a refused `ac add`): it was never written, so
   * `lore ac cite` would fail "not declared" and the line must be an `ac add ... --cite` (BR-86).
   */
  refusedIsNew: boolean;
  /** The spec's `extra.code_anchors` (`path[#Symbol]`). */
  specAnchors: readonly string[];
  /** The spec's branch (`undefined` = unplaced). */
  branch: string | undefined;
  /** Baseline docs, specs and the `ac_cites` / `rule_depends` rows. */
  data: RuleIndexData;
  /** Every `ac_exemptions` row. */
  exemptions: readonly ExemptionRef[];
  nowIso: string;
}

const TEXT_TIER_MIN_WORD = 4;
const TEXT_TIER_MAX_WORDS = 6;

/**
 * Build the refusal's feeding pack: up to 5 LIVE candidate rules ranked (1) cited by OTHER specs whose
 * code anchors match this spec's (the ranking is `findRules({file})`, once per anchor, in anchor order),
 * (2) the remaining live rules of the spec's branch in BR-n order, (3) a text match of the refused
 * criterion's longer words; a ready line for the first candidate (`lore ac cite` for an existing criterion, `lore ac add ... --cite` for one the refusal did not write); and the exemption
 * headroom.
 */
export function buildCiteFeedingPack(input: CiteFeedingPackInput): AcCiteFeedingPack {
  const rules = collectLeafRules(input.data.baseline);
  const index = indexBaseline(input.data.baseline);
  const ordered: string[] = [];
  const take = (ruleId: string): void => {
    if (ordered.length >= FEEDING_PACK_MAX_CANDIDATES || ordered.includes(ruleId)) return;
    // AD-n is never a candidate (BR-980)
    if (rules.get(ruleId)?.lifecycle !== "live" || ruleIdPrefix(ruleId) === "AD") return;
    ordered.push(ruleId);
  };

  // Tier 1 — anchors. The refused spec's own citations are excluded: it is asking what ELSE to cite.
  const others: RuleIndexData = {
    ...input.data,
    specs: input.data.specs.filter((s) => (s.id as string) !== input.specId),
    cites: input.data.cites.filter((c) => (c.doc_id as string) !== input.specId),
  };
  const files = [...new Set(input.specAnchors.map(stripAnchorSymbol))];
  for (const file of files) for (const ruleId of findRules({ file }, others)) take(ruleId);

  // Tier 2 — the spec's branch.
  if (input.branch !== undefined) {
    const inBranch = [...rules.keys()]
      .filter((ruleId) => index.branchOfRule.get(ruleId) === input.branch)
      .sort(compareRuleIds);
    for (const ruleId of inBranch) take(ruleId);
  }

  // Tier 3 — text.
  if (ordered.length < FEEDING_PACK_MAX_CANDIDATES && input.acStatement !== undefined) {
    const words = [...new Set(input.acStatement.toLowerCase().match(/[a-z0-9]+/g) ?? [])]
      .filter((w) => w.length >= TEXT_TIER_MIN_WORD)
      .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
      .slice(0, TEXT_TIER_MAX_WORDS);
    for (const text of words) for (const ruleId of findRules({ text }, input.data)) take(ruleId);
  }

  const candidates = ordered.map((id) => ({ id, statement: rules.get(id)?.statement ?? "" }));
  const first = candidates[0];
  const citeRule = first !== undefined ? first.id : "<BR-id>";
  return {
    candidates,
    cite_line: input.refusedIsNew
      ? `lore ac add ${input.specSlug} ${input.acId} ... --cite ${citeRule}`
      : `lore ac cite ${input.specSlug} ${input.acId} ${citeRule}`,
    exemption_headroom: exemptionHeadroom(
      countLiveCriteria(input.data.specs),
      input.exemptions,
      input.nowIso,
      satisfiedExemptionKeys(input.exemptions, input.data.cites, index.states),
    ),
  };
}
