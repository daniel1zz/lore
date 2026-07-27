/**
 * Real filesystem discovery probe for project memory files (spec-project-
 * claude-md-content-contract-governance-injected) — walks a repo tree
 * collecting every memory file matching `budgets.filenames` (default
 * `["CLAUDE.md"]`), classifying the repo-root-level match as `role: "root"`
 * and every nested match as `role: "module"`. Feeds `lintMemoryFiles`
 * (`../service/claude-md-check.js`) the SAME way `real-fs-probe.ts` feeds
 * `DriftCheckService` — the CLI adapter reads files here, the lint service
 * itself stays pure/store-free.
 *
 * Public surface:
 *   discoverMemoryFiles(repoRoot, filenames) — the discovery walk.
 *
 * @invariant Never throws on an unreadable directory or file — an entry that
 *   can't be `readdirSync`'d or `readFileSync`'d is silently skipped (this
 *   probe answers "what memory files exist and what do they contain", not
 *   filesystem health; `real-fs-probe.ts`'s FsProbe contract handles that
 *   concern elsewhere).
 * @invariant Excludes `.git`, `node_modules`, `.claude` (this repo parks
 *   linked worktrees under `.claude/worktrees/` — a worktree's own CLAUDE.md
 *   copies would otherwise be double-counted against the SAME repo's
 *   budget), and `.lore-backups` — matched by directory basename at ANY
 *   depth, not just at the repo root.
 * @invariant The repo-root-level file(s) (`<repoRoot>/<filename>` for each
 *   entry in `filenames`) are ALWAYS classified `role: "root"`; every match
 *   found at any deeper level is `role: "module"` — a root-level match is
 *   never double-recorded by the recursive walk (see `walkForModuleMatches`).
 *
 * Side-effect class: IO (synchronous node:fs reads only — never writes)
 * Source: spec-project-claude-md-content-contract-governance-injected §Scope
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { MemoryFileRecord } from "../service/claude-md-check.js";

/** Directory basenames never descended into, at any depth. */
const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".claude",
  ".lore-backups",
]);

/**
 * Reads `path` as UTF-8 text, or `undefined` if it doesn't exist / isn't a
 * readable file (ENOENT, EACCES, a directory sharing the target name, etc.)
 * — mirrors `real-fs-probe.ts`'s "collapse ordinary failure" convention.
 */
function tryReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Discovers every project memory file under `repoRoot` matching one of
 * `filenames`.
 *
 * @param repoRoot - Absolute repo root to walk.
 * @param filenames - Tracked filenames (`budgets.filenames`, e.g.
 *   `["CLAUDE.md"]`) — matched by exact basename.
 * @returns The repo-root-level match(es) (`role: "root"`) followed by every
 *   nested match (`role: "module"`), in directory-walk order. A repo with no
 *   matching files anywhere returns `[]`.
 * @example
 * discoverMemoryFiles(process.cwd(), ["CLAUDE.md"]);
 * // => [
 * //   { path: "CLAUDE.md", role: "root", content: "..." },
 * //   { path: "packages/core/CLAUDE.md", role: "module", content: "..." },
 * // ]
 */
export function discoverMemoryFiles(repoRoot: string, filenames: string[]): MemoryFileRecord[] {
  const filenameSet = new Set(filenames);
  const records: MemoryFileRecord[] = [];

  for (const filename of filenames) {
    const content = tryReadFile(join(repoRoot, filename));
    if (content !== undefined) {
      records.push({ path: filename, role: "root", content });
    }
  }

  walkForModuleMatches(repoRoot, repoRoot, filenameSet, records);

  return records;
}

/**
 * Recursively walks `dir` collecting nested (`role: "module"`) matches into
 * `records`. `repoRoot` itself is walked too (to reach its subdirectories),
 * but a match found directly IN `repoRoot` is skipped here —
 * `discoverMemoryFiles` already recorded every root-level match above.
 */
function walkForModuleMatches(
  repoRoot: string,
  dir: string,
  filenameSet: Set<string>,
  records: MemoryFileRecord[],
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      walkForModuleMatches(repoRoot, join(dir, entry.name), filenameSet, records);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!filenameSet.has(entry.name)) continue;
    if (dir === repoRoot) continue; // root-level match already recorded as role: "root"

    const absolutePath = join(dir, entry.name);
    const content = tryReadFile(absolutePath);
    if (content === undefined) continue;

    const relativePath = relative(repoRoot, absolutePath).split(sep).join("/");
    records.push({ path: relativePath, role: "module", content });
  }
}
