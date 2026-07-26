/**
 * RED suite (TDD-Role: red, paired-impl "T5 plan-close predicate") for
 * SPEC-080 §C4 — a NEW `prdOutlineSynced` predicate on the existing `plan-close`
 * checkpoint (`checkpoint-registry.ts`, which does not declare it yet): a closing
 * plan's ancestor spec must be linked (`parent` or `implements`) to a domain doc,
 * and that domain doc must carry >= 1 version whose content is NON-IDENTICAL to
 * its predecessor inside the plan window `[open, close)` — window opens at the
 * plan's EARLIEST task-claim `at` (fallback: the plan's own `created_at` when no
 * claim was ever recorded), closes at the plan-close write's own timestamp.
 * Version-bump-as-proxy is explicitly REJECTED by the spec (T3) — a content-blind
 * predicate would be trivially gameable, so every scenario below drives a REAL
 * (or deliberately whitespace-only) content diff, never a bare re-save.
 *
 * This predicate sits BEHIND A DEFAULT-OFF KNOB (Phase 0 of the migration plan —
 * "plan-close predicate behind default-OFF knob"), the opposite default of every
 * other per-predicate `workflow.gates.<checkpoint>.<field>.enabled` knob in this
 * codebase (which all default to enabled/absent=on). This suite's own interface
 * choices (config knob path, `PredicateResult.field` value, exemption shape) are
 * this RED task's CONTRACT PROPOSAL for the paired implementation task — chosen to
 * mirror the closest existing precedent (`attestation-floor.test.ts` /
 * `requires-uat-gate.test.ts`'s per-predicate knob + kebab-case field convention)
 * as closely as SPEC-080 §C4's prose allows:
 *   - config knob:  workflow.gates."plan-close".prd_sync.enabled === true (OFF by default)
 *   - field:        "gate:plan-close:prd-outline-synced"
 *   - exemption:    plan.extra.prd_sync_exempt: { reason, by, at } (mirrors
 *                    `attestation_exempt` + required non-empty reason, SPEC-069 D1
 *                    precedent) — `CorpusService.set` must reject a DIRECT patch to
 *                    this field once the dedicated writer (`lore outline exempt`)
 *                    exists (AC-080-4's own text; the domain-overview spec kind
 *                    itself (C2/SPEC_KINDS) is a SEPARATE task's scope, so this
 *                    suite's "domain doc" fixture is a plain spec doc, not
 *                    `spec_kind: "domain-overview"` — that value does not exist in
 *                    `SPEC_KINDS` yet and would fail spec-create for an unrelated
 *                    reason if used here).
 *
 * Harness mirrors `attestation-floor.test.ts` / `requires-uat-gate.test.ts`: real
 * InMemoryStore + GateEnforcer + CorpusService, no bare-predicate-only shortcuts —
 * so the plan-close gate WIRING itself (not just a pure predicate fn) is exercised
 * end-to-end via `corpusService.set(plan.id, {status: "archived"})`.
 *
 * Coverage dimensions: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION.
 *
 * Source: spec-080-prd-as-outline-contract-structured-outline-domain §C4,
 *   §Acceptance Criteria AC-080-4, §Trade-off Decisions T3.
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import type { CreateDocInput, DocRecord, LoreConfig } from "@lore/core";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A fixed past instant, reliably before any real wall-clock "now" at test-run
 *  time — used as a task claim's `at` so the plan window opens WELL BEFORE the
 *  domain-doc edits/archive-write this suite performs "now". */
const PAST_CLAIM_AT = "2020-01-01T00:00:00.000Z";

/** A fixed far-future instant — used to force the plan window OPEN AFTER any
 *  real-time domain-doc edit this suite could possibly perform, so a genuinely
 *  content-differing version still falls OUTSIDE `[open, close)` (BOUNDARY: the
 *  predicate is window-scoped, not "a diff exists anywhere in history"). */
const FUTURE_CLAIM_AT = "2099-01-01T00:00:00.000Z";

function makeHarness(config?: LoreConfig) {
  const store = new InMemoryStore();
  const enforcer = new GateEnforcer(config);
  const corpusService = new CorpusService(store, undefined, undefined, enforcer);
  return { store, corpusService };
}

/** knob ON: `workflow.gates."plan-close".prd_sync.enabled: true` — see module JSDoc
 *  for why this suite proposes that exact path. */
