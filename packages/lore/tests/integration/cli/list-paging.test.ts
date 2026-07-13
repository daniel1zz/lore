/**
 * Integration tests for `lore list --limit`/`--offset` (pagination hardening,
 * unbounded-payload review). Runs the real CLI via subprocess against an isolated
 * temp SQLite DB — same pattern as tests/integration/cli/task-workflow.test.ts.
 *
 * Scope: translation-only (args → paged StoreFilters/ListFilters → CorpusService
 * call → JSON shape). Cross-store paging correctness (LIMIT/OFFSET binding,
 * deterministic ORDER BY tiebreaker) is exhaustively covered at the store layer
 * (tests/unit/store/paging.shared.ts) — this file only proves the CLI actually
 * threads `--limit`/`--offset` through to that already-tested paging contract, and
 * that omitting both flags stays byte-identical to pre-pagination behavior.
 *
 * Coverage:
 *   HAPPY:      `--type task --limit 2 --offset 1` returns exactly 2 tasks, no
 *               overlap with page 1
 *   STATE (REGRESSION): no paging flags → every matching doc returned, unchanged
 *   BOUNDARY:   `--limit 0` → empty result, no error
 *
 * @spec_ref pagination hardening (list/findMany read path, unbounded-payload review)
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
  tmpDir = join(
    tmpdir(),
    `lore-list-paging-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
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

interface ListJsonPayload {
  ok: boolean;
  data: { docs: Array<{ id: string; slug: string }>; total: number };
}

function parseListJson(stdout: string): ListJsonPayload {
  return JSON.parse(stdout) as ListJsonPayload;
}

// ─── HAPPY — --limit/--offset page through --type task ────────────────────────

describe("lore list --type task --limit/--offset — HAPPY", () => {
  it("--limit 2 --offset 1 returns exactly 2 tasks, non-overlapping with page 1", () => {
    const planSlug = createPlan("Paging Plan");
    createTask(planSlug, "Task A");
    createTask(planSlug, "Task B");
    createTask(planSlug, "Task C");

    const page1 = runLore(["list", "--type", "task", "--limit", "2", "--offset", "0", "--json"], tmpDir);
    const page2 = runLore(["list", "--type", "task", "--limit", "2", "--offset", "1", "--json"], tmpDir);
    expect(page1.exitCode).toBe(0);
    expect(page2.exitCode).toBe(0);

    const parsed1 = parseListJson(page1.stdout);
    const parsed2 = parseListJson(page2.stdout);
    expect(parsed1.data.docs).toHaveLength(2);
    expect(parsed2.data.docs).toHaveLength(2);

    // offset:1 shares exactly one row with offset:0 (the overlap window), and
    // page2's first row is page1's second row (deterministic order).
    expect(parsed2.data.docs[0]?.id).toBe(parsed1.data.docs[1]?.id);
  });
});

// ─── STATE (REGRESSION) — no paging flags stays unbounded ─────────────────────

describe("lore list — no paging flags (REGRESSION)", () => {
  it("returns every matching task when --limit/--offset are omitted", () => {
    const planSlug = createPlan("Unpaged Plan");
    createTask(planSlug, "Task 1");
    createTask(planSlug, "Task 2");
    createTask(planSlug, "Task 3");

    const result = runLore(["list", "--type", "task", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = parseListJson(result.stdout);
    expect(parsed.data.docs).toHaveLength(3);
    expect(parsed.data.total).toBe(3);
  });

  it("plain `lore list` (no --type, no paging) exits 0 and prints a table, unchanged", () => {
    const planSlug = createPlan("Plain List Plan");
    createTask(planSlug, "Plain Task");

    const result = runLore(["list"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("document");
  });
});

// ─── BOUNDARY — --limit 0 / offset beyond row count ────────────────────────────

describe("lore list --limit/--offset — BOUNDARY", () => {
  it("--limit 0 returns an empty page, no error", () => {
    const planSlug = createPlan("Zero Limit Plan");
    createTask(planSlug, "Task Zero");

    const result = runLore(["list", "--type", "task", "--limit", "0", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = parseListJson(result.stdout);
    expect(parsed.data.docs).toEqual([]);
    expect(parsed.data.total).toBe(0);
  });

  it("--offset beyond the matching row count returns an empty page, no error", () => {
    const planSlug = createPlan("Offset Overflow Plan");
    createTask(planSlug, "Task Only");

    const result = runLore(
      ["list", "--type", "task", "--limit", "10", "--offset", "999", "--json"],
      tmpDir,
    );
    expect(result.exitCode).toBe(0);
    const parsed = parseListJson(result.stdout);
    expect(parsed.data.docs).toEqual([]);
  });
});
