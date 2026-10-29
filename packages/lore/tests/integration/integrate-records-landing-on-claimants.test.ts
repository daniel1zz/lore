// @spawns packages/lore/src/index.ts
// @reads packages/lore/src/service/integrate-service.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-a-task-is-archived-only-on-a-landing-lore-recorded-one  AC-LRD-2;
 *   business rule BR-1336 (integration records a landing on every claimant, also when the branch is already integrated).
 *
 * Throwaway git repo + throwaway corpus (mkdtemp + `git init` + `lore init`), real `lore` subprocesses; never the
 * repo's own `.lore/`.
 *
 * Coverage: (1) landing a claimed branch writes `extra.landing` {branch, branch_head, main_before, main_after,
 * landing_commit} on the task and prints its slug (HAPPY); (2) re-running integrate on the already-integrated branch
 * records a landing on a second claimant that had none, exits 0, and leaves the first claimant's landing untouched
 * (STATE + REGRESSION); (3) a branch no claim named prints that the landing names no task (NEGATIVE); (4) an archived
 * task that once claimed the branch is not rewritten (BOUNDARY).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { installShippedGuard } from "./support/main-guard-repo.js";

interface RunResult {
  readonly stdout: string;
  readonly exitCode: number;
  readonly text: string;
}

interface LandingJson {
  readonly branch: string;
  readonly branch_head: string;
  readonly main_before: string;
  readonly main_after: string;
  readonly landing_commit: string;
  readonly recorded_at: string;
  readonly kind?: string;
  readonly start_head?: string;
  readonly tip?: string;
}

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");

let dir: string;
let planSlug: string;
let taskCounter = 0;

function runLore(args: string[]): RunResult {
  const proc = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: "agent:integrate-records-landing-test" },
  });
  return { stdout: proc.stdout, exitCode: proc.status ?? 1, text: `${proc.stdout}\n${proc.stderr}` };
}

function mustRun(args: string[]): string {
  const result = runLore(args);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${result.exitCode}: ${result.text}`);
  return result.stdout;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from create output: ${stdout}`);
  return slug;
}

function landingOf(slug: string): LandingJson | undefined {
  const payload = JSON.parse(mustRun(["get", slug, "--json"])) as { data: { doc: { extra: { landing?: LandingJson } } } };
  return payload.data.doc.extra.landing;
}

function makeBranch(name: string): void {
  git(["checkout", "-q", "-b", name, "main"]);
  writeFileSync(join(dir, `${name}.txt`), `${name}\n`);
  git(["add", `${name}.txt`]);
  git(["commit", "-q", "-m", `work on ${name}`]);
  git(["checkout", "-q", "--detach", "main"]);
}

