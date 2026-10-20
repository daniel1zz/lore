// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref task-skill-fix-a-blocks-edge-in-a-feature-branch-plan-is-met (ad hoc, no spec)
 *
 * A plan that lands through ONE integration branch can never archive a blocker until that branch reaches
 * main (`lore done`'s not-landed floor), so its `blocks` edges used to read blocked until the final
 * landing. A plan may now declare `extra.integration_branch` (`lore plan integration-branch`): for
 * READINESS a blocker whose own work is on that branch counts as met, labelled "met on <branch>, not on
 * main"; `lore done` still judges landing against main.
 *
 * Fixture: CLI subprocess `bun run src/index.ts` over a throwaway git repo + corpus (never the repo's `.lore/`).
 *
 * Coverage: HAPPY (blocker merged into I: B ready, labelled, claimable; after I lands on main both archive),
 * NEGATIVE (no declared integration branch: B stays blocked; unmerged blocker keeps B blocked; `done A`
 * refuses while A is only on I), BOUNDARY (a claim with no commit past its base is trivially an ancestor and
 * must NOT unblock), ERROR (a malformed branch name is refused, exit 4, nothing written).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { installShippedGuard } from "./support/main-guard-repo.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly text: string;
}

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");
const ACTOR = "agent:feature-branch-blocks-test";
const INTEGRATION = "gs-integration";

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: ACTOR },
  });
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  return { stdout, stderr, exitCode: proc.exitCode ?? 1, text: `${stdout}\n${stderr}` };
}

function mustRun(args: string[], cwd: string): string {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${result.exitCode}: ${result.text}`);
  return result.stdout;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from create output: ${stdout}`);
  return slug;
}

function statusOf(slug: string, cwd: string): string {
  const payload = JSON.parse(mustRun(["get", slug, "--json"], cwd)) as { data: { doc: { status: string } } };
  return payload.data.doc.status;
}

