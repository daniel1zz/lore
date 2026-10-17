// @reads packages/lore/tests/integration/spec-loop-e2e.bun.test.ts
/**
 * Unit tests for the repo-corpus pollution guard's pure predicate (SPEC-OX D3,
 * AC-OX-2). Drives BOTH directions — accepts a clean tree, rejects a dirty one under
 * EITHER `.lore/` or `docs/requirements/**` — entirely from literal `git status
 * --short` text, without touching a real git working tree. That is the whole point
 * of extracting the decision out of `spec-loop-e2e.bun.test.ts`'s `execSync` call:
 * the widening (`docs/requirements` was previously invisible to the guard) can be
 * proven here without dirtying the repo's real corpus.
 *
 * Coverage dimensions:
 *   HAPPY      — empty (and whitespace-only) `git status --short` output verdicts
 *                clean.
 *   NEGATIVE   — a `docs/requirements/**` line verdicts dirty and names that exact
 *                path: the case the PRE-WIDENING guard (scoped to only `.lore`)
 *                accepted, which is the whole reason this predicate exists. Written
 *                and run FIRST against the un-widened predicate to record a genuine
 *                red (see task evidence: `expected-fail` recorded before the
 *                `isInCorpusScope` widening landed).
 *   BOUNDARY   — every porcelain status prefix shape (` M`, `??`, staged `A `, and a
 *                rename's `R  old -> new`, which names TWO paths on one line) and a
 *                path OUTSIDE both scopes, which must NOT be reported.
 *   ERROR      — malformed/too-short lines are dropped, never thrown, and never
 *                corrupt the parse of the well-formed lines around them.
 *   STATE      — multiple simultaneous offenders (both scopes dirty at once) are ALL
 *                returned, not just the first; and the function is pure/deterministic
 *                (same input twice yields equal, independently-owned results).
 *   REGRESSION — a `.lore/` line still verdicts dirty after the widening (the
 *                pre-existing behaviour this task must not break).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { checkRepoPollution } from "../../src/repo-pollution-guard.js";

/**
 * Path to the e2e WIRING file (SPEC-OX D3, AC-OX-2) — the OTHER file, never this
 * one. Reading a distinct file (rather than this test file's own source) is what
 * keeps the assertions below non-vacuous: a `toContain` over this file's own
 * literals would trivially match its own copy of the same strings.
 */
const E2E_WIRING_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "integration",
  "spec-loop-e2e.bun.test.ts",
);

