/**
 * Per-key precedence derivation for `defaults.*` (`editor`/`format`/`color`) —
 * pure, browser-safe module telling the Settings UI (SPEC-064 T4) which of the
 * three layers (machine, project, built-in) is EFFECTIVE for each key,
 * without the UI reimplementing `mergeDefaults`' project-wins semantics.
 *
 * Public surface:
 *   - BUILTIN_DEFAULTS — the runtime built-in fallback for each `defaults.*`
 *     key, represented HONESTLY: `format`/`color` have real built-ins
 *     ("text"/true), `editor` does not (the runtime falls through to
 *     `$EDITOR`/`vi`, resolved at call time by
 *     `adapters/cli/editor.ts::resolveEditorCommand` — this module has zero
 *     knowledge of environment variables and must not fabricate a value here).
 *   - computeDefaultsPrecedence(machine, project) — for each of the 3
 *     `LoreDefaultsSchema` keys, returns `{key, machine?, project?, builtin?,
 *     effective?, effectiveLayer}`. `effective` is read off
 *     `mergeDefaults(machine, project)` (imported, never reimplemented — see
 *     SPEC-064 §Design D4) falling back to `BUILTIN_DEFAULTS` when the merge
 *     result is undefined; `effectiveLayer` names WHICH layer produced that
 *     value, derived from simple presence (a key present on `project` always
 *     wins per `mergeDefaults`' own documented project-spread-last contract,
 *     so presence alone identifies the winning layer without re-deriving the
 *     merge policy itself).
 *
 * Invariants:
 *   - Zero Node builtins, zero IO, zero `Date.now()`/`Math.random()` — pure
 *     data transform only. Re-exported from the browser-safe `@lore/core`
 *     barrel (`index.ts`); see that file's header and `config-editability.ts`'s
 *     header for the full Vite-blank-SPA mechanism this must not trigger.
 *   - Never throws — a malformed or partial `LoreDefaults`-shaped input (extra
 *     keys, missing keys, an unrecognised `format` string that never passed
 *     `LoreDefaultsSchema.parse`) degrades to reading `undefined` off the
 *     missing/mismatched key rather than throwing; this module does no Zod
 *     validation of its own (that already happened upstream, at config load).
 *   - `computeDefaultsPrecedence` always returns exactly 3 rows, in the fixed
 *     order `["editor", "format", "color"]` (matching `LoreDefaultsSchema`'s
 *     declaration order) — deterministic rendering order for the UI, never
 *     `Object.keys` iteration order over a partial input.
 *
 * Side-effect class: pure
 *
 * Source: SPEC-064 §Design D4; @lore/core/config.ts::mergeDefaults, LoreDefaultsSchema
 */

import { mergeDefaults } from "./config.js";
import type { LoreDefaults } from "./config.js";

/** The 3 `LoreDefaultsSchema` keys, in declaration order — the fixed row order `computeDefaultsPrecedence` returns. */
const DEFAULTS_KEYS: readonly (keyof LoreDefaults)[] = ["editor", "format", "color"];

/**
 * Runtime built-in fallback for each `defaults.*` key, represented honestly:
 * `editor` is deliberately ABSENT (no built-in value — the runtime falls
 * through to `$EDITOR`/`vi`/`notepad`, an environment-dependent resolution
 * this pure module cannot and must not perform). `format`/`color` mirror the
 * literal defaults `adapters/cli` applies when `defaults.*` is unset.
 */
export const BUILTIN_DEFAULTS: Readonly<Partial<LoreDefaults>> = {
  format: "text",
  color: true,
};

/** Which layer produced a `DefaultsPrecedenceRow`'s `effective` value. */
export type DefaultsPrecedenceLayer = "machine" | "project" | "builtin";

/** Union of every possible `defaults.*` value shape — display-only, not a validated type. */
export type DefaultsPrecedenceValue = LoreDefaults[keyof LoreDefaults];

/** One row of the precedence table the Settings UI renders for a single `defaults.*` key. */
export interface DefaultsPrecedenceRow {
  key: keyof LoreDefaults;
  machine?: DefaultsPrecedenceValue;
  project?: DefaultsPrecedenceValue;
  /** Absent (not merely `undefined`-valued) for `editor` — see {@link BUILTIN_DEFAULTS}. */
  builtin?: DefaultsPrecedenceValue;
  /** `mergeDefaults(machine, project)[key]`, falling back to `builtin` when that is `undefined`. */
  effective?: DefaultsPrecedenceValue;
  effectiveLayer: DefaultsPrecedenceLayer;
}

/**
 * Derives, for each `defaults.*` key, which layer (machine, project,
 * built-in) is EFFECTIVE — the display data source for SPEC-064's precedence
 * rows. Uses {@link mergeDefaults} to compute the effective VALUE (never
 * reimplements project-wins precedence, per SPEC-064 §Design D4); `builtin`
 * comes from {@link BUILTIN_DEFAULTS}.
 *
 * @param machine - Parsed `defaults` section of the machine-scope config (`GlobalLoreConfigSchema`), or `undefined` when absent
 * @param project - Parsed `defaults` section of the project-scope config (`.lore/config.yaml`), or `undefined` when absent
 * @returns Exactly 3 rows, one per `defaults.*` key, in `["editor", "format", "color"]` order. Never throws.
 * @example
 *   computeDefaultsPrecedence({ editor: "vim", color: false }, { editor: "nano" })
 *   // => [
 *   //   { key: "editor", machine: "vim", project: "nano", builtin: undefined, effective: "nano", effectiveLayer: "project" },
 *   //   { key: "format", machine: undefined, project: undefined, builtin: "text", effective: "text", effectiveLayer: "builtin" },
 *   //   { key: "color", machine: false, project: undefined, builtin: true, effective: false, effectiveLayer: "machine" },
 *   // ]
 */
export function computeDefaultsPrecedence(
  machine: LoreDefaults | undefined,
  project: LoreDefaults | undefined,
): DefaultsPrecedenceRow[] {
  const merged = mergeDefaults(machine, project);

  return DEFAULTS_KEYS.map((key) => {
    const machineValue = machine?.[key];
    const projectValue = project?.[key];
    const builtinValue = BUILTIN_DEFAULTS[key];
    // reason: `??` (not `||`) — a falsy-but-present merged value (e.g.
    // `color: false`) must NOT be overridden by the built-in; only an
    // actually-undefined merge result falls back.
    const effective = merged[key] ?? builtinValue;
    // reason: presence-on-project always wins per mergeDefaults' own
    // documented "project spread last" contract — this reads that fact off
    // the inputs rather than re-deriving the merge policy.
    const effectiveLayer: DefaultsPrecedenceLayer =
      projectValue !== undefined ? "project" : machineValue !== undefined ? "machine" : "builtin";

    return {
      key,
      machine: machineValue,
      project: projectValue,
      builtin: builtinValue,
      effective,
      effectiveLayer,
    };
  });
}
