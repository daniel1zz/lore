/**
 * Module: baseline-status — the `baseline` block of `lore status --json` and the
 * `lore status --check-baseline` integrity findings.
 *
 * Purpose: one derivation of the baseline slice's health numbers (rule counts, citation
 *   warnings, registry integrity) so the JSON block, the default-output line and the
 *   `--check-baseline` exit code can never disagree.
 * Public surface: {@link computeBaselineStatus}, {@link findBaselineIntegrityFindings},
 *   {@link BaselineStatus}, {@link BaselineFinding}, {@link baselineWarningCount}.
 * Invariants:
 *   - `computeBaselineStatus` returns `ok(null)` unless >= 1 live baseline doc exists or
 *     >= 1 AC carries `cites` — a corpus without baselines reports exactly what it did
 *     before slice 1 (rollback invariant AC-BLS1-8).
 *   - Report-only for the status block; only `--check-baseline` (findings) drives an exit code.
 *   - Git-free: rule verification comes from `RuleStateService.counts()`.
 * Side-effect class: reads the store; the only environment access is the injected `pathExists`.
 * Source: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C7.
 */

import { ok, lintRuleStatement } from "@lore/core";
import type { DocRecord, LoreError, Result, RuleLifecycle } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import {
  canonicalAcCites,
  canonicalRuleDepends,
  deriveAcCites,
  deriveRuleDepends,
  listedRuleLifecycle,
} from "../store/index-rows.js";
import { countCitations, buildRuleIndex } from "./ac-citations.js";
import { collectKnownRuleIds, findUnregisteredRuleIds } from "./baseline-rule-ids.js";
import type { RuleStateService, RuleStateCounts } from "./rule-state-service.js";
import { AcExemptionService } from "./ac-exemption-service.js";

export interface BaselineStatus {
  rules_total: number;
  rules_by_lifecycle: Record<RuleLifecycle, number>;
  rules_by_verification: RuleStateCounts["by_verification"];
  /** Live rules no AC cites. */
  rules_uncovered: number;
  /** Live rules whose statement trips the BL-11 implementation-detail lint. */
  rules_with_impl_detail: number;
  acs_total: number;
  acs_citing: number;
  acs_uncited: number;
  cites_dangling: number;
  cites_to_inactive: number;
  ambiguous_ac_ref: number;
  registry_mismatch: number;
  /**
   * Disagreements between the migration-014 index tables and the documents they mirror: missing or
   * stray `ac_cites` / `rule_depends` rows plus registry rows whose lifecycle/version is stale.
   * A count only — never repaired by the status check.
   */
  index_mismatch: number;
  /** Criterion exemptions (spec C4) whose expiry is still in the future at status time. */
  exemptions_active: number;
  /** Criterion exemptions past their expiry (kept for the record, no longer excusing anything). */
  exemptions_expired: number;
  /** `exemptions_active / live criteria` (0 when none); the cap is 0.10. */
  exemption_ratio: number;
}

export type BaselineFindingKind =
  | "unregistered-rule"
  | "registry-leaf-mismatch"
  | "rule-on-non-leaf"
  | "dangling-depends-on";

export interface BaselineFinding {
  kind: BaselineFindingKind;
  /** Slug of the baseline doc the finding is about. */
  doc: string;
  detail: string;
}

/** Sum of the report-only warning counts (drives the one default-output line). */
export function baselineWarningCount(status: BaselineStatus): number {
  return (
    status.cites_dangling +
    status.cites_to_inactive +
    status.ambiguous_ac_ref +
    status.registry_mismatch +
    status.index_mismatch +
    status.rules_with_impl_detail
  );
}

function ruleRecordsOf(doc: DocRecord): Array<{ id: string; statement: string; lifecycle: string }> {
  const raw = doc.extra["rules"];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).flatMap((r) => {
    if (typeof r !== "object" || r === null) return [];
    const { id, statement, lifecycle } = r as { id?: unknown; statement?: unknown; lifecycle?: unknown };
    if (typeof id !== "string") return [];
    return [{ id, statement: typeof statement === "string" ? statement : "", lifecycle: typeof lifecycle === "string" ? lifecycle : "" }];
  });
}

function hasCites(spec: DocRecord): boolean {
  const acs = spec.extra["acceptance_criteria"];
  if (!Array.isArray(acs)) return false;
  return (acs as unknown[]).some(
    (c) => typeof c === "object" && c !== null && Array.isArray((c as { cites?: unknown }).cites) && ((c as { cites: unknown[] }).cites.length > 0),
  );
}

