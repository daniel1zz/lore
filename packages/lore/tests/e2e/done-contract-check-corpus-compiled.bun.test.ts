// @reads assets/project/lore-config-template.yaml
// @reads assets/project/reference-transaction
/**
 * done-contract-check-corpus-compiled.bun.test.ts — a check or corpus task is finished in the shared checkout, with no claim, no
 * worktree and no subagent, and is archived on contract rows (spec-done-contract-compiled-at-approve-task-kinds-write-sets),
 * observed through the `lore` command tree (`runLoreInProcess`) on a throwaway repository and corpus.
 *
 * Holds the criteria of the tasks before and including the one that owns the newest block, so it passes whole at every task's
 * tip. Each test name starts with `AC-DCS1-<n>:` (with the colon), so `-t 'AC-DCS1-1:'` never matches AC-DCS1-10.
 *
 *   Task "check and corpus kinds finish in the shared checkout and are archived on contract rows":
 *     AC-DCS1-19  finish at main's head records runner rows, archives on the second evidence rule, makes no worktree and no claim
 *     AC-DCS1-20  two finishes started together: one wins, the other exits 5 and records nothing
 *     AC-DCS1-21  the shared checkout is measured first (not-shared-checkout, head-not-main-tip, shared-checkout-dirty), and a run
 *                 that changes a file is refused kind-wrote-files
 *
 * Fixture: `mkdtemp` + `git init` + `lore init`, HOME outside every repository; the repository's own `.lore/` is never touched.
 * The fixture directory IS the shared checkout (its git dir is its common dir) and is detached at main's tip while a test runs.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { liveAmbient, liveWriteContext } from "../live-invocation";
import { makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { FIXTURE_HOME_OUTSIDE_REPO } from "../helpers/clean-tree-repo";
import { citeSpecViaAsyncCli } from "../helpers/cli-live-rule";
import { patchLoreConfig } from "../helpers/patch-lore-config";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

const PASS_CONFIG = { install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" };

let fixture: DoneContractFixture;
let scratch = "";
let waitDir = "";
let markFile = "";
let sequence = 0;

const sessionEnv = (session: string): Record<string, string> => ({ CLAUDE_CODE_SESSION_ID: session });

beforeAll(async () => {
  fixture = await makeDoneContractFixture();
  fixture.setDoneContractConfig(PASS_CONFIG);
  patchLoreConfig(fixture.dir, { workflow: { gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } } } });
  scratch = mkdtempSync(join(tmpdir(), "dcs1-cc-"));
  waitDir = join(scratch, "wait");
  mkdirSync(waitDir, { recursive: true });
  markFile = join(scratch, "oracle-ran");
  const add = (id: string, command: string): Promise<string> =>
    fixture.mustRun(["ac", "add", fixture.spec, id, "--statement", `Fixture criterion ${id}.`, "--mode", "script", "--oracle", "test", "--command", command]);
  // reason: the criteria are declared while the spec is still a draft, so no decision is needed to add them.
  await add("AC-FX-2", "echo fx2");
  await add("AC-FX-FAIL", "sh -c 'exit 1'");
  await add("AC-FX-MARK", `sh -c 'touch ${markFile}'`);
  await add("AC-FX-TOUCH", "sh -c 'echo changed-by-oracle >> README.md'");
  await add("AC-FX-NEWFILE", "sh -c 'touch oracle-wrote.txt'");
  await add("AC-FX-WAIT", `sh -c 'touch ${waitDir}/w-$$; until [ $(ls ${waitDir} | wc -l) -ge 2 ]; do sleep 0.1; done'`);
  await citeSpecViaAsyncCli((args) => fixture.mustRun(args), fixture.dir, undefined, fixture.spec, "AC-FX-1");
  await fixture.mustRun(["approve", fixture.spec]);
  fixture.git(["checkout", "-q", "--detach", "main"]);
  const status = fixture.git(["status", "--porcelain"]);
  if (status !== "") throw new Error(`the fixture checkout is not clean after setup: ${status}`);
});

afterAll(() => {
  fixture.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

interface Out {
  readonly exitCode: number;
  readonly text: string;
}

async function loreIn(cwd: string, args: readonly string[], session: string): Promise<Out> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  const result = await runLoreInProcess([...args], { cwd, home: FIXTURE_HOME_OUTSIDE_REPO, env: { ...env, ...sessionEnv(session), HOME: FIXTURE_HOME_OUTSIDE_REPO } });
  return { exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
}

interface Row {
  readonly oracle: string;
  readonly command: string;
  readonly result: string;
  readonly ac_ref?: string;
  readonly capture_source?: string;
  readonly attestation?: { runner: string; head_sha?: string; exit_code: number };
}

const rowsOf = async (slug: string): Promise<Row[]> => ((await fixture.readTask(slug)).extra["verification_evidence"] ?? []) as Row[];
const tip = (): string => fixture.git(["rev-parse", "main"]);
const worktrees = (): string => fixture.git(["worktree", "list", "--porcelain"]);
const finish = (slug: string, session = "dcs1-cc", cwd = fixture.dir): Promise<Out> => loreIn(cwd, ["finish", slug], session);

/** Creates and approves a task of `kind` with the given criteria scope; returns its slug. */
async function approvedKind(kind: "check" | "corpus", scope: readonly string[], title: string): Promise<string> {
  const plan = await fixture.createPlan(`${title} plan`);
  const slug = await fixture.createTask({ plan, kind, title, acScope: scope });
  await fixture.mustRun(["approve", slug]);
  return slug;
}

