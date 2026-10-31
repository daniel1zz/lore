/**
 * A deliberately small JSON Schema validator for template `fields` schemas.
 *
 * Purpose: check a document's `extra.fields` against its template's JSON Schema, and check
 * that a template's schema itself only uses keywords this validator understands.
 * Public surface: {@link checkJsonSchemaSupported}, {@link validateAgainstJsonSchema},
 *   {@link schemaAtFieldPath}, {@link readFieldPath}, {@link JsonSchemaNode}.
 * Invariants:
 *   - Pure, no IO, no Node builtins, no `eval` / `new Function` (browser-safe, CSP-safe).
 *   - A keyword outside {@link SUPPORTED_KEYWORDS} is REFUSED when the template is created
 *     (never silently ignored), so a template author can not believe a constraint is enforced
 *     when it is not.
 *   - Every violation is returned, not just the first.
 * Side-effect class: pure.
 *
 * reason: no direct JSON Schema dependency exists in the repo (`ajv@6` is only a transitive
 * dependency of eslint; ajv 8 compiles schemas with `new Function`). A closed keyword subset
 * that fails loud on anything else is the smaller, deterministic option — see
 * spec-every-document-is-stored-as-structured-fields-validated-by, "Templates themselves".
 */

/** A JSON Schema node as the subset understands it. Unknown keywords are refused, see {@link checkJsonSchemaSupported}. */
export type JsonSchemaNode = {
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchemaNode;
  readonly items?: JsonSchemaNode;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  readonly enum?: readonly unknown[];
  readonly const?: unknown;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly [annotation: string]: unknown;
};

/** One violation: `path` is a dotted field path with `[i]` for array items; `(root)` for the whole value. */
export interface JsonSchemaViolation {
  readonly path: string;
  readonly problem: string;
}

const JSON_SCHEMA_TYPES = ["object", "array", "string", "number", "integer", "boolean", "null"] as const;

/** Keywords that constrain a value. Anything else that is not an annotation is refused. */
const SUPPORTED_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "maxItems",
  "uniqueItems",
  "enum",
  "const",
  "minLength",
  "maxLength",
  "pattern",
  "minimum",
  "maximum",
  "anyOf",
]);

/** Annotation-only keywords: carried, never enforced. `x-*` markers (check library conventions) are annotations too. */
const ANNOTATION_KEYWORDS = new Set(["title", "description", "default", "examples", "$comment"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function joinPath(base: string, key: string): string {
  return base === "" ? key : `${base}.${key}`;
}

/**
 * Check that a schema is well-formed and only uses supported keywords.
 *
 * @param schema - the candidate JSON Schema node
 * @param path - schema location for messages (callers pass "" at the root)
 * @returns one message per problem; empty when the schema is usable
 */
export function checkJsonSchemaSupported(schema: unknown, path = ""): string[] {
  const where = path === "" ? "fields" : `fields.${path}`;
  if (!isPlainObject(schema)) return [`${where}: a JSON Schema node must be an object`];
  const problems: string[] = [];
  for (const keyword of Object.keys(schema)) {
    if (SUPPORTED_KEYWORDS.has(keyword) || ANNOTATION_KEYWORDS.has(keyword) || keyword.startsWith("x-")) continue;
    problems.push(`${where}: unsupported JSON Schema keyword "${keyword}"`);
  }
  const type = schema.type;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    for (const entry of types) {
      if (!(JSON_SCHEMA_TYPES as readonly unknown[]).includes(entry)) problems.push(`${where}: unknown type ${JSON.stringify(entry)}`);
    }
  }
  if (schema.properties !== undefined) {
    if (!isPlainObject(schema.properties)) problems.push(`${where}: properties must be an object`);
    else {
      for (const [key, child] of Object.entries(schema.properties)) {
        problems.push(...checkJsonSchemaSupported(child, joinPath(path, key)));
      }
    }
  }
  if (schema.required !== undefined && !(Array.isArray(schema.required) && schema.required.every((r) => typeof r === "string"))) {
    problems.push(`${where}: required must be an array of strings`);
  }
  if (isPlainObject(schema.additionalProperties)) {
    problems.push(...checkJsonSchemaSupported(schema.additionalProperties, joinPath(path, "<additional>")));
  } else if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    problems.push(`${where}: additionalProperties must be a boolean or a schema`);
  }
  if (schema.items !== undefined) problems.push(...checkJsonSchemaSupported(schema.items, `${path}[]`));
  if (schema.anyOf !== undefined) {
    if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) problems.push(`${where}: anyOf must be a non-empty array`);
    else schema.anyOf.forEach((branch, index) => problems.push(...checkJsonSchemaSupported(branch, `${path}<anyOf ${index}>`)));
  }
  if (schema.enum !== undefined && !(Array.isArray(schema.enum) && schema.enum.length > 0)) {
    problems.push(`${where}: enum must be a non-empty array`);
  }
  for (const keyword of ["minItems", "maxItems", "minLength", "maxLength"] as const) {
    const bound = schema[keyword];
    if (bound !== undefined && !(typeof bound === "number" && Number.isInteger(bound) && bound >= 0)) {
      problems.push(`${where}: ${keyword} must be a non-negative integer`);
    }
  }
  for (const keyword of ["minimum", "maximum"] as const) {
    if (schema[keyword] !== undefined && typeof schema[keyword] !== "number") problems.push(`${where}: ${keyword} must be a number`);
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== "string") problems.push(`${where}: pattern must be a string`);
    else {
      try {
        new RegExp(schema.pattern);
      } catch {
        problems.push(`${where}: pattern is not a valid regular expression`);
      }
    }
  }
  return problems;
}

