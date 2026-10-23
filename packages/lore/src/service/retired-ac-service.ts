/**
 * RetiredAcService — lists the acceptance criteria retired during a plan and settles the owner's one confirmation.
 *
 * Purpose: adr-an-acceptance-criterion-retires-with-the-feature-it. An AC retires with the feature it describes
 *   (superseded, or its spec deprecated) without a per-AC question; the plan's milestone review lists them and the
 *   owner confirms the whole batch with ONE pending decision per plan.
 * Public surface: `RetiredAcService.collect(bundle)`, `RetiredAcService.settle(bundle)`, `RetiredAcDeps`,
 *   `PlanRetirementState`, `retirementSubjectId`.
 * Invariants:
 *   - A retirement belongs to a plan when it happened after the plan was created AND (its spec is the plan's governing
 *     spec, or it was superseded BY a criterion of that spec, or the writing actor is one of the plan's task/plan
 *     authors or claim holders). An actor with no relation to the plan never attributes anything to it.
 *   - The decision uses class `governance-loosen` (human-always: weakening the quality floor is the owner's call, check 1
 *     of adr-ai-decision-standard-four-checks-references-from-excellent). Its subject id is `ac-retire-confirm:<plan>`
 *     (never the threshold subject, so threshold calibration ignores it) and its version hashes the plan fingerprint
 *     plus the retired set, so re-planning or a new retirement is a NEW question.
 *   - Accept (human-tty `auto`) confirms. Reject (human-tty `refuse`) is carried out here, idempotently: each listed
 *     retirement still in force (same `at`) is restored, and the close stays refused while the plan's fingerprint is the
 *     one the rejection recorded. Re-planning changes the fingerprint.
 *   - A pending decision is never raised twice for the same subject version.
 * Side-effect class: IO through injected ports (services never import each other; `app.ts` binds the real ones).
 *
 * Limit: a deprecation that also abandoned the spec's still-proposed rules is restored to its status only; the
 *   abandoned rule ids are not revived (re-propose them when re-planning).
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D, AC-LG-12)
 */

import { createHash } from "node:crypto";
import {
  err,
  ok,
  retiredAcRefSchema,
  specAcceptanceCriteriaSchema,
  type AuditEntry,
  type DocRecord,
  type LoreError,
  type PlanBundle,
  type Result,
  type RetiredAcRef,
} from "@lore/core";
import { decisionDetailSchema, effectiveDecisionVerdict, type DecisionDetail, type DecisionLogRow } from "../store/decision-log.js";
import type { DecisionService } from "./decision-service.js";
import { planStateFingerprint, type PlanRetirementState } from "./milestone-review.js";
import { GOVERNANCE_LOOSEN_CLASS } from "./autonomy-threshold-service.js";
import type { StoreInterface } from "../store/store-interface.js";

/** The ports this service needs. */
export interface RetiredAcDeps {
  readonly store: Pick<StoreInterface, "findMany" | "queryAudit" | "findVersions">;
  readonly decisions: Pick<DecisionService, "decide" | "listPending">;
  readonly listDecisionLog: () => Promise<Result<DecisionLogRow[], LoreError>>;
  /** Clears one supersession (matched by its `at`); `ok(false)` when nothing matched. */
  readonly restoreCriterion: (spec: string, ac: string, at: string, reason: string) => Promise<Result<boolean, LoreError>>;
  /** Puts a deprecated spec back to `status`; `ok(false)` when it is no longer deprecated. */
  readonly restoreSpecStatus: (spec: string, status: DocRecord["status"], reason: string) => Promise<Result<boolean, LoreError>>;
}

interface RetirementInstance extends RetiredAcRef {
  readonly by: string;
  readonly specId: string;
  readonly bySpecId?: string;
}

/** Decision subject id of one plan's retirement confirmation. */
export function retirementSubjectId(planSlug: string): string {
  return `ac-retire-confirm:${planSlug}`;
}

const instanceKey = (r: Pick<RetiredAcRef, "kind" | "spec" | "ac" | "at">): string => `${r.kind}|${r.spec}|${r.ac}|${r.at}`;

function toRef(i: RetirementInstance): RetiredAcRef {
  return retiredAcRefSchema.parse({
    kind: i.kind,
    spec: i.spec,
    ac: i.ac,
    reason: i.reason,
    at: i.at,
    ...(i.superseded_by !== undefined ? { superseded_by: i.superseded_by } : {}),
    ...(i.previous_status !== undefined ? { previous_status: i.previous_status } : {}),
  });
}

function storeError(message: string): LoreError {
  return { code: "STORE_ERROR", message };
}

/** See the module header. */
export class RetiredAcService {
  constructor(private readonly deps: RetiredAcDeps) {}

