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
import { evidenceBadge, formatReadyLine } from "../../../src/adapters/cli/commands/ready.js";
import type { CreateDocInput, DocSummary, ReadyRecord } from "@lore/core";

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

async function importReadyCommand(): Promise<RunnableCommand> {
  const mod = await import("../../../src/adapters/cli/commands/ready.js");
  const cmd = (mod as unknown as { default?: { run?: RunnableCommand["run"] } }).default;
  if (!cmd?.run) throw new Error("ready command not exported");
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

/** Like {@link seedTask} but also returns the parent plan's slug — `lore ready` needs it. */
async function seedPlanAndTask(): Promise<{ planSlug: string; taskSlug: string }> {
  const app = createApp(join(tmpDir, ".lore", "lore.db"));
  try {
    const planResult = await app.corpusService.create({
      type: "plan",
      title: "Ready Badge Rendering Test Plan",
      content: "body",
    } as CreateDocInput);
    if (!planResult.ok) throw new Error(`seed plan failed: ${JSON.stringify(planResult.error)}`);

    const taskResult = await app.corpusService.create({
      type: "task",
      title: "Ready Badge Rendering Test Task",
      parent_id: planResult.value.id,
      content: "body",
      extra: { plan_id: planResult.value.id },
    } as CreateDocInput);
    if (!taskResult.ok) throw new Error(`seed task failed: ${JSON.stringify(taskResult.error)}`);
    return { planSlug: planResult.value.slug, taskSlug: taskResult.value.slug };
  } finally {
    app.close();
  }
}

/** Minimal valid `DocSummary` fixture for direct `formatReadyLine` unit tests — no store round-trip. */
function buildDocSummary(overrides: Partial<DocSummary> = {}): DocSummary {
  return {
    id: "01FIXTURETASKID0000000000",
    slug: "task-ready-badge-fixture",
    type: "task",
    title: "Ready Badge Fixture Task",
    status: "draft",
    updated_at: "2026-08-01T00:00:00.000Z",
    tags: [],
    priority: "medium",
    ...overrides,
  };
}

/** Minimal valid `ReadyRecord` fixture — `ready`/`unmet_blockers` deliberately not the axis under test. */
function buildReadyRecord(overrides: Partial<ReadyRecord> = {}): ReadyRecord {
  return {
    task: buildDocSummary(),
    ready: true,
    unmet_blockers: [],
    evidence_count: 0,
    ...overrides,
  };
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
          "output-tail": "AssertionError: expected 1 to equal 2",
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
          "output-tail": "AssertionError: expected 1 to equal 2",
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
      // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
      // predicate-to-its-own) — "tsc" self-report is now refused regardless
      // of tail content; "manual" is the one oracle that still lets a
      // genuinely non-empty self-reported tail succeed. This test only
      // checks the success line's "(pass)" rendering, not oracle semantics.
      await cmd.run({
        args: {
          task: taskSlug,
          oracle: "manual",
          command: "bun run typecheck",
          result: "pass",
          by: "alice",
          "output-tail": "ok",
        },
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
        args: {
          task: taskSlug,
          oracle: "tsc",
          command: "bun run typecheck",
          result: "fail",
          by: "alice",
          "output-tail": "AssertionError: expected 1 to equal 2",
        },
      });

      const successLine = log.lines().find((l) => l.startsWith("Recorded"));
      expect(successLine).toContain("(fail)");
    } finally {
      log.restore();
    }
  });
});

