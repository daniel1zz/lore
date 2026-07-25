/**
 * ProjectSwitcher — project dropdown mounted in the global nav (SPEC-078 T10
 * deliverable 2, D5).
 * Purpose: lets the user see every registered project and switch between
 *   them. Data comes from `GET /api/projects` (`useProjectsQuery`,
 *   `lib/use-projects-query.ts`) — the SAME D7 mount-registry projection
 *   `use-project-redirect.ts` reads (one shared TanStack Query cache entry).
 * Public surface: ProjectSwitcher
 * Invariants:
 *   - Registry-less rendering stays BYTE-IDENTICAL to pre-SPEC-078 chrome
 *     (R-15): renders `null` while the query is loading, on the specific
 *     "registry absent" 404 signal (`isRegistryAbsent`), AND when the
 *     registry resolves but is empty — all three degrade SILENTLY, exactly
 *     like today's single-project dashboard having no switcher at all.
 *   - Any OTHER error (network failure, 500, malformed schema) is NEVER
 *     folded into that same silent path — it renders a visibly broken,
 *     disabled trigger naming the failure, per the T10 dispatch's explicit
 *     "fail loud on unexpected errors" requirement. Silently hiding a real
 *     backend problem behind "no switcher" would look identical to a
 *     healthy registry-less corpus — indistinguishable states are a bug.
 *   - Every registry entry ALWAYS renders a row — `state !== "mounted"`
 *     entries (missing/schema-skew/error) render disabled with their
 *     `diagnosis` string visible, never silently dropped from the list
 *     (component-test AC: "problem entry renders as explicit error state").
 *   - Only `mounted` entries are clickable and only they get a pending-count
 *     badge (`ProjectPendingBadge`, isolated per-row like
 *     `ActivePlansPanel`'s `PlanReadinessSummary` — one row's fetch failing
 *     never blanks a sibling row or the switcher itself).
 *   - Switching writes `setLastViewedProject` (`lib/project-storage.ts`)
 *     BEFORE navigating — the write must land even if navigation is
 *     synchronous, so a page reload immediately after a switch still
 *     recalls the just-chosen project via the `/` redirect hook.
 *   - Navigates to the target project's HOME (`/p/:name`), never attempting
 *     to preserve the current sub-path — deliberate even though ALL routes
 *     are mirrored under `/p/:name` (T13 completed the set T10 started):
 *     the current sub-path names resources of the OLD project (doc ids,
 *     search state) that need not exist in the target corpus, so home is
 *     the only always-valid landing.
 * Side-effect class: IO (fetch via TanStack Query, localStorage, navigation)
 * Source: SPEC-078 D5, T10 dispatch deliverable 2
 *
 * @example
 * <ProjectSwitcher />
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Check, ChevronDown } from "lucide-react";
import { apiGetPendingReview } from "@/lib/api";
import { queryKeys, useProjectParam, type ProjectsResponseEntry } from "@/lib/project-api";
import { useProjectsQuery, isRegistryAbsent } from "@/lib/use-projects-query";
import { setLastViewedProject } from "@/lib/project-storage";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ProjectPendingBadgeProps {
  /** Registry name of a `mounted` project. */
  projectName: string;
}

/**
 * Per-project pending-review count badge — an isolated `useQuery` per row
 * (mirrors `ActivePlansPanel`'s `PlanReadinessSummary`), so one project's
 * pending-count fetch failing never blanks a sibling row.
 */
function ProjectPendingBadge({ projectName }: ProjectPendingBadgeProps): React.ReactElement | null {
  const { data } = useQuery({
    queryKey: queryKeys.scope(projectName, ["switcher", "pending-count"]),
    queryFn: () => apiGetPendingReview(projectName),
  });

  if (data === undefined) return null;
  if (data.length === 0) return null;
  return (
    <Badge variant="secondary" className="ml-auto text-xs" aria-label={`${data.length} pending review`}>
      {data.length}
    </Badge>
  );
}

/** Row content for one registry entry — mounted (clickable) vs a problem state (disabled, diagnosis visible). */
function ProjectRow({
  entry,
  isActive,
  onSelect,
}: {
  entry: ProjectsResponseEntry;
  isActive: boolean;
  onSelect: (name: string) => void;
}): React.ReactElement {
  if (entry.state !== "mounted") {
    return (
      <DropdownMenuItem
        disabled
        aria-label={`${entry.name}: ${entry.state}`}
        data-testid={`project-row-${entry.name}`}
        className="flex flex-col items-start gap-0.5 opacity-70"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
          {entry.name}
          <Badge variant="destructive" className="text-xs">
            {entry.state}
          </Badge>
        </span>
        {/* reason: diagnosis is REQUIRED-in-spirit for a non-mounted entry (D7) —
            rendered whenever present; a present-but-empty string is still shown
            (never substituted with a placeholder) so the row stays truthful. */}
        {entry.diagnosis !== undefined && (
          <span className="text-xs text-muted-foreground break-words">{entry.diagnosis}</span>
        )}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      onClick={() => onSelect(entry.name)}
      aria-label={`Switch to ${entry.name}`}
      data-testid={`project-row-${entry.name}`}
      className="flex items-center gap-2"
    >
      {isActive ? <Check className="h-3.5 w-3.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
      <span className="truncate">{entry.name}</span>
      <ProjectPendingBadge projectName={entry.name} />
    </DropdownMenuItem>
  );
}

export function ProjectSwitcher(): React.ReactElement | null {
  const activeProject = useProjectParam();
  const navigate = useNavigate();
  const { data, error, isLoading } = useProjectsQuery();

  function handleSelect(name: string): void {
    setLastViewedProject(name);
    void navigate({ to: "/p/$name", params: { name } });
  }

  if (isLoading) return null;

  if (data === undefined) {
    // reason: registry absent (404) or empty is the ONLY silent-degrade case
    // (R-15) — every other error fails loud. See module doc comment.
    if (error !== null && !isRegistryAbsent(error)) {
      return (
        <button
          type="button"
          disabled
          className="flex items-center gap-1.5 text-xs px-2 py-1 border border-destructive text-destructive rounded opacity-80"
          aria-label={`Project registry error: ${error.message}`}
          data-testid="project-switcher-error"
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Project registry error
        </button>
      );
    }
    return null;
  }

  if (data.projects.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-sm px-2 py-1 border rounded hover:bg-muted"
          aria-label="Switch project"
          data-testid="project-switcher-trigger"
        >
          {activeProject ?? "Select project"}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Projects</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {data.projects.map((entry) => (
          <ProjectRow
            key={entry.name}
            entry={entry}
            isActive={entry.name === activeProject}
            onSelect={handleSelect}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
