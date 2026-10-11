/**
 * Tests for the AC-Quantifiability Gate's service-layer wiring: the `acQuantifiable`
 * predicate (`gate-predicates.ts`) as run through `GateEnforcer` on the `spec-create`
 * / `spec-promote` checkpoints (`CorpusService._createImpl`/`set`,
 * `ReviewService.enforceApprovalGate`), and the immediate-feedback lint on
 * `AcService.addCriterion`.
 *
 * Deterministic, zero-LLM by construction — `CorpusService`/`AcService`/
 * `ReviewService`/`GateEnforcer` take no AI-provider dependency at all, so every
 * assertion here proves the gate path never needs one, without mocking a provider.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref SPEC AC-Quantifiability Gate (design-time standardization enforcement)
 *   §Design; AC-ACQ-3, AC-ACQ-4, AC-ACQ-5
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "ulidx";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { LIVE_RULE_ID, seedLiveRule } from "../../helpers/live-rule-fixture.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord, LoreConfig } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** An AC whose statement carries an abstract-quality word with no measurable anchor. */
const BAD_AC = {
  id: "AC-BAD-1",
  statement: "the dashboard loads fast",
  verify: { mode: "human" as const },
  cites: [LIVE_RULE_ID],
};

/** The same claim, restated with a numeric threshold — passes the lint. */
const GOOD_AC = {
  id: "AC-GOOD-1",
  statement: "the dashboard P95 load time is < 200ms",
  verify: { mode: "human" as const },
  cites: [LIVE_RULE_ID],
};

/** A second, distinctly-quantified AC — used where a spec needs ≥2 declared ACs. */
const GOOD_AC_2 = {
  id: "AC-GOOD-2",
  statement: "the export completes within 5s for a 10MB corpus",
  verify: { mode: "script" as const, oracle: "test" as const, command: "bun test export.test.ts" },
  cites: [LIVE_RULE_ID],
};

async function makeCorpusService(config?: LoreConfig) {
  const store = new InMemoryStore();
  await seedLiveRule(store);
  const enforcer = new GateEnforcer(config);
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, enforcer);
  return { store, corpusService, enforcer };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

function specInput(acceptanceCriteria: unknown[], parentId: string): CreateDocInput {
  return {
    type: "spec",
    title: "Quantifiability Test Spec",
    content: "## Overview\n\nBody.",
    extra: { acceptance_criteria: acceptanceCriteria },
  } as CreateDocInput;
}

async function createPrd(cs: CorpusService): Promise<DocRecord> {
  return mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
}

/**
 * Inserts a DRAFT spec directly into the store, bypassing `CorpusService.create`
 * (and therefore its spec-create gate) — used to test `spec-promote`'s
 * `acQuantifiable` predicate in isolation, for an AC that predates the gate /
 * arrived via a non-gated path (the exact scenario this predicate is the
 * BACKSTOP for, per its own JSDoc). Mirrors `corpus-hardgate.test.ts`'s
 * `insertRawDoc` helper.
 */
