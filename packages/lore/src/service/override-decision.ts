/**
 * Override decision port — the ONE seam through which a self-grantable override asks decide() before it applies.
 *
 * Purpose: `approve --override-judgment/--override-no-judgment`,
 *   `ac exempt` and `verify --yes` (a command with no attested row on the task) were granted to whoever typed them.
 *   Each now asks DecisionService.decide() for its registered class and proceeds only on an effective `auto`;
 *   anything else is refused with exit 4 (VALIDATION_ERROR), writes nothing else, and names the pending decision
 *   and the `lore decide <id>` line a human answers it with (never a nonce). EXCEPT the two milestone classes
 *   (override-judgment, ac-exempt; BR-1370): the override APPLIES at once, a `milestone` decision
 *   is recorded for the milestone review to resolve, and NO pending human decision is opened.
 * Public surface: OverrideClassId, OverrideRequest, OverrideDecisionPort, createOverrideDecisionPort, requireOverrideAuto,
 *   OVERRIDE_MEASURED_FACTS.
 * Invariants:
 *   - INV-2: the facts are what lore itself measured (an override is reversible; the caller is the calling session;
 *     lore evaluated the precondition). No factor and NO confidence is caller-supplied; C is computed inside
 *     DecisionService from the class's recorded outcomes.
 *   - INV-5: this is the only permission rule for the three paths; a service holds the port and applies the verdict,
 *     it never re-derives one. A service whose override is REQUESTED while no port is wired refuses loudly
 *     ({@link requireOverrideAuto} -> VALIDATION_ERROR naming the missing port): there is no ungated fallback, so a
 *     composition root that forgets the port turns the override into an error, never into a grant. `app.ts` and the
 *     CLI composition wire the real one; a unit test that needs an override to apply passes an explicit test port.
 *   - The subject `(id, version)` is stable across a re-run of the same command (nothing was written), so the same
 *     pending decision is found again and a human-tty accept of it turns the re-run into `auto`.
 * Side-effect class: IO (appends one decision-log row per ask through DecisionService; never writes the guarded object).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-7;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D4, D7.
 */
import { err, ok, type AutonomyFacts, type LoreError, type Result } from "@lore/core";
import type { DecisionService, DecisionSubject } from "./decision-service.js";
import type { DecisionDetail } from "../store/decision-log.js";

/** The registered classes (core classes.ts) of the three self-grantable overrides. */
export type OverrideClassId = "override-judgment" | "ac-exempt" | "verify-new-command";

/** What an override path asks: the class, the stable subject it is about, and a one-line human summary. */
export interface OverrideRequest {
  readonly classId: OverrideClassId;
  readonly subject: DecisionSubject;
  /** Names the override in the refusal text, e.g. `approve spec-x --override-judgment <id>`. */
  readonly summary: string;
  /**
   * Class-specific facts of what is overridden, recorded as the decision detail's `change`: always the `document`
   * (slug), plus the refused judgment id (override-judgment), the exemption reason (ac-exempt) or the command
   * (verify-new-command). Absent = only the document slug (the subject id's part before `#`) is recorded.
   */
  readonly change?: Readonly<Record<string, unknown>>;
}

/** The plain-language account recorded with an override decision (HR-T2, AC-HR-1): the command asked, the document, what each answer does. */
export function buildOverrideDetail(request: OverrideRequest): DecisionDetail {
  const document = request.subject.id.split("#")[0] ?? request.subject.id;
  return {
    summary: `Allow an override on ${document}: ${request.summary}`,
    requested_by: "the session that ran this command (override request)",
    change: { document, override_class: request.classId, ...request.change },
    on_accept: "The override is granted once you re-run the same command; it then proceeds.",
    on_reject: "The override is refused; the command stays refused and writes nothing.",
  };
}

export interface OverrideDecisionPort {
  /**
   * Ask decide(); `ok` only when the effective verdict of the subject is `auto` or `milestone` (BR-1370).
   *
   * @returns err(VALIDATION_ERROR, field "autonomy") on escalate (message carries the pending id and the
   *   `lore decide <id>` line) or refuse; any store error from the decision log, unchanged.
   */
  /** @lore-site BR-1286 */
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

/**
 * The ONE call every override site makes: asks `port`, or refuses loudly when none is wired.
 *
 * @returns err(VALIDATION_ERROR, field "autonomy") when `port` is undefined (nothing was written), else the port's answer
 */
export async function requireOverrideAuto(port: OverrideDecisionPort | undefined, request: OverrideRequest): Promise<Result<void, LoreError>> {
  if (port === undefined) {
    return err({
      code: "VALIDATION_ERROR",
      field: "autonomy",
      message:
        `Override not granted: ${request.summary}. No OverrideDecisionPort is wired on this service, so the override cannot be decided ` +
        `(class ${request.classId}); it is refused rather than granted. The composition root must call setOverrideDecisionPort / pass the port.`,
      value: { class: request.classId, subject: request.subject, verdict: "no-port" },
    });
  }
  return port.requireAuto(request);
}

function refused(summary: string, message: string, value: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field: "autonomy", message: `Override not granted: ${summary}.\n${message}`, value, rule: "BR-1286" };
}

/** The port over a DecisionService (or any object with its `decide`/`listPending`). */
export function createOverrideDecisionPort(decisions: Pick<DecisionService, "decide" | "listPending">): OverrideDecisionPort {
  return {
    async requireAuto(request) {
      const decided = await decisions.decide(request.classId, request.subject, OVERRIDE_MEASURED_FACTS, buildOverrideDetail(request));
      if (!decided.ok) return decided;
      const { decision, effective } = decided.value;
      if (effective.verdict === "auto") return ok(undefined);
      const reasons = decision.reasons.join("; ");
      // BR-1370: the three override classes are decided by the milestone review, never by a pending human decision. The
      // override applies now; the `milestone` record just written (class, subject, summary, change) is what the review resolves.
      /** @lore-site BR-1370 */
      if (effective.verdict === "milestone") return ok(undefined);
      if (effective.verdict === "refuse") {
        /** @lore-site BR-1286 */
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
      /** @lore-site BR-1286 */
      return err(
        refused(
          request.summary,
          `Class ${request.classId} scored ${decision.score} against threshold ${decision.threshold ?? "n/a"} (${reasons}).\n` +
            `Pending decision ${open.id} created; nothing else was written. Ask the human in the session (lore pending --ask, then the interactive question tool); then re-run this same command.`,
          { class: request.classId, subject: request.subject, verdict: "escalate", pending_id: open.id },
        ),
      );
    },
  };
}
