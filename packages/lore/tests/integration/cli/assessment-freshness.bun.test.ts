// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * SPEC-106 (AC-FRESH-4) — `lore assess`'s non-blocking staleness advisory, exercised
 * end-to-end against the COMPILED `dist/lore` binary (`Bun.spawnSync`) over a
 * THROWAWAY corpus created via `mkdtemp(os.tmpdir())` — genuinely outside this repo's
 * own working tree, never touching the repo's own `.lore/` corpus (project CLAUDE.md
 * hard rule). Requires `bun run build` to have run first — `assertFreshBinary` fails
 * loud before any test runs otherwise. Mirrors `tiered-review-gate.bun.test.ts`'s
 * spawn-the-real-binary harness shape.
 *
 * The "AI provider" is a hermetic fixed-JSON-emitting shell script (the SAME idiom
 * `assess-ai.bun.test.ts` documents at length: `ClaudeCliProvider` spawns ANY
 * configured command and pipes the prompt to its stdin, so a fixed shell script is a
 * legitimate, deterministic "AI provider" for exercising `lore assess`'s post-AI CLI
 * path without a real LLM call).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a first `lore assess` on a plan with no prior assessment succeeds
 *               with NO staleness warning (nothing to be stale relative to yet)
 *   STATE:      after real task-evidence activity (`lore evidence`, a genuine
 *               `action: "evidence"` AUDIT row) postdates that first assessment, a
 *               SECOND `lore assess` run prints the loud staleness advisory
 *   REGRESSION: the second run still exits 0 and creates a second knowledge doc
 *               (sub_type=assessment) — `lore assess` NEVER refuses (D3), it always
 *               produces and saves a fresh assessment even when advising staleness
 *   BOUNDARY:   the advisory names BOTH timestamps it compared, not just a bare
 *               "stale" claim, so an operator can verify the comparison itself
 *
 * @spec_ref SPEC-106 §Acceptance Criteria AC-FRESH-4
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { saveConfig } from "@lore/core/node";
import { ASSESS_NEWER_TASK_ACTIVITY } from "../../../src/adapters/cli/cli-refusal-messages.js";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ -> packages/ -> repo root (5 up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the compiled `dist/lore` binary with `cwd` as its working directory. */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

interface JsonEnvelope<T> {
  ok: boolean;
  data: T;
}

interface DocEnvelope {
  id: string;
  slug: string;
  version: number;
  status: string;
}

async function initCorpus(dir: string): Promise<void> {
  const result = await runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

/** A hermetic fixed-JSON "AI provider" — tees stdin (the rendered prompt) to `captureFile`
 *  then emits a FIXED valid judge JSON on stdout, ignoring the actual prompt content. */
const VALID_JUDGE_JSON = JSON.stringify({
  verdict: "met",
  overall_score: 90,
  ac_scores: [],
  gaps: [],
  recommendations: ["Nothing further."],
});

function writeFixedJsonProviderScript(dir: string, captureFile: string): string {
  const scriptPath = join(dir, "fake-ai-provider.sh");
  writeFileSync(
    scriptPath,
    `#!/bin/sh\ncat > "${captureFile}"\ncat <<'JSONEOF'\n${VALID_JUDGE_JSON}\nJSONEOF\n`,
    { mode: 0o755 },
  );
  return scriptPath;
}

function writeAiConfig(dir: string, command: string): void {
  const result = saveConfig(dir, {
    project: { name: "assess-freshness-cli-test", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command, args: [], timeout_ms: 5000 } },
      templates: {},
      telemetry: false,
    },
  } as never);
  if (!result.ok) {
    throw new Error(`saveConfig failed: ${JSON.stringify(result.error)}`);
  }
}

async function createPlan(dir: string): Promise<DocEnvelope> {
  const result = await runLore(
    ["create", "plan", "--title", "Freshness CLI Plan", "--content", "## Plan\n\nbody", "--json"],
    dir,
  );
  if (result.exitCode !== 0) {
    throw new Error(`lore create plan failed: ${result.stderr}`);
  }
  return (JSON.parse(result.stdout) as JsonEnvelope<DocEnvelope>).data;
}

