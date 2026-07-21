/**
 * Six-dimension tests for `adapters/cli/verify-render.ts`'s SPEC-063
 * execution-root print decision (D2/D4): `shouldPrintExecutionRootLine`,
 * `formatExecutionRootLine`, and `buildVerifyHeaderLines` (the ordered
 * output-line assembly `commands/verify.ts` prints from). Pure string-output
 * assertions — no store, no filesystem, no bun:sqlite involvement
 * (vitest-safe, mirrors `setup-render.test.ts`/`review-render.test.ts`).
 *
 * @spec_ref AC-063-4
 */

import { describe, expect, it } from "vitest";
import {
  buildVerifyHeaderLines,
  formatAcResultLine,
  formatExecutionRootLine,
  shouldPrintExecutionRootLine,
} from "../../../src/adapters/cli/verify-render.js";
import type { VerifyPlanResult } from "../../../src/service/verify-runner-service.js";

function passResult(overrides: Partial<VerifyPlanResult["results"][number]> = {}): VerifyPlanResult["results"][number] {
  return { ac_id: "AC-1", result: "pass", exit_code: 0, duration_ms: 5, timed_out: false, ...overrides };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — worktree mode prints the execution-root line before the header line", () => {
  it("buildVerifyHeaderLines returns [executionRootLine, headerLine] in that order for mode: worktree", () => {
    const lines = buildVerifyHeaderLines({
      mode: "worktree",
      root: "/repo/.worktrees/t1",
      explicitOverride: false,
      planArg: "plan-x",
      taskSlug: "task-x",
    });

    expect(lines).toEqual([
      "Execution root: /repo/.worktrees/t1",
      "Verifying plan-x against task task-x:",
    ]);
  });

  it("AC-063-4: the execution-root line precedes the FIRST AC result line — a structural guarantee, not incidental", () => {
    const headerLines = buildVerifyHeaderLines({
      mode: "worktree",
      root: "/repo/.worktrees/t1",
      explicitOverride: false,
      planArg: "plan-x",
      taskSlug: "task-x",
    });
    const acLines = [formatAcResultLine(passResult())];
    const fullOutput = [...headerLines, ...acLines];

    const executionRootIndex = fullOutput.findIndex((l) => l.startsWith("Execution root:"));
    const firstAcResultIndex = fullOutput.findIndex((l) => l === acLines[0]);

    expect(executionRootIndex).toBeGreaterThanOrEqual(0);
    expect(firstAcResultIndex).toBeGreaterThan(executionRootIndex);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE — mode: corpus_root with no override prints ZERO execution-root lines", () => {
  it("buildVerifyHeaderLines returns exactly the header line, no execution-root line", () => {
    const lines = buildVerifyHeaderLines({
      mode: "corpus_root",
      root: "/repo",
      explicitOverride: false,
      planArg: "plan-x",
      taskSlug: "task-x",
    });

    expect(lines).toEqual(["Verifying plan-x against task task-x:"]);
    expect(lines.filter((l) => l.startsWith("Execution root:"))).toHaveLength(0);
  });

  it("shouldPrintExecutionRootLine is false for corpus_root + no override", () => {
    expect(shouldPrintExecutionRootLine("corpus_root", false)).toBe(false);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY — D4 explicit override forces the print even in corpus_root mode", () => {
  it("shouldPrintExecutionRootLine is true when explicitOverride is true, regardless of mode", () => {
    expect(shouldPrintExecutionRootLine("corpus_root", true)).toBe(true);
    expect(shouldPrintExecutionRootLine("worktree", true)).toBe(true);
  });

  it("buildVerifyHeaderLines prints the execution-root line for corpus_root mode when explicitOverride is true", () => {
    const lines = buildVerifyHeaderLines({
      mode: "corpus_root",
      root: "/repo",
      explicitOverride: true,
      planArg: "plan-x",
      taskSlug: "task-x",
    });

    expect(lines).toEqual(["Execution root: /repo", "Verifying plan-x against task task-x:"]);
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR — an empty root string still renders a (degenerate but non-throwing) line", () => {
  it("formatExecutionRootLine never throws on an empty string", () => {
    expect(() => formatExecutionRootLine("")).not.toThrow();
    expect(formatExecutionRootLine("")).toBe("Execution root: ");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE — the SAME mode flips print behavior purely based on explicitOverride", () => {
  it("mode: corpus_root prints with explicitOverride true, doesn't print with explicitOverride false", () => {
    const withOverride = buildVerifyHeaderLines({
      mode: "corpus_root",
      root: "/repo",
      explicitOverride: true,
      planArg: "plan-x",
      taskSlug: "task-x",
    });
    const withoutOverride = buildVerifyHeaderLines({
      mode: "corpus_root",
      root: "/repo",
      explicitOverride: false,
      planArg: "plan-x",
      taskSlug: "task-x",
    });

    expect(withOverride).toHaveLength(2);
    expect(withoutOverride).toHaveLength(1);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — formatAcResultLine is byte-identical to its pre-move behavior", () => {
  it("renders a pass line unchanged", () => {
    expect(formatAcResultLine(passResult())).toBe("  ✔ AC-1 pass (5ms, exit 0)");
  });

  it("renders a fail line with no [new]/[TIMED OUT] suffix by default", () => {
    expect(formatAcResultLine(passResult({ result: "fail", exit_code: 1 }))).toBe(
      "  ✘ AC-1 fail (5ms, exit 1)",
    );
  });

  it("renders an inconclusive line with declared/executed counts", () => {
    expect(
      formatAcResultLine(
        passResult({ result: "inconclusive", executed_files: 1, declared_paths: 3 }),
      ),
    ).toBe("  ⚠ AC-1 inconclusive (ran 1 of 3 declared paths) (5ms, exit 0)");
  });

  it("a plain main-checkout run's header lines are byte-identical to the pre-SPEC-063 single line", () => {
    const lines = buildVerifyHeaderLines({
      mode: "corpus_root",
      root: "/repo",
      explicitOverride: false,
      planArg: "my-plan",
      taskSlug: "my-task",
    });
    expect(lines).toEqual(["Verifying my-plan against task my-task:"]);
  });
});
