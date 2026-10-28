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
 *   - The acceptance is the plan's own `extra.known_defects` entry of that gate, flagged `gate_accepted`, naming the open
 *     issue the finding was filed under (filed or reused by root cause, like every finding), written in ONE versioned write
 *     that carries the decision on its version row.
 * Side-effect class: IO through the injected ports (issue filing, one document write).
 *
 * Reference: Kayenta critical metrics (a critical metric fails the canary regardless of score) with an explicit, recorded override.
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-7, BR-1500)
 */

import {
  GATE_DIMENSIONS,
  KNOWN_DEFECTS_FIELD,
  err,
  isGateDimension,
  ok,
  readKnownDefects,
  type DocRecord,
  type GateDimension,
  type LoreError,
  type PlanBundle,
  type Result,
} from "@lore/core";
import type { DecisionDraft, DecisionGate } from "./decision-gate.js";
import type { DocWritePort } from "./corpus-service.js";
import type { IssueFilingService } from "./issue-filing-service.js";
import { planStateFingerprint, selectLatestMilestoneReview } from "./milestone-review.js";
import type { FailedFinding } from "./root-cause-fingerprint.js";

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
    if (!entries.some((e) => e.dimension === dimension)) {
      return err(refuse("accept-gate", `the issue of the ${dimension} finding was filed but no known defect of ${dimension} is recorded on ${plan.slug}; nothing was accepted`));
    }
    const flagged = entries.map((e) => (e.dimension === dimension ? { ...e, gate_accepted: true as const } : e));
    const written = await this.ports.writer.writeDoc({
      doc: current,
      patch: { extra: { ...(current.extra as Record<string, unknown>), [KNOWN_DEFECTS_FIELD]: flagged } },
      action: "update",
      changeSummary: `Accepted gate ${dimension} with a decision (issue #${String(group.issue.number)})`,
      decision,
      auditAction: "update",
      auditDetails: { operation: "accept-gate", dimension, issue: group.issue.number, review: latest.doc.slug, rule: "BR-1500" },
      lock: "none",
      by: this.ports.by,
    });
    if (!written.ok) return written;
    return ok({ plan: plan.slug, dimension, issue: group.issue.number, review: latest.doc.slug });
  }
}