function relaxPlanGates(dir: string): void {
  patchLoreConfig(
    dir,
    ["workflow:", "  gates:", '    "plan-close":', "      enabled: false", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"', ""].join("\n"),
  );
}

let dir: string;
let planSlug: string;
let counter = 0;

function createTask(title: string): string {
  counter += 1;
  return parseSlug(
    mustRun(["create", "task", "--title", `${title} ${counter}`, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai"], dir),
  );
}

interface ReadyRow {
  readonly task: { readonly slug: string };
  readonly ready: boolean;
  readonly unmet_blockers: readonly { readonly slug: string }[];
  readonly met_on_integration?: readonly { readonly slug: string; readonly branch: string }[];
}

function readyRow(task: string): ReadyRow {
  const payload = JSON.parse(mustRun(["ready", planSlug, "--json"], dir)) as { data: { ready: { records: ReadyRow[] } } };
  const row = payload.data.ready.records.find((r) => r.task.slug === task);
  if (row === undefined) throw new Error(`task ${task} absent from ready output`);
  return row;
}

/** Branch `name` off `from`, claimed by `task` BEFORE any work (so the claim records a base), then one commit on it. */
function startWork(task: string, name: string, from: string, commit: boolean): void {
  git(["branch", name, from], dir);
  mustRun(["claim", task, "--worktree", name], dir);
  if (!commit) return;
  git(["checkout", "-q", name], dir);
  writeFileSync(join(dir, `${name}.txt`), "work\n");
  git(["add", `${name}.txt`], dir);
  git(["commit", "-q", "-m", `work on ${name}`], dir);
  git(["checkout", "-q", "main"], dir);
}

function capturePass(task: string): void {
  mustRun(["evidence", task, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"], dir);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-feature-branch-blocks-"));
  makeCleanTreeRepo(dir);
  mustRun(["init"], dir);
  appendFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n"); // `lore integrate` keeps its worktree there
  relaxPlanGates(dir);
  const prd = parseSlug(mustRun(["create", "prd", "--title", "Blocks PRD", "--content", "root", "--no-ai"], dir));
  planSlug = parseSlug(mustRun(["create", "plan", "--title", "Blocks Plan", "--parent", prd, "--content", "x", "--no-ai"], dir));
  mustRun(["set", planSlug, "--status", "approved"], dir);
  git(["branch", INTEGRATION, "main"], dir);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("a blocks edge in a feature-branch plan is met when the blocker landed on the integration branch", () => {
  it("HAPPY: B is READY with a label naming the branch, claimable; done A refuses until main has it; then both archive", () => {
    mustRun(["plan", "integration-branch", planSlug, INTEGRATION], dir);
    const a = createTask("Blocker A");
    const b = createTask("Blocked B");
    mustRun(["link", a, b, "--type", "blocks"], dir);

    startWork(a, "feat-a", INTEGRATION, true);
    expect(readyRow(b).ready).toBe(false); // A's work is on its own branch only

    git(["checkout", "-q", INTEGRATION], dir);
    git(["merge", "-q", "--no-ff", "-m", "land A on I", "feat-a"], dir);
    git(["checkout", "-q", "main"], dir);

    const row = readyRow(b);
    expect(row.ready).toBe(true);
    expect(row.unmet_blockers).toEqual([]);
    expect(row.met_on_integration?.map((m) => [m.slug, m.branch])).toEqual([[a, INTEGRATION]]);
    const human = mustRun(["ready", planSlug], dir);
    expect(human).toContain(`${a} met on ${INTEGRATION}, not on main`);

    startWork(b, "feat-b", INTEGRATION, false);
    expect(statusOf(b, dir)).not.toBe("archived");

    capturePass(a);
    const refused = runLore(["done", a], dir);
    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");

    git(["merge", "-q", "--no-ff", "-m", "land I on main", INTEGRATION], dir);
    // both branches are on main now; integrate finds each already integrated and records the landing on its claimant
    git(["checkout", "-q", "--detach", "main"], dir); // the shared checkout is a detached view of main
    installShippedGuard(dir, join(dir, ".git", "guard-hooks")); // integrate refuses to run without the guard (BR-1273)
    mustRun(["integrate", "feat-a", "--session", "blocks-session"], dir);
    mustRun(["integrate", "feat-b", "--session", "blocks-session"], dir);
    capturePass(b);
    expect(runLore(["done", a], dir).exitCode).toBe(0);
    expect(runLore(["done", b], dir).exitCode).toBe(0);
    expect(statusOf(a, dir)).toBe("archived");
    expect(statusOf(b, dir)).toBe("archived");
  }, 600_000);

  it("NEGATIVE: without a declared integration branch the same landing leaves B blocked (current behaviour kept)", () => {
    const a = createTask("Blocker A");
    const b = createTask("Blocked B");
    mustRun(["link", a, b, "--type", "blocks"], dir);
    startWork(a, "feat-a", "main", true);
    git(["checkout", "-q", INTEGRATION], dir);
    git(["merge", "-q", "--no-ff", "-m", "land A on I", "feat-a"], dir);
    git(["checkout", "-q", "main"], dir);

    const row = readyRow(b);
    expect(row.ready).toBe(false);
    expect(row.unmet_blockers.map((u) => u.slug)).toEqual([a]);
    expect(row.met_on_integration).toBeUndefined();
  }, 300_000);

  it("BOUNDARY: a blocker claimed on a branch with no commit past its base does not unblock (an empty head is trivially an ancestor)", () => {
    mustRun(["plan", "integration-branch", planSlug, INTEGRATION], dir);
    const a = createTask("Blocker A");
    const b = createTask("Blocked B");
    mustRun(["link", a, b, "--type", "blocks"], dir);
    startWork(a, "feat-a", INTEGRATION, false);

    const row = readyRow(b);
    expect(row.ready).toBe(false);
    expect(row.unmet_blockers.map((u) => u.slug)).toEqual([a]);
  }, 300_000);

  it("ERROR: a malformed integration branch is refused with exit 4 and nothing is declared", () => {
    for (const bad of ["a..b", "has space", "bad:ref", "trail/"]) {
      const refused = runLore(["plan", "integration-branch", planSlug, bad], dir);
      expect(refused.exitCode, refused.text).toBe(4);
    }
    const a = createTask("Blocker A");
    const b = createTask("Blocked B");
    mustRun(["link", a, b, "--type", "blocks"], dir);
    expect(readyRow(b).ready).toBe(false);
  }, 300_000);
});
