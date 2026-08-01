/**
 * Tests for @lore/core doc-type-meta — deriveTypeMeta.
 * Pure function, no IO. Spec-first: assertions come from SPEC-036 §2 D3, §3
 * AC-36-7, AC-36-10, and doc-type-meta.ts's own module header (read BEFORE
 * writing these tests) — not from reading the function body and mirroring it.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      each of the 5 meta-bearing types (spec/adr/knowledge/plan/task)
 *               produces the correct shape from well-formed extra; prd → undefined;
 *               a task carrying one of EACH of the four evidence-result values
 *               tallies all four independently (task-two-more-evidence-consumers-
 *               erase-an-expected-fail-row-doc)
 *   NEGATIVE:   extra is null; extra.claim wrong type; extra.verification_evidence
 *               not an array; extra.phases not an array; extra.spec_kind /
 *               extra.decision_status / extra.sub_type present-but-invalid — every
 *               case MUST NOT throw and MUST degrade by omission, never fabrication
 *               (AC-36-10)
 *   BOUNDARY:   spec_kind ABSENT (key not present) → documented "feature" default
 *               exception; claim present + ttl omitted → claim_stale key truly
 *               absent (exactOptionalPropertyTypes discipline); claim+ttl wired to
 *               isClaimStale for unambiguous stale/fresh cases; phases absent vs
 *               empty array → phase_count 0 either way; evidence array present but
 *               empty → 0/0; an inconclusive-only task carries evidence_inconclusive
 *               (distinguishable from zero evidence); a pass/fail-only task never
 *               carries the evidence_expected_fail/evidence_inconclusive keys at all
 *               (present-iff-nonzero, never a fabricated 0)
 *   ERROR:      n/a — pure function, no Result channel (mirrors the "n/a" dimension
 *               already used in task-workflow.test.ts for the same reason)
 *   STATE:      evidence tally with a MIX of pass and fail entries (multi-entry
 *               case) — chosen for this dimension since deriveTypeMeta itself is
 *               stateless; this is the closest "state-shaped" input this module has
 *   REGRESSION: deriveTypeMeta never mutates its doc argument
 *   CONTROL:    (task-two-more-evidence-consumers-erase-an-expected-fail-row-doc,
 *               its own dedicated block) pass-only / expected-fail-only / zero-
 *               evidence tasks produce three mutually distinct `deriveTypeMeta`
 *               outputs — guards the HAPPY/BOUNDARY distinguishing-field
 *               assertions above against passing vacuously
 *
 * @spec_ref AC-36-7, AC-36-10; task-two-more-evidence-consumers-erase-an-
 *   expected-fail-row-doc
 */

import { describe, it, expect } from "vitest";
import { deriveTypeMeta } from "./doc-type-meta.js";
import type { DocId, DocRecord, DocType } from "./types.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

let _seq = 0;

function nextId(): DocId {
  _seq += 1;
  return `01HMETA${String(_seq).padStart(19, "0")}`;
}

/**
 * Builds a DocRecord fixture. `extra` is deliberately typed `unknown` (not
 * `Record<string, unknown>`) so NEGATIVE-dimension fuzz values (null, a string,
 * wrong-shaped objects) can be handed in without per-call casts — mirrors how a
 * corrupted/legacy store row could arrive at runtime, which is exactly what
 * AC-36-10 requires this module to tolerate.
 */
function makeDoc(type: DocType, extra: unknown = {}, overrides: Partial<DocRecord> = {}): DocRecord {
  const id = nextId();
  const base = {
    id,
    slug: `${type}-fixture-${id.slice(-4)}`,
    type,
    role: "plan",
    title: `${type} ${id}`,
    status: "draft",
    priority: "medium",
    content: "Fixture body",
    parent_id: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra,
    ...overrides,
  };
  return base as unknown as DocRecord;
}

function passEntry(recordedAt: string) {
  return {
    oracle: "test" as const,
    command: "bun test",
    result: "pass" as const,
    recorded_at: recordedAt,
    recorded_by: "alice",
  };
}

function failEntry(recordedAt: string) {
  return {
    oracle: "tsc" as const,
    command: "bun run typecheck",
    result: "fail" as const,
    recorded_at: recordedAt,
    recorded_by: "alice",
  };
}

