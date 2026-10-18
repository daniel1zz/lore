/**
 * IntegrateLossLedger — the persisted "this branch keeps losing the race for main" record behind `lore status`.
 *
 * Purpose: `lore integrate` makes at most 3 attempts per call; a branch that keeps exiting 75 must stay visible, never
 * silent (adr-main-advances-only-by-lore-integrate-per-session, "Retry bound"). One JSON file per branch under
 * `<corpus dir>/integrate-losses/` (the corpus directory beside `lore.db`, resolved through the corpus root, so a
 * session worktree that reaches the corpus through the git common dir writes the SAME ledger every session reads —
 * the foreign-write guard governs CorpusService document writes, not this verb-owned side file).
 * Public surface: IntegrateLossLedger.{recordLoss, clear, list}, IntegrateLossEntry, INTEGRATE_LOSS_DIR.
 * Invariants:
 *   - One file per branch (name = encodeURIComponent(branch)): concurrent integrators of DIFFERENT branches never
 *     write the same file, so no lock is needed; a write is tmp + rename, so a reader never sees a torn file.
 *   - `losses` counts CONSECUTIVE lost CAS attempts of this branch across calls; `clear` (the branch landed, or was
 *     found already integrated) removes the file — the entry exists exactly while the branch has not landed.
 *   - A corrupt or unreadable file is returned as err, never skipped: a status that hid it would show a starving
 *     branch as healthy.
 * Side-effect class: IO (fs under the ledger directory).
 *
 * Source: spec-main-advances-only-through-lore-integrate-per-session AC-INT-1 (5), BR-1245.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { err, ok, type LoreError, type Result } from "@lore/core";

/** Directory name of the ledger inside the corpus directory. */
export const INTEGRATE_LOSS_DIR = "integrate-losses";

/** How many of the most recent "moved by" lines an entry keeps (the full history is not the point, the cause is). */
const MOVED_BY_KEPT = 10;

const IntegrateLossEntrySchema = z
  .object({
    schema_version: z.literal(1),
    branch: z.string().min(1),
    /** The branch tip at the last lost attempt. */
    tip: z.string().min(1),
    /** Consecutive lost CAS attempts of this branch, across calls, until it lands. */
    losses: z.number().int().positive(),
    /** `<sha12> <subject>` of the commits that moved main, most recent last. */
    moved_by: z.array(z.string()),
    updated_at: z.string().min(1),
  })
  .strict();

/** One starving branch. */
export type IntegrateLossEntry = z.infer<typeof IntegrateLossEntrySchema>;

function storeError(message: string, cause: unknown): LoreError {
  return { code: "STORE_ERROR", message, ...(cause instanceof Error ? { cause } : {}) };
}

export class IntegrateLossLedger {
  /**
   * @param corpusDir - the corpus directory (the one holding `lore.db`)
   * @param now - clock port (ISO string), so tests need no wall clock
   */
  constructor(
    private readonly corpusDir: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  private get dir(): string {
    return join(this.corpusDir, INTEGRATE_LOSS_DIR);
  }

  private fileFor(branch: string): string {
    return join(this.dir, `${encodeURIComponent(branch)}.json`);
  }

  /** Reads one branch's entry; `undefined` when the branch has none. */
  private read(file: string): Result<IntegrateLossEntry | undefined, LoreError> {
    if (!existsSync(file)) return ok(undefined);
    try {
      return ok(IntegrateLossEntrySchema.parse(JSON.parse(readFileSync(file, "utf8"))));
    } catch (cause) {
      return err(storeError(`integrate loss ledger entry ${file} is unreadable or malformed; fix or delete it`, cause));
    }
  }

  /**
   * Adds one lost CAS attempt to the branch's consecutive count and persists it.
   *
   * @param branch - the branch as typed to `lore integrate`
   * @param tip - the branch tip commit at this attempt
   * @param movedBy - `<sha12> <subject>` lines naming what moved main
   * @returns the entry after the write (its `losses` is the number to print)
   */
  recordLoss(branch: string, tip: string, movedBy: readonly string[]): Result<IntegrateLossEntry, LoreError> {
    const file = this.fileFor(branch);
    const previous = this.read(file);
    if (!previous.ok) return previous;
    const entry: IntegrateLossEntry = {
      schema_version: 1,
      branch,
      tip,
      losses: (previous.value?.losses ?? 0) + 1,
      moved_by: [...(previous.value?.moved_by ?? []), ...movedBy].slice(-MOVED_BY_KEPT),
      updated_at: this.now(),
    };
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(entry, null, 2)}\n`);
      renameSync(tmp, file);
      return ok(entry);
    } catch (cause) {
      return err(storeError(`cannot record the lost race of ${branch} under ${this.dir}`, cause));
    }
  }

  /** Removes the branch's entry (it landed or was already integrated). Absent is fine; idempotent. */
  clear(branch: string): Result<void, LoreError> {
    try {
      rmSync(this.fileFor(branch), { force: true });
      return ok(undefined);
    } catch (cause) {
      return err(storeError(`cannot clear the loss entry of ${branch} under ${this.dir}`, cause));
    }
  }

  /** Every starving branch, most losses first (ties by branch name). A malformed entry is an error, not a skip. */
  list(): Result<IntegrateLossEntry[], LoreError> {
    if (!existsSync(this.dir)) return ok([]);
    const entries: IntegrateLossEntry[] = [];
    try {
      for (const name of readdirSync(this.dir)) {
        if (!name.endsWith(".json")) continue;
        const read = this.read(join(this.dir, name));
        if (!read.ok) return read;
        if (read.value !== undefined) entries.push(read.value);
      }
    } catch (cause) {
      return err(storeError(`cannot list the integrate loss ledger under ${this.dir}`, cause));
    }
    entries.sort((a, b) => b.losses - a.losses || a.branch.localeCompare(b.branch));
    return ok(entries);
  }
}
