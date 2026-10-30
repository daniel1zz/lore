/**
 * PlanIntegrationBranchService — the SOLE writer of a plan's `extra.integration_branch`.
 *
 * Purpose: declare the feature branch a plan lands through, so a `blocks` edge counts as READY-met when the blocker
 *   landed there while `lore done` still judges "landed" against main.
 * Public surface: `setIntegrationBranch(planIdOrSlug, {branch, by})` → `PlanIntegrationBranch`.
 * Invariants:
 *   - READ-MERGE-WRITE, never wholesale replacement: `lore set` replaces `extra` in full, which is why this field has
 *     a dedicated writer. Every `extra` key this service does not own is carried through byte-identical.
 *   - The audit row carries the RESOLVED actor and the branch.
 *   - A branch name that is not a plain git ref name is REFUSED (`VALIDATION_ERROR`, BR-1313).
 * Side-effect class: store IO only (doc update + version insert + audit append, through the one `DocWritePort`).
 *
 * This service used to also write the plan-close exemptions of the attestation floor and the assessment-freshness
 * predicate; both predicates were removed when the milestone review became the only plan-close check (BR-1372).
 */

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";
import { createGitRunner } from "./evidence-binding.js";
import { resolveDoc } from "./resolve.js";

/**
 * The git facts and the one git write the declaration needs (AC-DCS2-10): where main and a branch point, and creating a branch.
 * Every method either answers or says why it could not; none returns a guess.
 */
export interface PlanBranchGit {
  /** The commit `refs/heads/main` points at. */
  mainHead(): Promise<Result<string, LoreError>>;
  /** The commit of local branch `name`, `null` when no such branch exists. */
  branchHead(name: string): Promise<Result<string | null, LoreError>>;
  /** Creates local branch `name` at `commit`; never moves an existing branch. @throws {Error} when git refuses (the message says why) */
  createBranch(name: string, commit: string): Promise<void>;
}

/** The real {@link PlanBranchGit} over the repository at `repoRoot`. */
export function createPlanBranchGit(repoRoot: string): PlanBranchGit {
  const git = createGitRunner(repoRoot);
  const failure = (reason: string): LoreError => ({ code: "STORE_ERROR", message: `plan integration branch: ${reason}` });
  return {
    async mainHead() {
      const head = git(["rev-parse", "--verify", "refs/heads/main"]);
      return head.ok ? ok(head.stdout.trim()) : err(failure(`main cannot be read (${head.reason})`));
    },
    async branchHead(name) {
      const exists = git(["show-ref", "--verify", "--quiet", `refs/heads/${name}`]);
      if (!exists.ok) {
        // reason: show-ref --quiet exits 1 only for "no such ref"; any other failure is a git fault, never "absent".
        return exists.reason.includes("exited 1:") ? ok(null) : err(failure(`branch ${name} cannot be looked up (${exists.reason})`));
      }
      const head = git(["rev-parse", "--verify", `refs/heads/${name}`]);
      return head.ok ? ok(head.stdout.trim()) : err(failure(`branch ${name} cannot be read (${head.reason})`));
    },
    async createBranch(name, commit) {
      const created = git(["branch", "--no-track", name, commit]);
      if (!created.ok) throw new Error(`branch ${name} could not be created at ${commit} (${created.reason})`);
    },
  };
}

/** `extra` key the integration-branch declaration owns. */
export const INTEGRATION_BRANCH_FIELD = "integration_branch";

/** A branch name safe to hand to git as a ref: no leading dash, no whitespace, no `..`, no ref-special characters. */
const INTEGRATION_BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/** {@link PlanIntegrationBranchService.setIntegrationBranch} options. */
export interface IntegrationBranchOpts {
  /** The branch the plan's members land on before it reaches main. */
  readonly branch: string;
  /** Actor identity recording the declaration (already resolved by the caller). */
  readonly by: string;
}

/** What the declaration did to the git branch: made it, found it at main's tip, or (no git port) did not look. */
export type BranchState = "created" | "reused" | "not-checked";

/** A persisted integration-branch declaration. */
export interface PlanIntegrationBranch {
  readonly branch: string;
  readonly by: string;
  readonly at: string;
  readonly branch_state: BranchState;
}

