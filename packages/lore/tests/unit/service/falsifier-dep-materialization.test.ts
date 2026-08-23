/**
 * Hybrid dependency materializer oracle for AC-SD-1 / AC-SD-2 / AC-SD-3 / AC-SD-4
 * (spec-a-falsifier-s-scratch-worktree-must-be-runnable-and,
 * adr-a-falsifier-s-scratch-worktree-gets-dependencies-by-hybrid,
 * task-build-the-hybrid-dependency-materializer-and-prove).
 *
 * Every fixture here is a THROWAWAY `mkdtemp` + `git init` repo — NEVER this
 * repo's own working tree (see CLAUDE.md: never write to this repo's own
 * `.lore/`/working tree from a test). The fixture repo plays the role of "the
 * main checkout" the ADR describes: it has its own `package.json` with
 * `workspaces: ["packages/*"]`, three workspace members under one derived
 * `@fixture/` scope, an "installed" (but git-ignored, exactly like a real
 * `node_modules`) third-party entry named literally "vitest" (AC-SD-1(d) pins
 * that exact name), a dotted `.bin` entry, and ONE nested per-package
 * `node_modules` under `packages/extra` (mirrors this real repo's own
 * `packages/dashboard/node_modules` — AC-SD-1(e)/AC-SD-4 both require this to
 * be DISCOVERED by enumeration, never hardcoded by name, which is why the
 * member carrying it is named "extra" and never referenced by that literal
 * name in an assertion).
 *
 * "The scratch worktree" in every test below is a REAL git worktree created
 * via `createFalsifierScratchWorktree` (imported read-only from
 * `verify-runner-service.ts`, never modified) — the exact primitive
 * `VerifyRunnerService.verifyFalsifier` uses in production, so this suite
 * exercises `materializeFalsifierDependencies` against the SAME handle shape
 * a real falsifier run would hand it, not a hand-rolled plain directory.
 *
 * Dimension mapping (six-dimension coverage, spread across the four describes
 * below rather than duplicated in each — see each `it()` title for its own
 * letter):
 *   HAPPY:      a full, correct materialize call satisfies every lettered
 *               clause of AC-SD-1, AC-SD-2, AC-SD-3(a)+(b), AC-SD-4(a)+(b)
 *   NEGATIVE:   missing main `node_modules`; a scratch dir that already has a
 *               `node_modules` entry; a hand-listed member array missing a
 *               package added with no code change (AC-SD-2's own RED)
 *   BOUNDARY:   a workspace member with NO nested `node_modules` is correctly
 *               left out of the nested-link set with no error; an omitted
 *               nested tree is correctly detected as absent
 *   ERROR:      the plain-symlink trap (AC-SD-1(c) / AC-SD-3's whole reason
 *               for existing) and the full-copy trap (AC-SD-1(d))
 *   STATE:      an empty-placeholder nested directory is distinguished from a
 *               genuinely linked one; a simulated "repoint the main checkout's
 *               own links" bug is caught by the readlink comparison
 *   REGRESSION: every trap above is pinned as an `it()` that must keep
 *               reproducing the documented wrong behavior for the SUITE to
 *               stay green — a fix that accidentally "fixes" the trap
 *               construction itself would be caught here, not just silently
 *               stop protecting anything
 *
 * RED-FIRST verification note (recorded in the task's evidence log at the
 * moment each was red, not re-derived here — see this task's completion
 * report for the exact commands/exit codes):
 *   - AC-SD-1's RED was produced by temporarily making the production
 *     `materializeFalsifierDependencies` skip the scope-exclusion check (so
 *     the blind top-level pass ALSO symlinked "@fixture" straight from the
 *     main checkout), then running `-t "hybrid layout"`.
 *   - AC-SD-2's RED was produced by temporarily hardcoding the member array
 *     inside `materializeFalsifierDependencies` to the pre-existing three
 *     names, then running `-t "derived workspace set"`.
 *   - AC-SD-3's RED was produced with the SAME AC-SD-1 bug reinstated (the
 *     scope becomes a passthrough symlink to the main checkout), then running
 *     `-t "mutation observability"` — the HAPPY test's mutated-command
 *     assertion failed because the command stayed green, reproducing the
 *     exact measured defect this spec exists to close.
 *   - AC-SD-4's RED was produced by temporarily making
 *     `materializeFalsifierDependencies` ALSO overwrite the MAIN checkout's
 *     own `node_modules/@fixture/*` link targets (instead of only ever
 *     writing under the scratch tree), then running
 *     `-t "main checkout untouched"`.
 *
 * @spec_ref AC-SD-1, AC-SD-2, AC-SD-3, AC-SD-4
 */

