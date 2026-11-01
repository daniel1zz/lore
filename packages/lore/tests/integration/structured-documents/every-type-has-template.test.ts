// @reads assets/templates/**
// @reads assets/project/lore-config-template.yaml
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-8 (seed half): every document type and
 * kind of the core schema has a seed template, and every seed is valid under the meta-schema.
 *
 * The types and kinds are enumerated FROM THE CORE ENUMS (docTypeSchema, SPEC_KINDS, KNOWLEDGE_SUB_TYPES,
 * BASELINE_NODE_KINDS), never from a list written here, so a new type or kind added to core fails this test
 * until it gets a seed. The `template` type itself is excepted: its own template is the meta-schema in code.
 * `issue-report` is not a core doc type (an issue report is a task whose `extra.issue_report` holds its fields),
 * so it is added by name.
 *
 * The corpus half (below the seed half): the first template is created in a corpus with no template at all, and for
 * every type and kind the filled `lore template show --blank --json` skeleton creates successfully in a fresh
 * `lore init` corpus whose config sets `workflow.structured_documents.require_create: true`. `phase` and `issue-report`
 * are not types `lore create` makes (a phase lives in its plan; `lore report-issue` validates an issue report against its
 * template and creates no document), so their filled blank is validated through the template service instead.
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BASELINE_NODE_KINDS, KNOWLEDGE_SUB_TYPES, SPEC_KINDS, docTypeSchema, parseTemplate } from "@lore/core";
import type { JsonSchemaNode } from "@lore/core";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { createStructuredRig, installTemplate, must, writeFieldsFile, type StructuredRig } from "../../helpers/structured-corpus.js";

const TEMPLATES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "assets", "templates");

/** The doc types that are authored per kind, with the core enum that lists their kinds. */
const KINDS_BY_TYPE: Readonly<Record<string, readonly string[]>> = {
  spec: SPEC_KINDS,
  knowledge: KNOWLEDGE_SUB_TYPES,
  baseline: BASELINE_NODE_KINDS,
};

/** The type that is excepted from needing a seed (its template is the meta-schema in code). */
const EXCEPTED_TYPES: readonly string[] = ["template"];

/** Seed file names the core enums require, each with the (doc_type, kind) it must declare. */
function requiredSeeds(): { file: string; docType: string; kind: string | undefined }[] {
  const seeds: { file: string; docType: string; kind: string | undefined }[] = [];
  for (const docType of docTypeSchema.options as readonly string[]) {
    if (EXCEPTED_TYPES.includes(docType)) continue;
    const kinds = KINDS_BY_TYPE[docType];
    if (kinds === undefined) seeds.push({ file: `${docType}.json`, docType, kind: undefined });
    else for (const kind of kinds) seeds.push({ file: `${docType}-${kind}.json`, docType, kind });
  }
  seeds.push({ file: "issue-report.json", docType: "issue-report", kind: undefined });
  return seeds;
}

function readSeed(file: string): unknown {
  return JSON.parse(readFileSync(join(TEMPLATES_DIR, file), "utf8"));
}

