/**
 * @spec_ref retro follow-up item 8 ("[arch] defense-in-depth")
 *
 * Proves `GateEnforcer` closes the SERVICE-LAYER gate bypass: before this change, the
 * four IoC vertical-slice checkpoints (`spec-create` / `spec-promote` / `plan-promote`
 * / `task-claim`) existed ONLY behind `lore gate <checkpoint>`, a separate CLI
 * pre-flight command an agent/CI hook shells out to. A caller going straight at
 * `CorpusService.create` / `ReviewService.approve` / `TaskWorkflowService.claim` — MCP,
 * HTTP, or a direct-service caller that skips the hook — bypassed every checkpoint
 * entirely. This file exercises those THREE service methods through the REAL
 * `createApp()` composition root (bun:sqlite), never through `lore gate` or any CLI
 * command, proving the checkpoints now fire regardless of caller.
 *
 * bun test (not vitest) — uses a real SQLiteStore via `createApp()`, the same
 * in-process idiom as `gate-p2-cross-tier.bun.test.ts`.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus — every test operates inside its own
 * `mkdtempSync` directory (project CLAUDE.md hard rule).
 *
 * Six-dimension coverage:
 *   HAPPY:      each checkpoint PASSES once its requirement is satisfied (skeleton +
 *                spec_kind for spec-create; ≥1 declared AC for spec-promote; approved
 *                ancestor spec (+AC) for plan-promote; approved ancestor spec for
 *                task-claim)
 *   NEGATIVE:   each checkpoint BLOCKS (err VALIDATION_ERROR, field "gate:<cp>") when
 *                its requirement is unmet — the actual bypass-closure proof
 *   BOUNDARY:   n/a beyond the above — four checkpoints, symmetric happy/negative pairs
 *   STATE:      `workflow.gates.<cp>.enabled: false` makes the corresponding blocked
 *                case pass again — proves config-disable still works at the service
 *                layer, not just in `lore gate`
 *   ERROR:      n/a — VALIDATION_ERROR shape covered by NEGATIVE
 *   REGRESSION: bare `new CorpusService(store)`-style absence-of-gate behavior is
 *                exhaustively covered at the unit level (corpus-service.test.ts,
 *                review-service.test.ts, task-workflow-service.test.ts — all
 *                untouched by this task); not re-tested here
 *
 * SPEC-049 §Design Decisions D3 addendum (the "D3: spec-create denial embeds the
 * feeding-skill rule slice" describe block below): the pure GateEnforcer.enforce()
 * pack-embedding change (D1) is unit-tested in gate-enforcer.test.ts with a
 * hand-built GateContext; THIS file proves the caller-side half — that
 * `CorpusService._createImpl` actually pre-fetches a real approved feeding-skill
 * doc from the store and threads it through — which needs a real store to be
 * meaningful (an approved `knowledge/skill` doc, `findFeedingSkill`'s scan). Both
 * the "found" and "no matching skill doc in the corpus" cases are covered, plus a
 * disabled-gate REGRESSION guard that the extra pre-fetch never fires when
 * `isEnabled("spec-create")` is false.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp, type App } from "../../src/app.js";
import type { CreateDocInput, LoreConfig } from "@lore/core";

// ─── Project setup ────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-gate-enforcer-service-layer-test-")));
  const loreDir = join(tmpDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const app = createApp(join(loreDir, "lore.db"));
  app.close();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function dbPath(): string {
  return join(tmpDir, ".lore", "lore.db");
}

/**
 * Config with all four checkpoints explicitly disabled — proves the STATE dimension
 * (config-disable still works when the enforcer lives at the service layer).
 */
const ALL_GATES_DISABLED_CONFIG = {
  project: { name: "gate-enforcer-service-layer-test", author: "tester" },
  workflow: {
    claim_ttl_minutes: 120,
    gates: {
      "spec-create": { enabled: false },
      "spec-promote": { enabled: false },
      "plan-promote": { enabled: false },
      "task-claim": { enabled: false },
    },
    // SPEC-103 §Mechanisms M2 — `review-judgment` is a SEPARATE checkpoint from the
    // four above (not covered by `gates."spec-promote".enabled` etc.); disabled here
    // too so "ALL gates disabled" stays true to its name for every test that approves
    // a spec/plan under this config.
    review: { judgment_required_types: [] },
  },
} as unknown as LoreConfig;

