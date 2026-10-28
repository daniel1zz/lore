/**
 * LORE_CONTEXT_VARIABLES — the registry instance for the `{{lore:<name>}}` expander.
 *
 * Purpose: the single list of facts lore lets its own context text reference.
 * Public surface: `LORE_CONTEXT_VARIABLES`. Invariants: passes `validateRegistry`;
 * every `code` entry is fixed by the lore version, never by settings; the one `invocation`
 * entry (`claude_dir`) is supplied by `lore setup` and allowed at `setup:settings-hook` only; the one `config`
 * entry (`integrate_floor`) is read from the outlet's config layer by `configVariableValues` at fragment outlets.
 * Side effects: pure.
 *
 * @spec_ref spec-lore-owned-agent-context-is-generated-from-templates-and (D1, D5, D7)
 */

import {
  CAPTURE_TAIL_CHARS,
  LORE_AGENT_NAMES,
  OUTLET_IDS,
  err,
  languageName,
  ok,
  resolveArtifactLanguage,
  resolveIntegrateFloor,
  type LoreError,
  type Result,
  type ContextConfigLayer,
  type ContextVariable,
  type OutletId,
  type VariableOutlet,
} from "@lore/core";

const ALL_OUTLETS: readonly VariableOutlet[] = [...OUTLET_IDS, "asset:install", "setup:settings-hook"];

export const LORE_CONTEXT_VARIABLES: readonly ContextVariable[] = [
  {
    name: "capture_tail_chars",
    source: "code",
    outlets: ALL_OUTLETS,
    describe: "Persisted evidence output_tail ceiling, in characters.",
    value: () => String(CAPTURE_TAIL_CHARS),
    // AC-CV-6: spellings that restate the ceiling by hand in lore-owned prose/code.
    literalPatterns: [/\b4000[- ]char/, /\bmax\(4000\)/, /\btailChars\([^)]*,\s*4000\)/, /=\s*4000;/],
  },
  {
    name: "implementer_agent",
    source: "code",
    outlets: ALL_OUTLETS,
    describe: "Installed name of the lore implementer agent.",
    value: () => LORE_AGENT_NAMES.implementer,
  },
  {
    name: "reader_agent",
    source: "code",
    outlets: ALL_OUTLETS,
    describe: "Installed name of the lore reader agent.",
    value: () => LORE_AGENT_NAMES.reader,
  },
  {
    name: "integrate_floor",
    source: "config",
    outlets: OUTLET_IDS,
    describe: "The `workflow.integrate.floor_command` the outlet's config layer sets, or the statement that none is configured.",
  },
  {
    name: "artifact_language",
    source: "config",
    outlets: OUTLET_IDS,
    describe: "The language NAME of `context.artifact_language` (e.g. Chinese) at the outlet's config layer; absent when unset.",
  },
  {
    name: "claude_dir",
    source: "invocation",
    outlets: ["setup:settings-hook"],
    describe: "Absolute Claude Code config directory a settings-hook command points into (supplied by setup).",
  },
];

/** Text `{{lore:integrate_floor}}` renders: the configured command verbatim, or an explicit "none" (never a default). */
export function integrateFloorText(floorCommand: string | null): string {
  return floorCommand === null
    ? "not set: no floor is configured, so `lore integrate` refuses to advance main"
    : `set to \`${floorCommand}\``;
}

/**
 * Caller-supplied values for the `config` variables of one fragment outlet, read from the layers that outlet
 * draws from. The ONE place a flow turns config into placeholder values (`expandFragments`'s `ctx.invocation`).
 */
export function configVariableValues(
  global: ContextConfigLayer,
  project: ContextConfigLayer,
  outlet: OutletId,
): Result<Readonly<Record<string, string>>, LoreError> {
  const values: Record<string, string> = { integrate_floor: integrateFloorText(resolveIntegrateFloor(global, project, outlet)) };
  const artifact = resolveArtifactLanguage(global, project, outlet);
  // reason: unset leaves the key ABSENT so a fragment naming it fails per BR-1095 - never a default language.
  if (artifact !== null) {
    const name = languageName(artifact.code, "context.artifact_language", artifact.layer);
    if (!name.ok) return err(name.error);
    values["artifact_language"] = name.value;
  }
  return ok(values);
}
