/**
 * task-getassesstemplatereproducibility-has-zero-production-callers — PRIMARY ORACLE.
 *
 * `getAssessTemplateReproducibility` shipped as a62a0dd's registry field / schema field /
 * three-render-site machinery but had ZERO production callers: `_finalizeAssessment`'s
 * `judgment: {...}` object literal never wrote it, so every REAL `lore assess` run
 * persisted a judgment with `reproducible` absent, and the presence-guarded renderers
 * (deliberately built to preserve legacy byte-identity) emitted nothing. a62a0dd's own
 * tests never caught this because every one of them constructs a `Judgment`/`AssessmentResult`
 * object DIRECTLY and hands it to the renderer or the schema — none drives assessPlan
 * end-to-end. This file closes that gap with the oracle the task explicitly demands: a
 * REAL `lore assess` CLI run (same command module, same real SQLiteStore, same hermetic
 * "AI provider" idiom `assess-ai.bun.test.ts` already established) against a throwaway
 * corpus, reading `extra.assessment.judgment.reproducible` back out of the PERSISTED
 * document — never a unit test over `_finalizeAssessment` in isolation.
 *
 * bun:test only — real SQLiteStore via createApp (mirrors assess-ai.bun.test.ts).
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      a real assess run stamps judgment.reproducible === true, matching
 *               getAssessTemplateReproducibility(ASSESS_PROMPT_VERSION)'s registry
 *               declaration for the SAME ASSESS_PROMPT_VERSION stamped as
 *               judgment.prompt_version — the two fields read the identical registry slot,
 *               never independently derived (the slot number itself has moved twice since
 *               this file was authored — 6 → 7 → 8 — precisely because neither assertion
 *               below restates it as a literal)
 *   STATE:      the field lands in the PERSISTED doc (re-opened via a fresh createApp),
 *               not just in the in-process return value
 *   REGRESSION: a pre-existing ("legacy") assessment doc — one never touched by
 *               _finalizeAssessment, constructed with a schema-valid literal that omits
 *               `reproducible` entirely — still reads back `undefined` (never coerced to
 *               `true`/`false`) and its rendered Markdown carries no "Reproducible:" line,
 *               byte-identical to pre-existing rendering (CONTROL, task AC #4)
 *   BOUNDARY:   the corrective-retry success path (first response malformed, second
 *               valid) ALSO stamps reproducible — the field is threaded through BOTH
 *               `_finalizeAssessment` call sites, not just the single-attempt one
 *
 * @spec_ref task-getassesstemplatereproducibility-has-zero-production-callers
 */

import type { Invocation } from "@lore/core";
import { liveInvocation, liveAmbient, liveWriteContext } from "../../live-invocation.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import { saveConfig } from "@lore/core/node";
import { renderAssessmentContent, type AssessmentResult } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { ASSESS_PROMPT_VERSION } from "../../../src/ai/assess-template.js";

// ─── Command type / output capture (mirrors assess-ai.bun.test.ts) ────────────

type RunnableCommand = { run: (ctx: { args: Record<string, unknown>; inv?: Invocation }) => Promise<void> };

function captureOutput() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  const origConsoleLog = process.stdout.write;

  (process.stderr as unknown as { write: (chunk: unknown) => boolean }).write = (chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  };
  process.stdout.write = (((chunk: unknown) => {
    const args: unknown[] = [String(chunk).replace(/\n$/, "")];
    stdout.push(args.join(" "));
  
    return true;
  }) as typeof process.stdout.write);

  return {
    stdout,
    stderr,
    restore: () => {
      (process.stderr as unknown as { write: typeof origStderrWrite }).write = origStderrWrite;
      process.stdout.write = origConsoleLog;
    },
  };
}

async function importAssessCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/assess.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("assess command not exported");
  return cmd as RunnableCommand;
}

