/**
 * Narrow second composition root for an UPSTREAM lore corpus (SPEC-072
 * `lore report-issue`). This is the ONLY place `lore report-issue`'s CLI/MCP
 * wiring reaches into a corpus that is NOT the caller's own — every other
 * flow/service in this codebase composes against the local corpus via
 * `app.ts`. Mirrors the `flows/` "thin composition, not business logic"
 * convention (`setup-project-flow.ts` precedent) rather than living in
 * `service/`, since `service/` files never construct stores themselves.
 *
 * Public surface:
 *   - `UpstreamPort` — the transport seam `IssueReportService` is injected
 *     with (SPEC-072 §4; a future P2 `HttpUpstreamPort` implements the same
 *     interface with zero orchestration rewrite). Gained a 5th op,
 *     `getResolution` (spec-issue-closure-loop-computed-resolution-agent-reachable
 *     D6/D7, AC-ICL-7), on top of the original 4 — see that method's own
 *     JSDoc for why a per-doc computed-resolution lookup could not be
 *     derived from the original 4 ops. `getResolution` REPLACES the earlier
 *     T5 `getDocStatus` (SPEC-072 AC-072-10) — D6 needs "has the DEFECT
 *     itself been triaged terminal" (`lore issue resolve`) or fixed (a
 *     `resolves` edge to a terminal doc), which `getResolution` answers
 *     directly, folding the raw doc status in as a demoted debugging field
 *     rather than the primary signal. `getDocStatus`'s audit-log
 *     reject-reason lookback ("was this draft ever bounced by the REVIEW
 *     workflow") was DROPPED by that replacement, then RESTORED by P2
 *     (spec-issue-closure-loop-computed-resolution-agent-reachable D2,
 *     AC-ICL-11) once the drop proved to be a real regression: a
 *     review-rejected report is indistinguishable from an untouched one by
 *     `doc.status` alone (SPEC-005), so `getResolution` needs that same
 *     lookback to feed `computeIssueResolution`'s `hasRecordedReviewRejection`
 *     parameter — see `getResolution`'s own JSDoc.
 *   - `buildUpstreamContext(corpusRoot)` — resolves `corpusRoot/.lore/lore.db`,
 *     re-asserts its schema version against `LATEST_SCHEMA_VERSION` via a
 *     readonly probe BEFORE constructing a real (migrating) `SQLiteStore`,
 *     then composes `SQLiteStore` + `CorpusService` ONLY.
 *
 * Invariants:
 *   - Deliberately NARROW composition — `SQLiteStore` + `CorpusService`
 *     only. NO `Telemetry`, NO AI-provider registry, NO `GateEnforcer`.
 *     `CorpusService._createImpl`'s gate branch only ever fires for
 *     `type === "spec"` (`corpus-service.ts:749`) — a task-type `create()`
 *     (what `createDraft` below performs) never consults ANY of the five
 *     registered checkpoints, so wiring a `GateEnforcer` here would be dead
 *     coupling implying false assurance (SPEC-072 §7 Design Decisions).
 *   - TOCTOU guard: `probeUpstreamDb` is called HERE (not just by an earlier
 *     caller) immediately before `new SQLiteStore(dbPath)` — `SQLiteStore`'s
 *     constructor unconditionally runs `runMigrations()`, so a version
 *     mismatch discovered ONE call earlier could still be raced by another
 *     process bumping the schema in between; re-checking right before the
 *     migrating construction closes that window. The cost is one extra
 *     cheap `PRAGMA` read.
 *   - A version mismatch or missing db file returns BEFORE any `SQLiteStore`
 *     is constructed — zero migration side effect is ever observable on a
 *     rejected upstream corpus.
 *
 * Side-effect class: IO (opens a real SQLite connection to the upstream
 * corpus on success; the probe-only rejection paths are read-only).
 *
 * Source: SPEC-072 §3 Structure, §4 Public Interface
 * (`flows/upstream-context-flow.ts`), §6 Dependency Graph, §7 Design
 * Decisions ("Composition home", "GateEnforcer in upstream context",
 * "Schema precheck", "Version SSOT").
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "@lore/core";
import type { DocStatus, LoreError } from "@lore/core";
import { probeUpstreamDb } from "./upstream-probe.js";
import { SQLiteStore, LATEST_SCHEMA_VERSION } from "../store/sqlite-store.js";
import { CorpusService } from "../service/corpus-service.js";
import { computeIssueResolution, type IssueResolution } from "../service/issue-resolution.js";

/**
 * The transport seam `IssueReportService` orchestrates through — never the
 * full `CorpusService`/`StoreInterface` surface (leak-proof against a
 * future P2 `HttpUpstreamPort` needing to implement anything beyond these 4
 * ops). Every method returns `Promise<Result<T, LoreError>>`, same
 * convention as every other service in this codebase.
 */
