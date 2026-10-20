/**
 * AutonomyCalibrationService — outcomes of auto decisions, the calibrated C factor and the human sampling floor.
 *
 * Purpose: lore observes what happened AFTER an auto decision (reversed or stood), records it append-only in the
 * hash-chained decision log, derives each class's confidence C from those outcomes, and queues 1 in 10 auto
 * decisions per class for non-blocking human audit. Calibration only TIGHTENS by itself; only a human-tty accept of
 * a governance-loosen decision for the class empties its real-outcome window (ADR D6, spec AC-AU-8 half 3b).
 * Public surface: isAutoDecisionRow, classConfidence, deriveAuditQueue, loosenBoundaryOf, foldOutcomes,
 *   AutonomyCalibrationService.{observe, recordObserved, recordAudit, auditQueue, getAuditItem, stats},
 *   createAuditReversalProbe, createGitReversalProbes, the constants and types below.
 * Invariants:
 *   - ONE definition of "an auto decision": `isAutoDecisionRow` (machine channel, verdict auto, class not in
 *     CALIBRATION_EXCLUDED_CLASSES, verdict not `superseded`). Counting, sampling and calibration all use it.
 *   - C = Wilson lower bound (z 1.96) over the class's last CALIBRATION_WINDOW observed decisions (newest decision
 *     first) PLUS CALIBRATION_PSEUDO_OUTCOMES pseudo-outcomes at the class prior (pseudo-outcomes never leave).
 *     A decision counts once: any trusted `reversed` outcome beats `stood`.
 *   - Outcome rows live in the decision log (class `autonomy-outcome`), so they are hash-chained: deleting a reversal
 *     breaks the chain. Only channel `machine` (lore's own observers) and `human-tty` (audit answers proved by the
 *     human channel) count; an `agent-asserted` outcome row is invisible to C.
 *   - The window of class X starts after the latest human-tty ACCEPT of a `governance-loosen` decision whose subject
 *     names X (`loosenBoundaryOf`); outcome rows at or before that row are not counted.
 *   - Sampling is deterministic: the auto decision whose per-class sequence number (1-based, id order) is divisible
 *     by AUDIT_EVERY is an audit item until a human-tty answer exists. It never blocks the audited operation.
 *   - `recordAudit` is the only writer of human-tty outcome rows and demands a HumanChannelProof.
 * Side-effect class: IO (decision_log appends through the injected store; git/audit reads through probes).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-8, AC-AU-10;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D6, PRD I2 (sampling floor).
 */
import { err, ok, storeError, validationError, wilsonLowerBound, type DocId, type LoreError, type OperationClassRegistry, type Result } from "@lore/core";
import { z } from "zod";
import { decisionChainHead, type DecisionLogRow } from "../store/decision-log.js";
import type { StoreInterface } from "../store/store-interface.js";
import {
  GOVERNANCE_LOOSEN_CLASS,
  THRESHOLD_INTEGRITY_CLASS,
  THRESHOLD_WRITE_CLASS,
  canonicalJson,
  loosenedClassIdsOf,
} from "./autonomy-threshold-service.js";
import { isIssuedHumanChannelProof, type HumanChannelProof } from "./human-channel.js";

/** Class of the decision-log rows that carry one outcome of an auto decision. */
export const OUTCOME_CLASS = "autonomy-outcome";
/** The last N observed decisions that enter C. */
export const CALIBRATION_WINDOW = 50;
/** Pseudo-outcomes at the class prior that always enter C (a new class starts near its prior). */
export const CALIBRATION_PSEUDO_OUTCOMES = 50;
/** z of the Wilson bound (95%). */
export const CALIBRATION_Z = 1.96;
/** Every auto decision whose per-class sequence number is divisible by this is queued for human audit. */
export const AUDIT_EVERY = 10;
/** An auto decision with no reversal evidence this long after it was made is recorded as `stood`. */
export const STOOD_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many unresolved decisions are probed per sweep (newest first). */
export const OBSERVE_BATCH = 200;
/** Classes whose rows are bookkeeping, never auto decisions (threshold writes, integrity, outcomes themselves). */
export const CALIBRATION_EXCLUDED_CLASSES: ReadonlySet<string> = new Set([THRESHOLD_WRITE_CLASS, THRESHOLD_INTEGRITY_CLASS, OUTCOME_CLASS]);

