/**
 * Vite/vitest `resolve.alias` entries for the workspace packages, derived from
 * `tsconfig.base.json` `compilerOptions.paths` — the single source of truth that
 * bun (runtime + `bun test` + bundler) and tsc already read.
 *
 * Why this exists (task-skill-implement-tg-20-worktrees-resolve-their-own-lore):
 * a git worktree under `.claude/worktrees/agent-*` has no `node_modules`, so a bare
 * `@lore/core` import walks up to the MAIN checkout's `node_modules/@lore/core`, a
 * symlink to the main checkout's `packages/core`. A worktree that changed
 * `packages/core` was then silently tested against main's core. Resolving through
 * `paths`/aliases anchored at THIS file's directory never consults node_modules.
 *
 * Fails loud (throws) when `tsconfig.base.json` is unreadable or declares a target that does
 * not exist — a missing alias must never fall back to a node_modules lookup.
 *
 * Side-effect class: IO (reads tsconfig.base.json and stats each target at config load).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface WorkspaceAlias {
  readonly find: RegExp;
  readonly replacement: string;
}

/** `rootDir` is the checkout root, i.e. the directory holding `tsconfig.base.json`. */
export function workspaceAliases(rootDir: string): WorkspaceAlias[] {
  const baseConfigPath = resolve(rootDir, "tsconfig.base.json");
  let parsed: { compilerOptions?: { paths?: Record<string, string[]> } };
  try {
    parsed = JSON.parse(readFileSync(baseConfigPath, "utf8"));
  } catch (error) {
    throw new Error(
      `workspace-aliases: cannot read ${baseConfigPath} (${error instanceof Error ? error.message : String(error)}); refusing to fall back to node_modules resolution.`,
    );
  }
  const paths = parsed.compilerOptions?.paths;
  if (paths === undefined) {
    throw new Error(`workspace-aliases: ${baseConfigPath} declares no compilerOptions.paths.`);
  }
  const aliases: WorkspaceAlias[] = [];
  for (const [specifier, targets] of Object.entries(paths)) {
    if (!specifier.startsWith("@lore/")) continue;
    const target = targets[0];
    if (target === undefined) throw new Error(`workspace-aliases: paths["${specifier}"] has no target.`);
    const absolute = resolve(dirname(baseConfigPath), target);
    if (!existsSync(absolute)) {
      throw new Error(`workspace-aliases: paths["${specifier}"] -> ${absolute} does not exist.`);
    }
    aliases.push({ find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`), replacement: absolute });
  }
  if (aliases.length === 0) {
    throw new Error(`workspace-aliases: ${baseConfigPath} declares no @lore/* paths.`);
  }
  return aliases;
}
