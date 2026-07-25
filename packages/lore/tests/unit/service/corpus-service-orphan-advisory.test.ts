/**
 * corpus-service-orphan-advisory.test.ts — create-time orphan advisory
 * (task-create-time-orphan-advisory-warn-or-default-parent-to-root).
 *
 * `CorpusService.create` surfaces a non-persisted, typed `orphan_advisory` string on
 * its `CreateDocResult` when an `adr`/`plan`/`knowledge` doc is created with NO parent
 * WHILE a root PRD already exists in the corpus — advisory-only (never blocks the
 * create, never mutates `parent_id`). Pre-PRD exploration (no root PRD yet) stays
 * silent by design; a supplied parent suppresses it; `spec`/`task` are unaffected
 * (their schema already mandates `parent_id`).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / STATE / REGRESSION
 *
 * @spec_ref task-create-time-orphan-advisory-warn-or-default-parent-to-root
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput } from "@lore/core";

function makeService() {
  const store = new InMemoryStore();
  return { service: new CorpusService(store), store };
}

async function createRootPrd(service: CorpusService, title = "Root PRD") {
  const result = await service.create({ type: "prd", title, content: "root" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create root prd: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("create-time orphan advisory (task-create-time-orphan-advisory-warn-or-default-parent-to-root)", () => {
  // ── HAPPY: root PRD exists, parentless adr/plan/knowledge → advisory present ──

  it("parentless knowledge + root PRD exists → advisory names BOTH the new doc and the root PRD", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);

    const result = await service.create({
      type: "knowledge",
      title: "Orphan Knowledge",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.orphan_advisory).toBeDefined();
    expect(result.value.orphan_advisory).toContain(result.value.slug);
    expect(result.value.orphan_advisory).toContain(rootPrd.slug);
    expect(result.value.orphan_advisory).toContain(
      `lore link ${result.value.slug} ${rootPrd.slug} --type parent`,
    );
    // Advisory-only — parent_id is untouched, never auto-set.
    expect(result.value.parent_id).toBeNull();
  });

  it("parentless adr + root PRD exists → advisory present", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);

    const result = await service.create({
      type: "adr",
      title: "Orphan ADR",
      extra: { decision_status: "proposed" },
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.orphan_advisory).toContain(
      `lore link ${result.value.slug} ${rootPrd.slug} --type parent`,
    );
  });

  it("parentless plan + root PRD exists → advisory present", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);

    const result = await service.create({
      type: "plan",
      title: "Orphan Plan",
      content: "body",
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.orphan_advisory).toContain(
      `lore link ${result.value.slug} ${rootPrd.slug} --type parent`,
    );
  });

  // ── NEGATIVE: no root PRD yet → silent (pre-PRD exploration deadlock rationale) ──

  it("parentless knowledge in a corpus with NO root PRD → no advisory", async () => {
    const { service } = makeService();

    const result = await service.create({
      type: "knowledge",
      title: "Early Exploration Note",
      extra: { sub_type: "ideation" },
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.orphan_advisory).toBeUndefined();
  });

  it("parentless adr in a corpus with NO root PRD → no advisory", async () => {
    const { service } = makeService();

    const result = await service.create({
      type: "adr",
      title: "Early Decision",
      extra: { decision_status: "proposed" },
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.orphan_advisory).toBeUndefined();
  });

  // ── BOUNDARY: explicit parent supplied → advisory suppressed even with a root PRD ──

  it("knowledge created WITH a parent (root PRD exists too) → no advisory", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);
    const planResult = await service.create({
      type: "plan",
      title: "Parent Plan",
      parent_id: rootPrd.id,
      content: "body",
    } as CreateDocInput);
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;

    const result = await service.create({
      type: "knowledge",
      title: "Attached Note",
      parent_id: planResult.value.id,
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.orphan_advisory).toBeUndefined();
  });

  it("plan created WITH parent_id === the root PRD itself → no advisory", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);

    const result = await service.create({
      type: "plan",
      title: "Attached Plan",
      parent_id: rootPrd.id,
      content: "body",
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.orphan_advisory).toBeUndefined();
  });

  // ── REGRESSION: spec/task unaffected — schema already mandates their parent_id ──

  it("spec always requires parent_id — schema rejects a parentless create before advisory logic runs", async () => {
    const { service } = makeService();
    await createRootPrd(service);

    const result = await service.create({ type: "spec", title: "Orphan Spec" } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARENT_REQUIRED");
  });

  it("task always requires parent_id (non-adhoc) — schema rejects a parentless create before advisory logic runs", async () => {
    const { service } = makeService();
    await createRootPrd(service);

    const result = await service.create({
      type: "task",
      title: "Orphan Task",
      extra: { plan_id: "irrelevant" },
    } as CreateDocInput);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("PARENT_REQUIRED");
  });

  it("a successfully-created spec (with parent, root PRD present) never carries the advisory field", async () => {
    const { service } = makeService();
    const rootPrd = await createRootPrd(service);

    const result = await service.create({
      type: "spec",
      title: "Attached Spec",
      parent_id: rootPrd.id,
    } as CreateDocInput);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.orphan_advisory).toBeUndefined();
  });
});
