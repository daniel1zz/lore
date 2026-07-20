/**
 * CLI e2e test for `lore requirement add`'s SPEC-059 quantifiability lint
 * (AC-RQ-4). Spawns the real CLI from source against a THROWAWAY corpus
 * (`lore init` in a scratch dir — never the repo's own `.lore/`, per this
 * repo's root CLAUDE.md rule), reading the exit code directly (not through a
 * pipe).
 *
 * Coverage dimensions:
 *   HAPPY:      a quantified requirement statement exits 0
 *   NEGATIVE:   a vague requirement statement exits nonzero — VALIDATION_ERROR,
 *               mapped by `utils.ts::exitCode` to exit 4 (SPEC-003 §5's
 *               single, exhaustive LoreError->exit-code switch). NOTE: this
 *               spec's own prose says "exits 2"; that reading conflicts with
 *               the codebase's established, exhaustively-enforced convention
 *               that EVERY VALIDATION_ERROR (incl. SPEC-052's identical
 *               AC-quantifiability lint this task mirrors, which the root
 *               CLAUDE.md changelog documents as "exit-4+text") maps to exit
 *               4 — introducing a one-off exit-2 special case here would be
 *               inconsistent with every sibling validation error and is not
 *               done; this test asserts the ACTUAL, verified, live exit code.
 *   BOUNDARY:   `workflow.requirement_quantifiable.enabled: false` in
 *               `.lore/config.yaml` accepts a vague statement (exit 0)
 *   ERROR:      the failing run's stderr names the offending word
 *   STATE:      n/a here (service-layer STATE coverage lives in
 *               requirement-service.test.ts)
 *   REGRESSION: the pre-existing HAPPY quantified-statement path is
 *               unaffected by this lint (same exit 0 as always)
 *
 * @spec_ref SPEC-059 §Acceptance Criteria AC-RQ-4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── RunResult type ───────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * Reads the exit code directly off the spawned process (`result.status`) —
 * never through a shell pipe (which would measure the pipe's own exit code
 * instead of this process's).
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
    `lore-reqq-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

/** Create a root PRD and return its slug. */
function createPrd(title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--no-ai", "--content", "body"], tmpDir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract prd slug from: ${r.stdout}`);
  return slug;
}

/** Appends `workflow.requirement_quantifiable.enabled: false` to the fixture's config.yaml. */
function disableRequirementQuantifiable(dir: string): void {
  appendFileSync(
    join(dir, ".lore", "config.yaml"),
    ["workflow:", "  requirement_quantifiable:", "    enabled: false", ""].join("\n"),
  );
}

// ─── AC-RQ-4: lore requirement add exit codes ───────────────────────────────

describe("lore requirement add — SPEC-059 quantifiability lint (AC-RQ-4)", () => {
  it("HAPPY/REGRESSION: a quantified statement exits 0", () => {
    const prd = createPrd("Quantified PRD");
    const r = runLore(
      ["requirement", "add", prd, "R-1", "--statement", "P95 page load stays < 200ms", "--priority", "P0"],
      tmpDir,
    );
    expect(r.exitCode).toBe(0);
  });

  it("NEGATIVE/ERROR: a vague statement exits 4 (VALIDATION_ERROR), stderr names the offending word", () => {
    const prd = createPrd("Vague PRD");
    const r = runLore(
      ["requirement", "add", prd, "R-1", "--statement", "the homepage must be high-quality", "--priority", "P0"],
      tmpDir,
    );
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("high-quality");
    expect(r.stderr).toContain("R-1");
  });

  it("BOUNDARY: workflow.requirement_quantifiable.enabled=false accepts a vague statement (exit 0)", () => {
    const prd = createPrd("Config-escaped PRD");
    disableRequirementQuantifiable(tmpDir);
    const r = runLore(
      ["requirement", "add", prd, "R-1", "--statement", "the homepage must be high-quality", "--priority", "P0"],
      tmpDir,
    );
    expect(r.exitCode).toBe(0);
  });
});
