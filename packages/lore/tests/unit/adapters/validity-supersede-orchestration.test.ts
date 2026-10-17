// @reads packages/core/src/**
// @reads packages/lore/src/**
/**
 * Unit tests for `createWithSupersedes`/`renderSupersedeRepairMessage`/
 * `SUPERSEDE_CREATE_ELIGIBLE_TYPES` (`flows/supersede-flow.ts`) — the SPEC-043 D11
 * supersede orchestration shared by `lore create <type> --supersedes <old>` (CLI) and
 * MCP `lore_create.supersedes`.
 *
 * Tests the exported orchestration function directly against INJECTED fake
 * `get`/`create`/`invalidate` dependencies — "a small exported function testable
 * without spawning" (Context Digest) — never a real store, never the compiled binary.
 *
 * task-mcp-lore-create-supersedes-still-creates-then-fails-the moved the target-type
 * eligibility precheck INTO this function (it used to live one layer up, inside the
 * CLI's `commands/create.ts`, which is exactly why MCP — already calling this function
 * directly — never inherited it). The precheck-specific coverage below is additive to
 * the pre-existing create/invalidate-sequencing coverage; end-to-end per-surface
 * behavior (CLI stderr+exit 4, MCP isError, doc-count-unchanged) is covered by
 * `cli-create-supersedes.bun.test.ts` (CLI) and `mcp-create-supersedes.test.ts` (MCP).
 *
 * Coverage:
 *   HAPPY:      create() succeeds, invalidate() succeeds → ok({doc}), no supersedeError
 *   NEGATIVE:   (a) create() itself fails → err() propagated untouched, invalidate() is
 *               NEVER called (nothing to invalidate when creation never happened);
 *               (b) the resolved target's type is OUTSIDE
 *               SUPERSEDE_CREATE_ELIGIBLE_TYPES → err(VALIDATION_ERROR) naming the
 *               offending type, create()/invalidate() are NEVER called (the precheck
 *               this task adds)
 *   BOUNDARY:   (a) renderSupersedeRepairMessage's exact pinned string format (edge
 *               case: the old input and new slug happen to share a common prefix);
 *               (b) get() itself fails (target does not resolve at all) → err()
 *               propagated untouched, create()/invalidate() NEVER called
 *   CONTROL:    a type-ELIGIBLE target (knowledge AND adr, not just one) still reaches
 *               create()/invalidate() — proves the precheck is a narrow allow-list, not
 *               a blanket refusal that would trivially pass NEGATIVE (b)
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
 * A separate top-level describe block (AC4) asserts
 * `SUPERSEDE_CREATE_ELIGIBLE_TYPES` is DECLARED in exactly one module — this shared
 * flow — across `packages/lore/src` and `packages/core/src`, via a structural (not
 * bare-substring) source scan, mirroring `barrel-isolation.test.ts`'s import-closure
 * scan style.
 *
 * @spec_ref SPEC-043 §Design Decisions D11; §Acceptance Criteria AC-MH-13;
 *   task-mcp-lore-create-supersedes-still-creates-then-fails-the
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, err } from "@lore/core";
import type { CreateDocInput, DocRecord, LoreError, Result } from "@lore/core";
import {
  createWithSupersedes,
  renderSupersedeRepairMessage,
  SUPERSEDE_CREATE_ELIGIBLE_TYPES,
  type SupersedeOrchestrationDeps,
} from "../../../src/flows/supersede-flow.js";
import type { InvalidateOpts, InvalidateResult } from "../../../src/service/validity-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

/**
 * @param getResult - Defaults to an ELIGIBLE type ("adr") so every pre-existing
 *   create/invalidate-sequencing test below is unaffected by the target-type
 *   precheck this task adds — tests exercising the precheck itself pass an explicit
 *   `getResult` (an ineligible type, or an `err()` for "target does not resolve").
 */
