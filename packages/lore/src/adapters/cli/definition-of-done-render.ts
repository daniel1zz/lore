/**
 * Terminal rendering of a task's definition of done (BR-1357), shared by `lore claim` and `lore feed task-start`.
 *
 * Purpose: one place that turns a `DefinitionOfDone` (computed by `TaskWorkflowService.describeDefinitionOfDone`
 * from the done floors' own predicates) into lines, so the two surfaces never word it differently.
 * Public surface: renderDefinitionOfDone(definition) -> string[].
 * Side-effect class: pure (type-only import of the service, so vitest can load it).
 */

import type { DefinitionOfDone } from "../../service/task-workflow-service.js";

/**
 * Renders the definition of done as lines: a header, then one line per floor that has something to say. A floor with
 * nothing owed is still named (`none`), so a reader can tell "no demand" from "not computed".
 *
 * @param definition - the definition of done of one task
 * @returns lines for `printLine`; the first is the header `Definition of done (lore done will require):`
 * @example
 * renderDefinitionOfDone({ unfiltered_pass_files: ["tests/a.test.ts"], red_required: true, verify_acs: ["AC-X-1"] });
 */
export function renderDefinitionOfDone(definition: DefinitionOfDone): string[] {
  const files = definition.unfiltered_pass_files;
  const acs = definition.verify_acs;
  return [
    "Definition of done (lore done will require):",
    `  unfiltered passing run of each anchored test file: ${files.length === 0 ? "none" : files.join(", ")}`,
    `  a runner-produced red run on record (red-first / no-new-tests): ${definition.red_required ? "yes" : "no"}`,
    `  script ACs to attest with lore verify: ${acs.length === 0 ? "none" : acs.join(", ")}`,
  ];
}
