/**
 * `lore issues migrate [--apply] [--json]` — the ONE-TIME conversion from the old mirror model (a task carrying
 * `extra.issue_report`, plus `resolves`/`relates-to`/`informs` links into it) to the carrier model, where work carries
 * `extra.issues` and GitHub owns every verdict
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries, section "Migration", AC-GS-12, AC-GS-13).
 *
 * Without `--apply` it reads the corpus and GitHub's complete listing, prints the full plan (one line per mirror and per
 * link with its disposition, plus totals) and writes NOTHING to the corpus or GitHub. With `--apply` it executes it.
 *
 * Ordering per mirror (the crash-safety argument, not a style choice):
 *   1. every GitHub write first (link comments, verdict comment/close/label, filing a local-only report);
 *   2. then the corpus: stamp carriers (`extra.issues`, set-based), retire / convert / re-home the mirror, and only
 *      then delete its inbound legacy links.
 *   A GitHub failure therefore leaves the mirror, its links and its version exactly as they were, and the run goes on
 *   with the next mirror. A crash between corpus steps is repaired by the next run: stamping is set-based, and a legacy
 *   link whose mirror is already retired is finished from the retired mirror's own ref (an "orphan link").
 *
 * Every corpus write goes through `CorpusService` (`writeDoc`, `setDocParent`, `link`, `removeLinkOfType`): no store
 * write. The legacy rows are READ with a read-only SQL handle and parsed by their own schemas
 * (`issues-migrate-plan.ts`), because the write-side enums no longer name them.
 *
 * Exit codes: 0 every mirror migrated (or a dry run); the FIRST failure's own kind otherwise (8 auth, 9 transport,
 * 10 rate limit, 5 concurrent edit, 4 a mirror that cannot be migrated); 4 no destination configured; 1 store failure
 * or a post-condition that does not hold. A failed run prints `N of M migrated`.
 *
 * Side-effect class: IO (SQL read, corpus writes via CorpusService, GitHub via `gh`); `--apply` only for the writes.
 */

import type { DocRecord, IssueRef, LoreError, Result } from "@lore/core";
import { buildUnconfiguredUpstreamRemedy, err, issueRefSchema, MAX_ISSUE_REFS_PER_CARRIER, ok, readIssueTriageLabels } from "@lore/core";
import { resolveActorWithSource } from "@lore/core/node";
import { dirname } from "node:path";

import { defineLoreCommand } from "../cli-exit.js";
import { invocationOf } from "../command-invocation.js";
import { loadLoreApp } from "../loader.js";
import { printLine } from "../output.js";
import {
  buildMigrationPlan,
  classifyMirror,
  FRESH_ISSUE_FACTS,
  LegacyDocRowSchema,
  LegacyIssueReportSchema,
  LegacyLinkRowSchema,
  LEGACY_LINK_TYPES,
  type IssueFacts,
  type LegacyDocRow,
  type LegacyLinkRow,
  type LegacyMirror,
  type LinkAction,
  type MigrationPlan,
  type MirrorClassification,
  type PlannedMirror,
} from "../issues-migrate-plan.js";
import { classifyFeedbackUpstream, fileGithubIssue, resolveConsumerCorpusRoot, resolveGithubIssueListing, type GithubUpstreamCfg } from "../report-issue-wiring.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { GhRunner, createNodeGhExecFile } from "../../../service/gh-runner.js";
import { joinIssueStatuses } from "../../../service/github-issue-listing.js";
import { GhIssueCloser } from "../../../service/issue-closer-port.js";
import { GhIssueVerdictWriter, recordIssueVerdict, type IssueVerdictPort } from "../../../service/issue-verdict.js";
import type { GithubIssueRef } from "../../../service/resolution-projector.js";

type LoadedApp = ReturnType<typeof loadLoreApp>["app"];

/** Audit action of a retired mirror: exactly one row per retired mirror. */
export const ISSUE_MIRROR_RETIRED_AUDIT_ACTION = "issue_mirror_retired";

