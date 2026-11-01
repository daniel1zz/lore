/**
 * Template growth: the single pending revision of a template, the proposals that accumulate in it, and the review that
 * turns accepted proposals into dimensions.
 *
 * Purpose: the write side of "a judge that finds a question the template does not ask proposes a new dimension, and a human
 *   reviews it" (spec-every-document-is-stored-as-structured-fields-validated-by, Scope "Template growth", BR-1530).
 * Public surface: {@link recordMissingDimensionFindings} (called by `JudgmentService.record`), {@link TemplateGrowthService}
 *   (`pendingRevision`, `approveRevision`), {@link TemplateGrowthError}.
 * Invariants:
 *   - At most ONE pending revision per template slug: the store refuses a second (partial unique index); the code opens a
 *     revision only when none is pending and, if two writers race, adopts the one that won.
 *   - A finding naming an existing proposal of the pending revision (`same_as`) raises that proposal's count; any other finding
 *     adds a proposal. A `same_as` that names no proposal of the pending revision is treated as a new gap (the finding is kept,
 *     never dropped).
 *   - A proposal NEVER reaches the approved template without review: recording a finding writes only the proposal tables; the
 *     template document is touched only by {@link TemplateGrowthService.approveRevision}, and that edit is an ordinary template
 *     edit, so the document drops to draft and the template's own approval still follows (the approved version stays what it was).
 *   - Approving a revision needs one decision per proposal: accepted (with a new kebab-case dimension id) or dropped (with a reason).
 * Side-effect class: IO (store reads/writes; the template edit goes through the injected writer).
 */

