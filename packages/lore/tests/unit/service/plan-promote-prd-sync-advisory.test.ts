/**
 * RED suite (paired-impl task-t1-applicability-verdict-in-the-predicate-s-own-
 * type-both, item 9) for spec-plan-close-predicates-measure-invariants-an-
 * applicability §Design Decisions D2 — `plan-promote` gains a domain-doc
 * EARLY-WARNING advisory (mirroring `planPromoteReachabilityAdvisory`'s exact
 * shape): fires when `prd_sync` is enabled AND the plan's ancestor spec
 * resolves no domain doc; names the spec slug and the `lore link ... --type
 * implements` wiring command; silent when a domain doc resolves. Surfaced on
 * `ReviewService.approve`'s `ApproveResult.prd_sync_advisories` — a key
 * DISTINCT from the pre-existing `reachability_advisories`, which keeps
 * carrying ONLY the verify-reachability class.
 *
 * Harness mirrors `requires-uat-gate.test.ts` / `plan-close-prd-sync.test.ts`:
 * real InMemoryStore + GateEnforcer + CorpusService + ReviewService, no
 * bare-predicate-only shortcuts — so the plan-promote gate WIRING itself is
 * exercised end-to-end via `reviewService.approve(plan.id)`.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref spec-plan-close-predicates-measure-invariants-an-applicability
 *   §Design Decisions D2, §Acceptance Criteria AC-PCI-4
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { CreateDocInput, DocRecord, LoreConfig } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

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

/** knob ON: `workflow.gates."plan-close".prd_sync.enabled: true` — the SAME knob
 *  `resolvePrdSyncGateEnabled` reads for BOTH the plan-close predicate and this
 *  plan-promote early-warning advisory (`GateEnforcer.isPrdSyncEnabled()`). */
function prdSyncConfig(overrides?: Record<string, unknown>): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    workflow: {
      gates: { "plan-close": { prd_sync: { enabled: true } }, ...(overrides ?? {}) },
    },
  } as unknown as LoreConfig;
}

