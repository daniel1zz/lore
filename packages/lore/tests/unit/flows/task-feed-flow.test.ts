/**
 * CONTRACT NOTE (this file is the authoritative shape `packages/lore/src/flows/
 * task-feed-flow.ts` satisfies — mirrors `phase-feed-flow.test.ts`'s own CONTRACT
 * NOTE convention) for `buildTaskStartPack` (SPEC-070 §Design Decisions D1-D4).
 *
 * Shapes exercised (see the flow module's own JSDoc for the authoritative prose):
 *   - `TaskBundle` — `{task, planSlug, specSlug, phaseName, acceptance,
 *     noDeclaredAcs, danglingScopedIds, anchors, priorFailures, claimView,
 *     upstreamSpecApproved}`. Every field arrives PRE-DERIVED — this test's fake
 *     `getTaskBundle` never calls a real derivation function, only returns
 *     canned data (thick-bundle/thin-flow, AC-070-1).
 *   - `AcceptanceView` — `{id, statement, mode, command?, coverage, scoped}`.
 *   - `PlanStateSlice` — `{sessions, anchor_conflicts}` (render-narrowed session/
 *     anchor-conflict views).
 *   - `TaskStartPack` — `{task_id, sections: {objective, acceptance, constraints,
 *     boundaries, claim, plan_state, knowledge_pointers, handoff}, truncated[]}`.
 *
 * AC-070-1's import-graph assertion (below, "STATE/REGRESSION" describe block) reads
 * the module's SOURCE TEXT directly and inspects only its `import`/re-export
 * statement lines (not its prose comments, which legitimately NAME the four
 * forbidden functions for documentation purposes) — a whole-file grep would
 * false-positive on the module's own header.
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start
 *   §Design D1-D4; §Acceptance Criteria AC-070-1..6;
 *   task-skill-implement-t1-core-flow-wiring-cli-vertical-slice.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, err } from "@lore/core";
import type { DocId, DocRecord, LoreError, Result } from "@lore/core";
import { CHECKPOINT_PRODUCED_TYPE } from "../../../src/flows/feed-flow.js";
import {
  buildTaskStartPack,
  type TaskBundle,
  type TaskFeedFlowDeps,
  type AcceptanceView,
  type PlanStateSlice,
  type KnowledgePointer,
  type HandoffPointer,
} from "../../../src/flows/task-feed-flow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/lore/tests/unit/flows/ -> ../../../src/flows/task-feed-flow.ts
const TASK_FEED_FLOW_PATH = resolve(__dirname, "../../../src/flows/task-feed-flow.ts");

/**
 * Collects each full `import`/`export` STATEMENT (not just its first line) from
 * `source` (SPEC-070 AC-070-1 import-scanner hardening, review finding F9) — the
 * PRE-hardening scanner only kept lines whose OWN text started with
 * `import`/`export`, so a future edit shaped like:
 *   import {
 *     computeAcCoverage,
 *   } from "@lore/core";
 * would have its `computeAcCoverage,` CONTINUATION line silently excluded from the
 * scanned text — a false negative, the forbidden import would slip past undetected.
 * This walks line-by-line; once a line opens an import/export statement it keeps
 * appending subsequent lines until one ends with `;` (every import/export statement
 * in this codebase's formatting terminates on a `;`-ending line, never mid-line —
 * balanced-brace multi-line specifier lists never contain a stray `;`).
 */
function collectImportExportStatements(source: string): string {
  const lines = source.split("\n");
  const collected: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (/^(import|export)\b/.test(line.trim())) {
      let statement = line;
      while (!statement.trim().endsWith(";") && i + 1 < lines.length) {
        i++;
        statement += "\n" + (lines[i] ?? "");
      }
      collected.push(statement);
    }
    i++;
  }
  return collected.join("\n");
}

// ─── Fixture helpers ────────────────────────────────────────────────────────

function fakeDoc(overrides: Partial<DocRecord> & { id: DocId; title: string }): DocRecord {
  const now = "2026-07-23T09:00:00.000Z";
  return {
    slug: `doc-${overrides.id}`,
    type: "task",
    role: "plan",
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
    extra: {},
    ...overrides,
  };
}

