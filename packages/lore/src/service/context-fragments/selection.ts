/**
 * Fragment selection file model: which fragments a scope has switched off.
 * Spec: spec-rule-store-git-tracked-fragment-selection-on-demand-skill (BR-1060, BR-1062, BR-1063).
 *
 * Public surface: `SelectionSchema`, `Selection`, `SelectionScope`, `SelectionError`, `SELECTION_FILE`,
 *   `emptySelection`, `parseSelection`, `serializeSelection`, `addToDisable`, `removeFromDisable`,
 *   `selectionToLayer`.
 * Invariants:
 *   - File shape is `{schemaVersion: 1, disable: string[]}`, strict (unknown keys are refused).
 *   - `serializeSelection` is deterministic: `disable` sorted + deduplicated, fixed YAML form, so a
 *     repeated add/remove yields byte-equal output (BR-1063 idempotence).
 *   - Nothing here throws: every failure is a `VALIDATION_ERROR` Result.
 *   - Locations: project `.lore/context/selection.yaml`; user `<userConfigDir>/context/selection.yaml`
 *     (see `user-config-dir.ts`). This module does no IO; callers read/write the files.
 * Side-effect class: pure.
 */
import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { err, ok, type ContextConfigLayer, type Fragment, type LoreError, type Result } from "@lore/core";
import { checkOverrides } from "./select.js";

/** Which selection file: the project's (git-tracked) or the user's. */
export type SelectionScope = "project" | "user";

/** Where each scope's file lives, relative to the project root / the user config dir. */
export const SELECTION_FILE: Readonly<Record<SelectionScope, string>> = {
  project: ".lore/context/selection.yaml",
  user: "context/selection.yaml",
};

export const SelectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    disable: z.array(z.string().min(1)),
  })
  .strict();

export type Selection = z.infer<typeof SelectionSchema>;

/** The only error this module returns; narrowed so callers can read `message`. */
export type SelectionError = Extract<LoreError, { code: "VALIDATION_ERROR" }>;

function selectionError(field: string, message: string, value?: unknown): SelectionError {
  return { code: "VALIDATION_ERROR", field, message, value };
}

/** A selection that disables nothing (what an absent file means). */
export function emptySelection(): Selection {
  return { schemaVersion: 1, disable: [] };
}

function normalizeDisable(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

/**
 * Parse and validate selection file text.
 *
 * @param text Raw file contents.
 * @param source Path shown in error messages (the file being parsed).
 * @returns ok(Selection) with `disable` sorted + deduplicated, or VALIDATION_ERROR naming `source`.
 */
export function parseSelection(text: string, source: string): Result<Selection, SelectionError> {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    /** @lore-site BR-1062 */
    return err(selectionError("selection", `${source}: invalid YAML: ${cause instanceof Error ? cause.message : String(cause)}`));
  }
  const parsed = SelectionSchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    /** @lore-site BR-1062 */
    return err(selectionError("selection", `${source}: invalid selection file (${detail})`, raw));
  }
  return ok({ schemaVersion: 1, disable: normalizeDisable(parsed.data.disable) });
}

/** Deterministic YAML text for a selection (sorted, deduplicated, trailing newline). */
export function serializeSelection(selection: Selection): string {
  return stringifyYaml({ schemaVersion: 1, disable: normalizeDisable(selection.disable) }, { lineWidth: 0 });
}

function layerOf(selection: Selection): ContextConfigLayer {
  return { context: { fragments: { disable: selection.disable } } };
}

function refuseUnknown(id: string, fragments: readonly Fragment[]): SelectionError | null {
  if (fragments.some((f) => f.frontmatter.id === id)) return null;
  return selectionError("id", `unknown fragment id: ${id}`, id);
}

/**
 * Disable a fragment (`context remove`). Idempotent: disabling an already-disabled id returns an equal selection.
 *
 * @param selection Current selection of `scope`.
 * @param id Fragment id.
 * @param scope Scope owning `selection`.
 * @param fragments ALL discovered fragments, un-merged (the flow supplies them): defines the known ids and
 *   lets a static main fragment the scope does not own be refused (reuses `checkOverrides`).
 * @returns ok(new Selection), or VALIDATION_ERROR (unknown id / not owned).
 */
export function addToDisable(
  selection: Selection,
  id: string,
  scope: SelectionScope,
  fragments: readonly Fragment[],
): Result<Selection, SelectionError> {
  const unknown = refuseUnknown(id, fragments);
  /** @lore-site BR-1063 */
  if (unknown) return err(unknown);
  const next: Selection = { schemaVersion: 1, disable: normalizeDisable([...selection.disable, id]) };
  const own = layerOf(next);
  const other: ContextConfigLayer = {};
  // reason: ownership rules live in checkOverrides (SSOT); "global" there is the user scope.
  const verdict = checkOverrides(fragments, scope === "project" ? { global: other, project: own } : { global: own, project: other });
  if (!verdict.ok) return err(selectionError("id", `${verdict.error.message} (scope: ${scope})`, id));
  return ok(next);
}

/**
 * Re-enable a fragment (`context add`). Idempotent: removing an id that is not disabled returns an equal selection.
 *
 * @param selection Current selection of the scope.
 * @param id Fragment id.
 * @param fragments ALL discovered fragments (defines the known ids).
 * @returns ok(new Selection), or VALIDATION_ERROR for an unknown id.
 */
export function removeFromDisable(selection: Selection, id: string, fragments: readonly Fragment[]): Result<Selection, SelectionError> {
  const unknown = refuseUnknown(id, fragments);
  /** @lore-site BR-1063 */
  if (unknown) return err(unknown);
  return ok({ schemaVersion: 1, disable: normalizeDisable(selection.disable.filter((d) => d !== id)) });
}

/**
 * Map a selection into the `ContextConfigLayer` shape `select.ts` / `checkOverrides` already consume,
 * refusing a settings-file layer that still carries its own `fragments.disable` (BR-1062).
 *
 * @param selection The scope's selection.
 * @param configLayer The same scope's settings-file layer (its `language` is kept).
 * @param scope Scope, used to name the file to move the list to.
 * @returns ok(layer with the selection's disable list), or VALIDATION_ERROR naming `selection.yaml`.
 */
export function selectionToLayer(
  selection: Selection,
  configLayer: ContextConfigLayer,
  scope: SelectionScope,
): Result<ContextConfigLayer, SelectionError> {
  const stray = configLayer.context?.fragments?.disable ?? [];
  if (stray.length > 0) {
    /** @lore-site BR-1062 */
    return err(
      selectionError(
        "context.fragments.disable",
        `context.fragments.disable in a settings file is not supported; move [${[...stray].sort().join(", ")}] to ${SELECTION_FILE[scope]} (selection.yaml, disable list)`,
        stray,
      ),
    );
  }
  const language = configLayer.context?.language;
  return ok({
    context: {
      ...(language === undefined ? {} : { language }),
      fragments: { disable: selection.disable },
    },
    ...(configLayer.workflow === undefined ? {} : { workflow: configLayer.workflow }),
  });
}
