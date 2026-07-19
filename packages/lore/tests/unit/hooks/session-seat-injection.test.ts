/**
 * session-seat-injection.test.ts — SPEC-047 AC-047-B.
 *
 * Behavioral test for the SessionStart hook's linked-worktree seat detection
 * (assets/hooks/session-start-resume.mjs, Phase D). Every case spawns the
 * REAL checked-in hook file as a `node` subprocess against throwaway
 * mkdtemp git repos + a PATH-stubbed `lore` binary — never the repo's own
 * working tree or its live `.lore/` corpus (CLAUDE.md's "never write to the
 * repo's own .lore/ from tests" rule; a stubbed `lore` also sidesteps it
 * for reads).
 *
 * Coverage:
 *   HAPPY:      linked worktree + briefing found at claude-dir → <session-seat>
 *               injected with the sanitized actor + main-checkout path;
 *               `lore bootstrap` is spawned with cwd = main checkout
 *   NEGATIVE:   main-checkout session (not a linked worktree) → NO
 *               <session-seat> block, exit 0 (byte-identical-in-shape to
 *               pre-SPEC-047 behavior for this session type)
 *   BOUNDARY:   briefing found only via the main-checkout assets/ fallback
 *               (claude-dir copy absent) still injects; detached HEAD
 *               derives `worktree-<shortsha>` instead of literal "HEAD"
 *   ERROR:      briefing absent at BOTH locations → fail-open (exit 0, no
 *               <session-seat>, one stderr skip note) — never throws/hangs
 *   STATE:      an exotic branch name (`feat/x_y`) sanitizes to
 *               `agent:feat-x-y` (slashes/underscores collapsed to single
 *               hyphens, no leading/trailing hyphen)
 *   REGRESSION: a non-worktree, non-git cwd (no `.git` at all) behaves
 *               exactly as fail-open — no throw, no seat block
 *
 * @spec_ref AC-047-B
 */

import { describe, it, expect, afterEach } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync, existsSync, realpathSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

// packages/lore/tests/unit/hooks/session-seat-injection.test.ts -> repo root is 5 levels up.
const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");
const HOOK_PATH = join(REPO_ROOT, "assets", "hooks", "session-start-resume.mjs");

if (!existsSync(HOOK_PATH)) {
  throw new Error(`test fixture bug: resolved HOOK_PATH does not exist: ${HOOK_PATH}`);
}

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

function mkScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return dir;
}

/** Initializes a git repo at `dir` with one commit on `initialBranch` (default: main). */
function initGitRepo(dir: string, initialBranch = "main"): void {
  execFileSync("git", ["init", "-q", "-b", initialBranch], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "seat-test@example.invalid"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Seat Test"], { cwd: dir, stdio: "pipe" });
  writeFileSync(join(dir, "README.md"), "seat-injection fixture\n");
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-q", "-m", "init"], { cwd: dir, stdio: "pipe" });
}

/** Writes an executable `lore` stub on its own dir, returning that dir for PATH prepending. */
function makeLoreStub(logPath: string): string {
  const stubDir = mkScratchDir("seat-lore-stub-");
  const stubPath = join(stubDir, "lore");
  writeFileSync(
    stubPath,
    `#!/bin/bash
printf '%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
if [ "$1" = "bootstrap" ]; then
  echo '{"ok":true,"data":{"stub":true}}'
fi
exit 0
`,
  );
  chmodSync(stubPath, 0o755);
  return stubDir;
}

interface RunOpts {
  cwd: string;
  extraEnv?: Record<string, string>;
}

function runHook({ cwd, extraEnv = {} }: RunOpts) {
  const stateBase = mkScratchDir("seat-state-");
  const result = spawnSync("node", [HOOK_PATH], {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...process.env,
      CLAUDE_SESSION_ID: `seat-test-${Math.random().toString(36).slice(2)}`,
      CLAUDE_STATE_BASE_OVERRIDE: stateBase,
      ...extraEnv,
    },
  });
  return result;
}

function parseAdditionalContext(stdout: string): string {
  const parsed = JSON.parse(stdout);
  return parsed?.hookSpecificOutput?.additionalContext ?? "";
}

// ─── HAPPY — linked worktree + claude-dir briefing ────────────────────────────

