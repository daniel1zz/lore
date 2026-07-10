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
  },
} as unknown as LoreConfig;

/** `createApp(dbPath, config)` always returns a bare App here — `sync` is absent. */
function openApp(config?: LoreConfig): App {
  return config === undefined ? createApp(dbPath()) : (createApp(dbPath(), config) as App);
}

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
    const app = openApp();
    try {
      const spec = await createSkeletalSpec(app);
      const result = await app.reviewService.approve(spec.id);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("VALIDATION_ERROR");
        expect((result.error as { field?: string }).field).toBe("gate:spec-promote");
        expect((result.error as { message?: string }).message).toContain("NO_ACCEPTANCE_CRITERIA");
      }
    } finally {
      app.close();
    }
  });

  it("HAPPY: approving a spec with ≥1 declared acceptance criterion PASSES", async () => {
    const app = openApp();
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
    const app = openApp();
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
  ): Promise<{ specId: string; taskId: string }> {
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
    return { specId: spec.value.id, taskId: task.value.id };
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
    const app = openApp();
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
});
