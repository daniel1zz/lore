/**
 * @spec_ref AC-ASSESS-1, AC-ASSESS-4, AC-ASSESS-6
 *
 * CLI `lore assess` post-AI path tests — bun:test only (uses real SQLiteStore via
 * loadLoreApp, same pattern as cli-create-ai.bun.test.ts).
 *
 * Why this file exists / coverage-boundary note (dispatch requirement):
 *   InMemoryAIProvider is NOT config-selectable — packages/lore/src/ai/registry.ts
 *   ALWAYS constructs a ClaudeCliProvider (or HttpAIProvider) from config.ai.providers;
 *   there is no `kind: "in-memory"` branch. So a literal InMemoryAIProvider cannot be
 *   wired into a real CLI invocation via config.
 *
 *   However, ClaudeCliProvider spawns ANY configured command and pipes the prompt to
 *   its stdin — exactly the existing hermetic idiom cli-create-ai.bun.test.ts already
 *   uses (/bin/cat, /usr/bin/true, /usr/bin/false, custom shell scripts). That idiom
 *   fully covers the CLI's post-AI success/failure paths WITHOUT needing InMemoryAIProvider
 *   to be config-selectable — a fixed shell script that emits deterministic JSON on
 *   stdout is a legitimate, hermetic "AI provider" for these purposes. This file uses
 *   that idiom, so post-AI CLI coverage is NOT skipped/deferred to the service layer only.
 *
 * Strategy:
 *   - Create a real .lore/lore.db in a temp dir via createApp()
 *   - Write .lore/config.yaml pointing ai.provider at a fake shell script
 *   - chdir into the temp dir, call assess command's run() directly (same process)
 *   - For the real-git-diff case: `git init` + two commits in the SAME temp dir,
 *     `--diff HEAD~1..HEAD` shells the real `git diff` subprocess (AC-ASSESS-6 D3)
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      --diff-file hermetic success creates a knowledge doc + informs link
 *               (AC-ASSESS-1); real-git --diff fixture succeeds end-to-end; PRIMARY
 *               ORACLE — auto-derived commit set excludes interleaved foreign commits
 *               (task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be)
 *   BOUNDARY:   the diff text actually reaches the judge prompt (captured via a script
 *               that tees stdin to a file before emitting its fixed JSON response);
 *               no discoverable commits → loud named outcome, never a silent empty diff
 *   ERROR:      double-malformed provider output → exit 6, AI_PROVIDER_ERROR, and NO
 *               knowledge doc is created (AC-ASSESS-4, end-to-end through the real CLI);
 *               a diff far exceeding the git-diff spawnSync maxBuffer → real ENOBUFS,
 *               message names the buffer + ai.assess.max_diff_chars, never git
 *               (task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1)
 *   STATE:      after a successful assess, the plan's tree shows the new assessment
 *               doc linked via informs; an ENOBUFS early-return creates NO doc
 *   REGRESSION: a plan with tasks that succeeds does NOT also trip the zero-task gate;
 *               CONTROL — a contiguous (non-interleaved) commit set agrees with today's
 *               naive range, so auto-derivation is not a behavior break for the simple case;
 *               a non-ENOBUFS git failure still renders the pre-existing generic message
 *
 * @spec_ref AC-ASSESS-1, AC-ASSESS-4, AC-ASSESS-6, task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be,
 * task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1
 */

import type { Invocation } from "@lore/core";
import { liveInvocation, liveAmbient, liveWriteContext, runHandlerForExit } from "../../live-invocation.js";

/** The exit code the most recent command call ended with (commands return it; none sets `process.exitCode`). */
let lastExitCode = 0;
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { createApp } from "../../../src/app.js";
import { ASSESS_NO_COMMITS_DERIVED } from "../../../src/adapters/cli/cli-refusal-messages.js";
import { saveConfig } from "@lore/core/node";
import type { CreateDocInput } from "@lore/core";

// ─── Command type ─────────────────────────────────────────────────────────────

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

// ─── Output / exit capture (mirrors cli-create-ai.bun.test.ts) ───────────────

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origConsoleLog = console.log.bind(console);

  (process.stderr as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  };
  console.log = (...args: unknown[]) => {
    stdout.push(args.join(" "));
  };

  return {
    stdout,
    stderr,
    restore: () => {
      (process.stderr as unknown as { write: typeof origStderrWrite }).write = origStderrWrite;
      console.log = origConsoleLog;
    },
  };
}

async function importAssessCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/assess.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("assess command not exported");
  return cmd as RunnableCommand;
}

// ─── Project setup ────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-assess-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  try {
    const { rmSync } = require("fs") as { rmSync: (p: string, opts: object) => void };
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────

