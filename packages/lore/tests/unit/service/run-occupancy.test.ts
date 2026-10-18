/**
 * @spec_ref spec-worktree-removal-is-decided-by-who-is-inside-not-by-how (AC-WL-1; D1, D2; BR-1070)
 *
 * `RunService.occupancy` over the InMemoryStore with an injected realpath port — the owning-run and open-claim
 * decisions without a database, a spawned CLI or the real filesystem.
 *
 * HAPPY:      (a) an agent worktree whose run has ended is not occupied
 * NEGATIVE:   (b) the same run with no end is occupied; (d) a non-agent basename has no owning run
 * STATE:      (c) a live run whose parent run ended is not occupied; (f) two runs sharing an agent_ref
 * BOUNDARY:   (e) claims by branch / by symlinked path, no harness_run, archived task, unregistered run
 * REGRESSION: (g) the read writes nothing (store write spy count 0)
 */

import { describe, expect, it, vi } from "vitest";
import type { CreateDocInput, DocRecord, RunId } from "@lore/core";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { RunService, type RunOccupancy } from "../../../src/service/run-service.js";

const COMPOSITION = { schemaVersion: 1 as const, fragments: [] };
const REAL = "/private/tmp/occ/agent-X1";
const LINK = "/tmp/occ/agent-X1";
const LINKS: Record<string, string> = { [LINK]: REAL };

async function setup() {
  const store = new InMemoryStore();
  let tick = 0;
  // reason: registered_at orders two runs of one agent (f); a strictly increasing clock makes "newer" unambiguous.
  const now = () => new Date(Date.UTC(2026, 9, 12, 5, 0, tick++));
  const service = new RunService(store, now, undefined, (p) => LINKS[p] ?? p, "/repo");
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const plan = await corpus.create({ type: "plan", title: "Plan A", content: "# A" } as CreateDocInput);
  if (!plan.ok) throw new Error(JSON.stringify(plan.error));
  const planId = plan.value.id;
  let n = 0;

  async function register(session: string, agentId?: string): Promise<RunId> {
    const r = await service.register({
      harness: "claude-code",
      sessionId: session,
      ...(agentId === undefined ? {} : { agentId, agentType: "t" }),
      composition: COMPOSITION,
    });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value.id;
  }
  async function end(id: RunId): Promise<void> {
    const r = await store.endRun(id, new Date(Date.UTC(2026, 9, 12, 6, 0, 0)).toISOString(), "test");
    if (!r.ok) throw new Error(JSON.stringify(r.error));
  }
  async function task(
    claim: { worktree: string; harness_run?: string } | null,
    status: DocRecord["status"] = "approved",
  ): Promise<DocRecord> {
    n += 1;
    const created = await corpus.create({
      type: "task",
      title: `Task ${n}`,
      parent_id: planId,
      content: "# T",
      extra: { plan_id: planId },
    } as CreateDocInput);
    if (!created.ok) throw new Error(JSON.stringify(created.error));
    const extra: Record<string, unknown> = { plan_id: planId };
    if (claim !== null) extra["claim"] = { by: "agent:x", at: new Date().toISOString(), ...claim };
    const patched = await store.update(created.value.id, { extra, status });
    if (!patched.ok) throw new Error(JSON.stringify(patched.error));
    return patched.value;
  }
  async function occupancy(worktree: string, branch?: string): Promise<RunOccupancy> {
    const r = await service.occupancy({ worktree, ...(branch === undefined ? {} : { branch }) });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  }
  return { store, service, register, end, task, occupancy };
}

