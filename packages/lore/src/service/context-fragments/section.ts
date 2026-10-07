/**
 * Wraps a rendered outlet block as the Z1 managed section `fragments`.
 * Spec: spec-context-fragments-config-driven-layered-rule-injection (D13).
 *
 * Public surface: `FRAGMENTS_SECTION_ID`, `buildFragmentsSection`.
 * Invariants: section id is always "fragments"; body contains the rendered text verbatim.
 * Side-effect class: pure.
 */
import type { ManagedSection } from "../context-projection.js";
import type { RenderedOutlet } from "./render.js";

/** Z1 section id for fragment-derived content. */
export const FRAGMENTS_SECTION_ID = "fragments";

/**
 * Build the `fragments` managed section for `spliceManagedSections`.
 *
 * @param rendered Output of `renderOutlet` for a claude-md outlet.
 * @param scope Which memory file the section targets; shown in the heading.
 */
export function buildFragmentsSection(
  rendered: RenderedOutlet,
  scope: "project" | "user",
): ManagedSection {
  return {
    id: FRAGMENTS_SECTION_ID,
    body: `## Context fragments (${scope})\n\n${rendered.text}`,
  };
}
