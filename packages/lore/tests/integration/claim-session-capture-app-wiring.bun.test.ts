/**
 * @spec_ref task-two-concurrent-orchestrators-both-resolve-to-agent-main
 *   §Required fix 1-4, §Proxy / Silence / Opt-in; SPEC-042 §Design Decisions D1/D5.
 *
 * The DISTRIBUTION oracle for claim-time session capture: `TaskWorkflowService`
 * defaults its `processEnv` to `{}` (so unit constructions stay deterministic
 * instead of depending on whether the test process runs under a Claude Code
 * session), which means EVERY shipped surface depends on ONE line in `app.ts`
 * passing `process.env`. A writer whose wiring is silently absent fails silent —
 * claims would simply record no `session_id` and the anchor mutex would degrade to
 * the retired same-actor proxy while every unit test stayed green. This file
 * exercises the REAL `createApp` composition root over a REAL SQLite corpus, so
 * dropping that argument (in either composition root) turns red here.
 *
 * bun test (not vitest): `createApp` pulls in `bun:sqlite`.
 *
 * ⛔ Never touches the repo's own `.lore/` corpus — every case runs inside its own
 * `mkdtempSync` directory (project CLAUDE.md hard rule).
 *
 * Coverage dimensions:
 *   HAPPY      — a claim through the wired app records `extra.claim.session_id`
 *                (the sanitized 8-char discriminator of $CLAUDE_CODE_SESSION_ID)
 *   STATE      — the observed two-orchestrator topology: ONE actor string, ONE
 *                checkout, TWO session ids → `deriveSessions` reports TWO sessions
 *                and the second overlapping claim is REFUSED; the same-session
 *                control is PERMITTED (so the refusal is not a blanket refuse)
 *   NEGATIVE   — with NO session env at all, a same-actor overlap is refused with
 *                the explicit not-measured marker, never permitted
 *   BOUNDARY   — $CLAUDE_SESSION_ID is honored as the fallback variable name
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { createApp } from "../../src/app.js";
import type { App } from "../../src/app.js";
import type { CreateDocInput, DocRecord, TaskClaim } from "@lore/core";
import { liveAmbient, liveWriteContext } from "../live-invocation.js";

const ORCHESTRATOR = "agent:main-orchestrator";
const SHARED_ANCHOR = "packages/core/src/session.ts";

let tmpDir: string;
let originalCwd: string;
const SESSION_ENV_VARS = ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"] as const;
const originalSessionEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of SESSION_ENV_VARS) originalSessionEnv.set(name, process.env[name]);
  tmpDir = resolve(mkdtempSync(join(tmpdir(), "lore-claim-session-wiring-")));
  mkdirSync(join(tmpDir, ".lore"), { recursive: true });
  const app = createApp(dbPath(), undefined, liveAmbient(), liveWriteContext()) as App;
  app.close();
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  for (const name of SESSION_ENV_VARS) {
    const original = originalSessionEnv.get(name);
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
  process.chdir(originalCwd);
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function dbPath(): string {
  return join(tmpDir, ".lore", "lore.db");
}

function setSessionEnv(variable: (typeof SESSION_ENV_VARS)[number] | null, value?: string): void {
  for (const name of SESSION_ENV_VARS) delete process.env[name];
  if (variable !== null && value !== undefined) process.env[variable] = value;
}

/**
 * One "session": a freshly-constructed app, which re-reads `process.env` through
 * `app.ts`'s wiring — exactly how two concurrently-live orchestrator processes in
 * ONE checkout differ from each other.
 */
async function withApp<T>(fn: (app: App) => Promise<T>): Promise<T> {
  // reason: `createApp(dbPath)` with no config always returns a bare `App` (the
  // `Result<App>` arm exists only for the sync-enabled TursoStore path, D-007) —
  // the same single-argument narrowing every other integration bun test relies on.
  const app = createApp(dbPath(), undefined, liveAmbient(), liveWriteContext()) as App;
  try {
    return await fn(app);
  } finally {
    app.close();
  }
}

async function createPlanWithTasks(anchorsPerTask: string[][]): Promise<{ planId: string; taskIds: string[] }> {
  return withApp(async (app) => {
    const plan = await app.corpusService.create({
      type: "plan",
      title: "Session Capture Wiring Plan",
      content: "# Plan",
    } as CreateDocInput);
    if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
    const taskIds: string[] = [];
    for (const [index, anchors] of anchorsPerTask.entries()) {
      const task = await app.corpusService.create({
        type: "task",
        title: `Session Capture Task ${index + 1}`,
        parent_id: plan.value.id,
        content: "# Task",
        extra: { plan_id: plan.value.id, file_anchors: anchors },
      } as CreateDocInput);
      if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
      taskIds.push(task.value.id);
    }
    return { planId: plan.value.id, taskIds };
  });
}

function readClaim(doc: DocRecord): TaskClaim | undefined {
  return doc.extra["claim"] as TaskClaim | undefined;
}

async function fetchTask(id: string): Promise<DocRecord> {
  return withApp(async (app) => {
    const result = await app.corpusService.get(id);
    if (!result.ok) throw new Error(`get failed: ${JSON.stringify(result.error)}`);
    return result.value.doc;
  });
}