describe("AC-ST-8: every type and kind has a seed template", () => {
  it("the enumeration reaches every core enum (guards against an empty or truncated list)", () => {
    const files = requiredSeeds().map((seed) => seed.file);
    expect(files.length).toBeGreaterThan(SPEC_KINDS.length + KNOWLEDGE_SUB_TYPES.length + BASELINE_NODE_KINDS.length);
    expect(files).toContain("knowledge-milestone-review.json");
    expect(files).toContain("baseline-debt-registry.json");
  });

  it("no type or kind lacks a seed (the failure names each missing file)", () => {
    const missing = requiredSeeds().filter((seed) => !existsSync(join(TEMPLATES_DIR, seed.file))).map((seed) => seed.file);
    expect(missing).toEqual([]);
  });

  it("every seed parses under the meta-schema and declares the doc_type and kind its file name says", () => {
    const defects: string[] = [];
    for (const seed of requiredSeeds()) {
      if (!existsSync(join(TEMPLATES_DIR, seed.file))) continue;
      const raw = readSeed(seed.file) as { doc_type?: string; kind?: string };
      const parsed = parseTemplate(raw);
      if (!parsed.ok) defects.push(`${seed.file}: ${parsed.error.map((issue) => `${issue.path}: ${issue.problem}`).join("; ")}`);
      if (raw.doc_type !== seed.docType || raw.kind !== seed.kind) {
        defects.push(`${seed.file}: declares doc_type=${raw.doc_type} kind=${raw.kind}, expected doc_type=${seed.docType} kind=${seed.kind}`);
      }
    }
    expect(defects).toEqual([]);
  });

  it("a seed that lists an unknown check id is refused, naming the id", () => {
    const seed = requiredSeeds().find((candidate) => existsSync(join(TEMPLATES_DIR, candidate.file)));
    expect(seed, "at least one seed must exist to mutate").toBeDefined();
    const raw = readSeed(seed!.file) as { checks: string[] };
    const parsed = parseTemplate({ ...raw, checks: [...raw.checks, "no-such-check"] });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.map((issue) => issue.problem).join("\n")).toContain('unknown check id "no-such-check"');
  });
});

// ── the corpus half of AC-ST-8: first template in an empty corpus, and the blank round-trip for every type ──

/** What `lore template show --blank --json` prints that the round-trip reads. */
interface ShownTemplate {
  ref: string;
  fields: JsonSchemaNode;
  dimensions: { id: string; needs_refs?: boolean }[];
  blank: { fields: Record<string, unknown>; dimensions: Record<string, unknown>[] };
}

function isNode(value: unknown): value is JsonSchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turn a blank skeleton value into the smallest value its schema node accepts: an empty string becomes `minimal` (padded
 * to `minLength`), objects and arrays recurse; enums, constants and numbers are already valid in the blank.
 */
function fillMinimal(schema: JsonSchemaNode | undefined, blank: unknown): unknown {
  if (typeof blank === "string") {
    if (blank !== "" || schema === undefined) return blank;
    const minLength = typeof schema["minLength"] === "number" ? schema["minLength"] : 0;
    return "minimal".padEnd(Math.max(minLength, 7), "x");
  }
  if (Array.isArray(blank)) {
    const items = schema !== undefined && isNode(schema["items"]) ? schema["items"] : undefined;
    return blank.map((item) => fillMinimal(items, item));
  }
  if (isNode(blank)) {
    const properties = schema !== undefined && isNode(schema["properties"]) ? (schema["properties"] as Record<string, unknown>) : {};
    return Object.fromEntries(Object.entries(blank).map(([key, value]) => [key, fillMinimal(isNode(properties[key]) ? (properties[key] as JsonSchemaNode) : undefined, value)]));
  }
  return blank;
}

/**
 * Every optional array entry is filled with minimal values EXCEPT where the template makes a non-empty list demand another
 * field: the task template's `if ac_scope has an item then spec_ref is required`. A minimal `ac_scope` entry names no real
 * criterion and a `spec_ref` must name a real spec, so for such a list the entry is deleted, as its optional-entry comment
 * says it may be.
 */
function dropDependentEntries(shown: ShownTemplate, fields: Record<string, unknown>): Record<string, unknown> {
  const condition = shown.fields["if"];
  const demanded = isNode(shown.fields["then"]) && Array.isArray(shown.fields["then"]["required"]) ? shown.fields["then"]["required"] : [];
  if (!isNode(condition) || !isNode(condition["properties"]) || demanded.some((name) => fields[String(name)] !== undefined)) return fields;
  const result = { ...fields };
  for (const name of Object.keys(condition["properties"])) if (Array.isArray(result[name])) result[name] = [];
  return result;
}

