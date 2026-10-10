#!/usr/bin/env bun
/**
 * Read-only census of the live corpus (AC-BLS3B-11, `spec-baseline-slice-3b-specs-belong-to-the-trees-through`):
 * `lore status --json` must report `specs_with_parent.count == 0` and `specs_without_citation.count == 0`.
 * Prints both counts; exit 0 = both zero, 1 = names every offending slug, 2 = lore output unreadable.
 * Side-effect class: IO (read-only lore call). Decision logic lives in `scripts/lib/spec-corpus-checks.ts`.
 */
import { runLore } from "./lib/lore-cli.js";
import { CorpusReadError, evaluateCensus, parseCensus } from "./lib/spec-corpus-checks.js";

/** CLI surface: returns the process exit code. */
export function main(): number {
  try {
    const verdict = evaluateCensus(parseCensus(runLore(["status", "--json"]).stdout));
    for (const line of verdict.lines) console.log(line); // CLI surface
    return verdict.ok ? 0 : 1;
  } catch (err) {
    if (err instanceof CorpusReadError) {
      console.error(`check-spec-citation-census: read error: ${err.message}`); // CLI surface
      return 2;
    }
    throw err;
  }
}

if (import.meta.main) process.exit(main());