/** Labels the old model wrote that no longer mean anything. */
const RETIRED_RESOLUTION_LABELS: readonly string[] = ["resolution:adopted", "resolution:resolving", "resolution:closed", "resolution:open"];

/** What the migration read from the corpus before planning. */
interface LegacyState {
  readonly docs: ReadonlyMap<string, LegacyDocRow>;
  readonly mirrors: readonly LegacyMirror[];
  readonly links: readonly LegacyLinkRow[];
}

/** One failed mirror or link. */
interface MigrationFailure {
  readonly subject: string;
  readonly error: LoreError;
}

function validationFailure(field: string, message: string, value: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, value };
}

function describe(error: LoreError): string {
  return "message" in error ? error.message : error.code;
}

/**
 * Reads every doc, every doc that carries `extra.issue_report`, and every legacy-typed link, with a read-only SQL
 * handle. reason: the write-side `LinkType` enum dropped `resolves`, so the store API cannot return these rows typed;
 * this is a READ outside the write-route invariant (plan "How T10 reads the old shape after T1").
 */
async function readLegacyState(dbPath: string): Promise<Result<LegacyState, LoreError>> {
  const { Database } = await import("bun:sqlite");
  const db = new Database(dbPath, { readonly: true });
  try {
    const docs = new Map<string, LegacyDocRow>();
    const mirrors: LegacyMirror[] = [];
    for (const raw of db.query("SELECT id, slug, type, status, title, content, parent_id, version, deleted_at, extra FROM docs").all() as Array<Record<string, unknown>>) {
      let extra: unknown;
      try {
        extra = JSON.parse(String(raw["extra"] ?? "{}"));
      } catch {
        return err(validationFailure("docs.extra", `doc ${String(raw["id"])} has an unparseable extra column`, raw["id"]));
      }
      const parsed = LegacyDocRowSchema.safeParse({ ...raw, extra });
      if (!parsed.success) return err(validationFailure("docs", `doc ${String(raw["id"])} does not parse: ${parsed.error.message}`, raw["id"]));
      docs.set(parsed.data.id, parsed.data);
      const report = parsed.data.type === "task" ? parsed.data.extra["issue_report"] : undefined;
      if (report !== undefined && report !== null && typeof report === "object" && !Array.isArray(report)) {
        const parsedReport = LegacyIssueReportSchema.safeParse(report);
        if (!parsedReport.success) return err(validationFailure("extra.issue_report", `mirror ${parsed.data.slug} does not parse: ${parsedReport.error.message}`, parsed.data.slug));
        mirrors.push({ row: parsed.data, report: parsedReport.data });
      }
    }
    const links: LegacyLinkRow[] = [];
    const placeholders = LEGACY_LINK_TYPES.map(() => "?").join(",");
    for (const raw of db.query(`SELECT from_id, to_id, link_type FROM links WHERE link_type IN (${placeholders})`).all(...LEGACY_LINK_TYPES) as Array<Record<string, unknown>>) {
      const parsed = LegacyLinkRowSchema.safeParse(raw);
      if (!parsed.success) return err(validationFailure("links", `a link row does not parse: ${parsed.error.message}`, raw));
      links.push(parsed.data);
    }
    return ok({ docs, mirrors, links });
  } finally {
    db.close();
  }
}

/** The set-based refs a doc's `extra.issues` already holds. */
function readIssueRefs(extra: Record<string, unknown>): IssueRef[] {
  const raw = extra["issues"];
  if (!Array.isArray(raw)) return [];
  const refs: IssueRef[] = [];
  for (const entry of raw) {
    const parsed = issueRefSchema.safeParse(entry);
    if (parsed.success) refs.push(parsed.data);
  }
  return refs;
}

function withRef(refs: readonly IssueRef[], ref: IssueRef): IssueRef[] {
  return refs.some((candidate) => candidate.repo_id === ref.repo_id && candidate.number === ref.number) ? [...refs] : [...refs, ref];
}

/** Everything the apply step shares across mirrors. */
interface ApplyContext {
  readonly app: LoadedApp;
  readonly cfg: GithubUpstreamCfg;
  readonly repoId: number;
  readonly verdictPort: IssueVerdictPort;
  readonly closer: GhIssueCloser;
  readonly docs: ReadonlyMap<string, LegacyDocRow>;
  readonly file: (mirror: LegacyMirror) => Promise<Result<number, LoreError>>;
  readonly nowIso: string;
}

