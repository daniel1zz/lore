/**
 * Module: absent-declarations — which declared leaf commands the analysed tree does not have.
 *
 * Purpose: ONE predicate for "this declared command is absent from the tree", shared by `lore baseline coverage` (reports it),
 *   `lore approve` of a baseline node (refuses it) and `lore status` (lists it). The tree is the checkout holding the corpus
 *   (a worktree resolves the shared corpus, so that is main's tree); a leaf's commands are resolved with the census's own
 *   entry resolution and compared with the registry's runnable commands.
 * Public surface: {@link treePredicateFor}, {@link measureAbsentDeclarations}, {@link censusRootOfCorpus}.
 * Invariants:
 *   - Only a command-unresolved failure reads as absent; any other census failure propagates (never read as absent).
 *   - Only the commands handed in are measured: approval measures the approved node's leaves, never the whole tree.
 *   - A corpus whose checkout holds no lore sources has no tree to compare with: `censusRootOfCorpus` is `undefined` and
 *     the caller reports "not measured", never "none absent".
 * Side-effect class: IO (reads the checkout's source files; executes none of them).
 */

import { dirname } from "node:path";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { absentDeclarationRefusal, absentDeclarationsOf, leavesUnder, type AbsentDeclaration, type DeclaringLeaf } from "../../service/leaf-coverage.js";
import { resolveDoc } from "../../service/resolve.js";
import { SQLiteStore } from "../../store/sqlite-store.js";
import { SiteCensusError, findCensusRoot, resolveCommandEntry } from "../../service/site-census.js";
import { listRunnableCommands, type RunnableCommand } from "./runnable-commands.js";

/** The predicate inputs of one tree: a declared command's census entry key, and the registry's runnable entry keys. */
export interface TreePredicate {
  /** The registry's runnable commands (the list `runnableEntries` is built from). */
  readonly runnable: readonly RunnableCommand[];
  readonly entryKeyOf: (command: string) => string | undefined;
  readonly runnableEntries: ReadonlySet<string>;
}

/**
 * @throws SiteCensusError when the tree's registry cannot be analysed (never a shorter list).
 */
export async function treePredicateFor(rootDir: string): Promise<TreePredicate> {
  const runnable = await listRunnableCommands(rootDir);
  const runnableEntries = new Set(runnable.map((c) => `${c.entry.file}#${c.entry.symbol}`));
  const entryKeyOf = (command: string): string | undefined => {
    try {
      const entry = resolveCommandEntry({ rootDir, command });
      return `${entry.file}#${entry.symbol}`;
    } catch (cause) {
      if (cause instanceof SiteCensusError && cause.reason === "command-unresolved") return undefined;
      throw cause;
    }
  };
  return { runnable, entryKeyOf, runnableEntries };
}

/** Absent declarations of `leaves` in the tree at `rootDir`; builds the tree predicate once. */
export async function measureAbsentDeclarations(rootDir: string, leaves: readonly DeclaringLeaf[]): Promise<AbsentDeclaration[]> {
  if (leaves.length === 0) return [];
  const { entryKeyOf, runnableEntries } = await treePredicateFor(rootDir);
  return absentDeclarationsOf(leaves, entryKeyOf, runnableEntries);
}

/**
 * The lore source root of the checkout that holds the corpus at `dbPath` (`<checkout>/.lore/lore.db`), or `undefined` when
 * that checkout has no lore sources to analyse.
 */
export function censusRootOfCorpus(dbPath: string): string | undefined {
  return findCensusRoot(dirname(dirname(dbPath)));
}

/**
 * The approval verdict for `idOrSlug`: `ok` unless it is a baseline node with a leaf at or below it declaring a command absent
 * from the corpus checkout's tree, in which case a VALIDATION_ERROR (exit 4) naming each command and its fix. Only the
 * node's own leaves are measured (never the whole tree). A document that is not a baseline node, or a corpus whose checkout
 * holds no lore sources (no tree to compare with), is not this check's concern: `ok`. An unanalysable tree refuses loudly.
 */
export async function checkBaselineApprovable(dbPath: string, idOrSlug: string): Promise<Result<void, LoreError>> {
  const rootDir = censusRootOfCorpus(dbPath);
  if (rootDir === undefined) return ok(undefined);
  const store = new SQLiteStore(dbPath);
  try {
    const resolved = await resolveDoc(store, idOrSlug);
    if (!resolved.ok || resolved.value.type !== "baseline") return ok(undefined);
    const all = await store.findMany({ type: "baseline" });
    if (!all.ok) return all;
    const leaves = leavesUnder(resolved.value, all.value);
    let absent: AbsentDeclaration[];
    try {
      absent = await measureAbsentDeclarations(rootDir, leaves);
    } catch (cause) {
      if (!(cause instanceof SiteCensusError)) throw cause;
      return err({ code: "VALIDATION_ERROR", field: `census:${cause.reason}`, message: cause.message });
    }
    if (absent.length === 0) return ok(undefined);
    return err({ code: "VALIDATION_ERROR", field: "baseline-commands", message: absentDeclarationRefusal(resolved.value.slug, absent), value: absent });
  } finally {
    store.close();
  }
}
