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
import { resolveDoc } from "./resolve.js";

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

/** A persisted integration-branch declaration. */
export interface PlanIntegrationBranch {
  readonly branch: string;
  readonly by: string;
  readonly at: string;
}

export class PlanIntegrationBranchService {
  constructor(
    private readonly store: StoreInterface,
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer. This service never calls `store.update` / `insertVersion` / `appendAuditEntry` itself.
    writer?: DocWritePort,
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
    return ok({ branch, by: opts.by, at });
  }
}
