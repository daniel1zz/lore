#!/usr/bin/env bun
/**
 * Gap-namespace checker + unowned-gap report (AC-GD-3,
 * `spec-governance-defaults-must-ship-and-every-recorded-gap-must` D4/D4a/D4b/D4c/D4d/D5/D6).
 *
 * PRD-001 (§3) numbers PRODUCT GOALS `G1`-`G16`; the governance-gap ledger
 * (`knowledge-attestation-is-structurally-one-sided-lore-verify-can`) used to
 * number GOVERNANCE GAPS `G1`-`G19` — same tokens, different documents. An
 * explorer agent resolved two gap ids against the PRD and returned dashboard
 * product goals as governance gaps; that is the concrete failure this checker
 * exists to make structurally impossible. D4 renamed every gap id to
 * `GAP-<n>`; this script is the mechanism that keeps the rename from silently
 * regressing.
 *
 * ## What it checks
 *
 * 1. **Namespace (D4/D4a/D4d)**: a bare `G<n>` token ANYWHERE in the ledger's
 *    markdown body — not just headings; the rename touches prose
 *    cross-references and a comparison table too — fails the check. Two
 *    exemptions, both bidirectional (each is tested in BOTH directions: the
 *    exempt form passes, and removing the exemption's own trigger condition
 *    on the SAME token fails again):
 *      - **Fence exemption (D4a)**: the ONE fenced ` ```legacy-gap-aliases `
 *        region at the ledger head, holding the 19 `G<n> -> GAP-<n>` mapping
 *        lines, is skipped. Only the FIRST such fence in the document is
 *        exempt — a second one is scanned normally, so the exemption cannot
 *        become a second place to hide a stale id (the exact failure mode
 *        D4a's own spec text warns against for a per-line marker).
 *      - **Qualifier exemption (D4d)**: `PRD-001 G<n>` (citing a PRD-001
 *        product goal) is lawful anywhere. Keyed on the LITERAL immediately
 *        preceding text `PRD-001 ` before the specific token match — never on
 *        "the line mentions PRD-001" — so a line carrying BOTH a qualified
 *        `PRD-001 G8` and a bare `G8` still fails on the bare occurrence.
 * 2. **Structured entries (D5)**: each `## GAP-<n>` entry carries a metadata
 *    comment `<!-- gap: id=... status=... owning_spec=... -->` (optional
 *    `open_half_carried_by=...`). `status` must be one of `open`,
 *    `half-closed`, `closed`, `corrected-record`, `not-a-lore-gap`. An entry
 *    missing the `owning_spec` key, or carrying an out-of-enum `status`, is a
 *    violation. `GAP-5` has no heading/comment of its own (cited only in the
 *    ledger's Scope paragraph) and is therefore simply never seen as an entry
 *    here — no special-casing needed, since entries are discovered by
 *    scanning for the metadata comment, not by matching every heading.
 * 3. **Unowned-gap report (D5)**, deliberately a REPORT, not a gate — it
 *    always exits 0 by itself (a namespace/structured violation elsewhere is
 *    what makes the overall run non-zero). Membership is the four-field
 *    disjunction the spec's own text derives after rejecting two simpler,
 *    self-contradictory phrasings: `(status === "open" && owning_spec is the
 *    "none" placeholder or absent)` OR `(status === "half-closed" &&
 *    open_half_carried_by is absent)`. This is why a fourth field
 *    (`open_half_carried_by`) exists at all: `GAP-1` and `GAP-11` are both
 *    `half-closed`, but `GAP-1`'s unclosed half was carried OUT into
 *    `GAP-17` (so it must NOT be double-listed) while `GAP-11` has no
 *    carrier (so it must be listed) — `status` alone cannot distinguish them.
 * 4. **GAP-19 scope line (D6)**: if a `## GAP-19` heading exists, its heading
 *    line must contain `main` and must NOT contain `PENDING`, `mirror
 *    branch`, or `a9f801dd` — the entry used to (wrongly) scope its own
 *    defect to a branch that never existed, steering readers away from a
 *    live defect. Vacuously fine when GAP-19 has no heading (most fixtures).
 *
 * ## SSOT (D4b): the corpus, never the exported mirror
 *
 * The gap ledger is a lore knowledge doc; `docs/requirements/knowledge/KN-*.md`
 * is a generated, sometimes-stale PROJECTION of it (`bun run mirror:export`).
 * A checker keyed on the mirror would report the mirror's staleness as a
 * namespace verdict instead of the corpus's real state. So the ONLY corpus
 * access this file performs is `readLedgerFromCorpus`, which shells to
 * `bun run <index.ts> get <slug> --json` — the SAME accessor a human uses
 * (`lore get`), never a raw sqlite/file reach-in, and never anything under
 * `docs/requirements/`. There is no code path anywhere in this file that
 * opens a path under `docs/requirements/` — that absence IS the SSOT
 * guarantee, not a runtime branch that could silently pick the wrong side.
 *
 * ## Why this is an "armed by `bun run test`" checker, not a `hooks/pre-push` entry
 *
 * `hooks/pre-push` is BYTE-IDENTICAL to `assets/project/pre-push`, the file
 * `lore setup --project` installs into every CONSUMER repo (parity-pinned;
 * regenerate the assets manifest on either edit). This checker's target
 * document — this repo's OWN governance-gap ledger — does not exist in any
 * consumer project a fresh `lore init` produces, so wiring it into
 * `hooks/pre-push` would ship a call to a script and a corpus doc that are
 * both absent in every downstream consumer's checkout, breaking their push
 * hook outright. This repo already answered exactly this question for its
 * other repo-internal static checkers
 * (`task-three-of-five-static-checkers-are-inert-no-exported-main`, archived
 * 2026-08-03): the established convention for a dev-repo-only structural
 * oracle is `export function main(cwd = REPO_ROOT, ...): number` (RETURNS,
 * never calls `process.exit`) plus a companion `scripts/tests/*.test.ts` that
 * calls `main()` with NO injected override against the REAL repo tree and
 * asserts the exit code — picked up unconditionally by `bun run test`
 * (`test:vitest`, via the `scripts/tests/**` vitest include glob), with no
 * dependency on `hooks/pre-push` or on `lore` being on PATH as a compiled
 * binary at all. `check-no-nul-bytes.ts`'s module header documents the
 * identical reasoning for the identical question; this file follows the same
 * convention. See `scripts/tests/check-gap-namespace.test.ts`'s
 * `describe("check-gap-namespace: real repo tree (task oracle) ...")` for the
 * arming assertion.
 *
 * ## Design note: one file, no `bun:sqlite`
 *
 * This task's file anchors are exactly two files (this script + its test),
 * so there is no third `-core.ts` split. All corpus access goes through a
 * `node:child_process` subprocess of the `lore` CLI's own source entry
 * (`packages/lore/src/index.ts`) rather than importing `createApp` in-process
 * (which top-level-imports `bun:sqlite`, unresolvable inside a vitest
 * worker — mirrors `scripts/check-unclaimed-oracle.ts`'s identical shape and
 * identical reasoning). That keeps this file's whole import graph
 * (`node:child_process` / `node:fs` / `node:path` / `node:url` / `zod` only)
 * vitest-importable directly, so `main()` itself — not just its pure
 * sub-functions — is testable in-process with no extra subprocess layer atop
 * the checker script itself.
 *
 * Public surface:
 *   - `findFencedRegions` / `findLegacyAliasFenceRegion` (pure) — fence
 *     boundary detection.
 *   - `findBareTokenViolations` (pure) — clause (a)/(b)/(c).
 *   - `parseGapCommentFields` / `extractGapEntries` (pure) — clause (e).
 *   - `computeUnownedGapIds` (pure) — clause (f).
 *   - `checkGap19Scope` (pure) — clause (h).
 *   - `evaluateLedger` (pure) — composes all of the above over one content
 *     string; this is what a fixture-content unit test calls directly.
 *   - `readLedgerFromCorpus` (IO) — the SSOT-honouring corpus read (D4b).
 *   - `main` (IO) — reads + evaluates + reports; returns the exit code, never
 *     calls `process.exit` itself.
 *
 * Exit codes:
 *   0 — no namespace/structured/scope violation (the unowned-gap report is
 *       printed regardless, and never affects this code by itself).
 *   3 — >=1 violation: a bare `G<n>` token, a structured-entry defect, or a
 *       GAP-19 scope-line defect.
 *   2 — the checker itself could not run (corpus unreadable, `lore`
 *       subprocess failed, or its JSON payload did not parse) — never
 *       reported as clean.
 *
 * Usage:
 *   bun scripts/check-gap-namespace.ts
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const INDEX_TS = join(REPO_ROOT, "packages", "lore", "src", "index.ts");

/** The real governance-gap ledger's corpus slug — production default for {@link main}. */
export const LEDGER_SLUG = "knowledge-attestation-is-structurally-one-sided-lore-verify-can";

