// @spawns packages/lore/src/index.ts
// @reads assets/project/reference-transaction
/**
 * @spec_ref spec-defect-clusters-round-1-done-floors-judge-real-runs-on  AC-DCL-1 (cases a-h), D1;
 *   business rules BR-199, BR-212, BR-146; reports #171 #174 #188 #49 #51 + three local reports.
 *
 * Every route that archives a task (`lore done`, `lore set --status archived`, plan close) applies the same
 * floors; a floor counts only rows a runner produced (`lore verify` attestation or `--capture`), and only
 * work whose landing `lore integrate` recorded is archived (BR-1291). Each case asserts the EXACT exit code and the refusing rule's
 * name (`[floor: <id>]` in the refusal text).
 *
 * Fixture (CLI subprocess `bun run src/index.ts`, throwaway git repo + corpus — never the repo's own `.lore/`).
 *
 * Coverage: (a) unlanded branch -> exit 4 not-landed / landed through lore integrate -> archives (NEGATIVE + HAPPY); (b) `set --status archived`
 * with no attested pass -> the same refusal `done` gives (NEGATIVE + REGRESSION); (c) attested e2e pass satisfies a
 * test-file anchor (HAPPY) while a pass naming another file does not (NEGATIVE); (d) self-reported expected-fail
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

/** Plan-close gate off + judgment off: the suite approves a plan only to reach the floors it tests. */
function relaxPlanGates(dir: string): void {
  patchLoreConfig(
    dir,
    ["workflow:", "  gates:", '    "plan-close":', "      enabled: false", "  review:", "    judgment_required_types: []", "  integrate:", '    floor_command: "true"', ""].join("\n"),
  );
}

/** The two routes every floor refusal must name (g). */
function expectNamesBothRunnerRoutes(text: string): void {
  expect(text).toContain("lore verify");
  expect(text).toContain("lore evidence");
  expect(text).toContain("--capture");
}

let dir: string;
let planSlug: string;
let taskCounter = 0;

function createTask(title: string, extra: string[] = []): string {
  taskCounter += 1;
  return parseSlug(
    mustRun(
      ["create", "task", "--kind", "code", "--title", `${title} ${taskCounter}`, "--parent", planSlug, "--plan-id", planSlug, "--content", "x", "--no-ai", ...extra],
      dir,
    ),
  );
}

/** A runner-attested pass: `--capture` spawns the command and attests its exit code. */
function capturePass(task: string, extra: string[] = []): void {
  mustRun(["evidence", task, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--capture", ...extra], dir);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lore-done-floors-landed-"));
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
  } catch {
    // best-effort
  }
});

describe("AC-DCL-1 (a) — lore done archives only landed work", () => {
  it("(a) refuses with exit 4 [floor: not-landed] naming the branch until lore integrate lands it, then archives", () => {
    const task = createTask("Unlanded");
    git(["branch", "feat-unmerged", "main"], dir);
    git(["checkout", "-q", "--detach", "main"], dir);
    installShippedGuard(dir, join(dir, ".git", "guard-hooks")); // integrate refuses to run without the guard (BR-1273)
    mustRun(["claim", task, "--worktree", "feat-unmerged"], dir);
    capturePass(task);
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

    // a hand merge records no landing: the branch's content on main is not what `lore done` reads (BR-1291)
    mustRun(["integrate", "feat-unmerged", "--session", "done-floors-session"], dir);
    const landed = runLore(["done", task], dir);

    expect(landed.exitCode).toBe(0);
    expect(statusOf(task, dir)).toBe("archived");
  }, 300_000);
});

describe("AC-DCL-1 (b) — set --status archived is no route around the floors", () => {
  it("(b) exits 4 [floor: attested-pass] with the refusal `lore done` gives, writes nothing; an attested task archives", () => {
    const bare = createTask("Bare");

    const viaSet = runLore(["set", bare, "--status", "archived"], dir);
    const viaDone = runLore(["done", bare], dir);

    expect(viaSet.exitCode).toBe(4);
    expect(viaSet.text).toContain("[floor: attested-pass]");
    expect(viaDone.exitCode).toBe(4);
    expect(viaDone.text).toContain("[floor: attested-pass]");
    expect(statusOf(bare, dir)).toBe("draft");

    const attested = createTask("Attested");
    capturePass(attested);
    const archivedViaSet = runLore(["set", attested, "--status", "archived"], dir);
    expect(archivedViaSet.exitCode).toBe(0);
    expect(statusOf(attested, dir)).toBe("archived");
  }, 300_000);
});

describe("AC-DCL-1 (c) — an attested e2e pass satisfies a test-file anchor (#188)", () => {
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

  it("(c) archives (exit 0) on an attested oracle:e2e pass running the anchor unfiltered; a pass naming another file refuses exit 4 [floor: unfiltered-test-file]", () => {
    addAnchorTestFile();
    const satisfied = createTask("Anchor e2e", ["--anchor", ANCHOR]);
    capturePass(satisfied, []);
    mustRun(["evidence", satisfied, "--oracle", "e2e", "--command", `bun test ${ANCHOR}`, "--result", "pass", "--capture"], dir);
    const ok = runLore(["done", satisfied], dir);
    expect(ok.exitCode).toBe(0);
    expect(statusOf(satisfied, dir)).toBe("archived");

    const unsatisfied = createTask("Anchor other", ["--anchor", ANCHOR]);
    capturePass(unsatisfied);
    mustRun(["evidence", unsatisfied, "--oracle", "e2e", "--command", "echo 'bun test tests/other.test.ts'", "--result", "pass", "--capture"], dir);
    const refused = runLore(["done", unsatisfied], dir);
    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: unfiltered-test-file]");
    expect(refused.text).toContain(ANCHOR);
    expectNamesBothRunnerRoutes(refused.text);
  }, 300_000);
});

