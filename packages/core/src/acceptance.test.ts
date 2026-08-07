/**
 * Tests for @lore/core acceptance — acceptanceCriterionSchema,
 * specAcceptanceCriteriaSchema, computeAcCoverage, ORACLE_KINDS/SCRIPT_ORACLES
 * exhaustiveness. Pure functions + schemas, no IO.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      all three verify modes parse; computeAcCoverage aggregates
 *               pass/fail(+attested) correctly over a mixed evidence set;
 *               verify.script.timeout_ms accepted when present or omitted
 *   NEGATIVE:   AC-ACODE-1 rejection paths — duplicate id, malformed id,
 *               script missing command, rubric over length; timeout_ms
 *               rejects zero/negative/non-integer
 *   BOUNDARY:   50-entry cap on the array, 2000/1000/500-char field limits,
 *               empty criteria array, empty task set (attested_pass/fail
 *               always present as 0, never omitted)
 *   ERROR:      malformed extra.verification_evidence (non-array, non-object
 *               entries) does not throw — extractEvidence defensively drops it
 *   STATE:      one ac_id accumulating both pass and fail evidence across tasks,
 *               split further by attested vs self-reported (SPEC-039 §2 D8)
 *   REGRESSION: evidenceEntrySchema parses with and without ac_ref; ORACLE_KINDS
 *               (task-workflow.ts) matches the original inline literal exactly;
 *               omitted timeout_ms still parses (pre-SPEC-039 fixtures unaffected)
 *
 * @spec_ref SPEC-038 §3, §4, §7 D1-D3; AC-ACODE-1, AC-ACODE-2, AC-ACODE-6;
 *   SPEC-039 §2 D8, D9; AC-VRF-8
 */

import { describe, it, expect } from "vitest";
import {
  acceptanceCriterionSchema,
  specAcceptanceCriteriaSchema,
  computeAcCoverage,
  AC_VERIFY_MODES,
  SCRIPT_ORACLES,
  type AcceptanceCriterion,
} from "./acceptance.js";
import { evidenceEntrySchema, ORACLE_KINDS } from "./task-workflow.js";
import { specExtraSchema, createDocInputSchema } from "./schemas.js";
import type { DocId, DocRecord } from "./types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

let _seq = 0;

function nextId(): DocId {
  _seq += 1;
  return `01HTASK${String(_seq).padStart(19, "0")}`;
}

function makeTask(overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextId();
  return {
    id,
    slug: `task-fixture-${id.slice(-4)}`,
    type: "task",
    role: "plan",
    title: `Task ${id}`,
    status: "draft",
    priority: "medium",
    content: "Task body",
    parent_id: "01HPLANAAAAAAAAAAAAAAAAAAA",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: "01HPLANAAAAAAAAAAAAAAAAAAA" },
    ...overrides,
  } as DocRecord;
}

function scriptAc(id: string): AcceptanceCriterion {
  return {
    id,
    statement: `Statement for ${id}`,
    verify: { mode: "script", oracle: "test", command: "bun test" },
  };
}

// ─── AC_VERIFY_MODES / SCRIPT_ORACLES ────────────────────────────────────────

describe("AC_VERIFY_MODES / SCRIPT_ORACLES", () => {
  it("HAPPY: SCRIPT_ORACLES is exactly ORACLE_KINDS minus 'manual'", () => {
    const expected = ORACLE_KINDS.filter((k) => k !== "manual");
    expect([...SCRIPT_ORACLES].sort()).toEqual([...expected].sort());
  });

  it("REGRESSION: ORACLE_KINDS matches the original inline literal exactly", () => {
    expect([...ORACLE_KINDS].sort()).toEqual(
      ["tsc", "test", "lint", "build", "e2e", "manual", "other"].sort(),
    );
  });

  it("HAPPY: AC_VERIFY_MODES is script/ai/human", () => {
    expect(AC_VERIFY_MODES).toEqual(["script", "ai", "human"]);
  });
});

// ─── acceptanceCriterionSchema ───────────────────────────────────────────────

