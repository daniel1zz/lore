/**
 * InMemoryStore — in-memory implementation of StoreInterface for unit tests.
 * Uses plain TypeScript data structures (Map, Array).
 * Methods are async to satisfy the async StoreInterface contract,
 * but internally operate synchronously (no I/O).
 * Source: same interface contract as SQLiteStore.
 */

import type {
  AuditEntry,
  CalibrationRecord,
  DocId,
  DocRecord,
  DocStatus,
  DocType,
  LinkRecord,
  LinkType,
  OrdinalDocType,
  ReviewJudgment,
  ReviewJudgmentKind,
  Slug,
  VersionRecord,
} from "@lore/core";
import {
  err,
  extractValidity,
  ok,
  ORDINAL_REGISTERED_TYPES,
  SNIPPET_MARK_CLOSE,
  SNIPPET_MARK_OPEN,
  type LoreError,
  type Result,
} from "@lore/core";
import type { RunId, RunRecord } from "@lore/core";
import type {
  AttributedWriteCount,
  AuditChainEntry,
  AuditFilters,
  CalibrationRecordWithPromptVersion,
  CalibrationWindowFilter,
  AcCiteRow,
  NeverReadDoc,
  RuleDependsRow,
  ProposedRuleWrite,
  RuleLeafPatch,
  RuleRegistryRow,
  AcExemptionRow,
  AcExemptionCap,
  SearchHit,
  StoreFilters,
  StoreInterface,
  TraceDenyByCheckpoint,
  TraceEventInput,
  TraceEventRecord,
  TraceGateDenyEvent,
  TraceRawSearchQuery,
  TraceStatsWindow,
  TraceZeroHitListOpts,
  TraceZeroHitSearch,
  UpdateOpts,
  ProvenanceWriteExtras,
  RunEndOutcome,
  RunEndState,
  RunLifecycle,
  RunProcessRecord,
} from "./store-interface.js";
import {
  allocateWithBoundedRetry,
  buildAcExemptionAlreadyActiveError,
  buildAcExemptionCapError,
  buildNonLiveRuleRefusal,
  computeAuditEntryHash,
  detectParentCycleViaAncestry,
  emptyKindsError,
  withoutNullHarnessRun,
} from "./store-shared.js";
import { stampAuditSurface } from "./audit-surface.js";
import { DECISION_GENESIS_HASH, computeDecisionEntryHash } from "./decision-log.js";
import type { DecisionLogRow, DecisionRecordInput } from "./decision-log.js";
import type { DecisionSubjectKey } from "./store-interface.js";
import type { RuleIdPrefix } from "@lore/core";
import { deriveAcCites, deriveRuleDepends, listedRuleLifecycle } from "./index-rows.js";

// ─── InMemoryStore ─────────────────────────────────────────────────────────────

/**
 * Composite-map-key separator used ONLY by {@link InMemoryStore.countTraceDenyByCheckpoint}
 * to join `(checkpoint, layer)` into a single `Map` key it later splits back apart.
 * A NUL byte can never occur in a checkpoint name or a layer discriminator
 * (`SPEC-102` D7's closed set), so it cannot collide with either field.
 *
 * MUST stay this escape sequence, never a literal NUL byte typed into the
 * source: a raw NUL inside git's first-8000-byte binary-sniff window makes
 * the WHOLE FILE unreviewable to `git diff`/`git show --stat` (measured
 * incident: `task-literal-nul-bytes-in-two-scripts-source-files-one-is` —
 * this exact file carried two raw NUL bytes at this call site, silently,
 * for one migration cycle, past the sniff window).
 */
const TRACE_BUCKET_KEY_SEP = "\0";

export class InMemoryStore implements StoreInterface {
  private readonly docs = new Map<DocId, DocRecord>();
  private links: LinkRecord[] = [];
  private readonly versions: VersionRecord[] = [];
  /** Mirrors `rule_registry` (migration-013); rows are never removed. */
  private readonly ruleRegistry: RuleRegistryRow[] = [];
  /** Mirrors `ac_exemptions` (migration-014), keyed `doc_id` + NUL + `ac_id`. */
  private readonly acExemptions = new Map<string, AcExemptionRow>();
  /**
   * SPEC-079 G3 — every entry carries its hash-chain fields (`id`/
   * `prev_hash`/`entry_hash`) alongside the plain {@link AuditEntry} fields,
   * mirroring the real stores' `audit` table columns. `queryAudit` (the
   * public read path) strips the chain fields back off via
   * {@link toPlainAuditEntry} so its return type stays a genuine
   * `AuditEntry[]` — {@link listAuditChain} is the only public method that
   * exposes this array's chain fields.
   */
  private readonly auditChain: AuditChainEntry[] = [];

  /** AC-AU-2 — mirrors `decision_log`; hash-chained, append-only (no mutator exists). */
  private readonly decisionLog: DecisionLogRow[] = [];
  private autonomyThresholds: { content: string; updated_at: string } | null = null;
  private readonly judgments: ReviewJudgment[] = [];
  private readonly calibrationRecords: CalibrationRecord[] = [];
  /** SPEC-102 — mirrors `trace_events`; never hash-chained, id is a plain 1-based sequence (insertion order). */
  private readonly traceEvents: TraceEventRecord[] = [];
  /** Mirrors `runs` (migration-016), keyed by run id; first registration wins. */
  private readonly runs = new Map<string, RunRecord>();
  /** Mirrors `runs.ended_at` / `runs.end_reason` (migration-017); absent key = open run. */
  private readonly runEnds = new Map<string, RunEndState>();
  private readonly runProcesses = new Map<string, RunProcessRecord>();

  // ── Document CRUD ─────────────────────────────────────────────────────────

  async insert(doc: DocRecord): Promise<Result<DocRecord, LoreError>> {
    const slugConflict = this.findSlugConflict(doc.slug);
    if (slugConflict !== null) {
      return err({
        code: "DUPLICATE_SLUG",
        slug: doc.slug,
        existing_id: slugConflict,
      });
    }

    if (this.docs.has(doc.id)) {
      return err({
        code: "STORE_ERROR",
        message: `Duplicate primary key: ${doc.id}`,
      });
    }

    this.docs.set(doc.id, { ...doc });
    return ok(doc);
  }

  /** MAX(ordinal) over every doc of `type` (including soft-deleted, SPEC-084 D9) — 0 when none carry a non-null ordinal yet. */
  private maxOrdinalForType(type: DocType): number {
    let max = 0;
    for (const doc of this.docs.values()) {
      if (doc.type === type && typeof doc.ordinal === "number" && doc.ordinal > max) {
        max = doc.ordinal;
      }
    }
    return max;
  }

  /** True when some doc of `type` (any deleted state) already occupies `ordinal`. */
  private hasOrdinalCollision(type: DocType, ordinal: number): boolean {
    for (const doc of this.docs.values()) {
      if (doc.type === type && doc.ordinal === ordinal) return true;
    }
    return false;
  }

  /**
   * @see StoreInterface.insertWithAllocatedOrdinal
   * Delegates its bounded-retry mechanics to the shared
   * {@link allocateWithBoundedRetry} seam (`store-shared.ts`) — no real
   * transaction primitive needed (synchronous Map mutation, no I/O to roll
   * back), so `tryAttempt` just checks {@link hasOrdinalCollision} before
   * delegating to the plain {@link insert}.
   */
  async insertWithAllocatedOrdinal(doc: DocRecord): Promise<Result<DocRecord, LoreError>> {
    const base = this.maxOrdinalForType(doc.type);
    return allocateWithBoundedRetry<DocRecord>(base, doc.type, async (candidate) => {
      if (this.hasOrdinalCollision(doc.type, candidate)) return { kind: "collision" };
      const insertResult = await this.insert({ ...doc, ordinal: candidate });
      if (insertResult.ok) return { kind: "success", value: insertResult.value };
      return { kind: "error", error: insertResult.error };
    });
  }

