/**
 * RED suite (TDD-Role: red, paired-impl task-skill-implement-core-phase-ts-phase-
 * completion-ts-schemas-w) for `@lore/core`'s `phase-completion.ts` — a module that
 * does NOT exist yet. Covers AC-P-1 (spec-spec-056): `computePhaseCompletion`, >=16
 * cases across HAPPY (mixed attested+manual) / BOUNDARY (anti-vacuous: empty scope +
 * all-dropped checklist -> "vacuous", distinct from "done") / STATE (overrun re-claim,
 * stale claim mid-phase) / ERROR (malformed acScope entries, negative TTL -> typed
 * err, no throw) / manual-vs-attested labeling.
 *
 * RED mechanism (deliberate — see `knowledge-spec-058-execution-learnings-init-
 * seeding-yaml-trap-co` §2, the repo's documented technique for this exact
 * situation): the module under test is loaded via a dynamic `import()` whose
 * specifier is a COMPUTED (non-literal) string built from an array `.join("/")`
 * rather than a string literal. TypeScript only performs static module resolution
 * against `import()` calls whose argument is a string literal, so `bun run
 * typecheck` stays green today (before `packages/core/src/phase-completion.ts`
 * exists) AND after it lands, with zero edits to this file either way. At runtime
 * today the import genuinely throws ("Cannot find module") inside `beforeAll`,
 * which vitest reports as every `it` in this file failing due to a failed hook —
 * the "import errors against not-yet-existing modules" RED mode this task's AC
 * calls for. Once the implementer creates that file with matching exports,
 * `beforeAll` resolves for real and every assertion runs against the genuine
 * module.
 *
 * CONTRACT NOTE (this file is the authoritative shape the paired implement task
 * must satisfy — SPEC-056's Public Interface sketch is a simplified TS type; the
 * concrete shapes below resolve every ambiguity the sketch leaves open):
 *   - `computePhaseCompletion` returns `Result<PhaseCompletion, LoreError>` (not a
 *     bare `PhaseCompletion`) — AC-P-1 explicitly requires "malformed acScope /
 *     negative TTL -> typed err, no throw", and this codebase's pervasive
 *     Result/LoreError convention (every fallible pure core function) is the
 *     natural fit; VALIDATION_ERROR is the code used for both error cases.
 *   - A checklist item (`ChecklistItemLike` below) carries an OPTIONAL `result:
 *     "pass" | "fail"` for script-bound items — this is a join the CALLER (the
 *     future PhaseWorkflowService/PhaseChecklistService) performs before invoking
 *     this pure function; `computePhaseCompletion` never reaches into evidence
 *     itself for checklist items (only `coverage` is pre-joined the same way, per
 *     the spec's own Public Interface sketch).
 *   - Satisfaction rules exercised by the cases below:
 *     - An acScope AC id is satisfied iff its `AcCoverageFact.attested_pass > 0`
 *       (self-reported-only pass, i.e. `pass > 0 && attested_pass === 0`, does
 *       NOT satisfy a phase-level contract AC — SPEC-039's attested/self-reported
 *       distinction is load-bearing here, not just in `lore ac list` badges).
 *     - A checklist item is satisfied iff `dropped` is set (excluded from
 *       `blocking`, named in `dropped_named`) OR (`bind.kind === "manual"` AND
 *       `checked` is set) OR (`bind.kind === "script"` AND `result === "pass"`).
 *     - `manual_selfattested` lists the ids of manual items that ARE checked
 *       (never script items, regardless of their result).
 *     - `state === "vacuous"` iff `acScope.length === 0` AND every checklist item
 *       (if any) is dropped — DISTINCT from `"done"` even when nothing blocks.
 *     - `state === "done"` iff NOT vacuous AND every acScope id is satisfied AND
 *       every non-dropped checklist item is satisfied.
 *     - `state === "active"` iff not done/vacuous AND `claim` is present and NOT
 *       stale (`now - claim.at <= claimTtlMinutes`, mirroring `isClaimStale`'s
 *       strict `>` staleness boundary from task-workflow.ts).
 *     - `state === "pending"` iff not done/vacuous AND (`claim` is undefined OR
 *       stale).
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Public Interface, §Acceptance Criteria AC-P-1.
 */