export type OutcomeResult = "reversed" | "stood";
export type OutcomeSource =
  | "archive-restore"
  | "merge-reverted"
  | "doc-restore"
  | "doc-reopen"
  | "doc-correction"
  | "doc-invalidate"
  | "no-reversal-observed"
  | "human-audit";

const outcomeFactsSchema = z.object({
  outcome: z.object({
    decision_id: z.number().int().positive(),
    result: z.enum(["reversed", "stood"]),
    source: z.string().min(1),
    detail: z.string(),
  }),
});

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

/**
 * THE predicate for "an auto decision": a machine-channel `auto` row of a real operation class. Never counted,
 * sampled or calibrated: threshold-write / threshold-integrity / outcome bookkeeping rows and any `superseded` row.
 */
export function isAutoDecisionRow(row: DecisionLogRow): boolean {
  if (row.channel !== "machine") return false;
  if ((row.verdict as string) === "superseded") return false; // reason: AU-T16 adds the verdict; the string compare compiles either way
  if (row.verdict !== "auto") return false;
  return !CALIBRATION_EXCLUDED_CLASSES.has(row.class);
}

interface OutcomeRow {
  readonly row: DecisionLogRow;
  readonly decision_id: number;
  readonly result: OutcomeResult;
  readonly source: string;
}

/** Trusted outcome rows (machine / human-tty) in id order; a row whose facts do not parse is a STORE_ERROR. */
function parseOutcomeRows(rows: readonly DecisionLogRow[]): Result<OutcomeRow[], LoreError> {
  const out: OutcomeRow[] = [];
  for (const row of rows) {
    if (row.class !== OUTCOME_CLASS || row.channel === "agent-asserted") continue;
    let json: unknown;
    try {
      json = JSON.parse(row.facts);
    } catch {
      return err(storeError(`decision_log row ${row.id}: outcome facts are not valid JSON`));
    }
    const parsed = outcomeFactsSchema.safeParse(json);
    if (!parsed.success) return err(storeError(`decision_log row ${row.id}: outcome facts have an unexpected shape`));
    out.push({ row, decision_id: parsed.data.outcome.decision_id, result: parsed.data.outcome.result, source: parsed.data.outcome.source });
  }
  return ok(out);
}

/** Folds outcome rows to one result per decision: any `reversed` beats `stood`. */
export function foldOutcomes(outcomes: readonly OutcomeRow[]): Map<number, OutcomeResult> {
  const folded = new Map<number, OutcomeResult>();
  for (const o of outcomes) {
    if (folded.get(o.decision_id) === "reversed") continue;
    if (o.result === "reversed" || !folded.has(o.decision_id)) folded.set(o.decision_id, o.result);
  }
  return folded;
}

/**
 * Id of the latest human-tty accept of a governance-loosen decision that names `classId`, or 0 when none. That
 * row empties the class's real-outcome window (half 3b): outcome rows with an id at or below it do not count.
 */
export function loosenBoundaryOf(rows: readonly DecisionLogRow[], classId: string): number {
  let boundary = 0;
  for (const row of rows) {
    if (row.class !== GOVERNANCE_LOOSEN_CLASS || row.channel !== "human-tty" || row.verdict !== "auto") continue;
    if (loosenedClassIdsOf(row.subject_id).includes(classId) && row.id > boundary) boundary = row.id;
  }
  return boundary;
}