/**
 * Registry <-> leaf consistency, rules on a non-leaf and dangling `depends_on` — the
 * `--check-baseline` oracle. Order: by finding kind, then document slug, then rule id.
 */
export async function findBaselineIntegrityFindings(
  store: StoreInterface,
): Promise<Result<BaselineFinding[], LoreError>> {
  const docs = await store.findMany({ type: "baseline", exclude_deleted: false });
  if (!docs.ok) return docs;
  const registry = await store.listRuleRegistry();
  if (!registry.ok) return registry;

  const live = docs.value.filter((d) => d.deleted_at === null);
  const liveLeaves = live.filter((d) => d.extra["node"] === "leaf");
  const liveById = new Map(live.map((d) => [d.id, d]));
  const deletedIds = new Set(docs.value.filter((d) => d.deleted_at !== null).map((d) => d.id));
  const rowById = new Map(registry.value.map((row) => [row.id, row]));
  const findings: BaselineFinding[] = [];

  const slugOf = new Map(liveLeaves.map((l) => [l.id, l.slug]));
  for (const { ruleId, leafId } of findUnregisteredRuleIds(liveLeaves, registry.value)) {
    findings.push({
      kind: "unregistered-rule",
      doc: slugOf.get(leafId) ?? leafId,
      detail: `${ruleId} is listed on the leaf but the registry never allocated it`,
    });
  }
  for (const leaf of liveLeaves) {
    for (const rule of ruleRecordsOf(leaf)) {
      const row = rowById.get(rule.id);
      if (row !== undefined && row.leaf_doc_id !== leaf.id) {
        findings.push({
          kind: "registry-leaf-mismatch",
          doc: leaf.slug,
          detail: `${rule.id} is listed here but the registry assigns it to ${liveById.get(row.leaf_doc_id)?.slug ?? row.leaf_doc_id}`,
        });
      }
    }
  }
  for (const row of registry.value) {
    if (deletedIds.has(row.leaf_doc_id)) continue; // a rule of a soft-deleted leaf keeps its burned id
    const owner = liveById.get(row.leaf_doc_id);
    if (owner === undefined || !ruleRecordsOf(owner).some((r) => r.id === row.id)) {
      findings.push({
        kind: "registry-leaf-mismatch",
        doc: owner?.slug ?? row.leaf_doc_id,
        detail: `registry assigns ${row.id} to this leaf but the leaf no longer lists it`,
      });
    }
  }

  for (const doc of live) {
    if (doc.extra["node"] !== "leaf" && ruleRecordsOf(doc).length > 0) {
      findings.push({
        kind: "rule-on-non-leaf",
        doc: doc.slug,
        detail: `${String(doc.extra["node"] ?? "?")} node carries ${ruleRecordsOf(doc).length} rule(s); rules belong on leaves only`,
      });
    }
  }
  const known = collectKnownRuleIds(liveLeaves, registry.value);
  for (const leaf of liveLeaves) {
    const deps = leaf.extra["depends_on"];
    if (!Array.isArray(deps)) continue;
    for (const dep of deps as unknown[]) {
      if (typeof dep === "string" && !known.has(dep)) {
        findings.push({ kind: "dangling-depends-on", doc: leaf.slug, detail: `depends_on ${dep} names no existing rule` });
      }
    }
  }
  return ok(findings);
}

/** Size of the symmetric difference of two canonical (sorted, de-duplicated) row lists. */
function symmetricDifferenceSize<T>(expected: T[], actual: T[], keyOf: (row: T) => string): number {
  const expectedKeys = new Set(expected.map(keyOf));
  const actualKeys = new Set(actual.map(keyOf));
  let differing = 0;
  for (const key of expectedKeys) if (!actualKeys.has(key)) differing += 1; // missing from the index
  for (const key of actualKeys) if (!expectedKeys.has(key)) differing += 1; // stray in the index
  return differing;
}

/**
 * Count the index-vs-document disagreements of migration-014: missing/stray `ac_cites` rows,
 * missing/stray `rule_depends` rows, and registry rows whose lifecycle or version differs from the
 * live leaf that lists the rule (one per row). Reads only; repairs nothing.
 */
