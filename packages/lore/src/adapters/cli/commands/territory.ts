/**
 * lore territory [--json] — AC-OWN-1 read surface (spec-multi-session-
 * concurrency-queryable-ownership-checkout §Scope L0): partitions every
 * worktree and branch CORPUS-WIDE (never plan-scoped) into `mine` / `foreign`
 * / `unowned` / `unmeasured`, naming each `foreign` entry's holder
 * `session_id` and worktree — copying git's own refusal shape (`fatal: 'x'
 * is already used by worktree at <path>`).
 *
 * Data sources:
 *   - `RealGitPort(app.repoRoot).worktreeList()` — every git worktree + its
 *     current branch (`null` for a detached HEAD). `app.repoRoot` is
 *     required here, never silently defaulted to `process.cwd()` — a
 *     missing value fails loud (see the `run()` guard below, mirroring the
 *     pre-existing `app.sessionService === undefined` guard immediately
 *     above it): `app.repoRoot` is ALWAYS populated for a real CLI boot
 *     (`createApp`'s own `repoRoot: string = process.cwd()` default,
 *     `app.ts`), so a missing value here means the App was mis-constructed,
 *     and substituting `process.cwd()` would silently partition whichever
 *     directory the process happens to be running from rather than the one
 *     the corpus describes.
 *   - `SessionService.getActiveSessions()` — the SAME corpus-wide derivation
 *     `lore bootstrap`'s `active_sessions` uses (by/machine/worktree/
 *     session_id groups with their claimed branches).
 *   - `real-git-port.ts::listLocalBranches(app.repoRoot)` — AC-OWN-1
 *     remediation (task-thread-real-local-branch-enumeration-from-the-git-
 *     port, 2026-08-13): every local branch git itself reports, threaded
 *     VERBATIM (never coerced — an `undefined` enumeration failure stays
 *     `undefined`) into `partitionTerritory`'s optional 4th `localBranches`
 *     parameter — discovery source (c), closing the gap where a branch
 *     neither checked out anywhere nor named by any claim was invisible to
 *     the other two sources and silently dropped.
 * Classification (`../territory-partition.ts::partitionTerritory`) routes
 *   through `gate-predicates.ts::compareClaimSessions` — the SAME
 *   three-valued session comparator the anchor-overlap mutex uses.
 *   `partitionTerritory` ALSO measures each entry's `unmerged_commits`
 *   (AC-REPLAY-1) via its own synchronous git probe — no separate
 *   enrichment step is needed here, `JSON.stringify(partition)` below
 *   already carries the field once present on an entry.
 *
 * The reason this task exists (2026-08-11): a session read a live peer's
 * in-flight branch as an orphan to rescue, because git topology carries no
 * ownership and no lore command could supply it. `lore territory` is the
 * command that would have prevented it — the merge protocol moves from
 * "scan `git branch -a` unconditionally" to "partition with `lore
 * territory`, act only on `mine` and `unowned`" (AC-REPLAY-1, sibling task).
 *
 * Exit codes: 0 = success; 1 = SessionService not wired; other codes per
 * `utils.ts::exitCode` on a git-port or store error.
 *
 * Source: spec-multi-session-concurrency-queryable-ownership-checkout §Scope L0, AC-OWN-1.
 */

import { defineCommand } from "citty";
import { RealGitPort, listLocalBranches } from "../../real-git-port.js";
import { resolveClaimSessionId } from "../../../service/task-workflow-service.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { partitionTerritory, formatTerritoryHuman } from "../territory-partition.js";

export default defineCommand({
  meta: {
    name: "territory",
    description:
      "Corpus-wide partition of every worktree/branch into mine/foreign/unowned/unmeasured (SPEC-L0, AC-OWN-1)",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output the raw TerritoryPartition as JSON",
    },
  },
  async run({ args }) {
    const { app } = loadLoreApp();
    try {
      if (app.sessionService === undefined) {
        process.stderr.write("Error: SessionService not wired on this App instance.\n");
        process.exitCode = 1;
        return;
      }
      // reason: fail loud rather than silently substituting process.cwd()
      // — see this module's own header for why. `app.repoRoot` is ALWAYS
      // set for a real CLI boot; a missing value here means the App was
      // mis-constructed, not that process.cwd() is a safe stand-in.
      if (app.repoRoot === undefined) {
        process.stderr.write("Error: repoRoot not set on this App instance.\n");
        process.exitCode = 1;
        return;
      }

      const gitPort = new RealGitPort(app.repoRoot);
      const worktreeListResult = await gitPort.worktreeList();
      if (!worktreeListResult.ok) {
        process.stderr.write(formatError(worktreeListResult.error) + "\n");
        process.exitCode = exitCode(worktreeListResult.error);
        return;
      }

      const activeSessionsResult = await app.sessionService.getActiveSessions();
      if (!activeSessionsResult.ok) {
        process.stderr.write(formatError(activeSessionsResult.error) + "\n");
        process.exitCode = exitCode(activeSessionsResult.error);
        return;
      }

      // reason: the SAME sanitized discriminator TaskWorkflowService.claim
      // captures into TaskClaim.session_id — read directly from process.env
      // here (the outermost CLI layer), never re-derived.
      const sessionIdResult = resolveClaimSessionId(process.env);
      const currentSessionId = sessionIdResult.ok ? sessionIdResult.value : undefined;

      // reason: AC-OWN-1 remediation (task-thread-real-local-branch-
      // enumeration-from-the-git-port) — discovery source (c),
      // territory-partition.ts's own §Invariants. `listLocalBranches`
      // already returns `undefined` (never `[]`) when enumeration was not
      // attempted or failed, so its result is threaded through VERBATIM —
      // never coerced — into `partitionTerritory`'s 4th parameter.
      const localBranches = await listLocalBranches(app.repoRoot);

      const partition = partitionTerritory(
        worktreeListResult.value.map((w) => ({ path: w.path, branch: w.branch })),
        activeSessionsResult.value,
        currentSessionId,
        localBranches,
      );

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: partition }, null, 2));
      } else {
        console.log(formatTerritoryHuman(partition));
      }
    } finally {
      app.close();
    }
  },
});
