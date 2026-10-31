// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-defect-clusters-round-1-done-floors-judge-real-runs-on  AC-DCL-1 (cases a-h), D1;
 *   business rules BR-199, BR-212, BR-146; reports #171 #174 #188 #49 #51 + three local reports.
 *
 * Every route that archives a task (`lore done`, `lore set --status archived`, plan close) applies the same
 * floors, judged by the contract compiled at `lore approve` (AC-DCS1-7); a floor counts only rows a runner produced
 * (`lore verify` attestation or `--capture`) bound to the code the task landed, and only work whose landing `lore integrate` recorded is
 * archived (BR-1291). Each case asserts the EXACT exit code and the refusing rule's name (`[floor: <id>]` in the refusal text).
 *
 * Fixture (CLI subprocess `bun run src/index.ts`, throwaway git repo + corpus — never the repo's own `.lore/`). A task is taken
 * through the stages the contract demands with `support/land-task.ts`: approved, claimed on a branch, committed on, landed on main
 * (a merge commit and the landing record) and, unless the case is about its absence, holding a runner pass for every contract oracle.
 * The retired steps: `lore red-first <task>` (the red run is the contract's default now, waived only at approve) and a pass captured
 * on a task that was never approved.
 *
 * Coverage: (a) unlanded branch -> exit 4 not-landed / landed through lore integrate -> archives (NEGATIVE + HAPPY); (b) `set --status archived`
 * with no attested pass -> the same refusal `done` gives (NEGATIVE + REGRESSION); (c) a pass running the anchor's contract command
 * satisfies a test-file anchor (HAPPY) while a pass naming another command does not (NEGATIVE); (d) self-reported expected-fail
 * does not satisfy red-first, `--capture` does (NEGATIVE + HAPPY); (e) latest attested fail beats an earlier pass
 * (STATE); (f) claim on archived/deprecated -> exit 4 (BOUNDARY); (g) every floor text names `lore verify` and
 * `lore evidence ... --capture` (ERROR text); (h) plan close leaves a floor-failing member task unarchived and
 * names it (REGRESSION, BR-1072).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo.js";
import { installShippedGuard } from "./support/main-guard-repo.js";
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { landTask, recordContractPasses, type TaskWorld } from "./support/land-task.js";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  /** stdout + stderr — refusals go to stderr, plain output to stdout. */
  readonly text: string;
}

const PROJECT_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PROJECT_ROOT, "src", "index.ts");
const ACTOR = "agent:done-floors-landed-real-runs-test";

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
  if (result.exitCode !== 0) {
    throw new Error(`lore ${args.join(" ")} exited ${result.exitCode}: ${result.text}`);
  }
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

/** Plan-close gate off + judgment off, and the commands approve compiles a code task's contract from (the test-file template runs the file whole). */
function relaxPlanGates(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:", "  gates:", '    "plan-close":', "      enabled: false", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"',
      "  done_contract:", '    install: "echo install-ok"', '    typecheck: "echo typecheck-ok"', '    test_file: "bun test {file}"', "",
    ].join("\n"),
  );
}

/** The two routes every floor refusal must name (g). */
function expectNamesBothRunnerRoutes(text: string): void {
  expect(text).toContain("lore verify");
  expect(text).toContain("lore evidence");
  expect(text).toContain("--capture");
}

let dir: string;
let wtRoot: string;
let planSlug: string;
let taskCounter = 0;
let landingCounter = 0;

