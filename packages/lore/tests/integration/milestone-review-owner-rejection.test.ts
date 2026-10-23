// @spawns assets/hooks/post-ask-decide.mjs
// @spawns packages/lore/src/index.ts
// @reads assets/**
/**
 * @spec_ref spec-lean-governance-batch-verbs-judgment-only-at-milestones (Part D; BR-1372, BR-1307)
 *
 * The owner's rejection of a retired-AC confirmation restores a spec deprecated during the plan exactly: its previous
 * status AND the proposed rule ids its deprecation abandoned (#337). Throwaway corpus per test (`mkdtemp` + `lore init`,
 * clean git tree), a hermetic shell script as the AI judge, the shipped ask hook as the owner's answer.
 *
 * Dimensions: HAPPY (reject restores status and rule), STATE (rule retired after deprecation, proposed after reject),
 * REGRESSION (a second settle changes nothing; the shared serializer equals the CLI row's fields).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { retirementAssessFields } from "../../src/service/retired-ac-service.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}
interface AssessRow {
  plan: string;
  retired_acs?: Parameters<typeof retirementAssessFields>[0] extends infer S ? (S extends { state: "pending"; retired: infer R } ? R : never) : never;
  pending_decision?: number;
}
interface AskedQuestion {
  question: string;
}

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");
const ASK_HOOK = join(PROJECT_ROOT, "..", "..", "assets", "hooks", "post-ask-decide.mjs");
const DIMENSIONS = ["correctness_vs_acs", "spec_conformance", "regression", "design_necessity", "snapshot_accuracy", "concurrency_safety", "security"];

let tmpDir: string;
let judgeDir: string;
let prdSlug: string;
let counter = 0;
const shimDirs: string[] = [];

function runLore(args: string[]): RunResult {
  const proc = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: tmpDir,
    encoding: "utf8",
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: "agent:milestone-review-test" },
  });
  return { stdout: proc.stdout, stderr: proc.stderr, exitCode: proc.status ?? 1 };
}

function must(args: string[]): string {
  const r = runLore(args);
  expect(r.exitCode, `lore ${args.join(" ")}: ${r.stderr}${r.stdout}`).toBe(0);
  return r.stdout;
}

function slugOf(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1] ?? stdout.match(/Created baseline \w+ (\S+) \(/)?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
}

function installJudge(): void {
  const answer = JSON.stringify({
    dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, { verdict: "pass", reason: `${d} holds`, reference: "Google engineering code review guide" }])),
  });
  writeFileSync(join(judgeDir, "pass.json"), answer);
  const script = join(judgeDir, "judge.sh");
  writeFileSync(script, `#!/bin/sh\ncat >/dev/null\ncat "${join(judgeDir, "pass.json")}"\n`);
  chmodSync(script, 0o755);
  patchLoreConfig(tmpDir, { ai: { provider: "claude-cli", providers: { "claude-cli": { command: script, args: [], timeout_ms: 20000 } } } });
}

function installFakeSuiteScripts(): void {
  const scripts = { "check:plan-close": "echo chain-ok", test: "echo ok" };
  writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "fixture", private: true, scripts }));
  for (const args of [["add", "package.json"], ["commit", "-q", "-m", "fixture scripts"]]) {
    const r = spawnSync("git", args, { cwd: tmpDir, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  }
}

function makePlan(title: string): string {
  counter += 1;
  const plan = slugOf(must(["create", "plan", "--title", `${title} ${counter}`, "--parent", prdSlug, "--content", "x", "--no-ai"]));
  const task = slugOf(must(["create", "task", "--title", `Work ${counter}`, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai"]));
  must(["evidence", task, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"]);
  must(["set", plan, "--status", "approved"]);
  return plan;
}

function assessRow(plan: string): AssessRow {
  const r = runLore(["assess", plan, "--json"]);
  expect(r.exitCode, r.stderr).toBe(0);
  return (JSON.parse(r.stdout) as { data: { rows: AssessRow[] } }).data.rows[0] as AssessRow;
}

function statusOf(slug: string): string {
  return (JSON.parse(must(["get", slug, "--json"])) as { data: { doc: { status: string } } }).data.doc.status;
}

function ruleState(id: string): string {
  return (JSON.parse(must(["rule", "show", id, "--json"])) as { data: { state: string } }).data.state;
}

function answerPending(label: "Accept" | "Reject"): void {
  const questions = (JSON.parse(must(["pending", "--ask"])) as { data: { questions: AskedQuestion[] } }).data.questions;
  expect(questions).toHaveLength(1);
  const question = questions[0] as AskedQuestion;
  const shim = mkdtempSync(join(tmpdir(), "lore-ask-shim-"));
  shimDirs.push(shim);
  writeFileSync(join(shim, "lore"), `#!/bin/sh\nexec bun run "${INDEX_TS}" "$@"\n`);
  chmodSync(join(shim, "lore"), 0o755);
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
}

function createSpec(title: string): string {
  return slugOf(must(["create", "spec", "--title", title, "--content", "## Overview/Goal\nx\n\n## Scope\nx\n\n## Acceptance Criteria\nx\n", "--no-ai"]));
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-milestone-reject-test-"));
  judgeDir = mkdtempSync(join(tmpdir(), "lore-milestone-reject-judge-"));
  makeCleanTreeRepo(tmpDir);
  installFakeSuiteScripts();
  must(["init"]);
  patchLoreConfig(tmpDir, "workflow:\n  review:\n    judgment_required_types: []\n");
  installJudge();
  prdSlug = slugOf(must(["create", "prd", "--title", "Review PRD", "--content", "root", "--no-ai"]));
});

afterEach(() => {
  for (const dir of shimDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(judgeDir, { recursive: true, force: true });
});

describe("milestone review gates close", () => {
  it("milestone review gates close: rejecting a deprecation restores the spec AND proposes its abandoned rule again (#337)", { timeout: 300_000 }, () => {
    const root = slugOf(must(["baseline", "add", prdSlug, "--node", "root", "--label", "Root", "--title", "Rule Root"]));
    const branch = slugOf(must(["baseline", "add", root, "--node", "branch", "--label", "Branch", "--title", "Rule Branch"]));
    const leaf = slugOf(must(["baseline", "add", branch, "--node", "leaf", "--label", "Leaf", "--title", "Rule Leaf"]));
    const plan = makePlan("Retire with rule");
    const spec = createSpec("Doomed spec with a rule");
    must(["ac", "add", spec, "AC-RULE-1", "--statement", "doomed", "--mode", "human"]);
    const proposed = must(["rule", "propose", spec, "add", "--leaf", leaf, "--statement", "A rule the spec introduces", "--example", "when X then Y", "--enforced-by", "both"]);
    const ruleId = proposed.match(/\bBR-\d+\b/)?.[0] ?? "";
    expect(ruleId).not.toBe("");
    expect(ruleState(ruleId)).toBe("proposed");

    must(["bulk", "deprecate", spec, "--apply", "--reason", "feature removed"]);
    expect(ruleState(ruleId)).toBe("retired"); // abandoned with the deprecation (BR-1307)
    assessRow(plan);
    answerPending("Reject");
    expect(runLore(["set", plan, "--status", "archived"]).exitCode).toBe(4);
    expect(statusOf(spec)).toBe("draft");
    expect(ruleState(ruleId)).toBe("proposed"); // revived in the same write as the status restore
    assessRow(plan); // a second settle changes nothing
    expect(ruleState(ruleId)).toBe("proposed");
    expect(statusOf(spec)).toBe("draft");
  });

  it("milestone review gates close: the shared serializer yields the CLI row's retired_acs and pending_decision exactly", { timeout: 300_000 }, () => {
    const plan = makePlan("Serializer shape");
    const spec = createSpec("Doomed spec");
    must(["ac", "add", spec, "AC-DOOM-1", "--statement", "doomed", "--mode", "human"]);
    must(["bulk", "deprecate", spec, "--apply", "--reason", "feature removed"]);
    const row = assessRow(plan);
    expect(row.retired_acs).toBeDefined();
    expect(row.pending_decision).toBeTypeOf("number");
    const fields = retirementAssessFields({ state: "pending", retired: row.retired_acs ?? [], pendingId: row.pending_decision ?? -1 });
    expect({ retired_acs: fields.retired_acs, pending_decision: fields.pending_decision }).toEqual({
      retired_acs: row.retired_acs,
      pending_decision: row.pending_decision,
    });
  });
});
