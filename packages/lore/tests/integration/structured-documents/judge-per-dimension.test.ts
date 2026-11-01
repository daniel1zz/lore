// @reads packages/lore/src/ai/review-template.ts
// @reads packages/lore/src/service/template-growth-service.ts
// @reads packages/lore/src/service/judgment-service.ts
// @reads packages/lore/tests/fixtures/design-necessity/review-prompt-v8-frozen.json
// @reads assets/project/lore-config-template.yaml
// @reads assets/templates/**
/**
 * spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-5 (BR-1530): JUDGE PER DIMENSION.
 *
 * A templated spec reviewed under prompt v9 sends one instruction per template dimension and stores the judgment with its
 * template_ref and one verdict row per dimension; a dimension the judge leaves out is stored `unclear`, never `pass`; a
 * missing_dimension finding becomes a proposal in the template's single pending revision; a second finding naming the same
 * proposal raises its count; two templates keep separate revisions; approving the revision turns accepted proposals into
 * dimensions and records why the others were dropped; prompt v8 output stays byte-identical to its frozen fixture.
 *
 * Throwaway corpus per run (mkdtemp + `lore init`, never the repo's `.lore/`), driven through the real `lore review`; the AI
 * is a shell-script stub provider (`ai.provider.command`) that records the prompt it received and prints a canned judgment
 * read from a file the test swaps between calls. No real provider is called.
 *
 * Every case and every false-green clause is an assertion:
 *   - a judge output that omits a dimension: the stored row for it is `unclear` (dropping it silently fails the count);
 *   - a second pending revision for one template: the store refuses it, and findings never add a second revision;
 *   - a proposal is never written into the approved template without review: the approved template is unchanged (same
 *     dimensions, still approved) until approveRevision runs, and approveRevision refuses a missing decision;
 *   - v8 for a legacy document is byte-identical to the frozen fixture, stores no template_ref and no verdict rows.
 *
 * @spec_ref spec-every-document-is-stored-as-structured-fields-validated-by
 */

import { Database } from "bun:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveConfig } from "@lore/core/node";
import { REVIEW_TEMPLATES } from "../../../src/ai/review-template.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { FROZEN_BUNDLES, FROZEN_BUDGETS, FROZEN_CHECKS, FROZEN_NOW } from "../../fixtures/design-necessity/frozen-bundles.js";
import {
  createStructuredRig,
  installTemplate,
  must,
  specTechTemplate,
  validSpecFiles,
  writeFieldsFile,
  type StructuredRig,
} from "../../helpers/structured-corpus.js";

const ID = "spec-every-document-is-stored-as-structured-fields-validated-by#AC-ST-5";

let rig: StructuredRig;
let techTemplateSlug = "";
let featureTemplateSlug = "";
let counter = 0;

const promptFile = (): string => join(rig.dir, "last-prompt.txt");
const answerFile = (): string => join(rig.dir, "answer.json");

/** The stub provider: store the prompt it was given, then print the canned answer file. */
function writeStubProvider(): string {
  const path = join(rig.dir, "stub-judge.sh");
  writeFileSync(path, ["#!/bin/sh", `cat > "${promptFile()}"`, `cat "${answerFile()}"`, ""].join("\n"), { mode: 0o755 });
  return path;
}

function answer(body: Record<string, unknown>): void {
  writeFileSync(
    answerFile(),
    JSON.stringify({ decision: "approve", confidence: 0.9, reasons: [{ dimension: "completeness", finding: "looks fine" }], blocking_questions: [], ...body }),
  );
}

const verdict = (id: string, v: "pass" | "fail" | "unclear" = "pass") => ({ dimension_id: id, verdict: v, reason: `${id} reason`, evidence: `${id} evidence` });
const ALL_THREE = ["edge-cases", "failure-modes", "evidence"].map((id) => verdict(id));