/** `createApp(dbPath, config)` always returns a bare App here — `sync` is absent. */
function openApp(config?: LoreConfig): App {
  return config === undefined ? createApp(dbPath()) : (createApp(dbPath(), config) as App);
}

/**
 * SPEC-103 §Mechanisms M2 — this whole file predates the judgment-required gate, which
 * is a SEPARATE, ADDITIVE checkpoint on `ReviewService.approve` for spec/adr docs
 * (default `workflow.review.judgment_required_types: ["spec","adr"]`). Every test below
 * that approves a spec/plan to exercise spec-promote/plan-promote/task-claim's OWN
 * concern (not M2's) uses this config to isolate that concern — mirrors this file's own
 * `ALL_GATES_DISABLED_CONFIG` precedent, disabling only the ORTHOGONAL new gate rather
 * than every checkpoint.
 */
const JUDGMENT_NOT_REQUIRED_CONFIG = {
  project: { name: "gate-enforcer-service-layer-test", author: "tester" },
  workflow: { review: { judgment_required_types: [] } },
} as unknown as LoreConfig;

// ─── spec-create ──────────────────────────────────────────────────────────────

describe("GateEnforcer — spec-create (via CorpusService.create, default config ON)", () => {
  it("NEGATIVE: a spec with no `## ` skeleton heading is BLOCKED (err VALIDATION_ERROR)", async () => {
    const app = openApp();
    try {
      const prd = await app.corpusService.create({ type: "prd", title: "Root PRD", content: "PRD body" } as CreateDocInput);
      if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);

      const spec = await app.corpusService.create({
        type: "spec",
        title: "Minimal Spec",
        parent_id: prd.value.id,
        content: "no heading here",
      } as CreateDocInput);

      expect(spec.ok).toBe(false);
      if (!spec.ok) {
        expect(spec.error.code).toBe("VALIDATION_ERROR");
        expect((spec.error as { field?: string }).field).toBe("gate:spec-create");
        expect((spec.error as { message?: string }).message).toContain("MISSING_SKELETON");
      }
    } finally {
      app.close();
    }
  });

  it("HAPPY: a spec with a `## ` skeleton heading PASSES", async () => {
    const app = openApp();
    try {
      const prd = await app.corpusService.create({ type: "prd", title: "Root PRD", content: "PRD body" } as CreateDocInput);
      if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);

      const spec = await app.corpusService.create({
        type: "spec",
        title: "Skeletal Spec",
        parent_id: prd.value.id,
        content: "## Overview\n\nSpec body.\n",
      } as CreateDocInput);

      expect(spec.ok).toBe(true);
    } finally {
      app.close();
    }
  });

  it("STATE: workflow.gates.spec-create.enabled=false lets the skeleton-less spec through", async () => {
    const app = openApp(ALL_GATES_DISABLED_CONFIG);
    try {
      const prd = await app.corpusService.create({ type: "prd", title: "Root PRD", content: "PRD body" } as CreateDocInput);
      if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);

      const spec = await app.corpusService.create({
        type: "spec",
        title: "Ungated Minimal Spec",
        parent_id: prd.value.id,
        content: "no heading here",
      } as CreateDocInput);

      expect(spec.ok).toBe(true);
    } finally {
      app.close();
    }
  });

  // ── SPEC-049 §Design Decisions D3: CorpusService._createImpl pre-fetches the
  // governing feeding skill (+ reuses the already-resolved parent doc's content)
  // so a service-layer spec-create denial's feeding pack matches `lore gate
  // spec-create`'s, not just the bare discriminator. ────────────────────────
  describe("D3: spec-create denial embeds the feeding-skill rule slice", () => {
    it("NEGATIVE + found feeding skill: message contains the rule slice, its [source: <slug>] header, and the parent slice", async () => {
      const app = openApp();
      try {
        const prd = await app.corpusService.create({
          type: "prd",
          title: "Root PRD With Parent Content",
          content: "## Parent Overview\n\nDistinctive parent body text for slicing.",
        } as CreateDocInput);
        if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);

        const skillCreate = await app.corpusService.create({
          type: "knowledge",
          title: "Write-spec rules (D3 test)",
          content: "## Rule\n\nEvery spec needs a `## ` heading skeleton.",
          extra: { sub_type: "skill", skill: { applies_to: "spec" } },
        } as CreateDocInput);
        if (!skillCreate.ok) throw new Error(`skill create failed: ${JSON.stringify(skillCreate.error)}`);
        const skillApprove = await app.corpusService.set(skillCreate.value.id, { status: "approved" });
        if (!skillApprove.ok) throw new Error(`skill approve failed: ${JSON.stringify(skillApprove.error)}`);

        const spec = await app.corpusService.create({
          type: "spec",
          title: "D3 Enrichment Spec",
          parent_id: prd.value.id,
          content: "no heading here",
        } as CreateDocInput);

        expect(spec.ok).toBe(false);
        if (spec.ok) return;
        expect((spec.error as { field?: string }).field).toBe("gate:spec-create");
        const message = (spec.error as { message?: string }).message ?? "";
        expect(message).toContain(`[source: ${skillApprove.value.slug}, trust: team-authored]`);
        expect(message).toContain("Every spec needs a `## ` heading skeleton.");
        expect(message).toContain("Distinctive parent body text for slicing.");
        expect(message).toContain("MISSING_SKELETON");
      } finally {
        app.close();
      }
    });

    // reason: spec-governance-visibility-an-armed-gate-that-vacuously-passes §B3 —
    // this used to assert the corpus-empty case degraded all the way to a bare
    // `[source: unknown]` discriminator with an empty rule slice (byte-identical
    // to what every fresh `lore init` corpus produced, since it starts with zero
    // approved `knowledge/skill` docs). `CorpusService._createImpl` now falls back
    // to a compiled-in rule slice (`FALLBACK_SPEC_CREATE_RULE_SOURCE`/`_MARKDOWN`)
    // instead — the assertions below were updated in the SAME change that shipped
    // the fallback, not loosened independently; the RED this test produced before
    // that fix landed was `expect(message).not.toContain("[source: unknown")`
    // failing because the message DID still contain it.
    it("NEGATIVE + no feeding skill in the corpus: message falls back to the compiled-in rule slice, never [source: unknown]", async () => {
      const app = openApp();
      try {
        const prd = await app.corpusService.create({
          type: "prd",
          title: "Root PRD No Skill Doc",
          content: "PRD body",
        } as CreateDocInput);
        if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);

        const spec = await app.corpusService.create({
          type: "spec",
          title: "No Feeding Skill Spec",
          parent_id: prd.value.id,
          content: "no heading here",
        } as CreateDocInput);

        expect(spec.ok).toBe(false);
        if (spec.ok) return;
        const message = (spec.error as { message?: string }).message ?? "";
        expect(message).not.toContain("[source: unknown");
        expect(message).toContain("[source: built-in fallback (no seeded rule doc), trust: team-authored]");
        expect(message).toContain("Missing:");
        expect(message).toContain("MISSING_SKELETON");
        // The fallback rule slice itself must be genuinely present, not just a
        // non-"unknown" source label with an empty body.
        expect(message).toContain("## Rules a candidate spec must satisfy");
        expect(message).toContain("Legal parent.");
      } finally {
        app.close();
      }
    });

    // STATE — a disabled spec-create gate must skip the feeding-skill pre-fetch
    // entirely (isEnabled short-circuit, mirroring gate.ts's own
    // isGateDisabledByConfig-before-runXGate order), not merely omit it from a
    // still-computed ctx. Observable effect: the create still passes (enforce()'s
    // own disabled short-circuit), so this is really a REGRESSION guard that D3's
    // extra IO didn't introduce a new failure mode when disabled.
    it("STATE: workflow.gates.spec-create.enabled=false still lets a skeleton-less spec through with a feeding skill present", async () => {
      const app = openApp(ALL_GATES_DISABLED_CONFIG);
      try {
        const prd = await app.corpusService.create({ type: "prd", title: "Root PRD", content: "PRD body" } as CreateDocInput);
        if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);

        const skillCreate = await app.corpusService.create({
          type: "knowledge",
          title: "Write-spec rules (disabled-gate test)",
          content: "## Rule\n\nIrrelevant while disabled.",
          extra: { sub_type: "skill", skill: { applies_to: "spec" } },
        } as CreateDocInput);
        if (!skillCreate.ok) throw new Error(`skill create failed: ${JSON.stringify(skillCreate.error)}`);
        const skillApprove = await app.corpusService.set(skillCreate.value.id, { status: "approved" });
        if (!skillApprove.ok) throw new Error(`skill approve failed: ${JSON.stringify(skillApprove.error)}`);

        const spec = await app.corpusService.create({
          type: "spec",
          title: "Disabled Gate D3 Spec",
          parent_id: prd.value.id,
          content: "no heading here",
        } as CreateDocInput);

        expect(spec.ok).toBe(true);
      } finally {
        app.close();
      }
    });
  });
});

