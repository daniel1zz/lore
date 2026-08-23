/**
 * Hybrid dependency materializer oracle for AC-SD-1 / AC-SD-2 / AC-SD-3 / AC-SD-4
 * / AC-SD-5 / AC-SD-8
 * (spec-a-falsifier-s-scratch-worktree-must-be-runnable-and,
 * adr-a-falsifier-s-scratch-worktree-gets-dependencies-by-hybrid,
 * task-build-the-hybrid-dependency-materializer-and-prove,
 * task-serve-both-runners-from-one-materialized-worktree-and-make).
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
 *   - AC-SD-5 / AC-SD-8 are different in kind from AC-SD-1..4: their own
 *     production surfaces (`materializeFalsifierDependencies`,
 *     `removeFalsifierScratchWorktree`) are OUT OF this task's file anchors
 *     (the former belongs to the task that landed it; wiring cleanup safety
 *     is this task's only permitted source change, and it needed none — see
 *     below). So each RED here was produced by temporarily UNDOING the "RED"
 *     it()'s own bug-simulation step (never a change to production code),
 *     observing the SAME assertion that stays green today fail for real, then
 *     restoring it — the equivalent proof that the assertion has
 *     discriminating power without touching a file outside this task's anchor:
 *     - AC-SD-5 RED(i): temporarily commented out the `rmSync(...".bin")` line
 *       in "both runners: ERROR (RED i...)", then ran `-t "both runners"` —
 *       `expect(vitestRun.status).not.toBe(0)` failed because the untouched
 *       `.bin` redirect let the vitest invocation exit 0, proving the
 *       assertion actually depends on that omission.
 *     - AC-SD-5 RED(ii): temporarily inserted a real
 *       `materializeFalsifierDependencies` call into "both runners: BOUNDARY
 *       (RED ii...)" (contradicting its own "deliberately never called"
 *       comment), then ran `-t "both runners"` — `expect(bunTestRun.status).not.toBe(0)`
 *       failed because materialization made the bun half green, proving the
 *       assertion actually depends on materialization being skipped.
 *     - AC-SD-8 RED(i): temporarily replaced the `followSymlinksRecursiveDelete`
 *       call in "cleanup cannot escape: ERROR (RED i...)" with the real
 *       `removeFalsifierScratchWorktree`, then ran `-t "cleanup cannot escape"`
 *       — `expect(existsSync(sentinelPath)).toBe(false)` failed because the
 *       real (safe) cleanup left the sentinel intact, proving the assertion
 *       actually depends on the buggy follow-symlinks shape being exercised.
 *     - AC-SD-8 RED(ii): temporarily called the real
 *       `removeFalsifierScratchWorktree` inside "cleanup cannot escape:
 *       NEGATIVE (RED ii...)" instead of doing nothing, then ran
 *       `-t "cleanup cannot escape"` — `expect(existsSync(scratch.parentDir)).toBe(true)`
 *       failed because real cleanup actually removed it, proving the assertion
 *       actually depends on cleanup being skipped.
 *     Exact commands/observed exit codes are recorded in this task's evidence
 *     log, not re-derived here.
 *
 * @spec_ref AC-SD-1, AC-SD-2, AC-SD-3, AC-SD-4, AC-SD-5, AC-SD-8
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
import { dirname, join, sep } from "node:path";
import { createHash } from "node:crypto";
import {
  materializeFalsifierDependencies,
  deriveWorkspaceMembers,
} from "../../../src/service/falsifier-dep-materialization.js";
import {
  createFalsifierScratchWorktree,
  removeFalsifierScratchWorktree,
  VerifyRunnerService,
  type FalsifierScratchWorktree,
} from "../../../src/service/verify-runner-service.js";
import { ok } from "@lore/core";
import type { AcceptanceCriterion, DocRecord, LoreError, PlanBundle, Result } from "@lore/core";
import type { VerifiedEvidenceInput } from "../../../src/service/task-workflow-service.js";
import type { VerifySpawnSpec, VerifyExecutionResult } from "../../../src/service/verify-spawn.js";

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
      // ⛔ realpathSync, NOT the raw handle: `/var` is a symlink to `/private/var`,
      // so an un-resolved base makes `isInside` report EVERY entry as escaping —
      // measured 2026-08-23, a CORRECT hybrid layout also returned all three, which
      // made this control assert a result it would get either way (zero discriminating
      // power). Same reason the HAPPY test above resolves its base.
      realpathSync(scratch.worktreeDir),
    );
    // the trap itself: EVERY scope entry escapes, because the outer symlink is
    // followed first and the inner @fixture/* links are relative.
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

  it("derived workspace set: BOUNDARY (RED, permanently pinned) — a stray directory under packages/ with NO package.json is skipped, not a loud abort for the whole repo", () => {
    const { repoRoot } = makeFixtureMainRepo();
    // A stray directory that carries NO package.json at all — e.g. a
    // leftover build artifact, an aborted rename, an editor scratch dir.
    // This is not a workspace member (Finding 2 of
    // task-make-the-falsifier-s-negative-control-a-permanent-runnable: one
    // such directory used to abort materialization for the WHOLE repo).
    const packagesDir = join(repoRoot, "packages");
    const strayDir = join(packagesDir, "stray-build-artifact");
    mkdirSync(strayDir, { recursive: true });
    writeFileSync(join(strayDir, "README.txt"), "not a package\n", "utf8");

    // RED, permanently pinned: the REJECTED naive alternative this test
    // guards against — the pre-fix `deriveWorkspaceMembers` treated EVERY
    // directory under the base dir as a would-be member and returned `err`
    // the instant one had no `package.json` (the literal
    // `if (!memberJsonResult.ok) return memberJsonResult;` shape the finding
    // named). Reproduced here as a standalone directory scan, never by
    // editing production code, so this assertion keeps discriminating power
    // even after the fix: it independently confirms the stray directory
    // really is the kind of directory that naive shape would have tripped
    // on, contrasted with the FIXED function's behavior asserted below.
    const dirEntryNames = readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const directoriesWithNoPackageJson = dirEntryNames.filter(
      (dirName) => !existsSync(join(packagesDir, dirName, "package.json")),
    );
    expect(directoriesWithNoPackageJson).toEqual(["stray-build-artifact"]);

    // The FIXED behavior: deriveWorkspaceMembers must NOT abort, and must
    // skip the stray directory rather than including or erroring on it.
    const derived = deriveWorkspaceMembers(repoRoot);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.value.map((m) => m.dirName).sort()).toEqual(["consumer", "core", "extra"]);
    expect(derived.value.map((m) => m.dirName)).not.toContain("stray-build-artifact");

    // Materialization for the WHOLE repo must also complete — not just
    // deriveWorkspaceMembers in isolation, which is the actual defect the
    // finding described ("aborts materialization for the whole repo").
    const scratch = createScratch(repoRoot);
    const materialized = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
    expect(materialized.ok).toBe(true);
  });

  it("derived workspace set: ERROR/REGRESSION — a directory that DOES have a package.json but fails to parse it still aborts loud, proving the stray-directory skip was not silently widened", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const brokenDir = join(repoRoot, "packages", "broken-package-json");
    mkdirSync(brokenDir, { recursive: true });
    // Deliberately malformed JSON. Unlike the stray-directory case above,
    // this directory HAS declared itself a package (it carries a
    // package.json) — the fix must NOT widen its skip to swallow this too.
    writeFileSync(join(brokenDir, "package.json"), "{ not valid json", "utf8");

    const derived = deriveWorkspaceMembers(repoRoot);
    expect(derived.ok).toBe(false);
    if (derived.ok) return;
    expect(derived.error.code).toBe("VALIDATION_ERROR");
    if (derived.error.code !== "VALIDATION_ERROR") return;
    expect(derived.error.message).toContain("broken-package-json");
    expect(derived.error.message).toContain("not valid JSON");
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
      // reason: the previous form compared mutatedCorePath against the very
      // directory it was JOINED onto — always true, zero information (found by
      // lore assess, 2026-08-23). This asserts what actually matters: the file
      // the command failed on is the SCRATCH copy and NOT the main checkout's.
      expect(isInside(realpathSync(mutatedCorePath), realpathSync(scratch.worktreeDir))).toBe(true);
      expect(isInside(realpathSync(mutatedCorePath), realpathSync(repoRoot))).toBe(false);
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

  it(
    "main checkout untouched: ERROR (RED i, permanently pinned) — mutating a tracked file directly in the main checkout is detected by the digest check",
    () => {
      const { repoRoot } = makeFixtureMainRepo();
      const digestBefore = digestGitLsFiles(repoRoot);

      // simulate a buggy implementation that mutates the WORKING TREE directly
      // instead of a scratch copy, with no revert.
      writeFileSync(join(repoRoot, "packages", "core", "index.js"), 'module.exports = { PROBE: "LEAKED" };\n', "utf8");

      expect(digestGitLsFiles(repoRoot)).not.toBe(digestBefore);
    },
    15000,
  );

  it(
    "main checkout untouched: NEGATIVE (RED ii, permanently pinned) — a single hardcoded path misses a mutation the full derived-set digest catches",
    () => {
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
    },
    15000,
  );

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

// ─── AC-SD-5 ────────────────────────────────────────────────────────────────

/**
 * Finds the nearest ancestor of `startDir` (inclusive) carrying a
 * `package.json` AND a REAL, INSTALLED `node_modules/.bin` — i.e. "the
 * checked-out repo with installed dependencies this test suite is actually
 * running from," never a hardcoded machine-specific path. Checking
 * `node_modules` alone is NOT enough: running `vitest` itself lazily creates
 * a bare `node_modules/.vite*` optimize-deps cache with no `.bin` and no real
 * packages (measured directly in this task's own dispatched worktree, which
 * otherwise has no `node_modules` of its own at all), which would satisfy a
 * weaker check while still being unusable as a `materializeFalsifierDependencies`
 * source. `.bin` is the signal a genuine package-manager install populates
 * and a bare vitest cache never does.
 *
 * A worktree dispatched under THIS repo's own `.claude/worktrees/<name>`
 * convention (root CLAUDE.md "Worktree 并发安全") has no `node_modules` of its
 * own; this walk lands on the ancestor checkout that does — mirroring the
 * SAME ancestor `node_modules` resolution that already lets this test file's
 * own `@lore/core` bare-specifier imports (transitively, via
 * `in-memory-store.ts`/`sqlite-store.ts`) succeed when this suite itself runs
 * from inside such a worktree. Throws (never a silent fallback) when no
 * ancestor qualifies — AC-SD-5 needs a real, dependency-installed checkout to
 * source both runners from; a caller running this suite with no such
 * ancestor gets a loud, named failure instead of a false pass or a false red.
 */
