// @layer service-corpus
/**
 * AC-HC-1 — a write that changes only working-state keys bumps docs.version by 1, adds NO versions row and exactly
 * one audit row whose details.state_change names the key (spec-history-records-content-a-working-state-only-write-adds-no).
 *
 * Runs on SQLite, Turso (local file) and InMemory. Throwaway corpora only (mkdtemp), never the repo's `.lore/`.
 *
 *   HAPPY:      each working-state key of task / phase / plan / spec / knowledge / prd: 0 rows, +1 version, 1 audit row
 *   STATE:      evidence append records only the new entry; landing replace records values + previous; release records
 *               removed + previous.claim; replay from the create row reproduces claim / evidence / landing
 *   BOUNDARY:   a review judgment's doc_version with no versions row resolves to the closest earlier row
 *   NEGATIVE:   a content write (title) still adds a row; a write at the old version is refused STALE_VERSION
 */

import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput, DocRecord, DocType, StateChange } from "@lore/core";
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { TaskWorkflowService } from "../../src/service/task-workflow-service.js";
import { VersionService } from "../../src/service/version-service.js";
import { SQLiteStore } from "../../src/store/sqlite-store.js";
import { TursoStore } from "../../src/store/turso-store.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import type { StoreInterface } from "../../src/store/store-interface.js";
import { actedStore } from "../live-invocation.js";
import { runOfName } from "../helpers/test-run-identity.js";