export interface UpstreamPort {
  /**
   * @returns the upstream corpus's root PRD (`{id, slug}`), or `null` when
   *   the upstream corpus has no PRD document at all (empty/malformed
   *   corpus — a fact, not an error)
   */
  resolveRootDoc(): Promise<Result<{ id: string; slug: string } | null, LoreError>>;
  /**
   * @returns every OPEN (status=`draft`) ad-hoc (`extra.adhoc === true`)
   *   task in the upstream corpus — the candidate set `countOpenReports`
   *   (`@lore/core`) filters down to one reporter project's own reports
   */
  listOpenAdhocDrafts(): Promise<
    Result<Array<{ id: string; status: string; extra?: unknown }>, LoreError>
  >;
  /**
   * Advisory FTS duplicate search — a search failure is the CALLER's concern
   * (surfaced as `dedup_degraded: true`, never blocks filing); this method
   * itself still returns `err(...)` on failure rather than silently
   * swallowing it, so the caller can distinguish "zero hits" from "search
   * broke".
   * @param query - free-text search query (title/description of the new report)
   * @param limit - maximum number of duplicate doc ids to return
   * @returns up to `limit` upstream doc ids ranked by search relevance
   */
  searchDuplicates(query: string, limit: number): Promise<Result<string[], LoreError>>;
  /**
   * Creates the upstream ad-hoc draft task. ANY failure (validation, store,
   * or otherwise) is returned VERBATIM (SPEC-072 R-5e failure-transparency)
   * — the caller must never paper over an upstream rejection.
   * @param input - `title`/`content` plus the fully-assembled `extra`
   *   (`buildIssueReportExtra`'s output, `@lore/core`) — this method does
   *   NOT itself inject `adhoc: true`; the caller's `extra` is passed
   *   through untouched, so it alone owns that contract.
   * @returns the newly created upstream doc's `id`
   */
  createDraft(input: {
    title: string;
    content: string;
    extra: Record<string, unknown>;
  }): Promise<Result<{ id: string }, LoreError>>;
  /**
   * Computed resolution (D2 `computeIssueResolution`, consumed verbatim from
   * `service/issue-resolution.ts` — never reimplemented here) for ONE
   * upstream issue-task doc by id, plus its raw lifecycle status (D6: demoted
   * to a debugging detail, no longer the primary signal) and, when a
   * rejection reason is on record, that reason echoed back.
   *
   * Added AFTER the original 4 ops proved insufficient: none of
   * `resolveRootDoc`/`listOpenAdhocDrafts`/`searchDuplicates`/`createDraft`
   * can answer "has this defect actually been fixed or triaged terminal" —
   * that needs a join this port didn't expose: every `resolves` in-edge
   * targeting the issue doc, plus each edge's source doc's lifecycle status.
   * Reuses `CorpusService.getResolvesInEdgesForIssues` (D7's ONE cross-doc
   * read-orchestration locus for exactly this join — batched, never N+1;
   * same method the local-corpus surfaces `lore issues`/HTTP issue-reports
   * projection call) rather than re-deriving the join here.
   *
   * P2 (AC-ICL-11) RESTORED the old T5 audit-log "most recent reject"
   * lookback that D6 had dropped: `ReviewService.reject` never transitions a
   * doc OFF `draft` (SPEC-005), so a review-rejected report is
   * indistinguishable from an untouched one by `status` alone — the audit
   * trail is the ONLY record. `computeIssueResolution`'s new
   * `hasRecordedReviewRejection` parameter needs exactly this boolean, which
   * only this store-backed caller can supply (the pure service module cannot
   * query the audit table itself). ONE unified reason reader
   * (`readResolutionReason` below, extended) surfaces the reason regardless
   * of whether it came from an explicit D3 write or this audit-log fallback
   * — there is no second `*_reason` field on the return type.
   *
   * @param id - the upstream draft task's doc id (a `ReceiptEntry.upstream_doc_id`)
   * @returns `ok(null)` when no doc with this id exists upstream anymore
   *   (deleted, or never existed) — a fact, not an error, and the caller's
   *   documented "unreachable"-equivalent row case; `ok({status, resolution,
   *   rejection_reason?})` otherwise. `rejection_reason` is populated ONLY
   *   when the computed `resolution` is itself `rejected`/`wontfix` — a
   *   stale audit-log reason from BEFORE a later fix landed (resolution now
   *   `fixed`/`resolving`) is never echoed, so no row ever shows a rejection
   *   reason next to a resolution that isn't actually a rejection.
   */
  getResolution(
    id: string,
  ): Promise<
    Result<{ status: DocStatus; resolution: IssueResolution; rejection_reason?: string } | null, LoreError>
  >;
  /** Closes the underlying SQLite connection. Idempotent-unsafe (do not call twice). */
  close(): void;
}

