/**
 * Terminal + `--json` rendering for `lore status --check-claude-md`
 * (spec-claude-md-governance-content-dimension-checks-wire-the). Extracted
 * from `commands/status.ts` (already 1800+ lines) into its own module,
 * mirroring this package's established `*-render.ts` convention
 * (`seat-render.ts`, `pending-render.ts`, `verify-render.ts`):
 * `commands/status.ts` transitively imports `loader.ts` (`bun:sqlite`),
 * unresolvable by vitest, but this module imports only `@lore/core` types +
 * the split service modules' TYPES (never their functions — this file
 * renders a result it is HANDED; it never calls
 * `runMemoryFileChecks`/`lintMemoryFiles`/`computeHeadroom` itself).
 *
 * Public surface:
 *   - CheckClaudeMdRenderInput — everything the rendering below needs,
 *     already computed by `commands/status.ts`.
 *   - buildCheckClaudeMdJsonPayload(input) — the exact `--json` envelope
 *     `lore status --check-claude-md --json` prints.
 *   - formatCheckClaudeMdHuman(input) — the non-`--json` terminal
 *     rendering, as an ordered array of lines ready for `console.log`.
 *
 * ⛔ This module never decides `process.exitCode` — `commands/status.ts`
 * still derives it from `input.findings.length > 0 ? 3 : 0` (unchanged
 * since before this split, and unaffected by `input.advisory`): rendering
 * and exit-code derivation stay separate concerns.
 *
 * Side-effect class: pure
 *
 * Source: spec-claude-md-governance-content-dimension-checks-wire-the.
 */

import type { MemoryFileBudgetResolution } from "@lore/core";
import type { AdvisoryFinding, MemoryFileFinding } from "../../service/claude-md-findings.js";
import type { HeadroomReport } from "../../service/claude-md-budget.js";
import type { AdoptionReport } from "../../service/claude-md-admission.js";

/** Everything `--check-claude-md`'s rendering needs, already computed by `commands/status.ts`. */
export interface CheckClaudeMdRenderInput {
  /** `runMemoryFileChecks(...).deterministic` — decides the exit code (unrendered here). */
  findings: MemoryFileFinding[];
  /**
   * `runMemoryFileChecks(...).advisory` — reference/narrative-smell findings
   * PLUS the two always-on `line_length`/`target_distance` metrics (one pair
   * per discovered file, Phase 4 N9) — never exit-relevant. Rendered in the
   * `--json` payload only (see {@link buildCheckClaudeMdJsonPayload}); this
   * module's human-readable rendering never prints `advisory` directly,
   * mirroring the existing convention for `reference_missing`/
   * `iso_date_density`/`status_word`.
   */
  advisory: AdvisoryFinding[];
  /** `computeHeadroom(...)` — used/ceiling/remaining, printed every run regardless of breach. */
  headroom: HeadroomReport[];
  /** `computeHeadroomWarnings(...)` — near-ceiling advisory rows, never exit-relevant. */
  warnings: AdvisoryFinding[];
  /** Whose budgets were used, and why, if substituted — see `resolveMemoryFileBudgetsFromConfigResult`. */
  budgetResolution: MemoryFileBudgetResolution;
  /**
   * `runMemoryFileChecks(...).adoption` — mode, where it came from, and how
   * many deterministic findings it downgraded
   * (spec-claude-md-root-section-structure-check-and-adoption-mode, D7).
   */
  adoption: AdoptionReport;
}

/** The exact `--json` envelope `lore status --check-claude-md --json` prints. */
export interface CheckClaudeMdJsonPayload {
  readonly ok: true;
  readonly data: {
    readonly claude_md: {
      readonly findings: MemoryFileFinding[];
      readonly advisory: AdvisoryFinding[];
      readonly headroom: HeadroomReport[];
      readonly warnings: AdvisoryFinding[];
      readonly budget_source: MemoryFileBudgetResolution["source"];
      readonly budget_substitution: string | null;
      readonly adoption: AdoptionReport;
    };
  };
}

/**
 * Wraps a `--check-claude-md` result in the `--json` envelope.
 * `budget_source`/`budget_substitution` are ALWAYS present (`null`
 * included) — same convention as `invalid_docs` elsewhere: an omitted key
 * would let a consumer read "absent" as "nothing was substituted", which is
 * the exact silence this branch exists to end.
 *
 * @param input - See {@link CheckClaudeMdRenderInput}.
 * @returns The envelope object; caller `JSON.stringify`s it.
 * @example
 * buildCheckClaudeMdJsonPayload({
 *   findings: [], advisory: [], headroom: [], warnings: [],
 *   budgetResolution: { source: "config", budgets, reason: undefined },
 * });
 * // => { ok: true, data: { claude_md: { findings: [], advisory: [], ... } } }
 */