  /** The retired ACs attributed to the plan in `bundle`, oldest first. */
  async collect(bundle: PlanBundle): Promise<Result<RetiredAcRef[], LoreError>> {
    const scanned = await this.scan(bundle.plan.created_at);
    if (!scanned.ok) return scanned;
    const actors = new Set<string>([bundle.plan.created_by, ...bundle.tasks.map((t) => t.created_by)]);
    for (const task of bundle.tasks) {
      const claimBy = (task.extra["claim"] as { by?: unknown } | undefined)?.by;
      if (typeof claimBy === "string") actors.add(claimBy);
    }
    const planSpecId = bundle.spec?.id;
    const mine = scanned.value.filter(
      (i) => i.at >= bundle.plan.created_at && ((planSpecId !== undefined && (i.specId === planSpecId || i.bySpecId === planSpecId)) || actors.has(i.by)),
    );
    return ok(mine.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).map(toRef));
  }

  /**
   * Carries out any rejection already answered for this plan, then reports where the plan stands; raises the one
   * pending owner decision when there are retired ACs nobody has answered for.
   *
   * @returns `none` (nothing retired, no standing rejection) | `confirmed` | `pending` (decision id to ask) | `rejected`
   */
  async settle(bundle: PlanBundle): Promise<Result<PlanRetirementState, LoreError>> {
    const subjectId = retirementSubjectId(bundle.plan.slug);
    const fingerprint = planStateFingerprint(bundle.plan, bundle.tasks);
    const logged = await this.deps.listDecisionLog();
    if (!logged.ok) return logged;
    const rows = logged.value;

    const restored: RetiredAcRef[] = [];
    let standingRejection = false;
    const versions = [...new Set(rows.filter((r) => r.class === GOVERNANCE_LOOSEN_CLASS && r.subject_id === subjectId).map((r) => r.subject_version))];
    for (const version of versions) {
      const effective = effectiveDecisionVerdict(rows, { class: GOVERNANCE_LOOSEN_CLASS, subject_id: subjectId, subject_version: version });
      if (effective === null || effective.channel !== "human-tty" || effective.verdict !== "refuse") continue;
      const recorded = this.recordedChange(rows, subjectId, version);
      if (recorded === undefined) continue;
      if (recorded.fingerprint === fingerprint) standingRejection = true;
      const done = await this.restoreRejected(recorded.retired);
      if (!done.ok) return done;
      restored.push(...done.value);
    }
    if (standingRejection) return ok({ state: "rejected", restored });

    const collected = await this.collect(bundle);
    if (!collected.ok) return collected;
    const retired = collected.value;
    if (retired.length === 0) return ok({ state: "none" });

    const version = createHash("sha256").update(`${fingerprint}|${retired.map(instanceKey).sort().join(",")}`).digest("hex");
    const effective = effectiveDecisionVerdict(rows, { class: GOVERNANCE_LOOSEN_CLASS, subject_id: subjectId, subject_version: version });
    if (effective !== null && effective.channel === "human-tty" && effective.verdict === "auto") return ok({ state: "confirmed", retired });

    const open = await this.findPending(subjectId, version);
    if (!open.ok) return open;
    if (open.value !== undefined) return ok({ state: "pending", retired, pendingId: open.value });
    const decided = await this.deps.decisions.decide(GOVERNANCE_LOOSEN_CLASS, { id: subjectId, version }, {}, this.detailOf(bundle, fingerprint, retired));
    if (!decided.ok) return decided;
    const raised = await this.findPending(subjectId, version);
    if (!raised.ok) return raised;
    if (raised.value === undefined) {
      return err(storeError(`retired-AC confirmation for plan ${bundle.plan.slug} was recorded (record ${decided.value.record_id}) but has no pending decision`));
    }
    return ok({ state: "pending", retired, pendingId: raised.value });
  }

  private async findPending(subjectId: string, version: string): Promise<Result<number | undefined, LoreError>> {
    const pending = await this.deps.decisions.listPending();
    if (!pending.ok) return pending;
    return ok(pending.value.find((p) => p.class === GOVERNANCE_LOOSEN_CLASS && p.subject_id === subjectId && p.subject_version === version)?.id);
  }

  private detailOf(bundle: PlanBundle, fingerprint: string, retired: readonly RetiredAcRef[]): DecisionDetail {
    const listed = retired.map((r) => `${r.spec}:${r.ac}`).join(", ");
    return {
      summary: `Confirm ${String(retired.length)} acceptance criteria retired during plan ${bundle.plan.slug}: ${listed.length > 600 ? `${listed.slice(0, 600)}...` : listed}`,
      requested_by: "lore assess (the plan's milestone review)",
      change: { document: bundle.plan.slug, plan_fingerprint: fingerprint, retired },
      on_accept: "The retirements stand and the plan can close.",
      on_reject:
        "The listed criteria are restored (superseded markers cleared, deprecated specs back to their previous status) and the plan cannot close until it is re-planned.",
    };
  }

  /** The `change` of the machine row that asked this subject version: the retired list and the fingerprint it asked about. */
  private recordedChange(
    rows: readonly DecisionLogRow[],
    subjectId: string,
    version: string,
  ): { retired: RetiredAcRef[]; fingerprint: string } | undefined {
    const asked = rows.filter((r) => r.class === GOVERNANCE_LOOSEN_CLASS && r.subject_id === subjectId && r.subject_version === version && r.channel === "machine" && r.detail != null);
    const row = asked[asked.length - 1];
    if (row?.detail == null) return undefined;
    const detail = decisionDetailSchema.parse(JSON.parse(row.detail));
    const fingerprint = detail.change["plan_fingerprint"];
    if (typeof fingerprint !== "string") return undefined;
    return { retired: retiredAcRefSchema.array().parse(detail.change["retired"]), fingerprint };
  }

  /** Restores each listed retirement that is still in force (same instance), once per spec for deprecations. */
  private async restoreRejected(listed: readonly RetiredAcRef[]): Promise<Result<RetiredAcRef[], LoreError>> {
    const earliest = listed.map((r) => r.at).sort()[0];
    if (earliest === undefined) return ok([]);
    const inForce = await this.scan(earliest);
    if (!inForce.ok) return inForce;
    const live = new Set(inForce.value.map(instanceKey));
    const done: RetiredAcRef[] = [];
    const specsRestored = new Set<string>();
    for (const entry of listed) {
      if (!live.has(instanceKey(entry))) continue;
      const reason = `retirement rejected at the milestone review: ${entry.reason}`;
      if (entry.kind === "superseded") {
        const r = await this.deps.restoreCriterion(entry.spec, entry.ac, entry.at, reason);
        if (!r.ok) return r;
        if (r.value) done.push(entry);
      } else if (!specsRestored.has(entry.spec)) {
        if (entry.previous_status === undefined) return err(storeError(`deprecated spec ${entry.spec} recorded no previous status to restore`));
        const r = await this.deps.restoreSpecStatus(entry.spec, entry.previous_status as DocRecord["status"], reason);
        if (!r.ok) return r;
        specsRestored.add(entry.spec);
        if (r.value) done.push(entry);
      } else {
        done.push(entry);
      }
    }
    return ok(done);
  }

  /** Every retirement in force since `since`: supersede markers and deprecated specs' criteria. */
  private async scan(since: string): Promise<Result<RetirementInstance[], LoreError>> {
    const specs = await this.deps.store.findMany({ type: "spec" });
    if (!specs.ok) return specs;
    const live = specs.value.filter((s) => s.deleted_at === null);
    const slugOfId = new Map(live.map((s) => [s.id as string, s.slug]));
    const found: RetirementInstance[] = [];

    for (const spec of live) {
      const criteria = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
      if (!criteria.success) continue;
      for (const c of criteria.data) {
        const marker = c.superseded_by;
        if (marker === undefined || marker.at < since) continue;
        found.push({
          kind: "superseded",
          spec: spec.slug,
          specId: spec.id as string,
          ac: c.id,
          reason: marker.reason,
          at: marker.at,
          by: marker.by,
          bySpecId: marker.spec,
          superseded_by: `${slugOfId.get(marker.spec) ?? marker.spec}:${marker.ac}`,
        });
      }
    }

    const audit = await this.deps.store.queryAudit({ action: "update", since });
    if (!audit.ok) return audit;
    const latestDeprecation = new Map<string, AuditEntry>();
    for (const entry of audit.value) {
      const patch = entry.details?.["patch"] as { status?: unknown } | undefined;
      if (patch?.status !== "deprecated" || entry.doc_id === undefined) continue;
      const prior = latestDeprecation.get(entry.doc_id as string);
      if (prior === undefined || entry.timestamp > prior.timestamp) latestDeprecation.set(entry.doc_id as string, entry);
    }
    for (const spec of live) {
      const entry = latestDeprecation.get(spec.id as string);
      if (entry === undefined || spec.status !== "deprecated") continue;
      const previous = await this.previousStatus(spec, entry);
      if (!previous.ok) return previous;
      const criteria = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
      if (!criteria.success) continue;
      const reasonText = entry.details?.["reason"];
      for (const c of criteria.data) {
        if (c.superseded_by !== undefined) continue;
        found.push({
          kind: "deprecated-spec",
          spec: spec.slug,
          specId: spec.id as string,
          ac: c.id,
          reason: typeof reasonText === "string" && reasonText.length > 0 ? reasonText : "spec deprecated",
          at: entry.timestamp,
          by: entry.actor,
          previous_status: previous.value,
        });
      }
    }
    return ok(found);
  }

  /** The spec's status in the version before the deprecating write; absent history is an error, never a guess. */
  private async previousStatus(spec: DocRecord, entry: AuditEntry): Promise<Result<string, LoreError>> {
    const newVersion = entry.details?.["new_version"];
    if (typeof newVersion !== "number") return err(storeError(`deprecation audit row of ${spec.slug} names no version`));
    const versions = await this.deps.store.findVersions(spec.id);
    if (!versions.ok) return versions;
    const before = versions.value.find((v) => v.version === newVersion - 1);
    if (before === undefined) return err(storeError(`${spec.slug} has no version ${String(newVersion - 1)} to read the pre-deprecation status from`));
    return ok(before.status);
  }
}
