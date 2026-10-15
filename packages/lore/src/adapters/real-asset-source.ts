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
 *     from `@lore/core`'s `buildHookSettingsEntries("{{lore:claude_dir}}")` —
 *     this port has no knowledge of the eventual install target, so the
 *     hook commands it emits carry the literal `"{{lore:claude_dir}}"` placeholder
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
 *     SSOT, see their own doc comment) skip `governance/seat-briefing.md`
 *     specifically -- that file stays in the walked `assets/governance/` tree
 *     (still fingerprinted by the embedded assets manifest) but is never
 *     yielded into the `AssetPayload`, so `lore setup` neither writes nor
 *     manifest-tracks it. The runtime `lore governance` verb reads it
 *     straight from the binary's own assets root instead -- see that
 *     command's module header. The binary-read set is therefore NOT
 *     governance-only: `assets/context/*.md` (context fragments, kind
 *     `context`, spec-context-fragments-config-driven-layered-rule-injection
 *     D9) is read the same way and is never walked by `load()` at all
 *     (`BINARY_READ_ONLY_TOP_DIRS`, `isRetiredFromInstall`'s `context/`
 *     prefix rule, `listBinaryReadAssetPaths`) -- grep those symbols in this
 *     file, not this prose, for the live set. `setup-check.ts`'s `buildCheckEmbeddedManifest`
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
 *   - Files of kind skill/agent/hook are returned EXPANDED: every
 *     `{{lore:<name>}}` is replaced at outlet `asset:install` (BR-1097) via
 *     {@link expandInstalledAsset}; an expansion refusal is returned as the
 *     `Err` (never raw text). governance is returned verbatim.
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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { err, ok, buildHookSettingsEntries, expandTemplate } from "@lore/core";
import type { Result, LoreError } from "@lore/core";
import type { AssetFile, AssetOwnership, AssetPayload, SetupEntryKind } from "@lore/core";

/** Invocation variable `SetupService.resolvePayload` resolves to the real target dir via expandTemplate. */
const CLAUDE_DIR_PLACEHOLDER = "{{lore:claude_dir}}";

/**
 * SINGLE SOURCE OF TRUTH for files retired from the MACHINE install set
 * (SPEC-083 D3, extended by SPEC-085 D3) while still shipping/fingerprinted
 * under `assets/`. Keyed by the FULL path relative to `assetsRoot` (e.g.
 * `"governance/seat-briefing.md"`) — the SAME shape both `AssetFile.path`
 * (this port, below) and `EmbeddedAssetEntry.path`
 * (`../generated/assets-manifest.js`, built by `scripts/embed-assets-manifest.mjs`
 * walking `assets/` directly) use.
 *
 * `seat-briefing.md` is retired from `<claude-dir>/governance/` (SPEC-085 D3) —
 * the bootstrap-stage `lore governance seat-briefing` verb (SPEC-085 D1,
 * `adapters/cli/commands/governance.ts`: `GOVERNANCE_TOPIC_ASSETS`) serves it
 * straight from the binary's OWN `assets/` tree at read time, and Phase D of
 * the session-start hook spawns that verb instead of reading an installed copy
 * (SPEC-085 D2), so a setup-time-snapshotted copy cannot drift from the binary.
 * It still lives under `assets/governance/` and is still fingerprinted by the
 * embedded assets manifest — only ITS INSTALLATION is retired here.
 * `governance/corpus-workflow.md` is NOT a member any more: the file was deleted
 * and its prose now ships as `assets/context/corpus-workflow-*.md` fragments
 * (spec-context-fragments-config-driven-layered-rule-injection D9; guard:
 * `tests/unit/setup-governance-retirement.test.ts`, its REGRESSION describe).
 * The binary-read set is wider than the governance files: whole
 * `assets/context/` fragments follow the same read path via
 * {@link BINARY_READ_ONLY_TOP_DIRS} (declared below this set).
 *
 * **Two independent consumers, one declaration** (2026-07-26 regression fix):
 * this port's own `load()` walk (below) AND `setup-check.ts`'s
 * `buildCheckEmbeddedManifest` (which filters the EMBEDDED manifest — a
 * SEPARATE data source that also fingerprints every file under `assets/`)
 * BOTH exclude via {@link isRetiredFromInstall}. Before this export existed,
 * the exclusion lived ONLY in this port's walk — `lore setup --check`
 * classified a retired governance file `missing` on every freshly
 * converged target (the embedded manifest still listed it, nothing told the
 * check's classifier to skip it) even though the file was NEVER supposed to
 * be installed. A hand-duplicated literal path string in `setup-check.ts`
 * would have "fixed" the symptom while recreating the exact two-declarations-
 * of-one-fact defect this export exists to prevent. SPEC-085 D3 rides the
 * SAME single-declaration fix: adding `seat-briefing.md` here is the ONLY
 * edit needed for both consumers to agree.
 *
 * `skills/lore-init-context/SKILL.md` (added
 * spec-context-verb-family-two-zone-claude-md-anatomy-lore D10) is a
 * DIFFERENT retirement shape from the three `governance/*` entries above: the
 * `lore-init-context` skill is superseded outright by this spec's `context`
 * verb family (generation/refresh now live in `lore` itself, not a prompted
 * skill), so its source file is ALSO deleted from `assets/skills/` entirely —
 * this port's walk therefore never even encounters that path anymore. The
 * membership entry here is kept anyway (harmless, since `isRetiredFromInstall`
 * only ever narrows an already-produced candidate list) so
 * `setup-check.ts`'s `buildCheckEmbeddedManifest` keeps classifying any
 * STALE embedded-manifest/`.lore-setup-manifest.json` record of this path
 * (from an install predating this retirement) the same way it already
 * classifies the governance trio, rather than needing a second, divergent
 * "file never existed" code path for this one entry.
 */