function findNearestRepoRootWithNodeModules(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "node_modules", ".bin")) && existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `no ancestor of "${startDir}" has both a package.json and an installed node_modules/.bin — AC-SD-5 requires a real, dependency-installed checkout to source the two runners from.`,
      );
    }
    dir = parent;
  }
}

/** Relative to the real repo root — an existing, fast, dependency-requiring vitest target (imports `@lore/core` transitively via `in-memory-store.ts`). */
const REAL_VITEST_TARGET_REL = join("packages", "lore", "tests", "unit", "store", "paging.test.ts");
/** Relative to `packages/lore` — an existing, known-good `.bun.test.ts` target (imports `@lore/core` transitively via `sqlite-store.ts`). */
const REAL_BUN_TEST_TARGET_REL = join("tests", "unit", "store", "sqlite-store.bun.test.ts");

describe("both runners", () => {
  it(
    "both runners: HAPPY — one materialized scratch worktree runs a vitest target and a .bun.test.ts target, each exiting exactly 0 with its own summary line",
    () => {
      const mainRepoRoot = findNearestRepoRootWithNodeModules(process.cwd());
      const scratch = createScratch(mainRepoRoot);
      const materialized = materializeFalsifierDependencies(scratch.worktreeDir, mainRepoRoot);
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) return;

      // vitest half — driven via the scratch tree's OWN materialized
      // `node_modules/.bin/vitest`, never `bunx`'s separate "automatically
      // installing into a global shared cache if not installed in
      // node_modules" fallback (`bunx --help`'s own words): that fallback can
      // mask a broken `.bin` redirect on any machine that already has vitest
      // cached globally (measured on this dev machine), which is exactly the
      // green-only trap RED(i) below exists to catch.
      // `NO_COLOR` (universal convention, https://no-color.org) forces plain
      // output regardless of the OUTER vitest process's own TTY detection —
      // without it, a `COLORTERM`/`FORCE_COLOR` inherited from an interactive
      // parent shell embeds ANSI escape codes INSIDE the summary line (e.g.
      // between "Files" and "1"), breaking the plain-substring check below
      // even though the run genuinely passed (measured directly).
      const plainOutputEnv = { ...process.env, NO_COLOR: "1" };
      const vitestBin = join(scratch.worktreeDir, "node_modules", ".bin", "vitest");
      const vitestRun = spawnSync(vitestBin, ["run", REAL_VITEST_TARGET_REL], {
        cwd: scratch.worktreeDir,
        encoding: "utf8",
        env: plainOutputEnv,
      });
      const vitestOutput = `${vitestRun.stdout ?? ""}${vitestRun.stderr ?? ""}`;
      expect(vitestRun.status, `vitest output:\n${vitestOutput}`).toBe(0);
      expect(vitestOutput).toContain("Test Files  1 passed");

      // bun test half — a real `.bun.test.ts` file, run from `packages/lore`
      // (its own package root, matching `bun run test:bun`'s own cwd).
      const bunTestRun = spawnSync("bun", ["test", REAL_BUN_TEST_TARGET_REL], {
        cwd: join(scratch.worktreeDir, "packages", "lore"),
        encoding: "utf8",
        env: plainOutputEnv,
      });
      const bunOutput = `${bunTestRun.stdout ?? ""}${bunTestRun.stderr ?? ""}`;
      expect(bunTestRun.status, `bun test output:\n${bunOutput}`).toBe(0);
      expect(bunOutput).toContain("0 fail");
    },
    30000,
  );

  it(
    "both runners: ERROR (RED i, permanently pinned) — omitting the dotted .bin entry from the symlinked set breaks the vitest invocation",
    () => {
      const mainRepoRoot = findNearestRepoRootWithNodeModules(process.cwd());
      const scratch = createScratch(mainRepoRoot);
      const materialized = materializeFalsifierDependencies(scratch.worktreeDir, mainRepoRoot);
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) return;

      // simulate "omit dotted entries (notably .bin) from the symlinked set"
      // by deleting the `.bin` symlink this REAL materialize call itself just
      // created — never a code change to the materializer (out of this
      // task's anchor).
      rmSync(join(scratch.worktreeDir, "node_modules", ".bin"), { force: true });

      const vitestBin = join(scratch.worktreeDir, "node_modules", ".bin", "vitest");
      const vitestRun = spawnSync(vitestBin, ["run", REAL_VITEST_TARGET_REL], {
        cwd: scratch.worktreeDir,
        encoding: "utf8",
      });
      // THE TRAP, pinned permanently: there is no `.bin/vitest` to spawn at
      // all — `spawnSync` never reaches a real exit code (0), reporting the
      // failure via `.error` (ENOENT) instead. Both are asserted: `status`
      // alone (never 0, whether null/undefined) plus a defined `.error`,
      // proving the HAPPY test's IDENTICAL invocation above actually depends
      // on the `.bin` redirect materialization built.
      expect(vitestRun.status, "expected the vitest invocation to fail once .bin is omitted").not.toBe(0);
      expect(vitestRun.error).toBeDefined();
    },
    30000,
  );

  it(
    "both runners: BOUNDARY (RED ii, permanently pinned) — the SAME bun command exits nonzero when materialization is skipped, proving materialization (not the bun runner alone) makes the bun half green",
    () => {
      const mainRepoRoot = findNearestRepoRootWithNodeModules(process.cwd());
      const scratch = createScratch(mainRepoRoot);
      // materializeFalsifierDependencies deliberately never called — this is
      // AC-SD-5's own required control: without it, `node_modules` does not
      // exist in the scratch tree at all.

      const bunTestRun = spawnSync("bun", ["test", REAL_BUN_TEST_TARGET_REL], {
        cwd: join(scratch.worktreeDir, "packages", "lore"),
        encoding: "utf8",
      });
      const bunOutput = `${bunTestRun.stdout ?? ""}${bunTestRun.stderr ?? ""}`;
      // THE TRAP, pinned permanently: with no materialized node_modules at
      // all, bare-specifier resolution of `@lore/core` fails outright — never
      // treated as a proven red by anything else in this suite, exactly
      // mirroring "mutation observability"'s own BOUNDARY test one describe
      // block up.
      expect(
        bunTestRun.status,
        `expected a nonzero exit with materialization skipped; output:\n${bunOutput}`,
      ).not.toBe(0);
      expect(bunOutput.toLowerCase()).toContain("cannot find module");
    },
    30000,
  );
});

