/**
 * pending-output.test.ts — SPEC-065 D3, AC-065-4: `lore pending`'s table output
 * must contain the slug of every pending doc. `commands/pending.ts` transitively
 * imports `loader.ts` (`bun:sqlite`), which vitest cannot resolve, so this suite
 * exercises the pure unit `commands/pending.ts` calls verbatim:
 *   - `PENDING_TABLE_HEADERS` / `buildPendingTableRows`
 *     (`packages/lore/src/adapters/cli/pending-render.ts`) — same split pattern
 *     as `assess-render.ts`/`review-render.ts`/`seat-render.ts`.
 *   - `formatTable` (`packages/lore/src/adapters/cli/utils.ts`) — the SAME
 *     rendering `commands/pending.ts` pipes the built rows through, so this
 *     suite proves the actual printed table string, not just the row array.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-065-4 — SPEC-065 D3
 */

import { describe, it, expect } from "vitest";
import { PENDING_TABLE_HEADERS, buildPendingTableRows } from "../../../src/adapters/cli/pending-render.js";
import { formatTable } from "../../../src/adapters/cli/utils.js";
import type { PendingDoc } from "../../../src/service/review-service.js";
import type { ReviewJudgment } from "@lore/core";

function makePendingDoc(overrides: Partial<PendingDoc> & { id: string; slug: string }): PendingDoc {
  return {
    id: overrides.id,
    slug: overrides.slug,
    type: overrides.type ?? "prd",
    title: overrides.title ?? "Test Document",
    status: "draft",
    created_by: overrides.created_by ?? "agent:test",
    updated_at: overrides.updated_at ?? "2026-07-20T00:00:00.000Z",
    version: overrides.version ?? 1,
    ...(overrides.meta !== undefined ? { meta: overrides.meta } : {}),
    ...(overrides.validity !== undefined ? { validity: overrides.validity } : {}),
  };
}