import { describe, it, expect, afterEach } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  existsSync,
  lstatSync,
  symlinkSync,
  cpSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  materializeFalsifierDependencies,
  deriveWorkspaceMembers,
} from "../../../src/service/falsifier-dep-materialization.js";
import {
  createFalsifierScratchWorktree,
  removeFalsifierScratchWorktree,
  type FalsifierScratchWorktree,
} from "../../../src/service/verify-runner-service.js";

// ─── Fixture repo builder (throwaway `mkdtemp` + `git init` — NEVER this
//     repo's own working tree) ──────────────────────────────────────────────

const createdScratches: Array<{ repoRoot: string; scratch: FalsifierScratchWorktree }> = [];
const createdRepos: string[] = [];

afterEach(() => {
  // reason: scratches removed FIRST — `removeFalsifierScratchWorktree` shells
  // `git worktree remove` with `cwd: repoRoot`, so the fixture repo must still
  // exist when it runs. Both loops are best-effort per-test cleanup: a
  // failure here is a disk leak in the test runner's own tmpdir, never a
  // correctness issue for assertions already made above it.
  while (createdScratches.length > 0) {
    const entry = createdScratches.pop();
    if (entry === undefined) continue;
    try {
      removeFalsifierScratchWorktree(entry.repoRoot, entry.scratch);
    } catch {
      /* best-effort */
    }
  }
  while (createdRepos.length > 0) {
    const repoRoot = createdRepos.pop();
    if (repoRoot === undefined) continue;
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

function writeFixturePackage(repoRoot: string, dirName: string, packageName: string, indexJs: string): void {
  const dir = join(repoRoot, "packages", dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: packageName, main: "index.js" }, null, 2), "utf8");
  writeFileSync(join(dir, "index.js"), indexJs, "utf8");
}

/**
 * The "target test command"'s own module — requires the fixture workspace's
 * `@fixture/core` member by BARE specifier (AC-SD-3's own requirement) and
 * exits 0 iff its exported `PROBE` reads exactly `"PROBE_OK"`.
 */
const CONSUMER_INDEX_JS = [
  'const core = require("@fixture/core");',
  'if (core.PROBE !== "PROBE_OK") {',
  '  console.error("PROBE_MISMATCH " + JSON.stringify(core));',
  "  process.exit(1);",
  "}",
  'console.log("PROBE_PASS");',
  "process.exit(0);",
  "",
].join("\n");

/**
 * Builds a throwaway fixture "main checkout": a committed workspace of three
 * `@fixture/*` members (`core`, `extra`, `consumer`) plus an UNTRACKED (real
 * repos gitignore `node_modules/`) `node_modules` carrying a named
 * third-party entry ("vitest", AC-SD-1(d)'s own pinned name), a dotted `.bin`
 * entry, the workspace scope's own pre-existing symlinks (mirrors a real
 * `bun install`), and ONE nested `packages/extra/node_modules` (mirrors this
 * real repo's own `packages/dashboard/node_modules`).
 */
function makeFixtureMainRepo(): { repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-dep-materialization-fixture-"));
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Dep Materialization Test"], { cwd: repoRoot });

  writeFileSync(join(repoRoot, ".gitignore"), "node_modules/\n", "utf8");
  writeFileSync(
    join(repoRoot, "package.json"),
    JSON.stringify({ name: "fixture-workspace", private: true, workspaces: ["packages/*"] }, null, 2),
    "utf8",
  );
  writeFixturePackage(repoRoot, "core", "@fixture/core", 'module.exports = { PROBE: "PROBE_OK" };\n');
  writeFixturePackage(repoRoot, "extra", "@fixture/extra", "module.exports = {};\n");
  writeFixturePackage(repoRoot, "consumer", "@fixture/consumer", CONSUMER_INDEX_JS);

  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-q", "-m", "seed fixture workspace"], { cwd: repoRoot });

  // Everything below is deliberately NEVER `git add`ed — mirrors a real
  // developer checkout, where `node_modules` is gitignored and present only
  // via `bun install`, not tracked history.
  const nodeModulesDir = join(repoRoot, "node_modules");
  mkdirSync(join(nodeModulesDir, "vitest"), { recursive: true });
  writeFileSync(join(nodeModulesDir, "vitest", "marker.txt"), "third-party marker\n", "utf8");
  mkdirSync(join(nodeModulesDir, ".bin"), { recursive: true });
  writeFileSync(join(nodeModulesDir, ".bin", "fixture-bin-marker"), "#!/bin/sh\nexit 0\n", "utf8");
  const scopeDir = join(nodeModulesDir, "@fixture");
  mkdirSync(scopeDir, { recursive: true });
  for (const dirName of ["core", "extra", "consumer"]) {
    symlinkSync(join("..", "..", "packages", dirName), join(scopeDir, dirName));
  }
  const extraNestedDir = join(repoRoot, "packages", "extra", "node_modules", "nested-marker");
  mkdirSync(extraNestedDir, { recursive: true });
  writeFileSync(join(extraNestedDir, "file.txt"), "nested marker content\n", "utf8");

  createdRepos.push(repoRoot);
  return { repoRoot };
}

/** Adds and commits a new workspace member — the AC-SD-2 fixture mutation. */
function addWorkspaceMember(repoRoot: string, dirName: string, packageName: string): void {
  writeFixturePackage(repoRoot, dirName, packageName, "module.exports = {};\n");
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", ["commit", "-q", "-m", `add workspace member ${dirName}`], { cwd: repoRoot });
}

function createScratch(repoRoot: string): FalsifierScratchWorktree {
  const result = createFalsifierScratchWorktree(repoRoot);
  if (!result.ok) {
    throw new Error(`createFalsifierScratchWorktree failed: ${JSON.stringify(result.error)}`);
  }
  createdScratches.push({ repoRoot, scratch: result.value });
  return result.value;
}

function gitStatusPorcelain(repoRoot: string): string {
  return execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" });
}

/** Digest over the sorted (path, content-hash) pairs of EVERY `git ls-files -z` path — AC-SD-4(a). */
function digestGitLsFiles(repoRoot: string): string {
  const raw = execFileSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "utf8" });
  const relPaths = raw
    .split("\0")
    .filter((p) => p.length > 0)
    .sort();
  const hasher = createHash("sha256");
  for (const relPath of relPaths) {
    const contentHash = createHash("sha256").update(readFileSync(join(repoRoot, relPath))).digest("hex");
    hasher.update(relPath);
    hasher.update("\0");
    hasher.update(contentHash);
    hasher.update("\n");
  }
  return hasher.digest("hex");
}

