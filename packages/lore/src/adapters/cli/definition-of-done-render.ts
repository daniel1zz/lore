/**
 * Terminal rendering of a task's definition of done (BR-1357), shared by `lore claim` and `lore feed task-start`.
 *
 * Purpose: one place that turns a `DefinitionOfDone` (computed by `TaskWorkflowService.describeDefinitionOfDone`
 * from the done floors' own predicates) into lines, so the two surfaces never word it differently.
 * Public surface: renderDefinitionOfDone(definition) -> string[].
 * Side-effect class: pure (type-only import of the service, so vitest can load it).
 */

import type { DoneContract } from "@lore/core";
import type { DefinitionOfDone } from "../../service/task-workflow-service.js";

/**
 * Renders a task's STORED done contract (BR-1357, AC-DCS1-1): what `lore claim` prints for an approved task, so the claimer reads
 * the contract that was fixed at approve and not a recomputation. One line per fact, one per oracle with its command.
 *
 * @param contract - the contract stored at `extra.done_contract`
 * @returns lines for `printLine`; the first is the header `Done contract (compiled at <commit> on <base>):`
 */
export function renderDoneContract(contract: DoneContract): string[] {
  const lines = [
    `Done contract (compiled at ${contract.compiled_at_commit.slice(0, 12)} on ${contract.base_branch}):`,
    `  kind: ${contract.kind}, lands via: ${contract.landing_route}`,
    `  a runner-produced red run on record: ${contract.red_required ? "yes" : `no (waived: ${contract.red_waiver_reason ?? "no reason recorded"})`}`,
  ];
  if (contract.install !== undefined) lines.push(`  install: ${contract.install}`);
  lines.push("  oracles (lore finish and lore done run these):");
  for (const oracle of [...contract.oracles, ...contract.added_oracles]) {
    lines.push(`    ${oracle.id}${oracle.command !== undefined ? `: ${oracle.command}` : ""}`);
  }
  return lines;
}

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
