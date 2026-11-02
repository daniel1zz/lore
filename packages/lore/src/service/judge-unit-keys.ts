/**
 * The key of one judged unit of a milestone review (BR-1535, spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit, S2).
 *
 * Purpose: say, for a changed file or an AI criterion, exactly which inputs its stored verdict may be reused under: its own
 *   canonical input, the unit-instruction template source (instructions plus dimension guide), the model-behaviour settings (the
 *   provider arguments that are the same for every call), the provider and the answering model.
 * Public surface: JudgeIdentity, CanonicalEvidenceRow, canonicalEvidenceRowsOf, sha256Hex, templateHashOf, fileUnitInput, criterionUnitInput, unitKeyOf.
 * Invariants:
 *   - A key never reads the call kind, the response schema, the output budget, a per-call argument, the commit sha, a run id or a
 *     timestamp, so a unit judged in a chunk call is reused in a full call and a fix that left a unit's inputs alone never invalidates it.
 *   - A key reads the template's TEXT (hashed), never a version string, so an edit invalidates it without anybody bumping anything.
 *   - A file unit's input is its own net diff. An AI criterion's input is its statement, its rubric and the WHOLE plan net diff: its
 *     verdict may depend on any changed file, so it is reused only when no file of the plan changed. It
 *     also holds the sorted SET of distinct canonical evidence rows the judge is shown for it (`canonicalEvidenceRowsOf`, the same
 *     function the prompt renders from; #636): content only, never a row id, version, run id, commit sha or timestamp.
 *   - The model in a key is a model id as a provider's reply named it. The configured name (an alias such as `sonnet`) is used only
 *     to LOOK UP; it never equals an answering model id, so an alias simply finds nothing.
 * Side-effect class: pure.
 */

import { createHash } from "node:crypto";
import { err, ok, type AiCriterionInput, type LoreError, type Result } from "@lore/core";

/** Which judge answers and how it is set: the part of every key that names the judge (spec S2, S5). */
export interface JudgeIdentity {
  readonly provider: string;
  /** The configured `ai.assess.model` (what lookups use); `undefined` when none is configured. */
  readonly model: string | undefined;
  /** Whether the provider's reply names the model that answered (claude CLI JSON output, HTTP `model`); a custom command does not. */
  readonly reportsAnsweringModel: boolean;
  /** The provider arguments that are the same for every call (effort and sampling flags); empty when none. */
  readonly settings: Readonly<Record<string, string | number>>;
  /** When reuse cannot be on: what to configure (named in the review's reuse-disabled cause). */
  readonly modelHint?: string;
}

/**
 * sha256 of `text` as lower-case hex.
 *
 * @param text - the text to hash
 */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * sha256 of the unit-instruction template source (stored on every row as `template_hash`).
 *
 * @param templateSource - the unfilled per-unit instructions with the dimension guide (`unitTemplateSourceOf`)
 */
export function templateHashOf(templateSource: string): string {
  return sha256Hex(templateSource);
}

/** A file unit's canonical input: its net plan diff. */
export function fileUnitInput(diffText: string): string {
  return diffText;
}

/** One evidence row as the judge is shown it: the fields the canonical row is made of (a structural subset of the prompt's evidence line). */
export interface CriterionEvidenceSource {
  readonly oracle: string;
  readonly command: string;
  readonly result: string;
  /** sha256 of the row's output tail (`sha256Hex(output_tail ?? "")`); absent on a line built without it. */
  readonly output_tail_sha256?: string;
  readonly ac_ref?: string;
}

/** The canonical form of one evidence row: content only, so a re-recorded identical row is the same row (#636). */
export interface CanonicalEvidenceRow {
  readonly criterion: string;
  readonly result: string;
  readonly oracle: string;
  readonly command: string;
  readonly output_sha256: string;
}

/**
 * The sorted SET of distinct canonical evidence rows of one criterion across the plan's tasks. The ONE function the judge prompt
 * renders a criterion's evidence from and the criterion's key reads, so the two cannot disagree about which evidence counts.
 *
 * @param tasks - the plan's tasks as the prompt receives them (their evidence lines)
 * @param criterion - the criterion (`spec`, `ac`); a line counts when its `ac_ref` is the AC id or `<spec>:<ac id>`
 * @returns distinct rows ordered by their canonical JSON; empty when the criterion has no evidence
 */
export function canonicalEvidenceRowsOf(
  tasks: readonly { readonly evidence: readonly CriterionEvidenceSource[] }[],
  criterion: Pick<AiCriterionInput, "spec" | "ac">,
): CanonicalEvidenceRow[] {
  const id = `${criterion.spec}:${criterion.ac}`;
  const byJson = new Map<string, CanonicalEvidenceRow>();
  for (const task of tasks) {
    for (const e of task.evidence) {
      if (e.ac_ref !== criterion.ac && e.ac_ref !== id) continue;
      const row: CanonicalEvidenceRow = { criterion: id, result: e.result, oracle: e.oracle, command: e.command, output_sha256: e.output_tail_sha256 ?? sha256Hex("") };
      byJson.set(JSON.stringify(row), row);
    }
  }
  return [...byJson.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);
}

/**
 * An AI criterion unit's canonical input: statement, rubric, the whole plan net diff and the canonical evidence rows shown to the judge.
 *
 * @param criterion - the criterion
 * @param planDiff - the plan's whole net diff (empty when none could be derived)
 * @param evidenceRows - `canonicalEvidenceRowsOf` for this criterion
 */
export function criterionUnitInput(criterion: AiCriterionInput, planDiff: string, evidenceRows: readonly CanonicalEvidenceRow[]): string {
  return JSON.stringify({ statement: criterion.statement ?? "", rubric: criterion.rubric, plan_diff: planDiff, evidence: evidenceRows });
}

/**
 * The key of one unit under one model.
 *
 * @param kind - `file` or `criterion`
 * @param canonicalInput - the unit's canonical input
 * @param templateSource - the unit-instruction template source with the dimension guide
 * @param identity - the judge's identity (provider and fixed settings are read)
 * @param model - the model id to key under: the configured name to look up, the reply's answering model to store
 * @returns the sha256 key; `err` when `model` is blank (a key without it would reuse another judge's verdict)
 */
export function unitKeyOf(
  kind: "file" | "criterion",
  canonicalInput: string,
  templateSource: string,
  identity: Pick<JudgeIdentity, "provider" | "settings">,
  model: string,
): Result<string, LoreError> {
  if (model.trim() === "") {
    return err({ code: "VALIDATION_ERROR", field: "model", message: "a judge verdict key needs the answering model; none was given", rule: "BR-1535" });
  }
  const settings = Object.fromEntries(Object.entries(identity.settings).sort(([a], [b]) => a.localeCompare(b)));
  return ok(sha256Hex(JSON.stringify([kind, canonicalInput, templateHashOf(templateSource), settings, identity.provider, model])));
}
