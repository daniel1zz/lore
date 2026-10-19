/**
 * The PURE half of `lore issues migrate`: read-only legacy row shapes and the per-mirror disposition table
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries, section "Migration", AC-GS-12).
 *
 * Public surface:
 *   - `LegacyDocRow`, `LegacyLinkRow`, `LegacyIssueReport` — Zod-parsed, read-only views of the OLD mirror shape
 *     (`extra.issue_report` on a task, `resolves`/`relates-to`/`informs` links). The write-side enums no longer
 *     name them, so they are parsed here with their own schemas and never reach a write.
 *   - `classifyMirror` — the disposition table, first match wins, as one pure function.
 *   - `planLinkActions` — what each inbound legacy link becomes (stamp a carrier, post a comment, or drop).
 *   - `buildMigrationPlan` — the whole plan over already-read rows; the command prints it (dry run) or runs it.
 *
 * Invariants:
 *   - No IO, no clock (`nowIso` is injected). The apply step recomputes `classifyMirror` per mirror right before
 *     writing, so a plan is never trusted across a GitHub call.
 *   - A verdict outranks a resolver; the remaining rows are tested top to bottom, the first match wins.
 *   - Every inbound legacy link has exactly one action; the link is deleted AFTER its meaning is preserved.
 *
 * Side-effect class: pure.
 */

import { isInvalidated, issueRefSchema, type IssueRef } from "@lore/core";
import { z } from "zod";

import { EXPLICIT_TERMINAL_RESOLUTIONS } from "../../service/issue-resolution.js";
import { closeReasonOf, type VerdictState } from "../../service/issue-verdict.js";
import { resolutionToLabel } from "../../service/resolution-projector.js";

/** Link types whose inbound edges into a mirror this migration rewrites and deletes. */
export const LEGACY_LINK_TYPES = ["resolves", "relates-to", "informs"] as const;

/** The pre-GitHub-owns-state shape of `extra.issue_report`; only the fields the migration reads are named. */
export const LegacyIssueReportSchema = z
  .object({
    github: z
      .object({ repo: z.string().min(1), number: z.number().int().positive(), repo_id: z.number().int().positive().optional() })
      .passthrough()
      .optional(),
    resolution: z
      .object({ state: z.string().optional(), reason: z.string().optional(), adopted_by: z.string().optional() })
      .passthrough()
      .optional(),
    expected: z.string().optional(),
    actual: z.string().optional(),
    repro_command: z.string().optional(),
    severity: z.string().optional(),
    category: z.string().optional(),
  })
  .passthrough();

/** Parsed `extra.issue_report` of a legacy mirror. */
export type LegacyIssueReport = z.infer<typeof LegacyIssueReportSchema>;

/** One `docs` row as the migration reads it (content omitted except for a mirror, which carries its body). */
export const LegacyDocRowSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  type: z.string().min(1),
  status: z.string().min(1),
  title: z.string(),
  content: z.string(),
  parent_id: z.string().nullable(),
  version: z.number().int().positive(),
  deleted_at: z.string().nullable(),
  extra: z.record(z.string(), z.unknown()),
});

/** A parsed `docs` row. */
export type LegacyDocRow = z.infer<typeof LegacyDocRowSchema>;

/** One legacy link row, `link_type` kept as the raw stored string. */
export const LegacyLinkRowSchema = z.object({ from_id: z.string().min(1), to_id: z.string().min(1), link_type: z.string().min(1) });

/** A parsed legacy link row. */
export type LegacyLinkRow = z.infer<typeof LegacyLinkRowSchema>;

/** A mirror: a task whose `extra.issue_report` is an object. */
export interface LegacyMirror {
  readonly row: LegacyDocRow;
  readonly report: LegacyIssueReport;
}

/** What GitHub shows of one issue right now. */
export interface IssueFacts {
  readonly state: "open" | "closed";
  readonly stateReason: string | null;
  readonly labels: readonly string[];
}

/** What one inbound legacy link becomes. */
export type LinkActionKind = "stamp" | "comment" | "drop";

