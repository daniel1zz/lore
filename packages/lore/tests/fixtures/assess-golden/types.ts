/**
 * Shared type for one `lore assess` golden fixture (SPEC-040 §T3 D7).
 *
 * A fixture is a synthetic, hand-designed `PlanBundle` snapshot paired with a
 * human-judged `expectedLabel` — the coarse outcome a reasonable judge SHOULD reach
 * given the materials. `scripts/assess-golden.ts --dry-run` lists every fixture's name
 * + expected label without invoking any provider; scored mode runs each fixture N
 * times per prompt version through a live provider and compares the resulting
 * majority label (`@lore/../ai/assess-golden-aggregation.ts`) against `expectedLabel`.
 */

import type { PlanBundle } from "@lore/core";
import type { GoldenDirectionLabel } from "../../../src/ai/assess-golden-aggregation.js";

export interface AssessGoldenFixture {
  /** Short, stable, kebab-case identifier — used as the dry-run listing key. */
  name: string;
  /** One-sentence description of what this fixture probes (printed in --dry-run output). */
  description: string;
  /** The coarse outcome a reasonable judge should reach given this fixture's materials. */
  expectedLabel: GoldenDirectionLabel;
  /** Synthetic {plan, spec?, tasks[], knowledge_links?} snapshot fed to the judge prompt. */
  bundle: PlanBundle;
  /** Optional diff text attached to this fixture's assess run. */
  diffText?: string;
}