import { describe, it, expect, beforeAll } from "vitest";
import type { AcCoverageFact, TaskClaim, Result, LoreError } from "@lore/core";

// packages/lore/tests/unit/core/ -> ../../../../ -> packages/ -> core/src/phase-completion.js
const PHASE_COMPLETION_MODULE_PATH = [
  "..",
  "..",
  "..",
  "..",
  "core",
  "src",
  "phase-completion.js",
].join("/");

type PhaseCompletionState = "pending" | "active" | "done" | "vacuous";

interface PhaseCompletion {
  state: PhaseCompletionState;
  blocking: string[];
  dropped_named: string[];
  manual_selfattested: string[];
}

interface ChecklistItemLike {
  id: string;
  statement: string;
  bind: { kind: "script"; oracle: string; command: string } | { kind: "manual" };
  /** Script-bound items only — pre-joined by the caller; absent = not yet run. */
  result?: "pass" | "fail";
  /** Manual-bound items only — self-attestation marker. */
  checked?: { by: string; at: string };
  /** Either bind kind — required-on-drop. */
  dropped?: { by: string; at: string; reason: string };
}

interface PhaseCompletionInput {
  acScope: string[];
  coverage: AcCoverageFact[];
  checklist: ChecklistItemLike[];
  claim: TaskClaim | undefined;
  claimTtlMinutes: number;
  now: Date;
}

interface PhaseCompletionModule {
  computePhaseCompletion: (input: PhaseCompletionInput) => Result<PhaseCompletion, LoreError>;
}

let mod: PhaseCompletionModule;

beforeAll(async () => {
  mod = (await import(PHASE_COMPLETION_MODULE_PATH)) as unknown as PhaseCompletionModule;
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

function attestedCoverage(acId: string, pass = 1, fail = 0): AcCoverageFact {
  return { ac_id: acId, mode: "script", pass, fail, refs: [], attested_pass: pass, attested_fail: fail };
}

/** Self-reported pass only — NOT runner-attested. Must NOT satisfy the AC. */
function selfReportedCoverage(acId: string): AcCoverageFact {
  return { ac_id: acId, mode: "script", pass: 1, fail: 0, refs: [], attested_pass: 0, attested_fail: 0 };
}

function noCoverage(acId: string): AcCoverageFact {
  return { ac_id: acId, mode: "script", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0 };
}

function manualItem(id: string, checked: boolean): ChecklistItemLike {
  return {
    id,
    statement: `${id} manual gate`,
    bind: { kind: "manual" },
    ...(checked ? { checked: { by: "alice", at: "2026-07-19T10:00:00.000Z" } } : {}),
  };
}

function scriptItem(id: string, result?: "pass" | "fail"): ChecklistItemLike {
  return {
    id,
    statement: `${id} script gate`,
    bind: { kind: "script", oracle: "test", command: `bun test ${id}` },
    ...(result ? { result } : {}),
  };
}

function droppedItem(id: string, kind: "script" | "manual" = "manual", reason = "no longer applicable"): ChecklistItemLike {
  return {
    id,
    statement: `${id} dropped gate`,
    bind: kind === "manual" ? { kind: "manual" } : { kind: "script", oracle: "test", command: `bun test ${id}` },
    dropped: { by: "alice", at: "2026-07-19T10:00:00.000Z", reason },
  };
}

function freshClaim(overrides: Partial<TaskClaim> = {}): TaskClaim {
  return { by: "alice", at: "2026-07-19T09:00:00.000Z", ...overrides };
}

function expectOk(result: Result<PhaseCompletion, LoreError>): PhaseCompletion {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok result, got err: " + JSON.stringify(result));
  return result.value;
}

function expectErr(result: Result<PhaseCompletion, LoreError>): LoreError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected err result, got ok: " + JSON.stringify(result));
  return result.error;
}

// ─── HAPPY: mixed attested script coverage + manual checklist ───────────────

describe("computePhaseCompletion — HAPPY: mixed attested coverage + manual checklist", () => {
  it("acScope fully attested-pass AND a checked manual checklist item yields state=done, empty blocking", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: ["AC-1"],
        coverage: [attestedCoverage("AC-1")],
        checklist: [manualItem("CHK-1", true)],
        claim: freshClaim(),
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.state).toBe("done");
    expect(value.blocking).toEqual([]);
  });

  it("a passing script-bound checklist item satisfies the phase alongside attested AC coverage", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: ["AC-1"],
        coverage: [attestedCoverage("AC-1")],
        checklist: [scriptItem("CHK-1", "pass")],
        claim: freshClaim(),
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.state).toBe("done");
    expect(value.blocking).toEqual([]);
  });

  it("a self-reported-only (non-attested) AC pass does NOT satisfy the scope — still blocking", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: ["AC-1"],
        coverage: [selfReportedCoverage("AC-1")],
        checklist: [],
        claim: freshClaim(),
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.state).not.toBe("done");
    expect(value.blocking).toEqual(["AC-1"]);
  });
});

