/**
 * Real filesystem probe (SPEC-045 §Design Decisions D4) — the `FsProbe`
 * implementation `DriftCheckService.checkDrift` is injected with by the CLI/MCP
 * adapters, backed by synchronous `node:fs` calls resolved against a repo root
 * (the SAME `process.cwd()` assumption `lore status --check-tree`'s blueprint
 * lookup already makes). Shared by `adapters/cli/commands/status.ts` (CLI
 * `--check-drift`) and `adapters/mcp/tools.ts` (`lore_status {check_drift: true}`)
 * — one implementation, never two independently-written probes.
 *
 * Public surface:
 *   buildRealFsProbe(repoRoot?) — constructs an `FsProbe` rooted at `repoRoot`
 *     (default `process.cwd()`).
 *
 * @invariant `stat()` NEVER throws — every failure (ENOENT, EACCES, a symlink
 *   resolving to neither a file nor a directory, etc.) collapses to `"missing"`.
 *   This is deliberate, not a shortcut: `computeDrift` (`@lore/core`) classifies
 *   `stat === "missing"` as `file_missing`/`dir_missing` — a REAL drift row, not a
 *   silently-swallowed "consistent". Collapsing every stat failure into "missing"
 *   is therefore the SAFE direction for G11 (zero false negatives) — a genuinely
 *   deleted anchor (the seeded-drift-fixture's core scenario, SPEC-045 AC-DR-4)
 *   MUST classify as `file_missing`, never `probe_error`, which is why this
 *   method does not rethrow on unexpected errors the way `readFile`/`listDir` do.
 * @invariant `readFile()`/`listDir()` return `null` on failure (never throw) —
 *   `DriftCheckService.collectProbes` turns an explicit `null` into a
 *   `probe_error` drift row for that anchor, same effect as a caught throw
 *   (`FsProbe`'s own contract documents both as legal failure signals).
 *
 * Side-effect class: IO (synchronous node:fs reads only — never writes)
 * Source: SPEC-045 §Design Decisions D4
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FsProbe } from "../service/drift-check-service.js";

/**
 * Constructs a real, `node:fs`-backed {@link FsProbe} rooted at `repoRoot`.
 *
 * @param repoRoot - Absolute repo root every declared anchor path is resolved
 *   against. Defaults to `process.cwd()` (same assumption `lore status
 *   --check-tree`'s `lore.tree.yaml` lookup makes).
 * @returns An `FsProbe` implementation for {@link DriftCheckService.checkDrift}.
 * @example
 * const probe = buildRealFsProbe(process.cwd());
 * const result = await app.driftCheckService.checkDrift(probe);
 */
export function buildRealFsProbe(repoRoot: string = process.cwd()): FsProbe {
  return {
    stat(path: string): "file" | "dir" | "missing" {
      try {
        const st = statSync(join(repoRoot, path));
        if (st.isDirectory()) return "dir";
        if (st.isFile()) return "file";
        // reason: neither a plain file nor a directory (e.g. a socket, a dangling
        // symlink) — never affirmatively verified, collapses to "missing" (see
        // module @invariant above).
        return "missing";
      } catch {
        return "missing";
      }
    },
    readFile(path: string): string | null {
      try {
        return readFileSync(join(repoRoot, path), "utf8");
      } catch {
        return null;
      }
    },
    listDir(path: string): string[] | null {
      try {
        return readdirSync(join(repoRoot, path));
      } catch {
        return null;
      }
    },
  };
}