/** The verdict port with the migration's hidden marker appended to the one comment it posts. */
class MarkedVerdictPort implements IssueVerdictPort {
  constructor(
    private readonly inner: IssueVerdictPort,
    private readonly marker: string,
  ) {}
  listCommentBodies(ref: GithubIssueRef): ReturnType<IssueVerdictPort["listCommentBodies"]> {
    return this.inner.listCommentBodies(ref);
  }
  postComment(ref: GithubIssueRef, body: string): ReturnType<IssueVerdictPort["postComment"]> {
    return this.inner.postComment(ref, `${body}\n${this.marker}`);
  }
  closeWithReason(ref: GithubIssueRef, reason: "duplicate" | "not_planned"): ReturnType<IssueVerdictPort["closeWithReason"]> {
    return this.inner.closeWithReason(ref, reason);
  }
  convergeLabel(ref: GithubIssueRef, label: string): ReturnType<IssueVerdictPort["convergeLabel"]> {
    return this.inner.convergeLabel(ref, label);
  }
}

/** Posts each link comment whose marker the issue does not already carry. */
async function postLinkComments(ctx: ApplyContext, ref: GithubIssueRef, actions: readonly LinkAction[]): Promise<Result<void, LoreError>> {
  const comments = actions.filter((action) => action.kind === "comment");
  if (comments.length === 0) return ok(undefined);
  const existing = await ctx.verdictPort.listCommentBodies(ref);
  if (!existing.ok) return existing;
  for (const action of comments) {
    if (existing.value.some((body) => body.includes(action.marker))) continue;
    const posted = await ctx.verdictPort.postComment(ref, `${action.commentText ?? ""}\n\n${action.marker}`);
    if (!posted.ok) return posted;
  }
  return ok(undefined);
}

/** The verdict sequence for a mirror whose verdict GitHub does not show yet; the migration marker rides on its comment. */
async function writeVerdictToGithub(ctx: ApplyContext, mirror: LegacyMirror, ref: GithubIssueRef, facts: IssueFacts, verdict: NonNullable<MirrorClassification["verdict"]>): Promise<Result<void, LoreError>> {
  const resolution = mirror.report.resolution;
  const reason = resolution?.reason?.trim() ? resolution.reason.trim() : `Recorded as ${verdict} in the lore corpus before GitHub became the owner of issue state (no reason text was recorded).`;
  const pointer = ["superseded_by", "duplicate_of"].map((key) => resolution?.[key]).find((value): value is string => typeof value === "string");
  const port = new MarkedVerdictPort(ctx.verdictPort, `<!-- lore-migrate:${mirror.row.id} -->`);
  const report = await recordIssueVerdict(port, { ref, state: facts.state, stateReason: facts.stateReason }, verdict, reason, pointer === undefined ? undefined : `${verdict === "duplicate" ? "Duplicate of" : "Superseded by"} ${pointer}`);
  return report.failure === undefined ? ok(undefined) : err(report.failure);
}

/** Appends `ref` to a task/plan's `extra.issues` through the write route (a no-op when already named). */
async function stampCarrier(ctx: ApplyContext, docId: string, ref: IssueRef, mirrorSlug: string): Promise<Result<void, LoreError>> {
  const fetched = await ctx.app.corpusService.get(docId);
  if (!fetched.ok) return fetched;
  const doc = fetched.value.doc;
  const refs = readIssueRefs(doc.extra);
  if (refs.some((candidate) => candidate.repo_id === ref.repo_id && candidate.number === ref.number)) return ok(undefined);
  if (refs.length >= MAX_ISSUE_REFS_PER_CARRIER) {
    return err(validationFailure("extra.issues", `${doc.slug} already names ${refs.length} issues; it cannot carry #${ref.number} too (limit ${MAX_ISSUE_REFS_PER_CARRIER})`, doc.slug));
  }
  const written = await ctx.app.corpusService.writeDoc({
    doc,
    patch: { extra: { ...doc.extra, issues: withRef(refs, ref) } },
    action: "update",
    changeSummary: `lore issues migrate: carry issue #${ref.number} (was mirror ${mirrorSlug})`,
    auditAction: "update",
    auditDetails: { migration: "issue_mirror_stamp", issue: ref, mirror: mirrorSlug },
    // reason: an extra-only change of a carrier leaves body/title/criteria untouched, so the record lock does not apply.
    lock: "none",
  });
  return written.ok ? ok(undefined) : written;
}

