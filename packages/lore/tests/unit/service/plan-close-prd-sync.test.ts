/**
 * Plan-close, knob `workflow.gates."plan-close".cited_rule_check.enabled`, AFTER slice 3a (BR-984): the former
 * domain-document-edit predicate (`prdOutlineSynced`, SPEC-080 §C4: an in-window, attributable content
 * diff on the ancestor spec's linked domain doc, or a `prd_sync_exempt`) is RETIRED. This file used to
 * pin that predicate's window / attribution / exemption behaviour; it now pins that none of it applies
 * any more, through the real wiring (`corpusService.set(plan, {status: "archived"})`).
 *
 * What replaces the predicate (cited-rule state) is pinned in `plan-close-rule-state.test.ts`; this
 * file covers the surrounding contract that survives:
 *   - the domain document is no longer consulted: an unedited, unattributed, unlinked domain doc
 *     closes with the knob ON (these were the old denials)
 *   - a stored `prd_sync_exempt` is inert (it neither bypasses nor is required) but remains
 *     protected from `lore set` (its writer `lore outline exempt` is retired, BR-985)
 *   - knob OFF / no config / a plan with no spec ancestor close unaffected
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { CreateDocInput, DocRecord, LoreConfig } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

const PAST_CLAIM_AT = "2020-01-01T00:00:00.000Z";

function makeHarness(config?: LoreConfig) {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)), undefined, undefined, new GateEnforcer(config));
  return { store, corpusService };
}

function prdSyncConfig(enabled: boolean): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    ...(enabled ? { workflow: { gates: { "plan-close": { cited_rule_check: { enabled: true } } } } } : {}),
  } as unknown as LoreConfig;
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function mustSet(cs: CorpusService, id: string, patch: Record<string, unknown>): Promise<DocRecord> {
  const result = await cs.set(id, patch);
  if (!result.ok) throw new Error(`set failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** root PRD -> {domainDoc, featureSpec}, featureSpec --implements--> domainDoc. */
async function makeLinkedAncestry(cs: CorpusService): Promise<{ domainDoc: DocRecord; featureSpec: DocRecord }> {
  const prd = await mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
  const domainDoc = await mustCreate(cs, {
    type: "spec",
    title: "Domain overview: billing",
    content: "## Overview\n\nOriginal domain narrative.",
  } as CreateDocInput);
  const featureSpec = await mustCreate(cs, {
    type: "spec",
    title: "Feature spec: billing checkout",
    content: "## Overview\n\nLanding feature spec.",
  } as CreateDocInput);
  const linkResult = await cs.link(featureSpec.id, domainDoc.id, "implements");
  if (!linkResult.ok) throw new Error(`link failed (setup): ${JSON.stringify(linkResult.error)}`);
  return { domainDoc, featureSpec };
}

async function makeApprovedPlan(
  cs: CorpusService,
  featureSpec: DocRecord,
  extra: Record<string, unknown> = {},
): Promise<DocRecord> {
  const created = await mustCreate(cs, {
    type: "plan",
    title: "Test plan",
    parent_id: featureSpec.id,
    content: "## Plan\n\nbody",
    extra,
  } as CreateDocInput);
  return mustSet(cs, created.id, { status: "approved" });
}

async function makeTask(cs: CorpusService, plan: DocRecord): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title: "Landing task",
    parent_id: plan.id,
    content: "## Task\n\nbody",
    extra: { plan_id: plan.id, claim: { by: "agent:t5r", at: PAST_CLAIM_AT } },
  } as CreateDocInput);
}

describe("plan-close with the cited_rule_check knob ON — the domain document is no longer consulted (BR-984)", () => {
  it("HAPPY: closes a plan whose linked domain doc was never edited (the former PRD_OUTLINE_NOT_SYNCED denial)", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("archived");
  });

  it("BOUNDARY: closes when the domain doc was edited with NO attribution to the plan (the former attribution denial)", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { domainDoc, featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan);
    await mustSet(corpusService, domainDoc.id, { content: "## Overview\n\nRewritten, naming neither plan nor spec." });

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });

  it("REGRESSION: the refusal vocabulary of the retired predicate is gone — a plan that closes names neither", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(JSON.stringify(result)).not.toContain("PRD_OUTLINE_NOT_SYNCED");
    expect(JSON.stringify(result)).not.toContain("prd-outline-synced");
  });

  it("STATE: a stored prd_sync_exempt is inert — the close behaves identically with and without it", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec, {
      prd_sync_exempt: { reason: "legacy exemption", by: "agent:t5r", at: "2026-07-26T00:00:00.000Z" },
    });
    await makeTask(corpusService, plan);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });
});

describe("plan-close with the knob OFF / absent / no spec ancestor is unaffected", () => {
  it("REGRESSION: archives with the knob OFF (default)", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(false));
    const { featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });

  it("REGRESSION: archives with no config object at all", async () => {
    const { corpusService } = makeHarness(undefined);
    const { featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });

  it("REGRESSION: archives a prd-parented plan (no spec tier, nothing cited) with the knob ON", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
    const created = await mustCreate(corpusService, {
      type: "plan",
      title: "Unlinked plan",
      parent_id: prd.id,
      content: "## Plan\n\nbody",
    } as CreateDocInput);
    const plan = await mustSet(corpusService, created.id, { status: "approved" });
    await makeTask(corpusService, plan);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });
});
