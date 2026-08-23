/**
 * RED-phase TDD tests for AC-CTX-2 — the admission-check extension to
 * `packages/lore/src/service/claude-md-check.ts`
 * (task-skill-test-red-admission-check-suite-for-reference; the paired
 * implementation task is a sibling in the same plan). This suite is
 * AC-CTX-2's script target verbatim:
 *   `bunx vitest run packages/lore/tests/unit/service/claude-md-admission.test.ts`
 *
 * Two functions under test do NOT exist yet in this worktree (confirmed
 * empirically before writing this file: `claude-md-check.ts` currently
 * exports only `lintMemoryFiles` + its supporting types — no
 * `checkReferenceExistence`, no `detectNarrativeSmells`):
 *   - `checkReferenceExistence(content, fileExists)` — deterministic,
 *     `kind: "reference_missing"`.
 *   - `detectNarrativeSmells(content)` — advisory, never exit-affecting.
 *
 * Typecheck strategy (the paired implementation task must land with
 * `bun run typecheck` green even before these two functions exist): unlike
 * the sibling AC-CMC-1 RED suite (`claude-md-check.test.ts`), the TARGET
 * MODULE FILE already exists here (`lintMemoryFiles` is real and
 * implemented) — so a literal static `import { checkReferenceExistence }
 * from "../../../src/service/claude-md-check.js"` would NOT fail on missing
 * module resolution; it would fail with TS2305 "Module has no exported
 * member 'checkReferenceExistence'", which DOES break `tsc --noEmit`. The
 * fix mirrors the sibling suite's dodge one level down: build the module
 * specifier from a `string[]` via `.join("/")` inside a dynamic `import()`.
 * TypeScript's `import()` type-checker only resolves and validates named
 * members for a LITERAL specifier; a non-literal `string`-typed specifier
 * resolves the whole import to `Promise<any>` — module resolution still
 * happens at runtime (the file DOES exist, so no "Cannot find module"), but
 * named-export validation is skipped entirely at compile time, and the `as
 * {...}` cast below is accepted unconditionally since the source type is
 * `any`. At runtime, `mod.checkReferenceExistence` / `mod.detectNarrativeSmells`
 * are `undefined` (real absent exports) — calling either throws
 * `TypeError: ... is not a function`, which is the correct RED failure
 * reason for every scenario below (missing exports, not a test bug).
 * `lintMemoryFiles` itself IS statically imported (it exists today) — this
 * also doubles as the REGRESSION co-existence check.
 *
 * Reference grammar under test (spec §D6 / Module Boundary, v1): a
 * candidate is a BACKTICK-quoted token that contains `/`, has no
 * whitespace, and does not start with a URL scheme (`https://` etc.). A
 * `#Symbol` suffix is a fragment on top of a file path — existence is
 * checked against the file part only. Existence is decided EXCLUSIVELY by
 * the injected `fileExists` predicate (never real `fs` access) — every
 * fixture below uses a `vi.fn` stand-in so call arguments are inspectable.
 *
 * Coverage dimensions: HAPPY (missing/existing single reference) / NEGATIVE
 * (URL scheme, no-slash backtick token, non-backtick prose path) / BOUNDARY
 * (trailing-slash directory, `#Symbol` suffix, multiple refs per line) /
 * ERROR (empty content, no throw) / STATE-independence (detectNarrativeSmells
 * never mutates or leaks into checkReferenceExistence's result; ISO-date-dense
 * vs. clean-discipline smell fixtures) / REGRESSION (lintMemoryFiles
 * untouched, still importable and functioning from the SAME module file).
 *
 * @spec_ref spec-context-verb-family-two-zone-claude-md-anatomy-lore
 * @ac_ref AC-CTX-2
 */

import { describe, it, expect, vi } from "vitest";
import { resolveMemoryFileBudgets, type MemoryFileBudgets } from "@lore/core";
import { lintMemoryFiles } from "../../../src/service/claude-md-budget.js";
import type { MemoryFileRecord } from "../../../src/service/claude-md-findings.js";