function sampleTask(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    ...fakeDoc({ id: "task-1" as DocId, title: "Implement the CLI slice" }),
    slug: "task-implement-cli-slice",
    content: "Estimate: L\nApproach: mirror the precedent.",
    ...overrides,
  };
}

function acceptanceView(overrides: Partial<AcceptanceView> & { id: string }): AcceptanceView {
  return {
    statement: `Statement for ${overrides.id}`,
    mode: "script",
    coverage: "none",
    scoped: true,
    ...overrides,
  };
}

function pointer(overrides: Partial<KnowledgePointer> & { doc_id: string }): KnowledgePointer {
  return {
    slug: `knowledge-${overrides.doc_id}`,
    title: `Learning ${overrides.doc_id}`,
    invalidated: false,
    ...overrides,
  };
}

function sampleBundle(overrides: Partial<TaskBundle> = {}): TaskBundle {
  return {
    task: sampleTask(),
    planSlug: "plan-implementation",
    specSlug: "spec-070-deterministic-task-dispatch-bundle",
    phaseName: null,
    acceptance: [
      acceptanceView({ id: "AC-070-1", coverage: "attested_pass" }),
      acceptanceView({ id: "AC-070-2", coverage: "none", mode: "human" }),
    ],
    noDeclaredAcs: false,
    danglingScopedIds: [],
    anchors: ["packages/lore/src/flows/task-feed-flow.ts"],
    priorFailures: [{ oracle: "test", command: "bun test", tail: "1 failing" }],
    unparseableEvidenceCount: 0,
    claimView: { holder: "agent:spec-070-core-cli", fresh: true },
    upstreamSpecApproved: true,
    relatedKnowledge: [],
    ...overrides,
  };
}