export interface ClassConfidence {
  readonly class: string;
  readonly prior: number;
  /** C: Wilson lower bound over window + pseudo-outcomes, rounded to 6 decimals. */
  readonly confidence: number;
  readonly stood: number;
  readonly reversed: number;
  /** Real decisions in the window (stood + reversed). */
  readonly window: number;
  readonly pseudo: number;
  /** Id of the human-tty governance-loosen accept that emptied the window, or 0. */
  readonly boundary_record_id: number;
}

/**
 * C for one class from the log `rows` (any superset, id ASC): Wilson LB (z 1.96) over the last
 * CALIBRATION_WINDOW observed decisions plus CALIBRATION_PSEUDO_OUTCOMES pseudo-outcomes at `prior`.
 *
 * @example classConfidence([], "stash-drop", 0.95) // fresh class: 47.5 / 50 successes -> C ~ 0.8514
 * @returns err(STORE_ERROR) when an outcome row's facts do not parse.
 */
export function classConfidence(rows: readonly DecisionLogRow[], classId: string, prior: number): Result<ClassConfidence, LoreError> {
  const parsed = parseOutcomeRows(rows);
  if (!parsed.ok) return parsed;
  const boundary = loosenBoundaryOf(rows, classId);
  const classDecisionIds = new Set(rows.filter((r) => r.class === classId && isAutoDecisionRow(r)).map((r) => r.id));
  const folded = foldOutcomes(parsed.value.filter((o) => o.row.id > boundary && classDecisionIds.has(o.decision_id)));
  const newestFirst = [...folded.entries()].sort((a, b) => b[0] - a[0]).slice(0, CALIBRATION_WINDOW);
  const stood = newestFirst.filter(([, result]) => result === "stood").length;
  const reversed = newestFirst.length - stood;
  const n = newestFirst.length + CALIBRATION_PSEUDO_OUTCOMES;
  const successes = stood + CALIBRATION_PSEUDO_OUTCOMES * prior;
  return ok({
    class: classId,
    prior,
    confidence: round6(wilsonLowerBound(successes, n, CALIBRATION_Z)),
    stood,
    reversed,
    window: newestFirst.length,
    pseudo: CALIBRATION_PSEUDO_OUTCOMES,
    boundary_record_id: boundary,
  });
}

/** One sampled decision awaiting the human's audit answer. */
export interface AuditItem {
  /** The decision row's id — what `lore decide <id>` takes for an audit item. */
  readonly id: number;
  readonly class: string;
  readonly subject_id: string;
  readonly subject_version: string;
  readonly decided_at: string;
  /** 1-based position among the class's auto decisions (divisible by AUDIT_EVERY). */
  readonly sequence: number;
  readonly score: number;
  /** Serialised DecisionDetail of the decision row (HR-T7), or null when it was decided without one. */
  readonly detail: string | null;
}

/**
 * Sampled auto decisions without a human-tty answer yet, id ASC. Deterministic: sequence numbers count the class's
 * auto decisions in id order, so the sample cannot be steered by re-rolling.
 */
export function deriveAuditQueue(rows: readonly DecisionLogRow[]): Result<AuditItem[], LoreError> {
  const outcomes = parseOutcomeRows(rows);
  if (!outcomes.ok) return outcomes;
  const answered = new Set(outcomes.value.filter((o) => o.row.channel === "human-tty").map((o) => o.decision_id));
  const sequence = new Map<string, number>();
  const queue: AuditItem[] = [];
  for (const row of rows) {
    if (!isAutoDecisionRow(row)) continue;
    const seq = (sequence.get(row.class) ?? 0) + 1;
    sequence.set(row.class, seq);
    if (seq % AUDIT_EVERY !== 0 || answered.has(row.id)) continue;
    queue.push({ id: row.id, class: row.class, subject_id: row.subject_id, subject_version: row.subject_version, decided_at: row.ts, sequence: seq, score: row.score, detail: row.detail ?? null });
  }
  return ok(queue);
}

/** What a probe found: this decision was reversed, and how. */
export interface ReversalFinding {
  readonly source: OutcomeSource;
  readonly detail: string;
}

