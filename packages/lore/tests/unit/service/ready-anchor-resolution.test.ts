/**
 * `TaskWorkflowService.ready`'s `anchor_resolution` field — the DISPATCHER-facing
 * half of task-a-mistyped-task-file-anchor-is-stored-and-consulted (Required #2).
 *
 * The write-time advisory is seen by the anchor's AUTHOR, who is not the party
 * the mutex protects; this field is what the dispatcher assigning concurrent work
 * reads. It sits beside the pre-existing `anchor_conflicts[]` and is computed from
 * the SAME already-fetched task array (no extra store IO), through the SAME
 * injected `FsProbe` port `--check-drift` uses.
 *
 * ⛔ The field is a DISCRIMINATED UNION, not an array: `{probed:false, reason}`
 * (no probe was supplied — MCP/HTTP `ready`) can never be confused with
 * `{probed:true, unresolved:[]}` (probed, everything resolves). An absent probe
 * and an empty finding list are the two states this task exists to keep apart.
 *
 * Six-dimension coverage:
 *   HAPPY:      a plan task whose anchor resolves → probed:true, unresolved:[]
 *               (CONTROL — a blanket-advisory regression fails here)
 *   NEGATIVE:   a CLAIMED task with a non-resolving anchor → a row naming
 *               task_slug + the exact anchor + kind
 *   BOUNDARY:   a plan with ZERO tasks still carries the field (probed:true,
 *               unresolved:[]); an anchor-less task contributes no rows
 *   ERROR:      a throwing probe surfaces probe_error rather than silently
 *               reporting the anchor as resolving
 *   STATE:      calling ready() WITHOUT a probe context yields probed:false with
 *               an explicit reason — structurally distinct from the clean probed
 *               report produced for the SAME corpus
 *   REGRESSION: `anchor_conflicts` / `sessions` / `records` are unchanged by the
 *               new field, and ready() still performs ZERO store writes
 *
 * @spec_ref task-a-mistyped-task-file-anchor-is-stored-and-consulted
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { FileAnchorProbeContext } from "../../../src/service/anchor-resolution.js";
import type { FsProbe } from "../../../src/service/drift-check-service.js";
import type { CreateDocInput, DocRecord } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";

const NOW = "2026-08-06T12:00:00.000Z";

function makeServices(store: StoreInterface = new InMemoryStore()) {
  return {
    store,
    corpusService: new CorpusService(store, new RecordLockService(store)),
    taskWorkflowService: new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }),
  };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPlan(cs: CorpusService): Promise<string> {
  const plan = await mustCreate(cs, { type: "plan", title: "Anchor Probe Plan", content: "# Plan" } as CreateDocInput);
  return plan.id;
}

async function createTask(
  cs: CorpusService,
  planId: string,
  title: string,
  anchors?: string[],
): Promise<DocRecord> {
  return mustCreate(cs, {
    type: "task",
    title,
    parent_id: planId,
    content: `# ${title}`,
    extra: { plan_id: planId, ...(anchors !== undefined ? { file_anchors: anchors } : {}) },
  } as CreateDocInput);
}

/** Records a fresh claim directly on the stored task (the shape `claim` writes). */
async function claimTask(store: StoreInterface, task: DocRecord, by: string): Promise<void> {
  const result = await store.update(task.id, {
    extra: { ...task.extra, claim: { by, at: NOW, worktree: "/wt" } },
  });
  if (!result.ok) throw new Error(`claim write failed: ${JSON.stringify(result.error)}`);
}

function fakeProbeContext(table: Record<string, "file" | "dir" | "missing" | "throw">): FileAnchorProbeContext {
  const probe: FsProbe = {
    stat(path: string) {
      const verdict = table[path];
      if (verdict === "throw") throw new Error(`refusing to probe "${path}"`);
      return verdict ?? "missing";
    },
    readFile: () => null,
    listDir: () => null,
  };
  return { probe, root: "/repo/root" };
}

const now = (): string => NOW;

describe("ready().anchor_resolution — HAPPY (CONTROL)", () => {
  it("a resolving anchor yields probed:true with an empty unresolved list", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Task A", ["src/real.ts"]);

    const result = await taskWorkflowService.ready(planId, now, fakeProbeContext({ "src/real.ts": "file" }));
    if (!result.ok) throw new Error("ready failed");
    expect(result.value.anchor_resolution).toEqual({ probed: true, root: "/repo/root", unresolved: [] });
  });

  it("a resolving directory-scope anchor yields no rows", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Task A", ["src/dir/"]);

    const result = await taskWorkflowService.ready(planId, now, fakeProbeContext({ "src/dir": "dir" }));
    if (!result.ok) throw new Error("ready failed");
    expect(result.value.anchor_resolution).toEqual({ probed: true, root: "/repo/root", unresolved: [] });
  });
});

