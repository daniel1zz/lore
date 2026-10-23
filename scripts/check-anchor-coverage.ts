#!/usr/bin/env bun
/**
 * Anchor-coverage ratchet (`bun scripts/check-anchor-coverage.ts`) —
 * `spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor` AC-BFI-5,
 * AC-BFI-6, AC-BFI-7.
 *
 * PURPOSE (one sentence): assert that the set of live specs declaring no
 * `extra.code_anchors` is EXACTLY the set of slugs dispositioned in
 * `scripts/anchor-coverage-ledger.json`, so anchor coverage can never decay
 * further in either direction — a new unanchored spec cannot appear silently, and
 * a ledger row cannot outlive the debt it names.
 *
 * ## Why a ledger instead of 60 synthesized anchors
 *
 * `adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`: a newly-armed
 * structural oracle is never required to exit 0 on the whole tree as its landing
 * criterion. Its landing criteria are (1) baseline-scoped enforcement, (2) an
 * auditable exemption ledger that is DATA the oracle reads (never an `--exclude`
 * glob buried in the script), and (3) ledger completeness asserted by the oracle
 * itself, so the ledger cannot quietly become a suppression list. Declaring 60
 * anchors nobody measured would satisfy the coverage predicate while producing 60
 * paths indistinguishable, afterwards, from measured ones — and an imprecise
 * anchor is worse than no anchor, because `lore status --check-drift` then reports
 * false drift forever. So a row is written in preference to an anchor.
 *
 * ## What "live spec" means here — the repo's existing definition, not a new one
 *
 * `app.corpusService.listFull({ type: "spec" })`. This is the SAME query
 * `flows/drift-flow.ts::buildListSpecs` binds for `countArmedSpecs`, which is what
 * produces the published `code_anchor_specs` field of `lore status --json`; and it
 * is the same population `scripts/export-spec-mirror.ts::runExport` names as "the
 * LIVE (non-deleted) corpus count". Concretely: `store.findMany` defaults
 * `exclude_deleted: true` (`sqlite-store.ts` — `deleted_at IS NULL`) and applies NO
 * invalidation filter, so this census can never be wrong by a hidden invalidated
 * population the way a `lore list` census silently is
 * (`knowledge-eleven-findings-from-resuming-handoff-102-with-three`). Measured
 * 2026-08-17: 151 live specs, of which 0 unanchored ones are invalidated and 0 are
 * archived/deprecated — so this definition and a stricter status-based one select
 * the identical set today; the broader one is chosen deliberately because
 * retracting or archiving a spec must not become a way to leave the ratchet.
 *
 * ## The anchored predicate is imported, not re-implemented (AC-BFI-14)
 *
 * `isSpecAnchored` used to be a second hand-written copy of `countArmedSpecs`'s
 * predicate (a non-empty `extra.code_anchors` array); this checker needs the SET
 * that predicate partitions, not the count `countArmedSpecs` returns, but that no
 * longer requires a private redefinition — `flows/drift-flow.ts::isSpecAnchored`
 * is now the ONE production definition, imported here AND by
 * `commands/status.ts::collectCodeAnchorSpecMembers` (spec-bootstrap-fixpoint-
 * integrity-binary-provenance-an-anchor AC-BFI-14, which also collapsed a THIRD,
 * previously undocumented copy in that file). {@link runCheck} still cross-checks
 * this module's partition count against `countArmedSpecs` on the SAME spec list
 * ({@link AnchorPredicateDisagreementError}) — by construction the two calls can
 * no longer disagree through the shared predicate itself (same function, same
 * data), so this guards specifically against a FUTURE hand-edit that reintroduces
 * divergent inline logic at either call site while bypassing the import; the
 * repo-wide uniqueness scan (`anchor-coverage-ratchet.test.ts`'s
 * `anchored-predicate-ssot` suite) is the STATIC counterpart that catches the same
 * regression at test time, over the whole tree, not just this one cross-check.
 *
 * ## Public surface
 *
 *   - `isSpecAnchored` — re-exported from `flows/drift-flow.ts` for callers that
 *     already import this module; NOT a second definition (AC-BFI-14).
 *   - `expectedCohortFor(createdAt)` / `classifyLedgerReason(reason)` — the pure
 *     ledger predicates (no IO).
 *   - `checkAnchorCoverage(specs, entries)` — pure; the whole verdict.
 *   - `AnchorCoverageLedgerEntrySchema` / `AnchorCoverageLedgerFileSchema` /
 *     `parseAnchorCoverageLedgerFile` / `loadLedgerFromDisk` — the ledger boundary.
 *   - `runCheck(app, ledger)` — IO: one corpus read + the pure check + the
 *     shared-predicate cross-check.
 *   - `main(dbPathOverride?, repoRootOverride?)` — IO: resolves corpus + ledger,
 *     prints the report, RETURNS the exit code. Never calls `process.exit` itself
 *     (the `import.meta.main` block below is the only place that does), mirroring
 *     `check-ac-ref-integrity.ts::main`.
 *
 * ## Exit codes
 *
 *   0 — clean: the ledger's disposition set EQUALS the measured unanchored set, and
 *       every row is well-formed.
 *   1 — repo-invariant failure (AC-BFI-6 and AC-BFI-7 both pin this exact code, and
 *       so does AC-BFI-5's reason predicate — they are one checker's one "the tree
 *       broke the invariant" verdict). Matches `check-no-nul-bytes.ts` /
 *       `check-no-timer-retry.ts` ("0 clean / 1 violations found").
 *   2 — the scan itself failed: ledger missing / not JSON / schema-invalid, corpus
 *       unreadable, or the shared-predicate cross-check disagreed. Never conflated
 *       with 1: a checker that crashed before inspecting anything must not be
 *       readable as "the ratchet fired".
 *
 * Side-effect class: IO in `loadLedgerFromDisk` (one file read), `runCheck` (one
 * corpus read) and `main` (both, plus console output). Everything else is pure.
 *
 * Source: spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor AC-BFI-5/6/7;
 *   adr-a-newly-armed-structural-oracle-enforces-from-a-baseline (ledger shape);
 *   knowledge-convergence-backfill-code-anchor-adoption-armed-gate-f (the `deliberate` cohort)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import { ok, type DocRecord, type LoreError } from "@lore/core";
import { ambientOfInvocation, createApp, type App } from "../packages/lore/src/app.js";
import { resolveEntryInvocation } from "../packages/lore/src/adapters/cli/run-cli.js";
import { findLoreDbPath } from "../packages/lore/src/adapters/cli/utils.js";
import { countArmedSpecs, isSpecAnchored } from "../packages/lore/src/flows/drift-flow.js";

// Re-exported (not re-defined, AC-BFI-14) so any existing consumer of this
// module's `isSpecAnchored` export still resolves — the shared definition now
// lives at `flows/drift-flow.ts::isSpecAnchored`; see this file's header.
export { isSpecAnchored };

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(__filename, "..", "..");

// ─── Constants (all measured, none guessed) ────────────────────────────────

/**
 * Repo-relative path to the disposition ledger — DATA this oracle reads, never a
 * suppression list inside the script (ADR criterion 2, same discipline as
 * `check-ac-ref-integrity-core.ts::LEDGER_RELATIVE_PATH`).
 */
