/**
 * DecisionService — the ONE adapter-facing path that runs decide() and records it.
 *
 * Purpose: every autonomy decision made through the service layer is appended to the hash-chained decision log,
 * and the EFFECTIVE verdict of a (class, subject, version) is answered from that log, never from a re-score.
 * Public surface: DecisionService.{decide, effectiveVerdict, verifyChain, chainHead, listPending, readPending, readDecisionViews, readAuditItemViews, readDecisionView (pure reads), getPending,
 *   resolvePending, governed, preview, calibration, listAudit, getAudit, resolveAudit, calibrationStats}, DecisionSubject,
 *   DecideOutcome.
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
 *   - AC-AU-8: C is COMPUTED here from the class's recorded outcomes (Wilson bound over the last 50 observed
 *     outcomes + 50 pseudo-outcomes at the governed prior) and written into the recorded facts. A caller that passes
 *     `facts.confidence` is refused (VALIDATION_ERROR): there is no caller-supplied C anywhere.
 *   - AC-AU-10: `listAudit` / `resolveAudit` expose the sampling floor's queue; `resolveAudit` is the only writer
 *     of human-tty audit outcomes and demands a HumanChannelProof.
 * Side-effect class: IO (decision_log appends through the injected store; clock via the injected `now`).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-2, AC-AU-3;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D5.
 */
import { decide, err, ok, type AutonomyDecision, type LoreError, type Result, type OperationClassRegistry } from "@lore/core";
import {
  AutonomyCalibrationService,
  classConfidence,
  deriveAuditQueue,
  type AuditItem,
  type ClassCalibrationStats,
  type ReversalProbe,
} from "./autonomy-calibration-service.js";
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
  decisionDetailSchema,
  effectiveDecisionVerdict,
  renderDecisionDetailSummary,
  verifyDecisionChain,
  type DecisionChainHead,
  type DecisionChainVerifyResult,
  type DecisionDetail,
  type DecisionLogRow,
  type DecisionRecordInput,
  type EffectiveDecisionVerdict,
} from "../store/decision-log.js";
import type { StoreInterface } from "../store/store-interface.js";
import { isIssuedHumanChannelProof, type HumanChannelProof } from "./human-channel.js";
import {
  deriveOpenEscalations,
  derivePendingDecisions,
  HUMAN_ANSWER_ONLY_CLASSES,
  newerVersionSupersession,
  parseRowFactors,
  parseRowReasons,
  SUPERSEDED_FACTS_KEY,
  type OpenEscalation,
  type PendingDecision,
  type RecommendedAnswer,
  type SubjectExistenceProbes,
  type SupersedeCause,
} from "./pending-decisions.js";

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
  /** Class-specific subject existence probes used when listing pending decisions (AU-T16). Absent = newer-version rule only. */
  readonly subjectProbes?: SubjectExistenceProbes;
  /** Reversal probes: when present, every decide() first sweeps new outcomes of earlier auto decisions. */
  readonly reversalProbes?: readonly ReversalProbe[];
}

function validationError(field: string, message: string): LoreError {
  return { code: "VALIDATION_ERROR", field, message };
}

/** Which queue a {@link DecisionReadView} belongs to: a blocking open decision, or a non-blocking audit item. */
export type DecisionReadKind = "decision" | "audit";

/**
 * What the dashboard shows for one open decision or audit item. `summary` is the shared renderer's line (the stored
 * summary or the exact "no detail recorded" label); `detail` is the parsed detail or null. `recommendation` is null
 * for an audit item: nothing was escalated, so nothing recommends an answer.
 */
export interface DecisionReadView {
  readonly kind: DecisionReadKind;
  readonly id: number;
  readonly class: string;
  readonly subject_id: string;
  readonly subject_version: string;
  readonly opened_at: string;
  readonly score: number;
  readonly threshold: number | null;
  readonly factors: Readonly<Record<string, number>>;
  readonly reasons: readonly string[];
  readonly summary: string;
  readonly detail: DecisionDetail | null;
  readonly recommendation: { readonly answer: RecommendedAnswer; readonly reason: string } | null;
  /** Command text only; answering stays on the human TTY channel. */
  readonly answer_commands: { readonly accept: string; readonly reject: string };
  /** Audit items only: 1-based sample position within the class. */
  readonly audit_sequence: number | null;
}

function answerCommands(id: number): DecisionReadView["answer_commands"] {
  return { accept: `lore decide ${id} --accept`, reject: `lore decide ${id} --reject` };
}

function parseDetail(raw: string | null | undefined): DecisionDetail | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = decisionDetailSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    // reason: unreadable stored detail is reported through `summary` (renderDecisionDetailSummary names it); the structured field is then absent.
    return null;
  }
}

