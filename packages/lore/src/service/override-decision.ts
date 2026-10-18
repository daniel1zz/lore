/**
 * Override decision port — the ONE seam through which a self-grantable override asks decide() before it applies.
 *
 * Purpose: `approve --override-judgment/--override-no-judgment`, `done --override-attestation(-cite)`,
 *   `ac exempt` and `verify --yes` (a command with no attested row on the task) were granted to whoever typed them.
 *   Each now asks DecisionService.decide() for its registered class and proceeds only on an effective `auto`;
 *   anything else is refused with exit 4 (VALIDATION_ERROR), writes nothing else, and names the pending decision
 *   and the `lore decide <id>` line a human answers it with (never a nonce).
 * Public surface: OverrideClassId, OverrideRequest, OverrideDecisionPort, createOverrideDecisionPort, OVERRIDE_MEASURED_FACTS.
 * Invariants:
 *   - INV-2: the facts are what lore itself measured (an override is reversible; the caller is the calling session;
 *     lore evaluated the precondition). No factor and NO confidence is caller-supplied; C is computed inside
 *     DecisionService from the class's recorded outcomes.
 *   - INV-5: this is the only permission rule for the four paths; a service holds the port and applies the verdict,
 *     it never re-derives one. An absent port (bare unit constructions) means the path is ungated, exactly like the
 *     other optional DI ports of these services; `app.ts` and the CLI composition wire the real one.
 *   - The subject `(id, version)` is stable across a re-run of the same command (nothing was written), so the same
 *     pending decision is found again and a human-tty accept of it turns the re-run into `auto`.
 * Side-effect class: IO (appends one decision-log row per ask through DecisionService; never writes the guarded object).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-7;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D4, D7.
 */
import { err, ok, type AutonomyFacts, type LoreError, type Result } from "@lore/core";
import type { DecisionService, DecisionSubject } from "./decision-service.js";

/** The registered classes (core classes.ts) of the four self-grantable overrides. */
export type OverrideClassId = "override-judgment" | "override-attestation" | "ac-exempt" | "verify-new-command";

/** What an override path asks: the class, the stable subject it is about, and a one-line human summary. */
export interface OverrideRequest {
  readonly classId: OverrideClassId;
  readonly subject: DecisionSubject;
  /** Names the override in the refusal text, e.g. `approve spec-x --override-judgment <id>`. */
  readonly summary: string;
}

export interface OverrideDecisionPort {
  /**
   * Ask decide(); `ok` only when the effective verdict of the subject is `auto`.
   *
   * @returns err(VALIDATION_ERROR, field "autonomy") on escalate (message carries the pending id and the
   *   `lore decide <id>` line) or refuse; any store error from the decision log, unchanged.
   */
  requireAuto(request: OverrideRequest): Promise<Result<void, LoreError>>;
}

/**
 * Facts lore measures for an override: the guarded write is reversible (the object can be reopened, the exemption
 * expires, the evidence row can be superseded), the actor is the calling session, and the precondition that makes the
 * override necessary was evaluated by lore itself. The class threshold and the calibrated C do the rest.
 */
export const OVERRIDE_MEASURED_FACTS: AutonomyFacts = {
  recoverability: "reversible",
  blast: "calling-session",
  evidence: "lore-evaluated",
};

function refused(summary: string, message: string, value: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field: "autonomy", message: `Override not granted: ${summary}.\n${message}`, value };
}

/** The port over a DecisionService (or any object with its `decide`/`listPending`). */
export function createOverrideDecisionPort(decisions: Pick<DecisionService, "decide" | "listPending">): OverrideDecisionPort {
  return {
    async requireAuto(request) {
      const decided = await decisions.decide(request.classId, request.subject, OVERRIDE_MEASURED_FACTS);
      if (!decided.ok) return decided;
      const { decision, effective } = decided.value;
      if (effective.verdict === "auto") return ok(undefined);
      const reasons = decision.reasons.join("; ");
      if (effective.verdict === "refuse") {
        return err(
          refused(
            request.summary,
            `Class ${request.classId} is refused for this subject (${effective.channel === "human-tty" ? "the human rejected it" : reasons}). Nothing was written.`,
            { class: request.classId, subject: request.subject, verdict: "refuse", record_id: effective.record_id },
          ),
        );
      }
      const pending = await decisions.listPending();
      if (!pending.ok) return pending;
      const open = pending.value.find(
        (p) => p.class === request.classId && p.subject_id === request.subject.id && p.subject_version === request.subject.version,
      );
      if (open === undefined) {
        return err({ code: "STORE_ERROR", message: `override ${request.classId} escalated (record ${decided.value.record_id}) but has no pending decision` });
      }
      return err(
        refused(
          request.summary,
          `Class ${request.classId} scored ${decision.score} against threshold ${decision.threshold ?? "n/a"} (${reasons}).\n` +
            `Pending decision ${open.id} created; nothing else was written. A human answers it with: lore decide ${open.id} --accept (or --reject); then re-run this same command.`,
          { class: request.classId, subject: request.subject, verdict: "escalate", pending_id: open.id },
        ),
      );
    },
  };
}
