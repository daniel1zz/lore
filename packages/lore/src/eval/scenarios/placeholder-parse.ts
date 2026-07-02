/**
 * Eval scenario: placeholder-parse.
 *
 * Measures MDX placeholder resolution success rate across the entire corpus.
 * For each live document that contains self-closing MDX component tags
 * (<ComponentName ... />), calls OutlineService.resolve() and aggregates:
 *   - how many whitelisted components resolved successfully
 *   - how many unknown components were stripped (non-fatal warnings)
 *   - how many docs produced a resolution error
 *
 * Pass condition: unknown_warnings === 0 && resolution_errors === 0
 * Meaning: every placeholder in the corpus is a whitelisted component AND
 * its resolution did not produce a store error.
 *
 * Algorithm:
 *   1. corpusService.list({}) → live doc summaries (deleted docs already excluded)
 *   2. For each summary, corpusService.get(id) → full DocRecord with content
 *   3. Scan content with PLACEHOLDER_REGEX to detect docs with placeholders
 *   4. For docs with placeholders, call outlineService.resolve(doc)
 *   5. Accumulate resolved_total, unknown_warnings, resolution_errors
 *
 * Public surface:
 *   - PlaceholderParseResultSchema — Zod schema (SSOT)
 *   - PlaceholderParseResult — z.infer<typeof PlaceholderParseResultSchema>
 *   - runPlaceholderParse(app) → Promise<PlaceholderParseResult>
 *
 * Invariants:
 *   - Never throws — all errors surface as passed=false
 *   - Idempotent — read-only on corpusService + outlineService; no corpus mutations
 *   - A doc whose get() fails is skipped (not counted in docs_with_placeholders);
 *     the list-level failure (step 1) is the only fatal path (returns passed=false).
 *
 * Side-effect class: IO (reads from app's store, no writes)
 *
 * Source: SPEC-013 §7 row 2 (placeholder-parse scenario)
 */

import { z } from "zod";
import type { App } from "../../app.js";
import type { LoreError } from "@lore/core";

// ─── Placeholder Detection Regex ─────────────────────────────────────────────

/**
 * Matches self-closing MDX component tags: <ComponentName prop="val" />
 * Mirrors the COMPONENT_REGEX used in OutlineService so detection is consistent.
 * Capture groups: [1] component name, [2] props string (unused here — count only)
 *
 * reason: must reset lastIndex=0 before each use because RegExp with /g flag is
 * stateful; sharing a single instance across doc iterations would produce skipped
 * matches after a non-exhausted iteration. See SPEC-013 §7.
 */
const PLACEHOLDER_REGEX = /<([A-Z][A-Za-z0-9]*)(\s[^>]*)?\s*\/>/g;

// ─── Result Schema (Zod SSOT) ─────────────────────────────────────────────────

/**
 * Zod schema for a single placeholder-parse eval result.
 * Types derive from this schema via z.infer — never duplicate as a separate interface.
 *
 * @example
 * const result = await runPlaceholderParse(app);
 * if (!result.passed) console.error("Unknown components:", result.details.unknown_components);
 */
export const PlaceholderParseResultSchema = z.object({
  /** Total live documents scanned (excludes soft-deleted) */
  total_docs_scanned: z.number().int().nonnegative(),
  /** Docs whose content contained at least one placeholder regex match */
  docs_with_placeholders: z.number().int().nonnegative(),
  /**
   * Sum of all regex hits across all scanned docs (pre-resolution count).
   * Counts individual tag occurrences, not unique component names.
   */
  total_placeholders_found: z.number().int().nonnegative(),
  /**
   * Sum of successfully resolved (whitelisted) components across all docs.
   * Aggregated from resolvedComponents.length returned by OutlineService.resolve().
   */
  resolved_total: z.number().int().nonnegative(),
  /**
   * Sum of unknown-component-stripped warnings across all resolved docs.
   * Non-zero means at least one tag was an unrecognized (non-whitelisted) component.
   * Source: SPEC-013 §7 pass condition — must be 0 to pass.
   */
  unknown_warnings: z.number().int().nonnegative(),
  /**
   * Number of docs whose outlineService.resolve() returned an error Result.
   * Typically caused by store errors during component data lookup.
   * Source: SPEC-013 §7 pass condition — must be 0 to pass.
   */
  resolution_errors: z.number().int().nonnegative(),
  /** Wall-clock duration of the full scenario in milliseconds */
  duration_ms: z.number(),
  /**
   * true iff unknown_warnings === 0 && resolution_errors === 0.
   * Meaning: every placeholder is a whitelisted component AND resolved without error.
   * Source: SPEC-013 §7 — "all known placeholders resolve"
   */
  passed: z.boolean(),
  details: z.object({
    /**
     * Up to 10 unknown component occurrences (by encounter order).
     * Populated from ResolutionWarning.component per warning per doc.
     */
    unknown_components: z.array(
      z.object({
        doc_id: z.string(),
        component: z.string(),
      }),
    ),
    /**
     * Up to 10 docs whose resolve() returned an error Result.
     * Populated from LoreError.code + LoreError.message.
     */
    resolution_error_docs: z.array(
      z.object({
        doc_id: z.string(),
        error_code: z.string(),
        message: z.string(),
      }),
    ),
  }),
});

