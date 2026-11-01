/**
 * The key of one judged unit of a milestone review (BR-1535, spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit, S2).
 *
 * Purpose: say, for a changed file or an AI criterion, exactly which inputs its stored verdict may be reused under: its own
 *   canonical input, the unit-instruction template source, the model-behaviour settings, the provider and the answering model.
 * Public surface: JudgeIdentity, CriterionContextPort, canonicalAttestationRows, criterionCoveredFiles, fileUnitInput,
 *   criterionUnitInput, unitKeyOf, templateHashOf, sha256Hex.
 * Invariants:
 *   - A key never reads the call kind, the response schema, the output budget, the commit sha, a run id or a timestamp, so a
 *     unit judged in a chunk call is reused in a full call and a fix that left a unit's inputs alone never invalidates it.
 *   - A key reads the template's TEXT (hashed), never a version string, so an edit invalidates it without anybody bumping anything.
 *   - A criterion's covered input is the net diffs of the changed files its text names, plus the changed files its command's test
 *     files reach (through `CriterionContextPort`, the repository's own selector in reverse). A criterion that covers no changed
 *     file, or that names a path neither changed nor present, takes the whole plan diff: its covered input is unknowable, never empty.
 * Side-effect class: pure except through the injected `CriterionContextPort`.
 */

import { createHash } from "node:crypto";
import { err, ok, type AiCriterionInput, type CriterionAttestationInput, type LoreError, type Result } from "@lore/core";

/** Which judge answered and how it was set: the part of every key that names the judge (spec S2, S5). */
export interface JudgeIdentity {
  readonly provider: string;
  /** The answering model; `undefined` when the provider cannot name it (reuse is then disabled for the review, S5). */
  readonly model: string | undefined;
  /** Model-behaviour settings (reasoning effort, temperature) as sent; empty when none is set. */
  readonly settings: Readonly<Record<string, string | number>>;
  /** When `model` is unknown: what to configure so it is known (named in the review's reuse-disabled cause). */
  readonly modelHint?: string;
}

/** What a criterion's covered set needs from the repository at the assessed commit. */
export interface CriterionContextPort {
  /** Whether `path` exists at the assessed commit. */
  readonly pathExists: (path: string) => Promise<Result<boolean, LoreError>>;
  /**
   * The changed files among `changedFiles` that the test files `command` runs reach through imports and `@reads` / `@spawns`
   * declarations (the selector of `scripts/changed-tests.ts` run in reverse).
   */
  readonly reachedChangedFiles: (command: string, changedFiles: readonly string[]) => Promise<Result<readonly string[], LoreError>>;
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
 * @param templateText - the unfilled per-unit instructions
 */
export function templateHashOf(templateText: string): string {
  return sha256Hex(templateText);
}

/**
 * A criterion's attestation rows in canonical form: criterion id, verdict, command text and the content hash of each test
 * file the command runs. The commit sha, run id and timestamp are dropped, and rows and files are sorted, so two commits whose
 * test files did not change yield the same text.
 *
 * @param rows - the rows as read
 * @returns the canonical JSON text
 */
export function canonicalAttestationRows(rows: readonly CriterionAttestationInput[] | undefined): string {
  const canonical = (rows ?? []).map((r) => ({
    criterion_id: r.criterion_id,
    verdict: r.verdict,
    command: r.command,
    test_files: [...r.test_files].map((f) => ({ path: f.path, content_sha256: f.content_sha256 })).sort((a, b) => a.path.localeCompare(b.path)),
  }));
  return JSON.stringify(canonical.map((r) => JSON.stringify(r)).sort());
}

const PATH_CHAR = /[\w./@-]/;
const PATH_LIKE = /(?<![\w./@-])(?:[\w@.-]+\/)+[\w@.-]+\.[A-Za-z]\w*/g;

/** Whether `path` appears in `text` as a whole path (not inside a longer path). */
function mentionsPath(text: string, path: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(path, from);
    if (at < 0) return false;
    const before = at === 0 ? "" : (text[at - 1] as string);
    const after = text[at + path.length] ?? "";
    const afterDotWord = after === "." && /\w/.test(text[at + path.length + 1] ?? "");
    if (!PATH_CHAR.test(before) && !(PATH_CHAR.test(after) && after !== ".") && !afterDotWord) return true;
    from = at + 1;
  }
}

