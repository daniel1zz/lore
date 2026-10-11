/**
 * RED suite (TDD-Role: red, paired-impl task-skill-implement-core-profiles-gate-wiring-
 * threading-status) for SPEC-058 AC-V-2 — the `oracleCoverage` gate predicate wired
 * onto the `spec-promote` checkpoint (`gate-predicates.ts` + `checkpoint-registry.ts`,
 * neither of which declares this predicate yet). Structural template: this repo's own
 * SPEC-052 suite, `ac-quantifiable-gate.test.ts` (InMemoryStore + bare service
 * construction, `insertRawSpec` to bypass spec-create for spec-promote-only testing,
 * `{...} as unknown as LoreConfig` casts for not-yet-schema'd config keys).
 *
 * Field-discriminator contract this suite PINS for the implementer (mirrors
 * `AC_QUANTIFIABLE_FIELD = "ac-quantifiable"` / `ANCHOR_OVERLAP_FIELD =
 * "anchor-overlap"`'s existing kebab-case convention): a blocked `oracleCoverage`
 * predicate must carry `PredicateResult.field === "oracle-coverage"`, surfacing as
 * `GateEnforcer`'s `gate:spec-promote:oracle-coverage`.
 *
 * Deterministic, zero-LLM by construction (same rationale as ac-quantifiable-gate.
 * test.ts's own header) — CorpusService/ReviewService/GateEnforcer take no AI-provider
 * dependency, so every assertion here proves the gate path never needs one.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 *
 * Source: spec-spec-058-verification-profiles-per-spec-kind-oracle-coverag
 *   §Acceptance Criteria AC-V-2; SPEC-052's own suite as structural precedent.
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
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { CreateDocInput, DocId, DocRecord, LoreConfig } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Script/test-oracle AC (quantified by construction — script mode is never
 *  blocked by SPEC-052's ac_quantifiable lint) — deliberately NOT e2e-bound. */
const NON_E2E_AC = {
  id: "AC-NONE2E-1",
  statement: "the export completes within 5s for a 10MB corpus",
  verify: { mode: "script" as const, oracle: "test" as const, command: "bun test export.test.ts" },
};

/** A second, e2e-bound script AC — added alongside NON_E2E_AC to build the
 *  "matched pair" positive twin (design spec that DOES satisfy the e2e floor). */
const E2E_AC = {
  id: "AC-E2E-1",
  statement: "the checkout flow completes end-to-end within 30s",
  verify: { mode: "script" as const, oracle: "e2e" as const, command: "bun run e2e:checkout" },
};

/** A test/lint-oracle AC — used for the feature-kind profile scenario. */
const TEST_ORACLE_AC = {
  id: "AC-TEST-1",
  statement: "the parser round-trips every fixture file",
  verify: { mode: "script" as const, oracle: "test" as const, command: "bun test parser.test.ts" },
};

function configuredDesignConfig(overrides?: Record<string, unknown>): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    workflow: {
      verification_profiles: { design: { required_oracles: ["e2e"] } },
      ...overrides,
    },
  } as unknown as LoreConfig;
}

