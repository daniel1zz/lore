/**
 * Spec-kind mistyping heuristic — pure, deterministic, no AI.
 *
 * Backs `lore migrate spec-kind [--dry-run]` (SPEC-032 §3.4): flags `spec` docs
 * whose title/content strongly suggests `tech` or `design` but whose
 * `extra.spec_kind` is still the defaulted `"feature"` (or absent — pre-SPEC-032
 * rows never got the default backfilled). Deliberately regex-based rather than
 * an LLM classifier so the report is 100% reproducible and every flagged doc
 * carries the exact signal that fired (transparency over cleverness — SPEC-032
 * §3.4 design constraint).
 *
 * @invariant Title matches win over content matches — a spec titled
 *   "Dashboard Visual Redesign" with unrelated body text is still a `design`
 *   candidate. When both a tech and a design signal fire in the SAME field
 *   (title or content), `tech` wins — TECH_SIGNAL_PATTERN is checked first.
 *   This is an arbitrary but deterministic tie-break; callers needing the
 *   other order can special-case it, but no current caller does.
 * @invariant Never mutates or reads `extra.spec_kind` — that decision (is this
 *   doc a candidate at all) is the caller's (`SpecKindService.migrateSpecKind`),
 *   which knows the doc's current classification. This module only answers
 *   "what does the TEXT suggest", independent of current classification.
 * Source: SPEC-032 §3.4
 */

/**
 * Signals suggesting a spec is primarily a `tech` document — internal
 * architecture/infrastructure with no direct user-facing behavior.
 * Named (not inlined) so the CLI report can quote which pattern fired.
 */
export const TECH_SIGNAL_PATTERN =
  /\b(tech[- ]spec|architecture|schema|migration|storage|adapter|service layer|mechaniz\w*)\b/i;

/**
 * Signals suggesting a spec is primarily a `design` document — UI/UX/visual.
 */
export const DESIGN_SIGNAL_PATTERN =
  /\b(design[- ]spec|ui|ux|dashboard|visual|prototype|component)\b/i;

/** Which spec-kind the heuristic thinks a doc should be reclassified to. */
export type SpecKindHeuristicKind = "tech" | "design";

/** Which field (title takes precedence) supplied the matched signal. */
export type SpecKindHeuristicField = "title" | "content";

/**
 * One heuristic hit: the suggested kind, the literal substring that matched,
 * and which field it was found in.
 * @example { kind: "tech", signal: "architecture", matchedIn: "title" }
 */
export interface SpecKindHeuristicMatch {
  kind: SpecKindHeuristicKind;
  signal: string;
  matchedIn: SpecKindHeuristicField;
}

/**
 * Test a single field (title or content) against both signal patterns.
 * Returns the tech match if both fire (tech-wins tie-break), else whichever
 * fired, else null.
 */
function matchField(
  text: string,
  field: SpecKindHeuristicField,
): SpecKindHeuristicMatch | null {
  const techMatch = TECH_SIGNAL_PATTERN.exec(text);
  if (techMatch) {
    return { kind: "tech", signal: techMatch[0], matchedIn: field };
  }
  const designMatch = DESIGN_SIGNAL_PATTERN.exec(text);
  if (designMatch) {
    return { kind: "design", signal: designMatch[0], matchedIn: field };
  }
  return null;
}

/**
 * Detect whether a spec's title/content suggests a `tech` or `design`
 * classification. Title is checked first and wins outright over content —
 * a content-only match is only reported when the title has none.
 *
 * @param title - The spec doc's title.
 * @param content - The spec doc's body content.
 * @returns The strongest match, or null when neither pattern fires anywhere.
 * @example detectSpecKindSignal("Dashboard Visual Redesign", "...")
 *   → { kind: "design", signal: "Dashboard", matchedIn: "title" }
 */
export function detectSpecKindSignal(
  title: string,
  content: string,
): SpecKindHeuristicMatch | null {
  return matchField(title, "title") ?? matchField(content, "content");
}
