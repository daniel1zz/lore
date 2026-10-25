// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-a-task-is-archived-only-on-a-landing-lore-recorded-one  AC-LRD-1;
 *   business rules BR-1291 (archival needs a recorded landing), BR-209 (the `not-landed` requirement's place in the order).
 *
 * `lore done` (and `lore set --status archived`, plan close) decides from the landing `lore integrate` recorded on the
 * task, never from the claimed working copy's head and never from main's history. Throwaway git repo + throwaway
 * corpus (mkdtemp + `git init` + `lore init`), real `lore` subprocesses; never the repo's own `.lore/`.
 *
 * Coverage: (a) content cherry-picked to main, no recorded landing -> exit 4 `[floor: not-landed]` (NEGATIVE);
 * (b) landing recorded, then one more commit on the branch -> exit 4 `[floor: not-landed]` (STATE);
 * (c) landing recorded, branch deleted -> archives (HAPPY + BOUNDARY); (d) no landing, working copy and branch deleted
 * -> exit 4, no fail-open (ERROR); (e) `lore set --status archived` refuses (a) with the same floor name (REGRESSION).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { installShippedGuard } from "./support/main-guard-repo.js";

interface RunResult {
  readonly stdout: string;
  readonly exitCode: number;
  /** stdout + stderr: refusals go to stderr, plain output to stdout. */
  readonly text: string;
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
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, CLAUDECODE: "1", LORE_ACTOR: "agent:landing-record-decides-done-test" },
  });
  return { stdout: proc.stdout, exitCode: proc.status ?? 1, text: `${proc.stdout}\n${proc.stderr}` };
}

function mustRun(args: string[]): string {
  const result = runLore(args);
  if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${result.exitCode}: ${result.text}`);
  return result.stdout;
}

function git(args: string[], extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...extraEnv } }).toString();
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from create output: ${stdout}`);
  return slug;
}

function statusOf(slug: string): string {
  const payload = JSON.parse(mustRun(["get", slug, "--json"])) as { data: { doc: { status: string } } };
  return payload.data.doc.status;
}

/** A branch holding one commit, main checked out detached afterwards (what `lore integrate` expects of the shared checkout). */
function makeBranch(name: string): void {
  git(["checkout", "-q", "-b", name, "main"]);
  writeFileSync(join(dir, `${name}.txt`), `${name}\n`);
  git(["add", `${name}.txt`]);
  git(["commit", "-q", "-m", `work on ${name}`]);
  git(["checkout", "-q", "--detach", "main"]);
}

/** The branch's content reaches main WITHOUT `lore integrate` (a hand cherry-pick): no landing is recorded anywhere. */
function cherryPickOntoMain(branch: string): void {
  // the guard refuses a hand checkout of main and a hand commit on it; this test takes the marker bypass on purpose
  const marked = { LORE_INTEGRATE: "1" };
  git(["checkout", "-q", "main"], marked);
  git(["cherry-pick", branch], marked);
  git(["checkout", "-q", "--detach", "main"]);
}

function recordPass(task: string): void {
  mustRun(["evidence", task, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture"]);
}

/**
 * A claimed task on `branch`. With `evidence: true` (the default) its pass is already on record, so the landing's done
 * walk (BR-1356) archives it at once; with `evidence: false` the landing leaves it unarchived for a later `lore done`.
 */
function createClaimedTask(title: string, branch: string, evidence = true): string {
  taskCounter += 1;
  const task = parseSlug(
    mustRun(["create", "task", "--title", `${title} ${taskCounter}`, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai"]),
  );
  mustRun(["claim", task, "--worktree", branch]);
  if (evidence) recordPass(task);
  return task;
}

function integrate(branch: string): RunResult {
  return runLore(["integrate", branch, "--session", "landing-record-session"]);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-landing-record-done-"));
  makeCleanTreeRepo(dir);
  appendFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n");
  mustRun(["init"]);
  patchLoreConfig(
    dir,
    ["workflow:", "  gates:", '    "plan-close":', "      enabled: false", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"', ""].join("\n"),
  );
  const prd = parseSlug(mustRun(["create", "prd", "--title", "Landing PRD", "--content", "root", "--no-ai"]));
  planSlug = parseSlug(mustRun(["create", "plan", "--title", "Landing Plan", "--parent", prd, "--content", "x", "--no-ai"]));
  mustRun(["set", planSlug, "--status", "approved"]);
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

describe("AC-LRD-1 — lore done decides from the recorded landing only", () => {
  it("(a) work cherry-picked onto main without lore integrate has no landing: exit 4 [floor: not-landed] naming the branch", () => {
    makeBranch("feat-picked");
    const task = createClaimedTask("Picked", "feat-picked");
    cherryPickOntoMain("feat-picked");

    const refused = runLore(["done", task]);

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("feat-picked");
    expect(statusOf(task)).not.toBe("archived");
  }, 300_000);

  it("(b) a landing is recorded, then the branch gets one more commit: exit 4 [floor: not-landed] naming the unlanded commit", () => {
    makeBranch("feat-late");
    // no pass on record yet: the landing's done walk leaves the task unarchived (a task whose floors are all met is
    // archived by the landing itself, BR-1356, and nothing is left for a later `lore done` to refuse)
    const task = createClaimedTask("Late", "feat-late", false);
    const landed = integrate("feat-late");
    expect(landed.exitCode, landed.text).toBe(0);
    expect(landed.text).toContain(task);
    expect(statusOf(task)).not.toBe("archived");
    git(["checkout", "-q", "feat-late"]);
    writeFileSync(join(dir, "late.txt"), "after the landing\n");
    git(["add", "late.txt"]);
    git(["commit", "-q", "-m", "committed after the landing"]);
    git(["checkout", "-q", "--detach", "main"]);
    recordPass(task);

    const refused = runLore(["done", task]);

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("feat-late");
    expect(refused.text).toContain("1 commit(s) not on main");
    expect(statusOf(task)).not.toBe("archived");
  }, 300_000);

  it("(c) a landing is recorded and the branch deleted: archives", () => {
    makeBranch("feat-gone");
    const task = createClaimedTask("Gone", "feat-gone");
    expect(integrate("feat-gone").exitCode).toBe(0);
    git(["branch", "-q", "-d", "feat-gone"]);

    const done = runLore(["done", task]);

    expect(done.exitCode, done.text).toBe(0);
    expect(statusOf(task)).toBe("archived");
  }, 300_000);

  it("(d) no landing and the branch deleted is refused: an unmeasurable state never archives", () => {
    makeBranch("feat-lost");
    const task = createClaimedTask("Lost", "feat-lost");
    git(["branch", "-q", "-D", "feat-lost"]);

    const refused = runLore(["done", task]);

    expect(refused.exitCode, refused.text).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(statusOf(task)).not.toBe("archived");
  }, 300_000);

  it("(e) lore set --status archived refuses (a) with the same floor name", () => {
    makeBranch("feat-set");
    const task = createClaimedTask("Set route", "feat-set");
    cherryPickOntoMain("feat-set");

    const viaSet = runLore(["set", task, "--status", "archived"]);

    expect(viaSet.exitCode, viaSet.text).toBe(4);
    expect(viaSet.text).toContain("[floor: not-landed]");
    expect(statusOf(task)).not.toBe("archived");
  }, 300_000);
});
