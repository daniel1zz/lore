/**
 * Module: task-start-service — `lore start` of a code task: checks the claim lease, creates the task's own worktree on the
 * contract's base branch, runs the contract's install command in it, claims the task there and returns the stored contract
 * (AC-DCS1-13, AC-DCS1-14).
 *
 * Purpose: the implementer's one opening verb; one call replaces `git worktree add`, the install and `lore claim`, and cuts the
 * worktree at the tip of the branch the task will land on (the plan's integration branch, else main), never at a stale main.
 * Public surface: {@link TaskStartService}, {@link TaskStartDeps}, {@link StartInput}, {@link StartOutcome}, {@link START_REFUSALS}.
 * Invariants:
 *   - the lease is checked FIRST (BR-1040, exit 5); every other refusal (not-approved, use-finish, worktree-exists,
 *     worktree-path-not-ignored) is decided before anything is created.
 *   - all or nothing: a failure after the worktree exists (install, claim) removes the worktree and the branch THIS run created,
 *     with plain `git worktree remove` and `git branch -d` (never forced), and stores nothing; a failed removal is named in the error.
 *   - the claim is made by `TaskWorkflowService.claim` (the one claim writer); this module records nothing of its own.
 *   - the drift check of the contract at start belongs to a later task; it enters through {@link TaskStartDeps.checkContractDrift}.
 * Side-effect class: git (worktree, branch), a child process (the install command), one corpus write through the claim.
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-13, AC-DCS1-14), ledger D28, D33.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { doneContractSchema, err, ok, type DocRecord, type DoneContract, type LoreError, type Result, type RunId } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { createGitRunner } from "./evidence-binding.js";
import { resolveDoc } from "./resolve.js";
import type { ClaimOpts } from "./task-workflow-service.js";

/** The named refusals of `lore start`, each stated once. */
export const START_REFUSALS = [
  "not-approved",
  "contract-missing",
  "use-finish",
  "worktree-exists",
  "worktree-path-not-ignored",
  "install-failed",
  "start-git-failed",
] as const;

/** One of {@link START_REFUSALS}. */
export type StartRefusal = (typeof START_REFUSALS)[number];

/** Longest an install command may run before `start` gives up (a hung install must not hold the claim path forever). */
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
/** The tail of the install output a refusal carries. */
const INSTALL_OUTPUT_TAIL_CHARS = 2000;

/** The services `lore start` composes; `app.ts` binds them (services never import each other). */
export interface TaskStartDeps {
  readonly store: StoreInterface;
  readonly workflow: {
    refuseClaimHeldByAnotherRun(task: DocRecord, party: { by: string; harnessRun?: RunId | null }, nowIso: string): Promise<Result<void, LoreError>>;
    claim(idOrSlug: string, opts: ClaimOpts, now?: () => string): Promise<Result<DocRecord, LoreError>>;
  };
  /**
   * The seam of the contract drift check at start (a later task of the plan): called after the refusals that need no git and
   * before anything is created. Absent, no drift is checked.
   */
  readonly checkContractDrift?: (task: DocRecord, contract: DoneContract) => Promise<Result<void, LoreError>>;
}

/** What one `lore start` call is given. */
export interface StartInput {
  /** Task slug or id. */
  readonly task: string;
  /** Any directory of the repository (the shared checkout or one of its worktrees). */
  readonly cwd: string;
  /** The caller's actor name. */
  readonly by: string;
  /** The caller's verified run; `null` when it has none. */
  readonly harnessRun: RunId | null;
  /** `--write-set` entries, passed to the claim as they were typed. */
  readonly writeSet?: readonly string[];
  /** The machine identity recorded on the claim. */
  readonly machine: string;
  /** The caller surface recorded in telemetry. */
  readonly source: string;
  /** The one reading of "now". */
  readonly nowIso: string;
}

/** What a successful `lore start` did. */
export interface StartOutcome {
  readonly slug: string;
  readonly worktree: string;
  readonly branch: string;
  /** The task as stored after the claim, so the contract printed is the stored one with its persisted additions. */
  readonly task: DocRecord;
  readonly contract: DoneContract;
}

function refusal(name: StartRefusal, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field: name, message: `${name}: ${message}`, value: { refusal: name, ...(value !== undefined ? { detail: value } : {}) } };
}

export class TaskStartService {
  constructor(private readonly deps: TaskStartDeps) {}

