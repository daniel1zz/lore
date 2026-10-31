/**
 * Integration-test helper: takes a task a test already created through the stages the done contract demands, so a test whose
 * subject is what happens AT or AFTER `lore done` (floors, archive walks, readers of the landing) states only that.
 *
 * Purpose: under the done-contract model a code task is judged by the contract compiled at `lore approve`; it is claimed on a
 * branch, its work is committed there, landed on main with a landing record, and only then do runner-attested passes of the contract
 * oracles count. {@link landTask} performs exactly those stages on an existing draft task and stops where the test's own subject
 * begins (it can leave out the passes, or the red run, or the landing itself).
 *
 * Public surface: {@link landTask}, {@link TaskLandingOptions}, {@link LandedTask}, {@link TaskWorld}, {@link recordContractPasses},
 *   {@link FIXTURE_DONE_CONTRACT_CONFIG} (re-exported).
 * Invariants: only for a throwaway repository and corpus (never this repository's `.lore/`); the shared checkout is left detached at
 *   main when the task is landed. The kind is the task's own: only a `code` task has a branch to land.
 * Side-effect class: IO (git in the fixture repository, `lore` through the injected runner).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { landWithoutIntegrate } from "../../helpers/done-contract-land";
import { FIXTURE_DONE_CONTRACT_CONFIG } from "../../helpers/landed-code-task";

export { FIXTURE_DONE_CONTRACT_CONFIG };

/** What one `lore` call produced. */
export interface TaskRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** The test's own fixture: the shared checkout, git in it and `lore` as a named session. */
export interface TaskWorld {
  /** The shared checkout (the repository root). */
  readonly dir: string;
  /** Runs git in the shared checkout and returns trimmed stdout (throws on a failing exit). */
  git(args: readonly string[]): string;
  /** Runs `lore <args>` in the shared checkout as `session` (a label the test's own runner maps to a session). */
  lore(args: readonly string[], session: string): Promise<TaskRun> | TaskRun;
}

/** Options of {@link landTask}. */
export interface TaskLandingOptions {
  /** The draft task to take through the stages. */
  readonly slug: string;
  /** The branch the task is claimed on (created from main). */
  readonly branch: string;
  /** Absolute path of the linked worktree to create for `branch`. */
  readonly worktree: string;
  /** What the claim records as `--worktree`: the worktree path or the branch name. */
  readonly claimValue: "path" | "branch";
  /** The session that approves, claims and records the evidence (a claim is held by its run, and done refuses another's). */
  readonly session: string;
  /**
   * The reason the red run is waived at approve (`lore approve --red-waiver`); `false` approves with the red run required.
   * Default: a fixed fixture reason, because the red run is rarely a landing test's subject.
   */
  readonly redWaiver?: string | false;
  /** `false` skips the approve (the task was approved by the test, so its contract is already stored). Default `true`. */
  readonly approve?: boolean;
  /** `false` leaves the task landed with no runner pass of any contract oracle. Default `true`. */
  readonly recordPasses?: boolean;
  /** `false` stops after the claim: nothing is committed or landed. Default `true`. */
  readonly land?: boolean;
  /** The file the branch commits (relative to the worktree). Default `<branch>.txt`. */
  readonly file?: string;
}

/** The stages' result. */
export interface LandedTask {
  readonly slug: string;
  readonly branch: string;
  readonly worktree: string;
  /** The landing commit (the merge commit now at main's tip), or `undefined` when the task was not landed. */
  readonly landingCommit: string | undefined;
}

interface StoredOracle {
  readonly id: string;
  readonly command?: string;
}

async function mustLore(world: TaskWorld, args: readonly string[], session: string): Promise<string> {
  const run = await world.lore(args, session);
  if (run.exitCode !== 0) throw new Error(`fixture step \`lore ${args.join(" ")}\` exited ${run.exitCode}: ${run.stderr}${run.stdout}`);
  return run.stdout;
}

/**
 * Records one runner-attested pass for every oracle of the task's stored contract, from the shared checkout.
 *
 * @param world - the test's fixture
 * @param slug - a task holding a stored contract
 * @param session - the session recording the rows
 * @throws Error when the task holds no contract or an oracle carries no command (a fixture fault)
 */
export async function recordContractPasses(world: TaskWorld, slug: string, session: string): Promise<void> {
  const stored = JSON.parse(await mustLore(world, ["get", slug, "--json"], session)) as {
    data: { doc?: { extra: Record<string, unknown> }; extra?: Record<string, unknown> };
  };
  const extra = stored.data.doc?.extra ?? stored.data.extra ?? {};
  const oracles = ((extra["done_contract"] as { oracles?: readonly StoredOracle[] } | undefined)?.oracles ?? []) as readonly StoredOracle[];
  if (oracles.length === 0) throw new Error(`task ${slug} holds no contract oracle to attest`);
  for (const oracle of oracles) {
    if (oracle.command === undefined) throw new Error(`oracle ${oracle.id} of ${slug} carries no command`);
    const args = ["evidence", slug, "--oracle", "test", "--command", oracle.command, "--result", "pass", "--capture"];
    if (oracle.id.startsWith("ac:")) args.push("--ac", oracle.id.slice("ac:".length));
    await mustLore(world, args, session);
  }
}

/**
 * Approves a draft code task, claims it on a fresh linked worktree, commits one file there, lands the branch on main and records a
 * runner-attested pass for every oracle of the stored contract (each stage can be left out through the options).
 *
 * @param world - the test's fixture (shared checkout, git, `lore` as a session)
 * @param options - the task, branch, worktree, session and which stages to run
 * @returns the task, branch, worktree and the landing commit
 * @throws Error when any fixture step fails (a fixture fault, never silent)
 */
export async function landTask(world: TaskWorld, options: TaskLandingOptions): Promise<LandedTask> {
  const { slug, branch, worktree, session } = options;
  const waiver = options.redWaiver ?? "the red run is not the subject of this fixture";
  if (options.approve !== false) {
    await mustLore(world, waiver === false ? ["approve", slug] : ["approve", slug, "--red-waiver", waiver], session);
  }

  world.git(["worktree", "add", "-q", "-b", branch, worktree, "main"]);
  await mustLore(world, ["claim", slug, "--worktree", options.claimValue === "branch" ? branch : worktree], session);
  if (options.land === false) return { slug, branch, worktree, landingCommit: undefined };

  const inTree = (args: string[]): void => void execFileSync("git", args, { cwd: worktree, stdio: ["ignore", "pipe", "pipe"] });
  inTree(["config", "user.email", "fixture@example.invalid"]);
  inTree(["config", "user.name", "fixture"]);
  const file = options.file ?? `${branch}.txt`;
  mkdirSync(dirname(join(worktree, file)), { recursive: true });
  writeFileSync(join(worktree, file), `${branch}\n`);
  inTree(["add", "-A"]);
  inTree(["commit", "-q", "-m", `own commit ${branch}`]);

  const landingCommit = await landWithoutIntegrate(world, branch);
  if (options.recordPasses !== false) await recordContractPasses(world, slug, session);
  return { slug, branch, worktree, landingCommit };
}
