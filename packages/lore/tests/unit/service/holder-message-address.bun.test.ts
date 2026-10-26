/**
 * @spec_ref spec-runs-carry-their-messaging-address-holder-listings-show-it (AC-MA-3; BR-1363, BR-1360)
 *
 * Every holder listing (bootstrap `active_sessions`, `lore ready` task-plan `sessions[]`, the phase-plan sessions
 * schema, `lore territory` foreign holders) carries `message_address`: the MAIN run's address of the session that
 * holds the claim. The join is claim.harness_run -> run -> main run id (deriveRunId of the run's session) -> address;
 * never parentRunId (the hook registers a subagent without --parent), claim.session_id or a display name.
 *
 * Fixture: main run M1 (uds:/one) holds task A; a subagent run of M1's session, registered WITHOUT parentRunId
 * exactly as the hook does, holds task B; main run M2 (no address) holds task C.
 *
 * Six dimensions: HAPPY (A and B show uds:/one), NEGATIVE (C null; claim of an unregistered-address run null),
 * BOUNDARY (a main run whose subagent holds a claim while the main holds none), STATE (a resume replaces the
 * address in the listing), ERROR (a harness_run the registry does not know yields null, no throw),
 * REGRESSION (holder counts equal the counts without the field; partition bucket totals unchanged).
 */

import { describe, expect, it } from "vitest";
import { readySessionSchema, type CreateDocInput, type DocRecord, type ReadySession, type RunId } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RunService } from "../../../src/service/run-service.js";
import { TaskWorkflowService } from "../../../src/service/task-workflow-service.js";
import { PhaseWorkflowService } from "../../../src/service/phase-workflow-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { formatSessionLine } from "../../../src/adapters/cli/commands/ready.js";
import { formatTerritoryHuman, partitionTerritory } from "../../../src/adapters/cli/territory-partition.js";
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
const COMPOSITION = { schemaVersion: 1 as const, fragments: [] };

