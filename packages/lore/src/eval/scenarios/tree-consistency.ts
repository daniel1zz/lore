/**
 * Eval scenario: tree-consistency.
 *
 * Validates the Lore corpus tree against three structural invariants:
 *   1. No orphan docs — every non-root doc must have a parent_id pointing
 *      to an existing, non-deleted document.
 *   2. No cycles — no parent chain may contain a cycle.
 *   3. No invalid parent types — every child's parent must satisfy
 *      PARENT_TYPE_CONTRACT (doc-type-rules.ts).
 *
 * Implementation delegates to app.treeCheckService.checkTree() with a
 * permissive minimal blueprint (prd root, no children required) to obtain
 * the full drift list, then counts drifts by kind.
 *
 * Public surface:
 *   - TreeConsistencyResultSchema — Zod schema (types derive via z.infer)
 *   - TreeConsistencyResult — type alias
 *   - runTreeConsistency(app) → Promise<TreeConsistencyResult>
 *
 * Invariants:
 *   - Never throws — store errors are returned as passed=false
 *   - Idempotent: same corpus state → same result
 *   - Uses only existing public APIs (treeCheckService.checkTree)
 *
 * Side-effect class: IO (reads from app's store, no writes)
 *
 * Source: SPEC-013 §3.2 (previously §7 Future Scenarios)
 */

import { z } from "zod";
import type { App } from "../../app.js";
import type { TreeBlueprint } from "@lore/core";

// ─── Permissive Blueprint ─────────────────────────────────────────────────────

/**
 * A minimal permissive blueprint that accepts any prd as root with no required
 * children. Passing this to checkTree() enables orphan, cycle, and misplaced
 * detection without triggering false "missing" drifts.
 *
 * reason: checkTree() requires a TreeBlueprint argument. Using a blueprint
 * that expects nothing (min=0 everywhere) avoids spurious missing/extra drifts
 * that would conflate structural violations with content policy violations.
 * We only care about orphans, cycles, and misplaced (= invalid parent types).
 */
const PERMISSIVE_BLUEPRINT: TreeBlueprint = {
  version: 1,
  root: {
    type: "prd",
    min: 0,
    max: null,
    children: [],
  },
};

// ─── Result Schema (Zod SSOT) ─────────────────────────────────────────────────

/**
 * Zod schema for a single invalid parent-type violation detail.
 */
const InvalidParentPairSchema = z.object({
  child_id: z.string(),
  parent_id: z.string(),
  child_type: z.string(),
  parent_type: z.string(),
});

/**
 * Zod schema for the tree-consistency eval result.
 * Types derive from this schema via z.infer — do not duplicate as an interface.
 *
 * @example
 * const result = await runTreeConsistency(app);
 * if (!result.passed) console.error("Orphans:", result.details.orphan_ids);
 */
export const TreeConsistencyResultSchema = z.object({
  /** Total non-deleted docs inspected by the tree check */
  total_docs: z.number().int().nonnegative(),
  /** Docs with parent_id pointing to a missing/deleted doc, or null for a non-root type */
  orphans: z.number().int().nonnegative(),
  /** Distinct parent-chain cycles detected */
  cycles: z.number().int().nonnegative(),
  /** Docs whose parent type violates PARENT_TYPE_CONTRACT */
  invalid_parent_types: z.number().int().nonnegative(),
  /** Wall-clock duration of the check in milliseconds */
  duration_ms: z.number(),
  /**
   * true iff orphans===0 && cycles===0 && invalid_parent_types===0.
   * Source: SPEC-013 §3.2
   */
  passed: z.boolean(),
  details: z.object({
    /** Up to 10 sampled orphan doc ids */
    orphan_ids: z.array(z.string()),
    /** Up to 10 sampled cycle paths (each is an ordered array of doc ids in the cycle) */
    cycle_paths: z.array(z.array(z.string())),
    /** All invalid parent-type pairs found */
    invalid_pairs: z.array(InvalidParentPairSchema),
  }),
});

export type TreeConsistencyResult = z.infer<typeof TreeConsistencyResultSchema>;