// ─── manual-vs-attested labeling ─────────────────────────────────────────────

describe("computePhaseCompletion — manual-vs-attested labeling", () => {
  it("manual_selfattested lists exactly the checked manual item ids, excluding script items entirely", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: [],
        coverage: [],
        checklist: [manualItem("CHK-1", true), manualItem("CHK-2", true), scriptItem("CHK-3", "pass")],
        claim: undefined,
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.manual_selfattested.slice().sort()).toEqual(["CHK-1", "CHK-2"]);
  });

  it("an unchecked manual item is blocking and NOT counted in manual_selfattested", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: [],
        coverage: [],
        checklist: [manualItem("CHK-1", false)],
        claim: undefined,
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.manual_selfattested).toEqual([]);
    expect(value.blocking).toEqual(["CHK-1"]);
  });

  it("a dropped manual item is never counted as manual_selfattested even though its bind kind is manual", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: [],
        coverage: [],
        checklist: [droppedItem("CHK-1", "manual")],
        claim: undefined,
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.manual_selfattested).toEqual([]);
  });
});

// ─── BOUNDARY: anti-vacuous ───────────────────────────────────────────────────

describe("computePhaseCompletion — BOUNDARY: anti-vacuous (empty scope + all-dropped checklist)", () => {
  it("empty acScope with every checklist item dropped yields state=vacuous, NEVER done", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: [],
        coverage: [],
        checklist: [droppedItem("CHK-1"), droppedItem("CHK-2", "script")],
        claim: undefined,
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.state).toBe("vacuous");
    expect(value.state).not.toBe("done");
    expect(value.dropped_named.slice().sort()).toEqual(["CHK-1", "CHK-2"]);
  });

  it("empty acScope with an entirely empty checklist ALSO yields state=vacuous (nothing declared at all)", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: [],
        coverage: [],
        checklist: [],
        claim: undefined,
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.state).toBe("vacuous");
  });

  it("empty acScope with a NON-dropped, satisfied checklist item yields state=done, NOT vacuous — proves the distinction", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: [],
        coverage: [],
        checklist: [manualItem("CHK-1", true)],
        claim: freshClaim(),
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.state).toBe("done");
  });

  it("a NON-empty unsatisfied acScope alongside an all-dropped checklist is NOT vacuous — acScope alone keeps it pending/active", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: ["AC-1"],
        coverage: [noCoverage("AC-1")],
        checklist: [droppedItem("CHK-1")],
        claim: undefined,
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.state).not.toBe("vacuous");
    expect(value.state).toBe("pending");
    expect(value.blocking).toEqual(["AC-1"]);
  });
});

// ─── STATE: overrun re-claim + stale claim mid-phase ─────────────────────────