/** One planned link rewrite. */
export interface LinkAction {
  readonly fromId: string;
  readonly fromSlug: string;
  readonly fromType: string;
  readonly toId: string;
  readonly linkType: string;
  readonly kind: LinkActionKind;
  /** Comment body WITHOUT the hidden marker (`kind === "comment"`). */
  readonly commentText?: string;
  /** The hidden marker identifying this link's comment, so a re-run never re-posts it. */
  readonly marker: string;
  /** Why a link was dropped without preserving meaning (`kind === "drop"`). */
  readonly dropReason?: string;
}

/** The disposition of one mirror; the first four are the table rows that keep or write GitHub facts. */
export type MirrorDisposition =
  | "retire:verdict-matches-github"
  | "retire:verdict-written-to-github"
  | "keep-as-carrier"
  | "retire:archived-resolver"
  | "rehome"
  | "retire:adoption-dropped-closed"
  | "retire:adoption-dropped-owner"
  | "retire:adoption-owner-task"
  | "retire:open-unadopted";

/** Result of {@link classifyMirror}. */
export interface MirrorClassification {
  readonly disposition: MirrorDisposition;
  /** The explicit verdict a `retire:verdict-*` disposition carries. */
  readonly verdict?: VerdictState;
  /** The live plan a `rehome` joins, or the live task owner a `retire:adoption-owner-task` stamps. */
  readonly owner?: LegacyDocRow;
  /** Ledger line for a dropped adoption. */
  readonly ledger?: string;
}

/** Everything {@link classifyMirror} needs about one mirror, already looked up. */
export interface ClassifyInput {
  readonly mirror: LegacyMirror;
  readonly facts: IssueFacts;
  /** Archived, non-deleted, non-invalidated task/plan sources of an inbound `resolves` link. */
  readonly archivedResolvers: readonly LegacyDocRow[];
  /** The doc named by `adopted_by`, or `undefined` when it names nothing in the corpus. */
  readonly adoptedBy: LegacyDocRow | undefined;
  readonly nowIso: string;
}

const VERDICTS: readonly string[] = [...EXPLICIT_TERMINAL_RESOLUTIONS];

/** The explicit not-fixed verdict recorded on a mirror, if any. */
export function readVerdict(report: LegacyIssueReport): VerdictState | undefined {
  const state = report.resolution?.state;
  return state !== undefined && VERDICTS.includes(state) ? (state as VerdictState) : undefined;
}

/** Does GitHub already show `verdict` exactly (closed, matching `state_reason`, the verdict label)? */
export function githubShowsVerdict(facts: IssueFacts, verdict: VerdictState): boolean {
  return facts.state === "closed" && facts.stateReason === closeReasonOf(verdict) && facts.labels.includes(resolutionToLabel(verdict));
}

function isLivePlan(doc: LegacyDocRow, nowIso: string): boolean {
  return doc.type === "plan" && doc.deleted_at === null && doc.status !== "archived" && doc.status !== "deprecated" && !isInvalidated({ extra: doc.extra }, nowIso);
}

/**
 * The disposition table of the spec, first match wins; the two explicit-verdict rows are tested first.
 *
 * @param input - one mirror with GitHub's current facts, its archived resolvers and its adoption owner
 * @returns the disposition plus the data the apply step needs for it
 */
export function classifyMirror(input: ClassifyInput): MirrorClassification {
  const { mirror, facts, archivedResolvers, adoptedBy, nowIso } = input;
  const verdict = readVerdict(mirror.report);
  if (verdict !== undefined) {
    return { disposition: githubShowsVerdict(facts, verdict) ? "retire:verdict-matches-github" : "retire:verdict-written-to-github", verdict };
  }
  if (mirror.row.status === "archived") return { disposition: "keep-as-carrier" };
  if (archivedResolvers.length > 0) {
    return { disposition: "retire:archived-resolver", ...(adoptedBy !== undefined ? { ledger: `adoption dropped: fixed by ${archivedResolvers[0]?.slug ?? "an archived resolver"}` } : {}) };
  }
  if (mirror.report.resolution?.state === "adopted") {
    if (adoptedBy !== undefined && isLivePlan(adoptedBy, nowIso)) {
      return facts.state === "open"
        ? { disposition: "rehome", owner: adoptedBy }
        : { disposition: "retire:adoption-dropped-closed", ledger: "adoption dropped: closed on GitHub" };
    }
    if (adoptedBy !== undefined && adoptedBy.type === "task" && adoptedBy.deleted_at === null && adoptedBy.status !== "archived" && adoptedBy.status !== "deprecated") {
      return { disposition: "retire:adoption-owner-task", owner: adoptedBy, ledger: `adoption moved onto live task ${adoptedBy.slug}` };
    }
    return {
      disposition: "retire:adoption-dropped-owner",
      ledger: `adoption dropped: owner ${adoptedBy === undefined ? "missing" : `${adoptedBy.slug} ${adoptedBy.deleted_at !== null ? "deleted" : adoptedBy.status}`}`,
    };
  }
  return { disposition: "retire:open-unadopted" };
}

