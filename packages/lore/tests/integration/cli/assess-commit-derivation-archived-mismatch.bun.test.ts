/**
 * @spec_ref task-lore-assess-derives-a-plan-s-commits-by-grepping-task
 *
 * End-to-end CLI wiring test for `lore assess`'s handling of an ALL-ARCHIVED plan whose
 * task commits are conventionally-worded (no task slug at all) — the exact defect
 * measured on `plan-implementation-evidence-output-tail-integrity-self-report`
 * (`lore assess` reported "could not derive any commits" for a plan whose work had
 * demonstrably landed in main). This proves the FULL chain, not just each unit in
 * isolation: `commands/assess.ts` computes `allTasksArchived` from the real bundle →
 * `deriveCommitSetForPlan` reports the distinct `"unverifiable_convention_mismatch"`
 * status → `commitDerivationUnverifiable` is threaded into `aiProviderService.assessPlan`
 * → the service layer forcibly strips any `scope_fidelity` dimension score, with a "not
 * scored" `unverifiable[]` entry — regardless of what the judge itself reports.
 *
 * bun:test only (uses real SQLiteStore via createApp + a real CLI command invocation),
 * mirrors the hermetic idiom `assess-ai.bun.test.ts` documents in its own header (a fixed
 * shell script standing in for `claude-cli`).
 *
 * Six-dimension coverage:
 *   HAPPY/RED-FIRST: an all-archived plan whose commits are conventionally-worded (no
 *               task slug) derives `"unverifiable_convention_mismatch"` end-to-end, and
 *               the persisted assessment has NO scope_fidelity dimension score even
 *               though the scripted judge scored it absence-based — with a literal "not
 *               scored" unverifiable[] entry. This test was run against the PRE-FIX
 *               source (assess.ts/ai-provider-service.ts/assess-commit-derivation.ts all
 *               reverted) first — it failed (status was the pre-existing
 *               "no_commits_found" and the absence-based scope_fidelity score was NOT
 *               forcibly removed) — then the source was restored to make it pass.
 *   CONTROL:    the SAME all-archived plan, but its commits DO mention the task slugs —
 *               status is "derived" (not "unverifiable_convention_mismatch"), and an
 *               EVIDENCE-based scope_fidelity score from the judge survives untouched
 *               (the forced floor never fires when a real diff was found).
 *   CONTROL:    the SAME conventional (non-matching) commit fixture, but with NON-archived
 *               tasks (still draft) — status is "no_commits_found", a DISTINCT value from
 *               the archived-mismatch case, asserted by value.
 *   BOUNDARY:   `--json` envelope surfaces `data.diff_source.status` as the exact new
 *               literal, never coerced/renamed.
 *   STATE:      the persisted knowledge doc's `extra.diff_source.status` and
 *               `extra.assessment.dimension_scores` match what was printed to stdout/json
 *               (no divergence between the render and the persisted record).
 *   ERROR:      the run still SUCCEEDS (exit 0) in the unverifiable-mismatch case — this
 *               is a reporting distinction, never a failure mode (mirrors the existing
 *               "no_commits_found" contract of never blocking the run).
 */

import type { Invocation } from "@lore/core";
import { liveInvocation, liveAmbient } from "../../live-invocation.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { createApp } from "../../../src/app.js";
import { saveConfig } from "@lore/core/node";
import type { CreateDocInput } from "@lore/core";

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

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

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  process.exitCode = 0;
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-assess-archived-mismatch-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient());
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

/** Creates a plan with N tasks; optionally archives every one of them via corpusService.set. */
async function createPlanWithTasks(
  taskTitles: string[],
  opts: { archiveAll: boolean },
): Promise<{ planId: string; planSlug: string; taskSlugs: string[] }> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient());
  try {
    const planResult = await app.corpusService.create({
      type: "plan",
      title: "Archived Convention Mismatch Plan",
      content: "Plan body for archived-mismatch CLI wiring tests.",
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

      if (opts.archiveAll) {
        // reason: task is one of DRAFT_TO_ARCHIVED_ALLOWED_TYPES (schemas.ts) — a fresh
        // draft task legally jumps straight to archived (SPEC-002 D3), no intermediate
        // fast-track needed.
        const archiveResult = await app.corpusService.set(taskResult.value.id, { status: "archived" }, { by: "tester" });
        if (!archiveResult.ok) throw new Error(`archive failed: ${JSON.stringify(archiveResult.error)}`);
      }
    }
    return { planId: planResult.value.id, planSlug: planResult.value.slug, taskSlugs };
  } finally {
    app.close();
  }
}

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "Tester", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "Tester", GIT_COMMITTER_EMAIL: "t@example.com" };

