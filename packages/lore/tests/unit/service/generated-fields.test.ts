/**
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by (BR-1528)
 *
 * Every internal generator fills fields and dimension answers through its SHIPPED seed template. This file proves the
 * builders in `generated-fields.ts` against the seeds they name, with no corpus: the output of each builder satisfies
 * `validateDocument` for its seed (every required field, every dimension answered), so a seed rename or a builder drift
 * fails here and not at a user's `lore handoff`.
 *
 * Coverage:
 *   HAPPY:      handoff, uat, milestone review, ad-hoc verification task and fidelity record each validate against their seed
 *   NEGATIVE:   a builder's output with a required field removed is refused naming that field (the check is real)
 *   BOUNDARY:   a degraded handoff leads with the exact marker; a handoff with a failing oracle, trail files, overflow and
 *               gaps keeps every one of them visible; a review with no assessed commit says so; an all-pass UAT answers
 *               `unverified` as `na`
 *   REGRESSION: no builder emits a `content` (the body is rendered by the write path, never supplied)
 */

import { describe, expect, it } from "vitest";
import { DEGRADED_HANDOFF_MARKER, MILESTONE_DIMENSIONS, handoffExtraSchema, milestoneReviewSchema, renderDocument, validateDocument, type Template } from "@lore/core";
import { readShippedTemplateSeeds } from "../../../src/adapters/cli/template-seeds.js";
import {
  adhocVerifyTaskFields,
  fidelityResearchFields,
  handoffFields,
  milestoneReviewFields,
  uatFields,
  withGeneratedFields,
  type GeneratedFields,
} from "../../../src/service/generated-fields.js";
import type { FidelityRecord } from "../../../src/service/fidelity-sample.js";

const readSeeds = readShippedTemplateSeeds();
if (!readSeeds.ok) throw new Error(`shipped seeds unreadable: ${JSON.stringify(readSeeds.error)}`);
const shippedSeeds = readSeeds.value;

function seed(docType: string, kind?: string): Template {
  const found = shippedSeeds.find((candidate) => candidate.template.doc_type === docType && candidate.template.kind === kind);
  if (found === undefined) throw new Error(`no shipped seed for ${docType}/${String(kind)}`);
  return found.template;
}

function problemsOf(template: Template, generated: GeneratedFields, kind?: string): string[] {
  const checked = validateDocument(template, generated.fields, generated.dimensions, kind === undefined ? {} : { kind });
  return checked.ok ? [] : checked.error.map((problem) => ("field" in problem ? `${problem.field}: ${problem.problem}` : `${problem.dimension}: ${problem.problem}`));
}

const handoff = handoffExtraSchema.parse({
  by: "agent:session-1",
  plan_ref: "plan-x",
  task_refs: ["task-a"],
  modified_files: ["src/a.ts"],
  key_decisions: [{ judgment: "keep the typed extra as the SSOT", confidence: 92 }, { judgment: "unsure about the cache" }],
  failing_oracle: { command: "bun run typecheck", output_tail: "error TS2345" },
  next_steps: ["wire the seam", "run the suite"],
});

const dimension = (verdict: "pass" | "fail" | "na" | "not-measured", extra: Record<string, unknown> = {}) => ({ verdict, reason: `${verdict} because it was measured`, reference: "", ...extra });

const review = milestoneReviewSchema.parse({
  plan_id: "01PLAN",
  fingerprint: "plan:P@1",
  overall: "fail",
  dimensions: {
    correctness_vs_acs: dimension("pass"),
    spec_conformance: dimension("fail", { cites: ["AC-X-1"] }),
    regression: dimension("fail"),
    design_necessity: dimension("pass", { reference: "Google engineering practices" }),
    snapshot_accuracy: dimension("na"),
    concurrency_safety: dimension("pass"),
    security: dimension("not-measured"),
  },
  decisions: [],
  causes: { regression_files: ["tests/a.test.ts"] },
  assessed_commit: "abc123",
  prompt_version: "milestone-1",
  diff_source: "derived",
});

