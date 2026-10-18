/**
 * Shared fixture world for the rule change-set tests (rule-change-set.test.ts, rule-snapshot-views.test.ts).
 * Not a test file: it builds an InMemoryStore with one armed branch, one leaf carrying a live BR-1,
 * and the services a change set touches. Spec: spec-a-spec-carries-its-rule-changes-the-baseline-takes-them.
 */

import { ulid } from "ulidx";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocId, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import { RuleReadService } from "../../../src/service/rule-read-service.js";
import { ImpactService } from "../../../src/service/impact-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { RuleChangeService } from "../../../src/service/rule-change-service.js";
import { actedStore } from "../../live-invocation.js";

export interface World {
  readonly store: InMemoryStore;
  readonly corpus: CorpusService;
  readonly rules: RuleService;
  readonly changes: RuleChangeService;
  readonly read: RuleReadService;
  readonly impact: ImpactService;
  /** AcService with the citation gate ENFORCING on branch `branch-a`. */
  readonly ac: AcService;
  readonly leafId: DocId;
  readonly leafSlug: string;
}

async function insertBaseline(store: InMemoryStore, slug: string, extra: Record<string, unknown>, parentId: DocId | null): Promise<DocId> {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc: DocRecord = {
    id,
    slug,
    type: "baseline",
    role: DOC_TYPE_ROLE_MAP.baseline,
    title: slug,
    status: "draft",
    priority: "medium",
    content: slug,
    parent_id: parentId,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra,
  };
  const inserted = await store.insert(doc);
  if (!inserted.ok) throw new Error(`baseline insert failed: ${JSON.stringify(inserted.error)}`);
  return id;
}

/** Build the world: branch-a (armed) > leaf-a holding the live rule BR-1. */
export async function makeWorld(): Promise<World> {
  const store = actedStore(new InMemoryStore());
  const lock = new RecordLockService(store, new GateEnforcer(undefined));
  const corpus = new CorpusService(store, lock);
  const rules = new RuleService(store, corpus.create.bind(corpus));
  const changes = new RuleChangeService(store, lock);
  corpus.setRuleChangeLanding(changes);
  const branchId = await insertBaseline(store, "branch-a", { node: "branch", label: "A" }, null);
  const leafId = await insertBaseline(store, "leaf-a", { node: "leaf", label: "A leaf" }, branchId);
  const seeded = await rules.addRule(
    "leaf-a",
    { statement: "A live rule that already describes the product", confidence: "established", enforced_by: "both", examples: ["e1"] },
    { by: "test" },
  );
  if (!seeded.ok || seeded.value.ruleId !== "BR-1") throw new Error(`seed rule failed: ${JSON.stringify(seeded)}`);
  return {
    store,
    corpus,
    rules,
    changes,
    read: new RuleReadService(store),
    impact: new ImpactService(store),
    ac: new AcService(store, lock, { citeGate: { mode: "enforce", armed_branches: ["branch-a"] } }),
    leafId,
    leafSlug: "leaf-a",
  };
}

/** Create a draft spec through the corpus; returns its record. */
export async function makeSpec(world: World, title: string): Promise<DocRecord> {
  const created = await world.corpus.create({ type: "spec", title, content: "body" });
  if (!created.ok) throw new Error(`spec create failed: ${JSON.stringify(created.error)}`);
  return created.value;
}

export const scriptCriterion = (id: string, cites: string[]) => ({
  id,
  statement: `Does the thing ${id}`,
  verify: { mode: "script", oracle: "test", command: "bunx vitest run x.test.ts" },
  cites,
});

export async function reload(world: World, id: string): Promise<DocRecord> {
  const found = await world.store.find(id as DocId);
  if (!found.ok || found.value === null) throw new Error(`doc ${id} vanished`);
  return found.value;
}

/** Approve a spec and give it one evidence row so it is a LOCKED record (BR-1047). */
export async function lockSpec(world: World, spec: DocRecord): Promise<void> {
  const current = await reload(world, spec.id);
  const next = current.version + 1;
  const updated = await world.store.update(spec.id, { status: "approved", version: next }, { expected_version: current.version });
  if (!updated.ok) throw new Error("approve failed");
  const version = await world.store.insertVersion({
    doc_id: spec.id,
    version: next,
    content: updated.value.content,
    extra: updated.value.extra,
    status: "approved",
    title: updated.value.title,
    action: "update",
    created_at: new Date().toISOString(),
    created_by: "tester",
    slug: updated.value.slug,
  });
  if (!version.ok) throw new Error("insertVersion failed");
  const plan = await world.corpus.create({ type: "plan", title: `Plan of ${spec.slug}`, parent_id: spec.id, content: "plan" });
  if (!plan.ok) throw new Error("plan create failed");
  const task = await world.corpus.create({ type: "task", title: `Task of ${spec.slug}`, parent_id: plan.value.id, content: "t", extra: { plan_id: plan.value.id } });
  if (!task.ok) throw new Error("task create failed");
  const evidenced = await world.store.update(task.value.id, {
    extra: {
      ...task.value.extra,
      verification_evidence: [
        { oracle: "test", command: "x", result: "pass", recorded_at: new Date().toISOString(), recorded_by: "tester", ac_ref: "AC-1" },
      ],
    },
  });
  if (!evidenced.ok) throw new Error("evidence write failed");
}
