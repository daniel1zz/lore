/** @spec_ref task-fts5-cjk-search-returns-zero-hits-unicode61-tokenizes */
/**
 * Tests for CJK bigram FTS5 search — both the pure store-shared.ts helpers
 * (expandCjkForFts / escapeFtsQuery's CJK query expansion) and the
 * store-level effect (SQLiteStore.search actually returning CJK hits).
 *
 * Root cause this fixes: FTS5's default unicode61 tokenizer treats a
 * contiguous CJK run as ONE token, so `lore search 交易` returned zero hits
 * against a corpus whose titles contain 交易 even though `title LIKE
 * '%交易%'` matched real rows (2026-07-25 guyin UAT finding). Mechanism:
 * migration-008 CJK bigram shadow columns (see migration-008.ts +
 * store-shared.ts's `expandCjkForFts`/`computeFtsShadowValues` for the full
 * design).
 *
 * Run under `bun test` (not vitest) because the store-level section touches
 * real `bun:sqlite`.
 *
 * Six-dimension coverage:
 *   HAPPY:      title-hit, content-hit, and mixed CJK+ASCII fixtures all
 *               found by their respective CJK/ASCII queries
 *   NEGATIVE:   a doc whose bigrams overlap the query's characters only
 *               NON-contiguously does NOT match (交流贸易 vs query 交易)
 *   BOUNDARY:   a single-char CJK query (交) — the length-1-run prefix-query
 *               path, distinct from the length-≥2 phrase path
 *   ERROR:      n/a for the pure helpers (no invalid-input surface — every
 *               string is a valid string); store-level malformed input has
 *               its own coverage in fts-query.test.ts / sqlite-store tests
 *   STATE:      expandCjkForFts / escapeFtsQuery are pure — repeated calls
 *               with the same input produce identical output
 *   REGRESSION: pure-ASCII escapeFtsQuery output is BYTE-IDENTICAL to the
 *               pre-CJK-change table (ports fts-query.test.ts's exhaustive
 *               table as a pin specific to this change)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import {
  collapseCjkBigramSnippet,
  escapeFtsQuery,
  expandCjkForFts,
} from "../../../src/store/store-shared.js";
import { SNIPPET_MARK_CLOSE, SNIPPET_MARK_OPEN, type DocRecord } from "@lore/core";

// ─── Pure function tests: expandCjkForFts ──────────────────────────────────

describe("expandCjkForFts — pure bigram expansion", () => {
  it("HAPPY: a 6-char CJK run expands into 5 overlapping bigrams", () => {
    expect(expandCjkForFts("量化交易策略")).toBe("量化 化交 交易 易策 策略");
  });

  it("HAPPY: mixed ASCII + CJK — the CJK run is expanded in place, ASCII untouched", () => {
    expect(expandCjkForFts("SPEC-078 多项目支持")).toBe("SPEC-078 多项 项目 目支 支持");
  });

  it("BOUNDARY: a length-1 CJK run passes through unchanged (no bigram possible)", () => {
    expect(expandCjkForFts("交")).toBe("交");
  });

  it("BOUNDARY: a length-2 CJK run — the minimal bigram-eligible run — expands to exactly one bigram", () => {
    expect(expandCjkForFts("交易")).toBe("交易");
  });

  it("REGRESSION: pure-ASCII text is returned byte-identical (no CJK run exists to expand)", () => {
    expect(expandCjkForFts("append-only version")).toBe("append-only version");
  });

  it("BOUNDARY: empty string returns empty string", () => {
    expect(expandCjkForFts("")).toBe("");
  });

  it("NEGATIVE: two SEPARATE CJK runs (split by an ASCII separator) never produce a bigram spanning the gap", () => {
    const result = expandCjkForFts("交 易");
    // Each run is length-1 (交, 易) — neither becomes a bigram, and no
    // cross-gap bigram ("交易") is ever produced.
    expect(result).toBe("交 易");
    expect(result).not.toContain("交易");
  });

  it("STATE: pure function — same input always returns the same output", () => {
    const input = "量化交易策略";
    expect(expandCjkForFts(input)).toBe(expandCjkForFts(input));
  });
});

// ─── Pure function tests: escapeFtsQuery CJK query-side expansion ─────────

describe("escapeFtsQuery — CJK query expansion", () => {
  it("HAPPY: a 2-char CJK query becomes a single-bigram phrase", () => {
    expect(escapeFtsQuery("交易")).toBe('"交易"');
  });

  it("HAPPY: a 4-char CJK query becomes a 3-bigram phrase (preserves contiguity)", () => {
    expect(escapeFtsQuery("量化交易")).toBe('"量化 化交 交易"');
  });

  it("BOUNDARY: a single CJK character becomes an unquoted prefix bareword", () => {
    expect(escapeFtsQuery("交")).toBe("交*");
  });

  it("HAPPY: mixed CJK + ASCII words (space-separated) each get their own expression", () => {
    expect(escapeFtsQuery("SPEC-078 多项目")).toBe('"SPEC-078" "多项 项目"');
  });

  it("STATE: pure function — same input always returns the same output", () => {
    const input = "量化交易策略";
    expect(escapeFtsQuery(input)).toBe(escapeFtsQuery(input));
  });

  // ─── REGRESSION: ASCII byte-identity pin ─────────────────────────────────
  // Ports fts-query.test.ts's exhaustive table verbatim — this change must
  // not alter a single character of pure-ASCII output.
  it.each([
    ["", ""],
    ["   ", ""],
    ["service", '"service"'],
    ["service layer", '"service" "layer"'],
    ["append-only version", '"append-only" "version"'],
    ['he said "hi"', '"he" "said" """hi"""'],
    ["foo*", '"foo*"'],
    ["(append)", '"(append)"'],
    ["a:b", '"a:b"'],
  ])("REGRESSION: escapeFtsQuery(%j) === %j (byte-identical to pre-CJK-change)", (input, expected) => {
    expect(escapeFtsQuery(input)).toBe(expected);
  });
});

// ─── Pure function tests: collapseCjkBigramSnippet ─────────────────────────
//
// Byproduct-fix suite (task-search-snippets-render-bigram-expanded-shadow-text-tong-bu):
// snippet() generates from the bigram-expanded fts_content/fts_title shadow
// columns, so a raw CJK snippet shows overlapping-bigram artifacts
// ("同步 步更 更新") instead of the original prose ("同步更新").
// collapseCjkBigramSnippet is the store-layer inverse, applied to snippet()
// output only.

describe("collapseCjkBigramSnippet — pure bigram-run collapse", () => {
  it("HAPPY: a chain of overlapping bigrams collapses back to the original run", () => {
    expect(collapseCjkBigramSnippet("交易 易策 策略")).toBe("交易策略");
  });

  it("HAPPY: run-with-highlight-markers — marks + leading/trailing ellipsis all preserved at the position they annotate (mirrors real snippet() output, verified against a live bun:sqlite FTS5 query)", () => {
    // Real snippet(docs_fts, 1, MARK_OPEN, MARK_CLOSE, '...', 6) output for a
    // doc whose fts_content run is "量化 化交 交易 易策 策略 略的 的回…" when
    // the query phrase matches only the "交易" bigram: the window is
    // truncated on both sides (leading + trailing "...") and the single
    // matched token is wrapped.
    const raw =
      `...量化 化交 ${SNIPPET_MARK_OPEN}交易${SNIPPET_MARK_CLOSE} 易策 策略 略的...`;
    const collapsed = collapseCjkBigramSnippet(raw);
    expect(collapsed).toBe(
      `...量化${SNIPPET_MARK_OPEN}交易${SNIPPET_MARK_CLOSE}策略的...`,
    );
    // The marker chars themselves are never dropped.
    expect(collapsed).toContain(SNIPPET_MARK_OPEN);
    expect(collapsed).toContain(SNIPPET_MARK_CLOSE);
    // No character from the original run is duplicated.
    expect(collapsed.split(SNIPPET_MARK_OPEN).join("").split(SNIPPET_MARK_CLOSE).join("")).toBe(
      "...量化交易策略的...",
    );
  });

  it("HAPPY: a multi-token phrase match wraps the WHOLE matched span with ONE open + ONE close mark (SQLite's own snippet() convention, not per-token)", () => {
    const raw =
      `本周 周关 关注 注量 量化 化交 ${SNIPPET_MARK_OPEN}交易 易策 策略${SNIPPET_MARK_CLOSE} 略的`;
    expect(collapseCjkBigramSnippet(raw)).toBe(
      `本周关注量化${SNIPPET_MARK_OPEN}交易策略${SNIPPET_MARK_CLOSE}的`,
    );
  });

  it("BOUNDARY: single CJK char tokens pass through untouched (never a bigram, never merged with a neighbor)", () => {
    expect(collapseCjkBigramSnippet("交")).toBe("交");
    expect(collapseCjkBigramSnippet("交 易")).toBe("交 易");
  });

  it("REGRESSION: ASCII-only snippet text is returned byte-identical (no CJK run exists to collapse)", () => {
    expect(collapseCjkBigramSnippet("append-only version")).toBe("append-only version");
    expect(collapseCjkBigramSnippet("...append-only version...")).toBe(
      "...append-only version...",
    );
  });

  it("HAPPY: mixed CJK + ASCII — the CJK run collapses, the ASCII word is untouched", () => {
    expect(collapseCjkBigramSnippet("SPEC-078 多项 项目 目支 支持")).toBe(
      "SPEC-078 多项目支持",
    );
  });

  it("NEGATIVE: two genuinely SEPARATE CJK bigram tokens that do NOT overlap stay space-separated (never merge into one run)", () => {
    // "交易" ends in 易, "策略" starts with 策 — no overlap, so these can only
    // be two distinct original words, not one expandCjkForFts run.
    const result = collapseCjkBigramSnippet("交易 策略");
    expect(result).toBe("交易 策略");
    expect(result).not.toBe("交易策略");
  });

  it("STATE: pure function — same input always returns the same output", () => {
    const input = "量化 化交 交易 易策 策略";
    expect(collapseCjkBigramSnippet(input)).toBe(collapseCjkBigramSnippet(input));
  });

  it("BOUNDARY: empty string returns empty string", () => {
    expect(collapseCjkBigramSnippet("")).toBe("");
  });
});

// ─── Store-level tests: SQLiteStore.search actually returns CJK hits ──────

let _counter = 0;
function nextId(): string {
  _counter += 1;
  return `01HCJKFTS${String(_counter).padStart(16, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> = {}): DocRecord {
  _counter += 1;
  return {
    id: nextId(),
    slug: `prd-cjk-fts-${_counter}`,
    type: "prd",
    role: "intent",
    title: "Untitled",
    status: "draft",
    priority: "medium",
    content: "",
    parent_id: null,
    extra: {},
    tags: [],
    version: 1,
    created_at: "2026-07-25T00:00:00.000Z",
    updated_at: "2026-07-25T00:00:00.000Z",
    created_by: "agent:test",
    deleted_at: null,
    ...overrides,
  };
}

describe("SQLiteStore.search — CJK bigram hits (store-level)", () => {
  let tempDir: string;
  let store: SQLiteStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "lore-cjk-fts-"));
    store = new SQLiteStore(join(tempDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("HAPPY: title-hit — a doc titled 量化交易策略 is returned for query 交易", async () => {
    const doc = makeDoc({ title: "量化交易策略" });
    await store.insert(doc);

    const result = await store.search("交易");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((h) => h.id)).toContain(doc.id);
  });

  it("HAPPY: content-hit — a doc whose CONTENT (not title) contains 交易 is returned for query 交易", async () => {
    const doc = makeDoc({
      title: "Trading Research Notes",
      content: "本周关注量化交易策略的回撤控制。",
    });
    await store.insert(doc);

    const result = await store.search("交易");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((h) => h.id)).toContain(doc.id);
  });

  it("HAPPY: mixed CJK+ASCII — a doc titled 'SPEC-078 多项目支持' is found by BOTH 多项目 and SPEC-078", async () => {
    const doc = makeDoc({ title: "SPEC-078 多项目支持" });
    await store.insert(doc);

    const cjkResult = await store.search("多项目");
    expect(cjkResult.ok).toBe(true);
    if (cjkResult.ok) expect(cjkResult.value.map((h) => h.id)).toContain(doc.id);

    const asciiResult = await store.search("SPEC-078");
    expect(asciiResult.ok).toBe(true);
    if (asciiResult.ok) expect(asciiResult.value.map((h) => h.id)).toContain(doc.id);
  });

  it("BOUNDARY: a single-char CJK query (交) hits a doc via prefix match on a bigram starting with that char", async () => {
    const doc = makeDoc({ title: "量化交易策略" });
    await store.insert(doc);

    const result = await store.search("交");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((h) => h.id)).toContain(doc.id);
  });

  it("NEGATIVE: a doc whose CJK run is 交流贸易 does NOT match query 交易 (bigrams never overlap contiguously)", async () => {
    const doc = makeDoc({ title: "交流贸易" });
    await store.insert(doc);

    const result = await store.search("交易");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((h) => h.id)).not.toContain(doc.id);
  });

  it("REGRESSION: an ASCII-only doc is still found by an ASCII query (CJK migration didn't break plain search)", async () => {
    const doc = makeDoc({ title: "Plain English Title", content: "append-only version history" });
    await store.insert(doc);

    const result = await store.search("append-only");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((h) => h.id)).toContain(doc.id);
  });

  it("HAPPY: snippet output collapses bigram-expansion artifacts back into original prose (no bare 'XY ZW'-overlap pattern survives)", async () => {
    const doc = makeDoc({
      title: "Trading Research Notes",
      content: "本周关注量化交易策略的回撤控制。",
    });
    await store.insert(doc);

    const result = await store.search("交易策略");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.value.find((h) => h.id === doc.id);
    expect(hit).toBeDefined();
    if (!hit) return;

    // The original contiguous substring is present once highlight marks
    // (which legitimately wrap only the matched span, e.g.
    // "…量化<mark>交易策略</mark>的回撤…") are stripped back out — a caller
    // rendering the snippet strips/replaces these the same way.
    const plain = hit.snippet.split(SNIPPET_MARK_OPEN).join("").split(SNIPPET_MARK_CLOSE).join("");
    expect(plain.includes("量化交易策略")).toBe(true);
    // No leftover bigram-overlap artifact (two adjacent 2-char CJK groups
    // joined by a bare space) remains anywhere in the collapsed run — this
    // fixture's content has no real internal space, so any such pattern
    // would be an uncollapsed artifact, not a genuine word boundary.
    expect(plain).not.toMatch(/[一-鿿]{2} [一-鿿]{2}/);
  });

  it("STATE: a doc RENAMED from ASCII to CJK becomes findable by the new CJK title (update() also writes shadow columns)", async () => {
    const doc = makeDoc({ title: "Placeholder Title" });
    await store.insert(doc);

    const beforeRename = await store.search("交易");
    expect(beforeRename.ok).toBe(true);
    if (beforeRename.ok) expect(beforeRename.value.map((h) => h.id)).not.toContain(doc.id);

    const updateResult = await store.update(doc.id, { title: "量化交易策略" });
    expect(updateResult.ok).toBe(true);

    const afterRename = await store.search("交易");
    expect(afterRename.ok).toBe(true);
    if (afterRename.ok) expect(afterRename.value.map((h) => h.id)).toContain(doc.id);
  });
});