/** The path-like tokens of `text` (a slash and an extension). */
function pathLikeTokens(text: string): string[] {
  return [...new Set([...text.matchAll(PATH_LIKE)].map((m) => m[0]))];
}

/**
 * The changed files a criterion covers.
 *
 * @param criterion - the criterion
 * @param diffByFile - the plan's net diff, per changed file
 * @param context - repository facts at the assessed commit; absent = paths are taken as present and no reach is computed
 * @returns the covered paths, sorted; every changed file when the criterion covers none or names a path neither changed nor present;
 *   `err` when `context` fails (a criterion's coverage is never guessed)
 */
export async function criterionCoveredFiles(
  criterion: AiCriterionInput,
  diffByFile: ReadonlyMap<string, string>,
  context: CriterionContextPort | undefined,
): Promise<Result<string[], LoreError>> {
  const changed = [...diffByFile.keys()];
  const texts = [criterion.statement ?? "", criterion.rubric, criterion.command ?? ""];
  const covered = new Set(changed.filter((p) => texts.some((t) => mentionsPath(t, p))));
  if (criterion.command !== undefined && context !== undefined) {
    const reached = await context.reachedChangedFiles(criterion.command, changed);
    if (!reached.ok) return reached;
    for (const p of reached.value) if (diffByFile.has(p)) covered.add(p);
  }
  let namesAbsentPath = false;
  if (context !== undefined) {
    for (const token of texts.flatMap(pathLikeTokens)) {
      if (diffByFile.has(token)) continue;
      const present = await context.pathExists(token);
      if (!present.ok) return present;
      if (!present.value) namesAbsentPath = true;
    }
  }
  if (covered.size === 0 || namesAbsentPath) return ok(changed.sort());
  return ok([...covered].sort());
}

/** A file unit's canonical input: its net plan diff. */
export function fileUnitInput(diffText: string): string {
  return diffText;
}

/**
 * A criterion unit's canonical input: statement, rubric, canonical attestation rows and the net diffs of its covered files.
 *
 * @param criterion - the criterion
 * @param covered - its covered paths (`criterionCoveredFiles`)
 * @param diffByFile - the plan's net diff, per changed file
 */
export function criterionUnitInput(criterion: AiCriterionInput, covered: readonly string[], diffByFile: ReadonlyMap<string, string>): string {
  return JSON.stringify({
    statement: criterion.statement ?? "",
    rubric: criterion.rubric,
    attestation: canonicalAttestationRows(criterion.attestation),
    covered: covered.map((path) => ({ path, diff: diffByFile.get(path) ?? "" })),
  });
}

/**
 * The key of one unit.
 *
 * @param kind - `file` or `criterion`
 * @param canonicalInput - the unit's canonical input
 * @param templateText - the unit-instruction template source
 * @param identity - the judge's identity; its model must be known
 * @returns the sha256 key; `err` when the model is unknown (a key without it would reuse another judge's verdict)
 */
export function unitKeyOf(kind: "file" | "criterion", canonicalInput: string, templateText: string, identity: JudgeIdentity): Result<string, LoreError> {
  if (identity.model === undefined || identity.model.trim() === "") {
    return err({ code: "VALIDATION_ERROR", field: "model", message: "a judge verdict key needs the answering model; the provider reported none", rule: "BR-1535" });
  }
  const settings = Object.fromEntries(Object.entries(identity.settings).sort(([a], [b]) => a.localeCompare(b)));
  return ok(sha256Hex(JSON.stringify([kind, canonicalInput, templateHashOf(templateText), settings, identity.provider, identity.model])));
}