/**
 * Tests for `lore ready`'s per-task evidence badge — task-lore-ready-renders-an-
 * expected-fail-evidence-row-as-a. Prior behavior: `formatReadyLine` treated only
 * `"fail"` as non-green, so `"expected-fail"` (a deliberate pre-implementation RED
 * pin) and `"inconclusive"` (an oracle ran but produced no trustworthy signal)
 * both silently rendered plain `✔n` — a FALSE GREEN indistinguishable from a real
 * passing oracle. The fix (`commands/ready.ts::evidenceBadge`) reuses the SAME
 * glyph vocabulary `commands/ac.ts::coverageBadge` / `utils.ts::formatWorkflowBadge`
 * already ship for these two states (`⚑R` expected-fail, `⚑?` inconclusive,
 * spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M1) rather than
 * inventing a second, divergent marker set.
 *
 * Assertions key on the MARKER TOKEN itself (`⚑R`, `⚑?`, `✔n`, `✘n`) via
 * `.toContain(...)`, never on a remembered contiguous phrase of the whole
 * rendered line — a matcher built from a memorized full-line phrase degrades to
 * silent no-match if the surrounding text ever shifts, and "no match + exit 0"
 * reads identically to "passed" (this repo's own standing false-oracle lesson).
 *
 * Six-dimension coverage:
 *   HAPPY      — expected-fail -> ⚑R, inconclusive -> ⚑? (both the pure
 *                `evidenceBadge` glyph and the composed `formatReadyLine` output)
 *   NEGATIVE   — an unrecognized/garbage result string does not silently fall to
 *                ✔ (the exact defect class this task fixes)
 *   BOUNDARY   — evidence_count > 0 with latest_evidence undefined: no crash, no
 *                green; evidence_count === 0 always renders no badge at all
 *   ERROR      — a non-string (null) result reaching the formatter (corrupted/
 *                legacy extra data) does not throw and does not render green
 *   STATE      — real corpus round-trip: `lore evidence --result expected-fail`
 *                then `lore ready` against the same task renders ⚑R in the actual
 *                printed line (not a fabricated ReadyRecord)
 *   REGRESSION — result=pass still renders ✔n and result=fail still renders ✘n,
 *                both asserted explicitly (the fix must not turn every badge
 *                non-green)
 *
 * @spec_ref task-lore-ready-renders-an-expected-fail-evidence-row-as-a
 */

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("lore ready evidence badge — HAPPY", () => {
  it("AC-READY-EF.H1: latest_evidence.result=expected-fail renders the ⚑R marker via evidenceBadge, distinct from ✔ and ✘", () => {
    const badge = evidenceBadge("expected-fail", 2);
    expect(badge).toContain("⚑R");
    expect(badge).not.toContain("✔");
    expect(badge).not.toContain("✘");
  });

  it("AC-READY-EF.H2: latest_evidence.result=inconclusive renders the ⚑? marker via evidenceBadge, distinct from ✔", () => {
    const badge = evidenceBadge("inconclusive", 1);
    expect(badge).toContain("⚑?");
    expect(badge).not.toContain("✔");
  });

  it("AC-READY-EF.H3: formatReadyLine composes the ⚑R marker into the full readiness line for an expected-fail task", () => {
    const line = formatReadyLine(
      buildReadyRecord({
        evidence_count: 3,
        latest_evidence: { result: "expected-fail", recorded_at: "2026-08-01T00:00:00.000Z" },
      }),
    );
    expect(line).toContain("⚑R3");
    expect(line).not.toContain("✔");
  });

  it("AC-READY-EF.H4: formatReadyLine composes the ⚑? marker into the full readiness line for an inconclusive task", () => {
    const line = formatReadyLine(
      buildReadyRecord({
        evidence_count: 1,
        latest_evidence: { result: "inconclusive", recorded_at: "2026-08-01T00:00:00.000Z" },
      }),
    );
    expect(line).toContain("⚑?1");
    expect(line).not.toContain("✔");
  });
});

// ─── NEGATIVE ────────────────────────────────────────────────────────────────

describe("lore ready evidence badge — NEGATIVE", () => {
  it("AC-READY-EF.N1: an unrecognized/garbage result value does not silently fall to ✔ (the exact false-green defect class)", () => {
    const garbage = "totally-bogus-result" as Parameters<typeof evidenceBadge>[0];
    const badge = evidenceBadge(garbage, 5);
    expect(badge).not.toContain("✔");
    // must not be blank either — a silent empty fallback is its own false signal
    expect(badge.trim().length).toBeGreaterThan(0);
  });
});

