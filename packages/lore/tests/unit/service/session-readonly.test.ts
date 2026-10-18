/**
 * Tests for SessionService's read-only invariant (SPEC-041 §4 AC-SL-2).
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   STATE: wraps a StoreInterface in a counting Proxy that intercepts exactly the 9
 *          mutating methods (insert/update/softDelete/addLink/removeLink/
 *          insertVersion/appendAuditEntry/insertJudgment/insertCalibrationRecord)
 *          and asserts `bootstrap`/`resume` invoke NONE of them, ever — proving these
 *          two methods are truly read-only rather than merely documented as such.
 *
 * @spec_ref SPEC-041 §4 AC-SL-2
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import type { CreateDocInput } from "@lore/core";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import { actedStore } from "../../live-invocation.js";

const MUTATING_METHODS = [
  "insert",
  "update",
  "softDelete",
  "addLink",
  "removeLink",
  "insertVersion",
  "appendAuditEntry",
  "insertJudgment",
  "insertCalibrationRecord",
] as const;

function countingProxy(store: StoreInterface): { proxy: StoreInterface; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const name of MUTATING_METHODS) counts[name] = 0;

  const proxy = new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof prop === "string" && (MUTATING_METHODS as readonly string[]).includes(prop)) {
        return (...args: unknown[]) => {
          counts[prop] = (counts[prop] ?? 0) + 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  });

  return { proxy: proxy as StoreInterface, counts };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput) {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function seedCorpus(store: InMemoryStore) {
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });

  await mustCreate(corpusService, { type: "prd", title: "Root PRD", content: "# Root" } as CreateDocInput);
  const plan = await mustCreate(corpusService, { type: "plan", title: "Plan", content: "# Plan" } as CreateDocInput);
  const task = await mustCreate(corpusService, {
    type: "task",
    title: "Task",
    parent_id: plan.id,
    content: "# Task",
    extra: { plan_id: plan.id },
  } as CreateDocInput);
  const claimed = await store.update(task.id, {
    extra: { plan_id: plan.id, claim: { by: "alice", at: "2026-07-10T00:00:00.000Z" } },
  });
  if (!claimed.ok) throw new Error(JSON.stringify(claimed.error));

  await mustCreate(corpusService, {
    type: "knowledge",
    title: "Draft note",
    content: "# Draft",
    extra: { sub_type: "reference" },
  } as CreateDocInput);

  const handoffResult = await sessionService.writeHandoff({
    by: "alice",
    plan_ref: plan.slug,
    task_refs: [],
    modified_files: [],
    key_decisions: [],
    next_steps: ["continue"],
  });
  if (!handoffResult.ok) throw new Error(JSON.stringify(handoffResult.error));

  return { planSlug: plan.slug };
}

describe("SessionService — read-only invariant (AC-SL-2)", () => {
  it("bootstrap() performs zero store mutations", async () => {
    const rawStore = actedStore(new InMemoryStore());
    await seedCorpus(rawStore);

    const { proxy, counts } = countingProxy(rawStore);
    const wrappedSessionService = new SessionService(proxy, {
      claimTtlMinutes: 120,
      handoffTtlMinutes: 10080,
      // reason: bootstrap never calls createHandoffDoc; a throwing stub proves it.
      createHandoffDoc: () => {
        throw new Error("bootstrap must never call createHandoffDoc");
      },
    });

    const result = await wrappedSessionService.bootstrap("alice");
    expect(result.ok).toBe(true);

    for (const name of MUTATING_METHODS) {
      expect(counts[name]).toBe(0);
    }
  });

  it("resume() performs zero store mutations", async () => {
    const rawStore = actedStore(new InMemoryStore());
    await seedCorpus(rawStore);

    const { proxy, counts } = countingProxy(rawStore);
    const wrappedSessionService = new SessionService(proxy, {
      claimTtlMinutes: 120,
      handoffTtlMinutes: 10080,
      createHandoffDoc: () => {
        throw new Error("resume must never call createHandoffDoc");
      },
    });

    const result = await wrappedSessionService.resume({});
    expect(result.ok).toBe(true);

    for (const name of MUTATING_METHODS) {
      expect(counts[name]).toBe(0);
    }
  });
});
