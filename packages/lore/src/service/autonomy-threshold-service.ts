/**
 * AutonomyThresholdService — the ONE governed autonomy threshold record, its integrity chain and its mirror.
 *
 * Purpose: class tiers/thresholds/priors and the worktree-remove regenerable patterns are governed data (ADR D8).
 * This service owns where they live (store table `autonomy_thresholds`, one row), how a write is attested (an
 * `autonomy-threshold-write` row in the hash-chained decision log carrying the sha256 of the written text), how a
 * mismatch is detected (stored text no longer hashes to the latest write row), and how the record plus the decision
 * chain head are mirrored into a git-tracked file so a rewrite of the local database is catchable from git.
 * Public surface: AutonomyThresholdService.{load, ensureSeeded, propose, buildMirror}, canonicalJson, contentHashOf,
 *   reproducesHead, parseMirror, the class/subject constants, and the types below.
 * Invariants:
 *   - UNSEEDED (no record row AND no write row) is the one state where the code seed table is the live value: nothing
 *     was ever governed, so nothing can have been tampered with. `ensureSeeded` leaves it (seed = a recorded initial
 *     governance write). A record row WITHOUT a matching latest write row, or a write row WITHOUT a record row, is
 *     BROKEN: every class escalates (DecisionService) until the human accepts the integrity decision.
 *   - The write path is two steps (decision-log row first, then the table). A crash between them leaves a mismatch,
 *     which fails SAFE (broken -> escalate); it never leaves a record that is silently trusted.
 *   - The confirmation of a broken record is keyed by the record's CONTENT HASH: a human accept covers exactly the
 *     text they saw, and any later edit needs a new accept.
 *   - Tightening applies with an auto write row; any loosening (see @lore/core diffGovernedThresholds) is class
 *     `governance-loosen` (human-always) and applies only when the human-tty accept of THAT exact proposal exists.
 *   - No ambient reads: the clock and executor run are injected.
 * Side-effect class: IO (store reads/writes; node:crypto hashing).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-9;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D8.
 */
import { createHash } from "node:crypto";
import {
  diffGovernedThresholds,
  err,
  governedThresholdsSchema,
  ok,
  registryOf,
  seedGovernedThresholds,
  storeError,
  type GovernedThresholds,
  type LoreError,
  type OperationClassRegistry,
  type Result,
  type ThresholdChange,
} from "@lore/core";
import { z } from "zod";
import {
  decisionChainHead,
  effectiveDecisionVerdict,
  verifyDecisionChain,
  type DecisionChainHead,
  type DecisionDetail,
  type DecisionLogRow,
  type EffectiveDecisionVerdict,
} from "../store/decision-log.js";
import type { StoreInterface } from "../store/store-interface.js";
import type { DecisionService } from "./decision-service.js";

/** Class of the decision-log rows that attest a write of the record (carry the content hash). */
export const THRESHOLD_WRITE_CLASS = "autonomy-threshold-write";
/** Class of the integrity decision a human answers to restore trust in a mismatched record. */
export const THRESHOLD_INTEGRITY_CLASS = "threshold-integrity";
/** Class (human-always) every loosening proposal is decided under. */
export const GOVERNANCE_LOOSEN_CLASS = "governance-loosen";
/** `subject_id` shared by the write rows and the integrity decision. */
export const THRESHOLD_SUBJECT_ID = "autonomy-thresholds";
/** `subject_version` of every write row (the content hash lives in `facts`, so the latest row is easy to list). */
export const THRESHOLD_WRITE_VERSION = "record";
/** `subject_version` of the integrity decision when the record row itself is missing. */
export const THRESHOLD_RECORD_MISSING_VERSION = "record_missing";

/** JSON with object keys recursively sorted, so equal values serialise to equal text. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sort(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

/** `subject_id` of a governance-loosen decision: names every loosened edit (`<class>.<field>: a -> b`). */
export function loosenSubjectId(loosened: readonly string[]): string {
  return `${THRESHOLD_SUBJECT_ID}: ${loosened.join("; ")}`;
}

/**
 * The class ids a governance-loosen `subject_id` (see {@link loosenSubjectId}) loosens. Calibration uses it to
 * empty exactly those classes' real-outcome windows when the human accepts (AC-AU-8 half 3b). The regenerable-set
 * edits are not a class and are skipped.
 */
