/**
 * ac-cite-config-file — the raw-text reader/writer of `workflow.gates."ac-cite"` in `.lore/config.yaml`
 * (Baseline slice 3a, BL-8: `lore baseline adopt` and the `lore setup --project` seed).
 *
 * Public surface: {@link readAcCiteStored}, {@link writeAcCiteStored}, {@link seedAcCiteModeIfAbsent}.
 *
 * Invariants:
 *   - Edits go through the `yaml` Document API on the RAW text, so ONLY the touched keys change: comments,
 *     key order and every other key survive, and no zod default is frozen into the file (a parsed+defaulted
 *     round trip through `saveConfig` would do exactly that).
 *   - The edited text is validated with `loadConfigFromString` BEFORE it is written (fail loud, file untouched).
 *   - "Stored" means the RAW file content: an absent `mode` is `null`, an absent `armed_branches` is `[]`.
 *     The EFFECTIVE mode (absent -> off/report by baseline presence) is `resolveCiteGateConfig`'s job, not here.
 *
 * Side-effect class: IO (one config file read; one write only on an actual change).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { CITE_GATE_MODES, err, loadConfigFromString, ok, storeError } from "@lore/core";
import type { CiteGateMode, LoreError, Result } from "@lore/core";

/** The raw stored ac-cite settings: `mode` is `null` when the key is absent, `armed_branches` `[]` when absent. */
export interface AcCiteStored {
  readonly mode: CiteGateMode | null;
  readonly armed_branches: readonly string[];
}

/** Outcome of {@link seedAcCiteModeIfAbsent}: `written` (key was absent) or `kept` (an explicit mode already there). */
export type AcCiteSeedOutcome = { status: "written" } | { status: "kept"; existing: CiteGateMode };

const configPathOf = (repoDir: string): string => join(repoDir, ".lore", "config.yaml");

function readDocument(repoDir: string): Result<ReturnType<typeof parseDocument>, LoreError> {
  const path = configPathOf(repoDir);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    return err(storeError(`Failed to read ${path}`, cause));
  }
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) return err(storeError(`Failed to parse ${path}: ${doc.errors[0]?.message ?? "unknown"}`, doc.errors[0]));
  return ok(doc);
}

function storedOf(doc: ReturnType<typeof parseDocument>, path: string): Result<AcCiteStored, LoreError> {
  const mode: unknown = doc.getIn(["workflow", "gates", "ac-cite", "mode"]);
  const armed: unknown = doc.getIn(["workflow", "gates", "ac-cite", "armed_branches"], true) ?? null;
  const armedPlain = armed !== null && typeof armed === "object" && "toJSON" in armed ? (armed as { toJSON(): unknown }).toJSON() : armed;
  if (mode !== undefined && mode !== null && !(CITE_GATE_MODES as readonly unknown[]).includes(mode)) {
    return err({ code: "VALIDATION_ERROR", field: "workflow.gates.ac-cite.mode", message: `${path}: workflow.gates."ac-cite".mode must be one of ${CITE_GATE_MODES.join(" | ")}`, value: mode, rule: "BR-987" });
  }
  if (armedPlain !== null && !(Array.isArray(armedPlain) && armedPlain.every((s) => typeof s === "string"))) {
    return err({ code: "VALIDATION_ERROR", field: "workflow.gates.ac-cite.armed_branches", message: `${path}: workflow.gates."ac-cite".armed_branches must be a list of branch slugs`, value: armedPlain, rule: "BR-987" });
  }
  return ok({ mode: (mode ?? null) as CiteGateMode | null, armed_branches: (armedPlain ?? []) as string[] });
}

/**
 * Reads the raw stored ac-cite settings from `<repoDir>/.lore/config.yaml`.
 *
 * @returns `err(STORE_ERROR)` for an unreadable/unparseable file, `err(VALIDATION_ERROR)` for a malformed entry.
 */
export function readAcCiteStored(repoDir: string): Result<AcCiteStored, LoreError> {
  const doc = readDocument(repoDir);
  if (!doc.ok) return doc;
  return storedOf(doc.value, configPathOf(repoDir));
}

function commit(repoDir: string, doc: ReturnType<typeof parseDocument>): Result<void, LoreError> {
  const path = configPathOf(repoDir);
  const edited = doc.toString();
  const validated = loadConfigFromString(edited);
  if (!validated.ok) return validated;
  try {
    writeFileSync(path, edited, "utf8");
  } catch (cause) {
    return err(storeError(`Failed to write ${path}`, cause));
  }
  return ok(undefined);
}

/**
 * Writes the given ac-cite settings (a key left `undefined` is left as it was) into the config file.
 * Never writes when nothing is given.
 */
export function writeAcCiteStored(
  repoDir: string,
  next: { readonly mode?: CiteGateMode; readonly armed_branches?: readonly string[] },
): Result<void, LoreError> {
  const doc = readDocument(repoDir);
  if (!doc.ok) return doc;
  try {
    if (next.mode !== undefined) doc.value.setIn(["workflow", "gates", "ac-cite", "mode"], next.mode);
    if (next.armed_branches !== undefined) doc.value.setIn(["workflow", "gates", "ac-cite", "armed_branches"], [...next.armed_branches]);
  } catch (cause) {
    return err(storeError(`Cannot edit workflow.gates."ac-cite" in ${configPathOf(repoDir)}`, cause));
  }
  return commit(repoDir, doc.value);
}

/**
 * Seeds `workflow.gates."ac-cite".mode: report` ONLY when `mode` is absent (the `lore setup --project` adoption
 * seed). An explicit value (off | report | enforce) and every other key, `armed_branches` included, is untouched.
 * Writes no audit row.
 */
export function seedAcCiteModeIfAbsent(repoDir: string): Result<AcCiteSeedOutcome, LoreError> {
  const doc = readDocument(repoDir);
  if (!doc.ok) return doc;
  const stored = storedOf(doc.value, configPathOf(repoDir));
  if (!stored.ok) return stored;
  if (stored.value.mode !== null) return ok({ status: "kept", existing: stored.value.mode });
  const written = writeAcCiteStored(repoDir, { mode: "report" });
  if (!written.ok) return written;
  return ok({ status: "written" });
}
