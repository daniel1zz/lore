/**
 * Hybrid dependency materializer for a falsifier's scratch git worktree
 * (`adr-a-falsifier-s-scratch-worktree-gets-dependencies-by-hybrid`;
 * `spec-a-falsifier-s-scratch-worktree-must-be-runnable-and` AC-SD-1..4).
 *
 * Public surface:
 *   - `materializeFalsifierDependencies(scratchWorktreeDir, mainRepoRoot)` — builds
 *     the hybrid `node_modules` layout described below INSIDE an already-created
 *     scratch git worktree (see `createFalsifierScratchWorktree` in
 *     `verify-runner-service.ts` — this module never creates or removes the
 *     worktree itself, only populates its dependency tree; wiring the two
 *     together is a later task's own file anchor, deliberately not done here).
 *   - `deriveWorkspaceMembers(mainRepoRoot)` — the runtime derivation the hybrid
 *     layout depends on (AC-SD-2): reads `mainRepoRoot/package.json`'s
 *     `workspaces` globs (today always the literal `"<dir>/*"` shape this repo
 *     uses), expands each against the filesystem, and reads every matched
 *     member's OWN `package.json` `name` field. Exported separately so a caller
 *     can inspect the derived set (or a test can prove it changes with zero code
 *     change here) without re-running the whole materialization.
 *
 * The hybrid layout (ADR decision, restated in code terms):
 * ```
 * <scratch>/node_modules/                        REAL directory (never a symlink)
 *   <every top-level entry of mainRepoRoot's own   SYMLINK -> absolute path inside
 *    node_modules, dotted entries (.bin)            mainRepoRoot's own node_modules
 *    included, EXCEPT the one derived scope>
 *   <scope>/                                       REAL directory (e.g. "@lore")
 *     <member short name>                          SYMLINK -> <scratch>/<baseDir>/<dirName>
 *                                                    (INSIDE the scratch tree — this
 *                                                    is the whole point: resolution
 *                                                    must land on the scratch tree's
 *                                                    OWN copy, never loop back through
 *                                                    the outer node_modules symlink
 *                                                    into mainRepoRoot)
 * <scratch>/<baseDir>/<dirName>/node_modules        SYMLINK -> mainRepoRoot's own
 *   (one per member whose mainRepoRoot counterpart   <baseDir>/<dirName>/node_modules,
 *    HAS a nested node_modules — discovered by       for a member that has one
 *    enumeration, never by name)
 * ```
 *
 * Why NOT the obvious `ln -s <main>/node_modules <scratch>/node_modules`: see
 * `knowledge-a-symlinked-node-modules-makes-the-green-control-pass`. A workspace
 * member's own `node_modules/<scope>/<member>` entry in `mainRepoRoot` is a
 * RELATIVE symlink (e.g. `../../packages/core`); path resolution follows the
 * OUTER `node_modules` symlink first, landing back in `mainRepoRoot` — every
 * bare-specifier import of a workspace package would silently read UNMUTATED
 * source while a green control reports a healthy scratch environment. This
 * module exists to make that structurally impossible: the scope directory is
 * always a REAL directory built fresh by this function, and every entry under
 * it is created pointing INSIDE `scratchWorktreeDir`, never through
 * `mainRepoRoot`'s own `node_modules`.
 *
 * Invariants:
 *   - Never writes to `mainRepoRoot` — every `mkdirSync`/`symlinkSync` write
 *     target is rooted at `scratchWorktreeDir` (AC-SD-4). `mainRepoRoot` is
 *     read-only input; its own `node_modules/<scope>/*` links are read (via
 *     the derivation) but never rewritten.
 *   - The workspace member set, and the single scope prefix excluded from the
 *     blind top-level symlink pass, are DERIVED from `mainRepoRoot`'s own
 *     `package.json` (+ each member's own `package.json`) at CALL TIME — never
 *     a hand-listed array (AC-SD-2). Adding a package to `mainRepoRoot` between
 *     two calls, with zero code change here, changes what the next call does.
 *   - Exactly ONE workspace scope is supported by design, matching the ADR's
 *     literal "the workspace scope (@lore)" — every derived member MUST share
 *     the same `@scope/` prefix, or this function refuses loud rather than
 *     guessing which scope is "the" workspace scope. An unscoped workspace
 *     member (no `@scope/` prefix at all) is refused the same way.
 *   - Fails loud (`VALIDATION_ERROR` / `STORE_ERROR`), never a silent partial
 *     layout, for: a missing `mainRepoRoot/node_modules`, a `package.json`
 *     that EXISTS but is unreadable/unparsable, a member missing its own
 *     `name` field, a scratch nested path absent for a main-checkout nested
 *     `node_modules`, or a pre-existing `scratchWorktreeDir/node_modules` —
 *     all refuse before any symlink is created. The ONE deliberate
 *     exception: a workspace-base-dir directory with NO `package.json` at
 *     all is not a workspace member and is silently excluded rather than
 *     aborting the whole call (see `deriveWorkspaceMembers`'s own doc —
 *     Finding 2 of task-make-the-falsifier-s-negative-control-a-permanent-runnable).
 *   - Does NOT create, remove, or know about git worktrees — that lifecycle
 *     belongs to `createFalsifierScratchWorktree`/`removeFalsifierScratchWorktree`
 *     (`verify-runner-service.ts`), which this module is deliberately not wired
 *     into yet (wiring is a later task's own file anchor).
 *
 * Side-effect class: IO (`node:fs` — `readdirSync`/`readFileSync`/`mkdirSync`/
 *   `symlinkSync`/`existsSync`, all synchronous, matching
 *   `verify-runner-service.ts`'s own falsifier primitives' style).
 *
 * Source: `adr-a-falsifier-s-scratch-worktree-gets-dependencies-by-hybrid`;
 *   `spec-a-falsifier-s-scratch-worktree-must-be-runnable-and` AC-SD-1, AC-SD-2,
 *   AC-SD-3, AC-SD-4; `knowledge-a-symlinked-node-modules-makes-the-green-control-pass`.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { err, ok } from "@lore/core";
import type { Result, LoreError } from "@lore/core";

/**
 * Zod boundary schemas for the two `package.json` shapes this module reads
 * off disk (untrusted config content — the AI-native-coding "Zod as SSOT"
 * rule applies the same way it would to an HTTP body). Both use
 * `.passthrough()`: a real `package.json` carries dozens of fields this
 * module has no opinion about, and rejecting on their presence would make
 * this materializer fail loud for reasons unrelated to what it actually
 * reads.
 */