function samplePlanState(overrides: Partial<PlanStateSlice> = {}): PlanStateSlice {
  return {
    sessions: [{ by: "agent:spec-070-core-cli", worktree: "/repo/.worktrees/t1", task_slugs: ["task-implement-cli-slice"] }],
    anchor_conflicts: [],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<TaskFeedFlowDeps> = {}): TaskFeedFlowDeps {
  return {
    getTaskBundle: async () => ok(sampleBundle()),
    planStateForTask: async () => ok(samplePlanState()),
    listLinkedKnowledgePointers: async () => ok([pointer({ doc_id: "k1" })]),
    latestHandoffForPlan: async () => ok({ slug: "knowledge-handoff-alice", title: "Handoff — alice" }),
    ...overrides,
  };
}

// ─── HAPPY — AC-070-1: complete pack, deterministic ────────────────────────

describe("HAPPY — buildTaskStartPack assembles all eight sections from a fully-wired bundle (AC-070-1)", () => {
  it("renders task/plan/spec pointers and task content into the objective section", async () => {
    const result = await buildTaskStartPack(makeDeps(), "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.task_id).toBe("task-1");
    expect(result.value.sections.objective).toContain("Implement the CLI slice");
    expect(result.value.sections.objective).toContain("plan-implementation");
    expect(result.value.sections.objective).toContain("spec-070-deterministic-task-dispatch-bundle");
    expect(result.value.sections.objective).toContain("mirror the precedent");
    expect(result.value.truncated).toEqual([]);
  });

  it("two calls with identical (fake, deterministic) deps and args produce deep-equal payloads", async () => {
    const deps = makeDeps();
    const first = await buildTaskStartPack(deps, "task-1", { max_objective_chars: 3000 });
    const second = await buildTaskStartPack(deps, "task-1", { max_objective_chars: 3000 });
    expect(first).toEqual(second);
  });
});

// ─── NEGATIVE — AC-070-3: acceptance view matrix ───────────────────────────

describe("NEGATIVE — acceptance view matrix (AC-070-3)", () => {
  it("zero declared ACs renders an explicit no-ACs note", async () => {
    const deps = makeDeps({
      getTaskBundle: async () =>
        ok(sampleBundle({ acceptance: [], noDeclaredAcs: true, danglingScopedIds: [] })),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.acceptance).toContain("no declared acceptance criteria");
  });

  it("a criterion out of ac_scope is marked [out-of-scope]; an in-scope one is not", async () => {
    const deps = makeDeps({
      getTaskBundle: async () =>
        ok(
          sampleBundle({
            acceptance: [
              acceptanceView({ id: "AC-070-1", scoped: true }),
              acceptanceView({ id: "AC-070-9", scoped: false }),
            ],
          }),
        ),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.value.sections.acceptance.split("\n");
    const scopedLine = lines.find((l) => l.includes("AC-070-1"));
    const outOfScopeLine = lines.find((l) => l.includes("AC-070-9"));
    expect(outOfScopeLine).toContain("[out-of-scope]");
    expect(scopedLine).not.toContain("[out-of-scope]");
  });

  it("a dangling scoped id (present in ac_scope, absent from declared criteria) renders a loud row, never dropped", async () => {
    const deps = makeDeps({
      getTaskBundle: async () =>
        ok(sampleBundle({ danglingScopedIds: ["AC-070-GHOST"] })),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.acceptance).toContain("AC-070-GHOST");
    expect(result.value.sections.acceptance).toContain("dangling scoped id");
  });

  it("a script-mode row includes its command string", async () => {
    const deps = makeDeps({
      getTaskBundle: async () =>
        ok(sampleBundle({ acceptance: [acceptanceView({ id: "AC-070-1", command: "bunx vitest run x" })] })),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.acceptance).toContain("command: bunx vitest run x");
  });
});

// ─── BOUNDARY — AC-070-4: constraints section ──────────────────────────────

describe("BOUNDARY — constraints section renders prior failures + upstream-spec advisory (AC-070-4)", () => {
  it("renders the last <=3 fail-evidence entries with oracle+command+clipped tail", async () => {
    const deps = makeDeps({
      getTaskBundle: async () =>
        ok(
          sampleBundle({
            priorFailures: [
              { oracle: "tsc", command: "bun run typecheck", tail: "error TS2322" },
              { oracle: "test", command: "bun test", tail: "3 failing" },
            ],
          }),
        ),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.constraints).toContain("[tsc] bun run typecheck");
    expect(result.value.sections.constraints).toContain("error TS2322");
    expect(result.value.sections.constraints).toContain("[test] bun test");
    expect(result.value.sections.constraints).toContain("3 failing");
  });

  it("zero prior failures renders an explicit no-prior-failures line", async () => {
    const deps = makeDeps({ getTaskBundle: async () => ok(sampleBundle({ priorFailures: [] })) });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.constraints).toContain("no prior failures");
  });

  it("upstreamSpecApproved=false renders the unapproved-spec advisory", async () => {
    const deps = makeDeps({ getTaskBundle: async () => ok(sampleBundle({ upstreamSpecApproved: false })) });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.constraints).toContain("upstream spec not approved");
  });

  it("upstreamSpecApproved=true renders no advisory", async () => {
    const deps = makeDeps({ getTaskBundle: async () => ok(sampleBundle({ upstreamSpecApproved: true })) });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.constraints).not.toContain("upstream spec not approved");
  });

  it("upstreamSpecApproved=null (no spec ancestor) renders no advisory", async () => {
    const deps = makeDeps({ getTaskBundle: async () => ok(sampleBundle({ upstreamSpecApproved: null })) });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.constraints).not.toContain("upstream spec not approved");
  });

  it("a nonzero unparseableEvidenceCount renders an explicit degraded line naming the count (AC-070-11)", async () => {
    const deps = makeDeps({
      getTaskBundle: async () => ok(sampleBundle({ unparseableEvidenceCount: 1 })),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.constraints).toContain("1 evidence entries unparseable");
    expect(result.value.sections.constraints).not.toContain("no prior failures");
  });

  it("a zero unparseableEvidenceCount renders no degraded line (REGRESSION)", async () => {
    const result = await buildTaskStartPack(makeDeps(), "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.constraints).not.toContain("unparseable");
  });
});

// ─── ERROR — AC-070-2: fatal/non-fatal contract ────────────────────────────

describe("ERROR — fatal getTaskBundle vs non-fatal aux ports (AC-070-2)", () => {
  it("propagates a fatal getTaskBundle failure verbatim, never an empty pack", async () => {
    const deps = makeDeps({
      getTaskBundle: async () => err({ code: "DOC_NOT_FOUND", id: "no-such-task" }),
    });
    const result = await buildTaskStartPack(deps, "no-such-task");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  it("a non-fatal planStateForTask failure degrades only plan_state, the other seven sections still render", async () => {
    const deps = makeDeps({
      planStateForTask: async () => err({ code: "STORE_ERROR", message: "boom" }),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.plan_state).toContain("plan state unavailable");
    expect(result.value.sections.objective).toContain("Implement the CLI slice");
    expect(result.value.sections.knowledge_pointers.length).toBeGreaterThan(0);
    expect(result.value.sections.handoff.length).toBeGreaterThan(0);
  });

  it("a non-fatal listLinkedKnowledgePointers failure degrades only knowledge_pointers", async () => {
    const deps = makeDeps({
      listLinkedKnowledgePointers: async () => err({ code: "STORE_ERROR", message: "boom" }),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.knowledge_pointers).toContain("knowledge pointers unavailable");
    expect(result.value.sections.objective).toContain("Implement the CLI slice");
  });

  it("a non-fatal latestHandoffForPlan failure degrades only handoff", async () => {
    const deps = makeDeps({
      latestHandoffForPlan: async () => err({ code: "STORE_ERROR", message: "boom" }),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.handoff).toContain("handoff unavailable");
    expect(result.value.sections.objective).toContain("Implement the CLI slice");
  });
});

// ─── STATE — AC-070-5: claim + plan_state sections ─────────────────────────

describe("STATE — claim + plan_state sections (AC-070-5)", () => {
  it("a foreign fresh claim renders the holder", async () => {
    const deps = makeDeps({
      getTaskBundle: async () =>
        ok(sampleBundle({ claimView: { holder: "agent:other", fresh: true } })),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.claim).toContain("agent:other");
    expect(result.value.sections.claim).not.toContain("STALE");
  });

  it("a stale claim is marked stale", async () => {
    const deps = makeDeps({
      getTaskBundle: async () =>
        ok(sampleBundle({ claimView: { holder: "agent:other", fresh: false } })),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.claim).toContain("agent:other");
    expect(result.value.sections.claim).toContain("STALE");
  });

  it("no claim renders an explicit no-claim line", async () => {
    const deps = makeDeps({ getTaskBundle: async () => ok(sampleBundle({ claimView: null })) });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.claim).toBe("(no claim)");
  });

  it("sessions and anchor_conflicts from the ready-report slice render in plan_state", async () => {
    const deps = makeDeps({
      planStateForTask: async () =>
        ok({
          sessions: [{ by: "agent:alice", worktree: "/w1", task_slugs: ["task-a", "task-b"] }],
          anchor_conflicts: [{ task_slug: "task-c", holder: "agent:bob", paths: ["src/x.ts"] }],
        }),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.plan_state).toContain("agent:alice");
    expect(result.value.sections.plan_state).toContain("task-a, task-b");
    expect(result.value.sections.plan_state).toContain("task-c conflicts with agent:bob");
    expect(result.value.sections.plan_state).toContain("src/x.ts");
  });

  it("an empty ready-report slice renders explicit none-lines", async () => {
    const deps = makeDeps({
      planStateForTask: async () => ok({ sessions: [], anchor_conflicts: [] }),
    });
    const result = await buildTaskStartPack(deps, "task-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.plan_state).toContain("no active sessions");
    expect(result.value.sections.plan_state).toContain("no anchor conflicts");
  });
});

// ─── BOUNDARY — AC-070-6: per-section budgets ──────────────────────────────

describe("BOUNDARY — per-section budgets clip independently and record exact truncated[] keys (AC-070-6)", () => {
  it("clips an oversized objective section and records 'objective' in truncated[]", async () => {
    const deps = makeDeps({
      getTaskBundle: async () =>
        ok(sampleBundle({ task: sampleTask({ content: "x".repeat(5000) }) })),
    });
    const result = await buildTaskStartPack(deps, "task-1", { max_objective_chars: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.objective.length).toBeLessThanOrEqual(50);
    expect(result.value.truncated).toContain("objective");
  });

  it("a section within budget is never named in truncated[]", async () => {
    const result = await buildTaskStartPack(makeDeps(), "task-1", { max_objective_chars: 8000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).not.toContain("objective");
  });

  it("clips an oversized knowledge_pointers section and records 'knowledge_pointers' in truncated[]", async () => {
    const manyPointers = Array.from({ length: 200 }, (_, i) =>
      pointer({ doc_id: `k${i}`, title: `A fairly long learning title number ${i}` }),
    );
    const deps = makeDeps({ listLinkedKnowledgePointers: async () => ok(manyPointers) });
    const result = await buildTaskStartPack(deps, "task-1", { max_knowledge_chars: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.knowledge_pointers.length).toBeLessThanOrEqual(100);
    expect(result.value.truncated).toContain("knowledge_pointers");
  });

  it("workflow.task_feed.* style config overrides (Partial<TaskStartBudgets>) apply per-section, independently of defaults", async () => {
    const deps = makeDeps({
      getTaskBundle: async () =>
        ok(sampleBundle({ priorFailures: Array.from({ length: 3 }, (_, i) => ({ oracle: "test", command: `cmd-${i}`, tail: "x".repeat(200) })) })),
    });
    const result = await buildTaskStartPack(deps, "task-1", { max_constraints_chars: 30, max_objective_chars: 8000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.constraints.length).toBeLessThanOrEqual(30);
    expect(result.value.truncated).toContain("constraints");
    expect(result.value.truncated).not.toContain("objective");
  });
});

// ─── STATE/REGRESSION — determinism + import-graph purity (AC-070-1) ──────

describe("STATE/REGRESSION — buildTaskStartPack import-graph purity + SSOT registration (AC-070-1)", () => {
  it("the module's import/re-export statements never reference computeAcCoverage/extractClaim/isClaimStale/extractEvidence (thick-bundle/thin-flow)", () => {
    const source = readFileSync(TASK_FEED_FLOW_PATH, "utf8");
    const importStatements = collectImportExportStatements(source);

    for (const forbidden of ["computeAcCoverage", "extractClaim", "isClaimStale", "extractEvidence"]) {
      expect(importStatements).not.toContain(forbidden);
    }
  });

  it("CHECKPOINT_PRODUCED_TYPE['task-start'] resolves to the 'task' produced type", () => {
    expect(CHECKPOINT_PRODUCED_TYPE["task-start"]).toBe("task");
  });
});

// ─── REGRESSION — import-scanner hardening itself (AC-070-1, review finding F9) ──

describe("REGRESSION — collectImportExportStatements catches a multi-line import continuation (AC-070-1 scanner hardening, F9)", () => {
  it("a forbidden name landing on a CONTINUATION line of a multi-line import is still caught", () => {
    const fixture = ['import {', "  ok,", "  computeAcCoverage,", '} from "@lore/core";'].join("\n");
    expect(collectImportExportStatements(fixture)).toContain("computeAcCoverage");
  });

  it("a forbidden name appearing ONLY in a prose comment (never an import/export line) is not flagged", () => {
    const fixture = [
      "// This module never imports computeAcCoverage.",
      'import { ok } from "@lore/core";',
    ].join("\n");
    expect(collectImportExportStatements(fixture)).not.toContain("computeAcCoverage");
  });

  it("a single-line import is collected unchanged (REGRESSION, pre-hardening shape)", () => {
    const fixture = 'import { ok, truncateSection } from "@lore/core";';
    expect(collectImportExportStatements(fixture)).toBe(fixture);
  });
});