function createTask(title: string, extra: string[] = []): string {
  taskCounter += 1;
  return parseSlug(
    mustRun(
      ["create", "task", "--kind", "code", "--title", `${title} ${taskCounter}`, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai", ...extra],
      dir,
    ),
  );
}

function worldOf(): TaskWorld {
  return { dir, git: (args) => git([...args], dir).trim(), lore: (args) => runLore([...args], dir) };
}

/**
 * Takes the draft `task` through the stages of the contract: approve (red run waived unless `redWaiver` is false), claim on a branch of
 * its own, commit, landing on main and (unless `recordPasses` is false) a runner pass for every contract oracle.
 */
async function land(task: string, options: { readonly recordPasses?: boolean; readonly redWaiver?: string | false } = {}): Promise<void> {
  landingCounter += 1;
  const branch = `dcl-${landingCounter}`;
  await landTask(worldOf(), { slug: task, branch, worktree: join(wtRoot, branch), claimValue: "branch", session: "dcl", ...options });
}

/** A runner-attested pass of `command`, captured at the shared checkout (a clean detached view of main after a landing). */
function capturePass(task: string, command: string, extra: string[] = []): void {
  mustRun(["evidence", task, "--oracle", "test", "--command", command, "--result", "pass", "--capture", ...extra], dir);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-done-floors-landed-"));
  wtRoot = mkdtempSync(join(tmpdir(), "lore-done-floors-wt-"));
  makeCleanTreeRepo(dir);
  mustRun(["init"], dir);
  appendFileSync(join(dir, ".git", "info", "exclude"), ".claude/\n"); // `lore integrate` keeps its worktree there
  relaxPlanGates(dir);
  const prd = parseSlug(mustRun(["create", "prd", "--title", "Floors PRD", "--content", "root", "--no-ai"], dir));
  planSlug = parseSlug(mustRun(["create", "plan", "--title", "Floors Plan", "--parent", prd, "--content", "x", "--no-ai"], dir));
  mustRun(["set", planSlug, "--status", "approved"], dir);
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
    rmSync(wtRoot, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

describe("AC-DCL-1 (a) — lore done archives only landed work", () => {
  it("(a) refuses with exit 4 [floor: not-landed] naming the branch until lore integrate lands it, then archives", () => {
    const task = createTask("Unlanded");
    mustRun(["approve", task, "--red-waiver", "the red run is not the subject of this test"], dir);
    git(["branch", "feat-unmerged", "main"], dir);
    git(["checkout", "-q", "--detach", "main"], dir);
    installShippedGuard(dir, join(dir, ".git", "guard-hooks")); // integrate refuses to run without the guard (BR-1273)
    mustRun(["claim", task, "--worktree", "feat-unmerged"], dir);
    // the work comes AFTER the claim: the claim's start is the branch tip at claim time
    git(["checkout", "-q", "feat-unmerged"], dir);
    writeFileSync(join(dir, "feature.txt"), "work\n");
    git(["add", "feature.txt"], dir);
    git(["commit", "-q", "-m", "feature work"], dir);
    git(["checkout", "-q", "--detach", "main"], dir);

    const refused = runLore(["done", task], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: not-landed]");
    expect(refused.text).toContain("feat-unmerged");
    expect(statusOf(task, dir)).not.toBe("archived");

    // the landing is made by integrate, which runs the contract oracles itself and records their rows (AC-DCS2-1)
    mustRun(["integrate", "feat-unmerged", "--session", "done-floors-session"], dir);
    const landed = runLore(["done", task], dir);

    expect(landed.exitCode).toBe(0);
    expect(statusOf(task, dir)).toBe("archived");
  }, 300_000);
});

describe("AC-DCL-1 (b) — set --status archived is no route around the floors", () => {
  it("(b) exits 4 [floor: attested-pass] with the refusal `lore done` gives, writes nothing; an attested task archives", async () => {
    const bare = createTask("Bare");
    await land(bare, { recordPasses: false });

    const viaSet = runLore(["set", bare, "--status", "archived"], dir);
    const viaDone = runLore(["done", bare], dir);

    expect(viaSet.exitCode).toBe(4);
    expect(viaSet.text).toContain("[floor: attested-pass]");
    expect(viaDone.exitCode).toBe(4);
    expect(viaDone.text).toContain("[floor: attested-pass]");
    expect(statusOf(bare, dir)).not.toBe("archived");

    const attested = createTask("Attested");
    await land(attested);
    const archivedViaSet = runLore(["set", attested, "--status", "archived"], dir);
    expect(archivedViaSet.exitCode).toBe(0);
    expect(statusOf(attested, dir)).toBe("archived");
  }, 300_000);
});

describe("AC-DCL-1 (c) — a pass running the anchor's contract command satisfies a test-file anchor (#188)", () => {
  const ANCHOR = "tests/anchor-case.test.ts";

  function addAnchorTestFile(): void {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(
      join(dir, ANCHOR),
      'import { expect, test } from "bun:test";\ntest("anchor case", () => { expect(1).toBe(1); });\n',
    );
    git(["add", "."], dir);
    git(["commit", "-q", "-m", "add anchor test"], dir);
  }

  it("(c) archives (exit 0) on an attested pass of the contract's whole-file command; a pass naming another command refuses exit 4 [floor: unfiltered-test-file]", async () => {
    addAnchorTestFile();
    const satisfied = createTask("Anchor e2e", ["--anchor", ANCHOR]);
    await land(satisfied);
    const ok = runLore(["done", satisfied], dir);
    expect(ok.exitCode, ok.text).toBe(0);
    expect(statusOf(satisfied, dir)).toBe("archived");

    const unsatisfied = createTask("Anchor other", ["--anchor", ANCHOR]);
    await land(unsatisfied, { recordPasses: false });
    capturePass(unsatisfied, "echo typecheck-ok"); // the typecheck oracle: the attested-pass floor is met
    mustRun(["evidence", unsatisfied, "--oracle", "e2e", "--command", "echo 'bun test tests/other.test.ts'", "--result", "pass", "--capture"], dir);
    const refused = runLore(["done", unsatisfied], dir);
    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: unfiltered-test-file]");
    expect(refused.text).toContain(ANCHOR);
    expectNamesBothRunnerRoutes(refused.text);
  }, 300_000);
});

describe("AC-DCL-1 (d) — red-first counts only runner-produced red rows", () => {
  it("(d) a self-reported expected-fail row refuses exit 4 [floor: red-first]; a --capture one satisfies it", async () => {
    // the red run is the contract's default (approve without a waiver); `lore red-first` is retired
    const selfReported = createTask("Red self");
    await land(selfReported, { redWaiver: false });
    mustRun(
      ["evidence", selfReported, "--oracle", "test", "--command", "bun test x", "--result", "expected-fail", "--output-tail", "1 fail: typed by hand"],
      dir,
    );
    const refused = runLore(["done", selfReported], dir);
    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: red-first]");
    expectNamesBothRunnerRoutes(refused.text);

    const captured = createTask("Red captured");
    await land(captured, { redWaiver: false });
    mustRun(["evidence", captured, "--oracle", "test", "--command", "echo '1 fail' && echo 'Ran 3 tests across 1 files' && false", "--result", "expected-fail", "--capture"], dir);
    const ok = runLore(["done", captured], dir);
    expect(ok.exitCode, ok.text).toBe(0);
    expect(statusOf(captured, dir)).toBe("archived");
  }, 300_000);
});

describe("AC-DCL-1 (e) — per criterion the latest attested result decides", () => {
  const RED = "echo '1 fail' && echo 'Ran 3 tests across 1 files' && false";

  function createTaskUnder(plan: string, title: string, acScope: string): string {
    return parseSlug(
      mustRun(["create", "task", "--kind", "code", "--title", title, "--parent", plan, "--plan-id", plan, "--ac-scope", acScope, "--content", "x", "--no-ai"], dir),
    );
  }

  it("(e) an attested fail recorded after an attested pass refuses exit 4 [floor: latest-attested-fail] naming the criterion", async () => {
    const spec = parseSlug(mustRun(["create", "spec", "--title", "Latest Spec", "--content", "## Overview\nx", "--no-ai"], dir));
    mustRun(["ac", "add", spec, "AC-LATEST-1", "--statement", "A criterion.", "--mode", "script", "--oracle", "other", "--command", "true"], dir);
    const plan = parseSlug(mustRun(["create", "plan", "--title", "Latest Plan", "--parent", spec, "--content", "x", "--no-ai"], dir));
    const task = createTaskUnder(plan, "Latest Task", "AC-LATEST-1");
    await land(task, { recordPasses: false });
    mustRun(["evidence", task, "--oracle", "test", "--command", RED, "--result", "expected-fail", "--ac", "AC-LATEST-1", "--capture"], dir);
    await recordContractPasses(worldOf(), task, "dcl");

    const whilePassing = runLore(["done", task], dir);
    expect(whilePassing.exitCode, whilePassing.text).toBe(0);

    const regressed = createTaskUnder(plan, "Latest Regressed", "AC-LATEST-1");
    await land(regressed, { recordPasses: false });
    mustRun(["evidence", regressed, "--oracle", "test", "--command", RED, "--result", "expected-fail", "--ac", "AC-LATEST-1", "--capture"], dir);
    await recordContractPasses(worldOf(), regressed, "dcl");
    mustRun(["evidence", regressed, "--oracle", "test", "--command", RED, "--result", "fail", "--ac", "AC-LATEST-1", "--capture"], dir);

    const refused = runLore(["done", regressed], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: latest-attested-fail]");
    expect(refused.text).toContain("AC-LATEST-1");
    expectNamesBothRunnerRoutes(refused.text);
    expect(statusOf(regressed, dir)).not.toBe("archived");
  }, 300_000);
});

describe("AC-DCL-1 (f) — a terminal task refuses claim", () => {
  it("(f) lore claim on an archived task exits 4", async () => {
    const task = createTask("Terminal");
    await land(task);
    mustRun(["done", task], dir);

    const claim = runLore(["claim", task], dir);

    expect(claim.exitCode).toBe(4);
    expect(claim.text).toContain("terminal task cannot be claimed");
    expect(claim.text).toContain("archived");
  }, 300_000);

  it("(f) lore claim on a deprecated task exits 4", () => {
    const task = createTask("Deprecated");
    mustRun(["set", task, "--status", "approved"], dir);
    mustRun(["set", task, "--status", "deprecated"], dir);

    const claim = runLore(["claim", task], dir);

    expect(claim.exitCode).toBe(4);
    expect(claim.text).toContain("deprecated");
  }, 300_000);
});

describe("AC-DCL-1 (g) — every floor refusal names both runner routes", () => {
  it("(g) attested-pass and red-first refusals name lore verify and lore evidence --capture", async () => {
    const bare = createTask("Text bare");
    await land(bare, { recordPasses: false });
    const attestedPass = runLore(["done", bare], dir);
    expect(attestedPass.exitCode).toBe(4);
    expect(attestedPass.text).toContain("[floor: attested-pass]");
    expectNamesBothRunnerRoutes(attestedPass.text);

    const redFirst = createTask("Text red");
    await land(redFirst, { redWaiver: false });
    const noRed = runLore(["done", redFirst], dir);
    expect(noRed.exitCode).toBe(4);
    expect(noRed.text).toContain("[floor: red-first]");
    expectNamesBothRunnerRoutes(noRed.text);
  }, 300_000);
});

describe("AC-DCL-1 (h) — plan close is no route around the floors (BR-1072)", () => {
  it("(h) closing the plan archives the attested member, leaves the floor-failing one unarchived and names it", async () => {
    const good = createTask("Close good");
    await land(good);
    const bad = createTask("Close bad");
    await land(bad, { recordPasses: false });
    // a freshly claimed member is skipped as such, whatever its floors say: the claims are released so the floors decide
    mustRun(["release", good], dir);
    mustRun(["release", bad], dir);

    const close = runLore(["set", planSlug, "--status", "archived"], dir);

    expect(close.exitCode, close.text).toBe(0);
    expect(statusOf(good, dir)).toBe("archived");
    expect(statusOf(bad, dir)).not.toBe("archived");
    expect(close.text).toContain(bad);
    expect(close.text).toContain("attested-pass");
  }, 300_000);
});