function createTask(title: string): string {
  taskCounter += 1;
  return parseSlug(
    mustRun(["create", "task", "--title", `${title} ${taskCounter}`, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai"]),
  );
}

function integrate(branch: string): RunResult {
  return runLore(["integrate", branch, "--session", "records-landing-session"]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-integrate-claimants-"));
  makeCleanTreeRepo(dir);
  appendFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n");
  mustRun(["init"]);
  patchLoreConfig(dir, ["workflow:", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"', ""].join("\n"));
  const prd = parseSlug(mustRun(["create", "prd", "--title", "Claimants PRD", "--content", "root", "--no-ai"]));
  planSlug = parseSlug(mustRun(["create", "plan", "--title", "Claimants Plan", "--parent", prd, "--content", "x", "--no-ai"]));
  git(["checkout", "-q", "--detach", "main"]);
  installShippedGuard(dir, join(dir, ".git", "guard-hooks")); // integrate refuses to run without the guard (BR-1273)
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("AC-LRD-2 — lore integrate records a landing on every claimant", () => {
  it("(1) landing a claimed branch records extra.landing on the task and prints its slug", () => {
    makeBranch("feat-one");
    const task = createTask("One");
    mustRun(["claim", task, "--worktree", "feat-one"]);
    const tip = git(["rev-parse", "feat-one"]);
    const before = git(["rev-parse", "main"]);

    const landed = integrate("feat-one");

    expect(landed.exitCode, landed.text).toBe(0);
    expect(landed.text).toMatch(new RegExp(`landing of feat-one recorded on .*${task}`));
    const landing = landingOf(task);
    expect(landing).toBeDefined();
    expect(landing?.branch).toBe("feat-one");
    expect(landing?.branch_head).toBe(tip);
    expect(landing?.main_before).toBe(before);
    expect(landing?.main_after).toBe(git(["rev-parse", "main"]));
    expect(landing?.landing_commit).toBe(landing?.main_after);
  }, 300_000);

  it("(2) re-running integrate on the already-integrated branch records a landing on a second claimant that had none", () => {
    makeBranch("feat-two");
    const first = createTask("First");
    mustRun(["claim", first, "--worktree", "feat-two"]);
    expect(integrate("feat-two").exitCode).toBe(0);
    const firstLanding = landingOf(first);
    // the first task's landing is on main, so a second claim naming the same branch is allowed (BR-1337)
    const second = createTask("Second");
    mustRun(["claim", second, "--worktree", "feat-two"]);
    expect(landingOf(second)).toBeUndefined();
    const mainBefore = git(["rev-parse", "main"]);

    const again = integrate("feat-two");

    expect(again.exitCode, again.text).toBe(0);
    expect(again.text).toContain("already integrated");
    expect(again.text).toContain(second);
    expect(git(["rev-parse", "main"])).toBe(mainBefore);
    const secondLanding = landingOf(second);
    expect(secondLanding?.branch).toBe("feat-two");
    expect(secondLanding?.branch_head).toBe(git(["rev-parse", "feat-two"]));
    expect(landingOf(first)).toEqual(firstLanding);
  }, 300_000);

  it("(2b) an already-integrated branch records the branch head itself as the landed commit, with the claim's base as the range start", () => {
    makeBranch("feat-head");
    const first = createTask("HeadFirst");
    const tip = git(["rev-parse", "feat-head"]);
    mustRun(["claim", first, "--worktree", "feat-head"]);
    expect(integrate("feat-head").exitCode).toBe(0);
    // the branch is on main now (its head is an ancestor of a merge commit); a second claimant has no landing yet
    const task = createTask("Head");
    mustRun(["claim", task, "--worktree", "feat-head"]);
    const mainTip = git(["rev-parse", "main"]);

    const again = integrate("feat-head");

    expect(again.exitCode, again.text).toBe(0);
    expect(again.text).toContain("already integrated");
    const landing = landingOf(task);
    expect(landing?.branch_head).toBe(tip);
    expect(landing?.landing_commit).toBe(tip);
    expect(landing?.main_after).toBe(mainTip);
    expect(landing?.main_before).not.toBe(mainTip);
  }, 300_000);

  it("(2c) integrate-service.ts reconstructs nothing from main's history", () => {
    const source = readFileSync(join(PROJECT_ROOT, "src", "service", "integrate-service.ts"), "utf8");
    expect(source).not.toContain("locateExistingLanding");
    expect(source).not.toContain("ancestry-path");
    expect(source).not.toContain('"rev-list"');
  });

  it("(3) a branch no claim named is refused (BR-1348): no task belongs to it, so no landing could name one", () => {
    makeBranch("feat-unclaimed");
    createTask("Bystander");
    const mainBefore = git(["rev-parse", "main"]);

    const refused = integrate("feat-unclaimed");

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain("BR-1348");
    expect(git(["rev-parse", "main"])).toBe(mainBefore);
  }, 300_000);

  it("(4) an archived task that once claimed the branch keeps its record", () => {
    makeBranch("feat-four");
    const old = createTask("Old");
    mustRun(["claim", old, "--worktree", "feat-four"]);
    expect(integrate("feat-four").exitCode).toBe(0);
    const oldLanding = landingOf(old);
    mustRun(["evidence", old, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"]);
    mustRun(["set", planSlug, "--status", "approved"]);
    mustRun(["done", old]);
    git(["checkout", "-q", "feat-four"]);
    writeFileSync(join(dir, "four-more.txt"), "more\n");
    git(["add", "four-more.txt"]);
    git(["commit", "-q", "-m", "more work on the same branch"]);
    git(["checkout", "-q", "--detach", "main"]);

    const landed = integrate("feat-four");

    expect(landed.exitCode, landed.text).toBe(0);
    expect(landed.text).toContain("recorded on no task");
    expect(landingOf(old)).toEqual(oldLanding);
  }, 300_000);

  it("(5) the landing's kind is measured from its own range, and a later re-claim, release and done never rewrite the record (BR-1372, BR-1336)", () => {
    makeBranch("feat-five");
    const task = createTask("Five");
    // the claim comes AFTER the branch's commit, so the claim's start_head equals the branch tip: the old derivation read that as no-change
    mustRun(["claim", task, "--worktree", "feat-five"]);
    const before = git(["rev-parse", "main"]);
    expect(integrate("feat-five").exitCode).toBe(0);
    const recorded = landingOf(task);
    expect(recorded?.kind).toBe("commits");
    expect(recorded?.start_head).toBe(before);
    expect(recorded?.tip).toBe(recorded?.branch_head);

    mustRun(["claim", task, "--worktree", "feat-five"]);
    expect(landingOf(task)).toEqual(recorded);
    mustRun(["release", task]);
    expect(landingOf(task)).toEqual(recorded);
    mustRun(["claim", task]);
    expect(landingOf(task)).toEqual(recorded);
    mustRun(["evidence", task, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"]);
    mustRun(["release", task]);
    mustRun(["set", planSlug, "--status", "approved"]);
    mustRun(["done", task]);
    expect(landingOf(task)).toEqual(recorded);
  }, 300_000);
});
