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
 *   - `UpstreamPort` — the 4-op transport seam `IssueReportService` is
 *     injected with (SPEC-072 §4; a future P2 `HttpUpstreamPort` implements
 *     the same interface with zero orchestration rewrite).
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
import type { LoreError } from "@lore/core";
import { probeUpstreamDb } from "./upstream-probe.js";
import { SQLiteStore, LATEST_SCHEMA_VERSION } from "../store/sqlite-store.js";
import { CorpusService } from "../service/corpus-service.js";

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
  /** Closes the underlying SQLite connection. Idempotent-unsafe (do not call twice). */
  close(): void;
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

    close() {
      store.close();
    },
  };

  return ok(port);
}