function makeHarness(config?: LoreConfig) {
  const store = new InMemoryStore();
  const enforcer = new GateEnforcer(config);
  const corpusService = new CorpusService(store, undefined, undefined, enforcer);
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

/** Creates a PRD -> spec (parented DIRECTLY under the PRD, no domain-doc link at
 *  all) declaring `criteria`. Draft (not yet approved). */
async function createUnlinkedSpec(cs: CorpusService, criteria: unknown[]): Promise<DocRecord> {
  const prd = await mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
  const spec = await mustCreate(cs, {
    type: "spec",
    title: "Feature spec: billing checkout",
    parent_id: prd.id,
    content: "## Overview\n\nBody.",
    extra: { acceptance_criteria: criteria },
  } as CreateDocInput);
  const approved = await cs.set(spec.id, { status: "approved" });
  if (!approved.ok) throw new Error(`spec approve failed (setup): ${JSON.stringify(approved.error)}`);
  return approved.value;
}

/** Creates a PRD -> {domainDoc, featureSpec} with featureSpec --implements-->
 *  domainDoc (a resolvable domain doc). featureSpec is approved. */
async function createLinkedSpec(cs: CorpusService, criteria: unknown[]): Promise<DocRecord> {
  const prd = await mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
  const domainDoc = await mustCreate(cs, {
    type: "spec",
    title: "Domain overview: billing",
    parent_id: prd.id,
    content: "## Overview\n\nDomain narrative.",
  } as CreateDocInput);
  const featureSpec = await mustCreate(cs, {
    type: "spec",
    title: "Feature spec: billing checkout",
    parent_id: prd.id,
    content: "## Overview\n\nBody.",
    extra: { acceptance_criteria: criteria },
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

// ─── AC-PCI-4: promote advisory ─────────────────────────────────────────────

describe("plan-promote prd-sync domain-doc promote advisory (AC-PCI-4)", () => {
  // HAPPY — prd_sync enabled, ancestor spec resolves NO domain doc: approve()
  // still succeeds (advisory never blocks), and prd_sync_advisories names the
  // spec's slug and the `lore link ... --type implements` wiring command, on a
  // key DISTINCT from reachability_advisories (absent here — the spec declares
  // a script-mode AC, so `lore verify` IS reachable).
  it("HAPPY: an ancestor spec with no domain doc yields prd_sync_advisories naming the spec + wiring command", async () => {
    const { corpusService, reviewService } = makeHarness(prdSyncConfig());
    const spec = await createUnlinkedSpec(corpusService, [SCRIPT_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prd_sync_advisories).toBeDefined();
      expect(result.value.prd_sync_advisories?.some((a) => a.includes(spec.slug))).toBe(true);
      expect(result.value.prd_sync_advisories?.some((a) => a.includes("--type implements"))).toBe(true);
      expect(result.value.reachability_advisories).toBeUndefined();
    }
  });

  // NEGATIVE — the same plan/config, but the ancestor spec DOES resolve a
  // domain doc (via `implements`): approve() succeeds with NO prd_sync_advisories.
  it("NEGATIVE: a resolvable domain doc yields no prd_sync_advisories at all", async () => {
    const { corpusService, reviewService } = makeHarness(prdSyncConfig());
    const spec = await createLinkedSpec(corpusService, [SCRIPT_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prd_sync_advisories).toBeUndefined();
    }
  });

  // BOUNDARY — prd_sync knob OFF (the default): even with NO domain doc
  // resolvable, no advisory fires — the knob gates this early-warning too.
  it("BOUNDARY: prd_sync disabled (default) suppresses the advisory even with no domain doc", async () => {
    const { corpusService, reviewService } = makeHarness(); // no config at all — prd_sync default OFF
    const spec = await createUnlinkedSpec(corpusService, [SCRIPT_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prd_sync_advisories).toBeUndefined();
    }
  });

  // ERROR (config-shaped) — the WHOLE plan-promote checkpoint disabled
  // suppresses the advisory too, mirroring `reachability_advisories`'s own
  // "disabled checkpoint ⇒ no advisory" shape exactly.
  it("ERROR: plan-promote checkpoint disabled by config suppresses the advisory too", async () => {
    const { corpusService, reviewService } = makeHarness(
      prdSyncConfig({ "plan-promote": { enabled: false } }),
    );
    const spec = await createUnlinkedSpec(corpusService, [SCRIPT_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prd_sync_advisories).toBeUndefined();
    }
  });

  // STATE — a `spec`-type doc's own approve() never computes a prd_sync
  // advisory at all (it has no ancestor of its own to resolve a domain doc
  // from) — regardless of the prd_sync knob.
  it("STATE: approving a spec doc itself never produces a prd_sync_advisories key", async () => {
    const { corpusService, reviewService } = makeHarness(prdSyncConfig());
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
    const spec = await mustCreate(corpusService, {
      type: "spec",
      title: "Standalone spec",
      parent_id: prd.id,
      content: "## Overview\n\nBody.",
      extra: { acceptance_criteria: [SCRIPT_AC] },
    } as CreateDocInput);

    const result = await reviewService.approve(spec.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prd_sync_advisories).toBeUndefined();
    }
  });

  // REGRESSION — both advisory classes can fire SIMULTANEOUSLY, on separate
  // keys, without colliding: an ancestor spec with a HUMAN-mode-only AC (so
  // `lore verify` is unreachable — zero script-mode ACs) AND no domain doc at
  // all yields BOTH reachability_advisories and prd_sync_advisories.
  it("REGRESSION: reachability_advisories and prd_sync_advisories coexist on separate keys without collision", async () => {
    const { corpusService, reviewService } = makeHarness(prdSyncConfig());
    const spec = await createUnlinkedSpec(corpusService, [HUMAN_AC]);
    const plan = await createPlan(corpusService, spec.id);

    const result = await reviewService.approve(plan.id);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reachability_advisories).toBeDefined();
      expect(result.value.prd_sync_advisories).toBeDefined();
      expect(result.value.reachability_advisories).not.toEqual(result.value.prd_sync_advisories);
    }
  });
});
