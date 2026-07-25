/**
 * AuditTab — document audit trail tab (SPEC-033 F3 §2/§3).
 * Purpose: mirrors HistoryTab's structure (fetch-on-mount + per-entry rows)
 *   but renders the append-only audit log (`GET /api/audit/:docId`) instead
 *   of the version log — every actor (human or AI judge) and action recorded
 *   against this document. AI-judge entries decode to a judge-identity badge
 *   and, when the entry carries a `judgment_ref`, expand inline to the full
 *   judgment (decision/confidence/blocking_questions) fetched via
 *   `apiGetJudgments`.
 * Public surface: AuditTab, AuditTabProps
 * Invariants:
 *   - Actor decoding is ALWAYS done client-side via `parseAuditActor`
 *     (browser-safe, `@lore/core`) — `apiGetAuditForDoc` returns the raw actor
 *     string verbatim (see its documented invariant in `lib/api.ts`), never
 *     pre-decoded by the server.
 *   - An entry's judge-identity badge and expandable judgment summary render
 *     ONLY when `details.judgment_ref` is both present on the entry AND
 *     resolves to an entry in this doc's judgment history (`apiGetJudgments`)
 *     — a dangling ref (judgment since pruned, or query still loading)
 *     degrades to the action chip + actor line with no crash and no expand
 *     affordance, never a broken link.
 *   - Renders a "No audit history yet." empty state when the trail is empty
 *     (mirrors HistoryTab's "No version history yet." precedent) and a
 *     distinct "Failed to load audit trail." on fetch error.
 *   - Expansion state is a single `expandedEntryIndex` (not judgment id) —
 *     two entries can reference the same judgment_ref (e.g. a `judge` action
 *     and a later `approve` action both carrying `version`), and each row's
 *     expand toggle must be independent of the others.
 * Side-effect class: IO (fetch via useQuery)
 * Source: SPEC-033 F3 §2, §3
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGetAuditForDoc, apiGetJudgments } from "@/lib/api";
import { parseAuditActor } from "@lore/core";
import { queryKeys } from "@/lib/project-api";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export interface AuditTabProps {
  /** Document ULID. */
  docId: string;
}

/** Read a string-typed `details` field, or `undefined` if absent/wrong type. */
function readStringDetail(details: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = details?.[key];
  return typeof value === "string" ? value : undefined;
}

/** Read a number-typed `details` field, or `undefined` if absent/wrong type. */
function readNumberDetail(details: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = details?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Document audit trail: append-only log of every action recorded against
 * this doc, with AI-judge actors decoded to a judge-identity badge and
 * linked to their full judgment.
 *
 * @example
 * <AuditTab docId={doc.id} />
 */
export function AuditTab({ docId }: AuditTabProps): React.ReactElement {
  const [expandedEntryIndex, setExpandedEntryIndex] = useState<number | null>(null);

  const auditQuery = useQuery({
    queryKey: queryKeys.scope(null, ["audit", docId]),
    queryFn: () => apiGetAuditForDoc(docId),
  });

  const judgmentsQuery = useQuery({
    queryKey: queryKeys.scope(null, ["judgments", docId]),
    queryFn: () => apiGetJudgments(docId),
  });

  if (auditQuery.isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (auditQuery.error !== null) {
    return <p className="text-sm text-destructive">Failed to load audit trail.</p>;
  }

  const entries = auditQuery.data ?? [];

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No audit history yet.</p>;
  }

  const judgmentsByRef = new Map((judgmentsQuery.data?.history ?? []).map((j) => [j.id, j] as const));

  return (
    <div className="space-y-2">
      {entries.map((entry, index) => {
        const parsedActor = parseAuditActor(entry.actor);
        const judgmentRef = readStringDetail(entry.details, "judgment_ref");
        const version = readNumberDetail(entry.details, "version");
        const judgment = judgmentRef !== undefined ? judgmentsByRef.get(judgmentRef) : undefined;
        const isExpanded = expandedEntryIndex === index;

        return (
          <div
            key={`${entry.timestamp}-${index}`}
            className="flex items-start gap-3 py-2 border-b last:border-0"
            data-testid="audit-entry"
          >
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-xs capitalize">
                  {entry.action}
                </Badge>
                {parsedActor.kind === "ai" ? (
                  <Badge variant="outline" className="text-xs font-mono" aria-label="AI judge identity">
                    {parsedActor.judge.provider}@{parsedActor.judge.prompt_version}
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">{parsedActor.name}</span>
                )}
                <span className="text-xs text-muted-foreground">{new Date(entry.timestamp).toLocaleString()}</span>
              </div>

              {(version !== undefined || judgmentRef !== undefined) && (
                <p className="text-xs text-muted-foreground">
                  {version !== undefined ? `v${version}` : null}
                  {version !== undefined && judgmentRef !== undefined ? " · " : null}
                  {judgmentRef !== undefined ? `judgment ${judgmentRef.slice(0, 8)}…` : null}
                </p>
              )}

              {judgment !== undefined && (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  onClick={() => setExpandedEntryIndex(isExpanded ? null : index)}
                >
                  {isExpanded ? "Hide judgment" : "View judgment"}
                </button>
              )}

              {isExpanded && judgment !== undefined && (
                <div className="text-xs bg-muted/50 rounded p-2 space-y-1">
                  <p>
                    <span className="font-medium">Decision:</span> {judgment.decision} (
                    {judgment.confidence.toFixed(2)})
                  </p>
                  {judgment.blocking_questions.length > 0 && (
                    <ul className="list-disc list-inside">
                      {judgment.blocking_questions.map((question, qi) => (
                        <li key={qi}>{question}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