async function createPlanWithTask(): Promise<{ planId: string; planSlug: string }> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const planResult = await app.corpusService.create({
      type: "plan",
      title: "AI Assess Plan",
      content: "Plan body for hermetic assess CLI tests.",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error(`plan create failed: ${JSON.stringify(planResult.error)}`);
    const taskResult = await app.corpusService.create({
      type: "task",
      title: "AI Assess Task",
      parent_id: planResult.value.id,
      content: "Task body.",
      extra: {
        plan_id: planResult.value.id,
        verification_evidence: [
          { oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_at: "2026-07-01T00:00:00.000Z", recorded_by: "alice" },
        ],
      },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error(`task create failed: ${JSON.stringify(taskResult.error)}`);
    return { planId: planResult.value.id, planSlug: planResult.value.slug };
  } finally {
    app.close();
  }
}

/**
 * Creates a plan with N tasks named `taskTitles`, returning each task's REAL slug (the
 * commit-derivation fixtures below must reference the actual generated slug, never a
 * guessed one — `deriveCommitSetForPlan` matches on the corpus's own `task.slug`).
 */
async function createPlanWithNamedTasks(taskTitles: string[]): Promise<{ planId: string; planSlug: string; taskSlugs: string[] }> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const planResult = await app.corpusService.create({
      type: "plan",
      title: "Assess Commit Derivation Plan",
      content: "Plan body for commit-derivation CLI tests.",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error(`plan create failed: ${JSON.stringify(planResult.error)}`);
    const taskSlugs: string[] = [];
    for (const title of taskTitles) {
      const taskResult = await app.corpusService.create({
        type: "task",
        title,
        parent_id: planResult.value.id,
        content: "Task body.",
        extra: {
          plan_id: planResult.value.id,
          verification_evidence: [
            { oracle: "tsc", command: "bun run typecheck", result: "pass", recorded_at: "2026-07-01T00:00:00.000Z", recorded_by: "alice" },
          ],
        },
      } as CreateDocInput);
      if (!taskResult.ok) throw new Error(`task create failed: ${JSON.stringify(taskResult.error)}`);
      taskSlugs.push(taskResult.value.slug);
    }
    return { planId: planResult.value.id, planSlug: planResult.value.slug, taskSlugs };
  } finally {
    app.close();
  }
}

/** Write config.yaml pointing ai.provider at the given shell command. */
function writeAiConfig(command: string, args: string[] = []) {
  saveConfig(tmpDir, {
    project: { name: "assess-ai-test", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command, args, timeout_ms: 5000 } },
      templates: {},
      telemetry: false,
    },
  } as never);
}

const VALID_JSON = JSON.stringify({
  verdict: "met",
  overall_score: 92,
  ac_scores: [{ ac_id: "AC-ASSESS-1", score: 92, reasoning: "Evidence trail is solid.", evidence_refs: [] }],
  gaps: [],
  recommendations: ["Nothing further."],
});

/**
 * Write a fake "AI provider" shell script that:
 *   1. tees its stdin (the rendered prompt) to `captureFile` for later inspection
 *   2. emits a FIXED valid-JSON assessment response on stdout, ignoring the actual prompt
 * This is the hermetic idiom documented in this file's header comment.
 */
function writeFixedJsonProviderScript(captureFile: string): string {
  const scriptPath = join(tmpDir, "fake-ai-provider.sh");
  writeFileSync(
    scriptPath,
    `#!/bin/sh\ncat > "${captureFile}"\ncat <<'JSONEOF'\n${VALID_JSON}\nJSONEOF\n`,
    { mode: 0o755 },
  );
  return scriptPath;
}

/** Write a fake provider script that always emits non-JSON prose (for AC-ASSESS-4). */
function writeMalformedProviderScript(): string {
  const scriptPath = join(tmpDir, "fake-ai-malformed.sh");
  writeFileSync(
    scriptPath,
    `#!/bin/sh\ncat > /dev/null\necho "Sorry, I cannot produce structured output right now."\n`,
    { mode: 0o755 },
  );
  return scriptPath;
}

// ─── HAPPY: --diff-file hermetic success (AC-ASSESS-1) ──────────────────────

