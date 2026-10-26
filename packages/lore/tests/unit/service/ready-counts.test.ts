/**
 * `ready()`'s `counts` field (gh-177): `.records` includes archived rows, so
 * `records.length` is NOT the ready count. `counts` exposes it directly.
 *
 * @spec_ref task-gh-1343388703-177
 */
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import type { CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
async function setup() {
  const store = actedStore(new InMemoryStore());
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const twf = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  const mk = async (input: CreateDocInput) => {
    const r = await cs.create(input);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  };
  const plan = await mk({ type: "plan", title: "Counts Plan", content: "# P" } as CreateDocInput);
  const task = (title: string) =>
    mk({ type: "task", title, parent_id: plan.id, content: `# ${title}`, extra: { plan_id: plan.id } } as CreateDocInput);
  return { cs, twf, plan, task };
}

describe("ready() counts (gh-177)", () => {
  it("AC-1/3: counts.ready is the ready-row count, not records.length; total === records.length", async () => {
    const { cs, twf, plan, task } = await setup();
    const a = await task("Done A");
    const b = await task("Done B");
    await task("Open C");
    const d = await task("Open D");
    for (const t of [a, b]) {
      expect((await cs.set(t.id, { status: "approved" })).ok).toBe(true);
      expect((await cs.set(t.id, { status: "archived" })).ok).toBe(true);
    }
    const claim = await twf.claim(d.id, { by: "agent:x" });
    expect(claim.ok).toBe(true);

    const res = await twf.ready(plan.id);
    if (!res.ok) throw new Error(JSON.stringify(res.error));
    const { records, counts } = res.value;
    const readyLen = records.filter((r) => r.ready === true).length;

    expect(readyLen).toBeGreaterThan(0);
    expect(counts.ready).toBe(readyLen);
    expect(counts.ready).not.toBe(records.length);
    expect(counts.total).toBe(records.length);
    expect(counts.archived).toBe(2);
    expect(counts.claimed).toBe(1);
  });

  it("boundary: a plan with no tasks reports all-zero counts", async () => {
    const { twf, plan } = await setup();
    const res = await twf.ready(plan.id);
    if (!res.ok) throw new Error(JSON.stringify(res.error));
    expect(res.value.counts).toEqual({ ready: 0, claimed: 0, archived: 0, total: 0 });
  });
});