/** Reads the mirror fresh and refuses when it moved since the plan was read (the expectedVersion guard). */
async function readMirrorFresh(ctx: ApplyContext, mirror: LegacyMirror): Promise<Result<DocRecord, LoreError>> {
  const fetched = await ctx.app.corpusService.get(mirror.row.id);
  if (!fetched.ok) return fetched;
  const doc = fetched.value.doc;
  if (doc.version !== mirror.row.version) return err({ code: "STALE_VERSION", id: doc.id, expected: mirror.row.version, actual: doc.version });
  return ok(doc);
}

function extraWithoutReport(extra: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...extra };
  delete rest["issue_report"];
  return rest;
}

/** Keep-as-carrier / re-home: the mirror stays, without `issue_report`, carrying its issue. */
async function convertMirror(ctx: ApplyContext, mirror: LegacyMirror, ref: IssueRef, classification: MirrorClassification): Promise<Result<void, LoreError>> {
  let doc = await readMirrorFresh(ctx, mirror);
  if (!doc.ok) return doc;
  const extra: Record<string, unknown> = extraWithoutReport(doc.value.extra);
  extra["issues"] = withRef(readIssueRefs(doc.value.extra), ref);
  if (classification.disposition === "rehome" && classification.owner !== undefined) {
    const plan = classification.owner;
    if (doc.value.parent_id !== plan.id) {
      const cleared = await ctx.app.corpusService.setDocParent({ docId: doc.value.id, parentId: null, auditAction: "issue_mirror_rehome_parent", auditSessionId: doc.value.id, auditDetails: { to_plan: plan.slug } });
      if (!cleared.ok) return cleared;
      const linked = await ctx.app.corpusService.link(doc.value.id, plan.id, "parent");
      if (!linked.ok) return linked;
      doc = await readMirrorFresh(ctx, mirror);
      if (!doc.ok) return doc;
    }
    delete extra["adhoc"];
    extra["plan_id"] = plan.id;
  }
  const written = await ctx.app.corpusService.writeDoc({
    doc: doc.value,
    patch: { extra },
    action: "update",
    changeSummary: `lore issues migrate: ${classification.disposition} issue #${ref.number}`,
    auditAction: "update",
    auditDetails: { migration: "issue_mirror_converted", issue: ref, disposition: classification.disposition },
    lock: "none",
  });
  return written.ok ? ok(undefined) : written;
}

/** Retires a mirror: a soft delete plus its ONE `issue_mirror_retired` audit row. */
async function retireMirror(ctx: ApplyContext, mirror: LegacyMirror, ref: IssueRef, classification: MirrorClassification, links: readonly LinkAction[]): Promise<Result<void, LoreError>> {
  const doc = await readMirrorFresh(ctx, mirror);
  if (!doc.ok) return doc;
  const written = await ctx.app.corpusService.writeDoc({
    doc: doc.value,
    patch: { deleted_at: ctx.nowIso },
    action: "delete",
    changeSummary: `lore issues migrate: retire mirror of issue #${ref.number}`,
    auditAction: ISSUE_MIRROR_RETIRED_AUDIT_ACTION,
    auditDetails: {
      issue: ref,
      prior_resolution: mirror.report.resolution?.state ?? null,
      prior_status: mirror.row.status,
      disposition: classification.disposition,
      ...(classification.ledger !== undefined ? { ledger: classification.ledger } : {}),
      links_rewritten: links.map((link) => ({ from: link.fromSlug, type: link.linkType, action: link.kind })),
    },
    now: ctx.nowIso,
    lock: "none",
  });
  return written.ok ? ok(undefined) : written;
}

