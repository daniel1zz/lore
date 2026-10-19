/**
 * IntegrateAttemptLedger — the persisted per-attempt phase durations of `lore integrate`, so the ADR's cost
 * assumption (~110 s per attempt) is checkable from data (adr-main-advances-only-by-lore-integrate-per-session;
 * measured 2026-10-19: ~1080 s per attempt and every attempt lost).
 *
 * Purpose: one JSON file per branch under `<corpus dir>/integrate-attempts/` holding the LAST 20 attempts of that
 * branch, each with the duration of every phase (merge, corpus snapshot, floor total + each floor step, CAS) and the
 * outcome. Public surface: IntegrateAttemptLedger.{recordAttempt, read}, medianMs, AttemptRecord, BranchAttempts,
 * ATTEMPT_LEDGER_DIR, ATTEMPTS_KEPT.
 * Invariants:
 *   - Separate from the loss ledger on purpose: the loss file exists exactly while a branch has not landed (`clear`
 *     removes it on landing), but cost data must exist even when nothing is lost, so this file is NEVER cleared on
 *     landing; it is bounded instead (ATTEMPTS_KEPT per branch, older attempts dropped).
 *   - A phase that was not reached in an attempt (CAS after a failed floor) is `null`, never 0 and never absent.
 *   - One file per branch (name = encodeURIComponent(branch)), written tmp + rename: no lock, no torn reads.
 *   - A corrupt file is returned as err, never read as an empty history.
 * Side-effect class: IO (fs under the ledger directory).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { err, ok, type LoreError, type Result } from "@lore/core";

/** Directory name of the attempt ledger inside the corpus directory. */
export const ATTEMPT_LEDGER_DIR = "integrate-attempts";

/** Attempts kept per branch (the cost trend is the point, not the full history). */
export const ATTEMPTS_KEPT = 20;

const FloorStepSchema = z.object({ step: z.string().min(1), exit: z.number().int(), ms: z.number().int().nonnegative() }).strict();

const AttemptRecordSchema = z
  .object({
    /** 1-based attempt number within its `lore integrate` call. */
    attempt: z.number().int().positive(),
    /** main as this attempt saw it. */
    base: z.string().min(1),
    started_at: z.string().min(1),
    outcome: z.enum(["landed", "lost_race", "floor_failed", "conflict"]),
    merge_ms: z.number().int().nonnegative(),
    /** `null` when the attempt ended (a conflict) before the snapshot. */
    corpus_snapshot_ms: z.number().int().nonnegative().nullable(),
    /** `null` when the attempt ended before the floor; `steps` is one named step when the floor emitted no timings. */
    floor: z.object({ total_ms: z.number().int().nonnegative(), steps: z.array(FloorStepSchema) }).strict().nullable(),
    /** `null` when the attempt ended before the CAS. */
    cas_ms: z.number().int().nonnegative().nullable(),
    total_ms: z.number().int().nonnegative(),
  })
  .strict();

const BranchAttemptsSchema = z
  .object({
    schema_version: z.literal(1),
    branch: z.string().min(1),
    attempts: z.array(AttemptRecordSchema),
    updated_at: z.string().min(1),
  })
  .strict();

/** One integrate attempt with its phase durations. */
export type AttemptRecord = z.infer<typeof AttemptRecordSchema>;
/** One branch's recorded attempts, oldest first. */
export type BranchAttempts = z.infer<typeof BranchAttemptsSchema>;

/** Median of `values` (mean of the two middle values, rounded, for an even count); `null` for none. */
export function medianMs(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : Math.round(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

function storeError(message: string, cause: unknown): LoreError {
  return { code: "STORE_ERROR", message, ...(cause instanceof Error ? { cause } : {}) };
}

export class IntegrateAttemptLedger {
  /**
   * @param corpusDir - the corpus directory (the one holding `lore.db`)
   * @param now - clock port (ISO string) for `updated_at`
   */
  constructor(
    private readonly corpusDir: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private get dir(): string {
    return join(this.corpusDir, ATTEMPT_LEDGER_DIR);
  }

  private fileFor(branch: string): string {
    return join(this.dir, `${encodeURIComponent(branch)}.json`);
  }

  /** The branch's recorded attempts; `ok(undefined)` when it has none, err when the file is unreadable or malformed. */
  read(branch: string): Result<BranchAttempts | undefined, LoreError> {
    const file = this.fileFor(branch);
    if (!existsSync(file)) return ok(undefined);
    try {
      return ok(BranchAttemptsSchema.parse(JSON.parse(readFileSync(file, "utf8"))));
    } catch (cause) {
      return err(storeError(`integrate attempt record ${file} is unreadable or malformed; fix or delete it`, cause));
    }
  }

  /** Appends one attempt to the branch's record (keeping the last {@link ATTEMPTS_KEPT}) and persists it. */
  recordAttempt(branch: string, record: AttemptRecord): Result<BranchAttempts, LoreError> {
    const previous = this.read(branch);
    if (!previous.ok) return previous;
    const entry: BranchAttempts = {
      schema_version: 1,
      branch,
      attempts: [...(previous.value?.attempts ?? []), AttemptRecordSchema.parse(record)].slice(-ATTEMPTS_KEPT),
      updated_at: this.now(),
    };
    const file = this.fileFor(branch);
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`);
      renameSync(tmp, file);
      return ok(entry);
    } catch (cause) {
      return err(storeError(`cannot record the integrate attempt of ${branch} under ${this.dir}`, cause));
    }
  }
}
