/**
 * File-anchor resolution advisory — the ONE place a task's declared
 * `extra.file_anchors` are probed against the working tree, and the ONE place the
 * resulting advisory is rendered (task-a-mistyped-task-file-anchor-is-stored-and-
 * consulted).
 *
 * Why this exists: a mistyped anchor is stored, displayed, and consulted by the
 * `noAnchorOverlap` gate exactly like a correct one. Because it can intersect
 * nothing, the mutual exclusion it was declared to provide is simply ABSENT —
 * and before this module, nothing anywhere said so. The classification itself is
 * pure and lives in `@lore/core` (`file-anchors.ts`); this module owns only the
 * IO orchestration and the text projection.
 *
 * Public surface:
 *   collectFileAnchorResolution(anchors, ctx) → probe each DISTINCT path once and
 *     classify every declared anchor (always a `probed: true` report)
 *   renderFileAnchorAdvisory(report, opts)    → the advisory lines a CLI write
 *     surface prints to stderr; `[]` when there is nothing to say
 *   FileAnchorProbeContext                    → the injected fs port + its root
 *
 * @invariant ⛔ NOTHING here can refuse a write. Every export returns a REPORT
 *   or lines — there is no `Result`, no error path, no exit-code influence. A
 *   task legitimately anchors a file it is ABOUT to create (that is precisely the
 *   two-agents-creating-the-same-new-file case the mutex matters most for), so
 *   existence is advisory forever. See `classifyFileAnchorResolution`'s JSDoc for
 *   the full proxy/silence/opt-in accounting, including why
 *   `normalizeFileAnchors` must NOT gain an existence check.
 * @invariant This module NEVER imports the Node filesystem builtin — the
 *   filesystem arrives ONLY through the caller-injected `FsProbe` port, the SAME
 *   port `DriftCheckService.checkDrift` / `lore status --check-drift` probe
 *   through (`adapters/real-fs-probe.ts::buildRealFsProbe` is its one real
 *   implementation, and `buildFileAnchorProbeContext` there is the one place a
 *   context is built). Reusing that port rather than opening a second one is a
 *   requirement of this task, and a source-text grep oracle pins it
 *   (`tests/unit/service/anchor-resolution.test.ts`).
 * @invariant Probe-level dedup: `stat` is called AT MOST ONCE per DISTINCT
 *   `fileAnchorProbePath`, however many anchors (or spellings — `"a"` and
 *   `"a/"`) name it. Mirrors `DriftCheckService.collectProbes`.
 * @invariant Every probe call is individually try/caught — a throw becomes a
 *   `probe_error` row for that path and the scan CONTINUES. A probe that could
 *   not look must never report "resolves" (the same safe direction SPEC-045 G11
 *   takes), because silence is the very defect this module fixes.
 *
 * Side-effect class: IO, but only through the injected port (this module opens no
 *   fs seam of its own; it holds no store and no state).
 *
 * Source: task-a-mistyped-task-file-anchor-is-stored-and-consulted (Required #1,
 *   #3); binding ADR `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`;
 *   port precedent SPEC-045 §Design Decisions D4.
 */

import {
  classifyFileAnchorResolution,
  fileAnchorProbePath,
  type FileAnchorProbeResult,
  type FileAnchorResolutionReport,
  type NonResolvingFileAnchor,
  type ProbedFileAnchors,
} from "@lore/core";
import type { FsProbe } from "./drift-check-service.js";

/**
 * The injected filesystem port plus the absolute directory anchors are resolved
 * against. `root` travels WITH the probe because `FsProbe` deliberately does not
 * expose its own root, and the report must name WHERE it looked — otherwise a
 * run from the wrong directory is indistinguishable from a genuine typo, which
 * would be a new silence in the fix for a silence.
 */
export interface FileAnchorProbeContext {
  probe: FsProbe;
  /** Absolute path every repo-relative anchor was resolved against. */
  root: string;
}