/**
 * What each inbound legacy link into one mirror becomes: a task/plan `resolves` source is stamped as a carrier;
 * any other source gets a GitHub comment; a source that no longer exists is dropped.
 *
 * @param mirror - the mirror the links point at
 * @param links - every inbound legacy link row into it
 * @param docs - every doc by id
 */
export function planLinkActions(mirror: LegacyDocRow, links: readonly LegacyLinkRow[], docs: ReadonlyMap<string, LegacyDocRow>): LinkAction[] {
  return links.map((link): LinkAction => {
    const source = docs.get(link.from_id);
    const base = { fromId: link.from_id, toId: mirror.id, linkType: link.link_type, marker: `<!-- lore-migrate:${link.from_id}:${link.link_type} -->` };
    if (source === undefined || source.deleted_at !== null) {
      return { ...base, fromSlug: source?.slug ?? link.from_id, fromType: source?.type ?? "unknown", kind: "drop", dropReason: "source document no longer exists" };
    }
    const shape = { ...base, fromSlug: source.slug, fromType: source.type };
    if (link.link_type === "resolves" && (source.type === "task" || source.type === "plan")) return { ...shape, kind: "stamp" };
    const text =
      link.link_type === "resolves"
        ? `Addressed by ${source.type} ${source.slug} (${source.id})`
        : `Referenced by ${source.type} ${source.slug} (${source.id}) as ${link.link_type}`;
    return { ...shape, kind: "comment", commentText: text };
  });
}

const NO_LOOKUPS = { archivedResolvers: [], adoptedBy: undefined } as const;

/** One mirror of the plan. */
export interface PlannedMirror {
  readonly mirror: LegacyMirror;
  /** The mirror's issue, or `null` for a local-only report that must be filed first. */
  readonly ref: IssueRef | null;
  readonly facts: IssueFacts | undefined;
  readonly links: readonly LinkAction[];
  readonly classification: MirrorClassification | undefined;
  /** The lookups {@link classifyMirror} was fed, kept so the apply step can classify again against fresh GitHub facts. */
  readonly lookups: Pick<ClassifyInput, "archivedResolvers" | "adoptedBy">;
  /** Set when the mirror cannot be migrated (foreign repo, issue absent from the listing); it is left untouched. */
  readonly blocked?: string;
}

/** The whole plan. */
export interface MigrationPlan {
  readonly mirrors: readonly PlannedMirror[];
  /** Legacy links left behind by an interrupted run: their mirror is already retired. */
  readonly orphanLinks: readonly (LinkAction & { readonly ref: IssueRef | undefined })[];
}

/** The live listing facts the plan reads. */
export interface PlanListing {
  readonly repo: string;
  readonly repoId: number;
  readonly issues: readonly { readonly number: number; readonly state: string; readonly state_reason?: string | null; readonly labels?: readonly string[] }[];
}

/** Resolves the mirror's issue ref against the configured repository, or says why it cannot. */
export function resolveMirrorRef(report: LegacyIssueReport, listing: PlanListing): { readonly ref: IssueRef | null } | { readonly blocked: string } {
  const github = report.github;
  if (github === undefined) return { ref: null };
  const sameRepo = github.repo.toLowerCase() === listing.repo.toLowerCase() || github.repo_id === listing.repoId;
  if (!sameRepo || (github.repo_id !== undefined && github.repo_id !== listing.repoId)) {
    return { blocked: `issue #${github.number} belongs to ${github.repo}, not the configured repository ${listing.repo}` };
  }
  const parsed = issueRefSchema.safeParse({ repo_id: listing.repoId, number: github.number });
  return parsed.success ? { ref: parsed.data } : { blocked: `issue number ${github.number} is not a valid issue ref` };
}