export function loosenedClassIdsOf(subjectId: string): string[] {
  const prefix = `${THRESHOLD_SUBJECT_ID}: `;
  if (!subjectId.startsWith(prefix)) return [];
  const ids = subjectId
    .slice(prefix.length)
    .split("; ")
    .map((line) => /^([^.:\s]+)[.:]/.exec(line)?.[1])
    .filter((id): id is string => id !== undefined && id !== "worktreeRemoveRegenerable");
  return [...new Set(ids)];
}

const REGENERABLE_ENTRY = "worktreeRemoveRegenerable";

/** The governed entries (class ids, or the regenerable set) a change's loosened lines touch, de-duplicated in order. */
function loosenedEntriesOf(change: ThresholdChange): string[] {
  return [...new Set(change.loosened.map((line) => (line.startsWith(`${REGENERABLE_ENTRY}:`) ? REGENERABLE_ENTRY : (/^([^.:\s]+)[.:]/.exec(line)?.[1] ?? line))))];
}

/** One entry's value in `record`: the whole class record (null when absent) or the regenerable pattern list. */
function entryValueOf(record: GovernedThresholds, entry: string): unknown {
  return entry === REGENERABLE_ENTRY ? record.worktreeRemoveRegenerable : (record.classes[entry] ?? null);
}

/**
 * `subject_version` of a governance-loosen decision: sha256 of the BEFORE and AFTER values of only the entries the
 * change loosens. reason: binding to the whole record version made N approvals in one batch apply only the first,
 * because the first apply changed the record under the others (like Kubernetes server-side apply, a write conflicts
 * on the fields it manages, not on the object's resourceVersion). Now an approval stays valid while its own entries
 * are unchanged and is voided only when one of them changed, which is a different question.
 */
export function loosenSubjectVersion(before: GovernedThresholds, after: GovernedThresholds, change: ThresholdChange): string {
  const entries = loosenedEntriesOf(change);
  const side = (record: GovernedThresholds) => Object.fromEntries(entries.map((entry) => [entry, entryValueOf(record, entry)]));
  return contentHashOf(canonicalJson({ before: side(before), after: side(after) }));
}

/**
 * The human-readable detail of a governance-loosen decision (HR-T1): names every loosened edit, the governed
 * entries it touches with their BEFORE and AFTER values (keyed by entry), and what accepting / rejecting does.
 * `change` = { entry: "<entries joined by '; '>", before: { <entry>: value }, after: { <entry>: value } }; a class
 * entry's value is the whole class record (null when the class does not exist on that side), the regenerable
 * entry's value is the pattern list.
 */
export function buildLoosenDetail(before: GovernedThresholds, after: GovernedThresholds, change: ThresholdChange, executorRun: string | null): DecisionDetail {
  const entries = loosenedEntriesOf(change);
  const side = (record: GovernedThresholds) => Object.fromEntries(entries.map((entry) => [entry, entryValueOf(record, entry)]));
  return {
    summary: `Loosen the governed autonomy thresholds: ${change.loosened.join("; ")}`,
    requested_by: executorRun === null ? "lore (no attested run)" : `run ${executorRun}`,
    change: { entry: entries.join("; "), before: side(before), after: side(after) },
    on_accept: "The governed autonomy record is rewritten with these values once you re-run the same `lore autonomy` command; the loosened setting then applies to every later decision.",
    on_reject: "Nothing changes: the governed autonomy record keeps its current values and the loosening is never applied.",
  };
}

/** sha256 hex of `text` — the hash the write rows carry. */
export function contentHashOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export type ThresholdBreakReason = "hash_mismatch" | "record_missing" | "no_write_record" | "write_record_unreadable" | "unparseable";

export type ThresholdIntegrity =
  /** Never governed: the code seed is live. */
  | { readonly state: "unseeded" }
  /** Stored text hashes to the latest write row. */
  | { readonly state: "intact"; readonly content_hash: string; readonly write_record_id: number }
  /** Mismatched, but a human-tty accept covers exactly this content hash. */
  | { readonly state: "confirmed"; readonly content_hash: string; readonly record_id: number }
  | { readonly state: "broken"; readonly reason: ThresholdBreakReason; readonly content_hash: string | null; readonly detail: string };

export interface GovernedAutonomy {
  readonly record: GovernedThresholds;
  readonly registry: OperationClassRegistry;
  readonly regenerablePatterns: readonly string[];
  readonly integrity: ThresholdIntegrity;
}