/** A single hand-picked path's content hash — the deliberately-NARROW check RED(ii) contrasts against. */
function digestSinglePath(repoRoot: string, relPath: string): string {
  return createHash("sha256").update(readFileSync(join(repoRoot, relPath))).digest("hex");
}

/** `{ entryName: linkTarget }` for every entry of `repoRoot/node_modules/<scope>` — AC-SD-4(b). */
function readScopeLinkTargets(repoRoot: string, scope: string): Record<string, string> {
  const scopeDir = join(repoRoot, "node_modules", scope);
  const map: Record<string, string> = {};
  for (const name of readdirSync(scopeDir)) {
    map[name] = readlinkSync(join(scopeDir, name));
  }
  return map;
}

function isInside(childPathAbs: string, parentDirAbs: string): boolean {
  return childPathAbs === parentDirAbs || childPathAbs.startsWith(parentDirAbs + sep);
}

/** Every enumerated `<scratch>/node_modules/@fixture/*` entry name whose realpath does NOT land inside `scratchDirAbs` — AC-SD-1(c)'s own "must fail naming the escaping entry" check. */
function findEscapingScopeEntries(scratchNodeModulesDir: string, scope: string, scratchDirAbs: string): string[] {
  const scopeDir = join(scratchNodeModulesDir, scope);
  const escaping: string[] = [];
  for (const name of readdirSync(scopeDir)) {
    if (!isInside(realpathSync(join(scopeDir, name)), scratchDirAbs)) escaping.push(name);
  }
  return escaping;
}

