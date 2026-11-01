/**
 * PlanCloseService and PlanCloseLease — the one close function and its plan-scoped lease (AC-DCS2-11, AC-DCS2-12, AC-DCS2-20),
 * against injected fakes (the end-to-end proof through real processes is `tests/e2e/done-contract-plan-close-compiled.bun.test.ts`).
 *
 * Coverage: HAPPY (a closable plan reaches the assess), NEGATIVE (open tasks, a refusing step, a missing UAT, a busy lease), BOUNDARY (a
 * deprecated task is not open, no spec skips the apply), ERROR (an unreadable process table is loud), STATE (an already closed plan answers
 * without a second assess; the lease is released on every path; a stale or pid-reused lease is taken over), REGRESSION (the steps run in order).
 */

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { err, ok, type DocRecord, type LoreError, type PlanBundle, type Result } from "@lore/core";
import { PLAN_CLOSE_LEASE_DIR, PlanCloseLease, type PlanCloseLeaseOutcome, type PlanCloseLeasePort } from "../../../src/service/plan-close-lease.js";
import { PlanCloseService, type PlanCloseDeps } from "../../../src/service/plan-close-service.js";

const doc = (partial: Record<string, unknown>): DocRecord => ({ deleted_at: null, version: 1, content: "", tags: [], parent_id: null, extra: {}, ...partial }) as unknown as DocRecord;
const task = (slug: string, status: string): DocRecord => doc({ id: `id-${slug}`, slug, type: "task", status });

interface World {
  plan: DocRecord;
  tasks: DocRecord[];
  specs: DocRecord[];
  uat: { present: boolean; p0Accepted: boolean; uncoveredP0: string[] };
  steps: string[];
  held: { current: boolean };
  busy?: { pid: number; start_time: string; plan: string; since: string };
  failApply?: string;
  drift: string[];
  failVerify: boolean;
}

function makeWorld(partial: Partial<World> = {}): World {
  return {
    plan: doc({ id: "id-plan", slug: "plan-one", type: "plan", status: "approved" }),
    tasks: [task("t-1", "archived")],
    specs: [doc({ id: "id-spec", slug: "spec-one", type: "spec", status: "approved" })],
    uat: { present: false, p0Accepted: false, uncoveredP0: [] },
    steps: [],
    held: { current: false },
    drift: [],
    failVerify: false,
    ...partial,
  };
}

function depsOf(world: World): PlanCloseDeps {
  const leases: PlanCloseLeasePort = {
    acquire: async (key): Promise<Result<PlanCloseLeaseOutcome, LoreError>> => {
      world.steps.push(`lease:${key}`);
      if (world.busy !== undefined) return ok({ state: "busy", holder: world.busy });
      world.held.current = true;
      return ok({ state: "held", release: () => (world.held.current = false) });
    },
  };
  return {
    leases,
    getPlanBundle: async () => ok({ plan: world.plan, tasks: world.tasks, ...(world.specs[0] !== undefined ? { spec: world.specs[0] } : {}) } as unknown as PlanBundle),
    linkedSpecs: async () => ok(world.specs),
    verifyPlan: async () => {
      world.steps.push("verify");
      return world.failVerify ? err({ code: "STORE_ERROR", message: "the suite store is down" }) : ok(undefined);
    },
    applySpec: async (spec) => {
      world.steps.push(`apply:${spec.slug}`);
      return world.failApply === undefined ? ok(undefined) : err({ code: "VALIDATION_ERROR", field: "rule_changes", message: world.failApply });
    },
    checkAnchors: async () => {
      world.steps.push("anchors");
      return ok(world.drift);
    },
    latestUat: async () => ok(world.uat),
  };
}

const assessOf = (world: World) => async (): Promise<string> => {
  world.steps.push("assess");
  return "assessed";
};