describe("ready().anchor_resolution — NEGATIVE", () => {
  it("a CLAIMED task's non-resolving anchor is reported with task_slug, anchor and kind", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const task = await createTask(corpusService, planId, "Typo Task", ["packages/lore/src/does-not-exist.ts"]);
    await claimTask(store, task, "agent:one");

    const result = await taskWorkflowService.ready(planId, now, fakeProbeContext({}));
    if (!result.ok) throw new Error("ready failed");
    const resolution = result.value.anchor_resolution;
    if (!resolution.probed) throw new Error("expected a probed report");
    expect(resolution.unresolved).toEqual([
      {
        task_slug: task.slug,
        anchor: "packages/lore/src/does-not-exist.ts",
        kind: "file_missing",
      },
    ]);
  });

  it("an UNCLAIMED task's non-resolving anchor is reported too (the dispatcher reads this BEFORE assigning)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const task = await createTask(corpusService, planId, "Unclaimed Typo", ["src/gone.ts"]);

    const result = await taskWorkflowService.ready(planId, now, fakeProbeContext({}));
    if (!result.ok) throw new Error("ready failed");
    const resolution = result.value.anchor_resolution;
    if (!resolution.probed) throw new Error("expected a probed report");
    expect(resolution.unresolved.map((r) => [r.task_slug, r.anchor])).toEqual([[task.slug, "src/gone.ts"]]);
  });

  it("a missing directory-scope anchor reports dir_missing", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Dir Typo", ["src/nope/"]);

    const result = await taskWorkflowService.ready(planId, now, fakeProbeContext({}));
    if (!result.ok) throw new Error("ready failed");
    const resolution = result.value.anchor_resolution;
    if (!resolution.probed) throw new Error("expected a probed report");
    expect(resolution.unresolved.map((r) => r.kind)).toEqual(["dir_missing"]);
  });
});

describe("ready().anchor_resolution — BOUNDARY", () => {
  it("a plan with ZERO tasks still carries the field (never an absent key)", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);

    const result = await taskWorkflowService.ready(planId, now, fakeProbeContext({}));
    if (!result.ok) throw new Error("ready failed");
    expect(result.value.records).toEqual([]);
    expect(result.value.anchor_resolution).toEqual({ probed: true, root: "/repo/root", unresolved: [] });
  });

  it("an anchor-less task contributes no rows", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "No Anchors");

    const result = await taskWorkflowService.ready(planId, now, fakeProbeContext({}));
    if (!result.ok) throw new Error("ready failed");
    const resolution = result.value.anchor_resolution;
    if (!resolution.probed) throw new Error("expected a probed report");
    expect(resolution.unresolved).toEqual([]);
  });
});

describe("ready().anchor_resolution — ERROR", () => {
  it("a throwing probe surfaces probe_error, never a silent 'resolves'", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Escape", ["src/escape.ts"]);

    const result = await taskWorkflowService.ready(planId, now, fakeProbeContext({ "src/escape.ts": "throw" }));
    if (!result.ok) throw new Error("ready failed");
    const resolution = result.value.anchor_resolution;
    if (!resolution.probed) throw new Error("expected a probed report");
    expect(resolution.unresolved.map((r) => r.kind)).toEqual(["probe_error"]);
  });
});

describe("ready().anchor_resolution — STATE (not probed ≠ nothing found)", () => {
  it("omitting the probe context yields probed:false with an explicit reason", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Task A", ["src/real.ts"]);

    const result = await taskWorkflowService.ready(planId, now);
    if (!result.ok) throw new Error("ready failed");
    expect(result.value.anchor_resolution).toEqual({ probed: false, reason: "no-fs-probe" });
  });

  it("the unprobed report is structurally distinct from the clean probed report for the SAME corpus", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Task A", ["src/real.ts"]);

    const unprobed = await taskWorkflowService.ready(planId, now);
    const probed = await taskWorkflowService.ready(planId, now, fakeProbeContext({ "src/real.ts": "file" }));
    if (!unprobed.ok || !probed.ok) throw new Error("ready failed");
    expect(unprobed.value.anchor_resolution).not.toEqual(probed.value.anchor_resolution);
  });
});

describe("ready() — REGRESSION", () => {
  it("records / sessions / anchor_conflicts are unaffected by the new field", async () => {
    const { store, corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const a = await createTask(corpusService, planId, "Task A", ["src/shared.ts"]);
    const b = await createTask(corpusService, planId, "Task B", ["src/shared.ts"]);
    await claimTask(store, a, "agent:one");
    await claimTask(store, b, "agent:two");

    const result = await taskWorkflowService.ready(planId, now, fakeProbeContext({ "src/shared.ts": "file" }));
    if (!result.ok) throw new Error("ready failed");
    expect(result.value.records).toHaveLength(2);
    expect(result.value.sessions.length).toBeGreaterThan(0);
    expect(result.value.anchor_conflicts.length).toBeGreaterThan(0);
    expect(result.value.anchor_resolution).toEqual({ probed: true, root: "/repo/root", unresolved: [] });
  });

  it("ready() performs zero store writes while probing", async () => {
    const base = new InMemoryStore();
    const writes: string[] = [];
    const proxy = new Proxy(base, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop === "string" && ["insert", "update", "softDelete", "insertVersion", "appendAuditEntry"].includes(prop)) {
          return (...args: unknown[]) => {
            writes.push(prop);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as StoreInterface;

    const { corpusService, taskWorkflowService } = makeServices(proxy);
    const planId = await createPlan(corpusService);
    await createTask(corpusService, planId, "Task A", ["src/gone.ts"]);
    writes.length = 0;

    const result = await taskWorkflowService.ready(planId, now, fakeProbeContext({}));
    if (!result.ok) throw new Error("ready failed");
    expect(writes).toEqual([]);
  });
});
