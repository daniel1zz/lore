// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore assess` CLI subcommand (SPEC-026) — pre-AI validation
 * paths only. Runs the real CLI via subprocess against an isolated temp SQLite DB,
 * same pattern as tests/integration/cli/task-workflow.test.ts.
 *
 * Scope: this file covers ONLY the paths that terminate before any AI provider call
 * (argument mutex checks + the zero-task gate) — they are hermetic without needing a
 * working AI provider on the test machine. Post-AI success/failure paths (hermetic
 * fake-provider script, real-git-diff fixture) live in assess-ai.bun.test.ts, which
 * needs a real SQLite DB opened in-process (bun:sqlite) to point config at a fake
 * provider script — see that file's header for why the split is necessary.
 *
 * Hermeticity note: `runLore` prepends a fail-fast stub `claude` binary to PATH (see
 * `beforeEach`). Without this shim, AC-ASSESS-8.CLI.N3 would resolve the REAL `claude`
 * binary on any machine that has one on PATH — invoking a real AI call (slow, costs a
 * real API request) instead of exercising the negative-space assertion it's meant to.
 *
 * Coverage:
 *   NEGATIVE:   --no-ai always exits 2 (assess has no non-AI mode, AC-ASSESS-9);
 *               --ai and --no-ai together exits 2; zero-task plan is an ERROR row, exit 1 (AC-ASSESS-8)
 *   BOUNDARY:   a plan with one task passes the zero-task gate and fails later on the provider
 *   ERROR:      n/a here (provider-error paths are in assess-ai.bun.test.ts)
 *   STATE:      n/a here
 *   REGRESSION: the zero-task gate fires even when `--ai` is also passed (gate runs before AI)
 *
 * @spec_ref AC-ASSESS-8, AC-ASSESS-9; spec-lean-governance-batch-verbs-judgment-only-at-milestones (BR-1372)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { installStubClaude, stubClaudeEnv } from "../../helpers/stub-claude.js";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── RunResult type ───────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * MOCK RISK: none — this calls the real CLI binary path. PATH is shimmed to resolve
 * `claude` to the fail-fast stub created in `beforeEach` (see stub-bin/claude), so the
 * AI-provider spawn (`claude-cli-provider.ts`) always hits a deterministic exit-1
 * failure instead of whatever `claude` happens to be installed on the host machine.
 */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: stubClaudeEnv(cwd, join(cwd, "stub-bin")),
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-assess-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  // Fail-fast `claude` stub (tests/helpers/stub-claude.ts): a real `claude` on the host
  // PATH would otherwise get invoked by the AI-provider spawn — slow, and it burns a real
  // API call. Any dev machine with the CLI installed (e.g. ~/.local/bin/claude) needs
  // this shim for AC-ASSESS-8.CLI.N3 to deterministically hit the AI-provider-failure path.
  installStubClaude(tmpDir);

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

function createPlan(title: string): string {
  const r = runLore(["create", "plan", "--title", title, "--no-ai", "--content", "body"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract plan slug from: ${r.stdout}`);
  return slug;
}

function createTask(planSlug: string, title: string): string {
  const r = runLore(
    ["create", "task", "--title", title, "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract task slug from: ${r.stdout}`);
  return slug;
}

// ─── --no-ai always exits 2 (AC-ASSESS-9) ─────────────────────────────────────

describe("lore assess --no-ai — always a contradiction (AC-ASSESS-9)", () => {
  it("AC-ASSESS-9.CLI.N1: exits 2 even for a plan that has tasks (assess has no non-AI mode)", () => {
    const planSlug = createPlan("No-AI Plan");
    createTask(planSlug, "Task One");

    const result = runLore(["assess", planSlug, "--no-ai"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--no-ai");
  });

  it("AC-ASSESS-9.CLI.N2: exits 2 even for a NONEXISTENT plan — the mutex check runs before plan resolution", () => {
    const result = runLore(["assess", "plan-does-not-exist-anywhere", "--no-ai"], tmpDir);
    expect(result.exitCode).toBe(2);
  });
});

// ─── --ai and --no-ai together exit 2 ─────────────────────────────────────────

describe("lore assess --ai --no-ai together — mutually exclusive", () => {
  it("exits 2 when both flags are passed, before any plan lookup", () => {
    const result = runLore(["assess", "plan-does-not-exist-anywhere", "--ai", "--no-ai"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("mutually exclusive");
  });
});

// ─── Zero-task plan gate (AC-ASSESS-8) ────────────────────────────────────────

describe("lore assess — zero-task plan (AC-ASSESS-8)", () => {
  it("AC-ASSESS-8.CLI.N1: a plan with zero tasks is an ERROR row (exit 1, batch contract) before any AI call, naming why", () => {
    const planSlug = createPlan("Empty Plan");

    const result = runLore(["assess", planSlug, "--json"], tmpDir);
    expect(result.exitCode).toBe(1);
    const rows = (JSON.parse(result.stdout) as { data: { rows: Array<{ outcome: string; reason: string }> } }).data.rows;
    expect(rows[0]?.outcome).toBe("ERROR");
    expect(rows[0]?.reason).toContain("zero child tasks");
  });

  it("AC-ASSESS-8.CLI.N2: the zero-task gate fires even when --ai is explicitly passed (gate runs before AI)", () => {
    const planSlug = createPlan("Empty Plan With AI Flag");

    const result = runLore(["assess", planSlug, "--ai"], tmpDir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("zero child tasks");
  });

  it("AC-ASSESS-8.CLI.N3: a plan with at least one task does NOT hit the zero-task gate (its row fails later, on the AI provider)", () => {
    const planSlug = createPlan("Non-Empty Plan");
    createTask(planSlug, "A Task");

    // `claude` resolves to the fail-fast stub on PATH (see beforeEach), so this row fails
    // LATER — AI provider failure — NOT on the zero-task gate. This is the negative-space
    // check that the gate is scoped to zero tasks only.
    const result = runLore(["assess", planSlug, "--json"], tmpDir);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain("zero child tasks");
    expect(result.stdout).toContain("AI_PROVIDER_ERROR");
  });
});
