/**
 * Unit tests for the SPEC-070 §Design Decisions D8 `lore_feed` phase-start/task-start
 * MCP parity: two dedicated dispatch branches on `lore_feed`, checked BEFORE the
 * generic `buildFeed` fallback — closing the SPEC-056 deferred phase-start MCP gap
 * (before this fix, checkpoint "phase-start" fell through to `buildFeed`, whose
 * `CHECKPOINT_PRODUCED_TYPE` map ALSO contains a "phase-start" -> "phase" entry, so it
 * silently degraded to a `findFeedingSkill("phase")` advisory NOTE instead of a real
 * `PhaseStartPack`) and adding the equivalent "task-start" branch for parity with the
 * CLI's `lore feed task-start` dispatch (SPEC-070 T1).
 *
 * Strategy mirrors `mcp-tools-phase.test.ts` / `mcp-session-tools.test.ts`: register
 * real tools against a McpServer, extract handlers from the internal
 * `_registeredTools` map, invoke directly against a real CorpusService/
 * TaskWorkflowService/PhaseWorkflowService/SessionService backed by InMemoryStore.
 *
 * Deep-equal-by-construction parity (Context Digest): both branches call the EXACT
 * SAME wiring (`buildTaskFeedFlowDeps`/`buildTaskStartPack`,
 * `buildPhaseFeedFlowDeps`/`buildPhaseStartPack`) the CLI `lore feed task-start`/
 * `lore feed phase-start` dispatches call — verified here by calling those functions
 * directly against the SAME seeded corpus and asserting the MCP tool's response is
 * `toEqual` that direct call's result (never two independently-authored assemblies).
 *
 * Coverage:
 *   HAPPY:      lore_feed(checkpoint: "task-start", task) returns the real
 *               TaskStartPack, deep-equal to a direct buildTaskStartPack call;
 *               lore_feed(checkpoint: "phase-start", phase) returns the real
 *               PhaseStartPack, deep-equal to a direct buildPhaseStartPack call
 *   NEGATIVE:   missing `task` on checkpoint "task-start" -> isError,
 *               VALIDATION_ERROR field "task"; missing `phase` on checkpoint
 *               "phase-start" -> isError, VALIDATION_ERROR field "phase"
 *   BOUNDARY:   a task target passed to "phase-start" (wrong doc type) -> isError,
 *               VALIDATION_ERROR (never returns a pack)
 *   ERROR:      a non-existent task/phase id -> isError, DOC_NOT_FOUND
 *   STATE:      the phase-start pack's `sections` shape distinguishes it from the
 *               generic buildFeed `FeedOutcome` shape (`skill`/`feed`/`type`) the
 *               pre-fix code path returned — regression pin for the closed gap
 *   REGRESSION: an untouched checkpoint ("spec-create") still dispatches through the
 *               generic buildFeed path unchanged (no isError, FeedOutcome shape)
 *
 * Source: spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start
 *   §Design D8; task-skill-implement-t2-mcp-lore-feed-task-start-phase-start
 *
 * AC-070-9 addendum: `registerTools` gains an ADDITIVE optional third param
 * (mirrors the CLI's `loadLoreApp()`-threaded config) so the MCP "task-start"
 * branch can resolve `workflow.task_feed.*` budgets identically to the CLI path
 * (`resolveTaskStartBudgets`) instead of always falling back to
 * `DEFAULT_TASK_START_BUDGETS`. Covered below by a dedicated describe block —
 * every pre-existing test in this file calls `registerTools(server, app)` with
 * NO third arg, pinning that omission still means "no config, default budgets"
 * (REGRESSION, byte-identical to pre-fix).
 *
 * SPEC-070 review Fix F6 (AC-070-15, supersedes the AC-070-9 snapshot shape):
 * that third param is now a config GETTER (`() => LoreConfig | undefined`), not a
 * one-time value — `lore --mcp-server` is long-lived, so a value closed over at
 * server-start could never observe a `.lore/config.yaml` edit made mid-session.
 * The AC-070-9 describe block below passes a constant closure (`() => config`,
 * sufficient for a single fixed config); a NEW describe block proves the getter
 * is actually re-invoked PER CALL by swapping its return value between two
 * `lore_feed` calls on the SAME registered server and observing the second
 * pack's `truncated[]` change without a restart.
 *
 * SPEC-070 review Fix F7/F8 (AC-070-16, dispatch-triplication + schema laxness):
 * a NEW describe block below exercises the shared `SPECIAL_FEED_CHECKPOINTS`
 * descriptor (`flows/feed-flow.ts`) — the CLI's `assertHandlersCoverDescriptor`
 * fail-loud coverage check (tested directly, fixture-driven, since
 * `commands/feed.ts` itself is not vitest-reachable — it transitively imports
 * `bun:sqlite` via `loader.ts`) and MCP `lore_feed`'s contradictory-field-combo
 * rejection (task-start+phase, phase-start+task, a non-special checkpoint
 * carrying task/phase).
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { VersionService } from "../../../src/service/version-service.js";
import { OutlineService } from "../../../src/service/outline-service.js";
import { MigrationService } from "../../../src/service/migration-service.js";
import { TreeCheckService } from "../../../src/service/tree-check-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { buildPhaseServices, buildPhaseFeedFlowDeps } from "../../../src/adapters/cli/phase-wiring.js";
import { buildTaskFeedFlowDeps, resolveTaskStartBudgets } from "../../../src/adapters/cli/task-feed-wiring.js";
import { buildPhaseStartPack, PHASE_START_CHECKPOINT } from "../../../src/flows/phase-feed-flow.js";
import { buildTaskStartPack, TASK_START_CHECKPOINT } from "../../../src/flows/task-feed-flow.js";
import {
  SESSION_RESUME_CHECKPOINT,
  SPECIAL_FEED_CHECKPOINTS,
  assertHandlersCoverDescriptor,
} from "../../../src/flows/feed-flow.js";
import { NoOpTelemetry, ok } from "@lore/core";
import type { App } from "../../../src/app.js";
import type { ApiKeyStore } from "../../../src/adapters/http/auth.js";
import { registerTools } from "../../../src/adapters/mcp/tools.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CreateDocInput, DocRecord, LoreConfig } from "@lore/core";

// ─── Test Infrastructure (mirrors mcp-tools-phase.test.ts + mcp-session-tools.test.ts) ─

const stubApiKeyStore = {} as ApiKeyStore;

let store: InMemoryStore;
let corpusService: CorpusService;

function makeApp(): App {
  store = new InMemoryStore();
  corpusService = new CorpusService(store, new RecordLockService(store));
  const gateEnforcer = new GateEnforcer(undefined);
  const phaseServices = buildPhaseServices(store, new NoOpTelemetry(), 120, gateEnforcer, corpusService);
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10_080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });

  return {
    corpusService,
    ...phaseServices,
    reviewService: new ReviewService(store),
    versionService: new VersionService(store, new RecordLockService(store)),
    outlineService: new OutlineService(store),
    migrationService: new MigrationService(store),
    treeCheckService: new TreeCheckService(store),
    apiKeyStore: stubApiKeyStore,
    aiProviderService: null as unknown as App["aiProviderService"],
    syncDocsService: null as unknown as App["syncDocsService"],
    exportDocsService: null as unknown as App["exportDocsService"],
    phaseService: null as unknown as App["phaseService"],
    taskWorkflowService: new TaskWorkflowService(
      store,
      new NoOpTelemetry(),
      { claimTtlMinutes: 120 },
      async () => ok(new Set<string>()),
    ),
    specKindService: null as unknown as App["specKindService"],
    judgmentService: null as unknown as App["judgmentService"],
    auditService: null as unknown as App["auditService"],
    sessionService,
    callerSurface: "mcp" as const,
    resolveAiDefault: (_explicit?: boolean) => ({ ai: false, source: "cli_flag" as const }),
    telemetry: new NoOpTelemetry(),
    close: () => undefined,
  };
}

type McpServerInternal = {
  _registeredTools: Record<
    string,
    { handler: (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult> }
  >;
};

function getToolHandler(
  server: McpServer,
  name: string,
): (args: Record<string, unknown>) => Promise<CallToolResult> {
  const internal = server as unknown as McpServerInternal;
  const tool = internal._registeredTools[name];
  if (!tool) throw new Error(`Tool not registered: ${name}`);
  return (args) => tool.handler(args, {} as unknown);
}

function parseResult(result: CallToolResult): unknown {
  const text = result.content[0];
  if (!text || text.type !== "text") throw new Error("Expected text content");
  return JSON.parse(text.text);
}

// ─── Fixture helpers (mirrors mcp-tools-phase.test.ts) ─────────────────────────

async function createPlan(title = "Test Plan"): Promise<DocRecord> {
  const result = await corpusService.create({ type: "plan", title, content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createTask(planId: string, title = "Test Task"): Promise<DocRecord> {
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

let phaseCounter = 0;

/** Raw phase DocRecord — no `lore create phase` path exists (mirrors mcp-tools-phase.test.ts). */
async function createPhase(plan: DocRecord, overrides: Partial<DocRecord> = {}): Promise<string> {
  phaseCounter += 1;
  const now = "2026-07-23T00:00:00.000Z";
  const doc: DocRecord = {
    id: `01HPHASE0000000000000${String(phaseCounter).padStart(4, "0")}` as DocRecord["id"],
    slug: `phase-mcp-feed-test-${phaseCounter}`,
    type: "phase" as DocRecord["type"],
    role: "plan",
    title: "MCP Feed Test Phase",
    status: "draft",
    priority: "medium",
    content: "# Phase",
    parent_id: plan.id,
    created_at: now,
    updated_at: now,
    created_by: "system",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: plan.id },
    ...overrides,
  };
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`Failed to insert phase: ${JSON.stringify(result.error)}`);
  return result.value.slug;
}

