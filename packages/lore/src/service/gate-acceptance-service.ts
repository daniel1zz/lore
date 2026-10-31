/**
 * GateAcceptanceService: `lore assess <plan> --accept-gate <dimension>`, the one way a failed or not-measured gate lets a
 * plan close (BR-1500, spec-the-milestone-review-measures-its-facts-per-landing-and "Overriding a gate").
 *
 * Purpose: record, on the plan, a decision (reason, an S..C premise, an alternative) that accepts one gate of its current
 *   review as a known defect, so the review batch's close rule no longer holds the plan open for that gate.
 * Public surface: {@link GateAcceptanceService}, {@link GateAcceptancePorts}, {@link GateAcceptance}.
 * Invariants:
 *   - Only `regression` and `security` can be accepted. `correctness_vs_acs` is refused naming `lore ac supersede`: a
 *     criterion that is not attested is retired or superseded, never accepted. A dimension that is not a gate is refused.
 *   - The decision is judged BEFORE anything is read or written and is REQUIRED (the same gate `lore set` applies to an
 *     agent's decision-carrying write): an incomplete one is a `decision` refusal (exit 4) naming each missing part, and
 *     nothing is written.
 *   - The gate must be failed or not-measured in the plan's CURRENT review; anything else has nothing to accept.
 *   - The acceptance is a human decision in the decision log (class `governance-loosen`, human-always; subject
 *     `<plan id>:<dimension>` at that failure's root-cause fingerprint). The call also files (or reuses, by root cause) the
 *     issue of the finding. It writes no `gate_accepted` and nothing else on the plan (#538: plan `extra` is not authority).
 *   - Who accepts (spec-an-agent-s-gate-acceptance-waits-for-a-human-decision, BR-1500): an AGENT run's call asks
 *     `DecisionService.decide`, refuses (exit 4) naming the pending decision, and takes effect only on a re-run after a
 *     human answered Accept. A human party's direct call (human / dashboard / api-key) answers that decision itself, at once.
 *     No decision service wired -> refused, never accepted.
 *   - {@link acceptedGatesOf} is the ONE predicate readers use, and it reads ONLY the decision log: a gate is accepted when the log holds an effective human accept (class governance-loosen, subject `<plan id>:<dimension>` at the fingerprint). Nothing stored on the plan counts.
 * Side-effect class: IO through the injected ports (decision log appends, issue filing); nothing is written on the plan.
 *
 * Reference: Kayenta critical metrics (a critical metric fails the canary regardless of score) with an explicit, recorded override.
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-7, BR-1500)
 */

import {
  GATE_DIMENSIONS,
  blockingGates,
  err,
  isGateDimension,
  ok,
  type DocRecord,
  type GateDimension,
  type LoreError,
  type MilestoneReview,
  type PlanBundle,
  type Result,
} from "@lore/core";
import type { DecisionDraft, DecisionGate } from "./decision-gate.js";
import type { DecisionService, DecisionSubject } from "./decision-service.js";
import { effectiveDecisionVerdict, type DecisionDetail } from "../store/decision-log.js";
import type { StoreInterface } from "../store/store-interface.js";
import { derivePendingDecisions } from "./pending-decisions.js";
import { issueHumanPartyProof } from "./human-channel.js";
import { OVERRIDE_MEASURED_FACTS } from "./override-decision.js";
import type { IssueFilingService } from "./issue-filing-service.js";
import { planStateFingerprint, selectLatestMilestoneReview } from "./milestone-review.js";
import { rootCauseOf, type FailedFinding } from "./root-cause-fingerprint.js";

/** What the service reads and writes through. */
export interface GateAcceptancePorts {
  readonly getPlanBundle: (planRef: string) => Promise<Result<PlanBundle, LoreError>>;
  /** The plan's knowledge docs of sub_type milestone-review. */
  readonly listReviewDocs: (planId: string) => Promise<Result<DocRecord[], LoreError>>;
  readonly gate: Pick<DecisionGate, "judgeChecked">;
  /** Files (or finds) the issue of the finding and records the plain known defect on the plan. */
  readonly filing: IssueFilingService | undefined;
  /** The writer's name source (`run | human | api-key | dashboard`); anything but a human party is treated as an agent. */
  readonly writerSource: string | null | undefined;
  /** Asks the human-always decision (and records a human party's own answer); absent = the call is refused, never accepted. */
  readonly decisions: Pick<DecisionService, "decide" | "resolvePending"> | undefined;
  /** Reads the decision log (pending id of a subject). */
  readonly log: GateAcceptanceLog;
}

/** The decision class an acceptance of a failed gate asks (human-always, BR-1370). */
export const GATE_ACCEPTANCE_CLASS = "governance-loosen";