export interface AutonomyThresholdDeps {
  readonly store: StoreInterface;
  /** Attested run id of the executing harness run, or null. */
  readonly executorRun: string | null;
  /** Injected clock (ISO 8601). */
  readonly now: () => string;
}

/** The slice of DecisionService `propose` uses (kept narrow so a double is trivial). */
export type ThresholdDecisionPort = Pick<DecisionService, "decide" | "effectiveVerdict" | "listPending">;

export type ProposeOutcome =
  | { readonly kind: "noop" }
  | { readonly kind: "applied"; readonly change: ThresholdChange; readonly write_record_id: number; readonly approved_by_record: number | null }
  | {
      readonly kind: "escalated";
      readonly change: ThresholdChange;
      readonly decision_record_id: number;
      /** The id `lore decide` takes. */
      readonly pending_id: number;
      readonly subject: { readonly id: string; readonly version: string };
    }
  | { readonly kind: "refused"; readonly integrity: Extract<ThresholdIntegrity, { state: "broken" }> };

const writeFactsSchema = z.object({ content_hash: z.string().regex(/^[0-9a-f]{64}$/) }).passthrough();

function integrityKey(version: string) {
  return { class: THRESHOLD_INTEGRITY_CLASS, subject_id: THRESHOLD_SUBJECT_ID, subject_version: version };
}

const WRITE_KEY = { class: THRESHOLD_WRITE_CLASS, subject_id: THRESHOLD_SUBJECT_ID, subject_version: THRESHOLD_WRITE_VERSION };

export class AutonomyThresholdService {
  constructor(private readonly deps: AutonomyThresholdDeps) {}

  /**
   * The live governed values plus the integrity verdict. Read-only: never seeds (see {@link ensureSeeded}).
   * A record that fails its integrity check still returns a usable `record` (its parsed text, else the seed) so a
   * caller can render it — but the caller MUST treat `integrity.state === "broken"` as "every class escalates".
   *
   * @returns err(STORE_ERROR) when the store cannot be read (never reported as intact).
   */
  async load(): Promise<Result<GovernedAutonomy, LoreError>> {
    const stored = await this.deps.store.readAutonomyThresholds();
    if (!stored.ok) return stored;
    const writes = await this.deps.store.listDecisionLog(WRITE_KEY);
    if (!writes.ok) return writes;
    const latestWrite = writes.value[writes.value.length - 1];

    if (stored.value === null) {
      if (latestWrite === undefined) return ok(this.view(seedGovernedThresholds(), { state: "unseeded" }));
      return this.settle(seedGovernedThresholds(), THRESHOLD_RECORD_MISSING_VERSION, {
        state: "broken",
        reason: "record_missing",
        content_hash: null,
        detail: `the record row is gone but write record ${latestWrite.id} says it was written`,
      });
    }

    const hash = contentHashOf(stored.value.content);
    const parsed = parseRecord(stored.value.content);
    const record = parsed ?? seedGovernedThresholds();
    const broken = (reason: ThresholdBreakReason, detail: string) =>
      this.settle(record, hash, { state: "broken", reason, content_hash: hash, detail }, parsed !== null);

    if (latestWrite === undefined) return broken("no_write_record", "a record row exists but no write record in the decision log attests it");
    const expected = writeFactsSchema.safeParse(safeJson(latestWrite.facts));
    if (!expected.success) return broken("write_record_unreadable", `write record ${latestWrite.id} carries no readable content hash`);
    if (expected.data.content_hash !== hash) {
      return broken("hash_mismatch", `stored content hashes to ${hash.slice(0, 12)} but write record ${latestWrite.id} attests ${expected.data.content_hash.slice(0, 12)}`);
    }
    if (parsed === null) return broken("unparseable", "the attested content does not parse as a governed threshold record");
    return ok(this.view(record, { state: "intact", content_hash: hash, write_record_id: latestWrite.id }));
  }

  /**
   * Seeds the record from the code table when it was never governed: one `seed` write row, then the table row.
   * Idempotent: any other state is returned as `load()` answers it.
   */
  async ensureSeeded(): Promise<Result<GovernedAutonomy, LoreError>> {
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    if (loaded.value.integrity.state !== "unseeded") return loaded;
    const written = await this.commit(seedGovernedThresholds(), "seed", { loosened: [], tightened: [] }, null);
    if (!written.ok) return written;
    return this.load();
  }

