/**
 * ReceiptLogV2 — two-phase (intent-then-outcome) append-only local record
 * of filed `lore report-issue` reports, on a NEW file path distinct from
 * the v1 `ReceiptLog` (`packages/lore/src/service/receipt-log.ts`).
 *
 * Why a new file instead of extending v1's schema: v1's
 * `receiptEntrySchema` is `.strict()` over exactly
 * `{upstream_doc_id, title, at}` (receipt-log.ts:53-59), and the live
 * ledger already holds 12 legacy rows written under that exact shape.
 * Adding fields to that schema would make every new line parse-FAIL
 * under any older binary still reading the strict v1 shape. So v2 lives
 * on its own path with its own reader — one that ALSO tolerates a file
 * still written in the old v1 shape (a v2 reader pointed at a legacy
 * file must return its rows, never report them corrupt — see `read()`).
 *
 * Two-phase design (spec-the-defect-channel-reaches-no-machine-but-its-own-github,
 * Risk R4): an `intent` line is appended BEFORE the network call that
 * files the upstream issue; an `outcome` line is appended AFTER it
 * succeeds. This is a DELIBERATE, LOCAL-ONLY break of the old "zero
 * writes before a successful create" invariant — see the `appendIntent`
 * doc comment for the reasoning, and do not "fix" it back to
 * append-after-success; that is the exact defect this design exists to
 * close (an intent with no matching outcome for its `idempotency_key` IS
 * the reconcile signal).
 *
 * Public surface:
 *   - `ReceiptLogV2` — `appendIntent(entry)` / `appendOutcome(entry)` /
 *     `read()`.
 *
 * Invariants:
 *   - `appendIntent` and `appendOutcome` are two DISTINCT methods (not one
 *     `append({phase, ...})`) so a caller cannot mis-tag a phase at the
 *     call site — the method name IS the phase.
 *   - `read()` NEVER throws. A missing/0-byte file is valid-empty. A
 *     corrupt or truncated line (e.g. a crash mid-append) is reported via
 *     `corrupt_lines` (1-indexed physical line numbers), never silently
 *     dropped or repaired, and every OTHER parseable line is still
 *     returned.
 *   - The raw log never dedupes: a retried `appendIntent` under the same
 *     `idempotency_key` after a prior `appendOutcome` produces TWO intent
 *     lines and one outcome line in `read()`'s output — reconciling
 *     intents to outcomes by key is the CALLER's job, not this class's.
 *   - This module asserts only the log's own read/write contract. The
 *     intent-before-network-call ORDERING is enforced by the caller (the
 *     GitHub intake port) — see that task's own AC; this module has no
 *     network dependency at all.
 *
 * Side-effect class: IO (file read/write under the caller-supplied path).
 *
 * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github,
 * AC-GI-3, Risk R4. Contract pinned test-first by
 * packages/lore/tests/unit/service/receipt-log-v2.test.ts.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { err, ok, type LoreError, type Result } from "@lore/core";

/** One `intent` line: appended before the network call that files the upstream issue. */
const receiptIntentEntrySchema = z
  .object({
    phase: z.literal("intent"),
    idempotency_key: z.string().min(1),
    title: z.string().min(1),
    at: z.string().min(1),
  })
  .strict();

/** One `outcome` line: appended after the network call succeeds. */
const receiptOutcomeEntrySchema = z
  .object({
    phase: z.literal("outcome"),
    idempotency_key: z.string().min(1),
    number: z.number(),
    url: z.string().min(1),
    at: z.string().min(1),
  })
  .strict();

/**
 * A legacy v1 row — carries NO `phase` field at all. Mirrors
 * `receiptEntrySchema` in `receipt-log.ts:53-59` exactly, DUPLICATED
 * rather than imported: v1 keeps that schema module-private (it is not
 * exported), and v2 must keep reading the v1 on-disk shape as its own
 * fixed contract even if v1's schema definition ever moves or changes
 * shape internally.
 */
