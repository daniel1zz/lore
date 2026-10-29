/**
 * Wiring of the criteria-at-head facts into `lore assess` (BR-1498): resolves the assessed commit, runs the plan's script
 * criteria once there and decides `correctness_vs_acs` from the attestations that run made.
 *
 * Purpose: keep `commands/assess.ts` thin; the decisions live in `service/milestone-attestation-facts.ts`.
 * Public surface: measurePlanCriteriaAtHead, resolveAssessedCommit, ListDocsPort.
 * Invariants:
 *   - Reads the corpus after the run; writes attested evidence only through the injected runner.
 *   - A failed corpus read or an unresolvable head is an `err` or a not-measured fact, never pass.
 * Side-effect class: IO through the injected corpus reader, runner and (for `resolveAssessedCommit`) a read-only git spawn.
 *
 * @spec_ref spec-a-plan-s-tests-and-criteria-are-measured-once-at-its (AC-AO-3, BR-1498)
 */

import { spawnSync } from "node:child_process";
import { err, ok, type DocRecord, type LoreError, type MilestoneFacts, type PlanBundle, type Result } from "@lore/core";
import {
  attestationRowsOf,
  measureCriteriaAtHead,
  planCriterionScopes,
  type AttestationRow,
  type HeadCriteriaRunnerPort,
} from "../../service/milestone-attestation-facts.js";

/** Reads every live doc of a type (`CorpusService.listFull` shape). */
export type ListDocsPort = (type: "spec" | "plan" | "task") => Promise<Result<DocRecord[], LoreError>>;

/**
 * The full sha of main's head: the commit a review measures at.
 *
 * @param cwd - any directory inside the project's checkout
 * @param env - the environment git runs with
 * @param mainRef - the ref that is main (default `main`)
 * @returns the sha, or an `err` naming git's complaint
 */
export function resolveAssessedCommit(cwd: string, env: NodeJS.ProcessEnv, mainRef = "main"): Result<string, LoreError> {
  const ran = spawnSync("git", ["rev-parse", "--verify", `${mainRef}^{commit}`], { cwd, env, encoding: "utf8" });
  const sha = ran.stdout.trim();
  return ran.status === 0 && sha.length > 0
    ? ok(sha)
    : err({ code: "STORE_ERROR", message: `could not resolve ${mainRef}: ${(ran.stderr ?? "").trim() || (ran.error?.message ?? "git failed")}` });
}

async function readRows(listDocs: ListDocsPort): Promise<Result<AttestationRow[], LoreError>> {
  const specs = await listDocs("spec");
  if (!specs.ok) return specs;
  const plans = await listDocs("plan");
  if (!plans.ok) return plans;
  const tasks = await listDocs("task");
  if (!tasks.ok) return tasks;
  return ok(attestationRowsOf(specs.value, plans.value, tasks.value));
}

/**
 * Runs the plan's script criteria once at the assessed commit and returns the criteria facts.
 *
 * @param listDocs - corpus reader
 * @param bundle - the plan bundle
 * @param head - the assessed commit and, when the review has one, the suite's throwaway worktree at it
 * @param runner - runs criteria at a commit through `lore verify`
 * @returns the part of `MilestoneFacts` this module owns (`criteria_attestation_ids` are the attestations made at the commit; `failing_fact_files` the files a failing criterion's command names)
 */
export async function measurePlanCriteriaAtHead(
  listDocs: ListDocsPort,
  bundle: PlanBundle,
  head: { readonly commit: string; readonly worktreeRoot?: string },
  runner: HeadCriteriaRunnerPort,
): Promise<Pick<MilestoneFacts, "attestation" | "criteria_attestation_ids" | "ai_criteria" | "failing_fact_files">> {
  const facts = await measureCriteriaAtHead({
    scopes: planCriterionScopes(bundle.spec, bundle.tasks),
    headCommit: head.commit,
    runner,
    ...(head.worktreeRoot !== undefined ? { worktreeRoot: head.worktreeRoot } : {}),
    readRows: () => readRows(listDocs),
  });
  return { attestation: facts.rows, criteria_attestation_ids: facts.deciding_ids, ai_criteria: facts.ai_criteria, failing_fact_files: facts.failing_files };
}