/** Commits one new file on main (the fixture stays detached at main's tip afterwards); returns the new commit. */
function commitOnMain(): string {
  sequence += 1;
  fixture.git(["checkout", "-q", "main"]);
  writeFileSync(join(fixture.dir, `bump-${sequence}.txt`), `${sequence}\n`);
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-q", "-m", `bump ${sequence}`]);
  fixture.git(["checkout", "-q", "--detach", "main"]);
  return tip();
}

function restoreTree(): void {
  fixture.git(["checkout", "-q", "--", "README.md"]);
  rmSync(join(fixture.dir, "oracle-wrote.txt"), { force: true });
  rmSync(join(fixture.dir, "stray.txt"), { force: true });
}

describe("AC-DCS1-19: a check or corpus task finishes at main's head with no claim and is archived on contract rows", () => {
  it("AC-DCS1-19: a check task runs its oracles at main's head, records runner rows stamped with it in one write, archives, and makes no worktree and no claim", async () => {
    const slug = await approvedKind("check", ["AC-FX-1", "AC-FX-2"], "Check happy");
    const contract = (await fixture.readTask(slug)).extra["done_contract"] as { landing_route: string; kind: string };
    expect(contract.kind).toBe("check");
    expect(contract.landing_route).toBe("none");
    const head = tip();
    const listBefore = worktrees();

    const out = await finish(slug);
    expect(out.exitCode, out.text).toBe(0);

    const task = await fixture.readTask(slug);
    expect(task.status).toBe("archived");
    expect(task.extra["claim"]).toBeUndefined();
    expect(worktrees()).toBe(listBefore);
    const rows = await rowsOf(slug);
    expect(rows.map((row) => row.command).sort()).toEqual(["echo fx1", "echo fx2"]);
    for (const row of rows) {
      expect(row.result).toBe("pass");
      expect(row.capture_source).toBe("runner");
      expect(row.attestation?.runner).toBe("lore-cli");
      expect(row.attestation?.head_sha).toBe(head);
      expect(row.ac_ref).toBeDefined();
    }
  });

  it("AC-DCS1-19: a corpus task with no script-mode AC is archived on its single corpus:files-unchanged row, stamped with main's head", async () => {
    const slug = await approvedKind("corpus", [], "Corpus single");
    const contract = (await fixture.readTask(slug)).extra["done_contract"] as { oracles: { id: string }[] };
    expect(contract.oracles.map((oracle) => oracle.id)).toEqual(["corpus:files-unchanged"]);
    const head = tip();
    const listBefore = worktrees();

    const out = await finish(slug);
    expect(out.exitCode, out.text).toBe(0);
    const task = await fixture.readTask(slug);
    expect(task.status).toBe("archived");
    expect(worktrees()).toBe(listBefore);
    const rows = await rowsOf(slug);
    expect(rows.length).toBe(1);
    expect(rows[0]?.command).toBe("corpus:files-unchanged");
    expect(rows[0]?.result).toBe("pass");
    expect(rows[0]?.capture_source).toBe("runner");
    expect(rows[0]?.attestation?.head_sha).toBe(head);
  });

  it("AC-DCS1-19: a corpus task with a script-mode AC records the AC row and the corpus row", async () => {
    const slug = await approvedKind("corpus", ["AC-FX-1"], "Corpus both");
    const out = await finish(slug);
    expect(out.exitCode, out.text).toBe(0);
    expect((await rowsOf(slug)).map((row) => row.command).sort()).toEqual(["corpus:files-unchanged", "echo fx1"]);
    expect((await fixture.readTask(slug)).status).toBe("archived");
  });

  it("AC-DCS1-19: done refuses [floor: attested-pass] a row recorded at a commit that does not contain the compile commit, and [floor: contract-oracles] a row for only some of the oracles; finish then archives", async () => {
    const older = tip();
    commitOnMain();
    const slug = await approvedKind("check", ["AC-FX-1"], "Check older row");
    const compiled = ((await fixture.readTask(slug)).extra["done_contract"] as { compiled_at_commit: string }).compiled_at_commit;
    expect(compiled).toBe(tip());
    expect(compiled).not.toBe(older);

    // a pass row taken before the approval: the head does not contain the compile commit
    fixture.git(["checkout", "-q", "--detach", older]);
    const stale = await loreIn(fixture.dir, ["evidence", slug, "--oracle", "test", "--command", "echo fx1", "--result", "pass", "--capture", "--ac", "AC-FX-1"], "dcs1-cc-stale");
    fixture.git(["checkout", "-q", "--detach", "main"]);
    expect(stale.exitCode, stale.text).toBe(0);
    expect((await rowsOf(slug))[0]?.attestation?.head_sha).toBe(older);
    const refusedStale = await loreIn(fixture.dir, ["done", slug], "dcs1-cc-stale");
    expect(refusedStale.exitCode, refusedStale.text).toBe(4);
    expect(refusedStale.text).toContain("[floor: attested-pass]");
    expect((await fixture.readTask(slug)).status).not.toBe("archived");

    // a row for only some of the oracles: AC-FX-1 passes at main's head, AC-FX-2 has none
    const partial = await approvedKind("check", ["AC-FX-1", "AC-FX-2"], "Check partial row");
    const captured = await loreIn(fixture.dir, ["evidence", partial, "--oracle", "test", "--command", "echo fx1", "--result", "pass", "--capture", "--ac", "AC-FX-1"], "dcs1-cc-partial");
    expect(captured.exitCode, captured.text).toBe(0);
    const refusedPartial = await loreIn(fixture.dir, ["done", partial], "dcs1-cc-partial");
    expect(refusedPartial.exitCode, refusedPartial.text).toBe(4);
    expect(refusedPartial.text).toContain("[floor: contract-oracles]");
    expect((await fixture.readTask(partial)).status).not.toBe("archived");

    // finish records the missing rows at main's head and archives both
    for (const name of [slug, partial]) {
      const out = await finish(name);
      expect(out.exitCode, out.text).toBe(0);
      expect((await fixture.readTask(name)).status).toBe("archived");
    }
  });

  it("AC-DCS1-19: a failing oracle makes finish exit 4 naming it and archives nothing; no worktree appears", async () => {
    const slug = await approvedKind("check", ["AC-FX-1", "AC-FX-FAIL"], "Check failing");
    const listBefore = worktrees();
    const out = await finish(slug);
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("ac:AC-FX-FAIL");
    expect((await fixture.readTask(slug)).status).not.toBe("archived");
    expect(worktrees()).toBe(listBefore);
  });

  it("AC-DCS1-19: a legacy no-branch claim on a check task is ignored by finish and released by the archive", async () => {
    const slug = await approvedKind("check", ["AC-FX-1"], "Check legacy claim");
    const app = createApp(join(fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
    try {
      const found = await app.corpusService.get(slug);
      if (!found.ok) throw new Error(`seed: ${JSON.stringify(found.error)}`);
      const doc = found.value.doc;
      const claimed = await app.corpusService.writeDoc({
        doc,
        patch: { extra: { ...doc.extra, claim: { by: "agent:session-legacy00", at: new Date().toISOString() } } },
        action: "update",
        changeSummary: "fixture: a legacy no-branch claim",
        auditAction: "update",
        auditDetails: { operation: "fixture-legacy-claim" },
        lock: "none",
        by: "agent:session-legacy00",
        now: new Date().toISOString(),
      });
      if (!claimed.ok) throw new Error(`seed: ${JSON.stringify(claimed.error)}`);
    } finally {
      app.close();
    }
    expect((await fixture.readTask(slug)).extra["claim"]).toBeDefined();
    const out = await finish(slug);
    expect(out.exitCode, out.text).toBe(0);
    const task = await fixture.readTask(slug);
    expect(task.status).toBe("archived");
    expect(task.extra["claim"]).toBeUndefined();
  });
});

describe("AC-DCS1-20: two finishes of one check task started together lose cleanly", () => {
  it("AC-DCS1-20: exactly one finish exits 0 and records its rows; the other exits 5 and records nothing", async () => {
    const slug = await approvedKind("check", ["AC-FX-WAIT"], "Check concurrent");
    const [first, second] = await Promise.all([finish(slug, "dcs1-cc-race-a"), finish(slug, "dcs1-cc-race-b")]);
    expect([first.exitCode, second.exitCode].sort(), `${first.text}\n---\n${second.text}`).toEqual([0, 5]);
    const loser = first.exitCode === 5 ? first : second;
    expect(loser.text).toMatch(/stale|version/i);
    // both oracles ran (the marker files of both exist), yet one set of rows is recorded
    expect(execFileSync("ls", [waitDir], { encoding: "utf8" }).trim().split("\n").length).toBe(2);
    const rows = await rowsOf(slug);
    expect(rows.length).toBe(1);
    expect(rows[0]?.ac_ref).toBe("AC-FX-WAIT");
    expect((await fixture.readTask(slug)).status).toBe("archived");
  });
});

describe("AC-DCS1-21: finish measures the shared checkout before it runs anything and a run changes no file", () => {
  it("AC-DCS1-21: from a linked worktree it exits 4 not-shared-checkout, records nothing and runs no oracle", async () => {
    const slug = await approvedKind("check", ["AC-FX-MARK"], "Check linked");
    const linked = join(scratch, "linked-wt");
    fixture.git(["worktree", "add", "-q", "--detach", linked, "main"]);
    rmSync(markFile, { force: true });
    const out = await finish(slug, "dcs1-cc", linked);
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("not-shared-checkout");
    expect(existsSync(markFile)).toBe(false);
    expect(await rowsOf(slug)).toEqual([]);
    fixture.git(["worktree", "remove", "--force", linked]);
  });

  it("AC-DCS1-21: HEAD not equal to the tip of main exits 4 head-not-main-tip naming both commits and git checkout --detach main; the detached tip is the passing control", async () => {
    commitOnMain();
    const slug = await approvedKind("check", ["AC-FX-MARK"], "Check moved main");
    const mainTip = tip();
    const behind = fixture.git(["rev-parse", "main~1"]);
    fixture.git(["checkout", "-q", "--detach", behind]);
    rmSync(markFile, { force: true });
    const out = await finish(slug);
    fixture.git(["checkout", "-q", "--detach", "main"]);
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("head-not-main-tip");
    expect(out.text).toContain(behind);
    expect(out.text).toContain(mainTip);
    expect(out.text).toContain("git checkout --detach main");
    expect(existsSync(markFile)).toBe(false);
    expect(await rowsOf(slug)).toEqual([]);

    const control = await finish(slug);
    expect(control.exitCode, control.text).toBe(0);
    expect(existsSync(markFile)).toBe(true);
  });

  it("AC-DCS1-21: uncommitted and untracked files exit 4 shared-checkout-dirty naming the paths, records nothing and runs no oracle", async () => {
    const slug = await approvedKind("check", ["AC-FX-MARK"], "Check dirty");
    writeFileSync(join(fixture.dir, "README.md"), "edited\n");
    writeFileSync(join(fixture.dir, "stray.txt"), "left behind\n");
    rmSync(markFile, { force: true });
    const out = await finish(slug);
    restoreTree();
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("shared-checkout-dirty");
    expect(out.text).toContain("README.md");
    expect(out.text).toContain("stray.txt");
    expect(existsSync(markFile)).toBe(false);
    expect(await rowsOf(slug)).toEqual([]);
  });

  it("AC-DCS1-21: an oracle that rewrites a tracked file is refused kind-wrote-files naming that path; nothing is recorded or archived", async () => {
    const slug = await approvedKind("check", ["AC-FX-1", "AC-FX-TOUCH"], "Check wrote tracked");
    const out = await finish(slug);
    const dirtyAfter = fixture.git(["status", "--porcelain"]);
    restoreTree();
    expect(dirtyAfter).toContain("README.md");
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("kind-wrote-files");
    expect(out.text).toContain("README.md");
    expect(out.text).not.toContain("oracle-wrote.txt");
    expect(await rowsOf(slug)).toEqual([]);
    expect((await fixture.readTask(slug)).status).not.toBe("archived");
  });

  it("AC-DCS1-21: a corpus task whose oracle creates an untracked file is refused kind-wrote-files naming only that file and records no corpus:files-unchanged row", async () => {
    const slug = await approvedKind("corpus", ["AC-FX-NEWFILE"], "Corpus wrote new file");
    const out = await finish(slug);
    restoreTree();
    expect(out.exitCode, out.text).toBe(4);
    expect(out.text).toContain("kind-wrote-files");
    expect(out.text).toContain("oracle-wrote.txt");
    expect(out.text).not.toContain("README.md");
    expect(await rowsOf(slug)).toEqual([]);
    expect((await fixture.readTask(slug)).status).not.toBe("archived");
  });

  it("AC-DCS1-21: lore claim of a check or corpus task exits 4 kind-has-no-claim and lore start exits 4 use-finish", async () => {
    const slug = await approvedKind("check", ["AC-FX-1"], "Check never claimed");
    const claim = await loreIn(fixture.dir, ["claim", slug], "dcs1-cc-claim");
    expect(claim.exitCode, claim.text).toBe(4);
    expect(claim.text).toContain("kind-has-no-claim");
    const start = await loreIn(fixture.dir, ["start", slug], "dcs1-cc-claim");
    expect(start.exitCode, start.text).toBe(4);
    expect(start.text).toContain("use-finish");
    expect((await fixture.readTask(slug)).extra["claim"]).toBeUndefined();
  });
});
