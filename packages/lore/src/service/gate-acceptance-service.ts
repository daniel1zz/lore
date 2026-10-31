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
 *   - The acceptance is the plan's own `extra.known_defects` entry of that gate AND that failure's root-cause fingerprint, flagged `gate_accepted`, naming the open
 *     issue the finding was filed under (filed or reused by root cause, like every finding), written in ONE versioned write
 *     that carries the decision on its version row.
 *   - Who accepts (spec-an-agent-s-gate-acceptance-waits-for-a-human-decision, BR-1500): an AGENT run's call writes nothing. After the
 *     decision record passes it asks `DecisionService.decide` (class `governance-loosen`, human-always; subject
 *     `<plan id>:<dimension>` at the root-cause fingerprint), refuses (exit 4) naming the pending decision, and takes effect
 *     only on a re-run after a human accepted it. A human party's direct call (human / dashboard / api-key) writes at once.
 *     No decision service wired -> refused, never accepted.
 *   - {@link acceptedGatesOf} is the ONE predicate readers use: an acceptance counts only when it carries a human writer party
 *     or a decision record id that the decision log confirms as an effective human accept for that plan, gate and fingerprint.
 * Side-effect class: IO through the injected ports (decision log, issue filing, one document write).
 *
 * Reference: Kayenta critical metrics (a critical metric fails the canary regardless of score) with an explicit, recorded override.
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-7, BR-1500)
 */

import {
  GATE_DIMENSIONS,
  blockingGates,
  KNOWN_DEFECTS_FIELD,
  err,
  isGateDimension,
  ok,
  readKnownDefects,
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
import { OVERRIDE_MEASURED_FACTS } from "./override-decision.js";
import type { DocWritePort } from "./corpus-service.js";
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
  readonly writer: Pick<DocWritePort, "writeDoc">;
  /** The writing actor. */
  readonly by: string;
  /** The writer's name source (`run | human | api-key | dashboard`); anything but a human party is treated as an agent. */
  readonly writerSource: string | null | undefined;
  /** Asks the human-always decision; absent = an agent's acceptance is refused (never accepted). */
  readonly decisions: Pick<DecisionService, "decide"> | undefined;
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
}

function refuse(field: string, message: string): LoreError {
  return { code: "VALIDATION_ERROR", field, message, rule: "BR-1500" };
}

/**
 * The blocking gates of a stored review that the plan accepted FOR THAT FAILURE with a HUMAN behind it: a `gate_accepted`
 * known defect of the gate whose root-cause fingerprint equals the fingerprint of the review's current failure of that gate
 * (BR-1500), carrying either a human writer party or a decision record id the decision log confirms as an effective human
 * accept for this plan, gate and fingerprint. This is the single predicate every close path uses.
 *
 * reason: matching by dimension alone let an acceptance of one failure wave a later, different failure of the same gate
 * through (AC-AF-7); a gate whose cause cannot be fingerprinted (no cite) is never accepted, the plan needs a new review.
 * reason: `gate_accepted` alone is what agent runs wrote before an agent's acceptance needed a human (#538); it never counts.
 *
 * @param plan - the plan (id, slug and `extra.known_defects`)
 * @param latest - the plan's latest stored review and its document
 * @param log - the decision log reader; absent = only a human writer party can back an acceptance
 * @returns the accepted gates, in render order; a store error from the log, unchanged
 */
export async function acceptedGatesOf(
  plan: Pick<DocRecord, "id" | "slug" | "extra">,
  latest: { readonly doc: Pick<DocRecord, "slug">; readonly review: MilestoneReview },
  log: GateAcceptanceLog | undefined,
): Promise<Result<GateDimension[], LoreError>> {
  const accepted = readKnownDefects(plan.extra).filter((entry) => entry.gate_accepted === true);
  if (accepted.length === 0) return ok([]);
  const gates: GateDimension[] = [];
  for (const dimension of blockingGates(latest.review.dimensions)) {
    const judgment = latest.review.dimensions[dimension];
    const cause = rootCauseOf({ plan: plan.slug, dimension, reason: judgment.reason, reference: judgment.reference, cites: judgment.cites, reviewSlug: latest.doc.slug, causes: latest.review.causes });
    if (!cause.ok) continue;
    const entry = accepted.find((e) => e.dimension === dimension && e.fingerprint === cause.value.fingerprint);
    if (entry === undefined) continue;
    if (entry.accepted_source !== undefined) {
      gates.push(dimension);
      continue;
    }
    if (entry.accepted_decision === undefined || log === undefined) continue;
    const record = await log.humanAcceptedRecord(gateAcceptanceSubject(plan.id, dimension, cause.value.fingerprint));
    if (!record.ok) return record;
    if (record.value === entry.accepted_decision) gates.push(dimension);
  }
  return ok(gates);
}

