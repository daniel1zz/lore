/**
 * The memory-file half of `lore migrate memory-limits`: what a person must fix before the
 * always-enforced limits pass (task-memory-file-limits-are-always-enforced-the-warn-adoption).
 *
 * Public surface:
 *   listMemoryFileFindings(repoRoot, configText) — one report per memory file that has deterministic findings.
 *
 * Why here: the migrate command repairs the very config every other command now refuses, so it cannot go
 * through `loadLoreApp`; it resolves budgets from the config TEXT as it will read once the setting is gone,
 * and routes through `runMemoryFileChecks` (the sole composition entry) like every other memory-file check.
 *
 * @invariant READ-ONLY: only `discoverMemoryFiles`, `discoverFragmentDocuments` and the `FsProbe` read; no memory file
 *   is ever rewritten (a breached ceiling or a missing section is judgement work, not a mechanical edit).
 * @invariant NEVER defaults silently: a config text that fails validation is returned as an error, not read as "no
 *   settings".
 *
 * Side-effect class: IO (synchronous node:fs reads only)
 */

import { loadConfigFromString, resolveMemoryFileBudgets, ok, type LoreError, type Result } from "@lore/core";
import { buildRealFsProbe } from "../real-fs-probe.js";
import { discoverFragmentDocuments, discoverMemoryFiles } from "../real-memory-file-probe.js";
import { runMemoryFileChecks } from "../../service/claude-md-admission.js";

/** One memory file and the deterministic findings a person must fix in it. */
export interface MemoryFileFindingsReport {
  /** Path as discovered, relative to the repo root (a fragment document keeps its own path). */
  readonly path: string;
  /** One `[kind] message` line per finding. */
  readonly lines: readonly string[];
}

/**
 * Lists the deterministic memory-file findings under the budgets `configText` yields.
 *
 * @param repoRoot - Directory the memory files are discovered under (the repo root that owns `.lore/config.yaml`).
 * @param configText - The config as it reads once the retired setting is gone.
 * @returns `ok([])` when every memory file conforms; `err(VALIDATION_ERROR)` when `configText` is invalid.
 * @example
 * listMemoryFileFindings("/repo", "project:\n  name: x\n");
 * // => ok([{ path: "CLAUDE.md", lines: ["[max_lines] CLAUDE.md has 500 lines, exceeding the root max_lines ceiling of 300"] }])
 */
export function listMemoryFileFindings(repoRoot: string, configText: string): Result<MemoryFileFindingsReport[], LoreError> {
  const config = loadConfigFromString(configText);
  if (!config.ok) return config;
  const budgets = resolveMemoryFileBudgets(config.value);
  const files = discoverMemoryFiles(repoRoot, budgets.filenames);
  const { deterministic } = runMemoryFileChecks(files, budgets, {
    probe: buildRealFsProbe(repoRoot),
    referenceDocuments: discoverFragmentDocuments(repoRoot),
    // The migration never reaches the corpus DB (same as --check-claude-md): slug pointers are `--check-memory-pointers`'s job.
    docExists: () => true,
  });
  const byPath = new Map<string, string[]>();
  for (const finding of deterministic) {
    const lines = byPath.get(finding.path) ?? [];
    lines.push(`[${finding.kind}] ${finding.message}`);
    byPath.set(finding.path, lines);
  }
  return ok([...byPath].map(([path, lines]) => ({ path, lines })));
}
