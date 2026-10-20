/**
 * Config-template overlay merge (SPEC-058 §Design Decisions D6) — pure,
 * vitest-safe (no `bun:sqlite`, no `node:fs`). Parses the recommended
 * `assets/project/lore-config-template.yaml` overlay (SSOT asset, read
 * verbatim by adapter-layer callers — this module never reads it from disk
 * itself, mirrors `setup-project-flow.ts`'s "no ports touch fs directly
 * except the injected ones" split) and deep-merges it into a freshly-computed
 * base config object, so `lore init` / `lore setup --project` can seed new
 * corpora with the recommended verification-profile block (SPEC-058 §Scope)
 * without this module needing `verificationProfileSchema` to exist yet — that
 * schema lands via a CONCURRENT sibling task (`@lore/core`
 * `verification-profile.ts`), not present on this file's dependency graph.
 * The merged object is written to disk UNTYPED (`saveConfig` never validates
 * on write, only `loadConfig` validates on read — same as every other
 * `config.yaml` write in this codebase) and becomes schema-valid the moment
 * both this task's seeding and the sibling's schema addition are merged
 * together.
 *
 * Public surface:
 *   parseConfigTemplateOverlay(yamlText) — Result<Record<string, unknown>, LoreError>, never throws
 *   mergeConfigWithOverlay(base, overlay) — deep-merge, overlay wins on scalar/array conflicts
 *
 * Invariants:
 *   - Absence of a template is the CALLER's concern, not this module's — a
 *     caller with no template text simply never calls these functions, and
 *     the resulting `.lore/config.yaml` is byte-identical to pre-SPEC-058
 *     behaviour (REGRESSION-safe by construction: nothing here runs).
 *   - A malformed template is reported via `Result`, never thrown — callers
 *     (`flows/init-corpus.ts`, `adapters/cli/commands/init.ts`) log a warning
 *     and proceed WITHOUT the recommended block rather than failing the whole
 *     `lore init`/`lore setup --project` run (D1's "non-breaking" ethos
 *     extends to "a corrupted shipped asset must not brick corpus creation").
 *   - Merge is deep on plain objects (so `workflow.verification_profiles.*`
 *     composes with any OTHER `workflow.*` key a caller's base object may
 *     already carry) and shallow-replace on arrays/scalars — no section
 *     seeded by this template needs array-concatenation semantics.
 *   - `mergeConfigWithOverlay` never mutates either input — it always
 *     allocates fresh objects on the merge path, so a caller holding a
 *     reference to `base` after the call still sees the pre-merge value.
 *
 * Side-effect class: pure
 * Source: SPEC-058 §Design Decisions D6
 */

import yaml from "yaml";
import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

/** True for a non-null, non-array `object` — the shape both config and overlay must have at every merge level. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Renders a `LoreError`'s human-readable text for a stderr warning. `LoreError`
 * is a discriminated union — not every member carries `.message` (e.g.
 * `DOC_NOT_FOUND` carries `id`, not `message`) — mirrors `commands/setup.ts`'s
 * own `describeLoreError` narrowing (this module cannot import that one; it
 * lives in an adapter file, and this module must stay adapter-free).
 */
export function describeConfigTemplateError(error: LoreError): string {
  return "message" in error ? error.message : error.code;
}

/**
 * Parses a config-template overlay's raw YAML text into a plain object.
 * Never throws — malformed YAML or a non-object top level both become a
 * `VALIDATION_ERROR` Result.
 *
 * @param yamlText - Raw YAML content (e.g. `assets/project/lore-config-template.yaml`'s bytes).
 * @returns `ok(parsedObject)` on success, `err(VALIDATION_ERROR)` naming why parsing failed.
 * @example
 * parseConfigTemplateOverlay("workflow:\n  verification_profiles:\n    tech:\n      required_oracles: [test]\n")
 * // => { ok: true, value: { workflow: { verification_profiles: { tech: { required_oracles: ["test"] } } } } }
 * parseConfigTemplateOverlay("- not\n- an\n- object\n")
 * // => { ok: false, error: { code: "VALIDATION_ERROR", field: "configTemplateYaml", ... } }
 */
export function parseConfigTemplateOverlay(yamlText: string): Result<Record<string, unknown>, LoreError> {
  let parsed: unknown;
  try {
    parsed = yaml.parse(yamlText);
  } catch (cause) {
    return err({
      code: "VALIDATION_ERROR",
      field: "configTemplateYaml",
      message: `failed to parse config template overlay YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
      value: yamlText,
      rule: "BR-829",
    } satisfies LoreError);
  }

  if (!isPlainObject(parsed)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "configTemplateYaml",
      message: "config template overlay must parse to a YAML mapping (object) at the top level",
      value: parsed,
      rule: "BR-829",
    } satisfies LoreError);
  }

  return ok(parsed);
}

/**
 * Deep-merges `overlay` onto `base`, returning a NEW object — neither input
 * is mutated. Plain-object values at the same key are merged recursively;
 * any other value (array, scalar, or a type mismatch between `base`/`overlay`
 * at that key) is a shallow replace where `overlay` always wins.
 *
 * @param base - The starting config object (e.g. `{project: {name, author}}`).
 * @param overlay - The parsed template overlay (e.g. from {@link parseConfigTemplateOverlay}).
 * @returns A new merged object. If either argument is not a plain object, returns
 *   `overlay` when defined, else `base` — mirrors `??`'s "rightmost defined wins" shape
 *   for the degenerate (non-object) case, never throws.
 * @example
 * mergeConfigWithOverlay(
 *   { project: { name: "t", author: "t" } },
 *   { workflow: { verification_profiles: { tech: { required_oracles: ["test"] } } } },
 * )
 * // => { project: {...}, workflow: { verification_profiles: { tech: {...} } } }
 */
export function mergeConfigWithOverlay(base: unknown, overlay: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return overlay ?? base;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = merged[key];
    merged[key] =
      isPlainObject(baseValue) && isPlainObject(overlayValue)
        ? mergeConfigWithOverlay(baseValue, overlayValue)
        : overlayValue;
  }
  return merged;
}