export const LEDGER_RELATIVE_PATH = "scripts/anchor-coverage-ledger.json";

/**
 * The instant separating the two cohorts. A spec created at or before this moment
 * predates the 2026-07-14 code-anchor backfill
 * (`knowledge-convergence-backfill-code-anchor-adoption-armed-gate-f` step 2, which
 * anchored 38 of the then-49 specs and left 11 deliberately unanchored because
 * "implementations spread across files with no clean anchor — anchoring them
 * imprecisely would create false-drift noise"). Anything created after it was
 * authored under a corpus that already had the anchor mechanism and simply did not
 * declare one.
 *
 * ⛔ This is a HISTORICAL boundary, not a rolling window: moving it forward would
 * reclassify real debt as a deliberate design decision. Re-measured 2026-08-17
 * against the live corpus — the 11 specs it selects are exactly the 11 that
 * knowledge doc names (monorepo-skeleton, auth-agent-credentials, cookie-auth,
 * SPEC-019/024/027/029/031/033/036/037), so the date reproduces the recorded
 * cohort rather than approximating it.
 */
export const DELIBERATE_COHORT_CUTOFF = "2026-07-14T23:59:59.999Z";

/**
 * Minimum length of a ledger row's `reason` after trimming (AC-BFI-5). Without a
 * length floor a ledger of 60 rows reading "x" would satisfy a presence check while
 * documenting nothing — the criterion is explicit that the reason field is
 * machine-constrained, not merely present.
 */
export const MIN_REASON_CHARS = 20;

/**
 * Reason texts that are structurally present but semantically empty (AC-BFI-5's
 * enumerated set), compared case-insensitively after trimming. Kept as an explicit
 * frozen set rather than a heuristic: a heuristic that "looks like a placeholder"
 * would be unfalsifiable, and this list is the criterion's own.
 */
export const PLACEHOLDER_REASONS: ReadonlySet<string> = new Set([
  "tbd",
  "todo",
  "n/a",
  "na",
  "-",
  "?",
  "xxx",
  "fixme",
  "pending",
]);