async function deleteLinks(ctx: ApplyContext, links: readonly LinkAction[]): Promise<Result<void, LoreError>> {
  for (const link of links) {
    const removed = await ctx.app.corpusService.removeLinkOfType({ fromId: link.fromId, toId: link.toId, linkType: link.linkType });
    if (!removed.ok) return removed;
  }
  return ok(undefined);
}

/** Migrates ONE mirror: GitHub writes, then the corpus writes (see the module header for the order). */
async function migrateMirror(ctx: ApplyContext, planned: PlannedMirror): Promise<Result<MirrorClassification, LoreError>> {
  if (planned.blocked !== undefined) return err(validationFailure("extra.issue_report.github", `${planned.mirror.row.slug}: ${planned.blocked}`, planned.mirror.row.slug));
  let ref = planned.ref;
  let facts = planned.facts ?? FRESH_ISSUE_FACTS;
  if (ref === null) {
    const number = await ctx.file(planned.mirror);
    if (!number.ok) return number;
    ref = { repo_id: ctx.repoId, number: number.value };
    const ghRef: GithubIssueRef = { repo: ctx.cfg.repo, issueNumber: number.value, repo_id: ctx.repoId };
    const snapshot = await ctx.closer.readIssue(ghRef);
    if (!snapshot.ok) return snapshot;
    facts = { state: snapshot.value.state, stateReason: snapshot.value.stateReason ?? null, labels: snapshot.value.labels };
  }
  const classification = classifyMirror({ mirror: planned.mirror, facts, nowIso: ctx.nowIso, ...planned.lookups });
  const ghRef: GithubIssueRef = { repo: ctx.cfg.repo, issueNumber: ref.number, repo_id: ref.repo_id };

  const commented = await postLinkComments(ctx, ghRef, planned.links);
  if (!commented.ok) return commented;
  if (classification.disposition === "retire:verdict-written-to-github" && classification.verdict !== undefined) {
    const written = await writeVerdictToGithub(ctx, planned.mirror, ghRef, facts, classification.verdict);
    if (!written.ok) return written;
  }

  // Corpus half: stamp, then the mirror, then the links (an interrupted run is finished by the orphan-link pass).
  const stampTargets = new Set(planned.links.filter((link) => link.kind === "stamp").map((link) => link.fromId));
  if (classification.disposition === "retire:adoption-owner-task" && classification.owner !== undefined) stampTargets.add(classification.owner.id);
  for (const docId of stampTargets) {
    const stamped = await stampCarrier(ctx, docId, ref, planned.mirror.row.slug);
    if (!stamped.ok) return stamped;
  }
  const mirrorWritten =
    classification.disposition === "keep-as-carrier" || classification.disposition === "rehome"
      ? await convertMirror(ctx, planned.mirror, ref, classification)
      : await retireMirror(ctx, planned.mirror, ref, classification, planned.links);
  if (!mirrorWritten.ok) return mirrorWritten;
  const unlinked = await deleteLinks(ctx, planned.links);
  if (!unlinked.ok) return unlinked;
  return ok(classification);
}

/** Finishes a legacy link whose mirror an interrupted run already retired. */
async function finishOrphanLink(ctx: ApplyContext, link: MigrationPlan["orphanLinks"][number]): Promise<Result<void, LoreError>> {
  if (link.kind === "stamp" && link.ref !== undefined) {
    const stamped = await stampCarrier(ctx, link.fromId, link.ref, link.toId);
    if (!stamped.ok) return stamped;
  } else if (link.kind === "comment" && link.ref !== undefined) {
    const posted = await postLinkComments(ctx, { repo: ctx.cfg.repo, issueNumber: link.ref.number, repo_id: link.ref.repo_id }, [link]);
    if (!posted.ok) return posted;
  }
  return deleteLinks(ctx, [link]);
}

