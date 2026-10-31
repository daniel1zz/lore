// @spawns packages/lore/src/index.ts
// @layer integration-cli-verify-missing-oracle AC-EI-2 (real CLI in a throwaway corpus; owner is the evidence-identity spec oracle)
/**
 * A script AC whose command names a test file that no longer exists is NOT MEASURED
 * (task-skill-implement-tg-10-verify-records-a-missing-oracle-file; spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-6;
 * baseline AS-17: a completeness/fidelity oracle never reports complete over what it could not see).
 *
 * Subprocess pattern (commands/ac.ts imports bun:sqlite, unresolvable under vitest): `bun run src/index.ts` in a
 * `mkdtemp` + `lore init` corpus inside a git repository on `main`, never this repo's `.lore/`.
 *
 * Under the done-contract model (AC-DCS1-7) `lore done` judges a task by the contract compiled at approve: the AC of the task's
 * ac_scope is the contract oracle `ac:<id>`, which a counted pass row must have run with the AC's CURRENT command, bound to the code the
 * task landed. The retired "oracle-file" floor of `lore done` (a refusal read from the AC's coverage state) therefore became the
 * `contract-oracles` floor: an AC whose file is missing has no counted pass, so `lore done` exits 4 naming `ac:<id>` and the command
 * (which names the missing path), once the task is landed and its other oracles hold their passes. Each task is approved with its
 * contract, claimed on a branch of its own, landed on main (a merge commit and the landing record) and given the pass of `typecheck`.
 *
 * Dimension mapping:
 *   HAPPY:      the oracle file exists -> verify records an attested pass, `ac list` renders attested_pass
 *   NEGATIVE:   file deleted -> verify exits 3 (the inconclusive exit) with the missing path in its output, records `inconclusive` (never pass/fail),
 *               `ac list` coverage state is `not_measured`, `lore done` exits exactly 4 [floor: contract-oracles] naming the AC and the path
 *   STATE:      the earlier attested pass stays in the log but no longer renders as passing (and no longer counts: its tree is not the landed tree)
 *   REGRESSION: repointing the command to an existing file clears the refusal (verify passes, done exits 0)
 *
 * @spec_ref AC-TG-6
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../../helpers/clean-tree-repo.js";
import { withSessionIdentity } from "../../helpers/session-actor.js";
import { landTask, type TaskWorld } from "../support/land-task.js";

const GIT_AUTHOR_ARGS = ["-c", "user.email=lore-test@example.com", "-c", "user.name=Lore Test"] as const;
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const AC_ID = "AC-M-1";
const TYPECHECK_COMMAND = "echo typecheck-ok";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string, actor: string | null = "missing-oracle-test"): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    // reason: HOME lies outside the fixture repository, so bun/lore caches never dirty the tree a captured pass is bound to
    env: withSessionIdentity({ ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, EDITOR: "true", CLAUDECODE: "1" }, actor) as Record<string, string>,
    encoding: "utf8",
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

function mustRun(args: string[], cwd: string): string {
  const r = runLore(args, cwd);
  if (r.exitCode !== 0) throw new Error(`lore ${args.join(" ")} failed (${r.exitCode}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

function extractSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function disableAllGates(dir: string): void {
  patchLoreConfig(
    dir,
    [
      "workflow:",
      "  gates:",
      ...["spec-create", "spec-promote", "plan-promote", "task-claim", '"task-create"'].flatMap((g) => [
        `    ${g}:`,
        "      enabled: false",
      ]),
      // approve compiles each task's done contract from these commands (a code task needs all three)
      "  done_contract:",
      '    install: "echo install-ok"',
      `    typecheck: "${TYPECHECK_COMMAND}"`,
      '    test_file: "echo Ran 1 tests in {file}"',
      "",
    ].join("\n"),
  );
}

const PASSING_TEST_BODY = 'import { test, expect } from "bun:test";\ntest("ok", () => { expect(1).toBe(1); });\n';

/** A git repository on `main` with one commit; the corpus and the linked worktrees never dirty its tree. */
function makeRepo(dir: string): void {
  const git = (...args: string[]): void => void execFileSync("git", [...GIT_AUTHOR_ARGS, ...args], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  appendFileSync(join(dir, ".git", "info", "exclude"), ".lore/\n.claude/\n");
  writeFileSync(join(dir, "README.md"), "fixture\n");
  git("add", "-A");
  git("commit", "-q", "-m", "fixture base");
}

/** Commits whatever is pending ON main (a landing leaves the shared checkout detached at main's tip, so main is checked out first). */
function commitAll(dir: string, msg: string): void {
  execFileSync("git", ["checkout", "-q", "main"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", [...GIT_AUTHOR_ARGS, "commit", "-q", "-m", msg, "--allow-empty"], { cwd: dir });
}

function worldOf(dir: string): TaskWorld {
  return { dir, git: (args) => execFileSync("git", [...GIT_AUTHOR_ARGS, ...args], { cwd: dir, encoding: "utf8" }).trim(), lore: (args) => runLore([...args], dir) };
}

/** The shared scratch directory that holds the linked worktrees of every landing in this file. */
const wtRoots: string[] = [];

/**
 * Claims the approved `task` on a branch of its own, commits there, lands the branch on main (no integrate run) and leaves the shared
 * checkout detached at the landing commit, with the task holding no pass yet; then records the runner pass of `typecheck`.
 */
async function landWithTypecheckPass(dir: string, task: string, branch: string): Promise<void> {
  const wtRoot = mkdtempSync(join(tmpdir(), "lore-missing-oracle-wt-"));
  wtRoots.push(wtRoot);
  await landTask(worldOf(dir), { slug: task, branch, worktree: join(wtRoot, branch), claimValue: "branch", session: "missing-oracle-test", approve: false, recordPasses: false });
  const recorded = runLore(["evidence", task, "--oracle", "test", "--command", TYPECHECK_COMMAND, "--result", "pass", "--capture"], dir);
  expect(recorded.exitCode, recorded.stdout + recorded.stderr).toBe(0);
}

function coverageState(dir: string, spec: string, acId: string = AC_ID): string | undefined {
  const parsed = JSON.parse(mustRun(["ac", "list", spec, "--json"], dir)) as {
    data: { coverage: Array<{ ac_id: string; state: string }> | null };
  };
  return parsed.data.coverage?.find((f) => f.ac_id === acId)?.state;
}

function lastEvidenceResult(dir: string, task: string): string | undefined {
  const parsed = JSON.parse(mustRun(["get", task, "--json"], dir)) as {
    data: { doc: { extra: { verification_evidence?: Array<{ result: string }> } } };
  };
  const rows = parsed.data.doc.extra.verification_evidence ?? [];
  return rows[rows.length - 1]?.result;
}

afterAll(() => {
  for (const root of wtRoots) rmSync(root, { recursive: true, force: true });
});

describe("lore verify / ac list / done over an AC whose oracle file is missing", () => {
  let dir: string;
  let spec: string;
  let plan: string;
  let task: string;

  // reason: ~10 CLI spawns at ~1-2s each.
  beforeAll(() => {
    mkdirSync(FIXTURE_HOME_OUTSIDE_REPO, { recursive: true });
    dir = mkdtempSync(join(tmpdir(), "lore-missing-oracle-"));
    makeRepo(dir);
    mustRun(["init"], dir);
    disableAllGates(dir);
    mustRun(["create", "prd", "--title", "Missing Oracle PRD", "--no-ai", "--content", "body"], dir);
    spec = extractSlug(mustRun(["create", "spec", "--title", "Missing Oracle Spec", "--no-ai", "--content", "body"], dir));
    writeFileSync(join(dir, "oracle.test.ts"), PASSING_TEST_BODY);
    writeFileSync(join(dir, "replacement.test.ts"), PASSING_TEST_BODY);
    mustRun(
      ["ac", "add", spec, AC_ID, "--statement", "oracle file exists", "--mode", "script", "--oracle", "test",
        "--command", `bun test oracle.test.ts && echo '${AC_ID} PASS: oracle ran'`],
      dir,
    );
    plan = extractSlug(mustRun(["create", "plan", "--title", "Missing Oracle Plan", "--parent", spec, "--no-ai", "--content", "body"], dir));
    task = extractSlug(
      mustRun(["create", "task", "--kind", "code", "--title", "Missing Oracle Task", "--parent", plan, "--plan-id", plan, "--ac-scope", AC_ID, "--no-ai", "--content", "body"], dir),
    );
    commitAll(dir, "fixture");
    // the contract (oracles ac:AC-M-1 and typecheck) is compiled here; the red run is not this file's subject (AC-DCS1-5)
    mustRun(["approve", task, "--red-waiver", "the red run is not the subject of this test"], dir);
  }, 180_000);

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("HAPPY: with the file present verify attests a pass and ac list renders attested_pass", { timeout: 120_000 }, () => {
    const verified = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    expect(lastEvidenceResult(dir, task)).toBe("pass");
    expect(coverageState(dir, spec)).toBe("attested_pass");
  });

  it("NEGATIVE/STATE: file deleted -> verify records not-measured with the path, list stops showing a pass, done exits 4 naming the AC", { timeout: 180_000 }, async () => {
    rmSync(join(dir, "oracle.test.ts"));
    commitAll(dir, "delete oracle");

    const verified = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(3);
    expect(verified.stdout + verified.stderr).toContain("oracle.test.ts");
    expect(lastEvidenceResult(dir, task)).toBe("inconclusive");

    expect(coverageState(dir, spec)).toBe("not_measured");

    // the task lands on a main without the file; the earlier pass ran on a tree that held it, so it no longer counts
    await landWithTypecheckPass(dir, task, "missing-oracle-landing");
    const again = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], dir);
    expect(again.exitCode, again.stdout + again.stderr).toBe(3);

    const done = runLore(["done", task], dir);
    expect(done.exitCode, done.stdout + done.stderr).toBe(4);
    expect(done.stderr).toContain("[floor: contract-oracles]");
    expect(done.stderr).toContain(`ac:${AC_ID}`);
    expect(done.stderr).toContain("oracle.test.ts");
  });

  it("REGRESSION: repointing the command at an existing file restores verify and done", { timeout: 180_000 }, () => {
    mustRun(
      ["ac", "set", spec, AC_ID, "--command", `bun test replacement.test.ts && echo '${AC_ID} PASS: replacement ran'`],
      dir,
    );
    commitAll(dir, "repoint"); // an empty commit: the tree is still the landed tree, so the rows recorded on it count
    const verified = runLore(["verify", plan, "--task", task, "--ac", AC_ID, "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    expect(coverageState(dir, spec)).toBe("attested_pass");

    const done = runLore(["done", task], dir);
    expect(done.exitCode, done.stdout + done.stderr).toBe(0);
  });
});

// ─── A declared-not-yet-written oracle is not a lie; a declared one that once passed and vanished is ───────────

describe("AC-TG-6 — red-first (--allow-missing-path) ACs: no evidence stays none; done refuses until the oracle has a counted pass; a vanished once-passing oracle refuses too", () => {
  let dir: string;
  let spec: string;
  let plan: string;
  let taskRedFirst: string;
  let taskVanished: string;
  let taskDifferentFile: string;
  let taskDotSpelling: string;
  let taskScript: string;

  const addScriptAc = (id: string, file: string, extra: string[] = []): void => {
    mustRun(
      ["ac", "add", spec, id, "--statement", `${id} oracle`, "--mode", "script", "--oracle", "test",
        "--command", `bun test ${file} && echo '${id} PASS: ran'`, ...extra],
      dir,
    );
  };
  const stateOf = (id: string): string | undefined => coverageState(dir, spec, id);
  const newTask = (title: string, scope: string[]): string => {
    const slug = extractSlug(
      mustRun(["create", "task", "--kind", "code", "--title", title, "--parent", plan, "--plan-id", plan, "--ac-scope", scope[0] as string, "--no-ai", "--content", "body"], dir),
    );
    for (const extra of scope.slice(1)) mustRun(["scope", "add", slug, extra], dir);
    return slug;
  };
  /** Asserts the refusal every case below ends in: the contract-oracles floor, naming the AC oracle and its command (which names the path). */
  const expectRefusedNaming = (done: RunResult, acId: string, path: string): void => {
    expect(done.exitCode, done.stdout + done.stderr).toBe(4);
    expect(done.stderr).toContain("[floor: contract-oracles]");
    expect(done.stderr).toContain(`ac:${acId}`);
    expect(done.stderr).toContain(path);
  };

  // reason: ~20 CLI spawns at ~1-2s each.
  beforeAll(() => {
    mkdirSync(FIXTURE_HOME_OUTSIDE_REPO, { recursive: true });
    dir = mkdtempSync(join(tmpdir(), "lore-missing-oracle-rf-"));
    makeRepo(dir);
    mustRun(["init"], dir);
    disableAllGates(dir);
    mustRun(["create", "prd", "--title", "RF PRD", "--no-ai", "--content", "body"], dir);
    spec = extractSlug(mustRun(["create", "spec", "--title", "RF Spec", "--no-ai", "--content", "body"], dir));
    writeFileSync(join(dir, "ok.test.ts"), PASSING_TEST_BODY);
    addScriptAc("AC-OK", "ok.test.ts");
    addScriptAc("AC-RF", "later.test.ts", ["--allow-missing-path", "red-first: a later task writes it"]);
    addScriptAc("AC-VAN", "vanish.test.ts", ["--allow-missing-path", "red-first: written before verify"]);
    addScriptAc("AC-DIFF", "never-written.test.ts", ["--allow-missing-path", "red-first: a later task writes it"]);
    addScriptAc("AC-DOT", "dotspelled.bun.test.ts", ["--allow-missing-path", "red-first: written before the pass"]);
    mustRun(
      ["ac", "add", spec, "AC-SCR", "--statement", "AC-SCR script oracle", "--mode", "script", "--oracle", "other",
        "--command", "sh scripts/ran.sh", "--allow-missing-path", "red-first: written before the pass"],
      dir,
    );
    plan = extractSlug(mustRun(["create", "plan", "--title", "RF Plan", "--parent", spec, "--no-ai", "--content", "body"], dir));
    taskRedFirst = newTask("RF Task One", ["AC-OK", "AC-RF"]);
    taskVanished = newTask("RF Task Two", ["AC-OK", "AC-VAN"]);
    taskDifferentFile = newTask("RF Task Three", ["AC-OK", "AC-DIFF"]);
    taskDotSpelling = newTask("RF Task Four", ["AC-OK", "AC-DOT"]);
    taskScript = newTask("RF Task Five", ["AC-OK", "AC-SCR"]);
    commitAll(dir, "fixture");
    // every task's contract (its ac oracles and typecheck) is compiled here; the red run is not this file's subject (AC-DCS1-5)
    for (const t of [taskRedFirst, taskVanished, taskDifferentFile, taskDotSpelling, taskScript]) {
      mustRun(["approve", t, "--red-waiver", "the red run is not the subject of this test"], dir);
    }
  }, 240_000);

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("STATE: a declared red-first AC with no evidence reads none, and its task is refused by done naming that AC until the oracle has a counted pass", { timeout: 180_000 }, async () => {
    await landWithTypecheckPass(dir, taskRedFirst, "rf-landing-one");
    const verified = runLore(["verify", plan, "--task", taskRedFirst, "--ac", "AC-OK", "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    expect(stateOf("AC-RF")).toBe("none");

    expectRefusedNaming(runLore(["done", taskRedFirst], dir), "AC-RF", "later.test.ts");
  });

  it("NEGATIVE: a declared AC that once passed and whose file is gone is not measured and still refuses done with exit 4", { timeout: 180_000 }, async () => {
    writeFileSync(join(dir, "vanish.test.ts"), PASSING_TEST_BODY);
    commitAll(dir, "write vanish oracle");
    for (const ac of ["AC-OK", "AC-VAN"]) {
      const verified = runLore(["verify", plan, "--task", taskVanished, "--ac", ac, "--yes"], dir);
      expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    }
    rmSync(join(dir, "vanish.test.ts"));
    commitAll(dir, "delete vanish oracle");

    expect(stateOf("AC-VAN")).toBe("not_measured");
    // the task lands on a main without the file: the passes recorded while it existed ran on another tree and no longer count
    await landWithTypecheckPass(dir, taskVanished, "rf-landing-two");
    const verified = runLore(["verify", plan, "--task", taskVanished, "--ac", "AC-OK", "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    expectRefusedNaming(runLore(["done", taskVanished], dir), "AC-VAN", "vanish.test.ts");
  });

  it("REGRESSION (TG-22 narrowing removed; AC-TG-6 text + AC-EI-2): a declared red-first AC with a pass tagged to it that ran a DIFFERENT existing file renders not_measured and lore done exits 4 naming the AC and its path", { timeout: 180_000 }, async () => {
    // A pass tagged AC-DIFF whose command runs other.bun.test.ts (exists), never never-written.test.ts (the AC's oracle).
    writeFileSync(join(dir, "other.bun.test.ts"), PASSING_TEST_BODY);
    commitAll(dir, "write other oracle");
    await landWithTypecheckPass(dir, taskDifferentFile, "rf-landing-three");
    const verified = runLore(["verify", plan, "--task", taskDifferentFile, "--ac", "AC-OK", "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    const recorded = runLore(
      ["evidence", taskDifferentFile, "--oracle", "test", "--command", "bun test other.bun.test.ts", "--result", "pass", "--ac", "AC-DIFF", "--capture"],
      dir,
    );
    expect(recorded.exitCode, recorded.stdout + recorded.stderr).toBe(0);

    // AC-EI-2: a missing oracle is not measured whichever files earlier passes ran (TG-22's "passes that ran the
    // missing file" narrowing is gone; spec-test-governance-guards-that-refuse-bad-tests-declared AC-TG-6 text never had it).
    expect(stateOf("AC-DIFF")).toBe("not_measured");
    // AC-TG-6 text: `lore done` exits 4 naming the AC until its command is repointed: the row ran another command than the AC's own,
    // so it is no pass of the contract oracle ac:AC-DIFF.
    expectRefusedNaming(runLore(["done", taskDifferentFile], dir), "AC-DIFF", "never-written.test.ts");
  });

  it("NEGATIVE (TG-22): a pass recorded as ./dotspelled.bun.test.ts of an AC path dotspelled.bun.test.ts that has since vanished is still not measured and refuses done", { timeout: 180_000 }, async () => {
    writeFileSync(join(dir, "dotspelled.bun.test.ts"), PASSING_TEST_BODY);
    commitAll(dir, "write dotspelled oracle");
    const verified = runLore(["verify", plan, "--task", taskDotSpelling, "--ac", "AC-OK", "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    const recorded = runLore(
      ["evidence", taskDotSpelling, "--oracle", "test", "--command", "bun test ./dotspelled.bun.test.ts", "--result", "pass", "--ac", "AC-DOT", "--capture"],
      dir,
    );
    expect(recorded.exitCode, recorded.stdout + recorded.stderr).toBe(0);
    rmSync(join(dir, "dotspelled.bun.test.ts"));
    commitAll(dir, "delete dotspelled oracle");

    expect(stateOf("AC-DOT")).toBe("not_measured");
    await landWithTypecheckPass(dir, taskDotSpelling, "rf-landing-four");
    const again = runLore(["verify", plan, "--task", taskDotSpelling, "--ac", "AC-OK", "--yes"], dir);
    expect(again.exitCode, again.stdout + again.stderr).toBe(0);
    expectRefusedNaming(runLore(["done", taskDotSpelling], dir), "AC-DOT", "dotspelled.bun.test.ts");
  });
  it("NEGATIVE (AC-EI-2): a script path that once passed and vanished is not measured and lore done exits 4 naming the AC and the script", { timeout: 180_000 }, async () => {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "ran.sh"), "echo ran\n");
    commitAll(dir, "write script oracle");
    for (const ac of ["AC-OK", "AC-SCR"]) {
      const verified = runLore(["verify", plan, "--task", taskScript, "--ac", ac, "--yes"], dir);
      expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    }
    rmSync(join(dir, "scripts", "ran.sh"));
    commitAll(dir, "delete script oracle");

    expect(stateOf("AC-SCR")).toBe("not_measured");
    await landWithTypecheckPass(dir, taskScript, "rf-landing-five");
    const verified = runLore(["verify", plan, "--task", taskScript, "--ac", "AC-OK", "--yes"], dir);
    expect(verified.exitCode, verified.stdout + verified.stderr).toBe(0);
    expectRefusedNaming(runLore(["done", taskScript], dir), "AC-SCR", "scripts/ran.sh");
  });
});