/**
 * Max characters of a row's `reason` echoed inline on the OK path before truncating
 * with a pointer to the ledger file.
 *
 * MEASURED, not guessed (the same discipline
 * `check-ac-ref-integrity-core.ts::MAX_REASON_DISPLAY_CHARS` documents): the shipped
 * ledger's 60 reasons run 398-471 characters, and each places BOTH load-bearing facts
 * an auditor needs — why this spec has no anchor, and the "retire this row in the same
 * commit that declares real anchors" instruction that makes ADR criterion 3 actionable
 * — with the second ENDING the string. A 200-char threshold (this constant's first
 * value) cut the instruction off entirely, which is why the number is now derived from
 * the real corpus rather than picked. 500 clears the widest measured reason by 29
 * characters, so today nothing truncates; the truncation branch stays because a longer
 * reason authored later must degrade with a visible pointer, never a silent cut.
 */
export const MAX_REASON_DISPLAY_CHARS = 500;

// ─── Typed errors ──────────────────────────────────────────────────────────

/**
 * The ledger file could not be loaded or failed Zod validation — a config-level
 * failure (exit 2), deliberately distinct from a per-row finding (exit 1), which is
 * reported and never thrown.
 */
export class AnchorCoverageLedgerError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_json" | "schema",
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AnchorCoverageLedgerError";
  }
}

/** A `listFull` corpus read failed (unreadable/corrupt `.lore/lore.db`) — carries the underlying `LoreError` verbatim, never only a stringified message. */
export class CorpusReadError extends Error {
  constructor(public readonly loreError: LoreError) {
    super(`check-anchor-coverage: failed to list specs — ${JSON.stringify(loreError)}`);
    this.name = "CorpusReadError";
  }
}

/**
 * This module's partition of `specs` by {@link isSpecAnchored} disagreed in
 * COUNT with `flows/drift-flow.ts::countArmedSpecs` over the SAME spec list.
 * Fails the run loud (exit 2) rather than reporting a population one of the
 * two considers wrong — see the module header's cross-check note.
 *
 * ⛔ Post-AC-BFI-14, BOTH sides call the identical `isSpecAnchored` export
 * over the identical `specs` array, so this can no longer fire through the
 * predicate itself drifting — it fires only if a FUTURE edit reintroduces
 * divergent inline logic at one of the two call sites while bypassing the
 * import (the repo-wide uniqueness scan in `anchor-coverage-ratchet.test.ts`'s
 * `anchored-predicate-ssot` suite catches that same regression statically,
 * before it ever reaches this runtime check).
 */
export class AnchorPredicateDisagreementError extends Error {
  constructor(
    public readonly localAnchoredCount: number,
    public readonly sharedAnchoredCount: number,
  ) {
    super(
      `check-anchor-coverage: local anchored-spec partition counted ${localAnchoredCount} but the shared ` +
        `flows/drift-flow.ts::countArmedSpecs counted ${sharedAnchoredCount} over the same spec list — ` +
        `one of the two call sites has bypassed the shared isSpecAnchored predicate; reconcile before trusting this oracle.`,
    );
    this.name = "AnchorPredicateDisagreementError";
  }
}

// ─── Ledger boundary (Zod is the SSOT; types are inferred) ─────────────────

/** The two cohorts AC-BFI-5 fixes by measurement — see {@link DELIBERATE_COHORT_CUTOFF}. */
export const CohortSchema = z.enum(["deliberate", "debt"]);

/** Derived TypeScript type for a cohort — inferred from {@link CohortSchema}, never hand-duplicated. */
export type Cohort = z.infer<typeof CohortSchema>;

/**
 * One disposition: an unanchored live spec, its measured cohort, and why it has no
 * anchor. `reason` is `min(1)` HERE only; the real predicate (>= 20 chars after
 * trim, not a placeholder) is evaluated in {@link checkAnchorCoverage} instead, so a
 * useless reason is reported as a per-row finding that NAMES the offending slug
 * (AC-BFI-5's RED (b)) rather than as a Zod path index inside a schema error.
 */
export const AnchorCoverageLedgerEntrySchema = z.object({
  slug: z.string().min(1),
  cohort: CohortSchema,
  reason: z.string().min(1),
});

/** Derived TypeScript type for one ledger row — see {@link AnchorCoverageLedgerEntrySchema}. */
export type AnchorCoverageLedgerEntry = z.infer<typeof AnchorCoverageLedgerEntrySchema>;

/** The whole ledger file: provenance fields for a human auditor plus the `entries` this oracle reads. */
export const AnchorCoverageLedgerFileSchema = z.object({
  baseline_date: z.string().optional(),
  adr: z.string().optional(),
  note: z.string().optional(),
  entries: z.array(AnchorCoverageLedgerEntrySchema),
});

/** Derived TypeScript type for the whole ledger file — see {@link AnchorCoverageLedgerFileSchema}. */
export type AnchorCoverageLedgerFile = z.infer<typeof AnchorCoverageLedgerFileSchema>;

