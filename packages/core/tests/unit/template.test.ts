/**
 * Tests for @lore/core template — meta-schema, dimension answers, validateDocument,
 * the cross-field check library and renderDocument. Pure, no IO.
 *
 * Six-dimension coverage:
 *   HAPPY:      a valid template parses; a valid document validates; each check passes a good case; render works
 *   NEGATIVE:   every meta-schema refusal; every validation problem kind; each check's violating case
 *   BOUNDARY:   all problems reported together; applies_to narrowing; empty optional fields omitted
 *   ERROR:      malformed dimensions input never throws
 *   STATE:      n/a — stateless pure functions
 *   REGRESSION: render is byte-identical regardless of object key insertion order
 */
import { describe, expect, it } from "vitest";
import {
  CROSS_FIELD_CHECK_IDS,
  parseTemplate,
  renderDocument,
  runCrossFieldChecks,
  validateDocument,
  type CrossFieldCheckPorts,
  type DocumentView,
  type JsonSchemaNode,
  type Template,
  type TemplateProblem,
} from "../../src/index.js";

function baseTemplate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    doc_type: "spec",
    kind: "tech",
    version: 1,
    fields: {
      type: "object",
      required: ["summary"],
      additionalProperties: false,
      properties: {
        summary: { type: "string", minLength: 3, title: "Summary" },
        notes: { type: "string" },
        tags: { type: "array", items: { type: "string" }, minItems: 1 },
        nested: { type: "object", properties: { depth: { type: "integer", minimum: 1 } } },
      },
    },
    dimensions: [
      { id: "inputs", question: "What are the inputs?" },
      { id: "traced", question: "Which criteria trace it?", needs_refs: true },
      { id: "tech-only", question: "Which tech trade-offs?", applies_to: ["tech"] },
    ],
    checks: ["refs-resolve"],
    render: [
      { heading: "Summary", fields: ["summary"] },
      { heading: "Details", fields: ["notes", "tags"] },
    ],
    ...overrides,
  };
}

function mustParse(overrides: Record<string, unknown> = {}): Template {
  const parsed = parseTemplate(baseTemplate(overrides));
  if (!parsed.ok) throw new Error(`fixture template refused: ${JSON.stringify(parsed.error)}`);
  return parsed.value;
}

const goodDimensions = [
  { id: "inputs", status: "handled", answer: "Only the CLI flags.", refs: [] },
  { id: "traced", status: "handled", answer: "AC-1 covers it.", refs: ["AC-1"] },
  { id: "tech-only", status: "na", answer: "No trade-offs: a pure function.", refs: [] },
];