/**
 * Inferred type for a placeholder-parse eval result.
 * Derived from PlaceholderParseResultSchema — do not maintain a separate interface.
 */
export type PlaceholderParseResult = z.infer<typeof PlaceholderParseResultSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Count all placeholder regex hits in a content string.
 * Resets lastIndex before scanning to avoid stale state from a prior iteration.
 *
 * @param content - Raw document content
 * @returns Number of self-closing MDX component tag matches
 */
function countPlaceholderHits(content: string): number {
  PLACEHOLDER_REGEX.lastIndex = 0;
  let count = 0;
  while (PLACEHOLDER_REGEX.exec(content) !== null) {
    count += 1;
  }
  return count;
}

/**
 * Return true if the content contains at least one MDX placeholder tag.
 * Resets lastIndex before testing to ensure consistent detection.
 *
 * @param content - Raw document content
 */
function hasMdxPlaceholders(content: string): boolean {
  PLACEHOLDER_REGEX.lastIndex = 0;
  return PLACEHOLDER_REGEX.test(content);
}

// ─── Error message extraction ────────────────────────────────────────────────

/**
 * Extract a human-readable message from any LoreError variant.
 * LoreError is a discriminated union — only STORE_ERROR and VALIDATION_ERROR carry
 * a `message` field. Other variants encode their context in type-specific fields.
 *
 * @param error - Any LoreError variant
 * @returns Best-effort display message string
 */
function loreErrorMessage(error: LoreError): string {
  if (error.code === "STORE_ERROR" || error.code === "VALIDATION_ERROR") {
    return error.message;
  }
  // For other error codes, derive a message from the structured fields.
  // reason: LoreError is a closed union — exhaustive handling avoids "as string" casts
  // and ensures tsc catches any new variants added to the union.
  switch (error.code) {
    case "DOC_NOT_FOUND":
      return `doc not found: ${error.id}`;
    case "SLUG_NOT_FOUND":
      return `slug not found: ${error.slug}`;
    case "STALE_VERSION":
      return `stale version: expected ${error.expected}, got ${error.actual}`;
    case "SCHEMA_VIOLATION":
      return `schema violation on type ${error.type}: missing ${error.missing.join(", ")}`;
    case "LINK_CYCLE":
      return `link cycle: ${error.path.join(" → ")}`;
    case "DUPLICATE_SLUG":
      return `duplicate slug: ${error.slug}`;
    case "DUPLICATE_LINK":
      return `duplicate link: ${error.from} → ${error.to}`;
    case "DELETE_REQUIRES_CONFIRM":
      return `delete requires confirm: ${error.id}`;
    case "INVALID_TRANSITION":
      return `invalid transition: ${error.from} → ${error.to}`;
    case "PARENT_REQUIRED":
      return `parent required for type: ${error.type}`;
    case "INVALID_PARENT_TYPE":
      return `invalid parent type: ${error.child} under ${error.parent}`;
    case "AI_PROVIDER_ERROR":
      return `AI provider error: ${error.message}`;
    case "CLAIM_CONFLICT":
      return `claim conflict: held by ${error.holder} (${error.age_minutes}m ago)`;
  }
}

// ─── Zero-result shortcut ────────────────────────────────────────────────────

/**
 * Build the zero-count passed=true result (empty corpus or no docs with placeholders).
 * All numeric fields are 0; passed reflects the provided value.
 *
 * @param totalDocsScanned - Number of live docs scanned
 * @param startMs - Date.now() at scenario start, used to compute duration_ms
 * @param passed - Pass/fail gate value for this result
 */
function buildZeroResult(
  totalDocsScanned: number,
  startMs: number,
  passed: boolean,
): PlaceholderParseResult {
  return PlaceholderParseResultSchema.parse({
    total_docs_scanned: totalDocsScanned,
    docs_with_placeholders: 0,
    total_placeholders_found: 0,
    resolved_total: 0,
    unknown_warnings: 0,
    resolution_errors: 0,
    duration_ms: Date.now() - startMs,
    passed,
    details: { unknown_components: [], resolution_error_docs: [] },
  });
}

