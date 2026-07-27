/**
 * @spec_ref AC-WH-4
 *
 * Compiled-binary e2e for the git-common-dir worktree-corpus-resolution
 * fallback (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree
 * §M4). `findLoreDbPath` (`utils.ts`) / `findLoreDbPathQuiet`
 * (`gate-bypass-audit.ts`) walk cwd -> filesystem root looking for
 * `.lore/lore.db`; a freshly `git worktree add`-ed tree never materializes
 * `.lore/` (gitignored, untracked, never checked out into a linked
 * worktree), so that walk-up always misses there. The fallback resolves the
 * MAIN checkout's corpus instead of failing, via
 * `git rev-parse --git-common-dir`, so SPEC-042's own claim-from-your-own-
 * worktree protocol no longer needs the hand-rolled lore.db/config.yaml/
 * local-key symlink workaround this repo's own CLAUDE.md documents.
 *
 * Freshness guard: `beforeAll` calls `assertFreshBinary` — a `.bun.test.ts`
 * spawning `dist/lore` directly needs `bun run build` first (dogfood
 * lesson, repo CLAUDE.md "Four false-oracle vectors" #4 — a stale binary is
 * a false oracle).
 *
 * Never touches the repo's OWN `.lore/` corpus — every fixture repo is a
 * throwaway `mkdtemp` git repository, asserted to live outside REPO_ROOT
 * (project CLAUDE.md "never write to the repo's own .lore/ from tests").
 *
 * Coverage:
 *   HAPPY:      get/claim/evidence/release from inside a linked worktree
 *               with NO local `.lore/` operate on the main checkout's
 *               corpus, without any symlink ever created.
 *   REGRESSION: the SAME chain run from the PRIMARY checkout itself is
 *               unchanged (git-common-dir === git-dir there, fallback never
 *               engaged).
 *   BOUNDARY:   cwd inside a SUBDIRECTORY of the linked worktree (not its
 *               root) still resolves via the fallback.
 *   STATE:      a worktree that DOES have its OWN local `.lore/lore.db` (a
 *               separate corpus) — the primary walk-up wins; the fallback
 *               is never consulted, and the main checkout's task stays
 *               invisible there (DOC_NOT_FOUND, exit 3).
 *   NEGATIVE:   a linked worktree of a plain, never-`lore init`-ed repo
 *               (neither a local NOR a common-dir `.lore/` anywhere) fails
 *               loud with the EXACT pre-existing "No Lore database found"
 *               message and exit code 1.
 *   ERROR:      a directory that isn't even a git repository (no `.git`
 *               anywhere, the git-facts probe itself fails) degrades to the
 *               same pre-existing loud failure, never a crash.
 */

import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// ─── Path / spawn setup ─────────────────────────────────────────────────────

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors tests/e2e/bootstrap-injection-compiled.bun.test.ts's own REPO_ROOT
// derivation (same directory, same depth).
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

const cleanupDirs: string[] = [];

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Creates a fresh mkdtemp scratch dir and resolves it via `realpathSync` —
 * macOS's `TMPDIR` (`/var/folders/...`) is itself a symlink into
 * `/private/var/...`, and `git rev-parse`'s absolute-path output is the
 * REAL (resolved) path. Comparing an unresolved `mkdtemp` path against that
 * resolved output would spuriously mismatch on macOS.
 */
function mkScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupDirs.push(dir);
  return realpathSync(dir);
}

/** Runs `git <args>` in `cwd`, returning trimmed stdout. Throws loud on a nonzero exit (fixture setup only — never the code path under test). */
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" }).trim();
}

/** Initializes a git repo at `dir` with one commit on `main`. */
function initGitRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "worktree-corpus-resolution-test@example.invalid"]);
  git(dir, ["config", "user.name", "worktree-corpus-resolution e2e"]);
  writeFileSync(join(dir, "README.md"), "worktree-corpus-resolution fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
}

/**
 * Spawns the COMPILED `dist/lore` binary with `cwd`/`HOME` both pointed at
 * `cwd` — `HOME` isolation keeps every invocation from touching the real
 * user's global `~/.config/lore` (same isolation `bootstrap-injection-compiled
 * .bun.test.ts` uses). `CLAUDECODE=1` resolves the "agent" caller surface
 * (SPEC-024) so no `create`/`claim`/`evidence`/`release` call risks a nested
 * AI invocation.
 */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  expect(result.exitCode).toBe(0);
}

