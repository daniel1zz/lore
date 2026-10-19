/**
 * Real filesystem discovery probe for project memory files (spec-project-
 * claude-md-content-contract-governance-injected) — walks a repo tree
 * collecting every memory file matching `budgets.filenames` (default
 * `["CLAUDE.md"]`), classifying the repo-root-level match as `role: "root"`
 * and every nested match as `role: "module"`, PLUS a separate recursive walk
 * of `.claude/rules/` collecting every `.md` file there as `role: "rules"`
 * (N8, spec-claude-md-governance-content-dimension-checks-wire-the). Feeds
 * `runMemoryFileChecks` (`../service/claude-md-admission.js`) the SAME way
 * `real-fs-probe.ts` feeds `DriftCheckService` — the CLI adapter reads files
 * here, the check services themselves stay pure/store-free.
 *
 * Public surface:
 *   discoverMemoryFiles(repoRoot, filenames) — the discovery walk.
 *
 * @invariant Never throws on an unreadable directory or file — an entry that
 *   can't be `readdirSync`'d or `readFileSync`'d is silently skipped (this
 *   probe answers "what memory files exist and what do they contain", not
 *   filesystem health; `real-fs-probe.ts`'s FsProbe contract handles that
 *   concern elsewhere).
 * @invariant The `role: "root"`/`"module"` walk excludes `.git`,
 *   `node_modules`, and `.lore-backups` (matched by directory basename at ANY
 *   depth, not just at the repo root), PLUS the single relative path
 *   `.claude/worktrees` (N8: this repo parks linked worktrees there — a
 *   worktree's own CLAUDE.md copies would otherwise be double-counted
 *   against the SAME repo's budget). ⛔ `.claude` itself is NOT excluded
 *   wholesale any more — narrowed, not removed, so `.claude/rules/` stays
 *   reachable; only the ONE `worktrees` subdirectory of `.claude` is skipped,
 *   never a `worktrees` directory found anywhere else in the tree.
 * @invariant AC-STR-10: the `role: "root"`/`"module"` walk never descends into
 *   a NON-ROOT directory that contains an entry named `.git` (a directory, as
 *   in a nested clone, OR a gitfile, as in a submodule) — that directory is
 *   another repository's root, so its CLAUDE.md files are not modules of THIS
 *   repo (issue #24). See `isNestedRepoRoot`; the walk's own `repoRoot` is
 *   exempt, so the host repo's own `.git` never stops it.
 * @invariant The repo-root-level file(s) (`<repoRoot>/<filename>` for each
 *   entry in `filenames`) are ALWAYS classified `role: "root"`; every match
 *   found at any deeper level (outside `.claude/worktrees`) is `role:
 *   "module"` — a root-level match is never double-recorded by the recursive
 *   walk (see `walkForModuleMatches`).
 * @invariant The `role: "rules"` walk (`walkRulesDir`) is a SEPARATE pass
 *   over `<repoRoot>/.claude/rules`, not filename-gated (unlike the
 *   root/module walk, which matches only `budgets.filenames`) — every `.md`
 *   file at any depth under that one directory counts, since a rule file's
 *   name is never `CLAUDE.md` in practice. A repo with no `.claude/rules/`
 *   directory contributes zero `role: "rules"` records, silently (no error).
 *
 * Side-effect class: IO (synchronous node:fs reads only — never writes)
 * Source: spec-project-claude-md-content-contract-governance-injected §Scope;
 *   spec-claude-md-governance-content-dimension-checks-wire-the, N7/N8/AC-RULES-1.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { MemoryFileRecord } from "../service/claude-md-findings.js";

/** Directory basenames never descended into, at any depth. */
const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".lore-backups",
]);

/**
 * Repo-relative directory paths (forward-slash, no leading/trailing slash)
 * never descended into by {@link walkForModuleMatches} — narrower than
 * {@link EXCLUDED_DIR_NAMES} because a basename match would also catch a
 * `worktrees` directory anywhere else in the tree, and because `.claude`
 * itself must stay walkable (N8) for `.claude/rules/` to be reachable. Only
 * this ONE path is excluded: this repo's own linked-worktree parking spot,
 * each a full checkout carrying its own CLAUDE.md copies that would
 * otherwise double-count against the SAME repo's budget the moment `.claude`
 * stopped being excluded wholesale (task's own two-condition trap — see
 * `claude-md-rules-discovery.test.ts`'s module header).
 */
const EXCLUDED_RELATIVE_DIRS: ReadonlySet<string> = new Set([".claude/worktrees"]);

/**
 * True when `dir` has an entry named `.git` (directory OR gitfile) — i.e. it
 * is the root of another repository. Callers MUST NOT pass the host repo root
 * (see `walkForModuleMatches`): only non-root directories are tested.
 * `existsSync` returns false on any error, matching this probe's never-throw
 * contract.
 */