/** D4a's single fenced exemption region's info-string language tag. */
export const LEGACY_ALIAS_FENCE_LANG = "legacy-gap-aliases";

/** D4d's qualifier: a bare token immediately preceded by this literal text is a lawful PRD-001 product-goal citation, not a namespace violation. */
export const PRD_QUALIFIER_PREFIX = "PRD-001 ";

/** D5's enumerated `status` values — the SOLE valid set; anything else is a structured-entry violation. */
export const GAP_STATUS_VALUES = ["open", "half-closed", "closed", "corrected-record", "not-a-lore-gap"] as const;

/** One entry's lifecycle state — the literal union derived from {@link GAP_STATUS_VALUES}. */
export type GapStatus = (typeof GAP_STATUS_VALUES)[number];

const GAP19_FORBIDDEN_SCOPE_TOKENS = ["PENDING", "mirror branch", "a9f801dd"] as const;

// ─── Pure: fence boundary detection (D4a) ───────────────────────────────────

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Every ` ```<lang> ... ``` ` fenced region in `lines`, as 0-based inclusive
 * `[openLineIndex, closeLineIndex]` pairs, in document order. An unclosed
 * opening fence (no matching bare ` ``` ` before EOF) is not reported — a
 * document that never closes its fence has no exempt region, so every line
 * after the opener is scanned normally rather than silently exempted.
 */
export function findFencedRegions(lines: readonly string[], lang: string): Array<[number, number]> {
  const openRe = new RegExp("^```" + escapeRegExp(lang) + "\\s*$");
  const closeRe = /^```\s*$/;
  const regions: Array<[number, number]> = [];
  let openAt: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (openAt === null) {
      if (openRe.test(line)) openAt = i;
    } else if (closeRe.test(line)) {
      regions.push([openAt, i]);
      openAt = null;
    }
  }
  return regions;
}

/**
 * D4a's ONE exemption region: only the FIRST ` ```legacy-gap-aliases ` fence
 * in the document is exempt. A second such fence later in the document is
 * deliberately NOT exempted — a marker any occurrence could claim is exactly
 * the "place stale ids hide" failure mode D4a's spec text rejects for a
 * per-line opt-out, and an unbounded "any fence with this tag" rule is the
 * same defect one level up.
 */
export function findLegacyAliasFenceRegion(lines: readonly string[]): [number, number] | null {
  const regions = findFencedRegions(lines, LEGACY_ALIAS_FENCE_LANG);
  return regions.length > 0 ? regions[0]! : null;
}

// ─── Pure: bare-token scan (a)(b)(c) ────────────────────────────────────────

const BARE_G_TOKEN_SOURCE = "\\bG(\\d+)\\b";

/** Nearest `## ...` heading at or before `index`, or `null` if none precedes it — used to name "the entry" a violation belongs to. */
function nearestHeadingBefore(lines: readonly string[], index: number): string | null {
  for (let i = index; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (line.startsWith("## ")) return line;
  }
  return null;
}

/** One bare `G<n>` token found outside both exemptions (D4a's fence, D4d's `PRD-001 ` qualifier) — clause (a)/(b)/(c)'s finding shape. */
export interface BareTokenViolation {
  readonly token: string;
  /** 1-based line number. */
  readonly line: number;
  readonly heading: string | null;
  readonly text: string;
}

/**
 * Every bare `G<n>` token in `content` OUTSIDE both exemptions: D4a's single
 * fenced `legacy-gap-aliases` region, and D4d's `PRD-001 ` qualifier (checked
 * per-OCCURRENCE, not per-line — a line carrying both a qualified and a bare
 * token still reports the bare one). `GAP-<n>` never matches: the regex
 * requires `G` immediately followed by a digit, and `GAP-<n>`'s `G` is
 * immediately followed by `A`.
 */
export function findBareTokenViolations(content: string): BareTokenViolation[] {
  const lines = content.split("\n");
  const exemptRegion = findLegacyAliasFenceRegion(lines);
  const violations: BareTokenViolation[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (exemptRegion && i >= exemptRegion[0] && i <= exemptRegion[1]) continue;
    const line = lines[i] ?? "";
    const re = new RegExp(BARE_G_TOKEN_SOURCE, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const before = line.slice(0, m.index);
      if (before.endsWith(PRD_QUALIFIER_PREFIX)) continue; // D4d qualifier exemption
      violations.push({ token: m[0], line: i + 1, heading: nearestHeadingBefore(lines, i), text: line });
    }
  }
  return violations;
}

// ─── Pure: structured entry parsing (e) ─────────────────────────────────────

const GAP_COMMENT_RE = /^<!--\s*gap:\s*(.+?)\s*-->$/;

/** Parses one `<!-- gap: key=value key2=value2 ... -->` line into its raw key/value fields, or `null` if `line` is not such a comment. */
export function parseGapCommentFields(line: string): Record<string, string> | null {
  const m = GAP_COMMENT_RE.exec(line.trim());
  if (!m) return null;
  const body = m[1] ?? "";
  const fields: Record<string, string> = {};
  for (const token of body.split(/\s+/)) {
    if (token.length === 0) continue;
    const eq = token.indexOf("=");
    if (eq === -1) continue;
    fields[token.slice(0, eq)] = token.slice(eq + 1);
  }
  return fields;
}

/** D5's structured entry, parsed from one `<!-- gap: id=... status=... owning_spec=... -->` metadata comment. */
export interface GapEntry {
  readonly id: string;
  readonly status: GapStatus;
  /** Raw `owning_spec` value — the literal string `"none"` when the gap has no owning spec, or a spec slug. */
  readonly owningSpec: string;
  /** Raw `open_half_carried_by` value, or `null` when the key is absent. */
  readonly openHalfCarriedBy: string | null;
  /** 1-based line number of this entry's metadata comment. */
  readonly line: number;
}

/** One D5 structured-field defect — a `<!-- gap: ... -->` comment missing `owning_spec`, or carrying an out-of-enum `status`. */
export interface StructuredEntryViolation {
  readonly line: number;
  readonly reason: string;
  readonly text: string;
}

/**
 * Scans `content` for every `<!-- gap: ... -->` metadata comment line and
 * validates it against D5's structured-field requirement: `id` and `status`
 * present with `status` in {@link GAP_STATUS_VALUES}, and `owning_spec`
 * present as a KEY (its value may legitimately be the literal `"none"`
 * placeholder — that is NOT the same as the key being absent, which is a
 * violation). A line with no metadata comment contributes nothing — `GAP-5`,
 * which has no heading or comment of its own, is therefore simply never seen
 * here, with no special-casing required.
 */
export function extractGapEntries(content: string): { entries: GapEntry[]; violations: StructuredEntryViolation[] } {
  const lines = content.split("\n");
  const entries: GapEntry[] = [];
  const violations: StructuredEntryViolation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fields = parseGapCommentFields(line);
    if (fields === null) continue;

    // reason: only `owning_spec` presence and `status` enum membership are AC-GD-3(e)'s two
    // pinned rejection probes — a placeholder id keeps a comment with a missing/malformed `id`
    // key visible (it surfaces as a conspicuously wrong id in the report) rather than crashing
    // the whole scan over one entry's typo.
    const id = fields["id"] ?? `(unknown id at line ${i + 1})`;
    const hasOwningSpecKey = Object.prototype.hasOwnProperty.call(fields, "owning_spec");
    const status = fields["status"];

    if (!hasOwningSpecKey) {
      violations.push({ line: i + 1, reason: `entry ${id} is missing required field 'owning_spec'`, text: line });
      continue;
    }
    if (status === undefined || !(GAP_STATUS_VALUES as readonly string[]).includes(status)) {
      violations.push({
        line: i + 1,
        reason: `entry ${id} has an out-of-enum 'status' value: '${status ?? "(missing)"}' — must be one of ${GAP_STATUS_VALUES.join(", ")}`,
        text: line,
      });
      continue;
    }

    entries.push({
      id,
      status: status as GapStatus,
      owningSpec: fields["owning_spec"] ?? "none",
      openHalfCarriedBy: fields["open_half_carried_by"] ?? null,
      line: i + 1,
    });
  }

  return { entries, violations };
}

