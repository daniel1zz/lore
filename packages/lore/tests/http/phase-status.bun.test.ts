/**
 * End-to-end tests for GET /api/phase-status/:planIdOrSlug against a real
 * in-process Bun.Server backed by a REAL SQLiteStore (via `createApp`, the actual
 * production composition root — mirrors `evidence-panel.bun.test.ts`'s SPEC-075 D8
 * rationale: avoid InMemoryStore-vs-production divergence and keep `bun:sqlite`
 * reachability confined to `.bun.test.ts` files).
 *
 * Phase docs are seeded directly via `app.corpusService.create({type: "phase", ...})`
 * — `CorpusService` itself places no restriction on direct `type: "phase"` creation
 * (`createDocInputSchema`'s superRefine only requires `parent_id` + `extra.plan_id`,
 * mirroring `task`); the CLI's `lore create` command excludes `"phase"` from its own
 * `VALID_TYPES` allowlist (phase docs are migration-created only, SPEC-056 D6a), but
 * that is a CLI-adapter-level restriction, not a service-level one — the SAME
 * distinction `mcp-tools-phase.test.ts`/`phase-status-flow.test.ts` already rely on.
 *
 * Test plan (6-dimension; deep scorecard-assembly math coverage lives in
 * `phase-status-flow.test.ts`'s vitest suite — this file proves the REAL route
 * wiring + auth duality + pinned envelope shape, per AC-077-4):
 *   HAPPY:
 *     - a plan with one phase (attested AC + satisfied manual checklist item) → 200
 *       with the pinned `{plan:{id,slug,title}, phases:[...]}` shape, phase fields
 *       populated (state, vacuous, ac_scope, checklist, claim, task_count)
 *     - a plan with ZERO phases → 200 with `phases: []` (not an error)
 *   NEGATIVE:
 *     - no auth header → 401
 *   BOUNDARY:
 *     - cookie session (not just bearer) also reaches this route (auth duality)
 *   ERROR:
 *     - unknown plan id → 404 DOC_NOT_FOUND
 *     - a resolvable non-plan doc (a task) → 422 VALIDATION_ERROR naming the actual type
 *   STATE:
 *     - a vacuous phase (empty ac_scope, empty/all-dropped checklist) renders
 *       `state: "vacuous"` and `vacuous: true`
 *
 * @spec_ref spec-077-dashboard-execution-read-surface-prd-21-f3 AC-077-4
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { startHttpServer } from "../../src/adapters/http/index.js";
import { createMachineAuthStores, type MachineAuthStores } from "../../src/adapters/http/machine-auth.js";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import type { CreateDocInput } from "@lore/core";
import { liveAmbient } from "../live-invocation.js";

interface TestContext {
  server: ReturnType<typeof Bun.serve>;
  app: App;
  rawKey: string;
  // reason: SPEC-078 D1 — the cookie-bootstrap flow (bootstrapCookie below) mints
  // "dashboard-local" on this MACHINE-scope store, never the per-corpus app.apiKeyStore.
  machineAuth: MachineAuthStores;
  machineRawKey: string;
  baseUrl: string;
  tmpDir: string;
  planId: string;
  planSlug: string;
  planTitle: string;
  taskId: string;
}

async function makeTestServer(): Promise<TestContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), "lore-phase-status-"));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  const dbPath = join(tmpDir, ".lore", "lore.db");

  const app = createApp(dbPath, undefined, liveAmbient());

  // reason: SPEC-078 D1 — this key is used ONLY for the bearer-token tests below;
  // "dashboard-local" for the cookie-bootstrap regression test lives on machineAuth.
  const createResult = await app.apiKeyStore.create("regression-agent", "owner");
  if (!createResult.ok) throw new Error("Failed to create API key");
  const rawKey = createResult.value.rawKey;

  const machineAuth = createMachineAuthStores({ baseDir: mkdtempSync(join(tmpdir(), "lore-phase-status-machine-auth-")) });
  const machineKeyResult = await machineAuth.apiKeyStore.create("dashboard-local", "admin");
  if (!machineKeyResult.ok) throw new Error("Failed to create machine API key");

  const prdResult = await app.corpusService.create({ type: "prd", title: "Phase Status Root PRD", content: "root" });
  if (!prdResult.ok) throw new Error("Failed to create seed prd");

  const specResult = await app.corpusService.create({
    type: "spec",
    title: "Phase Status Spec",
    content: "## Spec",
    extra: {
      acceptance_criteria: [
        { id: "AC-1", statement: "does the thing", verify: { mode: "script", oracle: "test", command: "bun test" } },
      ],
    },
  } as CreateDocInput);
  if (!specResult.ok) throw new Error("Failed to create seed spec");

  const planResult = await app.corpusService.create({
    type: "plan",
    title: "Phase Status Plan",
    parent_id: specResult.value.id,
    content: "## Plan",
  } as CreateDocInput);
  if (!planResult.ok) throw new Error("Failed to create seed plan");

  const taskResult = await app.corpusService.create({
    type: "task",
    title: "Phase Status Non-Phase Target",
    parent_id: planResult.value.id,
    content: "## Task",
    // reason: spec-declaring-ac-scope-is-required-at-task-creation-so-the —
    // this plan's spec declares a script-mode AC (AC-1), so task-create's
    // admission gate now requires ac_scope to be declared (any array,
    // including empty). Declared here as ["AC-1"] to match the spec's own
    // criterion — this task's ROLE in the suite is merely "a non-phase
    // document to probe /api/phase-status against", unaffected either way.
    extra: { plan_id: planResult.value.id, ac_scope: ["AC-1"] },
  } as CreateDocInput);
  if (!taskResult.ok) throw new Error("Failed to create seed task");

  const server = startHttpServer(app, { port: 0, host: "127.0.0.1", machineAuth });
  const baseUrl = `http://127.0.0.1:${server.port}`;

  return {
    server,
    app,
    rawKey,
    machineAuth,
    machineRawKey: machineKeyResult.value.rawKey,
    baseUrl,
    tmpDir,
    planId: planResult.value.id,
    planSlug: planResult.value.slug,
    planTitle: planResult.value.title,
    taskId: taskResult.value.id,
  };
}

async function bootstrapCookie(ctx: TestContext): Promise<string> {
  const res = await fetch(`${ctx.baseUrl}/api/auth/local-bootstrap`, {
    method: "POST",
    // reason: SPEC-078 D1 — bootstrap validates against the MACHINE-scope
    // "dashboard-local" key, not the bearer-only ctx.rawKey.
    headers: { "X-Lore-Token": ctx.machineRawKey, Origin: "http://localhost:5173" },
  });
  const { data } = (await res.json()) as { data: { session_id: string } };
  return data.session_id;
}

/** Creates a done-case phase (attested AC-1 + satisfied manual checklist item). */
async function createDonePhase(ctx: TestContext): Promise<{ id: string; title: string }> {
  const title = "Backend slice";
  const result = await ctx.app.corpusService.create({
    type: "phase",
    title,
    parent_id: ctx.planId,
    content: "## Phase",
    extra: {
      plan_id: ctx.planId,
      ac_scope: ["AC-1"],
      checklist: [
        {
          id: "CHK-1",
          statement: "manual smoke test passes",
          bind: { kind: "manual" },
          checked: { by: "alice", at: "2026-07-24T00:00:00.000Z" },
        },
      ],
      verification_evidence: [
        {
          oracle: "test",
          command: "bun test",
          result: "pass",
          recorded_at: "2026-07-24T00:00:00.000Z",
          recorded_by: "agent:t",
          ac_ref: "AC-1",
          attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 10, timed_out: false },
        },
      ],
    },
  } as unknown as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create seed phase: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, title: result.value.title };
}

