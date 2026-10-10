/**
 * Read-only subprocess edge for the corpus checker scripts: runs the repo's SOURCE entry
 * (`bun packages/lore/src/index.ts`, no built binary needed) in the caller's cwd corpus.
 * Side-effect class: IO (spawns a process; callers pass read verbs only, never writes).
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CorpusReadError } from "./spec-corpus-checks.js";

const ENTRY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "packages", "lore", "src", "index.ts");

export interface LoreRun {
  readonly status: number;
  readonly stdout: string;
}

/** Run a lore READ command; a spawn failure or an exit not in `acceptExit` throws CorpusReadError. */
export function runLore(args: readonly string[], acceptExit: readonly number[] = [0]): LoreRun {
  const res = spawnSync("bun", [ENTRY, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const label = `lore ${args.join(" ")}`;
  if (res.error) throw new CorpusReadError(label, `spawn failed: ${res.error.message}`);
  if (res.status === null || !acceptExit.includes(res.status)) {
    throw new CorpusReadError(label, `exit ${String(res.status)}: ${res.stderr.slice(0, 300)}`);
  }
  return { status: res.status, stdout: res.stdout };
}