/**
 * Defensive `extra.issue_report.resolution.reason` reader — mirrors the
 * duplicated-defensive-extra-reader pattern already established by
 * `adapters/cli/commands/issues.ts::readIssueReportString` and
 * `adapters/http/issue-reports-routes.ts::projectIssueReportRow` (same
 * module-boundary reasoning: a malformed/legacy `extra` degrades to
 * "no reason", never throws; duplicated rather than imported since each
 * call site reads a different key). `lore issue resolve` is the sole writer
 * of this field (`adapters/cli/commands/issue.ts`, D3). `getResolution`
 * (below) is this reader's ONLY caller — it merges this D3-explicit source
 * with the D2 audit-log reject-reason fallback into the SAME single
 * `rejection_reason` output field, preferring this one when both exist.
 *
 * @param extra - the issue task's raw `extra` field
 * @returns the recorded reason string when `extra.issue_report.resolution.reason`
 *   is present and well-shaped; `undefined` otherwise (absent, malformed, or
 *   no explicit terminal state was ever recorded)
 */
function readResolutionReason(extra: unknown): string | undefined {
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return undefined;
  const issueReport = (extra as Record<string, unknown>)["issue_report"];
  if (issueReport === null || typeof issueReport !== "object" || Array.isArray(issueReport)) return undefined;
  const resolution = (issueReport as Record<string, unknown>)["resolution"];
  if (resolution === null || typeof resolution !== "object" || Array.isArray(resolution)) return undefined;
  const reason = (resolution as Record<string, unknown>)["reason"];
  return typeof reason === "string" ? reason : undefined;
}

/**
 * Resolves `corpusRoot/.lore/lore.db`, re-asserts its schema version against
 * `LATEST_SCHEMA_VERSION` via a readonly probe, and — only on a match —
 * composes a narrow `UpstreamPort` over `SQLiteStore` + `CorpusService`.
 *
 * @param corpusRoot - the upstream repo ROOT (the shape `lore init`
 *   produces — i.e. the directory containing `.lore/`, NOT `.lore/` itself)
 * @returns `ok(UpstreamPort)` on a schema-version match; `err({code:
 *   "VALIDATION_ERROR", ...})` naming the resolved path (missing db) or both
 *   versions (mismatch) — no `SQLiteStore` is ever constructed on either
 *   rejection path
 * @example
 *   const ctx = buildUpstreamContext("/path/to/upstream/repo");
 *   if (ctx.ok) {
 *     const root = await ctx.value.resolveRootDoc();
 *     ctx.value.close();
 *   }
 */
