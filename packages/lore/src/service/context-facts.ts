/**
 * Context-facts collection for the "context verb family" (SPEC-context-verb-
 * family-two-zone-claude-md-anatomy-lore, §Public Interface, §Module
 * Boundary). Gathers the raw, regeneratable facts `flows/context-flow.ts`
 * renders into the lore-managed (Z1) `ManagedSection[]` — a nested-module
 * index (repo-relative dir + whether it already carries a tracked memory
 * file) and the repo-root `package.json`'s `scripts` map. ALL IO goes through
 * the injected {@link FsReadPort} (`@lore/core`) — this module never imports
 * `node:fs` directly, so ~most of it is exercisable against
 * `InMemoryFsPort` in a plain vitest unit test (D9's whole point).
 *
 * Public surface:
 *   - ModuleIndexEntry — one discovered module directory + memory-file presence
 *   - ContextFacts — `{ moduleIndex, commands }`, the full collected bundle
 *   - collectContextFacts(fs, root, budgetsCfg) — the collection entry point
 *
 * Invariants:
 *   - `root` is repo-relative (never a leading `/`, never a `..` segment) —
 *     `""` means "the whole tree the injected `fs` represents". A malformed
 *     `root` fails loud with `VALIDATION_ERROR` before any `fs` call.
 *   - Directories named `.git`, `node_modules`, `.claude`, `.lore`,
 *     `.lore-backups`, `dist`, or `coverage` are never descended into, at any
 *     depth — mirrors `adapters/real-memory-file-probe.ts`'s own exclusion
 *     set. That set is module-private there (a real-`node:fs` walker, a
 *     DIFFERENT layer from this port-based one), so it cannot be imported
 *     here without creating a `service/` -> `adapters/` dependency edge
 *     (backwards per the module boundary's "core <- service <- flows <-
 *     adapters" direction) — this is an independent, intentionally
 *     equivalent list at this module's own layer, not a second copy of the
 *     SAME implementation (that one walks real `node:fs`; this one walks an
 *     injected `FsReadPort`, exercised in tests against `InMemoryFsPort`).
 *   - A directory is discovered by `listDir` returning at least one entry
 *     for it — `FsReadPort` has no `isDirectory` primitive (by design, D9:
 *     a narrow 3-read-method contract), so a childless directory (real or
 *     simulated) is indistinguishable from a plain file and is simply never
 *     recorded as a module — undercounting an edge case is the accepted,
 *     documented direction (spec's own "misses acceptable, false alarms are
 *     not" risk posture, `claude-md-check.ts`'s identical stance).
 *   - Walk is capped at `MAX_MODULE_INDEX_ENTRIES` recorded entries — a
 *     defensive ceiling against a pathological (or adversarially deep)
 *     tree; hitting it silently stops recording further entries rather than
 *     failing the whole collection.
 *   - An absent, unreadable, or schema-invalid root `package.json` degrades
 *     `commands` to `{}` rather than failing the whole collection — a
 *     missing/malformed manifest must never block `lore context init` from
 *     producing at least the module-index/pointer sections.
 *   - `budgetsCfg.filenames` (e.g. `["CLAUDE.md"]`, `resolveMemoryFileBudgets`
 *     defaults) is the ONLY input this module reads off `budgetsCfg` — the
 *     line/byte ceilings themselves are a `claude-md-check.ts` lint concern,
 *     unrelated to fact collection.
 *
 * Side-effect class: IO (exclusively via the injected `FsReadPort`)
 *
 * Source: spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   §Public Interface, §Module Boundary, §Structure; task
 *   task-skill-implement-context-facts-collection-flow.
 */

import { z } from "zod";
import { err, ok } from "@lore/core";
import type { FsReadPort, LoreError, MemoryFileBudgets, Result } from "@lore/core";

// ─── Public shapes ───────────────────────────────────────────────────────────

/** One discovered module directory, plus whether it already carries a tracked memory file. */
export interface ModuleIndexEntry {
  /** Repo-relative directory path (POSIX separators), relative to `root`. */
  path: string;
  /** `true` iff at least one of `budgetsCfg.filenames` exists directly inside this directory. */
  hasMemoryFile: boolean;
}

/** The full facts bundle `flows/context-flow.ts` renders into managed sections. */
export interface ContextFacts {
  /** Discovered nested module directories, in walk order (breadth-first per directory, depth-first overall). */
  moduleIndex: ModuleIndexEntry[];
  /** `root`'s `package.json` `scripts` map, or `{}` when absent/unreadable/schema-invalid. */
  commands: Record<string, string>;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Directory basenames never descended into, at any depth — see module header. */
const EXCLUDED_DIR_BASENAMES: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".claude",
  ".lore",
  ".lore-backups",
  "dist",
  "coverage",
]);

/** Defensive ceiling on recorded module-index entries — see module header. */
const MAX_MODULE_INDEX_ENTRIES = 500;

/**
 * Boundary validation for a root `package.json`'s parsed JSON (SPEC boundary
 * rule: any `JSON.parse` result flows through a Zod parse before use).
 * `.passthrough()` — this module only ever reads `.scripts`, every other
 * `package.json` field is the caller's business, not a shape this module
 * enforces.
 */
const rootPackageJsonSchema = z.object({ scripts: z.record(z.string()).optional() }).passthrough();