const verdict = {
  verdict: "accept" as const,
  tier_results: [{ tier: "P0" as const, accepted: 3, rejected: 0, unverified: 0 }],
  requirement_coverage: { total: 3, covered: 3, uncovered_p0: [] },
  uiux: { blocker_count: 0, min_dimension_score: 4 },
  run_meta: { at: "2026-11-01T00:00:00.000Z", by: "agent:uat" },
};

const fidelity: FidelityRecord = {
  mode: "citations",
  seed: 7,
  size: 2,
  pool: 5,
  judges: 1,
  verdicts: [
    { n: 1, key: "spec#AC-1->BR-1", verdict: "faithful", reason: "the criterion checks the rule" },
    { n: 2, key: "spec#AC-2->BR-2", verdict: "not_seen", reason: "unreadable", unseen_paths: ["tests/missing.test.ts"] },
  ],
  disagreements: [],
  faithful_share: 0.5,
  not_seen: 1,
  catch_all: [{ rule_id: "BR-9", citing_criteria: ["spec#AC-1", "spec#AC-3"] }],
  threshold_share: 0.3,
};

describe("generated-fields: each builder satisfies its shipped seed", () => {
  const cases: Array<{ name: string; template: Template; kind?: string; generated: GeneratedFields }> = [
    { name: "handoff", template: seed("knowledge", "handoff"), kind: "handoff", generated: handoffFields(handoff) },
    { name: "uat", template: seed("knowledge", "uat"), kind: "uat", generated: uatFields("plan-x", verdict) },
    { name: "milestone review", template: seed("knowledge", "milestone-review"), kind: "milestone-review", generated: milestoneReviewFields("plan-x", review) },
    { name: "ad-hoc verification task", template: seed("task"), generated: adhocVerifyTaskFields({ acId: "AC-RF-1", specSlug: "spec-x" }) },
    { name: "fidelity record", template: seed("knowledge", "research"), kind: "research", generated: fidelityResearchFields(fidelity) },
  ];

  for (const { name, template, kind, generated } of cases) {
    it(`HAPPY: ${name} validates against ${template.doc_type}${kind === undefined ? "" : `/${kind}`} and renders a non-empty body`, () => {
      expect(problemsOf(template, generated, kind)).toEqual([]);
      expect(renderDocument(template, generated.fields).length).toBeGreaterThan(0);
    });

    it(`NEGATIVE: ${name} without a required field is refused naming it (the check is not vacuous)`, () => {
      const required = (template.fields as { required?: string[] }).required ?? [];
      expect(required.length).toBeGreaterThan(0);
      const [missing, ...rest] = required;
      const without = Object.fromEntries(Object.entries(generated.fields).filter(([key]) => key !== missing));
      const checked = problemsOf(template, { fields: without, dimensions: generated.dimensions }, kind);
      expect(checked.some((problem) => problem.startsWith(`${String(missing)}:`)), JSON.stringify({ missing, rest, checked })).toBe(true);
    });

    it(`REGRESSION: ${name} supplies no body: withGeneratedFields puts fields and dimensions in extra and never content`, () => {
      const input = withGeneratedFields({ type: "knowledge", title: "t" }, generated);
      expect("content" in input).toBe(false);
      expect(input.extra).toMatchObject({ fields: generated.fields, dimensions: generated.dimensions });
    });
  }
});

