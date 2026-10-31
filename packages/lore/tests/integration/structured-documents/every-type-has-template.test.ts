// @reads assets/templates/**
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
 * The remaining AC-ST-8 parts (first template in an empty corpus; `lore template show --blank` round-trips for
 * every type in a fresh corpus) need the template service and are not in this file yet.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BASELINE_NODE_KINDS, KNOWLEDGE_SUB_TYPES, SPEC_KINDS, docTypeSchema, parseTemplate } from "@lore/core";

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