  /**
   * Proposes `next` as the new record. Tightening applies (auto write row). Loosening is decided as
   * `governance-loosen` through `decisions` (human-always): it applies only once that exact proposal has a human-tty
   * accept, so re-running the same command after `lore decide` applies it.
   *
   * @returns refused when the current record is broken and unconfirmed (nothing written); err on a store failure.
   */
  async propose(next: GovernedThresholds, decisions: ThresholdDecisionPort): Promise<Result<ProposeOutcome, LoreError>> {
    const checked = governedThresholdsSchema.safeParse(next);
    if (!checked.success) return err({ code: "VALIDATION_ERROR", field: "record", message: checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), rule: "BR-1260" });
    const seeded = await this.ensureSeeded();
    if (!seeded.ok) return seeded;
    const current = seeded.value;
    if (current.integrity.state === "broken") return ok({ kind: "refused", integrity: current.integrity });

    const change = diffGovernedThresholds(current.record, checked.data);
    if (change.loosened.length === 0 && change.tightened.length === 0) return ok({ kind: "noop" });

    if (change.loosened.length === 0) {
      const written = await this.commit(checked.data, "tighten", change, null);
      if (!written.ok) return written;
      return ok({ kind: "applied", change, write_record_id: written.value.id, approved_by_record: null });
    }

