/**
 * ConversionService: turn one open legacy document into a structured one (`lore convert <doc>`).
 *
 * Purpose: AC-ST-7 of spec-every-document-is-stored-as-structured-fields-validated-by. Builds `extra.fields` and
 *   `extra.dimensions` from the existing body with an AI draft, then hands them to the ONE validating write path
 *   (`CorpusService.set` with `convertToTemplate`), which pins the template, validates, and renders the body.
 * Public surface: {@link ConversionService} (`convert`), {@link buildConversionPrompt}, {@link parseConversionDraft},
 *   {@link ConversionDraftPort}, {@link ConversionOutcome}.
 * Invariants:
 *   - Only an OPEN document converts: a completed or legacy-frozen document, a deleted one, a template, and an already
 *     templated one are refused (VALIDATION_ERROR, exit 4) before the AI is called.
 *   - The AI output is untrusted: it is parsed against a Zod shape here and validated against the template by the write
 *     path; nothing the draft says is stored unvalidated, and an unusable draft writes nothing.
 *   - The write is a normal versioned write guarded by the version read at the start (`expectedVersion`), so two
 *     concurrent converts of one document end with one conversion and one STALE_VERSION refusal.
 *   - A locked record (spec/adr approved, claimed task, settled knowledge) is converted through `correction`, never by
 *     bypassing the lock; a living document is simply rewritten (its approval resets to draft as any content change does).
 * Side-effect class: IO (one AI provider call, one document write through the injected write route).
 */

import { err, ok, validationError, type DocRecord, type LoreError, type Result } from "@lore/core";
import { z } from "zod";
import { isLegacyFrozen } from "./legacy-freeze.js";
import { documentKindOf, type ResolvedTemplate } from "./template-service.js";

/** The AI provider port, as this service needs it: a prompt in, raw text out. */
export interface ConversionDraftPort {
  draftText(prompt: string, docType: DocRecord["type"], title: string): Promise<Result<string, LoreError>>;
}

/** The corpus operations conversion uses (structural: `CorpusService` satisfies it). */
export interface ConversionCorpusPort {
  get(idOrSlug: string): Promise<Result<{ doc: DocRecord }, LoreError>>;
  set(
    idOrSlug: string,
    patch: { extra: Record<string, unknown> },
    opts: {
      by?: string;
      expectedVersion: number;
      convertToTemplate: true;
      correction?: { reason: string };
    },
  ): Promise<Result<DocRecord, LoreError>>;
}

/** What a conversion needs from the rest of the service layer. */
export interface ConversionDeps {
  readonly corpus: ConversionCorpusPort;
  readonly templates: { resolveTemplate(docType: string, kind?: string): Promise<Result<ResolvedTemplate, LoreError>> };
  readonly classification: { isCompleted(doc: DocRecord): Promise<Result<boolean, LoreError>> };
  /** `true` when the record is locked (the write must carry a correction). */
  readonly isLockedRecord: (doc: DocRecord) => Promise<Result<boolean, LoreError>>;
  readonly draft: ConversionDraftPort;
}

/** What `convert` reports. */
export interface ConversionOutcome {
  readonly slug: string;
  readonly type: string;
  readonly version: number;
  readonly status: string;
  readonly template_ref: string;
  /** True when the record was locked and the conversion went through `correction`. */
  readonly correction: boolean;
}

/** Shape the AI draft must have; the template validation of its content is the write path's job. */
const conversionDraftSchema = z.object({
  fields: z.record(z.unknown()),
  dimensions: z.array(z.unknown()),
});

/**
 * The drafting prompt: the template's field schema and dimensions, then the document as it is.
 *
 * @param template - the template the document will be pinned to
 * @param doc - the document being converted
 * @returns the prompt text
 */
export function buildConversionPrompt(template: ResolvedTemplate, doc: DocRecord): string {
  const dimensions = template.template.dimensions.map((dimension) => ({
    id: dimension.id,
    question: dimension.question,
    needs_refs: dimension.needs_refs === true,
  }));
  return [
    `Convert the existing ${doc.type} document below into structured fields for template ${template.ref}.`,
    "Use only what the document already says; never invent facts. Answer EVERY dimension: status `handled` with the answer, or `na` with the reason it does not apply. A dimension that needs refs lists the criterion ids, rule ids or document slugs the document cites.",
    "Reply with ONE JSON object and nothing else: {\"fields\": {...}, \"dimensions\": [{\"id\": string, \"status\": \"handled\"|\"na\", \"answer\": string, \"refs\": string[]}]}.",
    "",
    "FIELDS (JSON Schema):",
    JSON.stringify(template.template.fields, null, 2),
    "",
    "DIMENSIONS:",
    JSON.stringify(dimensions, null, 2),
    "",
    `DOCUMENT TITLE: ${doc.title}`,
    "DOCUMENT BODY:",
    doc.content,
  ].join("\n");
}

