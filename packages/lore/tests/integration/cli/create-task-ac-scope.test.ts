/**
 * Integration tests for the `task-create` admission gate (spec-declaring-ac-
 * scope-is-required-at-task-creation-so-the) — declaring `extra.ac_scope` is
 * required at `lore create task` time when the task's parent plan resolves a
 * spec-tier ancestor declaring >= 1 script-mode acceptance criterion. Runs the
 * real CLI via subprocess against an isolated throwaway corpus — same pattern
 * as `tests/integration/cli/verify.test.ts` / `task-workflow.test.ts`.
 *
 * Scope: adapter + service-layer translation (args → GateEnforcer.enforce
 * ("task-create", ctx) → exit code / stored extra.ac_scope). Business-rule
 * predicate math itself (`acScopeRequiredAtCreate`) is a pure function
 * exercised directly at the unit level; this file proves the WIRING — that
 * the real create path actually reaches it, for CLI callers, with the real
 * `--ac-scope` flag's absent-vs-empty CLI ergonomics.
 *
 * Coverage:
 *   NEGATIVE:   creating a task under a spec-lineaged plan with no --ac-scope
 *               is refused, exit 4, message names the literal `--ac-scope`
 *               (AC-ACS-1) and enumerates the governing spec's script-mode
 *               criterion ids so the author can copy one (AC-ACS-7)
 *   HAPPY:      the same creation WITH --ac-scope succeeds and the stored
 *               extra.ac_scope equals exactly the ids passed, in order
 *               (AC-ACS-2)
 *   BOUNDARY:   an explicit empty --ac-scope value succeeds and stores an
 *               EMPTY array, a state distinct from omitting the flag
 *               entirely (AC-ACS-3)
 *   STATE:      a plan whose spec declares only ai/human-mode criteria, or
 *               declares none at all, accepts a task with no --ac-scope —
 *               the predicate passes vacuously and adds no friction
 *               (AC-ACS-4); an --adhoc task (no parent plan at all) is
 *               created successfully with no --ac-scope — the trigger never
 *               fires with no parent plan to resolve a spec ancestor from
 *               (AC-ACS-5, D3 not-applicable-never-exempt)
 *
 * @spec_ref AC-ACS-1 AC-ACS-2 AC-ACS-3 AC-ACS-4 AC-ACS-5 AC-ACS-7
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

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir. MOCK RISK: none. */
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
  tmpDir = join(tmpdir(), `lore-create-task-ac-scope-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function mustRun(args: string[]): RunResult {
  const r = runLore(args, tmpDir);
  if (r.exitCode !== 0) {
    throw new Error(`fixture command \`lore ${args.join(" ")}\` failed (${r.exitCode}): ${r.stderr}`);
  }
  return r;
}

function createPrd(title: string): string {
  return extractSlug(mustRun(["create", "prd", "--title", title, "--no-ai", "--content", "## Overview\nbody"]).stdout);
}

function createSpec(title: string, parentSlug: string): string {
  return extractSlug(
    mustRun(["create", "spec", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "## Overview\nbody"])
      .stdout,
  );
}

