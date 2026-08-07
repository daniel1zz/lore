/**
 * Unit tests for `adapters/cli/task-feed-wiring.ts`'s real `TaskFeedFlowDeps`
 * binding (SPEC-070 review-fix wave — task-skill-implement-fixa-wiring-core-
 * surrogate-clip-tolerant). Covers the seven named findings this task closes:
 *   F1/AC-070-10  surrogate-safe `output_tail` clipping (headChars, no bare slice)
 *   F2/AC-070-11  per-entry tolerant fail-evidence extraction
 *   F3/AC-070-12  shared fail-first `deriveAcCoverageState` precedence
 *   F4/AC-070-13  a present-but-schema-invalid `plan.extra.ac_scope` fails loud
 *   F5/AC-070-14  aux-port internal refetch failures propagate, never manufacture
 *                 a success row
 *   F10/AC-070-17 the task doc is fetched exactly once; `computeAcCoverage` stays
 *                 correct after its single-pass restructure
 *
 * Strategy mirrors `mcp-feed-task-start.test.ts`: a REAL `App` backed by
 * `InMemoryStore` + real services (`CorpusService`/`TaskWorkflowService`/
 * `SessionService`), NOT hand-rolled fakes — `buildTaskFeedFlowDeps(app)`'s
 * bindings take a full `App`, and InMemoryStore is vitest-safe (no `bun:sqlite`).
 * UNLIKE that MCP fixture, `taskWorkflowService` here is wired with the REAL
 * `corpusService.resolveDeclaredAcIds.bind(corpusService)` port (not an
 * always-empty-set stub) so `ac_ref` cross-entity validation actually passes for
 * evidence referencing a real declared criterion (AC-070-12 needs this).
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start
 *   §Acceptance Criteria AC-070-10..14, 17; task-skill-implement-fixa-wiring-core-
 *   surrogate-clip-tolerant (F1, F2, F3, F4, F5, F10).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { buildTaskFeedFlowDeps } from "../../../src/adapters/cli/task-feed-wiring.js";
import { buildTaskStartPack } from "../../../src/flows/task-feed-flow.js";
import { NoOpTelemetry, ok, deriveAcCoverageState, computeAcCoverage } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import type { CreateDocInput, DocRecord, AcCoverageFact } from "@lore/core";
import type { RelatedKnowledgeRef } from "../../../src/flows/task-feed-flow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/lore/tests/unit/adapters/ -> ../../../src/adapters/cli/commands/ac.ts
const AC_TS_PATH = resolve(__dirname, "../../../src/adapters/cli/commands/ac.ts");

// ─── Test infrastructure (mirrors mcp-feed-task-start.test.ts) ─────────────

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store);
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10_080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });

  return {
    corpusService,
    reviewService: new ReviewService(store),
    versionService: new VersionService(store),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    // reason: REAL cross-entity port (unlike mcp-feed-task-start.test.ts's
    // always-empty-set stub) — AC-070-12's fixture needs `addEvidence` to
    // actually accept an `ac_ref` naming a real declared criterion.
    taskWorkflowService: new TaskWorkflowService(
      store,
      new NoOpTelemetry(),
      { claimTtlMinutes: 120 },
      corpusService.resolveDeclaredAcIds.bind(corpusService),
    ),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    sessionService,
    callerSurface: "cli" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

async function createPrd(title = "Wiring Test PRD"): Promise<DocRecord> {
  const result = await corpusService.create({ type: "prd", title, content: "PRD body." } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** A spec with one script-mode declared criterion `AC-X-1` (or `criteria` override). */
