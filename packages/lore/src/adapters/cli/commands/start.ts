/**
 * lore start <task> [--write-set <path>]... [--json] — the implementer's opening verb (AC-DCS1-13, AC-DCS1-14): run from the shared
 * checkout, it checks the claim lease, creates `<repo>/.claude/worktrees/<task>` on the new branch `task/<task>` cut at the tip of the
 * contract's base branch (the plan's integration branch, else main), runs the contract's install command there, claims the task with
 * that worktree and branch, and prints the stored contract. A failure after the worktree exists removes it and stores nothing.
 *
 * Before anything is created it checks the drift since approve (AC-DCS2-16): a stale falsifier literal or any compile cause exits 4
 * (contract-drift); otherwise the diff of the anchored and falsifier files is printed and a changed recompile is stored.
 *
 * Exit codes: 0 started, 4 refused (not-approved, use-finish, contract-drift, worktree-exists, worktree-path-not-ignored, install-failed, or a claim
 * refusal), 5 the task is held by a fresh claim of another run (checked first).
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-13, AC-DCS1-14).
 */

import { invocationOf } from "../command-invocation.js";
import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { printLine } from "../output.js";
import { refreshScopeFilesOf, scopeCandidatesOf } from "../edit-scope-wiring.js";
import { renderDoneContract } from "../definition-of-done-render.js";

export default defineLoreCommand({
  meta: {
    name: "start",
    description: "Create the task's worktree on the contract base, install, claim and print the contract",
  },
  args: {
    task: { type: "positional", description: "Task document ID or slug", required: true },
    "write-set": {
      type: "string",
      description: "[repeatable] A file (or `dir/`) this claim will touch, as for `lore claim --write-set`",
    },
    json: { type: "boolean", description: "Output result as JSON" },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    const { app } = loadLoreApp({ inv });
    try {
      const verifiedIdentity = await app.verifiedInvocationIdentity?.();
      if (verifiedIdentity !== undefined && !verifiedIdentity.ok) {
        printLine(inv.io.stderr, formatErrorFor(inv, verifiedIdentity.error)); // CLI surface
        exitCli(exitCode(verifiedIdentity.error));
      }
      if (app.taskStartService === undefined) {
        printLine(inv.io.stderr, "Error: lore start is not available in this composition"); // CLI surface
        return 1;
      }
      const by = resolveActor(inv);
      const result = await app.taskStartService.start({
        task: args.task as string,
        cwd: inv.cwd,
        by,
        harnessRun: verifiedIdentity?.value?.harnessRun ?? null,
        // reason: citty yields one string for one occurrence of a repeatable flag, an array for two or more.
        ...(args["write-set"] !== undefined ? { writeSet: (Array.isArray(args["write-set"]) ? args["write-set"] : [args["write-set"]]).map(String) } : {}),
        machine: inv.host,
        source: app.callerSurface,
        nowIso: new Date().toISOString(),
      });
      if (!result.ok) {
        printLine(inv.io.stderr, formatErrorFor(inv, result.error)); // CLI surface
        return exitCode(result.error);
      }
      const outcome = result.value;
      // reason: the edit-time anchor gate reads this working copy's scope file instead of spawning lore per edit (as `lore claim`).
      await refreshScopeFilesOf(app, outcome.slug, await scopeCandidatesOf(app, outcome.slug, inv.cwd, [outcome.worktree]));
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { slug: outcome.slug, worktree: outcome.worktree, branch: outcome.branch, done_contract: outcome.contract, drift: outcome.drift } }, null, 2));
        return 0;
      }
      const { drift } = outcome;
      printLine(inv.io.stdout, `Drift since approve (${drift.fromCommit.slice(0, 12)}..${drift.toCommit.slice(0, 12)}): ${drift.paths.length === 0 ? "no anchored or falsifier files" : drift.diff === "" ? "no changes to anchored and falsifier files" : "anchored and falsifier files changed"}${drift.stored ? "; the recompiled contract was stored and a drift entry logged" : ""}`);
      if (drift.diff !== "") printLine(inv.io.stdout, drift.diff.trimEnd());
      printLine(inv.io.stdout, `Started ${outcome.slug} by ${by} in ${outcome.worktree} on branch ${outcome.branch} (v${outcome.task.version})`);
      for (const line of renderDoneContract(outcome.contract)) printLine(inv.io.stdout, line);
      printLine(inv.io.stdout, `Next: work in ${outcome.worktree}, then \`lore finish ${outcome.slug}\` from it`);
    } finally {
      app.close();
    }
    return 0;
  },
});