function createPlan(title: string, parentSlug: string): string {
  return extractSlug(
    mustRun(["create", "plan", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"]).stdout,
  );
}

function declareScriptAc(specSlug: string, acId: string): void {
  mustRun([
    "ac",
    "add",
    specSlug,
    acId,
    "--statement",
    "A script-mode criterion.",
    "--mode",
    "script",
    "--oracle",
    "other",
    "--command",
    "true",
  ]);
}

function declareHumanAc(specSlug: string, acId: string): void {
  mustRun(["ac", "add", specSlug, acId, "--statement", "A human-judged criterion.", "--mode", "human"]);
}

interface DocJson {
  readonly slug: string;
  readonly extra: Record<string, unknown>;
}

function getDoc(slug: string): DocJson {
  const r = mustRun(["get", slug, "--json"]);
  return (JSON.parse(r.stdout) as { data: { doc: DocJson } }).data.doc;
}

/** Builds prd → spec (with 1 script-mode AC) → plan, returning both slugs. */
function buildScriptFixture(label: string): { specSlug: string; planSlug: string; acId: string } {
  const prdSlug = createPrd(`${label} PRD`);
  const specSlug = createSpec(`${label} Spec`, prdSlug);
  const acId = `AC-${label.toUpperCase().replace(/[^A-Z0-9]/g, "")}-1`;
  declareScriptAc(specSlug, acId);
  const planSlug = createPlan(`${label} Plan`, specSlug);
  return { specSlug, planSlug, acId };
}

// ─── AC-ACS-1 (NEGATIVE) / AC-ACS-7 (ERROR) ──────────────────────────────────

describe("lore create task — task-create admission gate (AC-ACS-1, AC-ACS-7)", () => {
  it("no --ac-scope under a script-lineaged plan is refused, exit 4, naming --ac-scope and the criterion id", () => {
    const { planSlug, acId } = buildScriptFixture("Refuse");

    const result = runLore(
      ["create", "task", "--title", "Unscoped Task", "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
      tmpDir,
    );

    expect(result.exitCode).toBe(4);
    // AC-ACS-1: the literal flag, so an author can copy-paste the fix.
    expect(result.stderr).toContain("--ac-scope");
    // AC-ACS-7: the governing spec's script-mode criterion id, not a query hint.
    expect(result.stderr).toContain(acId);
  });

  it("no doc is written for a refused creation — the task never lands in the corpus", () => {
    const { planSlug } = buildScriptFixture("NoWrite");

    runLore(
      ["create", "task", "--title", "Ghost Task", "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
      tmpDir,
    );

    const search = mustRun(["search", "Ghost Task", "--json"]);
    const parsed = JSON.parse(search.stdout) as { data: { results: unknown[] } };
    expect(parsed.data.results).toHaveLength(0);
  });
});

// ─── AC-ACS-2 (HAPPY) ─────────────────────────────────────────────────────────

describe("lore create task --ac-scope — the same creation WITH --ac-scope (AC-ACS-2)", () => {
  it("succeeds and the stored extra.ac_scope equals exactly the ids passed, in order", () => {
    const { planSlug, acId } = buildScriptFixture("Happy");

    const result = runLore(
      [
        "create",
        "task",
        "--title",
        "Scoped Task",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--no-ai",
        "--content",
        "body",
        "--ac-scope",
        acId,
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    const slug = extractSlug(result.stdout);
    expect(getDoc(slug).extra["ac_scope"]).toEqual([acId]);
  });

  it("a repeated --ac-scope flag stores every id, preserving passed order", () => {
    const prdSlug = createPrd("Multi PRD");
    const specSlug = createSpec("Multi Spec", prdSlug);
    declareScriptAc(specSlug, "AC-MULTI-1");
    declareScriptAc(specSlug, "AC-MULTI-2");
    const planSlug = createPlan("Multi Plan", specSlug);

    const result = runLore(
      [
        "create",
        "task",
        "--title",
        "Multi Scoped Task",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--no-ai",
        "--content",
        "body",
        "--ac-scope",
        "AC-MULTI-2",
        "--ac-scope",
        "AC-MULTI-1",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    const slug = extractSlug(result.stdout);
    expect(getDoc(slug).extra["ac_scope"]).toEqual(["AC-MULTI-2", "AC-MULTI-1"]);
  });
});

// ─── AC-ACS-3 (BOUNDARY) ──────────────────────────────────────────────────────

describe("lore create task --ac-scope \"\" — explicit empty value (AC-ACS-3)", () => {
  it("succeeds and stores an EMPTY array, distinct from omitting the flag entirely", () => {
    const { planSlug } = buildScriptFixture("Empty");

    const result = runLore(
      [
        "create",
        "task",
        "--title",
        "Explicitly Empty Task",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--no-ai",
        "--content",
        "body",
        "--ac-scope",
        "",
      ],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    const slug = extractSlug(result.stdout);
    const extra = getDoc(slug).extra;
    expect("ac_scope" in extra).toBe(true);
    expect(extra["ac_scope"]).toEqual([]);
  });
});

// ─── AC-ACS-4 (STATE — no new friction) ──────────────────────────────────────

describe("lore create task — a plan whose spec has no script-mode ACs adds no friction (AC-ACS-4)", () => {
  it("a spec declaring ONLY a human-mode criterion accepts a task with no --ac-scope", () => {
    const prdSlug = createPrd("HumanOnly PRD");
    const specSlug = createSpec("HumanOnly Spec", prdSlug);
    declareHumanAc(specSlug, "AC-HUMANONLY-1");
    const planSlug = createPlan("HumanOnly Plan", specSlug);

    const result = runLore(
      ["create", "task", "--title", "Unscoped OK Task", "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
    const slug = extractSlug(result.stdout);
    expect("ac_scope" in getDoc(slug).extra).toBe(false);
  });

  it("a spec declaring NO acceptance criteria at all accepts a task with no --ac-scope", () => {
    const prdSlug = createPrd("NoAc PRD");
    const specSlug = createSpec("NoAc Spec", prdSlug);
    const planSlug = createPlan("NoAc Plan", specSlug);

    const result = runLore(
      ["create", "task", "--title", "No AC Task", "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
  });

  it("a plan with no spec-tier ancestor at all (prd-parented) accepts a task with no --ac-scope", () => {
    const prdSlug = createPrd("Vacuum PRD");
    const planSlug = createPlan("Vacuum Plan", prdSlug);

    const result = runLore(
      ["create", "task", "--title", "Vacuum Task", "--parent", planSlug, "--plan-id", planSlug, "--no-ai", "--content", "body"],
      tmpDir,
    );

    expect(result.exitCode).toBe(0);
  });
});

// ─── AC-ACS-5 (STATE — --adhoc not-applicable, never exempt) ────────────────

describe("lore create task --adhoc — no parent plan, trigger never fires (AC-ACS-5)", () => {
  it("an --adhoc task with no --ac-scope is created successfully even under a corpus with script-mode ACs elsewhere", () => {
    // reason: D3 — an --adhoc task's structurally-absent parent plan means the
    // trigger never fires, regardless of what OTHER specs in the same corpus
    // declare. Seed an unrelated script-mode-AC spec first to prove this isn't
    // merely "no script ACs exist anywhere" (AC-ACS-4's vacuity) but genuinely
    // "no parent plan to resolve a spec ancestor from at all" (D3).
    const { planSlug: _unrelatedPlan } = buildScriptFixture("Unrelated");
    void _unrelatedPlan;
    createPrd("Adhoc Root PRD");

    const result = runLore(["create", "task", "--title", "Adhoc Task", "--adhoc", "--no-ai", "--content", "body"], tmpDir);

    expect(result.exitCode).toBe(0);
    const slug = extractSlug(result.stdout);
    expect("ac_scope" in getDoc(slug).extra).toBe(false);
  });
});
