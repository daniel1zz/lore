/**
 * Pure two-zone CLAUDE.md marker-section parser/renderer/splicer for the
 * "context verb family" (spec-context-verb-family-two-zone-claude-md-anatomy-lore,
 * AC-CTX-1). Parses/rebuilds the lore-managed (Z1) marker-wrapped zone of a
 * memory file into named, fingerprinted sections, leaving all hand-written
 * (Z2) prose byte-for-byte untouched on every code path.
 *
 * Public surface:
 *   - parseManagedSections(content) — locates the Z1 zone (if any), splits
 *     it into `{id, body, hash}` sections, and returns the Z2 byte spans
 *     (everything outside the zone) so callers can assert exact
 *     byte-preservation.
 *   - renderManagedSections(facts) — renders a facts bundle into the
 *     ordered `ManagedSection[]` a caller passes to `spliceManagedSections`.
 *     The real `ContextFacts` shape (module index, command table, ...) is
 *     owned by the sibling `context-facts.ts` task (out of this file's
 *     anchor) — this interim contract accepts anything already shaped as
 *     `{ sections: ManagedSection[] }` and returns those sections verbatim,
 *     in order. This is a complete, honest implementation of the narrower
 *     contract this task owns, not a deferred placeholder: the sibling task
 *     extends the input shape once `ContextFacts` exists, it does not need
 *     to touch this function's behavior.
 *   - spliceManagedSections(existing, next) — the five-state (created /
 *     updated / unchanged / diverged_skip / appended) idempotent splice:
 *     writes `next`'s sections into the Z1 zone (creating or appending it
 *     if absent), preserving every Z2 byte, and refusing to touch a
 *     section whose stored fingerprint hash no longer matches its stored
 *     body (a hand-edit) rather than silently overwriting it. A pre-existing
 *     marker zone that carries ZERO fingerprint comments anywhere in its
 *     interior (every pre-fingerprinting-era install shape — the template
 *     shipped before this refactor never wrote one) is a recognized LEGACY
 *     zone, not a structural error: the whole interior is discarded and
 *     replaced wholesale by `next`, each section freshly fingerprinted and
 *     reported `"updated"` — a one-way adoption into fingerprinted form (see
 *     the Invariants section below for the exact boundary against a
 *     genuinely malformed fingerprint attempt, which still fails loud).
 *
 * Invariants:
 *   - `next` is the FULL declarative section list for the zone on every
 *     call — a stored section id absent from `next` is dropped from the
 *     rebuilt zone. This mirrors `renderManagedSections`' "regenerated
 *     projection of reality" contract: a caller that wants a section
 *     retained includes it in `next` every time, exactly like
 *     `renderManagedSections` re-derives the full list from facts on every
 *     refresh — there is no separate "delete a section" verb.
 *   - Fingerprint hash = first 8 hex chars of sha256 over the section body
 *     (UTF-8 bytes), EXCLUDING the fingerprint comment line itself.
 *   - A stored section's body is used for divergence detection ONLY: when
 *     its stored hash does not match `sha256(stored body)`, the section is
 *     emitted byte-for-byte as stored (`diverged_skip`), regardless of
 *     what `next` requests for that id — never a silent overwrite.
 *   - Z2 bytes (everything before the start marker and after the end
 *     marker, or the WHOLE original file when a fresh zone is appended
 *     after existing markerless prose) are preserved byte-for-byte,
 *     including the exact newline/CRLF separator absorbed between the zone
 *     and any trailing Z2 content (mirrors
 *     `flows/setup-project-flow.ts::findClaudeMdManagedRange`'s absorption
 *     convention) — this exact-separator round-trip is what makes
 *     `spliceManagedSections(spliceManagedSections(x, s).value.content, s)`
 *     byte-identical to its own input (splice idempotency, AC-CTX-1).
 *   - A start marker found with no matching end marker fails loud with
 *     `VALIDATION_ERROR` — never a partial splice. Inside an otherwise
 *     well-formed zone, a line that LOOKS like an attempted fingerprint
 *     comment (starts with the `<!-- lore:managed` prefix) but doesn't fully
 *     match the grammar is structural damage (a corrupted fingerprint, e.g.
 *     a non-hex/wrong-length hash) and also fails loud with
 *     `VALIDATION_ERROR` — this is the ONE case `spliceManagedSections`
 *     never treats as legacy adoption, no matter how many other fingerprints
 *     are absent. A zone whose interior contains no such attempt anywhere is
 *     legacy adoption instead (see the `spliceManagedSections` bullet
 *     above) — `parseManagedSections` itself still reports `VALIDATION_ERROR`
 *     for both shapes (it has no adoption behavior of its own); the
 *     legacy/malformed distinction is drawn only inside
 *     `spliceManagedSections`, which is the sole write path this adoption
 *     applies to.
 *
 * Side-effect class: pure (no IO, no store, no wall-clock reads). Uses
 * `node:crypto`'s `createHash` for sha256 — safe here because this file is
 * server-only (`packages/lore/src/service/**`), never imported by the
 * browser-safe `@lore/core` barrel.
 *
 * Source: spec-context-verb-family-two-zone-claude-md-anatomy-lore,
 *   §Public Interface, §Design Decisions D4/D5, AC-CTX-1.
 */