// ─── Pure: unowned-gap report predicate (f, D5) ─────────────────────────────

/**
 * D5's accepted four-field disjunction, after the spec text rejects two
 * simpler phrasings that either exclude a member the AC asserts or
 * double-count one gap:
 *
 *   (status === "open" && owning_spec is absent/"none")
 *   OR (status === "half-closed" && open_half_carried_by is absent)
 *
 * Order of the returned array follows `entries`' order (i.e. document
 * order), not alphabetical/numeric — callers that need a stable comparison
 * set should sort.
 */
export function computeUnownedGapIds(entries: readonly GapEntry[]): string[] {
  const unowned: string[] = [];
  for (const e of entries) {
    const openUnowned = e.status === "open" && (e.owningSpec === "none" || e.owningSpec.length === 0);
    const halfClosedUncarried = e.status === "half-closed" && (e.openHalfCarriedBy === null || e.openHalfCarriedBy.length === 0);
    if (openUnowned || halfClosedUncarried) unowned.push(e.id);
  }
  return unowned;
}

// ─── Pure: GAP-19 scope-line check (h, D6) ──────────────────────────────────

/** D6's GAP-19 scope-line verdict — see {@link checkGap19Scope}. */
export interface Gap19ScopeCheck {
  readonly present: boolean;
  readonly ok: boolean;
  readonly line: number | null;
  readonly text: string | null;
  readonly reasons: readonly string[];
}