/** Loads every task and plan that names an issue, archived ones included. */
async function readCarriers(app: LoadedApp): Promise<Result<DocRecord[], LoreError>> {
  const carriers: DocRecord[] = [];
  for (const type of ["task", "plan"] as const) {
    const listed = await app.corpusService.listFull({ type });
    if (!listed.ok) return listed;
    carriers.push(...listed.value.docs.filter((doc) => Array.isArray(doc.extra["issues"])));
  }
  return ok(carriers);
}

/**
 * The final pass: close every open issue that has an archived carrier (D3), strip stray labels, then remove the retired
 * labels and any `resolution:fixed` an issue is not entitled to. Returns the failures; never aborts on one.
 */
async function runFinalPasses(inv: ReturnType<typeof invocationOf>, ctx: ApplyContext): Promise<MigrationFailure[]> {
  const failures: MigrationFailure[] = [];
  const first = await resolveGithubIssueListing(inv.io, ctx.cfg, inv);
  if (!first.ok) return [{ subject: "final pass (listing)", error: first.error }];
  const issueClose = ctx.app.issueClose;
  if (issueClose === undefined) return [{ subject: "final pass", error: validationFailure("feedback.upstream", "no GitHub closer is wired", ctx.cfg.repo) }];
  const synced = await issueClose.applySync({ issues: first.value.issues, repoId: first.value.repoId });
  if (synced.kind === "store_error") failures.push({ subject: "final pass (close)", error: synced.error });
  if (synced.kind === "not_configured") failures.push({ subject: "final pass (close)", error: validationFailure("feedback.upstream", synced.message, ctx.cfg.repo) });
  if (synced.kind === "planned") {
    for (const applied of synced.applied ?? []) {
      for (const line of applied.lines) printLine(inv.io.stdout, `  ${line}`); // CLI surface
      if (applied.failure !== undefined) failures.push({ subject: `issue #${applied.number}`, error: applied.failure });
    }
  }

  const second = await resolveGithubIssueListing(inv.io, ctx.cfg, inv);
  if (!second.ok) return [...failures, { subject: "final pass (label listing)", error: second.error }];
  const carriers = await readCarriers(ctx.app);
  if (!carriers.ok) return [...failures, { subject: "final pass (carriers)", error: carriers.error }];
  const rows = joinIssueStatuses(second.value.issues, carriers.value, second.value.repoId, new Date().toISOString());
  for (const row of rows) {
    const labels = row.issue.labels ?? [];
    const doomed = [...labels.filter((label) => RETIRED_RESOLUTION_LABELS.includes(label)), ...(labels.includes("resolution:fixed") && row.status !== "fixed" ? ["resolution:fixed"] : [])];
    if (doomed.length === 0) continue;
    const removed = await ctx.closer.removeLabels(
      { repo: ctx.cfg.repo, issueNumber: row.issue.number, repo_id: second.value.repoId },
      doomed,
    );
    printLine(inv.io.stdout, `  issue #${row.issue.number}: removed retired label(s) ${doomed.join(", ")}${removed.ok ? "" : " — FAILED"}`); // CLI surface
    if (!removed.ok) failures.push({ subject: `issue #${row.issue.number}`, error: removed.error });
  }
  return failures;
}

/** Counts what must be zero after a complete run. */
async function findPostConditionViolations(dbPath: string): Promise<Result<string[], LoreError>> {
  const state = await readLegacyState(dbPath);
  if (!state.ok) return state;
  const problems: string[] = [];
  const live = state.value.mirrors.filter((mirror) => mirror.row.deleted_at === null);
  if (live.length > 0) problems.push(`${live.length} live doc(s) still carry extra.issue_report (${live.map((mirror) => mirror.row.slug).join(", ")})`);
  const resolves = state.value.links.filter((link) => link.link_type === "resolves");
  if (resolves.length > 0) problems.push(`${resolves.length} resolves link(s) remain`);
  return ok(problems);
}