describe("AC-DCL-1 (d) — red-first counts only runner-produced red rows", () => {
  it("(d) a self-reported expected-fail row refuses exit 4 [floor: red-first]; a --capture one satisfies it", () => {
    const selfReported = createTask("Red self");
    mustRun(["red-first", selfReported], dir);
    capturePass(selfReported);
    mustRun(
      ["evidence", selfReported, "--oracle", "test", "--command", "bun test x", "--result", "expected-fail", "--output-tail", "1 fail: typed by hand"],
      dir,
    );
    const refused = runLore(["done", selfReported], dir);
    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: red-first]");
    expectNamesBothRunnerRoutes(refused.text);

    const captured = createTask("Red captured");
    mustRun(["red-first", captured], dir);
    capturePass(captured);
    mustRun(["evidence", captured, "--oracle", "test", "--command", "echo '1 fail' && echo 'Ran 3 tests across 1 files' && false", "--result", "expected-fail", "--capture"], dir);
    const ok = runLore(["done", captured], dir);
    expect(ok.exitCode).toBe(0);
    expect(statusOf(captured, dir)).toBe("archived");
  }, 300_000);
});

describe("AC-DCL-1 (e) — per criterion the latest attested result decides", () => {
  it("(e) an attested fail recorded after an attested pass refuses exit 4 [floor: latest-attested-fail] naming the criterion", () => {
    const spec = parseSlug(mustRun(["create", "spec", "--title", "Latest Spec", "--content", "## Overview\nx", "--no-ai"], dir));
    mustRun(["ac", "add", spec, "AC-LATEST-1", "--statement", "A criterion.", "--mode", "script", "--oracle", "other", "--command", "true"], dir);
    const plan = parseSlug(mustRun(["create", "plan", "--title", "Latest Plan", "--parent", spec, "--content", "x", "--no-ai"], dir));
    const task = parseSlug(
      mustRun(["create", "task", "--kind", "code", "--title", "Latest Task", "--parent", plan, "--plan-id", plan, "--ac-scope", "AC-LATEST-1", "--content", "x", "--no-ai"], dir),
    );
    mustRun(["evidence", task, "--oracle", "test", "--command", "echo '1 fail' && echo 'Ran 3 tests across 1 files' && false", "--result", "expected-fail", "--ac", "AC-LATEST-1", "--capture"], dir);
    mustRun(["evidence", task, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--ac", "AC-LATEST-1", "--capture"], dir);

    const whilePassing = runLore(["done", task], dir);
    expect(whilePassing.exitCode).toBe(0);

    const regressed = createTaskUnder(plan, "Latest Regressed", "AC-LATEST-1");
    mustRun(["evidence", regressed, "--oracle", "test", "--command", "echo '1 fail' && echo 'Ran 3 tests across 1 files' && false", "--result", "expected-fail", "--ac", "AC-LATEST-1", "--capture"], dir);
    mustRun(["evidence", regressed, "--oracle", "test", "--command", "echo 'Ran 3 tests'", "--result", "pass", "--ac", "AC-LATEST-1", "--capture"], dir);
    mustRun(["evidence", regressed, "--oracle", "test", "--command", "echo '1 fail' && echo 'Ran 3 tests across 1 files' && false", "--result", "fail", "--ac", "AC-LATEST-1", "--capture"], dir);

    const refused = runLore(["done", regressed], dir);

    expect(refused.exitCode).toBe(4);
    expect(refused.text).toContain("[floor: latest-attested-fail]");
    expect(refused.text).toContain("AC-LATEST-1");
    expectNamesBothRunnerRoutes(refused.text);
    expect(statusOf(regressed, dir)).not.toBe("archived");
  }, 300_000);
});

function createTaskUnder(plan: string, title: string, acScope: string): string {
  return parseSlug(
    mustRun(["create", "task", "--kind", "code", "--title", title, "--parent", plan, "--plan-id", plan, "--ac-scope", acScope, "--content", "x", "--no-ai"], dir),
  );
}

describe("AC-DCL-1 (f) — a terminal task refuses claim", () => {
  it("(f) lore claim on an archived task exits 4", () => {
    const task = createTask("Terminal");
    capturePass(task);
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
  it("(g) attested-pass and red-first/no-new-tests refusals name lore verify and lore evidence --capture", () => {
    const bare = createTask("Text bare");
    const attestedPass = runLore(["done", bare], dir);
    expect(attestedPass.exitCode).toBe(4);
    expect(attestedPass.text).toContain("[floor: attested-pass]");
    expectNamesBothRunnerRoutes(attestedPass.text);

    const redFirst = createTask("Text red");
    mustRun(["red-first", redFirst], dir);
    capturePass(redFirst);
    const noRed = runLore(["done", redFirst], dir);
    expect(noRed.exitCode).toBe(4);
    expect(noRed.text).toContain("[floor: red-first]");
    expectNamesBothRunnerRoutes(noRed.text);
  }, 300_000);
});

describe("AC-DCL-1 (h) — plan close is no route around the floors (BR-1072)", () => {
  it("(h) closing the plan archives the attested member, leaves the floor-failing one unarchived and names it", () => {
    const good = createTask("Close good");
    capturePass(good);
    const bad = createTask("Close bad");

    const close = runLore(["set", planSlug, "--status", "archived"], dir);

    expect(close.exitCode).toBe(0);
    expect(statusOf(good, dir)).toBe("archived");
    expect(statusOf(bad, dir)).not.toBe("archived");
    expect(close.text).toContain(bad);
    expect(close.text).toContain("attested-pass");
  }, 300_000);
});