describe("lore pending — table output (SPEC-065 D3)", () => {
  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("AC-065-4: the rendered table contains the slug of every pending doc", () => {
    const docs: PendingDoc[] = [
      makePendingDoc({ id: "01HZONEAAAAAAAAAAAAAAAAAAA", slug: "prd-first-doc", title: "First Doc" }),
      makePendingDoc({ id: "01HZTWOBBBBBBBBBBBBBBBBBBB", slug: "spec-second-doc", type: "spec", title: "Second Doc" }),
      makePendingDoc({ id: "01HZTHREECCCCCCCCCCCCCCCCC", slug: "adr-third-doc", type: "adr", title: "Third Doc" }),
    ];
    const judgments = new Map<string, ReviewJudgment | null>();

    const rendered = formatTable(PENDING_TABLE_HEADERS, buildPendingTableRows(docs, judgments));

    for (const doc of docs) {
      expect(rendered).toContain(doc.slug);
    }
  });

  it("AC-065-4: the row array carries the slug in its own column, position matches the header", () => {
    const docs: PendingDoc[] = [
      makePendingDoc({ id: "01HZONEAAAAAAAAAAAAAAAAAAA", slug: "prd-happy-path", title: "Happy Path Doc" }),
    ];
    const judgments = new Map<string, ReviewJudgment | null>();

    const slugColumnIndex = PENDING_TABLE_HEADERS.indexOf("Slug");
    expect(slugColumnIndex).toBeGreaterThanOrEqual(0);

    const rows = buildPendingTableRows(docs, judgments);
    expect(rows[0]?.[slugColumnIndex]).toBe("prd-happy-path");
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("NEGATIVE: an empty doc list produces zero data rows (headers only)", () => {
    const rows = buildPendingTableRows([], new Map());
    expect(rows).toEqual([]);
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: a slug longer than the ID column's 10-char truncation is NOT truncated (unlike the ID column)", () => {
    const longSlug = "prd-a-very-long-and-fully-descriptive-slug-title";
    const docs: PendingDoc[] = [
      makePendingDoc({ id: "01HZLONGSLUGAAAAAAAAAAAAAA", slug: longSlug, title: "Long Slug Doc" }),
    ];
    const rows = buildPendingTableRows(docs, new Map());
    const slugColumnIndex = PENDING_TABLE_HEADERS.indexOf("Slug");
    expect(rows[0]?.[slugColumnIndex]).toBe(longSlug);
  });

  it("BOUNDARY: the ID column stays truncated to 10 chars — D3 adds a column, does not widen the existing one", () => {
    const fullId = "01HZIDTRUNCATETESTAAAAAAAA";
    const docs: PendingDoc[] = [makePendingDoc({ id: fullId, slug: "prd-id-trunc-test" })];
    const rows = buildPendingTableRows(docs, new Map());
    expect(rows[0]?.[0]).toBe(fullId.slice(0, 10));
    expect(rows[0]?.[0]?.length).toBe(10);
  });

  // ── ERROR ──────────────────────────────────────────────────────────────

  it("ERROR: a doc id absent from the judgments map renders '[unreviewed]', never throws", () => {
    const docs: PendingDoc[] = [makePendingDoc({ id: "01HZNOJUDGMENTAAAAAAAAAAAA", slug: "prd-no-judgment" })];
    expect(() => buildPendingTableRows(docs, new Map())).not.toThrow();
    const rows = buildPendingTableRows(docs, new Map());
    const judgmentColumnIndex = PENDING_TABLE_HEADERS.indexOf("AI Judgment");
    expect(rows[0]?.[judgmentColumnIndex]).toBe("[unreviewed]");
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE: two docs sharing a common id prefix still render two DISTINCT, fully-resolvable slugs", () => {
    // Regression guard for the underlying P0-2 bug this task fixes: two docs
    // truncated to the same 10-char id prefix were indistinguishable in the
    // pre-D3 table. Post-D3, the slug column disambiguates them even when the
    // id column alone cannot.
    const docs: PendingDoc[] = [
      makePendingDoc({ id: "01HZSHAREDPREFIXAAAAAAAAAA", slug: "prd-doc-alpha", title: "Doc Alpha" }),
      makePendingDoc({ id: "01HZSHAREDPREFIXBBBBBBBBBB", slug: "prd-doc-beta", title: "Doc Beta" }),
    ];
    const rows = buildPendingTableRows(docs, new Map());
    const slugColumnIndex = PENDING_TABLE_HEADERS.indexOf("Slug");
    const slugs = rows.map((r) => r[slugColumnIndex]);
    expect(slugs).toEqual(["prd-doc-alpha", "prd-doc-beta"]);
    expect(new Set(slugs).size).toBe(2);
    // the id column, by contrast, IS identical for both rows (the whole reason
    // the slug column exists)
    expect(rows[0]?.[0]).toBe(rows[1]?.[0]);
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: --json output (PendingDoc itself) still carries every pre-existing field untouched", () => {
    const doc = makePendingDoc({
      id: "01HZJSONFIELDSAAAAAAAAAAAA",
      slug: "prd-json-fields",
      title: "JSON Fields Doc",
      created_by: "agent:tester",
      version: 3,
    });
    // slug is additive — every pre-existing PendingDoc field is untouched
    expect(doc.id).toBe("01HZJSONFIELDSAAAAAAAAAAAA");
    expect(doc.type).toBe("prd");
    expect(doc.title).toBe("JSON Fields Doc");
    expect(doc.status).toBe("draft");
    expect(doc.created_by).toBe("agent:tester");
    expect(doc.version).toBe(3);
    // and the new field is present
    expect(doc.slug).toBe("prd-json-fields");
  });

  it("REGRESSION: header order is unchanged for the pre-existing columns, Slug is inserted right after ID", () => {
    expect(PENDING_TABLE_HEADERS).toEqual([
      "ID",
      "Slug",
      "Type",
      "Title",
      "Author",
      "Updated",
      "Ver",
      "AI Judgment",
    ]);
  });
});

// ─── SPEC-043 D3 — [invalid] badge (task-lore-pending-does-not-filter-invalidated-docs-an) ───

describe("lore pending — [invalid] badge on the Title cell (SPEC-043 D3)", () => {
  const nowIso = "2026-07-26T00:00:00.000Z";

  // ── HAPPY ──────────────────────────────────────────────────────────────

  it("HAPPY: a doc carrying an already-past invalid_at renders the Title cell with an [invalid] suffix", () => {
    const docs: PendingDoc[] = [
      makePendingDoc({
        id: "01HZBADGEAAAAAAAAAAAAAAAAA",
        slug: "knowledge-invalid-doc",
        type: "knowledge",
        title: "Invalid Doc",
        validity: { invalid_at: "2026-06-01T00:00:00.000Z" },
      }),
    ];
    const rows = buildPendingTableRows(docs, new Map(), nowIso);
    const titleColumnIndex = PENDING_TABLE_HEADERS.indexOf("Title");
    expect(rows[0]?.[titleColumnIndex]).toBe("Invalid Doc [invalid]");
  });

  // ── NEGATIVE ───────────────────────────────────────────────────────────

  it("NEGATIVE: a doc whose validity.invalid_at is still in the future is NOT badged", () => {
    const docs: PendingDoc[] = [
      makePendingDoc({
        id: "01HZBADGEBBBBBBBBBBBBBBBBB",
        slug: "knowledge-future-invalid",
        type: "knowledge",
        title: "Future Invalidation",
        validity: { invalid_at: "2099-01-01T00:00:00.000Z" },
      }),
    ];
    const rows = buildPendingTableRows(docs, new Map(), nowIso);
    const titleColumnIndex = PENDING_TABLE_HEADERS.indexOf("Title");
    expect(rows[0]?.[titleColumnIndex]).toBe("Future Invalidation");
  });

  // ── BOUNDARY ───────────────────────────────────────────────────────────

  it("BOUNDARY: invalid_at exactly equal to nowIso IS badged (isInvalidated flips at equality)", () => {
    const docs: PendingDoc[] = [
      makePendingDoc({
        id: "01HZBADGECCCCCCCCCCCCCCCCC",
        slug: "knowledge-boundary-invalid",
        type: "knowledge",
        title: "Boundary Doc",
        validity: { invalid_at: nowIso },
      }),
    ];
    const rows = buildPendingTableRows(docs, new Map(), nowIso);
    const titleColumnIndex = PENDING_TABLE_HEADERS.indexOf("Title");
    expect(rows[0]?.[titleColumnIndex]).toBe("Boundary Doc [invalid]");
  });

  // ── ERROR ──────────────────────────────────────────────────────────────

  it("ERROR: a doc with no validity field at all renders without throwing and without a badge", () => {
    const docs: PendingDoc[] = [
      makePendingDoc({ id: "01HZBADGEDDDDDDDDDDDDDDDDD", slug: "prd-no-validity", title: "Plain Doc" }),
    ];
    expect(() => buildPendingTableRows(docs, new Map(), nowIso)).not.toThrow();
    const rows = buildPendingTableRows(docs, new Map(), nowIso);
    const titleColumnIndex = PENDING_TABLE_HEADERS.indexOf("Title");
    expect(rows[0]?.[titleColumnIndex]).toBe("Plain Doc");
  });

  // ── STATE ──────────────────────────────────────────────────────────────

  it("STATE: the SAME doc renders unbadged before its invalid_at and badged after, as nowIso moves forward", () => {
    const doc = makePendingDoc({
      id: "01HZBADGEEEEEEEEEEEEEEEEE",
      slug: "knowledge-state-doc",
      type: "knowledge",
      title: "State Doc",
      validity: { invalid_at: "2026-06-01T00:00:00.000Z" },
    });
    const titleColumnIndex = PENDING_TABLE_HEADERS.indexOf("Title");

    const before = buildPendingTableRows([doc], new Map(), "2026-05-01T00:00:00.000Z");
    expect(before[0]?.[titleColumnIndex]).toBe("State Doc");

    const after = buildPendingTableRows([doc], new Map(), "2026-07-01T00:00:00.000Z");
    expect(after[0]?.[titleColumnIndex]).toBe("State Doc [invalid]");
  });

  // ── REGRESSION ─────────────────────────────────────────────────────────

  it("REGRESSION: a non-invalidated doc's row is byte-identical whether or not an invalidated doc shares the same batch", () => {
    const plainDoc = makePendingDoc({
      id: "01HZBADGEFFFFFFFFFFFFFFFFF",
      slug: "prd-plain-doc",
      title: "Plain Batch Doc",
    });
    const invalidDoc = makePendingDoc({
      id: "01HZBADGEGGGGGGGGGGGGGGGGG",
      slug: "knowledge-invalid-sibling",
      type: "knowledge",
      title: "Invalid Sibling",
      validity: { invalid_at: "2026-06-01T00:00:00.000Z" },
    });

    const rowsAlone = buildPendingTableRows([plainDoc], new Map(), nowIso);
    const rowsWithSibling = buildPendingTableRows([plainDoc, invalidDoc], new Map(), nowIso);

    expect(rowsWithSibling[0]).toEqual(rowsAlone[0]);
  });

  it("REGRESSION: omitting nowIso still renders without throwing (default-now convenience path)", () => {
    const docs: PendingDoc[] = [
      makePendingDoc({ id: "01HZBADGEHHHHHHHHHHHHHHHHH", slug: "prd-default-now", title: "Default Now Doc" }),
    ];
    expect(() => buildPendingTableRows(docs, new Map())).not.toThrow();
  });
});
