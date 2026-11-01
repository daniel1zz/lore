/**
 * TemplateService: resolve, render, validate and cross-check templated documents against their template.
 *
 * Purpose: the ONE reader of corpus `template` documents (spec-every-document-is-stored-as-structured-fields-
 *   validated-by). Gates, `lore feed`, `lore template show|check` and the judge call this, never the store.
 * Public surface: {@link TemplateService} (`resolveTemplate`, `resolvePinned`, `render`, `validate`, `checks`),
 *   {@link ResolvedTemplate}, {@link documentKindOf}.
 * Invariants:
 *   - Versions come from the template document's HISTORY: a template version N is the newest document-history
 *     snapshot in status approved|active whose `extra.template.version` is N. A later revision adds a snapshot and never
 *     rewrites an earlier one, so `slug@N` returns exactly what was approved as N even while the live row is a
 *     draft revision or already at N+1. (Storing versions inside `extra` would duplicate every template body and let
 *     one write rewrite an approved version.)
 *   - "Latest approved" ignores a pending draft revision.
 *   - A pinned document is validated and rendered against its PINNED version, never the latest.
 *   - A kind and a kind-less template are different slots; there is no fallback from one to the other.
 *   - Every method returns a Result; nothing throws across this boundary.
 * Side-effect class: read-only (store reads only; writes nothing).
 */

import {
  dimensionAnswerSchema,
  err,
  formatTemplateRef,
  ok,
  parseTemplate,
  parseTemplateRef,
  renderDocument,
  runCrossFieldChecks,
  specAcceptanceCriteriaSchema,
  validateDocument,
  validationError,
  type CheckFinding,
  type DimensionAnswer,
  type DocRecord,
  type LoreError,
  type Result,
  type Template,
  type TemplateProblem,
} from "@lore/core";
import type { JsonSchemaNode } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

/** A template with the address documents pin it by. */
export interface ResolvedTemplate {
  /** Slug of the corpus `template` document. */
  readonly slug: string;
  /** The template's own version number (`template.version`). */
  readonly version: number;
  /** `slug@version`, the value of `extra.template_ref`. */
  readonly ref: string;
  readonly template: Template;
}

/**
 * What the service reads of a templated document: its address (for messages), type (kind lookup) and `extra`. A
 * stored `DocRecord` satisfies it, and so does a document that is about to be written and has no row yet — which is
 * how the write path validates BEFORE anything is stored.
 */
export type TemplatedDocLike = Pick<DocRecord, "slug" | "type" | "extra">;

