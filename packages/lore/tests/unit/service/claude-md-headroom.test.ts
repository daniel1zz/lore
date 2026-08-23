/**
 * Unit suite for `computeHeadroom` / `computeHeadroomWarnings` — the
 * headroom-reporting extension to
 * `packages/lore/src/service/claude-md-check.ts`
 * (task-lore-status-check-claude-md-reports-a-saturated-file-as).
 *
 * RED baseline (empirically confirmed against this worktree's HEAD before
 * this task's implementation landed, via `git stash` of the implementation
 * commit and a live `bunx vitest run` against this exact file): with the
 * pre-fix `claude-md-check.ts`, neither `computeHeadroom` nor
 * `computeHeadroomWarnings` exists — every scenario below fails with
 * `TypeError: computeHeadroom is not a function` (module resolves fine,
 * named export is absent), which is the correct RED failure reason (missing
 * feature, not a test bug). The paired CLI-level RED reproduction (the exact
 * incident: a fixture 5 bytes from CLAUDE.md's root byte ceiling printing
 * `CLAUDE.md: within budget (0 findings).` with no margin shown anywhere) is
 * pinned separately in `tests/integration/status-claude-md.test.ts`'s new
 * "headroom reporting" describe blocks.
 *
 * `lintMemoryFiles` itself is untouched by this extension (REGRESSION,
 * imported statically alongside the new exports below — same convention as
 * `claude-md-admission.test.ts`).
 *
 * Coverage dimensions: HAPPY (small file, both metrics reported) / the
 * INCIDENT fixture itself (root file at ceiling-5 bytes -> remaining=5,
 * warn=true) / BOUNDARY (exactly at the warn threshold fires, one unit under
 * does not) / NEGATIVE/CONTROL (comfortably-small file -> zero advisory
 * warnings, proving the band does not degrade into "always warns") / STATE
 * (`budgets.enabled=false` short-circuits both functions to empty, mirroring
 * `lintMemoryFiles`) / ERROR (empty files array, no throw) / configuration
 * (the warn threshold is read from `budgets.warn_threshold_fraction`, never
 * hardcoded — a custom fraction measurably moves the warn boundary) /
 * REGRESSION (a file near BOTH ceilings produces two independent warnings;
 * `lintMemoryFiles` itself keeps working from the same module file).
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore
 */

import { describe, it, expect } from "vitest";
import { resolveMemoryFileBudgets, type MemoryFileBudgets } from "@lore/core";
import {
  computeHeadroom,
  computeHeadroomWarnings,
  lintMemoryFiles,
} from "../../../src/service/claude-md-budget.js";
import type { MemoryFileRecord } from "../../../src/service/claude-md-findings.js";

// ─── Fixture builders (mirrors claude-md-check.test.ts's convention) ───────

/**
 * Produces text content with an EXACT line count and an EXACT
 * `Buffer.byteLength` (UTF-8 bytes), by padding the final line with
 * single-byte ASCII filler.
 */
function buildFixture(lineCount: number, byteCount: number): string {
  const rows: string[] = [];
  for (let i = 1; i <= lineCount; i++) {
    rows.push(`Line ${i}: standing discipline entry, not a status narrative.`);
  }
  let content = rows.join("\n") + "\n";
  const baseBytes = Buffer.byteLength(content, "utf8");
  if (baseBytes > byteCount) {
    throw new Error(`buildFixture: base content (${baseBytes} bytes) exceeds requested byteCount (${byteCount})`);
  }
  const deficit = byteCount - baseBytes;
  if (deficit > 0) {
    content = content.slice(0, -1) + "x".repeat(deficit) + "\n";
  }
  return content;
}

const budgets: MemoryFileBudgets = resolveMemoryFileBudgets(undefined);

