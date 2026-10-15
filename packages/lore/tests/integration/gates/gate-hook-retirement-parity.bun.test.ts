/**
 * AC-TE-1 (spec-interception-moves-off-every-tool-call-one-turn-end-review, Scope 1; BR-1092, AS-8):
 * the g1-g4 checkpoint hooks are retired only because the WRITE ITSELF refuses every case they
 * refused. This file is the proof, and it runs BEFORE the hooks are deleted (Risk R1).
 *
 * Contract under test, per case, on BOTH surfaces (real `lore` CLI process -> exit 4; real
 * `lore --mcp-server` over stdio -> `isError` tool result):
 *   1. a spec created with any parent (BR-2: a spec takes no parent)            -> spec-create
 *   2. a spec approved with no structured criterion                             -> spec-promote
 *   3. a plan approved over an unapproved spec                                  -> plan-promote
 *   4. a claim of a task whose upstream spec is unapproved                      -> task-claim
 * Every refusal names its checkpoint and writes no document and no version.
 *
 * Structural half: no `lore-gate-g1..g4` / `g1..g4` hook name is left in the shipped roster, the
 * shipped assets, the project scaffold, this repo's hooks/ or `.claude/settings.json`.
 *
 * Dimensions: NEGATIVE (the four refusals x 2 surfaces), STATE (no doc/version written),
 * REGRESSION (structural: hooks retired), HAPPY control (an unrelated create still succeeds on
 * both surfaces, so a refusal is the gate and not a broken fixture).
 *
 * Throwaway corpus only: mkdtemp outside the repo + `lore init`; never this repo's `.lore/`.
 */

import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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
  readonly mcp: (f: Fixture) => { name: string; arguments: Record<string, unknown> };
}

const CASES: readonly RefusalCase[] = [
  {
    name: "a spec created with a parent",
    checkpoint: "spec-create",
    names: "a spec takes no parent",
    cli: (f) => ["create", "spec", "--title", "Child Spec", "--kind", "tech", "--parent", f.prd, "--content", SKELETON, "--no-ai"],
    mcp: (f) => ({
      name: "lore_create",
      arguments: { type: "spec", title: "Child Spec", parent_id: f.prd, content: SKELETON, extra: { spec_kind: "tech" } },
    }),
  },
  {
    name: "a spec approved with no structured criterion",
    checkpoint: "spec-promote",
    names: "spec-promote",
    cli: (f) => ["approve", f.bareSpec],
    mcp: (f) => ({ name: "lore_approve", arguments: { id_or_slug: f.bareSpec } }),
  },
  {
    name: "a plan approved over an unapproved spec",
    checkpoint: "plan-promote",
    names: "plan-promote",
    cli: (f) => ["approve", f.plan],
    mcp: (f) => ({ name: "lore_approve", arguments: { id_or_slug: f.plan } }),
  },
  {
    name: "a claim of a task whose upstream spec is unapproved",
    checkpoint: "task-claim",
    names: "task-claim",
    cli: (f) => ["claim", f.task, "--worktree", f.dir],
    mcp: (f) => ({ name: "lore_claim", arguments: { id_or_slug: f.task, worktree: f.dir } }),
  },
];

let fixture: Fixture;

beforeAll(() => {
  fixture = buildFixture();
});

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true });
});

async function withMcp<T>(dir: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({ command: "bun", args: ["run", ENTRY, "--mcp-server"], cwd: dir, env: cleanEnv(dir) });
  const client = new Client({ name: "gate-hook-retirement-parity", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

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

describe("the write itself refuses what the g1-g4 hooks refused — MCP tool (error)", () => {
  for (const c of CASES) {
    it(`${c.name}: tool error, names ${c.names}, writes nothing`, async () => {
      const before = snapshot(fixture.dir);
      const call = c.mcp(fixture);
      const result = await withMcp(fixture.dir, (client) => client.callTool(call));
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(c.names);
      expect(snapshot(fixture.dir)).toBe(before);
    });
  }
});

describe("control: the same surfaces still accept a legal write (a refusal above is the gate, not a broken fixture)", () => {
  it("CLI creates a parentless spec; MCP creates another", async () => {
    mustLore(["create", "spec", "--title", "Control CLI Spec", "--kind", "tech", "--content", SKELETON, "--no-ai"], fixture.dir);
    const result = await withMcp(fixture.dir, (client) =>
      client.callTool({
        name: "lore_create",
        arguments: { type: "spec", title: "Control MCP Spec", content: SKELETON, extra: { spec_kind: "tech" } },
      }),
    );
    expect(result.isError ?? false).toBe(false);
  });
});

// ─── structural half: no g1-g4 hook remains shipped or registered ───────────

const G_HOOK_NAME = /lore-gate-g[1-4]|(^|[^a-z0-9])g[1-4]-(spec-create|spec-promote|plan-promote|task-claim)/;

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => filesUnder(join(path, entry)));
}

/** Files (names and contents) under `relPath` that still name a g1-g4 hook. */
function offenders(relPath: string): string[] {
  return filesUnder(join(REPO_ROOT, relPath)).filter((file) => G_HOOK_NAME.test(file.slice(REPO_ROOT.length)) || G_HOOK_NAME.test(readFileSync(file, "utf8")));
}

describe("no lore-gate-g1..g4 / g1..g4 hook remains shipped or registered", () => {
  const LOCATIONS = [
    "packages/core/src/distribution-hooks.ts",
    "assets/hooks",
    "assets/project",
    "hooks",
    ".claude/settings.json",
    "packages/lore/src/service/project-setup-service.ts",
    "packages/lore/src/flows/setup-project-flow.ts",
  ];
  for (const loc of LOCATIONS) {
    it(`${loc} names no g1-g4 hook`, () => {
      expect(offenders(loc)).toEqual([]);
    });
  }
});
