// @spawns assets/hooks/post-ask-decide.mjs
// @spawns packages/lore/src/index.ts
// @reads assets/**
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
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/** Extra environment of every spawn: the fake `gh` first on PATH and its state directory (set in `beforeEach`). */
let extraEnv: Record<string, string> = {};

function runLore(args: string[], cwd: string): RunResult {
  const proc = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: "agent:milestone-review-test", ...extraEnv },
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
    `#!/bin/sh\ninput=$(cat)\nprintf '%s\\n=====PROMPT=====\\n' "$input" >> "${join(judgeDir, "prompts.txt")}"\ncase "$input" in *FAILMARK*) cat "${join(judgeDir, "fail.json")}";; *) cat "${join(judgeDir, "pass.json")}";; esac\n`,
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

/**
 * The project's own scripts are the fake suite runner: `check:plan-close` and `test` echo, `test` appends one line to a
 * counter file per run and reports one failing file. Committed on `main`, so the throwaway worktree the batch run
 * creates contains them.
 */
function installFakeSuiteScripts(): void {
  const scripts = {
    "check:plan-close": "echo chain-ok",
    test: `echo run >> '${join(judgeDir, "suite-runs.txt")}'; echo ' FAIL  tests/unrelated.test.ts > breaks'; exit 1`,
  };
  writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "fixture", private: true, scripts }));
  for (const args of [["add", "package.json"], ["commit", "-q", "-m", "fixture scripts"]]) {
    const r = spawnSync("git", args, { cwd: tmpDir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  }
}

/** The fake issue port: a `gh` on PATH over a JSON state file (`issues.json`; every POST appends to it and to `posts.log`). */
function installFakeGh(): void {
  const stateDir = join(judgeDir, "gh-state");
  mkdirSync(join(judgeDir, "bin"), { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "issues.json"), "[]");
  const script = join(judgeDir, "bin", "gh");
  writeFileSync(
    script,
    `#!/usr/bin/env bun
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const dir = ${JSON.stringify(stateDir)};
const args = process.argv.slice(2);
const issues = () => JSON.parse(readFileSync(dir + "/issues.json", "utf8"));
const path = args[1];
if (path === "user") console.log(JSON.stringify({ login: "fake" }));
else if (path === "repos/o/r") console.log(JSON.stringify({ id: 777 }));
else if (path === "repos/o/r/issues?state=all&per_page=100") console.log(JSON.stringify(issues()));
else if (path === "repos/o/r/issues" && args.includes("POST")) {
  const field = (name) => (args.find((a) => a.startsWith(name + "=")) ?? "").slice(name.length + 1);
  const all = issues();
  const number = all.length + 1;
  all.push({ number, title: field("title"), state: "open", body: field("body"), labels: [], created_at: "2026-10-23T00:00:00Z" });
  writeFileSync(dir + "/issues.json", JSON.stringify(all));
  appendFileSync(dir + "/posts.log", field("title") + "\\n");
  console.log(JSON.stringify({ number, html_url: "https://example.invalid/o/r/issues/" + number }));
} else { console.error("fake gh: unsupported " + args.join(" ")); process.exit(1); }
`,
  );
  chmodSync(script, 0o755);
  extraEnv = { PATH: `${join(judgeDir, "bin")}:${process.env["PATH"] ?? ""}` };
}

function configureGithubUpstream(): void {
  patchLoreConfig(tmpDir, { feedback: { upstream: { repo: "o/r" } } });
}

function readJudgeFile(name: string): string {
  return existsSync(join(judgeDir, name)) ? readFileSync(join(judgeDir, name), "utf8") : "";
}

interface AskedQuestion {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

const HOOK_SHIM_DIRS: string[] = [];
const ASK_HOOK = join(PROJECT_ROOT, "..", "..", "assets", "hooks", "post-ask-decide.mjs");

/** A directory holding a `lore` script that runs the source entry; first on PATH for the shipped ask hook. */
function loreShimDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-ask-shim-"));
  HOOK_SHIM_DIRS.push(dir);
  const shim = join(dir, "lore");
  writeFileSync(shim, `#!/bin/sh\nexec bun run "${INDEX_TS}" "$@"\n`);
  chmodSync(shim, 0o755);
  return dir;
}

/** Ids of the open pending decisions (`lore pending --json`). */
function pendingIds(): number[] {
  const r = runLore(["pending", "--json"], tmpDir);
  expect(r.exitCode, r.stderr).toBe(0);
  const parsed = JSON.parse(r.stdout) as { data?: { pending?: { id: number }[]; decisions?: { id: number }[] } };
  return (parsed.data?.pending ?? parsed.data?.decisions ?? []).map((p) => p.id);
}

/** The in-session answer: `lore pending --ask` writes the question, the shipped PostToolUse hook records the answer. */
function answerPending(label: "Accept" | "Reject"): void {
  const asked = runLore(["pending", "--ask"], tmpDir);
  expect(asked.exitCode, asked.stderr).toBe(0);
  const questions = (JSON.parse(asked.stdout) as { data: { questions: AskedQuestion[] } }).data.questions;
  expect(questions).toHaveLength(1);
  const question = questions[0] as AskedQuestion;
  expect(question.question).toContain("acceptance criteria retired");
  const shim = loreShimDir();
  const payload = {
    session_id: "sess-retire-test",
    cwd: tmpDir,
    permission_mode: "default",
    hook_event_name: "PostToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions },
    tool_response: { questions, answers: { [question.question]: label }, annotations: {} },
    tool_use_id: "toolu_retire_test",
  };
  const hook = spawnSync("node", [ASK_HOOK], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { PATH: `${shim}:${process.env["PATH"] ?? ""}`, HOME: tmpDir, CLAUDE_STATE_BASE_OVERRIDE: join(judgeDir, "state") },
    timeout: 120_000,
  });
  expect(hook.status, hook.stderr).toBe(0);
  expect(hook.stdout).toContain(label === "Accept" ? "accepted" : "rejected");
}