/** The fields file a round-trip writes: the blank filled with minimal values, every dimension answered (refs where required). */
function filledFilesOf(shown: ShownTemplate): { fields: unknown; dimensions: unknown[] } {
  const needsRefs = new Set(shown.dimensions.filter((dimension) => dimension.needs_refs === true).map((dimension) => dimension.id));
  return {
    fields: dropDependentEntries(shown, fillMinimal(shown.fields, shown.blank.fields) as Record<string, unknown>),
    dimensions: shown.blank.dimensions.map((entry) => ({
      ...entry,
      answer: "A minimal answer.",
      refs: needsRefs.has(String(entry["id"])) ? ["AC-ROUNDTRIP-1"] : [],
    })),
  };
}

/** Paths of every array reachable through required properties whose blank value has no entry (an optional entry must still be shown). */
function arraysWithoutEntry(schema: JsonSchemaNode | undefined, blank: unknown, path: string): string[] {
  if (schema === undefined) return [];
  if (schema["type"] === "array") {
    const items = isNode(schema["items"]) ? schema["items"] : undefined;
    if (!Array.isArray(blank) || blank.length === 0) return items === undefined ? [] : [path];
    return arraysWithoutEntry(items, blank[0], `${path}[0]`);
  }
  if (isNode(blank) && isNode(schema["properties"])) {
    const properties = schema["properties"] as Record<string, unknown>;
    return Object.entries(blank).flatMap(([key, value]) => arraysWithoutEntry(isNode(properties[key]) ? (properties[key] as JsonSchemaNode) : undefined, value, `${path}.${key}`));
  }
  return [];
}

/** Knowledge sub-types `lore create` refuses by design: retired, or written only by their dedicated command. */
const KNOWLEDGE_WITHOUT_CREATE: readonly string[] = ["assessment", "milestone-review", "handoff", "uat"];

/** Whether the filled blank of the slot is created by `lore create` / `lore baseline add` (else it is validated through the service). */
function isCreatableByCreateCommand(docType: string, kind: string | undefined): boolean {
  if (docType === "phase" || docType === "issue-report") return false;
  if (docType === "knowledge") return kind === undefined || !KNOWLEDGE_WITHOUT_CREATE.includes(kind);
  return true;
}

describe("AC-ST-8: the first template is created in an empty corpus", () => {
  let rig: StructuredRig;
  beforeAll(async () => {
    rig = await createStructuredRig("lore-first-template");
  }, 180_000);
  afterAll(() => rig.cleanup());

  it("a fresh lore init corpus holds no template, and creating the first one (a shipped seed) succeeds and resolves", async () => {
    const before = await rig.withApp(async (app) => (await must(app.corpusService.list({ type: "template" } as never), "list templates")).total);
    expect(before, "this test is about a corpus with no template at all").toBe(0);

    const seed = readSeed("spec-tech.json") as { version: number };
    const installed = await installTemplate(rig, "First template", seed as unknown as Record<string, unknown>);
    expect(installed.slug).toBe("template-first-template");

    const resolved = await rig.withApp(async (app) => {
      if (app.templateService === undefined) throw new Error("no template service");
      return await must(app.templateService.resolveTemplate("spec", "tech"), "resolve the first template");
    });
    expect(resolved.slug).toBe("template-first-template");
    expect(resolved.version).toBe(seed.version);
  });

  it("the template type needs no seed of its own (it is excepted, so its absence cannot fail the enumeration)", () => {
    expect(requiredSeeds().some((seed) => seed.docType === "template")).toBe(false);
  });
});

