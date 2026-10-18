/**
 * @spec_ref SPEC-034 §4 (triage rendering)
 *
 * `lore pending` AI-judgment badge + `--escalated` filter tests — bun:test only (uses
 * real SQLiteStore via createApp, same pattern as assess-ai.bun.test.ts).
 *
 * Why bun:test (not vitest): judgments are seeded directly through
 * `app.judgmentService.record()` — a real StoreInterface call requiring bun:sqlite — so
 * this file follows the same "open a real App in-process, call the command's run()
 * directly" idiom as assess-ai.bun.test.ts, rather than spawning a subprocess. Seeding
 * judgments this way also means NO AI provider is ever invoked — badge rendering is
 * pure presentation over already-persisted judgments, so this is a hermetic path with
 * no stub-claude shim needed.
 *
 * Six-dimension coverage:
 *   HAPPY:      an unreviewed draft doc renders "[unreviewed]"; a doc with a fresh
 *               approve judgment renders "[AI: approve 0.93]"
 *   NEGATIVE:   n/a — no invalid-input branch exercised here (covered at the pure
 *               formatJudgmentBadge unit-test level, utils-judgment-badge.test.ts)
 *   BOUNDARY:   --escalated on a queue with NO escalations → "No escalated documents."
 *   ERROR:      n/a — no service failure path exercised (JudgmentService.record success
 *               path only; failure paths are covered in judgment-service.test.ts)
 *   STATE:      a judgment recorded against an OLDER doc_version renders "(stale)" after
 *               the doc is subsequently edited (bumping its version)
 *   REGRESSION: --escalated excludes non-escalate and stale-escalate docs, and prints
 *               blocking_questions as indented bullets ONLY for the docs it includes
 *
 * @spec_ref SPEC-034 §4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import type { CreateDocInput, NewReviewJudgment } from "@lore/core";
import { liveInvocation } from "../../live-invocation.js";
import type { Invocation } from "@lore/core";

// ─── Command type + output capture (mirrors assess-ai.bun.test.ts) ───────────

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

async function importPendingCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/pending.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("pending command not exported");
  return cmd as RunnableCommand;
}

// ─── Project setup ────────────────────────────────────────────────────────────

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  process.exitCode = 0;
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-pending-badges-test-")));
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
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const JUDGE_IDENTITY = { provider: "test-judge", model: "test-model", prompt_version: "v1" };

function baseNewJudgment(docId: string, docVersion: number): NewReviewJudgment {
  return {
    doc_id: docId,
    doc_version: docVersion,
    decision: "approve",
    confidence: 0.5,
    reasons: [{ dimension: "completeness", finding: "seeded for test" }],
    checks: [{ check: "schema", outcome: "pass" }],
    blocking_questions: [],
    judge: JUDGE_IDENTITY,
  };
}

// ─── HAPPY: unreviewed + fresh approve badge ──────────────────────────────────

describe("lore pending — AI Judgment badge (HAPPY)", () => {
  it("a draft doc with no judgment renders '[unreviewed]'", async () => {
    const app = createApp(join(tmpDir, ".lore", "lore.db"));
    try {
      const createResult = await app.corpusService.create({
        type: "prd",
        title: "Unreviewed PRD",
        content: "body",
      } as CreateDocInput);
      if (!createResult.ok) throw new Error(`create failed: ${JSON.stringify(createResult.error)}`);
    } finally {
      app.close();
    }

    const cmd = await importPendingCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: {}, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(output.stdout.join("\n")).toContain("[unreviewed]");
  });

  it("a draft doc with a fresh approve judgment renders '[AI: approve 0.93]'", async () => {
    const app = createApp(join(tmpDir, ".lore", "lore.db"));
    let docId: string;
    let docVersion: number;
    try {
      const createResult = await app.corpusService.create({
        type: "prd",
        title: "Approved-Looking PRD",
        content: "body",
      } as CreateDocInput);
      if (!createResult.ok) throw new Error(`create failed: ${JSON.stringify(createResult.error)}`);
      docId = createResult.value.id;
      docVersion = createResult.value.version;

      const recordResult = await app.judgmentService.record({
        ...baseNewJudgment(docId, docVersion),
        decision: "approve",
        confidence: 0.93,
      });
      if (!recordResult.ok) throw new Error(`record failed: ${JSON.stringify(recordResult.error)}`);
    } finally {
      app.close();
    }

    const cmd = await importPendingCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: {}, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(output.stdout.join("\n")).toContain("[AI: approve 0.93]");
  });

  it("--json includes the judgment object alongside each doc", async () => {
    const app = createApp(join(tmpDir, ".lore", "lore.db"));
    let docId: string;
    try {
      const createResult = await app.corpusService.create({
        type: "prd",
        title: "JSON Judgment PRD",
        content: "body",
      } as CreateDocInput);
      if (!createResult.ok) throw new Error(`create failed: ${JSON.stringify(createResult.error)}`);
      docId = createResult.value.id;

      const recordResult = await app.judgmentService.record(
        baseNewJudgment(docId, createResult.value.version),
      );
      if (!recordResult.ok) throw new Error(`record failed: ${JSON.stringify(recordResult.error)}`);
    } finally {
      app.close();
    }

    const cmd = await importPendingCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { json: true }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    const parsed = JSON.parse(output.stdout.join("\n")) as {
      data: { docs: Array<{ id: string; judgment: { decision: string } | null }> };
    };
    const row = parsed.data.docs.find((d) => d.id === docId);
    expect(row).toBeDefined();
    expect(row?.judgment?.decision).toBe("approve");
  });
});

// ─── BOUNDARY: --escalated with no escalations ────────────────────────────────

describe("lore pending --escalated — BOUNDARY (no escalations)", () => {
  it("prints 'No escalated documents.' when nothing is escalated", async () => {
    const app = createApp(join(tmpDir, ".lore", "lore.db"));
    try {
      const createResult = await app.corpusService.create({
        type: "prd",
        title: "Approve-Only PRD",
        content: "body",
      } as CreateDocInput);
      if (!createResult.ok) throw new Error(`create failed: ${JSON.stringify(createResult.error)}`);
      const recordResult = await app.judgmentService.record(
        baseNewJudgment(createResult.value.id, createResult.value.version),
      );
      if (!recordResult.ok) throw new Error(`record failed: ${JSON.stringify(recordResult.error)}`);
    } finally {
      app.close();
    }

    const cmd = await importPendingCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { escalated: true }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(output.stdout.join("\n")).toContain("No escalated documents.");
  });
});

// ─── STATE: stale badge after doc edit ────────────────────────────────────────

describe("lore pending — STATE (stale judgment badge)", () => {
  it("a judgment recorded against an older doc_version renders '(stale)' after the doc is edited", async () => {
    const app = createApp(join(tmpDir, ".lore", "lore.db"));
    try {
      const createResult = await app.corpusService.create({
        type: "prd",
        title: "Will Be Edited PRD",
        content: "original body",
      } as CreateDocInput);
      if (!createResult.ok) throw new Error(`create failed: ${JSON.stringify(createResult.error)}`);
      const docId = createResult.value.id;
      const originalVersion = createResult.value.version;

      const recordResult = await app.judgmentService.record(baseNewJudgment(docId, originalVersion));
      if (!recordResult.ok) throw new Error(`record failed: ${JSON.stringify(recordResult.error)}`);

      // Bump the doc's version — the previously recorded judgment is now stale.
      const setResult = await app.corpusService.set(docId, { content: "edited body — version bump" });
      if (!setResult.ok) throw new Error(`set failed: ${JSON.stringify(setResult.error)}`);
      expect(setResult.value.version).toBeGreaterThan(originalVersion);
    } finally {
      app.close();
    }

    const cmd = await importPendingCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: {}, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    expect(output.stdout.join("\n")).toContain("(stale)");
  });
});

// ─── REGRESSION: --escalated filters correctly + prints blocking questions ────

describe("lore pending --escalated — REGRESSION (filter + blocking-question bullets)", () => {
  it("includes only the fresh escalate doc, printing its blocking_questions as bullets", async () => {
    const app = createApp(join(tmpDir, ".lore", "lore.db"));
    try {
      // Doc A: fresh approve — must be EXCLUDED from --escalated.
      const approveDoc = await app.corpusService.create({
        type: "prd",
        title: "Approve Doc",
        content: "body",
      } as CreateDocInput);
      if (!approveDoc.ok) throw new Error("create approveDoc failed");
      const approveRecord = await app.judgmentService.record(
        baseNewJudgment(approveDoc.value.id, approveDoc.value.version),
      );
      if (!approveRecord.ok) throw new Error("record approve failed");

      // Doc B: fresh escalate — must be INCLUDED, with blocking questions printed.
      const escalateDoc = await app.corpusService.create({
        type: "prd",
        title: "Escalate Doc",
        content: "body",
      } as CreateDocInput);
      if (!escalateDoc.ok) throw new Error("create escalateDoc failed");
      const escalateRecord = await app.judgmentService.record({
        ...baseNewJudgment(escalateDoc.value.id, escalateDoc.value.version),
        decision: "escalate",
        confidence: 0.4,
        blocking_questions: ["Is this doc still relevant?", "Who is the owner?"],
      });
      if (!escalateRecord.ok) throw new Error("record escalate failed");

      // Doc C: STALE escalate (judgment.doc_version < current doc.version) — must be
      // EXCLUDED from --escalated (only FRESH escalations qualify).
      const staleEscalateDoc = await app.corpusService.create({
        type: "prd",
        title: "Stale Escalate Doc",
        content: "body",
      } as CreateDocInput);
      if (!staleEscalateDoc.ok) throw new Error("create staleEscalateDoc failed");
      const staleRecord = await app.judgmentService.record({
        ...baseNewJudgment(staleEscalateDoc.value.id, staleEscalateDoc.value.version),
        decision: "escalate",
        confidence: 0.4,
        blocking_questions: ["Stale question — should not print"],
      });
      if (!staleRecord.ok) throw new Error("record stale escalate failed");
      const bumpResult = await app.corpusService.set(staleEscalateDoc.value.id, { content: "bumped" });
      if (!bumpResult.ok) throw new Error("bump staleEscalateDoc failed");
    } finally {
      app.close();
    }

    const cmd = await importPendingCommand();
    const output = captureOutput();
    try {
      await cmd.run({ args: { escalated: true }, inv: liveInvocation() });
    } finally {
      output.restore();
    }

    const combined = output.stdout.join("\n");
    expect(combined).toContain("Escalate Doc");
    expect(combined).not.toContain("Approve Doc");
    expect(combined).not.toContain("Stale Escalate Doc");
    expect(combined).toContain("Is this doc still relevant?");
    expect(combined).toContain("Who is the owner?");
    expect(combined).not.toContain("Stale question — should not print");
  });
});
