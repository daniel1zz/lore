/**
 * The body of a filed issue report, rendered from the corpus's approved `issue-report` template.
 *
 * Purpose: `lore report-issue` (and every filing that goes through `fileGithubIssue`) files to GitHub, which owns the
 *   issue; no corpus document is created for a report. The spec routes the report's structure through its own template
 *   (`issue-report`, a template slot that is not a stored document type): the report's fields are validated against the
 *   latest approved template, and the GitHub body is rendered from them instead of hand-built text that drifts from its data
 *   (spec-every-document-is-stored-as-structured-fields-validated-by, #557).
 * Public surface: {@link IssueReportInput}, {@link renderIssueReportBody}.
 * Invariants:
 *   - Refuses loudly (`VALIDATION_ERROR` naming every problem) when the corpus has no approved `issue-report` template or the
 *     report does not satisfy it; nothing is filed on a refusal. No compiled-in fallback template.
 *   - Optional fields that are absent are omitted, never defaulted. The two dimensions are answered from facts the report
 *     carries (a repro command or steps; one report, one title) and say so.
 *   - The attached-context section (`input.context`, test-file refs) is appended after the rendered body: it is generated
 *     text with no template field.
 * Side-effect class: read-only (template reads through {@link TemplateService}).
 */

import { err, ok, renderDocument, validationError, validateDocument, type DimensionAnswer, type LoreError, type Result } from "@lore/core";
import { formatTemplateProblems } from "./structured-write.js";
import type { TemplateService } from "./template-service.js";

/** What a report carries (the subset of the CLI's filing input the template names). */
export interface IssueReportInput {
  readonly title: string;
  readonly description: string;
  readonly expected: string;
  readonly actual: string;
  readonly repro_command?: string | undefined;
  readonly repro_steps?: string | undefined;
  readonly suggested_fix?: string | undefined;
  readonly severity: string;
  readonly category: string;
  readonly refs?: readonly string[] | undefined;
  /** Generated `**Context:**` section (attached test-file refs); appended after the rendered body. */
  readonly context?: string | undefined;
}

/** The slot name of the issue-report template (a template `doc_type` that is not a stored document type). */
const ISSUE_REPORT_SLOT = "issue-report";

function dimensionAnswers(input: IssueReportInput): DimensionAnswer[] {
  const reproducibility: DimensionAnswer =
    input.repro_command !== undefined
      ? { id: "reproducibility", status: "handled", answer: `Reproduces with: ${input.repro_command}`, refs: [] }
      : input.repro_steps !== undefined
        ? { id: "reproducibility", status: "handled", answer: "Reproduction steps are given in the report.", refs: [] }
        : { id: "reproducibility", status: "na", answer: "The reporter gave no reproduction command or steps.", refs: [] };
  return [
    reproducibility,
    { id: "single-root-cause", status: "handled", answer: "Filed as one report under one title.", refs: [] },
  ];
}

/**
 * Validate a report against the approved `issue-report` template and render the GitHub body from it.
 *
 * @param templates - the corpus's template reader
 * @param input - the report as the filer gave it
 * @returns the rendered markdown body (with the context section appended), or the refusal
 */
export async function renderIssueReportBody(templates: TemplateService, input: IssueReportInput): Promise<Result<string, LoreError>> {
  const resolved = await templates.resolveTemplate(ISSUE_REPORT_SLOT);
  if (!resolved.ok) return resolved;
  const fields: Record<string, unknown> = {
    title: input.title,
    description: input.description,
    expected: input.expected,
    actual: input.actual,
    ...(input.repro_command !== undefined ? { repro_command: input.repro_command } : {}),
    ...(input.repro_steps !== undefined ? { repro_steps: input.repro_steps } : {}),
    ...(input.suggested_fix !== undefined ? { suggested_fix: input.suggested_fix } : {}),
    severity: input.severity,
    category: input.category,
    ...(input.refs !== undefined && input.refs.length > 0 ? { refs: [...input.refs] } : {}),
  };
  const problems = validateDocument(resolved.value.template, fields, dimensionAnswers(input));
  if (!problems.ok) {
    return err(validationError("extra.fields", `the report does not satisfy ${resolved.value.ref}: ${formatTemplateProblems(problems.error)}`, problems.error));
  }
  const body = renderDocument(resolved.value.template, fields).trimEnd();
  return ok(input.context === undefined ? body : `${body}\n\n${input.context}`);
}