// ─── BOUNDARY ────────────────────────────────────────────────────────────────

describe("lore ready evidence badge — BOUNDARY", () => {
  it("AC-READY-EF.B1: evidence_count > 0 with latest_evidence undefined does not crash and does not render green", () => {
    expect(() => evidenceBadge(undefined, 2)).not.toThrow();
    const badge = evidenceBadge(undefined, 2);
    expect(badge).not.toContain("✔");
    expect(badge.trim().length).toBeGreaterThan(0);
  });

  it("AC-READY-EF.B2: evidence_count === 0 renders no badge regardless of result value", () => {
    expect(evidenceBadge("pass", 0)).toBe("");
    expect(evidenceBadge("expected-fail", 0)).toBe("");
    expect(evidenceBadge(undefined, 0)).toBe("");
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

describe("lore ready evidence badge — ERROR", () => {
  it("AC-READY-EF.E1: a non-string (null) result — corrupted/legacy extra data — does not throw and does not render green", () => {
    const corrupted = null as unknown as Parameters<typeof evidenceBadge>[0];
    expect(() => evidenceBadge(corrupted, 4)).not.toThrow();
    const badge = evidenceBadge(corrupted, 4);
    expect(badge).not.toContain("✔");
  });
});

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("lore ready evidence badge — STATE", () => {
  it("AC-READY-EF.S1: real corpus round-trip — expected-fail evidence recorded via `lore evidence` renders ⚑R in `lore ready`'s printed output", async () => {
    const { planSlug, taskSlug } = await seedPlanAndTask();

    const evidenceCmd = await importEvidenceCommand();
    await evidenceCmd.run({
      args: {
        task: taskSlug,
        oracle: "tsc",
        command: "bun run typecheck",
        result: "expected-fail",
        "output-tail": "error TS2339: Property 'evidenceBadge' does not exist on type 'typeof import(\"./ready.js\")'.",
        by: "alice",
      },
    });
    expect(process.exitCode).toBe(0);

    const readyCmd = await importReadyCommand();
    const log = captureConsoleLog();
    try {
      await readyCmd.run({ args: { plan: planSlug, json: false } });
      const taskLine = log.lines().find((l) => l.includes(taskSlug));
      expect(taskLine).toBeDefined();
      expect(taskLine).toContain("⚑R");
      expect(taskLine).not.toContain("✔");
    } finally {
      log.restore();
    }
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("lore ready evidence badge — REGRESSION", () => {
  it("AC-READY-EF.R1: latest_evidence.result=pass still renders ✔n via evidenceBadge, unaffected by the fix", () => {
    expect(evidenceBadge("pass", 4)).toBe(" ✔4");
  });

  it("AC-READY-EF.R2: latest_evidence.result=fail still renders ✘n via evidenceBadge, unaffected by the fix", () => {
    expect(evidenceBadge("fail", 2)).toBe(" ✘2");
  });

  it("AC-READY-EF.R3: formatReadyLine still composes plain ✔/✘ for pass/fail (full-line control, no stray ⚑)", () => {
    const passLine = formatReadyLine(
      buildReadyRecord({
        evidence_count: 2,
        latest_evidence: { result: "pass", recorded_at: "2026-08-01T00:00:00.000Z" },
      }),
    );
    expect(passLine).toContain("✔2");
    expect(passLine).not.toContain("⚑");

    const failLine = formatReadyLine(
      buildReadyRecord({
        evidence_count: 1,
        latest_evidence: { result: "fail", recorded_at: "2026-08-01T00:00:00.000Z" },
      }),
    );
    expect(failLine).toContain("✘1");
    expect(failLine).not.toContain("⚑");
  });
});
