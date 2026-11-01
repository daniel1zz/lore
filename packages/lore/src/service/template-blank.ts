/**
 * Fill-in skeletons for a template: what `lore template show <type> --blank` prints.
 *
 * Purpose: turn a template into a YAML skeleton an author fills in: every required field with a type-appropriate
 *   empty value, and one `{id, status, answer, refs}` entry per applicable dimension, question as a comment.
 * Public surface: {@link blankFieldValue}, {@link blankFields}, {@link blankDimensions}, {@link renderBlankYaml}.
 * Invariants:
 *   - Only REQUIRED properties are emitted (recursively); optional ones are left for the author.
 *   - A skeleton is a starting point, never valid by itself: empty strings fail `minLength`, `answer` is empty.
 *   - Deterministic: property order is the schema's, dimension order is the template's.
 * Side-effect class: pure.
 */

import { stringify } from "yaml";
import type { JsonSchemaNode, Template } from "@lore/core";

function isNode(value: unknown): value is JsonSchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The empty value for one JSON Schema node: first `enum` member, `const`, `""`, `0`, `false`, `[]` (one blank item when
 * `minItems` > 0) or an object with its required properties.
 *
 * @param schema - a node of the template's `fields` schema
 * @returns a JSON-compatible value
 */
export function blankFieldValue(schema: JsonSchemaNode | undefined): unknown {
  if (schema === undefined) return "";
  if (Array.isArray(schema["enum"]) && schema["enum"].length > 0) return schema["enum"][0];
  if (schema["const"] !== undefined) return schema["const"];
  const type = Array.isArray(schema["type"]) ? schema["type"][0] : schema["type"];
  switch (type) {
    case "object":
      return blankFields(schema);
    case "array": {
      const minItems = typeof schema["minItems"] === "number" ? schema["minItems"] : 0;
      const items = isNode(schema["items"]) ? schema["items"] : undefined;
      return Array.from({ length: minItems }, () => blankFieldValue(items));
    }
    case "integer":
    case "number":
      return typeof schema["minimum"] === "number" ? schema["minimum"] : 0;
    case "boolean":
      return false;
    default:
      return "";
  }
}

/**
 * The required properties of an object schema, each with its empty value.
 *
 * @param schema - an object schema node (the template's `fields`, or a nested object)
 * @returns `{name: blank}` in the schema's property order
 */
export function blankFields(schema: JsonSchemaNode): Record<string, unknown> {
  const required = new Set(Array.isArray(schema["required"]) ? (schema["required"] as unknown[]).filter((r): r is string => typeof r === "string") : []);
  const properties = isNode(schema["properties"]) ? (schema["properties"] as Record<string, unknown>) : {};
  const blank: Record<string, unknown> = {};
  for (const [name, node] of Object.entries(properties)) {
    if (required.has(name)) blank[name] = blankFieldValue(isNode(node) ? node : undefined);
  }
  return blank;
}

/** Dimensions of the template that apply to `kind` (all of them when `kind` is undefined). */
export function applicableDimensions(template: Template, kind: string | undefined): Template["dimensions"] {
  return template.dimensions.filter((dimension) => dimension.applies_to === undefined || kind === undefined || dimension.applies_to.includes(kind));
}

/**
 * One blank answer per applicable dimension.
 *
 * @param template - the template
 * @param kind - the document kind, narrowing `applies_to`
 * @returns `[{id, status: "handled", answer: "", refs: []}]` in template order
 */
export function blankDimensions(template: Template, kind: string | undefined): { id: string; status: "handled"; answer: string; refs: string[] }[] {
  return applicableDimensions(template, kind).map((dimension) => ({ id: dimension.id, status: "handled" as const, answer: "", refs: [] }));
}

/**
 * The YAML skeleton: a `fields:` block of the required fields and a `dimensions:` block with each question as a comment
 * above its entry (and a note where refs are required).
 *
 * @param template - the template
 * @param kind - the document kind, narrowing `applies_to`
 * @returns YAML text ending in a newline
 */
export function renderBlankYaml(template: Template, kind: string | undefined): string {
  const lines: string[] = [];
  lines.push("fields:");
  const fields = blankFields(template.fields as JsonSchemaNode);
  if (Object.keys(fields).length === 0) lines.push("  {}");
  else lines.push(...stringify(fields).trimEnd().split("\n").map((line) => `  ${line}`));
  lines.push("dimensions:");
  for (const dimension of applicableDimensions(template, kind)) {
    lines.push(`  # ${dimension.question}`);
    lines.push("  # status: handled | na (an na answer says why); refs" + (dimension.needs_refs === true ? " are REQUIRED here" : " are optional") + ": AC ids, rule ids, field paths, doc slugs");
    const entry = stringify([{ id: dimension.id, status: "handled", answer: "", refs: [] }]).trimEnd().split("\n");
    lines.push(...entry.map((line) => `  ${line}`));
  }
  return `${lines.join("\n")}\n`;
}
