/**
 * `lore stash prune [--apply] [--json]` — AC-AU-4: stashes become recoverable, then LORE drops them.
 *
 * Without --apply: lists every stash with its facts (created-on branch, attributed run and whether it is live /
 * ended / has no provable owner, whether its tracked and untracked content is contained in main by blob equality).
 * Nothing is written. With --apply: per stash, archive it under refs/lore/archive/stash/<sha> (verified readable),
 * ask decide("stash-drop") and drop exactly that stash only on an auto verdict; prints the archive ref of every
 * stash and the counts dropped / kept / escalated. See service/stash-prune-service.ts for the attribution rules.
 *
 * Exit codes: 0 = the command ran (kept and escalated stashes are outcomes, not failures); 1 = an archive write,
 * archive verification or drop failed (apply stops there, nothing further is dropped), or a git/store failure.
 * The git-safety hook still refuses an agent-typed `git stash drop`: the drop happens in this process, which is why
 * the decision and the archive come first.
 *
 * Side-effect class: IO (git subprocesses in the repo root, corpus DB reads and decision_log appends).
 */
import { spawnSync } from "node:child_process";

import { defineLoreCommand } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { createAuditReversalProbe, createGitReversalProbes } from "../../../service/autonomy-calibration-service.js";
import { DecisionService } from "../../../service/decision-service.js";
import {
  StashPruneService,
  type GitRunner,
  type StashFacts,
  type StashPruneEntry,
  type StashPruneReport,
} from "../../../service/stash-prune-service.js";
import { invocationOf } from "../command-invocation.js";

function yesNo(value: boolean, measured: boolean): string {
  return measured ? (value ? "yes" : "no") : "not measured";
}

function renderFacts(facts: StashFacts): string[] {
  const { attribution, containment } = facts;
  return [
    `stash@{${facts.index}} ${facts.sha}`,
    `  message: ${facts.message}`,
    `  created on branch: ${attribution.branch ?? "(none)"}`,
    `  attribution: ${attribution.state} - ${attribution.reason}`,
    `  tracked in main: ${yesNo(containment.tracked_in_main, containment.measured)}; untracked in main: ${yesNo(containment.untracked_in_main, containment.measured)}`,
  ];
}

function renderOutcome(entry: StashPruneEntry): string[] {
  const outcome = entry.outcome;
  if (outcome === undefined) return [];
  switch (outcome.kind) {
    case "dropped":
      return [`  dropped (score ${outcome.score.toFixed(2)}); archive: ${outcome.archive_ref}`];
    case "escalated":
      return [`  escalated, kept (score ${outcome.score.toFixed(2)}): ${outcome.reasons.join("; ")}; archive: ${outcome.archive_ref}`];
    case "kept":
      return [`  kept: ${outcome.reasons.join("; ")}; archive: ${outcome.archive_ref}`];
  }
}

function renderReport(report: StashPruneReport): string {
  const lines = report.entries.flatMap((entry) => [...renderFacts(entry.facts), ...renderOutcome(entry)]);
  const { dropped, kept, escalated } = report.counts;
  lines.push(report.applied ? `dropped ${dropped}, kept ${kept}, escalated ${escalated}` : `${report.entries.length} stash(es); dry run (use --apply to archive and prune)`);
  return lines.join("\n");
}

/** Git runner bound to the repo root; never throws (a spawn failure is status 1 with the message on stderr). */
function gitRunnerFor(repoRoot: string): GitRunner {
  return (args, stdin) => {
    const result = spawnSync("git", [...args], { cwd: repoRoot, encoding: "utf8", ...(stdin !== undefined ? { input: stdin } : {}) });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? result.error?.message ?? "" };
  };
}

const prune = defineLoreCommand({
  meta: {
    name: "prune",
    description: "List stashes with facts; --apply archives each under refs/lore/archive/stash/ then drops it when decide(stash-drop) is auto (AC-AU-4)",
  },
  args: {
    apply: { type: "boolean", description: "Archive and drop stashes whose decision is auto (default: list only)" },
    json: { type: "boolean", description: "Output the report as JSON" },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const { app, dbPath } = loadLoreApp({ inv });
    let store: SQLiteStore | undefined;
    try {
      if (app.repoRoot === undefined) {
        inv.io.stderr.write("Error: repoRoot not set on this App instance.\n");
        return 1;
      }
      // reason: the decision record must carry the run the store wrapper stamps onto rows (BR-1035,
      // run-identity-verify.ts): verify once through the app's wrapped store; an unregistered id is null.
      const verifiedIdentity = await app.verifiedInvocationIdentity?.();
      if (verifiedIdentity !== undefined && !verifiedIdentity.ok) {
        inv.io.stderr.write(`${formatErrorFor(inv, verifiedIdentity.error)}\n`);
        return exitCode(verifiedIdentity.error);
      }
      store = new SQLiteStore(dbPath);
      const git = gitRunnerFor(app.repoRoot);
      // reason: AC-AU-8 — before scoring, decide() sweeps new outcomes of earlier stash drops (a stash restored from its archive ref is a reversal).
      const decisions = new DecisionService({
        store,
        executorRun: verifiedIdentity?.value?.harnessRun ?? null,
        reversalProbes: [createAuditReversalProbe(store), ...createGitReversalProbes(git)],
      });
      const service = new StashPruneService({ git, store, decisions });
      const result = args.apply === true ? await service.apply() : await dryRun(service);
      if (!result.ok) {
        inv.io.stderr.write(`${formatErrorFor(inv, result.error)}\n`);
        return exitCode(result.error);
      }
      inv.io.stdout.write(`${args.json === true ? JSON.stringify({ ok: true, data: result.value }, null, 2) : renderReport(result.value)}\n`);
    } finally {
      store?.close();
      app.close();
    }
  },
});

async function dryRun(service: StashPruneService) {
  const listed = await service.list();
  if (!listed.ok) return listed;
  const report: StashPruneReport = {
    entries: listed.value.map((facts) => ({ facts })),
    applied: false,
    counts: { dropped: 0, kept: 0, escalated: 0 },
  };
  return { ok: true as const, value: report };
}

export default defineLoreCommand({
  meta: { name: "stash", description: "Stash hygiene: `stash prune [--apply]` (AC-AU-4)" },
  subCommands: { prune },
});
