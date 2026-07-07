/**
 * Breadcrumb — ancestor-chain navigation trail for the doc detail page
 * (SPEC-036 §1 D1).
 * Purpose: renders "Home / <ancestors...> / <current title>" from
 *   `navigation.ancestors` (root-first `DocSummary[]`, excludes the current
 *   doc) so a user can jump back up the parent_id chain without relying on
 *   browser-back — the bottom navigation footer (`DocDetail.tsx`) only ever
 *   shows ONE level (the direct parent).
 * Public surface: Breadcrumb, BreadcrumbProps
 * Invariants:
 *   - Home crumb always renders first; clicking it calls `onHome`. Ancestor
 *     crumbs call `onNavigate(ancestor.id)`. Both callbacks are optional and
 *     safe to omit (mirrors `DocCard`'s `onClick?.()` convention) — real
 *     usage (`routes/docs.$id.tsx`) always wires both; only unit tests that
 *     don't need navigation omit them.
 *   - The current title is plain text with `aria-current="page"` — never a
 *     link (AC-36-3).
 *   - >3 ancestors: the middle ancestors collapse into a single
 *     non-interactive "..." crumb (its `title` attribute lists the full
 *     collapsed titles, comma-joined); the root (first) and direct parent
 *     (last) stay visible on either side of it (AC-36-4). <=3 ancestors
 *     render with no collapsing at all.
 * Side-effect class: pure (navigation delegated to callbacks)
 * Source: SPEC-036 §1 D1, AC-36-3, AC-36-4
 *
 * @example
 * <Breadcrumb
 *   ancestors={docWithNav.navigation.ancestors}
 *   currentTitle={docWithNav.doc.title}
 *   onNavigate={(id) => navigate({ to: "/docs/$id", params: { id } })}
 *   onHome={() => navigate({ to: "/" })}
 * />
 */

import type { DocSummary } from "@lore/core";

/** Ancestor counts at or below this render with no collapsing (AC-36-4). */
const OVERFLOW_THRESHOLD = 3;

export interface BreadcrumbProps {
  /** Root-first ancestor chain, excluding the current doc. Empty for root docs. */
  ancestors: DocSummary[];
  /** The current document's title — rendered as the trailing, non-link crumb. */
  currentTitle: string;
  /** Called with an ancestor's id when its crumb is clicked. */
  onNavigate?: (id: string) => void;
  /** Called when the Home crumb is clicked. */
  onHome?: () => void;
}

const CRUMB_BUTTON_CLASS = "hover:text-foreground hover:underline";
const SEPARATOR_CLASS = "text-muted-foreground/60";

/** Breadcrumb separator — decorative, hidden from assistive tech. */
function Separator(): React.ReactElement {
  return <span aria-hidden="true" className={SEPARATOR_CLASS}>/</span>;
}

export function Breadcrumb({ ancestors, currentTitle, onNavigate, onHome }: BreadcrumbProps): React.ReactElement {
  const isOverflowing = ancestors.length > OVERFLOW_THRESHOLD;
  const root = isOverflowing ? ancestors[0] : undefined;
  const directParent = isOverflowing ? ancestors[ancestors.length - 1] : undefined;
  const collapsedTitles = isOverflowing ? ancestors.slice(1, -1).map((a) => a.title) : [];

  return (
    <nav aria-label="Breadcrumb" className="flex items-center flex-wrap gap-1.5 text-sm text-muted-foreground mb-4">
      <button type="button" className={CRUMB_BUTTON_CLASS} onClick={() => onHome?.()}>
        Home
      </button>
      <Separator />
      {isOverflowing && root !== undefined && directParent !== undefined ? (
        <>
          <button type="button" className={CRUMB_BUTTON_CLASS} onClick={() => onNavigate?.(root.id)}>
            {root.title}
          </button>
          <Separator />
          <span title={collapsedTitles.join(", ")} className="cursor-default select-none">
            …
          </span>
          <Separator />
          <button type="button" className={CRUMB_BUTTON_CLASS} onClick={() => onNavigate?.(directParent.id)}>
            {directParent.title}
          </button>
          <Separator />
        </>
      ) : (
        ancestors.map((ancestor) => (
          <span key={ancestor.id} className="flex items-center gap-1.5">
            <button type="button" className={CRUMB_BUTTON_CLASS} onClick={() => onNavigate?.(ancestor.id)}>
              {ancestor.title}
            </button>
            <Separator />
          </span>
        ))
      )}
      <span aria-current="page" className="text-foreground font-medium">
        {currentTitle}
      </span>
    </nav>
  );
}
