/**
 * Template growth: how a judge's per-dimension verdicts are completed against a template, and the shape of the
 * proposals that "this document should answer a question the template does not ask" accumulate into.
 *
 * Purpose: the pure core of prompt v9's judging contract and of the single pending revision per template
 *   (spec-every-document-is-stored-as-structured-fields-validated-by, Scope "Judge" and "Template growth", BR-1530).
 * Public surface: {@link completeDimensionVerdicts}, {@link templateProposalSchema}, {@link templateRevisionSchema},
 *   {@link proposalDecisionSchema}, {@link TEMPLATE_REVISION_STATUSES}, {@link TemplateProposal}, {@link TemplateRevision}.
 * Invariants:
 *   - A judge output that omits an applicable dimension yields `unclear` for it, NEVER `pass`; the completed list has
 *     exactly one entry per applicable dimension, in template order.
 *   - A verdict naming a dimension the template does not have (or that does not apply to the kind), and a second verdict
 *     for a dimension already judged, are dropped: the first verdict per applicable dimension wins.
 *   - A proposal never becomes a dimension without a review decision: an approved revision carries one decision per
 *     proposal, and a dropped proposal carries the reason.
 * Side-effect class: pure (no IO, no clock).
 */

import { z } from "zod";
import type { TemplateDimensionVerdict } from "./review-judgment.js";
import { dimensionApplies, type Template } from "./template.js";

/** Reason stored for a dimension the judge did not return a verdict for. */
export const MISSING_VERDICT_REASON = "the judge returned no verdict for this dimension";

/**
 * Complete a judge's per-dimension verdicts against the template: one entry per applicable dimension, in template order.
 *
 * @param template - the document's pinned template
 * @param kind - the document's kind (selects which dimensions apply); undefined = every dimension applies
 * @param emitted - what the judge returned (untrusted: may omit, repeat or invent dimension ids)
 * @returns the verdicts, where an omitted dimension is `unclear` with {@link MISSING_VERDICT_REASON}, never `pass`
 */
export function completeDimensionVerdicts(
  template: Template,
  kind: string | undefined,
  emitted: readonly TemplateDimensionVerdict[] | undefined,
): TemplateDimensionVerdict[] {
  const firstById = new Map<string, TemplateDimensionVerdict>();
  for (const verdict of emitted ?? []) {
    if (!firstById.has(verdict.dimension_id)) firstById.set(verdict.dimension_id, verdict);
  }
  return template.dimensions
    .filter((dimension) => dimensionApplies(dimension, kind))
    .map(
      (dimension): TemplateDimensionVerdict =>
        firstById.get(dimension.id) ?? {
          dimension_id: dimension.id,
          verdict: "unclear",
          reason: MISSING_VERDICT_REASON,
          evidence: "",
        },
    );
}

/** A pending revision is open until it is approved; there is at most one pending revision per template. */
export const TEMPLATE_REVISION_STATUSES = ["pending", "approved"] as const;
export type TemplateRevisionStatus = (typeof TEMPLATE_REVISION_STATUSES)[number];

/** The review decision on one proposal: accepted as a dimension (with its id), or dropped (with the reason). */
export const proposalDecisionSchema = z.discriminatedUnion("decision", [
  z.object({
    proposal_id: z.string().min(1),
    decision: z.literal("accepted"),
    dimension_id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "dimension id must be kebab-case (a-z, 0-9, hyphens)"),
  }),
  z.object({ proposal_id: z.string().min(1), decision: z.literal("dropped"), reason: z.string().trim().min(1, "a dropped proposal needs a reason") }),
]);
export type ProposalDecision = z.infer<typeof proposalDecisionSchema>;

/** One proposed dimension: the question, the judgments that raised it, and how many findings named it. */
export const templateProposalSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  source_judgment_ids: z.array(z.string().min(1)),
  /** Number of findings that named this gap (a second finding of the same gap raises it, it adds no proposal). */
  count: z.number().int().min(1),
  decision: z.enum(["accepted", "dropped"]).optional(),
  dimension_id: z.string().optional(),
  drop_reason: z.string().optional(),
});
export type TemplateProposal = z.infer<typeof templateProposalSchema>;

/** The pending (or approved) revision of one template, with its proposals in creation order. */
export const templateRevisionSchema = z.object({
  id: z.string().min(1),
  template_slug: z.string().min(1),
  status: z.enum(TEMPLATE_REVISION_STATUSES),
  /** The template version that was latest approved when the revision opened. */
  base_version: z.number().int().min(1),
  created_at: z.string(),
  resolved_at: z.string().optional(),
  resolved_by: z.string().optional(),
  proposals: z.array(templateProposalSchema),
});
export type TemplateRevision = z.infer<typeof templateRevisionSchema>;