/**
 * Parses and validates raw ledger content. Pure (no IO).
 *
 * @param raw - The ledger file's text
 * @returns The validated ledger
 * @throws {AnchorCoverageLedgerError} `invalid_json` when `raw` is not JSON;
 *   `schema` when it parses but violates {@link AnchorCoverageLedgerFileSchema}
 *   (e.g. a row with an unknown `cohort` value).
 */
export function parseAnchorCoverageLedgerFile(raw: string): AnchorCoverageLedgerFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new AnchorCoverageLedgerError(
      "invalid_json",
      `ledger file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const parsed = AnchorCoverageLedgerFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new AnchorCoverageLedgerError("schema", `ledger file failed schema validation: ${parsed.error.message}`, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/**
 * Reads and validates `<repoRoot>/${LEDGER_RELATIVE_PATH}` — the only IO wrapper
 * around {@link parseAnchorCoverageLedgerFile}.
 *
 * @param repoRoot - Absolute path to the repo root holding the ledger
 * @returns The validated ledger
 * @throws {AnchorCoverageLedgerError} `not_found` when the file cannot be read;
 *   otherwise propagates {@link parseAnchorCoverageLedgerFile}'s errors.
 */
export function loadLedgerFromDisk(repoRoot: string): AnchorCoverageLedgerFile {
  const ledgerPath = join(repoRoot, LEDGER_RELATIVE_PATH);
  let raw: string;
  try {
    raw = readFileSync(ledgerPath, "utf8");
  } catch (e) {
    throw new AnchorCoverageLedgerError(
      "not_found",
      `ledger file not found at ${LEDGER_RELATIVE_PATH}: ${e instanceof Error ? e.message : String(e)}`,
      { path: ledgerPath },
    );
  }
  return parseAnchorCoverageLedgerFile(raw);
}

// ─── Pure predicates ───────────────────────────────────────────────────────
// `isSpecAnchored` used to be defined here; it is now imported from
// `flows/drift-flow.ts` (AC-BFI-14) and re-exported above.

/**
 * The cohort a spec MUST be filed under, derived from its creation instant alone —
 * never from what the ledger's author claims (AC-BFI-5: "cohort split is fixed by
 * measurement"). A `cohort` nobody validates is decoration; validating it is what
 * makes it data.
 *
 * @param createdAt - The spec's `created_at`, an ISO-8601 UTC instant. Lexicographic
 *   comparison is exact for this format (fixed-width, `Z`-suffixed), so no Date
 *   parsing — and therefore no timezone ambiguity — enters the predicate.
 * @returns `"deliberate"` at or before {@link DELIBERATE_COHORT_CUTOFF}, else `"debt"`
 * @example
 * expectedCohortFor("2026-06-08T10:00:00.000Z"); // => "deliberate"
 * expectedCohortFor("2026-07-24T12:02:03.159Z"); // => "debt"
 */
export function expectedCohortFor(createdAt: string): Cohort {
  return createdAt <= DELIBERATE_COHORT_CUTOFF ? "deliberate" : "debt";
}

/** Why a ledger row's `reason` is unusable — `null` means it is usable. */
export type ReasonProblem = "empty" | "too_short" | "placeholder";

/**
 * Evaluates AC-BFI-5's machine-constrained reason predicate.
 *
 * @param reason - The row's raw `reason` text
 * @returns `null` when the reason is usable, otherwise the NAMED problem — never a
 *   bare boolean, so the report can tell an auditor which rule the row broke.
 * @example
 * classifyLedgerReason("  ");                  // => "empty"
 * classifyLedgerReason("TBD");                 // => "placeholder"
 * classifyLedgerReason("spread out");          // => "too_short"
 * classifyLedgerReason("x".repeat(20));        // => null (the floor is >= 20, not > 20)
 */
export function classifyLedgerReason(reason: string): ReasonProblem | null {
  const trimmed = reason.trim();
  if (trimmed.length === 0) return "empty";
  if (PLACEHOLDER_REASONS.has(trimmed.toLowerCase())) return "placeholder";
  if (trimmed.length < MIN_REASON_CHARS) return "too_short";
  return null;
}

/**
 * Formats a row's `reason` for inline display, truncating with an explicit pointer
 * back to the ledger rather than a silent cut — an auditor must be able to tell that
 * a line was elided and where the rest lives.
 *
 * @param reason - The row's raw reason text
 * @returns The reason, unchanged when it fits {@link MAX_REASON_DISPLAY_CHARS}
 */
export function formatReasonForDisplay(reason: string): string {
  if (reason.length <= MAX_REASON_DISPLAY_CHARS) return reason;
  const cut = reason.length - MAX_REASON_DISPLAY_CHARS;
  return `${reason.slice(0, MAX_REASON_DISPLAY_CHARS)}… [truncated ${cut} more chars — see ${LEDGER_RELATIVE_PATH}]`;
}

// ─── Findings (a discriminated union, never a bag of booleans) ─────────────

/**
 * One reason the tree broke the anchor-coverage invariant. A discriminated union
 * rather than six parallel arrays so the reporter's `switch` is exhaustiveness-
 * checked by the compiler: a seventh finding kind added later cannot be silently
 * dropped from the printed report (which would turn an exit 1 into an unexplained
 * one).
 *
 * - `missing_disposition` — an unanchored live spec with no ledger row (AC-BFI-6:
 *   new debt).
 * - `debt_paid` — a ledgered spec that NOW declares anchors (AC-BFI-7: the row
 *   outlived its debt; ADR criterion 3).
 * - `unknown_slug` — a ledger row naming something that is not a live spec at all
 *   (typo, rename, or soft-deleted spec) — also an outlived row, distinguished
 *   because the repair differs.
 * - `unusable_reason` — the row exists but documents nothing (AC-BFI-5).
 * - `cohort_mismatch` — the row's cohort disagrees with the measured
 *   {@link expectedCohortFor}.
 * - `duplicate_row` — the same slug is dispositioned more than once, which would
 *   otherwise let one good row mask one bad one.
 */
export type AnchorCoverageFinding =
  | { readonly kind: "missing_disposition"; readonly slug: string; readonly createdAt: string; readonly expectedCohort: Cohort }
  | { readonly kind: "debt_paid"; readonly slug: string; readonly anchorCount: number }
  | { readonly kind: "unknown_slug"; readonly slug: string }
  | { readonly kind: "unusable_reason"; readonly slug: string; readonly problem: ReasonProblem; readonly reason: string }
  | { readonly kind: "cohort_mismatch"; readonly slug: string; readonly declared: Cohort; readonly expected: Cohort; readonly createdAt: string }
  | { readonly kind: "duplicate_row"; readonly slug: string; readonly count: number };

/** One dispositioned spec on the OK path: the row plus the spec it legitimately covers. */
export interface DispositionedSpec {
  readonly slug: string;
  readonly cohort: Cohort;
  readonly reason: string;
}

/** The whole verdict — census counts (so a zero-scan run can never read as clean) plus every finding. */
export interface AnchorCoverageReport {
  readonly liveSpecs: number;
  readonly anchored: number;
  readonly unanchored: number;
  readonly dispositioned: readonly DispositionedSpec[];
  readonly cohortCounts: Readonly<Record<Cohort, number>>;
  readonly findings: readonly AnchorCoverageFinding[];
}

/**
 * The whole check, pure. Partitions `specs` by {@link isSpecAnchored} and compares
 * the unanchored SET against the ledger's disposition SET in BOTH directions —
 * forward (`unanchored ⇒ ledgered`, AC-BFI-6) and reverse (`ledgered ⇒ still
 * unanchored`, AC-BFI-7) — plus the per-row well-formedness rules (AC-BFI-5).
 *
 * ⛔ A checker validating only the forward direction exits 0 on a row whose spec has
 * since declared anchors, and that row then silently becomes a suppression entry.
 * The reverse pass below is the whole point of AC-BFI-7 — do not "simplify" it away
 * on the grounds that the forward pass already covers every unanchored spec: by
 * construction it cannot, because a paid-off spec has left the unanchored set.
 *
 * @param specs - Every LIVE spec (see the module header for what that means)
 * @param entries - The validated ledger rows
 * @returns The full {@link AnchorCoverageReport}; `findings` empty means clean.
 */
export function checkAnchorCoverage(
  specs: readonly DocRecord[],
  entries: readonly AnchorCoverageLedgerEntry[],
): AnchorCoverageReport {
  const anchoredSpecs = specs.filter(isSpecAnchored);
  const unanchoredSpecs = specs.filter((spec) => !isSpecAnchored(spec));
  const specBySlug = new Map(specs.map((spec) => [spec.slug, spec]));
  const unanchoredBySlug = new Map(unanchoredSpecs.map((spec) => [spec.slug, spec]));

  const findings: AnchorCoverageFinding[] = [];

  // Row multiplicity first: a slug dispositioned twice must be reported even though
  // the map below keeps only one of the two rows.
  const rowCounts = new Map<string, number>();
  for (const entry of entries) rowCounts.set(entry.slug, (rowCounts.get(entry.slug) ?? 0) + 1);
  for (const [slug, count] of rowCounts) {
    if (count > 1) findings.push({ kind: "duplicate_row", slug, count });
  }

  const entryBySlug = new Map(entries.map((entry) => [entry.slug, entry]));

  // REVERSE direction (AC-BFI-7) + per-row well-formedness (AC-BFI-5).
  const dispositioned: DispositionedSpec[] = [];
  for (const entry of entryBySlug.values()) {
    const problem = classifyLedgerReason(entry.reason);
    if (problem !== null) {
      findings.push({ kind: "unusable_reason", slug: entry.slug, problem, reason: entry.reason });
    }

    const spec = specBySlug.get(entry.slug);
    if (spec === undefined) {
      findings.push({ kind: "unknown_slug", slug: entry.slug });
      continue;
    }
    if (isSpecAnchored(spec)) {
      const anchors = spec.extra["code_anchors"];
      findings.push({
        kind: "debt_paid",
        slug: entry.slug,
        anchorCount: Array.isArray(anchors) ? anchors.length : 0,
      });
      continue;
    }

    const expected = expectedCohortFor(spec.created_at);
    if (entry.cohort !== expected) {
      findings.push({
        kind: "cohort_mismatch",
        slug: entry.slug,
        declared: entry.cohort,
        expected,
        createdAt: spec.created_at,
      });
    }
    dispositioned.push({ slug: entry.slug, cohort: entry.cohort, reason: entry.reason });
  }

  // FORWARD direction (AC-BFI-6).
  for (const spec of unanchoredBySlug.values()) {
    if (entryBySlug.has(spec.slug)) continue;
    findings.push({
      kind: "missing_disposition",
      slug: spec.slug,
      createdAt: spec.created_at,
      expectedCohort: expectedCohortFor(spec.created_at),
    });
  }

  const cohortCounts: Record<Cohort, number> = { deliberate: 0, debt: 0 };
  for (const row of dispositioned) cohortCounts[row.cohort] += 1;

  return {
    liveSpecs: specs.length,
    anchored: anchoredSpecs.length,
    unanchored: unanchoredSpecs.length,
    dispositioned: dispositioned.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)),
    cohortCounts,
    findings: findings.sort((a, b) =>
      a.kind !== b.kind ? (a.kind < b.kind ? -1 : 1) : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0,
    ),
  };
}

// ─── IO ────────────────────────────────────────────────────────────────────

/**
 * Fetches every live spec and runs {@link checkAnchorCoverage} over it, then
 * cross-checks this module's `isSpecAnchored` partition count against the
 * shared `countArmedSpecs` on the SAME list (see {@link AnchorPredicateDisagreementError}
 * for what this can and cannot catch post-AC-BFI-14).
 *
 * @param app - A wired `App` (tests inject one built over a throwaway corpus)
 * @param ledger - The already-validated ledger
 * @returns The full report
 * @throws {CorpusReadError} when the corpus read fails — never a partial scan
 * @throws {AnchorPredicateDisagreementError} when the two anchored predicates disagree
 */
export async function runCheck(app: App, ledger: AnchorCoverageLedgerFile): Promise<AnchorCoverageReport> {
  const specsResult = await app.corpusService.listFull({ type: "spec" });
  if (!specsResult.ok) throw new CorpusReadError(specsResult.error);
  const specs = specsResult.value.docs;

  const report = checkAnchorCoverage(specs, ledger.entries);

  const sharedCountResult = await countArmedSpecs(() => Promise.resolve(ok(specs)));
  if (!sharedCountResult.ok) throw new CorpusReadError(sharedCountResult.error);
  if (sharedCountResult.value !== report.anchored) {
    throw new AnchorPredicateDisagreementError(report.anchored, sharedCountResult.value);
  }

  return report;
}

/** Human-readable label for a {@link ReasonProblem}, naming the rule the row broke. */
function describeReasonProblem(problem: ReasonProblem): string {
  switch (problem) {
    case "empty":
      return "empty after trimming";
    case "too_short":
      return `shorter than ${MIN_REASON_CHARS} characters after trimming`;
    case "placeholder":
      return `a placeholder (one of: ${[...PLACEHOLDER_REASONS].join(", ")})`;
    default: {
      const exhaustive: never = problem;
      return String(exhaustive);
    }
  }
}

/**
 * Renders one finding as the report line that NAMES its slug (every AC in this
 * family requires the offending slug in the output, not merely a count).
 *
 * The `switch` is exhaustiveness-checked: a new {@link AnchorCoverageFinding} member
 * without a branch here is a compile error, never a silently unprinted failure.
 */
function renderFinding(finding: AnchorCoverageFinding): string {
  switch (finding.kind) {
    case "missing_disposition":
      return (
        `  ${finding.slug} — declares no code_anchors and has no ledger disposition ` +
        `(created ${finding.createdAt}; measured cohort: ${finding.expectedCohort})`
      );
    case "debt_paid":
      return `  ${finding.slug} — ledger row now declares code_anchors (${finding.anchorCount} anchor(s)); the row outlived its debt`;
    case "unknown_slug":
      return `  ${finding.slug} — ledger row names something that is not a live spec in this corpus`;
    case "unusable_reason":
      return `  ${finding.slug} — unusable reason (${describeReasonProblem(finding.problem)}): ${JSON.stringify(finding.reason)}`;
    case "cohort_mismatch":
      return (
        `  ${finding.slug} — declared cohort "${finding.declared}" but the measured cohort is ` +
        `"${finding.expected}" (created ${finding.createdAt}, cutoff ${DELIBERATE_COHORT_CUTOFF})`
      );
    case "duplicate_row":
      return `  ${finding.slug} — declared more than once (${finding.count} rows); one disposition per spec`;
    default: {
      const exhaustive: never = finding;
      return String(exhaustive);
    }
  }
}

/** The repair instruction printed under each finding group — a checker's red must tell the reader what to do. */
function renderRepairHint(kind: AnchorCoverageFinding["kind"]): string {
  switch (kind) {
    case "missing_disposition":
      return (
        `Fix: declare real, measured code anchors (\`lore anchor add <spec-slug> <path[#Symbol]>\`) — or, when the ` +
        `implementation genuinely has no clean anchor, add a row to ${LEDGER_RELATIVE_PATH} with the measured cohort ` +
        `and a reason of at least ${MIN_REASON_CHARS} characters. ⛔ Never synthesize an imprecise anchor to silence ` +
        `this: it satisfies the predicate while being indistinguishable, afterwards, from a measured one.`
      );
    case "debt_paid":
      return (
        `Fix: delete the row from ${LEDGER_RELATIVE_PATH} in the SAME commit that declared the anchors ` +
        `(adr-a-newly-armed-structural-oracle-enforces-from-a-baseline criterion 3 — paying down debt carries a ` +
        `mandatory ledger edit; this red is fail-loud working as designed).`
      );
    case "unknown_slug":
      return `Fix: correct the slug in ${LEDGER_RELATIVE_PATH}, or delete the row if the spec was renamed or removed.`;
    case "unusable_reason":
      return `Fix: write the actual reason this spec has no anchor into ${LEDGER_RELATIVE_PATH}. A row that documents nothing is a suppression entry.`;
    case "cohort_mismatch":
      return `Fix: set the row's cohort to the measured value in ${LEDGER_RELATIVE_PATH}. The split is fixed by the spec's created_at, not by the author.`;
    case "duplicate_row":
      return `Fix: keep exactly one row per slug in ${LEDGER_RELATIVE_PATH}.`;
    default: {
      const exhaustive: never = kind;
      return String(exhaustive);
    }
  }
}

