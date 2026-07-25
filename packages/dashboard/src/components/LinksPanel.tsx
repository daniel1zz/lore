/**
 * LinksPanel — editable related-document links panel.
 * Purpose: allow users to add/remove document links from the detail view.
 * Public surface: LinksPanel, LinksPanelProps
 * Invariants:
 *   - Search is debounced 300ms to avoid flooding the API.
 *   - LINK_CYCLE errors (422) are displayed inline; other errors are toasted.
 *   - Deletion is immediate with optimistic UI (parent re-fetches after).
 *   - When onLinkAdd/onLinkRemove absent, renders in read-only mode.
 *   - useQuery is isolated inside LinkAddSearch (write-mode only) so LinksPanel
 *     can be rendered in tests without a QueryClientProvider. SPEC-022 §9.
 * Side-effect class: IO (fetch via api callbacks)
 * Source: SPEC-022 §9.2, Q4
 */

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiSearch } from "@/lib/api";
import type { SearchHit } from "@/lib/api";
import { queryKeys } from "@/lib/project-api";
import { X, Plus, Loader2 } from "lucide-react";
import { linkTypeSchema, type LinkType } from "@lore/core";

// `linkTypeSchema.options` (Zod enum → runtime array) is the SSOT for the
// canonical link-type set — mirrors the `LinkType` union in
// `packages/core/src/schemas.ts` at runtime so this list can never drift
// from it (a hardcoded copy here previously omitted `parent`/`governs` and
// included an invalid `extends`).
const LINK_TYPES: readonly LinkType[] = linkTypeSchema.options;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LinkEntry {
  /** Target doc id. */
  to_id: string;
  /** Target doc title. */
  title?: string;
  /** Link type. */
  link_type: LinkType;
}

export interface LinksPanelProps {
  /** Current links (from navigation.related). */
  links: LinkEntry[];
  /** Active project, or `null`/absent for registry-less mode (SPEC-078 T10) — threads into `LinkAddSearch`'s corpus search. */
  project?: string | null;
  /** Called when user adds a link. Returns error message or null on success. */
  onLinkAdd?: (toId: string, type: LinkType) => Promise<string | null>;
  /** Called when user removes a link. */
  onLinkRemove?: (toId: string) => Promise<void>;
  /** Whether a link operation is in progress. */
  isPending?: boolean;
}

// ─── LinkAddSearch — isolated write-mode sub-component ────────────────────────
// reason: the combobox search result type is `SearchHit` (imported from
// `@/lib/api`) — the real `CorpusService.search` envelope, `{id, slug, title,
// snippet, score}`. A prior version fabricated a local `{id, title, type,
// status}` shape the server never sends (SPEC-031 read-path contract drift);
// `hit.type`/`hit.status` silently rendered `undefined`.

interface LinkAddSearchProps {
  /** Active project, or `null` for registry-less mode. */
  project: string | null;
  /** Called with the selected doc's id and the chosen link type. */
  onAdd: (toId: string, linkType: LinkType) => Promise<void>;
  addError: string | null;
  isPending?: boolean | undefined;
}

/**
 * Write-mode combobox for searching and adding document links.
 * Isolated in its own component so `useQuery` is only mounted when write mode
 * is active — LinksPanel remains usable without QueryClientProvider in tests.
 *
 * @example
 * <LinkAddSearch onAdd={handleAddLink} addError={addError} isPending={isPending} />
 */
