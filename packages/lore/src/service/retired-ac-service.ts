/**
 * RetiredAcService — lists the acceptance criteria retired during a plan and settles the owner's one confirmation.
 *
 * Purpose: adr-an-acceptance-criterion-retires-with-the-feature-it. An AC retires with the feature it describes
 *   (superseded, or its spec deprecated) without a per-AC question; the plan's milestone review lists them and the
 *   owner confirms the whole batch with ONE pending decision per plan.
 * Public surface: `RetiredAcService.collect(bundle)`, `RetiredAcService.settle(bundle)`, `RetiredAcDeps`,
 *   `PlanRetirementState`, `retirementSubjectId`.
 * Invariants:
 *   - A retirement belongs to a plan ONLY when the retiring write recorded `retired_in_plan` = that plan's id (the plan
 *     of the task the writing run held a claim on: `lore ac supersede` marker / the deprecation's audit row). No
 *     timestamp, spec or actor heuristic attributes anything; a retirement without the field (history, or a run with
 *     no claimed task) belongs to no plan.
 *   - A pending decision of this subject whose retired list no longer matches the plan's current list is withdrawn in
 *     `settle` (closing marker in the decision log), so it leaves `lore pending`.
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
 *   - Rejecting a deprecation restores the spec's status AND revives the proposed rule ids its deprecation abandoned
 *     (BR-1307), in the same write (`restoreSpecStatus`, bound in `app.ts` through the rule-change planner).
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
  readonly decisions: Pick<DecisionService, "decide" | "listPending" | "readPending" | "withdrawPending">;
  readonly listDecisionLog: () => Promise<Result<DecisionLogRow[], LoreError>>;
  /** Clears one supersession (matched by its `at`); `ok(false)` when nothing matched. */
  readonly restoreCriterion: (spec: string, ac: string, at: string, reason: string) => Promise<Result<boolean, LoreError>>;
  /** Puts a deprecated spec back to `status`; `ok(false)` when it is no longer deprecated. */
  readonly restoreSpecStatus: (spec: string, status: DocRecord["status"], reason: string) => Promise<Result<boolean, LoreError>>;
}

interface RetirementInstance extends RetiredAcRef {
  /** Id of the plan whose work made the retirement; absent = attributed to no plan. */
  readonly retiredInPlan?: string;
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
    // reason: `plan.created_at` only bounds the scan (work done for a plan cannot predate it); it attributes nothing.
    const scanned = await this.scan(bundle.plan.created_at);
    if (!scanned.ok) return scanned;
    const mine = scanned.value.filter((i) => i.retiredInPlan === (bundle.plan.id as string));
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
    const fingerprint = planStateFingerprint(bundle.plan, bundle.tasks, bundle.spec);
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
    const version = createHash("sha256").update(`${fingerprint}|${retired.map(instanceKey).sort().join(",")}`).digest("hex");
    const withdrawn = await this.deps.decisions.withdrawPending(
      GOVERNANCE_LOOSEN_CLASS,
      subjectId,
      retired.length === 0 ? null : version,
      `the plan's retired-AC list changed (now ${String(retired.length)} listed); this question no longer matches it`,
    );
    if (!withdrawn.ok) return withdrawn;
    if (retired.length === 0) return ok({ state: "none" });
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

  /**
   * True when this plan has an open retirement decision that no longer matches its current attributed list (a
   * different subject version, or the list is now empty): `settle` would withdraw it (#354). A pure read.
   */
  async hasStalePendingDecision(bundle: PlanBundle): Promise<Result<boolean, LoreError>> {
    const subjectId = retirementSubjectId(bundle.plan.slug);
    const pending = await this.deps.decisions.readPending();
    if (!pending.ok) return pending;
    const open = pending.value.filter((p) => p.class === GOVERNANCE_LOOSEN_CLASS && p.subject_id === subjectId);
    if (open.length === 0) return ok(false);
    const collected = await this.collect(bundle);
    if (!collected.ok) return collected;
    if (collected.value.length === 0) return ok(true);
    const fingerprint = planStateFingerprint(bundle.plan, bundle.tasks, bundle.spec);
    const version = createHash("sha256").update(`${fingerprint}|${collected.value.map(instanceKey).sort().join(",")}`).digest("hex");
    return ok(open.some((p) => p.subject_version !== version));
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
          ac: c.id,
          reason: marker.reason,
          at: marker.at,
          ...(marker.retired_in_plan !== undefined ? { retiredInPlan: marker.retired_in_plan } : {}),
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
      const retiredInPlan = entry.details?.["retired_in_plan"];
      // reason: a deprecation attributed to no plan is listed for none, so its version history is never read (#353:
      // an old unattributed deprecation with trimmed history must not error an unrelated plan's settle).
      if (typeof retiredInPlan !== "string" || retiredInPlan === "") continue;
      const criteria = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
      if (!criteria.success) continue;
      const previous = await this.previousStatus(spec, entry);
      if (!previous.ok) return previous;
      const reasonText = entry.details?.["reason"];
      for (const c of criteria.data) {
        if (c.superseded_by !== undefined) continue;
        found.push({
          kind: "deprecated-spec",
          spec: spec.slug,
          ac: c.id,
          reason: typeof reasonText === "string" && reasonText.length > 0 ? reasonText : "spec deprecated",
          at: entry.timestamp,
          retiredInPlan,
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

/** What `lore assess` / `lore_assess` report about a plan's retired ACs: the one shape both surfaces serialize. */
export interface RetirementAssessFields {
  /** ACs retired during the plan (restored ones when the owner rejected); absent when none. */
  readonly retired_acs?: readonly RetiredAcRef[];
  /** The one pending owner decision that confirms them (`lore pending --ask`); absent when none is open. */
  readonly pending_decision?: number;
  /** One-clause account for the row's reason text; absent when nothing is retired. */
  readonly summary?: string;
}

/**
 * The single serializer of a plan's retirement state for assess output (CLI row and MCP payload alike).
 *
 * @param state - from `RetiredAcService.settle`; `undefined` (service not wired) and `none` report nothing
 */
export function retirementAssessFields(state: PlanRetirementState | undefined): RetirementAssessFields {
  if (state === undefined || state.state === "none") return {};
  const retired = state.state === "rejected" ? state.restored : state.retired;
  if (retired.length === 0) return {};
  const count = String(retired.length);
  const summary =
    state.state === "pending"
      ? `${count} retired AC(s) await the owner (decision #${String(state.pendingId)}, lore pending --ask)`
      : state.state === "rejected"
        ? `${count} retired AC(s) rejected by the owner and restored`
        : `${count} retired AC(s) confirmed by the owner`;
  return { retired_acs: retired, ...(state.state === "pending" ? { pending_decision: state.pendingId } : {}), summary };
}
