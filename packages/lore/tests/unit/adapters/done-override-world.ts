/**
 * Test fixture: a throwaway repository and corpus holding LANDED `code` tasks that have no evidence yet, for the CLI oracles of
 * `lore done --override-attestation` and `--override-attestation-cite`.
 *
 * Purpose: `lore done` judges a task only by the contract compiled at approve (spec-done-contract-compiled-at-approve-task-kinds-write-sets,
 * AC-DCS1-7), so a CLI test of the attestation escapes needs a task that has a contract and has landed, and whose evidence is
 * the test's own. {@link OverrideWorld.landTask} builds exactly that: create (kind code) -> approve (red waived) -> claim on a
 * branch in a linked worktree -> commit -> land on main (a merge commit plus the landing record, no `lore integrate`, so no
 * integrate rows exist). {@link OverrideWorld.attestAllOracles} then records one runner-attested pass per oracle of the stored
 * contract at the shared checkout, the evidence of a task that really passed.
 *
 * Public surface: {@link makeOverrideWorld}, {@link OverrideWorld}, {@link RunOutput}.
 * Invariants: the corpus and repository are `mkdtemp` directories and HOME is outside every repository; this repository's own
 *   `.lore/` is never touched.
 * Side-effect class: IO (git, `lore` in-process, temp directories).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeDoneContractFixture, type DoneContractFixture } from "../../helpers/done-contract-fixture";
import { landWithoutIntegrate } from "../../helpers/done-contract-land";
import { patchLoreConfig } from "../../helpers/patch-lore-config";

/** What one `lore` call produced. */
export interface RunOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** The throwaway project; see the module header. */
export interface OverrideWorld {
  /** The shared checkout (repository root). */
  readonly dir: string;
  /** Runs `lore <args>` in the shared checkout. */
  run(args: readonly string[]): Promise<RunOutput>;
  /** Like {@link run} but throws unless the exit code is 0. */
  mustRun(args: readonly string[]): Promise<RunOutput>;
  /** Creates, approves (red waived), claims, commits and lands one `code` task; returns its slug. It holds no evidence. */
  landTask(title: string): Promise<string>;
  /** Records a runner-attested pass of every oracle of the task's stored contract, at the shared checkout. */
  attestAllOracles(slug: string): Promise<void>;
  /** Reads a task back (`lore get --json`). */
  readTask(slug: string): Promise<{ readonly status: string; readonly version: number; readonly extra: Record<string, unknown> }>;
  /** Every audit row of `slug` (`lore audit --json`). */
  auditRows(slug: string): Promise<ReadonlyArray<{ readonly action: string; readonly details?: Record<string, unknown> }>>;
  /** Removes the repository and the worktrees. */
  dispose(): void;
}

/** Commands the fixture contract runs; each prints a runner summary, so a capture of one is a real attested run. */
const FIXTURE_CONFIG = { install: "echo install-ok", typecheck: "echo typecheck-ok", test_file: "echo Ran 1 tests in {file}" } as const;

interface StoredOracle {
  readonly id: string;
  readonly command?: string;
}

/**
 * Builds the world: a clean git repository, `lore init`, a spec and the three `workflow.done_contract` commands.
 *
 * @returns the world; call `dispose()` in `afterAll`
 */
export async function makeOverrideWorld(): Promise<OverrideWorld> {
  const fixture: DoneContractFixture = await makeDoneContractFixture({ seedDoneContractConfig: false });
  fixture.setDoneContractConfig(FIXTURE_CONFIG);
  // reason: the claim gate wants an approved spec and the integrate floor runs a project command; neither is this fixture's subject.
  patchLoreConfig(fixture.dir, {
    workflow: { gates: { "task-claim": { enabled: false }, "plan-close": { enabled: false }, "plan-promote": { enabled: false } } },
  });
  execFileSync("sh", ["-c", "printf '.claude/\\n' >> .git/info/exclude"], { cwd: fixture.dir });
  fixture.git(["checkout", "-q", "--detach", "main"]);
  const worktreeRoot = mkdtempSync(join(tmpdir(), "override-wt-"));
  const plan = await fixture.createPlan("Override plan");
  let sequence = 0;

  const run = async (args: readonly string[]): Promise<RunOutput> => fixture.run(args);
  const mustRun = async (args: readonly string[]): Promise<RunOutput> => {
    const out = await run(args);
    if (out.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${out.exitCode}: ${out.stderr}${out.stdout}`);
    return out;
  };

  return {
    dir: fixture.dir,
    run,
    mustRun,
    async landTask(title) {
      sequence += 1;
      const file = `tests/o-${sequence}.test.ts`;
      const slug = await fixture.createTask({ plan, kind: "code", title: `${title} ${sequence}`, anchors: [file], acScope: [] });
      await mustRun(["approve", slug, "--red-waiver", "the red run is not the subject of this fixture"]);
      const branch = `override-branch-${sequence}`;
      const worktree = join(worktreeRoot, `wt-${sequence}`);
      fixture.git(["worktree", "add", "-q", "-b", branch, worktree, "main"]);
      await mustRun(["claim", slug, "--worktree", branch]);
      const inTree = (args: string[]): void => void execFileSync("git", args, { cwd: worktree, stdio: ["ignore", "pipe", "pipe"] });
      inTree(["config", "user.email", "fixture@example.invalid"]);
      inTree(["config", "user.name", "fixture"]);
      mkdirSync(dirname(join(worktree, file)), { recursive: true });
      writeFileSync(join(worktree, file), "// test\n");
      inTree(["add", "-A"]);
      inTree(["commit", "-q", "-m", `work ${sequence}`]);
      await landWithoutIntegrate(fixture, branch);
      return slug;
    },
    async attestAllOracles(slug) {
      const stored = await fixture.readTask(slug);
      const oracles = ((stored.extra["done_contract"] as { oracles?: readonly StoredOracle[] } | undefined)?.oracles ?? []) as readonly StoredOracle[];
      if (oracles.length === 0) throw new Error(`task ${slug} holds no contract oracle to attest`);
      for (const oracle of oracles) {
        if (oracle.command === undefined) throw new Error(`oracle ${oracle.id} of ${slug} carries no command`);
        await mustRun(["evidence", slug, "--oracle", "test", "--command", oracle.command, "--result", "pass", "--capture"]);
      }
    },
    async readTask(slug) {
      const task = await fixture.readTask(slug);
      return { status: task.status, version: task.version, extra: task.extra };
    },
    async auditRows(slug) {
      const out = await mustRun(["audit", slug, "--json"]);
      return (JSON.parse(out.stdout) as { data: { entries: Array<{ action: string; details?: Record<string, unknown> }> } }).data.entries;
    },
    dispose() {
      fixture.dispose();
      rmSync(worktreeRoot, { recursive: true, force: true });
    },
  };
}
