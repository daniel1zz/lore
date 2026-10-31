/**
 * Structured-document templates: meta-schema, dimension answers, validation, cross-field checks, render.
 *
 * Purpose: the pure core of "every document is stored as structured fields validated by a
 *   versioned template" (spec-every-document-is-stored-as-structured-fields-validated-by).
 * Public surface: {@link templateSchema} / {@link parseTemplate} (the meta-schema, enforced in
 *   code so the first template needs no other template), {@link dimensionAnswerSchema},
 *   {@link validateDocument} (write-time validation, ALL problems in one list),
 *   {@link CROSS_FIELD_CHECK_IDS} / {@link runCrossFieldChecks} (promote-time checks),
 *   {@link renderDocument} (deterministic markdown).
 * Invariants:
 *   - Pure: no IO, no clock, no Node builtins (this file is re-exported from the browser-safe barrel).
 *   - Write-time validation never resolves refs (criteria are added after create); only
 *     `refs-resolve`, run at promote, does, through a caller-supplied port.
 *   - Every function reports all problems it finds, never just the first.
 * Side-effect class: pure.
 *
 * ## Cross-field check field-shape convention (for seed templates)
 * A check reads the document's `fields` and finds its input fields by a MARKER on the property in
 * the template's `fields` JSON Schema (`x-*` keywords are annotations; the validator carries them).
 * Markers are read on TOP-LEVEL properties of `fields` only. An "entry" of a list is either a
 * string (its own key) or an object (its key is `entry.id`, else `entry.text`, else `entry.item`).
 *
 *   marker                  read by                    field shape
 *   x-ref-list              refs-resolve               array of strings; each is a ref (AC id, rule id,
 *                                                      field path, doc slug). Dimension `refs` are checked too.
 *   x-refusal-list          refusal-has-ac             array of entries; each key must be cited by >= 1 AC
 *   x-rule-change-list      rule-change-has-ac         array of entries; each key must be cited by >= 1 AC
 *   x-decision-list         decision-has-rejected      array of objects `{decision|id, chosen?, rejected, why}`;
 *                                                      `rejected` = non-empty string or non-empty array of
 *                                                      strings / `{option}` objects; `why` non-empty string
 *   x-scope-list            out-of-scope-not-in-scope  array of entries (in scope)
 *   x-out-of-scope-list     out-of-scope-not-in-scope  array of entries (out of scope); no entry may equal
 *                                                      (trim, lower-case, collapsed whitespace) a scope entry
 *   x-goal                  goal-has-measure           object `{statement, measure}`; `measure` non-empty
 *                                                      string naming the observable outcome
 *
 * A marker whose field is absent from the document yields no findings (requiredness is the schema's job).
 */

import { z } from "zod";
import type { Result } from "./errors.js";
import {
  checkJsonSchemaUsable,
  readFieldPath,
  schemaAtFieldPath,
  validateAgainstJsonSchema,
  type JsonSchemaNode,
} from "./template-json-schema.js";

// ---------------------------------------------------------------------------
// Check library ids
// ---------------------------------------------------------------------------

/** The fixed library of cross-field check ids a template may list. Single definition site. */
export const CROSS_FIELD_CHECK_IDS = [
  "refs-resolve",
  "refusal-has-ac",
  "rule-change-has-ac",
  "decision-has-rejected",
  "out-of-scope-not-in-scope",
  "goal-has-measure",
] as const;
export type CrossFieldCheckId = (typeof CROSS_FIELD_CHECK_IDS)[number];

// ---------------------------------------------------------------------------
// Meta-schema
// ---------------------------------------------------------------------------

const KEBAB_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** One question every document of the type must answer. */
export const templateDimensionSchema = z.object({
  id: z.string().regex(KEBAB_ID_PATTERN, "dimension id must be kebab-case (a-z, 0-9, hyphens)"),
  question: z.string().trim().min(1, "dimension question must not be empty"),
  /** Document kinds (e.g. `tech`, `feature`) the question applies to; absent = every kind. */
  applies_to: z.array(z.string().min(1)).min(1).optional(),
  /** When true, an answer must carry at least one ref. */
  needs_refs: z.boolean().optional(),
});
export type TemplateDimension = z.infer<typeof templateDimensionSchema>;

/** One rendered section: a heading and the field paths (dotted, through `properties`) it shows. */
export const templateRenderSectionSchema = z.object({
  heading: z.string().trim().min(1, "render heading must not be empty"),
  fields: z.array(z.string().min(1)).min(1, "a render section must name at least one field"),
});
export type TemplateRenderSection = z.infer<typeof templateRenderSectionSchema>;

