/**
 * Test helper: builds a LANDED code task that `lore done` can archive, for tests whose subject is what happens AT or AFTER `lore done`
 * (worktree cleanup, seat claims, landing readers) and not how the task got there.
 *
 * Purpose: under the done-contract model a task is judged by the contract compiled at approve, so a fixture task must be a `code` task
 * that is approved (its red run waived, the red run is never these tests' subject), claimed on a branch, committed on, landed
 * on main by {@link landWithoutIntegrate} (a merge commit plus the landing record, no integrate run) and then holds one runner-attested
 * pass row per oracle of its stored contract, taken at the shared checkout (a commit whose tree is the landed tree). The kind is explicit
 * and never defaulted: this helper creates a `code` task because only a code task has a branch to land.
 *
 * Public surface: {@link landCodeTask}, {@link LandingWorld}, {@link LandedCodeTaskOptions}, {@link LandedCodeTask}, {@link FIXTURE_DONE_CONTRACT_CONFIG}.
 * Invariants: only for a throwaway repository and corpus (never this repository's `.lore/`); the shared checkout is left detached at main.
 * Side-effect class: IO (git in the fixture repository, `lore` through the injected runner).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { landWithoutIntegrate } from "./done-contract-land";

/**
 * The `workflow.done_contract` keys a fixture seeds so approve can compile a contract: each command prints a runner summary, so a
 * capture of it is a real attested run, and none touches the network.
 */
export const FIXTURE_DONE_CONTRACT_CONFIG = {
  install: "echo install-ok",
  typecheck: "echo typecheck-ok",
  test_file: "echo Ran 1 tests in {file}",
} as const;

/** What the helper needs from the test's own fixture: the shared checkout, git in it and `lore` as a named session. */
export interface LandingWorld {
  /** The shared checkout (the repository root). */
  readonly dir: string;
  /** Runs git in the shared checkout and returns trimmed stdout (throws on a failing exit). */
  git(args: readonly string[]): string;
  /** Runs `lore <args>` in the shared checkout as `session`. */
  lore(args: readonly string[], session: string): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
}

/** Options of {@link landCodeTask}. */
export interface LandedCodeTaskOptions {
  readonly title: string;
  readonly branch: string;
  /** Absolute path of the linked worktree to create for `branch`. */
  readonly worktree: string;
  /** What the claim records as `--worktree`: the worktree path or the branch name. */
  readonly claimValue: "path" | "branch";
  /** The session that creates, approves, claims, and records the evidence (a claim is held by its run, and done refuses another's). */
  readonly session: string;
  /** The spec governing the ad-hoc task (done resolves the task's criteria through it; an ad-hoc task with no spec is refused). */
  readonly spec: string;
}

/** The task the helper built. */
export interface LandedCodeTask {
  readonly slug: string;
  readonly branch: string;
  readonly worktree: string;
}

async function mustLore(world: LandingWorld, args: readonly string[], session: string): Promise<string> {
  const run = await world.lore(args, session);
  if (run.exitCode !== 0) throw new Error(`fixture step \`lore ${args.join(" ")}\` exited ${run.exitCode}: ${run.stderr}${run.stdout}`);
  return run.stdout;
}

interface StoredOracle {
  readonly id: string;
  readonly command?: string;
}

/**
 * Creates an approved code task, claims it on a fresh linked worktree, commits one file there, lands the branch on main and records a
 * runner-attested pass for every oracle of the stored contract at the shared checkout.
 *
 * @param world - the test's fixture (shared checkout, git, `lore` as a session)
 * @param options - the task, branch, worktree and session
 * @returns the task slug, branch and worktree path
 * @throws Error when any fixture step fails (a fixture fault, never silent)
 */
export async function landCodeTask(world: LandingWorld, options: LandedCodeTaskOptions): Promise<LandedCodeTask> {
  const { branch, worktree, session } = options;
  const createArgs = [
    "create", "task", "--adhoc", "--spec", options.spec, "--title", options.title, "--kind", "code",
    "--content", "Throwaway task.", "--no-ai", "--ac-scope", "", "--json",
  ];
  const created = JSON.parse(await mustLore(world, createArgs, session)) as { data: { slug: string } };
  const slug = created.data.slug;
  await mustLore(world, ["approve", slug, "--red-waiver", "the red run is not the subject of this fixture"], session);

  world.git(["worktree", "add", "-q", "-b", branch, worktree, "main"]);
  await mustLore(world, ["claim", slug, "--worktree", options.claimValue === "branch" ? branch : worktree], session);

  const inTree = (args: string[]): void => void execFileSync("git", args, { cwd: worktree, stdio: ["ignore", "pipe", "pipe"] });
  inTree(["config", "user.email", "fixture@example.invalid"]);
  inTree(["config", "user.name", "fixture"]);
  const file = `${branch}.txt`;
  mkdirSync(dirname(join(worktree, file)), { recursive: true });
  writeFileSync(join(worktree, file), `${branch}\n`);
  inTree(["add", "-A"]);
  inTree(["commit", "-q", "-m", `own commit ${branch}`]);

  await landWithoutIntegrate(world, branch);

  const stored = JSON.parse(await mustLore(world, ["get", slug, "--json"], session)) as { data: { doc?: { extra: Record<string, unknown> }; extra?: Record<string, unknown> } };
  const extra = stored.data.doc?.extra ?? stored.data.extra ?? {};
  const oracles = ((extra["done_contract"] as { oracles?: readonly StoredOracle[] } | undefined)?.oracles ?? []) as readonly StoredOracle[];
  if (oracles.length === 0) throw new Error(`task ${slug} holds no contract oracle to attest`);
  for (const oracle of oracles) {
    if (oracle.command === undefined) throw new Error(`oracle ${oracle.id} of ${slug} carries no command`);
    const args = ["evidence", slug, "--oracle", "test", "--command", oracle.command, "--result", "pass", "--capture"];
    if (oracle.id.startsWith("ac:")) args.push("--ac", oracle.id.slice("ac:".length));
    await mustLore(world, args, session);
  }
  return { slug, branch, worktree };
}
