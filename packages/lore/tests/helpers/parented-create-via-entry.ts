/**
 * Test fixture helper: {@link ensureRequirementsDocSlugViaEntry}, the spawning twin of `ensureRequirementsDocSlug`.
 *
 * Purpose: kept apart from parented-create.ts because it starts a child process (`bun <entry>`); a test that only
 *   needs the in-process helpers must not reach a spawn through its imports (scripts/check-test-spawns.ts), so the
 *   spawn lives here and only the suites that drive the lore entry point import it.
 * Public surface: {@link ensureRequirementsDocSlugViaEntry}.
 * Invariants: the corpus at `cwd` is a throwaway, initialised project; a failing child throws (a fixture fault).
 * Side-effect class: IO (spawns `bun`, may create one requirements document in the corpus at `cwd`).
 */

import { spawnSync } from "node:child_process";
import { ensureRequirementsDocSlug } from "./parented-create.js";

/**
 * {@link ensureRequirementsDocSlug} for a suite that drives the lore entry point directly (`bun <entry> <args>`),
 * as the scripts' tests do.
 *
 * @param entry - Absolute path of `packages/lore/src/index.ts`.
 * @param cwd - The throwaway corpus directory (an initialised project).
 * @returns The requirements document's slug.
 */
export function ensureRequirementsDocSlugViaEntry(entry: string, cwd: string): string {
  return ensureRequirementsDocSlug((args) => {
    const ran = spawnSync("bun", [entry, ...args], { cwd, encoding: "utf8" });
    return { stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.status };
  });
}