function typeMatches(type: string, value: unknown): boolean {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateNode(schema: JsonSchemaNode, value: unknown, path: string, out: JsonSchemaViolation[]): void {
  const here = path === "" ? "(root)" : path;
  if (schema.type !== undefined) {
    const types = typeof schema.type === "string" ? [schema.type] : schema.type;
    if (!types.some((type) => typeMatches(type, value))) {
      out.push({ path: here, problem: `expected ${types.join(" or ")}, got ${describeType(value)}` });
      return;
    }
  }
  if (schema.enum !== undefined && !schema.enum.some((member) => deepEqual(member, value))) {
    out.push({ path: here, problem: `must be one of ${schema.enum.map((member) => JSON.stringify(member)).join(", ")}` });
  }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) {
    out.push({ path: here, problem: `must equal ${JSON.stringify(schema.const)}` });
  }
  if (schema.anyOf !== undefined) {
    const matches = schema.anyOf.some((branch) => {
      const branchOut: JsonSchemaViolation[] = [];
      validateNode(branch, value, path, branchOut);
      return branchOut.length === 0;
    });
    if (!matches) out.push({ path: here, problem: "matches none of the allowed alternatives" });
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push({ path: here, problem: `must be at least ${schema.minLength} characters` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) out.push({ path: here, problem: `must be at most ${schema.maxLength} characters` });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) out.push({ path: here, problem: `must match pattern ${schema.pattern}` });
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) out.push({ path: here, problem: `must be >= ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) out.push({ path: here, problem: `must be <= ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push({ path: here, problem: `needs at least ${schema.minItems} item(s), has ${value.length}` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push({ path: here, problem: `allows at most ${schema.maxItems} item(s), has ${value.length}` });
    if (schema.uniqueItems === true) {
      const seen = new Set<string>();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) out.push({ path: here, problem: "items must be unique" });
        seen.add(key);
      }
    }
    if (schema.items !== undefined) value.forEach((item, index) => validateNode(schema.items as JsonSchemaNode, item, `${path}[${index}]`, out));
  }
  if (isPlainObject(value)) {
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) out.push({ path: joinPath(path, key), problem: "is required" });
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (childSchema !== undefined) validateNode(childSchema, child, joinPath(path, key), out);
      else if (schema.additionalProperties === false) out.push({ path: joinPath(path, key), problem: "is not an allowed field" });
      else if (isPlainObject(schema.additionalProperties)) validateNode(schema.additionalProperties as JsonSchemaNode, child, joinPath(path, key), out);
    }
  }
}

/**
 * Validate a value against a schema that already passed {@link checkJsonSchemaSupported}.
 *
 * @param schema - supported JSON Schema node
 * @param value - the document's `extra.fields` (or any sub-value)
 * @returns every violation in traversal order (schema property order is irrelevant: value keys drive it)
 */
export function validateAgainstJsonSchema(schema: JsonSchemaNode, value: unknown): JsonSchemaViolation[] {
  const out: JsonSchemaViolation[] = [];
  validateNode(schema, value, "", out);
  return out;
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
