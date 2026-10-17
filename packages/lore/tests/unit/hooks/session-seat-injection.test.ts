// @spawns assets/hooks/session-start-resume.mjs
// @reads assets/governance/seat-briefing.md
// @reads packages/lore/tests/fixtures/seat-branch-sanitize.golden.json
/**
 * session-seat-injection.test.ts — SPEC-047 AC-047-B, reworked for SPEC-085 D2.
 *
 * Behavioral test for the SessionStart hook's linked-worktree seat detection
 * (assets/hooks/session-start-resume.mjs, Phase D). Every case spawns the
 * REAL checked-in hook file as a `node` subprocess against throwaway
 * mkdtemp git repos + a PATH-stubbed `lore` binary — never the repo's own
 * working tree or its live `.lore/` corpus (CLAUDE.md's "never write to the
 * repo's own .lore/ from tests" rule; a stubbed `lore` also sidesteps it
 * for reads).
 *
 * SPEC-085 D2 rework: Phase D no longer reads `governance/seat-briefing.md`
 * off disk at two candidate paths — it spawns the SAME resolved `lore`
 * binary Phase C/E already spawn, running `governance --seat-briefing`, and
 * substitutes placeholders into whatever stdout that call returns. The
 * `lore` stub (`makeLoreStub`) below therefore answers `governance
 * --seat-briefing` the same way the real binary does (SPEC-085 D1): emits a
 * configured template on stdout at a configured exit code. Omitting the
 * template option reproduces the natural "binary ran but returned nothing
 * useful" fail-open shape with zero extra stub logic.
 *
 * Coverage:
 *   HAPPY:      linked worktree + stub answers `governance --seat-briefing`
 *               with the real SSOT template → <session-seat> injected with
 *               the sanitized actor + main-checkout path; `lore bootstrap`
 *               is spawned with cwd = main checkout
 *   NEGATIVE:   main-checkout session (not a linked worktree) → NO
 *               <session-seat> block, exit 0, and the `governance
 *               --seat-briefing` spawn never happens at all (byte-identical-
 *               in-shape to pre-SPEC-047 behavior for this session type)
 *   BOUNDARY:   the `governance --seat-briefing` spawn runs with cwd = main
 *               checkout (not the worktree cwd) — the SAME invariant Phase
 *               E's `lore bootstrap` spawn already pins, now asserted for
 *               this NEW Phase D child process too; detached HEAD derives
 *               `worktree-<shortsha>` instead of literal "HEAD"
 *   ERROR:      `governance --seat-briefing` returns empty stdout (exit 0)
 *               → fail-open (exit 0, no <session-seat>, one stderr skip
 *               note); a NON-ZERO exit with content on stdout is equally
 *               fail-open (content must never be trusted from a failed
 *               call) — never throws/hangs either way
 *   STATE:      an exotic branch name (`feat/x_y`) sanitizes to
 *               `agent:feat-x-y` (slashes/underscores collapsed to single
 *               hyphens, no leading/trailing hyphen)
 *   REGRESSION: a non-worktree, non-git cwd (no `.git` at all) behaves
 *               exactly as fail-open — no throw, no seat block
 *
 * @spec_ref AC-047-B, AC-085-3
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

const SEAT_BRIEFING_TEMPLATE = readFileSync(join(REPO_ROOT, "assets", "governance", "seat-briefing.md"), "utf8");

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

interface LoreStubOptions {
  /**
   * Stdout to emit for `governance --seat-briefing` (SPEC-085 D1's runtime
   * verb). Omit to simulate the "binary ran but returned nothing useful"
   * fail-open shape (empty stdout, exit 0) with zero extra stub logic.
   */
  briefingContent?: string;
  /** Exit code for the `governance --seat-briefing` branch (default 0). */
  briefingExitCode?: number;
}

/**
 * Writes an executable `lore` stub on its own dir, returning that dir for
 * PATH prepending. Logs every invocation (cwd + full argv) to `logPath` so
 * tests can assert BOTH the spawn args and the spawn cwd. Answers
 * `bootstrap` with a stub JSON payload (Phase E) and `governance
 * --seat-briefing` with `opts.briefingContent` at `opts.briefingExitCode`
 * (Phase D, SPEC-085 D2) — mirroring the real `lore governance
 * --seat-briefing` verb's contract (SPEC-085 D1).
 */