const legacyReceiptEntrySchema = z
  .object({
    upstream_doc_id: z.string().min(1),
    title: z.string().min(1),
    at: z.string().min(1),
  })
  .strict();

/**
 * Union of every line shape the v2 reader accepts: the two v2 phases plus
 * the legacy v1 shape. The three schemas are mutually exclusive under
 * `.strict()` (a legacy row has no `phase` key at all; an intent/outcome
 * row has no `upstream_doc_id` key), so a well-formed line always matches
 * exactly one branch.
 */
const receiptV2LineSchema = z.union([
  receiptIntentEntrySchema,
  receiptOutcomeEntrySchema,
  legacyReceiptEntrySchema,
]);

/** One persisted `intent` line, as validated by `read()`. */
export type ReceiptIntentEntry = z.infer<typeof receiptIntentEntrySchema>;

/** One persisted `outcome` line, as validated by `read()`. */
export type ReceiptOutcomeEntry = z.infer<typeof receiptOutcomeEntrySchema>;

/** One legacy v1 row, read back through the v2 reader unchanged. */
export type LegacyReceiptEntry = z.infer<typeof legacyReceiptEntrySchema>;

/** One persisted v2 line, of either phase, or a legacy v1 row read back through the v2 reader. */
export type ReceiptV2Entry = ReceiptIntentEntry | ReceiptOutcomeEntry | LegacyReceiptEntry;

/** Fields the caller supplies to `appendIntent` — `phase` is implicit in the method name, never passed in. */
export type ReceiptIntentInput = Omit<ReceiptIntentEntry, "phase">;

/** Fields the caller supplies to `appendOutcome` — `phase` is implicit in the method name, never passed in. */
export type ReceiptOutcomeInput = Omit<ReceiptOutcomeEntry, "phase">;

/** Result of `ReceiptLogV2.read()`. */
export interface ReceiptV2ReadResult {
  entries: ReceiptV2Entry[];
  /** 1-indexed physical line numbers of every line that failed to parse or validate (includes a truncated final line). */
  corrupt_lines: number[];
}

/**
 * Two-phase append-only JSONL receipt log for filed upstream issue
 * reports, on a path distinct from v1's `ReceiptLog`. One instance per
 * file path — construction is cheap (a single `mkdirSync`), so callers
 * may create a fresh instance per call rather than holding one
 * long-lived.
 *
 * @example
 * const log = new ReceiptLogV2("/repo/.lore/issue-receipts-v2.jsonl");
 * const key = crypto.randomUUID(); // caller-generated idempotency_key (ULID in production)
 * const intentResult = log.appendIntent({idempotency_key: key, title: "bug", at: new Date().toISOString()});
 * // ... network call to file the upstream issue happens here ...
 * const outcomeResult = log.appendOutcome({idempotency_key: key, number: 42, url: "https://github.com/...", at: new Date().toISOString()});
 * const readResult = log.read();
 * if (readResult.ok) console.log(readResult.value.entries.length);
 */
export class ReceiptLogV2 {
  private readonly filePath: string;

  /**
   * @param filePath - absolute or relative path to the JSONL receipt
   *   file. The parent directory is created if missing (mirrors
   *   `ReceiptLog` / `JsonlTelemetry`).
   */
  constructor(filePath: string) {
    this.filePath = filePath;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch {
      // reason: mirrors ReceiptLog/JsonlTelemetry — a directory-creation
      // failure (permissions, etc.) leaves append to fail loud on its own
      // IO attempt rather than throwing here at construction time.
    }
  }