/** Facts of a listed issue. */
export function factsOfListed(issue: PlanListing["issues"][number]): IssueFacts {
  return { state: issue.state === "closed" ? "closed" : "open", stateReason: issue.state_reason ?? null, labels: issue.labels ?? [] };
}

/** A fresh local-only report is open and unlabelled until GitHub says otherwise. */
export const FRESH_ISSUE_FACTS: IssueFacts = { state: "open", stateReason: null, labels: [] };

/**
 * Builds the plan over already-read rows.
 *
 * @param mirrors - every doc carrying `extra.issue_report` (deleted ones included)
 * @param docs - every doc by id
 * @param links - every legacy-typed link row
 * @param listing - the complete live listing
 * @param nowIso - the read instant
 */
export function buildMigrationPlan(
  mirrors: readonly LegacyMirror[],
  docs: ReadonlyMap<string, LegacyDocRow>,
  links: readonly LegacyLinkRow[],
  listing: PlanListing,
  nowIso: string,
): MigrationPlan {
  const bySlugOrId = (key: string): LegacyDocRow | undefined => docs.get(key) ?? [...docs.values()].find((doc) => doc.slug === key);
  const live = mirrors.filter((mirror) => mirror.row.deleted_at === null);
  const liveIds = new Set(live.map((mirror) => mirror.row.id));
  const planned = live.map((mirror): PlannedMirror => {
    const inbound = links.filter((link) => link.to_id === mirror.row.id && (LEGACY_LINK_TYPES as readonly string[]).includes(link.link_type));
    const actions = planLinkActions(mirror.row, inbound, docs);
    const resolved = resolveMirrorRef(mirror.report, listing);
    if ("blocked" in resolved) return { mirror, ref: null, facts: undefined, links: actions, classification: undefined, lookups: NO_LOOKUPS, blocked: resolved.blocked };
    let facts: IssueFacts | undefined = FRESH_ISSUE_FACTS;
    if (resolved.ref !== null) {
      const issue = listing.issues.find((candidate) => candidate.number === resolved.ref?.number);
      if (issue === undefined) {
        return { mirror, ref: resolved.ref, facts: undefined, links: actions, classification: undefined, lookups: NO_LOOKUPS, blocked: `issue #${resolved.ref.number} is not in the live listing of ${listing.repo}` };
      }
      facts = factsOfListed(issue);
    }
    const archivedResolvers = actions
      .filter((action) => action.kind === "stamp" && docs.get(action.fromId)?.status === "archived" && !isInvalidated({ extra: docs.get(action.fromId)?.extra ?? {} }, nowIso))
      .map((action) => docs.get(action.fromId))
      .filter((doc): doc is LegacyDocRow => doc !== undefined);
    const adoptedKey = mirror.report.resolution?.adopted_by;
    const lookups = { archivedResolvers, adoptedBy: adoptedKey === undefined ? undefined : bySlugOrId(adoptedKey) };
    const classification = classifyMirror({ mirror, facts, nowIso, ...lookups });
    return { mirror, ref: resolved.ref, facts, links: actions, classification, lookups };
  });

  const retired = mirrors.filter((mirror) => mirror.row.deleted_at !== null && !liveIds.has(mirror.row.id));
  const orphanLinks = retired.flatMap((mirror) => {
    const inbound = links.filter((link) => link.to_id === mirror.row.id && (LEGACY_LINK_TYPES as readonly string[]).includes(link.link_type));
    const resolved = resolveMirrorRef(mirror.report, listing);
    const ref = "ref" in resolved && resolved.ref !== null ? resolved.ref : undefined;
    return planLinkActions(mirror.row, inbound, docs).map((action) => ({
      ...action,
      // reason: a stamp needs the retired mirror's ref; without one (a report never filed) the link can only be dropped.
      ...(action.kind === "stamp" && ref === undefined ? { kind: "drop" as const, dropReason: "retired mirror has no GitHub ref" } : {}),
      ref,
    }));
  });
  return { mirrors: planned, orphanLinks };
}