export function buildUpstreamContext(corpusRoot: string): Result<UpstreamPort, LoreError> {
  const dbPath = join(corpusRoot, ".lore", "lore.db");

  if (!existsSync(dbPath)) {
    return err({
      code: "VALIDATION_ERROR",
      field: "feedback.upstream.corpus_path",
      message: `upstream corpus database not found at '${dbPath}' — is this a lore-init'd corpus root?`,
      value: corpusRoot,
    });
  }

  const probeResult = probeUpstreamDb(dbPath);
  if (!probeResult.ok) return probeResult;

  if (probeResult.value.user_version !== LATEST_SCHEMA_VERSION) {
    return err({
      code: "VALIDATION_ERROR",
      field: "feedback.upstream.corpus_path",
      message:
        `upstream corpus schema version mismatch at '${dbPath}': ` +
        `this lore install expects user_version ${LATEST_SCHEMA_VERSION}, found ${probeResult.value.user_version}`,
      value: { expected: LATEST_SCHEMA_VERSION, found: probeResult.value.user_version },
    });
  }

  // reason: narrow composition — SQLiteStore + CorpusService ONLY, no
  // Telemetry/AI-registry/GateEnforcer. See module header "Invariants".
  const store = new SQLiteStore(dbPath);
  const corpusService = new CorpusService(store);

  const port: UpstreamPort = {
    async resolveRootDoc() {
      const result = await store.findMany({ type: "prd" });
      if (!result.ok) return result;
      const rootPrd = result.value[0];
      return ok(rootPrd ? { id: rootPrd.id, slug: rootPrd.slug } : null);
    },

    async listOpenAdhocDrafts() {
      const result = await store.findMany({ type: "task", status: "draft" });
      if (!result.ok) return result;
      const drafts = result.value.filter((task) => task.extra?.["adhoc"] === true);
      return ok(drafts.map((task) => ({ id: task.id, status: task.status, extra: task.extra })));
    },

    async searchDuplicates(query, limit) {
      const result = await corpusService.search(query);
      if (!result.ok) return result;
      return ok(result.value.results.slice(0, limit).map((hit) => hit.id));
    },

    async createDraft(input) {
      const result = await corpusService.create({
        type: "task",
        title: input.title,
        content: input.content,
        extra: input.extra,
      });
      if (!result.ok) return result;
      return ok({ id: result.value.id });
    },

    async getResolution(id) {
      const docResult = await store.find(id);
      if (!docResult.ok) return docResult;
      const doc = docResult.value;
      if (doc === null) return ok(null);

      const edgesResult = await corpusService.getResolvesInEdgesForIssues([doc.id]);
      if (!edgesResult.ok) return edgesResult;
      const ctx = edgesResult.value.get(doc.id) ?? { resolvesInEdges: [], sourceDocs: [] };

      // reason: D2's review-rejection precedence step needs the audit trail
      // directly — ReviewService.reject (SPEC-005) never transitions a doc
      // OFF `draft`, so `doc.status` alone can't distinguish "never
      // reviewed" from "rejected back to draft". `queryAudit` orders by
      // `timestamp DESC`, so index 0 (limit:1) is the MOST RECENT reject,
      // correctly superseding an earlier one if the doc was rejected more
      // than once — restores the exact lookback T5's `getDocStatus` used
      // before D6 replaced it with this method (see this port's own
      // `getResolution` JSDoc, "P2 RESTORED").
      const auditResult = await store.queryAudit({ doc_id: doc.id, action: "reject", limit: 1 });
      if (!auditResult.ok) return auditResult;
      const latestReject = auditResult.value[0];

      const resolution = computeIssueResolution(
        { extra: doc.extra, status: doc.status },
        ctx.resolvesInEdges,
        ctx.sourceDocs,
        latestReject !== undefined,
      );

      // ONE unified reason field regardless of origin: an explicit D3 write
      // wins (mirrors computeIssueResolution's own precedence), else fall
      // back to the audit-log reject reason — but ONLY when the computed
      // resolution is ITSELF a rejection, so a stale reason from BEFORE a
      // later fix landed is never echoed next to a `fixed`/`resolving`/
      // `closed`/`open` row (AC-ICL-11: no row ever shows a rejection reason
      // beside a resolution that isn't actually a rejection).
      const auditReason = latestReject?.details?.["reason"];
      const reason =
        resolution === "rejected" || resolution === "wontfix"
          ? (readResolutionReason(doc.extra) ?? (typeof auditReason === "string" ? auditReason : undefined))
          : undefined;

      return ok({
        status: doc.status,
        resolution,
        ...(reason !== undefined ? { rejection_reason: reason } : {}),
      });
    },

    close() {
      store.close();
    },
  };

  return ok(port);
}
