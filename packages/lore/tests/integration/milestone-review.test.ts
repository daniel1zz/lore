// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D; AC-LG-12; BR-1372)
 *
 * `lore assess` is the binding milestone review and plan close requires only a passing review of the plan's
 * CURRENT state. Everything runs on a throwaway corpus (`mkdtemp` + `lore init`, git tree kept clean) with a hermetic
 * shell script as the AI judge — never a real model and never the repo's own `.lore/`.
 *
 * Dimensions: HAPPY (a passing review lets the plan close with no exemption), NEGATIVE (no review, a failing
 * dimension, a forged review doc, no selector, --no-ai), BOUNDARY (a plan with no tasks closes as not-applicable),
 * ERROR (an unparsable judge answer stores nothing), STATE (a task edit after the review makes it stale, a re-run
 * makes it current), REGRESSION (the removed exemption commands are gone; batch rows fail alone).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as core from "@lore/core";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

function runLore(args: string[], cwd: string): RunResult {
  const proc = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: "agent:milestone-review-test" },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.status ?? 1 };
}

const DIMENSIONS = [
  "correctness_vs_acs",
  "spec_conformance",
  "regression",
  "design_necessity",
  "snapshot_accuracy",
  "concurrency_safety",
  "security",
] as const;

function judgeAnswer(overrides: Record<string, { verdict: string; reason: string; reference: string }> = {}): string {
  const dimensions = Object.fromEntries(
    DIMENSIONS.map((d) => [d, overrides[d] ?? { verdict: "pass", reason: `${d} holds`, reference: "Google engineering code review guide" }]),
  );
  return JSON.stringify({ dimensions });
}

interface AssessRow {
  plan: string;
  outcome: string;
  review: string | null;
  failed: string[];
  reason: string;
}

let tmpDir: string;
let judgeDir: string;
let prdSlug: string;
let counter = 0;

function slugOf(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no slug in create output: ${stdout}`);
  return slug;
}

/** The judge answers the file `answer.json`, or `fail.json` when the prompt contains FAILMARK. */
function installJudge(pass: string, fail: string): void {
  writeFileSync(join(judgeDir, "pass.json"), pass);
  writeFileSync(join(judgeDir, "fail.json"), fail);
  const script = join(judgeDir, "judge.sh");
  writeFileSync(
    script,
    `#!/bin/sh\ninput=$(cat)\ncase "$input" in *FAILMARK*) cat "${join(judgeDir, "fail.json")}";; *) cat "${join(judgeDir, "pass.json")}";; esac\n`,
  );
  chmodSync(script, 0o755);
  patchLoreConfig(tmpDir, {
    ai: { provider: "claude-cli", providers: { "claude-cli": { command: script, args: [], timeout_ms: 20000 } } },
  });
}