describe("session-seat-injection — HAPPY", () => {
  it("linked worktree with briefing at claude-dir injects <session-seat> with sanitized actor + main-checkout path, and spawns bootstrap with cwd=main checkout", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));
    // git resolves symlinked tmp dirs (macOS /var -> /private/var) in its
    // plumbing output; compare against the realpath so the assertions match
    // what the hook (which derives MAIN_CHECKOUT from git output) actually sees.
    const mainRepoReal = realpathSync(mainRepo);

    const worktreeDir = join(mkScratchDir("seat-wt-parent-"), "wt");
    execFileSync("git", ["worktree", "add", "-b", "feat/x_y", worktreeDir], { cwd: mainRepo, stdio: "pipe" });

    const claudeDir = mkScratchDir("seat-claude-dir-");
    mkdirSync(join(claudeDir, "governance"), { recursive: true });
    const template = readFileSync(join(REPO_ROOT, "assets", "governance", "seat-briefing.md"), "utf8");
    writeFileSync(join(claudeDir, "governance", "seat-briefing.md"), template);

    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath);

    const result = runHook({
      cwd: worktreeDir,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      },
    });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout!);
    expect(ctx).toContain("<session-seat>");
    expect(ctx).toContain("</session-seat>");
    expect(ctx).toContain("agent:feat-x-y");
    expect(ctx).toContain(mainRepoReal);
    expect(ctx).toContain("feat/x_y");
    expect(ctx).not.toContain("{{ACTOR}}");
    expect(ctx).not.toContain("{{BRANCH}}");
    expect(ctx).not.toContain("{{MAIN_CHECKOUT}}");

    // Phase E's `lore bootstrap` spawn must run with cwd = main checkout,
    // not the worktree — the corpus lives there.
    const log = readFileSync(logPath, "utf8").trim().split("\n");
    const bootstrapCall = log.find((line) => line.includes("bootstrap"));
    expect(bootstrapCall).toBeDefined();
    expect(bootstrapCall!.startsWith(`${mainRepoReal}\t`)).toBe(true);
  });
});

// ─── NEGATIVE — main-checkout session gets no seat block ──────────────────────

describe("session-seat-injection — NEGATIVE", () => {
  it("a main-checkout (non-worktree) session injects NO <session-seat> block", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));

    const claudeDir = mkScratchDir("seat-claude-dir-");
    mkdirSync(join(claudeDir, "governance"), { recursive: true });
    const template = readFileSync(join(REPO_ROOT, "assets", "governance", "seat-briefing.md"), "utf8");
    writeFileSync(join(claudeDir, "governance", "seat-briefing.md"), template);

    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath);

    const result = runHook({
      cwd: mainRepo,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      },
    });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout!);
    expect(ctx).not.toContain("<session-seat>");
    expect(result.stderr).not.toContain("seat-briefing.md");
  });
});

// ─── BOUNDARY — main-checkout assets/ fallback + detached HEAD ────────────────

describe("session-seat-injection — BOUNDARY", () => {
  it("briefing found only via the main-checkout assets/ fallback (claude-dir copy absent) still injects", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));
    mkdirSync(join(mainRepo, "assets", "governance"), { recursive: true });
    const template = readFileSync(join(REPO_ROOT, "assets", "governance", "seat-briefing.md"), "utf8");
    writeFileSync(join(mainRepo, "assets", "governance", "seat-briefing.md"), template);

    const worktreeDir = join(mkScratchDir("seat-wt-parent-"), "wt");
    execFileSync("git", ["worktree", "add", "-b", "feat/fallback", worktreeDir], { cwd: mainRepo, stdio: "pipe" });

    // claude-dir override points at a dir with NO governance/seat-briefing.md.
    const claudeDir = mkScratchDir("seat-claude-dir-empty-");

    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath);

    const result = runHook({
      cwd: worktreeDir,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      },
    });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout!);
    expect(ctx).toContain("<session-seat>");
    expect(ctx).toContain("agent:feat-fallback");
  });

  it("detached HEAD in the worktree derives worktree-<shortsha> instead of literal HEAD", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));

    const worktreeDir = join(mkScratchDir("seat-wt-parent-"), "wt");
    execFileSync("git", ["worktree", "add", "-b", "feat/detach-src", worktreeDir], { cwd: mainRepo, stdio: "pipe" });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktreeDir, encoding: "utf8" }).trim();
    const shortSha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: worktreeDir, encoding: "utf8" }).trim();
    execFileSync("git", ["checkout", "--detach", sha], { cwd: worktreeDir, stdio: "pipe" });

    const claudeDir = mkScratchDir("seat-claude-dir-");
    mkdirSync(join(claudeDir, "governance"), { recursive: true });
    const template = readFileSync(join(REPO_ROOT, "assets", "governance", "seat-briefing.md"), "utf8");
    writeFileSync(join(claudeDir, "governance", "seat-briefing.md"), template);

    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath);

    const result = runHook({
      cwd: worktreeDir,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      },
    });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout!);
    expect(ctx).toContain(`agent:worktree-${shortSha}`);
    expect(ctx).toContain(`worktree-${shortSha}`);
    expect(ctx).not.toContain("agent:head");
  });
});