describe("AC-ST-8: the filled blank of every type and kind creates in a fresh corpus (require_create on)", () => {
  let rig: StructuredRig;
  const created: Record<string, string> = {};
  let counter = 0;

  async function showBlank(docType: string, kind: string | undefined): Promise<ShownTemplate> {
    const args = ["template", "show", docType, ...(kind === undefined ? [] : ["--kind", kind]), "--blank", "--json"];
    const result = await rig.lore(args);
    expect(result.exitCode, `${args.join(" ")}: ${result.stderr}${result.stdout}`).toBe(0);
    return (JSON.parse(result.stdout) as { data: ShownTemplate }).data;
  }

  async function write(args: string[]): Promise<string> {
    const result = await rig.lore([...args, "--json"]);
    expect(result.exitCode, `${args.join(" ")}: ${result.stderr}${result.stdout}`).toBe(0);
    return (JSON.parse(result.stdout) as { data: { slug: string } }).data.slug;
  }

  /** Show the blank of a slot, fill it, write it to a file in the rig and return the file path. */
  async function filledFile(docType: string, kind: string | undefined): Promise<string> {
    counter += 1;
    return writeFieldsFile(rig, `fill-${String(counter)}.json`, filledFilesOf(await showBlank(docType, kind)));
  }

  /** Validate the filled blank of a slot against its resolved template, through the template service. */
  async function validateThroughService(docType: string, kind: string | undefined, mutate?: (files: { fields: Record<string, unknown> }) => void): Promise<unknown[]> {
    const shown = await showBlank(docType, kind);
    const files = filledFilesOf(shown) as { fields: Record<string, unknown>; dimensions: unknown[] };
    mutate?.(files);
    return await rig.withApp(async (app) => {
      if (app.templateService === undefined) throw new Error("no template service");
      const doc = { slug: `roundtrip-${docType}`, type: docType, extra: { ...(kind === undefined ? {} : { sub_type: kind }), template_ref: shown.ref, fields: files.fields, dimensions: files.dimensions } };
      return await must(app.templateService.validate(doc as never), `validate ${docType}`);
    });
  }

  async function createBaseline(kind: string, parent: string, tree: "business" | "architecture"): Promise<string> {
    const file = await filledFile("baseline", kind);
    const result = await rig.lore(["baseline", "add", parent, "--tree", tree, "--node", kind, "--label", `${kind}-${String(counter)}`, "--title", `Round trip ${tree} ${kind}`, "--fields-file", file]);
    expect(result.exitCode, `baseline add ${kind}: ${result.stderr}${result.stdout}`).toBe(0);
    const slug = result.stdout.match(/Created baseline [\w-]+ (\S+) \(/)?.[1];
    expect(slug, `slug of the created baseline ${kind}: ${result.stdout}`).toBeDefined();
    return slug!;
  }

  beforeAll(async () => {
    rig = await createStructuredRig("lore-roundtrip");
    patchLoreConfig(rig.dir, { workflow: { structured_documents: { require_create: true } } });
    // `lore init` does not seed the templates yet; the seeds reach the corpus through `lore migrate templates --apply`.
    const migrated = await rig.lore(["migrate", "templates", "--apply"]);
    expect(migrated.exitCode, `${migrated.stderr}${migrated.stdout}`).toBe(0);
  }, 240_000);
  afterAll(() => rig.cleanup());

  it("the corpus refuses an unstructured create, so each round-trip below is a structured one", async () => {
    const result = await rig.lore(["create", "prd", "--title", "Unstructured", "--content", "free text", "--no-ai"]);
    expect(result.exitCode).not.toBe(0);
  });

  it("the spec-tech blank shows one out_of_scope entry with its id/text/why item shape", async () => {
    const shown = await showBlank("spec", "tech");
    expect(shown.blank.fields["out_of_scope"]).toEqual([{ id: "", text: "", why: "" }]);
    const itemProperties = ((shown.fields["properties"] as Record<string, { items?: { properties?: Record<string, unknown> } }>)["out_of_scope"]?.items?.properties) ?? {};
    expect(Object.keys(itemProperties)).toEqual(["id", "text", "why"]);
    const yaml = await rig.lore(["template", "show", "spec", "--kind", "tech", "--blank"]);
    expect(yaml.stdout).toMatch(/out_of_scope:\n\s+# optional[^\n]*\n\s+- id: ""\n\s+text: ""\n\s+# optional property\n\s+why: ""/);
  });

  it("every blank shows one entry for every array reachable through its required fields", async () => {
    const defects: string[] = [];
    for (const seed of requiredSeeds()) {
      const shown = await showBlank(seed.docType, seed.kind);
      for (const path of arraysWithoutEntry(shown.fields, shown.blank.fields, "fields")) defects.push(`${seed.file}: ${path}`);
    }
    expect(defects).toEqual([]);
  });

  it("the milestone-review template allows several root causes in one dimension, and refuses a root cause without a fingerprint", async () => {
    const twoCauses = (files: { fields: Record<string, unknown> }): void => {
      files.fields["findings"] = [
        {
          dimension: "regression",
          verdict: "fail",
          reason: "two test files are red",
          root_causes: [
            { fingerprint: "regression:packages/a.test.ts", cites: ["AC-X-1"], files: ["packages/a.test.ts"] },
            { fingerprint: "regression:packages/b.test.ts", cites: ["AC-X-2"], files: ["packages/b.test.ts"] },
          ],
        },
      ];
    };
    expect(await validateThroughService("knowledge", "milestone-review", twoCauses)).toEqual([]);

    const noFingerprint = (files: { fields: Record<string, unknown> }): void => {
      files.fields["findings"] = [{ dimension: "regression", verdict: "fail", reason: "red", root_causes: [{ cites: ["AC-X-1"] }] }];
    };
    expect((await validateThroughService("knowledge", "milestone-review", noFingerprint)).length).toBeGreaterThan(0);
  });

  // The cases come from the same core enums as the seed list, in creation order: a parent is created by an earlier case.
  for (const seed of requiredSeeds()) {
    const label = seed.kind === undefined ? seed.docType : `${seed.docType}/${seed.kind}`;
    it(`${label}: the filled blank is accepted`, async () => {
      const { docType, kind } = seed;
      counter += 1;
      const title = `Round trip ${label} ${String(counter)}`;
      if (!isCreatableByCreateCommand(docType, kind)) {
        // reason: these are not made by `lore create` / `lore baseline add` with a fields file: a phase lives in its plan,
        // an issue report is validated by `lore report-issue` and creates no document, a retired sub-type refuses every
        // create, and a milestone review / handoff / UAT verdict has a dedicated writer (`lore assess`, `lore handoff`,
        // `lore uat record`) that the create command refuses by design. So the filled blank is validated against the
        // resolved template through the template service, the check every create path runs.
        const problems = await validateThroughService(docType, kind);
        expect(problems).toEqual([]);
        if (docType === "knowledge") {
          const file = await filledFile(docType, kind);
          const refused = await rig.lore(["create", "knowledge", "--title", title, "--sub-type", kind!, "--parent", created["prd"]!, "--fields-file", file, "--json"]);
          expect(refused.exitCode, `lore create knowledge --sub-type ${kind!} must refuse: ${refused.stdout}`).not.toBe(0);
        }
        return;
      }
      if (docType === "baseline") {
        const architecture = kind !== "root" && kind !== "branch" && kind !== "leaf";
        if (architecture && created["arch-root"] === undefined) {
          created["arch-root"] = await createBaseline("root", created["prd"]!, "architecture");
        }
        const parent =
          kind === "root" ? created["prd"]!
          : kind === "branch" ? created["baseline-root"]!
          : kind === "leaf" ? created["baseline-branch"]!
          : kind === "section" ? created["arch-root"]!
          : created["baseline-section"]!;
        created[`baseline-${kind}`] = await createBaseline(kind!, parent, architecture ? "architecture" : "business");
        return;
      }
      const file = await filledFile(docType, kind);
      const base = ["create", docType, "--title", title, "--fields-file", file];
      const extra: string[] =
        docType === "spec" ? ["--kind", kind!]
        : docType === "adr" ? ["--parent", created["prd"]!, "--decision-status", "accepted"]
        : docType === "plan" ? ["--parent", created["spec-feature"]!]
        : docType === "knowledge" ? ["--sub-type", kind!, "--parent", created["prd"]!]
        : docType === "task" ? ["--plan-id", created["plan"]!]
        : [];
      created[kind === undefined ? docType : `${docType}-${kind}`] = await write([...base, ...extra]);
    });
  }
});
