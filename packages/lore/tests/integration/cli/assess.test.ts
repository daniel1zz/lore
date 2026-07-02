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
 * Coverage:
 *   NEGATIVE:   --no-ai always exits 2 (assess has no non-AI mode, AC-ASSESS-9);
 *               --ai and --no-ai together exits 2; zero-task plan exits 4 (AC-ASSESS-8)
 *   BOUNDARY:   --diff + --diff-file mutual exclusivity exits 2 (AC-ASSESS-6) — checked
 *               BEFORE plan resolution, so it fires even for a nonexistent plan id
 *   ERROR:      n/a here (provider-error paths are in assess-ai.bun.test.ts)
 *   STATE:      n/a here
 *   REGRESSION: the zero-task gate fires even when `--diff`/`--ai` flags are also passed
 *               (gate ordering: mutex checks → plan resolution → zero-task → diff → AI)
 *
 * @spec_ref AC-ASSESS-6, AC-ASSESS-8, AC-ASSESS-9
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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
 * MOCK RISK: none — this calls the real CLI binary path.
 */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
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

// ─── --diff + --diff-file mutual exclusivity (AC-ASSESS-6) ──────────────────

describe("lore assess --diff + --diff-file — mutually exclusive (AC-ASSESS-6)", () => {
  it("AC-ASSESS-6.CLI.N1: exits 2 when both are passed, for an existing plan with tasks", () => {
    const planSlug = createPlan("Diff Mutex Plan");
    createTask(planSlug, "Task One");

    const result = runLore(["assess", planSlug, "--diff", "HEAD~1..HEAD", "--diff-file", "/tmp/nonexistent-diff.txt"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("mutually exclusive");
  });

  it("AC-ASSESS-6.CLI.N2: exits 2 even for a NONEXISTENT plan — checked before plan resolution", () => {
    const result = runLore(
      ["assess", "plan-does-not-exist-anywhere", "--diff", "HEAD~1..HEAD", "--diff-file", "/tmp/nonexistent-diff.txt"],
      tmpDir,
    );
    expect(result.exitCode).toBe(2);
  });
});

// ─── Zero-task plan gate (AC-ASSESS-8) ────────────────────────────────────────

describe("lore assess — zero-task plan (AC-ASSESS-8)", () => {
  it("AC-ASSESS-8.CLI.N1: exits 4 with VALIDATION_ERROR before any AI call, on a plan with zero tasks", () => {
    const planSlug = createPlan("Empty Plan");

    const result = runLore(["assess", planSlug], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("nothing to assess");
  });

  it("AC-ASSESS-8.CLI.N2: the zero-task gate fires even when --ai is explicitly passed (gate runs before AI)", () => {
    const planSlug = createPlan("Empty Plan With AI Flag");

    const result = runLore(["assess", planSlug, "--ai"], tmpDir);
    expect(result.exitCode).toBe(4);
  });

  it("AC-ASSESS-8.CLI.N3: a plan with at least one task does NOT hit the zero-task gate (progresses past validation exit 4)", () => {
    const planSlug = createPlan("Non-Empty Plan");
    createTask(planSlug, "A Task");

    // The default "claude" binary is unlikely to exist / succeed in this sandboxed test
    // env, so this should fail LATER (AI provider failure, exit 6) — NOT exit 4. This
    // is the negative-space check that AC-ASSESS-8's gate is scoped to zero tasks only.
    const result = runLore(["assess", planSlug], tmpDir);
    expect(result.exitCode).not.toBe(4);
  });
});