// ─── ERROR — briefing absent everywhere → fail-open, never throws/hangs ───────

describe("session-seat-injection — ERROR", () => {
  it("briefing absent at both claude-dir and main-checkout assets/ → exit 0, no <session-seat>, one stderr skip note", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));

    const worktreeDir = join(mkScratchDir("seat-wt-parent-"), "wt");
    execFileSync("git", ["worktree", "add", "-b", "feat/no-briefing", worktreeDir], { cwd: mainRepo, stdio: "pipe" });

    const claudeDir = mkScratchDir("seat-claude-dir-empty-");

    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath);

    const result = runHook({
      cwd: worktreeDir,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      },
    });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout!);
    expect(ctx).not.toContain("<session-seat>");
    expect(result.stderr).toContain("seat-briefing.md");
    expect(result.stderr).toContain("linked worktree detected");
  });
});

// ─── STATE — exotic branch sanitization ───────────────────────────────────────

describe("session-seat-injection — STATE", () => {
  it("branch feat/x_y sanitizes to actor agent:feat-x-y (no double hyphen, no leading/trailing hyphen)", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));

    const worktreeDir = join(mkScratchDir("seat-wt-parent-"), "wt");
    execFileSync("git", ["worktree", "add", "-b", "feat/x_y", worktreeDir], { cwd: mainRepo, stdio: "pipe" });

    const claudeDir = mkScratchDir("seat-claude-dir-");
    mkdirSync(join(claudeDir, "governance"), { recursive: true });
    const template = readFileSync(join(REPO_ROOT, "assets", "governance", "seat-briefing.md"), "utf8");
    writeFileSync(join(claudeDir, "governance", "seat-briefing.md"), template);

    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath);

    const result = runHook({
      cwd: worktreeDir,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      },
    });

    expect(result.status).toBe(0);
    const ctx = parseAdditionalContext(result.stdout!);
    expect(ctx).toContain("agent:feat-x-y");
    expect(ctx).not.toContain("agent:feat--x");
    expect(ctx).not.toContain("agent:-feat");
  });
});

// ─── REGRESSION — a non-git cwd behaves as fail-open, never throws ────────────

describe("session-seat-injection — REGRESSION", () => {
  it("a plain (non-git) directory produces no <session-seat> block and never throws/hangs", () => {
    const plainDir = mkScratchDir("seat-plain-");

    const claudeDir = mkScratchDir("seat-claude-dir-");
    mkdirSync(join(claudeDir, "governance"), { recursive: true });
    const template = readFileSync(join(REPO_ROOT, "assets", "governance", "seat-briefing.md"), "utf8");
    writeFileSync(join(claudeDir, "governance", "seat-briefing.md"), template);

    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath);

    const result = runHook({
      cwd: plainDir,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      },
    });

    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    const ctx = parseAdditionalContext(result.stdout!);
    expect(ctx).not.toContain("<session-seat>");
  });
});