/** Statuses of a template snapshot that count as approved. */
const APPROVED_STATUSES: readonly string[] = ["approved", "active"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `spec/tech`, `knowledge/retro` or just `task`: how a missing template is named. */
function slotName(docType: string, kind: string | undefined): string {
  return kind === undefined ? docType : `${docType}/${kind}`;
}

/**
 * The kind a document's template is selected by: a spec's `spec_kind`, a knowledge doc's `sub_type`, a baseline node's
 * `node`; other types have none.
 *
 * @param doc - any document
 * @returns the kind, or undefined when the type has none or the document does not carry it
 */
export function documentKindOf(doc: Pick<DocRecord, "type" | "extra">): string | undefined {
  const extra: unknown = doc.extra;
  if (!isRecord(extra)) return undefined;
  const key = doc.type === "spec" ? "spec_kind" : doc.type === "knowledge" ? "sub_type" : doc.type === "baseline" ? "node" : undefined;
  const value = key === undefined ? undefined : extra[key];
  return typeof value === "string" ? value : undefined;
}

export class TemplateService {
  constructor(private readonly store: StoreInterface) {}

  /**
   * The latest APPROVED template for a document type (and kind).
   *
   * @param docType - e.g. `spec`
   * @param kind - e.g. `tech`; omitted = the kind-less template of the type
   * @returns the highest approved template version of that slot, or VALIDATION_ERROR naming the missing template
   */
  async resolveTemplate(docType: string, kind?: string): Promise<Result<ResolvedTemplate, LoreError>> {
    const docs = await this.store.findMany({ type: "template" });
    if (!docs.ok) return docs;
    let best: ResolvedTemplate | undefined;
    for (const doc of docs.value) {
      const snapshots = await this.approvedSnapshots(doc);
      if (!snapshots.ok) return snapshots;
      for (const snapshot of snapshots.value) {
        if (snapshot.template.doc_type !== docType || snapshot.template.kind !== kind) continue;
        if (best === undefined || snapshot.template.version > best.version) best = snapshot;
      }
    }
    if (best === undefined) {
      const name = slotName(docType, kind);
      return err(
        validationError(
          "template",
          `no approved template for ${name}: create one (lore create template), then review and approve it`,
          name,
        ),
      );
    }
    return ok(best);
  }

  /**
   * The document types that have at least one approved template (the "templated" types: only these are classified
   * legacy-frozen or listed for conversion).
   *
   * @returns the set of `doc_type`s, or the store failure
   */
  async templatedTypes(): Promise<Result<ReadonlySet<string>, LoreError>> {
    const docs = await this.store.findMany({ type: "template" });
    if (!docs.ok) return docs;
    const types = new Set<string>();
    for (const doc of docs.value) {
      if (doc.deleted_at !== null) continue;
      const snapshots = await this.approvedSnapshots(doc);
      if (!snapshots.ok) return snapshots;
      for (const snapshot of snapshots.value) types.add(snapshot.template.doc_type);
    }
    return ok(types);
  }

  /**
   * The template a `slug@version` pin names, exactly as it was approved as that version.
   *
   * @param ref - `extra.template_ref`, e.g. `spec-tech-template@2`
   * @returns the template, or VALIDATION_ERROR naming the ref (malformed, unknown slug, or version never approved)
   */
  async resolvePinned(ref: string): Promise<Result<Template, LoreError>> {
    const parsed = parseTemplateRef(ref);
    if (parsed === undefined) {
      return err(validationError("template_ref", `template ref "${ref}" is not <slug>@<version> (a positive integer)`, ref));
    }
    const doc = await this.store.findBySlug(parsed.slug);
    if (!doc.ok) return doc;
    if (doc.value === null || doc.value.type !== "template") {
      return err(validationError("template_ref", `template ref ${ref}: no template document "${parsed.slug}"`, ref));
    }
    const snapshots = await this.approvedSnapshots(doc.value);
    if (!snapshots.ok) return snapshots;
    const match = snapshots.value.find((snapshot) => snapshot.version === parsed.version);
    if (match === undefined) {
      const known = snapshots.value.map((snapshot) => String(snapshot.version)).join(", ");
      return err(
        validationError(
          "template_ref",
          `template ref ${ref}: version ${String(parsed.version)} was never approved (approved versions: ${known === "" ? "none" : known})`,
          ref,
        ),
      );
    }
    return ok(match.template);
  }

  /**
   * The document's text view, rendered from its fields by its pinned template.
   *
   * @param doc - a templated document (`extra.template_ref`, `extra.fields`)
   * @returns deterministic markdown, or the resolution refusal
   */
  async render(doc: TemplatedDocLike): Promise<Result<string, LoreError>> {
    const loaded = await this.loadPinned(doc);
    if (!loaded.ok) return loaded;
    return ok(renderDocument(loaded.value.template, loaded.value.fields));
  }

  /**
   * Write-time validation of the document against its PINNED template: schema violations and dimension
   * completeness, all problems at once. Never resolves refs.
   *
   * @param doc - a templated document
   * @returns the problems (empty = valid), or the resolution refusal
   */
  async validate(doc: TemplatedDocLike): Promise<Result<TemplateProblem[], LoreError>> {
    const loaded = await this.loadPinned(doc);
    if (!loaded.ok) return loaded;
    const { template, fields } = loaded.value;
    const kind = documentKindOf(doc);
    const checked = validateDocument(template, fields, doc.extra["dimensions"], kind === undefined ? {} : { kind });
    return ok(checked.ok ? [] : checked.error);
  }

  /**
   * The promote-time cross-field checks the pinned template lists, run on demand. Criteria are the document's own
   * acceptance criteria plus those of the spec `fields.spec_ref` names; a ref resolves when it names one of them, a
   * registered rule id, or a document (slug or id).
   *
   * @param doc - a templated document
   * @returns the findings (empty = clean), or the resolution refusal
   */
  async checks(doc: TemplatedDocLike): Promise<Result<CheckFinding[], LoreError>> {
    const loaded = await this.loadPinned(doc);
    if (!loaded.ok) return loaded;
    const { template, fields } = loaded.value;

    const criteria = this.criteriaOf(doc);
    const governingSpecCriterionIds = await this.governingSpecCriterionIds(fields["spec_ref"]);
    if (!governingSpecCriterionIds.ok) return governingSpecCriterionIds;
    const known = await this.knownRefTargets([...criteria.map((criterion) => criterion.id), ...governingSpecCriterionIds.value]);
    if (!known.ok) return known;

    const answers: DimensionAnswer[] = [];
    const rawAnswers: unknown = doc.extra["dimensions"];
    for (const raw of Array.isArray(rawAnswers) ? (rawAnswers as unknown[]) : []) {
      // reason: a malformed entry is `validate`'s finding; the cross-field checks run over the well-formed ones.
      const parsed = dimensionAnswerSchema.safeParse(raw);
      if (parsed.success) answers.push(parsed.data);
    }

    return ok(
      runCrossFieldChecks(
        template,
        { fieldsSchema: template.fields as JsonSchemaNode, fields, dimensions: answers },
        { criteria, resolveRef: (ref) => known.value.has(ref) },
      ),
    );
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Every approved snapshot of one template document, one per template version (newest document version wins). */
  private async approvedSnapshots(doc: DocRecord): Promise<Result<ResolvedTemplate[], LoreError>> {
    const versions = await this.store.findVersions(doc.id);
    if (!versions.ok) return versions;
    const byVersion = new Map<number, ResolvedTemplate>();
    // findVersions is newest first: the first snapshot seen for a template version is its newest.
    for (const row of versions.value) {
      if (!APPROVED_STATUSES.includes(row.status)) continue;
      const parsed = parseTemplate(row.extra["template"]);
      // reason: a snapshot that no longer parses (written before the meta-schema was enforced) cannot be served.
      if (!parsed.ok || byVersion.has(parsed.value.version)) continue;
      byVersion.set(parsed.value.version, {
        slug: doc.slug,
        version: parsed.value.version,
        ref: formatTemplateRef({ slug: doc.slug, version: parsed.value.version }),
        template: parsed.value,
      });
    }
    return ok([...byVersion.values()]);
  }

  private async loadPinned(doc: TemplatedDocLike): Promise<Result<{ template: Template; fields: Record<string, unknown> }, LoreError>> {
    const ref: unknown = doc.extra["template_ref"];
    if (typeof ref !== "string" || ref === "") {
      return err(validationError("extra.template_ref", `${doc.slug} has no extra.template_ref: it is not a templated document`, ref));
    }
    const fields: unknown = doc.extra["fields"];
    if (!isRecord(fields)) {
      return err(validationError("extra.fields", `${doc.slug} has no extra.fields object to read against ${ref}`, fields));
    }
    const template = await this.resolvePinned(ref);
    if (!template.ok) return template;
    return ok({ template: template.value, fields });
  }

  private criteriaOf(doc: TemplatedDocLike): { id: string; cites: string[] }[] {
    const raw: unknown = doc.extra["acceptance_criteria"];
    if (!Array.isArray(raw)) return [];
    const criteria: { id: string; cites: string[] }[] = [];
    for (const entry of raw as unknown[]) {
      if (!isRecord(entry) || typeof entry["id"] !== "string") continue;
      const cites = Array.isArray(entry["cites"]) ? (entry["cites"] as unknown[]).filter((c): c is string => typeof c === "string") : [];
      criteria.push({ id: entry["id"], cites });
    }
    return criteria;
  }

  /**
   * Criterion ids of the spec a document's `fields.spec_ref` names (a task's `ac_scope` and a plan's
   * `task_criteria_map` cite the criteria of that spec, not of the document itself). Superseded criteria count
   * (BR-1494: an archived task's scope stays addressable). Resolved by id or slug only, never by searching specs
   * for a criterion id (ids are unique only within one spec, issue #496).
   *
   * @param specRef - `fields.spec_ref`; absent / non-string / empty = the document names no spec
   * @returns the ids, empty when no spec is named or the named document is not a spec. A `spec_ref` that names no
   *   document yields no ids; `refs-resolve` then reports the `spec_ref` entry itself, naming the spec, so the
   *   gap is a finding and never a silent pass.
   */
  private async governingSpecCriterionIds(specRef: unknown): Promise<Result<string[], LoreError>> {
    if (typeof specRef !== "string" || specRef === "") return ok([]);
    const specs = await this.store.findMany({ type: "spec" });
    if (!specs.ok) return specs;
    const spec = specs.value.find((candidate) => candidate.id === specRef || candidate.slug === specRef);
    if (spec === undefined) return ok([]);
    const criteria = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
    return ok(criteria.success ? criteria.data.map((criterion) => criterion.id) : []);
  }

  /** Ids a ref may name: the document's criteria, registered rule ids, and every document's slug and id. */
  private async knownRefTargets(criterionIds: readonly string[]): Promise<Result<Set<string>, LoreError>> {
    const registry = await this.store.listRuleRegistry();
    if (!registry.ok) return registry;
    const docs = await this.store.findMany({});
    if (!docs.ok) return docs;
    return ok(
      new Set<string>([
        ...criterionIds,
        ...registry.value.map((row) => row.id),
        ...docs.value.flatMap((doc) => [doc.slug, doc.id]),
      ]),
    );
  }
}