describe("lore assess --diff-file — hermetic success path (AC-ASSESS-1)", () => {
  it("creates a knowledge doc (sub_type=assessment) linked to the plan via informs", async () => {
    const { planId, planSlug } = await createPlanWithTask();
    const captureFile = join(tmpDir, "captured-prompt.txt");
    const scriptPath = writeFixedJsonProviderScript(captureFile);
    writeAiConfig(scriptPath);

    const diffFile = join(tmpDir, "input.diff");
    writeFileSync(diffFile, "diff --git a/foo.ts b/foo.ts\n+++ b/foo.ts\n+added hermetic diff line\n");

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, "diff-file": diffFile, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode === 0).toBe(true);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain('"ok": true');

    // Verify the doc actually landed in the store — open a fresh App to inspect.
    const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const docsResult = await app.corpusService.listFull({ type: "knowledge" });
      expect(docsResult.ok).toBe(true);
      if (!docsResult.ok) return;
      expect(docsResult.value.docs).toHaveLength(1);
      expect(docsResult.value.docs[0]?.extra["sub_type"]).toBe("assessment");
      expect(docsResult.value.docs[0]?.parent_id).toBe(planId);
    } finally {
      app.close();
    }
  });

  it("the diff-file content actually reaches the judge prompt (captured via stdin tee)", async () => {
    const { planSlug } = await createPlanWithTask();
    const captureFile = join(tmpDir, "captured-prompt-2.txt");
    const scriptPath = writeFixedJsonProviderScript(captureFile);
    writeAiConfig(scriptPath);

    const diffFile = join(tmpDir, "input2.diff");
    const uniqueMarker = "UNIQUE_DIFF_MARKER_7f3a9c";
    writeFileSync(diffFile, `diff --git a/bar.ts b/bar.ts\n+++ b/bar.ts\n+${uniqueMarker}\n`);

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, "diff-file": diffFile, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(existsSync(captureFile)).toBe(true);
    const capturedPrompt = readFileSync(captureFile, "utf8");
    expect(capturedPrompt).toContain(uniqueMarker);
  });
});

// ─── HAPPY: real-git --diff fixture (AC-ASSESS-6, §3 D3) ─────────────────────

describe("lore assess --diff <range> — real git subprocess fixture (AC-ASSESS-6, D3)", () => {
  it("shells `git diff HEAD~1..HEAD` and the resulting diff reaches the judge prompt", async () => {
    const { planSlug } = await createPlanWithTask();
    const captureFile = join(tmpDir, "captured-git-prompt.txt");
    const scriptPath = writeFixedJsonProviderScript(captureFile);
    writeAiConfig(scriptPath);

    // Real git fixture: init, commit v1, commit v2.
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Tester", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "Tester", GIT_COMMITTER_EMAIL: "t@example.com" };
    spawnSync("git", ["init", "-q"], { cwd: tmpDir, env: gitEnv });
    const trackedFile = join(tmpDir, "tracked.txt");
    writeFileSync(trackedFile, "version one\n");
    spawnSync("git", ["add", "tracked.txt"], { cwd: tmpDir, env: gitEnv });
    spawnSync("git", ["commit", "-q", "-m", "v1"], { cwd: tmpDir, env: gitEnv });
    writeFileSync(trackedFile, "version one\nGIT_FIXTURE_MARKER_a1b2c3\n");
    spawnSync("git", ["add", "tracked.txt"], { cwd: tmpDir, env: gitEnv });
    spawnSync("git", ["commit", "-q", "-m", "v2"], { cwd: tmpDir, env: gitEnv });

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, diff: "HEAD~1..HEAD", json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode === 0).toBe(true);
    expect(existsSync(captureFile)).toBe(true);
    const capturedPrompt = readFileSync(captureFile, "utf8");
    expect(capturedPrompt).toContain("GIT_FIXTURE_MARKER_a1b2c3");
  });

  it("an invalid git range fails with a git error, exit code 2, and no knowledge doc is created", async () => {
    const { planSlug } = await createPlanWithTask();
    // No git repo initialized in tmpDir at all — `git diff` will fail.
    writeAiConfig("/bin/true"); // provider would never even be reached

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, diff: "HEAD~1..HEAD", json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(2);

    const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const docsResult = await app.corpusService.listFull({ type: "knowledge" });
      expect(docsResult.ok).toBe(true);
      if (!docsResult.ok) return;
      expect(docsResult.value.docs).toHaveLength(0);
    } finally {
      app.close();
    }
  });
});

// ─── HAPPY / PRIMARY ORACLE: auto-derived commit set, interleaved foreign history ──
//
// task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be — `lore assess <plan>`
// with NEITHER --diff NOR --diff-file must derive the plan's own commit set from git
// history itself, and the derived diff must contain ONLY the plan's own commits, never
// a foreign plan's, even when they are interleaved in main's history.

