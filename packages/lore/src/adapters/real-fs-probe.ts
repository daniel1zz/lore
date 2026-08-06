/**
 * Real filesystem probe (SPEC-045 §Design Decisions D4) — the `FsProbe`
 * implementation `DriftCheckService.checkDrift` is injected with by the CLI/MCP
 * adapters, backed by synchronous `node:fs` calls resolved against a repo root
 * (the SAME `process.cwd()` assumption `lore status --check-tree`'s blueprint
 * lookup already makes). Shared by `adapters/cli/commands/status.ts` (CLI
 * `--check-drift`) and `adapters/mcp/tools.ts` (`lore_status {check_drift: true}`)
 * — one implementation, never two independently-written probes.
 *
 * Public surface:
 *   buildRealFsProbe(repoRoot?) — constructs an `FsProbe` rooted at `repoRoot`
 *     (default `process.cwd()`).
 *   buildFileAnchorProbeContext(repoRoot?) — the SAME probe paired with its root,
 *     for the task `file_anchors` resolution advisory
 *     (task-a-mistyped-task-file-anchor-is-stored-and-consulted).
 *
 * @invariant `stat()` NEVER throws for a GENUINE stat failure — every ordinary
 *   failure (ENOENT, EACCES, a symlink resolving to neither a file nor a
 *   directory, etc.) collapses to `"missing"`. This is deliberate, not a
 *   shortcut: `computeDrift` (`@lore/core`) classifies `stat === "missing"` as
 *   `file_missing`/`dir_missing` — a REAL drift row, not a silently-swallowed
 *   "consistent". Collapsing every ordinary stat failure into "missing" is
 *   therefore the SAFE direction for G11 (zero false negatives) — a genuinely
 *   deleted anchor (the seeded-drift-fixture's core scenario, SPEC-045 AC-DR-4)
 *   MUST classify as `file_missing`, never `probe_error`.
 * @invariant SYMLINK-ESCAPE GUARD (BUG-015, distinct failure class from the
 *   invariant above) — every probe call first `realpathSync`-resolves the
 *   joined path and rejects it if the RESOLVED location falls outside
 *   `repoRoot`'s own realpath. A repo-internal symlink pointing OUTSIDE the
 *   repo (accidental or malicious) previously probed successfully — `statSync`
 *   follows symlinks by default, so an escaping anchor would report a
 *   perfectly valid "file"/"dir" (or real content/listing) sourced from
 *   OUTSIDE the repository, defeating the whole point of a repo-scoped drift
 *   oracle. Unlike an ordinary stat failure, an escape is NOT collapsed to
 *   "missing" — it is a DISTINCT throw (`stat`) / `null` (`readFile`/
 *   `listDir`) that `DriftCheckService.collectProbes` turns into a
 *   `probe_error` row (G11's OTHER safe direction: a probe that cannot
 *   affirmatively verify — here, refuses to look outside the repo — must never
 *   silently report "consistent" either). A path that genuinely doesn't exist
 *   (realpath itself throws ENOENT) is UNCHANGED by this guard — that's still
 *   the ordinary "missing" collapse, since containment is only checked once a
 *   real, resolvable location is known.
 * @invariant `readFile()`/`listDir()` return `null` on ordinary failure (never
 *   throw) — `DriftCheckService.collectProbes` turns an explicit `null` into a
 *   `probe_error` drift row for that anchor, same effect as a caught throw
 *   (`FsProbe`'s own contract documents both as legal failure signals). The
 *   escape guard above additionally makes them return `null` on a detected
 *   escape (same "probe_error, not silently missing" reasoning as `stat`'s
 *   throw — a `null` and a throw are the two FsProbe-contract-legal failure
 *   signals, so each method uses whichever its OWN pre-existing failure
 *   convention already is).
 *
 * Side-effect class: IO (synchronous node:fs reads only — never writes)
 * Source: SPEC-045 §Design Decisions D4; BUG-015 (symlink-escape hardening)
 */

import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import type { FsProbe } from "../service/drift-check-service.js";
import type { FileAnchorProbeContext } from "../service/anchor-resolution.js";

/**
 * Resolves `path` (repo-relative) against `repoRoot` and returns its REAL
 * (symlink-followed) absolute location, or `undefined` when it genuinely
 * doesn't exist / can't be resolved (ENOENT, EACCES, etc. — the caller's
 * existing "missing"/`null` collapse applies to this case, unchanged by
 * BUG-015).
 */
function tryResolveReal(repoRoot: string, path: string): string | undefined {
  try {
    return realpathSync(join(repoRoot, path));
  } catch {
    return undefined;
  }
}

