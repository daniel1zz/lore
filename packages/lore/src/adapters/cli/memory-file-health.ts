/**
 * Root memory-file health for `lore bootstrap`
 * (spec-claude-md-root-section-structure-check-and-adoption-mode, D7/D8/D9; AC-STR-5).
 *
 * Public surface:
 *   computeMemoryFileHealth(repoRoot, config) — the optional `memory_file_health` block.
 *   formatMemoryFileHealthLine(health)        — the ONE human text line, or undefined.
 *
 * Why here: `SessionService` has no filesystem, so health is composed in the CLI
 * adapter and attached beside `sessionService.bootstrap`. It routes through
 * `runMemoryFileChecks` (the sole composition entry) and re-derives nothing: the
 * findings are taken from its `deterministic` field verbatim (limits are always
 * enforced: there is no adoption mode).
 *
 * @invariant READ-ONLY: only `discoverMemoryFiles`, `discoverFragmentDocuments` and the `FsProbe` read;
 *   nothing is written, so two runs over an unchanged tree are identical.
 * @invariant ROOT ONLY, deduped by realpath: entries come from `budgets.filenames`
 *   (never a hard-coded name, D9); a symlinked `AGENTS.md` -> `CLAUDE.md` counts once.
 * @invariant Absent-vs-present is meaningful: `undefined` means "no root memory file, or
 *   a root file with zero deterministic findings"; a root file with any finding is ALWAYS present.
 *
 * Side-effect class: IO (synchronous node:fs reads only)
 * Source: spec-claude-md-root-section-structure-check-and-adoption-mode §Public Interface, D7-D9 (adoption mode retired by
 * task-memory-file-limits-are-always-enforced-the-warn-adoption)
 */

import { realpathSync } from "node:fs";
import { join } from "node:path";
import { resolveMemoryFileBudgets, type LoreConfig, type MemoryFileHealth } from "@lore/core";
import { buildRealFsProbe } from "../real-fs-probe.js";
import { discoverFragmentDocuments, discoverMemoryFiles } from "../real-memory-file-probe.js";
import { runMemoryFileChecks } from "../../service/claude-md-admission.js";
import type { MemoryFileRecord } from "../../service/claude-md-findings.js";

/** `realpathSync` that collapses an unresolvable path to itself (dedupe key only). */
function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Root-role records only, first occurrence per realpath wins. */
function dedupedRootFiles(repoRoot: string, filenames: string[]): MemoryFileRecord[] {
  const seen = new Set<string>();
  const roots: MemoryFileRecord[] = [];
  for (const record of discoverMemoryFiles(repoRoot, filenames)) {
    if (record.role !== "root") continue;
    const key = realpathOrSelf(join(repoRoot, record.path));
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push(record);
  }
  return roots;
}

/**
 * Computes the optional `memory_file_health` block for `lore bootstrap`.
 *
 * @param repoRoot - Directory the memory files are discovered under (the process cwd).
 * @param config - The project config `loadLoreApp()` already parsed; `undefined` resolves
 *   schema-default budgets.
 * @returns The health block, or `undefined` when there is nothing to report.
 * @example
 * computeMemoryFileHealth(process.cwd(), config);
 * // => { missing: ["Commands"], out_of_order: false, finding_kinds: ["section_missing"], finding_count: 1 }
 */
export function computeMemoryFileHealth(
  repoRoot: string,
  config: LoreConfig | undefined,
): MemoryFileHealth | undefined {
  const budgets = resolveMemoryFileBudgets(config);
  const roots = dedupedRootFiles(repoRoot, budgets.filenames);
  if (roots.length === 0) return undefined;

  const { deterministic } = runMemoryFileChecks(roots, budgets, {
    probe: buildRealFsProbe(repoRoot),
    referenceDocuments: discoverFragmentDocuments(repoRoot),
    // Bootstrap never reaches the corpus DB for this check (same as --check-claude-md).
    docExists: () => true,
  });
  if (deterministic.length === 0) return undefined;

  return {
    missing: deterministic.filter((f) => f.kind === "section_missing" && f.reference !== undefined).map((f) => f.reference as string),
    out_of_order: deterministic.some((f) => f.kind === "section_order"),
    finding_kinds: [...new Set(deterministic.map((f) => f.kind as string))],
    finding_count: deterministic.length,
  };
}

/**
 * Renders the single human text line for a present health block.
 *
 * @param health - The block from {@link computeMemoryFileHealth}, or `undefined`.
 * @returns One line (no newline), or `undefined` when the block is absent.
 * @example
 * formatMemoryFileHealthLine({ missing: ["Commands", "Module Index"], out_of_order: false,
 *   finding_kinds: ["section_missing"], finding_count: 2 });
 * // => "Memory file health: FAILING — missing sections: Commands, Module Index"
 */
export function formatMemoryFileHealthLine(health: MemoryFileHealth | undefined): string | undefined {
  if (health === undefined) return undefined;
  const parts: string[] = [];
  if (health.missing.length > 0) parts.push(`missing sections: ${health.missing.join(", ")}`);
  if (health.out_of_order) parts.push("sections out of order");
  const otherKinds = health.finding_kinds.filter((k) => k !== "section_missing" && k !== "section_order");
  if (otherKinds.length > 0) parts.push(`other findings: ${otherKinds.join(", ")}`);
  return `Memory file health: FAILING — ${parts.join("; ")}`;
}
