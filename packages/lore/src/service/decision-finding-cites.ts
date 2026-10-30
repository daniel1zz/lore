/**
 * Structured cites of a decision-recheck snapshot_accuracy failure (#500, BR-1379).
 *
 * Purpose: a snapshot_accuracy failure built from a wrong-when-written `decision_findings` entry is deterministic: it
 *   names its decision (`slug@version`), the premise part and the structured `source` it is about. Those become the
 *   finding's cites, so the root-cause fingerprint (`rootCauseOf`) keys on them instead of refusing a "cite-less" finding.
 * Public surface: {@link decisionFindingCites}, {@link withDecisionFindingCites}.
 * Invariants:
 *   - Only `wrong-when-written` findings (the kind that fails snapshot_accuracy, see `applyDecisionFindings`) cite.
 *   - Cites are the decision address, `<address> <part>` and the `source`'s address (file path, command, issue number or
 *     document slug); never the finding's wording, which is not read here, so a reworded re-review keeps one fingerprint.
 *   - A pure judge-text snapshot_accuracy failure is untouched: it still has no cite and is still refused.
 * Side-effect class: pure.
 */
import type { DecisionFinding, DecisionFindingSource, LlmMilestoneOutput } from "@lore/core";

/** The cite of a structured source: a file path, the command, `#<issue>` or the document slug (with version when pinned). */
function sourceCite(source: DecisionFindingSource): string {
  switch (source.kind) {
    case "file":
      return source.path;
    case "cmd":
      return source.command;
    case "issue":
      return `#${String(source.number)}`;
    case "doc":
      return source.version === undefined ? source.slug : `${source.slug}@${String(source.version)}`;
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

/**
 * The cites of the wrong-when-written findings: decision address, decision+part and the structured source address.
 *
 * @param findings - the re-check's findings
 * @returns sorted, de-duplicated cites; empty when no finding is wrong-when-written
 * @example
 * decisionFindingCites([{ decision: "d@2", part: "premise 1", kind: "wrong-when-written", fact: "x", source: { kind: "file", path: "a.ts" } }]);
 * // => ["a.ts", "d@2", "d@2 premise 1"]
 */
export function decisionFindingCites(findings: readonly DecisionFinding[]): string[] {
  const cites = new Set<string>();
  for (const f of findings) {
    if (f.kind !== "wrong-when-written") continue;
    cites.add(f.decision);
    cites.add(`${f.decision} ${f.part}`);
    if (f.source !== undefined) cites.add(sourceCite(f.source));
  }
  return [...cites].sort();
}

/**
 * Attach the decision findings' cites to a failed snapshot_accuracy. The cites replace any others: the failure is
 * measured, so its identity must not depend on whatever the judge cited.
 *
 * @param dimensions - the judgments after `applyDecisionFindings`
 * @param findings - the re-check's findings
 * @returns the same object when snapshot_accuracy did not fail or no finding cites
 */
export function withDecisionFindingCites(
  dimensions: LlmMilestoneOutput["dimensions"],
  findings: readonly DecisionFinding[],
): LlmMilestoneOutput["dimensions"] {
  const cites = decisionFindingCites(findings);
  if (cites.length === 0 || dimensions.snapshot_accuracy.verdict !== "fail") return dimensions;
  return { ...dimensions, snapshot_accuracy: { ...dimensions.snapshot_accuracy, cites } };
}