// ─── Test Setup ────────────────────────────────────────────────────────────────

let app: App;
let server: McpServer;

beforeEach(() => {
  app = makeApp();
  server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, app);
});

// ─── lore_feed checkpoint "task-start" ─────────────────────────────────────────

describe('lore_feed checkpoint "task-start"', () => {
  const call = () => getToolHandler(server, "lore_feed");

  it("HAPPY: returns the real TaskStartPack, deep-equal to a direct buildTaskStartPack call", async () => {
    const plan = await createPlan();
    const task = await createTask(plan.id);

    const result = await call()({ checkpoint: "task-start", task: task.slug });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      task_id: string;
      sections: Record<string, string>;
      truncated: string[];
    };
    expect(data.task_id).toBe(task.slug);
    expect(Object.keys(data.sections).sort()).toEqual(
      [
        "objective",
        "acceptance",
        "constraints",
        "boundaries",
        "claim",
        "plan_state",
        "knowledge_pointers",
        "handoff",
      ].sort(),
    );
    expect(data.sections.objective).toContain(task.title);

    // Deep-equal-by-construction: the SAME wiring, called directly.
    const deps = buildTaskFeedFlowDeps(app);
    const direct = await buildTaskStartPack(deps, task.slug);
    if (!direct.ok) throw new Error("direct buildTaskStartPack call failed");
    expect(data).toEqual(direct.value);
  });

  it("NEGATIVE: missing `task` field -> isError, VALIDATION_ERROR field \"task\"", async () => {
    const result = await call()({ checkpoint: "task-start" });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("task");
  });

  it("ERROR: a non-existent task id -> isError, DOC_NOT_FOUND", async () => {
    const result = await call()({ checkpoint: "task-start", task: "does-not-exist" });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("DOC_NOT_FOUND");
  });

  it("BOUNDARY: a plan (not a task) target -> isError, VALIDATION_ERROR (never a pack)", async () => {
    const plan = await createPlan();
    const result = await call()({ checkpoint: "task-start", task: plan.slug });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── lore_feed checkpoint "phase-start" ────────────────────────────────────────

describe('lore_feed checkpoint "phase-start"', () => {
  const call = () => getToolHandler(server, "lore_feed");

  it("HAPPY: returns the real PhaseStartPack, deep-equal to a direct buildPhaseStartPack call", async () => {
    const plan = await createPlan();
    const phaseSlug = await createPhase(plan);

    const result = await call()({ checkpoint: "phase-start", phase: phaseSlug });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as {
      phase_id: string;
      sections: Record<string, string>;
      truncated: string[];
    };
    expect(data.phase_id).toBe(phaseSlug);
    expect(Object.keys(data.sections).sort()).toEqual(
      ["scope", "siblings", "knowledge_pointers", "handoff"].sort(),
    );

    const deps = buildPhaseFeedFlowDeps(app);
    const direct = await buildPhaseStartPack(deps, phaseSlug);
    if (!direct.ok) throw new Error("direct buildPhaseStartPack call failed");
    expect(data).toEqual(direct.value);
  });

  it("NEGATIVE: missing `phase` field -> isError, VALIDATION_ERROR field \"phase\"", async () => {
    const result = await call()({ checkpoint: "phase-start" });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string; field: string };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.field).toBe("phase");
  });

  it("ERROR: a non-existent phase id -> isError, DOC_NOT_FOUND", async () => {
    const result = await call()({ checkpoint: "phase-start", phase: "does-not-exist" });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("DOC_NOT_FOUND");
  });

  it("BOUNDARY: a task (not a phase) target -> isError, VALIDATION_ERROR (never a pack)", async () => {
    const plan = await createPlan();
    const task = await createTask(plan.id);
    const result = await call()({ checkpoint: "phase-start", phase: task.slug });
    expect(result.isError).toBe(true);
    const error = parseResult(result) as { code: string };
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it(
    "STATE/REGRESSION: the returned shape is a real pack (sections), never the generic " +
      'buildFeed FeedOutcome shape (skill/feed/type) — the closed SPEC-056 gap',
    async () => {
      const plan = await createPlan();
      const phaseSlug = await createPhase(plan);

      const result = await call()({ checkpoint: "phase-start", phase: phaseSlug });
      expect(result.isError).toBeFalsy();
      const data = parseResult(result) as Record<string, unknown>;
      expect(data).toHaveProperty("sections");
      expect(data).not.toHaveProperty("feed");
      expect(data).not.toHaveProperty("skill");
    },
  );
});

// ─── AC-070-9: MCP task-start budget parity with the CLI config path ──────────

describe("AC-070-9: lore_feed task-start resolves workflow.task_feed.* config budgets identically to the CLI path", () => {
  const LONG_TITLE =
    "This Is A Deliberately Long Task Title Written To Overflow A Tiny Objective Budget";

  it(
    "HAPPY: a tiny workflow.task_feed budget forces truncated[] on both surfaces, and the " +
      "MCP pack deep-equals the CLI-path pack (buildTaskFeedFlowDeps + resolveTaskStartBudgets " +
      "+ buildTaskStartPack called directly) under the SAME config",
    async () => {
      const plan = await createPlan();
      const task = await createTask(plan.id, LONG_TITLE);

      const config = {
        workflow: {
          task_feed: {
            max_objective_chars: 10,
          },
        },
      } as unknown as LoreConfig;

      // MCP path: registerTools receives a config GETTER as its additive third param
      // (SPEC-070 F6 — a getter, not a one-time value, so a long-lived server can
      // observe config edits per call; AC-070-15 exercises that per-call freshness
      // directly, below). A constant closure is sufficient here — this test only
      // needs ONE fixed config for the whole call.
      const configuredServer = new McpServer({ name: "test-ac-070-9", version: "0.0.0" });
      registerTools(configuredServer, app, () => config);

      const mcpResult = await getToolHandler(configuredServer, "lore_feed")({
        checkpoint: "task-start",
        task: task.slug,
      });
      expect(mcpResult.isError).toBeFalsy();
      const mcpPack = parseResult(mcpResult) as {
        task_id: string;
        sections: Record<string, string>;
        truncated: string[];
      };

      // Prove the override actually bit — a pack indistinguishable from the
      // untouched-default case would make the deep-equal below vacuous.
      expect(mcpPack.truncated).toContain("objective");

      // CLI path: the EXACT SAME wiring the CLI's `handleTaskStart` calls,
      // invoked directly against the SAME config and corpus state.
      const deps = buildTaskFeedFlowDeps(app);
      const budgets = resolveTaskStartBudgets(config);
      const cliPack = await buildTaskStartPack(deps, task.slug, budgets);
      if (!cliPack.ok) throw new Error("direct buildTaskStartPack call failed");

      expect(mcpPack).toEqual(cliPack.value);
    },
  );

  it(
    "REGRESSION: registerTools called with NO config arg (every pre-existing call site) still " +
      "falls back to DEFAULT_TASK_START_BUDGETS — omission is not a truncation regression",
    async () => {
      const plan = await createPlan();
      const task = await createTask(plan.id, LONG_TITLE);

      // `server` (from the outer beforeEach) was registered via `registerTools(server, app)`,
      // no third arg — pins the additive param's default-omitted behavior.
      const result = await getToolHandler(server, "lore_feed")({
        checkpoint: "task-start",
        task: task.slug,
      });
      expect(result.isError).toBeFalsy();
      const pack = parseResult(result) as { truncated: string[] };
      expect(pack.truncated).toEqual([]);
    },
  );
});

// ─── AC-070-15: per-call config GETTER (config-staleness fix, F6) ─────────────

describe(
  "AC-070-15: lore_feed task-start resolves workflow.task_feed.* budgets from a " +
    "config GETTER, called fresh per call — no server restart needed",
  () => {
    const LONG_TITLE_FOR_BUDGETS =
      "This Is A Deliberately Long Task Title Written To Overflow A Tiny Objective Budget";

    it(
      "HAPPY: swapping the getter's return between two lore_feed calls on the SAME " +
        "server changes only the SECOND pack's truncated[]",
      async () => {
        const plan = await createPlan();
        const task = await createTask(plan.id, LONG_TITLE_FOR_BUDGETS);

        let currentConfig: LoreConfig | undefined = undefined;
        const configuredServer = new McpServer({ name: "test-ac-070-15", version: "0.0.0" });
        // reason: the getter reads `currentConfig` (a `let`, mutated below) on EVERY
        // call — proves registerTools stores the FUNCTION, not a snapshot of its
        // first return value.
        registerTools(configuredServer, app, () => currentConfig);

        const firstResult = await getToolHandler(configuredServer, "lore_feed")({
          checkpoint: "task-start",
          task: task.slug,
        });
        expect(firstResult.isError).toBeFalsy();
        const firstPack = parseResult(firstResult) as { truncated: string[] };
        expect(firstPack.truncated).toEqual([]);

        // Simulates a `.lore/config.yaml` edit made BETWEEN two calls on the same
        // long-lived MCP server — no restart, no new registerTools call.
        currentConfig = {
          workflow: { task_feed: { max_objective_chars: 10 } },
        } as unknown as LoreConfig;

        const secondResult = await getToolHandler(configuredServer, "lore_feed")({
          checkpoint: "task-start",
          task: task.slug,
        });
        expect(secondResult.isError).toBeFalsy();
        const secondPack = parseResult(secondResult) as { truncated: string[] };
        expect(secondPack.truncated).toContain("objective");
      },
    );

    it(
      "REGRESSION: a getter returning undefined (e.g. no config file found) falls back " +
        "to DEFAULT_TASK_START_BUDGETS, same as an omitted getter",
      async () => {
        const plan = await createPlan();
        const task = await createTask(plan.id, LONG_TITLE_FOR_BUDGETS);

        const configuredServer = new McpServer({ name: "test-ac-070-15-undef", version: "0.0.0" });
        registerTools(configuredServer, app, () => undefined);

        const result = await getToolHandler(configuredServer, "lore_feed")({
          checkpoint: "task-start",
          task: task.slug,
        });
        expect(result.isError).toBeFalsy();
        const pack = parseResult(result) as { truncated: string[] };
        expect(pack.truncated).toEqual([]);
      },
    );
  },
);

// ─── AC-070-16: shared descriptor — CLI handler-coverage fail-loud + MCP combo rejection ─

describe("AC-070-16: SPECIAL_FEED_CHECKPOINTS is the ONE descriptor consumed by both surfaces", () => {
  it("STATE: covers exactly session-resume (no required arg), phase-start (phase), task-start (task)", () => {
    expect(SPECIAL_FEED_CHECKPOINTS).toEqual({
      [SESSION_RESUME_CHECKPOINT]: { requiredArg: null },
      [PHASE_START_CHECKPOINT]: { requiredArg: "phase" },
      [TASK_START_CHECKPOINT]: { requiredArg: "task" },
    });
  });

  describe("assertHandlersCoverDescriptor (the CLI's module-init fail-loud check, exercised directly)", () => {
    it("HAPPY: a handler table covering every descriptor key does not throw", () => {
      expect(() =>
        assertHandlersCoverDescriptor(SPECIAL_FEED_CHECKPOINTS, {
          [SESSION_RESUME_CHECKPOINT]: () => undefined,
          [PHASE_START_CHECKPOINT]: () => undefined,
          [TASK_START_CHECKPOINT]: () => undefined,
        }),
      ).not.toThrow();
    });

    it("ERROR: a descriptor checkpoint with no matching handler throws, naming the checkpoint", () => {
      expect(() =>
        assertHandlersCoverDescriptor(
          { ...SPECIAL_FEED_CHECKPOINTS, "a-future-checkpoint": { requiredArg: null } },
          {
            [SESSION_RESUME_CHECKPOINT]: () => undefined,
            [PHASE_START_CHECKPOINT]: () => undefined,
            [TASK_START_CHECKPOINT]: () => undefined,
          },
        ),
      ).toThrow(/a-future-checkpoint/);
    });

    it("BOUNDARY: an empty handler table against a single-entry descriptor throws for that one entry", () => {
      expect(() =>
        assertHandlersCoverDescriptor({ "solo-checkpoint": { requiredArg: null } }, {}),
      ).toThrow(/solo-checkpoint/);
    });

    it("REGRESSION: an empty descriptor never throws, regardless of the handler table", () => {
      expect(() => assertHandlersCoverDescriptor({}, {})).not.toThrow();
    });
  });

  describe("MCP lore_feed contradictory field-combo rejection", () => {
    const call = () => getToolHandler(server, "lore_feed");

    it('NEGATIVE: checkpoint "task-start" carrying `phase` -> isError, VALIDATION_ERROR field "phase"', async () => {
      const plan = await createPlan();
      const task = await createTask(plan.id);
      const result = await call()({ checkpoint: "task-start", task: task.slug, phase: "some-phase" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; field: string };
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.field).toBe("phase");
    });

    it('NEGATIVE: checkpoint "phase-start" carrying `task` -> isError, VALIDATION_ERROR field "task"', async () => {
      const plan = await createPlan();
      const phaseSlug = await createPhase(plan);
      const result = await call()({ checkpoint: "phase-start", phase: phaseSlug, task: "some-task" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; field: string };
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.field).toBe("task");
    });

    it('NEGATIVE: a non-special checkpoint ("spec-create") carrying `task` -> isError, VALIDATION_ERROR field "task"', async () => {
      const result = await call()({ checkpoint: "spec-create", task: "some-task" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; field: string };
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.field).toBe("task");
    });

    it('NEGATIVE: a non-special checkpoint ("spec-create") carrying `phase` -> isError, VALIDATION_ERROR field "phase"', async () => {
      const result = await call()({ checkpoint: "spec-create", phase: "some-phase" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; field: string };
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.field).toBe("phase");
    });

    it('BOUNDARY: "session-resume" (requiredArg: null) carrying `task` -> isError, VALIDATION_ERROR field "task"', async () => {
      const result = await call()({ checkpoint: "session-resume", task: "some-task" });
      expect(result.isError).toBe(true);
      const error = parseResult(result) as { code: string; field: string };
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.field).toBe("task");
    });

    it('REGRESSION: "task-start" with ONLY `task` (no `phase`) still dispatches to the real pack, no isError', async () => {
      const plan = await createPlan();
      const task = await createTask(plan.id);
      const result = await call()({ checkpoint: "task-start", task: task.slug });
      expect(result.isError).toBeFalsy();
    });

    it('REGRESSION: "phase-start" with ONLY `phase` (no `task`) still dispatches to the real pack, no isError', async () => {
      const plan = await createPlan();
      const phaseSlug = await createPhase(plan);
      const result = await call()({ checkpoint: "phase-start", phase: phaseSlug });
      expect(result.isError).toBeFalsy();
    });
  });
});

// ─── Regression: untouched checkpoints ─────────────────────────────────────────

describe("lore_feed — untouched checkpoints (REGRESSION)", () => {
  const call = () => getToolHandler(server, "lore_feed");

  it('"spec-create" still dispatches through the generic buildFeed path (FeedOutcome shape, no isError)', async () => {
    const result = await call()({ checkpoint: "spec-create" });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { checkpoint: string; type: string | null; feed: string };
    expect(data.checkpoint).toBe("spec-create");
    expect(data.type).toBe("spec");
    expect(typeof data.feed).toBe("string");
  });

  it('an unknown checkpoint still degrades to the generic advisory note, no isError', async () => {
    const result = await call()({ checkpoint: "not-a-real-checkpoint" });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as { checkpoint: string; type: string | null; feed: string };
    expect(data.type).toBeNull();
    expect(data.feed).toContain("unknown checkpoint");
  });
});