// ─── spec-promote (via ReviewService.approve) ────────────────────────────────

describe("GateEnforcer — spec-promote (via ReviewService.approve, default config ON)", () => {
  async function createSkeletalSpec(app: App): Promise<{ id: string; slug: string }> {
    const prd = await app.corpusService.create({ type: "prd", title: "Root PRD", content: "PRD body" } as CreateDocInput);
    if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);
    const spec = await app.corpusService.create({
      type: "spec",
      title: "Approve-Target Spec",
      parent_id: prd.value.id,
      content: "## Overview\n\nSpec body.\n",
    } as CreateDocInput);
    if (!spec.ok) throw new Error(`spec create failed: ${JSON.stringify(spec.error)}`);
    return { id: spec.value.id, slug: spec.value.slug };
  }

  it("NEGATIVE: approving a spec with ZERO declared acceptance criteria is BLOCKED", async () => {
    const app = openApp(JUDGMENT_NOT_REQUIRED_CONFIG);
    try {
      const spec = await createSkeletalSpec(app);
      const result = await app.reviewService.approve(spec.id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        // reason: task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080 —
        // the base AC-count check (`acCountMeetsFloor`) now carries a `field`
        // sub-discriminator (`AC_COUNT_FIELD`), same as every other spec-promote
        // sub-predicate — see gate-enforcer.test.ts's identical update for detail.
        expect((result.error as { field?: string }).field).toBe("gate:spec-promote:acceptance-criteria-count");
        expect((result.error as { message?: string }).message).toContain("NO_ACCEPTANCE_CRITERIA");
      }
    } finally {
      app.close();
    }
  });

  it("HAPPY: approving a spec with ≥1 declared acceptance criterion PASSES", async () => {
    const app = openApp(JUDGMENT_NOT_REQUIRED_CONFIG);
    try {
      const spec = await createSkeletalSpec(app);
      if (app.acService === undefined) throw new Error("AcService not wired");
      const acResult = await app.acService.addCriterion(spec.id, {
        id: "AC-GATE-1",
        statement: "The gated behaviour works as declared.",
        verify: { mode: "human" },
      });
      if (!acResult.ok) throw new Error(`addCriterion failed: ${JSON.stringify(acResult.error)}`);

      const result = await app.reviewService.approve(spec.id);
      expect(result.ok).toBe(true);
    } finally {
      app.close();
    }
  });

  it("STATE: workflow.gates.spec-promote.enabled=false approves a 0-AC spec", async () => {
    const app = openApp(ALL_GATES_DISABLED_CONFIG);
    try {
      const spec = await createSkeletalSpec(app);
      const result = await app.reviewService.approve(spec.id);
      expect(result.ok).toBe(true);
    } finally {
      app.close();
    }
  });
});