function renderPlanLines(plan: MigrationPlan): string[] {
  const lines: string[] = [];
  for (const planned of plan.mirrors) {
    const where = planned.ref === null ? "local-only (filed to GitHub first)" : `#${planned.ref.number}`;
    lines.push(
      planned.blocked !== undefined
        ? `mirror ${planned.mirror.row.slug} ${where} -> BLOCKED: ${planned.blocked}`
        : `mirror ${planned.mirror.row.slug} ${where} -> ${planned.classification?.disposition ?? "unclassified"}${planned.classification?.ledger !== undefined ? ` (${planned.classification.ledger})` : ""}`,
    );
    for (const link of planned.links) lines.push(`  link ${link.linkType} ${link.fromType} ${link.fromSlug} -> ${link.kind}${link.dropReason !== undefined ? ` (${link.dropReason})` : ""}`);
  }
  for (const link of plan.orphanLinks) lines.push(`orphan link ${link.linkType} ${link.fromType} ${link.fromSlug} (mirror already retired) -> ${link.kind}`);
  return lines;
}

function planToJson(plan: MigrationPlan): Record<string, unknown> {
  const mirrorLinks = plan.mirrors.reduce((sum, planned) => sum + planned.links.length, 0);
  return {
    mirrors: plan.mirrors.map((planned) => ({
      id: planned.mirror.row.id,
      slug: planned.mirror.row.slug,
      status: planned.mirror.row.status,
      issue: planned.ref,
      local_only: planned.ref === null && planned.blocked === undefined,
      disposition: planned.blocked !== undefined ? "blocked" : planned.classification?.disposition,
      ...(planned.blocked !== undefined ? { blocked: planned.blocked } : {}),
      ...(planned.classification?.ledger !== undefined ? { ledger: planned.classification.ledger } : {}),
      links: planned.links.map((link) => ({ type: link.linkType, from: link.fromSlug, from_type: link.fromType, action: link.kind })),
    })),
    orphan_links: plan.orphanLinks.map((link) => ({ type: link.linkType, from: link.fromSlug, from_type: link.fromType, action: link.kind })),
    totals: { mirrors: plan.mirrors.length, links: mirrorLinks, orphan_links: plan.orphanLinks.length },
  };
}