describe("acceptanceCriterionSchema", () => {
  it("HAPPY: parses a valid script-mode criterion", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "AC-ACODE-1",
      statement: "Rejects malformed input",
      verify: { mode: "script", oracle: "test", command: "bunx vitest run packages/core" },
    });
    expect(result.success).toBe(true);
  });

  it("HAPPY: parses a valid ai-mode criterion", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "AC-ASSESS-10",
      statement: "Judge scores rubric correctly",
      verify: { mode: "ai", rubric: "Score 0-1 based on completeness" },
    });
    expect(result.success).toBe(true);
  });

  it("HAPPY: parses a valid human-mode criterion, note optional", () => {
    const withNote = acceptanceCriterionSchema.safeParse({
      id: "AC-EXPORT-COLLISION-1",
      statement: "Manually verified by a human reviewer",
      verify: { mode: "human", note: "Checked in staging" },
    });
    expect(withNote.success).toBe(true);

    const withoutNote = acceptanceCriterionSchema.safeParse({
      id: "AC-AUDIT-ACTOR",
      statement: "Manually verified by a human reviewer",
      verify: { mode: "human" },
    });
    expect(withoutNote.success).toBe(true);
  });

  it("NEGATIVE: rejects malformed id format (lowercase, no AC- prefix)", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "not-a-valid-id",
      statement: "Some statement",
      verify: { mode: "human" },
    });
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: rejects script mode missing command", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "AC-X-1",
      statement: "Some statement",
      verify: { mode: "script", oracle: "test" },
    });
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: rejects ai-mode rubric over 2000 chars", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "AC-X-1",
      statement: "Some statement",
      verify: { mode: "ai", rubric: "x".repeat(2001) },
    });
    expect(result.success).toBe(false);
  });

  it("NEGATIVE: rejects script oracle outside SCRIPT_ORACLES", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "AC-X-1",
      statement: "Some statement",
      verify: { mode: "script", oracle: "manual", command: "echo hi" },
    });
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: statement at exactly 2000 chars is valid, 2001 is rejected", () => {
    const at2000 = acceptanceCriterionSchema.safeParse({
      id: "AC-X-1",
      statement: "s".repeat(2000),
      verify: { mode: "human" },
    });
    expect(at2000.success).toBe(true);

    const at2001 = acceptanceCriterionSchema.safeParse({
      id: "AC-X-1",
      statement: "s".repeat(2001),
      verify: { mode: "human" },
    });
    expect(at2001.success).toBe(false);
  });

  it("BOUNDARY: script command at exactly 1000 chars is valid, 1001 is rejected", () => {
    const at1000 = acceptanceCriterionSchema.safeParse({
      id: "AC-X-1",
      statement: "s",
      verify: { mode: "script", oracle: "test", command: "c".repeat(1000) },
    });
    expect(at1000.success).toBe(true);

    const at1001 = acceptanceCriterionSchema.safeParse({
      id: "AC-X-1",
      statement: "s",
      verify: { mode: "script", oracle: "test", command: "c".repeat(1001) },
    });
    expect(at1001.success).toBe(false);
  });

  it("BOUNDARY: human note at exactly 500 chars is valid, 501 is rejected", () => {
    const at500 = acceptanceCriterionSchema.safeParse({
      id: "AC-X-1",
      statement: "s",
      verify: { mode: "human", note: "n".repeat(500) },
    });
    expect(at500.success).toBe(true);

    const at501 = acceptanceCriterionSchema.safeParse({
      id: "AC-X-1",
      statement: "s",
      verify: { mode: "human", note: "n".repeat(501) },
    });
    expect(at501.success).toBe(false);
  });
});

// ─── acceptanceCriterionSchema verify.script.timeout_ms (SPEC-039 §2 D9) ─────

describe("acceptanceCriterionSchema — verify.script.timeout_ms", () => {
  it("HAPPY: a valid positive integer timeout_ms is accepted", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "AC-VRF-1",
      statement: "s",
      verify: { mode: "script", oracle: "test", command: "bun test", timeout_ms: 60000 },
    });
    expect(result.success).toBe(true);
  });

  it("REGRESSION: omitted timeout_ms is valid — existing script ACs without it still parse", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "AC-VRF-1",
      statement: "s",
      verify: { mode: "script", oracle: "test", command: "bun test" },
    });
    expect(result.success).toBe(true);
  });

  it("BOUNDARY: timeout_ms of 0 is rejected (must be positive)", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "AC-VRF-1",
      statement: "s",
      verify: { mode: "script", oracle: "test", command: "bun test", timeout_ms: 0 },
    });
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: a negative timeout_ms is rejected", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "AC-VRF-1",
      statement: "s",
      verify: { mode: "script", oracle: "test", command: "bun test", timeout_ms: -1 },
    });
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: a non-integer timeout_ms (1.5) is rejected", () => {
    const result = acceptanceCriterionSchema.safeParse({
      id: "AC-VRF-1",
      statement: "s",
      verify: { mode: "script", oracle: "test", command: "bun test", timeout_ms: 1.5 },
    });
    expect(result.success).toBe(false);
  });
});