// ─── SPEC-057 additions ────────────────────────────────────────────────────────
//
// RED task (task-skill-test-seat-suites-red), AC-S-4 + the hook half of AC-S-5.
// AC-S-4 is a genuinely NEW behavior — the hook's Phase E `lore bootstrap`
// invocation (session-start-resume.mjs line ~193, `spawnSync('lore', ['bootstrap',
// '--json'], ...)`) does not pass a `--seat-branch` flag today, so the first
// describe block below is RED until the paired implementation task adds it. The
// second describe block (golden-fixture sanitizer parity) exercises the hook's
// PRE-EXISTING actor-sanitization regex (session-start-resume.mjs:138-142, live
// since SPEC-047) against the shared golden fixture — that half is expected to
// already be GREEN today (only the CORE side of AC-S-5, seat.test.ts, is RED),
// per this task's own "pre-existing cases green" pass criterion.
//
// Source: spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a
//   §Design Decisions D2, §Structure, §Acceptance Criteria AC-S-4, AC-S-5.

interface GoldenPair {
  input: string;
  expected: string;
}

function loadGoldenPairs(): GoldenPair[] {
  const fixturePath = join(REPO_ROOT, "packages", "lore", "tests", "fixtures", "seat-branch-sanitize.golden.json");
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as { pairs: GoldenPair[] };
  return raw.pairs;
}

/** Sets up a linked worktree on `branch` with a claude-dir briefing present, runs
 *  the hook, and returns `{ctx, bootstrapCall}` — the same fixture shape the HAPPY
 *  block above uses, factored out for reuse across many golden-pair cases. */
function runHookInSeatWorktree(branch: string): { ctx: string; bootstrapCall: string | undefined } {
  const mainRepo = mkScratchDir("seat-main-");
  initGitRepo(mainRepo);
  mkdirSync(join(mainRepo, ".lore"));

  const worktreeDir = join(mkScratchDir("seat-wt-parent-"), "wt");
  execFileSync("git", ["worktree", "add", "-b", branch, worktreeDir], { cwd: mainRepo, stdio: "pipe" });

  const claudeDir = mkScratchDir("seat-claude-dir-");
  mkdirSync(join(claudeDir, "governance"), { recursive: true });
  const template = readFileSync(join(REPO_ROOT, "assets", "governance", "seat-briefing.md"), "utf8");
  writeFileSync(join(claudeDir, "governance", "seat-briefing.md"), template);

  const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
  const stubDir = makeLoreStub(logPath);

  const result = runHook({
    cwd: worktreeDir,
    extraEnv: {
      PATH: `${stubDir}:${process.env.PATH}`,
      CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
    },
  });

  expect(result.status).toBe(0);
  const ctx = parseAdditionalContext(result.stdout!);
  const log = readFileSync(logPath, "utf8").trim().split("\n");
  const bootstrapCall = log.find((line) => line.includes("bootstrap"));
  return { ctx, bootstrapCall };
}

describe("session-seat-injection — SPEC-057 seat signal on lore bootstrap (AC-S-4)", () => {
  it("a linked-worktree session's lore bootstrap invocation includes --seat-branch with the branch value", () => {
    const { bootstrapCall } = runHookInSeatWorktree("feat/x_y");
    expect(bootstrapCall).toBeDefined();
    expect(bootstrapCall).toContain("--seat-branch feat/x_y");
  });

  it("a main-checkout (non-worktree) session's lore bootstrap invocation has NO --seat-branch flag — byte-unchanged", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));

    const claudeDir = mkScratchDir("seat-claude-dir-");
    mkdirSync(join(claudeDir, "governance"), { recursive: true });
    const template = readFileSync(join(REPO_ROOT, "assets", "governance", "seat-briefing.md"), "utf8");
    writeFileSync(join(claudeDir, "governance", "seat-briefing.md"), template);

    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath);

    const result = runHook({
      cwd: mainRepo,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      },
    });

    expect(result.status).toBe(0);
    const log = readFileSync(logPath, "utf8").trim().split("\n");
    const bootstrapCall = log.find((line) => line.includes("bootstrap"));
    expect(bootstrapCall).toBeDefined();
    expect(bootstrapCall).not.toContain("--seat-branch");
  });
});

describe("session-seat-injection — sanitizer golden-fixture parity (AC-S-5, hook side)", () => {
  const pairs = loadGoldenPairs();

  it("loaded golden fixture has at least 10 pairs", () => {
    expect(pairs.length).toBeGreaterThanOrEqual(10);
  });

  for (const { input, expected } of pairs) {
    it(`branch "${input}" sanitizes to actor agent:${expected} in the injected seat block`, () => {
      const { ctx } = runHookInSeatWorktree(input);
      expect(ctx).toContain(`agent:${expected}`);
    });
  }
});