// ─── Throwaway corpus setup (mkdtemp — NEVER this repo's own .lore/) ─────────

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  process.exitCode = 0;
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-assess-reproducible-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });

  const app = createApp(join(loreDir, "lore.db"), undefined, liveAmbient(), liveWriteContext());
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
  const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const planResult = await app.corpusService.create({
      type: "plan",
      title: "Reproducible Stamp Plan",
      content: "Plan body for reproducible-stamp CLI tests.",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error(`plan create failed: ${JSON.stringify(planResult.error)}`);
    const taskResult = await app.corpusService.create({
      type: "task",
      title: "Reproducible Stamp Task",
      parent_id: planResult.value.id,
      content: "Task body.",
      extra: {
        plan_id: planResult.value.id,
        verification_evidence: [
          {
            oracle: "tsc",
            command: "bun run typecheck",
            result: "pass",
            recorded_at: "2026-07-01T00:00:00.000Z",
            recorded_by: "alice",
          },
        ],
      },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error(`task create failed: ${JSON.stringify(taskResult.error)}`);
    return { planId: planResult.value.id, planSlug: planResult.value.slug };
  } finally {
    app.close();
  }
}

/** Write config.yaml pointing ai.provider at the given shell command (hermetic idiom). */
function writeAiConfig(command: string, args: string[] = []) {
  saveConfig(tmpDir, {
    project: { name: "assess-reproducible-test", author: "tester" },
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
  ac_scores: [],
  gaps: [],
  recommendations: ["Nothing further."],
});

const MALFORMED_JSON = "not valid json at all, please retry";

/** Fixed-JSON hermetic provider — always succeeds on the first attempt. */
function writeFixedJsonProviderScript(): string {
  const scriptPath = join(tmpDir, "fake-ai-provider.sh");
  writeFileSync(scriptPath, `#!/bin/sh\ncat > /dev/null\ncat <<'JSONEOF'\n${VALID_JSON}\nJSONEOF\n`, { mode: 0o755 });
  return scriptPath;
}

/**
 * Hermetic provider that emits malformed JSON on its FIRST invocation and valid JSON on
 * every subsequent one — drives the corrective-retry success path (BOUNDARY dimension).
 * Uses a marker file (created after the first call) to distinguish attempt 1 from 2+.
 */
function writeRetrySucceedsProviderScript(): string {
  const markerPath = join(tmpDir, "retry-marker");
  const scriptPath = join(tmpDir, "fake-ai-retry-provider.sh");
  writeFileSync(
    scriptPath,
    `#!/bin/sh\ncat > /dev/null\nif [ -f "${markerPath}" ]; then\n  cat <<'JSONEOF'\n${VALID_JSON}\nJSONEOF\nelse\n  touch "${markerPath}"\n  echo '${MALFORMED_JSON}'\nfi\n`,
    { mode: 0o755 },
  );
  return scriptPath;
}

// ─── HAPPY / STATE: a real assess run stamps judgment.reproducible ──────────

describe("lore assess — judgment.reproducible is stamped by a REAL run (task-getassesstemplatereproducibility-has-zero-production-callers)", () => {
  it("persists judgment.reproducible === true, matching getAssessTemplateReproducibility's declaration for the SAME prompt_version (7) actually stamped", async () => {
    const { planSlug } = await createPlanWithTask();
    const scriptPath = writeFixedJsonProviderScript();
    writeAiConfig(scriptPath);

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug, json: true }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);

    // Re-open the store fresh — proves the field is PERSISTED, not just present on the
    // in-process return value (STATE dimension).
    const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const docsResult = await app.corpusService.listFull({ type: "knowledge" });
      expect(docsResult.ok).toBe(true);
      if (!docsResult.ok) return;
      expect(docsResult.value.docs).toHaveLength(1);

      const assessment = docsResult.value.docs[0]?.extra["assessment"] as AssessmentResult | undefined;
      expect(assessment).toBeDefined();
      if (assessment === undefined) return;

      // Never derived from two different sources: prompt_version and reproducible must
      // agree on the SAME registry slot (ASSESS_PROMPT_VERSION → reproducible: true, per
      // assess-template.ts's ASSESS_TEMPLATE_REGISTRY) — read from the live export, never a
      // restated literal, so a future re-key (like D1's own 7→8 bump) cannot silently drift.
      expect(assessment.judgment.prompt_version).toBe(ASSESS_PROMPT_VERSION);
      expect(assessment.judgment.reproducible).toBe(true);
    } finally {
      app.close();
    }
  });

  it("BOUNDARY: the corrective-retry success path (first malformed, second valid) also stamps reproducible === true", async () => {
    const { planSlug } = await createPlanWithTask();
    const scriptPath = writeRetrySucceedsProviderScript();
    writeAiConfig(scriptPath);

    const cmd = await importAssessCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { plan: planSlug, json: true }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(process.exitCode === 0 || process.exitCode === undefined).toBe(true);

    const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const docsResult = await app.corpusService.listFull({ type: "knowledge" });
      expect(docsResult.ok).toBe(true);
      if (!docsResult.ok) return;
      expect(docsResult.value.docs).toHaveLength(1);

      const assessment = docsResult.value.docs[0]?.extra["assessment"] as AssessmentResult | undefined;
      expect(assessment).toBeDefined();
      if (assessment === undefined) return;

      // Sanity: this really did take the retry path (proves the fixture drove the
      // SECOND _finalizeAssessment call site, not the first).
      expect(assessment.judgment.retried).toBe(true);
      expect(assessment.judgment.prompt_version).toBe(ASSESS_PROMPT_VERSION);
      expect(assessment.judgment.reproducible).toBe(true);
    } finally {
      app.close();
    }
  });
});

