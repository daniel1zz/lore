/**
 * Real `AssetSource` (SPEC-046 §Design, P1 port implementation) — reads the
 * repo's vendored `assets/{skills,agents,hooks,governance}/` tree into an
 * in-memory `AssetPayload` for `SetupService.planInstall`/`install`.
 * Mirrors `real-fs-probe.ts`'s "one real implementation behind an injected
 * port" shape (SPEC-045 §Design Decisions D4 precedent).
 *
 * Public surface:
 *   - RealAssetSource implements AssetSource — constructor(assetsRoot: string)
 *
 * Invariants:
 *   - `assetsRoot` is a caller-resolved ABSOLUTE path to the repo's `assets/`
 *     directory — this module NEVER calls `process.cwd()` itself (mirrors
 *     `SetupService`'s own "targetDir is a resolved param" discipline; the
 *     CLI adapter resolves the real repo-relative path).
 *   - Only FOUR top-level subdirectories are walked: `skills`, `agents`,
 *     `hooks`, `governance`. `assets/project/` is DELIBERATELY excluded — it
 *     is a separate distribution concern (per-repo project scaffold),
 *     vendored by `ProjectSetupService`/`setup-project-flow.ts`, not this
 *     global-machine installer.
 *   - After walking the four directories, `load()` APPENDS exactly ONE
 *     synthetic `kind: "settings-hook"` entry (`path: "settings.json"`) built
 *     from `@lore/core`'s `buildHookSettingsEntries("{{CLAUDE_DIR}}")` —
 *     this port has no knowledge of the eventual install target, so the
 *     hook commands it emits carry the literal `"{{CLAUDE_DIR}}"` placeholder
 *     token; `SetupService.resolvePayload` substitutes the real `targetDir`
 *     before merging (see that module's doc comment, and
 *     `distribution-hooks.ts`'s "does NOT know or care" invariant). This is
 *     NOT a real file on disk under `assets/` — there is no `settings.json`
 *     in the walked tree — so it is exempt from `assets-ssot.test.ts`'s
 *     `DECLARED_FILES` (a real-file manifest); `real-setup-ports.test.ts`
 *     tracks it directly against this port's own output instead.
 *   - `AssetFile.path` is POSIX-joined and relative to `assetsRoot` (e.g.
 *     `skills/lore/SKILL.md`) — this becomes the path under the INSTALL
 *     target dir (e.g. `~/.claude/skills/lore/SKILL.md`), never absolute.
 *   - `AssetFile.kind` is derived from the top-level directory name alone:
 *     `skills → "skill"`, `agents → "agent"`, `hooks → "hook"`,
 *     `governance → "governance"` (`TOP_LEVEL_KIND_MAP`).
 *   - SPEC-083 D3: `isRetiredFromInstall`/`RETIRED_FROM_INSTALL_PATHS` (exported
 *     SSOT, see their own doc comment) skip `governance/corpus-workflow.md`
 *     specifically -- that file stays in the walked `assets/governance/` tree
 *     (still fingerprinted by the embedded assets manifest) but is never
 *     yielded into the `AssetPayload`, so `lore setup` neither writes nor
 *     manifest-tracks it. The runtime `lore governance` verb reads it
 *     straight from the binary's own assets root instead -- see that
 *     command's module header. `setup-check.ts`'s `buildCheckEmbeddedManifest`
 *     imports this SAME predicate to filter the EMBEDDED manifest it
 *     classifies against -- see this predicate's own doc for why a
 *     hand-duplicated literal there was rejected.
 *   - `AssetFile.executable` records the SOURCE file's on-disk owner-execute
 *     bit (`mode & 0o100 !== 0`), set ONLY when `true` (omitted, never
 *     `false` — see `assetFileSchema`'s doc in `@lore/core`). `SetupService`
 *     does not yet consume this field for its own write decision (it
 *     independently hardcodes `executable: true` for every `kind: "hook"`
 *     write) — captured here for data completeness ahead of that wiring.
 *   - `sha256` is computed here over `content` purely to satisfy
 *     `assetFileSchema`'s non-empty constraint — `SetupService.resolvePayload`
 *     ALWAYS recomputes it over the FINAL on-disk bytes (its own invariant
 *     I5) and never trusts this value.
 *   - `load()` never throws — an unreadable `assetsRoot`/subdirectory/file
 *     surfaces as `err(STORE_ERROR)` naming the failing path, never a
 *     partial or silently-empty payload.
 *   - **SPEC-076 D8 — `AssetFile.ownership` is set EXPLICITLY here, per file,
 *     never derived from `kind`.** This is the concrete producer `@lore/core`'s
 *     `setup-manifest.ts` module doc names as the I6 legal-pairing table's
 *     MACHINE-installer row: every walked file (all four `TOP_LEVEL_KIND_MAP`
 *     kinds) is `ownership: "managed"` (`WALKED_ASSET_OWNERSHIP`); the
 *     synthetic `settings.json` entry is `ownership: "merged"` (it is written
 *     via `mergeSettings`'s deterministic merge, never a blind overwrite). No
 *     file this port returns is ever `"user_once"` — that zone belongs
 *     exclusively to the project-scaffold path (`setup-project-flow.ts`,
 *     `lore.tree.yaml`/config templates), which this port has no knowledge of.
 *     Every `AssetFile` `load()` returns therefore carries a non-undefined
 *     `ownership` — `real-asset-source-ownership.test.ts` pins this as an
 *     enumeration assertion over both the real repo `assets/` tree and a
 *     synthetic fixture tree.
 *
 * Side-effect class: IO (synchronous node:fs reads only — never writes).
 * Source: SPEC-046 §Design; declared file set mirrors
 *   `packages/lore/tests/unit/assets-ssot.test.ts`'s manifest (minus
 *   `assets/project/`, out of this port's scope). SPEC-076 §C1, §C4, D8
 *   (ownership declaration).
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { err, ok, buildHookSettingsEntries } from "@lore/core";
import type { Result, LoreError } from "@lore/core";
import type { AssetFile, AssetOwnership, AssetPayload, SetupEntryKind } from "@lore/core";

/** Placeholder token substituted for the real target dir by `SetupService.resolvePayload`. */
const CLAUDE_DIR_PLACEHOLDER = "{{CLAUDE_DIR}}";