// ─── Main Eval Function ───────────────────────────────────────────────────────

/**
 * Run the tree-consistency eval scenario.
 *
 * Delegates to app.treeCheckService.checkTree() with a permissive blueprint,
 * then maps drift kinds to the three invariants (orphan, cycle, misplaced).
 * The total_docs count is derived from the drift analysis corpus size.
 *
 * Never throws — store failures are returned as passed=false.
 *
 * @param app - Wired App instance (treeCheckService must be available)
 * @returns Structured tree-consistency result
 *
 * @example
 * const result = await runTreeConsistency(app);
 * if (!result.passed) process.exit(1);
 */
export async function runTreeConsistency(app: App): Promise<TreeConsistencyResult> {
  const startMs = Date.now();

  // Get total_docs via corpusService.status() — reads store without extra queries
  const statusResult = await app.corpusService.status();
  const totalDocs = statusResult.ok ? statusResult.value.total_docs : 0;

  // Delegate structural check to treeCheckService with permissive blueprint.
  // reason: PERMISSIVE_BLUEPRINT (min=0 everywhere) suppresses missing/extra drifts
  // that would arise from content policy, not structural violations.
  const checkResult = await app.treeCheckService.checkTree(PERMISSIVE_BLUEPRINT);
  if (!checkResult.ok) {
    // Store error — cannot determine consistency
    return buildErrorResult(startMs);
  }

  const { drifts } = checkResult.value;

  // Count and sample orphans
  const orphanDrifts = drifts.filter((d) => d.kind === "orphan");
  const orphanIds = orphanDrifts
    .map((d) => d.actual?.id ?? "")
    .filter((id) => id !== "")
    .slice(0, 10);

  // Count and sample cycles
  const cycleDrifts = drifts.filter((d) => d.kind === "cycle");
  const cyclePaths = cycleDrifts
    .map((d) => d.blocked_by_cycles ?? [])
    .filter((path) => path.length > 0)
    .slice(0, 10);

  // Count and map misplaced drifts → invalid parent type pairs
  const misplacedDrifts = drifts.filter((d) => d.kind === "misplaced");
  const invalidPairs = misplacedDrifts
    .filter((d) => d.actual !== undefined)
    .map((d) => {
      // Extract child/parent types from the drift detail string.
      // Format: "<child_type> under <parent_type> (id=...) violates parent-type contract"
      // We parse this rather than re-querying the store.
      const detail = d.detail;
      const match = detail.match(/^(\w+) under (\w+)/);
      const childType = match?.[1] ?? d.actual?.type ?? "unknown";
      const parentType = match?.[2] ?? "unknown";
      return {
        child_id: d.actual!.id,
        parent_id: d.actual!.parent_id ?? "",
        child_type: childType,
        parent_type: parentType,
      };
    });

  const orphansCount = orphanDrifts.length;
  const cyclesCount = cycleDrifts.length;
  const invalidCount = misplacedDrifts.length;

  return TreeConsistencyResultSchema.parse({
    total_docs: totalDocs,
    orphans: orphansCount,
    cycles: cyclesCount,
    invalid_parent_types: invalidCount,
    duration_ms: Date.now() - startMs,
    passed: orphansCount === 0 && cyclesCount === 0 && invalidCount === 0,
    details: {
      orphan_ids: orphanIds,
      cycle_paths: cyclePaths as string[][],
      invalid_pairs: invalidPairs,
    },
  });
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

/**
 * Build a failed result when the store is unavailable.
 * All counts default to 0; passed=false signals the failure.
 *
 * @param startMs - Date.now() at scenario start
 */
function buildErrorResult(startMs: number): TreeConsistencyResult {
  // reason: eval must never throw (SPEC-013 §3); store errors become passed=false
  return TreeConsistencyResultSchema.parse({
    total_docs: 0,
    orphans: 0,
    cycles: 0,
    invalid_parent_types: 0,
    duration_ms: Date.now() - startMs,
    passed: false,
    details: { orphan_ids: [], cycle_paths: [], invalid_pairs: [] },
  });
}