function makeDeps(
  createResult: Result<DocRecord, LoreError>,
  invalidateResult: Result<InvalidateResult, LoreError>,
  getResult: Result<{ doc: Pick<DocRecord, "type"> }, LoreError> = ok({ doc: { type: "adr" as const } }),
): {
  deps: SupersedeOrchestrationDeps;
  createMock: ReturnType<typeof vi.fn>;
  invalidateMock: ReturnType<typeof vi.fn>;
  getMock: ReturnType<typeof vi.fn>;
} {
  const getMock = vi.fn(async (_idOrSlug: string) => getResult);
  const createMock = vi.fn(async (_input: CreateDocInput) => createResult);
  const invalidateMock = vi.fn(async (_idOrSlug: string, _opts: InvalidateOpts) => invalidateResult);
  return {
    deps: { get: getMock, create: createMock, invalidate: invalidateMock },
    createMock,
    invalidateMock,
    getMock,
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

// ─── NEGATIVE (b): target-type precheck — task-mcp-lore-create-supersedes-still-
// creates-then-fails-the's AC1, exercised at the shared-flow level ────────────

describe("createWithSupersedes — NEGATIVE (target-type precheck, AC1)", () => {
  it("resolved target's type is OUTSIDE SUPERSEDE_CREATE_ELIGIBLE_TYPES → err(VALIDATION_ERROR) naming the type; create()/invalidate() NEVER called", async () => {
    // Sanity: "task" really is outside the eligible set — a self-check against the
    // real exported constant, not a hardcoded assumption about it.
    expect(SUPERSEDE_CREATE_ELIGIBLE_TYPES.has("task")).toBe(false);

    const { deps, createMock, invalidateMock, getMock } = makeDeps(
      ok(makeDoc()),
      ok({ doc: makeDoc() }),
      ok({ doc: { type: "task" } }),
    );

    const result = await createWithSupersedes(deps, CREATE_INPUT, "task-cannot-be-superseded", "alice");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("supersedes");
    expect(result.error.value).toBe("task");
    expect(result.error.message).toContain("task");
    expect(result.error.message).toContain("supersedes");
    expect(getMock).toHaveBeenCalledWith("task-cannot-be-superseded");
    // The load-bearing assertion (mirrors AC1's "assert the doc count is
    // unchanged" at the corpus level): nothing downstream of the precheck runs.
    expect(createMock).not.toHaveBeenCalled();
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

// ─── BOUNDARY (b): target does not resolve at all ────────────────────────────

describe("createWithSupersedes — BOUNDARY (target does not resolve)", () => {
  it("get() itself fails (DOC_NOT_FOUND) → err() propagated untouched, create()/invalidate() NEVER called", async () => {
    const getErr: LoreError = { code: "DOC_NOT_FOUND", id: "knowledge-does-not-exist" };
    const { deps, createMock, invalidateMock } = makeDeps(ok(makeDoc()), ok({ doc: makeDoc() }), err(getErr));

    const result = await createWithSupersedes(deps, CREATE_INPUT, "knowledge-does-not-exist", "alice");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(getErr);
    expect(createMock).not.toHaveBeenCalled();
    expect(invalidateMock).not.toHaveBeenCalled();
  });
});

// ─── CONTROL: a blanket-refuse regression cannot pass as green ───────────────

describe("createWithSupersedes — CONTROL (type-eligible targets still reach create()/invalidate())", () => {
  it.each([...SUPERSEDE_CREATE_ELIGIBLE_TYPES])(
    "target type %s (an ELIGIBLE type) proceeds past the precheck to create()/invalidate()",
    async (eligibleType) => {
      const newDoc = makeDoc();
      const { deps, createMock, invalidateMock } = makeDeps(
        ok(newDoc),
        ok({ doc: makeDoc() }),
        ok({ doc: { type: eligibleType } }),
      );

      const result = await createWithSupersedes(deps, CREATE_INPUT, `${eligibleType}-old`, "alice");

      expect(result.ok).toBe(true);
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(invalidateMock).toHaveBeenCalledTimes(1);
    },
  );
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

// ─── AC4: SUPERSEDE_CREATE_ELIGIBLE_TYPES is declared in exactly one module ──
//
// Structural source scan (mirrors barrel-isolation.test.ts's import-closure scan
// style) over packages/lore/src and packages/core/src — the two source trees a
// future adapter (CLI/MCP today, anything else tomorrow) could live in. Keys on the
// DECLARATION form (`const SUPERSEDE_CREATE_ELIGIBLE_TYPES`), not a bare substring
// count, per this repo's own "contiguous-substring assumption" standing lesson: a
// bare-substring count would also match the (legitimate, out-of-anchor) prose
// mentions in service/validity-service.ts and core/schemas.ts that merely NAME the
// shared constant in a doc comment — those are pointers TO the SSOT, not
// re-implementations of it, and must not fail this assertion.

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const LORE_SRC = resolve(__dirname, "../../../src");
const CORE_SRC = resolve(__dirname, "../../../../core/src");
const DECLARATION_PATTERN = /\bconst\s+SUPERSEDE_CREATE_ELIGIBLE_TYPES\b/;

describe("SUPERSEDE_CREATE_ELIGIBLE_TYPES — single-declaration-module invariant (AC4)", () => {
  it("is DECLARED in exactly one module across packages/lore/src and packages/core/src — the shared flow — so a future adapter cannot silently re-implement it", () => {
    const allFiles = [...collectTsFiles(LORE_SRC), ...collectTsFiles(CORE_SRC)];
    const declaringFiles = allFiles.filter((file) => DECLARATION_PATTERN.test(readFileSync(file, "utf8")));

    expect(declaringFiles).toHaveLength(1);
    expect(declaringFiles[0]!.replace(/\\/g, "/")).toMatch(/\/flows\/supersede-flow\.ts$/);
  });

  it("control: the bare identifier is named in MORE than one file (prose pointers in validity-service.ts/schemas.ts) — proves the declaration-vs-mention distinction is doing real work, not vacuously passing on an empty haystack", () => {
    const allFiles = [...collectTsFiles(LORE_SRC), ...collectTsFiles(CORE_SRC)];
    const bareMentionFiles = allFiles.filter((file) =>
      readFileSync(file, "utf8").includes("SUPERSEDE_CREATE_ELIGIBLE_TYPES"),
    );

    expect(bareMentionFiles.length).toBeGreaterThan(1);
  });

  it("sanity check: the scanner actually walked a non-trivial tree (not a false-pass on an empty directory)", () => {
    const allFiles = [...collectTsFiles(LORE_SRC), ...collectTsFiles(CORE_SRC)];
    expect(allFiles.length).toBeGreaterThan(50);
  });
});