function openDecisionView(p: PendingDecision): DecisionReadView {
  return {
    kind: "decision",
    id: p.id,
    class: p.class,
    subject_id: p.subject_id,
    subject_version: p.subject_version,
    opened_at: p.opened_at,
    score: p.score,
    threshold: p.threshold,
    factors: p.factors,
    reasons: p.reasons,
    summary: renderDecisionDetailSummary({ detail: p.detail }),
    detail: parseDetail(p.detail),
    recommendation: { answer: p.recommended, reason: p.recommended_reason },
    answer_commands: answerCommands(p.id),
    audit_sequence: null,
  };
}

function auditItemView(row: DecisionLogRow, sequence: number): Result<DecisionReadView, LoreError> {
  const factors = parseRowFactors(row);
  if (!factors.ok) return factors;
  const reasons = parseRowReasons(row);
  if (!reasons.ok) return reasons;
  return ok({
    kind: "audit",
    id: row.id,
    class: row.class,
    subject_id: row.subject_id,
    subject_version: row.subject_version,
    opened_at: row.ts,
    score: row.score,
    threshold: row.threshold,
    factors: factors.value,
    reasons: reasons.value,
    summary: renderDecisionDetailSummary(row),
    detail: parseDetail(row.detail),
    recommendation: null,
    answer_commands: answerCommands(row.id),
    audit_sequence: sequence,
  });
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
   * `detail` (HR-T1) is the human-readable account of what the decision asks; it is validated, serialised
   * canonically and chained into the record's hash. It is not a fact and not a factor.
   *
   * @returns err(VALIDATION_ERROR) when `subject.version` is empty, `facts` is not JSON-serialisable or `detail`
   *   is not a valid DecisionDetail (nothing recorded); err(STORE_ERROR) when the append fails.
   */
  async decide(classId: string, subject: DecisionSubject, facts: unknown, detail?: DecisionDetail): Promise<Result<DecideOutcome, LoreError>> {
    if (subject.version === "") return err(validationError("subject.version", "a decision subject needs a version or sha"));
    let detailJson: string | null = null;
    if (detail !== undefined) {
      const checked = decisionDetailSchema.safeParse(detail);
      if (!checked.success) return err(validationError("detail", checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")));
      detailJson = canonicalJson(checked.data);
    }
    const scored = await this.scoreDecision(classId, subject.id, facts);
    if (!scored.ok) return scored;
    const { decision, factsJson, integrity } = scored.value;
    if (integrity !== null && integrity.state === "broken") {
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
      detail: detailJson,
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
   * Scores `facts` exactly as `decide` would, WITHOUT recording anything: a dry run's verdict is the same verdict
   * the recorded call would produce (calibrated C, governed thresholds, integrity fail-safe included).
   *
   * @returns err(VALIDATION_ERROR) for non-serialisable facts or a caller-supplied `confidence`.
   */
  async preview(classId: string, subjectId: string, facts: unknown): Promise<Result<AutonomyDecision, LoreError>> {
    const scored = await this.scoreDecision(classId, subjectId, facts);
    return scored.ok ? ok(scored.value.decision) : scored;
  }

  /** The ONE scoring path of `decide` and `preview`: refuse caller C, calibrate C, run decide(), apply the integrity fail-safe. */
  private async scoreDecision(
    classId: string,
    subjectId: string,
    suppliedFacts: unknown,
  ): Promise<Result<{ decision: AutonomyDecision; factsJson: string; integrity: GovernedAutonomy["integrity"] | null }, LoreError>> {
    if (typeof suppliedFacts === "object" && suppliedFacts !== null && !Array.isArray(suppliedFacts) && (suppliedFacts as Record<string, unknown>)["confidence"] !== undefined) {
      return err(validationError("facts.confidence", "C is computed by lore from the class's recorded outcomes (AC-AU-8); a caller cannot supply it"));
    }
    const governed = this.deps.registry === undefined ? await this.governed() : null;
    if (governed !== null && !governed.ok) return governed;
    const integrity = governed === null ? null : governed.value.integrity;
    const registry = this.deps.registry ?? governed?.value.registry;
    // reason: exactly one of `deps.registry` / the governed record is set above; the code seed is never consulted here.
    if (registry === undefined) return err({ code: "STORE_ERROR", message: "no class registry: neither an injected one nor the governed record" });
    const calibrated = await this.withCalibratedConfidence(classId, suppliedFacts, registry);
    if (!calibrated.ok) return calibrated;
    const facts = calibrated.value.facts;
    let factsJson: string;
    try {
      factsJson = canonicalJson(facts === undefined ? {} : facts);
    } catch (cause) {
      return err(validationError("facts", `facts are not JSON-serialisable: ${String(cause)}`));
    }
    let decision = decide(classId, subjectId, facts, registry);
    if (calibrated.value.note !== null) decision = { ...decision, reasons: [calibrated.value.note, ...decision.reasons] };
    if (integrity !== null && integrity.state === "broken" && decision.verdict !== "refuse") {
      // reason: a mismatched record means NO threshold can be trusted -> every factor is unmeasured -> escalate
      // (AC-AU-9). A refuse (invariant violation) stays a refuse: it never runs anything either.
      decision = {
        ...decision,
        verdict: "escalate",
        score: 0,
        reasons: [`threshold-integrity: ${integrity.reason} — ${integrity.detail}; every class escalates until the human accepts the threshold-integrity decision (lore pending)`, ...decision.reasons],
      };
    }
    return ok({ decision, factsJson, integrity });
  }

  /**
   * `facts` plus the class's calibrated C (a normal-tier class only; human-always and unknown classes are left for
   * decide() to rule on). Runs the observation sweep first when probes are configured.
   */
  private async withCalibratedConfidence(
    classId: string,
    facts: unknown,
    registry: OperationClassRegistry,
  ): Promise<Result<{ facts: unknown; note: string | null }, LoreError>> {
    const operationClass = Object.hasOwn(registry, classId) ? registry[classId] : undefined;
    if (operationClass === undefined || operationClass.tier !== "normal") return ok({ facts, note: null });
    if (facts !== undefined && (typeof facts !== "object" || facts === null || Array.isArray(facts))) return ok({ facts, note: null }); // malformed: decide() refuses it
    if (this.deps.reversalProbes !== undefined) {
      const swept = await this.calibration().observe();
      if (!swept.ok) return swept;
    }
    const rows = await this.deps.store.listDecisionLog();
    if (!rows.ok) return rows;
    const c = classConfidence(rows.value, classId, operationClass.priorConfidence);
    if (!c.ok) return c;
    const note = `calibration: C=${c.value.confidence} (Wilson LB over ${c.value.window} observed outcome(s): ${c.value.stood} stood / ${c.value.reversed} reversed, plus ${c.value.pseudo} pseudo-outcomes at prior ${c.value.prior})`;
    return ok({ facts: { ...(facts ?? {}), confidence: c.value.confidence }, note });
  }

  /** The outcome/calibration service over this service's store, clock and run. */
  calibration(): AutonomyCalibrationService {
    return new AutonomyCalibrationService({
      store: this.deps.store,
      executorRun: this.deps.executorRun,
      now: () => this.now(),
      ...(this.deps.reversalProbes === undefined ? {} : { probes: this.deps.reversalProbes }),
    });
  }

  /** The audit queue (1 in 10 auto decisions per class), separate from the blocking escalations of `listPending`. */
  async listAudit(): Promise<Result<AuditItem[], LoreError>> {
    return this.calibration().auditQueue();
  }

  /** One audit item by the decision id `lore decide` takes, or null. */
  async getAudit(decisionId: number): Promise<Result<AuditItem | null, LoreError>> {
    return this.calibration().getAuditItem(decisionId);
  }

  /** Human-tty audit answer: `right` -> stood, `wrong` -> reversed. Demands a HumanChannelProof. */
  async resolveAudit(decisionId: number, answer: "right" | "wrong", reason: string | undefined, proof: HumanChannelProof): Promise<Result<DecisionLogRow, LoreError>> {
    return this.calibration().recordAudit(decisionId, answer, reason, proof);
  }

  /** Outcome-based counts per class (BR-1005), computed against the GOVERNED registry. */
  async calibrationStats(): Promise<Result<ClassCalibrationStats[], LoreError>> {
    const registry = this.deps.registry === undefined ? await this.governedRegistry() : ok(this.deps.registry);
    if (!registry.ok) return registry;
    return this.calibration().stats(registry.value);
  }

  private async governedRegistry(): Promise<Result<OperationClassRegistry, LoreError>> {
    const governed = await this.governed();
    return governed.ok ? ok(governed.value.registry) : governed;
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

  /**
   * Open escalations (effective verdict: machine escalate), ordered by id. Listing first CLOSES the stale ones
   * (AU-T16): an escalation whose subject was re-measured on a newer version, or whose subject a probe reports
   * absent, gets one appended closing marker (see pending-decisions.ts); nothing is edited or deleted. Two
   * concurrent listers may both append a marker for one decision; the derivation treats any marker after the latest
   * escalate as closing, so duplicates never double-count, and each lister re-reads the log right before appending.
   */
  async listPending(): Promise<Result<PendingDecision[], LoreError>> {
    const closed = await this.closeStalePending();
    if (!closed.ok) return closed;
    const rows = await this.deps.store.listDecisionLog();
    if (!rows.ok) return rows;
    return derivePendingDecisions(rows.value);
  }

  /**
   * PURE read of the open escalations for the dashboard: the same derivation as {@link listPending} but WITHOUT
   * `closeStalePending`, so reading appends nothing (no marker row, no chain-head move) and runs no git or process
   * probe. A stale escalation a probe would close therefore still shows here until a CLI `lore pending` closes it.
   * reason: HTTP read routes must not write (AC-HR-3); do not "unify" this with listPending.
   */
  async readPending(): Promise<Result<PendingDecision[], LoreError>> {
    const rows = await this.deps.store.listDecisionLog();
    if (!rows.ok) return rows;
    return derivePendingDecisions(rows.value);
  }

  /** PURE read: every open decision as a {@link DecisionReadView}, id ASC. Appends nothing. */
  async readDecisionViews(): Promise<Result<DecisionReadView[], LoreError>> {
    const pending = await this.readPending();
    if (!pending.ok) return pending;
    return ok(pending.value.map(openDecisionView));
  }

  /** PURE read: every audit item (sampled auto decision awaiting a human answer) as a view, id ASC. Appends nothing. */
  async readAuditItemViews(): Promise<Result<DecisionReadView[], LoreError>> {
    const rows = await this.deps.store.listDecisionLog();
    if (!rows.ok) return rows;
    const queue = deriveAuditQueue(rows.value);
    if (!queue.ok) return queue;
    const views: DecisionReadView[] = [];
    for (const item of queue.value) {
      const row = rows.value.find((r) => r.id === item.id);
      if (row === undefined) return err({ code: "STORE_ERROR", message: `audit item ${item.id} has no decision_log row` });
      const view = auditItemView(row, item.sequence);
      if (!view.ok) return view;
      views.push(view.value);
    }
    return ok(views);
  }

  /** PURE read: one open decision or audit item by the id `lore decide` takes, or null when neither exists. */
  async readDecisionView(id: number): Promise<Result<DecisionReadView | null, LoreError>> {
    const open = await this.readDecisionViews();
    if (!open.ok) return open;
    const decision = open.value.find((v) => v.id === id);
    if (decision !== undefined) return ok(decision);
    const audit = await this.readAuditItemViews();
    if (!audit.ok) return audit;
    return ok(audit.value.find((v) => v.id === id) ?? null);
  }

  /** Appends a closing marker for every open escalation that is stale; returns how many markers were appended. */
  private async closeStalePending(): Promise<Result<number, LoreError>> {
    const rows = await this.deps.store.listDecisionLog();
    if (!rows.ok) return rows;
    const open = deriveOpenEscalations(rows.value);
    if (!open.ok) return open;
    let appended = 0;
    for (const candidate of open.value) {
      let cause: SupersedeCause | null = null;
      let detail = "";
      const newer = newerVersionSupersession(rows.value, candidate);
      if (newer !== null) {
        cause = "newer-version";
        detail = `decision record ${newer.id} re-measured the subject at version ${newer.subject_version}`;
      } else {
        const probe = HUMAN_ANSWER_ONLY_CLASSES.includes(candidate.class) ? undefined : this.deps.subjectProbes?.[candidate.class];
        if (probe !== undefined && (await probe({ id: candidate.subject_id, version: candidate.subject_version })) === "absent") {
          cause = "subject-gone";
          detail = `class ${candidate.class} existence probe: ${candidate.subject_id} no longer exists`;
        }
      }
      if (cause === null) continue;
      const written = await this.appendSupersedeMarker(candidate, cause, detail);
      if (!written.ok) return written;
      if (written.value) appended += 1;
    }
    return ok(appended);
  }

  /**
   * Appends the closing marker unless the log (re-read now) already closed `candidate`: machine channel, verdict
   * `superseded` (not a decision; see decision-log.ts invariants).
   */
  private async appendSupersedeMarker(candidate: OpenEscalation, cause: SupersedeCause, detail: string): Promise<Result<boolean, LoreError>> {
    const fresh = await this.deps.store.listDecisionLog();
    if (!fresh.ok) return fresh;
    const stillOpen = deriveOpenEscalations(fresh.value);
    if (!stillOpen.ok) return stillOpen;
    if (!stillOpen.value.some((p) => p.id === candidate.id && p.latest_escalate_id === candidate.latest_escalate_id)) return ok(false);
    const appended = await this.deps.store.appendDecisionRecord({
      ts: this.now(),
      class: candidate.class,
      subject_id: candidate.subject_id,
      subject_version: candidate.subject_version,
      facts: canonicalJson({ [SUPERSEDED_FACTS_KEY]: { pending_id: candidate.id, cause, detail } }),
      factors: "{}",
      score: 0,
      threshold: null,
      verdict: "superseded",
      reasons: canonicalJson([`superseded: ${detail}`]),
      executor_run: this.deps.executorRun,
      channel: "machine",
    });
    return appended.ok ? ok(true) : appended;
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
