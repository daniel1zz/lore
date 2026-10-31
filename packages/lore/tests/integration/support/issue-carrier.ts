/**
 * Integration-test helper: archives a GitHub-issue CARRIER task through `lore done` under the done-contract model.
 *
 * Purpose: the issue-loop tests (close on archive, push-only sync, resolve) need a carrier task that `lore done` archives so that the
 * archive prints and writes what it does for each named issue. A carrier that changes files is a `code` task judged by its stored
 * contract (AC-DCS1-7), so it is approved, claimed on a branch, landed on main and holds a runner pass for every contract oracle before
 * `lore done`. A corpus task cannot stand in: `lore finish` archives it but does not print the issue-close lines.
 *
 * Public surface: {@link CARRIER_DONE_CONTRACT_CONFIG_LINES}, {@link createCarrierSpec}, {@link landCarrierAndDone}, {@link CarrierWorld}.
 * Invariants: throwaway repository and corpus only (never this repository's `.lore/`); the shared checkout is left detached at main.
 * Side-effect class: IO (git in the fixture repository, `lore` through the injected runner).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landTask } from "./land-task";

/** The `workflow.done_contract` lines of a fixture config written as YAML text (each command prints a runner summary and touches nothing). */
export const CARRIER_DONE_CONTRACT_CONFIG_LINES: readonly string[] = [
  "  done_contract:",
  '    install: "echo install-ok"',
  '    typecheck: "echo typecheck-ok"',
  '    test_file: "echo Ran 1 tests in {file}"',
];

/** What the helper needs from the test's fixture: the repository root and `lore` as a named session. */
export interface CarrierWorld {
  /** The shared checkout (the repository root, on main, clean). */
  readonly dir: string;
  /** Runs `lore <args>` in the shared checkout as `session`. */
  run(args: readonly string[], session: string): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }>;
}

/**
 * Creates the spec an ad-hoc carrier names (`--spec`): approve and `lore done` resolve an ad-hoc task's criteria through it.
 *
 * @param world - the fixture
 * @returns the spec slug
 * @throws Error when the creation fails (a fixture fault)
 */
export async function createCarrierSpec(world: CarrierWorld): Promise<string> {
  const args = ["create", "spec", "--title", "Carrier Fixture Spec", "--kind", "tech", "--no-ai", "--content", "## Overview\n\nBody.", "--json"];
  const created = await world.run(args, "setup");
  if (created.exitCode !== 0) throw new Error(`fixture step \`lore ${args.join(" ")}\` exited ${created.exitCode}: ${created.stderr}${created.stdout}`);
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

let carrierSeq = 0;

/**
 * Takes the draft carrier `slug` through approve, claim, landing and the contract passes, then runs `lore done` on it.
 *
 * @param world - the fixture
 * @param slug - a draft adhoc `code` carrier task
 * @param scratchDirs - the caller's cleanup list; the linked worktree's parent directory is pushed onto it
 * @param session - the session that holds the claim and runs `lore done` (default `worker`)
 * @returns what `lore done` produced
 * @throws Error when a fixture step before `lore done` fails
 */
export async function landCarrierAndDone(
  world: CarrierWorld,
  slug: string,
  scratchDirs: string[],
  session = "worker",
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  carrierSeq += 1;
  const branch = `carrier-b${carrierSeq}`;
  const wtRoot = mkdtempSync(join(tmpdir(), "lore-carrier-wt-"));
  scratchDirs.push(wtRoot);
  await landTask(
    {
      dir: world.dir,
      git: (args) => execFileSync("git", [...args], { cwd: world.dir, encoding: "utf8" }).trim(),
      lore: (args, as) => world.run(args, as),
    },
    { slug, branch, worktree: join(wtRoot, branch), claimValue: "branch", session },
  );
  return await world.run(["done", slug], session);
}