describe("template meta-schema", () => {
  it("accepts a valid template", () => {
    expect(parseTemplate(baseTemplate()).ok).toBe(true);
  });

  it("refuses an unknown check id", () => {
    const result = parseTemplate(baseTemplate({ checks: ["no-such-check"] }));
    expect(result.ok).toBe(false);
  });

  it("accepts every library check id", () => {
    expect(parseTemplate(baseTemplate({ checks: [...CROSS_FIELD_CHECK_IDS] })).ok).toBe(true);
  });

  it("refuses duplicate dimension ids, naming the id", () => {
    const result = parseTemplate(
      baseTemplate({ dimensions: [{ id: "a", question: "q" }, { id: "a", question: "q2" }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.some((issue) => issue.problem.includes('duplicate dimension id "a"'))).toBe(true);
  });

  it("refuses an empty dimension list", () => {
    expect(parseTemplate(baseTemplate({ dimensions: [] })).ok).toBe(false);
  });

  it("refuses a non-kebab dimension id", () => {
    expect(parseTemplate(baseTemplate({ dimensions: [{ id: "Not_Kebab", question: "q" }] })).ok).toBe(false);
  });

  it("refuses an empty dimension question", () => {
    expect(parseTemplate(baseTemplate({ dimensions: [{ id: "a", question: "  " }] })).ok).toBe(false);
  });

  it("refuses a render path that is not in fields", () => {
    const result = parseTemplate(baseTemplate({ render: [{ heading: "H", fields: ["ghost"] }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error[0]?.problem).toContain('render path "ghost"');
  });

  it("accepts a dotted render path into nested properties", () => {
    expect(parseTemplate(baseTemplate({ render: [{ heading: "H", fields: ["nested.depth"] }] })).ok).toBe(true);
  });

  it("refuses fields that are not an object schema", () => {
    expect(parseTemplate(baseTemplate({ fields: { type: "string" }, render: [{ heading: "H", fields: ["x"] }] })).ok).toBe(false);
  });

  it("accepts x-* annotation keywords and other standard JSON Schema keywords the library supports", () => {
    const fields = { type: "object", properties: { a: { type: "string", format: "email", "x-refusal-list": true } } };
    expect(parseTemplate(baseTemplate({ fields, render: [{ heading: "H", fields: ["a"] }] })).ok).toBe(true);
  });

  function fieldsIssues(fields: unknown): Array<{ path: string; problem: string }> {
    const result = parseTemplate(baseTemplate({ fields, render: [{ heading: "H", fields: ["a"] }] }));
    return result.ok ? [] : result.error;
  }

  it("refuses a bad type name, with a path under fields", () => {
    const issues = fieldsIssues({ type: "object", properties: { a: { type: "strng" } } });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.path.startsWith("fields"))).toBe(true);
    expect(issues.some((issue) => issue.path.startsWith("fields.properties.a.type"))).toBe(true);
  });

  it("refuses other non-schema content: wrong-typed keywords and non-schema children", () => {
    expect(fieldsIssues({ type: "object", properties: { a: { type: "string", minLength: "3" } } }).length).toBeGreaterThan(0);
    expect(fieldsIssues({ type: "object", required: "a", properties: { a: { type: "string" } } }).length).toBeGreaterThan(0);
    expect(fieldsIssues({ type: "object", properties: { a: 5 } }).length).toBeGreaterThan(0);
    expect(fieldsIssues({ type: "object", properties: { a: { type: "array", minItems: -1 } } }).length).toBeGreaterThan(0);
    expect(fieldsIssues({ type: "object", properties: { a: { type: "string", pattern: "(" } } }).length).toBeGreaterThan(0);
  });

  it("accepts a valid schema using nested keywords", () => {
    const fields = {
      type: "object",
      required: ["a"],
      properties: {
        a: { type: ["string", "null"], minLength: 1 },
        b: { type: "array", items: { type: "object", properties: { c: { enum: [1, 2] } } }, uniqueItems: true },
      },
    };
    expect(fieldsIssues(fields)).toEqual([]);
  });

  it("states unknown-keyword behaviour: a plain extension keyword is accepted (annotation), not refused", () => {
    expect(fieldsIssues({ type: "object", properties: { a: { type: "string", "my-extension": { any: "thing" } } } })).toEqual([]);
  });

  it("refuses a missing version, an empty render list and an empty heading", () => {
    expect(parseTemplate(baseTemplate({ version: 0 })).ok).toBe(false);
    expect(parseTemplate(baseTemplate({ render: [] })).ok).toBe(false);
    expect(parseTemplate(baseTemplate({ render: [{ heading: "", fields: ["summary"] }] })).ok).toBe(false);
  });

  it("reports several refusals together", () => {
    const result = parseTemplate(
      baseTemplate({
        checks: ["nope"],
        dimensions: [{ id: "a", question: "q" }, { id: "a", question: "q" }],
        render: [{ heading: "H", fields: ["ghost"] }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThanOrEqual(3);
  });
});

describe("validateDocument", () => {
  const template = mustParse();

  function problemsOf(fields: unknown, dimensions: unknown, kind?: string): TemplateProblem[] {
    const result = validateDocument(template, fields, dimensions, kind === undefined ? {} : { kind });
    return result.ok ? [] : result.error;
  }

  it("accepts a valid document", () => {
    expect(validateDocument(template, { summary: "hello" }, goodDimensions).ok).toBe(true);
  });

  it("reports schema violations by field path", () => {
    const problems = problemsOf({ summary: "x", tags: [], nested: { depth: 0 }, extra: 1 }, goodDimensions);
    const fields = problems.flatMap((p) => ("field" in p ? [p.field] : []));
    expect(fields).toEqual(expect.arrayContaining(["summary", "tags", "nested.depth", "extra"]));
  });

  it("reports a missing required field", () => {
    expect(problemsOf({}, goodDimensions).some((p) => "field" in p && p.field === "summary")).toBe(true);
  });

  it("reports a missing dimension", () => {
    const problems = problemsOf({ summary: "hello" }, goodDimensions.slice(0, 2));
    expect(problems).toContainEqual(expect.objectContaining({ code: "missing-dimension", dimension: "tech-only" }));
  });

  it("reports an unknown dimension id", () => {
    const problems = problemsOf({ summary: "hello" }, [...goodDimensions, { id: "bogus", status: "handled", answer: "x", refs: [] }]);
    expect(problems).toContainEqual(expect.objectContaining({ code: "unknown-dimension", dimension: "bogus" }));
  });

  it("reports a duplicate dimension answer", () => {
    const problems = problemsOf({ summary: "hello" }, [...goodDimensions, goodDimensions[0]]);
    expect(problems).toContainEqual(expect.objectContaining({ code: "duplicate-dimension", dimension: "inputs" }));
  });

  it("reports an empty answer for handled and for na", () => {
    const dims = [
      { id: "inputs", status: "handled", answer: "", refs: [] },
      { id: "traced", status: "na", answer: "   ", refs: ["AC-1"] },
      goodDimensions[2],
    ];
    const empties = problemsOf({ summary: "hello" }, dims).filter((p) => p.code === "empty-answer");
    expect(empties.map((p) => ("dimension" in p ? p.dimension : ""))).toEqual(["inputs", "traced"]);
  });

  it("reports needs_refs without refs, for a missing and an empty refs list", () => {
    const missing = [goodDimensions[0], { id: "traced", status: "handled", answer: "yes" }, goodDimensions[2]];
    expect(problemsOf({ summary: "hello" }, missing)).toContainEqual(expect.objectContaining({ code: "missing-refs", dimension: "traced" }));
    const empty = [goodDimensions[0], { id: "traced", status: "handled", answer: "yes", refs: [] }, goodDimensions[2]];
    expect(problemsOf({ summary: "hello" }, empty)).toContainEqual(expect.objectContaining({ code: "missing-refs", dimension: "traced" }));
  });

  it("does not resolve refs: a ref to a not-yet-declared AC is valid here", () => {
    const dims = [goodDimensions[0], { id: "traced", status: "handled", answer: "yes", refs: ["AC-999"] }, goodDimensions[2]];
    expect(validateDocument(template, { summary: "hello" }, dims).ok).toBe(true);
  });

  it("reports an invalid status and a malformed entry", () => {
    const dims = [{ id: "inputs", status: "maybe", answer: "x" }, 42, goodDimensions[1], goodDimensions[2]];
    const codes = problemsOf({ summary: "hello" }, dims).map((p) => p.code);
    expect(codes.filter((code) => code === "invalid-dimension-entry")).toHaveLength(2);
  });

  it("reports (not throws) a template whose schema has an unresolvable $ref", () => {
    const broken = mustParse({
      fields: { type: "object", properties: { a: { $ref: "#/$defs/missing" } } },
      render: [{ heading: "H", fields: ["a"] }],
    });
    const result = validateDocument(broken, { a: 1 }, goodDimensions);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContainEqual(expect.objectContaining({ code: "schema-violation", field: "(schema)" }));
  });

  it("does not throw when dimensions is not an array", () => {
    const problems = problemsOf({ summary: "hello" }, "nope");
    expect(problems.some((p) => p.code === "invalid-dimension-entry")).toBe(true);
    expect(problems.filter((p) => p.code === "missing-dimension")).toHaveLength(3);
  });

  it("reports ALL problem kinds in one list", () => {
    const dims = [
      { id: "inputs", status: "handled", answer: "", refs: [] },
      { id: "traced", status: "handled", answer: "x", refs: [] },
      { id: "bogus", status: "handled", answer: "x", refs: [] },
    ];
    const codes = new Set(problemsOf({ tags: [] }, dims).map((p) => p.code));
    for (const code of ["schema-violation", "empty-answer", "missing-refs", "unknown-dimension", "missing-dimension"]) {
      expect(codes.has(code as TemplateProblem["code"])).toBe(true);
    }
  });

  it("applies_to: a dimension excluded for the kind is not required and not accepted", () => {
    const withoutTechOnly = goodDimensions.slice(0, 2);
    expect(validateDocument(template, { summary: "hello" }, withoutTechOnly, { kind: "feature" }).ok).toBe(true);
    const problems = problemsOf({ summary: "hello" }, goodDimensions, "feature");
    expect(problems).toContainEqual(expect.objectContaining({ code: "unknown-dimension", dimension: "tech-only" }));
  });
});

describe("cross-field check library", () => {
  const ports: CrossFieldCheckPorts = {
    criteria: [{ id: "AC-1", cites: ["R-1", "BR-9"] }],
    resolveRef: (ref) => ["AC-1", "BR-9", "some-slug"].includes(ref),
  };

  function run(id: (typeof CROSS_FIELD_CHECK_IDS)[number], properties: Record<string, JsonSchemaNode>, fields: Record<string, unknown>, dimensions: DocumentView["dimensions"] = []) {
    const template = mustParse({
      checks: [id],
      fields: { type: "object", properties },
      render: [{ heading: "H", fields: [Object.keys(properties)[0] ?? "x"] }],
    });
    const view: DocumentView = { fieldsSchema: template.fields as JsonSchemaNode, fields, dimensions };
    return runCrossFieldChecks(template, view, ports);
  }

  it("lists exactly the six library ids", () => {
    expect([...CROSS_FIELD_CHECK_IDS].sort()).toEqual(
      ["decision-has-rejected", "goal-has-measure", "out-of-scope-not-in-scope", "refs-resolve", "refusal-has-ac", "rule-change-has-ac"],
    );
  });

  it("refs-resolve: flags an unresolved list ref and an unresolved dimension ref; passes resolved ones and field paths", () => {
    const props = { refs: { type: "array", "x-ref-list": true }, other: { type: "string" } } as Record<string, JsonSchemaNode>;
    const findings = run("refs-resolve", props, { refs: ["AC-1", "AC-404", "other"], other: "v" }, [
      { id: "d", status: "handled", answer: "a", refs: ["some-slug", "ghost"] },
    ]);
    expect(findings.map((f) => f.entry)).toEqual(["refs: AC-404", "dimension d: ghost"]);
    expect(findings.every((f) => f.check === "refs-resolve")).toBe(true);
    expect(run("refs-resolve", props, { refs: ["AC-1"] })).toEqual([]);
  });

  it("refusal-has-ac: flags an uncited refusal (string and object entries); passes a cited one", () => {
    const props = { refusals: { type: "array", "x-refusal-list": true } } as Record<string, JsonSchemaNode>;
    const findings = run("refusal-has-ac", props, { refusals: ["R-1", "R-2", { id: "R-3", text: "x" }] });
    expect(findings.map((f) => f.entry)).toEqual(["refusals: R-2", "refusals: R-3"]);
    expect(run("refusal-has-ac", props, { refusals: ["R-1"] })).toEqual([]);
  });

  it("rule-change-has-ac: flags an uncited rule change; passes a cited one", () => {
    const props = { rule_changes: { type: "array", "x-rule-change-list": true } } as Record<string, JsonSchemaNode>;
    const findings = run("rule-change-has-ac", props, { rule_changes: [{ id: "BR-9" }, { id: "BR-10" }] });
    expect(findings).toEqual([expect.objectContaining({ check: "rule-change-has-ac", entry: "rule_changes: BR-10" })]);
    expect(run("rule-change-has-ac", props, { rule_changes: [{ id: "BR-9" }] })).toEqual([]);
  });

  it("decision-has-rejected: flags no rejected option and no why; passes string / array / object options", () => {
    const props = { decisions: { type: "array", "x-decision-list": true } } as Record<string, JsonSchemaNode>;
    const findings = run("decision-has-rejected", props, {
      decisions: [
        { decision: "D1", rejected: [], why: "because" },
        { decision: "D2", rejected: "opt", why: " " },
      ],
    });
    expect(findings.map((f) => [f.entry, f.problem])).toEqual([
      ["decisions: D1", "names no rejected option"],
      ["decisions: D2", "gives no reason (why) for the choice"],
    ]);
    const good = run("decision-has-rejected", props, {
      decisions: [
        { decision: "A", rejected: "x", why: "w" },
        { decision: "B", rejected: ["y"], why: "w" },
        { decision: "C", rejected: [{ option: "z" }], why: "w" },
      ],
    });
    expect(good).toEqual([]);
  });

  it("out-of-scope-not-in-scope: flags an item in both (normalised); passes disjoint lists", () => {
    const props = { scope: { type: "array", "x-scope-list": true }, out: { type: "array", "x-out-of-scope-list": true } } as Record<string, JsonSchemaNode>;
    const findings = run("out-of-scope-not-in-scope", props, { scope: ["Rewrite  the CLI", "b"], out: ["rewrite the cli", "c"] });
    expect(findings.map((f) => f.entry)).toEqual(["out: rewrite the cli"]);
    expect(run("out-of-scope-not-in-scope", props, { scope: ["a"], out: ["c"] })).toEqual([]);
  });

  it("goal-has-measure: flags a goal with no measure (object or string); passes one with a measure", () => {
    const props = { goal: { type: "object", "x-goal": true } } as Record<string, JsonSchemaNode>;
    expect(run("goal-has-measure", props, { goal: { statement: "better", measure: " " } })).toHaveLength(1);
    expect(run("goal-has-measure", props, { goal: "make it better" })).toHaveLength(1);
    expect(run("goal-has-measure", props, { goal: { statement: "faster", measure: "p95 < 200ms" } })).toEqual([]);
  });

  it("only runs the checks a template lists", () => {
    const template = mustParse({
      checks: ["goal-has-measure"],
      fields: { type: "object", properties: { refusals: { type: "array", "x-refusal-list": true } } },
      render: [{ heading: "H", fields: ["refusals"] }],
    });
    const view: DocumentView = { fieldsSchema: template.fields as JsonSchemaNode, fields: { refusals: ["unlisted"] }, dimensions: [] };
    expect(runCrossFieldChecks(template, view, ports)).toEqual([]);
  });

  it("a marked field absent from the document yields no findings", () => {
    const props = { refusals: { type: "array", "x-refusal-list": true } } as Record<string, JsonSchemaNode>;
    expect(run("refusal-has-ac", props, {})).toEqual([]);
  });
});

describe("renderDocument", () => {
  const template = mustParse({
    fields: {
      type: "object",
      properties: {
        summary: { type: "string", title: "Summary" },
        notes: { type: "string", title: "Notes" },
        tags: { type: "array", items: { type: "string" }, title: "Tags" },
        items: { type: "array", items: { type: "object", properties: { name: { type: "string" }, why: { type: "string" } } } },
      },
    },
    render: [
      { heading: "Summary", fields: ["summary"] },
      { heading: "Details", fields: ["notes", "tags"] },
      { heading: "Items", fields: ["items"] },
    ],
  });

  it("renders headings in render order with field content", () => {
    const text = renderDocument(template, { summary: "Hello", notes: "n", tags: ["a", "b"] });
    expect(text).toBe("## Summary\n\nHello\n\n## Details\n\n### Notes\n\nn\n\n### Tags\n\n- a\n- b\n");
  });

  it("omits empty optional fields and sections with nothing to show", () => {
    const text = renderDocument(template, { summary: "Hello", notes: "  ", tags: [] });
    expect(text).toBe("## Summary\n\nHello\n");
    expect(renderDocument(template, {})).toBe("");
  });

  it("renders objects in schema key order regardless of insertion order (byte-identical)", () => {
    const one = renderDocument(template, { items: [{ name: "n", why: "w", zeta: 1 }] });
    const two = renderDocument(template, { items: [{ zeta: 1, why: "w", name: "n" }] });
    expect(one).toBe(two);
    expect(one).toBe("## Items\n\n- name: n\n  why: w\n  zeta: 1\n");
  });

  it("same input twice yields identical output", () => {
    const fields = { summary: "S", tags: ["x"] };
    expect(renderDocument(template, fields)).toBe(renderDocument(template, { ...fields }));
  });
});
