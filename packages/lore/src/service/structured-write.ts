/**
 * Structured write: the validation and rendering step of the one document write path.
 *
 * Purpose: decide, for ONE create/set/writeDoc request, whether the document is templated; if so validate its
 *   `extra.fields` + `extra.dimensions` against the pinned template, render its body from the fields, and refuse a
 *   supplied body (spec-every-document-is-stored-as-structured-fields-validated-by, BR-1528/BR-1529).
 * Public surface: {@link StructuredWriteDeps}, {@link FieldsPatch}, {@link prepareStructuredCreate},
 *   {@link prepareStructuredUpdate}, {@link guardStructuredRowWrite}, {@link formatTemplateProblems}.
 * Invariants:
 *   - Called ONLY by `CorpusService` (create, set, writeDoc). Adapters never call it: that is what keeps the write
 *     path single (AC-ST-4's static check scans adapters for store writes).
 *   - A document without `extra.template_ref` is legacy: it is returned untouched (`ok(null)`) unless a create is
 *     explicitly structured (fields supplied, or `requireStructuredCreate` armed). Nothing is refused for a legacy
 *     document before its conversion.
 *   - A templated document is validated against its PINNED template version, except when `templateVersion: "latest"`
 *     moves the pin, in which case it is validated against the newest approved version.
 *   - Refs are never resolved here (criteria are declared after create); that is the promote-time check.
 *   - Every refusal is a VALIDATION_ERROR (exit 4) that names every failing field/dimension in one message and
 *     names `--fields-file` where the author should write instead; nothing is written by this module.
 * Side-effect class: read-only (template reads through {@link TemplateService}).
 */

import { err, ok, validationError, type DocRecord, type LoreError, type Result, type TemplateProblem } from "@lore/core";
import { bodyDiffers } from "./record-lock-service.js";
import { documentKindOf, type TemplateService } from "./template-service.js";

/** What the write path needs to make a document structured. */
export interface StructuredWriteDeps {
  readonly templates: TemplateService;
  /**
   * When true a NEW document of any type must be created structured (BR-1528); when false only a create that
   * supplies `extra.fields` (or a `template_ref`) is structured and a plain create keeps today's free body.
   * Source: `workflow.structured_documents.require_create` (default false until the open documents are converted;
   * a later task deletes the switch after the test migration).
   */
  readonly requireStructuredCreate: boolean;
}

/** A partial update of the structured content: top-level `fields` keys replace, `dimensions` merge by id. */
export interface FieldsPatch {
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly dimensions?: readonly unknown[];
}

