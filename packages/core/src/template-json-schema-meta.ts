/**
 * The JSON Schema draft 2020-12 meta-schema, flattened into one self-contained document.
 *
 * Purpose: let `template-json-schema.ts` refuse a template whose `fields` is not a JSON Schema
 *   (bad type name, `minLength: "3"`, `required: "a"`, ...) at parse time, with no network at runtime.
 * Public surface: {@link JSON_SCHEMA_2020_12_META_SCHEMA}.
 * Invariants: pure data, no imports.
 * Side-effect class: pure.
 *
 * Provenance: the seven vocabulary meta-schemas published at https://json-schema.org/draft/2020-12/meta/
 * (core, applicator, unevaluated, validation, meta-data, format-annotation, content) merged by taking
 * the union of their `properties` and `$defs`. Two mechanical edits, and no others:
 *   1. `$dynamicRef: "#meta"` became `$ref: "#"` (the library supports `$recursiveRef`, not
 *      `$dynamicRef`; for validating a plain schema the two recurse identically).
 *   2. `$id`, `$schema`, `$vocabulary`, `$dynamicAnchor` and `$comment` were dropped from the
 *      vocabulary documents' own headers; the `$ref`s between vocabularies became local `#/$defs/...`.
 * Unknown keywords are NOT refused by this meta-schema (the specification treats them as
 * annotations); that is the behaviour templates inherit, see `template.test.ts`.
 */

/** The flattened draft 2020-12 meta-schema. */
export const JSON_SCHEMA_2020_12_META_SCHEMA: Readonly<Record<string, unknown>> = {
  type: ["object", "boolean"],
  properties: {
    $id: { $ref: "#/$defs/uriReferenceString", pattern: "^[^#]*#?$" },
    $schema: { $ref: "#/$defs/uriString" },
    $ref: { $ref: "#/$defs/uriReferenceString" },
    $anchor: { $ref: "#/$defs/anchorString" },
    $dynamicRef: { $ref: "#/$defs/uriReferenceString" },
    $dynamicAnchor: { $ref: "#/$defs/anchorString" },
    $vocabulary: { type: "object", propertyNames: { $ref: "#/$defs/uriString" }, additionalProperties: { type: "boolean" } },
    $comment: { type: "string" },
    $defs: { type: "object", additionalProperties: { $ref: "#" } },
    prefixItems: { $ref: "#/$defs/schemaArray" },
    items: { $ref: "#" },
    contains: { $ref: "#" },
    additionalProperties: { $ref: "#" },
    properties: { type: "object", additionalProperties: { $ref: "#" }, default: {} },
    patternProperties: { type: "object", additionalProperties: { $ref: "#" }, propertyNames: { format: "regex" }, default: {} },
    dependentSchemas: { type: "object", additionalProperties: { $ref: "#" }, default: {} },
    propertyNames: { $ref: "#" },
    if: { $ref: "#" },
    then: { $ref: "#" },
    else: { $ref: "#" },
    allOf: { $ref: "#/$defs/schemaArray" },
    anyOf: { $ref: "#/$defs/schemaArray" },
    oneOf: { $ref: "#/$defs/schemaArray" },
    not: { $ref: "#" },
    unevaluatedItems: { $ref: "#" },
    unevaluatedProperties: { $ref: "#" },
    type: {
      anyOf: [
        { $ref: "#/$defs/simpleTypes" },
        { type: "array", items: { $ref: "#/$defs/simpleTypes" }, minItems: 1, uniqueItems: true },
      ],
    },
    const: true,
    enum: { type: "array", items: true },
    multipleOf: { type: "number", exclusiveMinimum: 0 },
    maximum: { type: "number" },
    exclusiveMaximum: { type: "number" },
    minimum: { type: "number" },
    exclusiveMinimum: { type: "number" },
    maxLength: { $ref: "#/$defs/nonNegativeInteger" },
    minLength: { $ref: "#/$defs/nonNegativeIntegerDefault0" },
    pattern: { type: "string", format: "regex" },
    maxItems: { $ref: "#/$defs/nonNegativeInteger" },
    minItems: { $ref: "#/$defs/nonNegativeIntegerDefault0" },
    uniqueItems: { type: "boolean", default: false },
    maxContains: { $ref: "#/$defs/nonNegativeInteger" },
    minContains: { $ref: "#/$defs/nonNegativeInteger", default: 1 },
    maxProperties: { $ref: "#/$defs/nonNegativeInteger" },
    minProperties: { $ref: "#/$defs/nonNegativeIntegerDefault0" },
    required: { $ref: "#/$defs/stringArray" },
    dependentRequired: { type: "object", additionalProperties: { $ref: "#/$defs/stringArray" } },
    title: { type: "string" },
    description: { type: "string" },
    default: true,
    deprecated: { type: "boolean", default: false },
    readOnly: { type: "boolean", default: false },
    writeOnly: { type: "boolean", default: false },
    examples: { type: "array", items: true },
    format: { type: "string" },
    contentEncoding: { type: "string" },
    contentMediaType: { type: "string" },
    contentSchema: { $ref: "#" },
  },
  $defs: {
    anchorString: { type: "string", pattern: "^[A-Za-z_][-A-Za-z0-9._]*$" },
    uriString: { type: "string", format: "uri" },
    uriReferenceString: { type: "string", format: "uri-reference" },
    schemaArray: { type: "array", minItems: 1, items: { $ref: "#" } },
    nonNegativeInteger: { type: "integer", minimum: 0 },
    nonNegativeIntegerDefault0: { $ref: "#/$defs/nonNegativeInteger", default: 0 },
    simpleTypes: { enum: ["array", "boolean", "integer", "null", "number", "object", "string"] },
    stringArray: { type: "array", items: { type: "string" }, uniqueItems: true, default: [] },
  },
};
