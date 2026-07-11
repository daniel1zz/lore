/**
 * File-anchor domain — typed `task.extra.file_anchors` normalization + the
 * anchor-overlap predicate that backs the `task-claim` gate's worktree-mutex
 * enforcement (SPEC-042 D3, D4). Pure, browser-safe module: no IO, no
 * Date.now()/Math.random() calls.
 *
 * Public surface:
 *   - normalizeFileAnchors(raw) — validates + normalizes a candidate anchor list,
 *     Result-returning (fail-loud on any malformed entry)
 *   - anchorsOverlap(a, b) — pure precondition-only overlap check over two
 *     ALREADY-NORMALIZED anchor lists (D4)
 *   - extractFileAnchors(task) — defensive read accessor, mirrors
 *     task-workflow.ts's extractClaim/extractEvidence shape
 *
 * Invariants:
 *   - No IO, no wall-clock reads — this module has nothing to do with staleness;
 *     that's task-workflow.ts's isClaimStale.
 *   - normalizeFileAnchors is the SINGLE validation gate for anchor entries —
 *     CorpusService._createImpl (create-time `--anchor`) and every
 *     TaskWorkflowService anchor-mutation verb (setAnchors/addAnchors/
 *     removeAnchors) call this, never re-deriving the segment/leading-slash/
 *     backslash/`..`/cap rules locally (SPEC-042 D3).
 *   - anchorsOverlap is a DOCUMENTED PRECONDITION-ONLY pure function (SPEC-042
 *     D4, review T6) — it has no ERROR path by design. Its inputs are assumed
 *     to already be `normalizeFileAnchors` output; passing raw, un-normalized
 *     strings produces an answer, just not necessarily the intended one (e.g. a
 *     literal `"./a"` won't be recognized as equal to `"a"`). Enforcement of
 *     that precondition lives solely at the D3 write seams, never here.
 *
 * Source: SPEC-042 §Design Decisions D3, D4.
 */

import { err, ok } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import type { DocRecord } from "./types.js";

/** Max number of file_anchors entries a task may declare (SPEC-042 D3 — the evidence cap precedent). */
export const MAX_FILE_ANCHORS = 50;

/** Max length (chars) of one raw file_anchors entry (SPEC-042 D3). */
export const MAX_FILE_ANCHOR_LENGTH = 512;

/**
 * Validates and normalizes a candidate `file_anchors` list (SPEC-042 D3).
 *
 * Per-entry rules (checked in this order, first failure wins):
 *   - non-empty
 *   - at most {@link MAX_FILE_ANCHOR_LENGTH} chars (raw, pre-normalization)
 *   - no `\` (POSIX separators only)
 *   - no leading `/` (repo-relative only — an absolute path is REJECTED, not
 *     silently rewritten to relative)
 *   - no `..` path segments (anywhere)
 *   - must not normalize to an empty path (e.g. `"."`, `"./"`)
 *
 * Normalization: `./`-prefix and duplicate `/` separators are collapsed away; a
 * trailing `/` is PRESERVED as the directory-scope marker `anchorsOverlap` reads
 * (D4). Post-normalization exact-string duplicates are dropped, first occurrence
 * wins, order otherwise preserved.
 *
 * @param anchors - Candidate raw anchor strings (e.g. from `--anchor` flags).
 * @returns `ok(normalized)` — deduplicated, normalized POSIX paths — or
 *   `err(VALIDATION_ERROR)` naming the offending entry on the first violation.
 * @throws Never — always returns a Result.
 *
 * @example
 * normalizeFileAnchors(["src/a", "./src/a", "src/b/"]);
 * // => ok(["src/a", "src/b/"]) — "./src/a" normalizes to "src/a", a duplicate, dropped
 *
 * @example
 * normalizeFileAnchors(["../escape"]);
 * // => err({ code: "VALIDATION_ERROR", field: "file_anchors", ... })
 */
export function normalizeFileAnchors(anchors: string[]): Result<string[], LoreError> {
  if (anchors.length > MAX_FILE_ANCHORS) {
    return err({
      code: "VALIDATION_ERROR",
      field: "file_anchors",
      message: `at most ${MAX_FILE_ANCHORS} file anchors allowed; got ${anchors.length}`,
      value: anchors.length,
    });
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of anchors) {
    if (raw.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "file_anchors",
        message: "file anchor entries must not be empty",
        value: raw,
      });
    }
    if (raw.length > MAX_FILE_ANCHOR_LENGTH) {
      return err({
        code: "VALIDATION_ERROR",
        field: "file_anchors",
        message: `file anchor exceeds ${MAX_FILE_ANCHOR_LENGTH} chars: "${raw.slice(0, 40)}..."`,
        value: raw,
      });
    }
    if (raw.includes("\\")) {
      return err({
        code: "VALIDATION_ERROR",
        field: "file_anchors",
        message: `file anchor must use POSIX "/" separators, not "\\": "${raw}"`,
        value: raw,
      });
    }
    if (raw.startsWith("/")) {
      return err({
        code: "VALIDATION_ERROR",
        field: "file_anchors",
        message: `file anchor must be repo-relative (no leading "/"): "${raw}"`,
        value: raw,
      });
    }

    const isDir = raw.endsWith("/");
    const segments: string[] = [];
    for (const seg of raw.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        return err({
          code: "VALIDATION_ERROR",
          field: "file_anchors",
          message: `file anchor must not contain ".." segments: "${raw}"`,
          value: raw,
        });
      }
      segments.push(seg);
    }

    if (segments.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "file_anchors",
        message: `file anchor normalizes to an empty path: "${raw}"`,
        value: raw,
      });
    }

    const normalizedEntry = segments.join("/") + (isDir ? "/" : "");
    if (!seen.has(normalizedEntry)) {
      seen.add(normalizedEntry);
      normalized.push(normalizedEntry);
    }
  }

  return ok(normalized);
}