async function runMigrate(args: { apply: boolean; json: boolean }, inv: ReturnType<typeof invocationOf>): Promise<number> {
  const { app, dbPath, config } = loadLoreApp({ inv });
  try {
    const classification = classifyFeedbackUpstream(config);
    if (classification.kind !== "github") {
      const refusal: LoreError = classification.kind === "retired" ? classification.error : buildUnconfiguredUpstreamRemedy();
      inv.io.stderr.write(formatErrorFor(inv, refusal) + "\n");
      return exitCode(refusal);
    }
    const cfg = classification.cfg;
    const corpusPath = dirname(dirname(dbPath));

    // reason: the listing is read FIRST — an offline run exits with its own kind before any corpus or GitHub write.
    const listing = await resolveGithubIssueListing(inv.io, cfg, inv);
    if (!listing.ok) {
      inv.io.stderr.write(formatErrorFor(inv, listing.error) + "\n");
      return exitCode(listing.error);
    }
    const state = await readLegacyState(dbPath);
    if (!state.ok) {
      inv.io.stderr.write(formatErrorFor(inv, state.error) + "\n");
      return exitCode(state.error);
    }
    const nowIso = new Date().toISOString();
    const plan = buildMigrationPlan(state.value.mirrors, state.value.docs, state.value.links, { repo: cfg.repo, repoId: listing.value.repoId, issues: listing.value.issues }, nowIso);

    if (!args.apply) {
      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { apply: false, corpus_path: corpusPath, repo: cfg.repo, ...planToJson(plan) } }, null, 2)); // CLI surface
      } else {
        printLine(inv.io.stdout, `Corpus: ${corpusPath}`); // CLI surface
        printLine(inv.io.stdout, `Repository: ${cfg.repo}`); // CLI surface
        for (const line of renderPlanLines(plan)) printLine(inv.io.stdout, line); // CLI surface
        printLine(inv.io.stdout, `Plan: ${plan.mirrors.length} mirror(s), ${plan.orphanLinks.length} orphan link(s). Dry run: nothing was written. Re-run with --apply.`); // CLI surface
      }
      return 0;
    }

    const runner = new GhRunner({ execFile: createNodeGhExecFile(inv.cwd), env: inv.env });
    const { actor, source: actorSource } = resolveActorWithSource(undefined, inv.env, inv.user);
    const ctx: ApplyContext = {
      app,
      cfg,
      repoId: listing.value.repoId,
      verdictPort: new GhIssueVerdictWriter(runner),
      closer: new GhIssueCloser(runner),
      docs: state.value.docs,
      nowIso,
      file: async (mirror) => {
        const labels = readIssueTriageLabels(mirror.row.extra);
        const filed = await fileGithubIssue(
          {
            title: mirror.row.title,
            description: mirror.row.content,
            expected: mirror.report.expected ?? "(not recorded in the corpus mirror)",
            actual: mirror.report.actual ?? "(not recorded in the corpus mirror)",
            ...(mirror.report.repro_command !== undefined ? { repro_command: mirror.report.repro_command } : {}),
            // reason: the body contract requires both labels; a mirror that never declared them gets the lowest
            // severity and a category naming the migration, never an invented judgment.
            severity: labels.severity ?? "low",
            category: labels.category ?? "migrated-from-local-corpus",
            tags: [],
          },
          cfg,
          { consumerCorpusRoot: resolveConsumerCorpusRoot(inv.io, inv), corpusService: app.corpusService, actor, actorSource, home: inv.paths.home, env: inv.env },
        );
        return filed.ok ? ok(filed.value.number) : filed;
      },
    };

    const failures: MigrationFailure[] = [];
    let migrated = 0;
    const outcomes: Array<{ slug: string; disposition: string }> = [];
    for (const planned of plan.mirrors) {
      const done = await migrateMirror(ctx, planned);
      if (done.ok) {
        migrated += 1;
        outcomes.push({ slug: planned.mirror.row.slug, disposition: done.value.disposition });
        if (!args.json) printLine(inv.io.stdout, `migrated ${planned.mirror.row.slug} -> ${done.value.disposition}`); // CLI surface
      } else {
        failures.push({ subject: planned.mirror.row.slug, error: done.error });
        if (!args.json) printLine(inv.io.stdout, `FAILED ${planned.mirror.row.slug}: ${describe(done.error)}`); // CLI surface
      }
    }
    for (const link of plan.orphanLinks) {
      const done = await finishOrphanLink(ctx, link);
      if (!done.ok) failures.push({ subject: `orphan link from ${link.fromSlug}`, error: done.error });
    }
    failures.push(...(await runFinalPasses(inv, ctx)));

    if (failures.length === 0) {
      const violations = await findPostConditionViolations(dbPath);
      if (!violations.ok) failures.push({ subject: "post-conditions", error: violations.error });
      else if (violations.value.length > 0) failures.push({ subject: "post-conditions", error: { code: "STORE_ERROR", message: violations.value.join("; ") } });
    }

    const summary = `${migrated} of ${plan.mirrors.length} migrated`;
    if (args.json) {
      printLine(inv.io.stdout, JSON.stringify({ ok: failures.length === 0, data: { apply: true, migrated, total: plan.mirrors.length, outcomes, failures: failures.map((f) => ({ subject: f.subject, error: describe(f.error) })) } }, null, 2)); // CLI surface
    } else {
      printLine(inv.io.stdout, summary); // CLI surface
    }
    const first = failures[0];
    if (first === undefined) return 0;
    for (const failure of failures) inv.io.stderr.write(`${failure.subject}: ${formatErrorFor(inv, failure.error)}\n`);
    return exitCode(first.error);
  } finally {
    app.close();
  }
}

export default defineLoreCommand({
  meta: {
    name: "migrate",
    description:
      "One-time migration from issue-report mirror tasks and resolves links to carriers (extra.issues) with GitHub owning verdicts; dry run by default, --apply executes",
  },
  args: {
    apply: { type: "boolean", description: "Execute the plan (writes GitHub and the corpus); resumable and idempotent" },
    json: { type: "boolean", description: "Output as JSON" },
  },
  async run(context): Promise<number> {
    return runMigrate({ apply: context.args.apply === true, json: context.args.json === true }, invocationOf(context));
  },
});
