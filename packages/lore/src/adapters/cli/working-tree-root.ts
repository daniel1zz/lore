/**
 * Resolves the working tree a lore command writes TRACKED repository files into.
 *
 * Purpose: the corpus location and the tree tracked files are edited in are two different facts
 * (adr-main-advances-only-by-lore-integrate-per-session, "Corpus home"). The corpus resolves through the git
 * common dir (spec-corpus-resolution-carries-provenance-and-a-foreign-write M4) and may sit in the shared main
 * checkout; tracked files (CLAUDE.md, .claude/rules, .lore/context, .lore/export-index.json, ...) are written
 * only in the invoking session's own working tree.
 * Public surface: {@link resolveWorkingTreeRoot}, {@link resolveTrackedWriteRoot}.
 * Invariants: the probe runs in the explicit `cwd` argument (never an ambient cwd); outside any git working tree
 *   the caller's own fallback root is returned unchanged; inside one whose toplevel cannot be measured the result
 *   is a refusal naming it (no fallback to the corpus root, which would silently write the wrong tree).
 * Side-effect class: IO (spawns `git rev-parse`).
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

const PROBE_TIMEOUT_MS = 5000;

/**
 * Toplevel of the git working tree containing `cwd`.
 *
 * @param cwd - the Invocation's cwd
 * @returns `ok(path)` inside a working tree; `ok(undefined)` when `cwd` is not inside any git working tree;
 *   a VALIDATION_ERROR refusal when git says it is inside one but the toplevel cannot be measured
 */
export function resolveWorkingTreeRoot(cwd: string): Result<string | undefined, LoreError> {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  if (inside.error !== undefined) return refuse(cwd, `git could not be run: ${inside.error.message}`);
  const insideOut = (inside.stdout ?? "").trim();
  if (inside.status !== 0) {
    // reason: git exits 128 with "not a git repository" outside any repository — the documented "unchanged" case.
    if ((inside.stderr ?? "").includes("not a git repository")) return ok(undefined);
    return refuse(cwd, `git rev-parse --is-inside-work-tree exited ${String(inside.status)}: ${(inside.stderr ?? "").trim()}`);
  }
  // reason: "false" = inside a .git dir or bare repo; there is no working tree to write into, so unchanged behaviour.
  if (insideOut === "false") return ok(undefined);
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  const topOut = (top.stdout ?? "").trim();
  if (top.error !== undefined || top.status !== 0 || topOut === "") {
    return refuse(cwd, `git rev-parse --show-toplevel failed inside a working tree: ${(top.stderr ?? "").trim() || "empty output"}`);
  }
  return ok(resolve(cwd, topOut));
}

/**
 * Root a tracked-file write lands in: the invoking working tree's toplevel, else `fallbackRoot` when `cwd` is
 * outside any git working tree.
 *
 * @param cwd - the Invocation's cwd
 * @param fallbackRoot - today's root for a non-git directory (corpus root or cwd walk-up, per command)
 * @returns the write root, or the refusal from {@link resolveWorkingTreeRoot}
 */
export function resolveTrackedWriteRoot(cwd: string, fallbackRoot: string): Result<string, LoreError> {
  const top = resolveWorkingTreeRoot(cwd);
  if (!top.ok) return top;
  return ok(top.value ?? fallbackRoot);
}

function refuse(cwd: string, reason: string): Result<never, LoreError> {
  return err({
    code: "VALIDATION_ERROR",
    field: "cwd",
    message: `cannot determine the working tree to write tracked files into from ${cwd}: ${reason}`,
    value: cwd,
  });
}
