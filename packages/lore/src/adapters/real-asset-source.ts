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
 *
 * Side-effect class: IO (synchronous node:fs reads only — never writes).
 * Source: SPEC-046 §Design; declared file set mirrors
 *   `packages/lore/tests/unit/assets-ssot.test.ts`'s manifest (minus
 *   `assets/project/`, out of this port's scope).
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { err, ok, buildHookSettingsEntries } from "@lore/core";
import type { Result, LoreError } from "@lore/core";
import type { AssetFile, AssetPayload, SetupEntryKind } from "@lore/core";

/** Placeholder token substituted for the real target dir by `SetupService.resolvePayload`. */
const CLAUDE_DIR_PLACEHOLDER = "{{CLAUDE_DIR}}";

import type { AssetSource } from "../service/setup-service.js";

/** Top-level `assets/` subdirectory name → the `SetupEntryKind` its files are tagged with. */
const TOP_LEVEL_KIND_MAP: Record<string, SetupEntryKind> = {
  skills: "skill",
  agents: "agent",
  hooks: "hook",
  governance: "governance",
};

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
          path: `${topDir}/${relPath}`,
          kind,
          content,
          sha256: sha256Hex(content),
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
    });

    return ok({ files });
  }
}