describe("lore assess — auto-derived commit set: PRIMARY ORACLE (interleaved foreign history)", () => {
  it("excludes every interleaved foreign commit; only the plan's own task-referencing commits reach the judge prompt", async () => {
    const { planSlug, taskSlugs } = await createPlanWithNamedTasks(["Own Task Alpha", "Own Task Beta"]);
    const captureFile = join(tmpDir, "captured-derived-prompt.txt");
    const scriptPath = writeFixedJsonProviderScript(captureFile);
    writeAiConfig(scriptPath);

    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Tester", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "Tester", GIT_COMMITTER_EMAIL: "t@example.com" };
    spawnSync("git", ["init", "-q"], { cwd: tmpDir, env: gitEnv });
    const gitCommit = (filename: string, content: string, message: string) => {
      writeFileSync(join(tmpDir, filename), content);
      spawnSync("git", ["add", filename], { cwd: tmpDir, env: gitEnv });
      spawnSync("git", ["commit", "-q", "-m", message], { cwd: tmpDir, env: gitEnv });
    };
    gitCommit("seed.txt", "seed\n", "seed commit");
    gitCommit("foreign1.txt", "FOREIGN_ALPHA_CONTENT\n", "unrelated foreign change alpha");
    gitCommit("own-a.txt", "OWN_A_CONTENT\n", `implements ${taskSlugs[0]}`);
    gitCommit("foreign2.txt", "FOREIGN_BETA_CONTENT\n", "unrelated foreign change beta");
    gitCommit("own-b.txt", "OWN_B_CONTENT\n", `implements ${taskSlugs[1]}`);
    gitCommit("foreign3.txt", "FOREIGN_GAMMA_CONTENT\n", "unrelated foreign change gamma");

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      // Deliberately NO --diff / --diff-file — this is the auto-derivation path.
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode === 0).toBe(true);
    expect(existsSync(captureFile)).toBe(true);
    const capturedPrompt = readFileSync(captureFile, "utf8");
    expect(capturedPrompt).toContain("OWN_A_CONTENT");
    expect(capturedPrompt).toContain("OWN_B_CONTENT");
    expect(capturedPrompt).not.toContain("FOREIGN_ALPHA_CONTENT");
    expect(capturedPrompt).not.toContain("FOREIGN_BETA_CONTENT");
    expect(capturedPrompt).not.toContain("FOREIGN_GAMMA_CONTENT");

    // AC #3: the assessment RECORDS which commits it diffed — not just diff_available.
    const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const docsResult = await app.corpusService.listFull({ type: "knowledge" });
      expect(docsResult.ok).toBe(true);
      if (!docsResult.ok) return;
      const diffSource = docsResult.value.docs[0]?.extra["diff_source"] as
        | { mode: string; status?: string; commits?: unknown[]; tasks_without_commits?: string[] }
        | undefined;
      expect(diffSource?.mode).toBe("auto_derived");
      expect(diffSource?.status).toBe("derived");
      expect(diffSource?.commits).toHaveLength(2);
      expect(diffSource?.tasks_without_commits).toEqual([]);
    } finally {
      app.close();
    }
  }, 20000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 9 direct spawn calls — 1 `spawnSync` (git init) + 6
  // calls to the locally-defined `gitCommit` helper (itself a registered spawn
  // helper, 2 direct `spawnSync` calls in its own body) + the 2 `spawnSync`
  // calls textually inside that helper's definition, which this oracle's
  // lexical scan also counts as part of the enclosing test body. Measured
  // 854-1167ms in isolation across 3 runs (this file also runs the real
  // `assess` command end-to-end, heavier than a bare git fixture); 20000ms
  // gives >=17x headroom for a concurrent-worktree load spike.
});

// ─── CONTROL: contiguous commits (SPEC oracle #5) ────────────────────────────────

describe("lore assess — auto-derived commit set: CONTROL (contiguous, no foreign interleaving)", () => {
  it("produces the same reachable content as today's naive contiguous range when there is no foreign interleaving", async () => {
    const { planSlug, taskSlugs } = await createPlanWithNamedTasks(["Contiguous Task Alpha", "Contiguous Task Beta"]);
    const captureFile = join(tmpDir, "captured-control-prompt.txt");
    const scriptPath = writeFixedJsonProviderScript(captureFile);
    writeAiConfig(scriptPath);

    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Tester", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "Tester", GIT_COMMITTER_EMAIL: "t@example.com" };
    spawnSync("git", ["init", "-q"], { cwd: tmpDir, env: gitEnv });
    const gitCommit = (filename: string, content: string, message: string) => {
      writeFileSync(join(tmpDir, filename), content);
      spawnSync("git", ["add", filename], { cwd: tmpDir, env: gitEnv });
      spawnSync("git", ["commit", "-q", "-m", message], { cwd: tmpDir, env: gitEnv });
    };
    gitCommit("seed.txt", "seed\n", "seed commit");
    gitCommit("y-a.txt", "CONTIGUOUS_A_CONTENT\n", `implements ${taskSlugs[0]}`);
    gitCommit("y-b.txt", "CONTIGUOUS_B_CONTENT\n", `implements ${taskSlugs[1]}`);

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode === 0).toBe(true);
    const capturedPrompt = readFileSync(captureFile, "utf8");
    expect(capturedPrompt).toContain("CONTIGUOUS_A_CONTENT");
    expect(capturedPrompt).toContain("CONTIGUOUS_B_CONTENT");

    // The naive "first task commit .. last task commit" range (today's pre-fix rule,
    // CLAUDE.md standing lesson) — contiguous here, so it AGREES with the derivation
    // (nothing foreign sits between them to disagree about).
    const naiveRange = spawnSync("git", ["log", "--format=%H", "--reverse"], { cwd: tmpDir, encoding: "utf8" })
      .stdout.trim()
      .split("\n");
    const firstOwn = naiveRange[1]; // index 0 is the seed commit
    const lastOwn = naiveRange[naiveRange.length - 1];
    const naiveDiff = spawnSync("git", ["diff", `${firstOwn}^..${lastOwn}`], { cwd: tmpDir, encoding: "utf8" }).stdout;
    expect(naiveDiff).toContain("CONTIGUOUS_A_CONTENT");
    expect(naiveDiff).toContain("CONTIGUOUS_B_CONTENT");
  }, 20000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 8 direct spawn calls — 1 `spawnSync` (git init) + 3
  // calls to the locally-defined `gitCommit` helper + the 2 `spawnSync` calls
  // textually inside that helper's own definition + 2 trailing direct
  // `spawnSync` calls (naive-range `git log`, naive-range `git diff`). Measured
  // 754-1059ms in isolation across 3 runs; 20000ms gives >=18x headroom for a
  // concurrent-worktree load spike.
});

