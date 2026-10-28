/**
 * DecisionOutcomeService: the outcome link from an escaped defect back to the recorded decision that let it through
 * (`lore decision trace`), and the rates read over those links (`lore decision rates`).
 *
 * Purpose: BR-1481 — a decision's gates and scores are only worth what they predict; this service appends traced
 *   failures to the plan's latest milestone review and counts them against the decisions that passed each gate / scored
 *   each dimension, as a LOWER bound (an untraced escape is invisible).
 * Public surface: {@link DecisionOutcomeService} (`trace`, `rates`), {@link TraceInput}, {@link RatesInput},
 *   {@link RatesReport}, {@link parseDecisionAddress}, {@link ruleOfThreeUpperBound}.
 * Invariants:
 *   - `trace` appends `{issue, decision, part}` to `extra.milestone_review.traced_decisions` of the plan's LATEST
 *     milestone-review document, once per triple (a repeat writes nothing), through the one write route with the version it
 *     read as the compare-and-swap guard; a lost race re-reads and re-appends, so two concurrent traces both land.
 *   - `decision` must resolve to a version row with a recorded decision, and `part` must name a gate id, a score dimension
 *     or a premise of THAT decision; anything else is `VALIDATION_ERROR` (exit 4) and nothing is written.
 *   - `rates` shares are a lower bound; at zero traced failures the rule-of-three upper bound `3/n` (95%) is reported.
 *   - Only this service writes `traced_decisions` (`lore set` refuses the key: DEDICATED_EXTRA_KEYS).
 * Side-effect class: IO (store reads; `trace` makes one `writeDoc` per attempt).
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, "Outcome link and rates"; BR-1481.
 */

import {
  err,
  milestoneReviewSchema,
  ok,
  type DecisionRecord,
  type DocRecord,
  type LoreError,
  type PlanBundle,
  type Result,
  type TracedDecision,
  type VersionRecord,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { selectPlanDecisions } from "./decision-recheck.js";
import { type DocWritePort } from "./corpus-service.js";
import { resolveDoc } from "./resolve.js";
import { selectLatestMilestoneReview } from "./milestone-review.js";

const OUTCOME_RULE = "BR-1481";
/** Attempts of the compare-and-swap append before a persistent race is reported (each attempt re-reads). */
const MAX_TRACE_ATTEMPTS = 10;
const WEIGHT_KINDS = ["rule revision", "document revision"] as const;

/** What `lore decision trace` hands the service. */
export interface TraceInput {
  /** The plan: id, slug or id prefix. */
  readonly plan: string;
  /** The issue that exposed the defect. */
  readonly issue: number;
  /** The decision's address `<slug>@<version>`. */
  readonly decision: string;
  /** A gate id, a score dimension, or `premise` (optionally `premise <n>`). */
  readonly part: string;
}

/** What `lore decision trace` reports. */
export interface TraceOutcome {
  readonly review: string;
  readonly entry: TracedDecision;
  /** `false` when the triple was already on the review (nothing written). */
  readonly added: boolean;
}

/** What `lore decision rates` hands the service. */
export interface RatesInput {
  /** Only decisions of this kind: `rule revision` or `document revision`. */
  readonly kind?: string;
  /** Only decisions (and reviews, archived tasks) at or after this ISO date. */
  readonly since?: string;
}

/** One gate's or score dimension's row. */
export interface RateRow {
  readonly part: string;
  /** Decisions that passed this gate / scored this dimension. */
  readonly decisions: number;
  /** Distinct decisions traced as failing on this part. */
  readonly tracedFailures: number;
  /** `tracedFailures / decisions`, a lower bound of the true failure share. */
  readonly shareLowerBound: number;
  /** Present only at zero traced failures: the 95% upper bound `3 / decisions`. */
  readonly ruleOfThreeUpperBound?: number;
}

/** The report of `lore decision rates`. */
export interface RatesReport {
  readonly kind: string | null;
  readonly since: string | null;
  readonly decisions: number;
  readonly gates: readonly RateRow[];
  readonly dimensions: readonly RateRow[];
  /** Recorded decisions of the window that belong to no plan (the plan selection, over every plan). */
  readonly decisionsInNoPlan: number;
  readonly guards: {
    readonly milestoneReviews: number;
    readonly tracedLinks: number;
    /** `tracedLinks / milestoneReviews`; `null` when there is no review. */
    readonly tracedLinksPerReview: number | null;
    readonly archivedTasks: number;
    /** `decisions / archivedTasks`; `null` when no task is archived. */
    readonly decisionsPerArchivedTask: number | null;
  };
}

/** The ports of {@link DecisionOutcomeService}; `app.ts` binds `CorpusService`'s methods. */
export interface DecisionOutcomeDeps {
  readonly store: StoreInterface;
  readonly writer: DocWritePort;
  readonly listMilestoneReviewDocs: (planId: string) => Promise<Result<DocRecord[], LoreError>>;
  readonly getPlanBundle: (planId: string) => Promise<Result<PlanBundle, LoreError>>;
}

function refuse(field: string, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, ...(value !== undefined ? { value } : {}), rule: OUTCOME_RULE };
}

