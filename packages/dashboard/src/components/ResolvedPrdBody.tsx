/**
 * ResolvedPrdBody — renders a document's resolved MDX body: markdown prose
 * interleaved with typed React renderings of each placeholder component
 * (ChildrenOf / RecentDecisions / ActivePlans / RelatedOf / ModuleTree /
 * HealthStats / Embed).
 * Purpose: the SPEC-033 §2.2 "structured data, never spliced-markdown-as-HTML"
 *   renderer — the dashboard's living PRD IS this component, wherever it is
 *   embedded (currently the home page only).
 * Public surface: ResolvedPrdBody, ResolvedPrdBodyProps
 * Invariants:
 *   - NEVER dangerouslySetInnerHTML; placeholder slots are typed React, not
 *     spliced text (AC-33-1: zero raw placeholder tags rendered as text).
 *   - Unknown component names (from `warnings`, or a `resolvedComponents` entry
 *     whose `name` this renderer doesn't recognize) render a labeled
 *     "unsupported placeholder" notice — never a crash, never a silent drop.
 *   - Markdown segments reuse the same ReactMarkdown+remarkGfm pipeline as
 *     DocDetail's read view (SPEC-031 typography) — same prose classes.
 *   - Data shapes come from a trusted same-origin server response and are
 *     duck-typed (Array.isArray / typeof checks), not Zod-validated — this
 *     matches the existing dashboard convention (api.ts's `fetchJson` also
 *     casts rather than schema-validates; DocWithNavigation/ListResponse etc.
 *     are trusted the same way).
 * Side-effect class: pure (renders received data; navigation is caller's via onNavigate)
 * Source: SPEC-033 §2.2, AC-33-1
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocSummary } from "@lore/core";
import type { ResolvedComponent, ResolutionWarning } from "@/lib/api";
import { splitContentByPlaceholders } from "@/lib/resolved-content";
import { Badge } from "@/components/ui/badge";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResolvedPrdBodyProps {
  /** Raw (unspliced) document markdown body. */
  content: string;
  /** Successfully resolved MDX placeholders, from `resolvedMdx.resolvedComponents`. */
  resolvedComponents: ResolvedComponent[];
  /** Stripped/unknown placeholders, from `resolvedMdx.warnings`. */
  warnings: ResolutionWarning[];
  /** Called when a linked document is clicked. */
  onNavigate?: (docId: string) => void;
}

/** Mirrors OutlineService's internal `TreeNode` shape (ModuleTree component data). */
interface ModuleTreeNode {
  doc: DocSummary;
  children: ModuleTreeNode[];
}

/** Mirrors OutlineService's `resolveHealthStats` data shape. */
interface HealthStatsData {
  total: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  stale: number;
  orphans: number;
}

// ─── Badge variant helpers ───────────────────────────────────────────────────
// reason: intentionally duplicated (not extracted+imported) from DocCard.tsx —
// this task's scope is additive (new home-page rendering), not a refactor of
// existing shared components; see the "don't refactor unrelated code" guard.

function typeBadgeVariant(type: string): "default" | "secondary" | "outline" | "destructive" {
  switch (type) {
    case "prd":
    case "spec":
      return "default";
    case "adr":
    case "plan":
      return "secondary";
    default:
      return "outline";
  }
}

function statusBadgeVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "active":
    case "approved":
      return "default";
    case "draft":
    case "in-review":
      return "secondary";
    default:
      return "outline";
  }
}

// ─── Shared sub-renderers ────────────────────────────────────────────────────

/** Muted, labeled box for empty/unsupported placeholder states. Never a silent blank. */
function PlaceholderNote({ title, message }: { title: string; message: string }): React.ReactElement {
  return (
    <div
      className="not-prose my-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground"
      role="note"
      aria-label={title}
    >
      <span className="font-medium">{title}:</span> {message}
    </div>
  );
}

interface DocSummaryListProps {
  title: string;
  docs: DocSummary[];
  emptyLabel: string;
  onNavigate?: (id: string) => void;
  extra?: (doc: DocSummary) => React.ReactNode;
}