describe("AC-WL-1 RunService.occupancy", () => {
  it("(a) agent worktree whose subagent run ended: agent_run.ended true, not occupied", async () => {
    const t = await setup();
    await t.register("S1");
    const run = await t.register("S1", "X1");
    await t.end(run);
    const out = await t.occupancy("/w/agent-X1");
    expect(out.agent_run).toEqual({ id: run, ended: true, parent_ended: false });
    expect(out.occupied).toBe(false);
    expect(out.open_claims).toEqual([]);
  });

  it("(b) the same run with no end: occupied", async () => {
    const t = await setup();
    await t.register("S1");
    const run = await t.register("S1", "X1");
    const out = await t.occupancy("/w/agent-X1");
    expect(out.agent_run).toEqual({ id: run, ended: false, parent_ended: false });
    expect(out.occupied).toBe(true);
  });

  it("(c) run open but its parent run ended: parent_ended true, not occupied", async () => {
    const t = await setup();
    const parent = await t.register("S1");
    const run = await t.register("S1", "X1");
    await t.end(parent);
    const out = await t.occupancy("/w/agent-X1");
    expect(out.agent_run).toEqual({ id: run, ended: false, parent_ended: true });
    expect(out.occupied).toBe(false);
  });

  it("(d) a basename without the agent- prefix has no owning run, even if an agent run exists", async () => {
    const t = await setup();
    await t.register("S1");
    await t.register("S1", "X1");
    const out = await t.occupancy("/w/feature-x1");
    expect(out.agent_run).toBeNull();
    expect(out.occupied).toBe(false);
  });

  it("(e) open claims: by branch name, by symlinked path; a run with no end and a claim with no run both occupy", async () => {
    const t = await setup();
    const live = await t.register("S9");
    const gone = await t.register("S8");
    await t.end(gone);
    const byBranch = await t.task({ worktree: "feat-x", harness_run: live });
    const byPath = await t.task({ worktree: LINK, harness_run: gone });
    const noRun = await t.task({ worktree: REAL });
    await t.task({ worktree: "other-branch", harness_run: live });
    const archived = await t.task({ worktree: REAL, harness_run: live }, "archived");

    const out = await t.occupancy(REAL, "feat-x");

    expect(out.open_claims).toEqual(
      [
        { task_slug: byBranch.slug, run_id: live, run_ended: false },
        { task_slug: byPath.slug, run_id: gone, run_ended: true },
        { task_slug: noRun.slug, run_id: null, run_ended: null },
      ].sort((x, y) => x.task_slug.localeCompare(y.task_slug)),
    );
    expect(out.open_claims.map((c) => c.task_slug)).not.toContain(archived.slug);
    expect(out.occupied).toBe(true);
  });

  it("(e) a claim whose run has ended does not occupy; a claim by a live run does", async () => {
    const t = await setup();
    const gone = await t.register("S8");
    await t.end(gone);
    await t.task({ worktree: REAL, harness_run: gone });
    expect((await t.occupancy(REAL)).occupied).toBe(false);
    const live = await t.register("S9");
    await t.task({ worktree: LINK, harness_run: live });
    expect((await t.occupancy(REAL)).occupied).toBe(true);
  });

  it("(f) two runs share an agent_ref, the older live and the newer ended: agent_run names the newer, occupied", async () => {
    const t = await setup();
    await t.register("S1");
    await t.register("S2");
    const older = await t.register("S1", "X1");
    const newer = await t.register("S2", "X1");
    await t.end(newer);
    const out = await t.occupancy("/w/agent-X1");
    expect(older).not.toBe(newer);
    expect(out.agent_run?.id).toBe(newer);
    expect(out.agent_run?.ended).toBe(true);
    expect(out.occupied).toBe(true);
  });

  it("(g) the read writes nothing", async () => {
    const t = await setup();
    await t.register("S1");
    await t.register("S1", "X1");
    await t.task({ worktree: REAL });
    const spies = (["insert", "update", "softDelete", "insertRun", "endRun", "reopenRun"] as const).map((m) =>
      vi.spyOn(t.store, m),
    );
    await t.occupancy("/w/agent-X1");
    await t.occupancy(REAL, "feat-x");
    expect(spies.map((s) => s.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("ERROR: a blank path is a VALIDATION_ERROR; a service built without a realpath port refuses", async () => {
    const t = await setup();
    const blank = await t.service.occupancy({ worktree: "" });
    expect(blank.ok).toBe(false);
    const bare = await new RunService(new InMemoryStore(), undefined, undefined, undefined, "/repo").occupancy({ worktree: "/w/agent-X1" });
    expect(bare.ok).toBe(false);
  });

  it("BOUNDARY: an unregistered agent worktree has no owning run and is not occupied", async () => {
    const t = await setup();
    const out = await t.occupancy("/w/agent-ghost");
    expect(out.agent_run).toBeNull();
    expect(out.occupied).toBe(false);
  });
});