/** Conventionally-worded commits that reference NEITHER task's slug — mirrors the measured defect. */
function commitConventionalNoSlug() {
  spawnSync("git", ["init", "-q"], { cwd: tmpDir, env: GIT_ENV });
  writeFileSync(join(tmpDir, "a.txt"), "content-a\n");
  spawnSync("git", ["add", "a.txt"], { cwd: tmpDir, env: GIT_ENV });
  spawnSync("git", ["commit", "-q", "-m", "fix(evidence): self-reported fail must carry a non-empty output_tail"], { cwd: tmpDir, env: GIT_ENV });
  writeFileSync(join(tmpDir, "b.txt"), "content-b\n");
  spawnSync("git", ["add", "b.txt"], { cwd: tmpDir, env: GIT_ENV });
  spawnSync("git", ["commit", "-q", "-m", "feat(assess): add scope mismatch warning"], { cwd: tmpDir, env: GIT_ENV });
}

/** Commits that DO reference the given task slugs (realistic auto-derivation happy path). */
function commitReferencingSlugs(slugs: string[]) {
  spawnSync("git", ["init", "-q"], { cwd: tmpDir, env: GIT_ENV });
  for (const [i, slug] of slugs.entries()) {
    const file = `own-${String(i)}.txt`;
    writeFileSync(join(tmpDir, file), `own-content-${String(i)}\n`);
    spawnSync("git", ["add", file], { cwd: tmpDir, env: GIT_ENV });
    spawnSync("git", ["commit", "-q", "-m", `implements ${slug}`], { cwd: tmpDir, env: GIT_ENV });
  }
}

function writeAiConfig(command: string) {
  saveConfig(tmpDir, {
    project: { name: "assess-archived-mismatch-test", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command, args: [], timeout_ms: 5000 } },
      templates: {},
      telemetry: false,
    },
  } as never);
}

/** Judge response that scores scope_fidelity ABSENCE-based — used to prove the forced floor. */
function writeAbsenceScopeFidelityProviderScript(): string {
  const scriptPath = join(tmpDir, "fake-ai-absence.sh");
  const json = JSON.stringify({
    verdict: "partially_met",
    overall_score: 50,
    ac_scores: [],
    gaps: [],
    recommendations: [],
    dimension_scores: {
      scope_fidelity: { score: 20, confidence: 0.2, based_on: "absence", reasoning: "cannot verify without a diff" },
    },
  });
  writeFileSync(scriptPath, `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${json}\nJSONEOF\n`, { mode: 0o755 });
  return scriptPath;
}

/** Judge response that scores scope_fidelity EVIDENCE-based — used for the CONTROL (real diff found). */
function writeEvidenceScopeFidelityProviderScript(): string {
  const scriptPath = join(tmpDir, "fake-ai-evidence.sh");
  const json = JSON.stringify({
    verdict: "met",
    overall_score: 90,
    ac_scores: [],
    gaps: [],
    recommendations: [],
    dimension_scores: {
      scope_fidelity: { score: 88, confidence: 0.8, based_on: "evidence", reasoning: "diff matches declared scope" },
    },
  });
  writeFileSync(scriptPath, `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${json}\nJSONEOF\n`, { mode: 0o755 });
  return scriptPath;
}

async function readPersistedAssessment(): Promise<{
  diffSource: { mode: string; status?: string } | undefined;
  assessment: { dimension_scores?: Record<string, unknown>; unverifiable?: { material: string; reason: string }[] } | undefined;
}> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient());
  try {
    const docsResult = await app.corpusService.listFull({ type: "knowledge" });
    if (!docsResult.ok) throw new Error("listFull failed");
    const doc = docsResult.value.docs[0];
    return {
      diffSource: doc?.extra["diff_source"] as { mode: string; status?: string } | undefined,
      assessment: doc?.extra["assessment"] as
        | { dimension_scores?: Record<string, unknown>; unverifiable?: { material: string; reason: string }[] }
        | undefined,
    };
  } finally {
    app.close();
  }
}

