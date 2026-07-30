/**
 * `resolvePrdSyncDomainDoc` — resolves the domain doc a prd-sync predicate
 * should reason about, from an already-resolved ancestor spec.
 *
 * Public surface: one function, {@link resolvePrdSyncDomainDoc}. Side-effect
 * class: IO (reads the store; never writes). Invariant: a store-taking FREE
 * function, not a service — extracted out of `CorpusService`'s former private
 * method (spec-plan-close-predicates-measure-invariants-an-applicability, task
 * T1 item 8) so BOTH `CorpusService` (`plan-close`, `CorpusService.set`) and
 * `ReviewService` (`plan-promote`'s domain-doc early-warning advisory,
 * `ReviewService.enforceApprovalGate`) can call the IDENTICAL resolution
 * without either service importing the other (`service/CLAUDE.md`'s "no
 * cross-service imports" invariant). This module sits beside
 * `checkpoint-registry.ts` as gate infrastructure, not a tracked service.
 */

import { ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

/**
 * Resolves the domain doc a `plan-close`/`plan-promote` prd-sync predicate
 * should diff/check against, from an already-resolved ancestor spec: SPEC-080's
 * own text says "linked (parent or implements) to a domain doc", read here as
 * (1) the ancestor spec's OWN `parent_id`, when that parent doc is itself type
 * `"spec"` (one tier up, e.g. a landing spec parented directly under a
 * domain-overview spec) or (2) failing that, the FIRST `"implements"`-typed
 * outgoing link the ancestor spec declares, when its target is itself type
 * `"spec"`. Both checks require type `"spec"` (never `"prd"`) — a landing
 * spec's parent is very commonly the root PRD itself, which must never be
 * mistaken for a domain doc. `domain-overview` (SPEC-080 §C2) isn't declared in
 * `SPEC_KINDS` yet (a separate task's scope) — a plain `spec`-typed doc stands
 * in.
 *
 * @param store - Storage abstraction (any `StoreInterface` implementation).
 * @param spec - The plan's resolved ancestor spec (`PlanBundle.spec`).
 * @returns `ok(DocRecord)` when a domain doc resolved; `ok(null)` — a FACT,
 *   never an error — when neither relation resolves one (no ancestor-spec
 *   parent at all, a non-spec parent, no `implements` link, or an
 *   unresolvable/soft-deleted/non-spec link target). Callers
 *   (`prdOutlineSynced`, `planPromotePrdSyncAdvisory`) treat `ok(null)` as
 *   "referent absent", never as a violation to encode as `false`.
 * @example
 * await resolvePrdSyncDomainDoc(store, featureSpec);
 *   // => ok(domainDocRecord) when featureSpec.parent_id resolves a spec, or
 *   //    featureSpec declares an `implements` edge to one
 * @example
 * await resolvePrdSyncDomainDoc(store, specParentedDirectlyUnderPrd);
 *   // => ok(null) — no domain doc, a fact
 */
export async function resolvePrdSyncDomainDoc(
  store: StoreInterface,
  spec: DocRecord,
): Promise<Result<DocRecord | null, LoreError>> {
  if (spec.parent_id !== null) {
    const parentResult = await store.find(spec.parent_id);
    if (!parentResult.ok) return parentResult;
    const parent = parentResult.value;
    if (parent !== null && parent.deleted_at === null && parent.type === "spec") {
      return ok(parent);
    }
  }

  const linksResult = await store.findLinks(spec.id, "out");
  if (!linksResult.ok) return linksResult;
  const implementsLink = linksResult.value.find((l) => l.link_type === "implements");
  if (implementsLink === undefined) {
    return ok(null);
  }

  const targetResult = await store.find(implementsLink.to_id);
  if (!targetResult.ok) return targetResult;
  const target = targetResult.value;
  if (target === null || target.deleted_at !== null || target.type !== "spec") {
    return ok(null);
  }
  return ok(target);
}
