/**
 * Eval scenario: type-distribution.
 *
 * Checks that each DocType's count in the corpus falls within configurable
 * min/max thresholds. Used to assert "is every type represented at a
 * reasonable level?" — e.g. at least one PRD and one spec must exist.
 *
 * Default thresholds (used when input is not provided):
 *   prd       min=1   (must have at least one PRD)
 *   spec      min=1   (must have at least one spec)
 *   adr       min=0   (ADRs are optional)
 *   plan      min=0
 *   knowledge min=0
 *   task      min=0
 *
 * Callers may supply custom thresholds; unknown types in thresholds are
 * reported as a violation with reason="unknown_type" rather than silently
 * skipped (fail loud — SPEC-013 §3 invariant).
 *
 * Public surface:
 *   - TypeThreshold — single threshold entry type
 *   - TypeDistributionInput — input config type
 *   - TypeDistributionResultSchema — Zod schema (z.infer derives the type)
 *   - TypeDistributionResult — type alias
 *   - DEFAULT_THRESHOLDS — exported default thresholds for test reference
 *   - runTypeDistribution(app, input?) → Promise<TypeDistributionResult>
 *
 * Invariants:
 *   - Never throws — store errors are returned as passed=false
 *   - Idempotent: same corpus state + same thresholds → same result
 *   - Unknown types in custom thresholds fail loud (not silent skip)
 *
 * Side-effect class: IO (reads from app's store, no writes)
 *
 * Source: SPEC-013 §3.4 (previously §7 Future Scenarios)
 */

import { z } from "zod";
import type { App } from "../../app.js";
import type { DocType } from "../../core/types.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * All valid DocType values — kept in sync with core/types.ts DocType union.
 * Used to validate custom threshold entries.
 * reason: importing the schema from core would pull in Zod overhead; a simple
 * Set is sufficient for a membership check here.
 */
const VALID_DOC_TYPES = new Set<string>(["prd", "spec", "adr", "plan", "knowledge", "task"]);

// ─── Input Types (Zod SSOT) ───────────────────────────────────────────────────

/**
 * Zod schema for a single type threshold entry.
 * At least one of min or max must be defined when used.
 */
export const TypeThresholdSchema = z.object({
  /** DocType to check */
  type: z.string(),
  /** Minimum count (inclusive). undefined = no minimum. */
  min: z.number().int().nonnegative().optional(),
  /** Maximum count (inclusive). undefined = no maximum. */
  max: z.number().int().nonnegative().optional(),
});

export type TypeThreshold = z.infer<typeof TypeThresholdSchema>;

/** Input config for runTypeDistribution. */
export const TypeDistributionInputSchema = z.object({
  thresholds: z.array(TypeThresholdSchema),
});

export type TypeDistributionInput = z.infer<typeof TypeDistributionInputSchema>;

// ─── Default Thresholds ───────────────────────────────────────────────────────

/**
 * Default thresholds applied when no custom thresholds are provided.
 * Requires at least one PRD and one spec; all other types optional.
 * Source: SPEC-013 §3.4
 */
export const DEFAULT_THRESHOLDS: readonly TypeThreshold[] = [
  { type: "prd", min: 1 },
  { type: "spec", min: 1 },
  { type: "adr", min: 0 },
  { type: "plan", min: 0 },
  { type: "knowledge", min: 0 },
  { type: "task", min: 0 },
] as const;

// ─── Result Schema (Zod SSOT) ─────────────────────────────────────────────────

/**
 * Describes a single threshold violation.
 */
const TypeViolationSchema = z.object({
  type: z.string(),
  actual: z.number().int().nonnegative(),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
  reason: z.enum(["below_min", "above_max", "unknown_type"]),
});

/**
 * Zod schema for the type-distribution eval result.
 * Types derive from this schema via z.infer — do not duplicate as an interface.
 *
 * @example
 * const result = await runTypeDistribution(app);
 * if (!result.passed) console.error("Violations:", result.violations);
 */
