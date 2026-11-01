/**
 * Runtime-neutral wiring of the template write path for unit-test corpora (spec-every-document-is-stored-as-structured-fields-validated-by, BR-1528).
 *
 * Purpose: arm a bare in-memory `CorpusService` with the template write path and the shipped templates, so a generator that
 *   creates structured documents works against it, and hand out a seeded `TemplateService` for a subject that only reads templates.
 *   Kept apart from `structured-docs.ts` because that file reaches the composition root (`bun:sqlite`), which a Node-run test file
 *   must not import; this file imports only services, the in-memory store and the shipped-seed reader.
 * Public surface: {@link wireStructuredCorpus}, {@link seededTemplateReader}, {@link fillTemplate}, {@link fillShippedTemplate}.
 * Invariants:
 *   - Seeds come from the repository's `assets/templates/`; a test using either function declares `// @reads assets/templates/**`.
 *   - A refused fixture write throws with the error; it never continues.
 * Side-effect class: IO (reads the shipped seeds; writes template documents into the corpus it is given).
 */

import { fileURLToPath } from "node:url";
import type { DimensionAnswer, JsonSchemaNode, LoreError, Result, Template } from "@lore/core";
import { readShippedTemplateSeeds } from "../../src/adapters/cli/template-seeds.js";
import { CorpusService } from "../../src/service/corpus-service.js";
import { GateEnforcer } from "../../src/service/gate-enforcer.js";
import { RecordLockService } from "../../src/service/record-lock-service.js";
import { TemplateSeedService } from "../../src/service/template-seed-service.js";
import { TemplateService } from "../../src/service/template-service.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import type { StoreInterface } from "../../src/store/store-interface.js";
import { actedStore } from "../live-invocation.js";

async function must<T>(result: Promise<Result<T, LoreError>>, what: string): Promise<T> {
  const done = await result;
  if (!done.ok) throw new Error(`${what}: ${JSON.stringify(done.error)}`);
  return done.value;
}

/**
 * Arm a bare `CorpusService` (the unit-test construction over an in-memory store) with the template write path and seed
 * the shipped templates into it.
 *
 * @param corpus - the service under test
 * @param store - the store it was built over (the template reader reads the same store)
 * @param options - `requireCreate` arms the create switch (default off)
 * @throws when a seed is invalid or a write is refused
 */
export async function wireStructuredCorpus(corpus: CorpusService, store: StoreInterface, options: { requireCreate?: boolean } = {}): Promise<void> {
  const templates = new TemplateService(store);
  corpus.setStructuredWrite({ templates, requireStructuredCreate: options.requireCreate === true });
  const seeds = readShippedTemplateSeeds(fileURLToPath(new URL("../../../../assets", import.meta.url)));
  if (!seeds.ok) throw new Error(`wireStructuredCorpus: ${JSON.stringify(seeds.error)}`);
  await must(new TemplateSeedService(templates, corpus).apply(seeds.value), "seed templates");
}

/**
 * A template reader over a throwaway in-memory corpus that holds every shipped template, for a test whose subject takes a
 * `TemplateService` (or a `CorpusService.templateReader`) but writes no document of its own.
 *
 * @returns the seeded reader
 * @throws when seeding fails
 */
export async function seededTemplateReader(): Promise<TemplateService> {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  await wireStructuredCorpus(corpus, store);
  const reader = corpus.templateReader;
  if (reader === undefined) throw new Error("seededTemplateReader: the corpus has no template reader after wiring");
  return reader;
}

/**
 * Valid fields and dimensions for a (type, kind), filled from the SHIPPED seed (no corpus needed): for a test that writes a
 * fields file or a front matter by hand and drives a CLI.
 *
 * @param docType - the template's `doc_type`
 * @param kind - the template's kind, when the type has kinds
 * @returns `{fields, dimensions}`
 * @throws when the seeds are unreadable or none matches
 */
export function fillShippedTemplate(docType: string, kind?: string, refTarget?: string): { fields: Record<string, unknown>; dimensions: DimensionAnswer[] } {
  const seeds = readShippedTemplateSeeds(fileURLToPath(new URL("../../../../assets", import.meta.url)));
  if (!seeds.ok) throw new Error(`fillShippedTemplate: ${JSON.stringify(seeds.error)}`);
  const seed = seeds.value.find((candidate) => candidate.template.doc_type === docType && candidate.template.kind === kind);
  if (seed === undefined) throw new Error(`fillShippedTemplate: no shipped seed for ${docType}${kind === undefined ? "" : `/${kind}`}`);
  return fillTemplate(seed.template, kind, refTarget);
}

function isNode(value: unknown): value is JsonSchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fillNode(schema: JsonSchemaNode | undefined): unknown {
  if (schema === undefined) return "sample";
  if (Array.isArray(schema["enum"]) && schema["enum"].length > 0) return schema["enum"][0];
  if (schema["const"] !== undefined) return schema["const"];
  const type = Array.isArray(schema["type"]) ? schema["type"][0] : schema["type"];
  switch (type) {
    case "object":
      return fillObject(schema);
    case "array": {
      const minItems = typeof schema["minItems"] === "number" ? schema["minItems"] : 0;
      const items = isNode(schema["items"]) ? schema["items"] : undefined;
      return Array.from({ length: minItems }, () => fillNode(items));
    }
    case "integer":
    case "number":
      return typeof schema["minimum"] === "number" ? schema["minimum"] : 1;
    case "boolean":
      return false;
    default: {
      const max = typeof schema["maxLength"] === "number" ? schema["maxLength"] : undefined;
      return max !== undefined ? "sample".slice(0, max) : "sample";
    }
  }
}

function fillObject(schema: JsonSchemaNode): Record<string, unknown> {
  const required = new Set(Array.isArray(schema["required"]) ? (schema["required"] as unknown[]).filter((name): name is string => typeof name === "string") : []);
  const properties = isNode(schema["properties"]) ? (schema["properties"] as Record<string, unknown>) : {};
  const filled: Record<string, unknown> = {};
  for (const [name, node] of Object.entries(properties)) {
    if (required.has(name)) filled[name] = fillNode(isNode(node) ? node : undefined);
  }
  return filled;
}

/**
 * Valid fields and dimension answers for a template: the minimum a create accepts. Values are minimal and deterministic:
 * first enum member, `"sample"` strings cut to `maxLength`, the schema's `minimum` (or 1) for numbers, required properties
 * only, `minItems` items per array; every applicable dimension is answered `handled`, with one ref where it needs refs.
 *
 * @param template - an approved template
 * @param kind - the document kind, narrowing which dimensions apply
 * @returns `{fields, dimensions}`
 */
export function fillTemplate(template: Template, kind?: string, refTarget = "AC-FIXTURE-1"): { fields: Record<string, unknown>; dimensions: DimensionAnswer[] } {
  const dimensions = template.dimensions
    .filter((dimension) => dimension.applies_to === undefined || kind === undefined || dimension.applies_to.includes(kind))
    .map((dimension): DimensionAnswer => ({
      id: dimension.id,
      status: "handled",
      answer: `Answered for the ${dimension.id} dimension in a test fixture.`,
      refs: dimension.needs_refs === true ? [refTarget] : [],
    }));
  return { fields: fillObject(template.fields as JsonSchemaNode), dimensions };
}