/**
 * Disables all four `lore gate` service-layer checkpoints for the fixture
 * corpus at `dir` (same shape as `tests/e2e/cli.bun.test.ts`'s own
 * `disableAllGates` helper) — this suite's AC (worktree corpus RESOLUTION)
 * has nothing to do with gate semantics; disabling them removes an
 * unrelated source of flakiness from the claim/evidence chain.
 */
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
      "",
    ].join("\n"),
  );
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse slug from create output: ${stdout}`);
  }
  return slug;
}

/**
 * Seeds a PRD -> plan -> task chain in `dir`'s corpus (task requires a
 * spec/task parent + `extra.plan_id` per `CreateDocInput` validation) and
 * returns the task's slug — the one doc this suite's HAPPY/STATE/REGRESSION
 * scenarios claim/evidence/release from a worktree.
 */
function seedTask(dir: string): string {
  const prdResult = runLore(
    ["create", "prd", "--title", "WCR E2E PRD", "--content", "root", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const planResult = runLore(
    ["create", "plan", "--title", "WCR E2E Plan", "--parent", prdSlug, "--content", "x", "--no-ai"],
    dir,
  );
  expect(planResult.exitCode).toBe(0);
  const planSlug = parseSlug(planResult.stdout);

  const taskResult = runLore(
    [
      "create",
      "task",
      "--title",
      "WCR E2E Task",
      "--parent",
      planSlug,
      "--plan-id",
      planSlug,
      "--content",
      "x",
      "--no-ai",
    ],
    dir,
  );
  expect(taskResult.exitCode).toBe(0);
  return parseSlug(taskResult.stdout);
}

const NO_DB_MESSAGE = "No Lore database found in this directory or any parent";

describe("worktree corpus resolution — git-common-dir fallback (AC-WH-4)", () => {
  it("HAPPY: get/claim/evidence/release from a linked worktree with no local .lore/ operate on the main checkout's corpus, no symlinks ever created", () => {
    const repoRoot = mkScratchDir("wcr-happy-repo-");
    initGitRepo(repoRoot);
    initCorpus(repoRoot);
    disableAllGates(repoRoot);
    const taskSlug = seedTask(repoRoot);

    const worktreeBase = mkScratchDir("wcr-happy-wt-");
    const worktreePath = join(worktreeBase, "linked-worktree");
    git(repoRoot, ["worktree", "add", "-b", "wcr-happy-feature", worktreePath]);

    // Precondition: the linked worktree genuinely has no local .lore/ — this
    // is the exact gap SPEC M4 closes, not a fixture artifact.
    expect(existsSync(join(worktreePath, ".lore"))).toBe(false);

    const getResult = runLore(["get", taskSlug], worktreePath);
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout).toContain("WCR E2E Task");

    const claimResult = runLore(
      ["claim", taskSlug, "--by", "agent:wcr-happy", "--worktree", "wcr-happy-feature"],
      worktreePath,
    );
    expect(claimResult.exitCode).toBe(0);

    const evidenceResult = runLore(
      [
        "evidence",
        taskSlug,
        "--oracle",
        "test",
        "--command",
        "echo wcr-happy",
        "--result",
        "pass",
        "--by",
        "agent:wcr-happy",
      ],
      worktreePath,
    );
    expect(evidenceResult.exitCode).toBe(0);

    const releaseResult = runLore(["release", taskSlug, "--by", "agent:wcr-happy"], worktreePath);
    expect(releaseResult.exitCode).toBe(0);

    // Confirm the writes landed in the MAIN checkout's corpus (not some
    // phantom local state) by reading the task back from the PRIMARY
    // checkout itself.
    const verifyFromMain = runLore(["get", taskSlug, "--json"], repoRoot);
    expect(verifyFromMain.exitCode).toBe(0);
    const parsed = JSON.parse(verifyFromMain.stdout) as {
      data: { doc: { extra: { verification_evidence?: unknown[] } } };
    };
    expect(Array.isArray(parsed.data.doc.extra.verification_evidence)).toBe(true);
    expect(parsed.data.doc.extra.verification_evidence?.length).toBe(1);

    // No symlink workaround was ever created.
    expect(existsSync(join(worktreePath, ".lore"))).toBe(false);
  }, 30000);

  it("REGRESSION: primary-checkout resolution is unchanged — get/claim/evidence/release from the main checkout itself still succeed", () => {
    const repoRoot = mkScratchDir("wcr-regression-repo-");
    initGitRepo(repoRoot);
    initCorpus(repoRoot);
    disableAllGates(repoRoot);
    const taskSlug = seedTask(repoRoot);

    // Primary checkout: git-common-dir === git-dir, fallback never engaged —
    // the pre-existing local walk-up resolves `.lore/lore.db` directly.
    const getResult = runLore(["get", taskSlug], repoRoot);
    expect(getResult.exitCode).toBe(0);

    const claimResult = runLore(
      ["claim", taskSlug, "--by", "agent:wcr-regression", "--worktree", "main"],
      repoRoot,
    );
    expect(claimResult.exitCode).toBe(0);

    const evidenceResult = runLore(
      [
        "evidence",
        taskSlug,
        "--oracle",
        "test",
        "--command",
        "echo wcr-regression",
        "--result",
        "pass",
        "--by",
        "agent:wcr-regression",
      ],
      repoRoot,
    );
    expect(evidenceResult.exitCode).toBe(0);

    const releaseResult = runLore(["release", taskSlug, "--by", "agent:wcr-regression"], repoRoot);
    expect(releaseResult.exitCode).toBe(0);
  }, 30000);

  it("BOUNDARY: cwd inside a subdirectory of the linked worktree (not its root) still resolves via the fallback", () => {
    const repoRoot = mkScratchDir("wcr-boundary-repo-");
    initGitRepo(repoRoot);
    initCorpus(repoRoot);
    disableAllGates(repoRoot);
    const taskSlug = seedTask(repoRoot);

    const worktreeBase = mkScratchDir("wcr-boundary-wt-");
    const worktreePath = join(worktreeBase, "linked-worktree");
    git(repoRoot, ["worktree", "add", "-b", "wcr-boundary-feature", worktreePath]);

    const subDir = join(worktreePath, "packages", "lore", "src");
    mkdirSync(subDir, { recursive: true });

    const getResult = runLore(["get", taskSlug], subDir);
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout).toContain("WCR E2E Task");
  }, 30000);

  it("STATE: a worktree with its OWN local .lore/lore.db resolves that corpus — the fallback is never consulted, and the main checkout's task is invisible there", () => {
    const repoRoot = mkScratchDir("wcr-state-repo-");
    initGitRepo(repoRoot);
    initCorpus(repoRoot);
    disableAllGates(repoRoot);
    const taskSlug = seedTask(repoRoot);

    const worktreeBase = mkScratchDir("wcr-state-wt-");
    const worktreePath = join(worktreeBase, "linked-worktree");
    git(repoRoot, ["worktree", "add", "-b", "wcr-state-feature", worktreePath]);

    // The worktree gets its OWN separate corpus (mirrors a session that
    // never adopted the SPEC M4 fallback and still ran `lore init` locally).
    initCorpus(worktreePath);
    expect(existsSync(join(worktreePath, ".lore", "lore.db"))).toBe(true);

    // The main checkout's task is NOT visible from the worktree — local
    // walk-up found the worktree's OWN (empty) corpus first, the fallback
    // was never reached.
    const getResult = runLore(["get", taskSlug], worktreePath);
    expect(getResult.exitCode).toBe(3);
  }, 30000);

  it("NEGATIVE: a linked worktree of a repo with neither local nor common-dir .lore/ fails loud with the existing error", () => {
    const repoRoot = mkScratchDir("wcr-negative-repo-");
    initGitRepo(repoRoot);
    // Deliberately never `lore init` in repoRoot — neither the main checkout
    // nor the worktree will have a `.lore/lore.db` anywhere.

    const worktreeBase = mkScratchDir("wcr-negative-wt-");
    const worktreePath = join(worktreeBase, "linked-worktree");
    git(repoRoot, ["worktree", "add", "-b", "wcr-negative-feature", worktreePath]);

    const getResult = runLore(["get", "anything"], worktreePath);
    expect(getResult.exitCode).toBe(1);
    expect(getResult.stderr).toContain(NO_DB_MESSAGE);
  }, 30000);

  it("ERROR: a plain non-git directory (no .git anywhere) degrades to the same pre-existing loud failure, never a crash", () => {
    const plainDir = mkScratchDir("wcr-error-plain-");
    // No `git init`, no `.lore/` — the git-facts probe itself fails (not a
    // git repository), and must degrade gracefully rather than throwing.

    const getResult = runLore(["get", "anything"], plainDir);
    expect(getResult.exitCode).toBe(1);
    expect(getResult.stderr).toContain(NO_DB_MESSAGE);
  }, 30000);
});
