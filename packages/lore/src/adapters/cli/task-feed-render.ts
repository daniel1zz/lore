/**
 * Terminal rendering for `lore feed task-start`'s human-readable pack (SPEC-070
 * §Design Decisions D7). Extracted into its own module so it can be unit-tested
 * directly under vitest — mirrors `status-stamp-verdict.ts`'s split rationale exactly:
 * `commands/feed.ts` transitively imports `loader.ts` (`bun:sqlite`), which vitest
 * cannot resolve, but this module imports only `../../flows/task-feed-flow.js`
 * (types only, browser-safe) — reusable by a future claim-time print or dashboard
 * surface without touching `commands/feed.ts` (D7).
 *
 * Public surface:
 *   - renderTaskStartPack(pack) — all eight section headers + bodies, an optional
 *     `## Governing rules` section (id + statement, capped, `+N more` overflow) and an
 *     optional truncation footer.
 *
 * Side-effect class: pure
 * Source: spec-070-deterministic-task-dispatch-bundle-lore-feed-task-start
 *   §Design D7; §Acceptance Criteria AC-070-7
 */

import type { TaskStartPack } from "../../flows/task-feed-flow.js";
import { renderDefinitionOfDone } from "./definition-of-done-render.js";

/**
 * Renders a `TaskStartPack`'s eight sections to a single string, plus a
 * truncation notice when any section was clipped to fit its configured budget.
 *
 * @param pack - The assembled pack (`buildTaskStartPack`'s success value).
 * @returns Human-readable text — `console.log`-ready, mirrors
 *   `commands/feed.ts`'s pre-existing `renderPhaseStartPack` shape.
 * @example
 * const text = renderTaskStartPack(pack);
 * console.log(text); // prints "# Task start — <id>\n\n## Objective\n..."
 */
export function renderTaskStartPack(pack: TaskStartPack): string {
  const lines: string[] = [];
  lines.push(`# Task start — ${pack.task_id}\n`);
  lines.push("## Objective");
  lines.push(pack.sections.objective);
  lines.push("\n## Acceptance");
  lines.push(pack.sections.acceptance);
  lines.push("\n## Constraints");
  lines.push(pack.sections.constraints);
  lines.push("\n## Boundaries");
  lines.push(pack.sections.boundaries);
  lines.push("\n## Claim");
  lines.push(pack.sections.claim);
  lines.push("\n## Plan state");
  lines.push(pack.sections.plan_state);
  lines.push("\n## Linked knowledge");
  lines.push(pack.sections.knowledge_pointers);
  lines.push("\n## Latest handoff");
  lines.push(pack.sections.handoff);
  if (pack.definition_of_done !== undefined) {
    lines.push(`\n## ${renderDefinitionOfDone(pack.definition_of_done).join("\n")}`);
  }
  if (pack.governing_rules !== undefined) {
    lines.push("\n## Governing rules");
    for (const rule of pack.governing_rules.rules) lines.push(`- ${rule.id}: ${rule.statement}`);
    if (pack.governing_rules.overflow > 0) lines.push(`+${pack.governing_rules.overflow} more`);
  }
  if (pack.truncated.length > 0) {
    lines.push(`\n(truncated sections: ${pack.truncated.join(", ")})`);
  }
  return lines.join("\n");
}
