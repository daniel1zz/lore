/**
 * The single resolver for the user's lore config folder (where the user's context fragments and the
 * user's `context/selection.yaml` live).
 * Spec: spec-rule-store-git-tracked-fragment-selection-on-demand-skill (BR-1065).
 *
 * Public surface: `resolveUserConfigDir`, `UserConfigDirEnv`.
 * Invariants:
 *   - Precedence: `LORE_CONFIG_HOME` > `XDG_CONFIG_HOME/lore` > `<homedir>/.config/lore`.
 *   - A variable that is unset OR the empty string counts as unset (matches both pre-existing code paths:
 *     `commands/fragments.ts` and the `XDG_CONFIG_HOME || join(home, ".config")` in `commands/context.ts`).
 *   - Backward compatible: with `LORE_CONFIG_HOME` unset the result equals the old refresh behaviour;
 *     with it set it equals the old `fragments` behaviour. Only refresh changes (it will honour
 *     `LORE_CONFIG_HOME`, which BR-1065 requires so both commands agree).
 * Side-effect class: pure (reads nothing but its arguments).
 */
import { join } from "node:path";

/** Environment subset the resolver reads; `process.env` satisfies it. */
export type UserConfigDirEnv = Readonly<Record<string, string | undefined>>;

/**
 * Resolve the user's lore config folder.
 *
 * @param env Environment variables (pass `process.env`).
 * @param homedir The user's home directory (pass `os.homedir()`).
 * @returns Directory path; fragments live in `<dir>/context/`.
 * @example resolveUserConfigDir({ XDG_CONFIG_HOME: "/x" }, "/h") // "/x/lore"
 */
export function resolveUserConfigDir(env: UserConfigDirEnv, homedir: string): string {
  const loreHome = env["LORE_CONFIG_HOME"];
  if (loreHome) return loreHome;
  const xdgConfigHome = env["XDG_CONFIG_HOME"];
  if (xdgConfigHome) return join(xdgConfigHome, "lore");
  return join(homedir, ".config", "lore");
}