describe("generated-fields: facts the generator holds stay visible", () => {
  it("BOUNDARY: a degraded handoff leads its summary with the exact marker", () => {
    const degraded = handoffExtraSchema.parse({ by: "stop-hook", next_steps: ["review"], degraded: true });
    expect(String(handoffFields(degraded).fields["summary"]).startsWith(DEGRADED_HANDOFF_MARKER)).toBe(true);
    expect(problemsOf(seed("knowledge", "handoff"), handoffFields(degraded), "handoff")).toEqual([]);
  });

  it("BOUNDARY: a handoff's failing oracle, merged trail files, overflow groups and gaps are all in the fields", () => {
    const merged = handoffExtraSchema.parse({
      ...handoff,
      changed_files: [{ path: "src/b.ts", sources: [{ kind: "run", run: "cc:s:a" }, { kind: "vcs" }], named_by_author: true, run_count: 2 }],
      changed_files_measured: true,
      changed_files_overflow: [{ dir: "docs", files: 12 }],
      trail_gaps: [{ kind: "removed", subject: "part s2", detail: "removed 2026-09-01" }, { kind: "unmeasured", subject: "turn t1", detail: "changes.json absent", count: 3 }],
    });
    const { fields } = handoffFields(merged);
    expect(fields["failing_oracle"]).toEqual({ command: "bun run typecheck", summary: "error TS2345" });
    expect(fields["modified_files"]).toEqual(["src/b.ts (2 runs; vcs; named by author)", "12 more files, grouped by top-level directory:", "docs/ (12 files)"]);
    expect(JSON.stringify(fields["open_threads"])).toContain("removed: part s2");
    expect(JSON.stringify(fields["open_threads"])).toContain("not measured: 3 x turn t1");
    expect(problemsOf(seed("knowledge", "handoff"), handoffFields(merged), "handoff")).toEqual([]);
  });

  it("BOUNDARY: a handoff with no trail measurement says 'changed files: not measured' with the reason", () => {
    const unmeasured = handoffExtraSchema.parse({
      ...handoff,
      changed_files: [],
      changed_files_measured: false,
      trail_gaps: [{ kind: "unmeasured", subject: "trail", detail: "no attested run" }],
    });
    expect(handoffFields(unmeasured).fields["modified_files"]).toEqual(["changed files: not measured (no attested run)"]);
  });

  it("BOUNDARY: a review with no assessed commit says it was not measured, never a made-up commit", () => {
    const { assessed_commit: _omit, ...rest } = review;
    void _omit;
    const fields = milestoneReviewFields("plan-x", milestoneReviewSchema.parse(rest)).fields;
    expect(String(fields["assessed_commit"])).toContain("not measured");
  });

  it("STATE: a failed dimension carries a root cause built from its cites; a measured one from its measured files", () => {
    const findings = milestoneReviewFields("plan-x", review).fields["findings"] as Array<{ dimension: string; root_causes?: Array<{ fingerprint: string; cites: string[] }> }>;
    expect(findings.map((finding) => finding.dimension)).toEqual([...MILESTONE_DIMENSIONS]);
    expect(findings.find((finding) => finding.dimension === "spec_conformance")?.root_causes?.[0]).toEqual({ fingerprint: "spec_conformance:AC-X-1", cites: ["AC-X-1"] });
    expect(findings.find((finding) => finding.dimension === "regression")?.root_causes?.[0]?.cites).toEqual(["tests/a.test.ts"]);
  });

  it("BOUNDARY: an all-pass UAT answers unverified as na; unverified journeys make it handled with the counts", () => {
    expect(uatFields("plan-x", verdict).dimensions.find((answer) => answer.id === "unverified")?.status).toBe("na");
    const withUnverified = uatFields("plan-x", { ...verdict, tier_results: [{ tier: "P1", accepted: 1, rejected: 0, unverified: 2 }] });
    const answer = withUnverified.dimensions.find((entry) => entry.id === "unverified");
    expect(answer?.status).toBe("handled");
    expect(answer?.answer).toContain("P1 2");
  });

  it("ERROR: an empty tier_results (not a journey result) is refused by the uat template, not patched up", () => {
    const empty = uatFields("plan-x", { ...verdict, tier_results: [] });
    expect(problemsOf(seed("knowledge", "uat"), empty, "uat").some((problem) => problem.startsWith("tier_results:"))).toBe(true);
  });
});