/** A deliberate RED pin — task-two-more-evidence-consumers-erase-an-expected-fail-row-doc. */
function expectedFailEntry(recordedAt: string) {
  return {
    oracle: "test" as const,
    command: "bun test tests/x.test.ts",
    result: "expected-fail" as const,
    recorded_at: recordedAt,
    recorded_by: "alice",
  };
}

/** A runner-issued zero/under-match outcome (SPEC-061). */
function inconclusiveEntry(recordedAt: string) {
  return {
    oracle: "test" as const,
    command: "bun test",
    result: "inconclusive" as const,
    recorded_at: recordedAt,
    recorded_by: "alice",
  };
}

// ─── HAPPY ───────────────────────────────────────────────────────────────────

describe("deriveTypeMeta — HAPPY", () => {
  it("spec with spec_kind='tech' → { t: 'spec', kind: 'tech' }", () => {
    const doc = makeDoc("spec", { spec_kind: "tech" });
    expect(deriveTypeMeta(doc)).toEqual({ t: "spec", kind: "tech" });
  });

  it("spec with spec_kind='design' → { t: 'spec', kind: 'design' } (defeats a hardcoded 'feature' return)", () => {
    const doc = makeDoc("spec", { spec_kind: "design" });
    expect(deriveTypeMeta(doc)).toEqual({ t: "spec", kind: "design" });
  });

  it("adr with decision_status='accepted' → { t: 'adr', decision_status: 'accepted' }", () => {
    const doc = makeDoc("adr", { decision_status: "accepted" });
    expect(deriveTypeMeta(doc)).toEqual({ t: "adr", decision_status: "accepted" });
  });

  it("adr with decision_status='superseded' → reflects the DIFFERENT value (defeats a hardcoded return)", () => {
    const doc = makeDoc("adr", { decision_status: "superseded" });
    expect(deriveTypeMeta(doc)).toEqual({ t: "adr", decision_status: "superseded" });
  });

  it("knowledge with sub_type='retro' → { t: 'knowledge', sub_type: 'retro' }", () => {
    const doc = makeDoc("knowledge", { sub_type: "retro" });
    expect(deriveTypeMeta(doc)).toEqual({ t: "knowledge", sub_type: "retro" });
  });

  it("knowledge with sub_type='assessment' → reflects the DIFFERENT value (defeats a hardcoded return)", () => {
    const doc = makeDoc("knowledge", { sub_type: "assessment" });
    expect(deriveTypeMeta(doc)).toEqual({ t: "knowledge", sub_type: "assessment" });
  });

  it("plan with 2 declared phases → { t: 'plan', phase_count: 2 }", () => {
    const doc = makeDoc("plan", { phases: [{ name: "P1" }, { name: "P2" }] });
    expect(deriveTypeMeta(doc)).toEqual({ t: "plan", phase_count: 2 });
  });

  it("plan with 5 declared phases → phase_count: 5 (defeats a hardcoded count)", () => {
    const doc = makeDoc("plan", {
      phases: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }],
    });
    expect(deriveTypeMeta(doc)).toEqual({ t: "plan", phase_count: 5 });
  });

  it("task with 2 pass + 1 fail evidence and no claim → correct tallies, claimed_by absent", () => {
    const doc = makeDoc("task", {
      verification_evidence: [
        passEntry("2026-07-01T01:00:00.000Z"),
        passEntry("2026-07-01T02:00:00.000Z"),
        failEntry("2026-07-01T03:00:00.000Z"),
      ],
    });
    const result = deriveTypeMeta(doc);
    expect(result).toMatchObject({ t: "task", evidence_pass: 2, evidence_fail: 1 });
    expect(result && "claimed_by" in result).toBe(false);
  });

  it("task-two-more-evidence-consumers-erase-an-expected-fail-row-doc: a task with one of EACH of the four evidence-result values tallies all four independently, none dropped", () => {
    const doc = makeDoc("task", {
      verification_evidence: [
        passEntry("2026-07-01T01:00:00.000Z"),
        failEntry("2026-07-01T02:00:00.000Z"),
        expectedFailEntry("2026-07-01T03:00:00.000Z"),
        inconclusiveEntry("2026-07-01T04:00:00.000Z"),
      ],
    });
    expect(deriveTypeMeta(doc)).toEqual({
      t: "task",
      evidence_pass: 1,
      evidence_fail: 1,
      evidence_expected_fail: 1,
      evidence_inconclusive: 1,
    });
  });

  it("prd → undefined (no meta variant for this type)", () => {
    const doc = makeDoc("prd", { anything: "goes" });
    expect(deriveTypeMeta(doc)).toBeUndefined();
  });
});