/** Every `packages/*` member directory in `mainRepoRoot` that has its own nested `node_modules` — discovered by enumeration (AC-SD-1(e)/AC-SD-4), never by name. */
function listNestedNodeModulesRelPaths(mainRepoRoot: string): string[] {
  const packagesDir = join(mainRepoRoot, "packages");
  const memberDirNames = readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const nested: string[] = [];
  for (const dirName of memberDirNames) {
    if (existsSync(join(packagesDir, dirName, "node_modules"))) {
      nested.push(join("packages", dirName, "node_modules"));
    }
  }
  return nested;
}

/** Spawns the fixture's `consumer` target command inside `cwd` via `bun` — the "target test command" every AC-SD-3 assertion drives. */
function runConsumerCommand(cwd: string): { status: number | null; combinedOutput: string } {
  const result = spawnSync("bun", [join("packages", "consumer", "index.js")], { cwd, encoding: "utf8" });
  return { status: result.status, combinedOutput: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

// ─── AC-SD-1 ────────────────────────────────────────────────────────────────

describe("hybrid layout", () => {
  it("hybrid layout: HAPPY — a real materialize call satisfies all five lettered clauses, nested trees included", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const scratch = createScratch(repoRoot);
    // reason: `os.tmpdir()` on macOS resolves under `/var/folders/...`, and
    // `/var` itself is a symlink to `/private/var` — so `scratch.worktreeDir`
    // (the raw, un-resolved handle) and `realpathSync()` of anything INSIDE
    // it differ by that one symlink hop even for a perfectly correct layout.
    // Every "does X realpath inside the scratch tree" check below must
    // compare against the REALPATH of the scratch dir, never the raw handle.
    const scratchDirReal = realpathSync(scratch.worktreeDir);

    const result = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { scratchNodeModulesDir, scope, linkedTopLevelEntries, linkedNestedNodeModules } = result.value;
    expect(scope).toBe("@fixture");

    // (a) <scratch>/node_modules is a REAL directory, never a symlink.
    const nodeModulesLstat = lstatSync(scratchNodeModulesDir);
    expect(nodeModulesLstat.isSymbolicLink()).toBe(false);
    expect(nodeModulesLstat.isDirectory()).toBe(true);

    // (b) <scratch>/node_modules/@fixture is a REAL directory.
    const scopeDir = join(scratchNodeModulesDir, scope);
    const scopeLstat = lstatSync(scopeDir);
    expect(scopeLstat.isSymbolicLink()).toBe(false);
    expect(scopeLstat.isDirectory()).toBe(true);

    // (c) EVERY entry under it realpaths INSIDE the scratch tree — enumerated,
    // never a hand-picked subset.
    const scopeEntries = readdirSync(scopeDir);
    expect(scopeEntries.sort()).toEqual(["consumer", "core", "extra"]);
    expect(findEscapingScopeEntries(scratchNodeModulesDir, scope, scratchDirReal)).toEqual([]);

    // (d) the named third-party entry ("vitest") realpaths OUTSIDE <scratch>,
    // into the main checkout's own node_modules.
    const vitestReal = realpathSync(join(scratchNodeModulesDir, "vitest"));
    expect(isInside(vitestReal, scratchDirReal)).toBe(false);
    expect(vitestReal).toBe(realpathSync(join(repoRoot, "node_modules", "vitest")));
    expect(linkedTopLevelEntries).toContain("vitest");

    // dotted entries (.bin) are INCLUDED in the blind top-level pass, not
    // silently filtered — and also realpath outside the scratch tree.
    expect(linkedTopLevelEntries).toContain(".bin");
    const binReal = realpathSync(join(scratchNodeModulesDir, ".bin"));
    expect(isInside(binReal, scratchDirReal)).toBe(false);

    // the scope name itself must NEVER appear as a blind top-level symlink —
    // it was rebuilt above as its own real directory.
    expect(linkedTopLevelEntries).not.toContain(scope);

    // (e) every nested packages/*/node_modules present in the main checkout
    // — discovered by enumeration — resolves in the scratch tree, non-empty,
    // with at least one entry realpathing to the same main-checkout entry.
    const nestedRelPaths = listNestedNodeModulesRelPaths(repoRoot);
    expect(nestedRelPaths.length).toBeGreaterThan(0); // sanity: the fixture actually has one
    expect([...linkedNestedNodeModules].sort()).toEqual(nestedRelPaths.sort());
    for (const relPath of nestedRelPaths) {
      const scratchNestedPath = join(scratch.worktreeDir, relPath);
      expect(existsSync(scratchNestedPath)).toBe(true);
      const scratchEntries = readdirSync(scratchNestedPath);
      expect(scratchEntries.length).toBeGreaterThan(0);
      const mainEntries = readdirSync(join(repoRoot, relPath));
      expect(mainEntries.length).toBeGreaterThan(0);
      const sampleEntry = mainEntries[0]!;
      expect(realpathSync(join(scratchNestedPath, sampleEntry))).toBe(
        realpathSync(join(repoRoot, relPath, sampleEntry)),
      );
    }

    // BOUNDARY — a workspace member with NO nested node_modules of its own
    // ("core", "consumer") is correctly left OUT of linkedNestedNodeModules,
    // never a false/empty entry.
    expect(linkedNestedNodeModules.some((p) => p.includes(join("packages", "core")))).toBe(false);
    expect(linkedNestedNodeModules.some((p) => p.includes(join("packages", "consumer")))).toBe(false);
  });

  it("hybrid layout: NEGATIVE — a main checkout with no node_modules is refused loud, nothing created", () => {
    const { repoRoot } = makeFixtureMainRepo();
    rmSync(join(repoRoot, "node_modules"), { recursive: true, force: true });
    const scratch = createScratch(repoRoot);

    const result = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("mainRepoRoot");
    expect(existsSync(join(scratch.worktreeDir, "node_modules"))).toBe(false);
  });

  it("hybrid layout: NEGATIVE — a scratch worktree that already has a node_modules entry is refused loud", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const scratch = createScratch(repoRoot);
    mkdirSync(join(scratch.worktreeDir, "node_modules"), { recursive: true });

    const result = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("scratchWorktreeDir");
  });

  it("hybrid layout: ERROR (RED i, permanently pinned) — a plain ln -s of the main node_modules leaves scope entries resolving OUTSIDE scratch, naming the escaping entries", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const scratch = createScratch(repoRoot);

    // The REJECTED naive layout — never calls materializeFalsifierDependencies.
    symlinkSync(join(repoRoot, "node_modules"), join(scratch.worktreeDir, "node_modules"));

    const escaping = findEscapingScopeEntries(
      join(scratch.worktreeDir, "node_modules"),
      "@fixture",
      scratch.worktreeDir,
    );
    // this is exactly the trap: EVERY scope entry escapes, because the outer
    // symlink is followed first and the inner @fixture/* links are relative.
    expect(escaping.sort()).toEqual(["consumer", "core", "extra"]);
  });

  it("hybrid layout: ERROR (RED ii, permanently pinned) — a full copy of the main node_modules leaves the named third-party entry (vitest) resolving INSIDE scratch, defeating clause (d)", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const scratch = createScratch(repoRoot);
    const scratchDirReal = realpathSync(scratch.worktreeDir); // see the HAPPY test's own comment for why

    // The REJECTED full-copy layout — never calls materializeFalsifierDependencies.
    cpSync(join(repoRoot, "node_modules"), join(scratch.worktreeDir, "node_modules"), { recursive: true });

    const vitestReal = realpathSync(join(scratch.worktreeDir, "node_modules", "vitest"));
    // clause (d) requires vitest to realpath OUTSIDE scratch — under a full
    // copy it wrongly realpaths INSIDE scratch instead, which is precisely
    // why a full copy is rejected (it also pays the 373MB walk in the real
    // repo, which this throwaway fixture is too small to measure).
    expect(isInside(vitestReal, scratchDirReal)).toBe(true);
  });

  it("hybrid layout: BOUNDARY (RED iii, permanently pinned) — omitting a nested tree after a real materialize is correctly detected as absent, naming the missing path", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const scratch = createScratch(repoRoot);
    const result = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [relPath] = listNestedNodeModulesRelPaths(repoRoot);
    expect(relPath).toBeDefined();
    const scratchNestedPath = join(scratch.worktreeDir, relPath!);
    // simulate "skip nested trees entirely" by deleting the link this call
    // itself just created.
    rmSync(scratchNestedPath, { force: true });

    expect(existsSync(scratchNestedPath), `expected "${relPath}" to be absent after simulating a skipped nested link`).toBe(
      false,
    );
  });

  it("hybrid layout: STATE (RED iv, permanently pinned) — an empty placeholder nested directory is distinguished from a genuinely linked one", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const scratch = createScratch(repoRoot);
    const result = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [relPath] = listNestedNodeModulesRelPaths(repoRoot);
    expect(relPath).toBeDefined();
    const scratchNestedPath = join(scratch.worktreeDir, relPath!);
    rmSync(scratchNestedPath, { force: true });
    // simulate "create each nested path as an EMPTY directory" instead of a symlink.
    mkdirSync(scratchNestedPath, { recursive: true });

    // "resolves to a readable directory" alone is NOT the check — it must
    // also be non-empty, which this placeholder fails.
    expect(existsSync(scratchNestedPath)).toBe(true);
    expect(readdirSync(scratchNestedPath)).toEqual([]);
  });
});