  /**
   * @see StoreInterface.allocateOrdinalForExisting
   * UPDATE-scoped sibling — refuses a row that already carries an ordinal
   * (checked before the CAS comparison), then delegates to the SAME shared
   * {@link allocateWithBoundedRetry} seam.
   */
  async allocateOrdinalForExisting(
    id: DocId,
    expectedVersion: number,
  ): Promise<Result<DocRecord, LoreError>> {
    const current = this.docs.get(id);
    if (!current) {
      return err({ code: "DOC_NOT_FOUND", id });
    }
    if (current.ordinal !== null && current.ordinal !== undefined) {
      return err({
        code: "STORE_ERROR",
        message: `doc ${id} already carries ordinal ${current.ordinal}; allocateOrdinalForExisting refuses to overwrite an already-allocated ordinal`,
      });
    }
    if (current.version !== expectedVersion) {
      return err({
        code: "STALE_VERSION",
        id,
        expected: expectedVersion,
        actual: current.version,
      });
    }

    const base = this.maxOrdinalForType(current.type);
    return allocateWithBoundedRetry<DocRecord>(base, current.type, async (candidate) => {
      if (this.hasOrdinalCollision(current.type, candidate)) return { kind: "collision" };
      const updated: DocRecord = { ...current, ordinal: candidate, version: expectedVersion + 1 };
      this.docs.set(id, updated);
      return { kind: "success", value: { ...updated } };
    });
  }

  /**
   * @see StoreInterface.assignOrdinalForRepair
   * SPEC-084 D7's internal repair-migration path — direct assignment of the
   * caller-computed target, never a `MAX(ordinal)+1` allocation. Reuses
   * {@link hasOrdinalCollision} (which already scans EVERY doc regardless of
   * soft-delete state, mirroring the real stores' partial-unique-index
   * semantics) for the loud, no-retry collision check.
   */
  async assignOrdinalForRepair(id: DocId, ordinal: number): Promise<Result<DocRecord, LoreError>> {
    const current = this.docs.get(id);
    if (!current) {
      return err({ code: "DOC_NOT_FOUND", id });
    }
    if (!ORDINAL_REGISTERED_TYPES.includes(current.type as OrdinalDocType)) {
      return err({
        code: "STORE_ERROR",
        message: `assignOrdinalForRepair refuses doc ${id}: type "${current.type}" is not an ordinal-registered type`,
      });
    }
    if (current.ordinal !== null && current.ordinal !== undefined) {
      if (current.ordinal === ordinal) {
        // Idempotent no-op — a repeat repair call at the SAME target succeeds without a write.
        return ok({ ...current });
      }
      return err({
        code: "STORE_ERROR",
        message: `doc ${id} already carries ordinal ${current.ordinal}; assignOrdinalForRepair refuses to overwrite it with a DIFFERENT value ${ordinal}`,
      });
    }
    if (this.hasOrdinalCollision(current.type, ordinal)) {
      return err({
        code: "STORE_ERROR",
        message: `assignOrdinalForRepair collision: another doc of type "${current.type}" already carries ordinal ${ordinal}`,
      });
    }
    const updated: DocRecord = { ...current, ordinal, version: current.version + 1 };
    this.docs.set(id, updated);
    return ok({ ...updated });
  }

  /**
   * @see StoreInterface.findByTypeOrdinal
   * Direct-address lookup — does NOT filter soft-deleted (mirrors `find`).
   */
  async findByTypeOrdinal(
    type: DocType,
    ordinal: number,
  ): Promise<Result<DocRecord | null, LoreError>> {
    for (const doc of this.docs.values()) {
      if (doc.type === type && doc.ordinal === ordinal) {
        return ok({ ...doc });
      }
    }
    return ok(null);
  }

  async find(id: DocId): Promise<Result<DocRecord | null, LoreError>> {
    const record = this.docs.get(id);
    return ok(record !== undefined ? { ...record } : null);
  }

  async findBySlug(slug: Slug): Promise<Result<DocRecord | null, LoreError>> {
    for (const doc of this.docs.values()) {
      if (doc.slug === slug) {
        return ok({ ...doc });
      }
    }
    return ok(null);
  }

  /**
   * @see StoreInterface.findByIdPrefix
   * Explicit `toUpperCase()` compare mirrors SQLite/libSQL's native
   * case-insensitive `LIKE` default (see those stores' implementation
   * notes) — this is a plain in-memory filter, no query engine to lean on.
   */
  async findByIdPrefix(prefix: string): Promise<Result<DocRecord[], LoreError>> {
    const upperPrefix = prefix.toUpperCase();
    const matches: DocRecord[] = [];
    for (const doc of this.docs.values()) {
      if (doc.deleted_at !== null) continue;
      if (doc.id.toUpperCase().startsWith(upperPrefix)) {
        matches.push({ ...doc });
      }
    }
    return ok(matches);
  }

  async findByIds(ids: DocId[]): Promise<Result<Map<DocId, DocRecord>, LoreError>> {
    const byId = new Map<DocId, DocRecord>();
    if (ids.length === 0) return ok(byId);
    for (const id of ids) {
      const record = this.docs.get(id);
      if (record !== undefined) {
        byId.set(id, { ...record });
      }
    }
    return ok(byId);
  }

  async findMany(filters: StoreFilters): Promise<Result<DocRecord[], LoreError>> {
    const excludeDeleted = filters.exclude_deleted !== false;

    let results = Array.from(this.docs.values()).filter((doc) => {
      if (excludeDeleted && doc.deleted_at !== null) return false;
      if (filters.type !== undefined && doc.type !== filters.type) return false;
      if (filters.status !== undefined && doc.status !== filters.status)
        return false;
      if (
        filters.parent_id !== undefined &&
        doc.parent_id !== filters.parent_id
      )
        return false;
      if (
        filters.created_by !== undefined &&
        doc.created_by !== filters.created_by
      )
        return false;
      if (filters.since !== undefined && doc.updated_at < filters.since)
        return false;
      // reason: applied HERE — in the candidate predicate, alongside every other
      // column filter — and NOT after the sort/slice below, so this double
      // reproduces the SQL stores' WHERE-before-LIMIT/OFFSET ordering exactly.
      // A double that filtered after paging would make the in-memory suite green
      // for the very post-window bug StoreFilters.sub_type forbids.
      if (filters.sub_type !== undefined && !matchesSubType(doc, filters.sub_type))
        return false;
      return true;
    });

    if (filters.tags && filters.tags.length > 0) {
      const requiredTags = filters.tags;
      results = results.filter((doc) =>
        requiredTags.every((tag) => doc.tags.includes(tag)),
      );
    }

    // Sort by updated_at DESC, id ASC to match SQLiteStore/TursoStore's
    // stable tiebreaker order — required for deterministic limit/offset
    // paging when multiple docs share the same updated_at.
    results.sort(
      (a, b) => b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id),
    );

    // limit/offset — see StoreFilters.limit/offset for the contract (omitted
    // → no truncation, byte-identical to pre-pagination behavior).
    if (filters.limit !== undefined || filters.offset !== undefined) {
      const offset = filters.offset ?? 0;
      results =
        filters.limit !== undefined
          ? results.slice(offset, offset + filters.limit)
          : results.slice(offset);
    }