// ─── CONTROL (AC-2, task-two-more-evidence-consumers-erase-an-expected- ──────
// ─── fail-row-doc): three mutually distinct outputs, so the distinguishing ───
// ─── field assertion above cannot pass vacuously ─────────────────────────────

describe("deriveTypeMeta — CONTROL: pass-only vs expected-fail-only vs zero evidence produce three mutually distinct outputs", () => {
  it("a task with only a pass row, only an expected-fail row, and zero evidence at all are pairwise distinct — and the expected-fail case is NOT byte-identical to zero evidence", () => {
    const passOnly = deriveTypeMeta(
      makeDoc("task", { verification_evidence: [passEntry("2026-07-01T01:00:00.000Z")] }),
    );
    const expectedFailOnly = deriveTypeMeta(
      makeDoc("task", { verification_evidence: [expectedFailEntry("2026-07-01T01:00:00.000Z")] }),
    );
    const zeroEvidence = deriveTypeMeta(makeDoc("task", {}));

    expect(passOnly).toEqual({ t: "task", evidence_pass: 1, evidence_fail: 0 });
    expect(expectedFailOnly).toEqual({
      t: "task",
      evidence_pass: 0,
      evidence_fail: 0,
      evidence_expected_fail: 1,
    });
    expect(zeroEvidence).toEqual({ t: "task", evidence_pass: 0, evidence_fail: 0 });

    // Pairwise distinct — the assertion this CONTROL exists to make un-vacuous.
    expect(passOnly).not.toEqual(expectedFailOnly);
    expect(expectedFailOnly).not.toEqual(zeroEvidence);
    expect(passOnly).not.toEqual(zeroEvidence);

    // Direct field assertion (never a rendered phrase): the expected-fail-only
    // task carries the distinguishing key; zero-evidence does not.
    expect(expectedFailOnly && "evidence_expected_fail" in expectedFailOnly).toBe(true);
    expect(zeroEvidence && "evidence_expected_fail" in zeroEvidence).toBe(false);
  });
});

// ─── NEGATIVE (AC-36-10) ──────────────────────────────────────────────────────

