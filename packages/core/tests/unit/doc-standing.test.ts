/**
 * AC-DR-1 — the document standing table + pure lock resolver
 * (`packages/core/src/doc-standing.ts`) and the reopen-only status edge
 * (`isReopenTransition` in `schemas.ts`).
 *
 * Spec: spec-documents-are-living-or-records-a-locked-record-is-never (D1, D2, D5).
 * Written red-first by task-core-doc-standing-table-and-resolvelock.
 *
 * `VALID_TRANSITIONS` is module-private, so "still lacks approved->draft" is asserted
 * through its two public projections, `isValidTransition` and `getAllowedTransitions`.
 */
import { describe, expect, it } from "vitest";
import {
  DOC_TYPE_STANDING,
  KNOWLEDGE_SUB_TYPE_STANDING,
  KNOWLEDGE_SUB_TYPES,
  REOPEN_ALLOWED_TYPES,
  getAllowedTransitions,
  isReopenTransition,
  isValidTransition,
  resolveLock,
  type DocStatus,
  type DocType,
  type KnowledgeSubType,
  type LockInput,
  type LockState,
} from "../../src/index.js";

// Mirrors the DocType union; the key-set test below pins the table to this list,
// and `Record<DocType, ...>` pins the table to the union at compile time.
const ALL_DOC_TYPES: readonly DocType[] = [
  "prd",
  "spec",
  "adr",
  "plan",
  "knowledge",
  "task",
  "phase",
  "baseline",
];
const ALL_STATUSES: readonly DocStatus[] = [
  "draft",
  "in-review",
  "approved",
  "active",
  "archived",
  "deprecated",
];

const LIVING: LockState = { standing: "living" };
const UNLOCKED: LockState = { standing: "record", locked: false };
const lockedBy = (reason: "approved" | "claimed" | "closed"): LockState => ({
  standing: "record",
  locked: true,
  reason,
});

describe("AC-DR-1 (a) tables are exhaustive", () => {
  it("DOC_TYPE_STANDING keys deep-equal the DocType list", () => {
    expect(Object.keys(DOC_TYPE_STANDING).sort()).toEqual([...ALL_DOC_TYPES].sort());
  });

  it("KNOWLEDGE_SUB_TYPE_STANDING keys deep-equal KNOWLEDGE_SUB_TYPES", () => {
    expect(Object.keys(KNOWLEDGE_SUB_TYPE_STANDING).sort()).toEqual([...KNOWLEDGE_SUB_TYPES].sort());
  });

  it("classifies each knowledge sub-type per D2", () => {
    const living: KnowledgeSubType[] = ["reference", "skill", "prompt"];
    const record: KnowledgeSubType[] = ["ideation", "retro", "research", "assessment", "handoff", "uat"];
    for (const s of living) expect(KNOWLEDGE_SUB_TYPE_STANDING[s]).toBe("living");
    for (const s of record) expect(KNOWLEDGE_SUB_TYPE_STANDING[s]).toBe("record");
  });

  it("classifies each doc type's rule per the spec Public Interface", () => {
    expect(DOC_TYPE_STANDING.prd).toEqual({ kind: "fixed", standing: "living" });
    expect(DOC_TYPE_STANDING.baseline).toEqual({ kind: "fixed", standing: "living" });
    expect(DOC_TYPE_STANDING.spec).toEqual({ kind: "fixed", standing: "record" });
    expect(DOC_TYPE_STANDING.adr).toEqual({ kind: "fixed", standing: "record" });
    expect(DOC_TYPE_STANDING.task).toEqual({ kind: "fixed", standing: "record" });
    expect(DOC_TYPE_STANDING.knowledge).toEqual({ kind: "by-sub-type" });
    expect(DOC_TYPE_STANDING.plan).toEqual({ kind: "by-plan-state" });
    expect(DOC_TYPE_STANDING.phase).toEqual({ kind: "by-plan-state" });
  });
});