function LinkAddSearch({ project, onAdd, addError, isPending }: LinkAddSearchProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedLinkType, setSelectedLinkType] = useState<LinkType>("relates-to");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search query 300ms.
  useEffect(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // reason: useQuery is only mounted inside this sub-component, not at LinksPanel root.
  // This keeps LinksPanel renderable without a QueryClientProvider (e.g., read-only tests).
  const { data: searchResults } = useQuery({
    queryKey: queryKeys.scope(project, ["links-search", debouncedQuery]),
    queryFn: () => apiSearch(project, debouncedQuery, {}),
    enabled: debouncedQuery.trim().length >= 2,
  });

  async function handleAddHit(hit: SearchHit): Promise<void> {
    await onAdd(hit.id, selectedLinkType);
    setSearchQuery("");
    setDebouncedQuery("");
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-2 py-1 text-sm"
          placeholder="Search docs to link…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Search for a document to link"
        />
        <select
          className="border rounded px-2 py-1 text-xs bg-background"
          value={selectedLinkType}
          onChange={(e) => setSelectedLinkType(e.target.value as LinkType)}
          aria-label="Link type"
        >
          {LINK_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {searchResults !== undefined && debouncedQuery.trim().length >= 2 && (
        <ul className="border rounded divide-y max-h-40 overflow-auto">
          {searchResults.results.length === 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">No results</li>
          )}
          {searchResults.results.map((hit) => (
            <li key={hit.id}>
              <button
                className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted flex items-center gap-2 disabled:opacity-50"
                onClick={() => void handleAddHit(hit)}
                disabled={isPending}
                type="button"
              >
                <span className="text-xs text-muted-foreground shrink-0 font-mono">{hit.slug}</span>
                <span className="truncate">{hit.title}</span>
                <Plus className="h-3 w-3 ml-auto shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {addError !== null && (
        <p className="text-xs text-destructive">{addError}</p>
      )}
    </div>
  );
}

// ─── LinksPanel ───────────────────────────────────────────────────────────────

/**
 * Editable links panel with corpus-search autocomplete for adding links.
 * Read-only when onLinkAdd/onLinkRemove are absent (no QueryClientProvider required).
 *
 * @example
 * <LinksPanel
 *   links={navigation.related.map(r => ({ to_id: r.id, title: r.title, link_type: r.link_type as LinkType }))}
 *   onLinkAdd={(toId, type) => handleAddLink(toId, type)}
 *   onLinkRemove={(toId) => handleRemoveLink(toId)}
 * />
 */
export function LinksPanel({
  links,
  project = null,
  onLinkAdd,
  onLinkRemove,
  isPending,
}: LinksPanelProps): React.ReactElement {
  const [addError, setAddError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const isWriteMode = onLinkAdd !== undefined || onLinkRemove !== undefined;

  async function handleAddLink(toId: string, linkType: LinkType): Promise<void> {
    if (onLinkAdd === undefined) return;
    setAddError(null);
    const error = await onLinkAdd(toId, linkType);
    if (error !== null) {
      setAddError(error);
    }
  }

  async function handleRemoveLink(toId: string): Promise<void> {
    if (onLinkRemove === undefined) return;
    setRemovingId(toId);
    try {
      await onLinkRemove(toId);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section aria-label="Related documents">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Related
      </h3>

      {links.length === 0 && !isWriteMode && (
        <p className="text-xs text-muted-foreground">No related documents.</p>
      )}

      <ul className="space-y-1">
        {links.map((link) => (
          <li key={link.to_id} className="flex items-center justify-between gap-2 group">
            <span className="text-xs font-mono text-muted-foreground shrink-0">
              {link.link_type}
            </span>
            <span className="text-sm truncate flex-1">
              {link.title ?? link.to_id}
            </span>
            {isWriteMode && onLinkRemove !== undefined && (
              <button
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 text-destructive transition-opacity"
                onClick={() => void handleRemoveLink(link.to_id)}
                disabled={removingId === link.to_id || isPending}
                aria-label={`Remove link to ${link.title ?? link.to_id}`}
                type="button"
              >
                {removingId === link.to_id
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <X className="h-3 w-3" />
                }
              </button>
            )}
          </li>
        ))}
      </ul>

      {/* reason: LinkAddSearch mounts useQuery — only render when in write mode
          to avoid requiring QueryClientProvider in read-only / test contexts. */}
      {isWriteMode && onLinkAdd !== undefined && (
        <LinkAddSearch
          project={project}
          onAdd={handleAddLink}
          addError={addError}
          isPending={isPending}
        />
      )}
    </section>
  );
}