// ─── AC-SD-2 ────────────────────────────────────────────────────────────────

describe("derived workspace set", () => {
  it("derived workspace set: HAPPY — adding a fourth workspace package with NO code change here produces a scratch-internal redirect for it", () => {
    const { repoRoot } = makeFixtureMainRepo();

    const before = deriveWorkspaceMembers(repoRoot);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.value.map((m) => m.dirName).sort()).toEqual(["consumer", "core", "extra"]);

    addWorkspaceMember(repoRoot, "fourth", "@fixture/fourth");

    // SAME function, no code change — just a new call after the fixture changed.
    const after = deriveWorkspaceMembers(repoRoot);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.map((m) => m.dirName).sort()).toEqual(["consumer", "core", "extra", "fourth"]);

    const scratch = createScratch(repoRoot); // off the NEW HEAD, so packages/fourth is checked out
    const materialized = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) return;
    expect(materialized.value.workspaceMembers.map((m) => m.dirName).sort()).toEqual([
      "consumer",
      "core",
      "extra",
      "fourth",
    ]);

    const fourthLinkPath = join(scratch.worktreeDir, "node_modules", "@fixture", "fourth");
    expect(existsSync(fourthLinkPath)).toBe(true);
    expect(isInside(realpathSync(fourthLinkPath), realpathSync(scratch.worktreeDir))).toBe(true);
    expect(realpathSync(fourthLinkPath)).toBe(realpathSync(join(scratch.worktreeDir, "packages", "fourth")));
  });

  it("derived workspace set: NEGATIVE (RED, permanently pinned) — a hand-listed member array would have silently missed the fourth package", () => {
    const { repoRoot } = makeFixtureMainRepo();
    addWorkspaceMember(repoRoot, "fourth", "@fixture/fourth");

    // The REJECTED alternative this AC exists to rule out: an array written
    // down at implementation time, before "fourth" ever existed.
    const HAND_LISTED_MEMBERS = ["core", "extra", "consumer"];

    const derived = deriveWorkspaceMembers(repoRoot);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const derivedNames = derived.value.map((m) => m.dirName);

    expect(derivedNames).toContain("fourth");
    expect(HAND_LISTED_MEMBERS).not.toContain("fourth");
    // naming exactly which package a hand-listed implementation would have
    // silently dropped a redirect for.
    const missedByHandListing = derivedNames.filter((name) => !HAND_LISTED_MEMBERS.includes(name));
    expect(missedByHandListing).toEqual(["fourth"]);
  });
});

