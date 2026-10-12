/**
 * @spec_ref spec-session-start-injection-carries-only-the-session-s-own — AC-SI-2, AC-SI-4.
 *
 * Compiled-binary oracle for the seat-only `lore bootstrap --injection`:
 *   - a main-checkout call (no seat flags) prints NOTHING (exit 0, empty stdout)
 *   - a seat call prints only {scope_declaration, [resume_hint,] seat_claims}
 *   - claims match by branch name OR by realpath of the worktree directory (D11, D12)
 *   - --seat-branch / --seat-worktree must come together in --injection mode (exit 2)
 *   - retired config knobs warn once per set key on stderr; char_budget never slices
 *
 * Never touches the repo's own `.lore/` — every scenario uses `mkdtemp` + `lore init`.
 * Run `bun run build` first; `assertFreshBinary` fails loud on a stale `dist/lore`.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

function mustRun(args: string[], cwd: string): RunResult {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}`);
  return r;
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`no slug in: ${stdout}`);
  return slug;
}

interface Seeded {
  readonly prd: string;
  readonly plan: string;
}

/** prd + plan; tasks are created on demand by `claimTask`. */
function seed(dir: string): Seeded {
  mustRun(["init"], dir);
  const prd = parseSlug(mustRun(["create", "prd", "--title", "Seat PRD", "--content", "r", "--no-ai"], dir).stdout);
  const plan = parseSlug(
    mustRun(["create", "plan", "--title", "Seat Plan", "--parent", prd, "--content", "x", "--no-ai"], dir).stdout,
  );
  return { prd, plan };
}

let taskCounter = 0;
/** Creates a fresh task under `plan` and claims it with `--worktree <worktree>`; returns its slug. */
function claimTask(dir: string, plan: string, worktree: string): string {
  taskCounter += 1;
  const slug = parseSlug(
    mustRun(
      ["create", "task", "--title", `Seat task ${taskCounter}`, "--parent", plan, "--plan-id", plan, "--content", "x", "--no-ai"],
      dir,
    ).stdout,
  );
  mustRun(["claim", slug, "--worktree", worktree], dir);
  return slug;
}

function injection(dir: string, branch: string, worktree: string, extra: string[] = []): RunResult {
  return runLore(["bootstrap", "--injection", "--seat-branch", branch, "--seat-worktree", worktree, ...extra], dir);
}

function claimSlugs(r: RunResult): string[] {
  expect(r.exitCode).toBe(0);
  const parsed = JSON.parse(r.stdout) as { seat_claims: Array<{ task_slug: string }> };
  return parsed.seat_claims.map((c) => c.task_slug);
}

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [join(REPO_ROOT, "packages", "lore", "src"), join(REPO_ROOT, "packages", "core", "src")]);
});

