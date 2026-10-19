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
 *   - MemoryModuleEntry — a folder with a memory file + its Purpose sentence
 *   - extractPurposeSentence(content) — pure Purpose-section reader
 *   - collectContextFacts(fs, root, budgetsCfg) — the collection entry point
 *
 * Invariants:
 *   - `root` is repo-relative (never a leading `/`, never a `..` segment) —
 *     `""` means "the whole tree the injected `fs` represents". A malformed
 *     `root` fails loud with `VALIDATION_ERROR` before any `fs` call.
 *   - Walk hygiene (AC-CTX-9, spec-context-verb-family-two-zone-claude-md-
 *     anatomy-lore; root cause: knowledge-retro-context-refresh-module-
 *     index-walk-pollutes). A directory is excluded from both recording AND
 *     further recursion when ANY of the following holds:
 *       1. Its basename starts with `.` (every dot-directory, at any depth,
 *          regardless of the static denylist below — `.serena`, `.claude`
 *          local caches, etc. are never "modules").
 *       2. Its basename is exactly one of `EXCLUDED_DIR_BASENAMES` (see
 *          below) — mirrors `adapters/real-memory-file-probe.ts`'s own
 *          exclusion set. That set is module-private there (a real-`node:fs`
 *          walker, a DIFFERENT layer from this port-based one), so it cannot
 *          be imported here without creating a `service/` -> `adapters/`
 *          dependency edge (backwards per the module boundary's "core <-
 *          service <- flows <- adapters" direction) — this is an
 *          independent, intentionally equivalent list at this module's own
 *          layer, not a second copy of the SAME implementation. EXACT-MATCH
 *          ONLY, never a prefix/substring test — `dist-npm` resembles the
 *          denylisted `dist` but is a distinct basename and is NOT excluded
 *          by this rule (the contiguous-substring-assumption trap the retro
 *          names); a repo that gitignores it is excluded via rule 3 instead.
 *       3. It is matched by `.gitignore` semantics: root and per-directory
 *          `.gitignore` files are read via `FsReadPort.readFile` (never
 *          `child_process`/`git`) and parsed with the `ignore` npm package
 *          (a mature, spec-compliant matcher). Each directory that owns a
 *          `.gitignore` contributes one matcher layer, scoped to that
 *          directory's own subtree; testing a candidate directory checks
 *          every ANCESTOR layer (root-to-nearest) with the candidate's path
 *          made relative to that layer's own base directory — a deeper
 *          layer's rule (including a negation) can override a shallower
 *          layer's verdict for the SAME path, but a directory already
 *          excluded by an ancestor's layer is never recursed into, so its
 *          own (possibly negating) `.gitignore` is never even read — this
 *          is what makes "a parent directory exclusion cannot be re-included
 *          by a nested negation" hold (gitignore(5); pinned by this module's
 *          own BOUNDARY test), without any special-cased negation logic.
 *     The static denylist (rule 2) is retained unconditionally as a fallback
 *     for repos with no `.gitignore` at all — rules 1-3 are independent, not
 *     mutually exclusive fallback tiers.
 *   - A directory is discovered by `listDir` returning at least one entry
 *     for it — `FsReadPort` has no `isDirectory` primitive (by design, D9:
 *     a narrow 3-read-method contract), so a childless directory (real or
 *     simulated) is indistinguishable from a plain file and is simply never
 *     recorded as a module — undercounting an edge case is the accepted,
 *     documented direction (spec's own "misses acceptable, false alarms are
 *     not" risk posture, `claude-md-admission.ts`'s identical stance).
 *   - Walk is capped at `MAX_MODULE_INDEX_ENTRIES` recorded entries — a
 *     defensive ceiling against a pathological (or adversarially deep)
 *     tree; hitting it stops recording further entries rather than
 *     failing the whole collection, and sets `walkTruncated` so the
 *     rendered index says so (spec-module-index-lists-only-folders-with-a-
 *     memory-file-managed, BR-882 modified: nothing is dropped silently).
 *   - `memoryModules` is the subset of discovered folders holding a memory
 *     file, each with the first sentence of its `Purpose` section
 *     (`extractPurposeSentence`); `modulesWithoutMemoryFile` counts the rest.
 *   - An absent, unreadable, or schema-invalid root `package.json` degrades
 *     `commands` to `{}` rather than failing the whole collection — a
 *     missing/malformed manifest must never block `lore context init` from
 *     producing at least the module-index/pointer sections.
 *   - `budgetsCfg.filenames` (e.g. `["CLAUDE.md"]`, `resolveMemoryFileBudgets`
 *     defaults) is the ONLY input this module reads off `budgetsCfg` — the
 *     line/byte ceilings themselves are a `claude-md-budget.ts` lint concern,
 *     unrelated to fact collection.
 *
 * Side-effect class: IO (exclusively via the injected `FsReadPort`)
 *
 * Source: spec-context-verb-family-two-zone-claude-md-anatomy-lore
 *   §Public Interface, §Module Boundary, §Structure; task
 *   task-skill-implement-context-facts-collection-flow.
 */

import { z } from "zod";
import ignoreFactory, { type Ignore } from "ignore";
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

/** One discovered folder that carries its own memory file — the only kind of folder the rendered module index lists. */
export interface MemoryModuleEntry {
  /** Repo-relative directory path (POSIX separators), relative to `root`. */
  path: string;
  /** Repo-relative path of the memory file itself (`<path>/<filename>`), the link target of the index line. */
  memoryFilePath: string;
  /** First sentence of the memory file's `Purpose` section, or `null` when it has none (rendered as "no Purpose section", never skipped). */
  purpose: string | null;
}

/** The full facts bundle `flows/context-flow.ts` renders into managed sections. */
export interface ContextFacts {
  /** Discovered nested module directories, in walk order (breadth-first per directory, depth-first overall). */
  moduleIndex: ModuleIndexEntry[];
  /** The subset of {@link moduleIndex} that carries a memory file, in walk order, with each file's Purpose sentence. */
  memoryModules: MemoryModuleEntry[];
  /** How many discovered folders carry NO memory file — counted in one rendered line, never listed. */
  modulesWithoutMemoryFile: number;
  /** `true` iff the walk hit {@link MAX_MODULE_INDEX_ENTRIES} and stopped; rendered as a notice so nothing is dropped silently. */
  walkTruncated: boolean;
  /** The scripts `root`'s `package.json` marks via `lore.documentedScripts` (name -> body plus the one-line description the project wrote), or `{}` when none/absent/unreadable. */
  commands: Record<string, DocumentedCommand>;
}

/** One documented script: its actual `package.json` command and the project's own one-line description of it. */
export interface DocumentedCommand {
  command: string;
  description: string;
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

/**
 * Defensive ceiling on recorded module-index entries — see module header. Hitting it sets
 * `ContextFacts.walkTruncated`, which the renderer turns into a visible notice (BR-882 modified:
 * nothing is dropped silently). Sized far above any real repo's folder count so a memory-file folder
 * is never missed on a large tree.
 */
const MAX_MODULE_INDEX_ENTRIES = 20000;

/** Longest Purpose sentence copied into an index line; a longer one is cut with an ellipsis so the entry stays one line. */
const MAX_PURPOSE_CHARS = 160;

/**
 * Boundary validation for a root `package.json`'s parsed JSON (SPEC boundary
 * rule: any `JSON.parse` result flows through a Zod parse before use).
 * `.passthrough()` — this module only ever reads `.scripts` and
 * `.lore.documentedScripts`, every other
 * `package.json` field is the caller's business, not a shape this module
 * enforces.
 */
const rootPackageJsonSchema = z
  .object({
    scripts: z.record(z.string()).optional(),
    // reason: `documentedScripts` is validated on its own in `readCommands` so a wrong shape fails loud
    // instead of the whole package.json degrading to "nothing documented".
    lore: z.object({ documentedScripts: z.unknown().optional() }).passthrough().optional(),
  })
  .passthrough();

/** `lore.documentedScripts`: script name -> non-empty one-line description (D4 of spec-prose-about-code-is-bound-to-what-it-describes-one). */
const documentedScriptsSchema = z.record(
  z
    .string()
    .trim()
    .min(1)
    .refine((text) => !text.includes("\n"), "must be one line"),
);

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

/**
 * Reads `root`'s `package.json` and returns ONLY the scripts the project marks as documented via
 * `"lore": { "documentedScripts": [...] }` (name -> body, in marker order).
 *
 * reason: MI-T4 (task-skill-design-mi-t4-the-generated-command-table-in-claude). The command table in the
 * managed zone is an orientation aid, not a mirror of package.json: copying every script duplicated the
 * hand-written `## Commands` section, surfaced retirement stubs (`test:bun`), and made every package.json edit
 * a CLAUDE.md edit. Opt-in keeps the table to what a project chose to document; with no marker it is empty and
 * renders a pointer. A marker naming a script that does not exist fails loud (stale marker), never silently dropped.
 * Absence/parse/schema failure still degrades to `{}` (see module header).
 */
async function readCommands(fs: FsReadPort, root: string): Promise<Result<Record<string, DocumentedCommand>, LoreError>> {
  const raw = await fs.readFile(joinRepoPath(root, "package.json"));
  if (raw === null) return ok({});

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return ok({});
  }

  const validated = rootPackageJsonSchema.safeParse(parsed);
  if (!validated.success) return ok({});
  const scripts = validated.data.scripts ?? {};
  const marker = validated.data.lore?.documentedScripts;
  if (marker === undefined) return ok({});
  const descriptions = documentedScriptsSchema.safeParse(marker);
  if (!descriptions.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "package.json lore.documentedScripts",
      message: `lore.documentedScripts must map each script name to a non-empty one-line description: ${descriptions.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
      value: marker,
    });
  }
  const documented: Record<string, DocumentedCommand> = {};
  for (const [name, description] of Object.entries(descriptions.data)) {
    const body = scripts[name];
    if (body === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "package.json lore.documentedScripts",
        message: `lore.documentedScripts names "${name}" but package.json has no such script`,
        value: name,
      });
    }
    documented[name] = { command: body, description };
  }
  return ok(documented);
}

// ─── Module index walk ───────────────────────────────────────────────────────

/** The first of `filenames` that exists directly inside `dir`, or `null` when none does. */
async function findMemoryFile(fs: FsReadPort, dir: string, filenames: readonly string[]): Promise<string | null> {
  for (const filename of filenames) {
    if (await fs.exists(joinRepoPath(dir, filename))) return filename;
  }
  return null;
}

/**
 * First sentence of the `Purpose` section of a memory file's text, or `null` when the file has no
 * `Purpose` heading (any level) or the section is empty. Pure.
 *
 * The section runs from the heading to the next heading; its first non-empty paragraph is whitespace-
 * collapsed and cut at the first sentence end (`.`, `!` or `?` followed by whitespace or end of text).
 */
export function extractPurposeSentence(content: string): string | null {
  const lines = content.split(/\r?\n/);
  const headingIdx = lines.findIndex((line) => /^#{1,6}\s+purpose\s*$/i.test(line.trim()));
  if (headingIdx === -1) return null;

  const paragraph: string[] = [];
  for (const line of lines.slice(headingIdx + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (line.trim().length === 0) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  if (paragraph.length === 0) return null;

  const text = paragraph.join(" ");
  const sentenceEnd = text.search(/[.!?](\s|$)/);
  const sentence = sentenceEnd === -1 ? text : text.slice(0, sentenceEnd + 1);
  return sentence.length > MAX_PURPOSE_CHARS ? `${sentence.slice(0, MAX_PURPOSE_CHARS - 1)}…` : sentence;
}

/**
 * `.gitignore` name recognized at every directory level — same convention
 * `git` itself uses, no per-project override (this module's own boundary
 * scope, see header rule 3).
 */
const GITIGNORE_FILENAME = ".gitignore";

/**
 * One directory's own `.gitignore` matcher, scoped to that directory (module
 * header rule 3) — `baseDir` is the repo-relative directory the `.gitignore`
 * file lives in; `matcher.ignores`/`.test` are always called with a path made
 * relative to `baseDir`, never to `root`.
 */
interface GitignoreLayer {
  baseDir: string;
  matcher: Ignore;
}

/**
 * Reads `dir`'s own `.gitignore` (if any) and returns a {@link GitignoreLayer}
 * scoped to it, or `null` when `dir` has no `.gitignore` — the ONLY place
 * this module reads `.gitignore` content, via the injected `FsReadPort`
 * (module header rule 3: never `child_process`/`git`).
 */
async function loadGitignoreLayer(fs: FsReadPort, dir: string): Promise<GitignoreLayer | null> {
  const content = await fs.readFile(joinRepoPath(dir, GITIGNORE_FILENAME));
  if (content === null) return null;
  return { baseDir: dir, matcher: ignoreFactory().add(content) };
}

/**
 * `true` iff `childPath` is excluded by any of `layers`' `.gitignore` rules.
 * Iterates layers in root-to-nearest order (the order {@link walkModuleIndex}
 * accumulates them in) so a deeper layer's explicit verdict (ignore or
 * negation) overrides a shallower one for the same path — matching
 * gitignore(5) precedence — while a directory already excluded by an
 * ancestor layer is never itself recursed into, so it never contributes its
 * own layer (module header rule 3's negation-cannot-escape-ancestor-
 * exclusion guarantee).
 */
function isExcludedByGitignore(childPath: string, layers: readonly GitignoreLayer[]): boolean {
  let verdict = false;
  for (const layer of layers) {
    const relPath =
      layer.baseDir.length === 0
        ? childPath
        : childPath.startsWith(`${layer.baseDir}/`)
          ? childPath.slice(layer.baseDir.length + 1)
          : null;
    if (relPath === null || relPath.length === 0) continue;

    // Directory-only patterns (e.g. "build/") only match with a trailing
    // slash on the tested path — the `ignore` package tests literal pattern
    // shape, it does not itself know `relPath` names a directory.
    const test = layer.matcher.test(`${relPath}/`);
    if (test.ignored) verdict = true;
    else if (test.unignored) verdict = false;
  }
  return verdict;
}

/** Accumulator of one module-index walk (mutated in place by {@link walkModuleIndex}). */
interface WalkResult {
  entries: ModuleIndexEntry[];
  memoryModules: MemoryModuleEntry[];
  withoutMemoryFile: number;
  truncated: boolean;
}

/**
 * Recursively walks `dir` (starting at `root`), recording every discovered
 * subdirectory (see module header for how "directory" is inferred from
 * `FsReadPort`'s narrow surface) into `out`, until `MAX_MODULE_INDEX_ENTRIES`
 * is reached. `layers` carries the accumulated `.gitignore` matchers for
 * every ancestor directory (root-to-nearest) that owns one (module header
 * rule 3) — the caller passes the layer set already covering `dir` itself;
 * this function loads and appends `dir`'s own `.gitignore` only when
 * recursing into a specific child.
 */
async function walkModuleIndex(
  fs: FsReadPort,
  root: string,
  dir: string,
  filenames: readonly string[],
  out: WalkResult,
  layers: readonly GitignoreLayer[],
): Promise<void> {
  if (out.entries.length >= MAX_MODULE_INDEX_ENTRIES) {
    out.truncated = true;
    return;
  }

  const entries = await fs.listDir(dir);
  for (const entry of entries) {
    if (entry.startsWith(".")) continue; // every dot-directory (and dot-file, harmlessly) skipped by default — module header rule 1
    if (EXCLUDED_DIR_BASENAMES.has(entry)) continue; // exact-match static fallback — module header rule 2

    const childPath = joinRepoPath(dir, entry);
    if (isExcludedByGitignore(childPath, layers)) continue; // module header rule 3

    const grandchildren = await fs.listDir(childPath);
    if (grandchildren.length === 0) continue; // indistinguishable from a plain file — never recorded (module header)

    const memoryFile = await findMemoryFile(fs, childPath, filenames);
    const relPath = root.length > 0 ? childPath.slice(root.length + 1) : childPath;
    out.entries.push({ path: relPath, hasMemoryFile: memoryFile !== null });
    if (memoryFile === null) {
      out.withoutMemoryFile += 1;
    } else {
      const memoryFilePath = joinRepoPath(relPath, memoryFile);
      // reason: a memory file that exists but cannot be read is listed as "no Purpose section", never skipped (BR-882 modified).
      const content = await fs.readFile(joinRepoPath(childPath, memoryFile));
      out.memoryModules.push({ path: relPath, memoryFilePath, purpose: content === null ? null : extractPurposeSentence(content) });
    }
    if (out.entries.length >= MAX_MODULE_INDEX_ENTRIES) {
      out.truncated = true;
      return;
    }

    const childLayer = await loadGitignoreLayer(fs, childPath);
    const childLayers = childLayer !== null ? [...layers, childLayer] : layers;
    await walkModuleIndex(fs, root, childPath, filenames, out, childLayers);
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

  const commandsResult = await readCommands(fs, root);
  if (!commandsResult.ok) return commandsResult;
  const commands = commandsResult.value;

  const rootLayer = await loadGitignoreLayer(fs, root);
  const rootLayers = rootLayer !== null ? [rootLayer] : [];

  const walk: WalkResult = { entries: [], memoryModules: [], withoutMemoryFile: 0, truncated: false };
  await walkModuleIndex(fs, root, root, budgetsCfg.filenames, walk, rootLayers);

  return ok({
    moduleIndex: walk.entries,
    memoryModules: walk.memoryModules,
    modulesWithoutMemoryFile: walk.withoutMemoryFile,
    walkTruncated: walk.truncated,
    commands,
  });
}
