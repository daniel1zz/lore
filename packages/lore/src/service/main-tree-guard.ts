/**
 * Module: main-tree-guard — the one predicate that refuses a command-declaration drop while main's tree still has the command.
 *
 * Purpose: the corpus is shared and un-branched. A branch that removes a command must not drop its declaration from
 *   the corpus before it lands: every other tree still has the command, so it would be undeclared for everyone (BR-1316).
 *   Site mappings and rules are traceability and are never guarded here. "Main's tree" is the checkout holding the corpus.
 *   `RuleService` asks this module through the injected {@link MainTreePort} (wired in app.ts, so CLI, MCP and HTTP refuse alike).
 * Public surface: {@link MainTreePort}, {@link refuseLiveCommandRemoval}.
 * Invariants:
 *   - Only what the write touches is measured (the named commands).
 *   - A port failure (census cannot be analysed) is returned as the refusal; it is never read as "not reached".
 *   - Every refusal is a VALIDATION_ERROR (exit 4) naming the dependents and the wait-for-landing instruction.
 * Side-effect class: pure except for the injected port (reads main's checkout; writes nothing).
 */

import { err, ok, type DocRecord, type LoreError, type Result } from "@lore/core";

/** What the corpus checkout's tree (main's tree) reaches. Implemented over the census / registry helpers coverage uses. */
export interface MainTreePort {
  /** The subset of `commands` main's registry still lists as runnable commands. */
  /** @lore-site BR-1316 */
  presentCommands(commands: readonly string[]): Promise<Result<readonly string[], LoreError>>;
}

/** How to see what still depends on a change. */
function seeCoverage(leafSlug: string): string {
  return `run \`lore baseline coverage ${leafSlug}\` to see what main still reaches`;
}

function refusal(field: string, message: string, value: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, value };
}

/** Refuse removing command declarations of `leaf` that main's registry still has. */
export async function refuseLiveCommandRemoval(
  port: MainTreePort,
  leaf: DocRecord,
  removeCommands: readonly string[],
): Promise<Result<void, LoreError>> {
  if (removeCommands.length === 0) return ok(undefined);
  const present = await port.presentCommands(removeCommands);
  if (!present.ok) return present;
  if (present.value.length === 0) return ok(undefined);
  /** @lore-site BR-1316 */
  return err(refusal(
    "commands",
    `cannot remove command declaration(s) of ${leaf.slug}, nothing written: main's registry still has ${present.value.map((c) => `"${c}"`).join(", ")} as runnable. ` +
      `Removing them now would leave the command(s) undeclared for every other branch; wait until the branch that removes the command has landed (${seeCoverage(leaf.slug)}).`,
    present.value,
  ));
}