// ─── plan-promote (via ReviewService.approve on a plan doc) ─────────────────

describe("GateEnforcer — plan-promote (via ReviewService.approve, default config ON)", () => {
  async function createSpecParentedPlan(
    app: App,
  ): Promise<{ specId: string; planId: string }> {
    const prd = await app.corpusService.create({ type: "prd", title: "Root PRD", content: "PRD body" } as CreateDocInput);
    if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);
    const spec = await app.corpusService.create({
      type: "spec",
      title: "Plan-Promote Spec",
      parent_id: prd.value.id,
      content: "## Overview\n\nSpec body.\n",
    } as CreateDocInput);
    if (!spec.ok) throw new Error(`spec create failed: ${JSON.stringify(spec.error)}`);
    const plan = await app.corpusService.create({
      type: "plan",
      title: "Plan-Promote Plan",
      parent_id: spec.value.id,
      content: "Plan body.",
    } as CreateDocInput);
    if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
    return { specId: spec.value.id, planId: plan.value.id };
  }

  it("NEGATIVE: approving a plan whose ancestor spec is still draft is BLOCKED", async () => {
    const app = openApp();
    try {
      const { planId } = await createSpecParentedPlan(app);
      const result = await app.reviewService.approve(planId);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect((result.error as { field?: string }).field).toBe("gate:plan-promote");
      }
    } finally {
      app.close();
    }
  });

  it("HAPPY: approving a plan whose ancestor spec is approved (+AC) PASSES", async () => {
    const app = openApp(JUDGMENT_NOT_REQUIRED_CONFIG);
    try {
      const { specId, planId } = await createSpecParentedPlan(app);
      if (app.acService === undefined) throw new Error("AcService not wired");
      const acResult = await app.acService.addCriterion(specId, {
        id: "AC-GATE-PP-1",
        statement: "The gated behaviour works as declared.",
        verify: { mode: "human" },
      });
      if (!acResult.ok) throw new Error(`addCriterion failed: ${JSON.stringify(acResult.error)}`);
      const specApprove = await app.reviewService.approve(specId);
      if (!specApprove.ok) throw new Error(`spec approve failed: ${JSON.stringify(specApprove.error)}`);

      const result = await app.reviewService.approve(planId);
      expect(result.ok).toBe(true);
    } finally {
      app.close();
    }
  });

  it("STATE: workflow.gates.plan-promote.enabled=false approves a plan under a draft spec", async () => {
    const app = openApp(ALL_GATES_DISABLED_CONFIG);
    try {
      const { planId } = await createSpecParentedPlan(app);
      const result = await app.reviewService.approve(planId);
      expect(result.ok).toBe(true);
    } finally {
      app.close();
    }
  });
});