// ─── AC-SD-3 ────────────────────────────────────────────────────────────────

describe("mutation observability", () => {
  it(
    "mutation observability: HAPPY — the unmutated control exits 0, and a bare-specifier workspace mutation exits exactly 1 naming the scratch path",
    () => {
      const { repoRoot } = makeFixtureMainRepo();
      const scratch = createScratch(repoRoot);
      const materialized = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) return;

      // (a) green control — UNMUTATED, exits EXACTLY 0. If this fails the
      // whole test fails here rather than crediting a red from a broken
      // harness (AC-SD-3's own wording).
      const control = runConsumerCommand(scratch.worktreeDir);
      expect(control.status, `green control output:\n${control.combinedOutput}`).toBe(0);

      // (b) mutate the workspace package reached by BARE specifier
      // (@fixture/core) — a genuine syntax error, same shape as the
      // knowledge doc's own measurement.
      const mutatedCorePath = join(scratch.worktreeDir, "packages", "core", "index.js");
      writeFileSync(mutatedCorePath, "module.exports = { PROBE: (( this is not valid javascript", "utf8");

      const mutated = runConsumerCommand(scratch.worktreeDir);
      expect(mutated.status).toBe(1);
      expect(mutated.combinedOutput).toContain(mutatedCorePath);
      expect(isInside(mutatedCorePath, scratch.worktreeDir)).toBe(true);
    },
    15000,
  );

  it(
    "mutation observability: ERROR (RED i, permanently pinned) — a plain ln -s layout leaves a bare-specifier mutation invisible, staying wrongly green",
    () => {
      const { repoRoot } = makeFixtureMainRepo();
      const scratch = createScratch(repoRoot);

      // The REJECTED naive layout — never calls materializeFalsifierDependencies.
      symlinkSync(join(repoRoot, "node_modules"), join(scratch.worktreeDir, "node_modules"));

      const control = runConsumerCommand(scratch.worktreeDir);
      expect(control.status, `green control output:\n${control.combinedOutput}`).toBe(0);

      const mutatedCorePath = join(scratch.worktreeDir, "packages", "core", "index.js");
      writeFileSync(mutatedCorePath, "module.exports = { PROBE: (( this is not valid javascript", "utf8");

      const mutated = runConsumerCommand(scratch.worktreeDir);
      // THE TRAP, pinned permanently: bare-specifier resolution follows the
      // outer node_modules symlink back into the MAIN checkout's own
      // packages/core/index.js, which was never mutated — the command stays
      // green even though the scratch copy is now broken.
      expect(mutated.status, `expected the naive layout to WRONGLY stay green; output:\n${mutated.combinedOutput}`).toBe(
        0,
      );
    },
    15000,
  );

  it("mutation observability: BOUNDARY (RED ii, permanently pinned) — a scratch worktree with materialization skipped fails the green control itself, never a spurious red", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const scratch = createScratch(repoRoot);
    // materializeFalsifierDependencies deliberately never called.

    const control = runConsumerCommand(scratch.worktreeDir);
    // MODULE_NOT_FOUND for "@fixture/core" — a genuinely broken harness,
    // never treated as a proven red by anything in this suite because (a) is
    // always asserted before (b) (see the HAPPY test above).
    expect(control.status).not.toBe(0);
    expect(control.combinedOutput.toLowerCase()).toContain("cannot find");
  });
});