    return ok(results.map((doc) => ({ ...doc })));
  }

  /**
   * Apply a partial patch to an existing doc.
   * When opts.expected_version is provided, performs a compare-and-swap:
   * if the stored version does not match, returns STALE_VERSION with diagnostics.
   * When opts is omitted or expected_version is not set, unconditional update.
   * @see UpdateOpts for full contract.
   */
  async update(
    id: DocId,
    patch: Partial<DocRecord>,
    opts?: UpdateOpts,
  ): Promise<Result<DocRecord, LoreError>> {
    const existing = this.docs.get(id);
    if (!existing) {
      return err({ code: "DOC_NOT_FOUND", id });
    }

    if (opts?.expected_version !== undefined) {
      if (existing.version !== opts.expected_version) {
        return err({
          code: "STALE_VERSION",
          id,
          expected: opts.expected_version,
          actual: existing.version,
        });
      }
    }

    const updated: DocRecord = {
      ...existing,
      ...patch,
      id: existing.id, // id is immutable
    };

    this.docs.set(id, updated);
    return ok({ ...updated });
  }

  async softDelete(id: DocId): Promise<Result<void, LoreError>> {
    const existing = this.docs.get(id);
    if (!existing) {
      return err({ code: "DOC_NOT_FOUND", id });
    }

    const now = new Date().toISOString();
    this.docs.set(id, { ...existing, deleted_at: now });
    return ok(undefined);
  }

  // ── Provenance-atomic composite writes (BUG-002) ────────────────────────
  //
  // InMemoryStore has no real transaction primitive (plain Map/Array
  // mutation, no I/O to roll back) — atomicity is implemented as explicit
  // manual undo of every step already applied when a LATER step fails. Each
  // composite method calls through `this.<method>(...)` (not a private raw
  // helper) so a test double that SUBCLASSES InMemoryStore and overrides
  // e.g. `insertVersion` to force a failure is honored by polymorphic
  // dispatch — the documented failure-injection technique for this store
  // (see BUG-002 AC-1 / the paired `provenance-writes` test suite).

  /**
   * Remove the single version row inserted by a just-failed composite call.
   * Matched on `(doc_id, version)` — the versions table's real PK, mirrored
   * here since InMemoryStore has no unique-index enforcement of its own.
   */
  private removeVersionEntry(version: VersionRecord): void {
    const idx = this.versions.findIndex(
      (v) => v.doc_id === version.doc_id && v.version === version.version,
    );
    if (idx !== -1) this.versions.splice(idx, 1);
  }

  /**
   * Restore `this.docs.get(id)` to its pre-call snapshot — `undefined` means
   * the doc did not exist before this call (so the rollback is a delete),
   * otherwise the snapshot is written back verbatim.
   */
  private restoreDocSnapshot(id: DocId, before: DocRecord | undefined): void {
    if (before === undefined) {
      this.docs.delete(id);
    } else {
      this.docs.set(id, { ...before });
    }
  }

  /**
   * @see StoreInterface.insertWithProvenance
   */
  async insertWithProvenance(
    doc: DocRecord,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    const insertResult = await this.insert(doc);
    if (!insertResult.ok) return insertResult;

    const versionResult = await this.insertVersion(version);
    if (!versionResult.ok) {
      this.docs.delete(doc.id);
      return versionResult;
    }

    const auditResult = await this.appendAuditEntry(audit);
    if (!auditResult.ok) {
      this.docs.delete(doc.id);
      this.removeVersionEntry(version);
      return auditResult;
    }

    return ok(insertResult.value);
  }

  /**
   * @see StoreInterface.insertWithAllocatedOrdinalAndProvenance
   *
   * Same manual-undo technique as {@link insertWithProvenance} (no real
   * transaction primitive — plain Map/Array mutation) layered on top of
   * {@link insertWithAllocatedOrdinal}'s bounded-retry allocation: dispatches
   * through `this.insertWithAllocatedOrdinal(doc)` → `this.insertVersion(...)`
   * → `this.appendAuditEntry(...)` (polymorphic `this.<method>` calls, NOT a
   * private raw helper — mirrors `insertWithProvenance`'s identical
   * rationale, so a failure-injecting subclass overriding `insertVersion`/
   * `appendAuditEntry` is honored here too). A later-step failure deletes
   * the doc row the allocation step just wrote (keyed by the ACTUAL
   * allocated id, from the alloc result — never the caller's pre-allocation
   * `doc` object) so the candidate ordinal is never left occupying a live
   * row; `maxOrdinalForType`'s next read for this type therefore recomputes
   * the SAME candidate on a subsequent call — the ordinal is not burned.
   */
  async insertWithAllocatedOrdinalAndProvenance(
    doc: DocRecord,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    const allocResult = await this.insertWithAllocatedOrdinal(doc);
    if (!allocResult.ok) return allocResult;

    const versionResult = await this.insertVersion(version);
    if (!versionResult.ok) {
      this.docs.delete(allocResult.value.id);
      return versionResult;
    }

    const auditResult = await this.appendAuditEntry(audit);
    if (!auditResult.ok) {
      this.docs.delete(allocResult.value.id);
      this.removeVersionEntry(version);
      return auditResult;
    }

    return ok(allocResult.value);
  }

  /**
   * @see StoreInterface.updateWithProvenance
   */
  async updateWithProvenance(
    id: DocId,
    patch: Partial<DocRecord>,
    opts: UpdateOpts | undefined,
    version: VersionRecord,
    audit: AuditEntry,
    extras?: ProvenanceWriteExtras,
  ): Promise<Result<DocRecord, LoreError>> {
    const before = this.docs.get(id);

    // reason: the in-memory store has no registry rows for leaves a test inserted directly, so the
    // liveness read is the baseline leaf docs themselves (the doc map is the single source here —
    // see listRuleRegistry). The read and the write below share one synchronous turn up to `update`.
    if (extras?.require_live_rules !== undefined && extras.require_live_rules.length > 0) {
      const refusal = buildNonLiveRuleRefusal(
        id,
        extras.require_live_rules.map((ruleId) => ({ rule_id: ruleId, lifecycle: this.readLeafLifecycle(ruleId) })),
      );
      if (refusal !== null) return err(refusal);
    }

    const updateResult = await this.update(id, patch, opts);
    if (!updateResult.ok) return updateResult;

    const versionResult = await this.insertVersion(version);
    if (!versionResult.ok) {
      this.restoreDocSnapshot(id, before);
      return versionResult;
    }

    const chainLength = this.auditChain.length;
    const auditResult = await this.appendAuditEntry(audit);
    if (!auditResult.ok) {
      this.restoreDocSnapshot(id, before);
      this.removeVersionEntry(version);
      return auditResult;
    }

    for (const extraAudit of extras?.also_audit ?? []) {
      const extraResult = await this.appendAuditEntry(extraAudit);
      if (!extraResult.ok) {
        this.restoreDocSnapshot(id, before);
        this.removeVersionEntry(version);
        this.auditChain.length = chainLength;
        return extraResult;
      }
    }

    return ok(updateResult.value);
  }

  /** A rule's lifecycle as listed by its live baseline leaf, or `null` when no leaf lists it. */
  private readLeafLifecycle(ruleId: string): string | null {
    for (const doc of this.docs.values()) {
      if (doc.type !== "baseline" || (doc.deleted_at ?? null) !== null) continue;
      const lifecycle = listedRuleLifecycle(doc.extra, ruleId);
      if (lifecycle !== undefined) return lifecycle;
    }
    return null;
  }

  /**
   * @see StoreInterface.softDeleteWithProvenance
   */
  async softDeleteWithProvenance(
    id: DocId,
    version: VersionRecord,
    audit: AuditEntry,
  ): Promise<Result<void, LoreError>> {
    const before = this.docs.get(id);

    const deleteResult = await this.softDelete(id);
    if (!deleteResult.ok) return deleteResult;

    const versionResult = await this.insertVersion(version);
    if (!versionResult.ok) {
      this.restoreDocSnapshot(id, before);
      return versionResult;
    }

    const auditResult = await this.appendAuditEntry(audit);
    if (!auditResult.ok) {
      this.restoreDocSnapshot(id, before);
      this.removeVersionEntry(version);
      return auditResult;
    }

    return ok(undefined);
  }

  // ── Rule registry (migration-013, spec C2) ────────────────────────────────

  /**
   * CAS-update one leaf and append its `action: "update"` version row, with NO
   * `await` — the whole allocate/move body must run in one synchronous turn so
   * no other call can interleave between the `MAX(n)` read and the registry
   * push (the in-memory analogue of the real stores' write transaction).
   * Undo is the caller's job (it holds the snapshots).
   */
  private applyRuleLeafPatchSync(
    patch: RuleLeafPatch,
    actor: string,
    nowIso: string,
  ): Result<DocRecord, LoreError> {
    const existing = this.docs.get(patch.id);
    if (!existing || existing.deleted_at != null) {
      return err({ code: "DOC_NOT_FOUND", id: patch.id });
    }
    if (existing.version !== patch.expectedVersion) {
      return err({
        code: "STALE_VERSION",
        id: patch.id,
        expected: patch.expectedVersion,
        actual: existing.version,
      });
    }
    const nextVersion = patch.expectedVersion + 1;
    if (this.versions.some((v) => v.doc_id === patch.id && v.version === nextVersion)) {
      // reason: mirrors the real stores' (doc_id, version) PRIMARY KEY.
      return err({
        code: "STORE_ERROR",
        message: `Duplicate version row (${patch.id}, ${nextVersion})`,
      });
    }
    const updated: DocRecord = {
      ...existing,
      extra: patch.extra,
      version: nextVersion,
      updated_at: nowIso,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    this.docs.set(patch.id, updated);
    this.versions.push({
      doc_id: updated.id,
      version: updated.version,
      content: updated.content,
      extra: updated.extra,
      status: updated.status,
      title: updated.title,
      action: "update",
      created_at: nowIso,
      created_by: actor,
      ...(patch.change_summary !== undefined ? { change_summary: patch.change_summary } : {}),
      slug: updated.slug,
      harness_run: patch.harness_run ?? null,
    });
    return ok(updated);
  }

  /** @see StoreInterface.allocateRuleAndUpdateLeaf */
  async allocateRuleAndUpdateLeaf(
    leafId: DocId,
    expectedVersion: number,
    buildExtra: (ruleId: string) => Record<string, unknown>,
    actor: string,
    prefix: RuleIdPrefix = "BR",
    harnessRun: string | null = null,
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>> {
    return this.allocateRuleSync(
      { docId: leafId, expectedVersion, buildExtra, harnessRun },
      { ownerDocId: leafId, proposed: false },
      actor,
      prefix,
    );
  }

  /** @see StoreInterface.reserveProposedRuleAndUpdateSpec */
  async reserveProposedRuleAndUpdateSpec(
    write: ProposedRuleWrite,
    actor: string,
    prefix: RuleIdPrefix = "BR",
    harnessRun: string | null = null,
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>> {
    return this.allocateRuleSync(
      {
        docId: write.specId,
        expectedVersion: write.expectedVersion,
        buildExtra: write.buildExtra,
        harnessRun,
        ...(write.status !== undefined ? { status: write.status } : {}),
        ...(write.changeSummary !== undefined ? { changeSummary: write.changeSummary } : {}),
      },
      { ownerDocId: write.ownerLeafId, proposed: true },
      actor,
      prefix,
    );
  }

  /**
   * Shared body of {@link allocateRuleAndUpdateLeaf} and {@link reserveProposedRuleAndUpdateSpec}; NO `await`,
   * so the whole read-allocate-write runs in one synchronous turn (see {@link applyRuleLeafPatchSync}).
   */
  private allocateRuleSync(
    doc: {
      docId: DocId;
      expectedVersion: number;
      buildExtra: (ruleId: string) => Record<string, unknown>;
      harnessRun: string | null;
      status?: DocStatus;
      changeSummary?: string;
    },
    registry: { ownerDocId: DocId; proposed: boolean },
    actor: string,
    prefix: RuleIdPrefix,
  ): Result<{ ruleId: string; doc: DocRecord }, LoreError> {
    const nextN =
      this.ruleRegistry
        .filter((row) => row.id.startsWith(`${prefix}-`))
        .reduce((max, row) => Math.max(max, row.n), 0) + 1;
    const ruleId = `${prefix}-${nextN}`;
    const nowIso = new Date().toISOString();
    const versionCount = this.versions.length;
    const before = this.docs.get(doc.docId);
    let written: Result<DocRecord, LoreError>;
    try {
      written = this.applyRuleLeafPatchSync(
        {
          id: doc.docId,
          expectedVersion: doc.expectedVersion,
          extra: doc.buildExtra(ruleId),
          harness_run: doc.harnessRun,
          ...(doc.status !== undefined ? { status: doc.status } : {}),
          ...(doc.changeSummary !== undefined ? { change_summary: doc.changeSummary } : {}),
        },
        actor,
        nowIso,
      );
    } catch (e) {
      this.restoreDocSnapshot(doc.docId, before);
      this.versions.length = versionCount;
      return err({ code: "STORE_ERROR", message: e instanceof Error ? e.message : "buildExtra threw" });
    }
    if (!written.ok) {
      this.restoreDocSnapshot(doc.docId, before);
      this.versions.length = versionCount;
      return written;
    }
    let registryVersion = written.value.version;
    if (registry.proposed) {
      const owner = this.docs.get(registry.ownerDocId);
      if (owner === undefined || owner.deleted_at != null) {
        this.restoreDocSnapshot(doc.docId, before);
        this.versions.length = versionCount;
        return err({ code: "DOC_NOT_FOUND", id: registry.ownerDocId });
      }
      registryVersion = owner.version;
    }
    this.ruleRegistry.push({
      id: ruleId,
      n: nextN,
      leaf_doc_id: registry.ownerDocId,
      allocated_at: nowIso,
      allocated_by: actor,
      lifecycle: registry.proposed ? "proposed" : (listedRuleLifecycle(written.value.extra, ruleId) ?? "live"),
      version: registryVersion,
    });
    return ok({ ruleId, doc: written.value });
  }

  /** @see StoreInterface.moveRule */
  async moveRule(
    ruleId: string,
    fromLeaf: RuleLeafPatch,
    toLeaf: RuleLeafPatch,
    actor: string,
  ): Promise<Result<{ from: DocRecord; to: DocRecord }, LoreError>> {
    const registryRow = this.ruleRegistry.find((row) => row.id === ruleId);
    if (!registryRow) return err({ code: "DOC_NOT_FOUND", id: ruleId });
    if (registryRow.leaf_doc_id !== fromLeaf.id) {
      return err({
        code: "VALIDATION_ERROR",
        field: "fromLeaf.id",
        message: `rule ${ruleId} is registered to leaf ${registryRow.leaf_doc_id}, not ${fromLeaf.id}`,
        value: fromLeaf.id,
      });
    }
    const nowIso = new Date().toISOString();
    const versionCount = this.versions.length;
    const beforeFrom = this.docs.get(fromLeaf.id);
    const beforeTo = this.docs.get(toLeaf.id);
    const undo = (): void => {
      this.restoreDocSnapshot(fromLeaf.id, beforeFrom);
      this.restoreDocSnapshot(toLeaf.id, beforeTo);
      this.versions.length = versionCount;
    };
    const from = this.applyRuleLeafPatchSync(fromLeaf, actor, nowIso);
    if (!from.ok) {
      undo();
      return from;
    }
    const to = this.applyRuleLeafPatchSync(toLeaf, actor, nowIso);
    if (!to.ok) {
      undo();
      return to;
    }
    registryRow.leaf_doc_id = toLeaf.id;
    registryRow.lifecycle = listedRuleLifecycle(to.value.extra, ruleId) ?? "live";
    registryRow.version = to.value.version;
    return ok({ from: from.value, to: to.value });
  }

  /**
   * @see StoreInterface.listRuleRegistry
   *
   * reason: the in-memory store has no triggers, so `lifecycle`/`version` are PROJECTED from the
   * owning leaf at read time — the doc map is the single source, which is the in-memory analogue of
   * the real stores' same-transaction writers (and survives the undo/restore paths for free).
   */
  async listRuleRegistry(): Promise<Result<RuleRegistryRow[], LoreError>> {
    return ok(
      [...this.ruleRegistry]
        .sort((a, b) => a.n - b.n || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((row) => {
          const owner = this.docs.get(row.leaf_doc_id);
          if (owner === undefined) return { ...row };
          return {
            ...row,
            lifecycle: listedRuleLifecycle(owner.extra, row.id) ?? row.lifecycle,
            version: owner.version,
          };
        }),
    );
  }

  /**
   * @see StoreInterface.insertAcExemptionCapped
   *
   * reason: the count and the insert run with no `await` between them, so on the single JS thread
   * they are atomic — the in-memory analogue of the real stores' one-transaction insert.
   */
  async insertAcExemptionCapped(
    row: AcExemptionRow,
    cap: AcExemptionCap,
  ): Promise<Result<AcExemptionRow, LoreError>> {
    const key = `${row.doc_id}\u0000${row.ac_id}`;
    const existing = this.acExemptions.get(key);
    if (existing !== undefined && existing.expires_at > cap.now) {
      return err(buildAcExemptionAlreadyActiveError(row.doc_id, row.ac_id));
    }
    if (existing !== undefined) this.acExemptions.delete(key);
    const active = [...this.acExemptions.values()].filter((r) => r.expires_at > cap.now).length;
    if (active >= cap.maxActive) {
      if (existing !== undefined) this.acExemptions.set(key, existing);
      return err(buildAcExemptionCapError(active, cap.liveCriteria, cap.maxActive));
    }
    this.acExemptions.set(key, { ...row });
    return ok({ ...row });
  }

  /** @see StoreInterface.listAcExemptions */
  async listAcExemptions(): Promise<Result<AcExemptionRow[], LoreError>> {
    return ok(
      [...this.acExemptions.values()]
        .map((r) => ({ ...r }))
        .sort((a, b) => (a.doc_id === b.doc_id ? a.ac_id.localeCompare(b.ac_id) : a.doc_id.localeCompare(b.doc_id))),
    );
  }

  /** @see StoreInterface.listAcCites — a computed view of the live specs (see {@link listRuleRegistry}'s reason). */
  async listAcCites(): Promise<Result<AcCiteRow[], LoreError>> {
    return ok(deriveAcCites([...this.docs.values()]));
  }

  /** @see StoreInterface.listRuleDepends — a computed view of the live baseline docs. */
  async listRuleDepends(): Promise<Result<RuleDependsRow[], LoreError>> {
    return ok(deriveRuleDepends([...this.docs.values()]));
  }

  // ── Links ─────────────────────────────────────────────────────────────────

  async addLink(link: LinkRecord): Promise<Result<LinkRecord, LoreError>> {
    if (link.link_type === "parent") {
      const cycleResult = await this.detectParentCycle(link.from_id, link.to_id);
      if (!cycleResult.ok) return cycleResult;
    }

    const isDuplicate = this.links.some(
      (l) =>
        l.from_id === link.from_id &&
        l.to_id === link.to_id &&
        l.link_type === link.link_type,
    );

    if (isDuplicate) {
      return err({
        code: "DUPLICATE_LINK",
        from: link.from_id,
        to: link.to_id,
        type: link.link_type,
      });
    }

    this.links = [...this.links, { ...link }];
    return ok(link);
  }

  /**
   * @see StoreInterface.addLinkWithProvenance — manual undo of every applied step when a later one
   * fails (see this file's "Provenance-atomic composite writes" header). Calls through `this.<method>`
   * so a subclass double that fails `update` / `appendAuditEntry` is honored.
   */
  async addLinkWithProvenance(
    link: LinkRecord,
    audit: AuditEntry,
  ): Promise<Result<LinkRecord, LoreError>> {
    const addResult = await this.addLink(link);
    if (!addResult.ok) return addResult;

    const undoLink = (): void => {
      this.links = this.links.filter(
        (l) =>
          !(l.from_id === link.from_id && l.to_id === link.to_id && l.link_type === link.link_type),
      );
    };

    const before = this.docs.get(link.from_id);
    if (link.link_type === "parent") {
      const updateResult = await this.update(link.from_id, {
        parent_id: link.to_id,
        updated_at: link.created_at,
      });
      if (!updateResult.ok) {
        undoLink();
        return updateResult;
      }
    }

    const chainLength = this.auditChain.length;
    const auditResult = await this.appendAuditEntry(audit);
    if (!auditResult.ok) {
      undoLink();
      this.restoreDocSnapshot(link.from_id, before);
      this.auditChain.length = chainLength;
      return auditResult;
    }

    return ok(link);
  }

  /**
   * @see StoreInterface.setDocParentWithProvenance — manual undo of the doc/link steps when the audit
   * append fails (see this file's "Provenance-atomic composite writes" header).
   */
  async setDocParentWithProvenance(
    id: DocId,
    parentId: DocId | null,
    audit: AuditEntry,
  ): Promise<Result<DocRecord, LoreError>> {
    const before = this.docs.get(id);
    const linksBefore = this.links;
    const updateResult = await this.update(id, { parent_id: parentId, updated_at: audit.timestamp });
    if (!updateResult.ok) return updateResult;
    if (parentId === null) {
      this.links = this.links.filter((l) => !(l.from_id === id && l.link_type === "parent"));
    }
    const chainLength = this.auditChain.length;
    const auditResult = await this.appendAuditEntry(audit);
    if (!auditResult.ok) {
      this.restoreDocSnapshot(id, before);
      this.links = linksBefore;
      this.auditChain.length = chainLength;
      return auditResult;
    }
    return updateResult;
  }

  /**
   * Detect whether adding a parent link from_id → to_id would create a cycle.
   * Delegates to {@link detectParentCycleViaAncestry} (store-shared.ts), the
   * same walk SQLiteStore/TursoStore use. Each node's effective parent is the
   * outgoing `parent` link when one exists, else `docs.parent_id` — both
   * sources must be consulted because `CorpusService.create --parent` writes
   * only `docs.parent_id` (no links row), while `addLink` alone writes only a
   * links row.
   */
  private async detectParentCycle(
    fromId: DocId,
    toId: DocId,
  ): Promise<Result<void, LoreError>> {
    return detectParentCycleViaAncestry(fromId, toId, async (id) => {
      const parentLink = this.links.find(
        (l) => l.from_id === id && l.link_type === "parent",
      );
      if (parentLink) return parentLink.to_id;
      return this.docs.get(id)?.parent_id ?? null;
    });
  }

  async removeLink(
    fromId: DocId,
    toId: DocId,
    linkType: LinkType,
  ): Promise<Result<void, LoreError>> {
    this.links = this.links.filter(
      (l) =>
        !(l.from_id === fromId &&
          l.to_id === toId &&
          l.link_type === linkType),
    );

    return ok(undefined);
  }

  async findLinks(
    docId: DocId,
    direction: "in" | "out" | "both",
  ): Promise<Result<LinkRecord[], LoreError>> {
    let found: LinkRecord[];

    if (direction === "out") {
      found = this.links.filter((l) => l.from_id === docId);
    } else if (direction === "in") {
      found = this.links.filter((l) => l.to_id === docId);
    } else {
      found = this.links.filter(
        (l) => l.from_id === docId || l.to_id === docId,
      );
    }

    return ok(found.map((l) => ({ ...l })));
  }

  async findLinksByToIds(
    toIds: DocId[],
    linkType: LinkType,
  ): Promise<Result<LinkRecord[], LoreError>> {
    if (toIds.length === 0) return ok([]);
    const idSet = new Set(toIds);
    const found = this.links.filter(
      (l) => l.link_type === linkType && idSet.has(l.to_id),
    );
    return ok(found.map((l) => ({ ...l })));
  }

  async findLinksByFromIds(
    fromIds: DocId[],
    _direction: "out" = "out",
  ): Promise<Result<Map<DocId, LinkRecord[]>, LoreError>> {
    const byFromId = new Map<DocId, LinkRecord[]>();
    if (fromIds.length === 0) return ok(byFromId);
    const idSet = new Set(fromIds);
    for (const link of this.links) {
      if (idSet.has(link.from_id)) {
        const bucket = byFromId.get(link.from_id);
        if (bucket === undefined) {
          byFromId.set(link.from_id, [{ ...link }]);
        } else {
          bucket.push({ ...link });
        }
      }
    }
    return ok(byFromId);
  }

  async countLinksByToIds(toIds: DocId[]): Promise<Result<Map<DocId, number>, LoreError>> {
    const counts = new Map<DocId, number>();
    if (toIds.length === 0) return ok(counts);
    const idSet = new Set(toIds);
    for (const link of this.links) {
      if (idSet.has(link.to_id)) {
        counts.set(link.to_id, (counts.get(link.to_id) ?? 0) + 1);
      }
    }
    return ok(counts);
  }

  // ── Search ────────────────────────────────────────────────────────────────

  /**
   * Simple substring search on title + content + tags (case-insensitive).
   * Not ranked — score is always 0. Mirrors interface contract, not FTS5 quality.
   */
  async search(
    query: string,
    filters?: StoreFilters,
  ): Promise<Result<SearchHit[], LoreError>> {
    if (!query || query.trim() === "") {
      return ok([]);
    }

    const lower = query.toLowerCase();
    const excludeDeleted = filters?.exclude_deleted !== false;

    let candidates = Array.from(this.docs.values()).filter((doc) => {
      if (excludeDeleted && doc.deleted_at !== null) return false;
      if (filters?.type !== undefined && doc.type !== filters.type) return false;
      if (filters?.status !== undefined && doc.status !== filters.status)
        return false;
      // reason: same candidate-stage placement as findMany's — the narrowing runs
      // before any scoring/ordering, mirroring the SQL stores' FTS5→docs join
      // WHERE clause rather than a post-fetch pass over the hit list.
      if (filters?.sub_type !== undefined && !matchesSubType(doc, filters.sub_type))
        return false;
      return true;
    });

    if (filters?.tags && filters.tags.length > 0) {
      const requiredTags = filters.tags;
      candidates = candidates.filter((doc) =>
        requiredTags.every((tag) => doc.tags.includes(tag)),
      );
    }

    const hits: SearchHit[] = [];

    for (const doc of candidates) {
      const titleMatch = doc.title.toLowerCase().includes(lower);
      const contentMatch = doc.content.toLowerCase().includes(lower);
      const tagMatch = doc.tags.some((t) => t.toLowerCase().includes(lower));

      if (titleMatch || contentMatch || tagMatch) {
        const snippet = buildSnippet(doc.content, lower);
        const validity = extractValidity(doc);
        hits.push({
          id: doc.id,
          slug: doc.slug,
          title: doc.title,
          snippet,
          score: 0,
          type: doc.type,
          status: doc.status,
          // SPEC-043 D3 — created_at + the narrow validity projection, straight from
          // the already-in-hand DocRecord (no extra lookup needed for InMemoryStore).
          created_at: doc.created_at,
          ...(validity !== undefined ? { validity } : {}),
        });
      }
    }

    return ok(hits);
  }

  // ── Versions ──────────────────────────────────────────────────────────────

  async insertVersion(version: VersionRecord): Promise<Result<VersionRecord, LoreError>> {
    this.versions.push(withoutNullHarnessRun({ ...version }));
    return ok(version);
  }

  async findVersions(
    docId: DocId,
    opts?: { limit?: number; offset?: number },
  ): Promise<Result<VersionRecord[], LoreError>> {
    const limit = opts?.limit ?? 100;
    const offset = opts?.offset ?? 0;

    const matching = this.versions
      .filter((v) => v.doc_id === docId)
      .sort((a, b) => b.version - a.version) // newest first
      .slice(offset, offset + limit);

    return ok(matching.map((v) => ({ ...v })));
  }

  async listAllVersions(since?: string): Promise<Result<VersionRecord[], LoreError>> {
    const matching = this.versions
      .filter((v) => since === undefined || v.created_at >= since)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    return ok(matching.map((v) => ({ ...v })));
  }

  // ── Audit ─────────────────────────────────────────────────────────────────

  /**
   * Strips the SPEC-079 G3 hash-chain fields (`id`/`prev_hash`/`entry_hash`)
   * off an internal {@link AuditChainEntry}, returning a genuine
   * `AuditEntry` — {@link queryAudit}'s public contract never exposes chain
   * hashes (see `store-shared.ts::AuditChainEntry`'s JSDoc for why: no
   * caller may ever read a value it could plausibly forge and resupply).
   */
  private toPlainAuditEntry(entry: AuditChainEntry): AuditEntry {
    const { id: _id, prev_hash: _prevHash, entry_hash: _entryHash, ...rest } = entry;
    return rest;
  }

  /**
   * @see StoreInterface.appendAuditEntry
   *
   * SPEC-079 G3 — reads the current chain head (the last-pushed entry's
   * `entry_hash`, or `""` if `auditChain` is empty) and computes this
   * entry's own `entry_hash` via `computeAuditEntryHash` before pushing.
   * InMemoryStore is single-threaded, synchronous JS with no `await`
   * between the head-read and the push, so — unlike SQLiteStore/TursoStore,
   * which need an explicit transaction to guard against a concurrent
   * PROCESS — there is no real concurrency window here for the chain to fork.
   */
  async appendAuditEntry(rawEntry: AuditEntry): Promise<Result<void, LoreError>> {
    const entry = stampAuditSurface(rawEntry);
    const head = this.auditChain[this.auditChain.length - 1];
    const prevHash = head?.entry_hash ?? "";
    const entryHash = computeAuditEntryHash(entry, prevHash);
    this.auditChain.push({
      ...withoutNullHarnessRun({ ...entry }),
      id: this.auditChain.length + 1,
      prev_hash: prevHash,
      entry_hash: entryHash,
    });
    return ok(undefined);
  }

  async queryAudit(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>> {
    let results = this.auditChain.filter((entry) => {
      if (filters.doc_id !== undefined && entry.doc_id !== filters.doc_id)
        return false;
      if (filters.actor !== undefined && entry.actor !== filters.actor)
        return false;
      if (filters.action !== undefined && entry.action !== filters.action)
        return false;
      if (filters.since !== undefined && entry.timestamp < filters.since)
        return false;
      return true;
    });

    // Sort by timestamp DESC
    results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filters.limit !== undefined) {
      results = results.slice(0, filters.limit);
    }

    return ok(results.map((e) => this.toPlainAuditEntry(e)));
  }

  /**
   * @see StoreInterface.appendDecisionRecord — single-threaded, no await between head-read and push.
   */
  async appendDecisionRecord(input: DecisionRecordInput): Promise<Result<DecisionLogRow, LoreError>> {
    const head = this.decisionLog[this.decisionLog.length - 1];
    const prevHash = head?.entry_hash ?? DECISION_GENESIS_HASH;
    const row: DecisionLogRow = {
      ...input,
      id: this.decisionLog.length + 1,
      prev_hash: prevHash,
      entry_hash: computeDecisionEntryHash(input, prevHash),
    };
    this.decisionLog.push(row);
    return ok({ ...row });
  }

  /**
   * @see StoreInterface.listDecisionLog
   */
  async listDecisionLog(subject?: DecisionSubjectKey): Promise<Result<DecisionLogRow[], LoreError>> {
    const rows = this.decisionLog.filter(
      (r) =>
        subject === undefined ||
        (r.class === subject.class &&
          r.subject_id === subject.subject_id &&
          r.subject_version === subject.subject_version),
    );
    return ok(rows.map((r) => ({ ...r })));
  }

  /**
   * @see StoreInterface.readAutonomyThresholds
   */
  async readAutonomyThresholds(): Promise<Result<{ readonly content: string; readonly updated_at: string } | null, LoreError>> {
    return ok(this.autonomyThresholds === null ? null : { ...this.autonomyThresholds });
  }

  /**
   * @see StoreInterface.writeAutonomyThresholds
   */
  async writeAutonomyThresholds(content: string, updatedAt: string): Promise<Result<void, LoreError>> {
    this.autonomyThresholds = { content, updated_at: updatedAt };
    return ok(undefined);
  }

  /**
   * @see StoreInterface.listAuditChain
   */
  async listAuditChain(): Promise<Result<AuditChainEntry[], LoreError>> {
    // reason: auditChain is already in id ASC order by construction — every
    // appendAuditEntry call pushes to the end, so array order IS insertion
    // (chain-construction) order. No sort needed, mirroring the real
    // stores' `ORDER BY id ASC`.
    return ok(this.auditChain.map((e) => ({ ...e })));
  }

  /**
   * @see StoreInterface.listAuditRowsByAction
   */
  async listAuditRowsByAction(action: string, docId?: DocId): Promise<Result<AuditChainEntry[], LoreError>> {
    return ok(
      this.auditChain
        .filter((e) => e.action === action && (docId === undefined || e.doc_id === docId))
        .map((e) => ({ ...e })),
    );
  }

  /**
   * @see StoreInterface.getAuditHeadId
   */
  async getAuditHeadId(): Promise<Result<number, LoreError>> {
    return ok(this.auditChain.length);
  }

  // ── Review Judgments ─────────────────────────────────────────────────────────

  async insertJudgment(judgment: ReviewJudgment): Promise<Result<void, LoreError>> {
    this.judgments.push({ ...judgment });
    return ok(undefined);
  }

  async findJudgments(docId: DocId, kind?: ReviewJudgmentKind): Promise<Result<ReviewJudgment[], LoreError>> {
    const matching = this.judgments
      .filter((j) => j.doc_id === docId && (kind === undefined || (j.kind ?? "review") === kind))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return ok(matching.map((j) => ({ ...j })));
  }

  async latestJudgment(
    docId: DocId,
    kind?: ReviewJudgmentKind,
  ): Promise<Result<ReviewJudgment | null, LoreError>> {
    const matchingResult = await this.findJudgments(docId, kind);
    if (!matchingResult.ok) return matchingResult;
    return ok(matchingResult.value[0] ?? null);
  }

  async latestJudgmentsByDocIds(
    docIds: DocId[],
    kind: ReviewJudgmentKind,
  ): Promise<Result<Map<DocId, ReviewJudgment>, LoreError>> {
    const result = new Map<DocId, ReviewJudgment>();
    if (docIds.length === 0) return ok(result);
    const idSet = new Set(docIds);
    const matching = this.judgments
      .filter((j) => idSet.has(j.doc_id) && (j.kind ?? "review") === kind)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    for (const j of matching) {
      if (!result.has(j.doc_id)) {
        result.set(j.doc_id, { ...j });
      }
    }
    return ok(result);
  }

  // ── Calibration Records ──────────────────────────────────────────────────────

  async insertCalibrationRecord(record: CalibrationRecord): Promise<Result<void, LoreError>> {
    this.calibrationRecords.push({ ...record });
    return ok(undefined);
  }

  async queryCalibrationWindow(
    filter: CalibrationWindowFilter,
  ): Promise<Result<CalibrationRecordWithPromptVersion[], LoreError>> {
    // reason: prompt_version filters on (AND, now unconditionally, is projected from)
    // the judgment a calibration record points at — mirrors the now-unconditional SQL
    // JOIN in SQLiteStore/TursoStore, kept as an in-memory lookup here since there's no
    // join operator on plain arrays. See SPEC-034 §3 / SPEC-035 calibration
    // disaggregation follow-up.
    const judgmentPromptVersionById = new Map(
      this.judgments.map((j) => [j.id, j.judge.prompt_version]),
    );
    // reason: judge_kind is projected the SAME way (SPEC-044 D12/AC-SP-11) — same
    // unconditional in-memory lookup, mirroring the SQL join's added `j.kind` column.
    const judgmentKindById = new Map(
      this.judgments.map((j) => [j.id, j.kind ?? "review"] as const),
    );

    let results = this.calibrationRecords.filter((record) => {
      if (filter.doc_type !== undefined && record.doc_type !== filter.doc_type) return false;
      if (
        filter.prompt_version !== undefined &&
        judgmentPromptVersionById.get(record.judgment_id) !== filter.prompt_version
      )
        return false;
      return true;
    });

    results = results.sort((a, b) => b.created_at.localeCompare(a.created_at));
    results = results.slice(0, filter.limit);

    const projected: CalibrationRecordWithPromptVersion[] = [];
    for (const record of results) {
      const judgePromptVersion = judgmentPromptVersionById.get(record.judgment_id);
      if (judgePromptVersion === undefined) {
        // reason: every calibration record is FK'd to a judgment by construction
        // (JudgmentService.recordCalibration always reads the judgment before
        // writing) — SQLiteStore/TursoStore enforce this at insert time via a DB
        // foreign key constraint. InMemoryStore has no such constraint, so reaching
        // this branch means a caller inserted an orphan record directly (test misuse,
        // not a normal runtime state). Fail loud rather than defaulting the label.
        return err({
          code: "STORE_ERROR",
          message: `queryCalibrationWindow: calibration record ${record.id} references unknown judgment_id ${record.judgment_id}`,
        });
      }
      const judgeKind = judgmentKindById.get(record.judgment_id) ?? "review";
      projected.push({ ...record, judge_prompt_version: judgePromptVersion, judge_kind: judgeKind });
    }

    return ok(projected);
  }

  // ── Trace Events (SPEC-102) ─────────────────────────────────────────────

  async insertTraceEvent(event: TraceEventInput): Promise<Result<void, LoreError>> {
    this.traceEvents.push({
      id: this.traceEvents.length + 1,
      ...event,
      details: event.details ?? {},
    });
    return ok(undefined);
  }

  async countTraceEventsByKind(window: TraceStatsWindow): Promise<Result<Record<string, number>, LoreError>> {
    const counts: Record<string, number> = {};
    for (const e of this.traceEvents) {
      if (e.ts < window.since) continue;
      counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    }
    return ok(counts);
  }

  async countTraceDenyByCheckpoint(
    window: TraceStatsWindow,
  ): Promise<Result<TraceDenyByCheckpoint[], LoreError>> {
    const buckets = new Map<string, number>();
    for (const e of this.traceEvents) {
      if (e.kind !== "gate_deny" || e.ts < window.since) continue;
      const checkpoint = e.checkpoint ?? "unknown";
      const details = e.details ?? {};
      const layer = typeof details["layer"] === "string" ? (details["layer"] as string) : "unknown";
      const key = `${checkpoint}${TRACE_BUCKET_KEY_SEP}${layer}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    return ok(
      [...buckets.entries()].map(([key, count]) => {
        const [checkpoint = "unknown", layer = "unknown"] = key.split(TRACE_BUCKET_KEY_SEP);
        return { checkpoint, layer, count };
      }),
    );
  }

  async listTraceZeroHitSearches(
    window: TraceStatsWindow,
    opts?: TraceZeroHitListOpts,
  ): Promise<Result<TraceZeroHitSearch[], LoreError>> {
    // reason: the `query` KEY is omitted entirely when raw queries were not
    // requested — mirrors SQLiteStore/TursoStore exactly (see their notes); the
    // test double must project the SAME absent-vs-empty distinction or a unit
    // test would certify a privacy boundary production does not have.
    const includeRawQueries = opts?.includeRawQueries === true;
    const rows = this.traceEvents
      .filter((e) => e.kind === "search" && e.hit_count === 0 && e.ts >= window.since)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .map((e) => {
        const details = e.details ?? {};
        const rawQuery = typeof details["query"] === "string" ? (details["query"] as string) : "";
        return {
          ts: e.ts,
          actor: e.actor,
          ...(includeRawQueries ? { query: rawQuery } : {}),
        };
      });
    return ok(rows);
  }

  async listNeverReadDocs(window: TraceStatsWindow): Promise<Result<NeverReadDoc[], LoreError>> {
    const readDocIds = new Set(
      this.traceEvents
        .filter((e) => e.kind === "get" && e.doc_id !== undefined && e.ts >= window.since)
        .map((e) => e.doc_id as string),
    );
    const rows: NeverReadDoc[] = [];
    for (const doc of this.docs.values()) {
      if (doc.deleted_at !== null) continue;
      if (readDocIds.has(doc.id)) continue;
      rows.push({ id: doc.id, slug: doc.slug });
    }
    // Matches SQLiteStore/TursoStore's `ORDER BY slug ASC, id ASC`.
    rows.sort((a, b) => a.slug.localeCompare(b.slug) || a.id.localeCompare(b.id));
    return ok(rows);
  }

  async countTraceZeroHitSearches(window: TraceStatsWindow): Promise<Result<number, LoreError>> {
    // reason: DERIVED from the member list, never a second tally — see
    // StoreInterface.countTraceZeroHitSearches's own ⛔ note.
    const listResult = await this.listTraceZeroHitSearches(window);
    if (!listResult.ok) return listResult;
    return ok(listResult.value.length);
  }

  async countNeverReadDocs(window: TraceStatsWindow): Promise<Result<number, LoreError>> {
    // reason: DERIVED from the member list — see listNeverReadDocs above.
    const listResult = await this.listNeverReadDocs(window);
    if (!listResult.ok) return listResult;
    return ok(listResult.value.length);
  }

  async listTraceGateDenies(window: TraceStatsWindow): Promise<Result<TraceGateDenyEvent[], LoreError>> {
    const rows = this.traceEvents
      .filter((e) => e.kind === "gate_deny" && e.ts >= window.since)
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .map((e) => ({ ts: e.ts, actor: e.actor, checkpoint: e.checkpoint ?? "unknown" }));
    return ok(rows);
  }

  async listTraceRawSearchQueries(
    window: TraceStatsWindow,
  ): Promise<Result<TraceRawSearchQuery[], LoreError>> {
    const rows = this.traceEvents
      .filter((e) => e.kind === "search" && e.ts >= window.since)
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .map((e) => {
        const details = e.details ?? {};
        return {
          ts: e.ts,
          actor: e.actor,
          query: typeof details["query"] === "string" ? (details["query"] as string) : "",
        };
      });
    return ok(rows);
  }

  async pruneTraceEvents(cutoffIso: string, batchSize = 50_000): Promise<Result<number, LoreError>> {
    let deleted = 0;
    for (let i = this.traceEvents.length - 1; i >= 0 && deleted < batchSize; i--) {
      const e = this.traceEvents[i];
      if (e !== undefined && e.ts < cutoffIso) {
        this.traceEvents.splice(i, 1);
        deleted++;
      }
    }
    return ok(deleted);
  }

  // ── Runs (migration-016) ──────────────────────────────────────────────────

  async insertRun(run: RunRecord): Promise<Result<void, LoreError>> {
    // reason: first registration wins — mirrors SQLite's INSERT OR IGNORE on the PK.
    if (!this.runs.has(run.id)) this.runs.set(run.id, structuredClone(run));
    return ok(undefined);
  }

  async getRun(id: RunId): Promise<Result<RunRecord | null, LoreError>> {
    const run = this.runs.get(id);
    return ok(run === undefined ? null : structuredClone(run));
  }

  async listRunsByAgentRef(agentRef: string): Promise<Result<RunRecord[], LoreError>> {
    const rows = [...this.runs.values()]
      .filter((run) => run.agentRef === agentRef)
      .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt) || a.id.localeCompare(b.id));
    return ok(rows.map((run) => structuredClone(run)));
  }

  async endRun(id: RunId, endedAt: string, reason: string): Promise<Result<RunEndOutcome, LoreError>> {
    if (!this.runs.has(id)) return ok("unknown-run");
    // reason: first end wins — mirrors SQLite's `WHERE ended_at IS NULL`.
    if (this.runEnds.has(id)) return ok("already-ended");
    this.runEnds.set(id, { endedAt, endReason: reason });
    return ok("ended");
  }

  async reopenRun(id: RunId): Promise<Result<boolean, LoreError>> {
    return ok(this.runEnds.delete(id));
  }

  async getRunEnd(id: RunId): Promise<Result<RunEndState | null, LoreError>> {
    if (!this.runs.has(id)) return ok(null);
    return ok(this.runEnds.get(id) ?? { endedAt: null, endReason: null });
  }

  async recordRunProcess(id: RunId, proc: RunProcessRecord): Promise<Result<boolean, LoreError>> {
    if (!this.runs.has(id)) return ok(false);
    // reason: newest registration wins — mirrors SQLite's unconditional UPDATE (a resumed run lives in a new process).
    this.runProcesses.set(id, { ...proc });
    return ok(true);
  }

  async listRunLifecycles(): Promise<Result<RunLifecycle[], LoreError>> {
    const rows = [...this.runs.values()].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.id.localeCompare(b.id));
    return ok(
      rows.map((run) => {
        const end = this.runEnds.get(run.id);
        return {
          id: run.id,
          registeredAt: run.registeredAt,
          endedAt: end?.endedAt ?? null,
          endReason: end?.endReason ?? null,
          parentRunId: run.parentRunId,
          agentRef: run.agentRef,
          process: { ...(this.runProcesses.get(run.id) ?? { pid: null, startTime: null, worktree: null }) },
        };
      }),
    );
  }

  async countAttributedWrites(
    windowStart: string,
    kinds: readonly string[],
  ): Promise<Result<AttributedWriteCount, LoreError>> {
    if (kinds.length === 0) return emptyKindsError();
    let total = 0;
    let attested = 0;
    for (const e of this.auditChain) {
      if (e.timestamp < windowStart || !kinds.includes(e.action)) continue;
      total++;
      if (e.harness_run != null) attested++;
    }
    return ok({ total, attested });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** No-op — no underlying connection to close. */
  close(): void {
    // intentionally empty — in-memory store has no resources to release
  }

  async maxDocVersion(): Promise<Result<number, LoreError>> {
    let max = 0;
    for (const doc of this.docs.values()) {
      if (doc.deleted_at === null && doc.version > max) max = doc.version;
    }
    return ok(max);
  }

  /** No disk footprint — always reports 0 bytes. */
  async dbSizeBytes(): Promise<Result<number, LoreError>> {
    return ok(0);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Id of the doc that ALREADY holds `slug`, or `null` when no doc does.
   *
   * Sole caller: {@link insert}'s `DUPLICATE_SLUG` branch. This store has
   * always resolved the winner here; the two SQL-backed stores reported the
   * REJECTED doc's own id until
   * task-skill-implement-duplicate-slug-existing-id-names-the gave each of
   * them the equivalent lookup (`SQLiteStore.findSlugConflictIdSync`,
   * `TursoStore.findSlugConflictId`). ⛔ That asymmetry was invisible to every
   * vitest unit test precisely BECAUSE this store — the test double — was the
   * correct one; the oracle therefore lives in
   * `tests/unit/store/sqlite-store.bun.test.ts` under `bun test`.
   *
   * ⛔ Scans soft-deleted docs too, deliberately: `docs.slug` is UNIQUE at the
   * COLUMN level in both SQL stores (`migrations/migration-006.ts:103`), so a
   * soft-deleted row still holds its slug and still refuses the insert.
   * Skipping `deleted_at !== null` docs here would make this store ACCEPT an
   * insert both SQL stores reject.
   */
  private findSlugConflict(slug: Slug): DocId | null {
    for (const doc of this.docs.values()) {
      if (doc.slug === slug) {
        return doc.id;
      }
    }
    return null;
  }
}

// ── Module-level helpers ───────────────────────────────────────────────────

/**
 * Faithful in-memory equivalent of SQLiteStore/TursoStore's
 * `json_extract(extra, '$.sub_type') = ?` predicate — see
 * {@link StoreFilters.sub_type}.
 *
 * Parity notes, each mirroring what SQLite actually does rather than what reads
 * nicer here:
 *   - a doc with NO `sub_type` key does NOT match any value (`json_extract`
 *     returns SQL NULL, and `NULL = ?` is never true) — so this returns `false`,
 *     never "unfiltered".
 *   - a non-string `sub_type` (a corrupted/legacy row) does NOT match either;
 *     the strict `===` stands in for SQL's type-affinity compare.
 *
 * `doc.extra` is typed `Record<string, unknown>` but a hand-built unit-test
 * fixture can legitimately hand this a `null`/non-object value at runtime, so
 * the read is defensive (same reasoning as `@lore/core`'s
 * `doc-type-meta.ts::safeExtra`).
 *
 * Side-effect class: pure.
 *
 * @param doc - The candidate document.
 * @param subType - The value being filtered for.
 * @returns `true` iff the doc's `extra.sub_type` is exactly `subType`.
 */
function matchesSubType(doc: DocRecord, subType: string): boolean {
  const extra: unknown = doc.extra;
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return false;
  return (extra as Record<string, unknown>)["sub_type"] === subType;
}

/**
 * Extract a short snippet from content that includes the match context.
 * Returns at most 120 chars around the first match, or the first 120 chars
 * if the term appears near the start.
 *
 * The matched span is wrapped in {@link SNIPPET_MARK_OPEN}/
 * {@link SNIPPET_MARK_CLOSE} (SPEC-037 §2 D5) — mirrors SQLiteStore/TursoStore's
 * FTS5 `snippet()` delimiters so this in-memory fake is a faithful test
 * double for the highlight contract. The sentinels are inserted around the
 * matched substring only; any literal `[`/`]` characters already present in
 * `content` pass through untouched and are never mistaken for highlights.
 */
function buildSnippet(content: string, lowerQuery: string): string {
  const lowerContent = content.toLowerCase();
  const idx = lowerContent.indexOf(lowerQuery);

  if (idx === -1) {
    return content.slice(0, 120);
  }

  const start = Math.max(0, idx - 30);
  const end = Math.min(content.length, idx + lowerQuery.length + 60);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  const before = content.slice(start, idx);
  const match = content.slice(idx, idx + lowerQuery.length);
  const after = content.slice(idx + lowerQuery.length, end);
  return (
    prefix +
    before +
    SNIPPET_MARK_OPEN +
    match +
    SNIPPET_MARK_CLOSE +
    after +
    suffix
  );
}
