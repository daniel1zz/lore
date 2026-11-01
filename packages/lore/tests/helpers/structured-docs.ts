/**
 * Test helpers for creating structured documents (spec-every-document-is-stored-as-structured-fields-validated-by, BR-1528).
 *
 * Purpose: a seeded-corpus helper and `createStructured`, which builds VALID fields and dimension answers from the
 *   approved seed template of a (type, kind) so a test creates a document without hand-writing its fields; and
 *   `requireCreateConfig`, the config that turns `workflow.structured_documents.require_create` ON, so a test proves a
 *   generator no longer depends on the switch being off.
 * Public surface: {@link seedTemplates}, {@link seedTemplatesWith}, {@link seedTemplatesInApp}, {@link requireCreateConfig}, {@link armRequireCreate}, {@link fillTemplate},
 *   {@link createStructured}.
 * Invariants:
 *   - Fill values are minimal and deterministic: first enum member, `"sample"` strings cut to `maxLength`, the schema's
 *     `minimum` (or 1) for numbers, required properties only, `minItems` items per array. Every dimension is answered
 *     `handled` with a one-line answer and, where the template needs refs, one ref.
 *   - A refused fixture throws with the error, never continues (the `must` convention of `structured-corpus.ts`).
 *   - Seeding goes through `lore migrate templates --apply` (the shipped seeds, the same path production uses).
 * Side-effect class: IO (in-process CLI runs, one corpus database through the App it is given).
 */

import { parseConfig, type CreateDocInput, type DimensionAnswer, type DocRecord, type JsonSchemaNode, type LoreConfig, type Template } from "@lore/core";
import { fileURLToPath } from "node:url";
import type { App } from "../../src/app.js";
import { readShippedTemplateSeeds } from "../../src/adapters/cli/template-seeds.js";
import { TemplateSeedService } from "../../src/service/template-seed-service.js";
import { must, type StructuredRig } from "./structured-corpus.js";
import { patchLoreConfig } from "./patch-lore-config.js";

/**
 * Seed every shipped template as an approved corpus template (`lore migrate templates --apply`).
 *
 * @param rig - the structured rig
 * @throws when the command does not exit 0
 */
export async function seedTemplates(rig: StructuredRig): Promise<void> {
  await seedTemplatesWith(rig.lore);
}

/**
 * Seed every shipped template through any in-corpus `lore` runner (a test with its own corpus and runner uses this).
 *
 * @param lore - runs one `lore` command in the corpus
 * @throws when the command does not exit 0
 */
export async function seedTemplatesWith(lore: (args: string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>): Promise<void> {
  const seeded = await lore(["migrate", "templates", "--apply"]);
  if (seeded.exitCode !== 0) throw new Error(`lore migrate templates --apply failed (${String(seeded.exitCode)}): ${seeded.stderr}${seeded.stdout}`);
}

/**
 * Seed every shipped template into an App's corpus directly (a test that builds its own `createApp` and has no CLI runner).
 * The seeds are read from the repository's `assets/templates/`, so a test using it declares `// @reads assets/templates/**`.
 *
 * @param app - an App whose writes are made by a known party (`createLiveApp`, or `createApp(..., liveWriteContext())`)
 * @throws when a seed is invalid or a write is refused
 */
export async function seedTemplatesInApp(app: App): Promise<void> {
  if (app.templateService === undefined) throw new Error("seedTemplatesInApp: the App has no template service");
  const seeds = readShippedTemplateSeeds(fileURLToPath(new URL("../../../../assets", import.meta.url)));
  if (!seeds.ok) throw new Error(`seedTemplatesInApp: ${JSON.stringify(seeds.error)}`);
  await must(new TemplateSeedService(app.templateService, app.corpusService).apply(seeds.value), "seed templates");
}

/**
 * A config with the create switch ON (`workflow.structured_documents.require_create: true`).
 *
 * @returns the parsed config, for `rig.withApp(body, config)`
 * @throws when the config does not parse
 */
export function requireCreateConfig(): LoreConfig {
  const parsed = parseConfig({ project: { name: "structured-test", author: "owner" }, workflow: { structured_documents: { require_create: true } } });
  if (!parsed.ok) throw new Error(`requireCreateConfig: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

/**
 * Turn the create switch ON for the CLI as well: patch the rig's `.lore/config.yaml` through the one config writer.
 *
 * @param rig - the structured rig
 */
export function armRequireCreate(rig: StructuredRig): void {
  patchLoreConfig(rig.dir, { workflow: { structured_documents: { require_create: true } } });
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
 * Valid fields and dimension answers for a template: the minimum a create accepts.
 *
 * @param template - an approved template
 * @param kind - the document kind, narrowing which dimensions apply
 * @returns `{fields, dimensions}`
 */
export function fillTemplate(template: Template, kind?: string): { fields: Record<string, unknown>; dimensions: DimensionAnswer[] } {
  const dimensions = template.dimensions
    .filter((dimension) => dimension.applies_to === undefined || kind === undefined || dimension.applies_to.includes(kind))
    .map((dimension): DimensionAnswer => ({
      id: dimension.id,
      status: "handled",
      answer: `Answered for the ${dimension.id} dimension in a test fixture.`,
      refs: dimension.needs_refs === true ? ["AC-FIXTURE-1"] : [],
    }));
  return { fields: fillObject(template.fields as JsonSchemaNode), dimensions };
}

/** What {@link createStructured} takes: a create input without a body, plus optional overrides of the filled content. */
export interface CreateStructuredInput extends Omit<CreateDocInput, "content"> {
  /** Merged OVER the filled fields (top-level keys replace). */
  readonly fields?: Record<string, unknown>;
  /** Replaces the filled dimension answers when given. */
  readonly dimensions?: DimensionAnswer[];
}

/**
 * Create a document structured: resolve the approved template of its type and kind, fill it, apply the overrides, create.
 *
 * @param app - an App over a seeded corpus (see {@link seedTemplates})
 * @param input - the create input (type, title, parent, extra ...) with optional `fields` / `dimensions` overrides
 * @returns the created document
 * @throws when the template is missing or the create is refused (the message carries the error)
 */
export async function createStructured(app: App, input: CreateStructuredInput): Promise<DocRecord> {
  if (app.templateService === undefined) throw new Error("createStructured: the App has no template service");
  const { fields: fieldOverrides, dimensions: dimensionOverrides, ...rest } = input;
  const extra = { ...(rest.extra ?? {}) } as Record<string, unknown>;
  const kind = rest.type === "spec" ? (extra["spec_kind"] as string | undefined) ?? "feature" : rest.type === "knowledge" ? (extra["sub_type"] as string | undefined) : rest.type === "baseline" ? (extra["node"] as string | undefined) : undefined;
  const resolved = await must(app.templateService.resolveTemplate(rest.type, kind), `resolve template ${rest.type}${kind === undefined ? "" : `/${kind}`}`);
  const filled = fillTemplate(resolved.template, kind);
  const created = await must(
    app.corpusService.create({
      ...rest,
      extra: { ...extra, fields: { ...filled.fields, ...(fieldOverrides ?? {}) }, dimensions: dimensionOverrides ?? filled.dimensions },
    } as CreateDocInput),
    `create ${rest.type} ${rest.title}`,
  );
  return created as DocRecord;
}