/** Looks for evidence that an auto decision was reversed. `null` = none found. */
export interface ReversalProbe {
  readonly name: string;
  /** @lore-site BR-1271 */
  check(row: DecisionLogRow): Promise<Result<ReversalFinding | null, LoreError>>;
}

/**
 * Reversal evidence in the audit log: after the decision, its subject (a doc id) was restored, invalidated,
 * reopened or corrected. A subject that is no doc has no audit rows and yields null.
 */
export function createAuditReversalProbe(store: StoreInterface): ReversalProbe {
  return {
    name: "audit-log",
    async check(row) {
      const entries = await store.queryAudit({ doc_id: row.subject_id as DocId, since: row.ts });
      if (!entries.ok) return entries;
      for (const entry of entries.value) {
        if (entry.timestamp <= row.ts) continue;
        const details = entry.details ?? {};
        if (entry.action === "restore") return ok({ source: "doc-restore", detail: `audit ${entry.action} at ${entry.timestamp}` });
        if (entry.action === "invalidate") return ok({ source: "doc-invalidate", detail: `audit ${entry.action} at ${entry.timestamp}` });
        if (entry.action === "update" && details["operation"] === "reopen") return ok({ source: "doc-reopen", detail: `audit reopen at ${entry.timestamp}` });
        if (entry.action === "update" && details["correction"] !== undefined) return ok({ source: "doc-correction", detail: `audit correction at ${entry.timestamp}` });
      }
      return ok(null);
    },
  };
}

/** Synchronous git runner (same shape as stash-prune's `GitRunner`). */
export type CalibrationGitRunner = (args: readonly string[]) => { readonly status: number; readonly stdout: string; readonly stderr: string };

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * Reversal evidence in git: (1) a `stash-drop` subject sha that is a stash again (restored from its
 * `refs/lore/archive/` ref) and (2) a commit sha subject that a later commit reverts (`This reverts commit <sha>`).
 * A git failure is an err — never read as "not reversed".
 */
export function createGitReversalProbes(git: CalibrationGitRunner): ReversalProbe[] {
  return [
    {
      name: "archive-restore",
      async check(row) {
        if (row.class !== "stash-drop" || !SHA_RE.test(row.subject_id)) return ok(null);
        const list = git(["stash", "list", "--format=%H"]);
        if (list.status !== 0) return err(storeError(`git stash list failed: ${list.stderr.trim()}`));
        const restored = list.stdout.split("\n").some((line) => line.trim() === row.subject_id);
        return ok(restored ? { source: "archive-restore", detail: `stash ${row.subject_id.slice(0, 12)} is a stash again (restored from its archive ref)` } : null);
      },
    },
    {
      name: "merge-reverted",
      async check(row) {
        const sha = SHA_RE.test(row.subject_id) ? row.subject_id : SHA_RE.test(row.subject_version) ? row.subject_version : null;
        if (sha === null) return ok(null);
        const found = git(["log", "--all", "-n", "1", "--format=%H", `--grep=This reverts commit ${sha}`]);
        if (found.status !== 0) return err(storeError(`git log failed: ${found.stderr.trim()}`));
        return ok(found.stdout.trim() === "" ? null : { source: "merge-reverted", detail: `commit ${found.stdout.trim().slice(0, 12)} reverts ${sha.slice(0, 12)}` });
      },
    },
  ];
}

export interface CalibrationDeps {
  readonly store: StoreInterface;
  readonly executorRun: string | null;
  /** Injected clock (ISO 8601). */
  readonly now: () => string;
  /** Reversal probes `observe` runs; none -> observe only records `stood`. */
  readonly probes?: readonly ReversalProbe[];
  readonly stoodAfterMs?: number;
}

export interface ObserveReport {
  readonly reversed: number;
  readonly stood: number;
  readonly probed: number;
}

/** Per-class counts for `lore calibration --stats` (BR-1005 surface). */
export interface ClassCalibrationStats extends ClassConfidence {
  readonly threshold: number | null;
  readonly auto_decisions: number;
  readonly audit_pending: number;
  readonly audit_answered: number;
  /** True when C is below the class threshold: the class escalates until the human loosens it. */
  readonly escalating: boolean;
}

