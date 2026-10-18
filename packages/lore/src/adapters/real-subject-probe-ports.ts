/**
 * Production {@link SubjectProbePorts}: real `git`, the real process table and the run lifecycle table.
 *
 * Purpose: let `lore pending` ask whether a pending decision's subject still exists (AU-T16).
 * Public surface: createRealSubjectProbePorts.
 * Invariants:
 *   - Every git call runs in the explicit `repoRoot` (the caller's resolved corpus repo), never an ambient cwd; a
 *     failed listing is `null` (unmeasured), never an empty list.
 * Side-effect class: IO (git subprocesses, `ps`, realpath, store reads).
 *
 * Source: task-skill-fix-au-t16-lore-pending-lists-escalations-whose.
 */
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { SubjectProbePorts } from "../service/decision-subject-probes.js";
import type { StoreInterface } from "../store/store-interface.js";
import { createRealProcessTablePort } from "./process-table-port.js";

function runGit(repoRoot: string, args: readonly string[]): string | null {
  const result = spawnSync("git", [...args], { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? (result.stdout ?? "") : null;
}

/** Real ports bound to `repoRoot` and the corpus `store` (read-only use of `listRunLifecycles`). */
export function createRealSubjectProbePorts(
  repoRoot: string,
  store: Pick<StoreInterface, "listRunLifecycles">,
  env: Readonly<Record<string, string | undefined>>,
): SubjectProbePorts {
  const processes = createRealProcessTablePort({ env, cwd: repoRoot });
  return {
    listWorktreePaths: () => {
      const out = runGit(repoRoot, ["worktree", "list", "--porcelain"]);
      return out === null ? null : out.split("\n").filter((line) => line.startsWith("worktree ")).map((line) => line.slice("worktree ".length));
    },
    realPath: (path) => {
      try {
        return realpathSync(path);
      } catch {
        // reason: a deleted path has no canonical form; compare the resolved input (nothing is fabricated).
        return resolve(path);
      }
    },
    listStashShas: () => {
      const out = runGit(repoRoot, ["stash", "list", "--format=%H"]);
      return out === null ? null : out.split("\n").filter((line) => line !== "");
    },
    inspectProcess: (pid) => processes.inspect(pid),
    runEnded: async (runId) => {
      const lifecycles = await store.listRunLifecycles();
      if (!lifecycles.ok) return null;
      const run = lifecycles.value.find((l) => l.id === runId);
      return run === undefined ? null : run.endedAt !== null;
    },
  };
}