/** The structured outcome of a prepared write: the `extra` to store (template_ref pinned) and the rendered body. */
export interface StructuredOutcome {
  readonly extra: Record<string, unknown>;
  readonly content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One message that lists every problem (fields by path, dimensions by id).
 *
 * @param problems - the validator's findings
 * @returns a single line-joined message
 */
export function formatTemplateProblems(problems: readonly TemplateProblem[]): string {
  return problems
    .map((problem) => ("field" in problem ? `[${problem.code}] field ${problem.field}: ${problem.problem}` : `[${problem.code}] dimension ${problem.dimension}: ${problem.problem}`))
    .join("; ");
}

function bodyRefusal(slug: string, ref: string): LoreError {
  return validationError(
    "content",
    `${slug} is a templated document (${ref}): its text is rendered from its fields, so a supplied body is refused — ` +
      "write the fields instead (`lore set <doc> --fields-file <yaml|json>`; `lore template show <type> --blank` prints the skeleton)",
  );
}

/** Dimension answers merged by id: a patched id replaces in place, a new id is appended. */
function mergeDimensions(current: unknown, patch: readonly unknown[]): unknown[] {
  const merged: unknown[] = Array.isArray(current) ? [...(current as unknown[])] : [];
  for (const entry of patch) {
    const id = isRecord(entry) ? entry["id"] : undefined;
    const at = merged.findIndex((existing) => isRecord(existing) && existing["id"] === id);
    if (at >= 0 && id !== undefined) merged[at] = entry;
    else merged.push(entry);
  }
  return merged;
}

/** Validate then render a candidate; the candidate's `template_ref` must already be pinned in `extra`. */
async function validateAndRender(
  deps: StructuredWriteDeps,
  subject: { slug: string; type: DocRecord["type"]; extra: Record<string, unknown> },
): Promise<Result<string, LoreError>> {
  const problems = await deps.templates.validate(subject);
  if (!problems.ok) return problems;
  if (problems.value.length > 0) {
    const ref = String(subject.extra["template_ref"]);
    return err(
      validationError(
        "extra.fields",
        `${subject.slug} does not satisfy ${ref}: ${formatTemplateProblems(problems.value)}`,
        problems.value,
      ),
    );
  }
  return deps.templates.render(subject);
}

/**
 * Prepare a NEW document: resolve the latest approved template of its type and kind, pin it, validate, render.
 *
 * @param deps - template access and the create policy
 * @param input - the create request after defaulting (`extra.spec_kind` etc. already applied)
 * @returns `ok(null)` for a legacy create (untouched); `ok({extra, content})` for a structured one; or the refusal
 */
export async function prepareStructuredCreate(
  deps: StructuredWriteDeps,
  input: { readonly type: DocRecord["type"]; readonly slug: string; readonly extra: Record<string, unknown>; readonly content: string | undefined },
): Promise<Result<StructuredOutcome | null, LoreError>> {
  // reason: a template's own substance is validated by the core meta-schema, never by a template document.
  if (input.type === "template") return ok(null);
  const suppliedFields = input.extra["fields"] !== undefined;
  const suppliedRef = typeof input.extra["template_ref"] === "string";
  if (!suppliedFields && !suppliedRef && !deps.requireStructuredCreate) return ok(null);

  const kind = documentKindOf({ type: input.type, extra: input.extra });
  const resolved = await deps.templates.resolveTemplate(input.type, kind);
  if (!resolved.ok) return resolved;
  if (!suppliedFields) {
    return err(
      validationError(
        "extra.fields",
        `a new ${input.type}${kind === undefined ? "" : `/${kind}`} document is created structured (${resolved.value.ref}): pass --fields-file <yaml|json> ` +
          "(`lore template show " + input.type + (kind === undefined ? "" : ` --kind ${kind}`) + " --blank` prints the skeleton)",
      ),
    );
  }
  if (input.content !== undefined && input.content.trim() !== "") {
    return err(bodyRefusal(input.slug, resolved.value.ref));
  }
  const extra: Record<string, unknown> = {
    ...input.extra,
    template_ref: resolved.value.ref,
    dimensions: input.extra["dimensions"] ?? [],
  };
  const rendered = await validateAndRender(deps, { slug: input.slug, type: input.type, extra });
  if (!rendered.ok) return rendered;
  return ok({ extra, content: rendered.value });
}

/** The conversion of a legacy document: pin the latest approved template, validate the drafted content, render it. */
async function prepareConversion(
  deps: StructuredWriteDeps,
  existing: DocRecord,
  patch: { readonly content?: string | undefined; readonly extra?: Record<string, unknown> | undefined },
  storedRef: string | undefined,
): Promise<Result<StructuredOutcome | null, LoreError>> {
  if (storedRef !== undefined) {
    return err(validationError("extra.template_ref", `${existing.slug} is already converted (${storedRef}); edit it with --fields-file`));
  }
  const extraIn = patch.extra;
  if (extraIn === undefined || !isRecord(extraIn["fields"])) {
    return err(validationError("extra.fields", `converting ${existing.slug} needs the drafted fields`));
  }
  const kind = documentKindOf({ type: existing.type, extra: extraIn });
  const resolved = await deps.templates.resolveTemplate(existing.type, kind);
  if (!resolved.ok) return resolved;
  const extra: Record<string, unknown> = {
    ...extraIn,
    template_ref: resolved.value.ref,
    dimensions: extraIn["dimensions"] ?? [],
  };
  const rendered = await validateAndRender(deps, { slug: existing.slug, type: existing.type, extra });
  if (!rendered.ok) return rendered;
  return ok({ extra, content: rendered.value });
}

/**
 * Prepare a change to an EXISTING document.
 *
 * @param deps - template access
 * @param existing - the stored document
 * @param patch - the patch's `content` and `extra` (as supplied; `extra` replaces wholesale, as `set` always did)
 * @param request - `fieldsPatch` (partial merge) and `templateVersion: "latest"` (move the pin)
 * @returns `ok(null)` when the write is not a structured one (legacy document, nothing structured touched);
 *   `ok({extra, content})` to store; or the refusal
 */
export async function prepareStructuredUpdate(
  deps: StructuredWriteDeps,
  existing: DocRecord,
  patch: { readonly content?: string | undefined; readonly extra?: Record<string, unknown> | undefined },
  request: {
    readonly fieldsPatch?: FieldsPatch | undefined;
    readonly templateVersion?: "latest" | undefined;
    /** `lore convert`: turn an unconverted document into a templated one from `patch.extra.fields` / `dimensions`. */
    readonly convert?: boolean | undefined;
  },
): Promise<Result<StructuredOutcome | null, LoreError>> {
  const storedRef: unknown = existing.extra["template_ref"];
  if (request.convert === true) return prepareConversion(deps, existing, patch, typeof storedRef === "string" && storedRef !== "" ? storedRef : undefined);
  const suppliedRef: unknown = patch.extra?.["template_ref"];
  const templated = typeof storedRef === "string" && storedRef !== "";
  const wantsStructure = request.fieldsPatch !== undefined || request.templateVersion !== undefined || typeof suppliedRef === "string";

  if (!templated) {
    if (request.fieldsPatch !== undefined || request.templateVersion !== undefined) {
      return err(
        validationError(
          "extra.template_ref",
          `${existing.slug} has no template_ref: it is a legacy document and is edited as before (--content) until it is converted (lore convert)`,
        ),
      );
    }
    return ok(null);
  }

  const ref = storedRef;
  if (patch.content !== undefined && bodyDiffers(existing.content, patch.content)) {
    return err(bodyRefusal(existing.slug, ref));
  }
  const touchesStructure = wantsStructure || patch.extra !== undefined;
  if (!touchesStructure) return ok(null);

  let extra: Record<string, unknown> = { ...(patch.extra ?? existing.extra) };
  if (request.fieldsPatch !== undefined) {
    const currentFields = isRecord(extra["fields"]) ? extra["fields"] : {};
    extra = { ...extra, fields: { ...currentFields, ...(request.fieldsPatch.fields ?? {}) } };
    if (request.fieldsPatch.dimensions !== undefined) {
      extra = { ...extra, dimensions: mergeDimensions(extra["dimensions"], request.fieldsPatch.dimensions) };
    }
  }
  if (request.templateVersion === "latest") {
    const kind = documentKindOf({ type: existing.type, extra });
    const latest = await deps.templates.resolveTemplate(existing.type, kind);
    if (!latest.ok) return latest;
    extra = { ...extra, template_ref: latest.value.ref };
  }
  const rendered = await validateAndRender(deps, { slug: existing.slug, type: existing.type, extra });
  if (!rendered.ok) return rendered;
  return ok({ extra, content: rendered.value });
}

/**
 * Guard for the row-level write route (`CorpusService.writeDoc`), which services use for lifecycle, link and
 * anchor writes: those never touch a templated document's content, fields or pin, and when one does it must pass
 * the same validation.
 *
 * @param deps - template access
 * @param doc - the stored document
 * @param patch - the row patch about to be written
 * @returns `ok(undefined)` to proceed, or the refusal
 */
export async function guardStructuredRowWrite(
  deps: StructuredWriteDeps,
  doc: DocRecord,
  patch: { readonly content?: string | undefined; readonly extra?: Record<string, unknown> | undefined },
): Promise<Result<undefined, LoreError>> {
  const ref: unknown = doc.extra["template_ref"];
  if (typeof ref !== "string" || ref === "") return ok(undefined);
  if (patch.content !== undefined && bodyDiffers(doc.content, patch.content)) return err(bodyRefusal(doc.slug, ref));
  if (patch.extra === undefined) return ok(undefined);
  const changed =
    JSON.stringify(patch.extra["fields"]) !== JSON.stringify(doc.extra["fields"]) ||
    JSON.stringify(patch.extra["dimensions"]) !== JSON.stringify(doc.extra["dimensions"]) ||
    patch.extra["template_ref"] !== doc.extra["template_ref"];
  if (!changed) return ok(undefined);
  const checked = await validateAndRender(deps, { slug: doc.slug, type: doc.type, extra: patch.extra });
  return checked.ok ? ok(undefined) : checked;
}
