/**
 * RED-phase TDD tests for `lintMemoryFiles` — the pure line/byte-ceiling lint
 * at `packages/lore/src/service/claude-md-check.ts` (task-skill-test-lint-
 * boundary-suite-red-ac-cmc-1-path; the paired implementation task is
 * task-skill-implement-lintmemoryfiles-pure-service-fs-discovery).
 *
 * The module does NOT exist yet in this worktree (confirmed empirically
 * before writing this file: `packages/lore/src/service/claude-md-check.ts`
 * is absent). This suite is AC-CMC-1's script target verbatim:
 *   `bunx vitest run packages/lore/tests/unit/service/claude-md-check.test.ts`
 *
 * Typecheck strategy (task's stated constraint — `bun run typecheck` must
 * stay green while this file is RED): `packages/lore/tsconfig.tests.json`
 * covers `tests/**` too, so a STATIC `import { lintMemoryFiles } from
 * "../../../src/service/claude-md-check.js"` would fail module resolution at
 * typecheck time (the file doesn't exist) — the same problem STAT-RED's
 * merged suite (`tests/integration/status-claude-md.test.ts`) sidesteps by
 * never importing the module at all (it spawns the compiled CLI as a
 * subprocess instead). This suite calls `lintMemoryFiles` directly in-process
 * (a unit test over the pure function, not a CLI e2e), so that dodge isn't
 * available here. Instead: `loadLintMemoryFiles()` below builds the module
 * specifier from a `string[]` via `.join("/")` rather than a string literal.
 * TypeScript's `import()` type-checker only attempts module resolution for a
 * LITERAL specifier; a non-literal `string`-typed specifier resolves to
 * `Promise<any>` with zero resolution attempt, so `tsc --noEmit` never looks
 * for the target file and stays green pre-GREEN. Empirically verified against
 * this exact tsconfig before writing the real scenarios below (scratch file,
 * removed): `bunx tsc --noEmit -p packages/lore/tsconfig.tests.json` → exit 0
 * with a nonexistent target; `bunx vitest run` on the same pattern → exit 1,
 * every case FAILED (not skipped) with `Cannot find module '...'`  — the
 * per-test-body import shape (not a shared `beforeAll`) is what keeps each
 * case an individually-reported FAILED test rather than a whole-suite
 * "3 skipped" collapse, matching this task's AC: "every case fails on the
 * missing module ... not test bugs".
 *
 * Budgets come from the ALREADY-LANDED `resolveMemoryFileBudgets` /
 * `contextConfigSchema` in `packages/core/src/config.ts` (real import below,
 * not reimplemented): defaults are root 300 lines / 30720 bytes, module 200
 * lines / 16384 bytes, `enabled: true`.
 *
 * Line-counting convention pinned by the fixtures below (mirrors this
 * codebase's established trailing-newline handling — see
 * `packages/lore/src/service/receipt-log.ts`'s "a trailing newline yields an
 * empty final element after split('\n') ... neither a data line"): a file's
 * line count is `content.split("\n").length`, minus 1 if content ends with
 * "\n" (the trailing empty element is not itself a line). `lintMemoryFiles`
 * must measure lines this same way for these fixtures' expected counts to
 * hold — this is the executable contract the paired implementation task
 * must satisfy.
 *
 * Coverage dimensions: BOUNDARY (ceiling-1 under / ceiling+1 over, both
 * metrics, both roles) / regression-class UTF-8 correctness (CJK multibyte —
 * the false-oracle-killer case: `content.length` < ceiling but
 * `Buffer.byteLength` > ceiling) / STATE (`enabled: false` short-circuits
 * regardless of content) / NEGATIVE-BOUNDARY (empty input array, no throw) /
 * REGRESSION (both ceilings breached simultaneously — no short-circuit after
 * the first finding).
 *
 * @spec_ref spec-project-claude-md-content-contract-governance-injected
 * @ac_ref AC-CMC-1
 */

import { describe, it, expect } from "vitest";
import { resolveMemoryFileBudgets, type MemoryFileBudgets } from "@lore/core";

// ─── Local shape mirrors (module under test doesn't exist yet — see header) ─

type MemoryFileRole = "root" | "module";

interface MemoryFileRecord {
  path: string;
  role: MemoryFileRole;
  content: string;
}

interface MemoryFileFinding {
  path: string;
  role: MemoryFileRole;
  kind: "max_lines" | "max_bytes";
  measured: number;
  ceiling: number;
  message: string;
}

