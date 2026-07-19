/**
 * RED suite (TDD-Role: red, paired-impl task-skill-implement-core-phase-ts-phase-
 * completion-ts-schemas-w) for `@lore/core`'s `phase.ts` — a module that does NOT
 * exist yet. Covers AC-P-2 (spec-spec-056): `assertScopeFreeze` matched-pair
 * (反向对照 discipline) — removal of an AC id that already has evidence referencing
 * it returns err, AND an additive edit (no evidenced id removed) returns ok, both
 * exercised against the SAME base fixture so the two assertions are a genuine
 * contrast, not two independently-plausible tests.
 *
 * RED mechanism (deliberate — see `knowledge-spec-058-execution-learnings-init-
 * seeding-yaml-trap-co` §2): the module under test is loaded via a dynamic
 * `import()` whose specifier is a COMPUTED (non-literal) string built from an
 * array `.join("/")`. TypeScript only statically resolves `import()` calls with a
 * string-literal argument, so `bun run typecheck` stays green today (before
 * `packages/core/src/phase.ts` exists) and after it lands, with zero edits to this
 * file either way. At runtime today the import genuinely throws inside
 * `beforeAll` ("Cannot find module"), which vitest reports as every `it` in this
 * file failing due to a failed hook — the intended RED signal.
 *
 * CONTRACT NOTE (this file is the authoritative shape the paired implement task
 * must satisfy):
 *   - `assertScopeFreeze(prev: string[], next: string[], evidence: EvidenceEntry[])
 *     -> Result<void, LoreError>` — matches SPEC-056's Public Interface sketch
 *     exactly (`EvidenceEntry` is the existing SPEC-025/038/039 type, imported
 *     statically from `@lore/core` — it already exists, unlike `phase.ts`).
 *   - "Removal of an evidenced id" means: an id present in `prev` but absent from
 *     `next`, where at least one entry in `evidence` has `ac_ref` equal to that
 *     id. That removal is rejected with a `VALIDATION_ERROR` result.
 *   - Removing an id with NO evidence referencing it is allowed (ok) — the
 *     invariant guards evidenced ids specifically, not "any shrink."
 *   - A purely additive edit (every `prev` id retained in `next`, zero or more new
 *     ids appended) is always ok, regardless of evidence.
 *   - `ok` results carry `value: undefined` (`Result<void, LoreError>`).
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Public Interface, §Design Decisions D4, §Acceptance Criteria AC-P-2.
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { EvidenceEntry, Result, LoreError } from "@lore/core";

// packages/lore/tests/unit/core/ -> ../../../../ -> packages/ -> core/src/phase.js
const PHASE_MODULE_PATH = ["..", "..", "..", "..", "core", "src", "phase.js"].join("/");

interface PhaseModule {
  assertScopeFreeze: (prev: string[], next: string[], evidence: EvidenceEntry[]) => Result<void, LoreError>;
}

let mod: PhaseModule;

beforeAll(async () => {
  mod = (await import(PHASE_MODULE_PATH)) as unknown as PhaseModule;
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

function evidenceFor(acRef: string, result: "pass" | "fail" = "pass"): EvidenceEntry {
  return {
    oracle: "test",
    command: `bun test ${acRef}`,
    result,
    recorded_at: "2026-07-19T10:00:00.000Z",
    recorded_by: "alice",
    ac_ref: acRef,
  };
}

/** Evidence entry carrying no `ac_ref` at all — must never block any removal. */
function evidenceWithoutRef(): EvidenceEntry {
  return {
    oracle: "test",
    command: "bun test unrelated",
    result: "pass",
    recorded_at: "2026-07-19T10:00:00.000Z",
    recorded_by: "alice",
  };
}

const BASE_PREV = ["AC-1", "AC-2"];
const BASE_EVIDENCE = [evidenceFor("AC-1")];

function expectOk(result: Result<void, LoreError>): void {
  expect(result.ok).toBe(true);
}

function expectErr(result: Result<void, LoreError>): LoreError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected err result, got ok");
  return result.error;
}

// ─── AC-P-2: matched pair (反向对照), SAME base fixture ──────────────────────

describe("assertScopeFreeze — matched pair on the SAME fixture (removal-blocked vs additive-allowed)", () => {
  it("removing AC-1 (has evidence referencing it) from BASE_PREV/BASE_EVIDENCE returns err", () => {
    const next = ["AC-2"]; // AC-1 dropped
    const error = expectErr(mod.assertScopeFreeze(BASE_PREV, next, BASE_EVIDENCE));
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("additively editing BASE_PREV/BASE_EVIDENCE (AC-1 and AC-2 both retained, AC-3 appended) returns ok", () => {
    const next = ["AC-1", "AC-2", "AC-3"]; // nothing removed, one appended
    expectOk(mod.assertScopeFreeze(BASE_PREV, next, BASE_EVIDENCE));
  });
});

// ─── NEGATIVE: removal is only blocked when evidence exists ─────────────────

describe("assertScopeFreeze — NEGATIVE: removal of a NON-evidenced id is allowed", () => {
  it("removing AC-2 (no evidence entry references it) from BASE_PREV/BASE_EVIDENCE returns ok", () => {
    const next = ["AC-1"]; // AC-2 dropped, but nothing in BASE_EVIDENCE names it
    expectOk(mod.assertScopeFreeze(BASE_PREV, next, BASE_EVIDENCE));
  });

  it("removing an id while unrelated evidence (no ac_ref field at all) is present still returns ok", () => {
    const next: string[] = []; // both removed
    expectOk(mod.assertScopeFreeze(BASE_PREV, next, [evidenceWithoutRef()]));
  });
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────

describe("assertScopeFreeze — BOUNDARY", () => {
  it("a no-op edit (next identical to prev) returns ok even with evidence present", () => {
    expectOk(mod.assertScopeFreeze(BASE_PREV, [...BASE_PREV], BASE_EVIDENCE));
  });

  it("both prev and next empty (never-scoped phase) returns ok", () => {
    expectOk(mod.assertScopeFreeze([], [], []));
  });

  it("first population — prev empty, next non-empty — returns ok", () => {
    expectOk(mod.assertScopeFreeze([], ["AC-1"], []));
  });
});

// ─── STATE: replace (simultaneous remove + add) ──────────────────────────────

describe("assertScopeFreeze — STATE: a replace that removes an evidenced id is still blocked despite the addition", () => {
  it("removing AC-1 (evidenced) while simultaneously adding AC-3 returns err — the addition does not offset the removal", () => {
    const next = ["AC-2", "AC-3"]; // AC-1 removed AND AC-3 added in the same edit
    const error = expectErr(mod.assertScopeFreeze(BASE_PREV, next, BASE_EVIDENCE));
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── REGRESSION: multiple evidence entries for the same id still block removal ─

describe("assertScopeFreeze — REGRESSION: ANY matching evidence entry blocks removal, not just the first", () => {
  it("a failing evidence entry referencing the removed id still blocks removal (result is irrelevant to the freeze check)", () => {
    const next = ["AC-2"];
    const evidence = [evidenceFor("AC-1", "fail")];
    const error = expectErr(mod.assertScopeFreeze(BASE_PREV, next, evidence));
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("multiple evidence entries, only the LAST of which references the removed id, still blocks removal", () => {
    const next = ["AC-2"];
    const evidence = [evidenceWithoutRef(), evidenceFor("AC-2"), evidenceFor("AC-1", "pass")];
    const error = expectErr(mod.assertScopeFreeze(BASE_PREV, next, evidence));
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});