describe("deriveTypeMeta — NEGATIVE (AC-36-10: malformed extra never throws, degrades by omission)", () => {
  it("spec with extra=null does not throw and (per the documented default) yields feature", () => {
    const doc = makeDoc("spec", null);
    expect(() => deriveTypeMeta(doc)).not.toThrow();
    expect(deriveTypeMeta(doc)).toEqual({ t: "spec", kind: "feature" });
  });

  it("adr with extra=null does not throw and omits meta (decision_status unresolvable)", () => {
    const doc = makeDoc("adr", null);
    expect(() => deriveTypeMeta(doc)).not.toThrow();
    expect(deriveTypeMeta(doc)).toBeUndefined();
  });

  it("knowledge with extra=null does not throw and omits meta (sub_type unresolvable)", () => {
    const doc = makeDoc("knowledge", null);
    expect(() => deriveTypeMeta(doc)).not.toThrow();
    expect(deriveTypeMeta(doc)).toBeUndefined();
  });

  it("plan with extra=null does not throw and reports phase_count: 0", () => {
    const doc = makeDoc("plan", null);
    expect(() => deriveTypeMeta(doc)).not.toThrow();
    expect(deriveTypeMeta(doc)).toEqual({ t: "plan", phase_count: 0 });
  });

  it("task with extra=null does not throw and reports zeroed evidence with no claim", () => {
    const doc = makeDoc("task", null);
    expect(() => deriveTypeMeta(doc)).not.toThrow();
    const result = deriveTypeMeta(doc);
    expect(result).toEqual({ t: "task", evidence_pass: 0, evidence_fail: 0 });
  });

  it("task with extra.claim as a bare string → claimed_by absent, evidence still tallied independently", () => {
    const doc = makeDoc("task", {
      claim: "bob",
      verification_evidence: [passEntry("2026-07-01T01:00:00.000Z")],
    });
    const result = deriveTypeMeta(doc);
    expect(result).toMatchObject({ t: "task", evidence_pass: 1, evidence_fail: 0 });
    expect(result && "claimed_by" in result).toBe(false);
  });

  it("task with extra.claim.by as a wrong-typed field (number) → claimed_by absent", () => {
    const doc = makeDoc("task", { claim: { by: 123, at: "2026-07-01T00:00:00.000Z" } });
    const result = deriveTypeMeta(doc);
    expect(result && "claimed_by" in result).toBe(false);
  });

  it("task with extra.verification_evidence as a string (not an array) → evidence_pass: 0, evidence_fail: 0", () => {
    const doc = makeDoc("task", { verification_evidence: "not-an-array" });
    expect(deriveTypeMeta(doc)).toEqual({ t: "task", evidence_pass: 0, evidence_fail: 0 });
  });

  it("task with extra.verification_evidence as an object (not an array) → evidence_pass: 0, evidence_fail: 0", () => {
    const doc = makeDoc("task", { verification_evidence: { result: "pass" } });
    expect(deriveTypeMeta(doc)).toEqual({ t: "task", evidence_pass: 0, evidence_fail: 0 });
  });

  it("plan with extra.phases as a string (not an array) → phase_count: 0, not a throw or guess", () => {
    // reason: planExtraSchema.safeParse fails the WHOLE object when `phases` is
    // present but not an array — this is a whole-object validation failure, not
    // a partial success with an ignored field. Confirmed by reading the source
    // comment above the plan branch in doc-type-meta.ts.
    const doc = makeDoc("plan", { phases: "not-an-array" });
    expect(deriveTypeMeta(doc)).toEqual({ t: "plan", phase_count: 0 });
  });

  it("spec with spec_kind='bogus' (present but invalid) → undefined (whole meta omitted, NOT defaulted)", () => {
    const doc = makeDoc("spec", { spec_kind: "bogus" });
    expect(deriveTypeMeta(doc)).toBeUndefined();
  });

  it("spec with spec_kind=42 (wrong type, present) → undefined (whole meta omitted, NOT defaulted)", () => {
    const doc = makeDoc("spec", { spec_kind: 42 });
    expect(deriveTypeMeta(doc)).toBeUndefined();
  });

  it("adr with decision_status missing entirely → undefined", () => {
    const doc = makeDoc("adr", { unrelated_field: true });
    expect(deriveTypeMeta(doc)).toBeUndefined();
  });

  it("adr with decision_status='bogus' (present but invalid) → undefined", () => {
    const doc = makeDoc("adr", { decision_status: "bogus" });
    expect(deriveTypeMeta(doc)).toBeUndefined();
  });

  it("knowledge with sub_type missing entirely → undefined", () => {
    const doc = makeDoc("knowledge", { unrelated_field: true });
    expect(deriveTypeMeta(doc)).toBeUndefined();
  });

  it("knowledge with sub_type='bogus' (present but invalid) → undefined", () => {
    const doc = makeDoc("knowledge", { sub_type: "bogus" });
    expect(deriveTypeMeta(doc)).toBeUndefined();
  });
});

// ─── BOUNDARY ──────────────────────────────────────────────────────────────

