/**
 * DecisionService — the ONE adapter-facing path that runs decide() and records it.
 *
 * Purpose: every autonomy decision made through the service layer is appended to the hash-chained decision log,
 * and the EFFECTIVE verdict of a (class, subject, version) is answered from that log, never from a re-score.
 * Public surface: DecisionService.{decide, effectiveVerdict, verifyChain, chainHead, listPending, getPending,
 *   resolvePending, governed}, DecisionSubject, DecideOutcome.
 * Invariants:
 *   - INV-2 (plan): no public method accepts caller-provided factor values. `decide` takes MEASURED FACTS
 *     (autonomyFactsSchema) and the factor values are computed by @lore/core's decide(); a new method that
 *     takes `factors`/`score`/`verdict` from a caller is a defect.
 *   - Every `decide` call appends exactly one row (machine channel), including a `refuse` verdict from an
 *     invariant violation; a store failure is returned, never swallowed, and the verdict is NOT handed out.
 *   - The effective verdict rules live in store/decision-log.ts::effectiveDecisionVerdict (latest human-tty,
 *     else worst machine); this service only fetches the subject's rows and applies them.
 *   - A new `subject.version` is a new subject: re-scoring the same version with better facts cannot improve it.
 *   - `resolvePending` is the ONLY writer of channel `human-tty` and requires a HumanChannelProof (AC-AU-3); a
 *     method that appends a human-tty row without one is a defect (the former ungated test seam is deleted).
 *   - AC-AU-9: decide() scores against the GOVERNED record (AutonomyThresholdService), not the code table. When the
 *     record fails its integrity check, EVERY class escalates (reason `threshold-integrity`) and one pending
 *     `threshold-integrity` decision is opened; only a human-tty accept of that decision restores scoring.
 *     A `registry` override (tests) bypasses the governed record entirely — production never passes one.
 * Side-effect class: IO (decision_log appends through the injected store; clock via the injected `now`).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-2, AC-AU-3;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D5.
 */
import { decide, err, ok, type AutonomyDecision, type LoreError, type Result, type OperationClassRegistry } from "@lore/core";
import {
  AutonomyThresholdService,
  THRESHOLD_INTEGRITY_CLASS,
  THRESHOLD_RECORD_MISSING_VERSION,
  THRESHOLD_SUBJECT_ID,
  canonicalJson,
  type GovernedAutonomy,
} from "./autonomy-threshold-service.js";
import {
  decisionChainHead,
  effectiveDecisionVerdict,
  verifyDecisionChain,
  type DecisionChainHead,
  type DecisionChainVerifyResult,
  type DecisionLogRow,
  type DecisionRecordInput,
  type EffectiveDecisionVerdict,
} from "../store/decision-log.js";
import type { StoreInterface } from "../store/store-interface.js";
import { isIssuedHumanChannelProof, type HumanChannelProof } from "./human-channel.js";
import { derivePendingDecisions, type PendingDecision } from "./pending-decisions.js";

/** What a decision is about: a stable id plus the version (or sha) it was measured at. */
export interface DecisionSubject {
  readonly id: string;
  readonly version: string;
}

export interface DecideOutcome {
  /** The raw machine decision for THIS call's facts (may be better than the effective verdict). */
  readonly decision: AutonomyDecision;
  /** The appended record's id. */
  readonly record_id: number;
  /** What actually binds this subject version after this call. */
  readonly effective: EffectiveDecisionVerdict;
}

export interface DecisionServiceDeps {
  readonly store: StoreInterface;
  /** Attested run id of the executing harness run, or null when the process has none. */
  readonly executorRun: string | null;
  /** Injected clock (ISO 8601). */
  readonly now?: () => string;
  /** Class registry override for tests; defaults to @lore/core's. */
  readonly registry?: OperationClassRegistry;
}

function validationError(field: string, message: string): LoreError {
  return { code: "VALIDATION_ERROR", field, message };
}

export class DecisionService {
  constructor(private readonly deps: DecisionServiceDeps) {}

  private now(): string {
    return (this.deps.now ?? (() => new Date().toISOString()))();
  }

