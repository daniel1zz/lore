/**
 * RED suite (TDD-Role: red, paired-impl task-skill-implement-phasechecklistservice)
 * for `PhaseChecklistService` (`packages/lore/src/service/phase-checklist-service.ts`)
 * — a module that does NOT exist yet (SPEC-056 §Design Decisions D2, §Module Boundary:
 * "PhaseChecklistService — checklist + track verbs — mirrors AcService's
 * add/list/remove-on-extra shape").
 *
 * RED mechanism (see `packages/lore/tests/unit/core/verification-profile.test.ts` for
 * the same technique, first used by SPEC-058 and captured as a reusable pattern in
 * `knowledge-spec-058-execution-learnings-init-seeding-yaml-trap-co` §2): the module
 * under test is loaded via a dynamic `import()` whose specifier is a COMPUTED
 * (non-literal) string built from an array `.join("/")`. TypeScript only performs
 * static module resolution against `import()` calls with a STRING-LITERAL argument, so
 * `bun run typecheck` stays green today (before the file exists) and after it lands,
 * with zero edits to this file either way. At runtime today the import genuinely
 * throws ("Cannot find module") inside `beforeAll`, which vitest reports as every `it`
 * in this file failing due to a failed hook — the "RED for missing-implementation
 * reasons only" mode this task's AC calls for.
 *
 * CONTRACT NOTE (this file is the authoritative shape the paired implement task must
 * satisfy — SPEC-056's Module Boundary sketch names the class and its AcService-shape
 * precedent but not concrete method signatures; the choices below resolve every
 * ambiguity the sketch leaves open):
 *   - `new PhaseChecklistService(store: StoreInterface)` — same single-arg constructor
 *     shape as `AcService`.
 *   - `addChecklistItem(phaseIdOrSlug, item: unknown): Promise<Result<ChecklistItem[], LoreError>>`
 *     — validates the FULL candidate array (existing + new) via
 *     `phaseExtraSchema.shape.checklist` in one pass (mirrors `AcService.addCriterion`'s
 *     `specAcceptanceCriteriaSchema` single-shot validation) — covers the new entry's
 *     own shape (including the schema's `checked` manual-bind-only superRefine) AND the
 *     100-entry cap simultaneously.
 *   - `listChecklist(phaseIdOrSlug): Promise<Result<ChecklistItem[], LoreError>>` —
 *     bare declared-order array (no coverage/dangling join at this layer — that is a
 *     LATER task's job per SPEC-056 D8, a separate runner-seam port).
 *   - `dropChecklistItem(phaseIdOrSlug, itemId, opts: {by: string; reason?: string}):
 *     Promise<Result<ChecklistItem[], LoreError>>` — sets `dropped: {by, at: now,
 *     reason}`; a missing/empty `reason` fails loud with VALIDATION_ERROR BEFORE any
 *     write (this task's own AC: "drop without reason → VALIDATION_ERROR", enforced by
 *     the service layer as an immediate check, not left to bubble up from schema
 *     validation as a generic message).
 *   - `checkChecklistItem(phaseIdOrSlug, itemId, opts: {by: string}): Promise<Result<ChecklistItem[], LoreError>>`
 *     — sets `checked: {by, at: now}`; rejects (VALIDATION_ERROR) when the target item's
 *     `bind.kind !== "manual"` — the service-level enforcement of "script items never
 *     carry checked" (the schema's own superRefine is the second, defense-in-depth
 *     layer exercised separately below).
 *   - `editChecklistStatement(phaseIdOrSlug, itemId, statement: string):
 *     Promise<Result<ChecklistItem[], LoreError>>` — updates `statement`; when the item
 *     currently carries `checked`, the edit VOIDS it (clears `checked`) — the write-time
 *     invariant `phase.ts`'s own module header assigns to this service ("checked being
 *     voided by a statement edit... PhaseChecklistService... is the sole writer
 *     responsible").
 *   - `addTrackNote(phaseIdOrSlug, note: unknown): Promise<Result<TrackItem[], LoreError>>`
 *     / `listTrack(phaseIdOrSlug): Promise<Result<TrackItem[], LoreError>>` — same
 *     shape as the checklist add/list pair, validated via
 *     `phaseExtraSchema.shape.track` (200-entry cap).
 *   - Every write (`addChecklistItem`/`dropChecklistItem`/`checkChecklistItem`/
 *     `editChecklistStatement`/`addTrackNote`) is CAS-guarded (`store.update`'s
 *     `expected_version`) and produces exactly ONE `insertVersion` snapshot + ONE
 *     `appendAuditEntry` (action "update", actor "system") — byte-identical shape to
 *     `AcService`'s `writeCriteria` private helper, so `AuditService.verify`'s
 *     versions⋈audit completeness oracle needs no special case for phase-checklist
 *     writes.
 *   - `resolveDoc`-style resolution rejects a resolvable-but-wrong-type target with
 *     `VALIDATION_ERROR` field `"type"` (mirrors `AcService.resolveSpec`) and an
 *     unresolvable id/slug with `DOC_NOT_FOUND`.
 *
 * Doc-type fixture note (mirrors `phase.ts`'s own module-header invariant): the `phase`
 * doc type is NOT yet wired into `DocType`/`DOC_TYPE_ROLE_MAP` (deferred to a later
 * task in this plan, per `phase.ts`'s header and this task's Context Digest) — fixture
 * phase docs below are built as plain objects and `store.insert()`ed directly
 * (bypassing `CorpusService.create`, which does not know the `"phase"` type yet),
 * with a `type: "phase" as unknown as DocType` cast at the single fixture-builder call
 * site. `InMemoryStore.insert` performs no runtime `type` validation (confirmed by
 * inspection — it only checks slug/id uniqueness), so this is safe at test-run time;
 * the cast exists solely to satisfy `DocRecord.type: DocType`'s current compile-time
 * enum, which this task's declared anchors (this test file only) do not extend.
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * Source: spec-spec-056-phase-execution-model-phase-doc-type-computed-comp
 *   §Module Boundary, §Design Decisions D2; task-skill-test-checklistservice-feed-flow-red
 *   AC "Both named test files exist and are RED for missing-implementation reasons only".
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect, beforeAll } from "vitest";
import { ulid } from "ulidx";
import type { ChecklistItem, DocId, DocRecord, LoreError, Result, TrackItem } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { StoreInterface } from "../../../src/store/store-interface.js";
import type { CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// packages/lore/tests/unit/service/ -> ../../../ -> packages/lore/ -> src/service/phase-checklist-service.js
const PHASE_CHECKLIST_SERVICE_MODULE_PATH = [
  "..",
  "..",
  "..",
  "src",
  "service",
  "phase-checklist-service.js",
].join("/");

/** The module's expected public shape — see CONTRACT NOTE above. */
interface PhaseChecklistServiceModule {
  PhaseChecklistService: new (store: StoreInterface) => {
    addChecklistItem(
      phaseIdOrSlug: string,
      item: unknown,
    ): Promise<Result<ChecklistItem[], LoreError>>;
    listChecklist(phaseIdOrSlug: string): Promise<Result<ChecklistItem[], LoreError>>;
    dropChecklistItem(
      phaseIdOrSlug: string,
      itemId: string,
      opts: { by: string; reason?: string },
    ): Promise<Result<ChecklistItem[], LoreError>>;
    checkChecklistItem(
      phaseIdOrSlug: string,
      itemId: string,
      opts: { by: string },
    ): Promise<Result<ChecklistItem[], LoreError>>;
    editChecklistStatement(
      phaseIdOrSlug: string,
      itemId: string,
      statement: string,
    ): Promise<Result<ChecklistItem[], LoreError>>;
    addTrackNote(phaseIdOrSlug: string, note: unknown): Promise<Result<TrackItem[], LoreError>>;
    listTrack(phaseIdOrSlug: string): Promise<Result<TrackItem[], LoreError>>;
  };
}

