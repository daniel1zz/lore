/**
 * Eval module — public re-exports for all eval scenarios.
 *
 * Public surface:
 *   - runMigrationCoverage — migration coverage scenario
 *   - MigrationCoverageResult / MigrationCoverageResultSchema — result types
 *
 * Invariants:
 *   - Scenarios never throw; all errors are embedded in the result type
 *
 * Side-effect class: IO (depends on which scenario is invoked)
 *
 * Source: SPEC-013
 */

export {
  runMigrationCoverage,
  MigrationCoverageResultSchema,
  type MigrationCoverageResult,
} from "./scenarios/migration-coverage.js";