describe("PlanCloseService", () => {
  it("HAPPY: a plan with no open task runs verify, apply, anchors and the assess in that order, then releases its lease", async () => {
    const world = makeWorld();
    const closed = await new PlanCloseService(depsOf(world)).close("plan-one", assessOf(world));
    expect(closed).toEqual({ ok: true, value: { state: "assessed", plan: "plan-one", row: "assessed", notes: [] } });
    expect(world.steps).toEqual(["lease:plan-one", "verify", "apply:spec-one", "anchors", "assess"]);
    expect(world.held.current, "the lease is released").toBe(false);
  });

  it("NEGATIVE: an open task refuses with plan-open-tasks naming each task and its status, runs nothing and releases the lease", async () => {
    const world = makeWorld({ tasks: [task("t-1", "archived"), task("t-2", "approved"), task("t-3", "draft")] });
    const closed = await new PlanCloseService(depsOf(world)).close("plan-one", assessOf(world));
    expect(closed.ok).toBe(false);
    if (closed.ok || closed.error.code !== "VALIDATION_ERROR") throw new Error("expected a validation error");
    expect(closed.error.field).toBe("plan-open-tasks");
    expect(closed.error.message).toContain("t-2 (approved)");
    expect(closed.error.message).toContain("t-3 (draft)");
    expect(closed.error.message).not.toContain("t-1");
    expect(world.steps).toEqual(["lease:plan-one"]);
    expect(world.held.current).toBe(false);
  });

  it("BOUNDARY: a deprecated task is not open", async () => {
    const world = makeWorld({ tasks: [task("t-1", "archived"), task("t-2", "deprecated")] });
    const closed = await new PlanCloseService(depsOf(world)).close("plan-one", assessOf(world));
    expect(closed.ok && closed.value.state).toBe("assessed");
  });

  it("STATE: an already archived plan answers already-closed without a lease and without a second assess", async () => {
    const world = makeWorld({ plan: doc({ id: "id-plan", slug: "plan-one", type: "plan", status: "archived" }) });
    const closed = await new PlanCloseService(depsOf(world)).close("plan-one", assessOf(world));
    expect(closed).toEqual({ ok: true, value: { state: "already-closed", plan: "plan-one", status: "archived" } });
    expect(world.steps).toEqual([]);
  });

  it("NEGATIVE: a live holder answers busy naming it and runs nothing", async () => {
    const busy = { pid: 4242, start_time: "2026-10-30T00:00:00.000Z", plan: "plan-one", since: "2026-10-30T00:00:01.000Z" };
    const world = makeWorld({ busy });
    const closed = await new PlanCloseService(depsOf(world)).close("plan-one", assessOf(world));
    expect(closed).toEqual({ ok: true, value: { state: "busy", plan: "plan-one", holder: busy } });
    expect(world.steps).toEqual(["lease:plan-one"]);
  });

  it("NEGATIVE: a failing rule apply leaves the plan open naming the spec and the cause, without the assess", async () => {
    const world = makeWorld({ failApply: "AC-X-1 has no accepting verdict" });
    const closed = await new PlanCloseService(depsOf(world)).close("plan-one", assessOf(world));
    if (closed.ok || closed.error.code !== "VALIDATION_ERROR") throw new Error("expected a validation error");
    expect(closed.error.field).toBe("plan-apply-failed");
    expect(closed.error.message).toContain("spec-one");
    expect(closed.error.message).toContain("AC-X-1 has no accepting verdict");
    expect(world.steps).not.toContain("assess");
    expect(world.held.current).toBe(false);
  });

  it("NEGATIVE: a drifted code anchor leaves the plan open naming it", async () => {
    const world = makeWorld({ drift: ["spec-one: src/gone.ts (file_missing)"] });
    const closed = await new PlanCloseService(depsOf(world)).close("plan-one", assessOf(world));
    if (closed.ok || closed.error.code !== "VALIDATION_ERROR") throw new Error("expected a validation error");
    expect(closed.error.field).toBe("plan-anchor-drift");
    expect(closed.error.message).toContain("src/gone.ts");
    expect(world.steps).not.toContain("assess");
  });

  it("NEGATIVE: a failing verification leaves the plan open", async () => {
    const world = makeWorld({ failVerify: true });
    const closed = await new PlanCloseService(depsOf(world)).close("plan-one", assessOf(world));
    if (closed.ok || closed.error.code !== "VALIDATION_ERROR") throw new Error("expected a validation error");
    expect(closed.error.field).toBe("plan-verify-failed");
    expect(world.steps).toEqual(["lease:plan-one", "verify"]);
  });

  it("NEGATIVE: a plan that requires UAT with no verdict, or a verdict that is not P0-accepted, stays open naming the gate; an accepted one closes", async () => {
    const required = doc({ id: "id-plan", slug: "plan-one", type: "plan", status: "approved", extra: { requires_uat: true } });
    const missing = makeWorld({ plan: required });
    const none = await new PlanCloseService(depsOf(missing)).close("plan-one", assessOf(missing));
    if (none.ok || none.error.code !== "VALIDATION_ERROR") throw new Error("expected a validation error");
    expect(none.error.field).toBe("plan-uat-gate");
    expect(none.error.message).toContain("none is recorded");
    const rejected = makeWorld({ plan: required, uat: { present: true, p0Accepted: false, uncoveredP0: ["R-3"] } });
    const notAccepted = await new PlanCloseService(depsOf(rejected)).close("plan-one", assessOf(rejected));
    if (notAccepted.ok || notAccepted.error.code !== "VALIDATION_ERROR") throw new Error("expected a validation error");
    expect(notAccepted.error.message).toContain("R-3");
    const accepted = makeWorld({ plan: required, uat: { present: true, p0Accepted: true, uncoveredP0: [] } });
    const closed = await new PlanCloseService(depsOf(accepted)).close("plan-one", assessOf(accepted));
    expect(closed.ok && closed.value.state).toBe("assessed");
    // a plan that does not require UAT never reads one
    const optOut = makeWorld();
    const free = await new PlanCloseService(depsOf(optOut)).close("plan-one", assessOf(optOut));
    expect(free.ok && free.value.state).toBe("assessed");
  });

  it("BOUNDARY: a plan with no spec skips the apply and says so; a plan implementing two specs applies both", async () => {
    const bare = makeWorld({ specs: [] });
    const skipped = await new PlanCloseService(depsOf(bare)).close("plan-one", assessOf(bare));
    expect(skipped.ok && skipped.value.state === "assessed" ? skipped.value.notes : []).toEqual(["plan-one has no spec: rule apply skipped"]);
    expect(bare.steps.some((step) => step.startsWith("apply:"))).toBe(false);
    const two = makeWorld({ specs: [doc({ id: "s1", slug: "spec-a", type: "spec" }), doc({ id: "s2", slug: "spec-b", type: "spec" })] });
    await new PlanCloseService(depsOf(two)).close("plan-one", assessOf(two));
    expect(two.steps.filter((step) => step.startsWith("apply:"))).toEqual(["apply:spec-a", "apply:spec-b"]);
  });
});