describe("createApp wiring — claim-time session capture (app.ts passes process.env)", () => {
  it("HAPPY: a claim through the wired app records the sanitized session discriminator", async () => {
    const { taskIds } = await createPlanWithTasks([[SHARED_ANCHOR]]);
    setSessionEnv("CLAUDE_CODE_SESSION_ID", "3DE02220-5d69-4b5a-ac23-d66e14c0261b");

    const claimed = await withApp((app) => app.taskWorkflowService.claim(taskIds[0]!, { by: ORCHESTRATOR }));
    expect(claimed.ok).toBe(true);

    const claim = readClaim(await fetchTask(taskIds[0]!));
    expect(claim?.by).toBe(ORCHESTRATOR);
    expect(claim?.session_id).toBe("3de02220");
  });

  it("BOUNDARY: $CLAUDE_SESSION_ID is honored when $CLAUDE_CODE_SESSION_ID is unset", async () => {
    const { taskIds } = await createPlanWithTasks([[SHARED_ANCHOR]]);
    setSessionEnv("CLAUDE_SESSION_ID", "7ab19c04-fallback");

    const claimed = await withApp((app) => app.taskWorkflowService.claim(taskIds[0]!, { by: ORCHESTRATOR }));
    expect(claimed.ok).toBe(true);
    expect(readClaim(await fetchTask(taskIds[0]!))?.session_id).toBe("7ab19c04");
  });

  it("STATE: two sessions, one actor, one checkout — the overlapping claim is REFUSED, the same-session control PASSES, and ready() reports TWO sessions", async () => {
    // Task 3 declares a DISJOINT anchor so the second session can legitimately hold a
    // claim at the same time — which is what makes the two-session `ready()` assertion
    // below reachable without hand-seeding a claim the gate would refuse.
    const { planId, taskIds } = await createPlanWithTasks([
      [SHARED_ANCHOR],
      [SHARED_ANCHOR],
      ["packages/lore/src/adapters/http/routes.ts"],
    ]);

    setSessionEnv("CLAUDE_CODE_SESSION_ID", "3de02220-first");
    const first = await withApp((app) => app.taskWorkflowService.claim(taskIds[0]!, { by: ORCHESTRATOR }));
    expect(first.ok).toBe(true);

    // A SECOND live orchestrator: identical actor string, identical checkout, its
    // own session id — the exact measured topology of the defect.
    setSessionEnv("CLAUDE_CODE_SESSION_ID", "7ab19c04-second");
    const overlapping = await withApp((app) => app.taskWorkflowService.claim(taskIds[1]!, { by: ORCHESTRATOR }));
    expect(overlapping.ok).toBe(false);
    if (!overlapping.ok) {
      expect((overlapping.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");
    }

    // The same second session CAN hold a disjoint-anchor task — the mutex is about
    // overlapping files, not about the session existing.
    const disjoint = await withApp((app) => app.taskWorkflowService.claim(taskIds[2]!, { by: ORCHESTRATOR }));
    expect(disjoint.ok).toBe(true);

    // `lore ready`'s derived session registry now sees BOTH live sessions under the
    // ONE mandated actor string — pre-fix this reported a single session, which is how
    // an orchestrator came to read a too-short `active_sessions` and remove a live
    // agent's worktree.
    const report = await withApp((app) => app.taskWorkflowService.ready(planId));
    expect(report.ok).toBe(true);
    if (report.ok) {
      expect(report.value.sessions).toHaveLength(2);
      expect(report.value.sessions.map((s) => s.session_id).sort()).toEqual(["3de02220", "7ab19c04"]);
      expect(new Set(report.value.sessions.map((s) => s.by))).toEqual(new Set([ORCHESTRATOR]));
    }

    // CONTROL — the FIRST session claiming the overlapping task IS permitted, so the
    // refusal above is session-scoped rather than a blanket refuse.
    setSessionEnv("CLAUDE_CODE_SESSION_ID", "3de02220-first");
    const sameSession = await withApp((app) => app.taskWorkflowService.claim(taskIds[1]!, { by: ORCHESTRATOR }));
    expect(sameSession.ok).toBe(true);
    expect(readClaim(await fetchTask(taskIds[1]!))?.session_id).toBe("3de02220");
  });

  it("NEGATIVE: with NO session env, a same-actor overlap is refused as not-measured — never permitted", async () => {
    const { taskIds } = await createPlanWithTasks([[SHARED_ANCHOR], [SHARED_ANCHOR]]);
    setSessionEnv(null);

    const first = await withApp((app) => app.taskWorkflowService.claim(taskIds[0]!, { by: ORCHESTRATOR }));
    expect(first.ok).toBe(true);
    expect(readClaim(await fetchTask(taskIds[0]!))?.session_id).toBeUndefined();

    const second = await withApp((app) => app.taskWorkflowService.claim(taskIds[1]!, { by: ORCHESTRATOR }));
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect((second.error as { field?: string }).field).toBe("gate:task-claim:anchor-overlap");
      expect(JSON.stringify(second.error)).toContain("ANCHOR_OVERLAP_SESSION_UNMEASURED");
    }
  });
});
