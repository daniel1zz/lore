/**
 * Fixture-only helper — seeds the full SPEC-077 `/execution` page fixture directly
 * via the service layer (`CorpusService` + `TaskWorkflowService`), bypassing the
 * CLI/HTTP/dashboard-UI surfaces entirely. Mirrors `seed-judgment.ts`'s pattern:
 * run as a separate `bun` process (not imported into the Playwright test process)
 * against the SAME SQLite file the running `lore serve` process has open, so its
 * `bun:sqlite` handle opens/writes/closes before the browser test proceeds — no
 * shared-handle races with the server (WAL mode, server reopens per statement).
 *
 * Why this exists (three things no CLI flag / dashboard-UI action can produce):
 *   - a plan promoted all the way to `status: "active"` — `ExecutionPage`'s plan
 *     selector only lists `apiList({type:"plan", status:"active"})` (a fresh
 *     `lore create plan` starts at `draft`; getting to `active` needs two chained
 *     status transitions, `draft -> approved -> active`, which no single dashboard
 *     write action or CLI flag does for a fixture in one step)
 *   - a `phase`-typed doc — SPEC-056's `phase` doc type is migration-created only
 *     per the CLI's own `VALID_TYPES` allowlist (`adapters/cli/commands/create.ts`);
 *     the SERVICE layer places no such restriction, exactly as documented in
 *     `packages/lore/tests/http/phase-status.bun.test.ts`'s own header comment
 *   - a FRESH claim on one task — only `lore claim` (CLI) or a direct
 *     `TaskWorkflowService.claim` call can acquire one; no dashboard UI does
 *
 * Plain task creation and plan status transitions COULD go through the CLI/HTTP
 * individually, but folding everything into one script keeps the fixture a single
 * atomic seed step (one `bun` process, one JSON line out) instead of six separate
 * process spawns.
 *
 * Anchor-conflict shape (SPEC-042 D7, `TaskWorkflowService`'s private
 * `computeAnchorAdvisories`): task B declares the SAME `file_anchors` path as task
 * A and needs NO claim of its own — the conflict fires because task B's declared
 * anchor overlaps task A's FRESH claim held by a DIFFERENT actor. This also means
 * task A's single claim alone produces both the "1 ready task row with a claim
 * badge" fixture requirement AND the "1 session row" requirement (a session is
 * just a group of fresh claims by `(by, machine, worktree)` — one claim, one
 * session) — a second claimed task is not needed for AC-077-5's assertions.
 *
 * Usage: bun seed-execution-fixture.ts <dbPath> <runId>
 * Prints one JSON line with every id/slug/title the test needs to reference.
 */
import { RecordLockService } from "../../../lore/src/service/record-lock-service.js";
import { GateEnforcer } from "../../../lore/src/service/gate-enforcer.js";
import { SQLiteStore } from "../../../lore/src/store/sqlite-store.js";
import { declareWriteActorForTests } from "../../../lore/src/store/write-context-store.js";
import { CorpusService } from "../../../lore/src/service/corpus-service.js";
import { TaskWorkflowService } from "../../../lore/src/service/task-workflow-service.js";
import { createRealWorktreeProbe } from "../../../lore/src/service/worktree-cleanup.js";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";

async function unwrap<T>(promise: Promise<Result<T, LoreError>>, label: string): Promise<T> {
  const result = await promise;
  if (!result.ok) {
    throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

async function main(): Promise<void> {
  const dbPath = process.argv[2];
  const runId = process.argv[3];
  if (dbPath === undefined || runId === undefined) {
    throw new Error("Usage: bun seed-execution-fixture.ts <dbPath> <runId>");
  }

  // reason: a fixed seeding author — this fixture script is its own entry and reads nothing from the process.
  const store = declareWriteActorForTests(new SQLiteStore(dbPath), "e2e-seed");
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflow = new TaskWorkflowService(
    store,
    undefined,
    { claimTtlMinutes: 120 },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createRealWorktreeProbe(process.cwd()),
  );

  const planTitle = `E2E Execution Plan ${runId}`;
  // reason: BR-709 - a plan is refused without a parent, so it is filed under a fixture PRD.
  const prd = await unwrap(
    corpus.create({ type: "prd", title: `E2E Execution PRD ${runId}`, content: "## Overview\n\nSPEC-077 fixture root." } as CreateDocInput),
    "create prd",
  );
  const plan = await unwrap(
    corpus.create({
      type: "plan",
      title: planTitle,
      parent_id: prd.id,
      content: "## Plan\n\nSPEC-077 execution-page e2e fixture.",
    } as CreateDocInput),
    "create plan",
  );
  await unwrap(corpus.set(plan.id, { status: "approved" }), "promote plan to approved");
  const activePlan: DocRecord = await unwrap(corpus.set(plan.id, { status: "active" }), "promote plan to active");

  const anchorPath = `src/e2e-fixture-${runId}.ts`;

  const taskATitle = `E2E Ready Task A ${runId}`;
  const taskA = await unwrap(
    corpus.create({
      type: "task",
      title: taskATitle,
      parent_id: activePlan.id,
      content: "## Task A",
      extra: { plan_id: activePlan.id, file_anchors: [anchorPath] },
    } as CreateDocInput),
    "create task A",
  );

  const taskBTitle = `E2E Conflict Task B ${runId}`;
  const taskB = await unwrap(
    corpus.create({
      type: "task",
      title: taskBTitle,
      parent_id: activePlan.id,
      content: "## Task B",
      extra: { plan_id: activePlan.id, file_anchors: [anchorPath] },
    } as CreateDocInput),
    "create task B",
  );

  const actorA = `e2e-holder-a-${runId}`;
  await unwrap(
    taskWorkflow.claim(taskA.id, { by: actorA, machine: "e2e-machine", worktree: "e2e-worktree" }),
    "claim task A",
  );

  const phaseTitle = `E2E Phase ${runId}`;
  const phase = await unwrap(
    corpus.create({
      type: "phase",
      title: phaseTitle,
      parent_id: activePlan.id,
      content: "## Phase",
      extra: { plan_id: activePlan.id },
    } as CreateDocInput),
    "create phase",
  );

  console.log(
    JSON.stringify({
      planId: activePlan.id,
      planSlug: activePlan.slug,
      planTitle,
      taskAId: taskA.id,
      taskATitle,
      taskBId: taskB.id,
      taskBTitle,
      phaseId: phase.id,
      phaseTitle,
      actorA,
    }),
  );
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
  process.exit(1);
});