// ─── REGRESSION / CONTROL: a pre-existing legacy doc stays absent + byte-identical ──

describe("legacy assessment docs (no reproducible field) — CONTROL, task AC #4", () => {
  it("a schema-valid assessment doc authored before this field existed still reads reproducible === undefined, and renders with NO 'Reproducible:' line", async () => {
    const app = createApp(join(tmpDir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const planResult = await app.corpusService.create({
        type: "plan",
        title: "Legacy Assessment Plan",
        content: "Plan body.",
      } as CreateDocInput);
      if (!planResult.ok) throw new Error("plan create failed");

      // Hand-built literal mirrors assessmentResultSchema's own minimal @example — no
      // `facts`/`source_versions`/`reproducible`, exactly what a pre-SPEC/task record
      // looked like. Never round-tripped through _finalizeAssessment.
      const legacyAssessment: AssessmentResult = {
        scope: { type: "plan", id: planResult.value.id },
        verdict: "met",
        overall_score: 88,
        ac_scores: [],
        gaps: [],
        recommendations: [],
        judgment: {
          provider: "claude-cli",
          prompt_version: 1,
          duration_ms: 3000,
          retried: false,
          truncated: [],
        },
      };

      const docResult = await app.corpusService.create({
        type: "knowledge",
        title: "Legacy Assessment Doc",
        parent_id: planResult.value.id,
        content: "placeholder — overwritten by renderAssessmentContent below",
        extra: { sub_type: "assessment", assessment: legacyAssessment },
      } as CreateDocInput);
      if (!docResult.ok) throw new Error(`legacy doc create failed: ${JSON.stringify(docResult.error)}`);

      // Re-read fresh — proves the ABSENCE survives a real store round-trip (Zod parse
      // on read), not just the in-memory literal.
      const reReadResult = await app.corpusService.get(docResult.value.id);
      expect(reReadResult.ok).toBe(true);
      if (!reReadResult.ok) return;
      const reReadAssessment = reReadResult.value.doc.extra["assessment"] as AssessmentResult;
      expect(reReadAssessment.judgment.reproducible).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(reReadAssessment.judgment, "reproducible")).toBe(false);

      const rendered = renderAssessmentContent(reReadAssessment);
      expect(rendered).not.toContain("Reproducible:");
      expect(rendered).toContain("Prompt version: 1");
    } finally {
      app.close();
    }
  });
});
