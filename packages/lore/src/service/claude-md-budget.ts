/**
 * SPEC-project-claude-md-content-contract-governance-injected /
 * spec-context-verb-family-two-zone-claude-md-anatomy-lore — pure CAPACITY
 * checks (line/byte ceilings) for project memory files. Split from the
 * former `claude-md-check.ts` (spec-claude-md-governance-content-dimension-
 * checks-wire-the, N12: the split precedes the new Phase 2+ content
 * metrics): this module owns capacity; content checks (reference existence,
 * narrative smells) live in the sibling `claude-md-admission.ts`; shared
 * finding/record types live in `claude-md-findings.ts`. Mirrors
 * `prd-budget-check.ts`'s purity convention: this module never touches a
 * `StoreInterface`, the filesystem, or wall-clock time — every fact it
 * needs (a memory file's path/role/content, the corpus-governed budget) is
 * passed in by the caller (the CLI adapter reads files via
 * `real-memory-file-probe.ts`, config via `resolveMemoryFileBudgets`).
 *
 * Public surface:
 *   - lintMemoryFiles(files, budgets) — the full ceiling oracle: for every
 *     file, measures line count AND `Buffer.byteLength` and reports every
 *     ceiling breach (never short-circuits after the first) PLUS every metric
 *     that has crossed the eviction floor below the ceiling. DETERMINISTIC,
 *     exit-relevant (`kind: "max_lines" | "max_bytes" | "eviction_required"`).
 *     ⛔ NOT called directly by any production call site — `claude-md-
 *     admission.ts`'s `runMemoryFileChecks` is the SOLE composition entry it
 *     routes through (AC-COMPOSE-1, spec-claude-md-governance-content-
 *     dimension-checks-wire-the).
 *   - computeHeadroom(files, budgets) — DETERMINISTIC, NEVER exit-relevant:
 *     the reporting counterpart to `lintMemoryFiles` — for EVERY file it
 *     returns the SAME two measurements (`countLines`/`Buffer.byteLength`)
 *     against the SAME per-role ceiling pair, but as used/ceiling/remaining
 *     numbers rather than a pass/fail finding, so a caller can render
 *     headroom on EVERY run, not only once a ceiling is already breached
 *     (task-lore-status-check-claude-md-reports-a-saturated-file-as: a file
 *     five bytes from its ceiling printed identically to a file at 10% used).
 *   - computeHeadroomWarnings(reports) — ADVISORY ONLY, NEVER exit-relevant:
 *     projects `computeHeadroom`'s rows whose `.warn` flag is set (used
 *     crossed `budgets.warn_threshold_fraction` of its ceiling) into
 *     `AdvisoryFinding`s — entering the near-ceiling band is worth a loud
 *     line in the report, but is NOT itself a breach; `lintMemoryFiles` alone
 *     ever decides breach/exit-code.
 *   `computeHeadroom`/`computeHeadroomWarnings` are a REPORTING layer, never
 *   a check — but they route THROUGH `claude-md-admission.ts`'s
 *   `runMemoryFileChecks` like every other metric in this mechanism (N15):
 *   Phase 1 shipped them as direct calls from `status.ts`, bypassing the
 *   declared sole entry, while AC-COMPOSE-1's banned-function list omitted
 *   exactly those two names — a self-consistent pair of statements that were
 *   jointly false. `status.ts`/`flows/context-flow.ts` must not call either
 *   directly any more.
 *
 * Three ordered bands per metric (task-a-module-claude-md-at-its-byte-ceiling-
 * silently-relocates). Both fractions come from `budgets`, never from a
 * constant here:
 *   used < ceiling*warn                  → silent
 *   ceiling*warn  <= used < ceiling*evict → ADVISORY `headroom_warning`
 *                                          (`computeHeadroomWarnings`, never
 *                                          exit-relevant)
 *   ceiling*evict <= used <= ceiling      → DETERMINISTIC `eviction_required`
 *   used > ceiling                        → DETERMINISTIC `max_lines`/`max_bytes`
 * The last two are mutually exclusive PER METRIC: a breach suppresses the
 * eviction row for that same metric, so a file over its ceiling reports
 * exactly the historical breach finding and never double-reports. WHY a third
 * band at all: the advisory band alone was measured to be ignorable — four
 * module docs sat in it for an unknown number of sessions and the count went
 * UP. At zero runway the ceiling guard blocks the one CORRECT write (recording
 * a new module in its OWN module doc), so the fact lands in a NEIGHBOURING
 * module's doc, which no mechanism reports at all
 * (`service/anchor-resolution.ts` was documented in three other module docs
 * and absent from service's own). The floor blocks while the file is still
 * writable, so eviction is always a reachable option.
 *
 * Invariants:
 *   - `budgets.enabled === false` short-circuits `lintMemoryFiles` to zero
 *     findings for every input, regardless of content (spec §D1: the check
 *     is a global opt-out, never a per-file one).
 *   - `eviction_required` is emitted from `lintMemoryFiles` and NOWHERE else,
 *     ON PURPOSE: that one function is the seam `lore status
 *     --check-claude-md`'s exit code and `--json` headroom (the latter read by
 *     `assets/hooks/stop-turn-review.mjs` finding (c), which replaced the
 *     retired `claude-md-guard.sh` PostToolUse block), `hooks/pre-push`, and `flows/context-flow.ts`'s
 *     `runContextRefresh` pre-write admission ALL already consume (via
 *     `runMemoryFileChecks`'s `deterministic` array, unchanged from
 *     `lintMemoryFiles`'s own output). Adding a second entry point would
 *     make the rule opt-in per surface — the property this mechanism exists
 *     to remove.
 *   - Both `lintMemoryFiles` metrics are ALWAYS measured for every file,
 *     independently — a file over both ceilings produces two findings
 *     (`max_lines` AND `max_bytes`), never just the first one hit (spec §D2:
 *     each metric catches a bloat class the other misses).
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
 *   - `computeHeadroom`'s `warn_threshold_fraction` comes EXCLUSIVELY from the
 *     caller-supplied `budgets` (`@lore/core`'s `contextConfigSchema`,
 *     resolved via `resolveMemoryFileBudgets`) — this module never hardcodes
 *     a near-ceiling threshold, mirroring its existing rule for the
 *     `max_lines`/`max_bytes` ceilings themselves (this is a project-wide
 *     "numbers live in config" discipline, not a new one introduced here).
 *   - `computeHeadroom`/`computeHeadroomWarnings` share `lintMemoryFiles`'s
 *     `budgets.enabled === false` short-circuit (empty array) and its SAME
 *     `countLines`/`Buffer.byteLength` measurement functions.
 *
 * Side-effect class: pure
 *
 * Source: spec-project-claude-md-content-contract-governance-injected,
 * AC-CMC-1; spec-context-verb-family-two-zone-claude-md-anatomy-lore, AC-CTX-2;
 * task-lore-status-check-claude-md-reports-a-saturated-file-as;
 * spec-claude-md-governance-content-dimension-checks-wire-the (split, N12).
 */