// ─── AC-SD-4 ────────────────────────────────────────────────────────────────

describe("main checkout untouched", () => {
  it(
    "main checkout untouched: HAPPY/REGRESSION — a full materialize-mutate-run-cleanup cycle leaves the main tree and its own scope links byte-identical",
    () => {
      const { repoRoot } = makeFixtureMainRepo();
      const statusBefore = gitStatusPorcelain(repoRoot);
      const digestBefore = digestGitLsFiles(repoRoot);
      const scopeLinksBefore = readScopeLinkTargets(repoRoot, "@fixture");

      const scratch = createScratch(repoRoot);
      const materialized = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
      expect(materialized.ok).toBe(true);

      // mutate ONLY the scratch copy, then run a command against it.
      writeFileSync(
        join(scratch.worktreeDir, "packages", "core", "index.js"),
        'module.exports = { PROBE: "MUTATED" };\n',
        "utf8",
      );
      runConsumerCommand(scratch.worktreeDir);

      removeFalsifierScratchWorktree(repoRoot, scratch);
      // reason: already cleaned up — don't let afterEach double-remove it.
      createdScratches.pop();

      expect(gitStatusPorcelain(repoRoot).trim()).toBe(statusBefore.trim());
      expect(gitStatusPorcelain(repoRoot).trim()).toBe("");
      expect(digestGitLsFiles(repoRoot)).toBe(digestBefore);
      expect(readScopeLinkTargets(repoRoot, "@fixture")).toEqual(scopeLinksBefore);
    },
    15000,
  );

  it("main checkout untouched: ERROR (RED i, permanently pinned) — mutating a tracked file directly in the main checkout is detected by the digest check", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const digestBefore = digestGitLsFiles(repoRoot);

    // simulate a buggy implementation that mutates the WORKING TREE directly
    // instead of a scratch copy, with no revert.
    writeFileSync(join(repoRoot, "packages", "core", "index.js"), 'module.exports = { PROBE: "LEAKED" };\n', "utf8");

    expect(digestGitLsFiles(repoRoot)).not.toBe(digestBefore);
  });

  it("main checkout untouched: NEGATIVE (RED ii, permanently pinned) — a single hardcoded path misses a mutation the full derived-set digest catches", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const narrowRelPath = join("packages", "core", "index.js");
    const fullDigestBefore = digestGitLsFiles(repoRoot);
    const narrowDigestBefore = digestSinglePath(repoRoot, narrowRelPath);

    // mutate a DIFFERENT tracked file than the one the narrow check watches.
    writeFileSync(join(repoRoot, "packages", "extra", "index.js"), "module.exports = { LEAKED: true };\n", "utf8");

    expect(digestGitLsFiles(repoRoot), "the full, git-ls-files-derived digest must catch this").not.toBe(
      fullDigestBefore,
    );
    expect(
      digestSinglePath(repoRoot, narrowRelPath),
      "a single hardcoded path must MISS a mutation to a different tracked file — proving why the path set must be enumerated, not chosen",
    ).toBe(narrowDigestBefore);
  });

  it("main checkout untouched: STATE (RED iii, permanently pinned) — repointing the main checkout's own scope link targets is detected and named", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const scopeLinksBefore = readScopeLinkTargets(repoRoot, "@fixture");

    // simulate a buggy materializer that "fixes" resolution by rewriting the
    // ORIGINAL checkout's own links instead of building scratch-internal ones.
    const corelinkPath = join(repoRoot, "node_modules", "@fixture", "core");
    rmSync(corelinkPath, { force: true });
    symlinkSync("/tmp/some-other-scratch-tree/packages/core", corelinkPath);

    const scopeLinksAfter = readScopeLinkTargets(repoRoot, "@fixture");
    expect(scopeLinksAfter).not.toEqual(scopeLinksBefore);
    const changedEntries = Object.keys(scopeLinksBefore).filter(
      (name) => scopeLinksAfter[name] !== scopeLinksBefore[name],
    );
    expect(changedEntries).toEqual(["core"]);
  });
});