/** The human party sources whose direct call is accepted at once. */
const HUMAN_PARTY_SOURCES = ["human", "dashboard", "api-key"] as const;
type HumanPartySource = (typeof HUMAN_PARTY_SOURCES)[number];

function humanPartyOf(source: string | null | undefined): HumanPartySource | undefined {
  return HUMAN_PARTY_SOURCES.find((candidate) => candidate === source);
}

/** The decision subject of accepting `dimension` of plan `planId` for the failure with root-cause `fingerprint`. */
export function gateAcceptanceSubject(planId: string, dimension: string, fingerprint: string): DecisionSubject {
  return { id: `${planId}:${dimension}`, version: fingerprint };
}

/** Reads of the decision log the acceptance predicate and the batch report need (pure reads, nothing appended). */
export interface GateAcceptanceLog {
  /** The record id of the effective HUMAN accept of `subject`, or `null` when there is none (none, machine-only, rejected). */
  humanAcceptedRecord(subject: DecisionSubject): Promise<Result<number | null, LoreError>>;
  /** The id of the open pending decision of `subject`, or `null`. */
  pendingId(subject: DecisionSubject): Promise<Result<number | null, LoreError>>;
}

/** The {@link GateAcceptanceLog} over the store's decision log. */
export function createGateAcceptanceLog(store: Pick<StoreInterface, "listDecisionLog">): GateAcceptanceLog {
  const keyOf = (subject: DecisionSubject) => ({ class: GATE_ACCEPTANCE_CLASS, subject_id: subject.id, subject_version: subject.version });
  return {
    async humanAcceptedRecord(subject) {
      const rows = await store.listDecisionLog(keyOf(subject));
      if (!rows.ok) return rows;
      const effective = effectiveDecisionVerdict(rows.value, keyOf(subject));
      return ok(effective !== null && effective.channel === "human-tty" && effective.verdict === "auto" ? effective.record_id : null);
    },
    async pendingId(subject) {
      const rows = await store.listDecisionLog();
      if (!rows.ok) return rows;
      const pending = derivePendingDecisions(rows.value);
      if (!pending.ok) return pending;
      const key = keyOf(subject);
      const open = pending.value.find((p) => p.class === key.class && p.subject_id === key.subject_id && p.subject_version === key.subject_version);
      return ok(open?.id ?? null);
    },
  };
}

/** What one acceptance recorded. */
export interface GateAcceptance {
  readonly plan: string;
  readonly dimension: GateDimension;
  /** The issue the accepted finding is filed under. */
  readonly issue: number;
  readonly review: string;
  /** The id of the human decision record in the decision log that accepts the gate. */
  readonly decision_record: number;
}

function refuse(field: string, message: string): LoreError {
  return { code: "VALIDATION_ERROR", field, message, rule: "BR-1500" };
}

/**
 * The blocking gates of a stored review that are accepted FOR THAT FAILURE: the decision log holds an effective human accept
 * of class governance-loosen for subject `<plan id>:<gate>` at the root-cause fingerprint of the review's current failure of
 * that gate (BR-1500). This is the single predicate every close path uses.
 *
 * reason: the log is the ONLY authority. Plan `extra` is writable by any caller (`lore set --extra`), so no stored field
 * (`gate_accepted`, a party, a record id) is read here: trusting one let an agent close its own plan (#538).
 * reason: the fingerprint is part of the subject, so an accept of one failure never waves a later, different failure of the
 * same gate through (AC-AF-7); a gate whose cause cannot be fingerprinted (no cite) is never accepted.
 *
 * @param plan - the plan (id and slug)
 * @param latest - the plan's latest stored review and its document
 * @param log - the decision log reader (required: with none wired the read fails loud, see {@link unwiredGateAcceptanceLog})
 * @returns the accepted gates, in render order; a store error from the log, unchanged
 */
export async function acceptedGatesOf(
  plan: Pick<DocRecord, "id" | "slug">,
  latest: { readonly doc: Pick<DocRecord, "slug">; readonly review: MilestoneReview },
  log: GateAcceptanceLog,
): Promise<Result<GateDimension[], LoreError>> {
  const gates: GateDimension[] = [];
  for (const dimension of blockingGates(latest.review.dimensions)) {
    const judgment = latest.review.dimensions[dimension];
    const cause = rootCauseOf({ plan: plan.slug, dimension, reason: judgment.reason, reference: judgment.reference, cites: judgment.cites, reviewSlug: latest.doc.slug, causes: latest.review.causes });
    if (!cause.ok) continue;
    const record = await log.humanAcceptedRecord(gateAcceptanceSubject(plan.id, dimension, cause.value.fingerprint));
    if (!record.ok) return record;
    if (record.value !== null) gates.push(dimension);
  }
  return ok(gates);
}

