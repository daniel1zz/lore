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
 * Transitional stub: the per-landing criteria attestation is retired (AC-AO-3). Always an `err`, so a caller that still
 * uses it leaves criteria not-measured (never pass) until the B2 patch switches it to {@link measurePlanCriteriaAtHead}.
 *
 * @deprecated delete with the assess.ts patch.
 * @param _listDocs - unused
 * @param _bundle - unused
 * @param _main - unused
 * @returns an `err` naming the retirement
 */
export async function measurePlanAttestation(
  _listDocs: ListDocsPort,
  bundle: PlanBundle,
  _main: unknown,
): Promise<Result<Pick<MilestoneFacts, "attestation" | "attestation_ids" | "ai_criteria">, LoreError>> {
  // reason: no criterion runs through this stub, so script criteria are not-measured (never pass) and a plan with no
  // criterion in scope is still `na`, exactly as measurePlanCriteriaAtHead decides it.
  const facts = await measureCriteriaAtHead({
    scopes: planCriterionScopes(bundle.spec, bundle.tasks),
    headCommit: "",
    runner: { attestAtHead: async () => err({ code: "STORE_ERROR", message: "criteria are measured once at the assessed commit by measurePlanCriteriaAtHead; this call site is not switched yet" }) },
    readRows: async () => ok([]),
  });
  return ok({ attestation: facts.rows, attestation_ids: facts.deciding_ids, ai_criteria: facts.ai_criteria });
}

/**
 * Transitional stub: the post-landing criteria attestation is retired (AC-AO-3, AC-AO-4); attests nothing.
 *
 * @deprecated delete with the assess.ts patch.
 * @returns an empty report
 */
export async function attestPlanLanding(
  _listDocs: ListDocsPort,
  _bundle: PlanBundle,
  _main: unknown,
  _attester: unknown,
  _warn: (line: string) => void,
): Promise<Result<{ readonly attested: readonly never[]; readonly failures: readonly never[] }, LoreError>> {
  return ok({ attested: [], failures: [] });
}

/**
 * Runs the plan's script criteria once at the assessed commit and returns the criteria facts.
 *
 * @param listDocs - corpus reader
 * @param bundle - the plan bundle
 * @param head - the assessed commit and, when the review has one, the suite's throwaway worktree at it
 * @param runner - runs criteria at a commit through `lore verify`
 * @returns the part of `MilestoneFacts` this module owns (`attestation_ids` are the attestations made at the commit)
 */
export async function measurePlanCriteriaAtHead(
  listDocs: ListDocsPort,
  bundle: PlanBundle,
  head: { readonly commit: string; readonly worktreeRoot?: string },
  runner: HeadCriteriaRunnerPort,
): Promise<Pick<MilestoneFacts, "attestation" | "attestation_ids" | "ai_criteria">> {
  const facts = await measureCriteriaAtHead({
    scopes: planCriterionScopes(bundle.spec, bundle.tasks),
    headCommit: head.commit,
    runner,
    ...(head.worktreeRoot !== undefined ? { worktreeRoot: head.worktreeRoot } : {}),
    readRows: () => readRows(listDocs),
  });
  return { attestation: facts.rows, attestation_ids: facts.deciding_ids, ai_criteria: facts.ai_criteria };
}
