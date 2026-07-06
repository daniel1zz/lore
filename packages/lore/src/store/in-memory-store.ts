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
  LinkRecord,
  LinkType,
  ReviewJudgment,
  Slug,
  VersionRecord,
} from "@lore/core";
import { err, ok, type LoreError, type Result } from "@lore/core";
import type {
  AuditFilters,
  CalibrationWindowFilter,
  SearchHit,
  StoreFilters,
  StoreInterface,
  UpdateOpts,
} from "./store-interface.js";

// ─── InMemoryStore ─────────────────────────────────────────────────────────────

export class InMemoryStore implements StoreInterface {
  private readonly docs = new Map<DocId, DocRecord>();
  private links: LinkRecord[] = [];
  private readonly versions: VersionRecord[] = [];
  private readonly audit: AuditEntry[] = [];
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

    // Sort by updated_at DESC to match SQLiteStore order
    results.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

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
        hits.push({
          id: doc.id,
          slug: doc.slug,
          title: doc.title,
          snippet,
          score: 0,
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

  // ── Audit ─────────────────────────────────────────────────────────────────

  async appendAuditEntry(entry: AuditEntry): Promise<Result<void, LoreError>> {
    this.audit.push({ ...entry });
    return ok(undefined);
  }

  async queryAudit(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>> {
    let results = this.audit.filter((entry) => {
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

    return ok(results.map((e) => ({ ...e })));
  }

  // ── Review Judgments ─────────────────────────────────────────────────────────

  async insertJudgment(judgment: ReviewJudgment): Promise<Result<void, LoreError>> {
    this.judgments.push({ ...judgment });
    return ok(undefined);
  }

  async findJudgments(docId: DocId): Promise<Result<ReviewJudgment[], LoreError>> {
    const matching = this.judgments
      .filter((j) => j.doc_id === docId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return ok(matching.map((j) => ({ ...j })));
  }

  async latestJudgment(docId: DocId): Promise<Result<ReviewJudgment | null, LoreError>> {
    const matchingResult = await this.findJudgments(docId);
    if (!matchingResult.ok) return matchingResult;
    return ok(matchingResult.value[0] ?? null);
  }

  // ── Calibration Records ──────────────────────────────────────────────────────

  async insertCalibrationRecord(record: CalibrationRecord): Promise<Result<void, LoreError>> {
    this.calibrationRecords.push({ ...record });
    return ok(undefined);
  }

  async queryCalibrationWindow(
    filter: CalibrationWindowFilter,
  ): Promise<Result<CalibrationRecord[], LoreError>> {
    // reason: prompt_version filters on the judgment a calibration record points
    // at — mirrors the SQL JOIN in SQLiteStore/TursoStore, kept as an in-memory
    // lookup here since there's no join operator on plain arrays.
    const judgmentPromptVersionById = new Map(
      this.judgments.map((j) => [j.id, j.judge.prompt_version]),
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

    return ok(results.map((r) => ({ ...r })));
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
  return prefix + content.slice(start, end) + suffix;
}
