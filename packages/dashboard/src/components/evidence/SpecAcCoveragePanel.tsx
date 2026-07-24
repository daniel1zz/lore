/**
 * SpecAcCoveragePanel — Evidence-tab rendering for a `spec` doc's projection
 * (SPEC-075 §Module Boundary D7, the `spec` branch of `EvidencePanelProjection`).
 * Purpose: render the AC coverage matrix — one row per declared acceptance
 *   criterion, aggregated pass/fail/attested counts across every descendant
 *   plan's tasks (`VerificationProjectionService`, `computeAcCoverage`).
 * Public surface: SpecAcCoveragePanel, SpecAcCoveragePanelProps
 * Invariants:
 *   - 1:1 with the core `SpecEvidencePanel` union member — rendering only, no
 *     local coverage math (that's `computeAcCoverage`'s job, `@lore/core`).
 *   - Per-row coverage state is `deriveAcCoverageState(fact)` (`@lore/core`,
 *     `acceptance.ts`) — the SAME fail-first precedence `lore ac list`'s CLI
 *     badge and `lore feed task-start`'s pack use; never a second ordering.
 *   - `panel.coverage` is guaranteed 1:1 index-aligned with `panel.criteria`
 *     (`computeAcCoverage`'s documented contract: "one AcCoverageFact per
 *     input criterion, in input order, never omits a declared criterion") —
 *     zipped by index, not a per-row `.find()`.
 *   - Zero declared criteria → an explicit empty state (AC-075-3), distinct
 *     from "zero coverage" (a spec CAN have criteria with no evidence yet;
 *     that renders as a `"none"` state badge per row, not this empty state).
 * Side-effect class: pure
 * Source: SPEC-075 §Module Boundary D7, AC-075-2, AC-075-3
 *
 * @example
 * <SpecAcCoveragePanel panel={{doc_type: "spec", criteria: [...], coverage: [...], task_count: 3}} />
 */

import { deriveAcCoverageState, type SpecEvidencePanel as SpecEvidencePanelProjection } from "@lore/core";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export interface SpecAcCoveragePanelProps {
  /** The `spec` branch of `EvidencePanelProjection` (`@lore/core`, `evidence-panel.ts`). */
  panel: SpecEvidencePanelProjection;
}

type CoverageState = "fail" | "attested_pass" | "pass" | "none";

/** Badge color per fail-first coverage state (mirrors `commands/ac.ts::coverageBadge`'s color intent). */
function stateVariant(state: CoverageState): "destructive" | "default" | "secondary" | "outline" {
  switch (state) {
    case "fail":
      return "destructive";
    case "attested_pass":
      return "default";
    case "pass":
      return "secondary";
    case "none":
      return "outline";
  }
}

/**
 * @example
 * <SpecAcCoveragePanel panel={panel} />
 */
export function SpecAcCoveragePanel({ panel }: SpecAcCoveragePanelProps): React.ReactElement {
  if (panel.criteria.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-label="AC coverage (empty)">
        This spec has no declared acceptance criteria.
      </p>
    );
  }

  return (
    <div className="space-y-2" aria-label="AC coverage matrix">
      <p className="text-xs text-muted-foreground">
        {panel.task_count} task{panel.task_count === 1 ? "" : "s"} contributing evidence
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>AC</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Coverage</TableHead>
            <TableHead>Pass / Fail</TableHead>
            <TableHead>Attested</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {panel.criteria.map((criterion, index) => {
            // reason: computeAcCoverage's documented contract — coverage[index] always
            // corresponds to criteria[index], never omitted. Zipped by index, not a
            // per-row .find() (see module doc comment).
            const fact = panel.coverage[index];
            const state: CoverageState = fact !== undefined ? deriveAcCoverageState(fact) : "none";
            return (
              <TableRow key={criterion.id}>
                <TableCell className="font-mono text-xs">{criterion.id}</TableCell>
                <TableCell className="text-xs">{criterion.verify.mode}</TableCell>
                <TableCell>
                  <Badge variant={stateVariant(state)} className="text-xs">
                    {state}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {fact?.pass ?? 0} / {fact?.fail ?? 0}
                </TableCell>
                <TableCell className="text-xs">{(fact?.attested_pass ?? 0) + (fact?.attested_fail ?? 0)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
