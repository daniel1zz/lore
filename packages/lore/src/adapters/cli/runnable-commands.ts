/**
 * Module: runnable-commands — every runnable CLI command of a lore source checkout, read from its command registry.
 *
 * Purpose: root coverage must refuse a command that no baseline leaf declares (BR-660: complete coverage is
 *   absolute), so it needs the full list of commands a user can run. The list is derived from the REGISTRY
 *   (`COMMAND_LOADERS` of `<root>/packages/lore/src/adapters/cli/index.ts`), never a hand list.
 * Public surface: {@link listRunnableCommands}, {@link RunnableCommand}.
 * Invariants:
 *   - A command is runnable iff its definition has a `run`; a group without `run` is not listed, its subcommands are.
 *   - `name` is the space-separated name `lore baseline map --command` accepts (`ac add`, `baseline glossary add`);
 *     `entry` is the census entry `resolveCommandEntry` yields for that same name, so a declared command and a
 *     registry command compare by entry, whatever spelling the leaf used (`ac-add` vs `ac add`).
 *   - A registry that cannot be loaded is a loud {@link SiteCensusError}, never an empty list (an empty list would
 *     read as "nothing undeclared").
 * Side-effect class: IO (dynamic import of the registry and every command module of the checkout).
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { SiteCensusError, type SiteCensusEntry } from "../../service/site-census.js";

/** One runnable command: how a leaf names it and where the census starts. */
export interface RunnableCommand {
  readonly name: string;
  readonly entry: SiteCensusEntry;
}

interface CommandNode {
  readonly run?: unknown;
  readonly subCommands?: unknown;
}

const REGISTRY_FILE = "packages/lore/src/adapters/cli/index.ts";
const COMMANDS_DIR = "packages/lore/src/adapters/cli/commands";

/** citty `Resolvable`: a value, a promise, or a function returning either; a module namespace yields its default. */
async function resolveNode(value: unknown): Promise<CommandNode | undefined> {
  const resolved = typeof value === "function" ? await (value as () => unknown)() : await value;
  if (typeof resolved !== "object" || resolved === null) return undefined;
  const node = resolved as CommandNode & { default?: unknown };
  if (node.run === undefined && node.subCommands === undefined && node.default !== undefined) return resolveNode(node.default);
  return node;
}

async function collect(node: CommandNode, tokens: readonly string[], file: string, out: RunnableCommand[]): Promise<void> {
  if (typeof node.run === "function") {
    const symbol = ["default", ...tokens.slice(1).map((t) => `subCommands.${t}`), "run"].join(".");
    out.push({ name: tokens.join(" "), entry: { file, symbol } });
  }
  const subs = await resolveNode(node.subCommands);
  if (subs === undefined) return;
  for (const [name, value] of Object.entries(subs)) {
    const child = await resolveNode(value);
    if (child !== undefined) await collect(child, [...tokens, name], file, out);
  }
}

/**
 * List every runnable command registered by the checkout at `rootDir`, sorted by name.
 *
 * @throws SiteCensusError("command-unresolved") when the registry cannot be loaded or exposes no `COMMAND_LOADERS`.
 * @example
 * await listRunnableCommands("/repo"); // [{ name: "ac add", entry: { file: ".../commands/ac.ts", symbol: "default.subCommands.add.run" } }, ...]
 */
export async function listRunnableCommands(rootDir: string): Promise<RunnableCommand[]> {
  const registryPath = path.resolve(rootDir, REGISTRY_FILE);
  let loaders: Record<string, () => Promise<unknown>>;
  try {
    // reason: a path computed from the analysed root, so the vite-ignore hint keeps a bundler from resolving it statically.
    const mod = (await import(/* @vite-ignore */ pathToFileURL(registryPath).href)) as { COMMAND_LOADERS?: Record<string, () => Promise<unknown>> };
    if (mod.COMMAND_LOADERS === undefined) throw new Error("module exports no COMMAND_LOADERS");
    loaders = mod.COMMAND_LOADERS;
  } catch (cause) {
    throw new SiteCensusError("command-unresolved", { reason: "command registry not loadable", registry: REGISTRY_FILE, cause: String(cause) });
  }
  const out: RunnableCommand[] = [];
  for (const [name, load] of Object.entries(loaders)) {
    const node = await resolveNode(await load());
    if (node === undefined) continue;
    await collect(node, [name], `${COMMANDS_DIR}/${name}.ts`, out);
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
