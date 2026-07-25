/**
 * ProjectIdentityLabel — persistent project-identity badge (SPEC-078 D5 R-13,
 * T10 deliverable 3).
 * Purpose: mounted adjacent to EVERY write control (adjudication bar
 *   approve/reject, editor save, config save) whenever a project context is
 *   active, so a user acting in a multi-project dashboard always sees WHICH
 *   corpus a write is about to land in, right next to the control that fires
 *   it — never only in the URL bar or a global switcher the user has since
 *   scrolled past.
 * Public surface: ProjectIdentityLabel, ProjectIdentityLabelProps
 * Invariants:
 *   - Renders `null` (nothing) when `project` is `null` — registry-less mode
 *     stays byte-identical to pre-SPEC-078 chrome (R-15), never a bare
 *     "no project" placeholder badge.
 *   - Pure and presentational — takes `project` as an explicit prop rather
 *     than calling `useProjectParam()` itself, so every mounting site (which
 *     already has `project` in scope for its own query/mutation calls) stays
 *     the single source of truth for "what project is this screen in", and
 *     this component is trivially unit-testable without a Router tree.
 * Side-effect class: pure
 * Source: SPEC-078 D5 R-13, T10 dispatch deliverable 3
 *
 * @example
 * <ProjectIdentityLabel project="acme" />
 * // renders a badge reading "acme"
 * @example
 * <ProjectIdentityLabel project={null} />
 * // renders nothing (registry-less mode)
 */

import { Badge } from "@/components/ui/badge";

export interface ProjectIdentityLabelProps {
  /** The active project's registry name, or `null` for registry-less mode. */
  project: string | null;
}

export function ProjectIdentityLabel({ project }: ProjectIdentityLabelProps): React.ReactElement | null {
  if (project === null) return null;
  return (
    <Badge
      variant="outline"
      className="text-xs font-mono"
      aria-label={`Active project: ${project}`}
      data-testid="project-identity-label"
    >
      {project}
    </Badge>
  );
}
