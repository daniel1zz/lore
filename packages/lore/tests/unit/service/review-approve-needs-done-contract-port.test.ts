/**
 * review-approve-needs-done-contract-port.test.ts — a ReviewService with no done-contract port refuses to approve a task
 * (D43: approve always compiles or refuses; a missing required input fails loud, never a silent approval without a contract).
 *
 * Coverage: NEGATIVE (refusal, nothing written) / HAPPY (a stub port approves) / BOUNDARY (a non-task needs no port)
 */

import { describe, expect, it } from "vitest";
import type { DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { ReviewService } from "../../../src/service/review-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { actedStore } from "../../live-invocation.js";
import { stubDoneContractPort } from "../../helpers/done-contract-stub-port.js";

function draft(type: "task" | "prd", id: string): DocRecord {
  return {
    id: id as DocRecord["id"],
    slug: `${type}-needs-port`,
    type,
    role: "intent",
    title: "Needs port",
    status: "draft",
    priority: "medium",
    content: "x",
    parent_id: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: type === "task" ? { kind: "code" } : {},
  };
}

function bare(): { store: InMemoryStore; service: ReviewService } {
  const store = actedStore(new InMemoryStore());
  return { store, service: new ReviewService(store, new RecordLockService(store, new GateEnforcer(undefined))) };
}

describe("ReviewService.approve of a task needs the done-contract port", () => {
  it("a bare ReviewService refuses a task with done-contract-port-missing and writes nothing", async () => {
    const { store, service } = bare();
    const task = draft("task", "01HPORT00000000000000000A1");
    await store.insert(task);
    const result = await service.approve(task.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.error)).toContain("done-contract-port-missing");
    const after = await store.find(task.id);
    expect(after.ok && after.value?.status).toBe("draft");
    expect(after.ok && after.value?.version).toBe(1);
    expect(after.ok && after.value?.extra["done_contract"]).toBeUndefined();
  });

  it("with a port the same task is approved and carries the contract", async () => {
    const { store, service } = bare();
    service.setDoneContractPort(stubDoneContractPort());
    const task = draft("task", "01HPORT00000000000000000A2");
    await store.insert(task);
    const result = await service.approve(task.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("approved");
    expect(result.value.extra["done_contract"]).toBeDefined();
  });

  it("a document that is not a task needs no port", async () => {
    const { store, service } = bare();
    const prd = draft("prd", "01HPORT00000000000000000A3");
    await store.insert(prd);
    const result = await service.approve(prd.id);
    expect(result.ok).toBe(true);
  });
});