/**
 * Probes every DISTINCT path named by `anchors` and classifies each declared
 * anchor against the result.
 *
 * @param anchors - Declared, normalized anchors (`extractFileAnchors` output).
 *   An empty list probes nothing and returns an empty (but PROBED) report.
 * @param ctx - The injected fs port + its root; see {@link FileAnchorProbeContext}.
 * @returns A `probed: true` report — `unresolved: []` means every declared
 *   anchor resolves, which is a DIFFERENT value from `unprobedFileAnchors()`.
 * @throws Never — a throwing probe becomes a `probe_error` row.
 * @example
 * const report = collectFileAnchorResolution(["src/gone.ts"], { probe, root: "/repo" });
 * // => { probed: true, root: "/repo", unresolved: [{ anchor: "src/gone.ts", kind: "file_missing" }] }
 */
export function collectFileAnchorResolution(
  anchors: readonly string[],
  ctx: FileAnchorProbeContext,
): ProbedFileAnchors {
  const probes = new Map<string, FileAnchorProbeResult>();

  for (const anchor of anchors) {
    const path = fileAnchorProbePath(anchor);
    if (probes.has(path)) continue;
    try {
      probes.set(path, { stat: ctx.probe.stat(path) });
    } catch (error) {
      // reason: a refusal/failure to look is recorded as `error`, which
      // `classifyFileAnchorResolution` turns into a `probe_error` row — never
      // dropped and never collapsed into "resolves" (SPEC-045 G11's direction).
      probes.set(path, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { probed: true, root: ctx.root, unresolved: classifyFileAnchorResolution(anchors, probes) };
}

/** Options for {@link renderFileAnchorAdvisory}. */
export interface FileAnchorAdvisoryOpts<Row extends NonResolvingFileAnchor> {
  /** What the anchors belong to, rendered into the header (e.g. a task slug, or a plan slug for `lore ready`). */
  subject: string;
  /**
   * Left-hand label for one row; defaults to the bare anchor. `lore ready`
   * passes a task-qualifying label, since ONE report there spans many tasks.
   */
  rowLabel?: (row: Row) => string;
}

/**
 * Renders the non-blocking advisory for a resolution report.
 *
 * Emission rules — both directions are load-bearing:
 *   - A report with findings ALWAYS renders, even when the anchor list is
 *     otherwise perfectly valid: the probe is never conditional on some other
 *     failure, because the silence IS the defect.
 *   - A report with NO findings renders NOTHING (the CONTROL — a blanket
 *     advisory would train readers to ignore it), and so does an UNPROBED report
 *     (it has no findings to report; callers that must distinguish "not probed"
 *     from "nothing found" read the `probed` discriminant, never this text).
 *
 * @param report - Output of {@link collectFileAnchorResolution}, or an
 *   `unprobedFileAnchors()` value.
 * @param opts - See {@link FileAnchorAdvisoryOpts}.
 * @returns Lines to write to STDERR (never stdout — `--json` consumers parse
 *   stdout, and an advisory must not corrupt a machine payload). `[]` = silent.
 * @example
 * renderFileAnchorAdvisory(report, { subject: "task-foo" });
 * // => ["file_anchors advisory — 1 declared anchor on task-foo does NOT resolve under /repo:", ...]
 */
export function renderFileAnchorAdvisory<Row extends NonResolvingFileAnchor>(
  report: FileAnchorResolutionReport<Row>,
  opts: FileAnchorAdvisoryOpts<Row>,
): string[] {
  if (!report.probed) return [];
  if (report.unresolved.length === 0) return [];

  const label = opts.rowLabel ?? ((row: Row): string => row.anchor);
  const count = report.unresolved.length;
  const plural = count === 1 ? "anchor does" : "anchors do";

  return [
    `file_anchors advisory — ${count} declared ${plural} NOT resolve under ${report.root} (${opts.subject}):`,
    ...report.unresolved.map((row) => {
      const detail = row.detail !== undefined ? ` — ${row.detail}` : "";
      return `  - ${label(row)} (${row.kind})${detail}`;
    }),
    "  This is NOT a refusal: a task may legitimately anchor a file it is about to create.",
    "  But an anchor that does not resolve can intersect nothing, so the mutual exclusion it",
    "  declares is absent for it — check for a typo, or that you ran this from the repo root.",
  ];
}
