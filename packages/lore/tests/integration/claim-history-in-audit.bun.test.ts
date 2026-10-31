// @layer service-task-workflow
/**
 * AC-HC-10 — a claim steal and a forced release are recorded in the audit trail, not in a versions row
 * (spec-history-records-content-a-working-state-only-write-adds-no).
 *
 *   HAPPY:    A claims, B steals: one audit row with previous.claim naming A and values.claim naming B; no versions row
 *   STATE:    C force-releases with a reason: removed ['claim'], previous.claim naming B, the reason in the same row
 *   REGRESSION: the audit query for the task returns both rows
 * Runs on SQLite, Turso (local file) and InMemory; throwaway corpora only.
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput, StateChange } from "@lore/core";
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { TaskWorkflowService } from "../../src/service/task-workflow-service.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { TursoStore } from "../../src/store/turso-store.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import type { StoreInterface } from "../../src/store/store-interface.js";
import { actedStore } from "../live-invocation.js";
import { runOfName } from "../helpers/test-run-identity.js";

import { fakeWorktreeProbe } from "../helpers/fake-worktree-probe.js";
import { ensureRequirementsDocId } from "../helpers/parented-create.js";
const scratch: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => {
  for (const close of closers.splice(0)) close();
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

function openStore(kind: "sqlite" | "turso" | "memory"): StoreInterface {
  if (kind === "memory") return actedStore(new InMemoryStore());
  const dir = mkdtempSync(join(tmpdir(), "lore-hc10-"));
  scratch.push(dir);
  const dbPath = join(dir, "corpus.db");
  const raw = kind === "sqlite" ? new SQLiteStore(dbPath) : new TursoStore({ localPath: dbPath });
  closers.push(() => raw.close());
  return actedStore(raw);
}

for (const kind of ["sqlite", "turso", "memory"] as const) {
  describe(`AC-HC-10 claim history in audit on ${kind}`, () => {
    it("steal and forced release each add one audit row with the delta and no versions row", async () => {
      const store = openStore(kind);
      const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
      const tasks = new TaskWorkflowService(store, undefined as never, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
      const plan = await corpus.create({ parent_id: await ensureRequirementsDocId(corpus), type: "plan", title: "Plan", content: "b" } as CreateDocInput);
      if (!plan.ok) throw new Error("plan");
      const created = await corpus.create({ type: "task", title: "T", parent_id: plan.value.id, content: "b", extra: { kind: "code", plan_id: plan.value.id } } as CreateDocInput);
      if (!created.ok) throw new Error("task");
      const id = created.value.id;
      const rowsBefore = (await store.findVersions(id)).ok ? ((await store.findVersions(id)) as { value: unknown[] }).value.length : -1;

      expect((await tasks.claim(id, { by: "run-a", harnessRun: runOfName("run-a") })).ok).toBe(true);
      expect((await tasks.claim(id, { by: "run-b", harnessRun: runOfName("run-b"), steal: true })).ok).toBe(true);
      expect((await tasks.release(id, { by: "run-c", harnessRun: runOfName("run-c"), force: true, reason: "worker vanished" })).ok).toBe(true);

      const versions = await store.findVersions(id);
      expect(versions.ok && versions.value.length).toBe(rowsBefore);

      const audit = await store.queryAudit({ doc_id: id, limit: 100 });
      if (!audit.ok) throw new Error("audit");
      // reason: queryAudit orders by timestamp DESC and same-millisecond rows tie; details.version (SPEC-035 §2) orders them.
      const versionOf = (e: { details?: unknown }): number => (e.details as { version?: number } | undefined)?.version ?? 0;
      const withDelta = [...audit.value].sort((a, b) => versionOf(a) - versionOf(b)).filter((e) => (e.details as { state_change?: unknown } | undefined)?.state_change !== undefined);
      expect(withDelta).toHaveLength(3); // claim, steal, forced release

      const steal = withDelta[1]!;
      const stealChange = (steal.details as { state_change: StateChange }).state_change;
      expect((stealChange.previous["claim"] as { by: string }).by).toBe("run-a");
      expect((stealChange.values["claim"] as { by: string }).by).toBe("run-b");

      const release = withDelta[2]!;
      const releaseChange = (release.details as { state_change: StateChange }).state_change;
      expect(releaseChange.removed).toEqual(["claim"]);
      expect((releaseChange.previous["claim"] as { by: string }).by).toBe("run-b");
      expect(JSON.stringify(release.details)).toContain("worker vanished");
    });
  });
}