function createSpec(title: string): string {
  const r = runLore(["create", "spec", "--title", title, "--content", "## Overview/Goal\nx\n\n## Scope\nx\n\n## Acceptance Criteria\nx\n", "--no-ai"], tmpDir);
  expect(r.exitCode, `${r.stderr}${r.stdout}`).toBe(0);
  return slugOf(r.stdout);
}

/** Two specs; `old` has two ACs, both superseded by `fresh`'s AC (the feature they described was removed). */
function retireTwoAcs(env: Record<string, string> = {}): { old: string; fresh: string } {
  const prev = extraEnv;
  extraEnv = { ...extraEnv, ...env };
  try {
    const old = createSpec("Old feature");
    const fresh = createSpec("New feature");
    for (const [spec, id] of [[old, "AC-OLD-1"], [old, "AC-OLD-2"], [fresh, "AC-NEW-1"]] as const) {
      const added = runLore(["ac", "add", spec, id, "--statement", `${id} holds`, "--mode", "human"], tmpDir);
      expect(added.exitCode, added.stderr).toBe(0);
    }
    for (const id of ["AC-OLD-1", "AC-OLD-2"]) {
      const sup = runLore(["ac", "supersede", old, id, "--by", `${fresh}:AC-NEW-1`, "--reason", "feature removed"], tmpDir);
      expect(sup.exitCode, sup.stderr).toBe(0);
    }
    return { old, fresh };
  } finally {
    extraEnv = prev;
  }
}

