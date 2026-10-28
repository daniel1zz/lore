/**
 * `readEditScope(deps, {all: true})` lists LIVE claims only, decided per claim by the shared `claimIsLive` predicate
 * (spec-a-helper-s-shell-write-whose-target-cannot-be-read-is, BR-1493, AC-USW-3).
 *
 * The liveness answer needs the claim's own task document and nothing else: no other task document is read (the fake
 * `listTasks` and `buildSiblingContext` throw), an expired lease is excluded, a live one is listed, and a claim whose
 * liveness cannot be read is an error, never a silent omission.
 */

import { describe, expect, it } from "vitest";
import { err, ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import { readEditScope, type EditScopeDeps } from "../../../src/service/edit-scope.js";
import { claimIsLive } from "../../../src/service/task-workflow-service.js";
import type { OpenProjectClaim } from "../../../src/service/run-service.js";
import type { StoreInterface } from "../../../src/store/interface.js";

const NOW = "2026-10-28T12:00:00.000Z";
const TTL_MINUTES = 120;

function taskDoc(slug: string, claimAt: string, run: string | null): DocRecord {
  return {
    id: `id-${slug}`,
    slug,
    type: "task",
    status: "active",
    title: slug,
    extra: { file_anchors: [`src/${slug}.ts`], claim: { by: "agent:x", at: claimAt, ...(run !== null ? { harness_run: run } : {}) } },
  } as unknown as DocRecord;
}

const docs = new Map<string, DocRecord>([
  ["live-task", taskDoc("live-task", "2026-10-28T11:30:00.000Z", null)],
  ["expired-task", taskDoc("expired-task", "2020-01-01T00:00:00.000Z", null)],
  ["run-task", taskDoc("run-task", "2026-10-28T11:30:00.000Z", "cc:s:agent")],
]);

function row(slug: string): OpenProjectClaim {
  return { slug, file_anchors: [`src/${slug}.ts`], holder_run: slug === "run-task" ? "cc:s:agent" : null, working_copy: `/wc/${slug}` };
}

const unreachable = (name: string) => () => {
  throw new Error(`${name} must not be needed for the liveness answer`);
};

function depsOver(rows: readonly OpenProjectClaim[], store: StoreInterface): EditScopeDeps {
  return {
    openClaimsOfProject: async () => ok(rows),
    getTask: async (slug: string): Promise<Result<DocRecord, LoreError>> => {
      const doc = docs.get(slug);
      return doc === undefined ? err({ code: "DOC_NOT_FOUND", id: slug } as LoreError) : ok(doc);
    },
    claimIsLive: (task: DocRecord, nowIso: string, endedRuns: Map<string, boolean>) => claimIsLive(store, task, nowIso, TTL_MINUTES, endedRuns),
    now: () => NOW,
    listTasks: unreachable("listTasks"),
    buildSiblingContext: unreachable("buildSiblingContext"),
  } as unknown as EditScopeDeps;
}

/** A store whose only answer is the run-end lookup the predicate makes for a claim with a run. */
function storeWithRun(endedAt: string | null): StoreInterface {
  return { getRunEnd: async () => ok(endedAt === null ? null : { endedAt }) } as unknown as StoreInterface;
}

describe("readEditScope({all: true}) lists live claims through claimIsLive", () => {
  it("AC-USW-3: a live claim is listed, an expired-lease claim is excluded, and no other task document is read", async () => {
    const report = await readEditScope(depsOver([row("live-task"), row("expired-task")], storeWithRun(null)), { all: true });
    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value.claims.map((c) => c.task)).toEqual(["live-task"]);
    expect(report.value.claims[0]?.working_copy).toBe("/wc/live-task");
  });

  it("AC-USW-3: open claims with no other task documents at all are still judged (no silent empty list)", async () => {
    const report = await readEditScope(depsOver([row("live-task")], storeWithRun(null)), { all: true });
    expect(report.ok && report.value.claims.map((c) => c.task)).toEqual(["live-task"]);
  });

  it("AC-USW-3: an unreadable run lookup is an error, never a silent omission", async () => {
    const failing = { getRunEnd: async () => err({ code: "STORE_ERROR", message: "boom" } as LoreError) } as unknown as StoreInterface;
    const report = await readEditScope(depsOver([row("run-task")], failing), { all: true });
    expect(report.ok).toBe(false);
  });

  it("AC-USW-3: claimIsLive is false for a task that holds no claim", async () => {
    const free = { ...taskDoc("free", NOW, null), extra: {} } as unknown as DocRecord;
    const live = await claimIsLive(storeWithRun(null), free, NOW, TTL_MINUTES, new Map());
    expect(live.ok && live.value).toBe(false);
  });
});
