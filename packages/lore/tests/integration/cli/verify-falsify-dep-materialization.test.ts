/**
 * AC-SD-6 (spec-a-falsifier-s-scratch-worktree-must-be-runnable-and) — the
 * PRODUCTION-WIRING oracle neither `falsifier-dep-materialization.test.ts`
 * (proves the materializer module works, calling it directly — never through
 * `_runFalsifier`) nor `attested-red.test.ts`/`verify-falsify-green-control.test.ts`
 * (prove the falsifier pipeline works, against fixtures with no `node_modules`
 * to materialize at all) reaches: that `VerifyRunnerService._runFalsifier`
 * actually CALLS `materializeFalsifierDependencies`, BEFORE the green control,
 * so a real `oracle: test` AC whose command genuinely needs `node_modules`
 * can go from "structurally inconclusive forever" to a genuine runner-attested
 * red. This repo has measured the "capability built, nothing calls it" shape
 * three times (root CLAUDE.md, "an attested pass is not evidence of
 * production wiring") — this file is the surface oracle that closes it for
 * this specific capability.
 *
 * `describe("AC-SD-6 ...")` drives the REAL CLI (`bun run src/index.ts`, same
 * subprocess pattern as `verify-falsify-green-control.test.ts::runLore`)
 * against a THROWAWAY corpus (`mkdtemp` + `lore init`, cwd inside it — NEVER
 * this repo's own `.lore/`) that is ALSO a real git repo AND a real (if
 * minimal) workspace: one `@fixture/*` member plus a REAL, WORKING
 * `node_modules` — a symlink farm sourced from the nearest real,
 * dependency-installed ancestor checkout (`findNearestRepoRootWithNodeModules`,
 * same mechanism `falsifier-dep-materialization.test.ts`'s "both runners"
 * describe already uses), never a `bun install` (which would pay a full
 * install per test run). The fixture AC's command is a REAL `vitest` run
 * against a REAL test file — genuinely green unmutated, genuinely exit-1 once
 * the falsifier's declared mutation flips the asserted value — so the
 * declared `--falsifier-exit-code 1` is the value vitest itself returns for
 * an assertion failure, not a scripted stand-in. Every assertion reads the
 * persisted evidence row back via a SEPARATE real `lore get --json` subprocess
 * call and `@lore/core`'s own `extractEvidence` parser — never an injected
 * recorder spy.
 *
 * `describe("materialization failure surfaces ...")` covers the OTHER half of
 * this task's own "no silent fallback" requirement: a `repoRoot` with no
 * `node_modules` of its own AT ALL (every pre-existing falsifier fixture in
 * this repo is exactly this shape) must not make `_runFalsifier` crash, and
 * the materializer's own failure reason must be visible in the SAME evidence
 * row the green control already produces — never a second, silently-dropped
 * failure. This is what makes the wiring backward-compatible with
 * `attested-red.test.ts`/`verify-falsify-green-control.test.ts`/
 * `falsifier-execution-root.bun.test.ts`, none of which this task's anchors
 * permit editing (all three re-run green, unmodified, against this task's
 * final `verify-runner-service.ts` — see this task's own completion report).
 *
 * Dimension mapping:
 *   HAPPY:      AC-SD-6's own scenario — materialized `node_modules` lets a
 *               real vitest command's green control pass, then the falsifier's
 *               mutation makes it exit exactly 1, recorded `expected-fail`
 *               with `attestation.exit_code === 1`, CLI exit 0
 *   NEGATIVE:   n/a at this layer — a falsifier declaring an exit code the
 *               mutation does not actually produce is AC-FR-2's own territory
 *               (`attested-red.test.ts`), unrelated to whether dependencies
 *               are materialized; duplicating it here would re-test AC-FR-2,
 *               not AC-SD-6
 *   BOUNDARY:   the read-back locates the row by `ac_ref` inside a real,
 *               `extractEvidence`-parsed array via a SEPARATE `lore get --json`
 *               subprocess — a runner that recorded nothing leaves `.find(...)`
 *               returning `undefined`, turned into a loud, named failure by
 *               `toBeDefined()` rather than a vacuous pass (RED (ii) below)
 *   ERROR:      `describe("materialization failure surfaces ...")` — a
 *               `repoRoot` with no `node_modules` at all makes
 *               `materializeFalsifierDependencies` itself fail; the run must
 *               neither crash (a hard `err` with nothing recorded) nor
 *               silently proceed as if nothing happened — the failure reason
 *               is asserted present, verbatim, inside the persisted
 *               `inconclusive` row's own `output_tail`
 *   STATE:      the persisted `expected-fail` row's `attestation` block is
 *               asserted present with `exit_code === 1` EXACTLY (not merely
 *               truthy/nonzero); the `inconclusive` row's absence of an
 *               `attestation` key is asserted directly (`toBeUndefined()`)
 *   REGRESSION: `describe("materialization failure surfaces ...")` doubles as
 *               the backward-compatibility proof for every pre-existing
 *               falsifier fixture's shape (no `node_modules`, no `workspaces`)
 *               — this task's own completion report records the pre-existing
 *               suites (`attested-red.test.ts`, `verify-falsify-green-control.test.ts`,
 *               `falsifier-execution-root.bun.test.ts`) re-run green,
 *               unmodified, against the wired `_runFalsifier`
 *
 * RED-FIRST verification note (recorded in this task's evidence log at the
 * moment each was red, per root CLAUDE.md's "red-first证据必须在红的那一刻落盘" —
 * NEVER a permanently-pinned in-suite RED, since AC-SD-6's own text does not
 * ask for one, unlike AC-SD-1..5/AC-SD-8's explicit "permanently pinned"):
 *   - RED (i) ("disable materialization and the row must become inconclusive
 *     with no attestation") was produced by the natural PRE-wiring state of
 *     `_runFalsifier` (no call to `materializeFalsifierDependencies` at all —
 *     this file's own HAPPY test, written and run BEFORE the wiring edit
 *     landed): the fixture's `node_modules/.bin/vitest` is absent from the
 *     bare scratch worktree, the green control's `sh -c` spawn exits 127
 *     ("No such file or directory"), and the persisted row read `inconclusive`
 *     with no `attestation` — exactly the assertion this test would otherwise
 *     make for the WRONG reason. See this task's completion report for the
 *     exact command/output pair.
 *   - RED (ii) ("make the runner skip persistence and the read-back must fail
 *     to find the row") was produced by temporarily short-circuiting
 *     `_runFalsifier`'s SUCCESS-path `recordVerifiedEvidence` call to
 *     `Promise.resolve(ok(task))` (never a change to `verify-runner-service.ts`
 *     left in place — reverted immediately after), re-running this file's
 *     HAPPY test, and observing the read-back's `evidence.find(...)` return
 *     `undefined`, failing `expect(row).toBeDefined()`. See this task's
 *     completion report for the exact command/output pair.
 *
 * @spec_ref spec-a-falsifier-s-scratch-worktree-must-be-runnable-and AC-SD-6
 * @spec_ref task-wire-materialization-into-the-live-falsifier-path-and
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { extractEvidence } from "@lore/core";
import type { DocRecord } from "@lore/core";

// ─── CLI subprocess plumbing (same shape as verify-falsify-green-control.test.ts::runLore) ──

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

/** Disables every `lore gate` service-layer checkpoint for a fixture corpus that deliberately stays "draft". */
function disableAllGates(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      "    spec-create:",
      "      enabled: false",
      "    spec-promote:",
      "      enabled: false",
      "    plan-promote:",
      "      enabled: false",
      "    task-claim:",
      "      enabled: false",
      '    "task-create":',
      "      enabled: false",
      "",
    ].join("\n"),
  );
}

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function createPrd(dir: string, title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], dir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createSpec(dir: string, title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "spec", "--title", title,"--no-ai", "--content", "body"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createPlan(dir: string, title: string, parentSlug: string): string {
  const r = runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

function createTask(dir: string, planSlug: string, title: string, acScope: readonly string[]): string {
  const args = [
    "create",
    "task",
    "--title",
    title,
    "--parent",
    planSlug,
    "--plan-id",
    planSlug,
    "--no-ai",
    "--content",
    "body",
  ];
  for (const acId of acScope) args.push("--ac-scope", acId);
  const r = runLore(args, dir);
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return extractSlug(r.stdout);
}

/** Declares a script-mode AC carrying a DECLARED falsifier (spec-falsifiability-reachability-a-feedable-checkpoint-an §D2). */
function declareScriptAcWithFalsifier(
  dir: string,
  specSlug: string,
  acId: string,
  command: string,
  falsifier: { path: string; find: string; replace: string; exitCode: number },
): void {
  const r = runLore(
    [
      "ac",
      "add",
      specSlug,
      acId,
      "--statement",
      "A dogfood AC exercising the wired falsifier dependency-materialization path.",
      "--mode",
      "script",
      "--oracle",
      "test",
      "--command",
      command,
      "--falsifier-path",
      falsifier.path,
      "--falsifier-find",
      falsifier.find,
      "--falsifier-replace",
      falsifier.replace,
      "--falsifier-exit-code",
      String(falsifier.exitCode),
    ],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`ac add (falsifier) failed: ${r.stderr}`);
}

// ─── Fixture repo builders ──────────────────────────────────────────────────

/**
 * Walks UP from `startDir` for the nearest ancestor carrying both a
 * `package.json` and an installed `node_modules/.bin` — a linked git
 * worktree (this repo's own concurrent-dispatch convention) has no
 * `node_modules` of its own; this lands on the ancestor checkout that does.
 * Same mechanism `falsifier-dep-materialization.test.ts`'s "both runners"
 * describe already uses to source a REAL, working `vitest` without paying
 * for a `bun install` per test run. Throws (never a silent fallback) when no
 * ancestor qualifies.
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
        `no ancestor of "${startDir}" has both a package.json and an installed node_modules/.bin — ` +
          "this fixture requires a real, dependency-installed checkout to source a working vitest from.",
      );
    }
    dir = parent;
  }
}

/**
 * Builds `repoRoot`'s own `node_modules` as a REAL, WORKING symlink farm —
 * every top-level entry of the nearest real, dependency-installed ancestor
 * checkout's `node_modules`, symlinked in (dotted entries, notably `.bin`,
 * included — `readdirSync` already returns them). Deliberately NEVER `git
 * add`-ed by any caller here: mirrors a real developer checkout, where
 * `node_modules` is gitignored and present only via a package-manager
 * install, not tracked history. This is `repoRoot`'s OWN dependency tree —
 * NOT the hybrid scratch-worktree layout (`materializeFalsifierDependencies`
 * builds that separately, INSIDE the scratch worktree, sourcing FROM this).
 */
function installFixtureOwnNodeModules(repoRoot: string): void {
  const sourceRepoRoot = findNearestRepoRootWithNodeModules(process.cwd());
  const sourceNodeModules = join(sourceRepoRoot, "node_modules");
  const destNodeModules = join(repoRoot, "node_modules");
  mkdirSync(destNodeModules, { recursive: true });
  for (const name of readdirSync(sourceNodeModules)) {
    symlinkSync(join(sourceNodeModules, name), join(destNodeModules, name));
  }
}

const GIT_AUTHOR_ARGS = ["-c", "user.email=lore-test@example.com", "-c", "user.name=Lore Test"] as const;

/** The fixture AC's own target file — green (unmutated) iff `ACTUAL_VALUE` reads exactly "MARKER_OK". */
const FIXTURE_TEST_FILE_CONTENT = [
  'import { test, expect } from "vitest";',
  "",
  'const ACTUAL_VALUE = "MARKER_OK";',
  "",
  'test("dep materialization fixture", () => {',
  '  expect(ACTUAL_VALUE).toBe("MARKER_OK");',
  "});",
  "",
].join("\n");

const FIXTURE_FALSIFIER = {
  path: "fixture.test.ts",
  find: 'const ACTUAL_VALUE = "MARKER_OK";',
  replace: 'const ACTUAL_VALUE = "MARKER_BROKEN";',
  exitCode: 1,
};

const FIXTURE_VERIFY_COMMAND = "node_modules/.bin/vitest run fixture.test.ts";

/**
 * A throwaway `mkdtemp` + `git init` repo that is BOTH the corpus root
 * (`_runFalsifier`'s `config.repoRoot === dirname(dirname(dbPath))`, `app.ts`)
 * and a minimal one-member `@fixture/*` workspace — package.json +
 * `packages/fixturepkg/package.json`, committed, PLUS a real, working
 * `node_modules` built AFTER that commit (untracked, see
 * {@link installFixtureOwnNodeModules}). Never this repo's own `.lore/`.
 */
function makeMaterializedFixtureRepo(): { repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-falsify-dep-mat-fixture-"));
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "lore-test@example.com"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Lore Test"], { cwd: repoRoot });

  writeFileSync(
    join(repoRoot, "package.json"),
    JSON.stringify({ name: "fixture-workspace", private: true, workspaces: ["packages/*"] }, null, 2),
    "utf8",
  );
  mkdirSync(join(repoRoot, "packages", "fixturepkg"), { recursive: true });
  writeFileSync(
    join(repoRoot, "packages", "fixturepkg", "package.json"),
    JSON.stringify({ name: "@fixture/pkg" }, null, 2),
    "utf8",
  );
  writeFileSync(join(repoRoot, "fixture.test.ts"), FIXTURE_TEST_FILE_CONTENT, "utf8");

  const init = runLore(["init"], repoRoot);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  disableAllGates(repoRoot);

  return { repoRoot };
}

function commitFixtureRepo(repoRoot: string): void {
  execFileSync("git", ["add", "-A"], { cwd: repoRoot });
  execFileSync("git", [...GIT_AUTHOR_ARGS, "commit", "-q", "-m", "seed fixture corpus + workspace"], {
    cwd: repoRoot,
  });
}

/** A throwaway `mkdtemp` + `git init` + `lore init` repo with NO package.json/node_modules at all — mirrors every pre-existing falsifier fixture in this repo. */
function makeBareFixtureRepo(): { repoRoot: string } {
  const repoRoot = mkdtempSync(join(tmpdir(), "lore-falsify-dep-mat-bare-"));
  execFileSync("git", ["init", "-q"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.email", "lore-test@example.com"], { cwd: repoRoot });
  execFileSync("git", ["config", "user.name", "Lore Test"], { cwd: repoRoot });
  writeFileSync(join(repoRoot, "README.md"), "placeholder\n", "utf8");

  const init = runLore(["init"], repoRoot);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  disableAllGates(repoRoot);

  return { repoRoot };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

const createdRepos: string[] = [];

afterEach(() => {
  while (createdRepos.length > 0) {
    const repoRoot = createdRepos.pop();
    if (repoRoot === undefined) continue;
    try {
      rmSync(repoRoot, { recursive: true, force: true });
    } catch {
      /* best-effort per-test cleanup */
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// describe 1 — AC-SD-6 itself: real CLI subprocess, real vitest, real materialization
// ══════════════════════════════════════════════════════════════════════════════

describe("AC-SD-6 — PRODUCTION WIRING: lore verify --falsify materializes dependencies before the green control", () => {
  it(
    "a real lore verify --falsify run persists an expected-fail row whose attestation exit_code is exactly 1, read back from a throwaway corpus",
    // reason: spawns ~10 `lore` CLI subprocesses (init, create x4, ac add, verify,
    // get) plus a handful of `git` calls plus TWO real `vitest` invocations
    // (green control + mutated) inside the scratch worktree — sized up from
    // `verify-falsify-green-control.test.ts`'s comparable 20s budget for its
    // own ~9-subprocess, no-real-vitest fixture, since this one also pays for
    // two cold vitest starts and a 443-entry symlink farm build.
    { timeout: 60_000 },
    () => {
      const { repoRoot } = makeMaterializedFixtureRepo();
      createdRepos.push(repoRoot);

      const acId = "AC-SD-6-DEPMAT";
      const prdSlug = createPrd(repoRoot, "Dep Materialization Wiring PRD");
      const specSlug = createSpec(repoRoot, "Dep Materialization Wiring Spec", prdSlug);
      declareScriptAcWithFalsifier(repoRoot, specSlug, acId, FIXTURE_VERIFY_COMMAND, FIXTURE_FALSIFIER);
      const planSlug = createPlan(repoRoot, "Dep Materialization Wiring Plan", specSlug);
      const taskSlug = createTask(repoRoot, planSlug, "Dep Materialization Wiring Task", [acId]);

      commitFixtureRepo(repoRoot);
      // Real, working node_modules — built AFTER the commit (untracked, mirrors
      // "checked out, then installed"). This is what materializeFalsifierDependencies
      // must symlink INTO the scratch worktree for the green control to pass.
      installFixtureOwnNodeModules(repoRoot);

      // ⛔ Measured WITHOUT a pipe — `RunResult.exitCode` comes straight from
      // `spawnSync`'s own `.status`.
      const result = runLore(
        ["verify", planSlug, "--task", taskSlug, "--falsify", acId, "--by", "falsify-oracle-test"],
        repoRoot,
      );

      expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain("Attested red recorded");
      expect(result.stdout).toContain(acId);

      // Read the row back OUT of the corpus via a SEPARATE real `lore get --json`
      // subprocess call — never an injected recorder spy (RED (ii)'s own target).
      const readBack = runLore(["get", taskSlug, "--json"], repoRoot);
      expect(readBack.exitCode).toBe(0);
      const parsed = JSON.parse(readBack.stdout) as { data: { doc: DocRecord } };
      const evidence = extractEvidence(parsed.data.doc);

      const row = evidence.find((e) => e.ac_ref === acId);
      expect(row).toBeDefined();
      expect(row?.result).toBe("expected-fail");
      expect(row?.capture_source).toBe("runner");
      expect(row?.recorded_by).toBe("falsify-oracle-test");
      // The declared value is named here on purpose (AC-SD-6's own text) — a
      // reader can determine the expected number without external context.
      expect(row?.attestation).toBeDefined();
      expect(row?.attestation?.exit_code).toBe(1);
      expect(row?.attestation?.runner).toBe("lore-cli");
      expect(row?.output_tail).toContain(FIXTURE_FALSIFIER.path);
    },
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// describe 2 — materialization FAILURE surfaces (never a silent fallback,
// never a crash) — the backward-compatibility half for every pre-existing
// falsifier fixture's own shape (no node_modules, no workspaces at all)
// ══════════════════════════════════════════════════════════════════════════════

describe("materialization failure surfaces without disarming the green control or crashing the run", () => {
  it(
    "a repoRoot with no node_modules at all still resolves to inconclusive via the real CLI, and the persisted row names the materialization failure",
    { timeout: 30_000 },
    () => {
      const { repoRoot } = makeBareFixtureRepo();
      createdRepos.push(repoRoot);

      const acId = "AC-SD-6-NOMOD";
      const prdSlug = createPrd(repoRoot, "Dep Materialization Failure PRD");
      const specSlug = createSpec(repoRoot, "Dep Materialization Failure Spec", prdSlug);
      // Same command as the HAPPY fixture — irrelevant here, since with NO
      // node_modules at all `sh -c` can never resolve `node_modules/.bin/vitest`
      // (exit 127) regardless of what the command would otherwise do.
      declareScriptAcWithFalsifier(repoRoot, specSlug, acId, FIXTURE_VERIFY_COMMAND, FIXTURE_FALSIFIER);
      const planSlug = createPlan(repoRoot, "Dep Materialization Failure Plan", specSlug);
      const taskSlug = createTask(repoRoot, planSlug, "Dep Materialization Failure Task", [acId]);

      commitFixtureRepo(repoRoot);
      // Deliberately NO node_modules built here — `repoRoot` has none of its
      // own to source from, at all. `materializeFalsifierDependencies` must
      // fail loud (its own documented VALIDATION_ERROR), and `_runFalsifier`
      // must neither crash nor silently proceed as if nothing happened.

      const result = runLore(
        ["verify", planSlug, "--task", taskSlug, "--falsify", acId, "--by", "falsify-oracle-test"],
        repoRoot,
      );

      // AC-FR-11's own exit convention: an inconclusive green control is
      // never a silent success.
      expect(result.exitCode, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(3);
      expect(result.stdout).toContain("Green control failed");
      expect(result.stdout).toContain("result:inconclusive");

      const readBack = runLore(["get", taskSlug, "--json"], repoRoot);
      expect(readBack.exitCode).toBe(0);
      const parsed = JSON.parse(readBack.stdout) as { data: { doc: DocRecord } };
      const evidence = extractEvidence(parsed.data.doc);
      const row = evidence.find((e) => e.ac_ref === acId);
      expect(row).toBeDefined();
      expect(row?.result).toBe("inconclusive");
      // AC-FR-11 — NO attestation block on an inconclusive row, materialization
      // failure or not.
      expect(row?.attestation).toBeUndefined();
      // The materialization failure is SURFACED — never silently dropped —
      // inside the SAME row the (also-failing, for the same underlying reason)
      // green control produces.
      expect(row?.output_tail).toContain("dependency materialization was attempted and failed");
      expect(row?.output_tail).toContain("does not exist");
    },
  );
});