async function countIndexMismatch(
  store: StoreInterface,
  specs: DocRecord[],
  baselineDocs: DocRecord[],
): Promise<Result<number, LoreError>> {
  const cites = await store.listAcCites();
  if (!cites.ok) return cites;
  const depends = await store.listRuleDepends();
  if (!depends.ok) return depends;
  const registry = await store.listRuleRegistry();
  if (!registry.ok) return registry;

  let mismatch = symmetricDifferenceSize(
    deriveAcCites(specs),
    canonicalAcCites(cites.value),
    (r) => `${r.doc_id}\u0000${r.ac_id}\u0000${r.rule_id}`,
  );
  mismatch += symmetricDifferenceSize(
    deriveRuleDepends(baselineDocs),
    canonicalRuleDepends(depends.value),
    (r) => `${r.leaf_id}\u0000${r.rule_id}`,
  );
  const liveById = new Map(baselineDocs.filter((d) => d.deleted_at === null).map((d) => [d.id, d]));
  for (const row of registry.value) {
    const owner = liveById.get(row.leaf_doc_id);
    if (owner === undefined) continue; // owner missing/soft-deleted: registry_mismatch's concern, nothing to compare
    const listed = listedRuleLifecycle(owner.extra, row.id);
    if (listed === undefined) continue; // leaf does not (validly) list the rule: registry_mismatch's concern
    if (row.lifecycle !== listed || row.version !== owner.version) mismatch += 1;
  }
  return ok(mismatch);
}

/**
 * Compute the `baseline` status block, or `ok(null)` when the corpus has neither a live
 * baseline doc nor any AC citation (and no index row that would be a mismatch).
 *
 * @param pathExists - repo-relative path probe for the BL-11 lint (fs check from the repo root).
 * @param now - ISO 8601 instant deciding which exemptions are active (default: the current time).
 */
export async function computeBaselineStatus(
  store: StoreInterface,
  ruleState: RuleStateService,
  pathExists: (path: string) => boolean,
  now: string = new Date().toISOString(),
): Promise<Result<BaselineStatus | null, LoreError>> {
  const baselineDocs = await store.findMany({ type: "baseline" });
  if (!baselineDocs.ok) return baselineDocs;
  const specs = await store.findMany({ type: "spec" });
  if (!specs.ok) return specs;
  const indexMismatch = await countIndexMismatch(store, specs.value, baselineDocs.value);
  if (!indexMismatch.ok) return indexMismatch;
  // reason: a stray index row in an otherwise baseline-free corpus is itself a finding worth a block.
  if (baselineDocs.value.length === 0 && !specs.value.some(hasCites) && indexMismatch.value === 0) return ok(null);

  const leaves = baselineDocs.value.filter((d) => d.extra["node"] === "leaf");
  const counts = await ruleState.counts();
  if (!counts.ok) return counts;
  const findings = await findBaselineIntegrityFindings(store);
  if (!findings.ok) return findings;
  const exemptions = await new AcExemptionService(store).counts({ now });
  if (!exemptions.ok) return exemptions;

  const index = buildRuleIndex(leaves);
  const citations = countCitations(specs.value, index);
  const cited = new Set<string>();
  for (const spec of specs.value) {
    const acs = spec.extra["acceptance_criteria"];
    if (!Array.isArray(acs)) continue;
    for (const ac of acs as unknown[]) {
      const cites = typeof ac === "object" && ac !== null ? (ac as { cites?: unknown }).cites : undefined;
      if (Array.isArray(cites)) for (const id of cites) if (typeof id === "string") cited.add(id);
    }
  }

  const byLifecycle: Record<RuleLifecycle, number> = { live: 0, deprecated: 0, retired: 0 };
  let uncovered = 0;
  let implDetail = 0;
  const seen = new Set<string>();
  for (const leaf of leaves) {
    for (const rule of ruleRecordsOf(leaf)) {
      if (seen.has(rule.id) || index.get(rule.id) === undefined) continue;
      seen.add(rule.id);
      const lifecycle = index.get(rule.id)?.lifecycle as RuleLifecycle;
      byLifecycle[lifecycle] += 1;
      if (lifecycle !== "live") continue;
      if (!cited.has(rule.id)) uncovered += 1;
      if (lintRuleStatement(rule.statement, { pathExists }).length > 0) implDetail += 1;
    }
  }

  return ok({
    rules_total: counts.value.rules_total,
    rules_by_lifecycle: byLifecycle,
    rules_by_verification: counts.value.by_verification,
    rules_uncovered: uncovered,
    rules_with_impl_detail: implDetail,
    ...citations,
    ambiguous_ac_ref: counts.value.ambiguous_ac_ref,
    registry_mismatch: findings.value.filter(
      (f) => f.kind === "unregistered-rule" || f.kind === "registry-leaf-mismatch",
    ).length,
    index_mismatch: indexMismatch.value,
    exemptions_active: exemptions.value.active,
    exemptions_expired: exemptions.value.expired,
    exemption_ratio: exemptions.value.ratio,
  });
}