export const RETIRED_FROM_INSTALL_PATHS = new Set<string>([
  "governance/seat-briefing.md",
  "governance/claude-md-contract.md",
  "skills/lore-init-context/SKILL.md",
]);

/**
 * Top-level `assets/` directories that are BINARY-READ ONLY: shipped in the npm
 * package and fingerprinted by the embedded manifest (generator kind `context`),
 * read at runtime via `resolveAssetsRoot`, and NEVER walked by `load()` nor
 * installed into `<claude-dir>/` (spec-context-fragments-config-driven-layered-
 * rule-injection D9; precedent: SPEC-083's governance read). Whole-directory
 * retirement, unlike {@link RETIRED_FROM_INSTALL_PATHS}'s per-file entries, so a
 * newly added fragment needs no edit here. Consumers: {@link isRetiredFromInstall}
 * (also used by `setup-check.ts`'s `buildCheckEmbeddedManifest`) and
 * {@link listBinaryReadAssetPaths} (npm assembly in `scripts/publish-npm.ts`).
 */
export const BINARY_READ_ONLY_TOP_DIRS: readonly string[] = ["context"];

/**
 * Predicate form of {@link RETIRED_FROM_INSTALL_PATHS} — `path` is the FULL
 * path relative to `assetsRoot`, never a bare filename (a bare-filename check
 * would risk excluding an unrelated same-named file nested elsewhere). Also
 * true for any path under a {@link BINARY_READ_ONLY_TOP_DIRS} directory
 * (`context/...`), matched on the `<dir>/` prefix.
 *
 * @param path - a full `assetsRoot`-relative path, e.g. `"governance/seat-briefing.md"`.
 * @returns `true` iff `path` is retired from the machine install set.
 * @throws Never.
 * @example
 * isRetiredFromInstall("governance/seat-briefing.md"); // => true
 * isRetiredFromInstall("governance/nested/seat-briefing.md"); // => false (different path)
 * isRetiredFromInstall("governance/corpus-workflow.md"); // => false (file deleted by fragments D9; no longer a member)
 */
export function isRetiredFromInstall(path: string): boolean {
  if (RETIRED_FROM_INSTALL_PATHS.has(path)) return true;
  return BINARY_READ_ONLY_TOP_DIRS.some((dir) => path.startsWith(`${dir}/`));
}

import type { AssetSource } from "../service/setup-service.js";
import { LORE_CONTEXT_VARIABLES } from "../service/context-variables-registry.js";

/**
 * Top-level `assets/` subdirectory name → the `SetupEntryKind` its files are tagged with.
 * Deliberately has NO `context` key: `assets/context/` is binary-read only
 * ({@link BINARY_READ_ONLY_TOP_DIRS}), never part of the install payload.
 */
const TOP_LEVEL_KIND_MAP: Record<string, SetupEntryKind> = {
  skills: "skill",
  agents: "agent",
  hooks: "hook",
  governance: "governance",
};

/**
 * Asset kinds whose text is expanded at install time (BR-1097): the files lore
 * copies into `<claude-dir>/`. `governance` is walked here too but is plain text
 * (no `{{lore:}}` allowed, enforced by `scripts/embed-assets-manifest.mjs`).
 */
export const EXPANDED_ASSET_KINDS: ReadonlySet<string> = new Set(["skill", "agent", "hook"]);

/**
 * SSOT for the installed bytes of one skill/agent/hook file: expands every
 * `{{lore:<name>}}` at outlet `asset:install` against {@link LORE_CONTEXT_VARIABLES}.
 * Both `RealAssetSource.load()` and the manifest script call this, so the embedded
 * sha256 and the installed bytes cannot drift apart (BR-1097).
 *
 * @param assetRelPath - path relative to `assets/` (named in refusals).
 * @param content - the source text.
 * @returns the expanded text, or VALIDATION_ERROR naming file:line and the variable.
 */
export function expandInstalledAsset(assetRelPath: string, content: string): Result<string, LoreError> {
  return expandTemplate(
    content,
    { outlet: "asset:install", path: assetRelPath, lineOffset: 0, invocation: {} },
    LORE_CONTEXT_VARIABLES,
  );
}

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
 * Lists every file under the {@link BINARY_READ_ONLY_TOP_DIRS} directories of
 * `assetsRoot` as `assetsRoot`-relative POSIX paths (`context/<file>.md`), sorted.
 * A missing directory contributes nothing (the `context` directory is legally
 * absent until fragments land); any other read failure propagates.
 *
 * @param assetsRoot - absolute path to the `assets/` directory.
 * @returns sorted relative paths; `[]` when no binary-read directory exists.
 * @throws Error from `readdirSync` for failures other than a missing directory.
 */
export function listBinaryReadAssetPaths(assetsRoot: string): string[] {
  const out: string[] = [];
  for (const dir of BINARY_READ_ONLY_TOP_DIRS) {
    const dirPath = join(assetsRoot, dir);
    if (!existsSync(dirPath)) continue;
    for (const rel of walkFilesRelative(dirPath)) out.push(`${dir}/${rel}`);
  }
  return out.sort();
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
        // (RETIRED_FROM_INSTALL_PATHS entries and the BINARY_READ_ONLY_TOP_DIRS dirs); every
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

        if (EXPANDED_ASSET_KINDS.has(kind)) {
          const expanded = expandInstalledAsset(assetRelPath, content);
          if (!expanded.ok) return expanded;
          content = expanded.value;
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