// ─── Local shape mirrors for the NOT-YET-EXISTING exports ──────────────────
//
// Deliberately loose (extra unknown fields tolerated) — this suite pins the
// behavioral contract (kind, message-names-the-path, array shape,
// non-mutation), NOT the implementer's exact field layout for fields the
// spec leaves open (e.g. whether a reference finding carries `role`).

interface ReferenceMissingFinding {
  kind: string;
  message: string;
  [key: string]: unknown;
}

interface AdvisoryFinding {
  kind: string;
  message: string;
  [key: string]: unknown;
}

type CheckReferenceExistenceFn = (
  content: string,
  fileExists: (p: string) => boolean,
) => ReferenceMissingFinding[];

type DetectNarrativeSmellsFn = (content: string) => AdvisoryFinding[];

/**
 * Loads `checkReferenceExistence` + `detectNarrativeSmells` via a
 * NON-LITERAL dynamic import specifier — see the header comment for why
 * this keeps `tsc --noEmit` green pre-GREEN (module exists, exports don't)
 * while still failing loudly ("... is not a function") under `vitest run`
 * today. Called fresh inside each `it()` (not hoisted to a shared
 * `beforeAll`) so a missing export fails every scenario individually,
 * matching this task's AC: "every case fails on the missing export ... not
 * test bugs".
 */
async function loadAdmissionFns(): Promise<{
  checkReferenceExistence: CheckReferenceExistenceFn;
  detectNarrativeSmells: DetectNarrativeSmellsFn;
}> {
  // reason: split away from claude-md-check.js (spec-claude-md-governance-
  // content-dimension-checks-wire-the, N12) — both functions now live in
  // claude-md-admission.ts. Kept as a non-literal `.join("/")` specifier to
  // minimize this pinned RED test's diff — see the module header for why
  // the dodge exists.
  const modulePathParts = ["..", "..", "..", "src", "service", "claude-md-admission.js"];
  const modulePath = modulePathParts.join("/");
  const mod = (await import(modulePath)) as {
    checkReferenceExistence: CheckReferenceExistenceFn;
    detectNarrativeSmells: DetectNarrativeSmellsFn;
  };
  return {
    checkReferenceExistence: mod.checkReferenceExistence,
    detectNarrativeSmells: mod.detectNarrativeSmells,
  };
}

// ─── Fixture builders ───────────────────────────────────────────────────────

/**
 * A `fileExists` stand-in resolving TRUE only for paths in `existing` —
 * exact string match, call-tracked via `vi.fn` so tests can assert exactly
 * which candidate strings the implementation extracted and probed. Never
 * touches real `fs` — this is the whole point of the injected-predicate
 * design (purity, spec §D6).
 */
function makeFileExists(existing: string[]): ((p: string) => boolean) & {
  mock: { calls: unknown[][] };
} {
  const set = new Set(existing);
  return vi.fn((p: string) => set.has(p));
}

/** Paragraph dense with ISO-date (`2026-07-27`-style) narrative — the
 * status-narrative smell this admission check exists to flag. */
const ISO_DATE_DENSE_PARAGRAPH =
  "On 2026-07-20 we shipped the first cut. By 2026-07-22 a regression " +
  "surfaced and was triaged. It stayed pending until 2026-07-25, when a " +
  "fix landed. We re-verified on 2026-07-27 and closed it out.";

/** A clean standing-discipline paragraph — no dates, no status words —
 * the negative control for narrative-smell detection. */
const CLEAN_DISCIPLINE_PARAGRAPH =
  "Every business-logic file must carry a matching test file covering all " +
  "six dimensions: happy, negative, boundary, error, state, and regression. " +
  "External oracles decide pass or fail — never self-assertion.";

// ─── Scenarios ──────────────────────────────────────────────────────────────

