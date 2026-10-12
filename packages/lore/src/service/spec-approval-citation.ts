/**
 * Module: spec-approval-citation — the BR-1007 approval precondition for a spec.
 *
 * Purpose: refuse the draft→approved promotion of a spec none of whose criteria cites a LIVE
 *   business (BR) or architecture standard (AS) rule; every other document type is untouched.
 * Public surface: {@link specCitesLiveRuleInCorpus} (the measure), {@link uncitedSpecMessage} (the refusal
 *   text, SSOT for approve / set / `lore gate spec-promote`), {@link requireSpecCitesLiveRule} (measure + refusal).
 * Invariants:
 *   - ONE definition of "live rule": `indexBaseline(...).states` / `specCitesLiveRule`
 *     (ac-cite-gate.ts), the same measure the citation gate uses — including its own-proposal rule: an id the
 *     spec's OWN change set proposes counts (a spec may cite what it is about to introduce); another spec's
 *     proposal is simply not passed in, so it never counts.
 *   - A store read failure is returned as itself, never read as "cites nothing" and never as "cites".
 *   - Nothing is written; the caller decides where in its gate order this runs and must call it from
 *     EVERY path that can promote a spec to `approved` (ReviewService.approve and CorpusService.set).
 * Side-effect class: IO (one `store.findMany({type: "baseline"})` read).
 * Source: rule BR-1007 (spec-baseline-slice-3b AC-BLS3B-2).
 */

import { err, ok, specAcceptanceCriteriaSchema, type LoreError, type Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { indexBaseline, specCitesLiveRule, type OwnProposedRule } from "./ac-cite-gate.js";

/**
 * The refusal text for an uncited spec — one wording for `approve`, `set --status approved` and the
 * `lore gate spec-promote` pre-flight, so the gate and the approval can never disagree in what they say.
 */
export function uncitedSpecMessage(specSlug: string): string {
  return (
    `spec "${specSlug}" cites no live business or architecture rule — none of its criteria cites a live ` +
    "BR or AS rule (or one its own change set proposes), so it cannot be approved. Cite one with `lore ac cite <spec> <ac-id> <rule-id>`"
  );
}

/**
 * The BR-1007 measure on its own: does at least one criterion cite a live BR/AS rule?
 *
 * @param store - read-only use: the baseline docs are listed to learn each rule's lifecycle
 * @param rawAcceptanceCriteria - the spec's `extra.acceptance_criteria` as stored (unvalidated);
 *   an absent or malformed value counts as zero criteria
 * @param ownProposed - the ids the SAME spec's change set proposes (`ownProposedRules(spec.extra)`); `[]` for none
 * @returns `ok(true | false)`; a store read failure is returned as itself
 */
export async function specCitesLiveRuleInCorpus(
  store: StoreInterface,
  rawAcceptanceCriteria: unknown,
  ownProposed: readonly OwnProposedRule[],
): Promise<Result<boolean, LoreError>> {
  const parsed = specAcceptanceCriteriaSchema.safeParse(rawAcceptanceCriteria);
  const criteria = parsed.success ? parsed.data : [];
  const baseline = await store.findMany({ type: "baseline" });
  if (!baseline.ok) return baseline;
  return ok(specCitesLiveRule(criteria, indexBaseline(baseline.value, ownProposed).states));
}

/**
 * @param store - read-only use: the baseline docs are listed to learn each rule's lifecycle
 * @param specSlug - the spec's slug, named in the refusal
 * @param rawAcceptanceCriteria - the spec's `extra.acceptance_criteria` as stored (unvalidated);
 *   an absent or malformed value counts as zero criteria
 * @param ownProposed - the ids the SAME spec's change set proposes (`ownProposedRules(spec.extra)`); `[]` for none
 * @returns `ok(true)` when at least one criterion cites a live BR/AS rule or an id the spec itself proposes; otherwise
 *   `VALIDATION_ERROR` (exit 4) on field `acceptance_criteria` whose message names `lore ac cite`
 * @example
 * const cited = await requireSpecCitesLiveRule(store, spec.slug, spec.extra["acceptance_criteria"], ownProposedRules(spec.extra));
 * if (!cited.ok) return cited;
 */
export async function requireSpecCitesLiveRule(
  store: StoreInterface,
  specSlug: string,
  rawAcceptanceCriteria: unknown,
  ownProposed: readonly OwnProposedRule[],
): Promise<Result<true, LoreError>> {
  const measured = await specCitesLiveRuleInCorpus(store, rawAcceptanceCriteria, ownProposed);
  if (!measured.ok) return measured;
  if (measured.value) return ok(true);
  return err({
    code: "VALIDATION_ERROR",
    field: "acceptance_criteria",
    message: uncitedSpecMessage(specSlug),
    value: specSlug,
  });
}
