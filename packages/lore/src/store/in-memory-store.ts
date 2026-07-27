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
import type {
  AuditChainEntry,
  AuditFilters,
  CalibrationRecordWithPromptVersion,
  CalibrationWindowFilter,
  SearchHit,
  StoreFilters,
  StoreInterface,
  UpdateOpts,
} from "./store-interface.js";
import { allocateWithBoundedRetry, computeAuditEntryHash } from "./store-shared.js";

// ─── InMemoryStore ─────────────────────────────────────────────────────────────

export class InMemoryStore implements StoreInterface {
  private readonly docs = new Map<DocId, DocRecord>();
  private links: LinkRecord[] = [];
  private readonly versions: VersionRecord[] = [];
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
  private readonly judgments: ReviewJudgment[] = [];
  private readonly calibrationRecords: CalibrationRecord[] = [];

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
  ): Promise<Result<DocRecord, LoreError>> {
    const before = this.docs.get(id);

    const updateResult = await this.update(id, patch, opts);
    if (!updateResult.ok) return updateResult;

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

    return ok(updateResult.value);
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

  // ── Links ─────────────────────────────────────────────────────────────────

  async addLink(link: LinkRecord): Promise<Result<LinkRecord, LoreError>> {
    if (link.link_type === "parent") {
      const cycleResult = this.detectParentCycle(link.from_id, link.to_id);
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
   * Detect whether adding a parent link from_id → to_id would create a cycle.
   * Mirrors SQLiteStore.detectParentCycle — iterative walk up the parent chain.
   * A self-link (from_id === to_id) is always a cycle.
   */
  private detectParentCycle(
    fromId: DocId,
    toId: DocId,
  ): Result<void, LoreError> {
    if (fromId === toId) {
      return err({ code: "LINK_CYCLE", path: [fromId] });
    }

    const path: string[] = [fromId, toId];
    let current = toId;

    while (true) {
      const parentLink = this.links.find(
        (l) => l.from_id === current && l.link_type === "parent",
      );

      if (!parentLink) break;

      const parentId = parentLink.to_id;
      if (parentId === fromId) {
        return err({ code: "LINK_CYCLE", path: [...path, parentId] });
      }
      path.push(parentId);
      current = parentId;
    }

    return ok(undefined);
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
    this.versions.push({ ...version });
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
  async appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>> {
    const head = this.auditChain[this.auditChain.length - 1];
    const prevHash = head?.entry_hash ?? "";
    const entryHash = computeAuditEntryHash(entry, prevHash);
    this.auditChain.push({
      ...entry,
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
   * @see StoreInterface.listAuditChain
   */
  async listAuditChain(): Promise<Result<AuditChainEntry[], LoreError>> {
    // reason: auditChain is already in id ASC order by construction — every
    // appendAuditEntry call pushes to the end, so array order IS insertion
    // (chain-construction) order. No sort needed, mirroring the real
    // stores' `ORDER BY id ASC`.
    return ok(this.auditChain.map((e) => ({ ...e })));
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

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** No-op — no underlying connection to close. */
  close(): void {
    // intentionally empty — in-memory store has no resources to release
  }

  /** No disk footprint — always reports 0 bytes. */
  async dbSizeBytes(): Promise<Result<number, LoreError>> {
    return ok(0);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

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