import { ulid } from "ulidx";
import {
  err,
  ok,
  parseTemplate,
  parseTemplateRef,
  proposalDecisionSchema,
  validationError,
  type DocRecord,
  type LoreError,
  type ProposalDecision,
  type Result,
  type ReviewJudgment,
  type Template,
  type TemplateRevision,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import type { SetOptions } from "./corpus-service.js";
import type { TemplateService } from "./template-service.js";

/** What recording one finding did: which proposal it landed on and whether it created that proposal. */
export interface RecordedFinding {
  readonly proposal_id: string;
  readonly revision_id: string;
  readonly created: boolean;
}

/** Injected ids and clock, so the module itself reads no wall clock and tests are deterministic. */
export interface TemplateGrowthClock {
  readonly newId: () => string;
  readonly now: () => string;
}

const DEFAULT_CLOCK: TemplateGrowthClock = { newId: () => ulid().toLowerCase(), now: () => new Date().toISOString() };

/**
 * Turn a persisted judgment's `missing_dimensions` into proposals in the template's single pending revision.
 *
 * @param store - the store holding the revision and proposal tables
 * @param judgment - the already-stored judgment (its id is the proposals' source)
 * @param clock - ids and time (default: ULIDs and the wall clock)
 * @returns one {@link RecordedFinding} per finding, in order; empty when the judgment has no template or no findings
 */
export async function recordMissingDimensionFindings(
  store: StoreInterface,
  judgment: ReviewJudgment,
  clock: TemplateGrowthClock = DEFAULT_CLOCK,
): Promise<Result<RecordedFinding[], LoreError>> {
  const findings = judgment.missing_dimensions ?? [];
  if (judgment.template_ref === undefined || findings.length === 0) return ok([]);
  const ref = parseTemplateRef(judgment.template_ref);
  if (ref === undefined) {
    return err(validationError("template_ref", `judgment ${judgment.id} carries template ref "${judgment.template_ref}" that is not <slug>@<version>`, judgment.template_ref));
  }

  const recorded: RecordedFinding[] = [];
  for (const finding of findings) {
    const revision = await ensurePendingRevision(store, ref.slug, ref.version, clock);
    if (!revision.ok) return revision;
    const existing = finding.same_as === undefined ? undefined : revision.value.proposals.find((proposal) => proposal.id === finding.same_as);
    if (existing !== undefined) {
      const added = await store.insertTemplateProposalFinding({
        proposal_id: existing.id,
        judgment_id: judgment.id,
        reason: finding.reason,
        created_at: clock.now(),
      });
      if (!added.ok) return added;
      recorded.push({ proposal_id: existing.id, revision_id: revision.value.id, created: false });
      continue;
    }
    const proposalId = `prop-${clock.newId()}`;
    const inserted = await store.insertTemplateProposal({
      id: proposalId,
      revision_id: revision.value.id,
      question: finding.question,
      judgment_id: judgment.id,
      reason: finding.reason,
      created_at: clock.now(),
    });
    if (!inserted.ok) return inserted;
    recorded.push({ proposal_id: proposalId, revision_id: revision.value.id, created: true });
  }
  return ok(recorded);
}

/** The template's pending revision, opened when none exists; a racing writer's revision is adopted, never duplicated. */
async function ensurePendingRevision(
  store: StoreInterface,
  templateSlug: string,
  baseVersion: number,
  clock: TemplateGrowthClock,
): Promise<Result<TemplateRevision, LoreError>> {
  const found = await store.findPendingTemplateRevision(templateSlug);
  if (!found.ok) return found;
  if (found.value !== null) return ok(found.value);
  const opened = await store.insertTemplateRevision({ id: `rev-${clock.newId()}`, template_slug: templateSlug, base_version: baseVersion, created_at: clock.now() });
  const after = await store.findPendingTemplateRevision(templateSlug);
  if (!after.ok) return after;
  // reason: when the insert lost a race the unique index refused it and the winner's revision is the one to use; only when NO
  // pending revision exists after a refused insert is the refusal a real failure.
  if (after.value === null) return opened.ok ? err(validationError("template_revision", `template ${templateSlug}: opened a revision but cannot read it back`)) : opened;
  return ok(after.value);
}

/** Why an approval was refused. */
export type TemplateGrowthError = LoreError;

/** The writer the template edit goes through (`CorpusService.set`): the ordinary, validated, demoting write path. */
export interface TemplateEditPort {
  set(idOrSlug: string, patch: { extra: Record<string, unknown> }, opts?: SetOptions): Promise<Result<unknown, LoreError>>;
}

export class TemplateGrowthService {
  constructor(
    private readonly store: StoreInterface,
    private readonly templates: TemplateService,
    private readonly editor: TemplateEditPort,
    private readonly clock: TemplateGrowthClock = DEFAULT_CLOCK,
  ) {}

  /**
   * The template's pending revision with its proposals, or null.
   *
   * @param templateSlug - slug of the template document
   */
  async pendingRevision(templateSlug: string): Promise<Result<TemplateRevision | null, LoreError>> {
    return this.store.findPendingTemplateRevision(templateSlug);
  }

  /**
   * Approve the template's pending revision: accepted proposals become dimensions of a new template version, dropped ones keep
   * the reason, and the revision closes. The template edit is an ordinary template edit, so the template document returns to
   * draft; the previously approved version keeps resolving until the template is approved again.
   *
   * @param templateSlug - slug of the template document
   * @param decisions - exactly one decision per proposal of the pending revision
   * @param actor - who approves (recorded on the revision and on the template edit)
   * @returns the closed revision, or the refusal: no pending revision, a proposal without a decision (or a decision for an
   *   unknown proposal), a dropped proposal without a reason, an accepted dimension id that is malformed or already exists
   */
  async approveRevision(templateSlug: string, decisions: readonly unknown[], actor: string): Promise<Result<TemplateRevision, LoreError>> {
    const pending = await this.store.findPendingTemplateRevision(templateSlug);
    if (!pending.ok) return pending;
    const revision = pending.value;
    if (revision === null) {
      return err(validationError("template", `template ${templateSlug} has no pending revision to approve`, templateSlug));
    }

    const parsed: ProposalDecision[] = [];
    for (const raw of decisions) {
      const checked = proposalDecisionSchema.safeParse(raw);
      if (!checked.success) {
        return err(validationError("decisions", checked.error.issues.map((issue) => issue.message).join("; "), raw));
      }
      parsed.push(checked.data);
    }
    const coverage = checkCoverage(revision, parsed);
    if (coverage !== undefined) return err(coverage);

    const accepted = parsed.filter((decision): decision is Extract<ProposalDecision, { decision: "accepted" }> => decision.decision === "accepted");
    if (accepted.length > 0) {
      const edited = await this.addAcceptedDimensions(templateSlug, revision, accepted, actor);
      if (!edited.ok) return edited;
    }

    const closed = await this.store.approveTemplateRevision({ id: revision.id, resolved_at: this.clock.now(), resolved_by: actor, decisions: parsed });
    if (!closed.ok) return closed;
    const reread = await this.store.findTemplateRevisions(templateSlug);
    if (!reread.ok) return reread;
    const stored = reread.value.find((candidate) => candidate.id === revision.id);
    return stored === undefined ? err(validationError("template", `revision ${revision.id} vanished after approval`)) : ok(stored);
  }

  /** Append the accepted proposals as dimensions to the template document and bump its version past the approved one. */
  private async addAcceptedDimensions(
    templateSlug: string,
    revision: TemplateRevision,
    accepted: readonly Extract<ProposalDecision, { decision: "accepted" }>[],
    actor: string,
  ): Promise<Result<void, LoreError>> {
    const doc = await this.store.findBySlug(templateSlug);
    if (!doc.ok) return doc;
    if (doc.value === null || doc.value.type !== "template") {
      return err(validationError("template", `no template document "${templateSlug}"`, templateSlug));
    }
    const live = parseTemplate(doc.value.extra["template"]);
    if (!live.ok) {
      return err(validationError("template", `template ${templateSlug} does not parse: ${live.error.map((issue) => `${issue.path}: ${issue.problem}`).join("; ")}`));
    }
    const approved = await this.templates.resolveTemplate(live.value.doc_type, live.value.kind);
    if (!approved.ok) return approved;

    const taken = new Set(live.value.dimensions.map((dimension) => dimension.id));
    const questionOf = new Map(revision.proposals.map((proposal) => [proposal.id, proposal.question]));
    const added: { id: string; question: string }[] = [];
    for (const decision of accepted) {
      if (taken.has(decision.dimension_id)) {
        return err(validationError("decisions", `dimension id "${decision.dimension_id}" already exists in template ${templateSlug} (or is accepted twice)`, decision.dimension_id));
      }
      taken.add(decision.dimension_id);
      added.push({ id: decision.dimension_id, question: questionOf.get(decision.proposal_id) ?? "" });
    }
    const next: Template = {
      ...live.value,
      // reason: the new version sits past the newest APPROVED one, and never below a version a human already bumped the draft to.
      version: Math.max(live.value.version, approved.value.version + 1),
      dimensions: [...live.value.dimensions, ...added],
    };
    return mapVoid(await this.editor.set(templateSlug, { extra: { ...(doc.value as DocRecord).extra, template: next } }, { by: actor }));
  }
}

/** Every proposal decided exactly once, and no decision for an unknown proposal; undefined when the decisions are complete. */
function checkCoverage(revision: TemplateRevision, decisions: readonly ProposalDecision[]): LoreError | undefined {
  const known = new Set(revision.proposals.map((proposal) => proposal.id));
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (!known.has(decision.proposal_id)) {
      return validationError("decisions", `revision ${revision.id} has no proposal "${decision.proposal_id}"`, decision.proposal_id);
    }
    if (seen.has(decision.proposal_id)) {
      return validationError("decisions", `proposal "${decision.proposal_id}" is decided more than once`, decision.proposal_id);
    }
    seen.add(decision.proposal_id);
  }
  const missing = revision.proposals.filter((proposal) => !seen.has(proposal.id)).map((proposal) => proposal.id);
  if (missing.length > 0) {
    return validationError("decisions", `every proposal needs a decision (accept with a dimension id, or drop with a reason); missing: ${missing.join(", ")}`, missing);
  }
  return undefined;
}

function mapVoid<T>(result: Result<T, LoreError>): Result<void, LoreError> {
  return result.ok ? ok(undefined) : result;
}
