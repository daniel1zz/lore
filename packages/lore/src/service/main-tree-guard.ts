/**
 * Module: main-tree-guard — the one predicate that refuses a corpus write which REDUCES accountability while main's tree
 *   still needs what it drops.
 *
 * Purpose: the corpus is shared and un-branched. A branch that stops reaching a site / command / rule behaviour must not
 *   remove the site mapping, the command declaration or the rule from the corpus before it lands: every other tree still has
 *   the behaviour, so root coverage would go incomplete for everyone. "Main's tree" is the checkout holding the corpus.
 *   `RuleService` asks this module through the injected {@link MainTreePort} (wired in app.ts, so CLI, MCP and HTTP refuse alike).
 * Public surface: {@link MainTreePort}, {@link refuseReachedSiteRemoval}, {@link refuseLiveCommandRemoval},
 *   {@link refuseRuleWithdrawal}, {@link citingMappings}.
 * Invariants:
 *   - Only what the write touches is measured (one leaf's sites, the named commands, one rule's citing sites).
 *   - A port failure (census cannot be analysed) is returned as the refusal; it is never read as "not reached".
 *   - Every refusal is a VALIDATION_ERROR (exit 4) naming the dependents and the wait-for-landing instruction.
 * Side-effect class: pure except for the injected port (reads main's checkout; writes nothing).
 */

import { err, ok, type DocRecord, type LoreError, type Result } from "@lore/core";
import { parseOwnedBy } from "./owned-by.js";

/** What the corpus checkout's tree (main's tree) reaches. Implemented over the census / registry helpers coverage uses. */
export interface MainTreePort {
  /**
   * The subset of `keys` that main's tree reaches from a leaf declaring `commands`: the live commands' census sites
   * (bootstrap excluded), or, for a leaf with no live command, the keys whose file and symbol still exist in main's tree.
   */
  reachedSites(input: { commands: readonly string[]; keys: readonly string[] }): Promise<Result<readonly string[], LoreError>>;
  /** The subset of `commands` main's registry still lists as runnable commands. */
  presentCommands(commands: readonly string[]): Promise<Result<readonly string[], LoreError>>;
}

/** How to see what still depends on a change. */
function seeCoverage(leafSlug: string): string {
  return `run \`lore baseline coverage ${leafSlug}\` to see what main still reaches`;
}

function refusal(field: string, message: string, value: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, value };
}

/** Refuse removing site mappings of `leaf` that main's census still reaches from it. */
export async function refuseReachedSiteRemoval(
  port: MainTreePort,
  leaf: DocRecord,
  removeSites: readonly string[],
): Promise<Result<void, LoreError>> {
  if (removeSites.length === 0) return ok(undefined);
  const commands = Array.isArray(leaf.extra["commands"]) ? (leaf.extra["commands"] as string[]) : [];
  const reached = await port.reachedSites({ commands, keys: removeSites });
  if (!reached.ok) return reached;
  if (reached.value.length === 0) return ok(undefined);
  return err(refusal(
    "site_map",
    `cannot remove ${reached.value.length} site mapping(s) of ${leaf.slug}, nothing written: main's tree still reaches ${reached.value.join(", ")}. ` +
      `Removing them now would make root coverage incomplete for every other branch; wait until the branch that drops the site has landed, then remove them (${seeCoverage(leaf.slug)}).`,
    reached.value,
  ));
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
  return err(refusal(
    "commands",
    `cannot remove command declaration(s) of ${leaf.slug}, nothing written: main's registry still has ${present.value.map((c) => `"${c}"`).join(", ")} as runnable. ` +
      `Removing them now would leave the command(s) undeclared for every other branch; wait until the branch that removes the command has landed (${seeCoverage(leaf.slug)}).`,
    present.value,
  ));
}

/** One leaf's site mappings that cite a rule: `leaf` holds the mapping, `sites` are the mapped keys. */
export interface CitingMapping {
  readonly leaf: DocRecord;
  readonly sites: string[];
}

/**
 * The site mappings that cite `ruleId` of `ruleLeaf`: its own mappings naming the id directly, and every leaf's
 * `non-business:owned-by <ruleLeaf> ... <ruleId>` mapping (the census reaching the site is the MAPPING leaf's).
 */
export function citingMappings(ruleId: string, ruleLeaf: DocRecord, baselineDocs: readonly DocRecord[]): CitingMapping[] {
  const out: CitingMapping[] = [];
  const ownerRefs = new Set([ruleLeaf.id, ruleLeaf.slug]);
  for (const doc of baselineDocs) {
    if (doc.extra["node"] !== "leaf") continue;
    const raw = doc.extra["site_map"];
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const sites = Object.entries(raw as Record<string, string[]>)
      .filter(([, entries]) =>
        (entries ?? []).some((entry) => {
          if (doc.id === ruleLeaf.id && entry === ruleId) return true;
          const owned = parseOwnedBy(entry);
          return owned.kind === "owned_by" && ownerRefs.has(owned.leaf) && owned.ruleIds.includes(ruleId);
        }),
      )
      .map(([key]) => key);
    if (sites.length > 0) out.push({ leaf: doc, sites });
  }
  return out;
}

/**
 * Refuse retiring or moving `ruleId` while a site mapping on a site main's census reaches cites it (directly or via owned-by).
 * Only the citing sites are measured, one census per mapping leaf.
 */
export async function refuseRuleWithdrawal(
  port: MainTreePort,
  input: { ruleId: string; operation: "retire" | "move"; ruleLeaf: DocRecord; baselineDocs: readonly DocRecord[] },
): Promise<Result<void, LoreError>> {
  const dependents: string[] = [];
  for (const mapping of citingMappings(input.ruleId, input.ruleLeaf, input.baselineDocs)) {
    const commands = Array.isArray(mapping.leaf.extra["commands"]) ? (mapping.leaf.extra["commands"] as string[]) : [];
    const reached = await port.reachedSites({ commands, keys: mapping.sites });
    if (!reached.ok) return reached;
    for (const site of reached.value) dependents.push(`${site} (leaf ${mapping.leaf.slug})`);
  }
  if (dependents.length === 0) return ok(undefined);
  const verb = input.operation === "retire" ? "retire" : "move";
  return err(refusal(
    "ruleId",
    `cannot ${verb} ${input.ruleId}, nothing written: site mappings on sites main's tree still reaches cite it: ${dependents.join("; ")}. ` +
      `Wait until the branch that removes the behaviour has landed, then ${verb} it (see \`lore rule impact ${input.ruleId}\` and \`lore baseline coverage ${input.ruleLeaf.slug}\`).`,
    dependents,
  ));
}