type LintMemoryFilesFn = (
  files: MemoryFileRecord[],
  budgets: MemoryFileBudgets,
) => MemoryFileFinding[];

/**
 * Loads `lintMemoryFiles` via a NON-LITERAL dynamic import specifier — see
 * the header comment for why this keeps `tsc --noEmit` green pre-GREEN while
 * still failing loudly (real "Cannot find module") under `vitest run` today.
 * Called fresh inside each `it()` (not hoisted to a shared `beforeAll`) so a
 * missing module fails every scenario individually.
 */
async function loadLintMemoryFiles(): Promise<LintMemoryFilesFn> {
  const modulePathParts = ["..", "..", "..", "src", "service", "claude-md-check.js"];
  const modulePath = modulePathParts.join("/");
  const mod = (await import(modulePath)) as { lintMemoryFiles: LintMemoryFilesFn };
  return mod.lintMemoryFiles;
}

// ─── Fixture builders ───────────────────────────────────────────────────────

/**
 * Produces text content with an EXACT line count and an EXACT
 * `Buffer.byteLength` (UTF-8 bytes), by padding the final line with
 * single-byte ASCII filler. Both metrics are controlled independently and
 * simultaneously — required for the ceiling±1-per-metric boundary scenarios,
 * since a naive "just repeat N lines" fixture can't hit an exact byte target.
 */
function buildFixture(lineCount: number, byteCount: number): string {
  if (lineCount < 1) {
    throw new Error(`buildFixture: lineCount must be >= 1, got ${lineCount}`);
  }
  const rows: string[] = [];
  for (let i = 1; i <= lineCount; i++) {
    rows.push(`Line ${i}: standing discipline entry, not a status narrative.`);
  }
  let content = rows.join("\n") + "\n";
  const baseBytes = Buffer.byteLength(content, "utf8");
  if (baseBytes > byteCount) {
    throw new Error(
      `buildFixture: base content (${baseBytes} bytes) already exceeds requested byteCount ` +
        `(${byteCount}) for lineCount=${lineCount}; adjust the row template`,
    );
  }
  const deficit = byteCount - baseBytes;
  if (deficit > 0) {
    // Pad within the LAST line, before its trailing "\n" — never inserts a
    // newline, so line count is unaffected. ASCII 'x' is exactly 1 byte.
    content = content.slice(0, -1) + "x".repeat(deficit) + "\n";
  }
  return content;
}

/**
 * A single-line, multibyte CJK content fixture — the UTF-8-correctness
 * false-oracle-killer case (spec §D2 / Module Boundary): `charCount` copies
 * of a 3-byte-UTF-8 CJK character (each exactly 1 UTF-16 code unit), so
 * `content.length` (UTF-16 code units — what a naive `.length`-based lint
 * would measure) undercounts the real `Buffer.byteLength` by ~3x. A lint
 * that measured `.length` instead of `Buffer.byteLength` would silently miss
 * a real max_bytes ceiling breach on CJK-heavy prose.
 */
function cjkFixture(charCount: number): string {
  const CJK_CHAR = "测"; // U+6D4B — 1 UTF-16 code unit, 3 UTF-8 bytes.
  return CJK_CHAR.repeat(charCount) + "\n";
}

// ─── Scenarios ──────────────────────────────────────────────────────────────

