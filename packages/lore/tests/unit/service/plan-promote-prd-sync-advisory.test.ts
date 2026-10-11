/**
 * plan-promote's domain-doc EARLY-WARNING advisory is RETIRED (slice 3a, BR-984).
 *
 * It existed (spec-plan-close-predicates-measure-invariants-an-applicability §D2, AC-PCI-4) to warn at
 * `lore approve <plan>` time that plan-close's domain-document-edit predicate (`prdOutlineSynced`) would
 * later find its referent absent. That predicate is gone — plan-close now reads cited rule state — so the
 * warning described a gate that no longer exists. This suite keeps the same harness and scenarios and pins
 * the new behaviour: `ReviewService.approve` NEVER produces a `prd_sync_advisories` key, whatever the
 * knob, the domain-doc linkage or the spec's criteria; the sibling `reachability_advisories` channel is
 * untouched (a human-mode-only spec still warns on its own key).
 *
 * Harness: real InMemoryStore + GateEnforcer + CorpusService + ReviewService, through
 * `reviewService.approve(plan.id)`.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref spec-baseline-slice-3a-architecture-tree-baseline-root BR-984
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { LIVE_RULE_ID, seedLiveRule } from "../../helpers/live-rule-fixture.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { CreateDocInput, DocRecord, LoreConfig } from "@lore/core";

const SCRIPT_AC = {
  id: "AC-1",
  statement: "the parser round-trips every fixture file",
  verify: { mode: "script" as const, oracle: "test" as const, command: "bun test parser.test.ts" },
};

const HUMAN_AC = {
  id: "AC-1",
  statement: "the onboarding flow reads clearly",
  verify: { mode: "human" as const },
};

/** knob ON: the SAME `workflow.gates."plan-close".prd_sync.enabled` the retired advisory read. */
function prdSyncConfig(overrides?: Record<string, unknown>): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    workflow: {
      gates: { "plan-close": { prd_sync: { enabled: true } }, ...(overrides ?? {}) },
    },
  } as unknown as LoreConfig;
}

async function makeHarness(config?: LoreConfig) {
  const store = new InMemoryStore();
  await seedLiveRule(store);
  const enforcer = new GateEnforcer(config);
  const corpusService = new CorpusService(store, new RecordLockService(store), undefined, undefined, enforcer);
  const reviewService = new ReviewService(store, undefined, {
    enforcer,
    getPlanBundle: corpusService.getPlanBundle.bind(corpusService),
  });
  return { store, corpusService, reviewService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** BR-1007: every fixture criterion cites the live rule `makeHarness` seeds, so the ancestor spec is approvable. */
function citing(criteria: unknown[]): unknown[] {
  return criteria.map((c) => ({ ...(c as Record<string, unknown>), cites: [LIVE_RULE_ID] }));
}

/** PRD -> spec parented DIRECTLY under the PRD (no domain-doc link at all), approved. */
async function createUnlinkedSpec(cs: CorpusService, criteria: unknown[]): Promise<DocRecord> {
  const prd = await mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
  const spec = await mustCreate(cs, {
    type: "spec",
    title: "Feature spec: billing checkout",
    content: "## Overview\n\nBody.",
    extra: { acceptance_criteria: citing(criteria) },
  } as CreateDocInput);
  const approved = await cs.set(spec.id, { status: "approved" });
  if (!approved.ok) throw new Error(`spec approve failed (setup): ${JSON.stringify(approved.error)}`);
  return approved.value;
}

/** PRD -> {domainDoc, featureSpec} with featureSpec --implements--> domainDoc, approved. */
async function createLinkedSpec(cs: CorpusService, criteria: unknown[]): Promise<DocRecord> {
  const prd = await mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
  const domainDoc = await mustCreate(cs, {
    type: "spec",
    title: "Domain overview: billing",
    content: "## Overview\n\nDomain narrative.",
  } as CreateDocInput);
  const featureSpec = await mustCreate(cs, {
    type: "spec",
    title: "Feature spec: billing checkout",
    content: "## Overview\n\nBody.",
    extra: { acceptance_criteria: citing(criteria) },
  } as CreateDocInput);
  const linkResult = await cs.link(featureSpec.id, domainDoc.id, "implements");
  if (!linkResult.ok) throw new Error(`link failed (setup): ${JSON.stringify(linkResult.error)}`);
  const approved = await cs.set(featureSpec.id, { status: "approved" });
  if (!approved.ok) throw new Error(`spec approve failed (setup): ${JSON.stringify(approved.error)}`);
  return approved.value;
}

async function createPlan(cs: CorpusService, parentId: string): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "plan",
    title: "Test plan",
    parent_id: parentId,
    content: "## Plan\n\nbody",
  } as CreateDocInput);
}