function makeCorpusService(config?: LoreConfig) {
  const store = new InMemoryStore();
  const enforcer = new GateEnforcer(config);
  const corpusService = new CorpusService(store, new RecordLockService(store), undefined, undefined, enforcer);
  return { store, corpusService, enforcer };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPrd(cs: CorpusService): Promise<DocRecord> {
  return mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
}

/**
 * Inserts a DRAFT spec directly into the store (bypasses `CorpusService.create` and
 * its spec-create gate) — the exact `insertRawSpec` technique
 * `ac-quantifiable-gate.test.ts` uses to test `spec-promote` in isolation.
 */
async function insertRawSpec(
  store: InMemoryStore,
  parentId: DocId,
  specKind: string,
  acceptanceCriteria: unknown[],
): Promise<DocRecord> {
  // BR-1007: every criterion cites the live fixture rule, so a spec that passes the gates under
  // test is also approvable; a spec with zero criteria stays uncitable (asserted where it matters).
  await seedLiveRule(store);
  const citedCriteria = acceptanceCriteria.map((c) => ({ ...(c as Record<string, unknown>), cites: [LIVE_RULE_ID] }));
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc: DocRecord = {
    id,
    slug: `spec-oracle-${id.slice(-8).toLowerCase()}`,
    type: "spec",
    role: DOC_TYPE_ROLE_MAP.spec,
    title: "Oracle Coverage Test Spec",
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
    extra: { spec_kind: specKind, acceptance_criteria: citedCriteria },
  };
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`insertRawSpec failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

// ─── AC-V-2: matched pair — blocks the negative, passes the positive twin ────

describe("oracleCoverage — spec-promote matched pair (CorpusService.set)", () => {
  // NEGATIVE
  it("blocks promoting a design spec with zero e2e-bound ACs under a configured design profile requiring e2e", async () => {
    const { corpusService, store } = makeCorpusService(configuredDesignConfig());
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, "design", [NON_E2E_AC]);

    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { field?: string }).field).toBe("gate:spec-promote:oracle-coverage");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("e2e");
    }
  });

  // HAPPY (positive twin — same spec, PLUS one e2e-bound AC)
  it("promotes the same spec once an e2e-bound script AC is added alongside the non-e2e one", async () => {
    const { corpusService, store } = makeCorpusService(configuredDesignConfig());
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, "design", [NON_E2E_AC, E2E_AC]);

    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(true);
  });

  // NEGATIVE (same blocking scenario, via ReviewService.approve — the OTHER spec-promote write path)
  it("ReviewService.approve blocks the same missing-e2e design spec", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store));
    const enforcer = new GateEnforcer(configuredDesignConfig());
    const reviewService = new ReviewService(store, undefined, {
      enforcer,
      getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
    });
    const prd = await mustCreate(corpusService, { type: "prd", title: "PRD", content: "# PRD" } as CreateDocInput);
    const spec = await insertRawSpec(store, prd.id, "design", [NON_E2E_AC]);

    const result = await reviewService.approve(spec.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:spec-promote:oracle-coverage");
    }
  });
});

// ─── AC-V-2: profile resolution is spec_kind-scoped, not hardcoded to design ─

describe("oracleCoverage — profile resolution is per-spec_kind", () => {
  // BOUNDARY
  it("a feature-kind spec is judged against ITS OWN configured profile (test), naming 'test' not 'e2e'", async () => {
    const { corpusService, store } = makeCorpusService(
      configuredDesignConfig({
        verification_profiles: {
          design: { required_oracles: ["e2e"] },
          feature: { required_oracles: ["test"] },
        },
      }),
    );
    const prd = await createPrd(corpusService);
    // AI-mode only — never satisfies a script-oracle floor (mirrors AC-V-1's own rule).
    const spec = await insertRawSpec(store, prd.id, "feature", [
      { id: "AC-AI-1", statement: "handled correctly, P95 < 200ms", verify: { mode: "ai", rubric: "P95 < 200ms" } },
    ]);

    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("test");
      expect(message).not.toContain("e2e");
    }
  });

  // NEGATIVE — no configured profile for THIS spec_kind (even though others are configured) => vacuous pass
  it("a tech-kind spec with NO configured 'tech' profile promotes ok regardless of AC oracle content", async () => {
    const { corpusService, store } = makeCorpusService(configuredDesignConfig());
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, "tech", [
      { id: "AC-H-1", statement: "the migration is reversible", verify: { mode: "human" } },
    ]);

    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(true);
  });
});

// ─── task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080: min_acs ──
// (option (a), profile-aware AC-count floor) — end-to-end through the REAL
// CorpusService.set / ReviewService.approve gate paths, mirroring the matched-pair
// pattern above. This is the exact real-world scenario the defect report describes:
// a migrated domain-overview spec with zero declared ACs, blocked pre-fix.

function domainOverviewConfig(overrides?: Record<string, unknown>): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    workflow: {
      verification_profiles: { "domain-overview": { min_acs: 0 } },
      ...overrides,
    },
  } as unknown as LoreConfig;
}

describe("acCountMeetsFloor — spec-promote min_acs (CorpusService.set / ReviewService.approve)", () => {
  // HAPPY — a domain-overview spec with ZERO declared ACs passes the min_acs floor (min_acs is 0)
  // and is then refused ONLY by BR-1007: with no criterion there is nothing to cite, so the
  // refusal is the citation one, never the spec-promote floor's.
  it("a domain-overview spec with zero declared ACs passes the min_acs-0 floor and is refused only for citing nothing (BR-1007)", async () => {
    const { corpusService, store } = makeCorpusService(domainOverviewConfig());
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, "domain-overview", []);

    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("acceptance_criteria");
      expect((result.error as { message?: string }).message).toContain("lore ac cite");
    }
  });

  // HAPPY — same scenario via ReviewService.approve, the OTHER spec-promote write path
  it("ReviewService.approve refuses the same AC-less domain-overview spec only for citing nothing (BR-1007), not on the floor", async () => {
    const store = new InMemoryStore();
    const corpusService = new CorpusService(store, new RecordLockService(store));
    const enforcer = new GateEnforcer(domainOverviewConfig());
    const reviewService = new ReviewService(store, undefined, {
      enforcer,
      getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
    });
    const prd = await mustCreate(corpusService, { type: "prd", title: "PRD", content: "# PRD" } as CreateDocInput);
    const spec = await insertRawSpec(store, prd.id, "domain-overview", []);

    const result = await reviewService.approve(spec.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("acceptance_criteria");
      expect((result.error as { message?: string }).message).toContain("lore ac cite");
    }
  });

  // NEGATIVE — a DIFFERENT spec_kind with no min_acs knob at all is still blocked at 0 ACs,
  // proving the fix is per-spec_kind and not a global disable of the base floor
  it("a feature-kind spec (no min_acs configured anywhere) is still blocked at zero declared ACs", async () => {
    const { corpusService, store } = makeCorpusService(domainOverviewConfig());
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, "feature", []);

    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:spec-promote:acceptance-criteria-count");
    }
  });

  // BOUNDARY — a configured min_acs of 2 blocks a spec with only 1 declared AC
  it("blocks a spec one short of a configured min_acs of 2", async () => {
    const { corpusService, store } = makeCorpusService(
      domainOverviewConfig({ verification_profiles: { design: { min_acs: 2 } } }),
    );
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, "design", [NON_E2E_AC]);

    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const message = (result.error as { message?: string }).message ?? "";
      // AC4 — the denial names the RESOLVED floor and kind, never a hardcoded "1".
      expect(message).toContain("needs >= 2");
      expect(message).toContain('spec_kind "design"');
    }
  });

  // BOUNDARY — the SAME configured min_acs of 2 passes once exactly met
  it("promotes the same spec_kind once declared ACs exactly meet a configured min_acs of 2", async () => {
    const { corpusService, store } = makeCorpusService(
      domainOverviewConfig({ verification_profiles: { design: { min_acs: 2 } } }),
    );
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, "design", [NON_E2E_AC, E2E_AC]);

    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(true);
  });
});

// ─── AC-V-2: config escape (oracle_coverage.enabled: false) ─────────────────

describe("oracleCoverage — config escape", () => {
  // STATE (knob test, AC-V-2's explicit requirement)
  it("workflow.gates.'spec-promote'.oracle_coverage.enabled=false lets a missing-e2e design spec promote", async () => {
    const config = configuredDesignConfig({
      gates: { "spec-promote": { oracle_coverage: { enabled: false } } },
    });
    const { corpusService, store } = makeCorpusService(config);
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, "design", [NON_E2E_AC]);

    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(true);
  });

  // REGRESSION — disabling the WHOLE spec-promote checkpoint also bypasses oracleCoverage
  it("disabling the entire spec-promote checkpoint also lets a missing-e2e design spec promote", async () => {
    const config = configuredDesignConfig({ gates: { "spec-promote": { enabled: false } } });
    const { corpusService, store } = makeCorpusService(config);
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, "design", [NON_E2E_AC]);

    const result = await corpusService.set(spec.id, { status: "approved" });
    expect(result.ok).toBe(true);
  });
});

// ─── AC-V-2: unconfigured corpus — REGRESSION against the frozen baseline fixture ──

describe("oracleCoverage — unconfigured corpus (D1 vacuous pass, frozen REGRESSION fixture)", () => {
  it("promotes a design spec with zero e2e-bound ACs byte-identically to spec-promote-unconfigured-baseline.json", async () => {
    // Deliberately NO `workflow.verification_profiles` anywhere in config — a fully
    // unconfigured corpus, matching the fixture capture scenario exactly.
    const { corpusService, store } = makeCorpusService(undefined);
    const prd = await createPrd(corpusService);
    const spec = await insertRawSpec(store, prd.id, "design", [NON_E2E_AC]);

    const result = await corpusService.set(spec.id, { status: "approved" });
    const outcome = result.ok
      ? { blocked: false, reasons: [] as string[] }
      : { blocked: true, reasons: (result.error as { value?: string[] }).value ?? [] };

    const fixturePath = join(__dirname, "../../fixtures/spec-promote-unconfigured-baseline.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf-8")) as { outcome: typeof outcome };

    expect(outcome).toEqual(fixture.outcome);
  });
});

// ─── AC-V-2: advisory-only — the deterministic gate path issues ZERO AI-provider calls ──

describe("oracleCoverage — advisory-only (no AI anywhere on the gate path)", () => {
  it("gate-predicates.ts and checkpoint-registry.ts import no AIProvider/generate symbol", () => {
    const root = join(__dirname, "../../../src/service");
    for (const file of ["gate-predicates.ts", "checkpoint-registry.ts"]) {
      const source = readFileSync(join(root, file), "utf-8");
      expect(source).not.toMatch(/AIProvider/);
      expect(source).not.toMatch(/\.generate\(/);
    }
  });
});
