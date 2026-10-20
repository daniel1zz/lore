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
 *     task-workflow.ts's readClaimRecord/extractEvidence shape
 *   - fileAnchorProbePath / classifyFileAnchorResolution / unprobedFileAnchors —
 *     the RESOLUTION-classification half (task-a-mistyped-task-file-anchor-is-
 *     stored-and-consulted): given filesystem observations COLLECTED ELSEWHERE,
 *     name the declared anchors that do not resolve. Advisory only — see
 *     `classifyFileAnchorResolution`'s JSDoc for why a missing path is never a
 *     refusal at any layer.
 *
 * Invariants:
 *   - No IO, no wall-clock reads — this module has nothing to do with staleness;
 *     that's task-workflow.ts's isClaimStale. The resolution half takes
 *     ALREADY-COLLECTED probe results (the same shape `computeDrift` takes),
 *     because `@lore/core` is browser-safe and must never import `fs`: the fs
 *     port lives in `packages/lore/src/service/anchor-resolution.ts`.
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
 * ASCII JS-identifier grammar of a `#Symbol` suffix — the ONE definition, shared with `code-anchors.ts`
 * (a task's `path#Symbol` file anchor and a spec's code anchor accept exactly the same spellings).
 */
export const FILE_ANCHOR_SYMBOL_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** A file anchor split into its path part and its optional `#Symbol` scope. */
export interface SplitFileAnchor {
  /** The anchor without its `#Symbol` suffix (a directory anchor keeps its trailing `/`). */
  readonly path: string;
  /** The top-level symbol the anchor is scoped to, or `undefined` for a whole-file / directory anchor. */
  readonly symbol: string | undefined;
}

/**
 * Splits `anchor` on its LAST `#` when the tail is a valid symbol and the head is not a directory.
 *
 * A `#` whose tail is not a symbol (a stored legacy entry) stays part of the path: reading never throws and never
 * reinterprets a legacy literal path as a symbol scope. Authoring is validated by {@link normalizeFileAnchors}.
 *
 * @example
 * splitFileAnchor("src/app.ts#wire"); // => { path: "src/app.ts", symbol: "wire" }
 * splitFileAnchor("src/app.ts");      // => { path: "src/app.ts", symbol: undefined }
 */
export function splitFileAnchor(anchor: string): SplitFileAnchor {
  const hash = anchor.lastIndexOf("#");
  if (hash <= 0) return { path: anchor, symbol: undefined };
  const head = anchor.slice(0, hash);
  const tail = anchor.slice(hash + 1);
  if (head.endsWith("/") || !FILE_ANCHOR_SYMBOL_RE.test(tail)) return { path: anchor, symbol: undefined };
  return { path: head, symbol: tail };
}

/** The path part of a file anchor: `src/app.ts#wire` -> `src/app.ts`; a path or directory anchor is returned as is. */
export function fileAnchorPath(anchor: string): string {
  return splitFileAnchor(anchor).path;
}

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
 * wins, order otherwise preserved. A `#Symbol` suffix (`src/app.ts#wire`, ASCII
 * identifier, never on a directory) scopes the entry to one top-level symbol of
 * one file; the dedup key is the whole entry, so two symbols of one file both
 * survive.
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

    // `path#Symbol`: the symbol scopes the hold to one top-level symbol of ONE file. Split on the LAST `#`.
    const hashAt = raw.lastIndexOf("#");
    const symbol = hashAt === -1 ? undefined : raw.slice(hashAt + 1);
    const body = hashAt === -1 ? raw : raw.slice(0, hashAt);
    if (symbol !== undefined) {
      if (!FILE_ANCHOR_SYMBOL_RE.test(symbol)) {
        return err({
          code: "VALIDATION_ERROR",
          field: "file_anchors",
          message: `file anchor symbol must be an ASCII identifier (path#Symbol): "${raw}"`,
          value: raw,
        });
      }
      if (body.endsWith("/")) {
        return err({
          code: "VALIDATION_ERROR",
          field: "file_anchors",
          message: `a directory anchor must not carry a #Symbol: "${raw}"`,
          value: raw,
        });
      }
    }

    const isDir = body.endsWith("/");
    const segments: string[] = [];
    for (const seg of body.split("/")) {
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

    const normalizedEntry = segments.join("/") + (isDir ? "/" : "") + (symbol !== undefined ? `#${symbol}` : "");
    if (!seen.has(normalizedEntry)) {
      seen.add(normalizedEntry);
      normalized.push(normalizedEntry);
    }
  }

  return ok(normalized);
}