/** Creates a vacuous phase (no ac_scope, no checklist). */
async function createVacuousPhase(ctx: TestContext): Promise<{ id: string; title: string }> {
  const title = "Untracked slice";
  const result = await ctx.app.corpusService.create({
    type: "phase",
    title,
    parent_id: ctx.planId,
    content: "## Phase",
    extra: { plan_id: ctx.planId },
  } as unknown as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create seed vacuous phase: ${JSON.stringify(result.error)}`);
  return { id: result.value.id, title: result.value.title };
}

interface PhaseScorecardBody {
  source: string;
  phase_id: string;
  phase_title: string;
  state: string;
  vacuous: boolean;
  ac_scope: { total: number; attested: number; blocking: string[] };
  checklist: { total: number; satisfied: number; blocking: string[] };
  checklist_items: Array<{ id: string; state: string; trust: string }>;
  claim: unknown;
  task_count: number;
}

/**
 * Declared-phase scorecard shape (adr-planphasestatus-projects-declared-extra-
 * phases-alongside, ISSUE-007) — no checklist/claim/state, since declared
 * phases (SPEC-023 `plan.extra.phases[]`) are not `phase` docs.
 */
interface DeclaredPhaseScorecardBody {
  source: "declared";
  phase_title: string;
  orphaned: boolean;
  task_count: number;
  evidence: { pass: number; fail: number };
  ac_coverage: Array<{ ac_id: string; pass: number; fail: number }>;
}

/** Declares `plan.extra.phases` on the seed plan (SPEC-023 `lore phase add` shape). */
async function declarePlanPhases(ctx: TestContext, names: string[]): Promise<void> {
  const result = await ctx.app.corpusService.set(ctx.planId, {
    extra: { phases: names.map((name) => ({ name })) },
  });
  if (!result.ok) throw new Error(`Failed to declare phases: ${JSON.stringify(result.error)}`);
}

/** Creates a task under the seed plan naming `phaseName` via `extra.phase`. */
async function createTaskInPhase(
  ctx: TestContext,
  phaseName: string,
  opts?: { evidence?: Array<{ result: "pass" | "fail"; ac_ref?: string }> },
): Promise<{ id: string }> {
  const verification_evidence = (opts?.evidence ?? []).map((e, i) => ({
    oracle: "test",
    // reason: AC-EI-1 — a row tagged with an AC counts only when its command equals that AC's declared command
    // (AC-1 declares "bun test"); untagged rows keep a distinct per-row command.
    command: e.ac_ref !== undefined ? "bun test" : `bun test ${i}`,
    result: e.result,
    recorded_at: "2026-07-26T00:00:00.000Z",
    recorded_by: "agent:t",
    ...(e.ac_ref !== undefined ? { ac_ref: e.ac_ref } : {}),
  }));
  const result = await ctx.app.corpusService.create({
    type: "task",
    title: `Task in ${phaseName}`,
    parent_id: ctx.planId,
    content: "## Task",
    // reason: spec-declaring-ac-scope-is-required-at-task-creation-so-the —
    // this plan's spec declares a script-mode AC (AC-1), so task-create's
    // admission gate now requires ac_scope to be declared on every task
    // created here — unrelated to the declared-PHASE-level ac_scope this
    // file's scorecard assertions read (a phase doc's OWN extra.ac_scope,
    // never a task's).
    extra: { plan_id: ctx.planId, phase: phaseName, ac_scope: ["AC-1"], verification_evidence },
  } as unknown as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create seed task: ${JSON.stringify(result.error)}`);
  return { id: result.value.id };
}

