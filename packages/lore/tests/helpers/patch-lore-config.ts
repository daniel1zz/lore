/**
 * Test helper — the ONE way a test changes a project's `.lore/config.yaml` (BR-926).
 *
 * Purpose: read the existing file, parse it, deep-merge a patch, and write it back, so a fixture
 * never appends a second copy of a top-level key (`workflow:` is seeded by `lore init`) — a file with a
 * duplicate key does not parse, and the loader refuses it loudly.
 *
 * Public surface: {@link patchLoreConfig}, {@link readLoreConfig}.
 *
 * Invariants:
 *   - Objects merge recursively; arrays and scalars in the patch REPLACE the existing value
 *     (a patched list is the list the test asked for, never a union with the seeded one).
 *   - A patch value of `null` is written as `null` (YAML null), never skipped.
 *   - An existing file that does not parse throws — the helper never repairs a broken file in silence.
 *   - A missing file counts as `{}` (a fixture with no `lore init`).
 *   - `packages/lore/tests/integration/config-unparsable-loud.bun.test.ts` scans every test file and fails
 *     on any `.lore/config.yaml` write that does not go through this module.
 *
 * Side-effect class: IO (reads and writes one file under `<projectDir>/.lore/`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as yaml from "yaml";

/** A plain YAML-shaped object (the parsed form of a config file). */
export type LoreConfigPatch = Record<string, unknown>;

/** Options for {@link patchLoreConfig}. */
export interface PatchLoreConfigOptions {
  /**
   * Replace the whole file with the patch instead of merging into it. For a fixture that needs
   * exactly its own content (no seeded template keys).
   */
  readonly replace?: boolean;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = merged[key];
    merged[key] = isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return merged;
}

/**
 * Parses the project's config file.
 *
 * @param projectDir - the project root (the directory CONTAINING `.lore/`).
 * @returns the parsed object (`{}` for a missing or empty file).
 * @throws when the file exists and does not parse to a mapping (a duplicate key included).
 */
export function readLoreConfig(projectDir: string): Record<string, unknown> {
  const configPath = join(projectDir, ".lore", "config.yaml");
  if (!existsSync(configPath)) return {};
  const parsed: unknown = yaml.parse(readFileSync(configPath, "utf8"));
  if (parsed === null || parsed === undefined) return {};
  if (!isPlainObject(parsed)) throw new Error(`${configPath} does not hold a YAML mapping`);
  return parsed;
}

/**
 * Deep-merges `patch` into `<projectDir>/.lore/config.yaml` and writes it back.
 *
 * @param projectDir - the project root (the directory CONTAINING `.lore/`).
 * @param patch - an object, or YAML text parsed into one (so a fixture can keep its readable YAML literal).
 * @param opts - `replace: true` writes the patch alone.
 * @throws when the existing file does not parse, or a text patch is not a YAML mapping.
 * @example
 *   patchLoreConfig(dir, "workflow:\n  gates:\n    task-claim:\n      enabled: false\n");
 *   patchLoreConfig(dir, { feedback: { upstream: { repo: "owner/repo" } } });
 */
export function patchLoreConfig(projectDir: string, patch: LoreConfigPatch | string, opts: PatchLoreConfigOptions = {}): void {
  const patchObject: unknown = typeof patch === "string" ? yaml.parse(patch) : patch;
  if (!isPlainObject(patchObject)) throw new Error("patchLoreConfig: the patch must be a YAML mapping / object");
  const loreDir = join(projectDir, ".lore");
  mkdirSync(loreDir, { recursive: true });
  const next = opts.replace === true ? patchObject : deepMerge(readLoreConfig(projectDir), patchObject);
  writeFileSync(join(loreDir, "config.yaml"), yaml.stringify(next), "utf8");
}
