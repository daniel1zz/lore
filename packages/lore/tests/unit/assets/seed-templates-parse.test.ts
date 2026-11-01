// @reads assets/templates/**
/**
 * Every seed template under `assets/templates/` is a valid template (T1's `parseTemplate`), and the
 * set covers the six document kinds the structured-documents spec ships. A failure names the file
 * and every meta-schema refusal in it.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTemplate } from "@lore/core";

const TEMPLATES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "assets", "templates");

const EXPECTED_FILES = [
  "adr.json",
  "baseline-branch.json",
  "baseline-debt-registry.json",
  "baseline-leaf.json",
  "baseline-module-card.json",
  "baseline-root.json",
  "baseline-section.json",
  "baseline-standard.json",
  "issue-report.json",
  "knowledge-assessment.json",
  "knowledge-handoff.json",
  "knowledge-ideation.json",
  "knowledge-milestone-review.json",
  "knowledge-prompt.json",
  "knowledge-reference.json",
  "knowledge-research.json",
  "knowledge-retro.json",
  "knowledge-skill.json",
  "knowledge-uat.json",
  "phase.json",
  "plan.json",
  "prd.json",
  "spec-design.json",
  "spec-domain-overview.json",
  "spec-feature.json",
  "spec-tech.json",
  "task.json",
];

describe("seed templates", () => {
  it("ships exactly the expected seed files", () => {
    const files = readdirSync(TEMPLATES_DIR).filter((name) => name.endsWith(".json")).sort();
    expect(files).toEqual(EXPECTED_FILES);
  });

  it("every file parses as a template, naming each invalid file and its refusals", () => {
    const invalid: string[] = [];
    for (const name of readdirSync(TEMPLATES_DIR).filter((entry) => entry.endsWith(".json"))) {
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(join(TEMPLATES_DIR, name), "utf8"));
      } catch (error) {
        invalid.push(`${name}: not JSON (${(error as Error).message})`);
        continue;
      }
      const parsed = parseTemplate(raw);
      if (!parsed.ok) invalid.push(`${name}: ${parsed.error.map((issue) => `${issue.path}: ${issue.problem}`).join("; ")}`);
    }
    expect(invalid).toEqual([]);
  });

  // reason: the three spec seeds that carry a refusal list moved to version 2 when a refusal entry started naming its own
  // `acs` (an AC `cites` takes rule ids only); every other seed is still its first version. A raised version is a NEW
  // template version in a corpus (`lore migrate templates` proposes it as a revision), never an overwrite.
  const SEED_VERSIONS: Readonly<Record<string, number>> = { "spec-design.json": 2, "spec-feature.json": 2, "spec-tech.json": 2, "task.json": 2 };

  it("each file's doc_type and kind match its file name, and its version is the expected one", () => {
    const mismatched: string[] = [];
    for (const name of EXPECTED_FILES) {
      const raw = JSON.parse(readFileSync(join(TEMPLATES_DIR, name), "utf8")) as { doc_type: string; kind?: string; version: number };
      const stem = raw.kind === undefined ? raw.doc_type : `${raw.doc_type}-${raw.kind}`;
      if (`${stem}.json` !== name || raw.version !== (SEED_VERSIONS[name] ?? 1)) mismatched.push(name);
    }
    expect(mismatched).toEqual([]);
  });

  it("every seed's refusal item schema carries the refusal's own `acs` list", () => {
    for (const name of ["spec-feature.json", "spec-tech.json", "spec-design.json"]) {
      const raw = JSON.parse(readFileSync(join(TEMPLATES_DIR, name), "utf8")) as {
        fields: { properties: { refusals: { items: { properties: Record<string, { type?: string }> } } } };
      };
      expect(raw.fields.properties.refusals.items.properties["acs"]?.type, name).toBe("array");
    }
  });

  it("spec kinds carry the review-derived dimensions and all six checks (feature, tech, design)", () => {
    const required = ["edge-cases", "refusal-paths", "concurrency", "unseen-inputs", "rule-consistency", "end-state", "failure-visibility", "false-green", "cost", "migration"];
    for (const name of ["spec-feature.json", "spec-tech.json", "spec-design.json"]) {
      const parsed = parseTemplate(JSON.parse(readFileSync(join(TEMPLATES_DIR, name), "utf8")));
      expect(parsed.ok, name).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.value.dimensions.map((d) => d.id), name).toEqual(expect.arrayContaining(required));
      expect([...parsed.value.checks].sort(), name).toEqual(
        ["decision-has-rejected", "goal-has-measure", "out-of-scope-not-in-scope", "refs-resolve", "refusal-has-ac", "rule-change-has-ac"],
      );
    }
  });
});
