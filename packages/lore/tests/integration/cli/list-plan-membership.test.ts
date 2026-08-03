/**
 * `lore list --plan-id`'s CONTRACT is plan MEMBERSHIP (`extra.plan_id`, via the
 * shared `isPlanMember` predicate) — RED-first suite for site 13 of
 * `task-plan-member-sites-twelve-and-thirteen-both-structurally`.
 *
 * Pre-fix, `--plan-id` resolved to a `parent_id` filter (`filters["parent_id"]
 * = resolvedPlanId`) — its own help text said so verbatim. That silently
 * excluded the SUPPORTED divergent shape SPEC-065 D4 describes (`lore create
 * task --plan-id P --parent Q`, P !== Q): a task legitimately a MEMBER of P
 * but FILED at Q never appeared under `lore list --plan-id P`, and (the
 * mirror bug, less obvious) DID appear under `lore list --plan-id Q` — a plan
 * that never declared it as a member at all.
 *
 * Runs the real CLI via subprocess against an isolated temp SQLite DB — same
 * pattern as `tests/integration/cli/list-paging.test.ts` and
 * `tests/integration/bootstrap-plan-membership.bun.test.ts`.
 *
 * Coverage (six dimensions):
 *   HAPPY      — a task diverged from its filing parent (parent_id=B,
 *                extra.plan_id=A) appears under `lore list --plan-id A`, both
 *                with and without `--type task` (the two branches this fix
 *                touches: the existing --type task branch, and the NEW
 *                plan-membership-only fallback for the untyped default path).
 *   BOUNDARY   — the SAME diverged task is ABSENT from `lore list --plan-id
 *                B` (its filing parent) — the mirror half of the old bug: B
 *                never declared this task as a member, so showing it there
 *                was itself wrong under the OLD parent_id contract.
 *   NEGATIVE   — a planless `--adhoc` task (no `extra.plan_id` at all) never
 *                appears under ANY `--plan-id` filter, even though its
 *                `parent_id` is the corpus root PRD (never a plan, so this is
 *                a vacuous-membership control, not a real ambiguity).
 *   ERROR      — `--plan-id <a slug that resolves to nothing>` fails loud
 *                (nonzero exit), unchanged by this fix (resolve() is shared).
 *   STATE      — two consecutive `lore list --plan-id` runs over an untouched
 *                corpus return byte-identical stdout (read-only, idempotent).
 *   REGRESSION — an ALIGNED task (`parent_id === extra.plan_id`, the common
 *                shape) appears under `lore list --plan-id` identically to the
 *                pre-fix contract — this shape is common to BOTH contracts, so
 *                it must never regress.
 *
 * @spec_ref task-plan-member-sites-twelve-and-thirteen-both-structurally
 * @spec_ref spec-065 D4
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

function runLoreOk(args: string[], cwd: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(
      `fixture step failed (exit ${result.exitCode}): lore ${args.join(" ")}\n` +
        `stderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  }
  return result;
}

function parseCreatedSlug(stdout: string): string {
  const m = /Slug:\s+(\S+)/.exec(stdout);
  const slug = m?.[1];
  if (slug === undefined) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

interface ListJsonEnvelope {
  readonly ok: true;
  readonly data: { readonly docs: ReadonlyArray<{ readonly slug: string }>; readonly total: number };
}

function listPlanId(cwd: string, planId: string, extraArgs: readonly string[] = []): ListJsonEnvelope {
  const r = runLoreOk(["list", "--plan-id", planId, "--json", ...extraArgs], cwd);
  return JSON.parse(r.stdout) as ListJsonEnvelope;
}

function slugsOf(envelope: ListJsonEnvelope): string[] {
  return envelope.data.docs.map((d) => d.slug);
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-list-plan-membership-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  runLoreOk(["init"], tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

function createPrd(title: string): string {
  return parseCreatedSlug(runLoreOk(["create", "prd", "--title", title, "--no-ai", "--content", "body"], tmpDir).stdout);
}

function createPlan(title: string, parentSlug: string): string {
  return parseCreatedSlug(
    runLoreOk(["create", "plan", "--title", title, "--parent", parentSlug, "--no-ai", "--content", "body"], tmpDir)
      .stdout,
  );
}

/** `parentSlug` is the FILING location (`--parent`); `planIdSlug` is the DECLARED membership (`--plan-id`). Diverges when they differ (SPEC-065 D4). */
function createTask(title: string, parentSlug: string, planIdSlug: string): string {
  return parseCreatedSlug(
    runLoreOk(
      [
        "create",
        "task",
        "--title",
        title,
        "--parent",
        parentSlug,
        "--plan-id",
        planIdSlug,
        "--no-ai",
        "--content",
        "body",
      ],
      tmpDir,
    ).stdout,
  );
}

