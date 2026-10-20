/**
 * Pushed decision-chain heads — the local ledger `pre-push` checks the decision log against.
 *
 * Purpose: the decision log is local and hash-chained, so a database rewritten from scratch (thresholds edited AND the
 * chain rebuilt to match) verifies as a clean chain. What it cannot do is reproduce a head that was already offered to
 * a remote: that hash covers every row before it. This ledger remembers each head `pre-push` let through; the next
 * push (and mirror export) demands that the local log still reproduces all of them.
 * Public surface: PUSHED_HEADS_FILE, pushedHeadsPath, readPushedHeads, verifyPushedHeads, recordPushedHead.
 * Invariants:
 *   - Machine-local on purpose, stored NEXT TO the corpus database inside `.lore/` (git-ignored): another machine's
 *     log has a different history, so a shared (git-tracked) head would fail every honest second machine. The
 *     git-tracked half of the design is the mirror file (`.lore/autonomy-mirror.json`), which carries the record and
 *     the head as of the last export so a rewrite is also visible in git history.
 *   - A missing ledger is "nothing pushed yet" (ok, empty). An unreadable or malformed ledger is an ERROR, never empty:
 *     emptying it would be the way to dodge the check.
 *   - Recording happens after verification passed, in the same pre-push run; a push that later fails at the network
 *     leaves a head recorded that the (append-only) log reproduces anyway, so it can never cause a false alarm.
 * Side-effect class: IO (reads/writes one JSON file).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-9 (integrity half 5, pre-push);
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D8.
 */
import { err, ok, type LoreError, type Result } from "@lore/core";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { DecisionChainHead, DecisionLogRow } from "../../store/decision-log.js";
import { reproducesHead, type HeadReproduction } from "../../service/autonomy-threshold-service.js";

/** File name inside the corpus directory (beside `lore.db`). */
export const PUSHED_HEADS_FILE = "autonomy-pushed-heads.json";

const ledgerSchema = z
  .object({
    version: z.literal(1),
    heads: z.array(
      z.object({ head_id: z.number().int().positive(), head_hash: z.string().min(1), count: z.number().int().positive(), recorded_at: z.string().min(1) }).strict(),
    ),
  })
  .strict();
type Ledger = z.infer<typeof ledgerSchema>;
export type PushedHead = Ledger["heads"][number];

function ledgerError(message: string): LoreError {
  return { code: "STORE_ERROR", message, rule: "BR-1264" };
}

/** The ledger path for the corpus database at `dbPath`. */
export function pushedHeadsPath(dbPath: string): string {
  return join(dirname(dbPath), PUSHED_HEADS_FILE);
}

/** Every recorded pushed head, oldest first. Missing file -> []; unreadable or malformed -> err. */
export function readPushedHeads(path: string): Result<PushedHead[], LoreError> {
  if (!existsSync(path)) return ok([]);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    /** @lore-site BR-1264 */
    return err(ledgerError(`pushed-heads ledger ${path} is unreadable: ${String(cause)}`));
  }
  const parsed = ledgerSchema.safeParse(json);
  /** @lore-site BR-1264 */
  if (!parsed.success) return err(ledgerError(`pushed-heads ledger ${path} has an unexpected shape: ${parsed.error.issues[0]?.message ?? "invalid"}`));
  return ok(parsed.data.heads);
}

export type PushedHeadsVerdict =
  | { readonly clean: true; readonly checked: number }
  | { readonly clean: false; readonly checked: number; readonly failures: readonly { readonly head: PushedHead; readonly why: Extract<HeadReproduction, { reproduced: false }> }[] };

/** Whether `rows` (the whole local decision log) reproduce EVERY head in `heads`. */
export function verifyPushedHeads(rows: readonly DecisionLogRow[], heads: readonly PushedHead[]): PushedHeadsVerdict {
  const failures: { head: PushedHead; why: Extract<HeadReproduction, { reproduced: false }> }[] = [];
  for (const head of heads) {
    const result = reproducesHead(rows, head);
    if (!result.reproduced) failures.push({ head, why: result });
  }
  return failures.length === 0 ? { clean: true, checked: heads.length } : { clean: false, checked: heads.length, failures };
}

/** Appends `head` to the ledger (no-op when it is already the newest entry). Atomic via temp file + rename. */
export function recordPushedHead(path: string, head: DecisionChainHead, recordedAt: string): Result<void, LoreError> {
  const existing = readPushedHeads(path);
  if (!existing.ok) return existing;
  const last = existing.value[existing.value.length - 1];
  if (last !== undefined && last.head_id === head.head_id && last.head_hash === head.head_hash) return ok(undefined);
  const next: Ledger = { version: 1, heads: [...existing.value, { head_id: head.head_id, head_hash: head.head_hash, count: head.count, recorded_at: recordedAt }] };
  const temp = `${path}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    renameSync(temp, path);
  } catch (cause) {
    return err(ledgerError(`could not write pushed-heads ledger ${path}: ${String(cause)}`));
  }
  return ok(undefined);
}
