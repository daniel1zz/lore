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
 *   - the drift check (AC-DCS2-16) runs after those refusals and before any worktree exists: the contract is recompiled through
 *     `DoneContractService` (the one compile); a stale falsifier literal or any compile cause refuses with every cause named and
 *     nothing created or stored; a changed recompile is stored once with a drift entry, and never drops an oracle.
 * Side-effect class: git (worktree, branch, diff), a child process (the install command), corpus writes (the drift write, the claim).
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-13, AC-DCS1-14), ledger D28, D33.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { doneContractSchema, err, extractFileAnchors, ok, type DocRecord, type DoneContract, type LoreError, type Result, type RunId } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import type { UncompilableCause } from "./done-contract-compile.js";
import type { DriftRecompile } from "./done-contract-service.js";
import { createGitRunner, type GitRunner } from "./evidence-binding.js";
import { resolveDoc } from "./resolve.js";
import type { ClaimOpts } from "./task-workflow-service.js";

/** The named refusals of `lore start`, each stated once. */
export const START_REFUSALS = [
  "not-approved",
  "kind-missing",
  "contract-missing",
  "use-finish",
  "contract-drift",
  "worktree-exists",
  "worktree-path-not-ignored",
  "worktree-dirty",
  "base-behind",
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
    refuseWorktreeHeldByAnotherClaim(task: DocRecord, worktree: string, nowIso: string): Promise<Result<void, LoreError>>;
  };
  /** The contract recompile and the one write of a changed contract plus its drift entry (AC-DCS2-16). */
  readonly contracts: {
    recompileForStart(task: DocRecord, stored: DoneContract): Promise<Result<DriftRecompile, LoreError>>;
    applyRecompile(task: DocRecord, stored: DoneContract, fresh: DoneContract, nowIso: string): Promise<Result<{ readonly stored: boolean }, LoreError>>;
  };
}

/** What the drift check found and did; printed by the command. */
export interface StartDrift {
  /** The commit the stored contract was compiled at. */
  readonly fromCommit: string;
  /** The tip of the base branch the start checked against. */
  readonly toCommit: string;
  /** `git diff` of the anchored and falsifier files between the two; empty when none changed. */
  readonly diff: string;
  /** The files the diff covered. */
  readonly paths: readonly string[];
  /** Whether a changed recompile was stored (and a drift entry written). */
  readonly stored: boolean;
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
  /**
   * The linked worktree the caller runs in (absolute path) and the branch checked out there, when `lore start` is to adopt it
   * instead of creating a sibling worktree (BR-1550, issue #623). Absent from the shared checkout.
   */
  readonly adopt?: { readonly path: string; readonly branch: string };
}

/** What a successful `lore start` did. */
export interface StartOutcome {
  readonly slug: string;
  readonly worktree: string;
  readonly branch: string;
  /** The task as stored after the claim, so the contract printed is the stored one with its persisted additions. */
  readonly task: DocRecord;
  readonly contract: DoneContract;
  readonly drift: StartDrift;
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
    // reason: BR-1550 — a worktree another fresh claim holds is never adopted (exit 5, same as a held task).
    if (input.adopt !== undefined) {
      const held = await this.deps.workflow.refuseWorktreeHeldByAnotherClaim(task, input.adopt.path, input.nowIso);
      if (!held.ok) return held;
    }

    if (task.status !== "approved") {
      return err(refusal("not-approved", `${task.slug} is ${task.status}; only an approved task is started (\`lore approve ${task.slug}\`).`));
    }
    const stored = doneContractSchema.safeParse(task.extra["done_contract"]);
    const kind = stored.success ? stored.data.kind : task.extra["kind"];
    // reason: D39 — no transitional path: a task without a kind is refused by name, never treated as code.
    if (kind !== "code" && kind !== "check" && kind !== "corpus") {
      return err(refusal("kind-missing", `${task.slug} has no kind (code, check or corpus). Run \`lore migrate done-contract\` to give every task its kind and contract.`));
    }
    if (!stored.success) {
      return err(refusal("contract-missing", `${task.slug} holds no done contract; it is compiled at approve (\`lore approve ${task.slug}\`).`));
    }
    const contract = stored.data;
    if (contract.kind !== "code") {
      return err(refusal("use-finish", `${task.slug} is a ${contract.kind} task: it has no worktree. Run \`lore finish ${task.slug}\` from the shared checkout.`));
    }

    const git = createGitRunner(input.cwd);
    const listed = git(["worktree", "list", "--porcelain"]);
    const repoRoot = listed.ok ? /^worktree (.+)$/m.exec(listed.stdout)?.[1] : undefined;
    if (repoRoot === undefined) {
      return err(refusal("start-git-failed", `the repository of ${input.cwd} cannot be read (${listed.ok ? "no worktree listed" : listed.reason}); nothing was created.`));
    }
    const repo = createGitRunner(repoRoot);

    // reason: AC-DCS2-16 — the drift since approve is decided before anything exists; a refusal here creates and stores nothing.
    const checked = await this.checkDrift(task, contract, repo, input.nowIso);
    if (!checked.ok) return checked;
    const drift = checked.value;