import { createHash } from "node:crypto";
import {
  CLAUDE_MD_MARKER_START,
  CLAUDE_MD_MARKER_END,
  formatManagedSectionFingerprint,
  parseManagedSectionFingerprint,
  err,
  ok,
  type LoreError,
  type ManagedSectionMeta,
  type Result,
} from "@lore/core";

// ─── Public shapes ───────────────────────────────────────────────────────────

/** Half-open character-offset range `[start, end)` into a content string. */
export interface Span {
  start: number;
  end: number;
}

/**
 * One managed section as parsed FROM existing content — `hash` is exactly
 * what was stored, not necessarily valid for `body` (divergence detection,
 * comparing this against a freshly computed hash of `body`, is
 * `spliceManagedSections`'s job, not this parse step's).
 */
export interface ParsedManagedSection {
  id: string;
  /** Body exactly as stored, excluding the fingerprint line and any trailing "\n". */
  body: string;
  hash: string;
}

/** Result of `parseManagedSections`: the ordered sections found in the Z1 zone (if any), plus the Z2 byte spans surrounding it. */
export interface ParsedManagedSections {
  sections: ParsedManagedSection[];
  z2Spans: Span[];
}

/** One section a caller wants written into the Z1 zone — the desired `next` state for `spliceManagedSections`. */
export interface ManagedSection {
  id: string;
  body: string;
}

/**
 * Per-section splice outcome — see the module header's Invariants section
 * for the exact trigger condition of each state.
 */
export type SpliceSectionState = "created" | "updated" | "unchanged" | "diverged_skip" | "appended";

/** Full result of a `spliceManagedSections` call. */
export interface SpliceResult {
  content: string;
  perSection: Array<{ id: string; state: SpliceSectionState }>;
}

/**
 * Interim `renderManagedSections` input contract — see the module header's
 * Public-surface note. Anything already pre-shaped as an ordered
 * `ManagedSection[]` bundle is accepted and passed through verbatim.
 */
export interface ManagedSectionsFacts {
  sections: ManagedSection[];
}

/** A stored section's identity + body, reused for both parse output and internal rebuild bookkeeping. */
type StoredSection = ManagedSectionMeta & { body: string };

// ─── sha256 fingerprint hashing ──────────────────────────────────────────────

/** First 8 hex chars of sha256 over `body`'s UTF-8 bytes — the canonical fingerprint hash (matches `@lore/core`'s `MANAGED_SECTION_HASH_PATTERN` shape). */
function sha256Hash8(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex").slice(0, 8);
}

// ─── Zone location ───────────────────────────────────────────────────────────

/**
 * Located Z1 zone span, split so reconstruction can re-insert the exact
 * separator that was absorbed between the zone and any trailing Z2
 * content.
 */
interface ZoneLocation {
  /** Index of the first char of `CLAUDE_MD_MARKER_START`. */
  zoneStart: number;
  /** Index one past the last char of `CLAUDE_MD_MARKER_END` (exclusive), before separator absorption. */
  zoneEndExclusive: number;
  /**
   * The literal newline separator ("" | "\n" | "\r\n") found immediately
   * after the end marker and folded into the zone span, so it is
   * re-inserted verbatim (never duplicated, never dropped) during
   * reconstruction — same absorption convention as
   * `flows/setup-project-flow.ts::findClaudeMdManagedRange`.
   */
  absorbedSeparator: string;
}

