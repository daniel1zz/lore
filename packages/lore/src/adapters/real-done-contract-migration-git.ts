/**
 * Module: real-done-contract-migration-git — the real `MigrationGitPort`: two read-only `git` questions in the repository root.
 *
 * Purpose: let `lore migrate done-contract` resolve a `--tip` commit and learn whether a claim's branch still exists.
 * Public surface: {@link createRealMigrationGit}.
 * Invariants: never writes; a ref git cannot resolve is `undefined` (a measured fact: exit 1 or 128), any other failure
 *   (git missing, not a repository) propagates so a broken checkout never reads as "unresolvable".
 * Side-effect class: IO (spawns `git`).
 */

import { execFileSync } from "node:child_process";
import type { MigrationGitPort } from "../service/done-contract-migration-service.js";

function resolve(repoRoot: string, spec: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "--verify", "--quiet", spec], { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return out.trim();
  } catch (cause) {
    const failure = cause as { status?: number | null };
    if (failure.status === 1 || failure.status === 128) return undefined;
    throw cause;
  }
}

/**
 * @param repoRoot - the directory `git` runs in (the project root holding `.lore/`)
 */
export function createRealMigrationGit(repoRoot: string): MigrationGitPort {
  return {
    resolveCommit: (ref) => (ref.startsWith("-") ? undefined : resolve(repoRoot, `${ref}^{commit}`)),
    branchTip: (name) => (name.startsWith("-") ? undefined : resolve(repoRoot, `refs/heads/${name}^{commit}`)),
  };
}