describe("lintMemoryFiles boundary suite (RED — packages/lore/src/service/claude-md-check.ts does not exist yet)", () => {
  const budgets: MemoryFileBudgets = resolveMemoryFileBudgets(undefined);

  it("BOUNDARY (under, both metrics): root file at exactly max_lines-1 lines and max_bytes-1 bytes -> zero findings", async () => {
    const lintMemoryFiles = await loadLintMemoryFiles();

    const lineCount = budgets.root.max_lines - 1;
    const byteCount = budgets.root.max_bytes - 1;
    const content = buildFixture(lineCount, byteCount);
    // Self-check: the fixture actually sits at the intended boundary, not
    // some other value the builder silently drifted to.
    expect(Buffer.byteLength(content, "utf8")).toBe(byteCount);

    const findings = lintMemoryFiles(
      [{ path: "CLAUDE.md", role: "root", content }],
      budgets,
    );

    expect(findings).toEqual([]);
  });

  it("BOUNDARY (over, max_lines only): root file at max_lines+1 -> exactly one max_lines finding naming the path", async () => {
    const lintMemoryFiles = await loadLintMemoryFiles();

    const lineCount = budgets.root.max_lines + 1;
    // Keep bytes comfortably under the root byte ceiling so ONLY max_lines
    // trips — natural short-row content is nowhere near 30720 bytes at 301
    // rows (~12KB), so no padding/exact-byte-targeting is needed here.
    const content = buildFixture(lineCount, budgets.root.max_bytes - 1000);

    const findings = lintMemoryFiles(
      [{ path: "CLAUDE.md", role: "root", content }],
      budgets,
    );

    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.kind).toBe("max_lines");
    expect(finding?.role).toBe("root");
    expect(finding?.measured).toBe(lineCount);
    expect(finding?.ceiling).toBe(budgets.root.max_lines);
    expect(finding?.message).toContain("CLAUDE.md");
  });

  it("UTF-8 correctness (false-oracle killer): module file over the byte ceiling via CJK content whose .length is UNDER the ceiling -> a max_bytes finding", async () => {
    const lintMemoryFiles = await loadLintMemoryFiles();

    // 6000 CJK chars: content.length ~6001 (well under the 16384 module byte
    // ceiling — the false-oracle condition), Buffer.byteLength ~18001 (well
    // OVER it). Single line, so module max_lines (200) is nowhere near
    // tripped — this fixture isolates the max_bytes signal.
    const content = cjkFixture(6000);
    const path = "packages/dashboard/CLAUDE.md";

    // Self-check: pin the exact false-oracle condition this scenario exists
    // to catch, independent of whatever lintMemoryFiles itself does.
    expect(content.length).toBeLessThan(budgets.module.max_bytes);
    expect(Buffer.byteLength(content, "utf8")).toBeGreaterThan(budgets.module.max_bytes);

    const findings = lintMemoryFiles([{ path, role: "module", content }], budgets);

    expect(findings.some((f) => f.kind === "max_bytes")).toBe(true);
    const bytesFinding = findings.find((f) => f.kind === "max_bytes");
    expect(bytesFinding?.role).toBe("module");
    expect(bytesFinding?.measured).toBe(Buffer.byteLength(content, "utf8"));
    expect(bytesFinding?.ceiling).toBe(budgets.module.max_bytes);
    expect(bytesFinding?.message).toContain(path);
  });

  it("STATE: budgets.enabled=false suppresses all findings even for a grossly oversized file", async () => {
    const lintMemoryFiles = await loadLintMemoryFiles();

    const disabledBudgets: MemoryFileBudgets = { ...budgets, enabled: false };
    // Deliberately oversized on BOTH metrics for the root role — proves the
    // enabled flag suppresses the check rather than the fixture happening to
    // already be compliant.
    const content = buildFixture(
      disabledBudgets.root.max_lines + 100,
      disabledBudgets.root.max_bytes + 1000,
    );

    const findings = lintMemoryFiles(
      [{ path: "CLAUDE.md", role: "root", content }],
      disabledBudgets,
    );

    expect(findings).toEqual([]);
  });

  it("NEGATIVE/BOUNDARY: empty files array -> zero findings, no throw", async () => {
    const lintMemoryFiles = await loadLintMemoryFiles();

    expect(() => {
      const findings = lintMemoryFiles([], budgets);
      expect(findings).toEqual([]);
    }).not.toThrow();
  });

  it("REGRESSION (no short-circuit): a file over BOTH ceilings -> two findings, one per kind", async () => {
    const lintMemoryFiles = await loadLintMemoryFiles();

    const lineCount = budgets.root.max_lines + 1;
    const byteCount = budgets.root.max_bytes + 1;
    const content = buildFixture(lineCount, byteCount);
    expect(Buffer.byteLength(content, "utf8")).toBe(byteCount);

    const findings = lintMemoryFiles(
      [{ path: "CLAUDE.md", role: "root", content }],
      budgets,
    );

    expect(findings).toHaveLength(2);
    const kinds = findings.map((f) => f.kind).sort();
    expect(kinds).toEqual(["max_bytes", "max_lines"]);

    const linesFinding = findings.find((f) => f.kind === "max_lines");
    expect(linesFinding?.measured).toBe(lineCount);
    expect(linesFinding?.ceiling).toBe(budgets.root.max_lines);

    const bytesFinding = findings.find((f) => f.kind === "max_bytes");
    expect(bytesFinding?.measured).toBe(byteCount);
    expect(bytesFinding?.ceiling).toBe(budgets.root.max_bytes);
  });
});
