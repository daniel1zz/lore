// @spawns packages/lore/src/index.ts
/**
 * AC-TE-1 (spec-interception-moves-off-every-tool-call-one-turn-end-review, Scope 1; BR-1092, AS-8):
 * the g1-g4 checkpoint hooks are retired only because the WRITE ITSELF refuses every case they
 * refused. This file is the proof, and it runs BEFORE the hooks are deleted (Risk R1).
 *
 * Contract under test, per case, on the CLI surface (real `lore` CLI process -> exit 4):
 *   1. a spec created with any parent (BR-2: a spec takes no parent)            -> spec-create
 *   2. a spec approved with no structured criterion                             -> spec-promote
 *   3. a plan approved over an unapproved spec                                  -> plan-promote
 *   4. a claim of a task whose upstream spec is unapproved                      -> task-claim
 * Every refusal names its checkpoint and writes no document and no version.
 *
 * Structural half (no `lore-gate-g1..g4` hook name left in the shipped roster, assets, scaffold,
 * hooks/ or `.claude/settings.json`) lives in `tests/integration/retirement-registry.bun.test.ts`.
 *
 * Dimensions: NEGATIVE (the four refusals on the CLI), STATE (no doc/version written),
 * REGRESSION (structural: hooks retired), HAPPY control (an unrelated create still succeeds on
 * the CLI, so a refusal is the gate and not a broken fixture).
 *
 * Throwaway corpus only: mkdtemp outside the repo + `lore init`; never this repo's `.lore/`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "@lore/core/node";
import { sessionEnvFor } from "../../helpers/session-actor";

setDefaultTimeout(300_000);

const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");
const ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const WRITER = "agent:gate-parity";
const REFUSAL_EXIT = 4;

// ─── process helpers ────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function cleanEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string" && !["LORE_ACTOR", "CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"].includes(k)) env[k] = v;
  }
  return { ...env, CLAUDECODE: "1", HOME: home, ...sessionEnvFor(WRITER) };
}

function lore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", ENTRY, ...args], { cwd, env: cleanEnv(cwd) });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustLore(args: string[], cwd: string): string {
  const r = lore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`fixture \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function slugOf(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
}

// ─── fixture corpus ─────────────────────────────────────────────────────────

const SKELETON = "## Overview\n\nx\n\n## Scope\n\ny\n\n## Acceptance Criteria\n\n- a\n";
const scratch: string[] = [];

interface Fixture {
  readonly dir: string;
  readonly prd: string;
  /** Draft spec with NO structured criterion. */
  readonly bareSpec: string;
  /** Plan under the (unapproved) bare spec. */
  readonly plan: string;
  /** Task in that plan; its upstream spec is unapproved. */
  readonly task: string;
}

function buildFixture(): Fixture {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-parity-")));
  if (dir.startsWith(REPO_ROOT)) throw new Error("fixture must live outside the repo");
  scratch.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "parity@example.invalid"]);
  git(dir, ["config", "user.name", "parity test"]);
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  mustLore(["init"], dir);
  // `review-judgment` is a SEPARATE, additive checkpoint on spec/adr approval; switch it off so the
  // approval cases below meet the checkpoint under test (spec-promote), not that one.
  saveConfig(dir, {
    project: { name: "gate-parity", author: "tester" },
    workflow: { review: { judgment_required_types: [] } },
  } as never);
  const prd = slugOf(mustLore(["create", "prd", "--title", "Parity Root", "--content", "root", "--no-ai"], dir));
  const bareSpec = slugOf(mustLore(["create", "spec", "--title", "Bare Spec", "--kind", "tech", "--content", SKELETON, "--no-ai"], dir));
  const plan = slugOf(mustLore(["create", "plan", "--title", "Parity Plan", "--parent", bareSpec, "--content", "Plan body.", "--no-ai"], dir));
  const task = slugOf(
    mustLore(["create", "task", "--title", "Parity Task", "--plan-id", plan, "--ac-scope", "", "--content", "Task body.", "--no-ai"], dir),
  );
  return { dir, prd, bareSpec, plan, task };
}

/** Every document's slug + version + status, as the corpus stores them. */
function snapshot(dir: string): string {
  const parsed = JSON.parse(mustLore(["list", "--json", "--limit", "500"], dir)) as { data?: { docs?: Array<Record<string, unknown>> } };
  const docs = parsed.data?.docs ?? [];
  if (docs.length === 0) throw new Error("snapshot saw an empty corpus — fixture is broken");
  return JSON.stringify(docs.map((d) => [d["slug"], d["version"], d["status"]]).sort());
}

// ─── the four refusal cases ─────────────────────────────────────────────────

interface RefusalCase {
  readonly name: string;
  readonly checkpoint: string;
  /** Text every refusal of this case must carry: the checkpoint name, or the rule the write names when it has no checkpoint id. */
  readonly names: string;
  readonly cli: (f: Fixture) => string[];
}

const CASES: readonly RefusalCase[] = [
  {
    name: "a spec created with a parent",
    checkpoint: "spec-create",
    names: "a spec takes no parent",
    cli: (f) => ["create", "spec", "--title", "Child Spec", "--kind", "tech", "--parent", f.prd, "--content", SKELETON, "--no-ai"],
  },
  {
    name: "a spec approved with no structured criterion",
    checkpoint: "spec-promote",
    names: "spec-promote",
    cli: (f) => ["approve", f.bareSpec],
  },
  {
    name: "a plan approved over an unapproved spec",
    checkpoint: "plan-promote",
    names: "plan-promote",
    cli: (f) => ["approve", f.plan],
  },
  {
    name: "a claim of a task whose upstream spec is unapproved",
    checkpoint: "task-claim",
    names: "task-claim",
    cli: (f) => ["claim", f.task, "--worktree", f.dir],
  },
];

let fixture: Fixture;

beforeAll(() => {
  fixture = buildFixture();
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

describe("the write itself refuses what the g1-g4 hooks refused — CLI (exit 4)", () => {
  for (const c of CASES) {
    it(`${c.name}: exit 4, names ${c.names}, writes nothing`, () => {
      const before = snapshot(fixture.dir);
      const r = lore(c.cli(fixture), fixture.dir);
      expect(r.exitCode).toBe(REFUSAL_EXIT);
      expect(r.stderr + r.stdout).toContain(c.names);
      expect(snapshot(fixture.dir)).toBe(before);
    });
  }
});

describe("control: the CLI still accepts a legal write (a refusal above is the gate, not a broken fixture)", () => {
  it("CLI creates a parentless spec", () => {
    mustLore(["create", "spec", "--title", "Control CLI Spec", "--kind", "tech", "--content", SKELETON, "--no-ai"], fixture.dir);
  });
});