/** Section heading per finding kind, so a reader sees WHICH invariant broke before reading the rows. */
function renderSectionHeading(kind: AnchorCoverageFinding["kind"], count: number): string {
  switch (kind) {
    case "missing_disposition":
      return `${count} live spec(s) declare no code_anchors and carry no ledger disposition (new debt):`;
    case "debt_paid":
      return `${count} ledger row(s) name a spec that now declares code_anchors (the row outlived its debt):`;
    case "unknown_slug":
      return `${count} ledger row(s) name a slug that is not a live spec:`;
    case "unusable_reason":
      return `${count} ledger row(s) carry an unusable reason:`;
    case "cohort_mismatch":
      return `${count} ledger row(s) declare a cohort that disagrees with the measured one:`;
    case "duplicate_row":
      return `${count} slug(s) are dispositioned more than once:`;
    default: {
      const exhaustive: never = kind;
      return String(exhaustive);
    }
  }
}

/** Every finding kind, in the order sections are printed — declared once so the reporter cannot forget one. */
const FINDING_KIND_ORDER: readonly AnchorCoverageFinding["kind"][] = [
  "missing_disposition",
  "debt_paid",
  "unknown_slug",
  "unusable_reason",
  "cohort_mismatch",
  "duplicate_row",
];

/**
 * Resolves the corpus and the ledger, runs the check, prints the report, and
 * RETURNS the process exit code. Never calls `process.exit` — the
 * `import.meta.main` block below is the only place that does, so this stays
 * directly callable.
 *
 * @param dbPathOverride - Corpus path; omitted → `findLoreDbPath({ cwd: process.cwd(), env: process.env })` from the cwd
 * @param repoRootOverride - Repo root holding the ledger; omitted → this script's own repo
 * @returns 0 clean, 1 repo-invariant failure, 2 scan failure (see the module header)
 * @throws {AnchorCoverageLedgerError} / {@link CorpusReadError} /
 *   {@link AnchorPredicateDisagreementError} — mapped to exit 2 by the caller below
 */