// ─── task-claim (via TaskWorkflowService.claim) ──────────────────────────────

describe("GateEnforcer — task-claim (via TaskWorkflowService.claim, default config ON)", () => {
  async function createSpecParentedTask(
    app: App,
  ): Promise<{ specId: string; planId: string; taskId: string }> {
    const prd = await app.corpusService.create({ type: "prd", title: "Root PRD", content: "PRD body" } as CreateDocInput);
    if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);
    const spec = await app.corpusService.create({
      type: "spec",
      title: "Task-Claim Spec",
      parent_id: prd.value.id,
      content: "## Overview\n\nSpec body.\n",
    } as CreateDocInput);
    if (!spec.ok) throw new Error(`spec create failed: ${JSON.stringify(spec.error)}`);
    const plan = await app.corpusService.create({
      type: "plan",
      title: "Task-Claim Plan",
      parent_id: spec.value.id,
      content: "Plan body.",
    } as CreateDocInput);
    if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
    const task = await app.corpusService.create({
      type: "task",
      title: "Task-Claim Task",
      parent_id: plan.value.id,
      content: "Task body.",
      extra: { plan_id: plan.value.id },
    } as CreateDocInput);
    if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
    return { specId: spec.value.id, planId: plan.value.id, taskId: task.value.id };
  }

  it("NEGATIVE: claiming a task whose plan's ancestor spec is still draft is BLOCKED", async () => {
    const app = openApp();
    try {
      const { taskId } = await createSpecParentedTask(app);
      const result = await app.taskWorkflowService.claim(taskId, { by: "alice" });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect((result.error as { field?: string }).field).toBe("gate:task-claim");
      }
    } finally {
      app.close();
    }
  });

  it("HAPPY: claiming a task whose plan's ancestor spec is approved PASSES", async () => {
    const app = openApp(JUDGMENT_NOT_REQUIRED_CONFIG);
    try {
      const { specId, taskId } = await createSpecParentedTask(app);
      if (app.acService === undefined) throw new Error("AcService not wired");
      const acResult = await app.acService.addCriterion(specId, {
        id: "AC-GATE-TC-1",
        statement: "The gated behaviour works as declared.",
        verify: { mode: "human" },
      });
      if (!acResult.ok) throw new Error(`addCriterion failed: ${JSON.stringify(acResult.error)}`);
      const specApprove = await app.reviewService.approve(specId);
      if (!specApprove.ok) throw new Error(`spec approve failed: ${JSON.stringify(specApprove.error)}`);

      const result = await app.taskWorkflowService.claim(taskId, { by: "alice" });
      expect(result.ok).toBe(true);
    } finally {
      app.close();
    }
  });

  it("STATE: workflow.gates.task-claim.enabled=false claims a task under a draft-spec plan", async () => {
    const app = openApp(ALL_GATES_DISABLED_CONFIG);
    try {
      const { taskId } = await createSpecParentedTask(app);
      const result = await app.taskWorkflowService.claim(taskId, { by: "alice" });
      expect(result.ok).toBe(true);
    } finally {
      app.close();
    }
  });

  // ── Adversarial-review regression: disabled gate must short-circuit BEFORE the
  // getPlanBundle IO, not after (review-fix, retro item 8 follow-up) ──────────
  //
  // Pre-fix, `enforceClaimGate` ran `getPlanBundle(task.parent_id)` UNCONDITIONALLY,
  // only checking `resolveGateEnabled` inside `enforce()` — AFTER that IO already ran.
  // A soft-deleted parent plan makes `getPlanBundle` return `DOC_NOT_FOUND` regardless
  // of the enabled flag, so a disabled task-claim gate was NOT byte-identical to
  // pre-GateEnforcer behavior: claim failed with a confusing plan-id DOC_NOT_FOUND
  // instead of succeeding. This test fails red without the `isEnabled` early-out in
  // `enforceClaimGate` (task-workflow-service.ts) and passes green with it.
  it("REGRESSION: disabled task-claim gate SKIPS getPlanBundle IO — claim succeeds even if the parent plan is soft-deleted", async () => {
    const app = openApp(ALL_GATES_DISABLED_CONFIG);
    try {
      const { taskId, planId } = await createSpecParentedTask(app);

      const deleteResult = await app.corpusService.delete(planId, true);
      expect(deleteResult.ok).toBe(true);

      const result = await app.taskWorkflowService.claim(taskId, { by: "tester" });
      expect(result.ok).toBe(true);
    } finally {
      app.close();
    }
  });

  it("STATE contrast: with the gate ENABLED (default), claiming a task under a soft-deleted parent plan is NOT ok (proves the bypass is disable-only)", async () => {
    const app = openApp();
    try {
      const { taskId, planId } = await createSpecParentedTask(app);

      const deleteResult = await app.corpusService.delete(planId, true);
      expect(deleteResult.ok).toBe(true);

      const result = await app.taskWorkflowService.claim(taskId, { by: "tester" });
      expect(result.ok).toBe(false);
    } finally {
      app.close();
    }
  });
});