export class PlanIntegrationBranchService {
  constructor(
    private readonly store: StoreInterface,
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer. This service never calls `store.update` / `insertVersion` / `appendAuditEntry` itself.
    writer?: DocWritePort,
    // reason: AC-DCS2-10 — `app.ts` passes the real git port, so the declared branch always exists; a bare test construction has
    // none and only declares (it never touches a repository).
    private readonly git?: PlanBranchGit,
  ) {
    this.writer = writer ?? bareDocWriter(store);
  }

  private readonly writer: DocWritePort;

  /**
   * Declare the integration (feature) branch a plan lands through.
   *
   * @param planIdOrSlug - Plan document ULID or slug
   * @param opts - `{branch, by}`; `branch` must look like a plain git branch name
   * @returns The persisted declaration `{branch, by, at}`
   * @throws (as `Result`) DOC_NOT_FOUND, VALIDATION_ERROR (blank/odd branch name, non-plan target), STALE_VERSION
   */
  async setIntegrationBranch(
    planIdOrSlug: string,
    opts: IntegrationBranchOpts,
  ): Promise<Result<PlanIntegrationBranch, LoreError>> {
    const branch = typeof opts.branch === "string" ? opts.branch.trim() : "";
    if (branch === "" || !INTEGRATION_BRANCH_PATTERN.test(branch) || branch.includes("..") || branch.endsWith("/")) {
      return err({
        code: "VALIDATION_ERROR",
        field: INTEGRATION_BRANCH_FIELD,
        message: `integration branch must be a plain branch name like 'gs-integration' (got '${String(opts.branch)}')`,
        value: opts.branch,
        rule: "BR-1313",
      });
    }
    const planResult = await resolveDoc(this.store, planIdOrSlug);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;
    if (plan.type !== "plan") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a plan document; got type '${plan.type}'`,
        value: plan.type,
      });
    }
    const ensured = await this.ensureBranchAtMain(branch);
    if (!ensured.ok) return ensured;
    const at = new Date().toISOString();
    // THE invariant: spread the existing extra FIRST, so every key this service does not own survives byte-identical.
    const written = await this.writer.writeDoc({
      doc: plan,
      patch: { extra: { ...plan.extra, [INTEGRATION_BRANCH_FIELD]: branch } },
      action: "update",
      changeSummary: `Plan integration branch declared: ${branch}`,
      auditAction: "update",
      auditDetails: { operation: "integration-branch", [INTEGRATION_BRANCH_FIELD]: branch },
      lock: "none",
      by: opts.by,
      now: at,
    });
    if (!written.ok) return written;
    return ok({ branch, by: opts.by, at, branch_state: ensured.value });
  }

  /**
   * Makes sure local branch `name` exists at the tip of main: creates it when absent, leaves one already there alone, refuses one
   * at another commit (`integration-branch-exists`, both commits named, nothing changed). Without a git port it does nothing.
   */
  private async ensureBranchAtMain(name: string): Promise<Result<BranchState, LoreError>> {
    if (this.git === undefined) return ok("not-checked");
    const main = await this.git.mainHead();
    if (!main.ok) return main;
    const existing = await this.git.branchHead(name);
    if (!existing.ok) return existing;
    if (existing.value === null) {
      const mainHead = main.value;
      try {
        await this.git.createBranch(name, mainHead);
      } catch (cause) {
        return err({ code: "STORE_ERROR", message: `plan integration branch: ${cause instanceof Error ? cause.message : String(cause)}` });
      }
      return ok("created");
    }
    if (existing.value === main.value) return ok("reused");
    return err({
      code: "VALIDATION_ERROR",
      field: "integration-branch-exists",
      message:
        `integration-branch-exists: branch ${name} already exists at ${existing.value.slice(0, 12)} but main is at ${main.value.slice(0, 12)}; ` +
        `nothing was changed. Declare another name, or move the branch deliberately (it must start at main's tip: \`git branch -f ${name} main\` only if it holds no work).`,
      value: { branch: name, branch_head: existing.value, main_head: main.value },
      rule: "BR-1313",
    });
  }
}