// ─── specAcceptanceCriteriaSchema ────────────────────────────────────────────

describe("specAcceptanceCriteriaSchema", () => {
  it("HAPPY: an array of distinct-id criteria parses", () => {
    const result = specAcceptanceCriteriaSchema.safeParse([
      scriptAc("AC-1"),
      scriptAc("AC-2"),
    ]);
    expect(result.success).toBe(true);
  });

  it("NEGATIVE: rejects duplicate id across the array", () => {
    const result = specAcceptanceCriteriaSchema.safeParse([
      scriptAc("AC-DUP-1"),
      scriptAc("AC-DUP-1"),
    ]);
    expect(result.success).toBe(false);
  });

  it("BOUNDARY: exactly 50 entries is valid, 51 is rejected", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => scriptAc(`AC-N-${i}`));
    expect(specAcceptanceCriteriaSchema.safeParse(fifty).success).toBe(true);

    const fiftyOne = Array.from({ length: 51 }, (_, i) => scriptAc(`AC-N-${i}`));
    expect(specAcceptanceCriteriaSchema.safeParse(fiftyOne).success).toBe(false);
  });

  it("BOUNDARY: an empty array is valid", () => {
    expect(specAcceptanceCriteriaSchema.safeParse([]).success).toBe(true);
  });
});

// ─── specExtraSchema / createDocInputSchema (schema half — AC-ACODE-2) ───────

describe("specExtraSchema.acceptance_criteria (AC-ACODE-2)", () => {
  it("HAPPY: absent acceptance_criteria stays valid (legacy specs unaffected)", () => {
    expect(specExtraSchema.safeParse({}).success).toBe(true);
  });

  it("HAPPY: valid acceptance_criteria round-trips through specExtraSchema", () => {
    const result = specExtraSchema.safeParse({
      acceptance_criteria: [scriptAc("AC-1")],
    });
    expect(result.success).toBe(true);
  });

  it("NEGATIVE: createDocInputSchema rejects an invalid acceptance_criteria on a spec", () => {
    const result = createDocInputSchema.safeParse({
      type: "spec",
      title: "A spec",
      parent_id: "01HPARENT0000000000000000",
      extra: { acceptance_criteria: [{ id: "bad id", statement: "x", verify: { mode: "human" } }] },
    });
    expect(result.success).toBe(false);
  });

  it("HAPPY: createDocInputSchema accepts a spec with valid acceptance_criteria", () => {
    const result = createDocInputSchema.safeParse({
      type: "spec",
      title: "A spec",
      parent_id: "01HPARENT0000000000000000",
      extra: { acceptance_criteria: [scriptAc("AC-1")] },
    });
    expect(result.success).toBe(true);
  });
});

// ─── computeAcCoverage ────────────────────────────────────────────────────────