export async function main(dbPathOverride?: string, repoRootOverride?: string): Promise<number> {
  const repoRoot = repoRootOverride ?? REPO_ROOT;
  const inv = await resolveEntryInvocation(process.argv.slice(2));
  const dbPath = dbPathOverride ?? findLoreDbPath(inv.io, inv);
  const app = createApp(dbPath, undefined, ambientOfInvocation(inv), { identity: inv.identity });
  try {
    const ledger = loadLedgerFromDisk(repoRoot);
    const report = await runCheck(app, ledger);

    console.log(
      `check-anchor-coverage: scanned ${report.liveSpecs} live spec(s) — ${report.anchored} anchored, ` +
        `${report.unanchored} unanchored (ledger: ${LEDGER_RELATIVE_PATH}, ${ledger.entries.length} row(s)).`,
    );

    if (report.findings.length > 0) {
      const firedKinds: AnchorCoverageFinding["kind"][] = [];
      for (const kind of FINDING_KIND_ORDER) {
        const group = report.findings.filter((finding) => finding.kind === kind);
        if (group.length === 0) continue;
        firedKinds.push(kind);
        console.error(`\ncheck-anchor-coverage: ${renderSectionHeading(kind, group.length)}\n`);
        for (const finding of group) console.error(renderFinding(finding));
        console.error(`\n${renderRepairHint(kind)}`);
      }
      // reason: the verdict MUST be the LAST line — see the OK path's identical note.
      // Only the kinds that actually fired are named, using their bare `kind`
      // identifiers rather than the prose headings above: a reader (and a test)
      // must be able to tell WHICH invariant broke from this one line without the
      // line itself asserting the phrasing of invariants that did NOT fire.
      console.error(
        `\ncheck-anchor-coverage: FAILED — ${report.findings.length} finding(s) in ${firedKinds.length} ` +
          `class(es): ${firedKinds.join(", ")}.`,
      );
      return 1;
    }

    if (report.dispositioned.length > 0) {
      // reason: printing only a COUNT is the exact defect
      // task-check-ac-ref-integrity-prints-an-exemption-count-not-its fixed on the
      // sibling oracle — an exemption is auditable only if the justification reaches
      // the auditor without opening the ledger separately, and the ADR's stated
      // consequence is that the back-catalogue stays "visible and countable".
      console.log(`\ncheck-anchor-coverage: dispositioned spec(s) — recorded debt, never silently excluded:\n`);
      for (const row of report.dispositioned) {
        console.log(`  [${row.cohort}] ${row.slug}`);
        console.log(`    ${formatReasonForDisplay(row.reason)}`);
      }
    }

    // reason: the verdict is printed LAST, AFTER the (60-row and growing) echo above,
    // and never only before it. Measured this task: with the verdict emitted first,
    // `lore evidence --capture`'s 4000-byte output-tail window kept only the trailing
    // rows and dropped the verdict entirely — an evidence record that proves a run
    // happened but not what it concluded. Any consumer that keeps a TAIL (evidence
    // capture, CI log excerpt, a shell `| tail`) sees the verdict only if it is last.
    // ⛔ Do not "tidy" this by moving it back up next to the census line.
    console.log(
      `\ncheck-anchor-coverage: OK — ${report.dispositioned.length} of ${report.unanchored} unanchored live ` +
        `spec(s) dispositioned (${report.cohortCounts.deliberate} deliberate / ${report.cohortCounts.debt} debt); ` +
        `0 finding(s).`,
    );

    return 0;
  } finally {
    app.close();
  }
}