describe("plan-promote no longer produces a prd-sync domain-doc advisory (BR-984)", () => {
  // HAPPY (inverted) — the scenario that USED to yield the advisory (knob on, no domain doc) now yields none.
  it("HAPPY: an ancestor spec with no domain doc approves with NO prd_sync_advisories and no domain-doc wording anywhere", async () => {
    const { corpusService, reviewService } = await makeHarness(prdSyncConfig());
    const spec = await createUnlinkedSpec(corpusService, [SCRIPT_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("prd_sync_advisories" in result.value).toBe(false);
      expect(JSON.stringify(result.value)).not.toContain("--type implements");
      expect(result.value.reachability_advisories).toBeUndefined();
    }
  });

  // NEGATIVE — a resolvable domain doc is equally silent (the linkage no longer matters at all).
  it("NEGATIVE: a resolvable domain doc yields no prd_sync_advisories", async () => {
    const { corpusService, reviewService } = await makeHarness(prdSyncConfig());
    const spec = await createLinkedSpec(corpusService, [SCRIPT_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect("prd_sync_advisories" in result.value).toBe(false);
  });

  // BOUNDARY — knob OFF (default) behaves identically.
  it("BOUNDARY: prd_sync disabled (default) yields no prd_sync_advisories either", async () => {
    const { corpusService, reviewService } = await makeHarness();
    const spec = await createUnlinkedSpec(corpusService, [SCRIPT_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect("prd_sync_advisories" in result.value).toBe(false);
  });

  // ERROR (config-shaped) — the whole plan-promote checkpoint disabled: still no key.
  it("ERROR: plan-promote checkpoint disabled by config still yields no prd_sync_advisories", async () => {
    const { corpusService, reviewService } = await makeHarness(prdSyncConfig({ "plan-promote": { enabled: false } }));
    const spec = await createUnlinkedSpec(corpusService, [SCRIPT_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect("prd_sync_advisories" in result.value).toBe(false);
  });

  // STATE — approving a spec doc itself never produced one and still does not.
  it("STATE: approving a spec doc itself never produces a prd_sync_advisories key", async () => {
    const { corpusService, reviewService } = await makeHarness(prdSyncConfig());
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "Standalone spec",
      content: "## Overview\n\nBody.",
      extra: { acceptance_criteria: citing([SCRIPT_AC]) },
    } as CreateDocInput);

    const result = await reviewService.approve(spec.id);

    expect(result.ok).toBe(true);
    if (result.ok) expect("prd_sync_advisories" in result.value).toBe(false);
  });

  // REGRESSION — the sibling reachability channel is untouched: a human-mode-only spec (no script AC, so
  // `lore verify` is unreachable) still warns on `reachability_advisories`, and only there.
  it("REGRESSION: reachability_advisories still fires on its own key, with no prd_sync_advisories beside it", async () => {
    const { corpusService, reviewService } = await makeHarness(prdSyncConfig());
    const spec = await createUnlinkedSpec(corpusService, [HUMAN_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reachability_advisories).toBeDefined();
      expect("prd_sync_advisories" in result.value).toBe(false);
    }
  });
});
