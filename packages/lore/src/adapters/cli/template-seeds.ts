/**
 * Reader for the shipped template seeds (`assets/templates/*.json`).
 *
 * Purpose: hand `TemplateSeedService` the parsed seeds; the seeds are STATIC JSON imports, so the compiled binary carries
 *   them, `lore init` / `lore migrate templates` / test helpers share ONE source, and the test selector follows imports.
 * Public surface: {@link readShippedTemplateSeeds}, {@link SHIPPED_TEMPLATE_SEED_FILES}.
 * Invariants:
 *   - The import list below is the seed set; `template-seeds-static.test.ts` proves it equals `assets/templates/*.json`
 *     (a seed added to the directory without an import fails that test, never ships silently missing).
 *   - A seed that fails the core meta-schema is a loud VALIDATION_ERROR naming the file, never skipped (a skipped seed
 *     would leave a type with no template).
 *   - Order is the file-name order, so previews and outcomes are deterministic.
 * Side-effect class: pure (no IO at call time; the JSON is bundled at build time).
 */

import { err, ok, parseTemplate, type LoreError, type Result } from "@lore/core";
import { seedFileError, type TemplateSeed } from "../../service/template-seed-service.js";
import adrSeed from "../../../../../assets/templates/adr.json";
import baselineBranchSeed from "../../../../../assets/templates/baseline-branch.json";
import baselineDebtRegistrySeed from "../../../../../assets/templates/baseline-debt-registry.json";
import baselineLeafSeed from "../../../../../assets/templates/baseline-leaf.json";
import baselineModuleCardSeed from "../../../../../assets/templates/baseline-module-card.json";
import baselineRootSeed from "../../../../../assets/templates/baseline-root.json";
import baselineSectionSeed from "../../../../../assets/templates/baseline-section.json";
import baselineStandardSeed from "../../../../../assets/templates/baseline-standard.json";
import issueReportSeed from "../../../../../assets/templates/issue-report.json";
import knowledgeAssessmentSeed from "../../../../../assets/templates/knowledge-assessment.json";
import knowledgeHandoffSeed from "../../../../../assets/templates/knowledge-handoff.json";
import knowledgeIdeationSeed from "../../../../../assets/templates/knowledge-ideation.json";
import knowledgeMilestoneReviewSeed from "../../../../../assets/templates/knowledge-milestone-review.json";
import knowledgePromptSeed from "../../../../../assets/templates/knowledge-prompt.json";
import knowledgeReferenceSeed from "../../../../../assets/templates/knowledge-reference.json";
import knowledgeResearchSeed from "../../../../../assets/templates/knowledge-research.json";
import knowledgeRetroSeed from "../../../../../assets/templates/knowledge-retro.json";
import knowledgeSkillSeed from "../../../../../assets/templates/knowledge-skill.json";
import knowledgeUatSeed from "../../../../../assets/templates/knowledge-uat.json";
import phaseSeed from "../../../../../assets/templates/phase.json";
import planSeed from "../../../../../assets/templates/plan.json";
import prdSeed from "../../../../../assets/templates/prd.json";
import specDesignSeed from "../../../../../assets/templates/spec-design.json";
import specDomainOverviewSeed from "../../../../../assets/templates/spec-domain-overview.json";
import specFeatureSeed from "../../../../../assets/templates/spec-feature.json";
import specTechSeed from "../../../../../assets/templates/spec-tech.json";
import taskSeed from "../../../../../assets/templates/task.json";

const SHIPPED_SEED_ENTRIES: ReadonlyArray<readonly [string, unknown]> = [
  ["adr.json", adrSeed],
  ["baseline-branch.json", baselineBranchSeed],
  ["baseline-debt-registry.json", baselineDebtRegistrySeed],
  ["baseline-leaf.json", baselineLeafSeed],
  ["baseline-module-card.json", baselineModuleCardSeed],
  ["baseline-root.json", baselineRootSeed],
  ["baseline-section.json", baselineSectionSeed],
  ["baseline-standard.json", baselineStandardSeed],
  ["issue-report.json", issueReportSeed],
  ["knowledge-assessment.json", knowledgeAssessmentSeed],
  ["knowledge-handoff.json", knowledgeHandoffSeed],
  ["knowledge-ideation.json", knowledgeIdeationSeed],
  ["knowledge-milestone-review.json", knowledgeMilestoneReviewSeed],
  ["knowledge-prompt.json", knowledgePromptSeed],
  ["knowledge-reference.json", knowledgeReferenceSeed],
  ["knowledge-research.json", knowledgeResearchSeed],
  ["knowledge-retro.json", knowledgeRetroSeed],
  ["knowledge-skill.json", knowledgeSkillSeed],
  ["knowledge-uat.json", knowledgeUatSeed],
  ["phase.json", phaseSeed],
  ["plan.json", planSeed],
  ["prd.json", prdSeed],
  ["spec-design.json", specDesignSeed],
  ["spec-domain-overview.json", specDomainOverviewSeed],
  ["spec-feature.json", specFeatureSeed],
  ["spec-tech.json", specTechSeed],
  ["task.json", taskSeed],
];

/** The file names of the statically imported seeds, in file-name order (the drift test compares it to the directory). */
export const SHIPPED_TEMPLATE_SEED_FILES: readonly string[] = SHIPPED_SEED_ENTRIES.map(([file]) => file);

/**
 * Parse every shipped seed.
 *
 * @returns the seeds in file-name order, or the first invalid seed as an error naming its file
 */
export function readShippedTemplateSeeds(): Result<TemplateSeed[], LoreError> {
  const seeds: TemplateSeed[] = [];
  for (const [file, raw] of [...SHIPPED_SEED_ENTRIES].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const parsed = parseTemplate(raw);
    if (!parsed.ok) return err(seedFileError(file, parsed.error.map((issue) => `${issue.path}: ${issue.problem}`).join("; ")));
    seeds.push({ file, template: parsed.value });
  }
  return ok(seeds);
}