let PhaseChecklistService: PhaseChecklistServiceModule["PhaseChecklistService"];

beforeAll(async () => {
  const mod = (await import(
    PHASE_CHECKLIST_SERVICE_MODULE_PATH
  )) as unknown as PhaseChecklistServiceModule;
  PhaseChecklistService = mod.PhaseChecklistService;
});

// ─── Fixture helpers ────────────────────────────────────────────────────────

function manualItem(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    statement: `${id} manual claim`,
    bind: { kind: "manual" },
    ...overrides,
  };
}

function scriptItem(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    statement: `${id} script claim`,
    bind: { kind: "script", oracle: "test", command: `bun test ${id}.test.ts` },
    ...overrides,
  };
}

async function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const phaseChecklistService = new PhaseChecklistService(store);
  return { store, corpusService, phaseChecklistService };
}

async function createPrd(cs: CorpusService): Promise<DocId> {
  const result = await cs.create({ type: "prd", title: "Root PRD", content: "root" } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create prd: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createSpec(cs: CorpusService, parentId: DocId): Promise<DocId> {
  const result = await cs.create({
    type: "spec",
    title: "Test Spec",
    content: "spec body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create spec: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createPlan(cs: CorpusService, parentId: DocId): Promise<DocId> {
  const result = await cs.create({
    type: "plan",
    title: "Test Plan",
    parent_id: parentId,
    content: "plan body",
  } as CreateDocInput);
  if (!result.ok) throw new Error(`Failed to create plan: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/**
 * Raw-inserts a `phase` doc directly into the store — see the doc-type fixture note in
 * the module header. `checklist`/`track` default to `[]`; callers seed via `extra`.
 */
async function createPhase(
  store: InMemoryStore,
  planId: DocId,
  extra: Record<string, unknown> = {},
): Promise<DocRecord> {
  const id = ulid() as DocId;
  const now = new Date().toISOString();
  const doc = {
    id,
    slug: `phase-test-${id.slice(-8).toLowerCase()}`,
    // reason: `phase` is not yet a registered DocType (see module header) — cast
    // needed purely to satisfy DocRecord.type's current compile-time enum.
    type: "phase" as unknown as DocRecord["type"],
    role: "plan",
    title: "Test Phase",
    status: "draft",
    priority: "medium",
    content: "phase body",
    parent_id: planId,
    created_at: now,
    updated_at: now,
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: { plan_id: planId, checklist: [], track: [], ...extra },
  } as unknown as DocRecord;
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`createPhase failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function createPhaseFixture(): Promise<{
  store: InMemoryStore;
  corpusService: CorpusService;
  phaseChecklistService: InstanceType<PhaseChecklistServiceModule["PhaseChecklistService"]>;
  phase: DocRecord;
}> {
  const { store, corpusService, phaseChecklistService } = await makeServices();
  const prdId = await createPrd(corpusService);
  const specId = await createSpec(corpusService, prdId);
  const planId = await createPlan(corpusService, specId);
  const phase = await createPhase(store, planId);
  return { store, corpusService, phaseChecklistService, phase };
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("HAPPY — checklist add/list + track add/list round-trip", () => {
  it("addChecklistItem on a phase with none persists the new entry, bumps version, and writes one versions row + one audit entry", async () => {
    const { store, phaseChecklistService, phase } = await createPhaseFixture();
    const versionBefore = phase.version;

    const result = await phaseChecklistService.addChecklistItem(phase.id, manualItem("CHK-1"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([manualItem("CHK-1")]);

    const after = await store.find(phase.id);
    if (!after.ok || after.value === null) throw new Error("phase re-fetch failed");
    expect(after.value.extra["checklist"]).toEqual([manualItem("CHK-1")]);
    expect(after.value.version).toBe(versionBefore + 1);

    // A checklist write is a working-state write: the version bumps, but no versions row is added and the delta
    // lives in the audit row (spec-history-records-content-a-working-state-only-write-adds-no).
    const versions = await store.findVersions(phase.id);
    expect(versions.ok).toBe(true);
    if (!versions.ok) return;
    expect(versions.value.every((v) => v.version <= versionBefore)).toBe(true);

    const audit = await store.queryAudit({ doc_id: phase.id });
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    const updates = audit.value.filter((e) => e.action === "update");
    expect(updates).toHaveLength(1);
    expect((updates[0]?.details as { state_change?: { keys: string[] } } | undefined)?.state_change?.keys).toEqual(["checklist"]);
  });

  it("listChecklist round-trips items in declaration order across script and manual binds", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    await phaseChecklistService.addChecklistItem(phase.id, manualItem("CHK-1"));
    await phaseChecklistService.addChecklistItem(phase.id, scriptItem("CHK-2"));

    const listed = await phaseChecklistService.listChecklist(phase.id);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((i) => i.id)).toEqual(["CHK-1", "CHK-2"]);
  });

  it("addTrackNote persists a note with by/at and listTrack round-trips it", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    const result = await phaseChecklistService.addTrackNote(phase.id, {
      id: "TRK-1",
      note: "displaced claim from task-migration",
      by: "alice",
      at: "2026-07-19T10:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const listed = await phaseChecklistService.listTrack(phase.id);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toEqual([
      { id: "TRK-1", note: "displaced claim from task-migration", by: "alice", at: "2026-07-19T10:00:00.000Z" },
    ]);
  });

  it("checkChecklistItem sets checked:{by,at} on a manual-bind item", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    await phaseChecklistService.addChecklistItem(phase.id, manualItem("CHK-1"));

    const result = await phaseChecklistService.checkChecklistItem(phase.id, "CHK-1", { by: "alice" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.value.find((i) => i.id === "CHK-1");
    expect(item?.checked?.by).toBe("alice");
    expect(typeof item?.checked?.at).toBe("string");
  });

  it("dropChecklistItem with a reason sets dropped:{by,at,reason} and keeps the item in the array", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    await phaseChecklistService.addChecklistItem(phase.id, manualItem("CHK-1"));

    const result = await phaseChecklistService.dropChecklistItem(phase.id, "CHK-1", {
      by: "alice",
      reason: "superseded by CHK-2",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.dropped).toEqual({
      by: "alice",
      reason: "superseded by CHK-2",
      at: expect.any(String),
    });
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("NEGATIVE — malformed input / cross-bind rejections", () => {
  it("dropChecklistItem without a reason fails loud with VALIDATION_ERROR and leaves the item unchanged", async () => {
    const { store, phaseChecklistService, phase } = await createPhaseFixture();
    await phaseChecklistService.addChecklistItem(phase.id, manualItem("CHK-1"));

    const result = await phaseChecklistService.dropChecklistItem(phase.id, "CHK-1", { by: "alice" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = await store.find(phase.id);
    if (!after.ok || after.value === null) throw new Error("phase re-fetch failed");
    const items = after.value.extra["checklist"] as Array<Record<string, unknown>>;
    expect(items[0]?.["dropped"]).toBeUndefined();
  });

  it("checkChecklistItem on a script-bind item is rejected with VALIDATION_ERROR (script items never carry checked)", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    await phaseChecklistService.addChecklistItem(phase.id, scriptItem("CHK-2"));

    const result = await phaseChecklistService.checkChecklistItem(phase.id, "CHK-2", { by: "alice" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("addChecklistItem rejects a script-bind item that carries `checked` at creation (schema superRefine) — doc unchanged", async () => {
    const { store, phaseChecklistService, phase } = await createPhaseFixture();

    const malformed = scriptItem("CHK-3", { checked: { by: "alice", at: "2026-07-19T10:00:00.000Z" } });
    const result = await phaseChecklistService.addChecklistItem(phase.id, malformed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = await store.find(phase.id);
    if (!after.ok || after.value === null) throw new Error("phase re-fetch failed");
    expect(after.value.extra["checklist"]).toEqual([]);
  });

  it("addChecklistItem rejects a candidate missing `statement` — doc unchanged", async () => {
    const { store, phaseChecklistService, phase } = await createPhaseFixture();

    const malformed = { id: "CHK-4", bind: { kind: "manual" } };
    const result = await phaseChecklistService.addChecklistItem(phase.id, malformed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");

    const after = await store.find(phase.id);
    if (!after.ok || after.value === null) throw new Error("phase re-fetch failed");
    expect(after.value.extra["checklist"]).toEqual([]);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("BOUNDARY — 100-entry checklist cap / 200-entry track cap", () => {
  it("the 101st checklist item is rejected with VALIDATION_ERROR when 100 are already declared", async () => {
    const { store, corpusService, phaseChecklistService } = await makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const planId = await createPlan(corpusService, specId);
    const fullChecklist = Array.from({ length: 100 }, (_, i) => manualItem(`CHK-${i}`));
    const phase = await createPhase(store, planId, { checklist: fullChecklist });

    const result = await phaseChecklistService.addChecklistItem(phase.id, manualItem("CHK-101"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("the 201st track entry is rejected with VALIDATION_ERROR when 200 are already declared", async () => {
    const { store, corpusService, phaseChecklistService } = await makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const planId = await createPlan(corpusService, specId);
    const fullTrack = Array.from({ length: 200 }, (_, i) => ({
      id: `TRK-${i}`,
      note: `note ${i}`,
      by: "alice",
      at: "2026-07-19T10:00:00.000Z",
    }));
    const phase = await createPhase(store, planId, { track: fullTrack });

    const result = await phaseChecklistService.addTrackNote(phase.id, {
      id: "TRK-201",
      note: "one too many",
      by: "alice",
      at: "2026-07-19T10:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("ERROR — unresolvable target / wrong doc type", () => {
  it("addChecklistItem on a nonexistent phase id returns DOC_NOT_FOUND", async () => {
    const { phaseChecklistService } = await makeServices();
    const result = await phaseChecklistService.addChecklistItem("phase-does-not-exist", manualItem("CHK-1"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  it("addChecklistItem on a resolvable non-phase doc (a plan) returns VALIDATION_ERROR field 'type'", async () => {
    const { corpusService, phaseChecklistService } = await makeServices();
    const prdId = await createPrd(corpusService);
    const specId = await createSpec(corpusService, prdId);
    const planId = await createPlan(corpusService, specId);

    const result = await phaseChecklistService.addChecklistItem(planId, manualItem("CHK-1"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as { field?: string }).field).toBe("type");
  });

  it("dropChecklistItem on an unknown item id returns VALIDATION_ERROR", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    const result = await phaseChecklistService.dropChecklistItem(phase.id, "CHK-GHOST", {
      by: "alice",
      reason: "n/a",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("checkChecklistItem on an unknown item id returns VALIDATION_ERROR", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    const result = await phaseChecklistService.checkChecklistItem(phase.id, "CHK-GHOST", { by: "alice" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("STATE — manual check voided on statement edit; version accumulates", () => {
  it("editChecklistStatement on a checked manual item VOIDS (clears) `checked`", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    await phaseChecklistService.addChecklistItem(phase.id, manualItem("CHK-1"));
    const checked = await phaseChecklistService.checkChecklistItem(phase.id, "CHK-1", { by: "alice" });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.value.find((i) => i.id === "CHK-1")?.checked).toBeDefined();

    const edited = await phaseChecklistService.editChecklistStatement(phase.id, "CHK-1", "revised claim text");
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const item = edited.value.find((i) => i.id === "CHK-1");
    expect(item?.statement).toBe("revised claim text");
    expect(item?.checked).toBeUndefined();
  });

  it("editChecklistStatement on a never-checked item is a no-op on `checked` (stays absent)", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    await phaseChecklistService.addChecklistItem(phase.id, manualItem("CHK-1"));

    const edited = await phaseChecklistService.editChecklistStatement(phase.id, "CHK-1", "revised claim text");
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const item = edited.value.find((i) => i.id === "CHK-1");
    expect(item?.statement).toBe("revised claim text");
    expect(item?.checked).toBeUndefined();
  });

  it("phase.version accumulates by exactly one per sequential write across checklist and track calls", async () => {
    const { store, phaseChecklistService, phase } = await createPhaseFixture();
    const versionBefore = phase.version;

    await phaseChecklistService.addChecklistItem(phase.id, manualItem("CHK-1"));
    await phaseChecklistService.addTrackNote(phase.id, {
      id: "TRK-1",
      note: "first note",
      by: "alice",
      at: "2026-07-19T10:00:00.000Z",
    });
    await phaseChecklistService.dropChecklistItem(phase.id, "CHK-1", { by: "alice", reason: "no longer needed" });

    const after = await store.find(phase.id);
    if (!after.ok || after.value === null) throw new Error("phase re-fetch failed");
    expect(after.value.version).toBe(versionBefore + 3);
  });

  it("dropping a checklist item does not remove it from the array — listChecklist still returns it", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    await phaseChecklistService.addChecklistItem(phase.id, manualItem("CHK-1"));
    await phaseChecklistService.dropChecklistItem(phase.id, "CHK-1", { by: "alice", reason: "cut from scope" });

    const listed = await phaseChecklistService.listChecklist(phase.id);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]?.dropped).toBeDefined();
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("REGRESSION — script-bind items never acquire `checked` through any service path", () => {
  it("a script-bind item added, then dropped, then re-listed carries no `checked` field at any point", async () => {
    const { phaseChecklistService, phase } = await createPhaseFixture();
    const added = await phaseChecklistService.addChecklistItem(phase.id, scriptItem("CHK-2"));
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.find((i) => i.id === "CHK-2")?.checked).toBeUndefined();

    const dropped = await phaseChecklistService.dropChecklistItem(phase.id, "CHK-2", {
      by: "alice",
      reason: "not needed",
    });
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) return;
    expect(dropped.value.find((i) => i.id === "CHK-2")?.checked).toBeUndefined();

    const listed = await phaseChecklistService.listChecklist(phase.id);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.find((i) => i.id === "CHK-2")?.checked).toBeUndefined();
  });
});
