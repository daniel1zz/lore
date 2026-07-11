/**
 * Unit tests for `createWithSupersedes`/`renderSupersedeRepairMessage`
 * (`flows/supersede-flow.ts`) — the SPEC-043 D11 supersede orchestration shared by
 * `lore create <type> --supersedes <old>` (CLI) and MCP `lore_create.supersedes`.
 *
 * Tests the exported orchestration function directly against INJECTED fake
 * `create`/`invalidate` dependencies — "a small exported function testable without
 * spawning" (Context Digest) — never a real store, never the compiled binary.
 *
 * Coverage:
 *   HAPPY:      create() succeeds, invalidate() succeeds → ok({doc}), no supersedeError
 *   NEGATIVE:   create() itself fails → err() propagated untouched, invalidate() is
 *               NEVER called (nothing to invalidate when creation never happened)
 *   BOUNDARY:   renderSupersedeRepairMessage's exact pinned string format (edge case:
 *               the old input and new slug happen to share a common prefix)
 *   ERROR:      create() succeeds but invalidate() is FORCED to fail (D11's central
 *               case, AC-MH-13) → the command still reports ok() (doc is real) with
 *               `supersedeError` set, AND the repair message names BOTH slugs exactly
 *               per the pinned D11 wording — loud orphan, never silent
 *   STATE:      invalidate() is invoked with EXACTLY `{supersededBy: newDoc.id, by}` —
 *               proves ValidityService (the injected invalidate call) remains the sole
 *               mutator, driven by the correct arguments
 *   REGRESSION: `doc` is present and UNCHANGED in the result on BOTH the happy path and
 *               the half-failure path — a supersede failure never hides or mutates the
 *               already-created document
 *
 * @spec_ref SPEC-043 §Design Decisions D11; §Acceptance Criteria AC-MH-13
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";
import {
  createWithSupersedes,
  renderSupersedeRepairMessage,
  type SupersedeOrchestrationDeps,
} from "../../../src/flows/supersede-flow.js";
import type { InvalidateOpts, InvalidateResult } from "../../../src/service/validity-service.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: overrides.id ?? "01J0000000000000000000NEW1",
    slug: overrides.slug ?? ("adr-new-decision" as DocRecord["slug"]),
    type: overrides.type ?? "adr",
    role: overrides.role ?? "decision",
    title: overrides.title ?? "New Decision",
    status: overrides.status ?? "draft",
    priority: overrides.priority ?? "medium",
    content: overrides.content ?? "# New Decision",
    parent_id: overrides.parent_id ?? null,
    created_at: overrides.created_at ?? "2026-07-11T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-07-11T00:00:00.000Z",
    created_by: overrides.created_by ?? "system",
    version: overrides.version ?? 1,
    deleted_at: overrides.deleted_at ?? null,
    tags: overrides.tags ?? [],
    extra: overrides.extra ?? {},
  };
}

const CREATE_INPUT: CreateDocInput = {
  type: "adr",
  title: "New Decision",
  content: "# New Decision",
  extra: { decision_status: "accepted" },
} as CreateDocInput;

function makeDeps(
  createResult: Result<DocRecord, LoreError>,
  invalidateResult: Result<InvalidateResult, LoreError>,
): { deps: SupersedeOrchestrationDeps; createMock: ReturnType<typeof vi.fn>; invalidateMock: ReturnType<typeof vi.fn> } {
  const createMock = vi.fn(async (_input: CreateDocInput) => createResult);
  const invalidateMock = vi.fn(async (_idOrSlug: string, _opts: InvalidateOpts) => invalidateResult);
  return {
    deps: { create: createMock, invalidate: invalidateMock },
    createMock,
    invalidateMock,
  };
}

// ─── HAPPY ────────────────────────────────────────────────────────────────

describe("createWithSupersedes — HAPPY", () => {
  it("create() succeeds, invalidate() succeeds → ok({doc}), no supersedeError", async () => {
    const newDoc = makeDoc();
    const oldDoc = makeDoc({ id: "01J0000000000000000000OLD1", slug: "adr-old-decision" as DocRecord["slug"] });
    const { deps } = makeDeps(ok(newDoc), ok({ doc: oldDoc }));

    const result = await createWithSupersedes(deps, CREATE_INPUT, "adr-old-decision", "alice");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.doc).toEqual(newDoc);
    expect(result.value.supersedeError).toBeUndefined();
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────

describe("createWithSupersedes — NEGATIVE", () => {
  it("create() itself fails → err() propagated untouched, invalidate() never called", async () => {
    const createErr: LoreError = { code: "VALIDATION_ERROR", field: "title", message: "title required" };
    const { deps, invalidateMock } = makeDeps(err(createErr), ok({ doc: makeDoc() }));

    const result = await createWithSupersedes(deps, CREATE_INPUT, "adr-old-decision", "alice");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(createErr);
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────

describe("renderSupersedeRepairMessage — BOUNDARY", () => {
  it("renders the pinned D11 format even when the old input and new slug share a common prefix", () => {
    const message = renderSupersedeRepairMessage("adr-decision-v1", "adr-decision-v2");
    expect(message).toBe(
      "new doc created but NOT superseded — run: lore invalidate adr-decision-v1 --superseded-by adr-decision-v2",
    );
  });
});

// ─── ERROR: the central D11 case ─────────────────────────────────────────

describe("createWithSupersedes — ERROR (D11 half-failure, AC-MH-13)", () => {
  it("create() succeeds but invalidate() is FORCED to fail → ok() with supersedeError; repair message names both slugs", async () => {
    const newDoc = makeDoc();
    const invalidateErr: LoreError = { code: "STALE_VERSION", id: "01J0000000000000000000OLD1", expected: 1, actual: 2 };
    const { deps } = makeDeps(ok(newDoc), err(invalidateErr));

    const result = await createWithSupersedes(deps, CREATE_INPUT, "adr-old-decision", "alice");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Loud orphan (D11) — doc is real, never hidden.
    expect(result.value.doc).toEqual(newDoc);
    expect(result.value.supersedeError).toEqual(invalidateErr);

    const repairMessage = renderSupersedeRepairMessage("adr-old-decision", result.value.doc.slug);
    expect(repairMessage).toBe(
      "new doc created but NOT superseded — run: lore invalidate adr-old-decision --superseded-by adr-new-decision",
    );
    expect(repairMessage).toContain("adr-old-decision"); // old slug named
    expect(repairMessage).toContain("adr-new-decision"); // new slug named
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────

describe("createWithSupersedes — STATE", () => {
  it("invalidate() is invoked with EXACTLY {supersededBy: newDoc.id, by} — ValidityService is the sole mutator, correctly driven", async () => {
    const newDoc = makeDoc({ id: "01J0000000000000000000NEWX" });
    const oldDoc = makeDoc({ id: "01J0000000000000000000OLD9", slug: "knowledge-old" as DocRecord["slug"] });
    const { deps, invalidateMock } = makeDeps(ok(newDoc), ok({ doc: oldDoc }));

    await createWithSupersedes(deps, CREATE_INPUT, "knowledge-old", "bob");

    expect(invalidateMock).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalledWith("knowledge-old", { supersededBy: "01J0000000000000000000NEWX", by: "bob" });
  });
});

// ─── REGRESSION ───────────────────────────────────────────────────────────

describe("createWithSupersedes — REGRESSION", () => {
  it("`doc` is present and unchanged on BOTH the happy path and the half-failure path", async () => {
    const newDoc = makeDoc({ id: "01J0000000000000000000REG1" });
    const oldDoc = makeDoc({ id: "01J0000000000000000000REG2" });

    const happy = makeDeps(ok(newDoc), ok({ doc: oldDoc }));
    const happyResult = await createWithSupersedes(happy.deps, CREATE_INPUT, "adr-old", "alice");
    expect(happyResult.ok && happyResult.value.doc).toEqual(newDoc);

    const invalidateErr: LoreError = { code: "DOC_NOT_FOUND", id: "adr-old" };
    const halfFailure = makeDeps(ok(newDoc), err(invalidateErr));
    const halfFailureResult = await createWithSupersedes(halfFailure.deps, CREATE_INPUT, "adr-old", "alice");
    expect(halfFailureResult.ok && halfFailureResult.value.doc).toEqual(newDoc);
  });
});