async function createSpec(
  parentId: string,
  criteria: unknown[] = [
    {
      id: "AC-X-1",
      statement: "The widget renders without throwing.",
      verify: { mode: "script", oracle: "test", command: "bun test" },
    },
  ],
  title = "Wiring Test Spec",
): Promise<DocRecord> {
  const result = await corpusService.create({
    type: "spec",
    title,
    parent_id: parentId,
    content: "Spec body.",
    extra: { acceptance_criteria: criteria },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create spec: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPlan(parentId: string, title = "Wiring Test Plan"): Promise<DocRecord> {
  const result = await corpusService.create({
    type: "plan",
    title,
    parent_id: parentId,
    content: "Plan body.",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createTask(planId: string, title = "Wiring Test Task"): Promise<DocRecord> {
  const result = await corpusService.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create task: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createKnowledge(title = "Wiring Test Knowledge"): Promise<DocRecord> {
  const result = await corpusService.create({
    type: "knowledge",
    title,
    content: "Knowledge body.",
    extra: { sub_type: "reference" },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create knowledge: ${JSON.stringify(result.error)}`);
  return result.value;
}

let app: App;

beforeEach(() => {
  app = makeApp();
});

// ─── F1/AC-070-10 — surrogate-safe output_tail clipping ────────────────────

describe("HAPPY — surrogate-safe output_tail clipping (F1/AC-070-10)", () => {
  it("an astral-plane character straddling the 500-char clip boundary is dropped whole, never split into an unpaired surrogate", async () => {
    const prd = await createPrd();
    const plan = await createPlan(prd.id);
    const task = await createTask(plan.id);

    // 499 ASCII chars, then a 2-code-unit emoji spanning indices 499-500 (the
    // naive .slice(0, 500) cut point), then more filler — 511 code units total.
    const outputTail = "a".repeat(499) + "\u{1F600}" + "b".repeat(10);
    const evidenceResult = await app.taskWorkflowService.addEvidence(task.slug, {
      oracle: "test",
      command: "bun test",
      result: "fail",
      output_tail: outputTail,
      recorded_by: "agent:wiring-test",
      capture_source: "self-report",
    });
    expect(evidenceResult.ok).toBe(true);

    const deps = buildTaskFeedFlowDeps(app);
    const bundleResult = await deps.getTaskBundle(task.slug);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;

    const tail = bundleResult.value.priorFailures[0]?.tail;
    expect(tail).toBeDefined();
    if (tail === undefined) return;

    // The whole emoji (and everything after it) is dropped, never split.
    expect(tail).toBe("a".repeat(499));
    expect(tail.length).toBeLessThanOrEqual(500);

    // No lone high-surrogate at the very end (the corruption this fix prevents).
    const lastCode = tail.charCodeAt(tail.length - 1);
    expect(lastCode >= 0xd800 && lastCode <= 0xdbff).toBe(false);
  });
});

// ─── F2/AC-070-11 — per-entry tolerant evidence extraction ─────────────────

describe("NEGATIVE — per-entry tolerant fail-evidence extraction (F2/AC-070-11)", () => {
  it("2 parseable fail entries plus 1 malformed entry render both failures AND an explicit degraded count", async () => {
    const prd = await createPrd();
    const plan = await createPlan(prd.id);
    const task = await createTask(plan.id);

    const nowIso = "2026-07-24T00:00:00.000Z";
    const rawEvidence = [
      { oracle: "test", command: "bun test A", result: "fail", recorded_at: nowIso, recorded_by: "agent:wiring-test" },
      // malformed: "BOGUS_ORACLE" is not a member of ORACLE_KINDS — fails evidenceEntrySchema.
      { oracle: "BOGUS_ORACLE", command: "bun test B", result: "fail", recorded_at: nowIso, recorded_by: "agent:wiring-test" },
      { oracle: "tsc", command: "bun run typecheck", result: "fail", recorded_at: nowIso, recorded_by: "agent:wiring-test" },
    ];
    const updateResult = await store.update(task.id, {
      extra: { ...task.extra, verification_evidence: rawEvidence },
    });
    expect(updateResult.ok).toBe(true);

    const deps = buildTaskFeedFlowDeps(app);
    const bundleResult = await deps.getTaskBundle(task.slug);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;

    expect(bundleResult.value.priorFailures).toHaveLength(2);
    expect(bundleResult.value.priorFailures.map((f) => f.command)).toEqual(["bun test A", "bun run typecheck"]);
    expect(bundleResult.value.unparseableEvidenceCount).toBe(1);

    // Full-pack render: both failures AND the degraded line, never the
    // no-prior-failures line (a non-empty raw array must never silently
    // render "no prior failures").
    const packResult = await buildTaskStartPack(deps, task.slug);
    expect(packResult.ok).toBe(true);
    if (!packResult.ok) return;
    expect(packResult.value.sections.constraints).toContain("bun test A");
    expect(packResult.value.sections.constraints).toContain("bun run typecheck");
    expect(packResult.value.sections.constraints).toContain("1 evidence entries unparseable");
    expect(packResult.value.sections.constraints).not.toContain("no prior failures");
  });

  it("zero evidence entries yields zero unparseable and the ordinary no-prior-failures line (REGRESSION)", async () => {
    const prd = await createPrd();
    const plan = await createPlan(prd.id);
    const task = await createTask(plan.id);

    const deps = buildTaskFeedFlowDeps(app);
    const bundleResult = await deps.getTaskBundle(task.slug);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.unparseableEvidenceCount).toBe(0);
    expect(bundleResult.value.priorFailures).toEqual([]);
  });
});

// ─── F3/AC-070-12 — shared fail-first coverage precedence ──────────────────

describe("STATE — shared fail-first AC coverage precedence (F3/AC-070-12)", () => {
  it("deriveAcCoverageState (the shared @lore/core helper) is fail-first: pass>0 AND fail>0 -> \"fail\"", () => {
    const base: AcCoverageFact = { ac_id: "AC-1", mode: "script", pass: 0, fail: 0, refs: [], attested_pass: 0, attested_fail: 0, falsified: 0 };
    expect(deriveAcCoverageState({ ...base, pass: 1, fail: 1 })).toBe("fail");
    expect(deriveAcCoverageState({ ...base, pass: 1, fail: 1, attested_pass: 1 })).toBe("fail");
    expect(deriveAcCoverageState({ ...base, pass: 1, attested_pass: 1 })).toBe("attested_pass");
    // falsified: 0 (never observed red) + a self-reported pass -> "pass_unfalsified",
    // not plain "pass" (spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1, AC-FALS-2).
    expect(deriveAcCoverageState({ ...base, pass: 1 })).toBe("pass_unfalsified");
    expect(deriveAcCoverageState(base)).toBe("none");
  });

  it("a criterion with an attested pass AND a later fail labels \"fail\" in the task-start pack, never \"attested_pass\"", async () => {
    const prd = await createPrd();
    const spec = await createSpec(prd.id);
    const plan = await createPlan(spec.id);
    const task = await createTask(plan.id);

    const passResult = await app.taskWorkflowService.addEvidence(task.slug, {
      oracle: "test",
      command: "bun test",
      result: "pass",
      ac_ref: "AC-X-1",
      recorded_by: "agent:wiring-test",
      output_tail: "ok",
      capture_source: "self-report",
    });
    expect(passResult.ok).toBe(true);
    const failResult = await app.taskWorkflowService.addEvidence(task.slug, {
      oracle: "test",
      command: "bun test",
      result: "fail",
      ac_ref: "AC-X-1",
      recorded_by: "agent:wiring-test",
      output_tail: "AssertionError: expected 1 to equal 2",
      capture_source: "self-report",
    });
    expect(failResult.ok).toBe(true);

    const deps = buildTaskFeedFlowDeps(app);
    const bundleResult = await deps.getTaskBundle(task.slug);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.acceptance).toHaveLength(1);
    expect(bundleResult.value.acceptance[0]?.coverage).toBe("fail");
  });

  it("REGRESSION: commands/ac.ts's coverageBadge delegates to the shared deriveAcCoverageState — no second precedence implementation", () => {
    const source = readFileSync(AC_TS_PATH, "utf8");
    expect(source).toContain("deriveAcCoverageState");
  });
});

// ─── F4/AC-070-13 — schema-invalid ac_scope fails loud ─────────────────────

describe("ERROR — a present-but-schema-invalid plan.extra.ac_scope fails loud (F4/AC-070-13)", () => {
  it("a non-array ac_scope value returns VALIDATION_ERROR naming plan.extra.ac_scope, never silently treated as absent", async () => {
    const prd = await createPrd();
    const spec = await createSpec(prd.id);
    const plan = await createPlan(spec.id);
    const task = await createTask(plan.id);

    // Bypass CorpusService's own cross-entity validation (a direct store write —
    // legacy/corrupted-data simulation, mirrors mcp-feed-task-start.test.ts's
    // raw `store.insert` phase-doc fixture).
    const updateResult = await store.update(plan.id, {
      extra: { ...plan.extra, ac_scope: { not: "an array" } },
    });
    expect(updateResult.ok).toBe(true);

    const deps = buildTaskFeedFlowDeps(app);
    const bundleResult = await deps.getTaskBundle(task.slug);
    expect(bundleResult.ok).toBe(false);
    if (bundleResult.ok) return;
    expect(bundleResult.error.code).toBe("VALIDATION_ERROR");
    expect("field" in bundleResult.error ? bundleResult.error.field : undefined).toBe("plan.extra.ac_scope");
    const message = "message" in bundleResult.error ? bundleResult.error.message : "";
    expect(message).toContain("ac_scope");
  });

  it("REGRESSION: an absent ac_scope stays legal — no error, acceptance renders scoped:true", async () => {
    const prd = await createPrd();
    const spec = await createSpec(prd.id);
    const plan = await createPlan(spec.id);
    const task = await createTask(plan.id);

    const deps = buildTaskFeedFlowDeps(app);
    const bundleResult = await deps.getTaskBundle(task.slug);
    expect(bundleResult.ok).toBe(true);
    if (!bundleResult.ok) return;
    expect(bundleResult.value.acceptance[0]?.scoped).toBe(true);
  });
});

// ─── F5/AC-070-14 — aux-port internal refetch failures propagate ───────────

describe("ERROR — aux-port internal refetch failures propagate, never manufacture a success row (F5/AC-070-14)", () => {
  it("a knowledge pointer whose doc cannot be re-fetched propagates err(...), never an invalidated:false row", async () => {
    const deps = buildTaskFeedFlowDeps(app);
    const ghostPointer: RelatedKnowledgeRef = { id: "01GHOSTDOCTHATDOESNOTEXIST0", slug: "ghost", title: "Ghost" };

    const result = await deps.listLinkedKnowledgePointers([ghostPointer], 20);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  it("a resolvable knowledge pointer still succeeds normally (REGRESSION)", async () => {
    const knowledge = await createKnowledge();
    const deps = buildTaskFeedFlowDeps(app);
    const pointer: RelatedKnowledgeRef = { id: knowledge.id, slug: knowledge.slug, title: knowledge.title };

    const result = await deps.listLinkedKnowledgePointers([pointer], 20);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ doc_id: knowledge.id, slug: knowledge.slug, title: knowledge.title, invalidated: false }]);
  });

  it("a handoff doc that cannot be re-fetched propagates err(...), never a {slug, title: slug} row", async () => {
    const prd = await createPrd();
    const plan = await createPlan(prd.id);

    if (app.sessionService === undefined) throw new Error("sessionService not wired");
    vi.spyOn(app.sessionService, "resume").mockResolvedValue(
      ok({
        found: true,
        handoff: {
          handoff_slug: "does-not-exist-handoff-slug",
          plan_slug: plan.slug,
          by: "agent:wiring-test",
          at: "2026-07-24T00:00:00.000Z",
          age_minutes: 0,
          ttl_warning: false,
          degraded: false,
          content: "",
        },
        multi_actor: false,
        readiness: null,
      }),
    );

    const deps = buildTaskFeedFlowDeps(app);
    const result = await deps.latestHandoffForPlan(plan.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── F10/AC-070-17 — single fetch + single-pass computeAcCoverage ──────────

describe("STATE/REGRESSION — the task doc is fetched exactly once; computeAcCoverage stays correct single-pass (F10/AC-070-17)", () => {
  it("buildTaskStartPack fetches the task doc by its own id/slug exactly once, even with a linked knowledge pointer", async () => {
    const prd = await createPrd();
    const plan = await createPlan(prd.id);
    const task = await createTask(plan.id);
    const knowledge = await createKnowledge();
    const linkResult = await corpusService.link(task.id, knowledge.id, "relates-to");
    expect(linkResult.ok).toBe(true);

    const getSpy = vi.spyOn(app.corpusService, "get");
    const deps = buildTaskFeedFlowDeps(app);
    const result = await buildTaskStartPack(deps, task.slug);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const taskFetchCalls = getSpy.mock.calls.filter(([arg]) => arg === task.slug || arg === task.id);
    expect(taskFetchCalls).toHaveLength(1);

    // The linked knowledge pointer still resolved correctly (proves the dedupe
    // eliminated only the redundant SELF-fetch, not per-pointer fetching).
    expect(result.value.sections.knowledge_pointers).toContain(knowledge.slug);
  });

  it("computeAcCoverage's single-pass restructure preserves per-criterion pass/fail/attested aggregation on a mixed fixture", () => {
    const criteria = [
      { id: "AC-1", statement: "s1", verify: { mode: "script" as const, oracle: "test" as const, command: "c1" } },
      { id: "AC-2", statement: "s2", verify: { mode: "script" as const, oracle: "test" as const, command: "c2" } },
    ];
    const now = "2026-07-24T00:00:00.000Z";
    const task1: DocRecord = {
      id: "01TASK1000000000000000000",
      slug: "task-1",
      type: "task",
      role: "plan",
      title: "Task 1",
      status: "in-review",
      priority: "medium",
      content: "body",
      parent_id: null,
      created_at: now,
      updated_at: now,
      created_by: "test",
      version: 1,
      deleted_at: null,
      tags: [],
      extra: {
        verification_evidence: [
          { oracle: "test", command: "c1", result: "pass", recorded_at: now, recorded_by: "a", ac_ref: "AC-1" },
          { oracle: "test", command: "c1", result: "fail", recorded_at: now, recorded_by: "a", ac_ref: "AC-1" },
          { oracle: "test", command: "c2", result: "pass", recorded_at: now, recorded_by: "a", ac_ref: "AC-2", attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false } },
          { oracle: "test", command: "cX", result: "pass", recorded_at: now, recorded_by: "a", ac_ref: "AC-UNDECLARED" },
        ],
      },
    };
    const task2: DocRecord = { ...task1, id: "01TASK2000000000000000000", slug: "task-2", extra: {} };

    const coverage = computeAcCoverage(criteria, [task1, task2]);
    expect(coverage).toEqual([
      {
        ac_id: "AC-1",
        mode: "script",
        pass: 1,
        fail: 1,
        refs: [
          { task_id: "01TASK1000000000000000000", result: "pass" },
          { task_id: "01TASK1000000000000000000", result: "fail" },
        ],
        attested_pass: 0,
        attested_fail: 0,
        falsified: 1,
      },
      {
        ac_id: "AC-2",
        mode: "script",
        pass: 1,
        fail: 0,
        refs: [{ task_id: "01TASK1000000000000000000", result: "pass", attested: true }],
        attested_pass: 1,
        attested_fail: 0,
        falsified: 0,
      },
    ]);
  });
});