describe("checkReferenceExistence + detectNarrativeSmells admission suite (RED — exports absent from packages/lore/src/service/claude-md-check.ts)", () => {
  describe("checkReferenceExistence", () => {
    it("HAPPY: missing backtick-quoted repo-relative path -> exactly one reference_missing finding naming the path", async () => {
      const { checkReferenceExistence } = await loadAdmissionFns();

      const path = "packages/lore/src/service/nonexistent-module.ts";
      const content = `Read \`${path}\` before editing this area.`;
      const fileExists = makeFileExists([]); // nothing exists

      const findings = checkReferenceExistence(content, fileExists);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.kind).toBe("reference_missing");
      expect(findings[0]?.message).toContain(path);
    });

    it("HAPPY: existing backtick-quoted path (predicate true) -> silent", async () => {
      const { checkReferenceExistence } = await loadAdmissionFns();

      const path = "packages/lore/src/service/claude-md-check.ts";
      const content = `See \`${path}\` for the lint implementation.`;
      const fileExists = makeFileExists([path]);

      const findings = checkReferenceExistence(content, fileExists);

      expect(findings).toEqual([]);
    });

    it("NEGATIVE: a `https://...` URL in backticks -> silent regardless of predicate", async () => {
      const { checkReferenceExistence } = await loadAdmissionFns();

      const content = "See `https://example.com/packages/lore/src/index.ts` for reference.";
      const fileExists = makeFileExists([]); // predicate would say "missing" for everything

      const findings = checkReferenceExistence(content, fileExists);

      expect(findings).toEqual([]);
    });

    it("NEGATIVE: backtick token without '/' (bare command name) -> silent", async () => {
      const { checkReferenceExistence } = await loadAdmissionFns();

      const content = "Run `lore` to check status.";
      const fileExists = makeFileExists([]);

      const findings = checkReferenceExistence(content, fileExists);

      expect(findings).toEqual([]);
    });

    it("NEGATIVE: backtick token with a space (shell command, not a path) -> silent", async () => {
      const { checkReferenceExistence } = await loadAdmissionFns();

      const content = "Run `bun install` first.";
      const fileExists = makeFileExists([]);

      const findings = checkReferenceExistence(content, fileExists);

      expect(findings).toEqual([]);
    });

    it("NEGATIVE: non-backtick plain-prose path -> silent (v1 grammar is backtick-only)", async () => {
      const { checkReferenceExistence } = await loadAdmissionFns();

      // Deliberately NOT wrapped in backticks, and deliberately nonexistent
      // (fileExists always false) -- if the grammar reached beyond
      // backtick-quoted tokens this would wrongly fire.
      const content = "See packages/lore/src/service/does-not-exist.ts for the entry point.";
      const fileExists = makeFileExists([]);

      const findings = checkReferenceExistence(content, fileExists);

      expect(findings).toEqual([]);
    });

    it("BOUNDARY: trailing-slash directory reference -> fires when predicate says missing, silent when predicate says exists", async () => {
      const { checkReferenceExistence } = await loadAdmissionFns();

      const dirPath = "packages/lore/src/service/nonexistent-dir/";
      const content = `See \`${dirPath}\` for the module layout.`;

      const missingFindings = checkReferenceExistence(content, makeFileExists([]));
      expect(missingFindings).toHaveLength(1);
      expect(missingFindings[0]?.kind).toBe("reference_missing");
      expect(missingFindings[0]?.message).toContain("nonexistent-dir");

      const existingFindings = checkReferenceExistence(content, makeFileExists([dirPath]));
      expect(existingFindings).toEqual([]);
    });

    it("BOUNDARY: `#Symbol` suffix -> existence is checked against the FILE PART only", async () => {
      const { checkReferenceExistence } = await loadAdmissionFns();

      const filePart = "packages/lore/src/service/claude-md-check.ts";
      const content = `See \`${filePart}#checkReferenceExistence\` for the contract.`;

      const existsFileExists = makeFileExists([filePart]);
      const existingFindings = checkReferenceExistence(content, existsFileExists);
      expect(existingFindings).toEqual([]);
      // Prove the predicate was probed with the file part (fragment
      // stripped), not the raw "file#Symbol" token verbatim.
      const probedArgs = (existsFileExists as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
        (call) => call[0],
      );
      expect(probedArgs).toContain(filePart);
      expect(probedArgs).not.toContain(`${filePart}#checkReferenceExistence`);

      const missingFileExists = makeFileExists([]); // file part does not exist
      const missingFindings = checkReferenceExistence(content, missingFileExists);
      expect(missingFindings).toHaveLength(1);
      expect(missingFindings[0]?.kind).toBe("reference_missing");
      expect(missingFindings[0]?.message).toContain(filePart);
    });

    it("BOUNDARY: multiple references in one line -> only the missing one fires, the existing one stays silent", async () => {
      const { checkReferenceExistence } = await loadAdmissionFns();

      const existingPath = "packages/lore/src/service/existing-ref.ts";
      const missingPath = "packages/lore/src/service/missing-ref.ts";
      const content = `See \`${existingPath}\` and \`${missingPath}\` together.`;
      const fileExists = makeFileExists([existingPath]);

      const findings = checkReferenceExistence(content, fileExists);

      expect(findings).toHaveLength(1);
      expect(findings[0]?.kind).toBe("reference_missing");
      expect(findings[0]?.message).toContain(missingPath);
      expect(findings[0]?.message).not.toContain(existingPath);
    });

    it("ERROR: empty content -> empty findings array, no throw", async () => {
      const { checkReferenceExistence } = await loadAdmissionFns();
      const fileExists = makeFileExists([]);

      expect(() => {
        const findings = checkReferenceExistence("", fileExists);
        expect(findings).toEqual([]);
      }).not.toThrow();
    });
  });

  describe("detectNarrativeSmells", () => {
    it("HAPPY: ISO-date-dense narrative paragraph fires at least one advisory finding", async () => {
      const { detectNarrativeSmells } = await loadAdmissionFns();

      const findings = detectNarrativeSmells(ISO_DATE_DENSE_PARAGRAPH);

      expect(Array.isArray(findings)).toBe(true);
      expect(findings.length).toBeGreaterThan(0);
    });

    it("NEGATIVE: a clean standing-discipline paragraph (no dates, no status words) -> zero advisory findings", async () => {
      const { detectNarrativeSmells } = await loadAdmissionFns();

      const findings = detectNarrativeSmells(CLEAN_DISCIPLINE_PARAGRAPH);

      expect(findings).toEqual([]);
    });

    it("ERROR: empty content -> empty findings array, no throw", async () => {
      const { detectNarrativeSmells } = await loadAdmissionFns();

      expect(() => {
        const findings = detectNarrativeSmells("");
        expect(findings).toEqual([]);
      }).not.toThrow();
    });
  });

  describe("STATE/independence: advisory findings never alter or leak into deterministic findings", () => {
    it("calling detectNarrativeSmells between two checkReferenceExistence calls on the same input does not mutate the deterministic result", async () => {
      const { checkReferenceExistence, detectNarrativeSmells } = await loadAdmissionFns();

      const path = "packages/lore/src/service/nonexistent-module.ts";
      const content = `Read \`${path}\` before editing this area, as of 2026-07-27.`;
      const fileExists = makeFileExists([]);

      const before = checkReferenceExistence(content, fileExists);
      expect(before).toHaveLength(1);
      expect(before[0]?.kind).toBe("reference_missing");

      // Advisory pass in between — must be side-effect-free w.r.t. the
      // deterministic check (separate finding families, spec §D7).
      const smells = detectNarrativeSmells(content);
      expect(Array.isArray(smells)).toBe(true);

      const after = checkReferenceExistence(content, fileExists);
      expect(after).toEqual(before);
      // The deterministic finding family is never smuggled into (or
      // replaced by) the advisory one.
      expect(after.every((f) => f.kind === "reference_missing")).toBe(true);
      expect(smells.every((f) => f.kind !== "reference_missing")).toBe(true);
    });
  });

  describe("REGRESSION: lintMemoryFiles (existing AC-CMC-1 behavior) stays untouched by this module's extension", () => {
    it("an oversized root file still produces exactly one max_lines finding via the SAME module file", () => {
      const budgets: MemoryFileBudgets = resolveMemoryFileBudgets(undefined);

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
      expect(findings[0]?.message).toContain("CLAUDE.md");
    });
  });
});