const scratch: string[] = [];
const closers: Array<() => void> = [];
afterAll(() => {
  for (const close of closers.splice(0)) close();
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

type Kind = "sqlite" | "turso" | "memory";

function openStore(kind: Kind): StoreInterface {
  if (kind === "memory") return actedStore(new InMemoryStore());
  const dir = mkdtempSync(join(tmpdir(), "lore-hc1-"));
  scratch.push(dir);
  const dbPath = join(dir, "corpus.db");
  const raw = kind === "sqlite" ? new SQLiteStore(dbPath) : new TursoStore({ localPath: dbPath });
  closers.push(() => raw.close());
  return actedStore(raw);
}

function compose(kind: Kind) {
  const store = openStore(kind);
  const recordLock = new RecordLockService(store, new GateEnforcer(undefined));
  const corpus = new CorpusService(store, recordLock);
  const tasks = new TaskWorkflowService(store, undefined as never, { claimTtlMinutes: 120 });
  const versions = new VersionService(store, recordLock, corpus);
  return { store, corpus, tasks, versions };
}

async function create(corpus: CorpusService, input: Record<string, unknown>): Promise<DocRecord> {
  const r = await corpus.create(input as CreateDocInput);
  if (!r.ok) throw new Error(`create failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

async function reload(store: StoreInterface, id: string): Promise<DocRecord> {
  const r = await store.find(id as never);
  if (!r.ok || r.value === null) throw new Error(`reload failed ${id}`);
  return r.value;
}

async function versionRows(store: StoreInterface, id: string) {
  const r = await store.findVersions(id as never);
  if (!r.ok) throw new Error("findVersions failed");
  return r.value;
}

async function auditRows(store: StoreInterface, id: string) {
  const r = await store.queryAudit({ doc_id: id as never, limit: 500 });
  if (!r.ok) throw new Error("queryAudit failed");
  return [...r.value].reverse(); // oldest first
}

function stateChangeOf(entry: { details?: unknown }): StateChange | undefined {
  return (entry.details as { state_change?: StateChange } | undefined)?.state_change;
}

interface KeyCase {
  readonly type: DocType;
  readonly key: string;
  readonly value: unknown;
  readonly input: (parentId: string) => Record<string, unknown>;
}

const CASES: readonly KeyCase[] = [
  { type: "task", key: "claim", value: { by: "agent:x", at: "2026-10-26T00:00:00.000Z" }, input: (p) => ({ type: "task", title: "T", parent_id: p, content: "b", extra: { plan_id: p } }) },
  { type: "task", key: "verification_evidence", value: [{ oracle: "manual", command: "c", result: "pass" }], input: (p) => ({ type: "task", title: "T", parent_id: p, content: "b", extra: { plan_id: p } }) },
  { type: "task", key: "landing", value: { branch: "b", commit: "abc" }, input: (p) => ({ type: "task", title: "T", parent_id: p, content: "b", extra: { plan_id: p } }) },
  { type: "phase", key: "checklist", value: [{ text: "item", done: true }], input: (p) => ({ type: "phase", title: "P", parent_id: p, content: "b", extra: { plan_id: p } }) },
  { type: "plan", key: "progress", value: { done: 1, total: 2 }, input: () => ({ type: "plan", title: "Pl", content: "b" }) },
  { type: "spec", key: "code_anchors", value: ["a.ts"], input: () => ({ type: "spec", title: "S", content: "b" }) },
  { type: "knowledge", key: "code_anchors", value: ["a.ts"], input: () => ({ type: "knowledge", title: "K", content: "b", extra: { sub_type: "reference" } }) },
  { type: "prd", key: "outline_budget", value: { max: 5 }, input: () => ({ type: "prd", title: "Pr", content: "b" }) },
];

for (const kind of ["sqlite", "turso", "memory"] as const) {
  describe(`AC-HC-1 working-state-only writes on ${kind}`, () => {
    for (const c of CASES) {
      it(`${c.type}.${c.key}: +1 version, 0 versions rows, 1 audit row naming the key`, async () => {
        const { store, corpus } = compose(kind);
        const parent = c.type === "task" || c.type === "phase" ? (await create(corpus, { type: "plan", title: "Plan", content: "b" })).id : "";
        const doc = await create(corpus, c.input(parent));
        const rowsBefore = (await versionRows(store, doc.id)).length;
        const auditBefore = (await auditRows(store, doc.id)).length;

        const set = await corpus.set(doc.id, { extra: { ...doc.extra, [c.key]: c.value } });
        if (!set.ok) throw new Error(`set failed: ${JSON.stringify(set.error)}`);

        const after = await reload(store, doc.id);
        expect(after.version).toBe(doc.version + 1);
        expect(await versionRows(store, doc.id)).toHaveLength(rowsBefore);
        const audit = await auditRows(store, doc.id);
        expect(audit).toHaveLength(auditBefore + 1);
        expect(stateChangeOf(audit[audit.length - 1]!)?.keys).toEqual([c.key]);
      });
    }

    it("NEGATIVE: a title change still adds a versions row and no state_change", async () => {
      const { store, corpus } = compose(kind);
      const plan = await create(corpus, { type: "plan", title: "Plan", content: "b" });
      const before = (await versionRows(store, plan.id)).length;
      const r = await corpus.set(plan.id, { title: "Renamed" });
      expect(r.ok).toBe(true);
      expect(await versionRows(store, plan.id)).toHaveLength(before + 1);
      const audit = await auditRows(store, plan.id);
      expect(stateChangeOf(audit[audit.length - 1]!)).toBeUndefined();
    });

    it("STATE: evidence append, landing replace, release; replay from the create row reproduces the final state", async () => {
      const { store, corpus, tasks, versions } = compose(kind);
      const plan = await create(corpus, { type: "plan", title: "Plan", content: "b" });
      const task = await create(corpus, { type: "task", title: "T", parent_id: plan.id, content: "b", extra: { plan_id: plan.id } });
      const createRow = (await versionRows(store, task.id)).find((v) => v.action === "create")!;
      const rowsAtStart = (await versionRows(store, task.id)).length;

      const evidence = (command: string) => ({
        oracle: "manual" as const,
        command,
        result: "pass" as const,
        recorded_by: "alice",
        output_tail: "captured output",
        capture_source: "self-report" as const,
      });
      expect((await tasks.claim(task.id, { by: "alice", harnessRun: runOfName("alice") })).ok).toBe(true);
      expect((await tasks.addEvidence(task.id, evidence("first"))).ok).toBe(true);
      expect((await tasks.addEvidence(task.id, evidence("second"))).ok).toBe(true);
      const mid = await reload(store, task.id);
      expect((await corpus.set(task.id, { extra: { ...mid.extra, landing: { branch: "b1" } } })).ok).toBe(true);
      const mid2 = await reload(store, task.id);
      expect((await corpus.set(task.id, { extra: { ...mid2.extra, landing: { branch: "b2" } } })).ok).toBe(true);
      expect((await tasks.release(task.id, { by: "alice", harnessRun: runOfName("alice") })).ok).toBe(true);

      expect(await versionRows(store, task.id)).toHaveLength(rowsAtStart);
      const audit = await auditRows(store, task.id);
      const changes = audit.map(stateChangeOf).filter((s): s is StateChange => s !== undefined);
      expect(changes).toHaveLength(6);

      const evidenceAppends = changes.filter((s) => s.appended["verification_evidence"] !== undefined);
      expect(evidenceAppends).toHaveLength(1); // the first entry creates the key (values), the second appends
      expect(evidenceAppends[0]!.appended["verification_evidence"]).toHaveLength(1);
      const landingReplace = changes.find((s) => s.keys.includes("landing") && s.previous["landing"] !== undefined)!;
      expect(landingReplace.values["landing"]).toEqual({ branch: "b2" });
      expect(landingReplace.previous["landing"]).toEqual({ branch: "b1" });
      const releaseChange = changes[changes.length - 1]!;
      expect(releaseChange.removed).toEqual(["claim"]);
      expect((releaseChange.previous["claim"] as { by: string }).by).toBe("alice");

      // replay
      const replay: Record<string, unknown> = { ...createRow.extra };
      for (const s of changes) {
        for (const [k, v] of Object.entries(s.values)) replay[k] = v;
        for (const [k, add] of Object.entries(s.appended)) replay[k] = [...((replay[k] as unknown[] | undefined) ?? []), ...add];
        for (const k of s.removed) delete replay[k];
      }
      const final = await reload(store, task.id);
      for (const k of ["claim", "verification_evidence", "landing"]) expect(replay[k]).toEqual(final.extra[k]);

      // BOUNDARY: version numbers with no row resolve to the closest earlier row
      expect(final.version).toBeGreaterThan(rowsAtStart);
      const resolved = await versions.resolveClosestEarlierRow(task.id as never, final.version);
      expect(resolved.ok && resolved.value.version).toBe(createRow.version);
      const none = await versions.resolveClosestEarlierRow(task.id as never, 0);
      expect(none.ok).toBe(false);

      // NEGATIVE: STALE_VERSION for a second writer on the old version
      const stale = await corpus.set(task.id, { title: "late" }, { expectedVersion: createRow.version });
      expect(stale.ok).toBe(false);
      if (!stale.ok) expect(stale.error.code).toBe("STALE_VERSION");
    });
  });
}
