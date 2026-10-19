/**
 * Module: runnable-commands — every runnable CLI command of a lore source checkout, read from its command registry.
 *
 * Purpose: root coverage must refuse a command that no baseline leaf declares (BR-660: complete coverage is
 *   absolute), so it needs the full list of commands a user can run. The list is derived from the REGISTRY
 *   (`COMMAND_LOADERS` of `<root>/packages/lore/src/adapters/cli/index.ts`), never a hand list, and read STATICALLY
 *   from source with the census's TypeScript program: a `bun build --compile` binary cannot import the analysed
 *   checkout's code (its bare imports do not resolve), so nothing of the checkout is executed.
 * Public surface: {@link listRunnableCommands}, {@link RunnableCommand}.
 * Invariants:
 *   - A command is runnable iff its definition has a `run`; a group without `run` is not listed, its subcommands are.
 *   - `name` is the space-separated name `lore baseline map --command` accepts (`ac add`, `baseline glossary add`);
 *     `entry` is the census entry `resolveCommandEntry` yields for that same name, so a declared command and a
 *     registry command compare by entry, whatever spelling the leaf used (`ac-add` vs `ac add`).
 *   - A registry or command module that cannot be resolved statically is a loud {@link SiteCensusError}, never a
 *     shorter list (a shorter list would read as "nothing undeclared").
 * Side-effect class: IO (reads the checkout's source files; executes none of them).
 */

import { listRunnableCommandPaths, type SiteCensusEntry } from "../../service/site-census.js";

/** One runnable command: how a leaf names it and where the census starts. */
export interface RunnableCommand {
  readonly name: string;
  readonly entry: SiteCensusEntry;
}

const REGISTRY_FILE = "packages/lore/src/adapters/cli/index.ts";
const REGISTRY_VAR = "COMMAND_LOADERS";

/**
 * List every runnable command registered by the checkout at `rootDir`, sorted by name.
 *
 * @throws SiteCensusError("command-unresolved") when the registry or a command module is not statically resolvable.
 * @example
 * await listRunnableCommands("/repo"); // [{ name: "ac add", entry: { file: ".../commands/ac.ts", symbol: "default.subCommands.add.run" } }, ...]
 */
export async function listRunnableCommands(rootDir: string): Promise<RunnableCommand[]> {
  const found = listRunnableCommandPaths({ rootDir, registryFile: REGISTRY_FILE, registryVar: REGISTRY_VAR });
  const out = found.map(
    ({ top, file, subs }): RunnableCommand => ({
      name: [top, ...subs].join(" "),
      entry: { file, symbol: ["default", ...subs.map((t) => `subCommands.${t}`), "run"].join(".") },
    }),
  );
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