  /**
   * Appends an `intent` line BEFORE the network call that files the
   * upstream issue is made.
   *
   * reason: this is a DELIBERATE, LOCAL-ONLY break of the historical
   * "zero writes before a successful create" invariant (see
   * receipt-log.ts's module doc, and SPEC risk R4) — this write happens
   * before the network call is even attempted, so a filing that never
   * reaches GitHub (crash, network failure, `gh` error) still leaves a
   * durable local trace instead of none. This does NOT reintroduce a
   * pre-success UPSTREAM write: no GitHub call happens in this method,
   * only a local file append. Do NOT "fix" this back to
   * append-after-success — that is exactly the defect this two-phase
   * design exists to close.
   *
   * @param entry - `idempotency_key` (client-generated ULID that pairs
   *   this line with its eventual `appendOutcome` call), `title`, `at`
   * @returns `ok(undefined)` on success; `err({code: "STORE_ERROR", ...})`
   *   if the underlying `appendFileSync` throws (disk full, permissions,
   *   etc.)
   */
  appendIntent(entry: ReceiptIntentInput): Result<void, LoreError> {
    return this.appendLine({ phase: "intent", ...entry });
  }

  /**
   * Appends an `outcome` line AFTER the network call that filed the
   * upstream issue has succeeded.
   *
   * @param entry - `idempotency_key` (the SAME key passed to the paired
   *   `appendIntent` call), `number` (the upstream issue number), `url`,
   *   `at`
   * @returns `ok(undefined)` on success; `err({code: "STORE_ERROR", ...})`
   *   if the underlying `appendFileSync` throws (disk full, permissions,
   *   etc.)
   */
  appendOutcome(entry: ReceiptOutcomeInput): Result<void, LoreError> {
    return this.appendLine({ phase: "outcome", ...entry });
  }

  private appendLine(line: ReceiptIntentEntry | ReceiptOutcomeEntry): Result<void, LoreError> {
    try {
      appendFileSync(this.filePath, JSON.stringify(line) + "\n", "utf8");
      return ok(undefined);
    } catch (error) {
      return err({
        code: "STORE_ERROR",
        message: `failed to append receipt to '${this.filePath}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        ...(error instanceof Error ? { cause: error } : {}),
        rule: "BR-497",
      });
    }
  }

  /**
   * Reads every line back — `intent`, `outcome`, and legacy v1 rows
   * alike — skipping (never throwing on) corrupt or truncated lines and
   * reporting their 1-indexed physical line numbers.
   *
   * @returns `ok({entries, corrupt_lines})` — a missing file, a 0-byte
   *   file, and a file with corrupt/truncated lines interleaved among
   *   valid ones all resolve successfully; `err({code: "STORE_ERROR", ...})`
   *   only if the file EXISTS but the read itself fails (permissions,
   *   etc.)
   */
  read(): Result<ReceiptV2ReadResult, LoreError> {
    if (!existsSync(this.filePath)) {
      return ok({ entries: [], corrupt_lines: [] });
    }

    let content: string;
    try {
      content = readFileSync(this.filePath, "utf8");
    } catch (error) {
      return err({
        code: "STORE_ERROR",
        message: `failed to read receipt log at '${this.filePath}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        ...(error instanceof Error ? { cause: error } : {}),
        rule: "BR-500",
      });
    }

    const rawLines = content.split("\n");
    const entries: ReceiptV2Entry[] = [];
    const corruptLines: number[] = [];

    rawLines.forEach((rawLine, index) => {
      // reason: mirrors ReceiptLog — a trailing newline (every append
      // call writes one) yields an empty final element after
      // split("\n"); a 0-byte file yields a single empty element. Neither
      // is a data line nor a truncated one — skip silently, never counted
      // as corrupt.
      if (rawLine.trim() === "") return;

      const lineNumber = index + 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawLine);
      } catch {
        // reason: covers BOTH a genuinely malformed line and a truncated
        // final line left behind by a crash mid-append (unterminated
        // JSON) — both fail JSON.parse identically, and both are
        // reported here rather than silently dropped.
        corruptLines.push(lineNumber);
        return;
      }

      const validated = receiptV2LineSchema.safeParse(parsed);
      if (!validated.success) {
        corruptLines.push(lineNumber);
        return;
      }
      entries.push(validated.data);
    });

    return ok({ entries, corrupt_lines: corruptLines });
  }
}