/** The template meta-schema. Cross-property refusals are in the superRefine below. */
export const templateSchema = z
  .object({
    doc_type: z.string().min(1),
    kind: z.string().min(1).optional(),
    version: z.number().int().min(1),
    fields: z.record(z.unknown()),
    dimensions: z.array(templateDimensionSchema).min(1, "a template needs at least one dimension"),
    // reason: z.string() + refine below, not z.enum — a failed enum stops zod before superRefine, which would
    // hide the duplicate-dimension / render-path refusals; the meta-schema reports ALL refusals together.
    checks: z.array(z.string()),
    render: z.array(templateRenderSectionSchema).min(1, "a template needs at least one render section"),
  })
  .superRefine((template, ctx) => {
    for (const problem of checkJsonSchemaUsable(template.fields)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem, path: ["fields"] });
    }
    if (template.fields.type !== "object") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fields must be a JSON Schema with type "object"', path: ["fields", "type"] });
    }
    const seen = new Set<string>();
    template.dimensions.forEach((dimension, index) => {
      if (seen.has(dimension.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate dimension id "${dimension.id}"`, path: ["dimensions", index, "id"] });
      }
      seen.add(dimension.id);
    });
    const seenChecks = new Set<string>();
    template.checks.forEach((check, index) => {
      if (seenChecks.has(check)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate check id "${check}"`, path: ["checks", index] });
      }
      seenChecks.add(check);
      if (!(CROSS_FIELD_CHECK_IDS as readonly string[]).includes(check)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown check id "${check}" (library: ${CROSS_FIELD_CHECK_IDS.join(", ")})`,
          path: ["checks", index],
        });
      }
    });
    template.render.forEach((section, sectionIndex) => {
      section.fields.forEach((fieldPath, fieldIndex) => {
        if (schemaAtFieldPath(template.fields as JsonSchemaNode, fieldPath) === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `render path "${fieldPath}" is not a field of the template`,
            path: ["render", sectionIndex, "fields", fieldIndex],
          });
        }
      });
    });
  });
/** A parsed template. `checks` is narrowed to library ids by {@link parseTemplate}. */
export type Template = Omit<z.infer<typeof templateSchema>, "checks"> & { readonly checks: readonly CrossFieldCheckId[] };

/** One meta-schema refusal: `path` locates it in the template (e.g. `dimensions.1.id`). */
export interface TemplateIssue {
  readonly path: string;
  readonly problem: string;
}

/**
 * Parse an untrusted template (corpus document content / seed file) against the meta-schema.
 *
 * @param raw - the candidate template, already JSON/YAML-decoded
 * @returns the template, or EVERY meta-schema refusal (unknown check id, duplicate dimension id,
 *   render path not in fields, unsupported JSON Schema keyword, ...)
 */
export function parseTemplate(raw: unknown): Result<Template, TemplateIssue[]> {
  const parsed = templateSchema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data as Template };
  return {
    ok: false,
    error: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), problem: issue.message })),
  };
}

// ---------------------------------------------------------------------------
// Dimension answers + document validation
// ---------------------------------------------------------------------------

/** The status of a dimension answer: handled in the document, or not applicable (with the reason in `answer`). */
export const DIMENSION_STATUSES = ["handled", "na"] as const;

/** One stored dimension answer (`extra.dimensions[]`). `answer` is non-empty for BOTH statuses. */
export const dimensionAnswerSchema = z.object({
  id: z.string().min(1),
  status: z.enum(DIMENSION_STATUSES),
  answer: z.string().trim().min(1, "answer must not be empty (an `na` must say why)"),
  refs: z.array(z.string().min(1)).default([]),
});
export type DimensionAnswer = z.infer<typeof dimensionAnswerSchema>;

/** Why a problem was reported; stable codes for callers and tests. */
export const TEMPLATE_PROBLEM_CODES = [
  "schema-violation",
  "missing-dimension",
  "unknown-dimension",
  "duplicate-dimension",
  "invalid-dimension-entry",
  "empty-answer",
  "missing-refs",
] as const;
export type TemplateProblemCode = (typeof TEMPLATE_PROBLEM_CODES)[number];

/** A problem in `extra.fields` (names the field path) or in `extra.dimensions` (names the dimension id). */
export type TemplateProblem =
  | { readonly code: "schema-violation"; readonly field: string; readonly problem: string }
  | { readonly code: Exclude<TemplateProblemCode, "schema-violation">; readonly dimension: string; readonly problem: string };

/** Optional narrowing for {@link validateDocument}. */
export interface ValidateDocumentOptions {
  /** The document's kind; dimensions whose `applies_to` excludes it are neither required nor accepted. */
  readonly kind?: string;
}

function dimensionApplies(dimension: TemplateDimension, kind: string | undefined): boolean {
  return dimension.applies_to === undefined || kind === undefined || dimension.applies_to.includes(kind);
}

/**
 * Write-time validation of a templated document's content. Never resolves refs.
 *
 * @param template - the pinned, already parsed template
 * @param fields - `extra.fields`
 * @param dimensions - `extra.dimensions` (untrusted: may be anything)
 * @returns ok, or EVERY problem at once: schema violations, missing / unknown / duplicate
 *   dimension, malformed entry, empty answer, `needs_refs` without refs
 */
export function validateDocument(
  template: Template,
  fields: unknown,
  dimensions: unknown,
  options: ValidateDocumentOptions = {},
): Result<void, TemplateProblem[]> {
  const problems: TemplateProblem[] = [];

  for (const violation of validateAgainstJsonSchema(template.fields as JsonSchemaNode, fields)) {
    problems.push({ code: "schema-violation", field: violation.path, problem: violation.problem });
  }

  const applicable = template.dimensions.filter((dimension) => dimensionApplies(dimension, options.kind));
  const applicableIds = new Set(applicable.map((dimension) => dimension.id));
  const knownIds = new Set(template.dimensions.map((dimension) => dimension.id));
  const answered = new Set<string>();

  const entries: unknown[] = Array.isArray(dimensions) ? dimensions : [];
  if (!Array.isArray(dimensions)) {
    problems.push({ code: "invalid-dimension-entry", dimension: "(dimensions)", problem: "dimensions must be an array of {id, status, answer, refs}" });
  }
  entries.forEach((entry, index) => {
    const label = isRecord(entry) && typeof entry.id === "string" && entry.id !== "" ? entry.id : `(entry ${index})`;
    if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "") {
      problems.push({ code: "invalid-dimension-entry", dimension: label, problem: "entry must be an object with a non-empty string id" });
      return;
    }
    if (!applicableIds.has(entry.id)) {
      const why = knownIds.has(entry.id) ? `does not apply to kind "${options.kind ?? ""}"` : "is not a dimension of this template";
      problems.push({ code: "unknown-dimension", dimension: entry.id, problem: why });
      return;
    }
    if (answered.has(entry.id)) {
      problems.push({ code: "duplicate-dimension", dimension: entry.id, problem: "is answered more than once" });
      return;
    }
    answered.add(entry.id);
    if (entry.status !== "handled" && entry.status !== "na") {
      problems.push({ code: "invalid-dimension-entry", dimension: entry.id, problem: 'status must be "handled" or "na"' });
    }
    if (typeof entry.answer !== "string" || entry.answer.trim() === "") {
      problems.push({ code: "empty-answer", dimension: entry.id, problem: "answer must not be empty (an `na` must say why)" });
    }
    const refsValue = entry.refs;
    const refsValid = refsValue === undefined || (Array.isArray(refsValue) && refsValue.every((ref) => typeof ref === "string" && ref !== ""));
    if (!refsValid) {
      problems.push({ code: "invalid-dimension-entry", dimension: entry.id, problem: "refs must be an array of non-empty strings" });
    }
    const refCount = refsValid && Array.isArray(refsValue) ? refsValue.length : 0;
    const dimension = applicable.find((candidate) => candidate.id === entry.id);
    if (dimension?.needs_refs === true && refsValid && refCount === 0) {
      problems.push({ code: "missing-refs", dimension: entry.id, problem: "needs at least one ref (AC id, rule id, field path or doc slug)" });
    }
  });

  for (const dimension of applicable) {
    if (!answered.has(dimension.id) && !entries.some((entry) => isRecord(entry) && entry.id === dimension.id)) {
      problems.push({ code: "missing-dimension", dimension: dimension.id, problem: `not answered: ${dimension.question}` });
    }
  }

  return problems.length === 0 ? { ok: true, value: undefined } : { ok: false, error: problems };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Cross-field check library
// ---------------------------------------------------------------------------

/** What a check sees of one criterion: its id and the ids/slugs/keys it cites. */
export interface CriterionCitation {
  readonly id: string;
  readonly cites: readonly string[];
}

/** Ports the checks need; everything else is read from the document view. Pure data, no IO. */
export interface CrossFieldCheckPorts {
  /** Criteria declared on the document so far (they are added after create). */
  readonly criteria: readonly CriterionCitation[];
  /** True when `ref` names an existing AC, rule or document. Field paths are resolved by the check itself. */
  readonly resolveRef: (ref: string) => boolean;
}

/** The document as a check sees it. `fieldsSchema` is the template's `fields` (for markers). */
export interface DocumentView {
  readonly fieldsSchema: JsonSchemaNode;
  readonly fields: Record<string, unknown>;
  readonly dimensions: readonly DimensionAnswer[];
}

/** One failed check on one entry. `entry` names the offending list entry, ref or field. */
export interface CheckFinding {
  readonly check: CrossFieldCheckId;
  readonly entry: string;
  readonly problem: string;
}

type CrossFieldCheck = (view: DocumentView, ports: CrossFieldCheckPorts) => CheckFinding[];

function markedFields(view: DocumentView, marker: string): string[] {
  return Object.entries(view.fieldsSchema.properties ?? {})
    .filter(([, node]) => node[marker] === true)
    .map(([name]) => name);
}

function entryList(view: DocumentView, name: string): unknown[] {
  const value = view.fields[name];
  return Array.isArray(value) ? value : [];
}

/** Key of a list entry: the string itself, else `id` / `text` / `item` of an object, else the index. */
function entryKey(entry: unknown, index: number): string {
  if (typeof entry === "string") return entry;
  if (isRecord(entry)) {
    for (const property of ["id", "text", "item"] as const) {
      const candidate = entry[property];
      if (typeof candidate === "string" && candidate !== "") return candidate;
    }
  }
  return `#${index}`;
}

function normaliseForCompare(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function citedBySomeCriterion(key: string, ports: CrossFieldCheckPorts): boolean {
  return ports.criteria.some((criterion) => criterion.cites.includes(key));
}

function everyEntryCited(check: CrossFieldCheckId, marker: string, noun: string): CrossFieldCheck {
  return (view, ports) =>
    markedFields(view, marker).flatMap((name) =>
      entryList(view, name).flatMap((entry, index) => {
        const key = entryKey(entry, index);
        return citedBySomeCriterion(key, ports) ? [] : [{ check, entry: `${name}: ${key}`, problem: `${noun} is cited by no acceptance criterion` }];
      }),
    );
}

const refsResolve: CrossFieldCheck = (view, ports) => {
  const findings: CheckFinding[] = [];
  const resolves = (ref: string): boolean => readFieldPath(view.fields, ref) !== undefined || ports.resolveRef(ref);
  for (const name of markedFields(view, "x-ref-list")) {
    for (const ref of entryList(view, name)) {
      if (typeof ref === "string" && !resolves(ref)) findings.push({ check: "refs-resolve", entry: `${name}: ${ref}`, problem: "names no existing AC, rule, field or document" });
    }
  }
  for (const dimension of view.dimensions) {
    for (const ref of dimension.refs) {
      if (!resolves(ref)) findings.push({ check: "refs-resolve", entry: `dimension ${dimension.id}: ${ref}`, problem: "names no existing AC, rule, field or document" });
    }
  }
  return findings;
};

const decisionHasRejected: CrossFieldCheck = (view) =>
  markedFields(view, "x-decision-list").flatMap((name) =>
    entryList(view, name).flatMap((entry, index) => {
      const decision = isRecord(entry) ? entry : {};
      const label = typeof decision.decision === "string" && decision.decision !== "" ? decision.decision : entryKey(entry, index);
      const rejected = decision.rejected;
      const hasRejected = Array.isArray(rejected)
        ? rejected.some((option) => nonEmptyString(option) || (isRecord(option) && nonEmptyString(option.option)))
        : nonEmptyString(rejected);
      const out: CheckFinding[] = [];
      if (!hasRejected) out.push({ check: "decision-has-rejected", entry: `${name}: ${label}`, problem: "names no rejected option" });
      if (!nonEmptyString(decision.why)) out.push({ check: "decision-has-rejected", entry: `${name}: ${label}`, problem: "gives no reason (why) for the choice" });
      return out;
    }),
  );

const outOfScopeNotInScope: CrossFieldCheck = (view) => {
  const inScope = new Map<string, string>();
  for (const name of markedFields(view, "x-scope-list")) {
    entryList(view, name).forEach((entry, index) => {
      const key = entryKey(entry, index);
      inScope.set(normaliseForCompare(key), key);
    });
  }
  return markedFields(view, "x-out-of-scope-list").flatMap((name) =>
    entryList(view, name).flatMap((entry, index) => {
      const key = entryKey(entry, index);
      return inScope.has(normaliseForCompare(key))
        ? [{ check: "out-of-scope-not-in-scope" as const, entry: `${name}: ${key}`, problem: "is listed both in scope and out of scope" }]
        : [];
    }),
  );
};

const goalHasMeasure: CrossFieldCheck = (view) =>
  markedFields(view, "x-goal").flatMap((name) => {
    const goal = view.fields[name];
    if (goal === undefined) return [];
    const measure = isRecord(goal) ? goal.measure : undefined;
    return nonEmptyString(measure) ? [] : [{ check: "goal-has-measure" as const, entry: name, problem: "goal names no observable measure (set goal.measure)" }];
  });

/** The library: pure functions keyed by id. */
export const CROSS_FIELD_CHECKS: Readonly<Record<CrossFieldCheckId, CrossFieldCheck>> = {
  "refs-resolve": refsResolve,
  "refusal-has-ac": everyEntryCited("refusal-has-ac", "x-refusal-list", "refusal"),
  "rule-change-has-ac": everyEntryCited("rule-change-has-ac", "x-rule-change-list", "rule change"),
  "decision-has-rejected": decisionHasRejected,
  "out-of-scope-not-in-scope": outOfScopeNotInScope,
  "goal-has-measure": goalHasMeasure,
};

/**
 * Run the checks a template lists, at promote/approve or on demand.
 *
 * @param template - the pinned template; only its `checks` are run (an unlisted check never applies)
 * @param view - the document's fields and dimension answers
 * @param ports - criteria citations and the ref resolver
 * @returns every finding across all listed checks, in template check order
 */
export function runCrossFieldChecks(template: Template, view: DocumentView, ports: CrossFieldCheckPorts): CheckFinding[] {
  return template.checks.flatMap((id) => CROSS_FIELD_CHECKS[id](view, ports));
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

function orderedKeys(value: Record<string, unknown>, schema: JsonSchemaNode | undefined): string[] {
  const declared = Object.keys(schema?.properties ?? {}).filter((key) => key in value);
  const rest = Object.keys(value).filter((key) => !declared.includes(key)).sort();
  return [...declared, ...rest];
}

function renderValue(value: unknown, schema: JsonSchemaNode | undefined, indent: string): string[] {
  if (Array.isArray(value)) {
    return value.filter((item) => !isEmptyValue(item)).flatMap((item) => {
      const [first, ...rest] = renderValue(item, schema?.items, `${indent}  `);
      return [`${indent}- ${(first ?? "").trimStart()}`, ...rest];
    });
  }
  if (isRecord(value)) {
    return orderedKeys(value, schema)
      .filter((key) => !isEmptyValue(value[key]))
      .flatMap((key) => {
        const child = value[key];
        const childSchema = schema?.properties?.[key];
        if (Array.isArray(child) || isRecord(child)) return [`${indent}${key}:`, ...renderValue(child, childSchema, `${indent}  `)];
        return [`${indent}${key}: ${String(child)}`];
      });
  }
  return [`${indent}${String(value)}`];
}

function renderFieldBody(value: unknown, schema: JsonSchemaNode | undefined): string {
  if (typeof value === "string") return value.trim();
  return renderValue(value, schema, "").join("\n");
}

/**
 * Render a document's text view from its fields: one `## heading` section per template render
 * section, in template order; fields with no value are omitted, and a section with nothing to
 * show is omitted whole.
 *
 * @param template - the pinned template
 * @param fields - `extra.fields`
 * @returns markdown; the same input always yields byte-identical output (object keys are ordered
 *   by schema property order, then alphabetically — never by insertion order)
 */
export function renderDocument(template: Template, fields: Record<string, unknown>): string {
  const sections: string[] = [];
  for (const section of template.render) {
    const parts: string[] = [];
    for (const fieldPath of section.fields) {
      const value = readFieldPath(fields, fieldPath);
      if (isEmptyValue(value)) continue;
      const node = schemaAtFieldPath(template.fields as JsonSchemaNode, fieldPath);
      const body = renderFieldBody(value, node);
      if (body === "") continue;
      if (section.fields.length > 1) {
        const label = typeof node?.title === "string" ? node.title : (fieldPath.split(".").pop() ?? fieldPath);
        parts.push(`### ${label}\n\n${body}`);
      } else {
        parts.push(body);
      }
    }
    if (parts.length > 0) sections.push(`## ${section.heading}\n\n${parts.join("\n\n")}`);
  }
  return sections.length === 0 ? "" : `${sections.join("\n\n")}\n`;
}