// ─── AC-SD-8 ────────────────────────────────────────────────────────────────

/**
 * Recursively deletes `dirPath`, WRONGLY dereferencing symlinks first instead
 * of unlinking them — the REJECTED cleanup shape AC-SD-8's RED(i) exists to
 * catch. NEVER used by production code (`removeFalsifierScratchWorktree`
 * itself is never modified by this function or by this task — see this
 * task's own completion report for why measurement showed it already safe).
 */
function followSymlinksRecursiveDelete(dirPath: string): void {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      // THE BUG: deletes what the symlink POINTS TO (dereferenced via
      // `realpathSync`), instead of unlinking the symlink entry itself —
      // exactly the destructive shape this AC exists to refuse.
      rmSync(realpathSync(fullPath), { recursive: true, force: true });
    } else if (entry.isDirectory()) {
      followSymlinksRecursiveDelete(fullPath);
    } else {
      rmSync(fullPath, { force: true });
    }
  }
}

describe("cleanup cannot escape", () => {
  it("cleanup cannot escape: HAPPY/REGRESSION — a sentinel inside the main checkout's node_modules survives a real materialize + cleanup cycle, and the scratch parent is gone", () => {
    const { repoRoot } = makeFixtureMainRepo();
    // The sentinel lives INSIDE the named third-party entry ("vitest") that
    // materialization symlinks straight from the main checkout — mirroring
    // the real "400+ symlinks pointing INTO the developer's real
    // node_modules" shape this AC's own prose describes, never a bare
    // top-level file that no symlink chain would ever reach through.
    const sentinelPath = join(repoRoot, "node_modules", "vitest", "SENTINEL.txt");
    const sentinelContent = `sentinel-${Date.now()}\n`;
    writeFileSync(sentinelPath, sentinelContent, "utf8");

    try {
      const scratch = createScratch(repoRoot);
      const materialized = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
      expect(materialized.ok).toBe(true);

      removeFalsifierScratchWorktree(repoRoot, scratch);
      // reason: already cleaned up — don't let afterEach double-remove it.
      createdScratches.pop();

      expect(existsSync(scratch.parentDir)).toBe(false);
      expect(existsSync(sentinelPath)).toBe(true);
      expect(readFileSync(sentinelPath, "utf8")).toBe(sentinelContent);
    } finally {
      // reason: this task's own context digest — a sentinel written into a
      // real node_modules must be cleaned up by the test even on failure.
      // `repoRoot` itself is a THROWAWAY fixture already destined for
      // `createdRepos`'s own afterEach removal, but this explicit unlink
      // keeps the sentinel from surviving even a thrown assertion above it.
      rmSync(sentinelPath, { force: true });
    }
  });

  it("cleanup cannot escape: ERROR (RED i, permanently pinned) — a symlink-FOLLOWING recursive delete destroys the sentinel inside the main checkout's node_modules", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const sentinelPath = join(repoRoot, "node_modules", "vitest", "SENTINEL.txt");
    const sentinelContent = `sentinel-${Date.now()}\n`;
    writeFileSync(sentinelPath, sentinelContent, "utf8");

    try {
      const scratch = createScratch(repoRoot);
      const materialized = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
      expect(materialized.ok).toBe(true);

      // The REJECTED cleanup shape — never calls the production
      // `removeFalsifierScratchWorktree`.
      followSymlinksRecursiveDelete(join(scratch.worktreeDir, "node_modules"));

      // THE TRAP, pinned permanently: the "vitest" entry was a symlink INTO
      // the MAIN checkout's own node_modules/vitest — a follow-symlinks
      // delete destroys ITS contents, wrongly taking the sentinel with it.
      expect(
        existsSync(sentinelPath),
        "expected the buggy symlink-following delete to WRONGLY destroy the sentinel",
      ).toBe(false);

      // best-effort: the scratch worktree's node_modules is now
      // partially/fully destroyed by the deliberately-destructive probe
      // above; still attempt real removal so this entry doesn't linger.
      createdScratches.pop();
      try {
        removeFalsifierScratchWorktree(repoRoot, scratch);
      } catch {
        /* best-effort */
      }
    } finally {
      rmSync(sentinelPath, { force: true });
    }
  });

  it("cleanup cannot escape: NEGATIVE (RED ii, permanently pinned) — a no-op cleanup cannot satisfy the scratch-parent-absent half", () => {
    const { repoRoot } = makeFixtureMainRepo();
    const scratch = createScratch(repoRoot);
    const materialized = materializeFalsifierDependencies(scratch.worktreeDir, repoRoot);
    expect(materialized.ok).toBe(true);

    // The REJECTED no-op cleanup — deliberately never calls
    // `removeFalsifierScratchWorktree` at all (this AC's own wording: "the
    // test cannot be satisfied by simply not deleting anything"). Real
    // removal still happens via the shared `afterEach`, since `scratch` stays
    // in `createdScratches`.
    expect(existsSync(scratch.parentDir), "a no-op cleanup must fail this half").toBe(true);
  });
});