import type { MemoryFileBudgets } from "@lore/core";
import type { AdvisoryFinding, MemoryFileRecord, MemoryFileFinding } from "./claude-md-findings.js";

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

/** The metric name a finding reports on — used verbatim in messages so a reader can map a finding back to its config knob. */
type MetricName = "max_lines" | "max_bytes";

/**
 * Decides the DETERMINISTIC verdict for ONE metric of ONE file: a ceiling
 * breach, an eviction-floor crossing, or neither. Returns `undefined` for the
 * silent and advisory-only bands (the latter belongs to
 * {@link computeHeadroomWarnings}, not here).
 *
 * The two branches are mutually exclusive BY CONSTRUCTION (`>` ceiling versus
 * `<=` ceiling), which is what keeps a breach from also reporting an eviction
 * row for the same metric.
 */
function judgeMetric(
  file: MemoryFileRecord,
  metric: MetricName,
  measured: number,
  ceiling: number,
  evictThresholdFraction: number,
): MemoryFileFinding | undefined {
  if (measured > ceiling) {
    return {
      path: file.path,
      role: file.role,
      kind: metric,
      measured,
      ceiling,
      message: `${file.path} is ${measured} ${metric === "max_lines" ? "lines" : "bytes"}, exceeding the ${file.role} ${metric} ceiling of ${ceiling}`,
    };
  }

  // Cross-multiplied rather than divided, mirroring `buildMetricHeadroom`'s
  // convention for the sibling advisory band.
  if (measured >= ceiling * evictThresholdFraction) {
    return {
      path: file.path,
      role: file.role,
      kind: "eviction_required",
      measured,
      ceiling,
      message:
        `${file.path} is ${measured}/${ceiling} against the ${file.role} ${metric} ceiling ` +
        `(${ceiling - measured} remaining), at or past the eviction floor of ` +
        `${evictThresholdFraction} — evict a block to the corpus and leave a one-line pointer ` +
        `before adding to this file. ⛔ Do NOT record the displaced fact in another module's doc, ` +
        `do NOT trade lines for bytes, and do NOT raise the ceiling (\`lore governance claude-md\`)`,
    };
  }

  return undefined;
}