if (import.meta.main) {
  try {
    // `LORE_ANCHOR_COVERAGE_REPO_ROOT` wires `main`'s `repoRootOverride` seam to this
    // real entrypoint. ⛔ Never set by production callers — production always reads the
    // ledger out of THIS script's own repo. It exists because this oracle's own suites
    // (`packages/lore/tests/unit/scripts/anchor-coverage-*.test.ts`) MUST spawn this
    // exact file as a subprocess (bun:sqlite in the import graph makes an in-process
    // vitest call impossible) while pointing it at a mutated COPY of the ledger, so a
    // RED case never edits the shipped file. Validated rather than trusted: an
    // empty-string value would silently resolve the ledger against the process cwd.
    const rawRepoRoot = process.env["LORE_ANCHOR_COVERAGE_REPO_ROOT"];
    if (rawRepoRoot !== undefined && rawRepoRoot.trim().length === 0) {
      console.error(
        "check-anchor-coverage: LORE_ANCHOR_COVERAGE_REPO_ROOT is set but empty — unset it, or point it at a real directory.",
      );
      process.exit(2);
    }
    const code = await main(undefined, rawRepoRoot);
    process.exit(code);
  } catch (e) {
    if (e instanceof AnchorCoverageLedgerError) {
      console.error(`check-anchor-coverage: ${e.message}`);
      if (e.context) console.error(JSON.stringify(e.context));
      process.exit(2);
    }
    console.error(`check-anchor-coverage: scan failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(2);
  }
}