describe("checkRepoPollution", () => {
  // ── NEGATIVE: this is the case the pre-widening guard could not see — written
  // FIRST and run against the un-widened predicate to record a genuine red before
  // the widening landed (SPEC-OX D3 red-first discipline). ──
  it("NEGATIVE: a docs/requirements/** line verdicts dirty and names the exact path — the case the pre-widening guard accepted", () => {
    const line = " M docs/requirements/spec/spec-105-oracle-exclusivity.md";
    const verdict = checkRepoPollution(line);
    expect(verdict.clean).toBe(false);
    expect(verdict.offendingPaths).toEqual(["docs/requirements/spec/spec-105-oracle-exclusivity.md"]);
  });

  it("HAPPY: empty git status --short output verdicts clean with no offending paths", () => {
    const verdict = checkRepoPollution("");
    expect(verdict).toEqual({ clean: true, offendingPaths: [] });
  });

  it("HAPPY: whitespace-only output (blank lines, no actual entries) also verdicts clean", () => {
    const verdict = checkRepoPollution("\n\n   \n");
    expect(verdict).toEqual({ clean: true, offendingPaths: [] });
  });

  it("REGRESSION: a .lore/ line still verdicts dirty after the widening (pre-existing behaviour must not regress)", () => {
    const line = " M .lore/export-index.json";
    const verdict = checkRepoPollution(line);
    expect(verdict.clean).toBe(false);
    expect(verdict.offendingPaths).toEqual([".lore/export-index.json"]);
  });

  it("BOUNDARY: every porcelain status prefix (' M', '??', staged 'A ') parses to its bare path", () => {
    const output = [
      " M docs/requirements/spec/spec-001-foo.md",
      "?? docs/requirements/task/task-999-new.md",
      "A  .lore/audit-anchor.json",
    ].join("\n");
    const verdict = checkRepoPollution(output);
    expect(verdict.clean).toBe(false);
    expect(verdict.offendingPaths).toEqual([
      "docs/requirements/spec/spec-001-foo.md",
      "docs/requirements/task/task-999-new.md",
      ".lore/audit-anchor.json",
    ]);
  });

  it("BOUNDARY: a rename line names BOTH the old and new path, in the correct order — a naive parser reports the wrong one", () => {
    const line =
      "R  docs/requirements/spec/spec-001-old-name.md -> docs/requirements/spec/spec-001-new-name.md";
    const verdict = checkRepoPollution(line);
    expect(verdict.clean).toBe(false);
    expect(verdict.offendingPaths).toEqual([
      "docs/requirements/spec/spec-001-old-name.md",
      "docs/requirements/spec/spec-001-new-name.md",
    ]);
  });

  it("BOUNDARY: a path outside both corpus scopes is NOT reported, even though the line is well-formed", () => {
    const output = [" M src/repo-pollution-guard.ts", " M docs/requirements/spec/spec-001-foo.md"].join(
      "\n",
    );
    const verdict = checkRepoPollution(output);
    expect(verdict.clean).toBe(false);
    // Only the in-scope path is reported — the out-of-scope src/ edit is dropped.
    expect(verdict.offendingPaths).toEqual(["docs/requirements/spec/spec-001-foo.md"]);
  });

  it("ERROR: a malformed line shorter than a status-code-plus-path pair is dropped, not thrown", () => {
    const output = ["M", " M docs/requirements/spec/spec-002-bar.md"].join("\n");
    expect(() => checkRepoPollution(output)).not.toThrow();
    const verdict = checkRepoPollution(output);
    expect(verdict.offendingPaths).toEqual(["docs/requirements/spec/spec-002-bar.md"]);
  });

  it("STATE: both scopes dirty at once returns ALL offending paths, not just the first", () => {
    const output = [
      " M .lore/export-index.json",
      " M docs/requirements/spec/spec-001-foo.md",
      "?? docs/requirements/plan/plan-002-bar.md",
    ].join("\n");
    const verdict = checkRepoPollution(output);
    expect(verdict.clean).toBe(false);
    expect(verdict.offendingPaths).toEqual([
      ".lore/export-index.json",
      "docs/requirements/spec/spec-001-foo.md",
      "docs/requirements/plan/plan-002-bar.md",
    ]);
  });

  it("STATE: the predicate is pure — calling it twice with the same input yields equal, independently-owned results", () => {
    const input = " M docs/requirements/spec/spec-001-foo.md";
    const first = checkRepoPollution(input);
    const second = checkRepoPollution(input);
    expect(first).toEqual(second);
    expect(first.offendingPaths).not.toBe(second.offendingPaths); // distinct array instances
  });
});

/**
 * AC-OX-2 revision (2026-08-11, in-flight): SPEC-061's attestation-completeness
 * guard counts every test-file-shaped argv token in an AC's declared command, so a
 * command pairing `grep ... spec-loop-e2e.bun.test.ts` with `bun test
 * repo-pollution-guard.bun.test.ts` declared TWO paths against ONE executed file and
 * `lore verify` returned `inconclusive`. Fix: the grep assertion moves IN here — this
 * unit suite reads the e2e wiring file's source and asserts its shape directly, so
 * AC-OX-2's declared command names exactly one path and runs on every `bun run test`.
 *
 * ⛔ Vacuity trap: read the OTHER file (`spec-loop-e2e.bun.test.ts`), never this
 * file's own source — a `toContain` over this file would trivially match its own
 * copy of the same literal strings.
 */
describe("e2e wiring (packages/lore/tests/integration/spec-loop-e2e.bun.test.ts)", () => {
  const e2eSource = readFileSync(E2E_WIRING_PATH, "utf8");

  it("names the WIDENED invocation — git status --short .lore docs/requirements — not just the pre-widening .lore-only form", () => {
    expect(e2eSource).toContain("git status --short .lore docs/requirements");
  });

  it("wires the guard at FILE scope: beforeAll/afterAll at column 0, never nested inside a describe block", () => {
    // Column-0 (no leading whitespace) is what makes a hook wrap the WHOLE file's
    // test run rather than only one describe's own tests — the exact defect found
    // in the pre-change guard, whose it() never actually ran "before" despite its
    // name. A hook indented under a describe would fail this pattern.
    expect(/^beforeAll\(\(\) => \{$/m.test(e2eSource)).toBe(true);
    expect(/^afterAll\(\(\) => \{$/m.test(e2eSource)).toBe(true);
  });

  it("the file-scope beforeAll drives the \"before\" phase and afterAll drives the \"after\" phase", () => {
    expect(e2eSource).toContain('assertRepoCorpusClean("before")');
    expect(e2eSource).toContain('assertRepoCorpusClean("after")');
  });
});
