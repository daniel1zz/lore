/**
 * NeedsYou — the read-only "Needs you" page: everything waiting for a person, in two sections.
 * Purpose: one place to read open autonomy decisions and documents awaiting review.
 *   Answering a decision happens ONLY in the person's own terminal (`lore decide <id> --accept|--reject`);
 *   nothing here writes.
 * Public surface: NeedsYou, NeedsYouProps, NEEDS_YOU_EMPTY_TEXT
 * Invariants:
 *   - Every section stays visible, headed by its exact count; an empty one shows
 *     {@link NEEDS_YOU_EMPTY_TEXT}. A failed fetch shows an error line in that section (never a fake 0).
 *   - Reads only (`apiGetDecisions`, `fetchReviewQueueRows`); imports no mutation module.
 *   - Detail links are plain `<a>` (same precedent as PendingPanel) built through `projectPath`.
 * Side-effect class: IO (GET only)
 * Source: spec-human-review-surface-decisions-audit-items-and-pending D3, AC-HR-4
 */

import { useQuery } from "@tanstack/react-query";
import { apiGetDecisions } from "@/lib/api";
import type { DecisionReadView } from "@/lib/api";
import { fetchReviewQueueRows } from "@/lib/review-queue";
import type { ReviewQueueDocRow } from "@/lib/review-queue";
import { projectPath, queryKeys } from "@/lib/project-api";
import { Button } from "@/components/ui/button";

/** The exact text of an empty section. */
export const NEEDS_YOU_EMPTY_TEXT = "Nothing waiting for you here.";

export interface NeedsYouProps {
  /** Registry project name, or null/omitted for registry-less mode. */
  project?: string | null;
}

interface SectionProps<T> {
  title: string;
  hint: string;
  query: { data: T[] | undefined; error: unknown };
  renderRow: (row: T) => React.ReactElement;
  rowKey: (row: T) => string;
}

function Section<T>({ title, hint, query, renderRow, rowKey }: SectionProps<T>): React.ReactElement {
  const rows = query.data;
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="text-lg font-semibold">
        {title} ({rows === undefined ? "…" : rows.length})
      </h2>
      <p className="text-sm text-muted-foreground">{hint}</p>
      {query.error !== null && query.error !== undefined ? (
        <p role="alert" className="text-sm text-destructive">
          Could not load this list. Try Refresh.
        </p>
      ) : rows === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{NEEDS_YOU_EMPTY_TEXT}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {rows.map((row) => (
            <li key={rowKey(row)} className="p-3 text-sm">
              {renderRow(row)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function decisionRow(project: string | null): (row: DecisionReadView) => React.ReactElement {
  return (row) => (
    <a href={projectPath(project, `/needs-you/decisions/${row.id}`)} className="block hover:underline">
      <span className="font-medium">{row.summary}</span>
      <span className="block text-xs text-muted-foreground">
        #{row.id} · {row.class} · {row.subject_id}
      </span>
    </a>
  );
}

/** @example <NeedsYou project={null} /> */
export function NeedsYou({ project = null }: NeedsYouProps): React.ReactElement {
  const decisions = useQuery({
    queryKey: queryKeys.scope(project, ["needs-you", "decisions"]),
    queryFn: () => apiGetDecisions(project),
  });
  const docs = useQuery({
    queryKey: queryKeys.scope(project, ["needs-you", "documents"]),
    queryFn: () => fetchReviewQueueRows(project),
  });

  function refreshAll(): void {
    void decisions.refetch();
    void docs.refetch();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Needs you</h1>
        <Button variant="outline" size="sm" onClick={refreshAll}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        This page is read-only. To answer a decision, run the command shown on its page in your own terminal.
      </p>
      <Section
        title="Open decisions"
        hint="The system stopped and is waiting for your answer."
        query={decisions}
        rowKey={(row) => String(row.id)}
        renderRow={decisionRow(project)}
      />
      <Section<ReviewQueueDocRow>
        title="Documents awaiting review"
        hint="Drafts and in-review documents. Approve or reject them on the Pending page."
        query={docs}
        rowKey={(row) => row.id}
        renderRow={(row) => (
          <a href={projectPath(project, `/docs/${row.id}`)} className="block hover:underline">
            <span className="font-medium">{row.title}</span>
            <span className="block text-xs text-muted-foreground">
              {row.type} · {row.status}
            </span>
          </a>
        )}
      />
      <a href={projectPath(project, "/pending")} className="text-sm underline">
        Open the full Pending queue
      </a>
    </div>
  );
}