// ─── BOUNDARY: no discoverable commits (zero-commit AND squashed-history alike) ──

describe("lore assess — auto-derived commit set: BOUNDARY (no discoverable commits)", () => {
  it("produces a loud, named outcome instead of a silent empty derived diff", async () => {
    const { planSlug } = await createPlanWithNamedTasks(["Unreferenced Task One", "Unreferenced Task Two"]);
    const captureFile = join(tmpDir, "captured-boundary-derive-prompt.txt");
    const scriptPath = writeFixedJsonProviderScript(captureFile);
    writeAiConfig(scriptPath);

    // Real git repo exists, but NO commit anywhere mentions either task's slug —
    // mechanically identical to "history was squashed and lost the references".
    const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "Tester", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "Tester", GIT_COMMITTER_EMAIL: "t@example.com" };
    spawnSync("git", ["init", "-q"], { cwd: tmpDir, env: gitEnv });
    writeFileSync(join(tmpDir, "unrelated.txt"), "unrelated\n");
    spawnSync("git", ["add", "unrelated.txt"], { cwd: tmpDir, env: gitEnv });
    spawnSync("git", ["commit", "-q", "-m", "a commit naming neither task"], { cwd: tmpDir, env: gitEnv });

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    // The run still succeeds (assess degrades to "no diff", same as never passing
    // --diff at all pre-fix) — it must NOT fail just because derivation found nothing.
    expect(lastExitCode === 0).toBe(true);

    const stderrText = output.stderr.join("");
    expect(stderrText).toContain(ASSESS_NO_COMMITS_DERIVED);

    const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const docsResult = await app.corpusService.listFull({ type: "knowledge" });
      expect(docsResult.ok).toBe(true);
      if (!docsResult.ok) return;
      const diffSource = docsResult.value.docs[0]?.extra["diff_source"] as
        | { mode: string; status?: string; tasks_without_commits?: string[] }
        | undefined;
      // Never a false green: status is the named "no_commits_found", not a silently
      // empty "derived".
      expect(diffSource?.mode).toBe("auto_derived");
      expect(diffSource?.status).toBe("no_commits_found");
      expect(diffSource?.tasks_without_commits).toHaveLength(2);
    } finally {
      app.close();
    }
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 3 direct `spawnSync` calls (git init, git add, git
  // commit). Measured 540-852ms in isolation across 3 runs; 15000ms gives >=17x
  // headroom for a concurrent-worktree load spike.
});

// ─── SPEC-028 AC-AE-1: pre-flight diff-budget stderr warning ─────────────────
//
// Write config.yaml pointing ai.provider at the fixed-JSON script (as HAPPY tests above
// do) but ALSO override ai.assess.max_diff_chars to a small number, so a diff of a known
// size can be pushed over/under the budget deterministically without needing a 24000+
// char fixture.

function writeAiConfigWithDiffBudget(command: string, maxDiffChars: number) {
  saveConfig(tmpDir, {
    project: { name: "assess-ai-test", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command, args: [], timeout_ms: 5000 } },
      templates: {},
      telemetry: false,
      assess: { max_diff_chars: maxDiffChars },
    },
  } as never);
}

