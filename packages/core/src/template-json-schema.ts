/**
 * JSON Schema validation of a templated document's `extra.fields`, via `@cfworker/json-schema`.
 *
 * Purpose: adapt the library's output-unit list to the flat `{path, problem}` list the template
 *   layer reports, and hold the small schema/field-path helpers the template code needs.
 * Public surface: {@link checkJsonSchemaUsable}, {@link validateAgainstJsonSchema},
 *   {@link schemaAtFieldPath}, {@link readFieldPath}, {@link JsonSchemaNode}.
 * Invariants:
 *   - Pure, no IO, no Node builtins, no code generation (`@cfworker/json-schema` interprets the
 *     schema; it has no dependencies), so this stays inside the browser-safe `@lore/core` barrel.
 *   - Every violation is returned, not just the first (`shortCircuit` is off).
 * Side-effect class: pure.
 *
 * reason: `@cfworker/json-schema@4.1.1` is pinned (not the 4.1.3/4.1.4 published 2026-10-30) so the
 * dependency is a release that has been public for over a year; see the T1 task report.
 */

import { Validator } from "@cfworker/json-schema";

/** A JSON Schema node. `x-*` keywords are annotations the check library reads (see `template.ts`). */
export type JsonSchemaNode = {
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly items?: JsonSchemaNode;
  readonly [keyword: string]: unknown;
};

/** One violation: `path` is a dotted field path with `[i]` for array items; `(root)` for the whole value. */
export interface JsonSchemaViolation {
  readonly path: string;
  readonly problem: string;
}

const VALIDATOR_DRAFT = "2020-12";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check a schema can be used: an object the library accepts (a bad `$ref` makes it throw).
 *
 * @param schema - the candidate JSON Schema node
 * @returns one message per problem; empty when usable
 */
export function checkJsonSchemaUsable(schema: unknown): string[] {
  if (!isPlainObject(schema)) return ["fields: a JSON Schema node must be an object"];
  try {
    new Validator(schema, VALIDATOR_DRAFT, false);
  } catch (cause) {
    return [`fields: not a usable JSON Schema (${cause instanceof Error ? cause.message : String(cause)})`];
  }
  return [];
}

/** `#/a/b/0` -> `a.b[0]`; `#` -> "". JSON Pointer escapes are decoded. */
function pointerToFieldPath(pointer: string): string {
  const segments = pointer.replace(/^#\/?/, "").split("/").filter((segment) => segment !== "");
  return segments.reduce((path, raw) => {
    const segment = decodeURIComponent(raw).replace(/~1/g, "/").replace(/~0/g, "~");
    if (/^\d+$/.test(segment)) return `${path}[${segment}]`;
    return path === "" ? segment : `${path}.${segment}`;
  }, "");
}

/** Keywords whose output unit only restates "a child failed"; the child carries the real reason. */
const WRAPPER_KEYWORDS = new Set(["properties", "items", "additionalProperties"]);
const REQUIRED_PATTERN = /^Instance does not have required property "(.*)"\.$/;

/**
 * Validate a value against a template's `fields` schema.
 *
 * @param schema - JSON Schema (draft 2020-12 semantics)
 * @param value - the document's `extra.fields` (or any sub-value)
 * @returns every violation, as the library reports them minus its wrapper units
 */
export function validateAgainstJsonSchema(schema: JsonSchemaNode, value: unknown): JsonSchemaViolation[] {
  let result;
  try {
    result = new Validator(schema as Record<string, unknown>, VALIDATOR_DRAFT, false).validate(value);
  } catch (cause) {
    // reason: the library throws (not reports) on e.g. an unresolvable $ref met during traversal;
    // a template defect must surface as a problem, never crash the write path.
    return [{ path: "(schema)", problem: `the template's fields schema is unusable: ${cause instanceof Error ? cause.message : String(cause)}` }];
  }
  if (result.valid) return [];
  const real = result.errors.filter((unit) => !WRAPPER_KEYWORDS.has(unit.keyword));
  const concrete = real.filter((unit) => unit.keyword !== "false");
  const violations: JsonSchemaViolation[] = [];
  for (const unit of real) {
    // reason: when a declared property FAILS, the library also reports it as an unevaluated
    // "additional" property (keyword `false`). That is noise: keep a `false` unit only when no other
    // violation sits at or under its location, i.e. the property really is undeclared.
    if (unit.keyword === "false" && concrete.some((other) => other.instanceLocation === unit.instanceLocation || other.instanceLocation.startsWith(`${unit.instanceLocation}/`))) {
      continue;
    }
    const base = pointerToFieldPath(unit.instanceLocation);
    const required = REQUIRED_PATTERN.exec(unit.error);
    if (required !== null) {
      const name = required[1] ?? "";
      violations.push({ path: base === "" ? name : `${base}.${name}`, problem: "is required" });
    } else if (unit.keyword === "false") {
      violations.push({ path: base === "" ? "(root)" : base, problem: "is not an allowed field" });
    } else {
      violations.push({ path: base === "" ? "(root)" : base, problem: unit.error });
    }
  }
  return violations;
}

/**
 * Resolve the sub-schema at a dotted field path (`a.b`), walking `properties` only.
 *
 * @returns the node, or undefined when any segment is not declared
 */
export function schemaAtFieldPath(schema: JsonSchemaNode, fieldPath: string): JsonSchemaNode | undefined {
  let node: JsonSchemaNode | undefined = schema;
  for (const segment of fieldPath.split(".")) {
    node = node?.properties?.[segment];
    if (node === undefined) return undefined;
  }
  return node;
}

/** Read the value at a dotted field path from a fields object; undefined when absent. */
export function readFieldPath(fields: unknown, fieldPath: string): unknown {
  let cursor: unknown = fields;
  for (const segment of fieldPath.split(".")) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}
