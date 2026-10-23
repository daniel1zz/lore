/**
 * ClaudeSettingsPort — merge-writes ONLY the `language` key of a Claude Code settings file.
 *
 * Purpose: project lore's `context.language` into Claude Code's own `language` setting
 * (spec-context-fragments-config-driven-layered-rule-injection D3; AC-CF-5, AC-CF-18).
 * Public surface: `ClaudeSettingsPort.mergeLanguage`, `resolveLanguageName`,
 * `createRealClaudeSettingsFs`, types `ClaudeSettingsFs`.
 * Invariants:
 *   - Only the top-level `language` key is ever set; every other key keeps its value and
 *     position (JSON.parse/stringify preserves insertion order; indent is re-detected).
 *   - A file that exists but is not a JSON object (malformed, empty, array, scalar) is
 *     REFUSED with VALIDATION_ERROR and never overwritten — a settings file we cannot
 *     parse may hold the user's permissions/hooks.
 *   - An already-equal value performs no write (idempotent, no mtime churn).
 * Side-effect class: IO through the injected `ClaudeSettingsFs` only.
 * Mirror of the read side: `flows/fragments-flow.ts::checkLanguageDrift` compares the
 * same `LANGUAGE_NAMES` mapping against the same two file paths.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { err, languageName, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

/** Minimal file port. `read` returns null ONLY for a missing file; other failures throw. */
export interface ClaudeSettingsFs {
  /** @lore-site BR-827 */
  read(path: string): string | null;
  /** Creates parent directories as needed. May throw on a genuine IO failure. */
  /** @lore-site BR-827 */
  write(path: string, content: string): void;
}

/** Which config layer a language code came from (named in error messages). */
export type LanguageLayer = "global" | "project";

/**
 * Maps a `context.language` code to Claude Code's language name.
 * @returns err(VALIDATION_ERROR) naming the code and layer when the code is unknown.
 */
export function resolveLanguageName(code: string, layer: LanguageLayer): Result<string, LoreError> {
  return languageName(code, "context.language", layer);
}

function detectIndent(raw: string): number | string {
  const match = /^[ \t]+(?=")/m.exec(raw);
  return match === null ? 2 : match[0];
}

export class ClaudeSettingsPort {
  constructor(private readonly fs: ClaudeSettingsFs) {}

  /**
   * Sets `language` in the settings file at `path`, creating the file when absent.
   * @returns ok({changed}) — `changed:false` when the value was already equal (no write);
   *   err(VALIDATION_ERROR) when the file exists but is not a JSON object (nothing written).
   * @example
   * new ClaudeSettingsPort(createRealClaudeSettingsFs()).mergeLanguage("/h/.claude/settings.json", "Chinese");
   */
  mergeLanguage(path: string, language: string): Result<{ changed: boolean }, LoreError> {
    const raw = this.fs.read(path);
    if (raw === null) {
      this.fs.write(path, `${JSON.stringify({ language }, null, 2)}\n`);
      return ok({ changed: true });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      return err({
        code: "VALIDATION_ERROR",
        field: "settings",
        message: `${path} is not valid JSON, refusing to overwrite it: ${cause instanceof Error ? cause.message : String(cause)}`,
        value: path,
        rule: "BR-827",
      });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "settings",
        message: `${path} must hold a JSON object at its root, refusing to overwrite it`,
        value: path,
        rule: "BR-827",
      });
    }

    const settings = parsed as Record<string, unknown>;
    if (settings["language"] === language) return ok({ changed: false });
    settings["language"] = language;
    this.fs.write(path, `${JSON.stringify(settings, null, detectIndent(raw))}\n`);
    return ok({ changed: true });
  }
}

/** Real node:fs-backed port; writes atomically (tmp + rename) so a crash never leaves a partial settings file. */
export function createRealClaudeSettingsFs(): ClaudeSettingsFs {
  return {
    read(path) {
      try {
        return readFileSync(path, "utf8");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw cause;
      }
    },
    write(path, content) {
      mkdirSync(dirname(path), { recursive: true });
      const tmp = `${path}.tmp-${process.pid}`;
      writeFileSync(tmp, content, "utf8");
      renameSync(tmp, path);
    },
  };
}