/**
 * A {@link GateAcceptanceLog} for a composition with no decision log: every read fails loud naming that cause, so a close
 * never silently reads "not accepted" (D3).
 */
export function unwiredGateAcceptanceLog(): GateAcceptanceLog {
  const unwired = <T>(): Promise<Result<T, LoreError>> =>
    Promise.resolve(err(refuse("decision-log", "no decision log is wired on this composition, so whether a gate was accepted cannot be read; the close is refused rather than treating the gate as not accepted")));
  return { humanAcceptedRecord: () => unwired<number | null>(), pendingId: () => unwired<number | null>() };
}

/**
 * The pending acceptance ids of the blocking gates of a review, for the batch report ("acceptance pending <id>").
 *
 * @returns `dimension -> pending decision id` for each gate whose acceptance waits for a human; empty when none
 */
export async function pendingAcceptancesOf(
  plan: Pick<DocRecord, "id" | "slug">,
  latest: { readonly doc: Pick<DocRecord, "slug">; readonly review: MilestoneReview },
  log: GateAcceptanceLog,
): Promise<Result<Map<GateDimension, number>, LoreError>> {
  const pending = new Map<GateDimension, number>();
  for (const dimension of blockingGates(latest.review.dimensions)) {
    const judgment = latest.review.dimensions[dimension];
    const cause = rootCauseOf({ plan: plan.slug, dimension, reason: judgment.reason, reference: judgment.reference, cites: judgment.cites, reviewSlug: latest.doc.slug, causes: latest.review.causes });
    if (!cause.ok) continue;
    const id = await log.pendingId(gateAcceptanceSubject(plan.id, dimension, cause.value.fingerprint));
    if (!id.ok) return id;
    if (id.value !== null) pending.set(dimension, id.value);
  }
  return ok(pending);
}

/** See the module header. */
export class GateAcceptanceService {
  constructor(private readonly ports: GateAcceptancePorts) {}

  /**
   * Accepts one gate of the plan's current review with a decision.
   *
   * @param planRef - plan id or slug
   * @param dimension - the gate to accept (as typed: validated here)
   * @param draft - the decision flags as parsed (`parseDecisionFlags`); absent = none given
   * @returns what was recorded; a `VALIDATION_ERROR` (exit 4) for a dimension that cannot be accepted, an incomplete
   *   decision, no current review, or a gate that is not blocking; any filing or write error as is
   */
  async acceptGate(planRef: string, dimension: string, draft: DecisionDraft | undefined): Promise<Result<GateAcceptance, LoreError>> {
    if (dimension === "correctness_vs_acs") {
      return err(
        refuse(
          "accept-gate",
          "correctness_vs_acs cannot be accepted: a criterion that is not attested is retired or superseded, never accepted. Use `lore ac supersede <spec> <ac> --by <spec>:<ac> --reason ...`. Nothing was written.",
        ),
      );
    }
    if (!isGateDimension(dimension)) {
      return err(refuse("accept-gate", `"${dimension}" is not a gate (gates: ${GATE_DIMENSIONS.join(", ")}); only a gate holds a plan open and can be accepted. Nothing was written.`));
    }
    const decided = await this.ports.gate.judgeChecked({ required: true, draft, kind: "document revision" });
    if (!decided.ok) return decided;
    const decision = decided.value;
    if (decision === undefined) return err(refuse("decision", "a decision is required to accept a gate. Nothing was written."));

    const bundle = await this.ports.getPlanBundle(planRef);
    if (!bundle.ok) return bundle;
    const { plan } = bundle.value;
    const docs = await this.ports.listReviewDocs(plan.id);
    if (!docs.ok) return docs;
    const latest = selectLatestMilestoneReview(docs.value);
    if (latest === undefined) {
      return err(refuse("accept-gate", `plan ${plan.slug} has no milestone review: run \`lore assess ${plan.slug}\` first. Nothing was written.`));
    }
    if (latest.review.fingerprint !== planStateFingerprint(plan, bundle.value.tasks, bundle.value.spec)) {
      return err(refuse("accept-gate", `the review of plan ${plan.slug} is not of its current state: run \`lore assess ${plan.slug}\` again, then accept the gate. Nothing was written.`));
    }
    const judgment = latest.review.dimensions[dimension];
    if (judgment.verdict !== "fail" && judgment.verdict !== "not-measured") {
      return err(refuse("accept-gate", `${dimension} of plan ${plan.slug} is ${judgment.verdict} in its current review: there is nothing to accept. Nothing was written.`));
    }

    const filing = this.ports.filing;
    if (filing === undefined) {
      return err(refuse("feedback.upstream", "accepting a gate records a known defect under an issue, but no issue tracker is configured (a GitHub feedback.upstream.repo in .lore/config.yaml). Nothing was written."));
    }
    const finding: FailedFinding = {
      plan: plan.slug,
      dimension,
      reason: judgment.reason,
      reference: judgment.reference,
      cites: judgment.cites,
      reviewSlug: latest.doc.slug,
      causes: latest.review.causes,
    };
    // reason: the acceptance IS the human accept in the decision log (class governance-loosen, subject `<plan id>:<dimension>` at
    // this failure's fingerprint); nothing stored on the plan carries that authority (#538, BR-1500). An agent's call waits for
    // a human to answer a pending decision; a human party's direct call appends its own human decision.
    const settled = await this.settleHumanAccept(plan, dimension, finding, latest.doc.slug, decision, humanPartyOf(this.ports.writerSource) !== undefined);
    if (!settled.ok) return settled;
    const filed = await filing.fileFindings([finding]);
    if (!filed.ok) return filed;
    const group = filed.value[0];
    if (group === undefined || group.error !== undefined || group.issue === undefined) {
      return err(group?.error ?? refuse("accept-gate", `the ${dimension} finding of ${plan.slug} could not be filed as an issue`));
    }
    return ok({ plan: plan.slug, dimension, issue: group.issue.number, review: latest.doc.slug, decision_record: settled.value });
  }