/**
 * D6: if a `## GAP-19 ...` heading exists, its heading line must contain
 * `main` and must not contain `PENDING`, `mirror branch`, or `a9f801dd` — the
 * entry used to scope its own defect to a branch that never existed,
 * steering readers away from a live defect on `main`. Vacuously `ok: true,
 * present: false` when the document has no GAP-19 heading at all (most
 * fixtures exercising other clauses).
 */
export function checkGap19Scope(content: string): Gap19ScopeCheck {
  const lines = content.split("\n");
  const headingRe = /^##\s+GAP-19\b/;
  const headingIndex = lines.findIndex((line) => headingRe.test(line ?? ""));
  if (headingIndex === -1) {
    return { present: false, ok: true, line: null, text: null, reasons: [] };
  }
  const text = lines[headingIndex] ?? "";
  const reasons: string[] = [];
  if (!text.includes("main")) reasons.push("scope line does not contain 'main'");
  for (const forbidden of GAP19_FORBIDDEN_SCOPE_TOKENS) {
    if (text.includes(forbidden)) reasons.push(`scope line contains forbidden token '${forbidden}'`);
  }
  return { present: true, ok: reasons.length === 0, line: headingIndex + 1, text, reasons };
}

// ─── Pure: full evaluator ───────────────────────────────────────────────────