describe("computeHeadroom", () => {
  it("HAPPY: a comfortably-small root file reports used/ceiling/remaining for BOTH metrics, warn false on both", () => {
    const content = buildFixture(10, 700);

    const reports = computeHeadroom([{ path: "CLAUDE.md", role: "root", content }], budgets);

    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report?.path).toBe("CLAUDE.md");
    expect(report?.role).toBe("root");
    expect(report?.lines).toEqual({ used: 10, ceiling: budgets.root.max_lines, remaining: budgets.root.max_lines - 10, warn: false });
    expect(report?.bytes).toEqual({ used: 700, ceiling: budgets.root.max_bytes, remaining: budgets.root.max_bytes - 700, warn: false });
  });

  it("THE INCIDENT: a root file 5 bytes from its byte ceiling reports remaining=5 and warn=true (not a bare pass/fail)", () => {
    // Mirrors the exact reproduction: 24571/24576 bytes = 99.98% used, well
    // past the 0.9 default warn_threshold_fraction — but line count stays
    // far under its own ceiling, isolating the byte-metric signal.
    const byteCount = budgets.root.max_bytes - 5;
    const content = buildFixture(50, byteCount);

    const [report] = computeHeadroom([{ path: "CLAUDE.md", role: "root", content }], budgets);

    expect(report?.bytes.used).toBe(byteCount);
    expect(report?.bytes.remaining).toBe(5);
    expect(report?.bytes.warn).toBe(true);
    // Lines are nowhere near their own ceiling at 50 rows.
    expect(report?.lines.warn).toBe(false);
  });

  it("BOUNDARY: used exactly at the warn threshold fires; one byte under does not", () => {
    const ceiling = budgets.root.max_bytes;
    const threshold = budgets.root.max_bytes * budgets.warn_threshold_fraction;
    const atThreshold = Math.ceil(threshold);
    const belowThreshold = atThreshold - 1;

    const atContent = buildFixture(5, atThreshold);
    const [atReport] = computeHeadroom([{ path: "CLAUDE.md", role: "root", content: atContent }], budgets);
    expect(atReport?.bytes.used).toBe(atThreshold);
    expect(atReport?.bytes.ceiling).toBe(ceiling);
    expect(atReport?.bytes.warn).toBe(true);

    const belowContent = buildFixture(5, belowThreshold);
    const [belowReport] = computeHeadroom([{ path: "CLAUDE.md", role: "root", content: belowContent }], budgets);
    expect(belowReport?.bytes.warn).toBe(false);
  });

  it("STATE: budgets.enabled=false short-circuits to an empty array, mirroring lintMemoryFiles", () => {
    const disabledBudgets: MemoryFileBudgets = { ...budgets, enabled: false };
    const content = buildFixture(50, budgets.root.max_bytes - 5); // deliberately near-ceiling

    const reports = computeHeadroom([{ path: "CLAUDE.md", role: "root", content }], disabledBudgets);

    expect(reports).toEqual([]);
  });

  it("ERROR/NEGATIVE: empty files array -> empty array, no throw", () => {
    expect(() => {
      const reports = computeHeadroom([], budgets);
      expect(reports).toEqual([]);
    }).not.toThrow();
  });

  it("CONFIGURATION: a custom warn_threshold_fraction measurably moves the warn boundary (never a hardcoded number)", () => {
    // 50% used would NOT warn under the default (0.9) but DOES warn under a
    // tightened 0.4 config value — proves the threshold is read from
    // `budgets`, not baked into the function.
    const halfUsedBytes = Math.floor(budgets.root.max_bytes * 0.5);
    const content = buildFixture(5, halfUsedBytes);

    const [defaultReport] = computeHeadroom([{ path: "CLAUDE.md", role: "root", content }], budgets);
    expect(defaultReport?.bytes.warn).toBe(false);

    const tightBudgets: MemoryFileBudgets = { ...budgets, warn_threshold_fraction: 0.4 };
    const [tightReport] = computeHeadroom([{ path: "CLAUDE.md", role: "root", content }], tightBudgets);
    expect(tightReport?.bytes.warn).toBe(true);
  });
});

describe("computeHeadroomWarnings", () => {
  it("NEGATIVE/CONTROL: a comfortably-small file's headroom report produces ZERO advisory warnings", () => {
    const content = buildFixture(10, 700);
    const reports = computeHeadroom([{ path: "CLAUDE.md", role: "root", content }], budgets);

    const warnings = computeHeadroomWarnings(reports);

    expect(warnings).toEqual([]);
  });

  it("HAPPY: the incident fixture (5 bytes remaining) produces exactly one headroom_warning naming the path and the remaining count", () => {
    const byteCount = budgets.root.max_bytes - 5;
    const content = buildFixture(50, byteCount);
    const reports = computeHeadroom([{ path: "CLAUDE.md", role: "root", content }], budgets);

    const warnings = computeHeadroomWarnings(reports);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.kind).toBe("headroom_warning");
    expect(warnings[0]?.measured).toBe(5);
    expect(warnings[0]?.message).toContain("CLAUDE.md");
    expect(warnings[0]?.message).toContain("5");
  });

  it("REGRESSION: a file near BOTH ceilings produces TWO independent headroom_warning findings", () => {
    const lineCount = Math.ceil(budgets.root.max_lines * 0.95);
    const byteCount = budgets.root.max_bytes - 5;
    const content = buildFixture(lineCount, byteCount);
    const reports = computeHeadroom([{ path: "CLAUDE.md", role: "root", content }], budgets);

    const warnings = computeHeadroomWarnings(reports);

    expect(warnings).toHaveLength(2);
    const kinds = warnings.map((w) => w.kind);
    expect(kinds).toEqual(["headroom_warning", "headroom_warning"]);
    expect(warnings.some((w) => w.message.includes("max_lines"))).toBe(true);
    expect(warnings.some((w) => w.message.includes("max_bytes"))).toBe(true);
  });

  it("ERROR/NEGATIVE: empty reports array -> empty array, no throw", () => {
    expect(() => {
      const warnings = computeHeadroomWarnings([]);
      expect(warnings).toEqual([]);
    }).not.toThrow();
  });
});

describe("REGRESSION: lintMemoryFiles (existing AC-CMC-1 behavior) stays untouched by this module's headroom extension", () => {
  it("an oversized root file still produces exactly one max_lines finding via the SAME module file", () => {
    const lineCount = budgets.root.max_lines + 1;
    const rows: string[] = [];
    for (let i = 1; i <= lineCount; i++) {
      rows.push(`Line ${i}: standing discipline entry, not a status narrative.`);
    }
    const content = rows.join("\n") + "\n";

    const file: MemoryFileRecord = { path: "CLAUDE.md", role: "root", content };
    const findings = lintMemoryFiles([file], budgets);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe("max_lines");
    expect(findings[0]?.measured).toBe(lineCount);
  });
});