/**
 * Lints every memory file's line count and UTF-8 byte size against its
 * role's ceiling pair AND its eviction floor (module header's three-band
 * table).
 *
 * @param files - Discovered memory files (see {@link MemoryFileRecord}).
 * @param budgets - Corpus-governed ceilings + `evict_threshold_fraction`,
 *   resolved via `resolveMemoryFileBudgets` (`@lore/core`) — never hardcoded
 *   here.
 * @returns One {@link MemoryFileFinding} per metric that breached its ceiling
 *   OR crossed its eviction floor — never both for the same metric. Empty
 *   array when `budgets.enabled` is `false`, `files` is empty, or every file
 *   is below both floors for its role.
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

    // Both metrics ALWAYS judged, independently (spec §D2) — each catches a
    // bloat class the other misses, so neither short-circuits the other.
    const lines = judgeMetric(
      file,
      "max_lines",
      countLines(file.content),
      ceilings.max_lines,
      budgets.evict_threshold_fraction,
    );
    if (lines !== undefined) findings.push(lines);

    const bytes = judgeMetric(
      file,
      "max_bytes",
      Buffer.byteLength(file.content, "utf8"),
      ceilings.max_bytes,
      budgets.evict_threshold_fraction,
    );
    if (bytes !== undefined) findings.push(bytes);
  }

  return findings;
}

// ─── Headroom reporting (deterministic numbers + advisory warn band) ───────
// task-lore-status-check-claude-md-reports-a-saturated-file-as: a bare
// pass/fail on `lintMemoryFiles`'s findings gave an author no way to tell
// "plenty of room" from "the next byte breaches" — both rendered as "within
// budget (0 findings)". The functions below are a REPORTING layer alongside
// `lintMemoryFiles`, never a replacement for it: breach/exit-code decisions
// stay exclusively `lintMemoryFiles`'s job.

/** One metric's (lines or bytes) measured headroom against its ceiling. */
export interface MetricHeadroom {
  /** The SAME measurement `lintMemoryFiles` uses for this metric (line count or `Buffer.byteLength`). */
  used: number;
  ceiling: number;
  /** `ceiling - used` — goes negative once `used` exceeds `ceiling` (a real breach; `lintMemoryFiles` is the exit-relevant source for that, this field only reports the number). */
  remaining: number;
  /** `true` once `used` reaches `budgets.warn_threshold_fraction` of `ceiling` — the SAME predicate {@link computeHeadroomWarnings} filters on. */
  warn: boolean;
}

/**
 * One memory file's full headroom picture — BOTH metrics, always both,
 * mirroring `lintMemoryFiles`'s own "never measure just one" invariant
 * (spec §D2), but organized per-file (not per-finding) since this is a
 * REPORT meant to render on every run, not a list that is empty when
 * everything is fine.
 */
export interface HeadroomReport {
  /** The measured file's path, verbatim. */
  path: string;
  role: MemoryFileRecord["role"];
  lines: MetricHeadroom;
  bytes: MetricHeadroom;
}

/**
 * Builds one {@link MetricHeadroom} row. `warn` is a plain fraction
 * comparison (`used / ceiling >= warnThresholdFraction`, computed via
 * cross-multiplication to avoid a division) — deliberately INDEPENDENT of
 * whether `used` already exceeds `ceiling`: a breach is, by definition, also
 * "in the warn band" (both conditions can be true at once; `lintMemoryFiles`
 * alone decides what a breach means for the exit code).
 */