/** One anchor parsed into D4's `(segments, isDir)` model, plus its optional `#Symbol` scope. */
interface ParsedAnchor {
  segments: string[];
  isDir: boolean;
  symbol: string | undefined;
}

/** Parses an already-normalized anchor string into `(segments, isDir, symbol)` (D4). */
function parseNormalizedAnchor(normalized: string): ParsedAnchor {
  const { path, symbol } = splitFileAnchor(normalized);
  const isDir = path.endsWith("/");
  const trimmed = isDir ? path.slice(0, -1) : path;
  const segments = trimmed.split("/").filter((s) => s.length > 0);
  return { segments, isDir, symbol };
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
 *     `"src/a"` × `"src/a/"` OVERLAP) AND their symbol scopes are compatible
 *     (`"a.ts#F"` × `"a.ts#G"` do NOT overlap; `"a.ts#F"` × `"a.ts"` and
 *     `"a.ts#F"` × `"a.ts#F"` DO — an absent symbol is the whole file), or
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
      const samePath = segmentsEqual(parsedA.segments, parsedB.segments);
      // Symbol scope narrows ONLY a same-file pair: two different symbols of one file are disjoint holds; a
      // whole-file anchor (no symbol) overlaps every symbol of its file; a directory has no symbol.
      const symbolsCompatible = parsedA.symbol === undefined || parsedB.symbol === undefined || parsedA.symbol === parsedB.symbol;
      const overlaps =
        (samePath && symbolsCompatible) ||
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
 * `task-workflow.ts`'s `extractEvidence`/`readClaimRecord` shape exactly.
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

// ─── Resolution Classification (task-a-mistyped-task-file-anchor-is-stored-and-consulted) ──

/**
 * The four ways a DECLARED file anchor can fail to resolve on the working tree.
 *
 * Deliberately a SUBSET of `code-anchors.ts`'s `DRIFT_KINDS` with the same
 * spellings — a reader who has learned one vocabulary reads the other. The two
 * kinds omitted are meaningless for a task anchor: `symbol_missing` (a task
 * anchor's `#Symbol` scopes a HOLD, it is never probed for existence — a task
 * may anchor a symbol it is about to add) and `dir_empty` (an EMPTY directory is a perfectly good anchor for a
 * task that is about to add the first file to it).
 */
export const FILE_ANCHOR_NONRESOLUTION_KINDS = [
  "file_missing",
  "dir_missing",
  "node_type_mismatch",
  "probe_error",
] as const;

/** Derived classification for one non-resolving declared file anchor. */
export type FileAnchorNonResolutionKind = (typeof FILE_ANCHOR_NONRESOLUTION_KINDS)[number];

/**
 * One already-collected filesystem observation for ONE distinct anchor path —
 * the narrow task-anchor counterpart of `code-anchors.ts`'s `AnchorProbe`
 * (deliberately narrower: no `children`/`content`, since neither directory
 * emptiness nor exported symbols mean anything for a task's file anchors).
 *
 * Both fields are optional because a probe may fail at any stage:
 *   - `error` set → the probe could not affirmatively look (e.g. the
 *     symlink-escape refusal `buildRealFsProbe` throws). NEVER treated as
 *     "resolves" — a probe that could not look reports `probe_error`.
 *   - `stat` absent while `error` is absent too → the collector recorded nothing
 *     usable; classified as missing rather than resolved (same safe direction).
 */
export interface FileAnchorProbeResult {
  /** `FsProbe.stat(path)` result, when the call succeeded. */
  stat?: "file" | "dir" | "missing";
  /** Set iff the probe call for this path threw or refused. */
  error?: string;
}

