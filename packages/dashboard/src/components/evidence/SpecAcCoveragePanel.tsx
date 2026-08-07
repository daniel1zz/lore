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
 *     badge and `lore feed task-start`'s pack use; never a second ordering. That
 *     precedence can return `"pass_unfalsified"` (spec-oracle-tier-falsifiability-
 *     a-criterion-never-observed-red M1 surfacing) — see `stateVariant`'s own
 *     JSDoc for the deliberately neutral badge color chosen for it.
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

type CoverageState = "fail" | "attested_pass" | "pass" | "pass_unfalsified" | "none";

/**
 * Badge color per fail-first coverage state (mirrors `commands/ac.ts::coverageBadge`'s
 * color intent).
 *
 * `pass_unfalsified` (spec-oracle-tier-falsifiability-a-criterion-never-observed-red
 * M1 surfacing) — a real, measured, always-positive fact: green, but never once
 * observed able to go red. Measured 2026-08-07: 574 of 700 corpus criteria (82.0%)
 * render this state — a majority, not an edge case. It maps to `"outline"`
 * (bordered, `text-foreground`, no fill) — the SAME neutral treatment `"none"`
 * already uses, and DELIBERATELY NOT `"destructive"` (red would misread a real pass
 * as an error) or `"secondary"`/`"default"` (either would make it visually
 * indistinguishable from — or MORE confident than — a criterion that HAS been
 * falsified, inverting the signal this whole mechanism exists to surface). Two
 * candidates were considered for this exact spot:
 *   (A, CHOSEN) reuse `"outline"` verbatim, zero new styling — the row's own visible
 *       text is still the state NAME (`"pass_unfalsified"` vs `"none"`), so the two
 *       states are never confused despite sharing a border treatment; this is also
 *       the least visually assertive of the four variants this badge component
 *       ships, which is exactly the property wanted for a state that will render on
 *       a majority of every row a viewer scans.
 *   (B, REJECTED) `"outline"` PLUS a one-off custom className (e.g. a faint
 *       `text-muted-foreground` tint) to visually separate it from `"none"` for a
 *       viewer scanning by color alone — rejected: `Badge`'s variant set is a closed
 *       CVA enum (`components/ui/badge.tsx`, out of this task's file anchors); a
 *       parallel ad-hoc className path would fork the "how does a coverage state
 *       get its color" decision into two mechanisms (the `variant` prop here, a
 *       bespoke class there) for marginal benefit over the label text already
 *       carrying the distinction.
 */
function stateVariant(state: CoverageState): "destructive" | "default" | "secondary" | "outline" {
  switch (state) {
    case "fail":
      return "destructive";
    case "attested_pass":
      return "default";
    case "pass":
      return "secondary";
    case "pass_unfalsified":
      return "outline";
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