export class AutonomyCalibrationService {
  constructor(private readonly deps: CalibrationDeps) {}

  private async rows(): Promise<Result<DecisionLogRow[], LoreError>> {
    return this.deps.store.listDecisionLog();
  }

  /** The sampled auto decisions still waiting for a human answer (id ASC). */
  async auditQueue(): Promise<Result<AuditItem[], LoreError>> {
    const rows = await this.rows();
    if (!rows.ok) return rows;
    return deriveAuditQueue(rows.value);
  }

  /** One audit item by the decision id `lore decide` takes, or null when that id is not (or no longer) queued. */
  async getAuditItem(id: number): Promise<Result<AuditItem | null, LoreError>> {
    const queue = await this.auditQueue();
    if (!queue.ok) return queue;
    return ok(queue.value.find((item) => item.id === id) ?? null);
  }

  private async append(decision: DecisionLogRow, result: OutcomeResult, source: OutcomeSource, detail: string, channel: "machine" | "human-tty", extra: Record<string, unknown>): Promise<Result<DecisionLogRow, LoreError>> {
    return this.deps.store.appendDecisionRecord({
      ts: this.deps.now(),
      class: OUTCOME_CLASS,
      subject_id: `decision:${decision.id}`,
      subject_version: source,
      facts: canonicalJson({ outcome: { decision_id: decision.id, result, source, detail }, ...extra }),
      factors: "{}",
      score: result === "stood" ? 1 : 0,
      threshold: null,
      verdict: "auto",
      reasons: canonicalJson([`outcome of auto decision ${decision.id} (${decision.class} ${decision.subject_id}): ${result} (${source})`]),
      executor_run: channel === "machine" ? this.deps.executorRun : null,
      channel,
    });
  }

  /**
   * Records an outcome lore OBSERVED for auto decision `decisionId` (machine channel). Called by `observe`; no CLI
   * verb exposes it, so an agent cannot assert an outcome.
   *
   * @returns err(VALIDATION_ERROR) when `decisionId` is not an auto decision row (nothing recorded).
   */
  async recordObserved(decisionId: number, result: OutcomeResult, source: OutcomeSource, detail: string): Promise<Result<DecisionLogRow, LoreError>> {
    const rows = await this.rows();
    if (!rows.ok) return rows;
    const decision = rows.value.find((r) => r.id === decisionId);
    if (decision === undefined || !isAutoDecisionRow(decision)) return err(validationError("decision_id", `row ${decisionId} is not an auto decision`));
    return this.append(decision, result, source, detail, "machine", {});
  }

  /**
   * THE human audit writer: `right` records `stood`, `wrong` records `reversed` (same weight as an observed
   * reversal). Demands a HumanChannelProof; an unproved or agent-asserted answer is refused and writes nothing.
   *
   * @returns err(VALIDATION_ERROR) for a forged proof or an id that is not in the audit queue.
   */
  async recordAudit(decisionId: number, answer: "right" | "wrong", reason: string | undefined, proof: HumanChannelProof): Promise<Result<DecisionLogRow, LoreError>> {
    if (!isIssuedHumanChannelProof(proof)) {
      return err(validationError("proof", "an audit answer needs a proof minted by the human channel (TTY, agent-ancestry and nonce checks)", undefined, "BR-1249"));
    }
    const rows = await this.rows();
    if (!rows.ok) return rows;
    const queue = deriveAuditQueue(rows.value);
    if (!queue.ok) return queue;
    if (!queue.value.some((item) => item.id === decisionId)) return err(validationError("id", `decision ${decisionId} is not awaiting audit`, undefined, "BR-1252"));
    const decision = rows.value.find((r) => r.id === decisionId);
    if (decision === undefined) return err(storeError(`audit item ${decisionId} vanished from the log`));
    const head = decisionChainHead(rows.value);
    return this.append(decision, answer === "wrong" ? "reversed" : "stood", "human-audit", reason ?? "", "human-tty", {
      human: {
        answer,
        reason: reason ?? null,
        ancestry: proof.ancestry,
        verified_at: proof.verified_at,
        chain_head: head === null ? null : { head_id: head.head_id, head_hash: head.head_hash, count: head.count },
      },
    });
  }

