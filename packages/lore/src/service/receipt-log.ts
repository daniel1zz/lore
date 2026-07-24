/**
 * ReceiptLog — consumer-side append-only JSONL history of filed
 * `lore report-issue` reports (SPEC-072 §4).
 *
 * One JSON line per successfully-filed report, written to
 * `<consumer-repo>/.lore/issue-receipts.jsonl` (path resolution is the
 * CALLER's job — this class takes an already-resolved `filePath`, mirroring
 * `JsonlTelemetry`'s constructor shape in
 * `packages/core/src/telemetry-node.ts`). Unlike telemetry, `read()` here is
 * NOT a write-only sink — `lore report-issue --list` needs the full history
 * back, so corruption on the read side is a first-class, reported outcome
 * rather than a swallowed one.
 *
 * Public surface:
 *   - `ReceiptLog` — `append(entry)` / `read()`.
 *
 * Invariants:
 *   - `append` creates the parent directory (`mkdirSync(..., {recursive:
 *     true})`) on construction, same as `JsonlTelemetry` — callers never
 *     need to pre-create `.lore/`.
 *   - `read` NEVER throws, even against a missing file, a 0-byte file, or a
 *     file with corrupt lines interleaved among valid ones. A missing file
 *     is a valid empty-history state (`{entries: [], corrupt_lines: []}`),
 *     not an error.
 *   - `read` is side-effect-free — it never rewrites, truncates, or
 *     "repairs" the file. Corrupt lines are reported via `corrupt_lines`
 *     (1-indexed physical line numbers) and otherwise left exactly as they
 *     were found; only `append` ever mutates the file.
 *   - A line is "corrupt" if it is non-blank AND either fails `JSON.parse`
 *     or parses to a value that doesn't match `ReceiptEntrySchema` (e.g. a
 *     JSON object missing `upstream_doc_id`). A blank line (the trailing
 *     newline every `append` call leaves, or the entire content of a 0-byte
 *     file) is neither an entry nor corrupt — it is simply skipped.
 *
 * Side-effect class: IO (file read/write under the caller-supplied path).
 *
 * Source: SPEC-072 §4 Public Interface (`ReceiptLog`), §5 step 9, §11
 * Downstream Handoff ("Corruption is reported, not repaired").
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { err, ok, type LoreError, type Result } from "@lore/core";

/**
 * Shape of one persisted receipt line. Matches the `entry` shape
 * `IssueReportService.report` passes to `append` (SPEC-072 §5 step 9) —
 * `.strict()` so a line carrying stray extra keys (a hand-edited file, or a
 * future schema drift) is treated as corrupt rather than silently accepted
 * with the extra data dropped.
 */
const receiptEntrySchema = z
  .object({
    upstream_doc_id: z.string().min(1),
    title: z.string().min(1),
    at: z.string().min(1),
  })
  .strict();

/** One filed report's receipt, as persisted by `ReceiptLog.append`. */
export type ReceiptEntry = z.infer<typeof receiptEntrySchema>;

/** Result of `ReceiptLog.read()`. */
export interface ReceiptReadResult {
  entries: ReceiptEntry[];
  /** 1-indexed physical line numbers of every line that failed to parse. */
  corrupt_lines: number[];
}

/**
 * Consumer-side append-only JSONL receipt log for filed upstream issue
 * reports. One instance per file path — construction is cheap (a single
 * `mkdirSync`), so callers may create a fresh instance per call rather than
 * holding one long-lived.
 *
 * @example
 * const log = new ReceiptLog("/repo/.lore/issue-receipts.jsonl");
 * const appendResult = log.append({upstream_doc_id: "01ABC", title: "bug", at: new Date().toISOString()});
 * const readResult = log.read();
 * if (readResult.ok) console.log(readResult.value.entries.length);
 */
export class ReceiptLog {
  private readonly filePath: string;

  /**
   * @param filePath - absolute or relative path to the JSONL receipt file.
   *   The parent directory is created if missing (mirrors
   *   `JsonlTelemetry`'s constructor).
   */
  constructor(filePath: string) {
    this.filePath = filePath;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch {
      // reason: mirrors JsonlTelemetry — a directory-creation failure
      // (permissions, etc.) leaves append() to fail loud on its own IO
      // attempt rather than throwing here at construction time.
    }
  }

  /**
   * Appends one JSON line to the receipt file.
   *
   * @param entry - the receipt fields to persist verbatim (no derived
   *   fields, no defaulting — the caller has already assembled the exact
   *   shape to write)
   * @returns `ok(undefined)` on success; `err({code: "STORE_ERROR", ...})`
   *   if the underlying `appendFileSync` throws (disk full, permissions,
   *   etc.) — IO failures here are NOT swallowed (unlike `JsonlTelemetry`,
   *   whose invariant is "never break the caller"); `IssueReportService`
   *   needs to know a receipt failed to record so it can surface a loud,
   *   specific error (SPEC-072 §5 step 9).
   */
  append(entry: ReceiptEntry): Result<void, LoreError> {
    try {
      appendFileSync(this.filePath, JSON.stringify(entry) + "\n", "utf8");
      return ok(undefined);
    } catch (error) {
      return err({
        code: "STORE_ERROR",
        message: `failed to append receipt to '${this.filePath}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        ...(error instanceof Error ? { cause: error } : {}),
      });
    }
  }

  /**
   * Reads every receipt line back, skipping (never throwing on) corrupt
   * lines and reporting their 1-indexed physical line numbers.
   *
   * @returns `ok({entries, corrupt_lines})` — a missing file, a 0-byte
   *   file, and a file with corrupt lines interleaved among valid ones all
   *   resolve successfully; `err({code: "STORE_ERROR", ...})` only if the
   *   file EXISTS but the read itself fails (permissions, etc.)
   */
  read(): Result<ReceiptReadResult, LoreError> {
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
      });
    }

    const rawLines = content.split("\n");
    const entries: ReceiptEntry[] = [];
    const corruptLines: number[] = [];

    rawLines.forEach((rawLine, index) => {
      // reason: a trailing newline (every append() call writes one) yields
      // an empty final element after split("\n"); a 0-byte file yields a
      // single empty element. Neither is a data line — skip silently,
      // never counted as corrupt (see module invariant above).
      if (rawLine.trim() === "") return;

      const lineNumber = index + 1;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawLine);
      } catch {
        corruptLines.push(lineNumber);
        return;
      }

      const validated = receiptEntrySchema.safeParse(parsed);
      if (!validated.success) {
        corruptLines.push(lineNumber);
        return;
      }
      entries.push(validated.data);
    });

    return ok({ entries, corrupt_lines: corruptLines });
  }
}