function acSuperseded(spec: string, acId: string): boolean {
  const r = runLore(["get", spec, "--json"], tmpDir);
  expect(r.exitCode, r.stderr).toBe(0);
  const doc = (JSON.parse(r.stdout) as { data: { doc: { extra: { acceptance_criteria: { id: string; superseded_by?: unknown }[] } } } }).data.doc;
  const criterion = doc.extra.acceptance_criteria.find((c) => c.id === acId);
  expect(criterion, `${acId} exists on ${spec}`).toBeDefined();
  return criterion?.superseded_by !== undefined;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-milestone-review-test-"));
  judgeDir = mkdtempSync(join(tmpdir(), "lore-milestone-judge-"));
  makeCleanTreeRepo(tmpDir);
  installFakeSuiteScripts();
  installFakeGh();
  expect(runLore(["init"], tmpDir).exitCode).toBe(0);
  patchLoreConfig(tmpDir, "workflow:\n  review:\n    judgment_required_types: []\n");
  installJudge(judgeAnswer(), judgeAnswer());
  const prd = runLore(["create", "prd", "--title", "Review PRD", "--content", "root", "--no-ai"], tmpDir);
  expect(prd.exitCode).toBe(0);
  prdSlug = slugOf(prd.stdout);
});

afterEach(() => {
  for (const dir of HOOK_SHIM_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
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

  // ── Part D, "Review inputs, measured once per batch" and "Accepted with known defects" (task D4) ──

  it("milestone review gates close: the full suite runs ONCE per batch in a throwaway worktree of main and every plan's review sees it", { timeout: 300_000 }, () => {
    const first = makePlan("Suite one");
    const second = makePlan("Suite two");
    const batch = assessRows(["--where", "type=plan,status=approved"]);
    expect(batch.exitCode, batch.stderr).toBe(0);
    expect(batch.rows.map((r) => r.plan).sort()).toEqual([first.plan, second.plan].sort());
    // one run for two plans: the fake `test` script appends one line per run.
    expect(readJudgeFile("suite-runs.txt").trim().split("\n")).toHaveLength(1);
    // both prompts carry the one run: the chain and the test command, their exits, the failing file.
    const prompts = readJudgeFile("prompts.txt").split("=====PROMPT=====").filter((p) => p.trim().length > 0);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) {
      expect(prompt).toContain("`bun run check:plan-close` exit 0");
      expect(prompt).toContain("`bun run test` exit 1");
      expect(prompt).toContain("tests/unrelated.test.ts");
    }
    // the failing file is not tied to either plan (no landed diff), so neither plan's regression fails.
    expect(batch.rows.every((r) => r.outcome === "PASS")).toBe(true);
    // the throwaway worktree is gone and the shared checkout is untouched.
    const worktrees = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: tmpDir, encoding: "utf8" }).stdout;
    expect(worktrees.split("\n").filter((l) => l.startsWith("worktree "))).toHaveLength(1);
    expect(spawnSync("git", ["status", "--porcelain"], { cwd: tmpDir, encoding: "utf8" }).stdout.trim()).toBe("");
  });

  it("milestone review gates close: a failing test file counts against a plan only when its diff touched the file or a direct import", { timeout: 60_000 }, async () => {
    const { MilestoneReviewService } = await import("../../src/service/milestone-review-service.js");
    const stored: { dimensions: Record<string, { verdict: string; reason: string }> }[] = [];
    const plan = { id: "P1", slug: "plan-p1", title: "Plan P1", content: "x", version: 1, extra: {} };
    const task = { id: "T1", slug: "task-t1", title: "T1", content: "x", status: "archived", version: 1, extra: {} };
    const service = new MilestoneReviewService({
      getPlanBundle: async () => core.ok({ plan, tasks: [task] } as never),
      getCitedRuleStates: async () => core.ok([]),
      listDecisionLog: async () => core.ok([]),
      judge: async () => core.ok(judgeAnswer()),
      createReviewDoc: async (input) => {
        stored.push((input.extra as { milestone_review: (typeof stored)[number] }).milestone_review);
        return core.ok({ id: "R1", slug: "review-1" } as never);
      },
      link: async () => core.ok(undefined),
    });
    const suite = {
      status: "measured" as const,
      commit: "abc123",
      commands: [{ command: "bun run test", exit_code: 1, output_tail: "" }],
      skipped: [],
      failing_test_files: [
        { file: "tests/touches-import.test.ts", imports: ["src/a.ts"] },
        { file: "tests/itself-touched.test.ts", imports: [] },
        { file: "tests/elsewhere.test.ts", imports: ["src/z.ts"] },
      ],
    };
    const diff = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@\n+x\ndiff --git a/tests/itself-touched.test.ts b/tests/itself-touched.test.ts\n@@\n+y\n";
    const withDiff = await service.review("plan-p1", { diffText: diff, diffSource: "test", maxDiffChars: 100_000, suite });
    expect(withDiff.ok).toBe(true);
    const regression = stored[0]?.dimensions["regression"];
    expect(regression?.verdict).toBe("fail");
    expect(regression?.reason).toContain("tests/touches-import.test.ts");
    expect(regression?.reason).toContain("tests/itself-touched.test.ts");
    expect(regression?.reason).not.toContain("tests/elsewhere.test.ts");
    // no landed diff: nothing can be tied to the plan, the judge's pass stands.
    const noDiff = await service.review("plan-p1", { diffSource: "none", maxDiffChars: 100_000, suite });
    expect(noDiff.ok).toBe(true);
    expect(stored[1]?.dimensions["regression"]?.verdict).toBe("pass");
    // a run that was not measured is never read as a failure.
    const unmeasured = await service.review("plan-p1", { diffText: diff, diffSource: "test", maxDiffChars: 100_000, suite: { status: "not_measured", reason: "no main" } });
    expect(unmeasured.ok).toBe(true);
    expect(stored[2]?.dimensions["regression"]?.verdict).toBe("pass");
  });

  it("milestone review gates close: snapshot_accuracy fails only on a contradicted cited rule; stale and unknown are n/a with the reason", { timeout: 60_000 }, async () => {
    const { MilestoneReviewService } = await import("../../src/service/milestone-review-service.js");
    const stored: { overall: string; dimensions: Record<string, { verdict: string; reason: string }> }[] = [];
    const plan = { id: "P1", slug: "plan-p1", title: "Plan P1", content: "x", version: 1, extra: {} };
    const task = { id: "T1", slug: "task-t1", title: "T1", content: "x", status: "archived", version: 1, extra: {} };
    const spec = { id: "S1", slug: "spec-s1", title: "S1", content: "x" };
    let cited: { rule_id: string; state: string; unknown_reason?: string }[] = [];
    const judgeFailsSnapshot = judgeAnswer({ snapshot_accuracy: { verdict: "fail", reason: "rule BR-1 looks stale", reference: "doc drift" } });
    const service = new MilestoneReviewService({
      getPlanBundle: async () => core.ok({ plan, tasks: [task], spec } as never),
      getCitedRuleStates: async () => core.ok(cited),
      listDecisionLog: async () => core.ok([]),
      judge: async () => core.ok(judgeFailsSnapshot),
      createReviewDoc: async (input) => {
        stored.push((input.extra as { milestone_review: (typeof stored)[number] }).milestone_review);
        return core.ok({ id: "R1", slug: "review-1" } as never);
      },
      link: async () => core.ok(undefined),
    });
    cited = [{ rule_id: "BR-1", state: "unknown", unknown_reason: "no-code-anchors" }];
    expect((await service.review("plan-p1", { diffSource: "none", maxDiffChars: 1000 })).ok).toBe(true);
    expect(stored[0]?.dimensions["snapshot_accuracy"]?.verdict).toBe("na");
    expect(stored[0]?.dimensions["snapshot_accuracy"]?.reason).toContain("no-code-anchors");
    expect(stored[0]?.overall).toBe("pass");
    cited = [{ rule_id: "BR-1", state: "contradicted" }, { rule_id: "BR-2", state: "unknown", unknown_reason: "dirty" }];
    expect((await service.review("plan-p1", { diffSource: "none", maxDiffChars: 1000 })).ok).toBe(true);
    expect(stored[1]?.dimensions["snapshot_accuracy"]?.verdict).toBe("fail");
    expect(stored[1]?.overall).toBe("fail");
  });

  /**
   * AC-LG-12 (BR-1372, Part D): stale cited evidence is re-verified ONCE per batch through the injected trusted-runner
   * port before any plan is judged; the rule state is then recomputed. `acResult` is what each citing AC "now" does.
   */
  async function refreshHarness(acResult: "pass" | "fail") {
    const { MilestoneReviewService } = await import("../../src/service/milestone-review-service.js");
    const stored: { overall: string; dimensions: Record<string, { verdict: string; reason: string }> }[] = [];
    const spec = { id: "S1", slug: "spec-s1", title: "S1", content: "x" };
    const bundleOf = (slug: string) => ({
      plan: { id: slug, slug, title: slug, content: "x", version: 1, extra: {} },
      tasks: [{ id: `T-${slug}`, slug: `task-${slug}`, title: "T", content: "x", status: "archived", version: 1, extra: {} }],
      spec,
    });
    let state = "stale";
    const ran: { plan: string; acIds: readonly string[] }[] = [];
    const service = new MilestoneReviewService({
      getPlanBundle: async (ref: string) => core.ok(bundleOf(ref) as never),
      getCitedRuleStates: async () => core.ok([{ rule_id: "BR-1", state, ...(state === "stale" ? { citing_acs: ["AC-A"] } : {}) }]),
      listDecisionLog: async () => core.ok([]),
      judge: async () => core.ok(judgeAnswer({ snapshot_accuracy: { verdict: "fail", reason: "BR-1 looks stale", reference: "doc drift" } })),
      createReviewDoc: async (input) => {
        stored.push((input.extra as { milestone_review: (typeof stored)[number] }).milestone_review);
        return core.ok({ id: "R1", slug: "review-1" } as never);
      },
      link: async () => core.ok(undefined),
    });
    const port = {
      runAcs: async (plan: string, acIds: readonly string[]) => {
        ran.push({ plan, acIds });
        state = acResult === "pass" ? "verified" : "contradicted";
        return core.ok(undefined);
      },
    };
    return { service, stored, ran, port };
  }

  it("milestone review gates close: a stale rule whose citing AC still passes is re-verified, becomes verified and the dimension passes (AC-LG-12 stale-then-verified)", { timeout: 60_000 }, async () => {
    const { service, stored, ran, port } = await refreshHarness("pass");
    const refreshed = await service.refreshStaleCitedRules(["plan-a"], port);
    expect(refreshed.ok).toBe(true);
    expect(ran).toEqual([{ plan: "plan-a", acIds: ["AC-A"] }]);
    expect((await service.review("plan-a", { diffSource: "none", maxDiffChars: 1000 })).ok).toBe(true);
    expect(stored[0]?.dimensions["snapshot_accuracy"]?.verdict).toBe("na");
    expect(stored[0]?.overall).toBe("pass");
  });

  it("milestone review gates close: a stale rule whose citing AC now fails becomes contradicted and the dimension fails (AC-LG-12 stale-then-contradicted)", { timeout: 60_000 }, async () => {
    const { service, stored, port } = await refreshHarness("fail");
    expect((await service.refreshStaleCitedRules(["plan-a"], port)).ok).toBe(true);
    expect((await service.review("plan-a", { diffSource: "none", maxDiffChars: 1000 })).ok).toBe(true);
    expect(stored[0]?.dimensions["snapshot_accuracy"]?.verdict).toBe("fail");
    expect(stored[0]?.dimensions["snapshot_accuracy"]?.reason).toContain("BR-1");
    expect(stored[0]?.overall).toBe("fail");
  });

  it("milestone review gates close: two plans citing the same stale rule run its AC exactly once per batch (AC-LG-12 one run per batch)", { timeout: 60_000 }, async () => {
    const { service, ran, port } = await refreshHarness("pass");
    expect((await service.refreshStaleCitedRules(["plan-a", "plan-b"], port)).ok).toBe(true);
    expect(ran.flatMap((r) => r.acIds)).toEqual(["AC-A"]);
  });

  it("milestone review gates close: a stale rule left unrefreshed is n/a with its reason, never a fail (AC-LG-12 stale is not a disagreement)", { timeout: 60_000 }, async () => {
    const { service, stored } = await refreshHarness("pass");
    expect((await service.review("plan-a", { diffSource: "none", maxDiffChars: 1000 })).ok).toBe(true);
    expect(stored[0]?.dimensions["snapshot_accuracy"]?.verdict).toBe("na");
    expect(stored[0]?.dimensions["snapshot_accuracy"]?.reason).toContain("stale");
  });

  /** A plan whose review fails on `security` and `regression`, with the fake GitHub configured as the upstream. */
  function makeFailedPlan(title: string): string {
    configureGithubUpstream();
    const { plan } = makePlan(title);
    installJudge(
      judgeAnswer({
        security: { verdict: "fail", reason: "unvalidated input reaches a shell", reference: "OWASP command injection" },
        regression: { verdict: "fail", reason: "breaks the old path", reference: "Kayenta canary analysis" },
      }),
      judgeAnswer(),
    );
    expect(assessRows([plan]).rows[0]?.failed).toEqual(["regression", "security"]);
    return plan;
  }

  /** Files an issue through the existing `lore report-issue` path; returns its number. */
  function fileIssue(title: string): number {
    const r = runLore(
      ["report-issue", "--title", title, "--description", "d", "--expected", "e", "--actual", "a", "--severity", "low", "--category", "test", "--json"],
      tmpDir,
    );
    expect(r.exitCode, r.stderr).toBe(0);
    return (JSON.parse(r.stdout) as { data: { number: number } }).data.number;
  }

  /** Links the plan to the corpus task minted for `issueNumber` (the existing `resolves` carrier link). */
  function linkIssue(plan: string, issueNumber: number): void {
    const linked = runLore(["link", plan, `task-gh-777-${String(issueNumber)}`, "--type", "resolves"], tmpDir);
    expect(linked.exitCode, linked.stderr).toBe(0);
  }

  function setIssueState(issueNumber: number, state: "open" | "closed"): void {
    const file = join(judgeDir, "gh-state", "issues.json");
    const all = JSON.parse(readFileSync(file, "utf8")) as { number: number; state: string }[];
    writeFileSync(file, JSON.stringify(all.map((i) => (i.number === issueNumber ? { ...i, state } : i))));
  }

  it("milestone review gates close: a failing review closes as accepted with known defects only when every failed dimension has an OPEN linked issue", { timeout: 300_000 }, () => {
    const plan = makeFailedPlan("Accepted");
    // no linked issue at all: refused, exit 4, even though GitHub has an unrelated open issue.
    expect(fileIssue("unrelated defect")).toBe(1);
    const bare = close(plan);
    expect(bare.exitCode).toBe(4);
    expect(bare.stderr).toContain("MILESTONE_REVIEW_FAILED");
    // one failed dimension covered, the other not: refused.
    expect(fileIssue(`${plan}: security`)).toBe(2);
    linkIssue(plan, 2);
    const partial = close(plan);
    expect(partial.exitCode).toBe(4);
    expect(statusOf(plan)).toBe("approved");
    // both covered but the regression issue is CLOSED on GitHub: refused (only OPEN issues count).
    expect(fileIssue(`${plan}: regression`)).toBe(3);
    linkIssue(plan, 3);
    setIssueState(3, "closed");
    expect(close(plan).exitCode).toBe(4);
    // both open: the close is accepted and the audit records the issue numbers.
    setIssueState(3, "open");
    const accepted = close(plan);
    expect(accepted.exitCode, accepted.stderr).toBe(0);
    expect(statusOf(plan)).toBe("archived");
    const audit = runLore(["audit", plan, "--json"], tmpDir);
    expect(audit.stdout).toContain("accepted with known defects: #2, #3");
  });

  it("milestone review gates close: --file-issues files one issue per failed dimension in one call, links them, and the close is then accepted", { timeout: 300_000 }, () => {
    configureGithubUpstream();
    const { plan } = makePlan("Filed");
    installJudge(
      judgeAnswer({
        security: { verdict: "fail", reason: "unvalidated input reaches a shell", reference: "OWASP command injection" },
        regression: { verdict: "fail", reason: "breaks the old path", reference: "Kayenta canary analysis" },
      }),
      judgeAnswer(),
    );
    const filed = runLore(["assess", plan, "--file-issues", "--json"], tmpDir);
    expect(filed.exitCode, filed.stderr).toBe(1);
    const rows = (JSON.parse(filed.stdout) as { data: { rows: (AssessRow & { filed_issues?: number[] })[] } }).data.rows;
    expect(rows[0]?.outcome).toBe("FAIL");
    expect(rows[0]?.filed_issues).toEqual([1, 2]);
    // one issue per failed dimension: title names plan and dimension, body carries the finding.
    const posts = readFileSync(join(judgeDir, "gh-state", "posts.log"), "utf8").trim().split("\n");
    expect(posts).toEqual([`${plan}: regression`, `${plan}: security`]);
    const listed = JSON.parse(readFileSync(join(judgeDir, "gh-state", "issues.json"), "utf8")) as { body: string }[];
    expect(listed[0]?.body).toContain("breaks the old path");
    expect(listed[1]?.body).toContain("unvalidated input reaches a shell");
    // the issues are linked to the plan, so plan close accepts the failing review.
    const closed = close(plan);
    expect(closed.exitCode, closed.stderr).toBe(0);
    expect(statusOf(plan)).toBe("archived");
    expect(runLore(["audit", plan, "--json"], tmpDir).stdout).toContain("accepted with known defects: #1, #2");
  });

  it("milestone review gates close: --file-issues without a GitHub upstream is refused before any review runs (exit 4)", { timeout: 300_000 }, () => {
    const { plan } = makePlan("No upstream");
    const refused = runLore(["assess", plan, "--file-issues"], tmpDir);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("feedback.upstream");
    expect(readJudgeFile("prompts.txt")).toBe("");
    expect(readJudgeFile("suite-runs.txt")).toBe("");
  });

  it("milestone review gates close: a plan with 2 retired ACs raises ONE pending decision; accept lets the plan close (adr: an AC retires with its feature)", { timeout: 300_000 }, () => {
    const { plan } = makePlan("Retire accept");
    const specs = retireTwoAcs();
    const review = assessRows([plan]);
    expect(review.exitCode, review.stderr).toBe(0);
    const row = review.rows[0] as AssessRow & { retired_acs?: { spec: string; ac: string; superseded_by?: string; reason: string }[]; pending_decision?: number };
    expect(row.retired_acs?.map((r) => `${r.spec}:${r.ac}`).sort()).toEqual([`${specs.old}:AC-OLD-1`, `${specs.old}:AC-OLD-2`]);
    expect(row.retired_acs?.every((r) => r.superseded_by === `${specs.fresh}:AC-NEW-1` && r.reason === "feature removed")).toBe(true);
    expect(typeof row.pending_decision).toBe("number");
    expect(assessRows([plan]).rows[0]).toMatchObject({ pending_decision: row.pending_decision }); // a second run raises nothing new
    expect(pendingIds()).toHaveLength(1);

    const waiting = close(plan);
    expect(waiting.exitCode).toBe(4);
    expect(waiting.stderr).toContain("lore pending --ask");
    expect(statusOf(plan)).toBe("approved");

    answerPending("Accept");
    const closed = close(plan);
    expect(closed.exitCode, closed.stderr).toBe(0);
    expect(statusOf(plan)).toBe("archived");
    expect(acSuperseded(specs.old, "AC-OLD-1")).toBe(true); // accept keeps the retirement
  });

  it("milestone review gates close: reject restores both ACs and keeps the close refused until the plan is re-planned", { timeout: 300_000 }, () => {
    const { plan, task } = makePlan("Retire reject");
    const specs = retireTwoAcs();
    expect(assessRows([plan]).exitCode).toBe(0);
    answerPending("Reject");

    const refused = close(plan);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("rejected");
    expect(statusOf(plan)).toBe("approved");
    expect(acSuperseded(specs.old, "AC-OLD-1")).toBe(false);
    expect(acSuperseded(specs.old, "AC-OLD-2")).toBe(false);
    expect(close(plan).exitCode).toBe(4); // still refused on a second try: restoring is not re-planning

    // re-planning: a task change gives the plan a new state, the refusal lifts and the review is stale until re-run
    expect(runLore(["set", task, "--content", "re-planned after the rejected retirement"], tmpDir).exitCode).toBe(0);
    addPass(task);
    expect(assessRows([plan]).exitCode).toBe(0);
    const closed = close(plan);
    expect(closed.exitCode, closed.stderr).toBe(0);
  });

  it("milestone review gates close: a spec deprecated during the plan lists its ACs; reject puts it back to its previous status", { timeout: 300_000 }, () => {
    const { plan } = makePlan("Retire deprecated");
    const spec = createSpec("Doomed spec");
    expect(runLore(["ac", "add", spec, "AC-DOOM-1", "--statement", "doomed", "--mode", "human"], tmpDir).exitCode).toBe(0);
    const deprecated = runLore(["bulk", "deprecate", spec, "--apply", "--reason", "feature removed"], tmpDir);
    expect(deprecated.exitCode, deprecated.stderr).toBe(0);
    const row = assessRows([plan]).rows[0] as AssessRow & { retired_acs?: { spec: string; ac: string }[] };
    expect(row.retired_acs).toMatchObject([{ spec, ac: "AC-DOOM-1" }]);
    answerPending("Reject");
    expect(close(plan).exitCode).toBe(4);
    expect(statusOf(spec)).toBe("draft");
  });

  it("milestone review gates close: a plan with no retired ACs raises no decision", { timeout: 300_000 }, () => {
    const { plan } = makePlan("No retirement");
    const row = assessRows([plan]).rows[0] as AssessRow & { retired_acs?: unknown; pending_decision?: unknown };
    expect(row.retired_acs).toBeUndefined();
    expect(row.pending_decision).toBeUndefined();
    expect(pendingIds()).toHaveLength(0);
    expect(close(plan).exitCode).toBe(0);
  });

  it("milestone review gates close: a retirement made BEFORE the plan existed is not attributed to it", { timeout: 300_000 }, () => {
    retireTwoAcs();
    const { plan } = makePlan("Later plan");
    const row = assessRows([plan]).rows[0] as AssessRow & { retired_acs?: unknown };
    expect(row.retired_acs).toBeUndefined();
    expect(pendingIds()).toHaveLength(0);
    expect(close(plan).exitCode).toBe(0);
  });

  it("milestone review gates close: a failing review with no linked open issue still refuses the close (exit 4, BR-1372)", { timeout: 300_000 }, () => {
    const plan = makeFailedPlan("Unlinked");
    const refused = close(plan);
    expect(refused.exitCode).toBe(4);
    expect(refused.stderr).toContain("MILESTONE_REVIEW_FAILED");
    expect(refused.stderr).toContain("BR-1372");
    expect(refused.stderr).toContain("--file-issues");
    expect(statusOf(plan)).toBe("approved");
  });
});