/** One declared anchor that failed to resolve, plus why. */
export interface NonResolvingFileAnchor {
  /** The anchor EXACTLY as declared/stored (directory scope keeps its trailing `/`). */
  anchor: string;
  kind: FileAnchorNonResolutionKind;
  /** Human-readable detail — populated for `probe_error` only. */
  detail?: string;
}

/** Why a resolution report carries no findings *because nothing was probed*. */
export const FILE_ANCHOR_UNPROBED_REASONS = ["no-fs-probe"] as const;

/** Derived reason type for {@link UnprobedFileAnchors}. */
export type FileAnchorUnprobedReason = (typeof FILE_ANCHOR_UNPROBED_REASONS)[number];

/**
 * "No filesystem probe was performed" — structurally distinct from a probed
 * report that found nothing. ⛔ Never collapse the two: `unresolved: []` means
 * "every declared anchor resolves"; THIS means "we do not know", and the whole
 * defect this type exists for was a silence that read like the former.
 */
export interface UnprobedFileAnchors {
  probed: false;
  reason: FileAnchorUnprobedReason;
}

/** A completed probe of a declared anchor set, rooted at `root`. */
export interface ProbedFileAnchors<Row = NonResolvingFileAnchor> {
  probed: true;
  /** Absolute directory every anchor was resolved against — names WHERE we looked, so a wrong-cwd run is distinguishable from a typo. */
  root: string;
  /** Every declared anchor that failed to resolve, in declaration order. `[]` = all good. */
  unresolved: Row[];
}

/**
 * Discriminated union carried by every surface that reports anchor resolution
 * (CLI write advisories, MCP payloads, `ReadyReport.anchor_resolution`).
 * Generic over the row so the plan-scoped `lore ready` variant can widen it with
 * `task_slug` without a second, drift-prone copy of the union.
 *
 * @example
 * // Consumers MUST branch on the discriminant, never on `unresolved.length`:
 * if (!report.probed) console.log("not probed"); else console.log(report.unresolved.length);
 */
export type FileAnchorResolutionReport<Row = NonResolvingFileAnchor> =
  | UnprobedFileAnchors
  | ProbedFileAnchors<Row>;

/**
 * Constructs the {@link UnprobedFileAnchors} value. A function (not a shared
 * constant) so no caller can mutate a singleton, and so the `reason` is always
 * stated explicitly rather than defaulted into silence.
 *
 * @param reason - Why no probe ran (currently only `"no-fs-probe"`: the caller
 *   supplied no filesystem port — e.g. MCP `lore_ready`/HTTP `/ready`, which
 *   answer for a caller whose cwd this process cannot speak for).
 * @returns `{ probed: false, reason }`
 * @example
 * unprobedFileAnchors("no-fs-probe"); // => { probed: false, reason: "no-fs-probe" }
 */
export function unprobedFileAnchors(reason: FileAnchorUnprobedReason): UnprobedFileAnchors {
  return { probed: false, reason };
}

/**
 * The filesystem path a declared anchor is probed at — the anchor minus its
 * directory-scope marker.
 *
 * A trailing `/` is `anchorsOverlap`'s directory-scope MARKER (D4), not part of
 * the path: `statSync("some/file.ts/")` fails with ENOTDIR, which would
 * misreport a file-vs-directory mismatch as "missing". Stripping it here keeps
 * the probe key and the classification honest, and lets two spellings of the
 * same path (`"a"` and `"a/"`) share ONE probe call.
 *
 * @param anchor - One NORMALIZED anchor entry (`normalizeFileAnchors` output).
 * @returns The repo-relative path to stat.
 * @example
 * fileAnchorProbePath("src/service/"); // => "src/service"
 * fileAnchorProbePath("src/a.ts");     // => "src/a.ts"
 */