    const subject = { id: loosenSubjectId(change.loosened), version: loosenSubjectVersion(current.record, checked.data, change) };
    const effective = await decisions.effectiveVerdict(GOVERNANCE_LOOSEN_CLASS, subject);
    if (!effective.ok) return effective;
    if (effective.value !== null && effective.value.channel === "human-tty" && effective.value.verdict === "auto") {
      const written = await this.commit(checked.data, "loosen-approved", change, effective.value.record_id);
      if (!written.ok) return written;
      return ok({ kind: "applied", change, write_record_id: written.value.id, approved_by_record: effective.value.record_id });
    }
    const detail = buildLoosenDetail(current.record, checked.data, change, this.deps.executorRun);
    const decided = await decisions.decide(GOVERNANCE_LOOSEN_CLASS, subject, {}, detail);
    if (!decided.ok) return decided;
    const pending = await decisions.listPending();
    if (!pending.ok) return pending;
    const open = pending.value.find((p) => p.class === GOVERNANCE_LOOSEN_CLASS && p.subject_id === subject.id && p.subject_version === subject.version);
    if (open === undefined) return err(storeError(`escalated loosening has no pending decision (record ${decided.value.record_id})`));
    return ok({ kind: "escalated", change, decision_record_id: decided.value.record_id, pending_id: open.id, subject });
  }

  /** What the git-tracked mirror file holds: the record text, its hash, its integrity and the decision chain head. */
  async buildMirror(): Promise<Result<AutonomyMirror, LoreError>> {
    const loaded = await this.load();
    if (!loaded.ok) return loaded;
    const rows = await this.deps.store.listDecisionLog();
    if (!rows.ok) return rows;
    const content = canonicalJson(loaded.value.record);
    return ok({
      version: 1,
      thresholds: loaded.value.record,
      thresholds_hash: contentHashOf(content),
      integrity: loaded.value.integrity.state,
      decision_chain_head: decisionChainHead(rows.value),
    });
  }

  private view(record: GovernedThresholds, integrity: ThresholdIntegrity): GovernedAutonomy {
    return { record, registry: registryOf(record), regenerablePatterns: record.worktreeRemoveRegenerable, integrity };
  }

  /** A broken verdict becomes `confirmed` when a human-tty accept covers this content hash (and the text parses). */
  private async settle(
    record: GovernedThresholds,
    version: string,
    broken: Extract<ThresholdIntegrity, { state: "broken" }>,
    parsed = true,
  ): Promise<Result<GovernedAutonomy, LoreError>> {
    const rows = await this.deps.store.listDecisionLog(integrityKey(version));
    if (!rows.ok) return rows;
    const effective: EffectiveDecisionVerdict | null = effectiveDecisionVerdict(rows.value, integrityKey(version));
    if (parsed && effective !== null && effective.channel === "human-tty" && effective.verdict === "auto") {
      return ok(this.view(record, { state: "confirmed", content_hash: version, record_id: effective.record_id }));
    }
    return ok(this.view(record, broken));
  }

  private async commit(
    record: GovernedThresholds,
    op: "seed" | "tighten" | "loosen-approved",
    change: ThresholdChange,
    approvedBy: number | null,
  ): Promise<Result<DecisionLogRow, LoreError>> {
    const content = canonicalJson(record);
    const ts = this.deps.now();
    const appended = await this.deps.store.appendDecisionRecord({
      ts,
      class: THRESHOLD_WRITE_CLASS,
      subject_id: THRESHOLD_SUBJECT_ID,
      subject_version: THRESHOLD_WRITE_VERSION,
      facts: canonicalJson({ op, content_hash: contentHashOf(content), loosened: change.loosened, tightened: change.tightened, approved_by_record: approvedBy }),
      factors: "{}",
      score: 1,
      threshold: null,
      verdict: "auto",
      reasons: canonicalJson([`governed threshold record written (${op})`]),
      executor_run: this.deps.executorRun,
      channel: "machine",
    });
    if (!appended.ok) return appended;
    const stored = await this.deps.store.writeAutonomyThresholds(content, ts);
    if (!stored.ok) return stored;
    return appended;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseRecord(content: string): GovernedThresholds | null {
  const parsed = governedThresholdsSchema.safeParse(safeJson(content));
  return parsed.success ? parsed.data : null;
}

// ── mirror (git-tracked file) ────────────────────────────────────────────────────────────────────────────────────

const chainHeadSchema = z.object({ head_id: z.number().int().positive(), head_hash: z.string().min(1), count: z.number().int().positive() }).strict();

export const autonomyMirrorSchema = z
  .object({
    version: z.literal(1),
    thresholds: governedThresholdsSchema,
    thresholds_hash: z.string().regex(/^[0-9a-f]{64}$/),
    integrity: z.enum(["unseeded", "intact", "confirmed", "broken"]),
    decision_chain_head: chainHeadSchema.nullable(),
  })
  .strict();
export type AutonomyMirror = z.infer<typeof autonomyMirrorSchema>;

/** Parses the mirror file's text; err names why it is unusable (never defaulted). */
export function parseMirror(text: string): Result<AutonomyMirror, LoreError> {
  const json = safeJson(text);
  if (json === undefined) return err(storeError("autonomy mirror is not valid JSON"));
  const parsed = autonomyMirrorSchema.safeParse(json);
  if (!parsed.success) return err(storeError(`autonomy mirror has an unexpected shape: ${parsed.error.issues[0]?.message ?? "invalid"}`));
  return ok(parsed.data);
}

export type HeadReproduction =
  | { readonly reproduced: true }
  | { readonly reproduced: false; readonly reason: "chain_broken" | "head_missing" | "head_hash_differs" | "count_differs"; readonly detail: string };

/**
 * Whether the local decision log REPRODUCES a head that was already pushed: the whole chain verifies, the row with
 * the pushed `head_id` exists, carries the pushed hash, and exactly `count` rows precede-or-equal it. A log rewritten
 * from scratch (or truncated below the pushed head) cannot pass: the pushed hash is a hash of every row before it.
 */
export function reproducesHead(rows: readonly DecisionLogRow[], pushed: DecisionChainHead): HeadReproduction {
  const verified = verifyDecisionChain(rows);
  if (!verified.clean) {
    return { reproduced: false, reason: "chain_broken", detail: `local chain is broken at row ${verified.break.id} (${verified.break.reason})` };
  }
  const row = rows.find((r) => r.id === pushed.head_id);
  if (row === undefined) return { reproduced: false, reason: "head_missing", detail: `local log has no row ${pushed.head_id} (pushed head)` };
  if (row.entry_hash !== pushed.head_hash) {
    return { reproduced: false, reason: "head_hash_differs", detail: `local row ${pushed.head_id} hashes to ${row.entry_hash.slice(0, 12)}, pushed head was ${pushed.head_hash.slice(0, 12)}` };
  }
  const upTo = rows.filter((r) => r.id <= pushed.head_id).length;
  if (upTo !== pushed.count) return { reproduced: false, reason: "count_differs", detail: `local log has ${upTo} rows up to ${pushed.head_id}, pushed head counted ${pushed.count}` };
  return { reproduced: true };
}