/**
 * Split a decision address.
 *
 * @param text - `<slug>@<version>`
 * @returns the slug and version, or `VALIDATION_ERROR` when the text is not an address
 */
export function parseDecisionAddress(text: string): Result<{ slug: string; version: number }, LoreError> {
  const at = text.lastIndexOf("@");
  const slug = at > 0 ? text.slice(0, at) : "";
  const versionText = at > 0 ? text.slice(at + 1) : "";
  const version = /^[1-9]\d*$/.test(versionText) ? Number(versionText) : Number.NaN;
  if (slug === "" || !Number.isInteger(version)) {
    return err(refuse("decision", `--decision must be "<slug>@<version>", got "${text}".`, text));
  }
  return ok({ slug, version });
}

/**
 * The 95% upper bound of a failure share when none of `n` decisions failed (the rule of three).
 *
 * @param n - decisions observed, > 0
 */
export function ruleOfThreeUpperBound(n: number): number {
  return 3 / n;
}

/** The parts of `record` a trace may name: gate ids, score dimensions, `premise` / `premise <n>`. */
function namedParts(record: DecisionRecord): { gates: string[]; dimensions: string[]; premises: number } {
  return {
    gates: (record.gates ?? []).map((g) => g.id),
    dimensions: [...new Set((record.scores ?? []).map((s) => s.dimension))],
    premises: record.premises.length,
  };
}

function partIsNamed(record: DecisionRecord, part: string): boolean {
  const named = namedParts(record);
  if (named.gates.includes(part) || named.dimensions.includes(part)) return true;
  if (part === "premise") return named.premises > 0;
  const numbered = /^premise (\d+)$/.exec(part);
  return numbered !== null && Number(numbered[1]) >= 1 && Number(numbered[1]) <= named.premises;
}

function sameTriple(a: TracedDecision, b: TracedDecision): boolean {
  return a.issue === b.issue && a.decision === b.decision && a.part === b.part;
}

function addHolder(holders: Map<string, Set<string>>, part: string, address: string): void {
  const set = holders.get(part) ?? new Set<string>();
  set.add(address);
  holders.set(part, set);
}

/** Outcome links and rates over recorded decisions; see the module header. */
export class DecisionOutcomeService {
  constructor(private readonly deps: DecisionOutcomeDeps) {}

  /**
   * Append one outcome link to the plan's latest milestone review.
   *
   * @param input - see {@link TraceInput}
   * @returns the review's slug and the entry; `added: false` when the triple was already there
   */
  async trace(input: TraceInput): Promise<Result<TraceOutcome, LoreError>> {
    if (!Number.isInteger(input.issue) || input.issue < 1) return err(refuse("issue", `--issue must be a positive integer, got "${String(input.issue)}".`, input.issue));
    if (input.part.trim() === "") return err(refuse("part", "--part must name a gate id, a score dimension or premise.", input.part));
    const address = parseDecisionAddress(input.decision);
    if (!address.ok) return address;
    const checked = await this.checkDecision(address.value.slug, address.value.version, input.part);
    if (!checked.ok) return checked;

    const resolved = await resolveDoc(this.deps.store, input.plan);
    if (!resolved.ok) return resolved;
    const plan = resolved.value;
    if (plan.type !== "plan") return err(refuse("plan", `${plan.slug} is a ${plan.type}, not a plan.`, plan.slug));

    const entry: TracedDecision = { issue: input.issue, decision: input.decision, part: input.part };
    for (let attempt = 0; attempt < MAX_TRACE_ATTEMPTS; attempt += 1) {
      const docs = await this.deps.listMilestoneReviewDocs(plan.id);
      if (!docs.ok) return docs;
      const latest = selectLatestMilestoneReview(docs.value);
      if (latest === undefined) {
        return err(refuse("plan", `${plan.slug} has no milestone review to trace into; run \`lore assess ${plan.slug}\` first.`, plan.slug));
      }
      const existing = latest.review.traced_decisions ?? [];
      if (existing.some((e) => sameTriple(e, entry))) return ok({ review: latest.doc.slug, entry, added: false });
      const review = milestoneReviewSchema.parse({ ...latest.review, traced_decisions: [...existing, entry] });
      const written = await this.deps.writer.writeDoc({
        doc: latest.doc,
        patch: { extra: { ...latest.doc.extra, milestone_review: review } },
        action: "update",
        changeSummary: `Traced ${input.decision} (${input.part}) to issue #${String(input.issue)}`,
        auditAction: "update",
        auditDetails: { operation: "decision-trace", issue: input.issue, decision: input.decision, part: input.part },
        lock: "none",
      });
      if (written.ok) return ok({ review: latest.doc.slug, entry, added: true });
      // reason: a lost compare-and-swap means another trace landed first; re-reading keeps its entry and appends ours (BR-1481).
      if (written.error.code !== "STALE_VERSION") return written;
    }
    return err(refuse("traced_decisions", `the review of ${plan.slug} kept changing under ${String(MAX_TRACE_ATTEMPTS)} attempts; re-run the trace.`));
  }