async function createTask(dir: string, planSlug: string): Promise<DocEnvelope> {
  const result = await runLore(
    [
      "create",
      "task",
      "--title",
      "Freshness CLI Task",
      "--plan-id",
      planSlug,
      "--content",
      "## Task\n\nbody",
      "--json",
    ],
    dir,
  );
  if (result.exitCode !== 0) {
    throw new Error(`lore create task failed: ${result.stderr}`);
  }
  return (JSON.parse(result.stdout) as JsonEnvelope<DocEnvelope>).data;
}

/**
 * Counts `knowledge`-type docs in the corpus. `lore list --json`'s summary shape omits
 * `extra` (confirmed against the real CLI output — it carries only id/slug/type/title/
 * status/updated_at/tags/priority/meta), so this cannot filter on `sub_type ===
 * "assessment"` directly; every fixture in this file creates `knowledge` docs
 * EXCLUSIVELY via `lore assess`, so a plain `knowledge`-type count is equivalent here.
 */
async function countAssessmentDocs(dir: string): Promise<number> {
  const result = await runLore(["list", "--type", "knowledge", "--json"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore list failed: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout) as JsonEnvelope<{ docs: unknown[] }>;
  return parsed.data.docs.length;
}

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("lore assess — AC-FRESH-4: non-blocking staleness advisory", () => {
  it("AC-FRESH-4: HAPPY — a first assess on a never-assessed plan succeeds with no staleness warning", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-assess-freshness-"));
    await initCorpus(tmpDir);
    const captureFile = join(tmpDir, "captured-prompt-1.txt");
    const scriptPath = writeFixedJsonProviderScript(tmpDir, captureFile);
    writeAiConfig(tmpDir, scriptPath);

    const plan = await createPlan(tmpDir);
    await createTask(tmpDir, plan.slug);

    const result = await runLore(["assess", plan.slug, "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("is already stale");
    expect(await countAssessmentDocs(tmpDir)).toBe(1);
  });

  it("AC-FRESH-4: STATE/REGRESSION — a second assess after newer task activity warns loudly, names both timestamps, and STILL writes a fresh assessment (never refuses)", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-assess-freshness-"));
    await initCorpus(tmpDir);

    const scriptPath = writeFixedJsonProviderScript(tmpDir, join(tmpDir, "captured-prompt-a.txt"));
    writeAiConfig(tmpDir, scriptPath);

    const plan = await createPlan(tmpDir);
    const task = await createTask(tmpDir, plan.slug);

    // First assessment — nothing to be stale relative to yet.
    const first = await runLore(["assess", plan.slug, "--json"], tmpDir);
    expect(first.exitCode).toBe(0);
    expect(await countAssessmentDocs(tmpDir)).toBe(1);

    // Real task-evidence activity AFTER the first assessment — a genuine
    // `action: "evidence"` audit row (D2), via the real `lore evidence` write path.
    // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
    // predicate-to-its-own) — "test" self-report is now refused regardless of
    // tail content; "manual" is the one oracle that still lets a genuinely
    // non-empty self-reported tail succeed. This test only needs a genuine
    // audit row to land AFTER the first assessment, not a specific oracle
    // kind.
    const evidence = await runLore(
      ["evidence", task.slug, "--oracle", "manual", "--command", "true", "--result", "pass", "--output-tail", "ok", "--json"],
      tmpDir,
    );
    expect(evidence.exitCode).toBe(0);

    // Second assessment — the stored (first) assessment is now stale relative to the
    // evidence activity that landed after it.
    const second = await runLore(["assess", plan.slug, "--json"], tmpDir);

    // REGRESSION (D3) — never refuses; still exits 0 and writes a fresh assessment.
    expect(second.exitCode).toBe(0);
    expect(await countAssessmentDocs(tmpDir)).toBe(2);

    // BOUNDARY — the advisory is loud and names the concrete comparison, not just a
    // bare "stale" claim.
    expect(second.stderr).toContain(`the stored assessment for '${plan.slug}'`);
    expect(second.stderr).toContain("is already stale");
    expect(second.stderr).toContain(ASSESS_NEWER_TASK_ACTIVITY);
    expect(second.stderr).toContain("lore assess` never refuses");

    // --json stdout stays a clean parseable envelope even with the stderr advisory.
    const parsed = JSON.parse(second.stdout) as { ok: boolean };
    expect(parsed.ok).toBe(true);
  });
});
