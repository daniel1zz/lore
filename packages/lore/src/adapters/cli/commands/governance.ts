/**
 * `lore governance` — SPEC-083 D1: prints the corpus-workflow governance
 * prose (`assets/governance/corpus-workflow.md`) verbatim to stdout, exit 0.
 *
 * Public surface: default export, a citty `CommandDef` with zero args (no
 * positionals, no `--json` — the payload IS text, per the spec's D1 note).
 *
 * Bootstrap-stage exemption (mirrors `commands/setup.ts`'s own documented
 * exemption, `adapters/cli/CLAUDE.md`'s "Key Invariants" #4 — "Document the
 * exemption when adding a new bootstrap-stage command"): this command MUST
 * NOT import `loader.ts` / `bun:sqlite` / `loadLoreApp`. It needs no `.lore/`
 * corpus at all — the governance prose is a static asset shipped alongside
 * the binary, resolved from the binary's OWN assets root (never an installed
 * on-disk copy under `<claude-dir>/governance/`, which SPEC-083 D3 retires
 * from the machine install set). The session-start hook's Phase C (SPEC-083
 * D2) spawns this verb instead of reading that now-retired installed file,
 * so prose and binary version can never drift apart — this verb IS the fix
 * for that drift class.
 *
 * Path resolution reuses `setup-args.ts`'s `resolveAssetsRoot` — the SAME
 * realpath-resolved, compiled-vs-dev-mode derivation `lore setup` uses (see
 * that module's doc comment for the full empirically-verified chain). This
 * is deliberate: prose and binary ship from the same `assets/` tree next to
 * `dist/lore`, so this command and `lore setup` must never diverge on where
 * that tree lives.
 *
 * Invariants:
 *   - Never a silent empty print — an unreadable asset (missing file,
 *     permission error, nonexistent `assetsRoot`) surfaces as a
 *     `VALIDATION_ERROR` through the normal `exitCode()`/`formatError()`
 *     pipeline (exit 4), never a swallowed empty stdout.
 *   - stdout is written via `writeAllSync` (the SAME non-blocking-fd1-safe
 *     primitive `installSyncStdio()` wires onto `console.*`) with ZERO added
 *     bytes (no trailing newline injection) — the hook's byte-parity
 *     contract (AC-083-1: stdout byte-identical to the source file) depends
 *     on this command never touching `console.log` (which appends `\n`).
 *
 * Side-effect class: IO (one synchronous file read via `node:fs`, one
 *   synchronous stdout write via `writeAllSync`) — no corpus, no network.
 *
 * Source: SPEC-083 §Design Decisions D1.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand } from "citty";
import type { LoreError } from "@lore/core";
import { resolveAssetsRoot, type SetupPathContext } from "../setup-args.js";
import { exitCode, formatError } from "../utils.js";
import { writeAllSync } from "../stdio-sync.js";

/** Repo-relative path (under `assetsRoot`) of the governance prose this command prints. */
const GOVERNANCE_ASSET_REL_PATH = "governance/corpus-workflow.md";

// ─── Repo-root resolution (dev mode only — mirrors commands/setup.ts's own
// identical derivation verbatim: packages/lore/src/adapters/cli/commands/
// governance.ts -> repo root is 6 levels up. Compiled mode never uses this —
// `resolveAssetsRoot` branches on `isCompiled` and derives from `execPath`
// instead, same as `lore setup`.) ─────────────────────────────────────────
const MODULE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..", "..", "..", "..", "..");

/**
 * Reads the governance asset's raw text off disk, given a resolved
 * `assetsRoot` (the SAME root `resolveAssetsRoot` computes for `lore setup`).
 *
 * @param assetsRoot - Absolute path to the repo's `assets/` tree.
 * @returns `{ok: true, value: <file contents>}`, or `{ok: false, error}`
 *   naming the unreadable path (never throws).
 * @throws Never.
 */
export function readGovernanceAsset(assetsRoot: string): { ok: true; value: string } | { ok: false; error: LoreError } {
  const assetPath = join(assetsRoot, GOVERNANCE_ASSET_REL_PATH);
  try {
    return { ok: true, value: readFileSync(assetPath, "utf8") };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: `lore governance: failed to read governance asset "${assetPath}": ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        field: "assetsRoot",
        value: assetsRoot,
      },
    };
  }
}

export default defineCommand({
  meta: {
    name: "governance",
    description:
      "Print the corpus-workflow governance prose (assets/governance/corpus-workflow.md) " +
      "verbatim to stdout — bootstrap-stage, no corpus required (SPEC-083 D1)",
  },
  args: {},
  run() {
    // Mirrors commands/setup.ts's own path-context resolution verbatim (see
    // setup-args.ts's module doc for the full `/$bunfs/` empirical chain) —
    // this command and `lore setup` must resolve the SAME assets/ tree.
    const pathCtx: SetupPathContext = {
      repoRoot: REPO_ROOT,
      isCompiled: Bun.main.startsWith("/$bunfs/"),
      execPath: process.execPath,
    };
    const assetsRoot = resolveAssetsRoot(pathCtx);

    const result = readGovernanceAsset(assetsRoot);
    if (!result.ok) {
      process.stderr.write(formatError(result.error) + "\n");
      process.exitCode = exitCode(result.error);
      return;
    }

    writeAllSync(1, result.value);
  },
});
