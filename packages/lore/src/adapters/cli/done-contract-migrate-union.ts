/**
 * Module: done-contract-migrate-union — the integrate machinery `lore migrate done-contract --apply` attests landed tasks with.
 *
 * Purpose: BR-1549 — a task that already landed on main is attested by ONE run of the union of the landed tasks' oracles on main's
 *   newest commit, inside one turn of the repository's merge queue, through integrate's oracle runner (`IntegrateOracleService`),
 *   recorded as integrate rows. This file only assembles the ports the migration service needs; it adds no rule.
 * Public surface: {@link buildLandedAttestPort}.
 * Invariants:
 *   - the turn is the merge queue's own (`app.createIntegrateQueue`), so a migration waits behind a landing and a landing behind a migration;
 *   - the tree is a detached worktree of main's tip in a `mkdtemp` directory, removed afterwards (a leftover directory is pruned);
 *   - `floorCovers` is empty: no floor ran, so no oracle may be recorded as covered by one.
 * Side-effect class: IO (git worktree add and remove, `sh -c` of the install command, the queue's files).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "../../app.js";
import type { FloorRunner } from "../../service/integrate-service.js";
import type { LandedAttestPort, MainTree } from "../../service/done-contract-migration-service.js";
import { resolveCallerSession } from "./caller-session.js";
import type { Invocation as CommandInvocation } from "@lore/core";
import { resolveActor } from "./utils.js";

const MAIN_REF = "refs/heads/main";

/** The inputs of {@link buildLandedAttestPort}. */
export interface LandedAttestInputs {
  readonly inv: CommandInvocation;
  readonly app: App;
  /** The repository root (the directory holding `.lore/`). */
  readonly projectRoot: string;
  /** `workflow.done_contract.install` of the current config. */
  readonly installCommand: string | undefined;
  /** `workflow.integrate.oracle_timeout_seconds` or its default. */
  readonly timeoutSeconds: number;
}

/**
 * @returns the port, or `undefined` when this composition lacks the oracle service or the merge queue (the migration then refuses a landed task loudly)
 */
export function buildLandedAttestPort(input: LandedAttestInputs): LandedAttestPort | undefined {
  const { inv, app, projectRoot } = input;
  const oracles = app.integrateOracleService;
  const createQueue = app.createIntegrateQueue;
  if (oracles === undefined || createQueue === undefined) return undefined;
  const log = (line: string): void => {
    inv.io.stdout.write(`${line}\n`);
  };
  const git = (cwd: string, args: readonly string[]) => spawnSync("git", [...args], { cwd, encoding: "utf8", env: { ...inv.env } });
  const commonDir = git(projectRoot, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (commonDir.status !== 0 || commonDir.stdout.trim() === "") {
    throw new Error(`cannot locate the git common dir of ${projectRoot} for the merge queue: ${(commonDir.stderr ?? "").trim()}`);
  }
  const queue = createQueue({ commonDir: commonDir.stdout.trim(), log });
  const session = resolveCallerSession(undefined, inv.env) ?? `migrate-${String(process.pid)}`;
  const runCommand: FloorRunner = (command, cwd) => {
    const result = spawnSync("sh", ["-c", command], { cwd, encoding: "utf8", env: { ...inv.env }, maxBuffer: 256 * 1024 * 1024 });
    return { status: result.status ?? 1, output: `${result.stdout ?? ""}${result.stderr ?? ""}${result.error !== undefined ? `\n${result.error.message}` : ""}` };
  };
  return {
    inTurn: (fn) => queue.runInTurn({ session, branch: "migrate done-contract" }, fn),
    async withMainTree<T>(fn: (tree: MainTree) => Promise<T>): Promise<T> {
      const tip = git(projectRoot, ["rev-parse", "--verify", `${MAIN_REF}^{commit}`]);
      if (tip.status !== 0) throw new Error(`git cannot resolve ${MAIN_REF}: ${(tip.stderr ?? "").trim()}`);
      const dir = join(mkdtempSync(join(tmpdir(), "lore-migrate-union-")), "main");
      const added = git(projectRoot, ["worktree", "add", "--detach", dir, tip.stdout.trim()]);
      if (added.status !== 0) throw new Error(`git worktree add ${dir} failed: ${(added.stderr ?? "").trim()}`);
      try {
        return await fn({ worktree: dir, commit: tip.stdout.trim() });
      } finally {
        // reason: the worktree holds nothing that is not in refs; an ignored build directory may stop `git worktree remove`, so the
        // directory is deleted and the registration pruned.
        rmSync(join(dir, ".."), { recursive: true, force: true });
        git(projectRoot, ["worktree", "prune"]);
      }
    },
    prove: (request) => oracles.prove(request),
    record: (request) => oracles.record(request),
    settings: {
      installCommand: input.installCommand,
      timeoutSeconds: input.timeoutSeconds,
      floorCovers: new Set<string>(),
      by: resolveActor(inv),
    },
    runCommand,
    log,
    clock: Date.now,
  };
}