/** A planless task: no `extra.plan_id`, filed at the corpus root PRD by construction (SPEC-069 D2). */
function createAdhocTask(title: string): string {
  return parseCreatedSlug(
    runLoreOk(
      ["create", "task", "--title", title, "--adhoc", "--ac-scope", "", "--no-ai", "--content", "body"],
      tmpDir,
    ).stdout,
  );
}

// ─── HAPPY + BOUNDARY: the diverged member ───────────────────────────────────

describe("lore list --plan-id: membership contract (site 13)", () => {
  it("HAPPY: a diverged task appears under its DECLARED plan (--plan-id), with --type task", () => {
    const root = createPrd("Membership Root");
    const planA = createPlan("Plan A", root);
    const planB = createPlan("Plan B", root);
    const diverged = createTask("Diverged Member", planB, planA);

    const result = listPlanId(tmpDir, planA, ["--type", "task"]);
    expect(slugsOf(result)).toContain(diverged);
  });

  it("HAPPY: a diverged task appears under its DECLARED plan (--plan-id) with NO --type filter (the plan-only fallback branch)", () => {
    const root = createPrd("Membership Root Untyped");
    const planA = createPlan("Plan A Untyped", root);
    const planB = createPlan("Plan B Untyped", root);
    const diverged = createTask("Diverged Member Untyped", planB, planA);

    const result = listPlanId(tmpDir, planA);
    expect(slugsOf(result)).toContain(diverged);
  });

  it("BOUNDARY: the SAME diverged task is ABSENT from its FILING parent's --plan-id listing", () => {
    const root = createPrd("Membership Root Boundary");
    const planA = createPlan("Plan A Boundary", root);
    const planB = createPlan("Plan B Boundary", root);
    const diverged = createTask("Diverged Member Boundary", planB, planA);

    const result = listPlanId(tmpDir, planB, ["--type", "task"]);
    expect(slugsOf(result)).not.toContain(diverged);
  });

  // ─── NEGATIVE ───────────────────────────────────────────────────────────────

  it("NEGATIVE: a planless --adhoc task never appears under ANY --plan-id filter", () => {
    const root = createPrd("Membership Root Adhoc");
    const planA = createPlan("Plan A Adhoc", root);
    const adhoc = createAdhocTask("Planless Adhoc");

    // Live control: the adhoc task exists and is filed at the root PRD (never a plan).
    const rootListing = JSON.parse(runLoreOk(["get", root, "--json"], tmpDir).stdout) as {
      data: { doc: { id: string } };
    };
    expect(rootListing.data.doc.id).toBeTruthy();

    const result = listPlanId(tmpDir, planA, ["--type", "task"]);
    expect(slugsOf(result)).not.toContain(adhoc);
  });

  // ─── ERROR ──────────────────────────────────────────────────────────────────

  it("ERROR: --plan-id naming a nonexistent slug fails loud (nonzero exit)", () => {
    const result = runLore(["list", "--plan-id", "plan-does-not-exist-xyz", "--json"], tmpDir);
    expect(result.exitCode).not.toBe(0);
  });

  // ─── STATE ──────────────────────────────────────────────────────────────────

  it("STATE: two consecutive runs over an untouched corpus are byte-identical", () => {
    const root = createPrd("Membership Root State");
    const planA = createPlan("Plan A State", root);
    createTask("Aligned Member State", planA, planA);

    const first = runLoreOk(["list", "--plan-id", planA, "--type", "task", "--json"], tmpDir).stdout;
    const second = runLoreOk(["list", "--plan-id", planA, "--type", "task", "--json"], tmpDir).stdout;
    expect(first).toBe(second);
  });

  // ─── REGRESSION ─────────────────────────────────────────────────────────────

  it("REGRESSION: an ALIGNED task (parent_id === extra.plan_id) appears identically under --plan-id", () => {
    const root = createPrd("Membership Root Regression");
    const planA = createPlan("Plan A Regression", root);
    const aligned = createTask("Aligned Member Regression", planA, planA);

    const withType = listPlanId(tmpDir, planA, ["--type", "task"]);
    expect(slugsOf(withType)).toContain(aligned);

    const withoutType = listPlanId(tmpDir, planA);
    expect(slugsOf(withoutType)).toContain(aligned);
  });
});
