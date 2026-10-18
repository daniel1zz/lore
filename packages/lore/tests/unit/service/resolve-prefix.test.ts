/**
 * Unit tests for SPEC-065 D1/D2 — unique ID-prefix resolution in `resolveDoc`.
 *
 * `resolveDoc`/`resolveDocId` (packages/lore/src/service/resolve.ts) is the
 * SINGLE service-level helper every surface (CLI, MCP, HTTP) resolves an
 * id-or-slug argument through — so exercising it directly against
 * InMemoryStore is, by construction, also proof the MCP `lore_get` tool path
 * (and every other surface) inherits identical prefix-resolution behavior
 * (AC-065-7).
 *
 * Uses InMemoryStore — no file I/O, no SQLite dependency. Docs are inserted
 * directly via `store.insert` with HAND-CHOSEN ids so prefix collisions can
 * be constructed deterministically (a real corpus's ulidx-generated ids are
 * ULID-monotonic and essentially never collide on a 10-char prefix by
 * chance — the test needs to engineer the collision, not hope for one).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-065-1, AC-065-2, AC-065-3, AC-065-7 — SPEC-065 D1/D2
 */

import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { resolveDoc, resolveDocId } from "../../../src/service/resolve.js";
import { DOC_TYPE_ROLE_MAP } from "@lore/core";
import type { DocRecord, Slug } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

// ─── DocRecord factory ──────────────────────────────────────────────────────

function makeDoc(
  overrides: Partial<DocRecord> & { id: string; type: DocRecord["type"]; title: string; slug: string },
): DocRecord {
  const now = "2024-01-15T10:00:00.000Z";
  return {
    id: overrides.id,
    slug: overrides.slug as Slug,
    type: overrides.type,
    role: DOC_TYPE_ROLE_MAP[overrides.type],
    title: overrides.title,
    status: overrides.status ?? "draft",
    priority: overrides.priority ?? "medium",
    content: overrides.content ?? "# Default\n\nContent body.",
    parent_id: overrides.parent_id ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    created_by: overrides.created_by ?? "test-agent",
    version: overrides.version ?? 1,
    deleted_at: overrides.deleted_at ?? null,
    tags: overrides.tags ?? [],
    extra: overrides.extra ?? {},
  };
}

async function insertDoc(store: InMemoryStore, doc: DocRecord): Promise<DocRecord> {
  const result = await store.insert(doc);
  if (!result.ok) throw new Error(`store.insert failed: ${result.error.code}`);
  return result.value;
}

// A syntactically valid (Crockford base32) 26-char ULID shape, hand-built so
// tests can control the prefix precisely. Real ulidx output is uppercase.
const FULL_A = "01HXAAAAAAAAAAAAAAAAAAAAAA";
const FULL_B = "01HXAAAAAAAAAABBBBBBBBBBBB"; // shares FULL_A's first 10 chars
const FULL_UNIQUE = "01HXZZZZZZZZZZZZZZZZZZZZZZ";

