/**
 * store-shared.ts — SSOT helpers shared by SQLiteStore and TursoStore.
 *
 * Contains:
 *  - Raw DB row interfaces (DocRow, LinkRow, VersionRow, AuditRow, FtsRow)
 *  - Row → domain record mappers (rowToDocRecord, etc.)
 *  - parseJson, wrapStoreError utilities
 *
 * Design contract:
 *  - Both stores share these types/functions — no duplication
 *  - Row types represent the raw column layout from the database
 *  - Mappers are pure functions with no side effects
 *
 * Source: SPEC-002 §7.1; SPEC-009 §3.1
 */

import type {
  AuditEntry,
  CalibrationRecord,
  CheckResult,
  DocRecord,
  DocStatus,
  DocType,
  LinkRecord,
  LinkType,
  ReviewJudgment,
  ReviewJudgmentKind,
  ReviewReason,
  SearchHit,
  SupersededCandidate,
  VersionRecord,
} from "@lore/core";
import {
  err,
  extractValidity,
  SNIPPET_MARK_CLOSE,
  SNIPPET_MARK_OPEN,
  type LoreError,
  type Result,
} from "@lore/core";

// ─── Raw DB row types ──────────────────────────────────────────────────────

/**
 * Raw row from the `docs` table.
 * Shared between SQLiteStore (bun:sqlite) and TursoStore (@libsql/client).
 * Numeric fields (version) may be bigint from libsql — callers MUST use Number().
 */
export interface DocRow {
  id: string;
  slug: string;
  type: string;
  role: string;
  title: string;
  status: string;
  priority: string;
  content: string;
  parent_id: string | null;
  extra: string;
  tags: string;
  version: number | bigint;
  created_at: string;
  updated_at: string;
  created_by: string;
  deleted_at: string | null;
}

export interface LinkRow {
  from_id: string;
  to_id: string;
  link_type: string;
  created_at: string;
  created_by: string;
}

export interface VersionRow {
  doc_id: string;
  version: number | bigint;
  content: string;
  extra: string;
  status: string;
  title: string;
  action: string;
  created_at: string;
  created_by: string;
  change_summary: string | null;
  /** SPEC-072 D2 — nullable; NULL on legacy pre-migration-007 rows. */
  slug: string | null;
}

export interface AuditRow {
  timestamp: string;
  actor: string;
  session_id: string;
  action: string;
  doc_id: string | null;
  details: string;
}

/**
 * Raw row from the `docs_fts` search join.
 * `type`/`status` are the docs-table columns joined in alongside id/slug/title
 * (SPEC-037 §2 D5) so `SearchHit` can carry them with zero extra queries.
 * `created_at`/`extra` are the SAME joined-in `docs` columns, added SPEC-043 D3 so
 * `SearchHit.validity` can be computed with zero N+1 per-hit fetches (review S3).
 */
export interface FtsRow {
  id: string;
  slug: string;
  title: string;
  snippet: string;
  rank: number | bigint;
  type: string;
  status: string;
  created_at: string;
  extra: string;
}

/**
 * Raw row from the `review_judgments` table (migration-003.ts, SPEC-034 §3).
 * `judge_provider`/`judge_model`/`judge_prompt_version` are denormalized
 * columns mirroring `ReviewJudgment.judge` — no separate judges table.
 */
export interface JudgmentRow {
  id: string;
  doc_id: string;
  doc_version: number | bigint;
  decision: string;
  confidence: number;
  reasons: string;
  checks: string;
  blocking_questions: string;
  judge_provider: string;
  judge_model: string;
  judge_prompt_version: string;
  /** `'review' | 'staleness'` — NOT NULL DEFAULT 'review' since migration-005.ts (SPEC-044 D3). */
  kind: string;
  /** JSON `SupersededCandidate` or NULL — nullable column since migration-005.ts (SPEC-044 D5/D11). */
  superseded_candidate: string | null;
  created_at: string;
  created_by: string;
}

/** Raw row from the `calibration_records` table (migration-003.ts, SPEC-034 §3). */
export interface CalibrationRow {
  id: string;
  judgment_id: string;
  doc_id: string;
  doc_type: string;
  human_outcome: string;
  delta_reasons: string;
  actor: string;
  created_at: string;
}

