/**
 * Fixture suite for the literal-vs-regex `-t` filter defect
 * (task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles).
 *
 * Its case titles are REAL, verbatim copies of the two filter strings measured
 * silently matching ZERO cases while the runner exited 0, plus a
 * metacharacter-free control. They exist so
 * `packages/lore/tests/unit/adapters/evidence-literal-filter-guard.test.ts` can
 * spawn a REAL vitest run against a file that genuinely CONTAINS a case by each
 * literal name and assert the MATCHED COUNT the runner itself reports — the
 * literal-vs-regex gap is the whole defect, so a title without the
 * metacharacters would prove nothing (the task's own AC-1).
 *
 * ⛔ Do NOT "tidy" these titles: the parentheses in `AC-2.H1 (GREEN)` and the
 * ` + ` in `real repo tree + real corpus` ARE the test data.
 *
 * ⛔ Deliberately named `*.fixture.ts`, not `*.test.ts`: the root
 * `vitest.config.ts` include globs cover `packages/lore/tests/**\/*.test.ts`,
 * so a `.test.ts` name here would enrol this file in every full-suite run.
 * It is executed only through the sibling `vitest.fixture.config.ts`, by the
 * guard test's own subprocess.
 *
 * Side-effect class: pure (assertions only, no IO).
 */

import { describe, it, expect } from "vitest";

describe("literal AC titles carrying regex metacharacters", () => {
  it("AC-2.H1 (GREEN)", () => {
    expect(true).toBe(true);
  });

  it("real repo tree + real corpus", () => {
    expect(true).toBe(true);
  });

  it("AC-2 metacharacter free control title", () => {
    expect(true).toBe(true);
  });
});