describe("computePhaseCompletion — STATE: claim freshness drives active/pending, never blocking/done", () => {
  it("a stale claim mid-phase (partial progress, unmet items) yields state=pending, NOT active", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: ["AC-1"],
        coverage: [noCoverage("AC-1")],
        checklist: [],
        claim: freshClaim({ at: "2026-07-19T06:00:00.000Z" }), // 4h old
        claimTtlMinutes: 120, // 2h TTL -> stale
        now: new Date("2026-07-19T10:00:00.000Z"),
      }),
    );
    expect(value.state).toBe("pending");
    expect(value.blocking).toEqual(["AC-1"]);
  });

  it("overrun re-claim: a FRESH claim (recent .at) on a phase with prior partial progress yields state=active, evidence intact", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: ["AC-1", "AC-2"],
        coverage: [attestedCoverage("AC-1"), noCoverage("AC-2")],
        checklist: [],
        claim: freshClaim({ at: "2026-07-19T09:55:00.000Z" }), // re-claimed just now
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T10:00:00.000Z"),
      }),
    );
    expect(value.state).toBe("active");
    // prior evidence intact: AC-1 already satisfied, AC-2 still blocking, independent of the reclaim
    expect(value.blocking).toEqual(["AC-2"]);
  });

  it("no claim at all, with unmet items, yields state=pending", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: ["AC-1"],
        coverage: [noCoverage("AC-1")],
        checklist: [],
        claim: undefined,
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.state).toBe("pending");
  });

  it("claim presence/freshness is IRRELEVANT once the phase is done — state stays done even with no claim", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: ["AC-1"],
        coverage: [attestedCoverage("AC-1")],
        checklist: [],
        claim: undefined,
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    expect(value.state).toBe("done");
  });

  it("claim age exactly EQUAL to the TTL is still fresh (strict > staleness boundary, mirrors isClaimStale) — state=active", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: ["AC-1"],
        coverage: [noCoverage("AC-1")],
        checklist: [],
        claim: freshClaim({ at: "2026-07-19T08:00:00.000Z" }),
        claimTtlMinutes: 120, // exactly 120 minutes elapsed by `now` below
        now: new Date("2026-07-19T10:00:00.000Z"),
      }),
    );
    expect(value.state).toBe("active");
  });
});

// ─── ERROR: malformed acScope entries / negative TTL ─────────────────────────

describe("computePhaseCompletion — ERROR: malformed input yields typed err, never throws", () => {
  it("an empty-string acScope entry yields a typed VALIDATION_ERROR result, no throw", () => {
    let result: Result<PhaseCompletion, LoreError> | undefined;
    expect(() => {
      result = mod.computePhaseCompletion({
        acScope: ["AC-1", ""],
        coverage: [attestedCoverage("AC-1")],
        checklist: [],
        claim: undefined,
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      });
    }).not.toThrow();
    const error = expectErr(result as Result<PhaseCompletion, LoreError>);
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("an acScope entry not matching the AC id grammar (no 'AC-' prefix) yields a typed VALIDATION_ERROR result, no throw", () => {
    let result: Result<PhaseCompletion, LoreError> | undefined;
    expect(() => {
      result = mod.computePhaseCompletion({
        acScope: ["not-an-ac-id"],
        coverage: [],
        checklist: [],
        claim: undefined,
        claimTtlMinutes: 120,
        now: new Date("2026-07-19T09:30:00.000Z"),
      });
    }).not.toThrow();
    const error = expectErr(result as Result<PhaseCompletion, LoreError>);
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("a negative claimTtlMinutes yields a typed VALIDATION_ERROR result, no throw", () => {
    let result: Result<PhaseCompletion, LoreError> | undefined;
    expect(() => {
      result = mod.computePhaseCompletion({
        acScope: ["AC-1"],
        coverage: [attestedCoverage("AC-1")],
        checklist: [],
        claim: freshClaim(),
        claimTtlMinutes: -5,
        now: new Date("2026-07-19T09:30:00.000Z"),
      });
    }).not.toThrow();
    const error = expectErr(result as Result<PhaseCompletion, LoreError>);
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("a claimTtlMinutes of exactly ZERO is valid (not negative) — must NOT trigger the negative-TTL error path", () => {
    const value = expectOk(
      mod.computePhaseCompletion({
        acScope: ["AC-1"],
        coverage: [attestedCoverage("AC-1")],
        checklist: [],
        claim: freshClaim(),
        claimTtlMinutes: 0,
        now: new Date("2026-07-19T09:30:00.000Z"),
      }),
    );
    // 0-minute TTL means any elapsed time is stale; the phase is already
    // done regardless, so this only proves 0 is accepted, not rejected.
    expect(value.state).toBe("done");
  });
});