async function createSpec(kind: "tech" | "feature", label: string): Promise<string> {
  counter += 1;
  const files = validSpecFiles();
  const file = writeFieldsFile(rig, `fields-${String(counter)}.yaml`, files);
  const created = await rig.lore(["create", "spec", "--kind", kind, "--title", `${label} ${String(counter)}`, "--fields-file", file, "--json"]);
  expect(created.exitCode, created.stderr).toBe(0);
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

async function review(slug: string): Promise<void> {
  const r = await rig.lore(["review", slug]);
  expect(r.exitCode, r.stderr + r.stdout).toBe(0);
}

function sql<T>(query: string, ...params: string[]): T[] {
  const db = new Database(rig.dbPath, { readonly: true });
  try {
    return db.query(query).all(...params) as T[];
  } finally {
    db.close();
  }
}

async function docId(slug: string): Promise<string> {
  const doc = JSON.parse((await rig.lore(["get", slug, "--json"])).stdout) as { data: { doc: { id: string } } };
  return doc.data.doc.id;
}

interface JudgmentRow {
  readonly id: string;
  readonly judge_prompt_version: string;
  readonly template_ref: string | null;
}

function latestJudgment(id: string): JudgmentRow {
  const rows = sql<JudgmentRow>("SELECT id, judge_prompt_version, template_ref FROM review_judgments WHERE doc_id = ? ORDER BY rowid DESC LIMIT 1", id);
  if (rows[0] === undefined) throw new Error("no judgment recorded");
  return rows[0];
}

function dimensionRows(judgmentId: string): { dimension_id: string; verdict: string; reason: string; evidence: string }[] {
  return sql("SELECT dimension_id, verdict, reason, evidence FROM review_judgment_dimensions WHERE judgment_id = ? ORDER BY rowid", judgmentId);
}

async function templateState(slug: string): Promise<{ status: string; dimensions: string[]; version: number }> {
  const doc = JSON.parse((await rig.lore(["get", slug, "--json"])).stdout) as {
    data: { doc: { status: string; extra: { template: { version: number; dimensions: { id: string }[] } } } };
  };
  return {
    status: doc.data.doc.status,
    dimensions: doc.data.doc.extra.template.dimensions.map((d) => d.id),
    version: doc.data.doc.extra.template.version,
  };
}

beforeAll(async () => {
  rig = await createStructuredRig("lore-judge-per-dimension", { templates: "none" });
  saveConfig(rig.dir, {
    project: { name: "judge-per-dimension", author: "tester" },
    ai: {
      provider: "claude-cli",
      providers: { "claude-cli": { command: writeStubProvider(), args: [], timeout_ms: 20_000 } },
      templates: {},
      telemetry: false,
      review: { max_doc_chars: 12000, max_context_chars: 8000 },
    },
  } as never);
  answer({});
  techTemplateSlug = (await installTemplate(rig, "Spec tech template", specTechTemplate(1))).slug;
  featureTemplateSlug = (await installTemplate(rig, "Spec feature template", { ...specTechTemplate(1), kind: "feature" })).slug;
}, 240_000);

afterAll(() => {
  rig.cleanup();
});

describe(`${ID} judging a templated document per dimension`, () => {
  let spec = "";
  let specDocId = "";

  it("sends one instruction per template dimension under prompt v9 and stores template_ref with one verdict row per dimension", async () => {
    spec = await createSpec("tech", "Judged tech spec");
    specDocId = await docId(spec);
    answer({ dimension_verdicts: [verdict("edge-cases"), verdict("failure-modes", "fail"), verdict("evidence", "unclear")], missing_dimensions: [] });
    await review(spec);

    const prompt = readFileSync(promptFile(), "utf8");
    for (const [id, question] of [
      ["edge-cases", "Which edge cases does it handle?"],
      ["failure-modes", "How does it fail?"],
      ["evidence", "What proves it?"],
    ] as const) {
      expect(prompt).toContain(`Judge dimension "${id}": ${question}`);
    }
    expect(prompt).toContain(`template ${techTemplateSlug}@1`);

    const judgment = latestJudgment(specDocId);
    expect(judgment.judge_prompt_version).toBe("v9");
    expect(judgment.template_ref).toBe(`${techTemplateSlug}@1`);
    expect(dimensionRows(judgment.id).map((r) => [r.dimension_id, r.verdict])).toEqual([
      ["edge-cases", "pass"],
      ["failure-modes", "fail"],
      ["evidence", "unclear"],
    ]);
    expect(dimensionRows(judgment.id)[0]).toMatchObject({ reason: "edge-cases reason", evidence: "edge-cases evidence" });
  }, 120_000);

  it("a judge output missing a dimension is stored as unclear for it, never pass (and an unknown or repeated id adds no row)", async () => {
    answer({
      dimension_verdicts: [verdict("edge-cases"), verdict("edge-cases", "fail"), verdict("made-up"), verdict("evidence")],
    });
    await review(spec);
    const rows = dimensionRows(latestJudgment(specDocId).id);
    expect(rows.map((r) => r.dimension_id)).toEqual(["edge-cases", "failure-modes", "evidence"]);
    expect(rows.find((r) => r.dimension_id === "failure-modes")?.verdict).toBe("unclear");
    expect(rows.find((r) => r.dimension_id === "edge-cases")?.verdict).toBe("pass");
    expect(rows.some((r) => r.verdict === "pass" && r.dimension_id === "failure-modes")).toBe(false);

    answer({});
    await review(spec);
    const none = dimensionRows(latestJudgment(specDocId).id);
    expect(none).toHaveLength(3);
    expect(none.every((r) => r.verdict === "unclear")).toBe(true);
  }, 120_000);

  it("a missing_dimension finding adds a proposal to the template's single pending revision, never to the approved template", async () => {
    const before = await templateState(techTemplateSlug);
    answer({ dimension_verdicts: ALL_THREE, missing_dimensions: [{ question: "How is it rolled back?", reason: "no rollback story" }] });
    await review(spec);

    const revision = await rig.withApp(async (app) => must(app.templateGrowthService!.pendingRevision(techTemplateSlug), "pending revision"));
    expect(revision).not.toBeNull();
    expect(revision!.proposals).toHaveLength(1);
    expect(revision!.proposals[0]).toMatchObject({ question: "How is it rolled back?", count: 1, source_judgment_ids: [latestJudgment(specDocId).id] });

    const after = await templateState(techTemplateSlug);
    expect(after).toEqual(before);
    expect(after.status).toBe("approved");
    expect(after.dimensions).toEqual(["edge-cases", "failure-modes", "evidence"]);
  }, 120_000);

  it("a second finding naming the same proposal id raises its count and adds no proposal and no second revision", async () => {
    const open = await rig.withApp(async (app) => must(app.templateGrowthService!.pendingRevision(techTemplateSlug), "pending revision"));
    const proposalId = open!.proposals[0]!.id;
    answer({ dimension_verdicts: ALL_THREE, missing_dimensions: [{ question: "Rollback plan?", same_as: proposalId }] });
    await review(spec);

    expect(readFileSync(promptFile(), "utf8")).toContain(`${proposalId} (raised 1x): How is it rolled back?`);
    const revision = await rig.withApp(async (app) => must(app.templateGrowthService!.pendingRevision(techTemplateSlug), "pending revision"));
    expect(revision!.id).toBe(open!.id);
    expect(revision!.proposals).toHaveLength(1);
    expect(revision!.proposals[0]).toMatchObject({ id: proposalId, count: 2 });
    expect(revision!.proposals[0]!.source_judgment_ids).toHaveLength(2);
    expect(sql<{ n: number }>("SELECT count(*) AS n FROM template_revisions WHERE template_slug = ? AND status = 'pending'", techTemplateSlug)[0]!.n).toBe(1);
  }, 120_000);

  it("a different gap adds a second PROPOSAL but never a second pending revision, and the store refuses a second pending revision", async () => {
    answer({ dimension_verdicts: ALL_THREE, missing_dimensions: [{ question: "Who owns the on-call?" }, { question: "Bogus same_as", same_as: "prop-does-not-exist" }] });
    await review(spec);
    const revision = await rig.withApp(async (app) => must(app.templateGrowthService!.pendingRevision(techTemplateSlug), "pending revision"));
    expect(revision!.proposals.map((p) => p.question)).toEqual(["How is it rolled back?", "Who owns the on-call?", "Bogus same_as"]);
    expect(sql<{ n: number }>("SELECT count(*) AS n FROM template_revisions WHERE template_slug = ?", techTemplateSlug)[0]!.n).toBe(1);

    const store = new SQLiteStore(rig.dbPath);
    let refused: { ok: boolean };
    try {
      refused = await store.insertTemplateRevision({ id: "rev-second", template_slug: techTemplateSlug, base_version: 1, created_at: new Date().toISOString() });
    } finally {
      store.close();
    }
    expect(refused.ok).toBe(false);
    expect(sql<{ n: number }>("SELECT count(*) AS n FROM template_revisions WHERE template_slug = ? AND status = 'pending'", techTemplateSlug)[0]!.n).toBe(1);
  }, 120_000);

  it("two templates keep separate pending revisions", async () => {
    const featureSpec = await createSpec("feature", "Judged feature spec");
    answer({ dimension_verdicts: ALL_THREE, missing_dimensions: [{ question: "Feature-only question?" }] });
    await review(featureSpec);

    const [tech, feature] = await rig.withApp(async (app) => [
      await must(app.templateGrowthService!.pendingRevision(techTemplateSlug), "tech revision"),
      await must(app.templateGrowthService!.pendingRevision(featureTemplateSlug), "feature revision"),
    ]);
    expect(feature).not.toBeNull();
    expect(feature!.id).not.toBe(tech!.id);
    expect(feature!.proposals.map((p) => p.question)).toEqual(["Feature-only question?"]);
    expect(tech!.proposals.map((p) => p.question)).not.toContain("Feature-only question?");
  }, 120_000);

  it("approving the revision turns accepted proposals into dimensions and records why the others were dropped; a missing decision is refused", async () => {
    const open = await rig.withApp(async (app) => must(app.templateGrowthService!.pendingRevision(techTemplateSlug), "pending revision"));
    const [rollback, oncall, bogus] = open!.proposals;

    const refused = await rig.withApp(async (app) =>
      app.templateGrowthService!.approveRevision(techTemplateSlug, [{ proposal_id: rollback!.id, decision: "accepted", dimension_id: "rollback" }], "human:test"),
    );
    expect(refused.ok).toBe(false);
    expect(await templateState(techTemplateSlug)).toMatchObject({ status: "approved", dimensions: ["edge-cases", "failure-modes", "evidence"], version: 1 });

    const noReason = await rig.withApp(async (app) =>
      app.templateGrowthService!.approveRevision(
        techTemplateSlug,
        [
          { proposal_id: rollback!.id, decision: "accepted", dimension_id: "rollback" },
          { proposal_id: oncall!.id, decision: "dropped", reason: "  " },
          { proposal_id: bogus!.id, decision: "dropped", reason: "not a real gap" },
        ],
        "human:test",
      ),
    );
    expect(noReason.ok).toBe(false);

    const approved = await rig.withApp(async (app) =>
      must(
        app.templateGrowthService!.approveRevision(
          techTemplateSlug,
          [
            { proposal_id: rollback!.id, decision: "accepted", dimension_id: "rollback" },
            { proposal_id: oncall!.id, decision: "dropped", reason: "ownership is a process question, not a spec dimension" },
            { proposal_id: bogus!.id, decision: "dropped", reason: "not a real gap" },
          ],
          "human:test",
        ),
        "approve revision",
      ),
    );
    expect(approved.status).toBe("approved");
    expect(approved.proposals.find((p) => p.id === rollback!.id)).toMatchObject({ decision: "accepted", dimension_id: "rollback" });
    expect(approved.proposals.find((p) => p.id === oncall!.id)).toMatchObject({ decision: "dropped", drop_reason: "ownership is a process question, not a spec dimension" });
    expect(approved.proposals.find((p) => p.id === bogus!.id)).toMatchObject({ decision: "dropped", drop_reason: "not a real gap" });

    // the accepted proposal is now a dimension of the next template version (an ordinary template edit: draft until approved)
    expect(await templateState(techTemplateSlug)).toEqual({ status: "draft", dimensions: ["edge-cases", "failure-modes", "evidence", "rollback"], version: 2 });
    const stillOne = await rig.withApp(async (app) => must(app.templateGrowthService!.pendingRevision(techTemplateSlug), "pending revision"));
    expect(stillOne).toBeNull();
  }, 120_000);
});

describe(`${ID} prompt v8 stays frozen for a legacy document`, () => {
  it("the v8 builder is byte-identical to its frozen fixture for a spec, a plan and an ADR", () => {
    const frozen = JSON.parse(
      readFileSync(new URL("../../fixtures/design-necessity/review-prompt-v8-frozen.json", import.meta.url), "utf8"),
    ) as Record<string, string>;
    for (const kind of ["spec", "plan", "adr"] as const) {
      const prompt = REVIEW_TEMPLATES["v8"]!(FROZEN_BUNDLES[kind], FROZEN_CHECKS, FROZEN_BUDGETS, FROZEN_NOW).prompt;
      expect(prompt).toBe(frozen[`v8:${kind}`]);
    }
  });

  it("a legacy document is reviewed under v8 with no template_ref and no verdict rows, even when the judge sends verdicts", async () => {
    const created = await rig.lore(["create", "spec", "--title", "Legacy spec", "--no-ai", "--content", "## Overview/Goal\n\nLegacy body.", "--json"]);
    expect(created.exitCode, created.stderr).toBe(0);
    const slug = (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
    answer({ dimension_verdicts: ALL_THREE, missing_dimensions: [{ question: "Ignored for a legacy document" }] });
    await review(slug);
    const judgment = latestJudgment(await docId(slug));
    expect(judgment.judge_prompt_version).toBe("v8");
    expect(judgment.template_ref).toBeNull();
    expect(dimensionRows(judgment.id)).toHaveLength(0);
    expect(readFileSync(promptFile(), "utf8")).not.toContain("Template Dimensions");
  }, 120_000);
});