function makeLoreStub(logPath: string, opts: LoreStubOptions = {}): string {
  const { briefingContent, briefingExitCode = 0 } = opts;
  const stubDir = mkScratchDir("seat-lore-stub-");
  const stubPath = join(stubDir, "lore");
  let briefingEmitLine = "";
  if (briefingContent !== undefined) {
    const briefingFile = join(stubDir, "briefing-content.txt");
    writeFileSync(briefingFile, briefingContent);
    briefingEmitLine = `cat "${briefingFile}"`;
  }
  writeFileSync(
    stubPath,
    `#!/bin/bash
printf '%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
if [ "$1" = "bootstrap" ]; then
  echo '{"ok":true,"data":{"stub":true}}'
  exit 0
fi
if [ "$1" = "governance" ] && [ "$2" = "--seat-briefing" ]; then
  ${briefingEmitLine}
  exit ${briefingExitCode}
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

/**
 * Finds a logged `lore` invocation by its EXACT leading argv tokens (e.g.
 * `["bootstrap"]` or `["governance", "--seat-briefing"]`) — never a
 * substring match on the raw log line. Phase E's `governance
 * bootstrap-framing` spawn
 * (spec-context-provenance-injected-corpus-global-state-and-a D2) shares the
 * substring "bootstrap" with the `bootstrap` subcommand's own invocation,
 * and "governance" with every other governance-topic call (bare
 * `governance`, `governance --seat-briefing`) — a naive `line.includes(...)`
 * filter silently grabs the wrong logged line once more than one candidate
 * exists (this repo's own documented contiguous-substring false-oracle
 * vector). Log format is `<cwd>\t<space-joined argv>` (see `makeLoreStub`).
 *
 * @param log - Log lines, one per invocation (`makeLoreStub`'s format).
 * @param argvPrefix - The exact leading argv tokens to match, in order.
 * @returns The first matching line, or `undefined` if none match.
 */
function findLoreCall(log: readonly string[], argvPrefix: readonly string[]): string | undefined {
  return log.find((line) => {
    const argvStr = line.split("\t")[1] ?? "";
    const tokens = argvStr.split(" ");
    return argvPrefix.every((tok, i) => tokens[i] === tok);
  });
}

// ─── HAPPY — linked worktree + binary answers governance --seat-briefing ──────

describe("session-seat-injection — HAPPY", () => {
  it("linked worktree with the binary answering governance --seat-briefing injects <session-seat> with sanitized actor + main-checkout path, and spawns bootstrap with cwd=main checkout", () => {
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
    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath, { briefingContent: SEAT_BRIEFING_TEMPLATE });

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

    const log = readFileSync(logPath, "utf8").trim().split("\n");

    // Phase D's new spawn: `governance --seat-briefing` as a literal argv pair.
    const governanceCall = findLoreCall(log, ["governance", "--seat-briefing"]);
    expect(governanceCall).toBeDefined();
    expect(governanceCall).toContain("governance --seat-briefing");

    // Phase E's `lore bootstrap` spawn must run with cwd = main checkout,
    // not the worktree — the corpus lives there.
    const bootstrapCall = findLoreCall(log, ["bootstrap"]);
    expect(bootstrapCall).toBeDefined();
    expect(bootstrapCall!.startsWith(`${mainRepoReal}\t`)).toBe(true);
  });
});

// ─── NEGATIVE — main-checkout session gets no seat block, no spawn at all ─────

describe("session-seat-injection — NEGATIVE", () => {
  it("a main-checkout (non-worktree) session injects NO <session-seat> block and never spawns governance --seat-briefing", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));

    const claudeDir = mkScratchDir("seat-claude-dir-");
    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath, { briefingContent: SEAT_BRIEFING_TEMPLATE });

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
    expect(result.stderr).not.toContain("seat-briefing");

    // Phase C still spawns bare `governance` (no flag) for this .lore-having
    // main-checkout session — only the Phase D `--seat-briefing` spawn must
    // be absent, since Phase D's whole branch is gated on being inside a
    // linked worktree (commonDirAbs !== gitDirAbs), which this session isn't.
    const log = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    expect(log.some((line) => line.includes("--seat-briefing"))).toBe(false);
  });
});

// ─── BOUNDARY — spawn cwd = main checkout + detached HEAD ─────────────────────

describe("session-seat-injection — BOUNDARY", () => {
  it("the governance --seat-briefing spawn runs with cwd = main checkout, not the worktree", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));
    const mainRepoReal = realpathSync(mainRepo);

    const worktreeDir = join(mkScratchDir("seat-wt-parent-"), "wt");
    execFileSync("git", ["worktree", "add", "-b", "feat/cwd-check", worktreeDir], { cwd: mainRepo, stdio: "pipe" });

    const claudeDir = mkScratchDir("seat-claude-dir-");
    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath, { briefingContent: SEAT_BRIEFING_TEMPLATE });

    const result = runHook({
      cwd: worktreeDir,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      },
    });

    expect(result.status).toBe(0);
    const log = readFileSync(logPath, "utf8").trim().split("\n");
    const governanceCall = findLoreCall(log, ["governance", "--seat-briefing"]);
    expect(governanceCall).toBeDefined();
    expect(governanceCall!.startsWith(`${mainRepoReal}\t`)).toBe(true);
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
    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath, { briefingContent: SEAT_BRIEFING_TEMPLATE });

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

// ─── ERROR — governance --seat-briefing failure shapes → fail-open ────────────

describe("session-seat-injection — ERROR", () => {
  it("governance --seat-briefing returns empty stdout (exit 0) → exit 0, no <session-seat>, one stderr skip note", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));

    const worktreeDir = join(mkScratchDir("seat-wt-parent-"), "wt");
    execFileSync("git", ["worktree", "add", "-b", "feat/no-briefing", worktreeDir], { cwd: mainRepo, stdio: "pipe" });

    const claudeDir = mkScratchDir("seat-claude-dir-empty-");
    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    // No briefingContent — the stub answers governance --seat-briefing with
    // empty stdout at exit 0, the natural "unavailable" shape.
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
    expect(result.stderr).toContain("seat-briefing unavailable");
    expect(result.stderr).toContain("linked worktree detected");
  });

  it("governance --seat-briefing exits non-zero even WITH stdout content → fail-open, content never trusted from a failed call", () => {
    const mainRepo = mkScratchDir("seat-main-");
    initGitRepo(mainRepo);
    mkdirSync(join(mainRepo, ".lore"));

    const worktreeDir = join(mkScratchDir("seat-wt-parent-"), "wt");
    execFileSync("git", ["worktree", "add", "-b", "feat/nonzero-exit", worktreeDir], { cwd: mainRepo, stdio: "pipe" });

    const claudeDir = mkScratchDir("seat-claude-dir-empty-");
    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath, { briefingContent: SEAT_BRIEFING_TEMPLATE, briefingExitCode: 1 });

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
    expect(result.stderr).toContain("seat-briefing unavailable");
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
    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath, { briefingContent: SEAT_BRIEFING_TEMPLATE });

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
    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath, { briefingContent: SEAT_BRIEFING_TEMPLATE });

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

/** Sets up a linked worktree on `branch` with the stub answering
 *  governance --seat-briefing, runs the hook, and returns `{ctx, bootstrapCall}`
 *  — the same fixture shape the HAPPY block above uses, factored out for reuse
 *  across many golden-pair cases. */
function runHookInSeatWorktree(branch: string): { ctx: string; bootstrapCall: string | undefined } {
  const mainRepo = mkScratchDir("seat-main-");
  initGitRepo(mainRepo);
  mkdirSync(join(mainRepo, ".lore"));

  const worktreeDir = join(mkScratchDir("seat-wt-parent-"), "wt");
  execFileSync("git", ["worktree", "add", "-b", branch, worktreeDir], { cwd: mainRepo, stdio: "pipe" });

  const claudeDir = mkScratchDir("seat-claude-dir-");
  const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
  const stubDir = makeLoreStub(logPath, { briefingContent: SEAT_BRIEFING_TEMPLATE });

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
  const bootstrapCall = findLoreCall(log, ["bootstrap"]);
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
    const logPath = join(mkScratchDir("seat-log-"), "lore-calls.log");
    const stubDir = makeLoreStub(logPath, { briefingContent: SEAT_BRIEFING_TEMPLATE });

    const result = runHook({
      cwd: mainRepo,
      extraEnv: {
        PATH: `${stubDir}:${process.env.PATH}`,
        CLAUDE_AGENTS_DIR_OVERRIDE: join(claudeDir, "agents"),
      },
    });

    expect(result.status).toBe(0);
    const log = readFileSync(logPath, "utf8").trim().split("\n");
    const bootstrapCall = findLoreCall(log, ["bootstrap"]);
    expect(bootstrapCall).toBeDefined();
    expect(bootstrapCall).not.toContain("--seat-branch");
  });
});

describe("session-seat-injection — sanitizer golden-fixture parity (spec-spec-057-two-tier-worktree-seat-model-lore-seat-verb-seat-a#AC-S-5, hook side)", () => {
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