/**
 * Finds the Z1 zone's marker span in `content`, if a start marker is
 * present. Returns `null` when there is no start marker at all — a valid,
 * non-error state; the caller decides whether that means "create fresh"
 * (empty file) or "append after existing prose" (non-empty file). Returns
 * `err(VALIDATION_ERROR)` when a start marker is found but no matching end
 * marker follows it — a structurally broken zone, never silently ignored.
 */
function locateZone(content: string): Result<ZoneLocation, LoreError> | null {
  const zoneStart = content.indexOf(CLAUDE_MD_MARKER_START);
  if (zoneStart === -1) return null;

  const endMarkerIdx = content.indexOf(CLAUDE_MD_MARKER_END, zoneStart + CLAUDE_MD_MARKER_START.length);
  if (endMarkerIdx === -1) {
    return err({
      code: "VALIDATION_ERROR",
      field: "content",
      message: "found a lore-managed zone start marker with no matching end marker",
    });
  }

  const zoneEndExclusive = endMarkerIdx + CLAUDE_MD_MARKER_END.length;
  const next2 = content.slice(zoneEndExclusive, zoneEndExclusive + 2);
  const absorbedSeparator = next2 === "\r\n" ? "\r\n" : content[zoneEndExclusive] === "\n" ? "\n" : "";

  return ok({ zoneStart, zoneEndExclusive, absorbedSeparator });
}

/**
 * Renders an ordered list of resolved sections (id + hash + body already
 * decided by the caller) into the Z1 zone's exact wire text: `ZONE_START`,
 * then each section as `<fingerprint line>\n<body>`, then `ZONE_END`,
 * every element joined by a single `"\n"` — a multi-line `body` is pushed
 * as one array element and still round-trips correctly because `join`
 * inserts its separator only BETWEEN elements, never inside one.
 */
function renderZoneText(sections: StoredSection[]): string {
  const lines: string[] = [CLAUDE_MD_MARKER_START];
  for (const section of sections) {
    lines.push(formatManagedSectionFingerprint({ id: section.id, hash: section.hash }));
    lines.push(section.body);
  }
  lines.push(CLAUDE_MD_MARKER_END);
  return lines.join("\n");
}

// ─── parseManagedSections ────────────────────────────────────────────────────

/**
 * Parses `content`'s Z1 managed zone (if present) into its ordered
 * sections plus the Z2 byte spans outside it.
 *
 * @param content - Full file content, LF or CRLF line endings tolerated.
 * @returns `ok` with `{ sections, z2Spans }` — `sections` is `[]` and
 *   `z2Spans` is the whole file when no zone marker is present at all (not
 *   an error: a file with no managed zone yet is a legitimate state).
 * @throws Never — returns `err({ code: "VALIDATION_ERROR", ... })` instead,
 *   for a start marker with no matching end marker, or a line that should
 *   be a fingerprint comment but does not parse as one.
 */
export function parseManagedSections(content: string): Result<ParsedManagedSections, LoreError> {
  const located = locateZone(content);
  if (located === null) {
    return ok({ sections: [], z2Spans: [{ start: 0, end: content.length }] });
  }
  if (!located.ok) return located;

  const { zoneStart, zoneEndExclusive, absorbedSeparator } = located.value;
  const zoneOuterText = content.slice(zoneStart, zoneEndExclusive);
  const lines = zoneOuterText.split(/\r?\n/);
  // lines[0] === CLAUDE_MD_MARKER_START and lines[lastLineIdx] === CLAUDE_MD_MARKER_END
  // by construction of `zoneOuterText` (it spans exactly from the start marker's
  // first char through the end marker's last char).
  const lastLineIdx = lines.length - 1;

  const sections: ParsedManagedSection[] = [];
  let i = 1;
  while (i < lastLineIdx) {
    const fingerprintLine = lines[i] ?? "";
    const meta = parseManagedSectionFingerprint(fingerprintLine);
    if (meta === null) {
      return err({
        code: "VALIDATION_ERROR",
        field: "content",
        message: `expected a lore-managed fingerprint comment inside the managed zone, found: ${fingerprintLine}`,
      });
    }
    i += 1;

    const bodyLines: string[] = [];
    while (i < lastLineIdx && parseManagedSectionFingerprint(lines[i] ?? "") === null) {
      bodyLines.push(lines[i] ?? "");
      i += 1;
    }
    sections.push({ id: meta.id, hash: meta.hash, body: bodyLines.join("\n") });
  }

  const z2Spans: Span[] = [
    { start: 0, end: zoneStart },
    { start: zoneEndExclusive + absorbedSeparator.length, end: content.length },
  ];
  return ok({ sections, z2Spans });
}