// ─── AC-SD-7 ────────────────────────────────────────────────────────────────
//
// Unlike every describe above (which calls `materializeFalsifierDependencies`
// directly, bypassing the falsifier pipeline entirely), THIS describe drives
// `VerifyRunnerService.verifyFalsifier` — the wired `_runFalsifier` this
// task's own anchor (`verify-runner-service.ts`) now calls
// `materializeFalsifierDependencies` from — the SAME shape
// `attested-red.test.ts` already uses for its own "AC-FR-11 — green-control"
// describe: a REAL `executor` (spawns `sh -c <command>` via
// `node:child_process.spawnSync`, never a scripted double) and REAL git
// worktree mechanics, with only `getPlanBundle`/`recordVerifiedEvidence`
// staying hand-written test doubles.
//
// The fixture reuses `makeFixtureMainRepo()` verbatim (the SAME workspace +
// node_modules shape already proven, by every describe above, to make
// `materializeFalsifierDependencies` succeed) and adds ONE untracked-only
// file — `only-in-worktree.txt`, mirroring `attested-red.test.ts`'s own
// `makeThrowawayGitRepoWithDependency(false)` fixture exactly: present in
// the WORKING TREE, never `git add`-ed, so the default
// `git worktree add --detach <dir> HEAD` (no `captureUncommitted`) checks out
// only committed content and structurally cannot carry it into the scratch
// worktree either way.
//
// The AC's own command checks TWO things in order, each with its own
// distinct marker, so a wrong-cause pass can never be mistaken for the
// right-cause one: (1) that `node_modules/@fixture/core` resolves at all —
// this is the discriminating check that materialization genuinely ran and
// succeeded (a materializer regression would print `AC_SD_7_MODULE_MISSING`
// and exit 9, a DIFFERENT code than the falsifier's own declared value,
// making a materializer failure impossible to mistake for this AC's own
// green-control failure); only once that passes does it (2) check for
// `only-in-worktree.txt`, printing `AC_SD_7_UNTRACKED_MISSING` and exiting 5
// when absent — the falsifier's OWN declared `expected_exit_code` is ALSO 5,
// mirroring `attested-red.test.ts::makeGreenControlCriterion`'s own
// deliberate numeric coincidence: an implementation that skipped the green
// control, or compared its exit code against `expected_exit_code` instead of
// strictly `=== 0`, would wrongly record "expected-fail" here.
//
// RED-FIRST verification note (recorded in this task's evidence log at the
// moment each was red; NEVER permanently pinned in this describe — both
// require a TEMPORARY, reverted edit to `_runFalsifier` itself, this task's
// own anchor, so pinning either permanently would mean shipping the bug
// alongside its own test):
//   - RED (i) ("hardcode the green control to always pass") was produced by
//     temporarily forcing `_runFalsifier`'s `greenUsable` computation to
//     `true` unconditionally, re-running the HAPPY test below, and observing
//     it record `result: "expected-fail"` (the mutation gets applied and
//     compared even though `only-in-worktree.txt` is still missing) instead
//     of `"inconclusive"` — failing this test's own assertion. Reverted
//     immediately after. See this task's completion report for the exact
//     command/output pair.
//   - RED (ii) ("make materialization also stage untracked files") was
//     produced by temporarily inserting one line right after this task's own
//     `materializeFalsifierDependencies(...)` call in `_runFalsifier` —
//     `cpSync(join(repoRoot, "only-in-worktree.txt"), join(scratch.worktreeDir, "only-in-worktree.txt"))`
//     — simulating a materializer widened to ALSO copy untracked files into
//     the scratch tree, re-running the HAPPY test below, and observing it
//     record `result: "expected-fail"` (the file is now present, so the
//     green control passes) instead of `"inconclusive"` — failing this
//     test's own assertion, proving that widening would be a silent scope
//     change AC-SD-7 exists to reject, never something this task's wiring
//     may do on its own authority. Reverted immediately after. See this
//     task's completion report for the exact command/output pair.