describe("computeAcCoverage", () => {
  it("HAPPY: aggregates pass/fail per ac_ref across tasks", () => {
    const criteria = [scriptAc("AC-1"), scriptAc("AC-2")];
    const task1 = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "t", recorded_by: "alice", ac_ref: "AC-1" },
          { oracle: "test", command: "bun test", result: "fail", recorded_at: "t", recorded_by: "alice", ac_ref: "AC-1" },
        ],
      },
    });
    const task2 = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "t", recorded_by: "alice", ac_ref: "AC-2" },
        ],
      },
    });

    const coverage = computeAcCoverage(criteria, [task1, task2]);

    expect(coverage).toHaveLength(2);
    const ac1 = coverage.find((c) => c.ac_id === "AC-1");
    const ac2 = coverage.find((c) => c.ac_id === "AC-2");
    expect(ac1).toMatchObject({ pass: 1, fail: 1 });
    expect(ac1?.refs).toHaveLength(2);
    expect(ac2).toMatchObject({ pass: 1, fail: 0 });
  });

  it("NEGATIVE: evidence without ac_ref does not count toward any criterion", () => {
    const criteria = [scriptAc("AC-1")];
    const task = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "t", recorded_by: "alice" },
        ],
      },
    });

    const coverage = computeAcCoverage(criteria, [task]);
    expect(coverage).toEqual([
      { ac_id: "AC-1", mode: "script", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: 0 },
    ]);
  });

  it("BOUNDARY: empty task set yields {pass:0, fail:0, refs:[]} for every criterion", () => {
    const criteria = [scriptAc("AC-1"), scriptAc("AC-2")];
    const coverage = computeAcCoverage(criteria, []);
    expect(coverage).toEqual([
      { ac_id: "AC-1", mode: "script", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: 0 },
      { ac_id: "AC-2", mode: "script", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: 0 },
    ]);
  });

  it("BOUNDARY: empty criteria set yields an empty array regardless of tasks", () => {
    const task = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "t", recorded_by: "alice", ac_ref: "AC-1" },
        ],
      },
    });
    expect(computeAcCoverage([], [task])).toEqual([]);
  });

  it("ERROR: malformed extra.verification_evidence does not throw (defensive extractEvidence)", () => {
    const criteria = [scriptAc("AC-1")];
    const malformedArray = makeTask({ extra: { plan_id: "p", verification_evidence: "not-an-array" } });
    const malformedExtra = makeTask({ extra: null as unknown as Record<string, unknown> });

    expect(() => computeAcCoverage(criteria, [malformedArray, malformedExtra])).not.toThrow();
    expect(computeAcCoverage(criteria, [malformedArray, malformedExtra])).toEqual([
      { ac_id: "AC-1", mode: "script", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: 0 },
    ]);
  });

  it("STATE: a single ac_id accumulates both pass and fail evidence from separate append events", () => {
    const criteria = [scriptAc("AC-1")];
    const task = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          { oracle: "test", command: "bun test", result: "fail", recorded_at: "t1", recorded_by: "alice", ac_ref: "AC-1" },
          { oracle: "test", command: "bun test", result: "pass", recorded_at: "t2", recorded_by: "alice", ac_ref: "AC-1" },
        ],
      },
    });

    const coverage = computeAcCoverage(criteria, [task]);
    expect(coverage[0]).toMatchObject({ pass: 1, fail: 1 });
  });

  it("STATE: attested_pass/attested_fail split runner-attested evidence from self-reported (AC-VRF-8)", () => {
    const criteria = [scriptAc("AC-1")];
    const task = makeTask({
      extra: {
        plan_id: "p",
        verification_evidence: [
          // (a) attested pass
          {
            oracle: "test", command: "bun test", result: "pass",
            recorded_at: "t1", recorded_by: "lore-cli", ac_ref: "AC-1",
            attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 500, timed_out: false },
          },
          // (b) self-reported pass (no attestation)
          {
            oracle: "test", command: "bun test", result: "pass",
            recorded_at: "t2", recorded_by: "alice", ac_ref: "AC-1",
          },
          // (c) attested fail
          {
            oracle: "test", command: "bun test", result: "fail",
            recorded_at: "t3", recorded_by: "lore-cli", ac_ref: "AC-1",
            attestation: { runner: "lore-cli", exit_code: 1, duration_ms: 900, timed_out: false },
          },
        ],
      },
    });

    const coverage = computeAcCoverage(criteria, [task]);
    expect(coverage).toHaveLength(1);
    const fact = coverage[0]!;
    expect(fact.pass).toBe(2);
    expect(fact.fail).toBe(1);
    expect(fact.attested_pass).toBe(1);
    expect(fact.attested_fail).toBe(1);

    const attestedPassRefs = fact.refs.filter((r) => r.result === "pass" && r.attested === true);
    const attestedFailRefs = fact.refs.filter((r) => r.result === "fail" && r.attested === true);
    expect(attestedPassRefs).toHaveLength(1);
    expect(attestedFailRefs).toHaveLength(1);

    // present-iff-true convention: the self-reported pass ref must OMIT `attested`,
    // not carry `attested: false` (mirrors ReadyRecord.claim/.phase elsewhere).
    const selfReportedPassRef = fact.refs.find(
      (r) => r.result === "pass" && r.attested !== true,
    );
    expect(selfReportedPassRef).toBeDefined();
    expect(selfReportedPassRef?.attested).toBeUndefined();
    expect("attested" in (selfReportedPassRef as object)).toBe(false);
  });
});

// ─── evidenceEntrySchema ac_ref (REGRESSION) ─────────────────────────────────

describe("evidenceEntrySchema ac_ref", () => {
  it("REGRESSION: parses without ac_ref (pre-existing shape)", () => {
    const result = evidenceEntrySchema.safeParse({
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_at: "2026-07-02T10:00:00.000Z",
      recorded_by: "alice",
    });
    expect(result.success).toBe(true);
  });

  it("REGRESSION: parses with ac_ref (new optional field)", () => {
    const result = evidenceEntrySchema.safeParse({
      oracle: "test",
      command: "bunx vitest run packages/core",
      result: "pass",
      recorded_at: "2026-07-02T10:00:00.000Z",
      recorded_by: "alice",
      ac_ref: "AC-ACODE-1",
    });
    expect(result.success).toBe(true);
  });
});