describe("lore assess — SPEC-028 AC-AE-1: pre-flight diff-budget stderr warning", () => {
  it("warns on stderr when the diff exceeds ai.assess.max_diff_chars, and --json stdout stays a clean parseable envelope", async () => {
    const { planSlug } = await createPlanWithTask();
    const captureFile = join(tmpDir, "captured-warn-prompt.txt");
    const scriptPath = writeFixedJsonProviderScript(captureFile);
    const maxDiffChars = 50;
    writeAiConfigWithDiffBudget(scriptPath, maxDiffChars);

    const diffFile = join(tmpDir, "oversized.diff");
    const diffContent = `diff --git a/foo.ts b/foo.ts\n+++ b/foo.ts\n+${"x".repeat(100)}\n`;
    writeFileSync(diffFile, diffContent);
    expect(diffContent.length).toBeGreaterThan(maxDiffChars); // sanity: must exceed budget

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, "diff-file": diffFile, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    const stderrText = output.stderr.join("");
    expect(stderrText).toContain(`diff is ${diffContent.length} chars`);
    expect(stderrText).toContain(`budget of ${maxDiffChars}`);
    expect(stderrText).toContain("--diff-file");
    expect(stderrText).toContain("ai.assess.max_diff_chars");

    // --json stdout must remain a single clean JSON envelope — parse it to prove it, not
    // just eyeball a substring.
    const stdoutText = output.stdout.join("\n");
    const parsed = JSON.parse(stdoutText) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it("does NOT warn when the diff is within budget, and --json stdout is still clean JSON", async () => {
    const { planSlug } = await createPlanWithTask();
    const captureFile = join(tmpDir, "captured-nowarn-prompt.txt");
    const scriptPath = writeFixedJsonProviderScript(captureFile);
    const maxDiffChars = 1000;
    writeAiConfigWithDiffBudget(scriptPath, maxDiffChars);

    const diffFile = join(tmpDir, "small.diff");
    const diffContent = "diff --git a/foo.ts b/foo.ts\n+++ b/foo.ts\n+small change\n";
    writeFileSync(diffFile, diffContent);
    expect(diffContent.length).toBeLessThanOrEqual(maxDiffChars); // sanity: within budget

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, "diff-file": diffFile, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    const stderrText = output.stderr.join("");
    expect(stderrText).not.toContain("Warning: diff is");
    expect(stderrText).not.toContain("exceeding the configured");

    const stdoutText = output.stdout.join("\n");
    const parsed = JSON.parse(stdoutText) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });

  it("a diff exactly AT the budget (not over it) does not warn (strict > comparison, boundary)", async () => {
    const { planSlug } = await createPlanWithTask();
    const captureFile = join(tmpDir, "captured-boundary-prompt.txt");
    const scriptPath = writeFixedJsonProviderScript(captureFile);

    const diffFile = join(tmpDir, "boundary.diff");
    const diffContent = "diff --git a/foo.ts b/foo.ts\n+++ b/foo.ts\n+exact\n";
    writeFileSync(diffFile, diffContent);
    // Configure the budget to be EXACTLY diffContent.length — the CLI's check is a strict
    // `>`, so this must NOT warn.
    writeAiConfigWithDiffBudget(scriptPath, diffContent.length);

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, "diff-file": diffFile, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    const stderrText = output.stderr.join("");
    expect(stderrText).not.toContain("Warning: diff is");
  });
});

// ─── git-diff spawnSync maxBuffer (task-lore-assess-diff-spawnsync-sets-no-maxbuffer- ──
// ─── a-diff-over-1) ─────────────────────────────────────────────────────────────────
//
// `spawnSync("git", ["diff", args.diff], ...)` now sizes `maxBuffer` against the
// EFFECTIVE `ai.assess.max_diff_chars` (computeGitDiffMaxBuffer, 4 bytes/char worst-case
// UTF-8 — assess-render.ts) instead of Node's arbitrary 1 MiB default. These tests
// configure a SMALL `max_diff_chars` via `writeAiConfigWithDiffBudget` so a small, fast
// git fixture can drive a REAL ENOBUFS — no need to construct a >1 MiB diff.
//
// Six-dimension coverage:
//   ERROR:      a diff decisively larger than the buffer -> ENOBUFS; message names the
//               buffer size + ai.assess.max_diff_chars, NEVER "spawnSync ENOBUFS"/git
//   NEGATIVE:   a non-ENOBUFS git failure (no repository) still renders the PRE-EXISTING
//               generic "git diff <range> failed: <reason>" message, untouched by this fix
//   BOUNDARY:   a diff just UNDER the configured buffer succeeds; just OVER it ENOBUFS's
//               (buffer sized from the diff's OWN measured byte length, not guessed)
//   STATE:      the ENOBUFS early-return skips Step 6 — no knowledge doc is created
//   REGRESSION: covered by the pre-existing "real git subprocess fixture" HAPPY tests
//               above, unmodified — an ordinary small diff at the DEFAULT budget still
//               reaches the judge prompt exactly as before this fix

describe("lore assess --diff <range> — git-diff spawnSync maxBuffer (task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1)", () => {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Tester",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "Tester",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };

  function gitInit() {
    spawnSync("git", ["init", "-q"], { cwd: tmpDir, env: gitEnv });
  }
  function gitCommit(filename: string, content: string, message: string) {
    writeFileSync(join(tmpDir, filename), content);
    spawnSync("git", ["add", filename], { cwd: tmpDir, env: gitEnv });
    spawnSync("git", ["commit", "-q", "-m", message], { cwd: tmpDir, env: gitEnv });
  }
  /** Measures the EXACT byte length `git diff HEAD~1..HEAD` will produce in tmpDir. */
  function measureActualDiffBytes(): number {
    const probe = spawnSync("git", ["diff", "HEAD~1..HEAD"], { cwd: tmpDir, env: gitEnv, encoding: "utf8" });
    return Buffer.byteLength(probe.stdout, "utf8");
  }

  it("ERROR: a diff far exceeding the configured buffer triggers ENOBUFS — message names the buffer + knob, not git; no doc created (STATE)", async () => {
    const { planSlug } = await createPlanWithTask();
    const maxDiffChars = 50; // maxBuffer = 200 bytes
    writeAiConfigWithDiffBudget("/bin/true", maxDiffChars); // provider unreachable — ENOBUFS returns before Step 4/5

    gitInit();
    gitCommit("big.txt", "v1\n", "v1");
    gitCommit("big.txt", `v1\n${"X".repeat(5000)}\n`, "v2, huge change"); // decisively > 200 bytes

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, diff: "HEAD~1..HEAD", json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(2);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("200 bytes"); // names the buffer size (maxDiffChars * 4)
    expect(stderrText).toContain("ai.assess.max_diff_chars=50"); // names the knob + effective value
    expect(stderrText).toContain("not a git failure");
    expect(stderrText).not.toContain("spawnSync ENOBUFS"); // never the misleading pre-fix wording

    // STATE: the early ENOBUFS return skips Step 6 entirely — no knowledge doc lands.
    const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const docsResult = await app.corpusService.listFull({ type: "knowledge" });
      expect(docsResult.ok).toBe(true);
      if (!docsResult.ok) return;
      expect(docsResult.value.docs).toHaveLength(0);
    } finally {
      app.close();
    }
  }, 10000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 3 spawn-helper call(s) — `gitInit()` + 2x `gitCommit()`
  // (each itself 2 direct `spawnSync` calls, add + commit). ENOBUFS fires before the
  // AI provider is ever reached, so this is the LIGHTEST case in this describe block.
  // Measured 137-158ms in isolation across 3 runs; 10000ms gives >=63x headroom for a
  // concurrent-worktree load spike.

  it("NEGATIVE: a non-ENOBUFS git failure (no repository) still renders the pre-existing GENERIC message, untouched by the maxBuffer fix", async () => {
    const { planSlug } = await createPlanWithTask();
    // No git repo initialized in tmpDir at all — `git diff` exits nonzero with a plain
    // "fatal: not a git repository" — never touches maxBuffer/ENOBUFS.
    writeAiConfig("/bin/true");

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, diff: "HEAD~1..HEAD", json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(2);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain("git diff HEAD~1..HEAD failed:");
    expect(stderrText).not.toContain("ai.assess.max_diff_chars"); // generic path never names the knob
    expect(stderrText).not.toContain("buffer");
  });

  it("BOUNDARY: a diff just UNDER the configured buffer succeeds — no ENOBUFS, run reaches the AI provider", async () => {
    const { planSlug } = await createPlanWithTask();
    const captureFile = join(tmpDir, "captured-boundary-under-prompt.txt");
    const scriptPath = writeFixedJsonProviderScript(captureFile);

    gitInit();
    gitCommit("boundary-under.txt", "v1\n", "v1");
    gitCommit("boundary-under.txt", `v1\n${"y".repeat(300)}\n`, "v2");

    // Size the budget from the diff's OWN measured byte length (never a guessed constant
    // against git's header/hunk overhead) — buffer clears the actual size by >=100 bytes.
    // NOTE: this deliberately does NOT assert the marker survives into the captured judge
    // prompt — `ai.assess.max_diff_chars` ALSO drives the UNRELATED file-boundary prompt
    // truncation (`truncateDiffByFile`, tested separately above/in diff-truncation.test.ts)
    // over the exact same diffText.length, so a small buffer margin here can legitimately
    // still truncate the PROMPT even though spawnSync captured the FULL diff with no
    // ENOBUFS — that is the thing this test asserts, not the prompt's own truncation.
    const actualDiffBytes = measureActualDiffBytes();
    const maxDiffChars = Math.ceil((actualDiffBytes + 100) / 4);
    writeAiConfigWithDiffBudget(scriptPath, maxDiffChars);

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, diff: "HEAD~1..HEAD", json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode === 0).toBe(true);
    // Proof the run reached the AI provider (i.e. spawnSync fully captured the diff and
    // returned no ENOBUFS — an ENOBUFS early-return, Step 3, would never write this file).
    expect(existsSync(captureFile)).toBe(true);
    const stderrText = output.stderr.join("");
    expect(stderrText).not.toContain("bytes, sized from ai.assess.max_diff_chars");
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 4 spawn-helper call(s) — `gitInit()` + 2x `gitCommit()` +
  // `measureActualDiffBytes()` (itself 1 direct `spawnSync` probe of `git diff`). The
  // ONLY case in this block that succeeds through to a real AI-provider-script
  // invocation (the other three all early-return at Step 3 before reaching it), making
  // it the heaviest. Measured 588-816ms in isolation across 3 runs; 15000ms gives
  // >=18x headroom for a concurrent-worktree load spike.

  it("BOUNDARY: a diff just OVER the configured buffer ENOBUFS's — message names the buffer, not git", async () => {
    const { planSlug } = await createPlanWithTask();

    gitInit();
    gitCommit("boundary-over.txt", "v1\n", "v1");
    gitCommit("boundary-over.txt", `v1\n${"z".repeat(400)}\n`, "v2");

    // Size the budget from the diff's OWN measured byte length — buffer sits >=100 bytes
    // BELOW the actual size, so ENOBUFS fires with clear margin (never a razor-tight guess).
    const actualDiffBytes = measureActualDiffBytes();
    const maxDiffChars = Math.floor((actualDiffBytes - 100) / 4);
    writeAiConfigWithDiffBudget("/bin/true", maxDiffChars);

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, diff: "HEAD~1..HEAD", json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(2);
    const stderrText = output.stderr.join("");
    expect(stderrText).toContain(`ai.assess.max_diff_chars=${maxDiffChars}`);
    expect(stderrText).not.toContain("spawnSync ENOBUFS");
  }, 10000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 4 spawn-helper call(s) — `gitInit()` + 2x `gitCommit()` +
  // `measureActualDiffBytes()`. ENOBUFS fires before the AI provider is ever reached
  // (provider unreachable, `/bin/true`), same shape as the ERROR case above despite
  // one extra spawn-helper call for the byte-length probe. Measured 112-138ms in
  // isolation across 3 runs; 10000ms gives >=72x headroom for a concurrent-worktree
  // load spike.
});

// ─── ERROR: double-malformed provider output → exit 6, no doc created (AC-ASSESS-4) ─

describe("lore assess — double-malformed AI output end-to-end (AC-ASSESS-4)", () => {
  it("exits 6 with AI_PROVIDER_ERROR and creates NO knowledge doc", async () => {
    const { planSlug } = await createPlanWithTask();
    const scriptPath = writeMalformedProviderScript();
    writeAiConfig(scriptPath);

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(6);

    const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const docsResult = await app.corpusService.listFull({ type: "knowledge" });
      expect(docsResult.ok).toBe(true);
      if (!docsResult.ok) return;
      expect(docsResult.value.docs).toHaveLength(0);
    } finally {
      app.close();
    }
  });

  // ─── SPEC-029 AC-AR-5: real CLI stderr never suggests --no-ai for assess ────
  //
  // This is the most important end-to-end proof for AC-AR-5: it exercises formatError
  // through the REAL assess command's failure branch (assess.ts calls
  // formatError(assessResult.error, { aiHasNoFallback: true })) and inspects the actual
  // process.stderr bytes, not just a unit-level formatError() call in isolation.
  it("stderr does NOT contain '--no-ai' and DOES contain assess-specific recovery guidance", async () => {
    const { planSlug } = await createPlanWithTask();
    const scriptPath = writeMalformedProviderScript();
    writeAiConfig(scriptPath);

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      lastExitCode = await runHandlerForExit(() => cmd.run({ args: { plan: planSlug, json: true }, inv: liveInvocation() }));
    } finally {
      output.restore();
    }

    expect(lastExitCode).toBe(6);

    const stderrText = output.stderr.join("");
    expect(stderrText).not.toContain("--no-ai");
    // Pinned against utils.ts's actual aiHasNoFallback wording — retry guidance, a
    // pointer to the ai.provider config / provider binary, and the raw output already
    // embedded in the message above.
    expect(stderrText).toContain("no non-AI fallback");
    expect(stderrText).toContain("Retry the command");
    expect(stderrText.toLowerCase()).toContain("ai.provider");
  });
});