  /**
   * Run decide() over measured `facts`, append the machine-channel record, and return the decision together
   * with the effective verdict of `(classId, subject.id, subject.version)`.
   *
   * @returns err(VALIDATION_ERROR) when `subject.version` is empty or `facts` is not JSON-serialisable (nothing
   *   recorded); err(STORE_ERROR) when the append fails.
   */
  async decide(classId: string, subject: DecisionSubject, facts: unknown): Promise<Result<DecideOutcome, LoreError>> {
    if (subject.version === "") return err(validationError("subject.version", "a decision subject needs a version or sha"));
    let factsJson: string;
    try {
      factsJson = canonicalJson(facts === undefined ? {} : facts);
    } catch (cause) {
      return err(validationError("facts", `facts are not JSON-serialisable: ${String(cause)}`));
    }
    const governed = this.deps.registry === undefined ? await this.governed() : null;
    if (governed !== null && !governed.ok) return governed;
    const integrity = governed === null ? null : governed.value.integrity;
    let decision = decide(classId, subject.id, facts, this.deps.registry ?? governed?.value.registry);
    if (integrity !== null && integrity.state === "broken") {
      // reason: a mismatched record means NO threshold can be trusted -> every factor is unmeasured -> escalate
      // (AC-AU-9). A refuse (invariant violation) stays a refuse: it never runs anything either.
      if (decision.verdict !== "refuse") {
        decision = {
          ...decision,
          verdict: "escalate",
          score: 0,
          reasons: [`threshold-integrity: ${integrity.reason} — ${integrity.detail}; every class escalates until the human accepts the threshold-integrity decision (lore pending)`, ...decision.reasons],
        };
      }
      const opened = await this.openIntegrityDecision(integrity);
      if (!opened.ok) return opened;
    }
    const appended = await this.deps.store.appendDecisionRecord({
      ts: this.now(),
      class: classId,
      subject_id: subject.id,
      subject_version: subject.version,
      facts: factsJson,
      factors: canonicalJson(decision.factors),
      score: decision.score,
      threshold: decision.threshold,
      verdict: decision.verdict,
      reasons: canonicalJson(decision.reasons),
      executor_run: this.deps.executorRun,
      channel: "machine",
    });
    if (!appended.ok) return appended;
    const effective = await this.effectiveVerdict(classId, subject);
    if (!effective.ok) return effective;
    if (effective.value === null) {
      return err({ code: "STORE_ERROR", message: `decision_log has no effective verdict right after appending record ${appended.value.id}` });
    }
    return ok({ decision, record_id: appended.value.id, effective: effective.value });
  }

  /**
   * The live governed autonomy values (class table, regenerable patterns) and the record's integrity verdict.
   * Every service-layer reader of a threshold, prior or pattern goes through here — never through the code seed.
   */
  async governed(): Promise<Result<GovernedAutonomy, LoreError>> {
    return this.thresholds().load();
  }

  /** The record service over this service's store/clock/run — the `lore autonomy` verbs use it directly. */
  thresholds(): AutonomyThresholdService {
    return new AutonomyThresholdService({ store: this.deps.store, executorRun: this.deps.executorRun, now: () => this.now() });
  }

  /** Opens (once per content hash) the pending `threshold-integrity` decision a human answers with `lore decide`. */
  private async openIntegrityDecision(integrity: Extract<GovernedAutonomy["integrity"], { state: "broken" }>): Promise<Result<void, LoreError>> {
    const subject = { id: THRESHOLD_SUBJECT_ID, version: integrity.content_hash ?? THRESHOLD_RECORD_MISSING_VERSION };
    const existing = await this.effectiveVerdict(THRESHOLD_INTEGRITY_CLASS, subject);
    if (!existing.ok) return existing;
    if (existing.value !== null) return ok(undefined);
    const appended = await this.deps.store.appendDecisionRecord({
      ts: this.now(),
      class: THRESHOLD_INTEGRITY_CLASS,
      subject_id: subject.id,
      subject_version: subject.version,
      facts: canonicalJson({ reason: integrity.reason, detail: integrity.detail }),
      factors: "{}",
      score: 0,
      threshold: null,
      verdict: "escalate",
      reasons: canonicalJson([`threshold-integrity: ${integrity.reason}`, integrity.detail]),
      executor_run: this.deps.executorRun,
      channel: "machine",
    });
    return appended.ok ? ok(undefined) : appended;
  }

