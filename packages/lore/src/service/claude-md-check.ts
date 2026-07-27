/**
 * SPEC-project-claude-md-content-contract-governance-injected — pure
 * line/byte ceiling lint backing `lore status --check-claude-md`. Mirrors
 * `prd-budget-check.ts`'s purity convention: this module never touches a
 * `StoreInterface`, the filesystem, or wall-clock time; every fact it needs
 * (a memory file's path/role/content, the corpus-governed budget) is passed
 * in by the caller (the CLI adapter reads files via `real-memory-file-probe.ts`
 * and config via `resolveMemoryFileBudgets`).
 *
 * Public surface:
 *   - lintMemoryFiles(files, budgets) — the full ceiling oracle: for every
 *     file, measures line count AND `Buffer.byteLength` and reports every
 *     ceiling breach (never short-circuits after the first).
 *
 * Invariants:
 *   - `budgets.enabled === false` short-circuits to zero findings for every
 *     input, regardless of content (spec §D1: the check is a global opt-out,
 *     never a per-file one).
 *   - Both metrics are ALWAYS measured for every file, independently — a
 *     file over both ceilings produces two findings (`max_lines` AND
 *     `max_bytes`), never just the first one hit (spec §D2: each metric
 *     catches a bloat class the other misses).
 *   - Line count is `content.split("\n").length`, minus 1 when content ends
 *     with `"\n"` (the trailing empty element after a final-newline split is
 *     not itself a line) — mirrors `receipt-log.ts`'s established convention
 *     for this exact ambiguity.
 *   - Byte count is `Buffer.byteLength(content, "utf8")`, never
 *     `content.length` (UTF-16 code units) — a CJK-heavy file can sit well
 *     under a `.length`-based ceiling while its real UTF-8 byte size is
 *     multiples over it (the false-oracle class this module exists to
 *     catch).
 *   - Each role (`"root"` | `"module"`) is checked against its OWN ceiling
 *     pair from `budgets` — never a single shared ceiling.
 *
 * Side-effect class: pure
 *
 * Source: spec-project-claude-md-content-contract-governance-injected, AC-CMC-1
 */

import type { MemoryFileBudgets } from "@lore/core";

// ─── Memory File Record (caller-assembled, e.g. by real-memory-file-probe.ts) ─

/** A discovered project memory file's role — governs which ceiling pair applies. */
export type MemoryFileRole = "root" | "module";

/**
 * One memory file's facts as measured by the caller (typically
 * `real-memory-file-probe.ts`'s filesystem discovery walk). `content` is the
 * file's raw text — `lintMemoryFiles` does all line/byte measurement itself
 * from this single value (module header's single-measurement-point
 * invariant), never from caller-precomputed counts.
 */
export interface MemoryFileRecord {
  /** Repo-relative path, used verbatim in finding messages. */
  path: string;
  role: MemoryFileRole;
  content: string;
}

// ─── Finding ────────────────────────────────────────────────────────────────

/** Which ceiling a {@link MemoryFileFinding} reports a breach of. */
export type MemoryFileFindingKind = "max_lines" | "max_bytes";

/**
 * One ceiling breach — flat and serializable (CLI rendering is the caller's
 * job, this module never formats output beyond the `message` field).
 */
export interface MemoryFileFinding {
  path: string;
  role: MemoryFileRole;
  kind: MemoryFileFindingKind;
  /** The measured line count or byte count, matching `kind`. */
  measured: number;
  /** The ceiling from `budgets` that was exceeded, matching `kind`+`role`. */
  ceiling: number;
  /** Human-readable summary — always names `path`. */
  message: string;
}

// ─── Measurement ────────────────────────────────────────────────────────────

/**
 * Counts lines the same way this module's fixtures/spec define "a line":
 * `content.split("\n").length`, minus 1 when content ends with `"\n"` (the
 * trailing empty element after a final-newline split is not itself a line).
 */
function countLines(content: string): number {
  const parts = content.split("\n");
  return content.endsWith("\n") ? parts.length - 1 : parts.length;
}

// ─── Lint ───────────────────────────────────────────────────────────────────

/**
 * Lints every memory file's line count and UTF-8 byte size against its
 * role's ceiling pair.
 *
 * @param files - Discovered memory files (see {@link MemoryFileRecord}).
 * @param budgets - Corpus-governed ceilings, resolved via
 *   `resolveMemoryFileBudgets` (`@lore/core`) — never hardcoded here.
 * @returns One {@link MemoryFileFinding} per breached ceiling. Empty array
 *   when `budgets.enabled` is `false`, `files` is empty, or every file is
 *   within both ceilings for its role.
 * @example
 * lintMemoryFiles(
 *   [{ path: "CLAUDE.md", role: "root", content: "..." }],
 *   resolveMemoryFileBudgets(config),
 * );
 * // => [{ path: "CLAUDE.md", role: "root", kind: "max_lines", measured: 301, ceiling: 300, message: "..." }]
 */
export function lintMemoryFiles(
  files: MemoryFileRecord[],
  budgets: MemoryFileBudgets,
): MemoryFileFinding[] {
  if (!budgets.enabled) return [];

  const findings: MemoryFileFinding[] = [];

  for (const file of files) {
    const ceilings = budgets[file.role];

    const lineCount = countLines(file.content);
    if (lineCount > ceilings.max_lines) {
      findings.push({
        path: file.path,
        role: file.role,
        kind: "max_lines",
        measured: lineCount,
        ceiling: ceilings.max_lines,
        message: `${file.path} is ${lineCount} lines, exceeding the ${file.role} max_lines ceiling of ${ceilings.max_lines}`,
      });
    }

    const byteCount = Buffer.byteLength(file.content, "utf8");
    if (byteCount > ceilings.max_bytes) {
      findings.push({
        path: file.path,
        role: file.role,
        kind: "max_bytes",
        measured: byteCount,
        ceiling: ceilings.max_bytes,
        message: `${file.path} is ${byteCount} bytes, exceeding the ${file.role} max_bytes ceiling of ${ceilings.max_bytes}`,
      });
    }
  }

  return findings;
}