describe("deriveTypeMeta — BOUNDARY", () => {
  it("spec with spec_kind key entirely ABSENT (empty extra) → defaults to feature (documented exception)", () => {
    const doc = makeDoc("spec", {});
    expect("spec_kind" in (doc.extra as Record<string, unknown>)).toBe(false);
    expect(deriveTypeMeta(doc)).toEqual({ t: "spec", kind: "feature" });
  });

  it("task with claim present and opts.claimTtlMinutes OMITTED → claimed_by present, claim_stale key truly absent", () => {
    const doc = makeDoc("task", { claim: { by: "alice", at: "2026-07-01T00:00:00.000Z" } });
    const result = deriveTypeMeta(doc);
    expect(result).toBeDefined();
    if (!result) return;
    expect("claimed_by" in result).toBe(true);
    expect((result as { claimed_by?: string }).claimed_by).toBe("alice");
    // exactOptionalPropertyTypes discipline: assert the KEY is absent, not merely
    // `=== undefined` — a bug that set `claim_stale: undefined` explicitly would
    // pass a `=== undefined` check but fail this one.
    expect("claim_stale" in result).toBe(false);
    expect(Object.hasOwn(result, "claim_stale")).toBe(false);
  });

  it("task with claim far in the past and a short TTL → claim_stale wired to true (unambiguously stale)", () => {
    const doc = makeDoc("task", {
      claim: { by: "alice", at: "2016-07-01T00:00:00.000Z" }, // ~10 years ago
    });
    const result = deriveTypeMeta(doc, { claimTtlMinutes: 1 });
    expect(result).toMatchObject({ claimed_by: "alice", claim_stale: true });
  });

  it("task with claim at (approximately) now and a long TTL → claim_stale wired to false (unambiguously fresh)", () => {
    const doc = makeDoc("task", {
      claim: { by: "alice", at: new Date().toISOString() },
    });
    const result = deriveTypeMeta(doc, { claimTtlMinutes: 120 });
    expect(result).toMatchObject({ claimed_by: "alice", claim_stale: false });
  });

  it("plan with extra.phases absent entirely → phase_count: 0", () => {
    const doc = makeDoc("plan", {});
    expect(deriveTypeMeta(doc)).toEqual({ t: "plan", phase_count: 0 });
  });

  it("plan with extra.phases present as an empty array → phase_count: 0", () => {
    const doc = makeDoc("plan", { phases: [] });
    expect(deriveTypeMeta(doc)).toEqual({ t: "plan", phase_count: 0 });
  });

  it("task with verification_evidence present but an empty array → evidence_pass: 0, evidence_fail: 0", () => {
    const doc = makeDoc("task", { verification_evidence: [] });
    expect(deriveTypeMeta(doc)).toEqual({ t: "task", evidence_pass: 0, evidence_fail: 0 });
  });

  it("task with only an inconclusive row → evidence_inconclusive: 1, distinguishable from zero evidence (mirrors evidence_expected_fail's distinguishing purpose)", () => {
    const doc = makeDoc("task", { verification_evidence: [inconclusiveEntry("2026-07-01T01:00:00.000Z")] });
    const result = deriveTypeMeta(doc);
    expect(result).toEqual({ t: "task", evidence_pass: 0, evidence_fail: 0, evidence_inconclusive: 1 });
    expect(result && "evidence_expected_fail" in result).toBe(false);
  });

  it("task with only pass/fail evidence never carries the evidence_expected_fail/evidence_inconclusive keys at all (present-iff-nonzero, not a fabricated 0)", () => {
    const doc = makeDoc("task", {
      verification_evidence: [passEntry("2026-07-01T01:00:00.000Z"), failEntry("2026-07-01T02:00:00.000Z")],
    });
    const result = deriveTypeMeta(doc);
    expect(result).toBeDefined();
    if (!result) return;
    expect("evidence_expected_fail" in result).toBe(false);
    expect("evidence_inconclusive" in result).toBe(false);
  });
});

// ─── ERROR ───────────────────────────────────────────────────────────────────

// n/a — deriveTypeMeta is a pure function with no Result<T, LoreError> channel;
// every "error-shaped" input (malformed extra) is covered under NEGATIVE above,
// mirroring task-workflow.test.ts's own "ERROR: n/a at this layer" dimension note.

// ─── STATE ───────────────────────────────────────────────────────────────────

describe("deriveTypeMeta — STATE (evidence tally over a mixed pass/fail sequence)", () => {
  it("3 pass + 2 fail entries → evidence_pass: 3, evidence_fail: 2 (order-independent tally)", () => {
    const doc = makeDoc("task", {
      verification_evidence: [
        passEntry("2026-07-01T01:00:00.000Z"),
        failEntry("2026-07-01T02:00:00.000Z"),
        passEntry("2026-07-01T03:00:00.000Z"),
        failEntry("2026-07-01T04:00:00.000Z"),
        passEntry("2026-07-01T05:00:00.000Z"),
      ],
    });
    expect(deriveTypeMeta(doc)).toEqual({ t: "task", evidence_pass: 3, evidence_fail: 2 });
  });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

describe("deriveTypeMeta — REGRESSION (purity)", () => {
  it("does not mutate doc.extra", () => {
    const doc = makeDoc("task", {
      claim: { by: "alice", at: "2026-07-01T00:00:00.000Z" },
      verification_evidence: [passEntry("2026-07-01T01:00:00.000Z")],
    });
    const snapshot = JSON.parse(JSON.stringify(doc.extra));
    const extraRefBefore = doc.extra;
    deriveTypeMeta(doc, { claimTtlMinutes: 120 });
    expect(doc.extra).toBe(extraRefBefore);
    expect(doc.extra).toEqual(snapshot);
  });

  it("does not mutate the doc object at all across a plan input", () => {
    const doc = makeDoc("plan", { phases: [{ name: "P1" }] });
    const snapshot = JSON.parse(JSON.stringify(doc));
    deriveTypeMeta(doc);
    expect(doc).toEqual(snapshot);
  });
});