// ─── Main Eval Function ───────────────────────────────────────────────────────

/**
 * Run the placeholder-parse eval scenario.
 *
 * Lists all live corpus documents, identifies those containing MDX placeholder
 * tags, then calls OutlineService.resolve() on each to measure resolution quality.
 * Never throws — store failures and resolution errors are captured in the result.
 *
 * @param app - Wired App instance (corpusService + outlineService must be available)
 * @returns Structured placeholder-parse result with pass/fail gate
 *
 * @example
 * const result = await runPlaceholderParse(app);
 * if (!result.passed) process.exit(1);
 */
export async function runPlaceholderParse(app: App): Promise<PlaceholderParseResult> {
  const startMs = Date.now();

  // ── Step 1: list all live docs ───────────────────────────────────────────
  // list({}) excludes soft-deleted docs (store.findMany adds deleted_at IS NULL by default)
  const listResult = await app.corpusService.list({});
  if (!listResult.ok) {
    // reason: list failure means we cannot determine the corpus state → passed=false
    // (SPEC-013 §3 — eval must never throw; store error becomes passed=false)
    return PlaceholderParseResultSchema.parse({
      total_docs_scanned: 0,
      docs_with_placeholders: 0,
      total_placeholders_found: 0,
      resolved_total: 0,
      unknown_warnings: 0,
      resolution_errors: 0,
      duration_ms: Date.now() - startMs,
      passed: false,
      details: { unknown_components: [], resolution_error_docs: [] },
    });
  }

  const summaries = listResult.value.docs;

  if (summaries.length === 0) {
    // Empty corpus — no placeholders possible → trivially passes
    return buildZeroResult(0, startMs, true);
  }

  // ── Step 2-5: fetch full content, detect placeholders, resolve ───────────
  let docsWithPlaceholders = 0;
  let totalPlaceholdersFound = 0;
  let resolvedTotal = 0;
  let unknownWarnings = 0;
  let resolutionErrors = 0;

  // Capped at 10 by encounter order (SPEC-013 §7 AC 4 details shape)
  const unknownComponents: Array<{ doc_id: string; component: string }> = [];
  const resolutionErrorDocs: Array<{ doc_id: string; error_code: string; message: string }> = [];

  for (const summary of summaries) {
    // Step 2: fetch full DocRecord (list returns DocSummary without content)
    const getResult = await app.corpusService.get(summary.id);
    if (!getResult.ok) {
      // reason: a single doc fetch failure is non-fatal — skip this doc and continue.
      // We do not count this as a resolution_error because the failure happened
      // before resolve() was called (it is a corpus fetch issue, not a placeholder issue).
      continue;
    }

    const { doc } = getResult.value;

    // Step 3: detect placeholder tags in content
    if (!hasMdxPlaceholders(doc.content)) {
      // No MDX placeholder tags — skip resolve() (no-op call avoided for performance)
      continue;
    }

    docsWithPlaceholders += 1;
    totalPlaceholdersFound += countPlaceholderHits(doc.content);

    // Step 4: resolve MDX placeholders via OutlineService
    const resolveResult = await app.outlineService.resolve(doc);

    if (!resolveResult.ok) {
      // Step 5a: resolution error (store error during component data lookup)
      resolutionErrors += 1;
      if (resolutionErrorDocs.length < 10) {
        resolutionErrorDocs.push({
          doc_id: doc.id,
          error_code: resolveResult.error.code,
          message: loreErrorMessage(resolveResult.error),
        });
      }
      continue;
    }

    // Step 5b: accumulate successful resolution metrics
    resolvedTotal += resolveResult.value.resolvedComponents.length;

    for (const warning of resolveResult.value.warnings) {
      unknownWarnings += 1;
      if (unknownComponents.length < 10) {
        unknownComponents.push({
          doc_id: doc.id,
          component: warning.component,
        });
      }
    }
  }

  const passed = unknownWarnings === 0 && resolutionErrors === 0;

  return PlaceholderParseResultSchema.parse({
    total_docs_scanned: summaries.length,
    docs_with_placeholders: docsWithPlaceholders,
    total_placeholders_found: totalPlaceholdersFound,
    resolved_total: resolvedTotal,
    unknown_warnings: unknownWarnings,
    resolution_errors: resolutionErrors,
    duration_ms: Date.now() - startMs,
    passed,
    details: {
      unknown_components: unknownComponents,
      resolution_error_docs: resolutionErrorDocs,
    },
  });
}