/**
 * SINGLE SOURCE OF TRUTH for files retired from the MACHINE install set
 * (SPEC-083 D3, extended by SPEC-085 D3) while still shipping/fingerprinted
 * under `assets/`. Keyed by the FULL path relative to `assetsRoot` (e.g.
 * `"governance/corpus-workflow.md"`) — the SAME shape both `AssetFile.path`
 * (this port, below) and `EmbeddedAssetEntry.path`
 * (`../generated/assets-manifest.js`, built by `scripts/embed-assets-manifest.mjs`
 * walking `assets/` directly) use.
 *
 * `corpus-workflow.md` is retired from `<claude-dir>/governance/` — the
 * bootstrap-stage `lore governance` verb (SPEC-083 D1) prints it straight
 * from the binary's OWN `assets/` tree at read time, so an installed,
 * setup-time-snapshotted copy can no longer drift out of sync with the
 * binary. `seat-briefing.md` is retired the same way (SPEC-085 D3) — the
 * SAME verb's `--seat-briefing` flag (SPEC-085 D1) now serves it at runtime,
 * and Phase D of the session-start hook spawns that flag instead of reading
 * an installed copy (SPEC-085 D2). Both files still live under
 * `assets/governance/` (this port's `load()` never walks anything else) and
 * are still fingerprinted by the embedded assets manifest — only THEIR
 * INSTALLATION is retired here; the `governance/` install directory is now
 * empty (no governance files are written to `<claude-dir>/governance/`).
 *
 * **Two independent consumers, one declaration** (2026-07-26 regression fix):
 * this port's own `load()` walk (below) AND `setup-check.ts`'s
 * `buildCheckEmbeddedManifest` (which filters the EMBEDDED manifest — a
 * SEPARATE data source that also fingerprints every file under `assets/`)
 * BOTH exclude via {@link isRetiredFromInstall}. Before this export existed,
 * the exclusion lived ONLY in this port's walk — `lore setup --check`
 * classified `governance/corpus-workflow.md` `missing` on every freshly
 * converged target (the embedded manifest still listed it, nothing told the
 * check's classifier to skip it) even though the file was NEVER supposed to
 * be installed. A hand-duplicated literal path string in `setup-check.ts`
 * would have "fixed" the symptom while recreating the exact two-declarations-
 * of-one-fact defect this export exists to prevent. SPEC-085 D3 rides the
 * SAME single-declaration fix: adding `seat-briefing.md` here is the ONLY
 * edit needed for both consumers to agree.
 */
export const RETIRED_FROM_INSTALL_PATHS = new Set<string>([
  "governance/corpus-workflow.md",
  "governance/seat-briefing.md",
]);

/**
 * Predicate form of {@link RETIRED_FROM_INSTALL_PATHS} — `path` is the FULL
 * path relative to `assetsRoot`, never a bare filename (a bare-filename check
 * would risk excluding an unrelated same-named file nested elsewhere).
 *
 * @param path - a full `assetsRoot`-relative path, e.g. `"governance/corpus-workflow.md"`.
 * @returns `true` iff `path` is retired from the machine install set.
 * @throws Never.
 * @example
 * isRetiredFromInstall("governance/corpus-workflow.md"); // => true
 * isRetiredFromInstall("governance/seat-briefing.md"); // => true
 * isRetiredFromInstall("governance/nested/corpus-workflow.md"); // => false (different path)
 */