export function fileAnchorProbePath(anchor: string): string {
  const path = fileAnchorPath(anchor);
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Classifies every declared anchor against already-collected probe results —
 * pure, unit-testable with hand-built maps, no filesystem access (the IO lives
 * in `packages/lore/src/service/anchor-resolution.ts`, which drives the SAME
 * injected `FsProbe` port `lore status --check-drift` probes through).
 *
 * ⛔ This is an ADVISORY computation, not validation. A non-resolving anchor is
 * NEVER a refusal at any layer, and `normalizeFileAnchors` deliberately gains no
 * existence check: a spec's `code_anchors` are declared AFTER the code lands (so
 * their referent must exist), while a task's `file_anchors` are declared BEFORE
 * the work — a task creating a new module legitimately anchors a path that does
 * not exist yet, and refusing it would make the worktree mutex unusable for
 * exactly the highest-risk case (two agents both creating the same new file).
 *
 * ⛔ "The path resolves" is a PROXY for "this anchor names the file this task
 * will touch", and the filesystem can only ever speak to part of it. Two
 * accepted gaps, both known: a typo that lands on a DIFFERENT real file
 * (`session-service.ts` → `sessions.ts`) satisfies the proxy while violating the
 * property and stays silent here; a to-be-created file violates the proxy while
 * satisfying the property, which is why this is an advisory. Binding:
 * `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`.
 *
 * ⛔ Scope, stated so no future reader overclaims: anchors are themselves
 * opt-in. An UNDECLARED anchor is invisible to `noAnchorOverlap` entirely, so
 * probing declared anchors only makes the DECLARED set more trustworthy — it
 * does nothing about the undeclared set, and manual intersection queueing
 * remains necessary as defense-in-depth. Nothing here closes the anchor-mutex
 * hole. Separately: a peer session concluded that anchor-SCOPED predicates are
 * the wrong shape for verifying worktree state (its fix was re-specified from
 * anchor-scoped to whole-worktree `git status` porcelain). That conclusion is
 * about trusting anchors as a SCOPE; this function improves the anchors
 * themselves. They do not conflict — but this function is NOT evidence that
 * anchor-scoped predicates are safe.
 *
 * Classification order per anchor (first match wins):
 *   1. no probe entry for its path, or `error` set → `probe_error`
 *   2. `stat` absent or `"missing"` → `dir_missing` (directory scope) / `file_missing`
 *   3. directory scope but `stat === "file"` → `node_type_mismatch`
 *   4. plain anchor but `stat === "dir"` → `node_type_mismatch`
 *   5. otherwise → resolves (no row)
 *
 * @param anchors - Declared, NORMALIZED anchors (`extractFileAnchors` output).
 * @param probes - Observations keyed by {@link fileAnchorProbePath} (one entry
 *   per DISTINCT path — probe-level dedup is the collector's job).
 * @returns One row per non-resolving anchor, in declaration order; `[]` when
 *   every declared anchor resolves (the CONTROL: a resolving anchor is SILENT).
 * @example
 * classifyFileAnchorResolution(["src/gone.ts"], new Map([["src/gone.ts", { stat: "missing" }]]));
 * // => [{ anchor: "src/gone.ts", kind: "file_missing" }]
 */
export function classifyFileAnchorResolution(
  anchors: readonly string[],
  probes: ReadonlyMap<string, FileAnchorProbeResult>,
): NonResolvingFileAnchor[] {
  const rows: NonResolvingFileAnchor[] = [];

  for (const anchor of anchors) {
    const isDir = anchor.endsWith("/");
    const path = fileAnchorProbePath(anchor);
    const probe = probes.get(path);

    if (probe === undefined) {
      rows.push({
        anchor,
        kind: "probe_error",
        detail: `no probe result recorded for path "${path}"`,
      });
      continue;
    }
    if (probe.error !== undefined) {
      rows.push({ anchor, kind: "probe_error", detail: probe.error });
      continue;
    }
    if (probe.stat === undefined || probe.stat === "missing") {
      rows.push({ anchor, kind: isDir ? "dir_missing" : "file_missing" });
      continue;
    }
    if (isDir && probe.stat === "file") {
      rows.push({ anchor, kind: "node_type_mismatch" });
      continue;
    }
    if (!isDir && probe.stat === "dir") {
      rows.push({ anchor, kind: "node_type_mismatch" });
      continue;
    }
  }

  return rows;
}