  /**
   * One observation sweep over auto decisions with no outcome yet (newest OBSERVE_BATCH): a probe that finds
   * reversal evidence records `reversed`; none found and the decision older than STOOD_AFTER_MS records `stood`.
   *
   * @returns err when a probe or an append fails (the sweep stops; rows already appended stay).
   */
  async observe(): Promise<Result<ObserveReport, LoreError>> {
    const rows = await this.rows();
    if (!rows.ok) return rows;
    const outcomes = parseOutcomeRows(rows.value);
    if (!outcomes.ok) return outcomes;
    const resolved = new Set(outcomes.value.map((o) => o.decision_id));
    const open = rows.value.filter((r) => isAutoDecisionRow(r) && !resolved.has(r.id)).slice(-OBSERVE_BATCH);
    const nowMs = Date.parse(this.deps.now());
    const stoodAfter = this.deps.stoodAfterMs ?? STOOD_AFTER_MS;
    let reversed = 0;
    let stood = 0;
    for (const decision of open) {
      let finding: ReversalFinding | null = null;
      for (const probe of this.deps.probes ?? []) {
        const checked = await probe.check(decision);
        if (!checked.ok) return checked;
        if (checked.value !== null) {
          finding = checked.value;
          break;
        }
      }
      if (finding !== null) {
        const appended = await this.append(decision, "reversed", finding.source, finding.detail, "machine", {});
        if (!appended.ok) return appended;
        reversed += 1;
      } else if (Number.isFinite(nowMs) && nowMs - Date.parse(decision.ts) >= stoodAfter) {
        const appended = await this.append(decision, "stood", "no-reversal-observed", `no reversal evidence ${Math.floor(stoodAfter / 86_400_000)} days after the decision`, "machine", {});
        if (!appended.ok) return appended;
        stood += 1;
      }
    }
    return ok({ reversed, stood, probed: open.length });
  }

  /** Outcome-based counts per class (BR-1005): every normal class of `registry` plus any class with auto rows. */
  async stats(registry: OperationClassRegistry): Promise<Result<ClassCalibrationStats[], LoreError>> {
    const rows = await this.rows();
    if (!rows.ok) return rows;
    const queue = deriveAuditQueue(rows.value);
    if (!queue.ok) return queue;
    const outcomes = parseOutcomeRows(rows.value);
    if (!outcomes.ok) return outcomes;
    const answeredIds = new Set(outcomes.value.filter((o) => o.row.channel === "human-tty").map((o) => o.decision_id));
    const classIds = new Set<string>(Object.entries(registry).filter(([, c]) => c.tier === "normal").map(([id]) => id));
    for (const row of rows.value) if (isAutoDecisionRow(row)) classIds.add(row.class);
    const stats: ClassCalibrationStats[] = [];
    for (const classId of [...classIds].sort()) {
      const operationClass = Object.hasOwn(registry, classId) ? registry[classId] : undefined;
      if (operationClass === undefined || operationClass.tier !== "normal") continue;
      const confidence = classConfidence(rows.value, classId, operationClass.priorConfidence);
      if (!confidence.ok) return confidence;
      const decisions = rows.value.filter((r) => r.class === classId && isAutoDecisionRow(r));
      stats.push({
        ...confidence.value,
        threshold: operationClass.threshold,
        auto_decisions: decisions.length,
        audit_pending: queue.value.filter((i) => i.class === classId).length,
        audit_answered: decisions.filter((d) => answeredIds.has(d.id)).length,
        escalating: confidence.value.confidence < operationClass.threshold,
      });
    }
    return ok(stats);
  }
}
