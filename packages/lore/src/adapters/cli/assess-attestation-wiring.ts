/**
 * Wiring of the criteria-attestation facts into `lore assess` (BR-1498): reads the corpus's stamped attestations, decides
 * the plan's criteria from bound evidence, and (in the batch) attests landed criteria at their landing commits.
 *
 * Purpose: keep `commands/assess.ts` thin; the decisions live in `service/milestone-attestation-facts.ts`.
 * Public surface: measurePlanAttestation, attestPlanLanding.
 * Invariants:
 *   - Reads only; `attestPlanLanding` writes attested evidence through the injected landing attester and nothing else.
 *   - A failed corpus read is an `err` (the caller leaves attestation unmeasured, never pass).
 *   - A failed attestation of one landing is a warning line, not an error: its criteria stay not-measured, named in the review.
 * Side-effect class: IO through the injected corpus reader, git port and attester.
 *
 * @spec_ref spec-the-milestone-review-measures-its-facts-per-landing-and (AC-AF-3, BR-1498)
 */

import { ok, type DocRecord, type LoreError, type MilestoneFacts, type PlanBundle, type Result } from "@lore/core";
import {
  attestLandedCriteria,
  attestationFacts,
  attestationRowsOf,
  planCriterionScopes,
  type CriterionScope,
  type AttestationRow,
  type LandingAttesterPort,
  type LandingAttestationReport,
  type MainFirstParentPort,
} from "../../service/milestone-attestation-facts.js";

/** Reads every live doc of a type (`CorpusService.listFull` shape). */
export type ListDocsPort = (type: "spec" | "plan" | "task") => Promise<Result<DocRecord[], LoreError>>;

async function loadInputs(listDocs: ListDocsPort, bundle: PlanBundle): Promise<Result<{ scopes: CriterionScope[]; rows: AttestationRow[] }, LoreError>> {
  const specs = await listDocs("spec");
  if (!specs.ok) return specs;
  const plans = await listDocs("plan");
  if (!plans.ok) return plans;
  const tasks = await listDocs("task");
  if (!tasks.ok) return tasks;
  return ok({ scopes: planCriterionScopes(bundle.spec, bundle.tasks), rows: attestationRowsOf(specs.value, plans.value, tasks.value) });
}

/**
 * The attestation facts of a plan: fact rows, AI-mode criteria for the judge and the deciding attestation ids.
 *
 * @param listDocs - corpus reader
 * @param bundle - the plan bundle
 * @param main - main's first-parent history
 * @returns the part of `MilestoneFacts` this module owns
 */
export async function measurePlanAttestation(
  listDocs: ListDocsPort,
  bundle: PlanBundle,
  main: MainFirstParentPort,
): Promise<Result<Pick<MilestoneFacts, "attestation" | "attestation_ids" | "ai_criteria">, LoreError>> {
  const inputs = await loadInputs(listDocs, bundle);
  if (!inputs.ok) return inputs;
  const facts = await attestationFacts(inputs.value.scopes, inputs.value.rows, main);
  return ok({ attestation: facts.rows, attestation_ids: facts.deciding_ids, ai_criteria: facts.ai_criteria });
}

/**
 * Attests the plan's landed script criteria at their landing commits (the post-landing batch step).
 *
 * @param listDocs - corpus reader
 * @param bundle - the plan bundle
 * @param main - main's first-parent history
 * @param attester - runs criteria at a landing commit
 * @param warn - receives one line per landing that could not be attested
 */
export async function attestPlanLanding(
  listDocs: ListDocsPort,
  bundle: PlanBundle,
  main: MainFirstParentPort,
  attester: LandingAttesterPort,
  warn: (line: string) => void,
): Promise<Result<LandingAttestationReport, LoreError>> {
  const inputs = await loadInputs(listDocs, bundle);
  if (!inputs.ok) return inputs;
  const report = await attestLandedCriteria(inputs.value.scopes, inputs.value.rows, main, attester);
  if (!report.ok) return report;
  for (const failure of report.value.failures) {
    warn(`Warning: could not attest ${failure.criteria.join(", ")} at landing ${failure.landing_commit}: ${failure.message}`);
  }
  return report;
}
