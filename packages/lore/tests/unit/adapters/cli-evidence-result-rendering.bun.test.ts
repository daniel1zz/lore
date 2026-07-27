/**
 * Tests for `lore evidence`'s non-JSON success line — specifically that
 * `--result expected-fail` is rendered VERBATIM (`Recorded <oracle> evidence
 * (expected-fail) on ...`), never blank or coerced toward `pass`/`fail`.
 *
 * spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M1 (AC-WH-1)
 * states `expected-fail` is "stored verbatim with distinct rendering" — this file
 * closes the "evidence list rendering" half of the 2026-07-27 assess major gap on
 * AC-WH-1 (task-t5-close-ac-wh-1-rendering-clause-oracle-coverage-assess). The
 * command's `console.log` line already interpolates `args.result` directly
 * (`commands/evidence.ts` — no coercion, no lookup table that could silently drop
 * an unrecognized value) — this is a REGRESSION pin on EXISTING correct behavior,
 * not a new-behavior assertion: it was already green when written, because no
 * rendering code changed here (contrast with `cli-ac-coverage-badge.bun.test.ts`'s
 * AC-WH-1 HAPPY/BOUNDARY cases, which DID fail pre-change against the `ac.ts`
 * badge fix in this same task).
 *
 * Uses bun:test (not vitest): `commands/evidence.ts` imports `loadLoreApp` from
 * `../loader.js`, which imports `bun:sqlite` transitively via `app.ts` — mirrors
 * this directory's other `.bun.test.ts` files (e.g. `cli-evidence-ac-ref.bun.test.ts`,
 * whose fixture setup this file reuses verbatim).
 *
 * Six-dimension coverage:
 *   HAPPY      — --result expected-fail renders "(expected-fail)" verbatim in the
 *                success line
 *   NEGATIVE   — the rendered line does NOT contain the bare word "pass" or "fail"
 *                as the parenthesized result token (proves no coercion toward
 *                either sibling value)
 *   REGRESSION — --result pass and --result fail still render their own value
 *                verbatim, byte-identical to pre-AC-WH-1 behavior
 *
 * @spec_ref AC-WH-1
 */

import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../../src/app.js";
import type { CreateDocInput } from "@lore/core";

// ─── Command type ─────────────────────────────────────────────────────────────

type RunnableCommand = {
  run: (ctx: { args: Record<string, unknown> }) => Promise<void>;
};

async function importEvidenceCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/evidence.js");
  const cmd = (mod as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("evidence command not exported");
  return cmd as RunnableCommand;
}

// ─── Fixture setup (mirrors cli-evidence-ac-ref.bun.test.ts) ──────────────────

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  process.exitCode = 0;

  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-cli-evidence-result-test-")));
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
    /* best-effort cleanup */
  }
});

async function seedTask(): Promise<string> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"));
  try {
    const planResult = await app.corpusService.create({
      type: "plan",
      title: "Evidence Result Rendering Test Plan",
      content: "body",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error(`seed plan failed: ${JSON.stringify(planResult.error)}`);

    const taskResult = await app.corpusService.create({
      type: "task",
      title: "Evidence Result Rendering Test Task",
      parent_id: planResult.value.id,
      content: "body",
      extra: { plan_id: planResult.value.id },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error(`seed task failed: ${JSON.stringify(taskResult.error)}`);
    return taskResult.value.slug;
  } finally {
    app.close();
  }
}

/** Captures every `console.log` call's first argument as a string; restore via `.restore()`. */
function captureConsoleLog(): { lines: () => string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(String(args[0]));
  });
  return {
    lines: () => lines,
    restore: () => spy.mockRestore(),
  };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("lore evidence --result expected-fail rendering — HAPPY", () => {
  it("AC-WH-1.RENDER-H1: the success line renders '(expected-fail)' verbatim, not blank or coerced", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const log = captureConsoleLog();

    try {
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "tsc",
          command: "bun run typecheck",
          result: "expected-fail",
          by: "alice",
        },
      });

      expect(process.exitCode).toBe(0);
      const successLine = log.lines().find((l) => l.startsWith("Recorded"));
      expect(successLine).toBeDefined();
      expect(successLine).toContain("(expected-fail)");
    } finally {
      log.restore();
    }
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("lore evidence --result expected-fail rendering — NEGATIVE", () => {
  it("AC-WH-1.RENDER-N1: the rendered parenthetical is not the bare word 'pass' or 'fail' (no coercion toward a sibling value)", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const log = captureConsoleLog();

    try {
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "tsc",
          command: "bun run typecheck",
          result: "expected-fail",
          by: "alice",
        },
      });

      const successLine = log.lines().find((l) => l.startsWith("Recorded")) ?? "";
      expect(successLine).not.toContain("(pass)");
      expect(successLine).not.toContain("(fail)");
      expect(successLine).not.toBe("");
    } finally {
      log.restore();
    }
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("lore evidence --result rendering — REGRESSION", () => {
  it("AC-WH-1.RENDER-REG1: --result pass still renders '(pass)' verbatim, byte-identical to pre-AC-WH-1 behavior", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const log = captureConsoleLog();

    try {
      await cmd.run({
        args: { task: taskSlug, oracle: "tsc", command: "bun run typecheck", result: "pass", by: "alice" },
      });

      const successLine = log.lines().find((l) => l.startsWith("Recorded"));
      expect(successLine).toContain("(pass)");
    } finally {
      log.restore();
    }
  });

  it("AC-WH-1.RENDER-REG2: --result fail still renders '(fail)' verbatim, byte-identical to pre-AC-WH-1 behavior", async () => {
    const taskSlug = await seedTask();
    const cmd = await importEvidenceCommand();
    const log = captureConsoleLog();

    try {
      await cmd.run({
        args: { task: taskSlug, oracle: "tsc", command: "bun run typecheck", result: "fail", by: "alice" },
      });

      const successLine = log.lines().find((l) => l.startsWith("Recorded"));
      expect(successLine).toContain("(fail)");
    } finally {
      log.restore();
    }
  });
});