const rootPackageJsonSchema = z.object({ workspaces: z.array(z.string()).optional() }).passthrough();
const memberPackageJsonSchema = z.object({ name: z.string().min(1).optional() }).passthrough();

/** One workspace member derived from `mainRepoRoot`'s own `package.json` workspaces glob (AC-SD-2). */
export interface WorkspaceMember {
  /** Directory name under the glob's base dir (e.g. "core" for the glob "packages/*"). */
  readonly dirName: string;
  /** Base dir the glob matched under, relative to the repo root (e.g. "packages"). */
  readonly baseDir: string;
  /** The member's own declared `package.json` "name" (e.g. "@lore/core"). */
  readonly packageName: string;
  /** Scope prefix parsed out of `packageName` (e.g. "@lore"). Every member must carry one — see this module's header. */
  readonly scope: string;
  /** `packageName` with the scope prefix stripped (e.g. "core"). */
  readonly shortName: string;
}

/** Result of one {@link materializeFalsifierDependencies} call. */
export interface MaterializeFalsifierDependenciesResult {
  /** Absolute path to the real directory created at `<scratchWorktreeDir>/node_modules`. */
  readonly scratchNodeModulesDir: string;
  /** The workspace members {@link deriveWorkspaceMembers} derived and redirected inward. */
  readonly workspaceMembers: readonly WorkspaceMember[];
  /** The single scope directory created as a real directory (e.g. "@lore"). */
  readonly scope: string;
  /** Top-level entry names of `mainRepoRoot`'s node_modules that were symlinked outward (excludes the scope). */
  readonly linkedTopLevelEntries: readonly string[];
  /** `<baseDir>/<dirName>/node_modules` relative paths symlinked because a nested tree exists in `mainRepoRoot`. */
  readonly linkedNestedNodeModules: readonly string[];
}

const SCOPED_PACKAGE_NAME_PATTERN = /^(@[^/]+)\/(.+)$/;

/**
 * Parses a `package.json` "workspaces" glob of the literal shape this repo
 * uses (`"packages/*"`) into its base directory. Only the `"<dir>/*"` shape
 * is derivable — any other shape (a nested glob, an exact path with no `*`,
 * a glob with content after the `*`) is refused loud rather than silently
 * skipped, since a silently-skipped glob is exactly the kind of blind spot
 * AC-SD-2 exists to close.
 */