// ─── renderManagedSections ───────────────────────────────────────────────────

/**
 * Renders a facts bundle into the ordered `ManagedSection[]` a caller
 * passes to `spliceManagedSections`. See the module header's Public
 * surface note for why `facts`'s real shape is deliberately narrow here.
 *
 * @param facts - A pre-shaped `{ sections }` bundle.
 * @returns `facts.sections`, verbatim and in order.
 */
export function renderManagedSections(facts: ManagedSectionsFacts): ManagedSection[] {
  return facts.sections;
}

// ─── spliceManagedSections ───────────────────────────────────────────────────

/** Every section in `next` treated as freshly created — used both for a brand-new zone and for a zone appended after untouched prose. */
function renderAllAs(next: ManagedSection[], state: Extract<SpliceSectionState, "created" | "appended">): SpliceResult["perSection"] {
  return next.map((section) => ({ id: section.id, state }));
}

/** Resolves `next` sections (none pre-existing) into freshly hashed `StoredSection`s, for the empty-file and appended-zone paths. */
function hashFresh(next: ManagedSection[]): StoredSection[] {
  return next.map((section) => ({ id: section.id, hash: sha256Hash8(section.body), body: section.body }));
}

/** Degenerate case: `existing` is a completely empty file — the whole zone is newly "created". */
function buildFreshZone(next: ManagedSection[]): SpliceResult {
  return { content: renderZoneText(hashFresh(next)), perSection: renderAllAs(next, "created") };
}

/** `existing` has real, non-empty markerless prose — the zone is "appended" after it, verbatim and untouched. */
function buildAppendedZone(existing: string, next: ManagedSection[]): SpliceResult {
  const separator = existing.endsWith("\n") ? "" : "\n";
  return {
    content: `${existing}${separator}${renderZoneText(hashFresh(next))}`,
    perSection: renderAllAs(next, "appended"),
  };
}

/**
 * Matches a line that LOOKS like an attempt at a fingerprint comment (the
 * `<!-- lore:managed ...` prefix), whether or not it fully satisfies the
 * strict grammar `parseManagedSectionFingerprint` enforces. Used ONLY to
 * distinguish "legacy zone, never fingerprinted" (zero attempts anywhere)
 * from "corrupted fingerprint" (an attempt present but malformed) — see
 * `isLegacyZoneInterior`'s doc comment.
 */
const FINGERPRINT_ATTEMPT_PREFIX = /^<!-- lore:managed\b/;

/**
 * Returns the Z1 zone's interior lines (excluding both marker lines
 * themselves) — the same slice `parseManagedSections` walks, exposed here so
 * `isLegacyZoneInterior` can scan it independently of that function's
 * strict-parse control flow.
 */
function zoneInteriorLines(existing: string, zone: ZoneLocation): string[] {
  const zoneOuterText = existing.slice(zone.zoneStart, zone.zoneEndExclusive);
  const lines = zoneOuterText.split(/\r?\n/);
  return lines.slice(1, lines.length - 1);
}

/**
 * A zone is LEGACY ADOPTION material when its interior contains ZERO lines
 * that even attempt the fingerprint-comment prefix — every pre-fingerprint
 * lore build wrote a zone shaped exactly like this (plain prose between the
 * markers, no per-section bookkeeping at all). The moment ONE interior line
 * attempts the prefix and still fails to fully parse, this is NOT legacy —
 * it's a corrupted fingerprint on an already-fingerprinted zone, and
 * `buildRebuiltZone` must keep surfacing the original `VALIDATION_ERROR`
 * rather than silently discarding whatever partial bookkeeping exists.
 */
function isLegacyZoneInterior(existing: string, zone: ZoneLocation): boolean {
  return zoneInteriorLines(existing, zone).every((line) => !FINGERPRINT_ATTEMPT_PREFIX.test(line.trim()));
}

/**
 * Legacy-adoption splice: `existing`'s ENTIRE zone interior is discarded
 * (there is no stored per-section state worth preserving — a legacy zone
 * was never fingerprinted, so there is nothing to diff against) and
 * replaced wholesale by `next`, each section freshly hashed. Every section
 * is reported `"updated"` (never `"created"`) — this is a REPLACE of
 * pre-existing managed content, not the creation of a new zone, mirroring
 * the pre-refactor SPEC-076 D7 wholesale-overwrite behavior this one-way
 * migration path preserves.
 */