export const TypeDistributionResultSchema = z.object({
  /** Actual doc count per type in the live corpus */
  distribution: z.record(z.number()),
  /** Threshold violations found */
  violations: z.array(TypeViolationSchema),
  /** Wall-clock duration in milliseconds */
  duration_ms: z.number(),
  /**
   * true iff violations.length === 0.
   * Source: SPEC-013 §3.4
   */
  passed: z.boolean(),
});

export type TypeDistributionResult = z.infer<typeof TypeDistributionResultSchema>;

// ─── Main Eval Function ───────────────────────────────────────────────────────

/**
 * Run the type-distribution eval scenario.
 *
 * Counts live docs by type via corpusService.status(), then evaluates each
 * threshold entry. Custom thresholds with unknown DocType values produce a
 * violation with reason="unknown_type" (fail loud — not silently skipped).
 *
 * Never throws — store failures are returned as passed=false.
 *
 * @param app - Wired App instance (corpusService must be available)
 * @param input - Optional custom thresholds; defaults to DEFAULT_THRESHOLDS
 * @returns Structured type-distribution result
 *
 * @example
 * const result = await runTypeDistribution(app);
 * if (!result.passed) process.exit(1);
 *
 * @example
 * // Custom thresholds
 * const result = await runTypeDistribution(app, {
 *   thresholds: [{ type: "prd", min: 2, max: 5 }]
 * });
 */
export async function runTypeDistribution(
  app: App,
  input?: TypeDistributionInput,
): Promise<TypeDistributionResult> {
  const startMs = Date.now();

  const thresholds = input?.thresholds ?? DEFAULT_THRESHOLDS;

  // Get per-type counts via corpusService.status()
  const statusResult = await app.corpusService.status();
  if (!statusResult.ok) {
    return buildErrorResult(startMs);
  }

  // reason: by_type in status() reflects live (non-deleted) docs only,
  // matching the intent of "are each type represented at a reasonable level?"
  const distribution: Record<string, number> = { ...statusResult.value.by_type };

  const violations: Array<{
    type: string;
    actual: number;
    min?: number;
    max?: number;
    reason: "below_min" | "above_max" | "unknown_type";
  }> = [];

  for (const threshold of thresholds) {
    const docType = threshold.type;

    // Unknown type — fail loud rather than silently skip (SPEC-013 §3 invariant)
    if (!VALID_DOC_TYPES.has(docType)) {
      // reason: exactOptionalPropertyTypes requires conditional spread for optional fields
      violations.push({
        type: docType,
        actual: 0,
        ...(threshold.min !== undefined ? { min: threshold.min } : {}),
        ...(threshold.max !== undefined ? { max: threshold.max } : {}),
        reason: "unknown_type" as const,
      });
      continue;
    }

    const actual = distribution[docType] ?? 0;

    if (threshold.min !== undefined && actual < threshold.min) {
      // reason: exactOptionalPropertyTypes requires conditional spread for optional fields
      violations.push({
        type: docType,
        actual,
        min: threshold.min,
        ...(threshold.max !== undefined ? { max: threshold.max } : {}),
        reason: "below_min" as const,
      });
    } else if (threshold.max !== undefined && actual > threshold.max) {
      // reason: exactOptionalPropertyTypes requires conditional spread for optional fields
      violations.push({
        type: docType,
        actual,
        ...(threshold.min !== undefined ? { min: threshold.min } : {}),
        max: threshold.max,
        reason: "above_max" as const,
      });
    }
  }

  return TypeDistributionResultSchema.parse({
    distribution,
    violations,
    duration_ms: Date.now() - startMs,
    passed: violations.length === 0,
  });
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Build a failed result when the store is unavailable.
 * passed=false signals the failure.
 *
 * @param startMs - Date.now() at scenario start
 */
function buildErrorResult(startMs: number): TypeDistributionResult {
  // reason: eval must never throw (SPEC-013 §3); store errors become passed=false
  return TypeDistributionResultSchema.parse({
    distribution: {},
    violations: [],
    duration_ms: Date.now() - startMs,
    passed: false,
  });
}