function parseWildcardGlobBaseDir(glob: string): Result<string, LoreError> {
  const suffix = "/*";
  if (!glob.endsWith(suffix) || glob.length <= suffix.length) {
    return err({
      code: "VALIDATION_ERROR",
      field: "package.json#workspaces",
      message: `unsupported workspace glob "${glob}" — only the "<dir>/*" shape can be derived; refusing rather than silently skipping it.`,
      value: glob,
    });
  }
  return ok(glob.slice(0, -suffix.length));
}

function readJsonFile(path: string, describedAs: string): Result<unknown, LoreError> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return err({
      code: "VALIDATION_ERROR",
      field: describedAs,
      message: `"${path}" is not readable: ${error instanceof Error ? error.message : String(error)}`,
      value: path,
    });
  }
  try {
    return ok(JSON.parse(raw));
  } catch (error) {
    return err({
      code: "VALIDATION_ERROR",
      field: describedAs,
      message: `"${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      value: path,
    });
  }
}

/**
 * Derives the workspace member set from `mainRepoRoot`'s own `package.json`
 * `workspaces` array — never a hand-listed name array (AC-SD-2). A caller
 * adding a workspace package to `mainRepoRoot` between two calls changes this
 * function's output with zero code change here.
 *
 * @returns One {@link WorkspaceMember} per matched directory that HAS its own
 *   `package.json` (in the order `readdirSync` reports them), or a
 *   `VALIDATION_ERROR` naming exactly what could not be read/parsed:
 *   `mainRepoRoot/package.json` missing or unparsable, its `workspaces`
 *   field missing/not-an-array/empty, an unsupported glob shape, or — for a
 *   matched directory that DOES carry a `package.json` — that file being
 *   unreadable/unparsable or missing a non-empty `name` string. A matched
 *   directory with NO `package.json` at all is not treated as a workspace
 *   member and is silently excluded from the returned array rather than
 *   failing loud — see the `existsSync` check inside the loop below for why
 *   that one case does not raise (task-make-the-falsifier-s-negative-control-a-permanent-runnable,
 *   Finding 2: a stray non-member directory under a workspace base dir must
 *   not abort materialization for the whole repo).
 */
export function deriveWorkspaceMembers(mainRepoRoot: string): Result<WorkspaceMember[], LoreError> {
  const rootPackageJsonPath = join(mainRepoRoot, "package.json");
  const rootJsonResult = readJsonFile(rootPackageJsonPath, "mainRepoRoot/package.json");
  if (!rootJsonResult.ok) return rootJsonResult;
  const rootParsed = rootPackageJsonSchema.safeParse(rootJsonResult.value);
  if (!rootParsed.success) {
    return err({
      code: "VALIDATION_ERROR",
      field: "package.json#workspaces",
      message: `"${rootPackageJsonPath}" does not match the expected package.json shape: ${rootParsed.error.message}`,
      value: rootJsonResult.value,
    });
  }
  const workspaces = rootParsed.data.workspaces;
  if (workspaces === undefined || workspaces.length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "package.json#workspaces",
      message: `"${rootPackageJsonPath}" declares no non-empty "workspaces" array — cannot derive workspace members without one.`,
      value: workspaces,
    });
  }

  const members: WorkspaceMember[] = [];
  for (const glob of workspaces) {
    const baseDirResult = parseWildcardGlobBaseDir(glob);
    if (!baseDirResult.ok) return baseDirResult;
    const baseDir = baseDirResult.value;
    const baseDirAbs = join(mainRepoRoot, baseDir);
    let dirEntryNames: string[];
    try {
      dirEntryNames = readdirSync(baseDirAbs, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error) {
      return err({
        code: "VALIDATION_ERROR",
        field: "package.json#workspaces",
        message: `workspace glob "${glob}" resolves to unreadable directory "${baseDirAbs}": ${error instanceof Error ? error.message : String(error)}`,
        value: glob,
      });
    }
    for (const dirName of dirEntryNames) {
      const memberPackageJsonPath = join(baseDirAbs, dirName, "package.json");
      // reason: a directory under a workspace base dir with NO package.json
      // at all (a stray build artifact, an aborted rename, an editor scratch
      // dir) is not a workspace member and must not abort materialization
      // for the ENTIRE repo — that is Finding 2 of
      // task-make-the-falsifier-s-negative-control-a-permanent-runnable,
      // measured against the literal `if (!memberJsonResult.ok) return
      // memberJsonResult;` shape this replaces. A directory that DOES carry
      // a package.json but fails to read/parse it, or is missing/has an
      // unscoped `name`, stays a LOUD failure below (unchanged): at that
      // point the directory has declared itself a package, and something
      // about that declaration is broken — a real defect worth failing on,
      // never silently masked. Do not widen this `existsSync` check into
      // swallowing those cases too.
      if (!existsSync(memberPackageJsonPath)) continue;
      const memberJsonResult = readJsonFile(memberPackageJsonPath, "workspaceMember.package.json");
      if (!memberJsonResult.ok) return memberJsonResult;
      const memberParsed = memberPackageJsonSchema.safeParse(memberJsonResult.value);
      if (!memberParsed.success || memberParsed.data.name === undefined) {
        return err({
          code: "VALIDATION_ERROR",
          field: "workspaceMember.package.json#name",
          message: `"${memberPackageJsonPath}" has no non-empty "name" field — cannot derive this member's package name.`,
          value: memberPackageJsonPath,
        });
      }
      const packageName = memberParsed.data.name;
      const scopeMatch = SCOPED_PACKAGE_NAME_PATTERN.exec(packageName);
      if (scopeMatch === null) {
        return err({
          code: "VALIDATION_ERROR",
          field: "workspaceMember.package.json#name",
          message: `"${memberPackageJsonPath}" declares unscoped package name "${packageName}" — this materializer requires every workspace member to share one "@scope/" prefix.`,
          value: packageName,
        });
      }
      members.push({
        dirName,
        baseDir,
        packageName,
        scope: scopeMatch[1]!,
        shortName: scopeMatch[2]!,
      });
    }
  }
  return ok(members);
}