/** Linked doc list with type + status chips — the shape ChildrenOf/RecentDecisions/ActivePlans/RelatedOf all share. */
function DocSummaryList({ title, docs, emptyLabel, onNavigate, extra }: DocSummaryListProps): React.ReactElement {
  return (
    <div className="not-prose my-4 rounded-lg border p-4 space-y-2" role="region" aria-label={title}>
      <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{title}</h4>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="space-y-1.5">
          {docs.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-2 text-sm">
              <button
                type="button"
                className="text-left text-primary hover:underline truncate"
                onClick={() => onNavigate?.(doc.id)}
              >
                {doc.title}
              </button>
              <span className="flex items-center gap-1 shrink-0">
                <Badge variant={typeBadgeVariant(doc.type)} className="text-xs">
                  {doc.type}
                </Badge>
                <Badge variant={statusBadgeVariant(doc.status)} className="text-xs">
                  {doc.status}
                </Badge>
                {extra?.(doc)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModuleTreeNodeView({
  node,
  onNavigate,
}: {
  node: ModuleTreeNode;
  onNavigate?: (id: string) => void;
}): React.ReactElement {
  return (
    <li>
      <button
        type="button"
        className="text-left text-primary hover:underline text-sm"
        onClick={() => onNavigate?.(node.doc.id)}
      >
        {node.doc.title}
      </button>
      {node.children.length > 0 && (
        <ul className="ml-4 border-l pl-2 mt-1 space-y-1">
          {node.children.map((child) => (
            // reason: exactOptionalPropertyTypes forbids passing `onNavigate={undefined}` —
            // conditional spread omits the prop entirely when absent (see DocTree.tsx precedent).
            <ModuleTreeNodeView key={child.doc.id} node={child} {...(onNavigate ? { onNavigate } : {})} />
          ))}
        </ul>
      )}
    </li>
  );
}

function HealthStatsView({ stats }: { stats: HealthStatsData }): React.ReactElement {
  return (
    <div className="not-prose my-4 rounded-lg border p-4 space-y-3" role="region" aria-label="Health Stats">
      <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Health Stats</h4>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Total docs" value={stats.total} />
        <StatTile label="Stale (30d+)" value={stats.stale} />
        <StatTile label="Orphans" value={stats.orphans} />
        <StatTile label="Types" value={Object.keys(stats.by_type).length} />
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div className="rounded-md bg-muted/50 p-2 text-center">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ─── Runtime shape guards (duck-typed — see module header) ──────────────────

function asDocSummaryArray(value: unknown): DocSummary[] {
  return Array.isArray(value) ? (value as DocSummary[]) : [];
}

// ─── Component slot dispatch ──────────────────────────────────────────────────

function renderComponentSlot(component: ResolvedComponent, onNavigate?: (id: string) => void): React.ReactElement {
  const data = (component.data ?? null) as Record<string, unknown> | null;

  switch (component.name) {
    case "ChildrenOf": {
      const children = asDocSummaryArray(data?.["children"]);
      return (
        <DocSummaryList
          title="Children"
          docs={children}
          emptyLabel="No children yet."
          {...(onNavigate ? { onNavigate } : {})}
        />
      );
    }

    case "RecentDecisions": {
      const decisions = asDocSummaryArray(data?.["decisions"]);
      return (
        <DocSummaryList
          title="Recent Decisions"
          docs={decisions}
          emptyLabel="No decisions recorded yet."
          {...(onNavigate ? { onNavigate } : {})}
        />
      );
    }

    case "ActivePlans": {
      const plans = asDocSummaryArray(data?.["plans"]);
      return (
        <DocSummaryList
          title="Active Plans"
          docs={plans}
          emptyLabel="No active plans."
          {...(onNavigate ? { onNavigate } : {})}
        />
      );
    }

    case "RelatedOf": {
      const related = Array.isArray(data?.["related"])
        ? (data?.["related"] as Array<DocSummary & { link_type: string }>)
        : [];
      return (
        <DocSummaryList
          title="Related"
          docs={related}
          emptyLabel="No related documents."
          {...(onNavigate ? { onNavigate } : {})}
          extra={(doc) => {
            const match = related.find((r) => r.id === doc.id);
            return match !== undefined ? (
              <Badge variant="outline" className="text-xs">
                {match.link_type}
              </Badge>
            ) : null;
          }}
        />
      );
    }

    case "ModuleTree": {
      const modules = (data?.["modules"] ?? null) as ModuleTreeNode | null;
      if (modules === null) {
        return <PlaceholderNote title="Module Tree" message="No module tree available." />;
      }
      return (
        <div className="not-prose my-4 rounded-lg border p-4" role="region" aria-label="Module Tree">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Module Tree</h4>
          <ul className="space-y-1">
            <ModuleTreeNodeView node={modules} {...(onNavigate ? { onNavigate } : {})} />
          </ul>
        </div>
      );
    }

    case "HealthStats": {
      const stats = data?.["stats"] as HealthStatsData | undefined;
      if (stats === undefined) {
        return <PlaceholderNote title="Health Stats" message="No stats available." />;
      }
      return <HealthStatsView stats={stats} />;
    }

    case "Embed": {
      const embedded = (data?.["embedded"] ?? null) as { id: string; title: string; content: string } | null;
      if (embedded === null) {
        return <PlaceholderNote title="Embed" message="Embedded document not found." />;
      }
      return (
        <div
          className="not-prose my-4 rounded-lg border p-4 space-y-2"
          role="region"
          aria-label={`Embedded: ${embedded.title}`}
        >
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{embedded.title}</h4>
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{embedded.content}</ReactMarkdown>
          </div>
        </div>
      );
    }

    default:
      return (
        <PlaceholderNote title={component.name} message="Unsupported placeholder — no renderer registered." />
      );
  }
}

function renderWarningSlot(warning: ResolutionWarning): React.ReactElement {
  return <PlaceholderNote title={warning.component} message={warning.message} />;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders a document's content with MDX placeholders spliced into typed React.
 *
 * @example
 * <ResolvedPrdBody
 *   content={doc.content}
 *   resolvedComponents={resolvedMdx.resolvedComponents}
 *   warnings={resolvedMdx.warnings}
 *   onNavigate={(id) => navigate({ to: '/docs/$id', params: { id } })}
 * />
 */
export function ResolvedPrdBody({
  content,
  resolvedComponents,
  warnings,
  onNavigate,
}: ResolvedPrdBodyProps): React.ReactElement {
  const segments = splitContentByPlaceholders(content, resolvedComponents, warnings);

  if (segments.length === 0) {
    return <p className="text-sm text-muted-foreground">This document has no content yet.</p>;
  }

  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        if (segment.kind === "markdown") {
          if (segment.text.trim().length === 0) return null;
          return (
            <div key={index} className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{segment.text}</ReactMarkdown>
            </div>
          );
        }
        if (segment.kind === "component") {
          return <div key={index}>{renderComponentSlot(segment.component, onNavigate)}</div>;
        }
        return <div key={index}>{renderWarningSlot(segment.warning)}</div>;
      })}
    </div>
  );
}