describe("AC-DR-1 (b) resolveLock", () => {
  const cases: Array<[string, LockInput, LockState]> = [
    // spec / adr: locked "approved" iff everApproved, whatever the current status
    ["spec ever approved, approved", { type: "spec", status: "approved", everApproved: true }, lockedBy("approved")],
    ["spec ever approved, now draft (reopened)", { type: "spec", status: "draft", everApproved: true }, lockedBy("approved")],
    ["spec ever approved, deprecated", { type: "spec", status: "deprecated", everApproved: true }, lockedBy("approved")],
    ["spec draft-then-deprecated is NOT locked", { type: "spec", status: "deprecated", everApproved: false }, UNLOCKED],
    ["spec never approved, draft", { type: "spec", status: "draft", everApproved: false }, UNLOCKED],
    ["adr ever approved", { type: "adr", status: "approved", everApproved: true }, lockedBy("approved")],
    ["adr never approved", { type: "adr", status: "draft", everApproved: false }, UNLOCKED],
    // task: locked "claimed" iff everClaimed
    ["task ever claimed, released (draft)", { type: "task", status: "draft", everClaimed: true }, lockedBy("claimed")],
    ["task ever claimed, archived", { type: "task", status: "archived", everClaimed: true }, lockedBy("claimed")],
    ["never-claimed archived task is NOT locked", { type: "task", status: "archived", everClaimed: false }, UNLOCKED],
    ["task never claimed, approved", { type: "task", status: "approved", everClaimed: false }, UNLOCKED],
    // knowledge: by sub-type
    ["knowledge reference is living", { type: "knowledge", status: "approved", subType: "reference" }, LIVING],
    ["knowledge skill is living", { type: "knowledge", status: "approved", subType: "skill" }, LIVING],
    ["knowledge prompt is living", { type: "knowledge", status: "approved", subType: "prompt" }, LIVING],
    ["knowledge research ever approved", { type: "knowledge", status: "approved", subType: "research", everApproved: true }, lockedBy("approved")],
    ["knowledge retro ever approved", { type: "knowledge", status: "approved", subType: "retro", everApproved: true }, lockedBy("approved")],
    ["knowledge retro never approved", { type: "knowledge", status: "draft", subType: "retro", everApproved: false }, UNLOCKED],
    ["knowledge uat ever approved", { type: "knowledge", status: "approved", subType: "uat", everApproved: true }, lockedBy("approved")],
    // plan / phase: living until the plan closes
    ["plan draft", { type: "plan", status: "draft", planStatus: "draft" }, LIVING],
    ["plan approved", { type: "plan", status: "approved", planStatus: "approved" }, LIVING],
    ["plan active", { type: "plan", status: "active", planStatus: "active" }, LIVING],
    ["plan archived", { type: "plan", status: "archived", planStatus: "archived" }, lockedBy("closed")],
    ["plan deprecated", { type: "plan", status: "deprecated", planStatus: "deprecated" }, lockedBy("closed")],
    ["phase of open plan", { type: "phase", status: "draft", planStatus: "active" }, LIVING],
    ["phase of archived plan", { type: "phase", status: "draft", planStatus: "archived" }, lockedBy("closed")],
    ["phase of deprecated plan", { type: "phase", status: "draft", planStatus: "deprecated" }, lockedBy("closed")],
    // always living
    ["baseline", { type: "baseline", status: "approved" }, LIVING],
    ["prd", { type: "prd", status: "approved" }, LIVING],
  ];

  it.each(cases)("%s", (_name, input, expected) => {
    expect(resolveLock(input)).toEqual(expected);
  });

  it("baseline and prd are living in every status", () => {
    for (const status of ALL_STATUSES) {
      expect(resolveLock({ type: "baseline", status })).toEqual(LIVING);
      expect(resolveLock({ type: "prd", status })).toEqual(LIVING);
    }
  });

  it("facts irrelevant to a type are ignored (a living doc stays living)", () => {
    expect(resolveLock({ type: "baseline", status: "approved", everApproved: true, everClaimed: true })).toEqual(LIVING);
  });
});

describe("AC-DR-1 (c) a missing required fact throws, never defaults", () => {
  const missing: Array<[string, LockInput, RegExp]> = [
    ["knowledge without subType", { type: "knowledge", status: "draft", everApproved: true }, /subType/],
    ["spec without everApproved", { type: "spec", status: "draft" }, /everApproved/],
    ["adr without everApproved", { type: "adr", status: "draft" }, /everApproved/],
    ["knowledge record without everApproved", { type: "knowledge", status: "draft", subType: "retro" }, /everApproved/],
    ["task without everClaimed", { type: "task", status: "draft" }, /everClaimed/],
    ["plan without planStatus", { type: "plan", status: "draft" }, /planStatus/],
    ["phase without planStatus", { type: "phase", status: "draft" }, /planStatus/],
  ];

  it.each(missing)("%s", (_name, input, field) => {
    expect(() => resolveLock(input)).toThrow(field);
  });

  it("a living knowledge sub-type does not require everApproved", () => {
    expect(() => resolveLock({ type: "knowledge", status: "draft", subType: "reference" })).not.toThrow();
  });
});

describe("AC-DR-1 (d) isReopenTransition", () => {
  it("is true only for spec approved->draft (exhaustive over type x from x to)", () => {
    const hits: string[] = [];
    for (const type of ALL_DOC_TYPES)
      for (const from of ALL_STATUSES)
        for (const to of ALL_STATUSES)
          if (isReopenTransition(type, from, to)) hits.push(`${type}:${from}->${to}`);
    expect(hits).toEqual(["spec:approved->draft"]);
  });

  it("REOPEN_ALLOWED_TYPES is exactly ['spec']", () => {
    expect([...REOPEN_ALLOWED_TYPES]).toEqual(["spec"]);
  });

  it("VALID_TRANSITIONS still lacks approved->draft", () => {
    expect(isValidTransition("approved", "draft")).toBe(false);
    expect(isValidTransition("approved", "draft", "spec")).toBe(false);
    expect(getAllowedTransitions("approved")).not.toContain("draft");
    expect(getAllowedTransitions("approved", "spec")).not.toContain("draft");
  });
});
