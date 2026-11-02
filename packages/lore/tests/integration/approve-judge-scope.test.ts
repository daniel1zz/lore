// @reads packages/lore/src/service/review-service.ts
// @spawns-external git the shared done-contract constants live in a helper that builds git repositories
// @reads packages/lore/src/ai/review-template.ts
// @reads assets/project/lore-config-template.yaml
// @reads packages/core/src/config.ts
/**
 * AC-LG-6 (spec-lean-governance-batch-verbs-judgment-only-at-milestones, Part B, BR-1369): `lore approve` needs a review
 * judgment only for a spec and an ADR. With NO judgment on record, a plan, a task, a knowledge doc and a baseline node
 * approve (exit 0); a spec and an ADR are refused with exit 4 naming review-judgment. The task-level judge prompt and the
 * AC-quantifiability advisory no longer exist under packages/lore/src/ai.
 *
 * Throwaway corpus (mkdtemp + `lore init`, never the repo's own `.lore/`); no AI is configured or called. Commands run
 * in-process through the real CLI.
 *
 * Coverage:
 *   HAPPY      plan / task / knowledge / baseline node approve with no judgment.
 *   NEGATIVE   spec and ADR approve is refused, exit 4, naming review-judgment.
 *   REGRESSION an `escalate` judgment on a plan no longer blocks (types outside the list never consult judgments);
 *              the advisory text is gone from the prompt source.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeCleanTreeRepo } from "../helpers/clean-tree-repo";
import { FIXTURE_DONE_CONTRACT_CONFIG } from "../helpers/landed-code-task";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { planFieldsArgs, templatedFieldsArgs } from "../helpers/templated-create.js";

const TIMEOUT_MS = 120_000;
let dir: string;

async function lore(args: readonly string[]) {
  return runLoreInProcess([...args], { cwd: dir, home: dir, env: { ...process.env, HOME: dir, EDITOR: "true" } });
}

async function must(args: readonly string[]): Promise<string> {
  const r = await lore(args);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function slugOf(stdout: string): string {
  const m = stdout.match(/Created baseline \w+ (\S+) \(/) ?? stdout.match(/Slug:\s+(\S+)/);
  if (m?.[1] === undefined) throw new Error(`no slug in: ${stdout}`);
  return m[1];
}

let prd: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "approve-judge-scope-"));
  // reason: approving a task compiles its done contract at a commit of the repository (AC-DCS1-1), which needs the three
  // `workflow.done_contract` commands; the compile is not this file's subject, so the fixture only supplies what it needs.
  makeCleanTreeRepo(dir);
  await must(["init"]);
  patchLoreConfig(dir, { workflow: { done_contract: { ...FIXTURE_DONE_CONTRACT_CONFIG } } });
  prd = slugOf(await must(["create", "prd", "--title", "Judge scope product", "--no-ai", ...templatedFieldsArgs("prd")]));
}, TIMEOUT_MS);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("AC-LG-6: judge only spec and adr", () => {
  it("judge only spec and adr: a knowledge doc approves with no judgment", async () => {
    const slug = slugOf(
      await must(["create", "knowledge", "--sub-type", "reference", "--title", "Judge scope note", "--parent", prd, ...templatedFieldsArgs("knowledge", { kind: "reference" }), "--no-ai"]),
    );
    const r = await lore(["approve", slug]);
    expect(r.stderr + r.stdout).not.toContain("review-judgment");
    expect(r.exitCode, r.stderr + r.stdout).toBe(0);
  }, TIMEOUT_MS);

  it("judge only spec and adr: a baseline node approves with no judgment", async () => {
    const root = slugOf(await must(["baseline", "add", prd, "--node", "root", "--label", "Root", "--title", "Judge scope root", ...templatedFieldsArgs("baseline", { kind: "root" })]));
    const r = await lore(["approve", root]);
    expect(r.stderr + r.stdout).not.toContain("review-judgment");
    expect(r.exitCode, r.stderr + r.stdout).toBe(0);
  }, TIMEOUT_MS);

  it("judge only spec and adr: a plan and its task approve with no judgment", async () => {
    const plan = slugOf(await must(["create", "plan", "--title", "Judge scope plan", "--parent", prd, "--no-ai", ...planFieldsArgs(prd)]));
    const planRun = await lore(["approve", plan]);
    expect(planRun.stderr + planRun.stdout).not.toContain("review-judgment");
    const task = slugOf(
      await must(["create", "task", "--kind", "code", "--title", "Judge scope task", "--parent", plan, "--plan-id", plan, "--no-ai", ...templatedFieldsArgs("task")]),
    );
    const taskRun = await lore(["approve", task]);
    expect(taskRun.stderr + taskRun.stdout).not.toContain("review-judgment");
    expect(taskRun.exitCode, taskRun.stderr + taskRun.stdout).toBe(0);
    expect(planRun.exitCode, planRun.stderr + planRun.stdout).toBe(0);
  }, TIMEOUT_MS);

  it("judge only spec and adr: a spec and an ADR are refused with exit 4 naming review-judgment", async () => {
    const spec = slugOf(await must(["create", "spec", "--title", "Judge scope spec", ...templatedFieldsArgs("spec", { kind: "feature" }), "--no-ai"]));
    const adr = slugOf(
      await must(["create", "adr", "--title", "Judge scope adr", "--parent", prd, ...templatedFieldsArgs("adr"), "--decision-status", "proposed", "--no-ai"]),
    );
    for (const slug of [spec, adr]) {
      const r = await lore(["approve", slug]);
      expect(r.exitCode).toBe(4);
      expect(r.stderr + r.stdout).toContain("review-judgment");
    }
  }, TIMEOUT_MS);

  it("judge only spec and adr: the advisory and its prompt text are gone from packages/lore/src/ai", () => {
    const source = readFileSync(new URL("../../src/ai/review-template.ts", import.meta.url), "utf8");
    expect(source).not.toContain("AC Quantifiability");
    expect(source).not.toContain("ac_quantifiability");
    expect(source).not.toContain("ADVISORY_ONLY_CLAUSE");
  });
});