describe("resolveDoc — SPEC-065 unique ID-prefix resolution", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("AC-065-1: a unique 10-char ID prefix resolves via resolveDoc", async () => {
    const store = actedStore(new InMemoryStore());
    const doc = await insertDoc(
      store,
      makeDoc({ id: FULL_UNIQUE, type: "prd", title: "Unique Doc", slug: "prd-unique-doc" }),
    );

    const prefix = FULL_UNIQUE.slice(0, 10);
    const result = await resolveDoc(store, prefix);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(doc.id);
  });

  it("AC-065-7: prefix resolution works through resolveDocId (the MCP-tool-consumed path) too", async () => {
    const store = actedStore(new InMemoryStore());
    await insertDoc(store, makeDoc({ id: FULL_UNIQUE, type: "spec", title: "MCP Path Doc", slug: "spec-mcp-path-doc" }));

    const prefix = FULL_UNIQUE.slice(0, 12);
    const result = await resolveDocId(store, prefix);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(FULL_UNIQUE);
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("AC-065-2: an ambiguous ID prefix returns VALIDATION_ERROR listing every candidate's full ID and slug", async () => {
    const store = actedStore(new InMemoryStore());
    await insertDoc(store, makeDoc({ id: FULL_A, type: "prd", title: "Doc A", slug: "prd-doc-a" }));
    await insertDoc(store, makeDoc({ id: FULL_B, type: "prd", title: "Doc B", slug: "prd-doc-b" }));

    const sharedPrefix = FULL_A.slice(0, 10); // matches both FULL_A and FULL_B
    const result = await resolveDoc(store, sharedPrefix);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.message).toContain(FULL_A);
    expect(result.error.message).toContain("prd-doc-a");
    expect(result.error.message).toContain(FULL_B);
    expect(result.error.message).toContain("prd-doc-b");
  });

  it("NEGATIVE: a hyphenated slug-shaped input never triggers prefix scanning (charset excludes hyphens)", async () => {
    const store = actedStore(new InMemoryStore());
    await insertDoc(store, makeDoc({ id: FULL_UNIQUE, type: "prd", title: "Some Doc", slug: "prd-some-doc" }));

    const result = await resolveDoc(store, "prd-nonexistent-slug");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
    if (result.error.code !== "DOC_NOT_FOUND") return;
    // hyphens are outside the ID-prefix charset — no truncation diagnostic
    expect(result.error.suggestions).toBeUndefined();
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("AC-065-3: a non-matching truncated-ID-shaped input returns NOT_FOUND with a truncation diagnostic naming 26-char full IDs", async () => {
    const store = actedStore(new InMemoryStore());
    await insertDoc(store, makeDoc({ id: FULL_UNIQUE, type: "prd", title: "Some Doc", slug: "prd-some-doc" }));

    const noMatchPrefix = "9ZZZZZ9999"; // prefix-shaped, matches nothing
    const result = await resolveDoc(store, noMatchPrefix);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
    if (result.error.code !== "DOC_NOT_FOUND") return;
    expect(result.error.suggestions?.length).toBeGreaterThan(0);
    const diagnostic = result.error.suggestions?.[0] ?? "";
    expect(diagnostic).toContain("26");
    expect(diagnostic).toContain(String(noMatchPrefix.length));
  });

  it("BOUNDARY: a 5-char input (below the 6-char prefix floor) is NOT treated as an ID prefix — plain NOT_FOUND, no diagnostic", async () => {
    const store = actedStore(new InMemoryStore());
    await insertDoc(store, makeDoc({ id: FULL_UNIQUE, type: "prd", title: "Some Doc", slug: "prd-some-doc" }));

    const result = await resolveDoc(store, "9ZZZZ"); // 5 chars, below the floor
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
    if (result.error.code !== "DOC_NOT_FOUND") return;
    expect(result.error.suggestions).toBeUndefined();
  });

  it("BOUNDARY: a full 26-char but non-existent ID is NOT re-scanned as a prefix — plain NOT_FOUND, no diagnostic", async () => {
    const store = actedStore(new InMemoryStore());
    await insertDoc(store, makeDoc({ id: FULL_UNIQUE, type: "prd", title: "Some Doc", slug: "prd-some-doc" }));

    const result = await resolveDoc(store, FULL_A); // syntactically a full ULID, but never inserted
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
    if (result.error.code !== "DOC_NOT_FOUND") return;
    expect(result.error.suggestions).toBeUndefined();
  });

  it("BOUNDARY: prefix matching is case-insensitive (a lowercase-typed prefix still resolves)", async () => {
    const store = actedStore(new InMemoryStore());
    const doc = await insertDoc(
      store,
      makeDoc({ id: FULL_UNIQUE, type: "prd", title: "Case Doc", slug: "prd-case-doc" }),
    );

    const lowercasePrefix = FULL_UNIQUE.slice(0, 10).toLowerCase();
    const result = await resolveDoc(store, lowercasePrefix);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(doc.id);
  });

  // ── ERROR ──────────────────────────────────────────────────────────────

  it("ERROR: a store.findByIdPrefix failure propagates as STORE_ERROR, never silently swallowed", async () => {
    const store = actedStore(new InMemoryStore());
    const brokenStore = Object.create(store, {
      findByIdPrefix: {
        value: () =>
          Promise.resolve({
            ok: false as const,
            error: { code: "STORE_ERROR" as const, message: "disk unreachable" },
          }),
      },
    }) as InMemoryStore;

    const result = await resolveDoc(brokenStore, "9ZZZZZ9999");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("STORE_ERROR");
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE: a soft-deleted doc's prefix is excluded — resolves as zero candidates (NOT_FOUND), not the deleted doc", async () => {
    const store = actedStore(new InMemoryStore());
    await insertDoc(
      store,
      makeDoc({
        id: FULL_UNIQUE,
        type: "prd",
        title: "Deleted Doc",
        slug: "prd-deleted-doc",
        deleted_at: "2024-02-01T00:00:00.000Z",
      }),
    );

    const prefix = FULL_UNIQUE.slice(0, 10);
    const result = await resolveDoc(store, prefix);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });

  it("STATE: a prefix ambiguous only because of a soft-deleted sibling resolves uniquely to the live doc", async () => {
    const store = actedStore(new InMemoryStore());
    const live = await insertDoc(
      store,
      makeDoc({ id: FULL_A, type: "prd", title: "Live Doc", slug: "prd-live-doc" }),
    );
    await insertDoc(
      store,
      makeDoc({
        id: FULL_B,
        type: "prd",
        title: "Deleted Sibling",
        slug: "prd-deleted-sibling",
        deleted_at: "2024-02-01T00:00:00.000Z",
      }),
    );

    const sharedPrefix = FULL_A.slice(0, 10);
    const result = await resolveDoc(store, sharedPrefix);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(live.id);
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: exact full-ULID resolution is untouched by the prefix addition", async () => {
    const store = actedStore(new InMemoryStore());
    const doc = await insertDoc(
      store,
      makeDoc({ id: FULL_UNIQUE, type: "prd", title: "Exact Doc", slug: "prd-exact-doc" }),
    );

    const result = await resolveDoc(store, FULL_UNIQUE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(doc.id);
  });

  it("REGRESSION: exact slug resolution is untouched by the prefix addition", async () => {
    const store = actedStore(new InMemoryStore());
    const doc = await insertDoc(
      store,
      makeDoc({ id: FULL_UNIQUE, type: "prd", title: "Slug Doc", slug: "prd-slug-doc" }),
    );

    const result = await resolveDoc(store, "prd-slug-doc");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe(doc.id);
  });
});