// ───────────────────────────── the lease ─────────────────────────────

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function leaseOver(options: { pid: number; alive: Map<number, string | "zombie">; unreadable?: boolean }): { lease: PlanCloseLease; dir: string } {
  const root = mkdtempSync(join(tmpdir(), "plan-close-lease-"));
  roots.push(root);
  const lease = new PlanCloseLease({
    commonDir: root,
    pid: options.pid,
    inspect: async (pid) => {
      if (options.unreadable === true) throw new Error("ps failed");
      const start = options.alive.get(pid);
      return start === undefined ? null : { zombie: start === "zombie", startTime: start === "zombie" ? null : start };
    },
  });
  return { lease, dir: join(root, PLAN_CLOSE_LEASE_DIR) };
}

const leaseFiles = (dir: string): string[] => readdirSync(dir).sort();

describe("PlanCloseLease", () => {
  it("HAPPY: a free lease is taken, a second taker of the same plan is busy naming the holder, another plan is free, release frees it", async () => {
    const { lease, dir } = leaseOver({ pid: 100, alive: new Map([[100, "T100"]]) });
    const first = await lease.acquire("plan-a");
    if (!first.ok || first.value.state !== "held") throw new Error("expected held");
    const again = await lease.acquire("plan-a");
    expect(again.ok && again.value.state === "busy" ? again.value.holder.pid : undefined).toBe(100);
    const other = await lease.acquire("plan-b");
    expect(other.ok && other.value.state).toBe("held");
    first.value.release();
    expect(leaseFiles(dir)).toEqual(["plan-b.lease"]);
    const reacquired = await lease.acquire("plan-a");
    expect(reacquired.ok && reacquired.value.state).toBe("held");
  });

  it("STATE: a lease whose holder is gone, a zombie, or whose pid has another start time is taken over", async () => {
    for (const holderState of [undefined, "zombie", "T-OTHER"] as const) {
      const alive = new Map<number, string | "zombie">([[100, "T100"]]);
      if (holderState !== undefined) alive.set(200, holderState);
      const { lease, dir } = leaseOver({ pid: 100, alive });
      await lease.acquire("plan-a").then((taken) => {
        if (!taken.ok || taken.value.state !== "held") throw new Error("expected held");
        taken.value.release();
      });
      writeFileSync(join(dir, "plan-a.lease"), `${JSON.stringify({ pid: 200, start_time: "T200", plan: "plan-a", since: "2026-10-30T00:00:00.000Z" })}\n`);
      const taken = await lease.acquire("plan-a");
      expect(taken.ok && taken.value.state, `holder ${String(holderState)}`).toBe("held");
    }
  });

  it("NEGATIVE: a live holder with the recorded start time is never taken over", async () => {
    const { lease, dir } = leaseOver({ pid: 100, alive: new Map([[100, "T100"], [200, "T200"]]) });
    await lease.acquire("plan-a").then((taken) => taken.ok && taken.value.state === "held" && taken.value.release());
    writeFileSync(join(dir, "plan-a.lease"), `${JSON.stringify({ pid: 200, start_time: "T200", plan: "plan-a", since: "2026-10-30T00:00:00.000Z" })}\n`);
    const busy = await lease.acquire("plan-a");
    expect(busy.ok && busy.value.state === "busy" ? busy.value.holder.pid : undefined).toBe(200);
  });

  it("ERROR: an unreadable process table and an unreadable lease file are loud, never read as dead or free", async () => {
    const down = leaseOver({ pid: 100, alive: new Map(), unreadable: true });
    const unreadable = await down.lease.acquire("plan-a");
    expect(unreadable.ok).toBe(false);
    expect(!unreadable.ok && "message" in unreadable.error ? unreadable.error.message : "").toContain("process table");

    const { lease, dir } = leaseOver({ pid: 100, alive: new Map([[100, "T100"]]) });
    await lease.acquire("plan-a").then((taken) => taken.ok && taken.value.state === "held" && taken.value.release());
    writeFileSync(join(dir, "plan-a.lease"), "not json\n");
    const torn = await lease.acquire("plan-a");
    expect(torn.ok).toBe(false);
    expect(!torn.ok && "message" in torn.error ? torn.error.message : "").toContain("plan-a.lease");
  });
});