async function insertRawSpec(
  store: InMemoryStore,
  parentId: DocId,
  acceptanceCriteria: unknown[],
): Promise<DocRecord> {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc: DocRecord = {
    id,
    slug: `spec-raw-${id.slice(-8).toLowerCase()}`,
    type: "spec",
    role: DOC_TYPE_ROLE_MAP.spec,
    title: "Raw Spec",
    status: "draft",
    priority: "medium",
    content: "## Overview\n\nBody.",
    parent_id: parentId,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { spec_kind: "feature", acceptance_criteria: acceptanceCriteria },
  };
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`insertRawSpec failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

// ─── AC-ACQ-3: spec-create rejects an unquantified AC, accepts a quantified one ──

describe("acQuantifiable — spec-create (CorpusService.create)", () => {
  // HAPPY
  it("creates a spec whose declared ACs are all quantified", async () => {
    const { corpusService } = await makeCorpusService();
    const prd = await createPrd(corpusService);
    const result = await corpusService.create(specInput([GOOD_AC], prd.id));
    expect(result.ok).toBe(true);
  });

  // NEGATIVE — AC-ACQ-3
  it("rejects a spec with an unquantified abstract-word AC, exit-mapped VALIDATION_ERROR naming the AC id", async () => {
    const { corpusService } = await makeCorpusService();
    const prd = await createPrd(corpusService);
    const result = await corpusService.create(specInput([BAD_AC], prd.id));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { field?: string }).field).toBe("gate:spec-create:ac-quantifiable");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("AC_NOT_QUANTIFIABLE");
      expect(message).toContain("AC-BAD-1");
      expect(message).toContain("fast");
    }
  });

  // STATE — mixed set: one good, one bad — still blocked, names the bad one
  it("rejects when only ONE of several declared ACs is unquantified", async () => {
    const { corpusService } = await makeCorpusService();
    const prd = await createPrd(corpusService);
    const result = await corpusService.create(specInput([GOOD_AC, BAD_AC], prd.id));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("AC-BAD-1");
      expect(message).not.toContain("AC-GOOD-1: abstract word");
    }
  });

  // BOUNDARY — no declared ACs at all (the common create-then-`lore ac add` case) → vacuous pass
  it("does not block a spec created with no acceptance_criteria at all", async () => {
    const { corpusService } = await makeCorpusService();
    const prd = await createPrd(corpusService);
    const result = await corpusService.create({
      type: "spec",
      title: "No ACs Yet",
      content: "## Overview\n\nBody.",
    } as CreateDocInput);
    expect(result.ok).toBe(true);
  });

  // REGRESSION — a script-mode AC using an abstract word is never blocked (oracle-bound by construction)
  it("does not block a script-mode AC even though its statement carries an abstract word", async () => {
    const { corpusService } = await makeCorpusService();
    const prd = await createPrd(corpusService);
    const result = await corpusService.create(
      specInput(
        [
          {
            id: "AC-SCRIPT-1",
            statement: "the CLI is fast",
            verify: { mode: "script", oracle: "test", command: "bun test perf.test.ts" },
          },
        ],
        prd.id,
      ),
    );
    expect(result.ok).toBe(true);
  });

  // REGRESSION — an ungated CorpusService (no GateEnforcer wired) never blocks, byte-identical to pre-gate behavior
  it("does not block when the service was constructed with NO GateEnforcer (bare unit-test shape)", async () => {
    const store = new InMemoryStore();
    await seedLiveRule(store);
    const bareCorpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await mustCreate(bareCorpusService, { type: "prd", title: "PRD", content: "# PRD" } as CreateDocInput);
    const result = await bareCorpusService.create(specInput([BAD_AC], prd.id));
    expect(result.ok).toBe(true);
  });
});

// ─── AC-ACQ-3 (service-layer path): AcService.addCriterion ──────────────────

describe("acQuantifiable — AcService.addCriterion (immediate-feedback layer)", () => {
  async function makeSpec(): Promise<{ corpusService: CorpusService; spec: DocRecord; acService: AcService }> {
    const store = new InMemoryStore();
    await seedLiveRule(store);
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const prd = await mustCreate(corpusService, { type: "prd", title: "PRD", content: "# PRD" } as CreateDocInput);
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "AC Service Spec",
      content: "## Overview\n\nBody.",
    } as CreateDocInput);
    return { corpusService, spec, acService: new AcService(store, new RecordLockService(store, new GateEnforcer(undefined))) };
  }

  // NEGATIVE
  it("rejects addCriterion for an unquantified abstract-word AC, naming the word", async () => {
    const { spec, acService } = await makeSpec();
    const result = await acService.addCriterion(spec.id, BAD_AC);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("fast");
      expect((result.error as { field?: string }).field).toBe("acceptance_criteria.AC-BAD-1");
    }
  });

  // HAPPY
  it("accepts addCriterion for a quantified AC", async () => {
    const { spec, acService } = await makeSpec();
    const result = await acService.addCriterion(spec.id, GOOD_AC);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((c) => c.id)).toContain("AC-GOOD-1");
    }
  });

  // STATE — a rejected addCriterion never mutates the spec's declared criteria
  it("leaves the spec's declared criteria unchanged after a rejected addCriterion", async () => {
    const { spec, acService } = await makeSpec();
    await acService.addCriterion(spec.id, GOOD_AC);
    const rejected = await acService.addCriterion(spec.id, BAD_AC);
    expect(rejected.ok).toBe(false);
    const listed = await acService.listCriteria(spec.id);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.value.criteria.map((c) => c.id)).toEqual(["AC-GOOD-1"]);
    }
  });
});

// ─── AC-ACQ-3 (spec-promote): CorpusService.set / ReviewService.approve ──────

describe("acQuantifiable — spec-promote (CorpusService.set + ReviewService.approve)", () => {
  it("CorpusService.set blocks an approve-transition when a declared AC is unquantified", async () => {
    const { corpusService, store } = await makeCorpusService();
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, [GOOD_AC_2, BAD_AC]);
    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:spec-promote:ac-quantifiable");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("AC-BAD-1");
    }
  });

  it("CorpusService.set allows an approve-transition when every declared AC is quantified", async () => {
    const { corpusService } = await makeCorpusService();
    const prd = await createPrd(corpusService);
    const spec = await mustCreate(corpusService, specInput([GOOD_AC, GOOD_AC_2], prd.id));
    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(true);
  });

  it("ReviewService.approve blocks the same unquantified-AC spec via the plan-promote-shaped GateDependencies bundle", async () => {
    const store = new InMemoryStore();
    await seedLiveRule(store);
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
    const enforcer = new GateEnforcer(undefined);
    const reviewService = new ReviewService(store, undefined, {
      enforcer,
      getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
    });
    const prd = await mustCreate(corpusService, { type: "prd", title: "PRD", content: "# PRD" } as CreateDocInput);
    const spec = await mustCreate(corpusService, specInput([BAD_AC], prd.id));
    const result = await reviewService.approve(spec.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:spec-promote:ac-quantifiable");
    }
  });
});

// ─── AC-ACQ-4: config escape ─────────────────────────────────────────────────

describe("config-escape", () => {
  it("spec-create: workflow.gates.spec-create.ac_quantifiable.enabled=false lets an unquantified-AC spec through", async () => {
    const config = {
      project: { name: "t", author: "t" },
      workflow: { gates: { "spec-create": { ac_quantifiable: { enabled: false } } } },
    } as unknown as LoreConfig;
    const { corpusService } = await makeCorpusService(config);
    const prd = await createPrd(corpusService);
    const result = await corpusService.create(specInput([BAD_AC], prd.id));
    expect(result.ok).toBe(true);
  });

  it("spec-promote: workflow.gates.spec-promote.ac_quantifiable.enabled=false lets an unquantified-AC spec approve", async () => {
    const config = {
      project: { name: "t", author: "t" },
      workflow: { gates: { "spec-promote": { ac_quantifiable: { enabled: false } } } },
    } as unknown as LoreConfig;
    const { corpusService, store } = await makeCorpusService(config);
    const prd = await createPrd(corpusService);
    // spec-create's own ac_quantifiable sub-knob is untouched by this config (still
    // enabled) — insert the doc directly so this test isolates the spec-PROMOTE
    // escape specifically, mirroring the "predates the gate" backstop scenario.
    const spec = await insertRawSpec(store, prd.id, [BAD_AC]);
    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(true);
  });

  it("disabling spec-create's ac_quantifiable does NOT disable spec-promote's (independent sub-knobs)", async () => {
    const config = {
      project: { name: "t", author: "t" },
      workflow: { gates: { "spec-create": { ac_quantifiable: { enabled: false } } } },
    } as unknown as LoreConfig;
    const { corpusService } = await makeCorpusService(config);
    const prd = await createPrd(corpusService);
    // spec-create allows the bad AC through because only ITS sub-knob is disabled
    const spec = await mustCreate(corpusService, specInput([BAD_AC], prd.id));
    // spec-promote is untouched — still blocks the approve-transition
    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:spec-promote:ac-quantifiable");
    }
  });

  it("disabling ONLY ac_quantifiable leaves the rest of spec-create's checks (e.g. skeleton) enforced", async () => {
    const config = {
      project: { name: "t", author: "t" },
      workflow: { gates: { "spec-create": { ac_quantifiable: { enabled: false } } } },
    } as unknown as LoreConfig;
    const { corpusService } = await makeCorpusService(config);
    const prd = await createPrd(corpusService);
    const result = await corpusService.create({
      type: "spec",
      title: "No Skeleton",
      content: "no heading at all",
      extra: { acceptance_criteria: [BAD_AC] },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("MISSING_SKELETON");
      expect(message).not.toContain("AC_NOT_QUANTIFIABLE");
    }
  });
});

// ─── AC-ACQ-5: advisory-only — the deterministic gate path issues ZERO AI-provider calls ──

describe("advisory-only", () => {
  it("spec-create passes for a quantified spec with NO AI provider reachable anywhere in the construction graph", async () => {
    // CorpusService/GateEnforcer/AcService/ReviewService take no AI-provider
    // dependency at all — this constructs the full gate path with only a store
    // and a GateEnforcer, proving the deterministic gate never needs one.
    const { corpusService } = await makeCorpusService();
    const prd = await createPrd(corpusService);
    const result = await corpusService.create(specInput([GOOD_AC], prd.id));
    expect(result.ok).toBe(true);
  });

  it("spec-promote passes for a quantified spec with NO AI provider reachable anywhere in the construction graph", async () => {
    const { corpusService } = await makeCorpusService();
    const prd = await createPrd(corpusService);
    const spec = await mustCreate(corpusService, specInput([GOOD_AC], prd.id));
    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(true);
  });

  // REGRESSION — source-scan: the gate-path modules touched by this feature import
  // no AI/provider symbol, mirroring AC-ACQ-2's own zero-LLM proof for ac-quality.ts.
  it("gate-predicates.ts and checkpoint-registry.ts import no AIProvider/generate symbol", () => {
    const root = join(__dirname, "../../../src/service");
    for (const file of ["gate-predicates.ts", "checkpoint-registry.ts"]) {
      const source = readFileSync(join(root, file), "utf-8");
      expect(source).not.toMatch(/AIProvider/);
      expect(source).not.toMatch(/\.generate\(/);
    }
  });

  it("ac-service.ts's addCriterion lint path imports no AIProvider/generate symbol", () => {
    const source = readFileSync(join(__dirname, "../../../src/service/ac-service.ts"), "utf-8");
    expect(source).not.toMatch(/AIProvider/);
    expect(source).not.toMatch(/\.generate\(/);
  });
});
