/**
 * Plans are judged by default: with default review settings a plan whose current version carries a
 * reject judgment cannot be approved (exit 4, `review-judgment` checkpoint named, plan stays draft);
 * a project that lists its own judged types as `[spec]` approves the same plan (exit 0).
 *
 * Throwaway corpus (mkdtemp + `lore init`), commands run in-process, the reject judgment is seeded as
 * the `review_judgments` row the gate reads — no real AI call, never the repo's own `.lore/`.
 *
 * Six-dimension coverage:
 *   HAPPY:      judged types `[spec]` approves the plan carrying a reject (exit 0, status approved)
 *   NEGATIVE:   default settings refuse the plan carrying a reject (exit 4, names review-judgment)
 *   BOUNDARY:   a plan with an approve judgment of its current version approves under the default
 *   ERROR:      a plan with no judgment at all is refused under the default (names `lore review`)
 *   STATE:      the refused plan is still draft afterwards
 *   REGRESSION: a type outside the default list (knowledge reference) still approves without judgment
 */

import { afterEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

interface DocEnvelope {
  id: string;
  slug: string;
  version: number;
  status: string;
}

async function runLore(args: string[], cwd: string) {
  const proc = await runLoreInProcess(args, {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.exitCode };
}

async function mustRun(args: string[], cwd: string): Promise<string> {
  const result = await runLore(args, cwd);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed: ${result.stderr}${result.stdout}`);
  return result.stdout;
}

async function createDraftPlan(dir: string): Promise<DocEnvelope> {
  const prd = JSON.parse(await mustRun(["create", "prd", "--title", "Root PRD", "--content", "x", "--json"], dir)) as {
    data: DocEnvelope;
  };
  const plan = JSON.parse(
    await mustRun(
      ["create", "plan", "--title", "Plan Under Judgment", "--parent", prd.data.slug, "--content", "## Overview\n\nBody.", "--json"],
      dir,
    ),
  ) as { data: DocEnvelope };
  return await getDoc(dir, plan.data.slug);
}

async function getDoc(dir: string, slug: string): Promise<DocEnvelope> {
  const out = JSON.parse(await mustRun(["get", slug, "--json"], dir)) as { data: { doc: DocEnvelope } };
  return out.data.doc;
}

let seedCounter = 0;

/** Direct insert of the `review_judgments` row `ReviewService.approve`'s review-judgment checkpoint reads. */
function insertRawJudgment(dir: string, docId: string, docVersion: number, decision: "approve" | "reject"): void {
  const db = new Database(join(dir, ".lore", "lore.db"));
  try {
    db.run(
      `INSERT INTO review_judgments
        (id, doc_id, doc_version, decision, confidence, reasons, checks, blocking_questions,
         judge_provider, judge_model, judge_prompt_version, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `judgment-seed-${++seedCounter}`,
        docId,
        docVersion,
        decision,
        0.9,
        JSON.stringify([{ dimension: "design_necessity", finding: "seeded for test" }]),
        JSON.stringify([{ check: "schema", outcome: "pass" }]),
        JSON.stringify([]),
        "test-judge",
        "test-model",
        "v4",
        new Date().toISOString(),
        "ai:test-judge:test-model:v4",
      ],
    );
  } finally {
    db.close();
  }
}

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

async function freshCorpus(prefix: string): Promise<string> {
  tmpDir = mkdtempSync(join(tmpdir(), prefix));
  await mustRun(["init"], tmpDir);
  return tmpDir;
}

describe("plans are judged by default", () => {
  it("NEGATIVE/STATE: default settings refuse a plan carrying a reject verdict (exit 4) and it stays draft", async () => {
    const dir = await freshCorpus("lore-plan-judged-default-");
    const plan = await createDraftPlan(dir);
    insertRawJudgment(dir, plan.id, plan.version, "reject");

    const result = await runLore(["approve", plan.slug], dir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("review-judgment");
    expect(result.stderr).toContain("JUDGMENT_REJECTED");
    expect((await getDoc(dir, plan.slug)).status).toBe("draft");
  });

  it("HAPPY: a project judging only [spec] approves the same plan (exit 0)", async () => {
    const dir = await freshCorpus("lore-plan-judged-speconly-");
    const plan = await createDraftPlan(dir);
    writeFileSync(
      join(dir, ".lore", "config.yaml"),
      `project:\n  name: test\n  author: test\nworkflow:\n  review:\n    judgment_required_types: [spec]\n`,
      "utf8",
    );
    insertRawJudgment(dir, plan.id, plan.version, "reject");

    const result = await runLore(["approve", plan.slug], dir);
    expect(result.exitCode).toBe(0);
    expect((await getDoc(dir, plan.slug)).status).toBe("approved");
  });

  it("ERROR: default settings refuse a never-judged plan, naming lore review", async () => {
    const dir = await freshCorpus("lore-plan-judged-none-");
    const plan = await createDraftPlan(dir);

    const result = await runLore(["approve", plan.slug], dir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("lore review");
  });

  it("BOUNDARY: default settings approve a plan whose current version carries an approve judgment", async () => {
    const dir = await freshCorpus("lore-plan-judged-approve-");
    const plan = await createDraftPlan(dir);
    insertRawJudgment(dir, plan.id, plan.version, "approve");
    const result = await runLore(["approve", plan.slug], dir);
    expect(result.exitCode).toBe(0);
    expect((await getDoc(dir, plan.slug)).status).toBe("approved");
  });

  it("REGRESSION: a knowledge reference doc still approves without any judgment under the default", async () => {
    const dir = await freshCorpus("lore-plan-judged-knowledge-");
    const prd = JSON.parse(await mustRun(["create", "prd", "--title", "Root PRD", "--content", "x", "--json"], dir)) as {
      data: DocEnvelope;
    };
    const knowledge = JSON.parse(
      await mustRun(
        ["create", "knowledge", "--sub-type", "reference", "--title", "Ref", "--parent", prd.data.slug, "--content", "x", "--json"],
        dir,
      ),
    ) as { data: DocEnvelope };

    const result = await runLore(["approve", knowledge.data.slug], dir);
    expect(result.exitCode).toBe(0);
  });
});