/**
 * Parse the provider's text into a draft; tolerates a code fence or prose around the JSON object.
 *
 * @param text - the provider output
 * @param slug - the document, named in the refusal
 * @returns the draft, or a VALIDATION_ERROR (exit 4) naming what was unusable
 */
export function parseConversionDraft(text: string, slug: string): Result<z.infer<typeof conversionDraftSchema>, LoreError> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return err(validationError("draft", `the AI draft for ${slug} is not a JSON object: ${text.slice(0, 200)}`));
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (cause) {
    return err(validationError("draft", `the AI draft for ${slug} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`));
  }
  const parsed = conversionDraftSchema.safeParse(raw);
  if (!parsed.success) {
    return err(validationError("draft", `the AI draft for ${slug} lacks fields/dimensions: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`));
  }
  return ok(parsed.data);
}

export class ConversionService {
  constructor(private readonly deps: ConversionDeps) {}

  /**
   * Convert one open legacy document.
   *
   * @param idOrSlug - the document
   * @param opts - `by`: the acting identity for the version and audit rows
   * @returns the outcome, or the refusal (completed/frozen/templated, missing template, unusable draft, invalid content,
   *   STALE_VERSION when another write landed first)
   */
  async convert(idOrSlug: string, opts: { by?: string } = {}): Promise<Result<ConversionOutcome, LoreError>> {
    const found = await this.deps.corpus.get(idOrSlug);
    if (!found.ok) return found;
    const doc = found.value.doc;
    const refusal = await this.refusalFor(doc);
    if (refusal !== undefined) return err(refusal);

    const resolved = await this.deps.templates.resolveTemplate(doc.type, documentKindOf(doc));
    if (!resolved.ok) return resolved;

    const drafted = await this.deps.draft.draftText(buildConversionPrompt(resolved.value, doc), doc.type, doc.title);
    if (!drafted.ok) return drafted;
    const draft = parseConversionDraft(drafted.value, doc.slug);
    if (!draft.ok) return draft;

    const locked = await this.deps.isLockedRecord(doc);
    if (!locked.ok) return locked;
    const written = await this.deps.corpus.set(
      doc.id,
      { extra: { ...doc.extra, fields: draft.value.fields, dimensions: draft.value.dimensions } },
      {
        expectedVersion: doc.version,
        convertToTemplate: true,
        ...(opts.by !== undefined ? { by: opts.by } : {}),
        ...(locked.value ? { correction: { reason: `converted to the structured template ${resolved.value.ref} (lore convert)` } } : {}),
      },
    );
    if (!written.ok) return written;
    return ok({
      slug: written.value.slug,
      type: written.value.type,
      version: written.value.version,
      status: written.value.status,
      template_ref: resolved.value.ref,
      correction: locked.value,
    });
  }

  private async refusalFor(doc: DocRecord): Promise<LoreError | undefined> {
    if (doc.deleted_at !== null) return validationError("slug", `${doc.slug} is deleted and is not converted`);
    if (doc.type === "template") return validationError("type", `${doc.slug} is a template: templates are validated by the core meta-schema, not converted`);
    if (typeof doc.extra["template_ref"] === "string") {
      return validationError("extra.template_ref", `${doc.slug} is already converted (${String(doc.extra["template_ref"])})`);
    }
    if (isLegacyFrozen(doc)) {
      return validationError("legacy", `${doc.slug} is legacy-frozen (completed before structured templates) and is never converted`);
    }
    const completed = await this.deps.classification.isCompleted(doc);
    if (!completed.ok) return completed.error;
    if (completed.value) {
      return validationError("legacy", `${doc.slug} is completed and stays in its old form: run \`lore migrate legacy --apply\` to freeze it; it is never converted`);
    }
    return undefined;
  }
}