/**
 * A {@link CalibrationRow} augmented with `judge_prompt_version` AND `judge_kind`,
 * projected by `queryCalibrationWindow`'s UNCONDITIONAL join to `review_judgments`
 * (see `StoreInterface.CalibrationRecordWithPromptVersion`). `judge_kind` was added
 * SPEC-044 D12/AC-SP-11 — `computeCalibrationStats`'s group key joins on it so review
 * and staleness calibrations never pool into one Wilson bound even under the same
 * `(doc_type, prompt_version)` pair.
 */
export interface CalibrationRowWithPromptVersion extends CalibrationRow {
  judge_prompt_version: string;
  judge_kind: string;
}

// ─── JSON helpers ──────────────────────────────────────────────────────────

export function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Like {@link parseJson} but for an OPTIONAL nullable column (e.g.
 * `review_judgments.superseded_candidate`) — `null`/`undefined`/malformed JSON all
 * degrade to `undefined` rather than a fallback value, matching `extractValidity`'s
 * "absence is not an error" contract.
 */
export function parseJsonOptional<T>(raw: string | null | undefined): T | undefined {
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

// ─── Row mappers ───────────────────────────────────────────────────────────

/**
 * Maps a raw {@link FtsRow} (the `docs_fts ⋈ docs` search join row) to a
 * {@link SearchHit}, including the SPEC-043 D3 narrow `validity` projection —
 * parsed from the SAME joined `extra` JSON column, never a per-hit `store.find`
 * (review S3's "no N+1" constraint). Shared by SQLiteStore and TursoStore so this
 * projection logic exists exactly once.
 */
export function rowToSearchHit(row: FtsRow): SearchHit {
  const extra = parseJson<Record<string, unknown>>(row.extra, {});
  const validity = extractValidity({ extra });
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    // reason: row.snippet is raw snippet() output over the CJK bigram-expanded
    // fts_content/fts_title shadow columns (migration-008) — collapse back to
    // prose for display. See collapseCjkBigramSnippet's JSDoc. ASCII-only
    // snippets short-circuit inside the helper and come back byte-identical.
    snippet: collapseCjkBigramSnippet(row.snippet ?? ""),
    score: typeof row.rank === "bigint" ? Number(row.rank) : row.rank,
    type: row.type as DocType,
    status: row.status as DocStatus,
    created_at: row.created_at,
    ...(validity !== undefined ? { validity } : {}),
  };
}

export function rowToDocRecord(row: DocRow): DocRecord {
  return {
    id: row.id,
    slug: row.slug,
    type: row.type as DocRecord["type"],
    role: row.role as DocRecord["role"],
    title: row.title,
    status: row.status as DocRecord["status"],
    priority: row.priority as DocRecord["priority"],
    content: row.content,
    parent_id: row.parent_id,
    extra: parseJson(row.extra, {}),
    tags: parseJson(row.tags, []),
    version: Number(row.version),
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by,
    deleted_at: row.deleted_at,
  };
}