  /**
   * Starts a code task: lease, refusals, worktree on the contract base, install, claim.
   *
   * @param input - see {@link StartInput}
   * @returns the outcome, or a refusal (exit 4), or the lease conflict (exit 5); on any refusal nothing is left behind
   */
  async start(input: StartInput): Promise<Result<StartOutcome, LoreError>> {
    const resolved = await resolveDoc(this.deps.store, input.task);
    if (!resolved.ok) return resolved;
    const task = resolved.value;
    if (task.type !== "task") return err({ code: "VALIDATION_ERROR", field: "type", message: `Expected a task document; got type '${task.type}'`, value: task.type });

    // reason: BR-1040 — the lease is checked before anything else, so a task another run holds never gets a worktree.
    const lease = await this.deps.workflow.refuseClaimHeldByAnotherRun(task, { by: input.by, harnessRun: input.harnessRun }, input.nowIso);
    if (!lease.ok) return lease;

    if (task.status !== "approved") {
      return err(refusal("not-approved", `${task.slug} is ${task.status}; only an approved task is started (\`lore approve ${task.slug}\`).`));
    }
    const stored = doneContractSchema.safeParse(task.extra["done_contract"]);
    if (!stored.success) {
      return err(refusal("contract-missing", `${task.slug} holds no done contract; it is compiled at approve (\`lore approve ${task.slug}\`).`));
    }
    const contract = stored.data;
    if (contract.kind !== "code") {
      return err(refusal("use-finish", `${task.slug} is a ${contract.kind} task: it has no worktree. Run \`lore finish ${task.slug}\` from the shared checkout.`));
    }
    if (this.deps.checkContractDrift !== undefined) {
      const drift = await this.deps.checkContractDrift(task, contract);
      if (!drift.ok) return drift;
    }

    const git = createGitRunner(input.cwd);
    const listed = git(["worktree", "list", "--porcelain"]);
    const repoRoot = listed.ok ? /^worktree (.+)$/m.exec(listed.stdout)?.[1] : undefined;
    if (repoRoot === undefined) {
      return err(refusal("start-git-failed", `the repository of ${input.cwd} cannot be read (${listed.ok ? "no worktree listed" : listed.reason}); nothing was created.`));
    }
    const repo = createGitRunner(repoRoot);

    const branch = `task/${task.slug}`;
    const worktreePath = join(repoRoot, ".claude", "worktrees", task.slug);
    const branchExists = repo(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
    if (existsSync(worktreePath) || branchExists) {
      const what = [existsSync(worktreePath) ? `the path ${worktreePath}` : undefined, branchExists ? `the branch ${branch}` : undefined].filter((part) => part !== undefined).join(" and ");
      return err(refusal("worktree-exists", `${what} already exists; nothing was removed. Use it (\`lore claim ${task.slug} --worktree <path>\`) or remove it yourself, then start again.`));
    }
    const ignored = repo(["check-ignore", "-q", worktreePath]);
    if (!ignored.ok) {
      // reason: `git check-ignore -q` exits 1 for "not ignored"; any other failure is a git fault, never "not ignored".
      if (!ignored.reason.includes(" exited 1:")) return err(refusal("start-git-failed", `${ignored.reason}; nothing was created.`));
      return err(refusal("worktree-path-not-ignored", `git does not ignore ${worktreePath}; add \`.claude/\` to .gitignore or .git/info/exclude, then start again. Nothing was created.`));
    }

    const created = repo(["worktree", "add", "-b", branch, worktreePath, contract.base_branch]);
    if (!created.ok) return err(refusal("start-git-failed", `${created.reason}; nothing was created.`));

    // reason: `git branch -d` judges a branch against HEAD unless it has an upstream; the base may be an integration branch that
    // HEAD does not contain, so the branch this run created is pointed at its base first and the delete stays plain.
    let cleanupFailure: string | undefined;
    const removeStartWorktree = async (path: string, name: string): Promise<void> => {
      const steps: readonly (readonly string[])[] = [
        ["worktree", "remove", path],
        ["config", `branch.${name}.remote`, "."],
        ["config", `branch.${name}.merge`, `refs/heads/${contract.base_branch}`],
        ["branch", "-d", name],
      ];
      for (const step of steps) {
        const done = repo(step);
        if (!done.ok) {
          cleanupFailure = done.reason;
          return;
        }
      }
    };
    const fail = async (cause: LoreError): Promise<Result<StartOutcome, LoreError>> => {
      await removeStartWorktree(worktreePath, branch);
      if (cleanupFailure === undefined) return err(cause);
      const causeText = "message" in cause ? cause.message : cause.code;
      return err(refusal("start-git-failed", `${causeText}\nCleanup failed (${cleanupFailure}); remove ${worktreePath} and branch ${branch} yourself.`));
    };

    if (contract.install !== undefined) {
      const install = spawnSync("sh", ["-c", contract.install], { cwd: worktreePath, encoding: "utf8", timeout: INSTALL_TIMEOUT_MS });
      if (install.error !== undefined || install.status !== 0) {
        const output = `${install.stdout ?? ""}${install.stderr ?? ""}`.trim().slice(-INSTALL_OUTPUT_TAIL_CHARS);
        const why = install.error !== undefined ? install.error.message : `exited ${install.status}`;
        return fail(refusal("install-failed", `\`${contract.install}\` ${why} in ${worktreePath}; the worktree and branch were removed and nothing was claimed.\n${output}`));
      }
    }

    const claimed = await this.deps.workflow.claim(task.slug, {
      by: input.by,
      harnessRun: input.harnessRun,
      branch,
      machine: input.machine,
      worktree: worktreePath,
      ...(input.writeSet !== undefined ? { writeSet: input.writeSet } : {}),
      source: input.source,
    });
    if (!claimed.ok) return fail(claimed.error);

    const after = doneContractSchema.safeParse(claimed.value.extra["done_contract"]);
    if (!after.success) return fail(refusal("contract-missing", `${task.slug} lost its done contract during the claim.`));
    return ok({ slug: task.slug, worktree: worktreePath, branch, task: claimed.value, contract: after.data });
  }
}