/** One anchor parsed into D4's `(segments, isDir)` model. */
interface ParsedAnchor {
  segments: string[];
  isDir: boolean;
}

/** Parses an already-normalized anchor string into `(segments, isDir)` (D4). */
function parseNormalizedAnchor(normalized: string): ParsedAnchor {
  const isDir = normalized.endsWith("/");
  const trimmed = isDir ? normalized.slice(0, -1) : normalized;
  const segments = trimmed.split("/").filter((s) => s.length > 0);
  return { segments, isDir };
}

/** Case-sensitive, whole-segment array equality. */
function segmentsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((seg, i) => seg === b[i]);
}

/** True iff `prefix` is a STRICT (shorter, non-equal) whole-segment prefix of `full`. */
function isStrictSegmentPrefix(prefix: readonly string[], full: readonly string[]): boolean {
  if (prefix.length >= full.length) return false;
  return prefix.every((seg, i) => seg === full[i]);
}

/** Result of {@link anchorsOverlap}. */
export interface AnchorOverlapResult {
  /** True iff at least one pair overlaps. */
  overlaps: boolean;
  /** Every overlapping `(a-entry, b-entry)` pair, in scan order. */
  pairs: Array<[string, string]>;
}

/**
 * Pure overlap check between two NORMALIZED anchor lists (SPEC-042 D4).
 * Documented PRECONDITION-ONLY — see module invariant: no ERROR path, no
 * re-validation of its inputs.
 *
 * Two anchors overlap iff:
 *   - their `segments` are exactly equal (REGARDLESS of `isDir` on either side —
 *     `"src/a"` × `"src/a/"` OVERLAP), or
 *   - one side has `isDir === true` and its `segments` is a STRICT whole-segment
 *     prefix of the other's (`"src/a/"` × `"src/a/b.ts"` overlaps;
 *     `"src/a"` × `"src/ab.ts"` does NOT — segment boundaries, never a raw
 *     string-prefix test).
 *
 * Case-sensitive byte compare. Either list empty ⇒ no overlap (vacuous).
 *
 * @param a - First normalized anchor list (e.g. a claim candidate's own anchors).
 * @param b - Second normalized anchor list (e.g. a sibling's declared anchors).
 * @returns `{overlaps, pairs}` — `pairs` lists every overlapping combination.
 *
 * @example
 * anchorsOverlap(["src/a"], ["src/a/"]).overlaps;      // => true
 * anchorsOverlap(["src/a/"], ["src/a/b.ts"]).overlaps; // => true (directory scope)
 * anchorsOverlap(["src/a"], ["src/ab.ts"]).overlaps;   // => false (segment boundary)
 * anchorsOverlap([], ["src/a"]).overlaps;               // => false (vacuous)
 */
export function anchorsOverlap(a: string[], b: string[]): AnchorOverlapResult {
  if (a.length === 0 || b.length === 0) {
    return { overlaps: false, pairs: [] };
  }

  const pairs: Array<[string, string]> = [];
  for (const rawA of a) {
    const parsedA = parseNormalizedAnchor(rawA);
    for (const rawB of b) {
      const parsedB = parseNormalizedAnchor(rawB);
      const overlaps =
        segmentsEqual(parsedA.segments, parsedB.segments) ||
        (parsedA.isDir && isStrictSegmentPrefix(parsedA.segments, parsedB.segments)) ||
        (parsedB.isDir && isStrictSegmentPrefix(parsedB.segments, parsedA.segments));
      if (overlaps) {
        pairs.push([rawA, rawB]);
      }
    }
  }
  return { overlaps: pairs.length > 0, pairs };
}

/**
 * Defensive `extra` accessor — mirrors task-workflow.ts's identical
 * `safeTaskExtra` helper (duplicated, not imported, to avoid a reverse
 * dependency — that module doesn't depend on this one).
 */
function safeTaskExtra(task: DocRecord): Record<string, unknown> {
  const extra: unknown = task.extra;
  return extra !== null && typeof extra === "object" && !Array.isArray(extra)
    ? (extra as Record<string, unknown>)
    : {};
}

/**
 * Extracts a task's declared `file_anchors`. Returns `[]` when absent or
 * malformed (defensive — `extra` is untyped storage), mirroring
 * `task-workflow.ts`'s `extractEvidence`/`extractClaim` shape exactly.
 *
 * @invariant Does NOT re-run `normalizeFileAnchors` on read — entries written
 *   through the sanctioned seams (create-time `--anchor`, the
 *   TaskWorkflowService anchor-mutation verbs) are already normalized at write
 *   time. An entry written via an unsanctioned raw `lore set --extra-json`
 *   bypass may not be normalized; that is an accepted, documented limitation
 *   (SPEC-042 D3 — anchor mutations are deliberately NOT routed through
 *   `CorpusService.set`).
 */
export function extractFileAnchors(task: DocRecord): string[] {
  const raw = safeTaskExtra(task)["file_anchors"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === "string");
}