  /** Effective verdict for one subject version, or null when it has no decision yet. */
  async effectiveVerdict(classId: string, subject: DecisionSubject): Promise<Result<EffectiveDecisionVerdict | null, LoreError>> {
    const key = { class: classId, subject_id: subject.id, subject_version: subject.version };
    const rows = await this.deps.store.listDecisionLog(key);
    if (!rows.ok) return rows;
    return ok(effectiveDecisionVerdict(rows.value, key));
  }

  /** Whole-chain verification (id ASC). Never filtered: a filtered walk cannot see a deleted row. */
  async verifyChain(): Promise<Result<DecisionChainVerifyResult, LoreError>> {
    const rows = await this.deps.store.listDecisionLog();
    if (!rows.ok) return rows;
    return ok(verifyDecisionChain(rows.value));
  }

  /** The whole log in id ASC order WITH chain hashes — what `reproducesHead` checks pushed heads against. */
  async chainRows(): Promise<Result<DecisionLogRow[], LoreError>> {
    return this.deps.store.listDecisionLog();
  }

  /** Current chain head (id, hash, row count), or null for an empty log. AU-T9 records it in mirror exports. */
  async chainHead(): Promise<Result<DecisionChainHead | null, LoreError>> {
    const rows = await this.deps.store.listDecisionLog();
    if (!rows.ok) return rows;
    return ok(decisionChainHead(rows.value));
  }

  /** Open escalations (effective verdict: machine escalate), ordered by id. See pending-decisions.ts. */
  async listPending(): Promise<Result<PendingDecision[], LoreError>> {
    const rows = await this.deps.store.listDecisionLog();
    if (!rows.ok) return rows;
    return derivePendingDecisions(rows.value);
  }

  /** One open escalation by the id `lore decide` takes, or null when that id is not (or no longer) pending. */
  async getPending(pendingId: number): Promise<Result<PendingDecision | null, LoreError>> {
    const pending = await this.listPending();
    if (!pending.ok) return pending;
    return ok(pending.value.find((p) => p.id === pendingId) ?? null);
  }

  /**
   * THE human channel's only writer: answers pending decision `pendingId` with a `human-tty` record
   * (accept -> verdict `auto`, reject -> `refuse`). Demands a `HumanChannelProof`, which only
   * `confirmHumanNonce` mints after the TTY, agent-ancestry and nonce checks; a forged literal is refused.
   * The record carries the human's answer, the ancestry snapshot the proof captured and the chain head as it
   * stood BEFORE this append. It takes no factor values.
   *
   * @returns err(VALIDATION_ERROR) for a forged proof, or when `pendingId` is not pending (already answered,
   *   never existed, or answered concurrently); nothing is written in either case.
   */
  async resolvePending(
    pendingId: number,
    answer: "accept" | "reject",
    reason: string | undefined,
    proof: HumanChannelProof,
  ): Promise<Result<DecisionLogRow, LoreError>> {
    if (!isIssuedHumanChannelProof(proof)) {
      return err(validationError("proof", "a human-tty record needs a proof minted by the human channel (TTY, agent-ancestry and nonce checks)"));
    }
    const rows = await this.deps.store.listDecisionLog();
    if (!rows.ok) return rows;
    const pending = derivePendingDecisions(rows.value);
    if (!pending.ok) return pending;
    const target = pending.value.find((p) => p.id === pendingId);
    if (target === undefined) return err(validationError("id", `decision ${pendingId} is not pending`));
    const verdict = answer === "accept" ? "auto" : "refuse";
    const head = decisionChainHead(rows.value);
    const input: DecisionRecordInput = {
      ts: this.now(),
      class: target.class,
      subject_id: target.subject_id,
      subject_version: target.subject_version,
      facts: canonicalJson({
        human: {
          pending_id: target.id,
          answer,
          reason: reason ?? null,
          ancestry: proof.ancestry,
          verified_at: proof.verified_at,
          chain_head: head === null ? null : { head_id: head.head_id, head_hash: head.head_hash, count: head.count },
        },
      }),
      factors: "{}",
      score: verdict === "auto" ? 1 : 0,
      threshold: null,
      verdict,
      reasons: canonicalJson([`human-tty ${answer}`, ...(reason === undefined ? [] : [reason])]),
      executor_run: null,
      channel: "human-tty",
    };
    return this.deps.store.appendDecisionRecord(input);
  }
}