export function isRetiredFromInstall(path: string): boolean {
  return RETIRED_FROM_INSTALL_PATHS.has(path);
}

import type { AssetSource } from "../service/setup-service.js";

/** Top-level `assets/` subdirectory name → the `SetupEntryKind` its files are tagged with. */
const TOP_LEVEL_KIND_MAP: Record<string, SetupEntryKind> = {
  skills: "skill",
  agents: "agent",
  hooks: "hook",
  governance: "governance",
};

/**
 * Ownership zone for every file walked out of the four `TOP_LEVEL_KIND_MAP`
 * directories (SPEC-076 D8) — all four kinds (`skill`/`agent`/`hook`/
 * `governance`) are tool-owned, read-only distribution units from THIS
 * port's perspective (see module doc's I6 table). A single constant, not a
 * per-kind map, because the mapping is uniform across all four — unlike
 * `kind`, which genuinely varies per top-level directory.
 */
const WALKED_ASSET_OWNERSHIP: AssetOwnership = "managed";

/**
 * Ownership zone for the synthetic `settings.json`/`kind: "settings-hook"`
 * entry (SPEC-076 D8) — it is written via `mergeSettings`'s deterministic,
 * both-parties-co-own merge, never a blind managed-style overwrite.
 */
const SETTINGS_HOOK_OWNERSHIP: AssetOwnership = "merged";

/** Hex sha256 of a UTF-8 string — mirrors `SetupService`'s own private helper of the same shape. */
function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Renders any thrown value as a diagnostic string (never re-throws). Mirrors `SetupService`'s `describeCaught`. */
function describeCaught(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** Recursively collects every regular file under `dir`, as POSIX paths relative to `dir`. */
function walkFilesRelative(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(current, entry.name), rel);
      } else if (entry.isFile()) {
        out.push(rel);
      }
    }
  };
  walk(dir, "");
  return out;
}

/**
 * Reads the repo's vendored `assets/{skills,agents,hooks,governance}/` tree
 * (rooted at `assetsRoot`) into an `AssetSource` for `SetupService`.
 *
 * @example
 * const source = new RealAssetSource(path.join(repoRoot, "assets"));
 * const result = await source.load();
 */
export class RealAssetSource implements AssetSource {
  constructor(private readonly assetsRoot: string) {}

  async load(): Promise<Result<AssetPayload, LoreError>> {
    const files: AssetFile[] = [];

    for (const [topDir, kind] of Object.entries(TOP_LEVEL_KIND_MAP)) {
      const dirPath = join(this.assetsRoot, topDir);
      let relPaths: string[];
      try {
        relPaths = walkFilesRelative(dirPath);
      } catch (cause) {
        return err({
          code: "STORE_ERROR",
          message: `RealAssetSource: failed to read directory "${dirPath}": ${describeCaught(cause)}`,
          ...(cause instanceof Error ? { cause } : {}),
        });
      }

      for (const relPath of relPaths) {
        const assetRelPath = `${topDir}/${relPath}`;

        // SPEC-083 D3 / SPEC-085 D3 — skip files retired from the install set
        // (governance/corpus-workflow.md, governance/seat-briefing.md); every
        // other file is unaffected. See RETIRED_FROM_INSTALL_PATHS's doc for
        // why this is a full-path, not bare-filename, exclusion.
        if (isRetiredFromInstall(assetRelPath)) {
          continue;
        }

        const fullPath = join(dirPath, relPath);
        let content: string;
        let mode: number;
        try {
          content = readFileSync(fullPath, "utf8");
          mode = statSync(fullPath).mode;
        } catch (cause) {
          return err({
            code: "STORE_ERROR",
            message: `RealAssetSource: failed to read file "${fullPath}": ${describeCaught(cause)}`,
            ...(cause instanceof Error ? { cause } : {}),
          });
        }

        const isExecutable = (mode & 0o100) !== 0;
        files.push({
          path: assetRelPath,
          kind,
          content,
          sha256: sha256Hex(content),
          ownership: WALKED_ASSET_OWNERSHIP,
          ...(isExecutable ? { executable: true } : {}),
        });
      }
    }

    const settingsHookContent = JSON.stringify(buildHookSettingsEntries(CLAUDE_DIR_PLACEHOLDER), null, 2);
    files.push({
      path: "settings.json",
      kind: "settings-hook",
      content: settingsHookContent,
      sha256: sha256Hex(settingsHookContent),
      ownership: SETTINGS_HOOK_OWNERSHIP,
    });

    return ok({ files });
  }
}
