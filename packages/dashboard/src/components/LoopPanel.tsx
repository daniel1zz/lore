/**
 * LoopPanel — feedback-loop observability panel: calibration agreement stats
 * (doc_type × prompt_version, Wilson lower bound) plus an audit-verify status
 * chip (clean vs N misses).
 * Purpose: SPEC-033 §2.4 "Loop panel" — makes the human/AI calibration loop
 *   visible on the dashboard home page instead of only via `lore calibration
 *   --stats` / `lore audit --verify`.
 * Public surface: LoopPanel
 * Invariants:
 *   - n=0 stat rows still render as a labeled empty state (BOUNDARY dimension),
 *     never an omitted/blank table.
 *   - Audit-verify chip: "clean" (emerald) when `clean === true`, "{n} misses"
 *     (destructive) otherwise; loading/error states are distinct, never
 *     silently rendered as either "clean" or "misses".
 * Side-effect class: IO (fetch via TanStack Query)
 * Source: SPEC-033 §2.4
 */

import { useQuery } from "@tanstack/react-query";
import { apiGetCalibrationStats, apiGetAuditVerify } from "@/lib/api";
import type { AuditVerifyResponse } from "@/lib/api";
import { queryKeys } from "@/lib/project-api";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

interface AuditVerifyChipProps {
  data: AuditVerifyResponse | undefined;
  isLoading: boolean;
  error: Error | null;
}

function AuditVerifyChip({ data, isLoading, error }: AuditVerifyChipProps): React.ReactElement {
  if (isLoading) return <Skeleton className="h-5 w-20 rounded" />;
  if (error !== null || data === undefined) {
    return (
      <Badge variant="outline" className="text-xs">
        verify unknown
      </Badge>
    );
  }
  if (data.clean) {
    return (
      <Badge variant="default" className="text-xs bg-emerald-600 text-white hover:bg-emerald-600/90">
        clean
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="text-xs" title={`Since ${data.since}`}>
      {data.misses.length} miss{data.misses.length === 1 ? "" : "es"}
    </Badge>
  );
}

/**
 * @example
 * <LoopPanel />
 */
export function LoopPanel(): React.ReactElement {
  const statsQuery = useQuery({
    queryKey: queryKeys.scope(null, ["home", "loop", "calibration-stats"]),
    queryFn: () => apiGetCalibrationStats(),
  });
  const verifyQuery = useQuery({
    queryKey: queryKeys.scope(null, ["home", "loop", "audit-verify"]),
    queryFn: () => apiGetAuditVerify(),
  });

  return (
    <section className="rounded-lg border p-4 space-y-3" aria-label="Feedback loop">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Feedback Loop</h3>
        <AuditVerifyChip data={verifyQuery.data} isLoading={verifyQuery.isLoading} error={verifyQuery.error} />
      </div>

      {statsQuery.isLoading && <Skeleton className="h-16 rounded" />}

      {statsQuery.error !== null && !statsQuery.isLoading && (
        <p className="text-sm text-destructive">Failed to load calibration stats.</p>
      )}

      {statsQuery.data !== undefined && statsQuery.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No calibration data recorded yet.</p>
      )}

      {statsQuery.data !== undefined && statsQuery.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Prompt</TableHead>
              <TableHead className="text-right">n</TableHead>
              <TableHead className="text-right">Agreement</TableHead>
              <TableHead className="text-right">Wilson LB</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statsQuery.data.map((row) => (
              <TableRow key={`${row.doc_type}-${row.prompt_version}`}>
                <TableCell>{row.doc_type}</TableCell>
                <TableCell className="font-mono text-xs">{row.prompt_version}</TableCell>
                <TableCell className="text-right">{row.n}</TableCell>
                <TableCell className="text-right">{(row.agreement_rate * 100).toFixed(0)}%</TableCell>
                <TableCell className="text-right">{(row.wilson_lower_bound * 100).toFixed(0)}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