/** Confirms every derived member shares exactly one `@scope/` prefix (module header invariant), returning it. */
function deriveSingleWorkspaceScope(members: readonly WorkspaceMember[]): Result<string, LoreError> {
  if (members.length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "workspaceMembers",
      message: "no workspace members were derived — nothing to build the scope directory from.",
      value: members,
    });
  }
  const scopes = new Set(members.map((m) => m.scope));
  if (scopes.size > 1) {
    return err({
      code: "VALIDATION_ERROR",
      field: "workspaceMembers",
      message: `derived workspace members declare more than one scope (${[...scopes].join(", ")}) — this materializer supports exactly one workspace scope.`,
      value: [...scopes],
    });
  }
  return ok([...scopes][0]!);
}

/**
 * Builds the hybrid `node_modules` layout described in this module's header
 * inside an already-created scratch git worktree.
 *
 * @param scratchWorktreeDir - A scratch worktree's own directory — e.g.
 *   `createFalsifierScratchWorktree(...).value.worktreeDir` — checked out from
 *   the SAME repository `mainRepoRoot` names, so `<scratchWorktreeDir>/<baseDir>/*`
 *   already exists (git-tracked source) before this function runs.
 * @param mainRepoRoot - The main checkout to source dependencies AND the
 *   workspace member derivation from. Read-only — never written to.
 * @returns `ok` with a summary of what was linked, or a `VALIDATION_ERROR` /
 *   `STORE_ERROR` naming exactly what prerequisite was missing or which write
 *   failed. No partial cleanup is attempted on failure — the caller owns
 *   removing the scratch worktree via `removeFalsifierScratchWorktree`
 *   regardless of outcome (mirroring how that function already tolerates an
 *   incompletely-populated worktree).
 */
