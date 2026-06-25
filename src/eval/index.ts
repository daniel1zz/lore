/**
 * Eval module — public re-exports for all eval scenarios.
 *
 * Public surface:
 *   - runMigrationCoverage — migration coverage scenario (SPEC-013 §3.1)
 *   - runTreeConsistency — tree-consistency scenario (SPEC-013 §3.2)
 *   - runLinkIntegrity — link-integrity scenario (SPEC-013 §3.3)
 *   - runTypeDistribution — type-distribution scenario (SPEC-013 §3.4)
 *   - runFtsRecall — fts-recall scenario (SPEC-013 §3.5)
 *   - runPlaceholderParse — placeholder-parse scenario (SPEC-013 §3.6)
 *   - Result schemas and types for each scenario
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

export {
  runTreeConsistency,
  TreeConsistencyResultSchema,
  type TreeConsistencyResult,
} from "./scenarios/tree-consistency.js";

export {
  runLinkIntegrity,
  LinkIntegrityResultSchema,
  type LinkIntegrityResult,
} from "./scenarios/link-integrity.js";

export {
  runTypeDistribution,
  TypeDistributionResultSchema,
  DEFAULT_THRESHOLDS,
  type TypeDistributionResult,
  type TypeDistributionInput,
  type TypeThreshold,
} from "./scenarios/type-distribution.js";

export {
  runFtsRecall,
  FtsRecallResultSchema,
  FtsRecallInputSchema,
  DEFAULT_FTS_QUERIES,
  DEFAULT_RECALL_THRESHOLD,
  DEFAULT_TOP_K,
  type FtsRecallResult,
  type FtsRecallInput,
} from "./scenarios/fts-recall.js";

export {
  runPlaceholderParse,
  PlaceholderParseResultSchema,
  type PlaceholderParseResult,
} from "./scenarios/placeholder-parse.js";