export function rowToLinkRecord(row: LinkRow): LinkRecord {
  return {
    from_id: row.from_id,
    to_id: row.to_id,
    link_type: row.link_type as LinkType,
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

export function rowToVersionRecord(row: VersionRow): VersionRecord {
  return {
    doc_id: row.doc_id,
    version: Number(row.version),
    content: row.content,
    extra: parseJson(row.extra, {}),
    status: row.status as VersionRecord["status"],
    title: row.title,
    action: row.action as VersionRecord["action"],
    created_at: row.created_at,
    created_by: row.created_by,
    ...(row.change_summary !== null
      ? { change_summary: row.change_summary }
      : {}),
    // reason: SPEC-072 D1 — absence-tolerant. NULL (legacy row, or a
    // deliberately slug-less sentinel like the delete version-0 row) never
    // becomes a placeholder string; the key is omitted entirely.
    ...(row.slug !== null ? { slug: row.slug } : {}),
  };
}

export function rowToAuditEntry(row: AuditRow): AuditEntry {
  return {
    timestamp: row.timestamp,
    actor: row.actor,
    session_id: row.session_id,
    action: row.action,
    ...(row.doc_id !== null ? { doc_id: row.doc_id } : {}),
    details: parseJson(row.details, {}),
  };
}

/**
 * Maps a raw `review_judgments` row to a ReviewJudgment. Reassembles `judge` from its 3
 * denormalized columns. `kind` reads as `'review'` via `??` when the stored value is
 * undefined (SPEC-044 D3/review S10 — a direct-`insertJudgment` legacy/test fixture that
 * bypasses `reviewJudgmentSchema`'s own `.default("review")`), NEVER a strict-equality
 * check against `'review'` — the DB column itself is `NOT NULL DEFAULT 'review'` post
 * migration-005.ts, so this `??` is defense-in-depth for InMemoryStore/direct-insert
 * paths, not something the SQL layer can actually produce `undefined`/`null` for.
 */
export function rowToReviewJudgment(row: JudgmentRow): ReviewJudgment {
  const supersededCandidate = parseJsonOptional<SupersededCandidate>(row.superseded_candidate);
  return {
    id: row.id,
    doc_id: row.doc_id,
    doc_version: Number(row.doc_version),
    decision: row.decision as ReviewJudgment["decision"],
    confidence: row.confidence,
    reasons: parseJson<ReviewReason[]>(row.reasons, []),
    checks: parseJson<CheckResult[]>(row.checks, []),
    blocking_questions: parseJson<string[]>(row.blocking_questions, []),
    judge: {
      provider: row.judge_provider,
      model: row.judge_model,
      prompt_version: row.judge_prompt_version,
    },
    kind: (row.kind as ReviewJudgmentKind | undefined) ?? "review",
    ...(supersededCandidate !== undefined ? { superseded_candidate: supersededCandidate } : {}),
    created_at: row.created_at,
    created_by: row.created_by,
  };
}

/** Maps a raw `calibration_records` row to a CalibrationRecord. */
export function rowToCalibrationRecord(row: CalibrationRow): CalibrationRecord {
  return {
    id: row.id,
    judgment_id: row.judgment_id,
    doc_id: row.doc_id,
    doc_type: row.doc_type as DocType,
    human_outcome: row.human_outcome as CalibrationRecord["human_outcome"],
    delta_reasons: parseJson<string[]>(row.delta_reasons, []),
    actor: row.actor,
    created_at: row.created_at,
  };
}

/**
 * Maps a raw `calibration_records` ⋈ `review_judgments` row (the projection
 * `queryCalibrationWindow` now always selects) to a CalibrationRecord carrying
 * the judgment's real `judge_prompt_version` — see
 * `StoreInterface.CalibrationRecordWithPromptVersion`. This is what lets
 * `JudgmentService.computeCalibrationStats` group by the actual
 * (doc_type, prompt_version) pair instead of an unpinned `"*"` sentinel.
 */
export function rowToCalibrationRecordWithPromptVersion(
  row: CalibrationRowWithPromptVersion,
): CalibrationRecord & { judge_prompt_version: string; judge_kind: ReviewJudgmentKind } {
  return {
    ...rowToCalibrationRecord(row),
    judge_prompt_version: row.judge_prompt_version,
    // reason: same `?? 'review'` defense-in-depth as rowToReviewJudgment (SPEC-044 D12/S10).
    judge_kind: (row.judge_kind as ReviewJudgmentKind | undefined) ?? "review",
  };
}

// ─── Error helpers ──────────────────────────────────────────────────────────

export function wrapStoreError(e: unknown): Result<never, LoreError> {
  const message =
    e instanceof Error ? e.message : "Unknown store error";
  if (e instanceof Error) {
    return err({ code: "STORE_ERROR", message, cause: e });
  }
  return err({ code: "STORE_ERROR", message });
}

// ─── CJK bigram expansion for FTS5 (unicode61 contiguous-run limitation) ───
//
// unicode61 (FTS5's default tokenizer) treats CJK Unified Ideographs as
// token characters, so a contiguous run with no ASCII/whitespace separator
// tokenizes as ONE whole-run token — "量化交易策略" indexes as a single
// 6-char token, not the 2-char words a Chinese query actually types. A
// trigram tokenizer was evaluated and REJECTED (orchestrator decision,
// task-fts5-cjk-search-returns-zero-hits-unicode61-tokenizes): it cannot
// match a 2-char query, and 2-char words are the dominant Chinese query
// shape. Overlapping CJK BIGRAMS, expanded into separate space-delimited
// tokens BEFORE unicode61 ever sees the text, fix this without touching the
// tokenizer: "交易策略" → "交易 易策 策略" indexes as three real tokens,
// each independently matchable.

/**
 * CJK Unified Ideographs range (U+4E00–U+9FFF) — mirrors `@lore/core`'s
 * `CJK_CHAR_PATTERN` (`packages/core/src/slugify-node.ts`, SPEC-068)
 * character-for-character. Deliberately duplicated rather than imported:
 * that constant lives behind the `@lore/core/node` subpath (grouped there
 * because its sibling export `getTransliterateCjk` pulls in the ~931KB
 * `pinyin-pro` dependency), and the store layer — bun-only already, but with
 * no other reason to reach across that subpath boundary — has nothing to
 * gain from taking on that reachability. If the upstream range ever changes,
 * this must change with it; there is no automated parity check between the
 * two, so a maintainer touching one must know to check the other.
 */
const CJK_RUN_PATTERN = /[一-鿿]+/g;

/**
 * Splits a maximal CJK run into overlapping bigrams: `"交易策略"` (4 chars)
 * → `["交易", "易策", "策略"]` (3 bigrams, `run.length - 1`). The overlap is
 * what preserves contiguity information — the SAME sequence of adjacent
 * pairs is produced whether this runs over a document (for indexing) or a
 * query piece (for phrase-matching), so a query phrase built from a
 * sub-sequence of a document's bigrams is guaranteed to appear as a
 * consecutive run in that document's index. Pure/no side effects. Not
 * exported — callers go through {@link expandCjkForFts} or the query-side
 * expansion in {@link escapeFtsQuery}, both of which handle the
 * run.length === 1 case (a lone CJK char never becomes a bigram) before
 * reaching this helper.
 */
function toBigrams(run: string): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < run.length - 1; i++) {
    bigrams.push(run.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * Expands every maximal contiguous CJK run of length ≥2 in `text` into
 * space-separated overlapping bigrams, in place — non-CJK spans (ASCII
 * words, punctuation, whitespace, other scripts) and lone (length-1) CJK
 * runs pass through byte-identical. This is the SHADOW-COLUMN transform:
 * `SQLiteStore`/`TursoStore` compute `expandCjkForFts(title|content|tagsJson)`
 * at every doc INSERT/UPDATE and persist the result into the `fts_title` /
 * `fts_content` / `fts_tags` columns migration-008 adds to `docs` — those
 * shadow columns, not the real `title`/`content`/`tags`, are what
 * `docs_fts`'s external-content binding indexes (see migration-008.ts's
 * module JSDoc for why the FTS5 table itself had to be redefined against
 * them, not just fed different trigger values).
 *
 * A pure-ASCII `text` is returned UNCHANGED (no CJK run exists to expand),
 * which is what keeps ASCII search/ranking byte-identical to pre-migration
 * behavior even though every doc now carries these shadow columns.
 *
 * @param text - Raw title, content, or JSON-stringified tags-array text.
 * @returns `text` with every CJK run of length ≥2 bigram-expanded.
 * @example
 *   expandCjkForFts("量化交易策略")        // => "量化 化交 交易 易策 策略"
 *   expandCjkForFts("SPEC-078 多项目支持") // => "SPEC-078 多项 项目 目支 支持"
 *   expandCjkForFts("交")                  // => "交" (length-1 run, unchanged)
 *   expandCjkForFts("append-only")         // => "append-only" (no CJK, unchanged)
 */
export function expandCjkForFts(text: string): string {
  if (text === "") return text;
  return text.replace(CJK_RUN_PATTERN, (run) =>
    run.length === 1 ? run : toBigrams(run).join(" "),
  );
}

/**
 * Computes the three `fts_*` shadow-column values that MUST accompany every
 * `docs` row INSERT/UPDATE in both `SQLiteStore` and `TursoStore` — see
 * {@link expandCjkForFts}'s JSDoc for the mechanism. Centralized here so the
 * ~6 write sites across both stores (insert/update × conditional/
 * unconditional × provenance-wrapped) compute this identically; a call site
 * that skips this produces silently-stale CJK search for whatever it wrote.
 *
 * `tagsJson` is the ALREADY-`JSON.stringify`-d `tags` column value — both
 * stores compute that once for the real `tags` column already; pass the
 * SAME string here rather than re-stringifying. This mirrors a pre-existing
 * (unrelated to this change) property of the FTS5 setup: the `tags` shadow
 * has always indexed the raw JSON array text, brackets/quotes and all
 * (unicode61 treats them as token separators, so this has always
 * effectively indexed each tag word) — this function preserves that
 * behavior for the CJK-expanded copy rather than redesigning it.
 *
 * @param title - The doc's `title` column value.
 * @param content - The doc's `content` column value.
 * @param tagsJson - The doc's `tags` column value (JSON-stringified array).
 * @returns The three shadow-column values, ready to bind into the SQL INSERT/UPDATE.
 */
export function computeFtsShadowValues(
  title: string,
  content: string,
  tagsJson: string,
): { fts_title: string; fts_content: string; fts_tags: string } {
  return {
    fts_title: expandCjkForFts(title),
    fts_content: expandCjkForFts(content),
    fts_tags: expandCjkForFts(tagsJson),
  };
}

// ─── CJK bigram snippet collapse (inverse of expandCjkForFts, display side) ─
//
// FTS5's `snippet()` returns a slice of the INDEXED column value verbatim —
// since docs_fts indexes the bigram-expanded `fts_*` shadow columns (not the
// real title/content/tags), a CJK hit's snippet renders as the raw shadow
// text: overlapping bigrams joined by literal spaces the indexer inserted
// (`"交易 易策 策略"`), not the original prose (`"交易策略"`). This section
// collapses that back for display — the store-layer inverse of
// {@link expandCjkForFts}, applied only to `snippet()` output, never to the
// real `title`/`content` columns (those are untouched by the shadow scheme).

/** The literal ellipsis text passed as `snippet()`'s 5th argument in both
 *  `sqlite-store.ts` and `turso-store.ts` — duplicated here (not imported;
 *  it's a SQL string literal, not a JS export) so the collapse parser can
 *  recognize truncation markers. If either SQL call site's ellipsis literal
 *  ever changes, this constant must change with it. */
const SNIPPET_ELLIPSIS = "...";

/** Non-global per-character existence probe — `CJK_RUN_PATTERN` is a `/g`
 *  pattern with mutable `lastIndex` state; reusing it for a plain `.test()`
 *  short-circuit would silently skip matches on the second-and-later call. */
const CJK_SINGLE_CHAR_PROBE = /[一-鿿]/;

/** Non-global sibling of {@link CJK_RUN_PATTERN} — extracts exactly the
 *  first CJK run within one already-decoration-stripped chunk. Kept as its
 *  own constant (rather than reusing the `/g` pattern with `.exec()`) for
 *  the same "no mutable `lastIndex` between calls" reason as
 *  {@link CJK_SINGLE_CHAR_PROBE}. */
const CJK_RUN_PATTERN_SINGLE = /[一-鿿]+/;

/**
 * One space-delimited piece of a `snippet()` result, fully decomposed into
 * FTS5's insertions (leading/trailing ellipsis, highlight marks) plus the
 * raw indexed text split into `prefix + core + suffix`, where `core` is the
 * (0, 1, or 2-char) CJK run found within that raw text and `prefix`/`suffix`
 * are whatever non-CJK text is glued directly onto it with NO space —
 * `expandCjkForFts` never inserts a separator between a CJK run and
 * whatever immediately precedes/follows it in the original document (only
 * BETWEEN bigrams of the SAME run), so a run ending right before punctuation
 * (`控制。`) or starting right after an opening quote (`「本周`) shows up as
 * one chunk with that punctuation fused on. Re-joining
 * `leadingEllipsis + prefix + hasOpenMark + core + hasCloseMark + suffix +
 * trailingEllipsis` in that order reproduces the original chunk exactly —
 * {@link parseSnippetChunk} and {@link renderSnippetToken} are inverses for
 * any token that ends up NOT part of a collapsed run.
 */
interface SnippetToken {
  leadingEllipsis: boolean;
  prefix: string;
  hasOpenMark: boolean;
  core: string;
  hasCloseMark: boolean;
  suffix: string;
  trailingEllipsis: boolean;
  isBigram: boolean;
}

/**
 * Splits one `snippet()`-output chunk (already isolated by splitting the
 * full result on `" "`) into decorations + `prefix`/`core`/`suffix`.
 *
 * Order matters: the ellipsis is spliced onto the OUTERMOST edges of the
 * WHOLE `snippet()` result (so it is stripped first, from each end of the
 * chunk — only the very first/last chunk of the whole result ever has one).
 * Highlight marks wrap the matched TOKEN specifically — i.e. the CJK
 * `core` — which is why they are located and removed by scanning the
 * REMAINING string for the sentinel character rather than assumed to sit at
 * the chunk's own edges: a matched token can still have punctuation glued
 * on past its closing mark (`<控制>。`), so "ends with the close mark" would
 * miss it. What's left after removing all four is the raw indexed text,
 * which {@link CJK_RUN_PATTERN_SINGLE} then splits into `prefix`/`core`/`suffix`.
 */
function parseSnippetChunk(chunk: string): SnippetToken {
  let s = chunk;
  let leadingEllipsis = false;
  if (s.startsWith(SNIPPET_ELLIPSIS)) {
    leadingEllipsis = true;
    s = s.slice(SNIPPET_ELLIPSIS.length);
  }
  let trailingEllipsis = false;
  if (s.endsWith(SNIPPET_ELLIPSIS)) {
    trailingEllipsis = true;
    s = s.slice(0, s.length - SNIPPET_ELLIPSIS.length);
  }

  let hasOpenMark = false;
  const openIdx = s.indexOf(SNIPPET_MARK_OPEN);
  if (openIdx !== -1) {
    hasOpenMark = true;
    s = s.slice(0, openIdx) + s.slice(openIdx + SNIPPET_MARK_OPEN.length);
  }
  let hasCloseMark = false;
  const closeIdx = s.indexOf(SNIPPET_MARK_CLOSE);
  if (closeIdx !== -1) {
    hasCloseMark = true;
    s = s.slice(0, closeIdx) + s.slice(closeIdx + SNIPPET_MARK_CLOSE.length);
  }

  // `s` is now the raw indexed text for this chunk, decoration-free.
  const runMatch = CJK_RUN_PATTERN_SINGLE.exec(s);
  let prefix = "";
  let core = "";
  let suffix = s;
  if (runMatch !== null) {
    const runStart = runMatch.index;
    const run = runMatch[0];
    // A run longer than 2 chars within one no-space chunk should not occur
    // (expandCjkForFts always space-joins bigrams within a single run of
    // length ≥3) — defensively cap `core` at 2 chars and fold any excess
    // into `suffix` as opaque literal text rather than lose or duplicate it.
    const coreLen = Math.min(run.length, 2);
    prefix = s.slice(0, runStart);
    core = run.slice(0, coreLen);
    suffix = run.slice(coreLen) + s.slice(runStart + run.length);
  }

  return {
    leadingEllipsis,
    prefix,
    hasOpenMark,
    core,
    hasCloseMark,
    suffix,
    trailingEllipsis,
    isBigram: core.length === 2,
  };
}

/** Re-assembles a {@link SnippetToken} that was NOT folded into a collapsed
 *  run back into its original chunk text — the inverse of
 *  {@link parseSnippetChunk} for the passthrough case. */
function renderSnippetToken(token: SnippetToken): string {
  return (
    (token.leadingEllipsis ? SNIPPET_ELLIPSIS : "") +
    token.prefix +
    (token.hasOpenMark ? SNIPPET_MARK_OPEN : "") +
    token.core +
    (token.hasCloseMark ? SNIPPET_MARK_CLOSE : "") +
    token.suffix +
    (token.trailingEllipsis ? SNIPPET_ELLIPSIS : "")
  );
}

/**
 * Collapses one maximal chain-compatible run of ≥2 bigram tokens
 * (`run[i].core[1] === run[i + 1].core[0]` for every adjacent pair — the
 * SAME overlap {@link toBigrams} guarantees within a single expanded CJK
 * run) back into the original `run.length + 1`-character prose substring.
 *
 * Each token `i` (0-indexed within `run`) covers collapsed character
 * positions `[i, i + 1]` (its first char at `i`, shared last char at
 * `i + 1` — the next token's first char). Decorations attach at those same
 * positions, in {@link parseSnippetChunk}'s canonical order:
 * `leadingEllipsis`, then `prefix`, then `hasOpenMark` insert immediately
 * BEFORE position `i`; `hasCloseMark`, then `suffix`, then `trailingEllipsis`
 * insert immediately AFTER position `i + 1`. Two different tokens never
 * target the same "before" (or same "after") slot — each token owns a
 * unique `i` — so insertion order across tokens is unambiguous. In
 * practice only the FIRST token of a run ever carries a non-empty `prefix`
 * and only the LAST ever carries a non-empty `suffix` (interior tokens are
 * always a pure 2-char bigram), but every token is handled uniformly here
 * rather than special-casing the ends.
 */
function collapseBigramRun(run: SnippetToken[]): string {
  const charCount = run.length + 1;
  const chars: string[] = new Array(charCount);
  chars[0] = run[0]!.core[0]!;
  chars[1] = run[0]!.core[1]!;
  for (let i = 1; i < run.length; i++) {
    chars[i + 1] = run[i]!.core[1]!;
  }

  const before: string[][] = Array.from({ length: charCount }, () => []);
  const after: string[][] = Array.from({ length: charCount }, () => []);
  for (let i = 0; i < run.length; i++) {
    const token = run[i]!;
    if (token.leadingEllipsis) before[i]!.push(SNIPPET_ELLIPSIS);
    if (token.prefix !== "") before[i]!.push(token.prefix);
    if (token.hasOpenMark) before[i]!.push(SNIPPET_MARK_OPEN);
    if (token.hasCloseMark) after[i + 1]!.push(SNIPPET_MARK_CLOSE);
    if (token.suffix !== "") after[i + 1]!.push(token.suffix);
    if (token.trailingEllipsis) after[i + 1]!.push(SNIPPET_ELLIPSIS);
  }

  let out = "";
  for (let p = 0; p < charCount; p++) {
    out += before[p]!.join("") + chars[p]! + after[p]!.join("");
  }
  return out;
}

/**
 * Collapses the overlapping-bigram artifacts a `snippet()` call produces
 * over the CJK bigram-expanded `fts_content`/`fts_title` shadow columns
 * (migration-008) back into ORIGINAL prose for display — the inverse
 * transform of {@link expandCjkForFts}, scoped to `snippet()` output only.
 *
 * `"…同步 步更 更新 新实 实测…"` → `"…同步更新实测…"`. Highlight marks
 * ({@link SNIPPET_MARK_OPEN}/{@link SNIPPET_MARK_CLOSE}) and the ellipsis
 * truncation marker are preserved at the position they annotate; punctuation
 * or ASCII glued directly onto a run's first/last bigram with no space
 * (`控制。`, `「本周`) rides along on that token's `prefix`/`suffix`. Two
 * adjacent CJK bigram tokens that do NOT overlap (`run[i].core[1] !==
 * run[i + 1].core[0]`) are genuinely separate matches (never produced by one
 * {@link expandCjkForFts} run) and are left space-separated, unmerged.
 *
 * Single CJK-char tokens and ASCII/punctuation tokens never have a 2-char
 * `core` and pass through byte-identical. A snippet with no CJK character
 * at all short-circuits before the split/rejoin machinery runs at all,
 * guaranteeing ASCII output stays byte-identical to the pre-migration-008
 * behavior.
 *
 * @param snippet - Raw `snippet()` SQL function output (already includes
 *   `SNIPPET_MARK_OPEN`/`CLOSE` highlight marks and `...` truncation text).
 * @returns `snippet` with bigram-expansion artifacts collapsed back to prose.
 * @example
 *   collapseCjkBigramSnippet("同步 步更 更新")        // => "同步更新"
 *   collapseCjkBigramSnippet("append-only version") // => "append-only version" (unchanged)
 */
export function collapseCjkBigramSnippet(snippet: string): string {
  if (!CJK_SINGLE_CHAR_PROBE.test(snippet)) return snippet;

  const chunks = snippet.split(" ");
  const tokens = chunks.map(parseSnippetChunk);
  const pieces: string[] = [];

  let i = 0;
  while (i < tokens.length) {
    const current = tokens[i]!;
    if (current.isBigram) {
      let j = i;
      while (
        j + 1 < tokens.length &&
        tokens[j + 1]!.isBigram &&
        tokens[j]!.core[1] === tokens[j + 1]!.core[0]
      ) {
        j++;
      }
      if (j > i) {
        pieces.push(collapseBigramRun(tokens.slice(i, j + 1)));
        i = j + 1;
        continue;
      }
    }
    pieces.push(renderSnippetToken(current));
    i++;
  }

  return pieces.join(" ");
}

/**
 * Wraps `s` as one FTS5 double-quoted phrase, doubling any embedded `"`
 * (FTS5 phrase-escape). Shared by both the plain (byte-identical-to-legacy)
 * ASCII path and the CJK bigram-phrase path in {@link escapeFtsQuery} below
 * so the quoting rule is written exactly once.
 */
function quoteFtsPhrase(s: string): string {
  return `"${s.replaceAll('"', '""')}"`;
}

/**
 * FTS5-ready expression for ONE whitespace-delimited query piece (the unit
 * {@link escapeFtsQuery} splits `raw` into). Walks `piece` run-by-run,
 * alternating non-CJK spans (quoted phrases, byte-identical to the pre-CJK
 * escaping rule) and CJK spans:
 *   - a length-1 CJK run becomes an UNQUOTED prefix bareword (`交*`) — FTS5
 *     prefix syntax is explicitly NOT honored inside quotes (the tokenizer
 *     would consume the literal `*`), and a single character only ever
 *     appears in the bigram index as the leading or trailing half of some
 *     bigram token, so a prefix match is what makes it findable at all;
 *   - a length-≥2 CJK run becomes ONE quoted phrase of its space-joined
 *     bigrams (`"量化 化交 交易"`, same {@link toBigrams} used on the
 *     document side) — FTS5 phrase-query semantics (consecutive tokens, in
 *     order) exactly recovers "these bigrams appeared contiguously", which
 *     is the whole reason the document-side expansion overlaps.
 *
 * A `piece` with NO CJK characters exercises the loop zero times and falls
 * straight to the trailing "remainder" branch, producing
 * `quoteFtsPhrase(piece)` — the EXACT pre-CJK expression. This is what pins
 * pure-ASCII query output byte-identical to the pre-change implementation.
 */
function expandFtsQueryPiece(piece: string): string {
  const segments: string[] = [];
  let consumed = 0;
  for (const match of piece.matchAll(CJK_RUN_PATTERN)) {
    const run = match[0];
    const runStart = match.index;
    if (runStart > consumed) {
      segments.push(quoteFtsPhrase(piece.slice(consumed, runStart)));
    }
    segments.push(run.length === 1 ? `${run}*` : quoteFtsPhrase(toBigrams(run).join(" ")));
    consumed = runStart + run.length;
  }
  if (consumed < piece.length) {
    segments.push(quoteFtsPhrase(piece.slice(consumed)));
  }
  return segments.join(" ");
}

// ─── FTS5 query escape ─────────────────────────────────────────────────────

/**
 * Escape an arbitrary user search string into a FTS5-safe MATCH expression.
 *
 * Algorithm:
 *   1. Trim input. If empty, return "".
 *   2. Split on whitespace (one or more) into pieces.
 *   3. Each piece is expanded via {@link expandFtsQueryPiece} — pure-ASCII
 *      pieces reduce to the ORIGINAL rule (replace internal `"` with `""`,
 *      wrap in `"…"`); pieces containing a CJK run additionally emit a
 *      bigram phrase (or prefix bareword for a lone CJK char) per the CJK
 *      bigram-shadow-index scheme — see {@link expandCjkForFts}'s JSDoc.
 *   4. Join pieces (and, within a mixed piece, its CJK/non-CJK segments)
 *      with single spaces.
 *
 * Semantics: the resulting expression is an AND of phrase/prefix terms (FTS5
 * default boolean operator between bare expressions is AND). Each ASCII
 * phrase is FTS5-tokenized internally — so `"append-only"` matches docs
 * containing the consecutive sequence "append" then "only", which is what
 * users with a hyphenated term in mind almost always want.
 *
 * Returns "" only when input was empty or whitespace-only. Callers MUST treat
 * empty input as a no-results query and short-circuit BEFORE passing to FTS5
 * MATCH — FTS5 errors on an empty MATCH expression.
 *
 * Note: InMemoryStore uses substring-based search and does NOT use this
 * function — its semantics intentionally diverge from FTS5 and are out of scope
 * for this escape mechanism.
 *
 * @example
 *   escapeFtsQuery("")                    === ""
 *   escapeFtsQuery("   ")                 === ""
 *   escapeFtsQuery("service")             === '"service"'
 *   escapeFtsQuery("service layer")       === '"service" "layer"'
 *   escapeFtsQuery("append-only version") === '"append-only" "version"'
 *   escapeFtsQuery('he said "hi"')        === '"he" "said" """hi"""'
 *   escapeFtsQuery("foo*")                === '"foo*"'
 *   escapeFtsQuery("(append)")            === '"(append)"'
 *   escapeFtsQuery("交易")                === '"交易"'   (2-char CJK run → 1 bigram phrase)
 *   escapeFtsQuery("量化交易")            === '"量化 化交 交易"'
 *   escapeFtsQuery("交")                  === '交*'      (lone CJK char → prefix bareword)
 *
 * Source: SPEC-013 §3.5 FTS5-special-token resilience; CJK bigram extension
 * per task-fts5-cjk-search-returns-zero-hits-unicode61-tokenizes.
 */
export function escapeFtsQuery(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";

  const pieces = trimmed.split(/\s+/);
  const escaped = pieces.map((piece) => expandFtsQueryPiece(piece));
  return escaped.join(" ");
}