function isNestedRepoRoot(dir: string): boolean {
  return existsSync(join(dir, ".git"));
}

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
 * Discovers every project memory file under `repoRoot`: every file matching
 * one of `filenames` (`role: "root"`/`"module"`), PLUS every `.md` file under
 * `.claude/rules/` (`role: "rules"`, N8) — the two are independent passes
 * (`walkForModuleMatches`/`walkRulesDir`) over the SAME `repoRoot`, results
 * concatenated.
 *
 * @param repoRoot - Absolute repo root to walk.
 * @param filenames - Tracked filenames (`budgets.filenames`, e.g.
 *   `["CLAUDE.md"]`) — matched by exact basename. Governs ONLY the
 *   root/module pass; the rules pass matches by directory, not filename.
 * @returns The repo-root-level match(es) (`role: "root"`), every nested
 *   root/module match (`role: "module"`), then every `.claude/rules/**\/*.md`
 *   file (`role: "rules"`), in that order. A repo with no matching files
 *   anywhere returns `[]`.
 * @example
 * discoverMemoryFiles(process.cwd(), ["CLAUDE.md"]);
 * // => [
 * //   { path: "CLAUDE.md", role: "root", content: "..." },
 * //   { path: "packages/core/CLAUDE.md", role: "module", content: "..." },
 * //   { path: ".claude/rules/testing.md", role: "rules", content: "..." },
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
  walkRulesDir(repoRoot, join(repoRoot, ".claude", "rules"), records);

  return records;
}

/**
 * Recursively walks `dir` collecting nested (`role: "module"`) matches into
 * `records`. `repoRoot` itself is walked too (to reach its subdirectories),
 * but a match found directly IN `repoRoot` is skipped here —
 * `discoverMemoryFiles` already recorded every root-level match above. Skips
 * `EXCLUDED_DIR_NAMES` by basename and `EXCLUDED_RELATIVE_DIRS` by exact
 * repo-relative path (currently just `.claude/worktrees` — see that
 * constant's own doc for why a path match, not a basename match, is needed
 * here).
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
      const childDir = join(dir, entry.name);
      const relativeChildDir = relative(repoRoot, childDir).split(sep).join("/");
      if (EXCLUDED_RELATIVE_DIRS.has(relativeChildDir)) continue;
      if (isNestedRepoRoot(childDir)) continue; // AC-STR-10: another repo's root
      walkForModuleMatches(repoRoot, childDir, filenameSet, records);
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

/**
 * Recursively walks `dir` (expected to be `<repoRoot>/.claude/rules`)
 * collecting every `.md` file at any depth as `role: "rules"` (N8,
 * AC-RULES-1) — deliberately NOT filename-gated (unlike
 * {@link walkForModuleMatches}'s `budgets.filenames` match): a path-scoped
 * rule file is never named `CLAUDE.md` in practice, so gating on that
 * filename would silently discover nothing. `dir` not existing (no
 * `.claude/rules/` directory in this repo at all) is the ordinary,
 * non-error case — `readdirSync` throwing ENOENT is caught and this function
 * returns having added nothing, same as any other unreadable directory in
 * this probe (module header).
 */
function walkRulesDir(repoRoot: string, dir: string, records: MemoryFileRecord[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      walkRulesDir(repoRoot, join(dir, entry.name), records);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;

    const absolutePath = join(dir, entry.name);
    const content = tryReadFile(absolutePath);
    if (content === undefined) continue;

    const relativePath = relative(repoRoot, absolutePath).split(sep).join("/");
    records.push({ path: relativePath, role: "rules", content });
  }
}

/** Repo-relative directories whose `*.md` files are context fragments (project layer, then the shipped layer of this repo). */
const FRAGMENT_DIRS: readonly string[] = [".lore/context", "assets/context"];

/**
 * Reads every context fragment under `repoRoot` as a reference document: raw file text
 * (frontmatter included, so a reference's line number is its line in the file).
 * A directory that does not exist is an empty layer; a listed `*.md` file that cannot be
 * read THROWS naming the path, because a fragment the check cannot read is not a clean one.
 *
 * @param repoRoot - Absolute repo root.
 * @returns `{ path, content }` per fragment, project layer first, file names sorted.
 * @example
 * discoverFragmentDocuments(process.cwd());
 * // => [{ path: ".lore/context/test-runner-split.md", content: "---\nid: ..." }]
 */
export function discoverFragmentDocuments(repoRoot: string): Array<{ path: string; content: string }> {
  const documents: Array<{ path: string; content: string }> = [];
  for (const dir of FRAGMENT_DIRS) {
    const absoluteDir = join(repoRoot, dir);
    if (!existsSync(absoluteDir)) continue;
    for (const name of readdirSync(absoluteDir).filter((n) => n.endsWith(".md")).sort()) {
      documents.push({ path: `${dir}/${name}`, content: readFileSync(join(absoluteDir, name), "utf8") });
    }
  }
  return documents;
}
