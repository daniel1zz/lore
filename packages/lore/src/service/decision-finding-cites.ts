/**
 * Structured cites of a decision-recheck snapshot_accuracy failure (#500, BR-1379).
 *
 * Purpose: a snapshot_accuracy failure built from a wrong-when-written `decision_findings` entry is deterministic: it
 *   names its decision (`slug@version`), the premise part and the premise source file. Those become the finding's
 *   cites, so the root-cause fingerprint (`rootCauseOf`) keys on them instead of refusing a "cite-less" finding.
 * Public surface: {@link decisionFindingCites}, {@link withDecisionFindingCites}.
 * Invariants:
 *   - Only `wrong-when-written` findings (the kind that fails snapshot_accuracy, see `applyDecisionFindings`) cite.
 *   - Cites are the decision address, `<address> <part>` and, when the fact names one, the premise source path; never
 *     the finding's wording, so a reworded re-review keeps one fingerprint.
 *   - A pure judge-text snapshot_accuracy failure is untouched: it still has no cite and is still refused.
 * Side-effect class: pure.
 */
import type { DecisionFinding, LlmMilestoneOutput } from "@lore/core";

// reason: `DecisionFinding` has no structured source field and decision-recheck.ts (`checkFileSource`) emits the premise
// source only inside `fact`, always as the leading token: `<path>:<a>-<b>@<sha> read ...` (quote mismatch),
// `<path> does not exist at <sha>` or `<path> has N lines at <sha>, ...`. All three are matched here; a changed shape
// degrades to decision+part cites (never to no cite), pinned by decision-finding-cites.test.ts.
const SOURCE_PATH = /^(\S+?)(?::\d+-\d+@[0-9a-f]+ read | does not exist at | has \d+ lines at )/;

/**
 * The cites of the wrong-when-written findings: decision address, decision+part and premise source path.
 *
 * @param findings - the re-check's findings
 * @returns sorted, de-duplicated cites; empty when no finding is wrong-when-written
 * @example
 * decisionFindingCites([{ decision: "d@2", part: "premise 1", kind: "wrong-when-written", fact: "a.ts does not exist at abc" }]);
 * // => ["a.ts", "d@2", "d@2 premise 1"]
 */
export function decisionFindingCites(findings: readonly DecisionFinding[]): string[] {
  const cites = new Set<string>();
  for (const f of findings) {
    if (f.kind !== "wrong-when-written") continue;
    cites.add(f.decision);
    cites.add(`${f.decision} ${f.part}`);
    const path = SOURCE_PATH.exec(f.fact)?.[1];
    if (path !== undefined) cites.add(path);
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
