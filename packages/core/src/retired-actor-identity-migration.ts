/**
 * The removal of the retired claim-time identity setting of the `task-claim` gate, for `lore migrate config-keys`.
 *
 * Purpose: claims compare RUNS only (spec-every-write-is-made-by-a-known-party-an-attested-agent-run end state 4,
 * BR-1040), so the setting that switched the same-name collision guard no longer exists. The strict config schema
 * rejects it like any unknown key; this module is the ONE place that still names it, so that `lore migrate config-keys`
 * can cut it out of a project config. Nothing reads its value and no loader special-cases it.
 *
 * Public surface: {@link RETIRED_ACTOR_IDENTITY_FIELD}, {@link removeRetiredActorIdentityGate},
 * {@link RetiredActorIdentityRemoval}.
 *
 * Invariants:
 *   - Pure and browser-safe: no filesystem, no Node builtin (`config-node.ts` writes the file).
 *   - The text edit is a line-wise cut: every byte of the config outside the setting (and the parent mappings the cut
 *     leaves empty) is identical. Flow-style placement is refused by name (the operator deletes it by hand).
 *
 * Side-effect class: pure.
 */

import yaml from "yaml";
import { ok, err } from "./errors.js";
import type { Result, LoreError } from "./errors.js";

/** The `LoreError.field` of the retired `task-claim` gate setting that `lore migrate config-keys` removes. */
export const RETIRED_ACTOR_IDENTITY_FIELD = 'workflow.gates."task-claim".actor_identity';

/** What {@link removeRetiredActorIdentityGate} computed for a config text. */
export interface RetiredActorIdentityRemoval {
  /** The config text without the setting: every other byte is identical to the input. */
  readonly text: string;
  /** The value the removed setting carried (for example `{ enabled: false }`). */
  readonly value: unknown;
}

/**
 * The offset just past the last scalar of `node` (a scalar, or the deepest last content of a collection), or `undefined`
 * when no position is known. A collection's own `range[1]` can include the line break and the blank lines after it, which
 * would make the next line look like part of the cut; the last scalar's end never does.
 */
function contentEndOf(node: unknown): number | undefined {
  if (yaml.isScalar(node)) return node.range?.[1] ?? undefined;
  if (!yaml.isCollection(node)) return undefined;
  let end: number | undefined;
  for (const item of node.items) {
    const parts = yaml.isPair(item) ? [item.key, item.value] : [item];
    for (const part of parts) {
      const partEnd = contentEndOf(part);
      if (partEnd !== undefined && (end === undefined || partEnd > end)) end = partEnd;
    }
  }
  return end;
}

/**
 * PURE computation of the removal of `workflow.gates."task-claim".actor_identity` from a config text. The setting
 * switched the retired claim-time same-name guard; claims now compare runs only (BR-1040), so there is nothing left for
 * it to switch and the strict config schema refuses the key. The setting's own lines are cut out, and so is every parent
 * mapping (`task-claim`, `gates`, `workflow`) that the cut leaves empty. Every other byte is identical.
 * Writing the result is `lore migrate config-keys --apply`'s job: no loader ever writes a config file.
 *
 * @param yamlText - the raw config file text
 * @returns `ok(undefined)` when the setting is absent; `ok({text, value})` when present; `err(VALIDATION_ERROR)` when
 *   the YAML is malformed or the setting shares a line with other keys (flow style), which cannot be cut out without
 *   rewriting them: the operator deletes it by hand (nothing is written).
 * @example
 *   removeRetiredActorIdentityGate('workflow:\n  gates:\n    "task-claim":\n      actor_identity:\n        enabled: false\n');
 *   // => ok({ text: "", value: { enabled: false } })
 */
export function removeRetiredActorIdentityGate(yamlText: string): Result<RetiredActorIdentityRemoval | undefined, LoreError> {
  const doc = yaml.parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return err({ code: "VALIDATION_ERROR", field: "yaml", message: "Failed to parse YAML: malformed input", value: yamlText } satisfies LoreError);
  }
  const chain = ["workflow", "gates", "task-claim"] as const;
  const maps: yaml.YAMLMap[] = [];
  for (let depth = 1; depth <= chain.length; depth += 1) {
    const node = doc.getIn(chain.slice(0, depth), true);
    if (!yaml.isMap(node)) return ok(undefined);
    maps.push(node);
  }
  const taskClaim = maps[maps.length - 1]!;
  const pair = taskClaim.items.find((item) => yaml.isScalar(item.key) && item.key.value === "actor_identity");
  if (pair === undefined) return ok(undefined);
  const settingValue = doc.getIn([...chain, "actor_identity"], true);
  const value: unknown = yaml.isNode(settingValue) ? settingValue.toJSON() : settingValue;

  // The outermost mapping pair whose only content is the setting: cutting it leaves no empty parent mapping.
  let cutPair = pair;
  let level = maps.length;
  while (level > 0 && maps[level - 1]!.items.length === 1) {
    const parent = level === 1 ? doc.contents : maps[level - 2];
    if (!yaml.isMap(parent)) break;
    const parentPair = parent.items.find((item) => item.value === maps[level - 1]);
    if (parentPair === undefined) break;
    cutPair = parentPair;
    level -= 1;
  }

  const handEdit = (reason: string): Result<never, LoreError> =>
    err({
      code: "VALIDATION_ERROR",
      field: RETIRED_ACTOR_IDENTITY_FIELD,
      message: `${RETIRED_ACTOR_IDENTITY_FIELD} ${reason}; delete it by hand in .lore/config.yaml (nothing was rewritten).`,
      value: yamlText,
    } satisfies LoreError);
  const keyRange = yaml.isNode(cutPair.key) ? cutPair.key.range : undefined;
  const settingKeyRange = yaml.isNode(pair.key) ? pair.key.range : undefined;
  if (keyRange === undefined || keyRange === null || settingKeyRange === undefined || settingKeyRange === null) {
    return handEdit("has no source position, so it cannot be removed in place");
  }
  // The cut ends where the setting's own content ends (it is the last content inside any escalated parent).
  const contentEnd = contentEndOf(pair.value) ?? settingKeyRange[1];
  const lineStart = yamlText.lastIndexOf("\n", keyRange[0] - 1) + 1;
  const newline = yamlText.indexOf("\n", contentEnd);
  const lineEnd = newline === -1 ? yamlText.length : newline + 1;
  const before = yamlText.slice(lineStart, keyRange[0]);
  const after = yamlText.slice(contentEnd, newline === -1 ? yamlText.length : newline).trim();
  if (before.trim() !== "" || (after !== "" && !after.startsWith("#"))) {
    return handEdit("shares its line with other settings, so it cannot be removed line-wise");
  }
  return ok({ text: yamlText.slice(0, lineStart) + yamlText.slice(lineEnd), value });
}