function buildLegacyAdoptedZone(existing: string, zone: ZoneLocation, next: ManagedSection[]): SpliceResult {
  const zoneText = renderZoneText(hashFresh(next));
  const z2Before = existing.slice(0, zone.zoneStart);
  const z2After = existing.slice(zone.zoneEndExclusive + zone.absorbedSeparator.length);
  const content = `${z2Before}${zoneText}${zone.absorbedSeparator}${z2After}`;
  const perSection = next.map((section) => ({ id: section.id, state: "updated" as const }));
  return { content, perSection };
}

/**
 * Resolves one requested section against its stored counterpart (if any),
 * producing both the `StoredSection` to serialize and the per-section
 * splice state — the core five-state decision (minus "appended", which
 * only applies when the zone itself is brand new).
 */
function resolveSection(
  requested: ManagedSection,
  stored: StoredSection | undefined,
): { resolved: StoredSection; state: SpliceSectionState } {
  if (stored === undefined) {
    return { resolved: { id: requested.id, hash: sha256Hash8(requested.body), body: requested.body }, state: "created" };
  }

  const recomputedHash = sha256Hash8(stored.body);
  if (recomputedHash !== stored.hash) {
    // Hand-edited since the last write (stored hash no longer matches stored
    // body) — leave it byte-for-byte untouched, never overwrite silently.
    return { resolved: stored, state: "diverged_skip" };
  }

  if (requested.body === stored.body) {
    return { resolved: stored, state: "unchanged" };
  }

  return { resolved: { id: requested.id, hash: sha256Hash8(requested.body), body: requested.body }, state: "updated" };
}

/**
 * An existing, well-formed zone is rebuilt in `next`'s order — see the
 * module header's `next`-is-declarative invariant. A zone `parseManagedSections`
 * can't parse (interior doesn't start with a fingerprint line where one is
 * structurally expected) is routed to `buildLegacyAdoptedZone` when its
 * interior contains no fingerprint-comment ATTEMPT anywhere (a pre-fingerprint
 * legacy shape); any other parse failure — an attempted-but-malformed
 * fingerprint present somewhere in the interior — still propagates
 * `VALIDATION_ERROR` unchanged, never silently adopted.
 */
function buildRebuiltZone(existing: string, zone: ZoneLocation, next: ManagedSection[]): Result<SpliceResult, LoreError> {
  const parsed = parseManagedSections(existing);
  if (!parsed.ok) {
    if (isLegacyZoneInterior(existing, zone)) {
      return ok(buildLegacyAdoptedZone(existing, zone, next));
    }
    return parsed;
  }
  const storedById = new Map(parsed.value.sections.map((section) => [section.id, section] as const));

  const resolutions = next.map((requested) => resolveSection(requested, storedById.get(requested.id)));
  const zoneText = renderZoneText(resolutions.map((r) => r.resolved));
  const perSection = resolutions.map((r, index) => ({ id: next[index]!.id, state: r.state }));

  const z2Before = existing.slice(0, zone.zoneStart);
  const z2After = existing.slice(zone.zoneEndExclusive + zone.absorbedSeparator.length);
  const content = `${z2Before}${zoneText}${zone.absorbedSeparator}${z2After}`;

  return ok({ content, perSection });
}

/**
 * Idempotent five-state splice of `next`'s sections into `existing`'s Z1
 * managed zone — see the module header for the full invariant list.
 *
 * @param existing - Full current file content (possibly empty, possibly
 *   with no zone yet, possibly CRLF).
 * @param next - The FULL desired ordered section list for the zone (not a
 *   partial patch — see the module header's `next`-is-declarative
 *   invariant).
 * @returns `ok` with the spliced `content` and one `perSection` state per
 *   `next` entry, in `next`'s order.
 * @throws Never — returns `err({ code: "VALIDATION_ERROR", ... })` instead
 *   when `existing` has a start marker with no matching end marker, or a
 *   malformed fingerprint line inside an otherwise well-formed zone.
 */
export function spliceManagedSections(existing: string, next: ManagedSection[]): Result<SpliceResult, LoreError> {
  const located = locateZone(existing);

  if (located === null) {
    return ok(existing.length === 0 ? buildFreshZone(next) : buildAppendedZone(existing, next));
  }
  if (!located.ok) return located;

  return buildRebuiltZone(existing, located.value, next);
}