  /**
   * Makes sure the decision log holds an effective human accept of this gate and returns its record id.
   *
   * An agent's call asks the human-always decision and refuses (exit 4) naming the pending decision, the human's rejection,
   * or the missing decision service; it appends nothing human. A human party's direct call (`byHumanParty`) answers that
   * same pending decision itself through `DecisionService.resolvePending` (the one writer of the `human-tty` channel), so
   * its accept is a record in the same log. Writes nothing in the corpus either way.
   */
  private async settleHumanAccept(
    plan: Pick<DocRecord, "id" | "slug">,
    dimension: GateDimension,
    finding: FailedFinding,
    reviewSlug: string,
    decision: { readonly reason: string },
    byHumanParty: boolean,
  ): Promise<Result<number, LoreError>> {
    const decisions = this.ports.decisions;
    if (decisions === undefined) {
      return err(refuse("accept-gate", `accepting a gate needs a human decision, and no decision service is wired on this composition, so ${dimension} of ${plan.slug} was not accepted. Nothing was written.`));
    }
    const cause = rootCauseOf(finding);
    if (!cause.ok) {
      return err(refuse("accept-gate", `the ${dimension} failure of ${plan.slug} has no identifiable root cause (${cause.error.code}), so it cannot be accepted: it needs a new review. Nothing was written.`));
    }
    const subject = gateAcceptanceSubject(plan.id, dimension, cause.value.fingerprint);
    const detail: DecisionDetail = {
      summary: `Accept the failed ${dimension} gate of plan ${plan.slug} as a known defect (review ${reviewSlug})`,
      requested_by: "the agent session that ran `lore assess --accept-gate`",
      change: { document: plan.slug, gate: dimension, review: reviewSlug, reason: decision.reason, fingerprint: cause.value.fingerprint },
      on_accept: "Re-running the same `lore assess --accept-gate` command then reports the gate accepted, and the plan may close past it.",
      on_reject: "The gate stays unaccepted; the plan stays open until it is fixed and reviewed again.",
    };
    const decided = await decisions.decide(GATE_ACCEPTANCE_CLASS, subject, OVERRIDE_MEASURED_FACTS, detail);
    if (!decided.ok) return decided;
    const { effective } = decided.value;
    if (effective.channel === "human-tty" && effective.verdict === "auto") return ok(effective.record_id);
    if (effective.channel === "human-tty") {
      return err(refuse("accept-gate", `a human rejected accepting ${dimension} of ${plan.slug} (decision ${String(effective.record_id)}). Nothing was written.`));
    }
    const pending = await this.ports.log.pendingId(subject);
    if (!pending.ok) return pending;
    if (pending.value === null) {
      return err(refuse("accept-gate", `accepting ${dimension} of ${plan.slug} needs a human decision but no pending decision could be found (record ${String(decided.value.record_id)}). Nothing was written.`));
    }
    if (byHumanParty) {
      const answered = await decisions.resolvePending(pending.value, "accept", decision.reason, issueHumanPartyProof(new Date().toISOString()));
      if (!answered.ok) return answered;
      return ok(answered.value.id);
    }
    return err(
      refuse(
        "accept-gate",
        `An agent run cannot accept a gate: pending decision ${String(pending.value)} was created for a human to accept ${dimension} of ${plan.slug}. Ask the human in the session (\`lore pending --ask\`, then the interactive question tool), then re-run this same command. Nothing was written.`,
      ),
    );
  }
}