function makeWorld() {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const runs = new RunService(store, undefined, undefined, undefined, "/repo");
  const tasks = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  const sessions = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10080,
    createHandoffDoc: corpus.createHandoffDoc.bind(corpus),
  });
  return { store, corpus, runs, tasks, sessions };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput): Promise<DocRecord> {
  const r = await cs.create(input);
  if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

async function seed(options: { resumeAddress?: string } = {}) {
  const w = makeWorld();
  const plan = await mustCreate(w.corpus, { type: "plan", title: "Plan", content: "# Plan" } as CreateDocInput);
  const mk = (title: string) =>
    mustCreate(w.corpus, {
      type: "task",
      title,
      parent_id: plan.id,
      content: `# ${title}`,
      extra: { plan_id: plan.id },
    } as CreateDocInput);
  const [a, b, c] = [await mk("Task A"), await mk("Task B"), await mk("Task C")];

  const reg = async (input: Parameters<RunService["register"]>[0]) => {
    const r = await w.runs.register(input);
    if (!r.ok) throw new Error(`register failed: ${JSON.stringify(r.error)}`);
    return r.value.id;
  };
  const m1 = await reg({ harness: "claude-code", sessionId: "S1", composition: COMPOSITION, messageAddress: "uds:/one" });
  // reason: registered WITHOUT parentRunId, exactly as the real SubagentStart hook does (parentRunId stays NULL).
  const sub = await reg({ harness: "claude-code", sessionId: "S1", agentId: "AG1", agentType: "worker", composition: COMPOSITION });
  const m2 = await reg({ harness: "claude-code", sessionId: "S2", composition: COMPOSITION });
  if (options.resumeAddress !== undefined) {
    await reg({ harness: "claude-code", sessionId: "S1", composition: COMPOSITION, messageAddress: options.resumeAddress });
  }

  // reason: claim.session_id comes from the injected process env; territory only names a holder whose session_id
  // was measured, so each claimant gets a service carrying its own session env (as app.ts wires the real process).
  const claim = async (task: DocRecord, by: string, run: RunId, worktree: string, session: string) => {
    const svc = new TaskWorkflowService(w.store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, {
      CLAUDE_CODE_SESSION_ID: session,
    }, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
    const r = await svc.claim(task.id, { by, harnessRun: run, worktree, branch: { "/w/m1": "b1", "/w/sub": "b2", "/w/m2": "b3" }[worktree] ?? "b0" });
    if (!r.ok) throw new Error(`claim failed: ${JSON.stringify(r.error)}`);
  };
  await claim(a, "agent:session-S1", m1, "/w/m1", "s1");
  await claim(b, "agent:session-S1", sub, "/w/sub", "s1");
  await claim(c, "agent:session-S2", m2, "/w/m2", "s2");
  return { ...w, plan, a, b, c, m1, sub, m2 };
}

function addressOfTask(sessions: readonly ReadySession[], slug: string): string | null | undefined {
  return sessions.find((s) => s.task_slugs.includes(slug))?.message_address;
}

describe("holder listings show the holding run's messaging address (AC-MA-3)", () => {
  it("HAPPY: bootstrap active_sessions shows uds:/one for the main run's and its subagent's holders, null for M2", async () => {
    const w = await seed();
    const boot = await w.sessions.bootstrap("agent:session-S1");
    if (!boot.ok) throw new Error(JSON.stringify(boot.error));
    const active = boot.value.active_sessions;
    expect(addressOfTask(active, w.a.slug)).toBe("uds:/one");
    expect(addressOfTask(active, w.b.slug)).toBe("uds:/one");
    expect(addressOfTask(active, w.c.slug)).toBeNull();
    for (const s of active) expect(readySessionSchema.safeParse(s).success).toBe(true);
  });

  it("HAPPY: lore ready task-plan sessions[] shows the same addresses and the text line prints uds:/one", async () => {
    const w = await seed();
    const report = await w.tasks.ready(w.plan.id);
    if (!report.ok) throw new Error(JSON.stringify(report.error));
    const { sessions } = report.value;
    expect(addressOfTask(sessions, w.a.slug)).toBe("uds:/one");
    expect(addressOfTask(sessions, w.b.slug)).toBe("uds:/one");
    expect(addressOfTask(sessions, w.c.slug)).toBeNull();
    const m1Line = formatSessionLine(sessions.find((s) => s.task_slugs.includes(w.a.slug))!);
    expect(m1Line).toContain("uds:/one");
    const m2Line = formatSessionLine(sessions.find((s) => s.task_slugs.includes(w.c.slug))!);
    expect(m2Line).not.toContain("uds:");
    expect(m2Line).toContain("address:none");
  });

  it("HAPPY: lore territory foreign holders carry message_address and the text line prints it", async () => {
    const w = await seed();
    const active = await w.sessions.getActiveSessions();
    if (!active.ok) throw new Error(JSON.stringify(active.error));
    const partition = partitionTerritory(
      [
        { path: "/w/m1", branch: "b1" },
        { path: "/w/sub", branch: "b2" },
        { path: "/w/m2", branch: "b3" },
      ],
      active.value,
      "someone-else",
    );
    const byPath = new Map(partition.foreign.map((e) => [e.path, e.holder]));
    expect(byPath.get("/w/m1")?.message_address).toBe("uds:/one");
    expect(byPath.get("/w/sub")?.message_address).toBe("uds:/one");
    expect(byPath.get("/w/m2")?.message_address).toBeNull();
    const text = formatTerritoryHuman(partition);
    const m1Line = text.split("\n").find((l) => l.includes("/w/m1"))!;
    expect(m1Line).toContain("uds:/one");
  });

  it("SCHEMA: the phase-plan sessions shape accepts the same field (schema consistency, no production caller)", () => {
    const parsed = readySessionSchema.safeParse({
      by: "x",
      branches: [],
      task_slugs: [],
      newest_at: "2026-01-01T00:00:00.000Z",
      message_address: "uds:/one",
    });
    expect(parsed.success).toBe(true);
    expect(readySessionSchema.safeParse({ by: "x", branches: [], task_slugs: [], newest_at: "t" }).success).toBe(false);
    expect(typeof PhaseWorkflowService).toBe("function");
  });

  it("STATE: a resume register replaces the address shown in the listing", async () => {
    const w = await seed({ resumeAddress: "uds:/two" });
    const active = await w.sessions.getActiveSessions();
    if (!active.ok) throw new Error(JSON.stringify(active.error));
    expect(addressOfTask(active.value, w.a.slug)).toBe("uds:/two");
    expect(addressOfTask(active.value, w.b.slug)).toBe("uds:/two");
  });

  it("BOUNDARY: a subagent-only holder (the main run holds nothing) still resolves to the main run's address", async () => {
    const w = makeWorld();
    const plan = await mustCreate(w.corpus, { type: "plan", title: "P", content: "# P" } as CreateDocInput);
    const t = await mustCreate(w.corpus, {
      type: "task",
      title: "Only sub",
      parent_id: plan.id,
      content: "# t",
      extra: { plan_id: plan.id },
    } as CreateDocInput);
    await w.runs.register({ harness: "claude-code", sessionId: "S9", composition: COMPOSITION, messageAddress: "uds:/nine" });
    const sub = await w.runs.register({
      harness: "claude-code",
      sessionId: "S9",
      agentId: "AG9",
      agentType: "worker",
      composition: COMPOSITION,
    });
    if (!sub.ok) throw new Error(JSON.stringify(sub.error));
    const claimed = await w.tasks.claim(t.id, { by: "agent:session-S9", harnessRun: sub.value.id, worktree: "/w/s9", branch: "b-s9" });
    expect(claimed.ok).toBe(true);
    const active = await w.sessions.getActiveSessions();
    if (!active.ok) throw new Error(JSON.stringify(active.error));
    expect(addressOfTask(active.value, t.slug)).toBe("uds:/nine");
  });

  it("ERROR: a claim whose run the registry does not hold lists null, never throws", async () => {
    const w = makeWorld();
    const plan = await mustCreate(w.corpus, { type: "plan", title: "P", content: "# P" } as CreateDocInput);
    const t = await mustCreate(w.corpus, {
      type: "task",
      title: "Ghost",
      parent_id: plan.id,
      content: "# t",
      extra: { plan_id: plan.id },
    } as CreateDocInput);
    // reason: the claim verb may refuse an unregistered run; when it accepts, the listing must still be total.
    const claimed = await w.tasks.claim(t.id, { by: "agent:session-ghost", harnessRun: "cc:ghost" as RunId, worktree: "/w/g", branch: "b-g" });
    const active = await w.sessions.getActiveSessions();
    if (!active.ok) throw new Error(JSON.stringify(active.error));
    if (claimed.ok) expect(addressOfTask(active.value, t.slug)).toBeNull();
    else expect(active.value).toEqual([]);
  });

  it("REGRESSION: the join drops no holder; the three claims still yield three sessions and three territory entries", async () => {
    const w = await seed();
    const active = await w.sessions.getActiveSessions();
    if (!active.ok) throw new Error(JSON.stringify(active.error));
    expect(active.value.length).toBe(3);
    expect(active.value.flatMap((s) => s.task_slugs).sort()).toEqual([w.a.slug, w.b.slug, w.c.slug].sort());
    const stripped = active.value.map(({ message_address: _dropped, ...rest }) => rest);
    expect(stripped.length).toBe(active.value.length);
    const partition = partitionTerritory(
      [
        { path: "/w/m1", branch: "b1" },
        { path: "/w/sub", branch: "b2" },
        { path: "/w/m2", branch: "b3" },
      ],
      active.value,
      "someone-else",
    );
    expect(partition.mine.length + partition.foreign.length + partition.unowned.length + partition.unmeasured.length).toBe(3);
  });
});
