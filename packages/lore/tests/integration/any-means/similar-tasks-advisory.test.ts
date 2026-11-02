/**
 * AC-AT-3 — approving a plan, and approving a task in a plan, prints an advisory when three open tasks have bodies that
 * differ only in counts, paths or ids; two such tasks or three dissimilar ones print none; the approval never fails
 * (spec-helpers-may-change-files-by-any-means-territory-is S3; BR-1564).
 *
 * Throwaway corpus (mkdtemp + `lore init`), real command tree in process. Dimensions: HAPPY (3 similar, plan and task
 * approve), NEGATIVE (2 similar; 3 dissimilar).
 *
 * @spec_ref spec-helpers-may-change-files-by-any-means-territory-is AC-AT-3
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { planFieldsArgs, templatedFieldsArgs } from "../../helpers/templated-create.js";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

let dir: string;
let counter = 0;

async function runLore(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const r = await runLoreInProcess(args, { cwd: dir, home: dir, env: { ...process.env, HOME: dir, EDITOR: "true", LORE_ACTOR: "agent:similar-tasks-test" } });
  return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode };
}

async function mustRun(args: string[]): Promise<string> {
  const r = await runLore(args);
  if (r.exitCode !== 0) throw new Error(`FIXTURE FAILURE - lore ${args.join(" ")} exited ${r.exitCode}: ${r.stderr}${r.stdout}`);
  return r.stdout;
}

/** A plan under the shared spec with one task per objective; returns the plan slug and task slugs. */
async function makePlan(objectives: string[]): Promise<{ plan: string; tasks: string[] }> {
  const n = ++counter;
  const plan = `plan-sim-plan-${n}`;
  await mustRun(["create", "plan", "--title", `Sim Plan ${n}`, "--parent", "spec-sim-spec", "--no-ai", ...planFieldsArgs("spec-sim-spec")]);
  const tasks: string[] = [];
  for (const [i, objective] of objectives.entries()) {
    const letter = String.fromCharCode(97 + i);
    await mustRun(["create", "task", "--kind", "code", "--title", `Sim Task ${n} ${letter}`, "--parent", plan, "--plan-id", plan, "--no-ai", ...templatedFieldsArgs("task", { fields: { objective } })]);
    tasks.push(`task-sim-task-${n}-${letter}`);
  }
  return { plan, tasks };
}

const similar = (k: number): string => `Rename the helper wireUp in packages/pkg${k}/src/file${k}.ts at ${k * 11} call sites`;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "lore-similar-tasks-"));
  await mustRun(["init"]);
  await mustRun(["create", "prd", "--title", "Sim PRD", "--no-ai", ...templatedFieldsArgs("prd", { refTarget: "problem" })]);
  await mustRun(["create", "spec", "--title", "Sim Spec", "--no-ai", ...templatedFieldsArgs("spec", { kind: "feature", refTarget: "prd-sim-prd" })]);
  await mustRun(["approve", "prd-sim-prd"]);
  await mustRun(["approve", "spec-sim-spec"]);
}, 240_000);

afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

describe("AC-AT-3 similar-task advisory", () => {
  it("HAPPY: approving a plan with three similar open tasks names all three and exits 0", async () => {
    const { plan, tasks } = await makePlan([similar(1), similar(2), similar(3)]);
    const r = await runLore(["approve", plan]);
    expect(r.exitCode, r.stderr).toBe(0);
    for (const t of tasks) expect(r.stderr).toContain(t);
    expect(r.stderr).toContain("scripted");
    expect(r.stdout).toContain(`Approved ${plan}`);
  });

  it("HAPPY: approving one of three similar tasks names all three and exits 0", async () => {
    const { plan, tasks } = await makePlan([similar(4), similar(5), similar(6)]);
    await mustRun(["approve", plan]);
    const r = await runLore(["approve", tasks[0] as string, "--red-waiver", "fixture"]);
    expect(r.exitCode, r.stderr).toBe(0);
    for (const t of tasks) expect(r.stderr).toContain(t);
    expect(r.stderr).toContain("scripted");
  });

  it("NEGATIVE: two similar tasks print no advisory on plan or task approve", async () => {
    const { plan, tasks } = await makePlan([similar(7), similar(8)]);
    const p = await runLore(["approve", plan]);
    expect(p.exitCode, p.stderr).toBe(0);
    expect(p.stderr).not.toContain("scripted");
    const t = await runLore(["approve", tasks[0] as string, "--red-waiver", "fixture"]);
    expect(t.exitCode, t.stderr).toBe(0);
    expect(t.stderr).not.toContain("scripted");
  });

  it("NEGATIVE: three dissimilar tasks print no advisory on plan or task approve", async () => {
    const { plan, tasks } = await makePlan(["Add a retry cache to the loader", "Delete the legacy export route", "Document the claim lease rules"]);
    const p = await runLore(["approve", plan]);
    expect(p.exitCode, p.stderr).toBe(0);
    expect(p.stderr).not.toContain("scripted");
    const t = await runLore(["approve", tasks[1] as string, "--red-waiver", "fixture"]);
    expect(t.exitCode, t.stderr).toBe(0);
    expect(t.stderr).not.toContain("scripted");
  });
});