function makeGreenControlStillFiresDoc(
  overrides: Partial<DocRecord> & Pick<DocRecord, "id" | "type" | "title">,
): DocRecord {
  return {
    slug: overrides.id,
    role: "plan",
    status: "approved",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-08-23T00:00:00.000Z",
    updated_at: "2026-08-23T00:00:00.000Z",
    created_by: "ac-sd-7-tester",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

/** A REAL executor — spawns `sh -c <command>` synchronously via `node:child_process.spawnSync`, never a scripted double (same shape `attested-red.test.ts::realExecutor` uses). */
async function greenControlStillFiresRealExecutor(
  spec: VerifySpawnSpec,
): Promise<Result<VerifyExecutionResult, LoreError>> {
  const start = Date.now();
  const result = spawnSync(spec.cmd[0]!, spec.cmd.slice(1), {
    cwd: spec.cwd,
    timeout: spec.timeoutMs,
    encoding: "utf8",
    env: spec.env,
  });
  const timedOut = result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
  const exitCode = result.status ?? (timedOut ? 124 : 1);
  return ok({
    exitCode,
    outputTail: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    durationMs: Date.now() - start,
    timedOut,
  });
}

function makeGreenControlStillFiresRecorder() {
  const calls: Array<{ idOrSlug: string; entry: VerifiedEvidenceInput; nowIso: string }> = [];
  const fn = async (
    idOrSlug: string,
    entry: VerifiedEvidenceInput,
    nowIso: string,
  ): Promise<Result<DocRecord, LoreError>> => {
    calls.push({ idOrSlug, entry, nowIso });
    return ok(makeGreenControlStillFiresDoc({ id: "task-1", type: "task", title: "Task" }));
  };
  return { fn, calls };
}

const GREEN_CONTROL_STILL_FIRES_BASE_CONFIG = {
  repoRoot: "", // overridden per-test with the fixture repo's root
  defaultTimeoutMs: 15000,
  claimTtlMinutes: 120,
  requireCommandApproval: false,
  envAllowlist: [],
  envPassthroughAll: true,
  processEnv: process.env,
};

/**
 * Checks (1) `node_modules/@fixture/core` resolves (proves materialization
 * itself succeeded — a DIFFERENT exit code/marker than (2)/(3), so a
 * materializer regression can never be mistaken for this AC's own
 * untracked-file green-control failure or for a genuine falsifier red), THEN
 * (2) `only-in-worktree.txt` exists — absent by fixture construction in the
 * HAPPY test, exit 5, matching the falsifier's own declared
 * `expected_exit_code` on purpose (see this describe's own header) — THEN,
 * only once BOTH (1) and (2) pass (the reverse-control test, where the file
 * IS tracked), (3) `grep`s `packages/core/index.js`'s own CONTENT for the
 * falsifier's unmutated marker, so the falsifier's mutation (which changes
 * that file's TEXT, never its existence) has an observable effect on this
 * command's exit code — exit 5 again post-mutation, the SAME declared value,
 * mirroring `attested-red.test.ts::makeGreenControlCriterion`'s own
 * deliberate numeric coincidence.
 */
const GREEN_CONTROL_STILL_FIRES_COMMAND = [
  "if [ ! -e node_modules/@fixture/core ]; then echo AC_SD_7_MODULE_MISSING; exit 9; fi",
  "if [ ! -f only-in-worktree.txt ]; then echo AC_SD_7_UNTRACKED_MISSING; exit 5; fi",
  "grep -q PROBE_OK packages/core/index.js && exit 0 || exit 5",
].join("\n");

describe("green control still fires", () => {
  it(
    "green control still fires: HAPPY (also the permanently-pinned RED case) — materialization succeeds (node_modules resolves) but an untracked-only dependency file still makes the green control fail, recording inconclusive, never expected-fail, even though the observed exit code coincides with the falsifier's declared value",
    // reason: spawns ~7 real subprocesses (2 `git config`, `git init` inside
    // `makeFixtureMainRepo`, `git add`/`git commit` seeding the fixture
    // workspace, `git worktree add` + `git worktree remove` inside
    // `verifyFalsifier`'s own `createFalsifierScratchWorktree`/
    // `removeFalsifierScratchWorktree`, plus one real `sh -c` green-control
    // spawn) — check-test-budgets D1 (spec-a-test-case-s-timeout-budget-must-be-declared-when-its).
    { timeout: 20_000 },
    async () => {
      const { repoRoot } = makeFixtureMainRepo();
      // reason: UNTRACKED (never `git add`-ed) — the measured defect vector
      // this AC exists to keep closed even with materialization enabled; see
      // this describe's own header for why the default (no
      // `captureUncommitted`) `git worktree add --detach <dir> HEAD` cannot
      // carry it into the scratch worktree either way.
      writeFileSync(join(repoRoot, "only-in-worktree.txt"), "dependency present\n", "utf8");

      const criterion: AcceptanceCriterion = {
        id: "AC-SD-7-GREEN",
        statement: "node_modules/@fixture/core resolves AND only-in-worktree.txt exists",
        verify: {
          mode: "script",
          oracle: "test",
          command: GREEN_CONTROL_STILL_FIRES_COMMAND,
          falsifier: {
            path: "packages/core/index.js",
            find: "PROBE_OK",
            replace: "PROBE_BROKEN",
            expected_exit_code: 5,
          },
        },
      };
      const plan = makeGreenControlStillFiresDoc({ id: "plan-ac-sd-7", type: "plan", title: "AC-SD-7 Plan" });
      const spec = makeGreenControlStillFiresDoc({
        id: "spec-ac-sd-7",
        type: "spec",
        title: "AC-SD-7 Spec",
        status: "approved",
        extra: { acceptance_criteria: [criterion] },
      });
      const task = makeGreenControlStillFiresDoc({
        id: "task-ac-sd-7",
        type: "task",
        title: "AC-SD-7 Task",
        slug: "task-ac-sd-7",
        parent_id: "plan-ac-sd-7",
      });
      const bundle: PlanBundle = { plan, spec, tasks: [task] };

      const recorder = makeGreenControlStillFiresRecorder();
      const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
      const service = new VerifyRunnerService(
        getPlanBundle,
        recorder.fn,
        greenControlStillFiresRealExecutor,
        { ...GREEN_CONTROL_STILL_FIRES_BASE_CONFIG, repoRoot },
      );

      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "ac-sd-7-tester",
        nowIso: "2026-08-23T00:00:00.000Z",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // The green control's OWN exit code (the untracked-file fallback
      // branch) — numerically equal to `falsifier.expected_exit_code` by
      // deliberate fixture construction, yet the outcome below must still be
      // "inconclusive", never "expected-fail".
      expect(result.value.exit_code).toBe(5);
      expect(result.value.result).toBe("inconclusive");
      expect(result.value.ac_id).toBe("AC-SD-7-GREEN");

      expect(recorder.calls).toHaveLength(1);
      const entry = recorder.calls[0]!.entry;
      expect(entry.result).toBe("inconclusive");
      expect(entry.capture_source).toBe("runner");
      expect(entry.ac_ref).toBe("AC-SD-7-GREEN");
      // AC-FR-11 — NO attestation block on an inconclusive green-control row,
      // materialization enabled or not.
      expect(entry.attestation).toBeUndefined();
      // Proves materialization itself SUCCEEDED — the "module missing"
      // branch (and its own DISTINCT exit code, 9) was never hit. Without
      // this assertion, a materializer regression for this exact fixture
      // shape could make this test pass for the WRONG reason.
      expect(entry.output_tail).not.toContain("AC_SD_7_MODULE_MISSING");
      expect(entry.output_tail).toContain("AC_SD_7_UNTRACKED_MISSING");

      // The mutation was never applied — packages/core/index.js (the
      // falsifier's own target) is untouched.
      expect(readFileSync(join(repoRoot, "packages", "core", "index.js"), "utf8")).toContain("PROBE_OK");
    },
  );

  it(
    "green control still fires: NEGATIVE (mandatory reverse control) — the SAME criterion with only-in-worktree.txt TRACKED instead of untracked passes the green control and reaches expected-fail, proving the HAPPY test's inconclusive above is really about the file being untracked",
    // reason: same subprocess budget as the HAPPY test above, PLUS one extra
    // `git add`/`git commit` pair to track `only-in-worktree.txt` and PLUS
    // the mutated (second) spawn once the green control passes — check-test-budgets
    // flagged this exact test with "3 spawn-helper call(s), no explicit
    // timeout argument" (measured 2026-08-23).
    { timeout: 20_000 },
    async () => {
      const { repoRoot } = makeFixtureMainRepo();
      writeFileSync(join(repoRoot, "only-in-worktree.txt"), "dependency present\n", "utf8");
      // reason: TRACKED this time — the mandatory reverse control (mirrors
      // `attested-red.test.ts::makeThrowawayGitRepoWithDependency(true)`).
      // Without this half, the HAPPY test's "inconclusive" cannot be
      // distinguished from "happened to fail for some unrelated reason" —
      // and it is ALSO the closest available proxy for AC-SD-7's own RED (ii)
      // ("materialization also staging untracked files would be a scope
      // change"): whatever mechanism makes this file available in the
      // scratch tree (git tracking here; a widened materializer per RED (ii)'s
      // own text) flips the SAME criterion's outcome from "inconclusive" to
      // "expected-fail" — exactly the outcome AC-SD-7 forbids a widened
      // materializer from producing silently.
      execFileSync("git", ["add", "-A"], { cwd: repoRoot });
      execFileSync("git", ["commit", "-q", "-m", "track only-in-worktree.txt too"], { cwd: repoRoot });

      const criterion: AcceptanceCriterion = {
        id: "AC-SD-7-GREEN",
        statement: "node_modules/@fixture/core resolves AND only-in-worktree.txt exists",
        verify: {
          mode: "script",
          oracle: "test",
          command: GREEN_CONTROL_STILL_FIRES_COMMAND,
          falsifier: {
            path: "packages/core/index.js",
            find: "PROBE_OK",
            replace: "PROBE_BROKEN",
            expected_exit_code: 5,
          },
        },
      };
      const plan = makeGreenControlStillFiresDoc({ id: "plan-ac-sd-7-neg", type: "plan", title: "AC-SD-7 Plan" });
      const spec = makeGreenControlStillFiresDoc({
        id: "spec-ac-sd-7-neg",
        type: "spec",
        title: "AC-SD-7 Spec",
        status: "approved",
        extra: { acceptance_criteria: [criterion] },
      });
      const task = makeGreenControlStillFiresDoc({
        id: "task-ac-sd-7-neg",
        type: "task",
        title: "AC-SD-7 Task",
        slug: "task-ac-sd-7-neg",
        parent_id: "plan-ac-sd-7-neg",
      });
      const bundle: PlanBundle = { plan, spec, tasks: [task] };

      const recorder = makeGreenControlStillFiresRecorder();
      const getPlanBundle = async (): Promise<Result<PlanBundle, LoreError>> => ok(bundle);
      const service = new VerifyRunnerService(
        getPlanBundle,
        recorder.fn,
        greenControlStillFiresRealExecutor,
        { ...GREEN_CONTROL_STILL_FIRES_BASE_CONFIG, repoRoot },
      );

      const result = await service.verifyFalsifier(plan.id, criterion.id, {
        explicitTaskIdOrSlug: task.id,
        by: "ac-sd-7-tester",
        nowIso: "2026-08-23T00:00:00.000Z",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.result).toBe("expected-fail");
      expect(result.value.exit_code).toBe(5);

      expect(recorder.calls).toHaveLength(1);
      const entry = recorder.calls[0]!.entry;
      expect(entry.result).toBe("expected-fail");
      expect(entry.attestation?.exit_code).toBe(5);
      expect(entry.attestation?.runner).toBe("lore-cli");
    },
  );
});
