/**
 * Module: rule-leaf-companion-writes — turns planned baseline-leaf writes into the companion writes of one spec write.
 *
 * Purpose: a spec's deprecation (abandon its proposed ids) and the owner's rejection of that deprecation (revive
 *   them) both commit leaf writes in the SAME transaction as the spec's status write; ONE builder shapes them.
 * Public surface: {@link leafPlansToCompanionWrites}.
 * Invariants: pure (no store, IO or clock); each leaf write is CAS-guarded on the version the plan read and carries
 *   its own version row and audit row naming `actor`.
 * Side-effect class: pure.
 * Source: BR-1307; adr-an-acceptance-criterion-retires-with-the-feature-it.
 */

import type { CompanionDocWrite } from "../store/store-interface.js";
import type { AbandonedLeafPlan } from "./rule-landing-port.js";

/**
 * @param leaves - the planned leaf writes (from `planAbandonment` or `planRevival`)
 * @param actor - the resolved acting identity
 * @param now - ISO timestamp shared with the primary write
 * @param proposeRules - true when the store must set the touched ids' registry rows to `proposed` (revival)
 */
export function leafPlansToCompanionWrites(
  leaves: readonly AbandonedLeafPlan[],
  actor: string,
  now: string,
  proposeRules: boolean,
): CompanionDocWrite[] {
  return leaves.map((planned) => {
    const leafVersion = planned.leaf.version + 1;
    return {
      id: planned.leaf.id,
      patch: { extra: planned.extra, status: planned.status, version: leafVersion, updated_at: now },
      opts: { expected_version: planned.leaf.version },
      version: {
        doc_id: planned.leaf.id,
        version: leafVersion,
        content: planned.leaf.content,
        extra: planned.extra,
        status: planned.status,
        title: planned.leaf.title,
        action: "update",
        created_at: now,
        created_by: actor,
        change_summary: planned.summary,
        slug: planned.leaf.slug,
      },
      audit: {
        timestamp: now,
        actor,
        session_id: planned.leaf.id,
        action: "update",
        doc_id: planned.leaf.id,
        details: { ...planned.details, version: leafVersion, new_version: leafVersion },
      },
      ...(proposeRules ? { propose_rules: planned.rules } : {}),
    };
  });
}