function buildMetricHeadroom(used: number, ceiling: number, warnThresholdFraction: number): MetricHeadroom {
  return {
    used,
    ceiling,
    remaining: ceiling - used,
    warn: used >= ceiling * warnThresholdFraction,
  };
}

/**
 * Computes a {@link HeadroomReport} for every file — the used/ceiling/
 * remaining numbers `lore status --check-claude-md` (and any other caller)
 * needs to show real margin instead of a bare pass/fail. This is a
 * REPORTING function: it never affects, and is never affected by,
 * `lintMemoryFiles`'s exit-relevant findings.
 *
 * @param files - Discovered memory files (see {@link MemoryFileRecord}).
 * @param budgets - Corpus-governed ceilings AND `warn_threshold_fraction`,
 *   resolved via `resolveMemoryFileBudgets` (`@lore/core`) — the config knob
 *   backing `.warn` on each row, never a hardcoded fraction.
 * @returns One {@link HeadroomReport} per file (both metrics inside). Empty
 *   array when `budgets.enabled` is `false` or `files` is empty — mirrors
 *   `lintMemoryFiles`'s own `enabled` short-circuit (spec §D1: a global
 *   opt-out, never per-file).
 * @example
 * computeHeadroom(
 *   [{ path: "CLAUDE.md", role: "root", content: "..." }],
 *   resolveMemoryFileBudgets(config),
 * );
 * // => [{ path: "CLAUDE.md", role: "root",
 * //       lines: { used: 289, ceiling: 300, remaining: 11, warn: false },
 * //       bytes: { used: 24571, ceiling: 24576, remaining: 5, warn: true } }]
 */
export function computeHeadroom(files: MemoryFileRecord[], budgets: MemoryFileBudgets): HeadroomReport[] {
  if (!budgets.enabled) return [];

  return files.map((file) => {
    const ceilings = budgets[file.role];
    const lineCount = countLines(file.content);
    const byteCount = Buffer.byteLength(file.content, "utf8");

    return {
      path: file.path,
      role: file.role,
      lines: buildMetricHeadroom(lineCount, ceilings.max_lines, budgets.warn_threshold_fraction),
      bytes: buildMetricHeadroom(byteCount, ceilings.max_bytes, budgets.warn_threshold_fraction),
    };
  });
}

/**
 * Projects {@link computeHeadroom}'s rows whose `.warn` flag is set into
 * {@link AdvisoryFinding}s (`kind: "headroom_warning"`) — ADVISORY ONLY,
 * NEVER exit-relevant: entering the near-ceiling band is worth a loud line
 * in the report, but is NOT itself a breach.
 *
 * @param reports - {@link computeHeadroom}'s own output for the SAME files
 *   this call is reporting on — never independently recomputed.
 * @returns One `headroom_warning` finding per (file, metric) row crossing
 *   the band — a file near BOTH ceilings produces two findings. Empty array
 *   when no row crosses the band (the CONTROL requirement: a comfortably-
 *   small file must stay silent here, never "always warns").
 * @example
 * computeHeadroomWarnings([
 *   { path: "CLAUDE.md", role: "root",
 *     lines: { used: 289, ceiling: 300, remaining: 11, warn: false },
 *     bytes: { used: 24571, ceiling: 24576, remaining: 5, warn: true } },
 * ]);
 * // => [{ kind: "headroom_warning", measured: 5, message: "..." }]
 */
export function computeHeadroomWarnings(reports: HeadroomReport[]): AdvisoryFinding[] {
  const findings: AdvisoryFinding[] = [];

  for (const report of reports) {
    if (report.lines.warn) {
      findings.push({
        kind: "headroom_warning",
        measured: report.lines.remaining,
        message:
          `${report.path} (${report.role}) is approaching its max_lines ceiling: ` +
          `${report.lines.used}/${report.lines.ceiling} lines used, ${report.lines.remaining} remaining`,
      });
    }
    if (report.bytes.warn) {
      findings.push({
        kind: "headroom_warning",
        measured: report.bytes.remaining,
        message:
          `${report.path} (${report.role}) is approaching its max_bytes ceiling: ` +
          `${report.bytes.used}/${report.bytes.ceiling} bytes used, ${report.bytes.remaining} remaining`,
      });
    }
  }

  return findings;
}