/** `true` iff `resolved` is `realRepoRoot` itself or a descendant of it. */
function isWithinRoot(realRepoRoot: string, resolved: string): boolean {
  return resolved === realRepoRoot || resolved.startsWith(realRepoRoot + sep);
}

/**
 * Constructs a real, `node:fs`-backed {@link FsProbe} rooted at `repoRoot`.
 *
 * @param repoRoot - Absolute repo root every declared anchor path is resolved
 *   against. Defaults to `process.cwd()` (same assumption `lore status
 *   --check-tree`'s `lore.tree.yaml` lookup makes).
 * @returns An `FsProbe` implementation for {@link DriftCheckService.checkDrift}.
 * @example
 * const probe = buildRealFsProbe(process.cwd());
 * const result = await app.driftCheckService.checkDrift(probe);
 */
export function buildRealFsProbe(repoRoot: string = process.cwd()): FsProbe {
  // reason: realpath the root ONCE, at construction — comparing a realpath'd
  // anchor resolution against a NON-realpath'd repoRoot would false-positive
  // "escape" every single anchor whenever the root itself sits behind a
  // symlink (e.g. macOS `/tmp` -> `/private/tmp`, `mkdtempSync`'s default
  // base). A root that can't be realpath'd at all (repoRoot doesn't exist) is
  // a caller bug — process.cwd() always exists — so this degrades to the raw
  // repoRoot string rather than throwing at construction time; every probe
  // call's own realpath attempt on the JOINED path still fails safely
  // (collapses to "missing"/null) in that scenario.
  const realRepoRoot = (() => {
    try {
      return realpathSync(repoRoot);
    } catch {
      return repoRoot;
    }
  })();

  return {
    stat(path: string): "file" | "dir" | "missing" {
      const resolved = tryResolveReal(repoRoot, path);
      if (resolved === undefined) return "missing";
      if (!isWithinRoot(realRepoRoot, resolved)) {
        // BUG-015: an escape is NOT "missing" — throw so collectProbes turns
        // it into a probe_error row instead of silently reporting "consistent"
        // or (worse) affirmatively verifying content sourced outside the repo.
        throw new Error(
          `anchor path "${path}" resolves to "${resolved}", outside repo root "${realRepoRoot}" — refusing to probe a symlink escape`,
        );
      }
      try {
        const st = statSync(resolved);
        if (st.isDirectory()) return "dir";
        if (st.isFile()) return "file";
        // reason: neither a plain file nor a directory (e.g. a socket, a dangling
        // symlink) — never affirmatively verified, collapses to "missing" (see
        // module @invariant above).
        return "missing";
      } catch {
        return "missing";
      }
    },
    readFile(path: string): string | null {
      const resolved = tryResolveReal(repoRoot, path);
      if (resolved === undefined) return null;
      if (!isWithinRoot(realRepoRoot, resolved)) return null; // BUG-015 escape guard
      try {
        return readFileSync(resolved, "utf8");
      } catch {
        return null;
      }
    },
    listDir(path: string): string[] | null {
      const resolved = tryResolveReal(repoRoot, path);
      if (resolved === undefined) return null;
      if (!isWithinRoot(realRepoRoot, resolved)) return null; // BUG-015 escape guard
      try {
        return readdirSync(resolved);
      } catch {
        return null;
      }
    },
  };
}

/**
 * Pairs {@link buildRealFsProbe} with the root it resolves against — the ONE
 * construction site for the task `file_anchors` resolution advisory's port
 * (task-a-mistyped-task-file-anchor-is-stored-and-consulted, Required #3: reuse
 * the fs port `code-anchors`/`--check-drift` already probes through, never open
 * a second one).
 *
 * @param repoRoot - Absolute root every repo-relative anchor resolves against.
 *   Defaults to `process.cwd()`, the SAME assumption `--check-drift` makes.
 *   ⛔ Deliberately NOT the corpus root (`.lore/`'s parent): inside a linked git
 *   worktree, `findLoreDbPath` falls back to the MAIN checkout's corpus, so a
 *   corpus-rooted probe would answer for a tree the operator is not working in.
 *   cwd is the tree whose files the task will actually touch, and the report
 *   NAMES this root so a wrong-directory run stays distinguishable from a typo.
 * @returns `{ probe, root }` for `collectFileAnchorResolution` /
 *   `TaskWorkflowService.ready`.
 * @example
 * const report = collectFileAnchorResolution(anchors, buildFileAnchorProbeContext());
 */
export function buildFileAnchorProbeContext(repoRoot: string = process.cwd()): FileAnchorProbeContext {
  return { probe: buildRealFsProbe(repoRoot), root: repoRoot };
}