describe("GET /api/phase-status/:planIdOrSlug (SPEC-077 S3)", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await makeTestServer();
  });

  afterEach(() => {
    ctx.server.stop(true);
    ctx.app.close();
    ctx.machineAuth.db.close();
    rmSync(ctx.tmpDir, { recursive: true, force: true });
  });

  describe("HAPPY — populated phases + pinned envelope shape", () => {
    it("a plan with one done-case phase → 200 with plan{id,slug,title} + one populated PhaseScorecard", async () => {
      const phase = await createDonePhase(ctx);

      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        data: { plan: { id: string; slug: string; title: string }; phases: PhaseScorecardBody[] };
      };
      expect(body.ok).toBe(true);
      expect(body.data.plan).toEqual({ id: ctx.planId, slug: ctx.planSlug, title: ctx.planTitle });
      expect(body.data.phases).toHaveLength(1);

      const scorecard = body.data.phases[0];
      expect(scorecard).toBeDefined();
      expect(scorecard?.phase_id).toBe(phase.id);
      expect(scorecard?.phase_title).toBe(phase.title);
      expect(scorecard?.state).toBe("done");
      expect(scorecard?.vacuous).toBe(false);
      expect(scorecard?.ac_scope).toEqual({ total: 1, attested: 1, blocking: [] });
      expect(scorecard?.checklist.total).toBe(1);
      expect(scorecard?.checklist.satisfied).toBe(1);
      expect(scorecard?.checklist_items).toEqual([
        { id: "CHK-1", statement: "manual smoke test passes", state: "satisfied", trust: "manual" },
      ]);
      expect(scorecard?.claim).toBeNull();
      expect(scorecard?.task_count).toBe(0);
    });

    it("a plan with ZERO phases → 200 with phases: [] (not an error)", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; data: { phases: unknown[] } };
      expect(body.ok).toBe(true);
      expect(body.data.phases).toEqual([]);
    });
  });

  describe("STATE — vacuous phase", () => {
    it("a phase with no ac_scope and no checklist renders state:'vacuous' + vacuous:true", async () => {
      await createVacuousPhase(ctx);

      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planSlug}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { phases: PhaseScorecardBody[] } };
      expect(body.data.phases).toHaveLength(1);
      expect(body.data.phases[0]?.state).toBe("vacuous");
      expect(body.data.phases[0]?.vacuous).toBe(true);
    });
  });

  describe("BOUNDARY — auth duality", () => {
    it("a cookie session (not just bearer) also reaches this route → 200", async () => {
      const sessionId = await bootstrapCookie(ctx);
      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planId}`, {
        headers: { Cookie: `lore_sid=${sessionId}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean };
      expect(body.ok).toBe(true);
    });
  });

  describe("NEGATIVE — no auth → 401", () => {
    it("no auth header at all → 401", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planId}`);
      expect(res.status).toBe(401);
    });
  });

  describe("ERROR — unknown id / wrong type", () => {
    it("an unresolvable plan id → 404 DOC_NOT_FOUND", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/phase-status/does-not-exist-at-all`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(404);
      const body = (await res.json()) as { ok: boolean; error: { code: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("DOC_NOT_FOUND");
    });

    it("a resolvable non-plan doc (a task) → 422 VALIDATION_ERROR naming the actual type", async () => {
      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.taskId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(422);
      const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.message).toContain("task");
    });
  });

  // ─── Declared phases (adr-planphasestatus-projects-declared-extra-phases-alongside) ───
  describe("declared phases — SPEC-023 extra.phases with no phase doc", () => {
    it("every existing phase-doc scorecard now carries source:'phase-doc' (additive REGRESSION pin)", async () => {
      await createDonePhase(ctx);
      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      const body = (await res.json()) as { data: { phases: PhaseScorecardBody[] } };
      expect(body.data.phases).toHaveLength(1);
      expect(body.data.phases[0]?.source).toBe("phase-doc");
    });

    it("a declared-only plan (no phase docs) yields a declared scorecard with task/evidence/AC rollups", async () => {
      await declarePlanPhases(ctx, ["Declared Only Phase"]);
      await createTaskInPhase(ctx, "Declared Only Phase", {
        evidence: [
          { result: "pass", ac_ref: "AC-1" },
          { result: "fail" },
        ],
      });
      await createTaskInPhase(ctx, "Declared Only Phase", { evidence: [{ result: "pass" }] });

      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { phases: DeclaredPhaseScorecardBody[] } };
      expect(body.data.phases).toHaveLength(1);

      const declared = body.data.phases[0];
      expect(declared?.source).toBe("declared");
      expect(declared?.phase_title).toBe("Declared Only Phase");
      expect(declared?.orphaned).toBe(false);
      expect(declared?.task_count).toBe(2);
      expect(declared?.evidence).toEqual({ pass: 2, fail: 1 });
      const acFact = declared?.ac_coverage.find((f) => f.ac_id === "AC-1");
      expect(acFact?.pass).toBe(1);
      expect(acFact?.fail).toBe(0);
    });

    it("a declared phase with zero tasks yet is a normal state, not an error", async () => {
      await declarePlanPhases(ctx, ["Empty Declared Phase"]);

      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { phases: DeclaredPhaseScorecardBody[] } };
      expect(body.data.phases).toHaveLength(1);
      expect(body.data.phases[0]?.task_count).toBe(0);
      expect(body.data.phases[0]?.evidence).toEqual({ pass: 0, fail: 0 });
      expect(body.data.phases[0]?.orphaned).toBe(false);
    });

    it("a mixed plan (one phase-doc + one declared-only phase) yields BOTH sources, never double-projecting the phase-doc's own name", async () => {
      const phaseDoc = await createDonePhase(ctx); // title "Backend slice"
      await declarePlanPhases(ctx, [phaseDoc.title, "Frontend slice"]);
      await createTaskInPhase(ctx, "Frontend slice");

      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { phases: Array<PhaseScorecardBody | DeclaredPhaseScorecardBody> };
      };
      expect(body.data.phases).toHaveLength(2); // NOT 3 — "Backend slice" is not double-projected

      const byTitle = new Map(body.data.phases.map((p) => [p.phase_title, p]));
      expect(byTitle.get(phaseDoc.title)?.source).toBe("phase-doc");
      expect(byTitle.get("Frontend slice")?.source).toBe("declared");
    });

    it("a task's extra.phase naming a phase absent from BOTH extra.phases[] and every phase-doc title surfaces as orphaned:true, never silently dropped", async () => {
      // Declare the phase, write a task against it, then remove the declaration —
      // simulating "the plan's declared phases changed after the task was written"
      // (SPEC-023 write-time validation only checks membership AT WRITE TIME).
      await declarePlanPhases(ctx, ["Soon Removed Phase"]);
      await createTaskInPhase(ctx, "Soon Removed Phase", { evidence: [{ result: "pass" }] });
      await declarePlanPhases(ctx, []); // the plan no longer declares any phase

      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { phases: DeclaredPhaseScorecardBody[] } };
      expect(body.data.phases).toHaveLength(1);
      expect(body.data.phases[0]?.source).toBe("declared");
      expect(body.data.phases[0]?.phase_title).toBe("Soon Removed Phase");
      expect(body.data.phases[0]?.orphaned).toBe(true);
      expect(body.data.phases[0]?.task_count).toBe(1);
    });

    it("a phase-doc-only plan (pre-existing seed, no extra.phases declared) stays byte-identical to before this ADR (REGRESSION)", async () => {
      await createDonePhase(ctx);
      const res = await fetch(`${ctx.baseUrl}/api/phase-status/${ctx.planId}`, {
        headers: { Authorization: `Bearer ${ctx.rawKey}` },
      });
      const body = (await res.json()) as { data: { phases: PhaseScorecardBody[] } };
      // Exactly the pre-existing phase-doc scorecard — no declared/orphaned entries
      // fabricated for a plan that never declared extra.phases at all.
      expect(body.data.phases).toHaveLength(1);
      expect(body.data.phases[0]?.ac_scope).toEqual({ total: 1, attested: 1, blocking: [] });
      expect(body.data.phases[0]?.checklist_items).toEqual([
        { id: "CHK-1", statement: "manual smoke test passes", state: "satisfied", trust: "manual" },
      ]);
    });
  });
});