/** The full per-clause verdict for one ledger content string — see {@link evaluateLedger}. */
export interface NamespaceCheckResult {
  readonly bareTokenViolations: readonly BareTokenViolation[];
  readonly structuredViolations: readonly StructuredEntryViolation[];
  readonly entries: readonly GapEntry[];
  readonly unownedGapIds: readonly string[];
  readonly gap19Scope: Gap19ScopeCheck;
  /** `true` iff there is no namespace, structured-entry, or GAP-19 scope violation. */
  readonly ok: boolean;
}

/** Evaluates one ledger content string against every AC-GD-3 clause except (d) (SSOT), which is a property of {@link readLedgerFromCorpus}'s wiring, not of the content itself. */
export function evaluateLedger(content: string): NamespaceCheckResult {
  const bareTokenViolations = findBareTokenViolations(content);
  const { entries, violations: structuredViolations } = extractGapEntries(content);
  const unownedGapIds = computeUnownedGapIds(entries);
  const gap19Scope = checkGap19Scope(content);
  const ok = bareTokenViolations.length === 0 && structuredViolations.length === 0 && gap19Scope.ok;
  return { bareTokenViolations, structuredViolations, entries, unownedGapIds, gap19Scope, ok };
}

// ─── IO: corpus read (D4b — never the exported mirror) ─────────────────────

/**
 * Thrown when the `lore` subprocess invocation fails to run, exits non-zero,
 * or returns unparseable/unexpectedly-shaped JSON — a scan-level failure,
 * loud by construction, never degraded to an empty/clean result. Carries the
 * full argv, exit code, and BOTH stdout and stderr.
 */
export class LedgerReadError extends Error {
  constructor(
    public readonly argv: readonly string[],
    public readonly exitCode: number,
    public readonly stdout: string,
    public readonly stderr: string,
  ) {
    super(`check-gap-namespace: \`bun run ${argv.join(" ")}\` failed (exit ${exitCode}): ${stderr || stdout || "(no output)"}`);
    this.name = "LedgerReadError";
  }
}

