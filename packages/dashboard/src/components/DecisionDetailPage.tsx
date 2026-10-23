/**
 * DecisionDetailPage — read-only detail for one open decision.
 * Purpose: show, in plain words, what is being asked: summary, before/after (when the change has them),
 *   what accepting and rejecting each do, every factor by name, and the recommendation (none for an audit
 *   item). It prints the exact `lore decide` commands and says answering happens in your own terminal.
 * Public surface: DecisionDetailPage, DecisionDetailPageProps
 * Invariants: GET only; no button writes. An unknown id (404) and a bad id (422) get distinct messages.
 * Side-effect class: IO (GET only)
 * Source: spec-human-review-surface-decisions-audit-items-and-pending D3, AC-HR-4
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError, apiGetDecision } from "@/lib/api";
import { projectPath, queryKeys } from "@/lib/project-api";

export interface DecisionDetailPageProps {
  /** The `$id` route param (kept a string so a non-numeric id reaches the server's 422). */
  id: string;
  project?: string | null;
}

function show(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 404) return "No decision with that number exists.";
  if (error instanceof ApiError && error.status === 422) return "That is not a valid decision number.";
  return "Could not load this decision. Try again.";
}

/** @example <DecisionDetailPage id="7" project={null} /> */
export function DecisionDetailPage({ id, project = null }: DecisionDetailPageProps): React.ReactElement {
  const query = useQuery({
    queryKey: queryKeys.scope(project, ["needs-you", "decision", id]),
    queryFn: () => apiGetDecision(project, id),
    retry: false,
  });
  const back = (
    <a href={projectPath(project, "/needs-you")} className="text-sm underline">
      Back to Needs you
    </a>
  );

  if (query.error !== null) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <p role="alert" className="text-destructive">
          {errorMessage(query.error)}
        </p>
        {back}
      </div>
    );
  }
  const view = query.data;
  if (view === undefined) return <p className="p-4 text-muted-foreground">Loading…</p>;

  const { detail } = view;
  const change = detail?.change ?? {};
  const hasBefore = "before" in change;
  const hasAfter = "after" in change;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4">
      {back}
      <h1 className="text-2xl font-semibold">
        Decision #{view.id}
      </h1>
      <p className="text-base">{view.summary}</p>
      <p className="text-xs text-muted-foreground">
        {view.class} · {view.subject_id} · {view.subject_version}
      </p>

      {detail !== null && (
        <section className="space-y-2">
          <p className="text-sm">Asked by: {detail.requested_by}</p>
          {hasBefore && (
            <div>
              <h2 className="text-sm font-semibold">Before</h2>
              <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-sm">{show(change["before"])}</pre>
            </div>
          )}
          {hasAfter && (
            <div>
              <h2 className="text-sm font-semibold">After</h2>
              <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-sm">{show(change["after"])}</pre>
            </div>
          )}
          <div>
            <h2 className="text-sm font-semibold">If you accept</h2>
            <p className="text-sm">{detail.on_accept}</p>
          </div>
          <div>
            <h2 className="text-sm font-semibold">If you reject</h2>
            <p className="text-sm">{detail.on_reject}</p>
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold">Factors</h2>
        <ul className="text-sm">
          {Object.entries(view.factors).map(([name, value]) => (
            <li key={name}>
              {name}: {value}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Score {view.score}
          {view.threshold !== null ? `, threshold ${view.threshold}` : ""}
        </p>
      </section>

      {view.recommendation !== null && (
        <section>
          <h2 className="text-sm font-semibold">Recommendation</h2>
          <p className="text-sm">
            {view.recommendation.answer}: {view.recommendation.reason}
          </p>
        </section>
      )}

      <section className="space-y-1">
        <h2 className="text-sm font-semibold">How to answer</h2>
        <p className="text-sm">This page only shows the details. Answering happens in your own terminal.</p>
        <code className="block rounded bg-muted p-2 text-sm">{view.answer_commands.accept}</code>
        <code className="block rounded bg-muted p-2 text-sm">{view.answer_commands.reject}</code>
      </section>
    </div>
  );
}