  private async checkDecision(slug: string, version: number, part: string): Promise<Result<VersionRecord, LoreError>> {
    const doc = await this.deps.store.findBySlug(slug);
    if (!doc.ok) return doc;
    if (doc.value === null) return err(refuse("decision", `no document "${slug}" for the decision address.`, slug));
    const versions = await this.deps.store.findVersions(doc.value.id, { limit: 1000 });
    if (!versions.ok) return versions;
    const row = versions.value.find((v) => v.version === version);
    if (row === undefined) return err(refuse("decision", `${slug} has no version ${String(version)}.`, `${slug}@${String(version)}`));
    if (row.decision == null) return err(refuse("decision", `${slug}@${String(version)} recorded no decision.`, `${slug}@${String(version)}`));
    if (!partIsNamed(row.decision, part)) {
      const named = namedParts(row.decision);
      const choices = [...named.gates, ...named.dimensions, ...(named.premises > 0 ? ["premise"] : [])].join(", ");
      return err(refuse("part", `${slug}@${String(version)} has no part "${part}"; its parts: ${choices === "" ? "(none)" : choices}.`, part));
    }
    return ok(row);
  }

  /**
   * Count, per gate and score dimension, the decisions that passed against the traced failures.
   *
   * @param input - see {@link RatesInput}
   */
  async rates(input: RatesInput): Promise<Result<RatesReport, LoreError>> {
    if (input.kind !== undefined && !(WEIGHT_KINDS as readonly string[]).includes(input.kind)) {
      return err(refuse("kind", `unknown kind "${input.kind}"; one of: ${WEIGHT_KINDS.join(", ")}.`, input.kind));
    }
    let since: string | undefined;
    if (input.since !== undefined) {
      const parsed = Date.parse(input.since);
      if (Number.isNaN(parsed)) return err(refuse("since", `--since must be a date, got "${input.since}".`, input.since));
      since = new Date(parsed).toISOString();
    }
    const rows = await this.deps.store.listRecordedDecisions(since);
    if (!rows.ok) return rows;
    const population: VersionRecord[] = [];
    for (const row of rows.value) {
      if (row.decision == null) continue;
      if (input.kind !== undefined) {
        const kind = await this.kindOf(row);
        if (!kind.ok) return kind;
        if (kind.value !== input.kind) continue;
      }
      population.push(row);
    }
    const slugOf = new Map<string, string>();
    const addressOf = async (row: VersionRecord): Promise<Result<string, LoreError>> => {
      let slug = row.slug ?? slugOf.get(row.doc_id);
      if (slug === undefined) {
        const doc = await this.deps.store.find(row.doc_id);
        if (!doc.ok) return doc;
        if (doc.value === null) return err(refuse("decision", `a version row names a missing document ${row.doc_id}.`));
        slug = doc.value.slug;
        slugOf.set(row.doc_id, slug);
      }
      return ok(`${slug}@${String(row.version)}`);
    };

    // per part: the addresses of decisions that passed that gate / scored that dimension
    const gateHolders = new Map<string, Set<string>>();
    const dimensionHolders = new Map<string, Set<string>>();
    const addresses = new Set<string>();
    for (const row of population) {
      const address = await addressOf(row);
      if (!address.ok) return address;
      addresses.add(address.value);
      const record = row.decision as DecisionRecord;
      for (const gate of record.gates ?? []) {
        if (gate.verdict === "pass") addHolder(gateHolders, gate.id, address.value);
      }
      for (const score of record.scores ?? []) addHolder(dimensionHolders, score.dimension, address.value);
    }

    const reviews = await this.allReviewDocs(since);
    if (!reviews.ok) return reviews;
    const traced: TracedDecision[] = [];
    for (const doc of reviews.value.all) {
      const parsed = milestoneReviewSchema.safeParse(doc.extra["milestone_review"]);
      if (parsed.success) traced.push(...(parsed.data.traced_decisions ?? []));
    }
    const failuresOf = (holders: Set<string>, part: string): number =>
      new Set(traced.filter((t) => t.part === part && holders.has(t.decision)).map((t) => t.decision)).size;
    const rowsOf = (holders: Map<string, Set<string>>): RateRow[] =>
      [...holders.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([part, set]) => {
          const tracedFailures = failuresOf(set, part);
          return {
            part,
            decisions: set.size,
            tracedFailures,
            shareLowerBound: tracedFailures / set.size,
            ...(tracedFailures === 0 ? { ruleOfThreeUpperBound: ruleOfThreeUpperBound(set.size) } : {}),
          };
        });

    const inPlans = await this.addressesInPlans();
    if (!inPlans.ok) return inPlans;
    const inNoPlan = [...addresses].filter((a) => !inPlans.value.has(a)).length;

    const windowTraced = reviews.value.inWindow.reduce((sum, doc) => {
      const parsed = milestoneReviewSchema.safeParse(doc.extra["milestone_review"]);
      return sum + (parsed.success ? (parsed.data.traced_decisions ?? []).length : 0);
    }, 0);
    const archived = await this.deps.store.findMany({ type: "task", status: "archived", ...(since !== undefined ? { since } : {}) });
    if (!archived.ok) return archived;
    return ok({
      kind: input.kind ?? null,
      since: since ?? null,
      decisions: population.length,
      gates: rowsOf(gateHolders),
      dimensions: rowsOf(dimensionHolders),
      decisionsInNoPlan: inNoPlan,
      guards: {
        milestoneReviews: reviews.value.inWindow.length,
        tracedLinks: windowTraced,
        tracedLinksPerReview: reviews.value.inWindow.length === 0 ? null : windowTraced / reviews.value.inWindow.length,
        archivedTasks: archived.value.length,
        decisionsPerArchivedTask: archived.value.length === 0 ? null : population.length / archived.value.length,
      },
    });
  }

