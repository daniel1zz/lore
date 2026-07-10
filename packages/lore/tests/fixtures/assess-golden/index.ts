/**
 * Fixture registry for the `lore assess` golden harness (SPEC-040 §T3 D7).
 * `ASSESS_GOLDEN_FIXTURES` is a fixed array literal — its order IS the deterministic
 * listing order `scripts/assess-golden.ts --dry-run` prints (AC-ADF-7 "deterministic
 * order"). Do not sort dynamically at runtime; the array's declared order is the SSOT.
 */

import { cleanFullDeliveryFixture } from "./01-clean-full-delivery.js";
import { missingEvidenceFixture } from "./02-missing-evidence.js";
import { partialDanglingScopeFixture } from "./03-partial-dangling-scope.js";
import { attestedVsSelfReportedFixture } from "./04-attested-vs-self-reported.js";
import { specLessPlanFixture } from "./05-spec-less-plan.js";
import { truncationHeavyFixture } from "./06-truncation-heavy.js";
import type { AssessGoldenFixture } from "./types.js";

export type { AssessGoldenFixture } from "./types.js";

/**
 * Every registered golden fixture, in fixed deterministic order. Accrual note: this
 * set is SYNTHETIC/hand-designed; real point-in-time fixtures accrue separately via
 * `extra.assessment.source_versions` (persisted on every live `lore assess` run since
 * SPEC-040 §T2) — see README.md in this directory.
 */
export const ASSESS_GOLDEN_FIXTURES: readonly AssessGoldenFixture[] = [
  cleanFullDeliveryFixture,
  missingEvidenceFixture,
  partialDanglingScopeFixture,
  attestedVsSelfReportedFixture,
  specLessPlanFixture,
  truncationHeavyFixture,
];