/**
 * The pending acceptance ids of the blocking gates of a review, for the batch report ("acceptance pending <id>").
 *
 * @returns `dimension -> pending decision id` for each gate whose acceptance waits for a human; empty when none
 */
export async function pendingAcceptancesOf(
  plan: Pick<DocRecord, "id" | "slug">,
  latest: { readonly doc: Pick<DocRecord, "slug">; readonly review: MilestoneReview },
  log: GateAcceptanceLog | undefined,
): Promise<Result<Map<GateDimension, number>, LoreError>> {
  const pending = new Map<GateDimension, number>();
  if (log === undefined) return ok(pending);
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
    const party = humanPartyOf(this.ports.writerSource);
    let humanRecord: number | undefined;
    if (party === undefined) {
      const waited = await this.awaitHumanAccept(plan, dimension, finding, latest.doc.slug, decision);
      if (!waited.ok) return waited;
      humanRecord = waited.value;
    }
    const filed = await filing.fileFindings([finding]);
    if (!filed.ok) return filed;
    const group = filed.value[0];
    if (group === undefined || group.error !== undefined || group.issue === undefined) {
      return err(group?.error ?? refuse("accept-gate", `the ${dimension} finding of ${plan.slug} could not be filed as an issue`));
    }

    // reason: re-read AFTER the filing wrote the plain known-defect entry (its write bumped the plan's version), so the
    // flagging write below carries the current version as its CAS guard.
    const fresh = await this.ports.getPlanBundle(planRef);
    if (!fresh.ok) return fresh;
    const current = fresh.value.plan;
    const entries = readKnownDefects(current.extra);
    // reason: bound to THIS failure's root-cause fingerprint, never to the dimension: an older entry of the same gate
    // with another fingerprint is a different failure and stays unflagged.
    const fingerprint = group.cause.fingerprint;
    if (!entries.some((e) => e.dimension === dimension && e.fingerprint === fingerprint)) {
      return err(refuse("accept-gate", `the issue of the ${dimension} finding was filed but no known defect of ${dimension} with its root cause is recorded on ${plan.slug}; nothing was accepted`));
    }
    const flagged = entries.map((e) => (e.dimension === dimension && e.fingerprint === fingerprint ? { ...e, gate_accepted: true as const, ...(party !== undefined ? { accepted_source: party } : {}), ...(humanRecord !== undefined ? { accepted_decision: humanRecord } : {}) } : e));
    const written = await this.ports.writer.writeDoc({
      doc: current,
      patch: { extra: { ...(current.extra as Record<string, unknown>), [KNOWN_DEFECTS_FIELD]: flagged } },
      action: "update",
      changeSummary: `Accepted gate ${dimension} with a decision (issue #${String(group.issue.number)})`,
      decision,
      auditAction: "update",
      auditDetails: { operation: "accept-gate", dimension, fingerprint, ...(humanRecord !== undefined ? { decision_record: humanRecord } : {}), issue: group.issue.number, review: latest.doc.slug, rule: "BR-1500" },
      lock: "none",
      by: this.ports.by,
    });
    if (!written.ok) return written;
    return ok({ plan: plan.slug, dimension, issue: group.issue.number, review: latest.doc.slug });
  }

  /**
   * An agent's acceptance: asks the human-always decision and returns the record id of the human accept, or refuses (exit 4)
   * naming the pending decision, the human's rejection, or the missing decision service. Writes nothing in the corpus.
   */
  private async awaitHumanAccept(
    plan: Pick<DocRecord, "id" | "slug">,
    dimension: GateDimension,
    finding: FailedFinding,
    reviewSlug: string,
    decision: { readonly reason: string },
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
      on_accept: "Re-running the same `lore assess --accept-gate` command records the known defect, and the plan may then close past this gate.",
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
    return err(
      refuse(
        "accept-gate",
        `An agent run cannot accept a gate: pending decision ${String(pending.value)} was created for a human to accept ${dimension} of ${plan.slug}. Ask the human in the session (\`lore pending --ask\`, then the interactive question tool), then re-run this same command. Nothing was written.`,
      ),
    );
  }
}