    if (input.adopt !== undefined) return this.startInAdoptedWorktree(task, contract, input, input.adopt, drift);

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
    return ok({ slug: task.slug, worktree: worktreePath, branch, task: claimed.value, contract: after.data, drift });
  }

  /**
   * BR-1550: starts the task in the caller's own linked worktree. Requires a clean tree whose HEAD contains the tip of the contract
   * base (else `worktree-dirty` / `base-behind`, naming `git merge --ff-only`), runs the install there and claims the task with that
   * worktree and its branch. Nothing is created, so a failure removes nothing; the claim writes nothing when refused.
   */
  private async startInAdoptedWorktree(
    task: DocRecord,
    contract: DoneContract,
    input: StartInput,
    adopt: { readonly path: string; readonly branch: string },
    drift: StartDrift,
  ): Promise<Result<StartOutcome, LoreError>> {
    const inTree = createGitRunner(adopt.path);
    const status = inTree(["status", "--porcelain"]);
    if (!status.ok) return err(refusal("start-git-failed", `${status.reason}; nothing was claimed.`));
    if (status.stdout.trim() !== "") {
      return err(refusal("worktree-dirty", `${adopt.path} has uncommitted changes; commit them (\`git commit\`) or move them aside, then start again. Nothing was claimed.`));
    }
    const baseTip = inTree(["rev-parse", "--verify", "--quiet", `refs/heads/${contract.base_branch}^{commit}`]);
    if (!baseTip.ok) return err(refusal("start-git-failed", `${baseTip.reason}; nothing was claimed.`));
    const contains = inTree(["merge-base", "--is-ancestor", baseTip.stdout.trim(), "HEAD"]);
    if (!contains.ok) {
      // reason: `git merge-base --is-ancestor` exits 1 for "not an ancestor"; any other failure is a git fault, never "behind".
      if (!contains.reason.includes(" exited 1:")) return err(refusal("start-git-failed", `${contains.reason}; nothing was claimed.`));
      return err(refusal("base-behind", `HEAD of ${adopt.path} does not contain the tip of ${contract.base_branch}; run \`git merge --ff-only ${contract.base_branch}\` there, then start again. Nothing was claimed.`));
    }

    if (contract.install !== undefined) {
      const install = spawnSync("sh", ["-c", contract.install], { cwd: adopt.path, encoding: "utf8", timeout: INSTALL_TIMEOUT_MS });
      if (install.error !== undefined || install.status !== 0) {
        const output = `${install.stdout ?? ""}${install.stderr ?? ""}`.trim().slice(-INSTALL_OUTPUT_TAIL_CHARS);
        const why = install.error !== undefined ? install.error.message : `exited ${install.status}`;
        return err(refusal("install-failed", `\`${contract.install}\` ${why} in ${adopt.path}; nothing was claimed.\n${output}`));
      }
    }

    const claimed = await this.deps.workflow.claim(task.slug, {
      by: input.by,
      harnessRun: input.harnessRun,
      branch: adopt.branch,
      machine: input.machine,
      worktree: adopt.path,
      ...(input.writeSet !== undefined ? { writeSet: input.writeSet } : {}),
      source: input.source,
    });
    if (!claimed.ok) return claimed;
    const after = doneContractSchema.safeParse(claimed.value.extra["done_contract"]);
    if (!after.success) return err(refusal("contract-missing", `${task.slug} lost its done contract during the claim.`));
    return ok({ slug: task.slug, worktree: adopt.path, branch: adopt.branch, task: claimed.value, contract: after.data, drift });
  }

  /**
   * The drift check: recompiles the contract (the one compile of approve), refuses a stale falsifier literal or any other cause with
   * every cause named, otherwise diffs the anchored and falsifier files since `compiled_at_commit` and stores a changed recompile.
   */
  private async checkDrift(task: DocRecord, contract: DoneContract, repo: GitRunner, nowIso: string): Promise<Result<StartDrift, LoreError>> {
    const recompiled = await this.deps.contracts.recompileForStart(task, contract);
    if (!recompiled.ok) return recompiled;
    const { causes, falsifierPaths } = recompiled.value;
    const missingLiterals = causes.filter((cause) => cause.code === "falsifier-literal-absent");
    const otherCauses = causes.filter((cause) => cause.code !== "falsifier-literal-absent");
    // reason: every cause is named in ONE refusal, so the refusal of the literals also carries the other causes found.
    const driftRefusal = (literals: readonly UncompilableCause[]): LoreError => {
      const all = [...literals, ...otherCauses];
      const lines = all.map((cause) => `  - ${cause.code}: ${cause.message}`);
      return refusal(
        "contract-drift",
        `the contract of ${task.slug} (compiled at ${contract.compiled_at_commit.slice(0, 12)}) is stale against ${contract.base_branch} (${all.length} cause${all.length === 1 ? "" : "s"}); ` +
          `no worktree was created and the stored contract is unchanged; fix every cause, then start again:\n${lines.join("\n")}`,
        all.map((cause) => cause.code),
      );
    };
    if (missingLiterals.length > 0) return err(driftRefusal(missingLiterals));
    if (otherCauses.length > 0) return err(driftRefusal([]));
    const fresh = recompiled.value.contract;
    if (fresh === undefined) return err(refusal("contract-missing", `${task.slug}: the recompile returned neither a contract nor a cause.`));

    const tipRun = repo(["rev-parse", "--verify", "--quiet", `refs/heads/${contract.base_branch}^{commit}`]);
    if (!tipRun.ok) return err(refusal("start-git-failed", `${tipRun.reason}; nothing was created.`));
    const toCommit = tipRun.stdout.trim();
    const paths = [...new Set([...extractFileAnchors(task).map((anchor) => anchor.split("#")[0] ?? anchor), ...falsifierPaths])].filter((path) => path !== "");
    let diff = "";
    if (paths.length > 0) {
      const diffRun = repo(["diff", `${contract.compiled_at_commit}..${toCommit}`, "--", ...paths]);
      if (!diffRun.ok) return err(refusal("start-git-failed", `${diffRun.reason}; nothing was created.`));
      diff = diffRun.stdout;
    }
    const applied = await this.deps.contracts.applyRecompile(task, contract, fresh, nowIso);
    if (!applied.ok) return applied;
    return ok({ fromCommit: contract.compiled_at_commit, toCommit, diff, paths, stored: applied.value.stored });
  }
}