export function buildCheckClaudeMdJsonPayload(input: CheckClaudeMdRenderInput): CheckClaudeMdJsonPayload {
  return {
    ok: true,
    data: {
      claude_md: {
        findings: input.findings,
        advisory: input.advisory,
        headroom: input.headroom,
        warnings: input.warnings,
        budget_source: input.budgetResolution.source,
        budget_substitution:
          input.budgetResolution.source === "substituted-defaults" ? input.budgetResolution.reason : null,
        adoption: input.adoption,
      },
    },
  };
}

/** Text rendering for one deterministic finding — the finding's own `message` already names `path`. */
function renderFindingLine(finding: MemoryFileFinding): string {
  return `  - [${finding.kind}] ${finding.message}`;
}

/**
 * Text rendering for one headroom row — printed on EVERY run
 * (task-lore-status-check-claude-md-reports-a-saturated-file-as: a bare
 * pass/fail hid a file 5 bytes from its ceiling as "within budget", so
 * used/ceiling/remaining now render unconditionally, never only on a
 * breach).
 */
function renderHeadroomLine(report: HeadroomReport): string {
  return (
    `  ${report.path} (${report.role}): lines ${report.lines.used}/${report.lines.ceiling} ` +
    `(${report.lines.remaining} remaining), bytes ${report.bytes.used}/${report.bytes.ceiling} ` +
    `(${report.bytes.remaining} remaining)`
  );
}

/**
 * Compact human-readable rendering for `--check-claude-md`'s non-`--json`
 * terminal path — breach/within-budget summary, one line per deterministic
 * finding, one headroom line per file (always, even when compliant), and an
 * approaching-ceiling summary when any `headroom_warning` fired. Pure —
 * returns lines, caller `console.log`s them.
 *
 * @param input - See {@link CheckClaudeMdRenderInput}.
 * @returns Ordered lines ready for `console.log` (one `console.log` per
 *   element, or joined with `"\n"`).
 * @example
 * formatCheckClaudeMdHuman({ findings: [], advisory: [], headroom: [], warnings: [], budgetResolution });
 * // => ["CLAUDE.md: within budget (0 findings)."]
 */
export function formatCheckClaudeMdHuman(input: CheckClaudeMdRenderInput): string[] {
  const lines: string[] = [];
  const downgraded = input.advisory.filter((finding) => finding.kind === "downgraded");

  if (input.findings.length === 0) {
    lines.push(
      downgraded.length === 0
        ? "CLAUDE.md: within budget (0 findings)."
        : `CLAUDE.md: 0 enforced findings (${downgraded.length} downgraded by adoption=warn, exit code unaffected):`,
    );
    for (const finding of downgraded) lines.push(`  - [downgraded:${finding.downgraded_kind ?? "unknown"}] ${finding.message}`);
  } else {
    lines.push(`CLAUDE.md: BREACHED (${input.findings.length} finding(s)):`);
    for (const finding of input.findings) lines.push(renderFindingLine(finding));
    lines.push("  fix: trim the file, or run `lore governance claude-md` for the content contract.");
  }

  // ⛔ Printed on EVERY warn run, conforming or not — "must not go silent":
  // a warn project stays visibly unenforced until someone promotes it. The
  // fixed `WARN adoption=warn` prefix is the token consumers/tests match.
  if (input.adoption.mode === "warn") {
    const promote = input.adoption.promotable
      ? "the file conforms — promote with `context.memory_files.adoption: enforce` in .lore/config.yaml"
      : "fix the downgraded findings, then set `context.memory_files.adoption: enforce` in .lore/config.yaml";
    lines.push(
      `WARN adoption=warn (mode_source=${input.adoption.mode_source}): ${input.adoption.downgraded_count} finding(s) downgraded to advisory; ${promote}.`,
    );
  }

  for (const report of input.headroom) lines.push(renderHeadroomLine(report));

  if (input.warnings.length > 0) {
    lines.push(`CLAUDE.md: approaching ceiling (${input.warnings.length} advisory warning(s), exit code unaffected):`);
    for (const warning of input.warnings) lines.push(`  - ${warning.message}`);
  }

  return lines;
}