function prdSyncConfig(enabled: boolean): LoreConfig {
  return {
    project: { name: "t", author: "t" },
    ...(enabled
      ? { workflow: { gates: { "plan-close": { prd_sync: { enabled: true } } } } }
      : {}),
  } as unknown as LoreConfig;
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function mustSet(
  cs: CorpusService,
  id: string,
  patch: Record<string, unknown>,
): Promise<DocRecord> {
  const result = await cs.set(id, patch);
  if (!result.ok) throw new Error(`set failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Builds the plan's ancestor chain: root PRD -> {domainDoc, featureSpec}, with
 *  featureSpec --implements--> domainDoc (SPEC-080 §C4: "ancestor spec must be
 *  linked (parent or implements) to a domain doc"). Both specs are plain
 *  `spec_kind: "feature"` docs (default) — `domain-overview` kind doesn't exist
 *  in `SPEC_KINDS` yet (separate task's scope). */
async function makeLinkedAncestry(
  cs: CorpusService,
): Promise<{ prd: DocRecord; domainDoc: DocRecord; featureSpec: DocRecord }> {
  const prd = await mustCreate(cs, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
  const domainDoc = await mustCreate(cs, {
    type: "spec",
    title: "Domain overview: billing",
    parent_id: prd.id,
    content: "## Overview\n\nOriginal domain narrative.",
  } as CreateDocInput);
  const featureSpec = await mustCreate(cs, {
    type: "spec",
    title: "Feature spec: billing checkout",
    parent_id: prd.id,
    content: "## Overview\n\nLanding feature spec.",
  } as CreateDocInput);
  const linkResult = await cs.link(featureSpec.id, domainDoc.id, "implements");
  if (!linkResult.ok) throw new Error(`link failed (setup): ${JSON.stringify(linkResult.error)}`);
  return { prd, domainDoc, featureSpec };
}

/** Creates a plan parented under `featureSpec` (its ancestor spec), fast-tracked
 *  straight to `approved` (a valid single-hop transition — `approved -> archived`
 *  needs no intermediate `active` hop). */
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

/** Creates a task under `plan`, carrying NO verification_evidence (keeps the
 *  pre-existing SPEC-069 `attestationFloor` predicate — which also runs on
 *  plan-close — a structural non-issue for every scenario here, mirroring
 *  `attestation-floor.test.ts`'s own "no evidence at all -> unaffected"
 *  regression). `claimAt` is optional — omitted reproduces the "no claim ever
 *  recorded" scenario. */
async function makeTask(
  cs: CorpusService,
  plan: DocRecord,
  claimAt?: string,
): Promise<DocRecord> {
  const extra: Record<string, unknown> = { plan_id: plan.id };
  if (claimAt !== undefined) {
    extra["claim"] = { by: "agent:t5r", at: claimAt };
  }
  return mustCreate(cs, {
    type: "task",
    title: "Landing task",
    parent_id: plan.id,
    content: "## Task\n\nbody",
    extra,
  } as CreateDocInput);
}

// ─── AC-080-4: zero content-differing versions inside the window → DENY ──────

describe("prdOutlineSynced — knob ON, domain doc never edited after creation → plan-close denied", () => {
  it("denies archiving with VALIDATION_ERROR naming lore outline set / lore set <domain-doc> / lore outline exempt", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { domainDoc, featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan, PAST_CLAIM_AT);
    // domainDoc has exactly ONE version (its own creation) — no predecessor to
    // diff against, so zero content-differing versions exist, in or out of window.

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:prd-outline-synced");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("lore outline set");
      expect(message).toContain("lore set");
      expect(message).toContain(domainDoc.slug);
      expect(message).toContain("lore outline exempt");
    }
  });
});

// ─── AC-080-4: >= 1 content-differing version inside the window → PASS ───────

describe("prdOutlineSynced — knob ON, a real content diff on the domain doc inside the window unblocks the close", () => {
  it("archives once the domain doc's content is substantively edited after the claim, before the close", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { domainDoc, featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan, PAST_CLAIM_AT);
    await mustSet(corpusService, domainDoc.id, {
      content: "## Overview\n\nSubstantively rewritten domain narrative reflecting the landed feature.",
    });

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("archived");
    }
  });
});

// ─── Documented residual: a whitespace-only diff still counts (pinned, not fixed) ──

describe("prdOutlineSynced — BOUNDARY: a whitespace-only content diff still satisfies the predicate (documented residual gameability, SPEC-080 §C4)", () => {
  it("archives after a domain-doc edit that differs from its predecessor by trailing whitespace only", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { domainDoc, featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan, PAST_CLAIM_AT);
    // Same string as domainDoc's original content, plus one trailing space — a
    // pure whitespace no-op edit. SPEC-080 §C4 explicitly ACCEPTS this residual
    // gameability rather than building whitespace-normalizing diff logic.
    await mustSet(corpusService, domainDoc.id, {
      content: "## Overview\n\nOriginal domain narrative. ",
    });

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });
});

// ─── BOUNDARY: the window is real — a diff OUTSIDE [open, close) does not count ──

describe("prdOutlineSynced — BOUNDARY: a content diff that precedes the window's open boundary still denies the close", () => {
  it("denies archiving even though the domain doc WAS edited, when the edit predates the plan's (future) claim", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { domainDoc, featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    // The domain doc is edited FIRST (real "now"), only afterward does the task
    // claim open the window far in the future — the edit's version timestamp is
    // strictly BEFORE that window's open boundary, so it must not count. This is
    // the direct regression guard against a content-blind "any diff, ever"
    // implementation (T3's rejected version-bump-as-proxy shape would pass this
    // scenario; a correctly window-scoped predicate must deny it).
    await mustSet(corpusService, domainDoc.id, {
      content: "## Overview\n\nEdited before the window even opens.",
    });
    await makeTask(corpusService, plan, FUTURE_CLAIM_AT);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:prd-outline-synced");
    }
  });
});

// ─── AC-080-4: a valid prd_sync_exempt bypasses the predicate entirely ───────

describe("prdOutlineSynced — STATE: a valid extra.prd_sync_exempt exempts the plan despite zero diff", () => {
  it("archives a plan declaring a reasoned prd_sync_exempt even though the domain doc was never edited", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec, {
      prd_sync_exempt: {
        reason: "domain narrative genuinely unchanged — pure refactor plan",
        by: "agent:t5r",
        at: "2026-07-26T00:00:00.000Z",
      },
    });
    await makeTask(corpusService, plan, PAST_CLAIM_AT);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("archived");
    }
  });
});

// ─── AC-080-4: direct extra.prd_sync_exempt patch via `set` is rejected ──────

describe("prdOutlineSynced — dedicated-writer guard: `lore set` cannot introduce/change extra.prd_sync_exempt directly", () => {
  it("rejects a plain `set` patch that adds extra.prd_sync_exempt, naming `lore outline exempt`", async () => {
    // Knob state is irrelevant to this guard — it mirrors extra.validity's
    // unconditional dedicated-writer rule (SPEC-043 D10), which fires on `set`
    // regardless of any gate knob.
    const { corpusService } = makeHarness(prdSyncConfig(false));
    const { featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);

    const result = await corpusService.set(plan.id, {
      extra: {
        prd_sync_exempt: { reason: "sneaking this in via set", by: "agent:t5r", at: "2026-07-26T00:00:00.000Z" },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("lore outline exempt");
    }
  });
});

// ─── REGRESSION: knob OFF (default) is byte-identical to pre-change behavior ──

describe("prdOutlineSynced — REGRESSION: knob OFF (the default) never denies, even with zero diff", () => {
  it("archives an unsynced plan unaffected when workflow.gates.'plan-close'.prd_sync.enabled is absent (default OFF)", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(false));
    const { featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan, PAST_CLAIM_AT);
    // domainDoc never edited — would be denied under knob ON (see the first
    // describe block above); must be a silent no-op under the default OFF knob.

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("archived");
    }
  });

  it("archives with no config object at all (undefined LoreConfig) — the true pre-SPEC-080 baseline", async () => {
    const { corpusService } = makeHarness(undefined);
    const { featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan, PAST_CLAIM_AT);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });
});

// ─── AC-080-4 / §C4: no claim ever recorded → window falls back to plan created_at ──

describe("prdOutlineSynced — BOUNDARY: no claim ever recorded opens the window at the plan's own created_at", () => {
  it("archives once the domain doc is edited after plan creation, even though no task ever claimed a lease", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { domainDoc, featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    // Task exists but carries NO extra.claim at all — the fallback-rule scenario.
    await makeTask(corpusService, plan, undefined);
    // Edited AFTER plan creation (real "now" strictly follows plan.created_at) —
    // falls inside [plan.created_at, close) under the fallback rule.
    await mustSet(corpusService, domainDoc.id, {
      content: "## Overview\n\nEdited post-creation, no claim ever existed.",
    });

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("archived");
    }
  });

  it("STILL denies a zero-diff plan with no claim ever recorded (fallback window is real, not a second vacuous-pass escape hatch)", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const { featureSpec } = await makeLinkedAncestry(corpusService);
    const plan = await makeApprovedPlan(corpusService, featureSpec);
    await makeTask(corpusService, plan, undefined);
    // domainDoc never edited at all — zero content-differing versions regardless
    // of where the window opens.

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.error as { field?: string }).field).toBe("gate:plan-close:prd-outline-synced");
    }
  });
});

// ─── REGRESSION: a plan with no spec ancestor at all is unaffected ───────────

describe("prdOutlineSynced — REGRESSION: a plan with no linkable ancestor spec is unaffected by this predicate", () => {
  it("archives a prd-parented plan (no spec tier, so no domain-doc linkage is even possible) with the knob ON", async () => {
    const { corpusService } = makeHarness(prdSyncConfig(true));
    const prd = await mustCreate(corpusService, { type: "prd", title: "Root PRD", content: "# PRD" } as CreateDocInput);
    const created = await mustCreate(corpusService, {
      type: "plan",
      title: "Unlinked plan",
      parent_id: prd.id,
      content: "## Plan\n\nbody",
    } as CreateDocInput);
    const plan = await mustSet(corpusService, created.id, { status: "approved" });
    await makeTask(corpusService, plan, PAST_CLAIM_AT);

    const result = await corpusService.set(plan.id, { status: "archived" });

    expect(result.ok).toBe(true);
  });
});