const LoreGetResponseSchema = z.object({
  ok: z.literal(true),
  data: z.object({
    doc: z.object({
      content: z.string(),
    }),
  }),
});

/**
 * Reads the gap ledger's markdown BODY from the lore CORPUS — never
 * `docs/requirements/knowledge/` (D4b). Shells to `bun run <index.ts> get
 * <slug> --json` with `cwd` set to `corpusCwd`, the SAME accessor a human
 * uses (`lore get`), never a raw sqlite/file reach-in. There is no other
 * corpus-reading code path in this file.
 */
export function readLedgerFromCorpus(corpusCwd: string, slug: string): string {
  const argv = [INDEX_TS, "get", slug, "--json"];
  const result = spawnSync("bun", ["run", ...argv], {
    cwd: corpusCwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: "1" },
  });

  if (result.error) {
    throw new LedgerReadError(argv, -1, "", result.error.message);
  }
  const status = result.status ?? -1;
  if (status !== 0) {
    throw new LedgerReadError(argv, status, result.stdout ?? "", result.stderr ?? "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    throw new LedgerReadError(argv, status, result.stdout ?? "", `JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const validated = LoreGetResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new LedgerReadError(argv, status, result.stdout ?? "", `unexpected response shape: ${validated.error.message}`);
  }
  return validated.data.data.doc.content;
}

// ─── IO: reporting + entrypoint ─────────────────────────────────────────────

/** Human-readable report over one {@link NamespaceCheckResult}. */
export function formatReport(result: NamespaceCheckResult, slug: string): string {
  const lines: string[] = [];

  if (result.bareTokenViolations.length > 0) {
    lines.push(`check-gap-namespace: ${result.bareTokenViolations.length} bare G<n> token(s) found in '${slug}' — rename to GAP-<n>:`);
    for (const v of result.bareTokenViolations) {
      lines.push(`  line ${v.line} [entry: ${v.heading ?? "(no preceding heading)"}] '${v.token}': ${v.text.trim()}`);
    }
  }

  if (result.structuredViolations.length > 0) {
    lines.push(`check-gap-namespace: ${result.structuredViolations.length} structured-entry violation(s):`);
    for (const v of result.structuredViolations) {
      lines.push(`  line ${v.line}: ${v.reason}`);
    }
  }

  if (result.gap19Scope.present && !result.gap19Scope.ok) {
    lines.push(`check-gap-namespace: GAP-19 scope-line violation at line ${result.gap19Scope.line}: ${result.gap19Scope.reasons.join("; ")} — ${result.gap19Scope.text ?? ""}`);
  }

  lines.push(
    result.ok
      ? `check-gap-namespace: OK — namespace clean, ${result.entries.length} structured entr${result.entries.length === 1 ? "y" : "ies"} parsed.`
      : `check-gap-namespace: FAILED — see violation(s) above.`,
  );

  lines.push(
    result.unownedGapIds.length > 0
      ? `check-gap-namespace: unowned-gap report (report-only, ${result.unownedGapIds.length}): ${result.unownedGapIds.join(", ")}`
      : `check-gap-namespace: unowned-gap report (report-only): 0 unowned open gap(s).`,
  );

  return lines.join("\n");
}

/**
 * Reads the ledger from the corpus (D4b), evaluates every AC-GD-3 clause,
 * prints a human report, and returns the exit code. Never calls
 * `process.exit` itself — the `import.meta.main` block below is the only
 * place that does.
 *
 * @param corpusCwd - directory whose `.lore/` corpus to read from; defaults
 *   to this repo's own root. A test pointing this at a `mkdtemp` + `lore
 *   init` throwaway corpus is how AC-GD-3(d)'s SSOT clause is exercised
 *   without ever writing to this repo's own corpus.
 * @param ledgerSlug - the ledger doc's slug; defaults to the real ledger.
 */
export function main(corpusCwd: string = REPO_ROOT, ledgerSlug: string = LEDGER_SLUG): number {
  const content = readLedgerFromCorpus(corpusCwd, ledgerSlug);
  const result = evaluateLedger(content);
  console.log(formatReport(result, ledgerSlug)); // CLI surface — human-readable report to stdout
  return result.ok ? 0 : 3;
}

// CLI surface — direct invocation (`bun scripts/check-gap-namespace.ts`) reads this repo's own
// corpus and reports/exits; never reached when this file is imported by a test.
if (import.meta.main) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`check-gap-namespace: could not run — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}