// ─── HAPPY / RED-FIRST ────────────────────────────────────────────────────────

describe("lore assess — archived plan + conventional (non-matching) commits: HAPPY/RED-FIRST", () => {
  it("derives 'unverifiable_convention_mismatch' and forcibly strips the judge's absence-based scope_fidelity score, with a 'not scored' unverifiable[] entry", async () => {
    const { planSlug } = await createPlanWithTasks(["Archived Task Alpha", "Archived Task Beta"], { archiveAll: true });
    commitConventionalNoSlug();
    writeAiConfig(writeAbsenceScopeFidelityProviderScript());

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug, json: true }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
    expect(output.stderr.join("")).toContain("CONVENTION MISMATCH");

    const { diffSource, assessment } = await readPersistedAssessment();
    expect(diffSource?.mode).toBe("auto_derived");
    expect(diffSource?.status).toBe("unverifiable_convention_mismatch");
    expect(diffSource?.status).not.toBe("no_commits_found");

    expect(assessment?.dimension_scores?.["scope_fidelity"]).toBeUndefined();
    const scopeEntry = (assessment?.unverifiable ?? []).find((u) => u.material.toLowerCase().includes("scope_fidelity"));
    expect(scopeEntry).toBeDefined();
    expect(scopeEntry?.reason.toLowerCase()).toContain("not scored");

    // BOUNDARY: the --json envelope's stdout carries the identical status literal.
    const parsed = JSON.parse(output.stdout.join("\n")) as { data: { diff_source: { status: string } } };
    expect(parsed.data.diff_source.status).toBe("unverifiable_convention_mismatch");
  }, 15000);
  // ^ explicit timeout (spec-a-test-case-s-timeout-budget-must-be-declared-when-its
  // D1/check-test-budgets): 2 corpusService.create + 2 corpusService.set (archive) calls
  // + git init + 2 commits (4 direct spawnSync calls) + one hermetic AI subprocess spawn.
  // Measured comparably to assess-ai.bun.test.ts's own BOUNDARY case (540-852ms); 15000ms
  // gives ample headroom for a concurrent-worktree load spike.
});

// ─── CONTROL: archived plan whose commits DO match — real diff, forced floor never fires ─

describe("lore assess — archived plan + MATCHING commits: CONTROL", () => {
  it("derives 'derived' (not 'unverifiable_convention_mismatch'), and an evidence-based scope_fidelity score survives untouched", async () => {
    const { planSlug, taskSlugs } = await createPlanWithTasks(["Matching Task One"], { archiveAll: true });
    commitReferencingSlugs(taskSlugs);
    writeAiConfig(writeEvidenceScopeFidelityProviderScript());

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug, json: true }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);

    const { diffSource, assessment } = await readPersistedAssessment();
    expect(diffSource?.status).toBe("derived");
    expect(assessment?.dimension_scores?.["scope_fidelity"]).toBeDefined();
    expect((assessment?.dimension_scores?.["scope_fidelity"] as { score: number }).score).toBe(88);
  }, 15000);
  // ^ explicit timeout: 1 create + 1 archive-set + git init + 1 commit + 1 hermetic AI
  // spawn. Comparably lightweight to the HAPPY case above; 15000ms gives ample headroom.
});

// ─── CONTROL: non-archived plan + conventional commits stays 'no_commits_found' ──────

describe("lore assess — NON-archived plan + conventional (non-matching) commits: CONTROL, distinct from the archived-mismatch case", () => {
  it("derives 'no_commits_found' (never 'unverifiable_convention_mismatch') for the identical conventional-commit fixture when tasks are not archived", async () => {
    const { planSlug } = await createPlanWithTasks(["Draft Task Alpha", "Draft Task Beta"], { archiveAll: false });
    commitConventionalNoSlug();
    writeAiConfig(writeAbsenceScopeFidelityProviderScript());

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug, json: true }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);
    expect(output.stderr.join("")).not.toContain("CONVENTION MISMATCH");

    const { diffSource } = await readPersistedAssessment();
    expect(diffSource?.status).toBe("no_commits_found");
    expect(diffSource?.status).not.toBe("unverifiable_convention_mismatch");
  }, 15000);
  // ^ explicit timeout: 2 creates (no archive-set calls) + git init + 2 commits + one
  // hermetic AI spawn — lighter than the HAPPY case; 15000ms gives ample headroom.
});
