// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-an-active-spec-counts-as-approved-for-claiming-its-tasks (AC-ACT-1, BR-104, BR-111)
 *
 * Real CLI (`bun run src/index.ts`) against a throwaway corpus (mkdtemp + `lore init`) —
 * never the repo's own `.lore/`. Proves `UPSTREAM_APPROVED_STATUSES = {approved, active}`
 * reaches all three consumers: the claim gate, plan approval, and the `lore ready`
 * unapproved-spec flag. draft and in-review must still refuse with UPSTREAM_NOT_APPROVED
 * (exit 4).
 *
 * Coverage: HAPPY (active clears all three), NEGATIVE (draft / in-review refuse),
 * STATE (approved -> active -> reopened draft), REGRESSION (approved still clears).
 */
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PROJECT_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1", LORE_ACTOR: "agent:active-spec-counts-as-approved-test" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): string {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`lore ${args.join(" ")} exited ${result.exitCode}: ${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from create output: ${stdout}`);
  return slug;
}

interface Fixture {
  readonly specSlug: string;
  readonly planSlug: string;
  readonly taskSlug: string;
  /** A second, still-draft plan under the spec — the plan-approval probe. */
  readonly draftPlanSlug: string;
}

let tmpDir: string;
let fx: Fixture;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-active-spec-approved-"));
  mustRun(["init"], tmpDir);
  // Fixture-only: spec promotion/review gates would demand AC + judgments for setup states
  // this file is not testing. task-claim and plan-promote stay ENABLED — they are the subject.
  appendFileSync(
    join(tmpDir, ".lore", "config.yaml"),
    [
      "workflow:",
      "  gates:",
      '    "spec-create":',
      "      enabled: false",
      '    "spec-promote":',
      "      enabled: false",
      "  review:",
      "    judgment_required_types: []",
      "",
    ].join("\n"),
    "utf8",
  );
  const specSlug = parseSlug(
    mustRun(["create", "spec", "--title", "Active Gate Spec", "--content", "## Overview\n\nx\n", "--no-ai"], tmpDir),
  );
  // plan-promote requires the parent spec to declare >= 1 AC (UPSTREAM_NO_AC).
  mustRun(["ac", "add", specSlug, "AC-FIX-1", "--statement", "fixture criterion", "--mode", "human"], tmpDir);
  const mkPlan =(title: string): string =>
    parseSlug(mustRun(["create", "plan", "--title", title, "--parent", specSlug, "--content", "x", "--no-ai"], tmpDir));
  const planSlug = mkPlan("Active Gate Plan");
  const draftPlanSlug = mkPlan("Active Gate Second Plan");
  const taskSlug = parseSlug(
    mustRun(
      ["create", "task", "--title", "Active Gate Task", "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai"],
      tmpDir,
    ),
  );
  // Plan approval is gated on the spec being approved, so approve the spec first.
  fx = { specSlug, planSlug, taskSlug, draftPlanSlug };
  setSpec("approved");
  mustRun(["approve", planSlug], tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Sets the spec's status straight in the throwaway corpus DB. `lore set --status approved`
 * would demand a rule-cited acceptance criterion (BR/AS citation gate) — setup this file is
 * not testing; the gates under test only read the resulting status.
 */
function setSpec(status: string): void {
  const db = new Database(join(tmpDir, ".lore", "lore.db"));
  try {
    db.query("UPDATE docs SET status = ? WHERE slug = ?").run(status, fx.specSlug);
  } finally {
    db.close();
  }
}

function claim(): RunResult {
  return runLore(["claim", fx.taskSlug, "--worktree", "w-active-gate"], tmpDir);
}

function approveDraftPlan(): RunResult {
  return runLore(["approve", fx.draftPlanSlug], tmpDir);
}

function readyFlagged(): boolean {
  const out = mustRun(["ready", fx.planSlug, "--json"], tmpDir);
  return out.includes("upstream_unapproved");
}

function expectUpstreamRefusal(result: RunResult): void {
  expect(result.exitCode).toBe(4);
  expect(result.stdout + result.stderr).toContain("UPSTREAM_NOT_APPROVED");
}

describe("an active spec counts as approved (AC-ACT-1)", () => {
  it("approved spec: claim succeeds (REGRESSION)", () => {
    expect(claim().exitCode).toBe(0);
  });

  it("approved -> active: claim is not refused for its upstream", () => {
    setSpec("active");
    const result = claim();
    expect(result.stdout + result.stderr).not.toContain("UPSTREAM_NOT_APPROVED");
    expect(result.exitCode).toBe(0);
  });

  it("approved -> active: approving a new plan under it is not refused for its upstream", () => {
    setSpec("active");
    const result = approveDraftPlan();
    expect(result.stdout + result.stderr).not.toContain("UPSTREAM_NOT_APPROVED");
    expect(result.exitCode).toBe(0);
  });

  it("approved -> active: lore ready shows no unapproved-spec flag", () => {
    setSpec("active");
    expect(readyFlagged()).toBe(false);
  });

  it("reopened to draft: claim and plan approval refuse with UPSTREAM_NOT_APPROVED (exit 4) and the flag returns", () => {
    // `lore reopen` only accepts approved -> draft (active -> draft is an illegal transition),
    // so the revise path is: approved spec, reopen, now draft again.
    mustRun(["reopen", fx.specSlug, "--reason", "revise the spec"], tmpDir);
    expectUpstreamRefusal(claim());
    expectUpstreamRefusal(approveDraftPlan());
    expect(readyFlagged()).toBe(true);
  });

  it("in-review spec: claim and plan approval refuse the same way and the flag shows", () => {
    setSpec("in-review");
    expectUpstreamRefusal(claim());
    expectUpstreamRefusal(approveDraftPlan());
    expect(readyFlagged()).toBe(true);
  });
});
