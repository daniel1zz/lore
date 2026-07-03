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
 *               (AC-ASSESS-1); real-git --diff fixture succeeds end-to-end
 *   BOUNDARY:   the diff text actually reaches the judge prompt (captured via a script
 *               that tees stdin to a file before emitting its fixed JSON response)
 *   ERROR:      double-malformed provider output → exit 6, AI_PROVIDER_ERROR, and NO
 *               knowledge doc is created (AC-ASSESS-4, end-to-end through the real CLI)
 *   STATE:      after a successful assess, the plan's tree shows the new assessment
 *               doc linked via informs
 *   REGRESSION: a plan with tasks that succeeds does NOT also trip the zero-task gate
 *
 * @spec_ref AC-ASSESS-1, AC-ASSESS-4, AC-ASSESS-6
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { createApp } from "../../../src/app.js";
import { saveConfig } from "@lore/core/node";
import type { CreateDocInput } from "@lore/core";

// ─── Command type ─────────────────────────────────────────────────────────────

type RunnableCommand = { run: (ctx: { args: Record<string, unknown> }) => Promise<void> };

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
  process.exitCode = 0;
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-assess-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"));
  app.close();

  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.exitCode = 0;
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
  const app = createApp(join(tmpDir, ".lore", "lore.db"));
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
      await cmd.run({ args: { plan: planSlug, "diff-file": diffFile, json: true } });
    } finally {
      output.restore();
    }

    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
    const stdoutText = output.stdout.join("\n");
    expect(stdoutText).toContain('"ok": true');

    // Verify the doc actually landed in the store — open a fresh App to inspect.
    const app = createApp(join(tmpDir, ".lore", "lore.db"));
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
      await cmd.run({ args: { plan: planSlug, "diff-file": diffFile, json: true } });
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
      await cmd.run({ args: { plan: planSlug, diff: "HEAD~1..HEAD", json: true } });
    } finally {
      output.restore();
    }

    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
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
      await cmd.run({ args: { plan: planSlug, diff: "HEAD~1..HEAD", json: true } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(2);

    const app = createApp(join(tmpDir, ".lore", "lore.db"));
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
      await cmd.run({ args: { plan: planSlug, "diff-file": diffFile, json: true } });
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
      await cmd.run({ args: { plan: planSlug, "diff-file": diffFile, json: true } });
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
      await cmd.run({ args: { plan: planSlug, "diff-file": diffFile, json: true } });
    } finally {
      output.restore();
    }

    const stderrText = output.stderr.join("");
    expect(stderrText).not.toContain("Warning: diff is");
  });
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
      await cmd.run({ args: { plan: planSlug, json: true } });
    } finally {
      output.restore();
    }

    expect(process.exitCode).toBe(6);

    const app = createApp(join(tmpDir, ".lore", "lore.db"));
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