/** An approved plan under the PRD with one task holding attested evidence. */
function makePlan(title: string): { plan: string; task: string } {
  counter += 1;
  const plan = slugOf(runLore(["create", "plan", "--title", `${title} ${counter}`, "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir).stdout);
  const task = slugOf(
    runLore(["create", "task", "--title", `Work ${title} ${counter}`, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai"], tmpDir).stdout,
  );
  addPass(task);
  expect(runLore(["set", plan, "--status", "approved"], tmpDir).exitCode).toBe(0);
  return { plan, task };
}

function addPass(task: string): void {
  const r = runLore(["evidence", task, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"], tmpDir);
  expect(r.exitCode, r.stderr).toBe(0);
}

function assessRows(args: string[]): { exitCode: number; rows: AssessRow[]; stderr: string } {
  const r = runLore(["assess", ...args, "--json"], tmpDir);
  const parsed = r.stdout.trim().length > 0 ? (JSON.parse(r.stdout) as { data: { rows: AssessRow[] } }) : undefined;
  return { exitCode: r.exitCode, rows: parsed?.data.rows ?? [], stderr: r.stderr };
}

function statusOf(slug: string): string {
  const r = runLore(["get", slug, "--json"], tmpDir);
  const parsed = JSON.parse(r.stdout) as { data?: { doc?: { status: string } }; status?: string };
  return parsed.data?.doc?.status ?? parsed.status ?? `unreadable: ${r.stdout.slice(0, 200)}`;
}

function close(plan: string): RunResult {
  return runLore(["set", plan, "--status", "archived"], tmpDir);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-milestone-review-test-"));
  judgeDir = mkdtempSync(join(tmpdir(), "lore-milestone-judge-"));
  makeCleanTreeRepo(tmpDir);
  expect(runLore(["init"], tmpDir).exitCode).toBe(0);
  patchLoreConfig(tmpDir, "workflow:\n  review:\n    judgment_required_types: []\n");
  installJudge(judgeAnswer(), judgeAnswer());
  const prd = runLore(["create", "prd", "--title", "Review PRD", "--content", "root", "--no-ai"], tmpDir);
  expect(prd.exitCode).toBe(0);
  prdSlug = slugOf(prd.stdout);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(judgeDir, { recursive: true, force: true });
});

describe("milestone review gates close", () => {
  it("milestone review gates close: a plan with no review is refused (exit 4, BR-1372) and stays open", { timeout: 300_000 }, () => {
    const { plan } = makePlan("No review");
    const refused = close(plan);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("MILESTONE_REVIEW_MISSING");
    expect(refused.stderr).toContain("BR-1372");
    expect(refused.stderr).toContain(`lore assess ${plan}`);
    expect(statusOf(plan)).toBe("approved");
  });

  it("milestone review gates close: a passing current review closes the plan with no exemption and no other predicate", { timeout: 300_000 }, () => {
    const { plan } = makePlan("Passing");
    const review = assessRows([plan]);
    expect(review.exitCode, review.stderr).toBe(0);
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]?.outcome).toBe("PASS");
    expect(review.rows[0]?.review).toMatch(/^knowledge-milestone-review/);
    const closed = close(plan);
    expect(closed.exitCode, closed.stderr).toBe(0);
    expect(statusOf(plan)).toBe("archived");
  });

  it("milestone review gates close: a failing dimension refuses the close even though the review is current", { timeout: 300_000 }, () => {
    const { plan } = makePlan("Failing");
    installJudge(
      judgeAnswer({ security: { verdict: "fail", reason: "unvalidated input reaches a shell", reference: "OWASP command injection" } }),
      judgeAnswer(),
    );
    const review = assessRows([plan]);
    expect(review.exitCode).toBe(1);
    expect(review.rows[0]?.outcome).toBe("FAIL");
    expect(review.rows[0]?.failed).toEqual(["security"]);
    const refused = close(plan);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("MILESTONE_REVIEW_FAILED");
    expect(refused.stderr).toContain("security");
    expect(statusOf(plan)).toBe("approved");
  });

  it("milestone review gates close: design_necessity without a reference is a fail whatever the judge said", { timeout: 300_000 }, () => {
    const { plan } = makePlan("No reference");
    installJudge(
      judgeAnswer({ design_necessity: { verdict: "pass", reason: "needed", reference: "" } }),
      judgeAnswer(),
    );
    const review = assessRows([plan]);
    expect(review.exitCode).toBe(1);
    expect(review.rows[0]?.failed).toEqual(["design_necessity"]);
    expect(close(plan).exitCode).toBe(4);
  });

  it("milestone review gates close: a task changed after the review makes it stale; a new review makes it current", { timeout: 300_000 }, () => {
    const { plan, task } = makePlan("Stale");
    expect(assessRows([plan]).exitCode).toBe(0);
    addPass(task);
    const stale = close(plan);
    expect(stale.exitCode).toBe(4);
    expect(stale.stderr).toContain("MILESTONE_REVIEW_STALE");
    expect(statusOf(plan)).toBe("approved");
    expect(assessRows([plan]).exitCode).toBe(0);
    const closed = close(plan);
    expect(closed.exitCode, closed.stderr).toBe(0);
  });

  it("milestone review gates close: a plan with no tasks has nothing to review and closes", { timeout: 300_000 }, () => {
    counter += 1;
    const plan = slugOf(runLore(["create", "plan", "--title", `Empty ${counter}`, "--parent", prdSlug, "--content", "x", "--no-ai"], tmpDir).stdout);
    expect(runLore(["set", plan, "--status", "approved"], tmpDir).exitCode).toBe(0);
    const review = assessRows([plan]);
    expect(review.exitCode).toBe(1);
    expect(review.rows[0]?.outcome).toBe("ERROR");
    expect(review.rows[0]?.reason).toContain("zero child tasks");
    const closed = close(plan);
    expect(closed.exitCode, closed.stderr).toBe(0);
    expect(statusOf(plan)).toBe("archived");
  });

  it("milestone review gates close: batch assess gives one row per plan, a failing row does not stop the others, exit 1", { timeout: 300_000 }, () => {
    const good = makePlan("Good batch");
    const bad = makePlan("FAILMARK batch");
    installJudge(
      judgeAnswer(),
      judgeAnswer({ regression: { verdict: "fail", reason: "breaks the old path", reference: "Kayenta canary analysis" } }),
    );
    const byIds = assessRows([good.plan, bad.plan]);
    expect(byIds.exitCode).toBe(1);
    const byPlan = new Map(byIds.rows.map((r) => [r.plan, r]));
    expect(byPlan.get(good.plan)?.outcome).toBe("PASS");
    expect(byPlan.get(bad.plan)?.outcome).toBe("FAIL");
    expect(byPlan.get(bad.plan)?.failed).toEqual(["regression"]);
    // --where selects the same plans through the bulk selector.
    const byWhere = assessRows(["--where", "type=plan,status=approved"]);
    expect(byWhere.rows.map((r) => r.plan).sort()).toEqual([good.plan, bad.plan].sort());
    expect(byWhere.exitCode).toBe(1);
    // the passing plan closes, the failing one does not.
    expect(close(good.plan).exitCode).toBe(0);
    expect(close(bad.plan).exitCode).toBe(4);
  });

  it("milestone review gates close: usage errors exit 2 and store nothing", { timeout: 300_000 }, () => {
    const { plan } = makePlan("Usage");
    expect(runLore(["assess"], tmpDir).exitCode).toBe(2);
    expect(runLore(["assess", plan, "--where", "type=plan"], tmpDir).exitCode).toBe(2);
    expect(runLore(["assess", "--where", "colour=red"], tmpDir).exitCode).toBe(2);
    expect(runLore(["assess", plan, "--no-ai"], tmpDir).exitCode).toBe(2);
    expect(close(plan).stderr).toContain("MILESTONE_REVIEW_MISSING");
  });

  it("milestone review gates close: an unparsable judge answer stores no review and the plan stays unclosable", { timeout: 300_000 }, () => {
    const { plan } = makePlan("Garbage");
    installJudge("not json at all", "not json at all");
    const review = assessRows([plan]);
    expect(review.exitCode).toBe(1);
    expect(review.rows[0]?.outcome).toBe("ERROR");
    expect(review.rows[0]?.reason).toContain("AI_PROVIDER_ERROR");
    expect(close(plan).stderr).toContain("MILESTONE_REVIEW_MISSING");
  });

  it("milestone review gates close: a review cannot be forged through lore create", { timeout: 300_000 }, () => {
    const { plan } = makePlan("Forged");
    const forged = runLore(["create", "knowledge", "--title", "Forged review", "--sub-type", "milestone-review", "--parent", plan, "--content", "x", "--no-ai"], tmpDir);
    expect(forged.exitCode).not.toBe(0);
    expect(close(plan).stderr).toContain("MILESTONE_REVIEW_MISSING");
  });

  it("milestone review gates close: the plan-level exemption commands no longer exist", { timeout: 300_000 }, () => {
    const { plan } = makePlan("Exempt");
    for (const sub of ["exempt-attestation", "exempt-assessment-freshness"]) {
      const r = runLore(["plan", sub, plan, "--reason", "because", "--kind", "other"], tmpDir);
      expect(r.exitCode, sub).not.toBe(0);
    }
    expect(close(plan).stderr).toContain("MILESTONE_REVIEW_MISSING");
  });
  it("milestone review gates close: no code path parses the legacy assessment schema; an archived legacy assessment shows its raw body", { timeout: 300_000 }, async () => {
    // The legacy plan-outcome schema, its facts and its renderer are gone from the public surface.
    const surface = core as Record<string, unknown>;
    for (const name of ["assessmentResultSchema", "llmAssessmentOutputSchema", "computeAssessmentFacts", "renderAssessmentContent", "computeScopeMismatchWarning"]) {
      expect(surface[name], name).toBeUndefined();
    }
    // A knowledge doc whose sub_type is "assessment" no longer needs (or is checked against) an extra.assessment payload.
    expect(core.knowledgeExtraSchema.safeParse({ sub_type: "assessment" }).success).toBe(true);
    expect(core.knowledgeExtraSchema.safeParse({ sub_type: "assessment", assessment: { verdict: 42 } }).success).toBe(true);

    // An archived legacy doc (payload a legacy parse would reject) reads back as its raw body.
    const created = runLore(["create", "knowledge", "--title", "Legacy plan outcome", "--sub-type", "research", "--content", "RAWBODY legacy assessment text", "--no-ai"], tmpDir);
    expect(created.exitCode, created.stderr).toBe(0);
    const slug = slugOf(created.stdout);
    const { Database } = await import("bun:sqlite");
    const db = new Database(join(tmpDir, ".lore", "lore.db"));
    db.run("UPDATE docs SET status = 'archived', extra = ? WHERE slug = ?", [
      JSON.stringify({ sub_type: "assessment", assessment: { verdict: 42, ac_scores: "not-an-array" } }),
      slug,
    ]);
    db.close();
    const read = runLore(["get", slug], tmpDir);
    expect(read.exitCode, read.stderr).toBe(0);
    expect(read.stdout).toContain("RAWBODY legacy assessment text");

    // Nothing may write a new one.
    const forged = runLore(["create", "knowledge", "--title", "New assessment", "--sub-type", "assessment", "--content", "x", "--no-ai"], tmpDir);
    expect(forged.exitCode).not.toBe(0);
    expect(forged.stderr).toContain("assessment");
  });
});