export function materializeFalsifierDependencies(
  scratchWorktreeDir: string,
  mainRepoRoot: string,
): Result<MaterializeFalsifierDependenciesResult, LoreError> {
  const scratchDirAbs = resolve(scratchWorktreeDir);
  const mainRepoRootAbs = resolve(mainRepoRoot);

  if (!existsSync(scratchDirAbs)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "scratchWorktreeDir",
      message: `scratch worktree directory "${scratchDirAbs}" does not exist — materialization requires an already-created scratch worktree.`,
      value: scratchDirAbs,
    });
  }
  const mainNodeModulesDir = join(mainRepoRootAbs, "node_modules");
  if (!existsSync(mainNodeModulesDir)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "mainRepoRoot",
      message: `"${mainNodeModulesDir}" does not exist — the main checkout has no installed dependencies to materialize from (run the package manager's install first).`,
      value: mainNodeModulesDir,
    });
  }
  const scratchNodeModulesDir = join(scratchDirAbs, "node_modules");
  if (existsSync(scratchNodeModulesDir)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "scratchWorktreeDir",
      message: `"${scratchNodeModulesDir}" already exists — refusing to materialize over an unexpected pre-existing entry.`,
      value: scratchNodeModulesDir,
    });
  }

  const membersResult = deriveWorkspaceMembers(mainRepoRootAbs);
  if (!membersResult.ok) return membersResult;
  const members = membersResult.value;

  const scopeResult = deriveSingleWorkspaceScope(members);
  if (!scopeResult.ok) return scopeResult;
  const scope = scopeResult.value;

  try {
    mkdirSync(scratchNodeModulesDir, { recursive: true });
  } catch (error) {
    return err({
      code: "STORE_ERROR",
      message: `could not create "${scratchNodeModulesDir}": ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // ─── Third-party (and any other non-workspace-scope) top-level entries ────
  // reason: dotted entries (notably ".bin") are NOT filtered out — readdirSync
  // already returns them, and AC-SD-1/AC-SD-5 both depend on that (a scratch
  // worktree's own `.bin` resolution is what makes the vitest binary runnable
  // there at all).
  let mainNodeModulesEntries: string[];
  try {
    mainNodeModulesEntries = readdirSync(mainNodeModulesDir);
  } catch (error) {
    return err({
      code: "STORE_ERROR",
      message: `could not list "${mainNodeModulesDir}": ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const linkedTopLevelEntries: string[] = [];
  for (const entryName of mainNodeModulesEntries) {
    // reason: the workspace scope is rebuilt below as a REAL scratch-internal
    // directory — never a passthrough symlink to mainRepoRoot's own copy of
    // it, which is exactly the plain-symlink trap this module exists to avoid
    // (AC-SD-1(c) / AC-SD-3, see module header).
    if (entryName === scope) continue;
    const linkPath = join(scratchNodeModulesDir, entryName);
    try {
      symlinkSync(join(mainNodeModulesDir, entryName), linkPath);
    } catch (error) {
      return err({
        code: "STORE_ERROR",
        message: `could not symlink main checkout's node_modules entry "${entryName}": ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    linkedTopLevelEntries.push(entryName);
  }

  // ─── The workspace scope — ONE real directory, entries pointing INSIDE scratch ──
  const scopeDir = join(scratchNodeModulesDir, scope);
  try {
    mkdirSync(scopeDir, { recursive: true });
  } catch (error) {
    return err({
      code: "STORE_ERROR",
      message: `could not create scope directory "${scopeDir}": ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  for (const member of members) {
    const linkPath = join(scopeDir, member.shortName);
    const targetPath = join(scratchDirAbs, member.baseDir, member.dirName);
    try {
      symlinkSync(targetPath, linkPath, "dir");
    } catch (error) {
      return err({
        code: "STORE_ERROR",
        message: `could not link workspace member "${member.packageName}" into the scratch node_modules: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // ─── Nested per-package node_modules, discovered by enumeration ──────────
  // reason: iterates the ALREADY-derived member list (one entry per directory
  // under each workspace base dir) rather than re-scanning the filesystem —
  // `deriveWorkspaceMembers` already enumerated every directory there, so a
  // second directory listing would just repeat the same enumeration for no
  // new information.
  const linkedNestedNodeModules: string[] = [];
  for (const member of members) {
    const mainNestedNodeModules = join(mainRepoRootAbs, member.baseDir, member.dirName, "node_modules");
    if (!existsSync(mainNestedNodeModules)) continue;
    const relativeNestedPath = join(member.baseDir, member.dirName, "node_modules");
    const scratchNestedParent = join(scratchDirAbs, member.baseDir, member.dirName);
    if (!existsSync(scratchNestedParent)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "scratchWorktreeDir",
        message: `main checkout has a nested node_modules at "${relativeNestedPath}" but the scratch worktree has no "${join(member.baseDir, member.dirName)}" directory to attach it to.`,
        value: scratchNestedParent,
      });
    }
    try {
      symlinkSync(mainNestedNodeModules, join(scratchDirAbs, relativeNestedPath), "dir");
    } catch (error) {
      return err({
        code: "STORE_ERROR",
        message: `could not symlink nested node_modules "${relativeNestedPath}": ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    linkedNestedNodeModules.push(relativeNestedPath);
  }

  return ok({
    scratchNodeModulesDir,
    workspaceMembers: members,
    scope,
    linkedTopLevelEntries,
    linkedNestedNodeModules,
  });
}