  /** Every milestone-review document (all of them, for the traced links) and those created in the window. */
  private async allReviewDocs(since: string | undefined): Promise<Result<{ all: DocRecord[]; inWindow: DocRecord[] }, LoreError>> {
    const docs = await this.deps.store.findMany({ type: "knowledge", sub_type: "milestone-review" });
    if (!docs.ok) return docs;
    return ok({ all: docs.value, inWindow: docs.value.filter((d) => since === undefined || d.created_at >= since) });
  }

  /** Addresses of every decision some plan's selection holds (spec D4), over every live plan. */
  private async addressesInPlans(): Promise<Result<Set<string>, LoreError>> {
    const plans = await this.deps.store.findMany({ type: "plan" });
    if (!plans.ok) return plans;
    const found = new Set<string>();
    for (const plan of plans.value) {
      const bundle = await this.deps.getPlanBundle(plan.id);
      if (!bundle.ok) return bundle;
      const selected = await selectPlanDecisions({ store: this.deps.store }, bundle.value);
      if (!selected.ok) return selected;
      for (const decision of selected.value) found.add(decision.address);
    }
    return ok(found);
  }

  /**
   * The kind the command fixed for this write: a rule revision when the version changed the document's rules, pending
   * rules or rule change set against the version before it, a document revision otherwise.
   */
  private async kindOf(row: VersionRecord): Promise<Result<string, LoreError>> {
    const versions = await this.deps.store.findVersions(row.doc_id, { limit: 1000 });
    if (!versions.ok) return versions;
    const before = versions.value.find((v) => v.version === row.version - 1);
    const ruleFacts = (extra: Record<string, unknown> | undefined): string => {
      const pending = extra?.["pending"];
      const pendingRules = typeof pending === "object" && pending !== null ? (pending as Record<string, unknown>)["rules"] : undefined;
      return JSON.stringify([extra?.["rules"] ?? null, pendingRules ?? null, extra?.["rule_changes"] ?? null]);
    };
    return ok(ruleFacts(before?.extra) !== ruleFacts(row.extra) ? "rule revision" : "document revision");
  }
}
