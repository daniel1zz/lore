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
 * adoption verdict (`mode`, `mode_source`, `downgraded_count`, `promotable`) is
 * taken from its `adoption` field verbatim.
 *
 * @invariant READ-ONLY: only `discoverMemoryFiles` reads and `existsSync` probes;
 *   nothing is written, so two runs over an unchanged tree are identical.
 * @invariant ROOT ONLY, deduped by realpath: entries come from `budgets.filenames`
 *   (never a hard-coded name, D9); a symlinked `AGENTS.md` -> `CLAUDE.md` counts once.
 * @invariant Absent-vs-present is meaningful: `undefined` means "no root memory file,
 *   or mode `enforce` with zero would-be deterministic findings". `warn` with a root
 *   file is ALWAYS present, even when clean (`promotable: true`) — never silent.
 *
 * Side-effect class: IO (synchronous node:fs reads only)
 * Source: spec-claude-md-root-section-structure-check-and-adoption-mode §Public Interface, D7-D9
 */

import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { resolveMemoryFileBudgets, type LoreConfig, type MemoryFileHealth } from "@lore/core";
import { discoverMemoryFiles } from "../real-memory-file-probe.js";
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
 *   schema-default budgets (adoption absent -> `warn`, `mode_source: "default"`).
 * @returns The health block, or `undefined` when there is nothing to report.
 * @example
 * computeMemoryFileHealth(process.cwd(), config);
 * // => { mode: "warn", mode_source: "default", missing: ["Commands"], out_of_order: false,
 * //      downgraded_kinds: ["section_missing"], downgraded_count: 1, promotable: false }
 */
export function computeMemoryFileHealth(
  repoRoot: string,
  config: LoreConfig | undefined,
): MemoryFileHealth | undefined {
  const budgets = resolveMemoryFileBudgets(config);
  const roots = dedupedRootFiles(repoRoot, budgets.filenames);
  if (roots.length === 0) return undefined;

  const { deterministic, advisory, adoption } = runMemoryFileChecks(roots, budgets, {
    fileExists: (p) => existsSync(join(repoRoot, p)),
    // Bootstrap never reaches the corpus DB for this check (same as --check-claude-md).
    docExists: () => true,
  });

  // Would-be deterministic findings: live in `deterministic` under enforce, and as
  // `downgraded` advisories (carrying the original kind) under warn.
  const wouldBe: { kind: string; reference?: string }[] = [
    ...deterministic.map((f) => ({ kind: f.kind, ...(f.reference === undefined ? {} : { reference: f.reference }) })),
    ...advisory.flatMap((f) =>
      f.kind === "downgraded" && f.downgraded_kind !== undefined
        ? [{ kind: f.downgraded_kind as string, ...(f.reference === undefined ? {} : { reference: f.reference }) }]
        : [],
    ),
  ];

  if (adoption.mode === "enforce" && wouldBe.length === 0) return undefined;

  const missing = wouldBe
    .filter((f) => f.kind === "section_missing" && f.reference !== undefined)
    .map((f) => f.reference as string);

  return {
    mode: adoption.mode,
    mode_source: adoption.mode_source,
    missing,
    out_of_order: wouldBe.some((f) => f.kind === "section_order"),
    downgraded_kinds: adoption.mode === "warn" ? [...new Set(wouldBe.map((f) => f.kind))] : [],
    downgraded_count: adoption.downgraded_count,
    promotable: adoption.promotable,
  };
}

/**
 * Renders the single human text line for a present health block.
 *
 * @param health - The block from {@link computeMemoryFileHealth}, or `undefined`.
 * @returns One line (no newline), or `undefined` when the block is absent.
 * @example
 * formatMemoryFileHealthLine({ mode: "warn", mode_source: "default", missing: ["Commands", "Module Index"],
 *   out_of_order: false, downgraded_kinds: ["section_missing"], downgraded_count: 2, promotable: false });
 * // => "Memory file health: WARN adoption=warn (default) — missing sections: Commands, Module Index; not yet promotable to enforce"
 */
export function formatMemoryFileHealthLine(health: MemoryFileHealth | undefined): string | undefined {
  if (health === undefined) return undefined;
  const parts: string[] = [];
  if (health.missing.length > 0) parts.push(`missing sections: ${health.missing.join(", ")}`);
  if (health.out_of_order) parts.push("sections out of order");
  const otherKinds = health.downgraded_kinds.filter((k) => k !== "section_missing" && k !== "section_order");
  if (otherKinds.length > 0) parts.push(`other findings: ${otherKinds.join(", ")}`);
  const detail = parts.length > 0 ? parts.join("; ") : "no findings";
  const verdict =
    health.mode === "warn"
      ? health.promotable
        ? "clean, promotable to enforce"
        : "not yet promotable to enforce"
      : "FAILING under enforce";
  return `Memory file health: ${health.mode === "warn" ? "WARN " : ""}adoption=${health.mode} (${health.mode_source}) — ${detail}; ${verdict}`;
}
