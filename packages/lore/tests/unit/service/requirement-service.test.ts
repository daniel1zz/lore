/**
 * Tests for SPEC-055 requirement-service wiring: RequirementService add/list/remove
 * round-trip on prd.extra.requirements, CorpusService.computeRequirementCoverageForPrd
 * over descendant spec ACs, and AcService.addCriterion persisting requirement_refs.
 *
 * Deterministic, zero-LLM. Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 *
 * Source: SPEC-055 §Acceptance Criteria AC-055-5, AC-055-6, AC-055-7.
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RequirementService } from "../../../src/service/requirement-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import type { CreateDocInput, DocRecord } from "@lore/core";

function harness() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const requirementService = new RequirementService(store);
  const acService = new AcService(store);
  return { store, corpusService, requirementService, acService };
}

async function makePrd(cs: CorpusService, extra: Record<string, unknown> = {}): Promise<DocRecord> {
  const r = await cs.create({ type: "prd", title: "Root PRD", content: "# PRD", extra } as CreateDocInput);
  if (!r.ok) throw new Error(`prd create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

async function makeSpecUnder(cs: CorpusService, prd: DocRecord): Promise<DocRecord> {
  const r = await cs.create({
    type: "spec",
    title: "Child spec",
    content: "## Overview\n\nbody",
    parent_id: prd.id,
    extra: { spec_kind: "feature" },
  } as CreateDocInput);
  if (!r.ok) throw new Error(`spec create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

// ─── AC-055-5: RequirementService round-trip ─────────────────────────────────

describe("SPEC-055 AC-055-5 — RequirementService add/list/remove", () => {
  it("HAPPY: add then list round-trips, preserving other extra keys; remove drops it", async () => {
    const { corpusService, requirementService } = harness();
    const prd = await makePrd(corpusService, { note: "keep me" });

    const add = await requirementService.addRequirement(prd.id, {
      id: "R-1",
      statement: "user can log in",
      priority: "P0",
    });
    expect(add.ok).toBe(true);

    const list = await requirementService.listRequirements(prd.id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.map((r) => r.id)).toEqual(["R-1"]);

    // other extra key preserved
    const fresh = await corpusService.get(prd.id);
    expect(fresh.ok && (fresh.value.doc.extra as Record<string, unknown>)["note"]).toBe("keep me");

    const rm = await requirementService.removeRequirement(prd.id, "R-1");
    expect(rm.ok).toBe(true);
    const list2 = await requirementService.listRequirements(prd.id);
    expect(list2.ok && list2.value).toEqual([]);
  });

  it("NEGATIVE: adding a duplicate id fails loud", async () => {
    const { corpusService, requirementService } = harness();
    const prd = await makePrd(corpusService);
    await requirementService.addRequirement(prd.id, { id: "R-1", statement: "x is < 5", priority: "P1" });
    const dup = await requirementService.addRequirement(prd.id, { id: "R-1", statement: "y is < 9", priority: "P1" });
    expect(dup.ok).toBe(false);
  });

  it("NEGATIVE: targeting a non-prd doc fails", async () => {
    const { corpusService, requirementService } = harness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpecUnder(corpusService, prd);
    const r = await requirementService.addRequirement(spec.id, { id: "R-1", statement: "x", priority: "P0" });
    expect(r.ok).toBe(false);
  });
});

// ─── AC-055-7: AcService persists requirement_refs ───────────────────────────

describe("SPEC-055 AC-055-7 — AcService requirement_refs round-trip", () => {
  it("HAPPY: addCriterion persists requirement_refs, round-tripped via listCriteria", async () => {
    const { corpusService, acService } = harness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpecUnder(corpusService, prd);

    const add = await acService.addCriterion(spec.id, {
      id: "AC-1",
      statement: "returns 200 for a valid login",
      verify: { mode: "human" },
      requirement_refs: ["R-1"],
    });
    expect(add.ok).toBe(true);

    const list = await acService.listCriteria(spec.id);
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.criteria[0]?.requirement_refs).toEqual(["R-1"]);
  });

  it("REGRESSION: a criterion with no requirement_refs still validates", async () => {
    const { corpusService, acService } = harness();
    const prd = await makePrd(corpusService);
    const spec = await makeSpecUnder(corpusService, prd);
    const add = await acService.addCriterion(spec.id, {
      id: "AC-1",
      statement: "the export completes within 5s",
      verify: { mode: "human" },
    });
    expect(add.ok).toBe(true);
  });
});

// ─── AC-055-6: computeRequirementCoverageForPrd over descendant ACs ──────────

describe("SPEC-055 AC-055-6 — CorpusService.computeRequirementCoverageForPrd", () => {
  it("HAPPY: a requirement referenced by a descendant AC is covered; an unreferenced one is not", async () => {
    const { corpusService, requirementService, acService } = harness();
    const prd = await makePrd(corpusService);
    await requirementService.addRequirement(prd.id, { id: "R-1", statement: "user can log in", priority: "P0" });
    await requirementService.addRequirement(prd.id, { id: "R-2", statement: "user can export", priority: "P0" });

    const spec = await makeSpecUnder(corpusService, prd);
    await acService.addCriterion(spec.id, {
      id: "AC-1",
      statement: "login returns 200",
      verify: { mode: "human" },
      requirement_refs: ["R-1"],
    });

    const cov = await corpusService.computeRequirementCoverageForPrd(prd.id);
    expect(cov.ok).toBe(true);
    if (!cov.ok) return;
    expect(cov.value.covered).toEqual(["R-1"]);
    expect(cov.value.uncovered).toEqual(["R-2"]);
    expect(cov.value.uncovered_p0).toEqual(["R-2"]);
  });

  it("BOUNDARY: a PRD with no requirements → all-empty coverage (vacuous)", async () => {
    const { corpusService } = harness();
    const prd = await makePrd(corpusService);
    const cov = await corpusService.computeRequirementCoverageForPrd(prd.id);
    expect(cov.ok).toBe(true);
    if (!cov.ok) return;
    expect(cov.value).toEqual({ total: 0, covered: [], uncovered: [], uncovered_p0: [] });
  });
});
