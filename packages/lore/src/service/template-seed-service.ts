/**
 * TemplateSeedService: create the corpus templates a corpus lacks, from the shipped seeds, as approved documents.
 *
 * Purpose: BR-1528 — templates are versioned corpus documents and the shipped assets carry defaults only as seeds.
 *   `lore migrate templates` runs this; it NEVER overwrites an approved corpus template.
 * Public surface: {@link TemplateSeedService} (`preview`, `apply`), {@link TemplateSeed}, {@link seedSlugOf}.
 * Invariants:
 *   - A slot (doc_type, kind) that already resolves to an approved corpus template is skipped, whatever its content;
 *     a seed never revises, replaces or re-versions it.
 *   - A slot with no approved template but whose seed slug is already held (a draft or deprecated template) is
 *     reported `blocked` and untouched; seeding never edits an existing document.
 *   - A seeded template is created at version 1 by the same `CorpusService` write path as any template and then
 *     approved through the same approval path; it carries no review judgment (shipped defaults, template type is not
 *     judgment-required).
 *   - Idempotent: a second `apply` finds every slot filled and writes nothing.
 * Side-effect class: IO (document writes through the injected ports; none in `preview`).
 */

import { ok, validationError, type DocRecord, type LoreError, type Result, type Template } from "@lore/core";
import type { TemplateService } from "./template-service.js";

/** One shipped seed: the file it came from and its parsed template. */
export interface TemplateSeed {
  readonly file: string;
  readonly template: Template;
}

/** What happened (or would happen) to one seed's slot. */
export type SeedOutcome =
  | { readonly slot: string; readonly action: "seeded"; readonly slug: string }
  | { readonly slot: string; readonly action: "present"; readonly ref: string }
  | { readonly slot: string; readonly action: "blocked"; readonly slug: string; readonly reason: string };

/** The write ports this service needs of the corpus (structural, so no service imports another). */
export interface TemplateSeedWriter {
  create(input: { type: "template"; title: string; slug: string; extra: Record<string, unknown> }, opts?: { by?: string }): Promise<Result<DocRecord, LoreError>>;
  set(id: string, patch: { status: "approved" }, opts?: { by?: string; expectedVersion?: number }): Promise<Result<unknown, LoreError>>;
  get(idOrSlug: string): Promise<Result<{ doc: DocRecord }, LoreError>>;
}

/** Slot label: `spec/tech`, `task`. */
function slotOf(template: Template): string {
  return template.kind === undefined ? template.doc_type : `${template.doc_type}/${template.kind}`;
}

/**
 * The slug a seed is created under, stable so a re-run recognises its own earlier output.
 *
 * @param template - the seed's template
 * @returns e.g. `spec-tech-template`, `task-template`
 */
export function seedSlugOf(template: Template): string {
  return `${template.doc_type}${template.kind === undefined ? "" : `-${template.kind}`}-template`;
}

export class TemplateSeedService {
  constructor(
    private readonly templates: TemplateService,
    private readonly writer: TemplateSeedWriter,
  ) {}

  /**
   * What `apply` would do, writing nothing.
   *
   * @param seeds - the shipped seeds
   * @returns one outcome per seed, in seed order
   */
  async preview(seeds: readonly TemplateSeed[]): Promise<Result<SeedOutcome[], LoreError>> {
    const outcomes: SeedOutcome[] = [];
    for (const seed of seeds) {
      const outcome = await this.classify(seed);
      if (!outcome.ok) return outcome;
      outcomes.push(outcome.value);
    }
    return ok(outcomes);
  }

  /**
   * Seed every slot that has no approved template.
   *
   * @param seeds - the shipped seeds
   * @param opts - the writing actor
   * @returns one outcome per seed; the first write failure aborts and is returned (earlier seeds stay written, a
   *   re-run continues because seeding is idempotent)
   */
  async apply(seeds: readonly TemplateSeed[], opts: { by?: string } = {}): Promise<Result<SeedOutcome[], LoreError>> {
    const outcomes: SeedOutcome[] = [];
    for (const seed of seeds) {
      const classified = await this.classify(seed);
      if (!classified.ok) return classified;
      if (classified.value.action !== "seeded") {
        outcomes.push(classified.value);
        continue;
      }
      const slug = classified.value.slug;
      const created = await this.writer.create(
        { type: "template", title: titleOf(seed.template), slug, extra: { template: seed.template } },
        opts.by === undefined ? undefined : { by: opts.by },
      );
      if (!created.ok) {
        // reason: a taken slug between classify and create is the same "blocked" fact, reported not thrown.
        if (created.error.code === "DUPLICATE_SLUG") {
          outcomes.push({ slot: slotOf(seed.template), action: "blocked", slug, reason: "its slug was taken while seeding" });
          continue;
        }
        return created;
      }
      const approved = await this.writer.set(created.value.id, { status: "approved" }, opts.by === undefined ? undefined : { by: opts.by });
      if (!approved.ok) return approved;
      outcomes.push(classified.value);
    }
    return ok(outcomes);
  }

  private async classify(seed: TemplateSeed): Promise<Result<SeedOutcome, LoreError>> {
    const slot = slotOf(seed.template);
    const resolved = await this.templates.resolveTemplate(seed.template.doc_type, seed.template.kind);
    if (resolved.ok) return ok({ slot, action: "present", ref: resolved.value.ref });
    // reason: "no approved template" is the one expected refusal (VALIDATION_ERROR naming the slot); any other failure
    // (a store error) must surface, never read as "missing".
    if (resolved.error.code !== "VALIDATION_ERROR") return resolved;
    const slug = seedSlugOf(seed.template);
    const held = await this.holderOf(slug);
    if (!held.ok) return held;
    if (held.value !== undefined) {
      return ok({ slot, action: "blocked", slug, reason: `a ${held.value.type} document already holds the slug (status ${held.value.status}); it is not edited` });
    }
    return ok({ slot, action: "seeded", slug });
  }

  private async holderOf(slug: string): Promise<Result<Pick<DocRecord, "type" | "status"> | undefined, LoreError>> {
    const found = await this.writer.get(slug);
    if (found.ok) return ok(found.value.doc);
    if (found.error.code === "DOC_NOT_FOUND" || found.error.code === "SLUG_NOT_FOUND") return ok(undefined);
    return found;
  }
}

function titleOf(template: Template): string {
  const label = template.kind === undefined ? template.doc_type : `${template.doc_type} ${template.kind}`;
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} template`;
}

/** Refusal for a seed file that does not parse; used by the adapter that reads the shipped directory. */
export function seedFileError(file: string, problem: string): LoreError {
  return validationError("template-seed", `shipped template seed ${file} is invalid: ${problem}`, file);
}