// ─── Path helpers ────────────────────────────────────────────────────────────

/** Joins repo-relative POSIX path segments, skipping empty ones — never `node:path` (these are logical repo-relative strings, not real fs paths; the real `FsReadPort`/`FsWritePort` implementation resolves them against an absolute root at the CLI adapter boundary, D9). */
function joinRepoPath(...segments: string[]): string {
  return segments.filter((s) => s.length > 0).join("/");
}

/**
 * Validates that `root` is a legal repo-relative path prefix: `""` (whole
 * tree) or a POSIX path with no leading `/` and no `..` segment. Mirrors
 * `@lore/core`'s `normalizeFileAnchors` validation rules narrowly (that
 * function additionally enforces a max length/count and a trailing-slash
 * directory convention this module doesn't need — `root` is a single
 * internal walk prefix, not a user-authored anchor list).
 */
function validateRoot(root: string): Result<void, LoreError> {
  if (root.startsWith("/")) {
    return err({
      code: "VALIDATION_ERROR",
      field: "root",
      message: `root must be repo-relative (no leading "/"): "${root}"`,
      value: root,
    });
  }
  if (root.split("/").some((segment) => segment === "..")) {
    return err({
      code: "VALIDATION_ERROR",
      field: "root",
      message: `root must not contain ".." segments: "${root}"`,
      value: root,
    });
  }
  return ok(undefined);
}

// ─── Commands (package.json scripts) ────────────────────────────────────────

/** Reads `root`'s `package.json` and extracts `.scripts`, degrading to `{}` on any absence/parse/schema failure (see module header). */
async function readCommands(fs: FsReadPort, root: string): Promise<Record<string, string>> {
  const raw = await fs.readFile(joinRepoPath(root, "package.json"));
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  const validated = rootPackageJsonSchema.safeParse(parsed);
  if (!validated.success) return {};
  return validated.data.scripts ?? {};
}

// ─── Module index walk ───────────────────────────────────────────────────────

/** `true` iff any of `filenames` exists directly inside `dir`. */
async function hasAnyMemoryFile(fs: FsReadPort, dir: string, filenames: readonly string[]): Promise<boolean> {
  for (const filename of filenames) {
    if (await fs.exists(joinRepoPath(dir, filename))) return true;
  }
  return false;
}

/**
 * Recursively walks `dir` (starting at `root`), recording every discovered
 * subdirectory (see module header for how "directory" is inferred from
 * `FsReadPort`'s narrow surface) into `out`, until `MAX_MODULE_INDEX_ENTRIES`
 * is reached.
 */
async function walkModuleIndex(
  fs: FsReadPort,
  root: string,
  dir: string,
  filenames: readonly string[],
  out: ModuleIndexEntry[],
): Promise<void> {
  if (out.length >= MAX_MODULE_INDEX_ENTRIES) return;

  const entries = await fs.listDir(dir);
  for (const entry of entries) {
    if (EXCLUDED_DIR_BASENAMES.has(entry)) continue;

    const childPath = joinRepoPath(dir, entry);
    const grandchildren = await fs.listDir(childPath);
    if (grandchildren.length === 0) continue; // indistinguishable from a plain file — never recorded (module header)

    const hasMemoryFile = await hasAnyMemoryFile(fs, childPath, filenames);
    const relPath = root.length > 0 ? childPath.slice(root.length + 1) : childPath;
    out.push({ path: relPath, hasMemoryFile });
    if (out.length >= MAX_MODULE_INDEX_ENTRIES) return;

    await walkModuleIndex(fs, root, childPath, filenames, out);
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Collects the full {@link ContextFacts} bundle `flows/context-flow.ts`
 * renders into managed sections.
 *
 * @param fs - Injected filesystem read capability (`InMemoryFsPort` in
 *   tests; a real `node:fs`-backed port, constructed by the CLI adapter, in
 *   production — this module never imports `node:fs` itself, D9).
 * @param root - Repo-relative directory to collect facts from (`""` for the
 *   whole tree the injected `fs` represents).
 * @param budgetsCfg - Resolved `context.memory_files` budgets
 *   (`resolveMemoryFileBudgets`, `@lore/core`) — only `.filenames` is read
 *   here (see module header).
 * @returns `ok(facts)` on success; `err(VALIDATION_ERROR)` only for a
 *   structurally malformed `root` — every other absence/failure mode
 *   (missing `package.json`, an unreadable subdirectory) degrades in place
 *   rather than failing the whole collection (module header).
 * @example
 * const facts = await collectContextFacts(realFsPort, "", resolveMemoryFileBudgets(undefined));
 * // facts.value.moduleIndex // => [{ path: "packages/core", hasMemoryFile: true }, ...]
 */
export async function collectContextFacts(
  fs: FsReadPort,
  root: string,
  budgetsCfg: MemoryFileBudgets,
): Promise<Result<ContextFacts, LoreError>> {
  const rootValidation = validateRoot(root);
  if (!rootValidation.ok) return rootValidation;

  const commands = await readCommands(fs, root);

  const moduleIndex: ModuleIndexEntry[] = [];
  await walkModuleIndex(fs, root, root, budgetsCfg.filenames, moduleIndex);

  return ok({ moduleIndex, commands });
}
