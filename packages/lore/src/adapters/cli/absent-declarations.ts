/**
 * Module: absent-declarations — which declared leaf commands the analysed tree does not have.
 *
 * Purpose: ONE predicate for "this declared command is absent from the tree", shared by `lore baseline coverage` (reports it),
 *   `lore approve` of a baseline node (refuses it) and `lore status` (lists it). The tree is the checkout holding the corpus
 *   (a worktree resolves the shared corpus, so that is main's tree); a leaf's commands are resolved with the census's own
 *   entry resolution and compared with the registry's runnable commands.
 * Public surface: {@link treePredicateFor}, {@link measureAbsentDeclarations}, {@link censusRootOfCorpus}, {@link buildBaselineDeclarationPort},
 *   {@link buildMainTreePort} / {@link armMainTree} (which commands main's registry still has, for command-declaration drops).
 * Invariants:
 *   - Only a command-unresolved failure reads as absent; any other census failure propagates (never read as absent).
 *   - Only the commands handed in are measured: approval measures the approved node's leaves, never the whole tree.
 *   - A corpus whose checkout holds no lore sources has no tree to compare with: `censusRootOfCorpus` is `undefined` and
 *     the caller reports "not measured", never "none absent".
 * Side-effect class: IO (reads the checkout's source files; executes none of them).
 */

import { dirname } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { absentDeclarationsOf, partitionDeclaredCommands, type AbsentDeclaration, type DeclaringLeaf } from "../../service/leaf-coverage.js";
import type { MainTreePort } from "../../service/main-tree-guard.js";
import type { BaselineDeclarationPort } from "../../service/review-service.js";
import type { RuleService } from "../../service/rule-service.js";
import { SiteCensusError, findCensusRoot, resolveCommandEntry } from "../../service/site-census.js";
import { listRunnableCommands, type RunnableCommand } from "./runnable-commands.js";

/** The predicate inputs of one tree: each declared command's census entry key, and the registry's runnable entry keys. */
export interface TreePredicate {
  /** The registry's runnable commands (the list `runnableEntries` is built from). */
  readonly runnable: readonly RunnableCommand[];
  /** `file#symbol` per declared command; `undefined` = the command resolves to no census entry. */
  readonly entryKeys: ReadonlyMap<string, string | undefined>;
  readonly runnableEntries: ReadonlySet<string>;
}

/**
 * Resolve `commands` against the tree at `rootDir`.
 *
 * @throws SiteCensusError when the tree's registry cannot be analysed, or a command fails to resolve for any reason other
 *   than "no such command" (never read as absent).
 */
export async function treePredicateFor(rootDir: string, commands: Iterable<string>): Promise<TreePredicate> {
  const runnable = await listRunnableCommands(rootDir);
  const runnableEntries = new Set(runnable.map((c) => `${c.entry.file}#${c.entry.symbol}`));
  const entryKeys = new Map<string, string | undefined>();
  for (const command of commands) {
    try {
      const entry = resolveCommandEntry({ rootDir, command });
      entryKeys.set(command, `${entry.file}#${entry.symbol}`);
    } catch (cause) {
      if (!(cause instanceof SiteCensusError && cause.reason === "command-unresolved")) throw cause;
      entryKeys.set(command, undefined);
    }
  }
  return { runnable, entryKeys, runnableEntries };
}

/** Absent declarations of `leaves` in the tree at `rootDir`; builds the tree predicate once. */
export async function measureAbsentDeclarations(rootDir: string, leaves: readonly DeclaringLeaf[]): Promise<AbsentDeclaration[]> {
  if (leaves.length === 0) return [];
  const { entryKeys, runnableEntries } = await treePredicateFor(rootDir, leaves.flatMap((l) => l.commands));
  return absentDeclarationsOf(leaves, entryKeys, runnableEntries);
}

/**
 * The lore source root of the checkout that holds the corpus at `dbPath` (`<checkout>/.lore/lore.db`), or `undefined` when
 * that checkout has no lore sources to analyse.
 */
export function censusRootOfCorpus(dbPath: string): string | undefined {
  return findCensusRoot(dirname(dirname(dbPath)));
}

/**
 * The port `ReviewService` measures a baseline node's leaves through (wired in app.ts, so approve, `set --status approved`,
 * MCP and HTTP all refuse alike). The tree is the one at `repoRoot` (the corpus checkout; main's tree from a worktree).
 * A checkout with no lore sources has no tree to compare with: nothing is measured. An unanalysable tree is a loud refusal.
 */
export function buildBaselineDeclarationPort(repoRoot: string): BaselineDeclarationPort {
  return {
    async absentDeclarations(leaves) {
      const rootDir = findCensusRoot(repoRoot);
      if (rootDir === undefined) return ok([]);
      try {
        return ok(await measureAbsentDeclarations(rootDir, leaves));
      } catch (cause) {
        if (!(cause instanceof SiteCensusError)) throw cause;
        return err({ code: "VALIDATION_ERROR", field: `census:${cause.reason}`, message: cause.message, rule: "BR-1309" });
      }
    },
  };
}

/**
 * The port `RuleService` asks before a command-declaration drop (`--remove-command`): which of the commands
 * main's tree (the checkout at `repoRoot`) still has as runnable. One registry predicate, the same helpers
 * coverage uses; only the commands the write touches are measured. A checkout with no lore sources has no tree
 * to compare with, so nothing is reached there (the same stance as {@link buildBaselineDeclarationPort}); an
 * unanalysable tree is a loud refusal, never "not reached".
 */
export function buildMainTreePort(repoRoot: string): MainTreePort {
  const guarded = async <T>(measure: (rootDir: string) => Promise<T>, none: T): Promise<Result<T, LoreError>> => {
    const rootDir = findCensusRoot(repoRoot);
    if (rootDir === undefined) return ok(none);
    try {
      return ok(await measure(rootDir));
    } catch (cause) {
      if (!(cause instanceof SiteCensusError)) throw cause;
      return err({ code: "VALIDATION_ERROR", field: `census:${cause.reason}`, message: `cannot measure main's tree, refusing the command drop: ${cause.message}`, rule: "BR-1317" });
    }
  };
  return {
    presentCommands: (commands) =>
      guarded(async (rootDir): Promise<readonly string[]> => {
        const { entryKeys, runnableEntries } = await treePredicateFor(rootDir, commands);
        const { live } = partitionDeclaredCommands(commands, entryKeys, runnableEntries);
        return live;
      }, []),
  };
}

/** Arm `ruleService` with main's tree; returns it so a composition root wires and constructs in one expression. */
export function armMainTree(ruleService: RuleService, repoRoot: string): RuleService {
  ruleService.setMainTreePort(buildMainTreePort(repoRoot));
  return ruleService;
}