// ── task-lore-gate-bypass-honored-by-lore-gate-subcommands-but ──────────────
//
// Proves the CHOSEN semantics (Design Decision Option B, `gate-enforcer.ts`'s module
// header): `LORE_GATE_BYPASS=1` NEVER changes whether a REAL write path (here,
// `CorpusService.create`/`ReviewService.approve`, exercised through the SAME real
// `createApp()` composition root the rest of this file uses) blocks — only whether a
// resulting denial's message names the boundary. AC-1 (four cases minimum, this
// file's half of the pair — `gate-spec-create.bun.test.ts` covers the `lore gate`
// pre-flight half unchanged), AC-2 (two independent lone tokens), AC-3 (no
// gate_skipped audit row for this branch — it is a DENIAL, not a skip), AC-4
// (variable unset ⇒ byte-identical to every OTHER describe block above), AC-5
// (composes with the config knob: config-disable is still evaluated FIRST and
// short-circuits to a pass before the env var is ever consulted).
describe("GateEnforcer — LORE_GATE_BYPASS write-path boundary note (task-lore-gate-bypass-honored-by-lore-gate-subcommands-but)", () => {
  const ENV_VAR = "LORE_GATE_BYPASS";
  let originalBypassEnv: string | undefined;

  beforeEach(() => {
    originalBypassEnv = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
  });

  afterEach(() => {
    if (originalBypassEnv === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = originalBypassEnv;
  });

  async function createSkeletonlessSpecPrd(app: App): Promise<string> {
    const prd = await app.corpusService.create({
      type: "prd",
      title: "Bypass-Boundary Root PRD",
      content: "PRD body",
    } as CreateDocInput);
    if (!prd.ok) throw new Error(`prd create failed: ${JSON.stringify(prd.error)}`);
    return prd.value.id;
  }

  // REGRESSION (AC-4) — variable UNSET: a non-compliant spec-create denial carries
  // NO boundary note at all, byte-identical to the base "NEGATIVE" describe block's
  // assertion far above in this same file.
  it("REGRESSION: LORE_GATE_BYPASS unset — spec-create denial message contains no boundary note", async () => {
    const app = openApp();
    try {
      const parentId = await createSkeletonlessSpecPrd(app);
      const spec = await app.corpusService.create({
        type: "spec",
        title: "No-Bypass-Env Spec",
        parent_id: parentId,
        content: "no heading here",
      } as CreateDocInput);

      expect(spec.ok).toBe(false);
      if (spec.ok) return;
      const message = (spec.error as { message?: string }).message ?? "";
      expect(message).toContain("MISSING_SKELETON");
      expect(message).not.toContain("LORE_GATE_BYPASS");
      expect(message).not.toContain("workflow.gates");
    } finally {
      app.close();
    }
  });

  // NEGATIVE + AC-1 + AC-2 — variable SET to "1": the write path STILL denies (the
  // checkpoint predicates ran unconditionally — Option B), but the message now names
  // BOTH the variable itself and the config knob that DOES apply here, as two
  // independent lone tokens (never one remembered sentence — contiguous-substring
  // rule).
  it("NEGATIVE: LORE_GATE_BYPASS=1 — spec-create STILL denies, message names the boundary via two independent lone tokens", async () => {
    process.env[ENV_VAR] = "1";
    const app = openApp();
    try {
      const parentId = await createSkeletonlessSpecPrd(app);
      const spec = await app.corpusService.create({
        type: "spec",
        title: "Bypass-Env-Set Spec",
        parent_id: parentId,
        content: "no heading here",
      } as CreateDocInput);

      expect(spec.ok).toBe(false);
      if (spec.ok) return;
      expect((spec.error as { code?: string }).code).toBe("VALIDATION_ERROR");
      const message = (spec.error as { message?: string }).message ?? "";
      expect(message).toContain("MISSING_SKELETON");
      // Two INDEPENDENT lone tokens, not one contiguous remembered phrase.
      expect(message).toContain("LORE_GATE_BYPASS");
      expect(message).toContain("workflow.gates");
      // Names the exact supported per-checkpoint alternative.
      expect(message).toContain("workflow.gates.spec-create.enabled: false");
    } finally {
      app.close();
    }
  });

  // BOUNDARY — an env value that is NOT exactly "1" (mirrors gate.ts's own
  // `=== "1"` check) never triggers the note — a truthy-looking string like "true"
  // must not be treated as the bypass being set.
  it("BOUNDARY: LORE_GATE_BYPASS=true (not exactly \"1\") — no boundary note", async () => {
    process.env[ENV_VAR] = "true";
    const app = openApp();
    try {
      const parentId = await createSkeletonlessSpecPrd(app);
      const spec = await app.corpusService.create({
        type: "spec",
        title: "Bypass-Env-Truthy Spec",
        parent_id: parentId,
        content: "no heading here",
      } as CreateDocInput);

      expect(spec.ok).toBe(false);
      if (spec.ok) return;
      const message = (spec.error as { message?: string }).message ?? "";
      expect(message).not.toContain("LORE_GATE_BYPASS");
    } finally {
      app.close();
    }
  });

  // AC-1 second write-path case — spec-promote (ReviewService.approve) on a 0-AC
  // spec, mirroring the task doc's own suggested "OR lore set --status approved on
  // a 0-AC spec" example.
  it("NEGATIVE: LORE_GATE_BYPASS=1 — approving a 0-AC spec STILL denies, message names the boundary", async () => {
    process.env[ENV_VAR] = "1";
    const app = openApp(JUDGMENT_NOT_REQUIRED_CONFIG);
    try {
      const parentId = await createSkeletonlessSpecPrd(app);
      const spec = await app.corpusService.create({
        type: "spec",
        title: "Bypass-Env-Approve Spec",
        parent_id: parentId,
        content: "## Overview\n\nBody.\n",
      } as CreateDocInput);
      if (!spec.ok) throw new Error(`spec create failed: ${JSON.stringify(spec.error)}`);

      const result = await app.reviewService.approve(spec.value.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const message = (result.error as { message?: string }).message ?? "";
      expect(message).toContain("NO_ACCEPTANCE_CRITERIA");
      expect(message).toContain("LORE_GATE_BYPASS");
      expect(message).toContain("workflow.gates.spec-promote.enabled: false");
    } finally {
      app.close();
    }
  });

  // AC-3 — the audit trail: a write-path denial with the variable set is NOT a
  // skip (the checkpoint ran and blocked) — zero `gate_skipped` rows of ANY
  // mechanism are recorded for this call, unlike a genuine config-disabled skip.
  it("AC-3: a write-path denial under LORE_GATE_BYPASS=1 writes NO gate_skipped audit row", async () => {
    process.env[ENV_VAR] = "1";
    const app = openApp();
    try {
      const parentId = await createSkeletonlessSpecPrd(app);
      const spec = await app.corpusService.create({
        type: "spec",
        title: "Bypass-Env-Audit Spec",
        parent_id: parentId,
        content: "no heading here",
      } as CreateDocInput);
      expect(spec.ok).toBe(false);

      const auditResult = await app.auditService.query({ action: "gate_skipped" });
      expect(auditResult.ok).toBe(true);
      if (!auditResult.ok) return;
      expect(auditResult.value).toEqual([]);
    } finally {
      app.close();
    }
  });

  // STATE (AC-5) — precedence: the per-checkpoint config knob is evaluated BEFORE
  // any predicate runs (this module's pre-existing `resolveGateEnabled` early
  // return), so a config-disabled checkpoint passes regardless of the env var, and
  // the env var never gets a chance to annotate anything (there is no denial to
  // annotate). This is the documented precedence made explicit by assertion.
  it("STATE: workflow.gates.spec-create.enabled=false + LORE_GATE_BYPASS=1 together — still passes (config-disable precedes the env var)", async () => {
    process.env[ENV_VAR] = "1";
    const config = {
      project: { name: "x", author: "y" },
      workflow: { claim_ttl_minutes: 120, gates: { "spec-create": { enabled: false } } },
    } as unknown as LoreConfig;
    const app = openApp(config);
    try {
      const parentId = await createSkeletonlessSpecPrd(app);
      const spec = await app.corpusService.create({
        type: "spec",
        title: "Bypass-Env-And-Config-Disabled Spec",
        parent_id: parentId,
        content: "no heading here", // would otherwise fail MISSING_SKELETON
      } as CreateDocInput);

      expect(spec.ok).toBe(true);

      // Exactly ONE gate_skipped row (this test's single spec-create call), and its
      // mechanism is `config_disabled` — never `env_bypass` — because this write
      // path never even reads LORE_GATE_BYPASS on a config-disabled checkpoint (the
      // early return in `enforce()` precedes that read entirely).
      const auditResult = await app.auditService.query({ action: "gate_skipped" });
      expect(auditResult.ok).toBe(true);
      if (!auditResult.ok) return;
      expect(auditResult.value).toHaveLength(1);
      expect((auditResult.value[0]?.details as { mechanism?: string } | undefined)?.mechanism).toBe(
        "config_disabled",
      );
    } finally {
      app.close();
    }
  });
});