describe("AC-SI-2: compiled dist/lore bootstrap --injection is seat-only", () => {
  let dir: string;
  let seeded: Seeded;
  let scratch: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-seat-injection-"));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    seeded = seed(dir);
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "lore-seat-dirs-")));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  it("(a) no seat flags, even with a claimed task -> exit 0 and stdout exactly empty", () => {
    claimTask(dir, seeded.plan, "feat-a");
    const r = runLore(["bootstrap", "--injection"], dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("(b) a claim recorded with the seat branch -> keys [scope_declaration, seat_claims] naming that task", () => {
    const slug = claimTask(dir, seeded.plan, "feat-x");
    const r = injection(dir, "feat-x", scratch);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["scope_declaration", "seat_claims"]);
    expect(claimSlugs(r)).toEqual([slug]);
  });

  it("(b2) a claim recorded as an absolute dir D matches a seat worktree that is a symlink to D", () => {
    const real = join(scratch, "b2-real");
    const link = join(scratch, "b2-link");
    mkdirSync(real);
    symlinkSync(real, link);
    const slug = claimTask(dir, seeded.plan, real);
    expect(claimSlugs(injection(dir, "other-b2", link))).toEqual([slug]);
  });

  it("(b3) the reverse: a claim recorded as the symlink path matches the real seat path", () => {
    const real = join(scratch, "b3-real");
    const link = join(scratch, "b3-link");
    mkdirSync(real);
    symlinkSync(real, link);
    const slug = claimTask(dir, seeded.plan, link);
    expect(claimSlugs(injection(dir, "other-b3", real))).toEqual([slug]);
  });

  it("(b3) a claim recorded with a trailing slash also matches", () => {
    const real = join(scratch, "b3-slash");
    mkdirSync(real);
    const slug = claimTask(dir, seeded.plan, `${real}/`);
    expect(claimSlugs(injection(dir, "other-slash", real))).toEqual([slug]);
  });

  it("(b3) a claim whose recorded directory no longer exists still matches its own path string, never throws (D12)", () => {
    const gone = join(scratch, "never-created");
    const slug = claimTask(dir, seeded.plan, gone);
    const r = injection(dir, "other-gone", gone);
    expect(r.stderr).not.toContain("ENOENT");
    expect(claimSlugs(r)).toEqual([slug]);
  });

  it("(c) another branch with an unrelated worktree -> stdout empty", () => {
    const unrelated = join(scratch, "unrelated");
    mkdirSync(unrelated);
    const r = injection(dir, "other-branch-c", unrelated);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("(d) after lore done archives the claimed task -> stdout empty", () => {
    const slug = claimTask(dir, seeded.plan, "feat-done");
    expect(claimSlugs(injection(dir, "feat-done", scratch))).toEqual([slug]);
    mustRun(["evidence", slug, "--oracle", "test", "--command", "echo ok", "--result", "pass", "--capture"], dir);
    mustRun(["done", slug], dir);
    const r = injection(dir, "feat-done", scratch);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("(g) --seat-branch without --seat-worktree, or the reverse, exits exactly 2", () => {
    const onlyBranch = runLore(["bootstrap", "--injection", "--seat-branch", "feat-x"], dir);
    expect(onlyBranch.exitCode).toBe(2);
    expect(onlyBranch.stdout).toBe("");
    const onlyWorktree = runLore(["bootstrap", "--injection", "--seat-worktree", scratch], dir);
    expect(onlyWorktree.exitCode).toBe(2);
    expect(onlyWorktree.stdout).toBe("");
  });

  it("(f) a seat whose branch names a plan with a handoff gets resume_hint; an unrelated seat branch gets none (BR-326)", () => {
    mustRun(["handoff", "--plan", seeded.plan, "--next", "next step", "--decision", "decision@80"], dir);
    const shortSlug = seeded.plan.replace(/^plan-/, "");
    const hit = injection(dir, `plan/${shortSlug}`, scratch);
    expect(hit.exitCode).toBe(0);
    const parsed = JSON.parse(hit.stdout) as { resume_hint?: { plan_slug: string | null } };
    expect(Object.keys(parsed)).toEqual(["scope_declaration", "resume_hint", "seat_claims"]);
    expect(parsed.resume_hint?.plan_slug).toBe(seeded.plan);

    const miss = injection(dir, "plan/no-such-plan-here", scratch);
    expect(miss.exitCode).toBe(0);
    expect(miss.stdout).toBe("");
  });
});

describe("AC-SI-2 (e): plain bootstrap --json is unchanged", () => {
  it("keeps exactly the 10-key set on a fresh corpus", () => {
    const fresh = mkdtempSync(join(tmpdir(), "lore-seat-fresh-"));
    try {
      mustRun(["init"], fresh);
      const r = mustRun(["bootstrap", "--json"], fresh);
      const data = (JSON.parse(r.stdout) as { data: Record<string, unknown> }).data;
      expect(Object.keys(data).sort()).toEqual(
        [
          "active_plans",
          "active_sessions",
          "archive_candidates",
          "armed_gates",
          "corpus",
          "latest_handoffs",
          "my_claims",
          "pending_reviews",
          "resume_hint",
          "root",
        ].sort(),
      );
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe("AC-SI-4: retired config knobs + char_budget", () => {
  let dir: string;
  let seeded: Seeded;
  let scratch: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-seat-knobs-"));
    seeded = seed(dir);
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "lore-seat-knobs-dirs-")));
    claimTask(dir, seeded.plan, "feat-knobs");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  it("exits 0 and warns exactly once per SET retired key on stderr", () => {
    appendFileSync(
      join(dir, ".lore", "config.yaml"),
      "\nworkflow:\n  bootstrap_injection:\n    max_active_plans: 2\n    max_handoffs: 2\n    max_pending_slugs: 2\n",
      "utf8",
    );
    const r = injection(dir, "feat-knobs", scratch);
    expect(r.exitCode).toBe(0);
    for (const key of ["max_active_plans", "max_handoffs", "max_pending_slugs"]) {
      const lines = r.stderr.split("\n").filter((l) => l.includes(`bootstrap_injection.${key}`));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("deprecated");
    }
  });

  it("a config setting no retired key emits no deprecation line", () => {
    const clean = mkdtempSync(join(tmpdir(), "lore-seat-knobs-clean-"));
    try {
      mustRun(["init"], clean);
      const r = runLore(["bootstrap", "--injection", "--seat-branch", "x", "--seat-worktree", scratch], clean);
      expect(r.exitCode).toBe(0);
      expect(r.stderr).not.toContain("deprecated");
    } finally {
      rmSync(clean, { recursive: true, force: true });
    }
  });

  it("char_budget=50 with a seat claim -> budget_exceeded true, payload parses as JSON (never sliced)", () => {
    appendFileSync(join(dir, ".lore", "config.yaml"), "    char_budget: 50\n", "utf8");
    const r = injection(dir, "feat-knobs", scratch);
    expect(r.exitCode).toBe(0);
    const parsed = JSON.parse(r.stdout) as { budget_exceeded?: boolean; seat_claims: unknown[] };
    expect(parsed.budget_exceeded).toBe(true);
    expect(parsed.seat_claims).toHaveLength(1);
  });
});
