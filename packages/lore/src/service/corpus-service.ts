/**
 * CorpusService — primary CRUD + graph + search service for the Lore corpus.
 * All methods return Promise<Result<T, LoreError>>. No thrown exceptions cross this boundary.
 * Source: SPEC-001 §3.1
 */

import { ulid } from "ulidx";
import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import {
  createDocInputSchema,
  docPatchSchema,
  slugifyWithCollision,
} from "@lore/core";
import type { CreateDocInput, DocPatch } from "@lore/core";
import {
  DOC_TYPE_ROLE_MAP,
  type DocId,
  type DocRecord,
  type DocStatus,
  type DocSummary,
  type DocType,
  type LinkRecord,
  type LinkType,
} from "@lore/core";
import { isValidParentType, PARENT_TYPE_CONTRACT } from "@lore/core";
import type {
  SearchHit,
  StoreInterface,
} from "../store/store-interface.js";
import { NoOpTelemetry, type Telemetry, type TelemetryEvent } from "@lore/core";

// ─── Local types (mirror SPEC-001 §3.1 interfaces) ────────────────────────

/** ULID regex — 26 uppercase/digit chars */
const ULID_RE = /^[0-9A-Z]{26}$/;

/** Check if input looks like a ULID */
function isUlid(input: string): boolean {
  return ULID_RE.test(input);
}

export interface GetOpts {
  resolve_mdx?: boolean;
}

export interface DocWithNavigation {
  doc: DocRecord;
  navigation: {
    parent: DocSummary | null;
    siblings: DocSummary[];
    children: DocSummary[];
    related: Array<DocSummary & { link_type: LinkType }>;
  };
  resolved_components?: ResolvedComponent[];
}

export interface ResolvedComponent {
  placeholder: string;
  docs: DocSummary[];
}

export interface ListFilters {
  type?: DocType;
  status?: DocStatus;
  parent_id?: DocId;
  created_by?: string;
  since?: string;
  tags?: string[];
}

export interface SearchFilters {
  type?: DocType;
  status?: DocStatus;
  tags?: string[];
}

export interface TreeOpts {
  depth?: number;
}

export interface TreeNode {
  doc: DocSummary;
  children: TreeNode[];
}

export interface CorpusStatus {
  total_docs: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  last_updated: string;
  db_size_bytes: number;
}

// ─── CorpusService ─────────────────────────────────────────────────────────

export class CorpusService {
  private readonly telemetry: Telemetry;

  /**
   * @param store - Storage abstraction (SQLiteStore, TursoStore, or InMemoryStore)
   * @param telemetry - Telemetry sink for instrumented methods (defaults to NoOp)
   */
  constructor(
    private readonly store: StoreInterface,
    telemetry: Telemetry = new NoOpTelemetry(),
  ) {
    this.telemetry = telemetry;
  }

  /**
   * Record a telemetry event for a service call outcome.
   * Never throws — delegates to Telemetry.record() which swallows IO errors.
   *
   * @param method - CorpusService method name
   * @param startMs - High-resolution start time from Date.now()
   * @param result - The Result from the service call
   * @param meta - Optional extra context
   */
  private recordTelemetryEvent<T>(
    method: string,
    startMs: number,
    result: Result<T, LoreError>,
    meta?: Record<string, unknown>,
  ): void {
    const event: TelemetryEvent = {
      ts: new Date().toISOString(),
      service: "CorpusService",
      method,
      ok: result.ok,
      duration_ms: Date.now() - startMs,
      ...(!result.ok ? { error_code: result.error.code } : {}),
      ...(meta !== undefined ? { meta } : {}),
    };
    this.telemetry.record(event);
  }

  // ── Resolve ──────────────────────────────────────────────────────────────

  /**
   * Resolve any string input to a DocId.
   * ULID format → find by id. Otherwise → find by slug.
   * If not found, return DOC_NOT_FOUND with fuzzy suggestions (substring on slugs).
   */
  async resolve(input: string): Promise<Result<DocId, LoreError>> {
    if (isUlid(input)) {
      const findResult = await this.store.find(input);
      if (!findResult.ok) return findResult;
      if (findResult.value !== null) return ok(findResult.value.id);

      const suggestions = await this.buildSuggestions(input);
      return err({ code: "DOC_NOT_FOUND", id: input, suggestions });
    }

    const slugResult = await this.store.findBySlug(input);
    if (!slugResult.ok) return slugResult;
    if (slugResult.value !== null) return ok(slugResult.value.id);

    const suggestions = await this.buildSlugSuggestions(input);
    return err({ code: "DOC_NOT_FOUND", id: input, suggestions });
  }

  // ── Create ───────────────────────────────────────────────────────────────

  /**
   * Create a new document.
   * Validates via createDocInputSchema, generates ULID + slug, resolves parent,
   * inserts doc + version record + audit entry.
   * Telemetry: records one event with doc type and resulting id/slug on success.
   */
  async create(input: CreateDocInput): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._createImpl(input);
    this.recordTelemetryEvent("create", startMs, result, { type: input.type });
    return result;
  }

  private async _createImpl(input: CreateDocInput): Promise<Result<DocRecord, LoreError>> {
    const parsed = createDocInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      if (!issue) {
        return err({ code: "VALIDATION_ERROR", field: "input", message: "Invalid input" });
      }

      // Map PARENT_REQUIRED specifically
      if (
        issue.path.includes("parent_id") &&
        issue.message.includes("required")
      ) {
        return err({ code: "PARENT_REQUIRED", type: input.type });
      }

      return err({
        code: "VALIDATION_ERROR",
        field: String(issue.path.join(".")),
        message: issue.message,
        value: issue.path.reduce<unknown>((obj, key) => {
          if (typeof obj === "object" && obj !== null) {
            return (obj as Record<string, unknown>)[String(key)];
          }
          return undefined;
        }, input),
      });
    }

    const data = parsed.data;

    // Resolve parent if provided
    let resolvedParentId: DocId | null = null;
    if (data.parent_id) {
      const parentResult = await this.resolve(data.parent_id);
      if (!parentResult.ok) return parentResult;
      resolvedParentId = parentResult.value;

      // Verify parent exists and is not soft-deleted, then enforce type contract
      const parentDocResult = await this.store.find(resolvedParentId);
      if (!parentDocResult.ok) return parentDocResult;
      const parentDoc = parentDocResult.value;
      if (parentDoc === null || parentDoc.deleted_at !== null) {
        return err({ code: "DOC_NOT_FOUND", id: resolvedParentId });
      }
      if (!isValidParentType(data.type, parentDoc.type)) {
        return err({
          code: "INVALID_PARENT_TYPE",
          child: data.type,
          parent: parentDoc.type,
          allowed: [...PARENT_TYPE_CONTRACT[data.type]],
        });
      }
    }

    // Cross-entity phase validation for tasks with extra.phase (AC-PHASE-3, SPEC-023 §4).
    // reason: Zod cannot express cross-document constraints — must be enforced in service layer.
    // Three sub-cases: (1) parent has no phases → VALIDATION_ERROR, (2) phase name not found
    // → VALIDATION_ERROR, (3) phase found → proceed. Tasks without extra.phase bypass this check.
    if (data.type === "task" && resolvedParentId !== null) {
      const taskPhase =
        typeof data.extra?.["phase"] === "string" ? (data.extra["phase"] as string) : undefined;
      if (taskPhase !== undefined) {
        const parentForPhaseResult = await this.store.find(resolvedParentId);
        if (!parentForPhaseResult.ok) return parentForPhaseResult;
        const parentForPhase = parentForPhaseResult.value;
        if (parentForPhase !== null) {
          const declaredPhases = parentForPhase.extra["phases"];
          const phasesArray = Array.isArray(declaredPhases) ? declaredPhases : null;
          if (!phasesArray || phasesArray.length === 0) {
            return err({
              code: "VALIDATION_ERROR",
              field: "extra.phase",
              message: `task references phase "${taskPhase}" but parent plan declares no phases`,
              value: taskPhase,
            });
          }
          const match = phasesArray.find(
            (p): p is { name: string; description?: string } =>
              typeof p === "object" && p !== null && (p as Record<string, unknown>)["name"] === taskPhase,
          );
          if (!match) {
            const knownNames = phasesArray
              .filter((p): p is { name: string } => typeof p === "object" && p !== null)
              .map((p) => (p as { name: string }).name)
              .join(", ");
            return err({
              code: "VALIDATION_ERROR",
              field: "extra.phase",
              message: `unknown phase "${taskPhase}"; parent plan declares: [${knownNames}]`,
              value: taskPhase,
            });
          }
        }
      }
    }

    const id = ulid() as DocId;
    const now = new Date().toISOString();
    const role = DOC_TYPE_ROLE_MAP[data.type];

    // Generate collision-free slug
    const slug = await slugifyWithCollision(data.type, data.title, async (candidate) => {
      const r = await this.store.findBySlug(candidate);
      return r.ok && r.value !== null;
    });

    const doc: DocRecord = {
      id,
      slug,
      type: data.type,
      role,
      title: data.title,
      status: "draft",
      priority: data.priority ?? "medium",
      content: data.content ?? "",
      parent_id: resolvedParentId,
      created_at: now,
      updated_at: now,
      created_by: "system",
      version: 1,
      deleted_at: null,
      tags: data.tags ?? [],
      extra: data.extra ?? {},
    };

    const insertResult = await this.store.insert(doc);
    if (!insertResult.ok) return insertResult;

    const versionResult = await this.store.insertVersion({
      doc_id: id,
      version: 1,
      content: doc.content,
      extra: doc.extra,
      status: doc.status,
      title: doc.title,
      action: "create",
      created_at: now,
      created_by: doc.created_by,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: "system",
      session_id: id,
      action: "create",
      doc_id: id,
      details: { type: doc.type, slug: doc.slug },
    });
    if (!auditResult.ok) return auditResult;

    return ok(insertResult.value);
  }

  // ── Get ──────────────────────────────────────────────────────────────────

  /**
   * Get a document with navigation context.
   * Builds parent, siblings, children, and related link lists.
   * Telemetry: records one event with the resolved id on success.
   */
  async get(idOrSlug: string, _opts?: GetOpts): Promise<Result<DocWithNavigation, LoreError>> {
    const startMs = Date.now();
    const result = await this._getImpl(idOrSlug, _opts);
    this.recordTelemetryEvent("get", startMs, result, { idOrSlug });
    return result;
  }

  private async _getImpl(idOrSlug: string, _opts?: GetOpts): Promise<Result<DocWithNavigation, LoreError>> {
    const resolveResult = await this.resolve(idOrSlug);
    if (!resolveResult.ok) return resolveResult;

    const findResult = await this.store.find(resolveResult.value);
    if (!findResult.ok) return findResult;
    if (findResult.value === null) {
      return err({ code: "DOC_NOT_FOUND", id: resolveResult.value });
    }

    const doc = findResult.value;

    // Parent
    let parent: DocSummary | null = null;
    if (doc.parent_id !== null) {
      const parentResult = await this.store.find(doc.parent_id);
      if (parentResult.ok && parentResult.value !== null) {
        parent = toDocSummary(parentResult.value);
      }
    }

    // Siblings — same parent (excluding self)
    let siblings: DocSummary[] = [];
    if (doc.parent_id !== null) {
      const siblingsResult = await this.store.findMany({ parent_id: doc.parent_id });
      if (siblingsResult.ok) {
        siblings = siblingsResult.value
          .filter((d) => d.id !== doc.id)
          .map(toDocSummary);
      }
    }

    // Children — docs where parent_id = this doc's id
    const childrenResult = await this.store.findMany({ parent_id: doc.id });
    const children: DocSummary[] = childrenResult.ok
      ? childrenResult.value.map(toDocSummary)
      : [];

    // Related — non-parent outbound links
    const linksResult = await this.store.findLinks(doc.id, "both");
    const related: Array<DocSummary & { link_type: LinkType }> = [];

    if (linksResult.ok) {
      for (const link of linksResult.value) {
        if (link.link_type === "parent") continue;

        // Determine the "other" side of the link
        const otherId = link.from_id === doc.id ? link.to_id : link.from_id;
        const otherResult = await this.store.find(otherId);
        if (otherResult.ok && otherResult.value !== null) {
          related.push({ ...toDocSummary(otherResult.value), link_type: link.link_type });
        }
      }
    }

    return ok({
      doc,
      navigation: { parent, siblings, children, related },
    });
  }

  // ── Set ──────────────────────────────────────────────────────────────────

  /**
   * Patch a document.
   * If patching content or title on an 'approved' doc, resets status to 'draft'.
   * Increments version and creates a version record.
   */
  async set(idOrSlug: string, patch: DocPatch): Promise<Result<DocRecord, LoreError>> {
    const parsedPatch = docPatchSchema.safeParse(patch);
    if (!parsedPatch.success) {
      const issue = parsedPatch.error.issues[0];
      return err({
        code: "VALIDATION_ERROR",
        field: issue ? String(issue.path.join(".")) : "patch",
        message: issue ? issue.message : "Invalid patch",
      });
    }

    const resolveResult = await this.resolve(idOrSlug);
    if (!resolveResult.ok) return resolveResult;

    const findResult = await this.store.find(resolveResult.value);
    if (!findResult.ok) return findResult;
    if (findResult.value === null) {
      return err({ code: "DOC_NOT_FOUND", id: resolveResult.value });
    }

    const existing = findResult.value;
    const now = new Date().toISOString();

    // Reset to draft if content/title changed on approved doc
    let newStatus = parsedPatch.data.status ?? existing.status;
    const contentOrTitleChanged =
      parsedPatch.data.content !== undefined || parsedPatch.data.title !== undefined;
    if (existing.status === "approved" && contentOrTitleChanged) {
      newStatus = "draft";
    }

    const newVersion = existing.version + 1;

    // Build patch explicitly — exactOptionalPropertyTypes requires no undefined values in Partial<DocRecord>
    const docPatch: Partial<DocRecord> = {
      status: newStatus,
      version: newVersion,
      updated_at: now,
    };
    if (parsedPatch.data.title !== undefined) docPatch.title = parsedPatch.data.title;
    if (parsedPatch.data.content !== undefined) docPatch.content = parsedPatch.data.content;
    if (parsedPatch.data.priority !== undefined) docPatch.priority = parsedPatch.data.priority;
    if (parsedPatch.data.tags !== undefined) docPatch.tags = parsedPatch.data.tags;
    if (parsedPatch.data.extra !== undefined) docPatch.extra = parsedPatch.data.extra;
    if (parsedPatch.data.slug !== undefined) docPatch.slug = parsedPatch.data.slug;

    // Cross-entity phase validation when updating a task's extra.phase (AC-PHASE-3, SPEC-023 §4).
    // reason: same constraint as create — must validate phase against parent plan at write time.
    if (existing.type === "task" && parsedPatch.data.extra !== undefined) {
      const newPhase = parsedPatch.data.extra["phase"];
      if (typeof newPhase === "string" && existing.parent_id !== null) {
        const parentForPhaseResult = await this.store.find(existing.parent_id);
        if (!parentForPhaseResult.ok) return parentForPhaseResult;
        const parentForPhase = parentForPhaseResult.value;
        if (parentForPhase !== null) {
          const declaredPhases = parentForPhase.extra["phases"];
          const phasesArray = Array.isArray(declaredPhases) ? declaredPhases : null;
          if (!phasesArray || phasesArray.length === 0) {
            return err({
              code: "VALIDATION_ERROR",
              field: "extra.phase",
              message: `task references phase "${newPhase}" but parent plan declares no phases`,
              value: newPhase,
            });
          }
          const match = phasesArray.find(
            (p): p is { name: string; description?: string } =>
              typeof p === "object" && p !== null && (p as Record<string, unknown>)["name"] === newPhase,
          );
          if (!match) {
            const knownNames = phasesArray
              .filter((p): p is { name: string } => typeof p === "object" && p !== null)
              .map((p) => (p as { name: string }).name)
              .join(", ");
            return err({
              code: "VALIDATION_ERROR",
              field: "extra.phase",
              message: `unknown phase "${newPhase}"; parent plan declares: [${knownNames}]`,
              value: newPhase,
            });
          }
        }
      }
    }

    const updateResult = await this.store.update(existing.id, docPatch, { expected_version: existing.version });
    if (!updateResult.ok) return updateResult;

    const versionResult = await this.store.insertVersion({
      doc_id: existing.id,
      version: newVersion,
      content: updateResult.value.content,
      extra: updateResult.value.extra,
      status: updateResult.value.status,
      title: updateResult.value.title,
      action: "update",
      created_at: now,
      created_by: "system",
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: "system",
      session_id: existing.id,
      action: "update",
      doc_id: existing.id,
      details: { patch: parsedPatch.data, new_version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(updateResult.value);
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  /**
   * Soft-delete a document.
   * Requires confirm=true, otherwise returns DELETE_REQUIRES_CONFIRM.
   */
  async delete(
    idOrSlug: string,
    confirm: boolean,
  ): Promise<Result<{ id: DocId; recoverable_until: string }, LoreError>> {
    if (!confirm) {
      // Resolve ID for the error even without confirm
      const r = await this.resolve(idOrSlug);
      const id = r.ok ? r.value : idOrSlug;
      return err({ code: "DELETE_REQUIRES_CONFIRM", id });
    }

    const resolveResult = await this.resolve(idOrSlug);
    if (!resolveResult.ok) return resolveResult;

    const id = resolveResult.value;
    const deleteResult = await this.store.softDelete(id);
    if (!deleteResult.ok) return deleteResult;

    const now = new Date().toISOString();
    const recoverableUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    const versionResult = await this.store.insertVersion({
      doc_id: id,
      version: 0,
      content: "",
      extra: {},
      status: "archived",
      title: "",
      action: "delete",
      created_at: now,
      created_by: "system",
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: "system",
      session_id: id,
      action: "delete",
      doc_id: id,
      details: { recoverable_until: recoverableUntil },
    });
    if (!auditResult.ok) return auditResult;

    return ok({ id, recoverable_until: recoverableUntil });
  }

  // ── List ─────────────────────────────────────────────────────────────────

  /**
   * List documents matching filters. Returns DocSummary[] with total count.
   * Telemetry: records one event with filter type (if any) and result count.
   */
  async list(filters: ListFilters): Promise<Result<{ docs: DocSummary[]; total: number }, LoreError>> {
    const startMs = Date.now();
    const storeResult = await this.store.findMany(filters);
    if (!storeResult.ok) {
      this.recordTelemetryEvent("list", startMs, storeResult, { filter_type: filters.type });
      return storeResult;
    }

    const docs = storeResult.value.map(toDocSummary);
    const result = ok({ docs, total: docs.length });
    this.recordTelemetryEvent("list", startMs, result, { filter_type: filters.type, count: docs.length });
    return result;
  }

  /**
   * List documents matching filters, returning full DocRecord rows (including extra).
   * Use this when extra fields are needed (e.g. phase grouping in tree, phase filter in list).
   * Callers that only need display fields should use list() to avoid carrying extra payload.
   *
   * @param filters - Same filter set as list()
   * @returns Full DocRecord array (not stripped to DocSummary)
   */
  async listFull(filters: ListFilters): Promise<Result<{ docs: DocRecord[]; total: number }, LoreError>> {
    const storeResult = await this.store.findMany(filters);
    if (!storeResult.ok) return storeResult;
    return ok({ docs: storeResult.value, total: storeResult.value.length });
  }

  // ── Search ───────────────────────────────────────────────────────────────

  /**
   * Full-text search delegated to store.
   * Telemetry: records one event with query length and result count.
   */
  async search(
    query: string,
    filters?: SearchFilters,
  ): Promise<Result<{ results: SearchHit[] }, LoreError>> {
    const startMs = Date.now();
    const storeResult = await this.store.search(query, filters);
    if (!storeResult.ok) {
      this.recordTelemetryEvent("search", startMs, storeResult, { query_length: query.length });
      return storeResult;
    }
    const result = ok({ results: storeResult.value });
    this.recordTelemetryEvent("search", startMs, result, { query_length: query.length, hits: storeResult.value.length });
    return result;
  }

  // ── Tree ─────────────────────────────────────────────────────────────────

  /**
   * Build a document tree starting from rootIdOrSlug (or first PRD if none given).
   * Depth defaults to 3.
   */
  async tree(rootIdOrSlug?: string, opts?: TreeOpts): Promise<Result<TreeNode, LoreError>> {
    const depth = opts?.depth ?? 3;

    let rootDoc: DocRecord;

    if (rootIdOrSlug) {
      const resolveResult = await this.resolve(rootIdOrSlug);
      if (!resolveResult.ok) return resolveResult;

      const findResult = await this.store.find(resolveResult.value);
      if (!findResult.ok) return findResult;
      if (findResult.value === null) {
        return err({ code: "DOC_NOT_FOUND", id: resolveResult.value });
      }
      rootDoc = findResult.value;
    } else {
      // Find first PRD
      const prdsResult = await this.store.findMany({ type: "prd" });
      if (!prdsResult.ok) return prdsResult;
      const first = prdsResult.value[0];
      if (!first) {
        return err({ code: "DOC_NOT_FOUND", id: "prd", suggestions: ["No PRD documents found"] });
      }
      rootDoc = first;
    }

    const nodeResult = await this.buildTreeNode(rootDoc, depth);
    return nodeResult;
  }

  // ── Link ─────────────────────────────────────────────────────────────────

  /**
   * Create a link between two documents.
   * For type='parent', also updates docs.parent_id on the 'from' doc.
   * Telemetry: records one event with link_type and from/to ids on success.
   */
  async link(
    fromIdOrSlug: string,
    toIdOrSlug: string,
    type: LinkType,
  ): Promise<Result<LinkRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._linkImpl(fromIdOrSlug, toIdOrSlug, type);
    this.recordTelemetryEvent("link", startMs, result, { link_type: type });
    return result;
  }

  private async _linkImpl(
    fromIdOrSlug: string,
    toIdOrSlug: string,
    type: LinkType,
  ): Promise<Result<LinkRecord, LoreError>> {
    const fromResult = await this.resolve(fromIdOrSlug);
    if (!fromResult.ok) return fromResult;

    const toResult = await this.resolve(toIdOrSlug);
    if (!toResult.ok) return toResult;

    // For parent links, enforce type contract before calling store.
    // Only applies when the child type has a non-empty allowed parent list
    // (root types with empty allowed list pass through to store-level cycle detection).
    if (type === "parent") {
      const fromDocResult = await this.store.find(fromResult.value);
      if (!fromDocResult.ok) return fromDocResult;
      const fromDoc = fromDocResult.value;
      if (fromDoc === null) return err({ code: "DOC_NOT_FOUND", id: fromResult.value });

      const toDocResult = await this.store.find(toResult.value);
      if (!toDocResult.ok) return toDocResult;
      const toDoc = toDocResult.value;
      if (toDoc === null || toDoc.deleted_at !== null) {
        return err({ code: "DOC_NOT_FOUND", id: toResult.value });
      }

      const allowedParents = PARENT_TYPE_CONTRACT[fromDoc.type];
      if (allowedParents.length > 0 && !isValidParentType(fromDoc.type, toDoc.type)) {
        return err({
          code: "INVALID_PARENT_TYPE",
          child: fromDoc.type,
          parent: toDoc.type,
          allowed: [...allowedParents],
        });
      }

      // Orphan-parent guard: a non-root doc that is itself un-parented cannot
      // serve as a parent anchor (it would create a detached sub-tree).
      // Root types (empty allowed list) are exempt — they are valid roots.
      const toAllowedParents = PARENT_TYPE_CONTRACT[toDoc.type];
      if (toAllowedParents.length > 0 && toDoc.parent_id === null) {
        return err({
          code: "INVALID_PARENT_TYPE",
          child: fromDoc.type,
          parent: toDoc.type,
          allowed: [...allowedParents],
        });
      }
    }

    const now = new Date().toISOString();
    const linkRecord: LinkRecord = {
      from_id: fromResult.value,
      to_id: toResult.value,
      link_type: type,
      created_at: now,
      created_by: "system",
    };

    const addResult = await this.store.addLink(linkRecord);
    if (!addResult.ok) return addResult;

    // For parent links, update docs.parent_id on the from doc
    if (type === "parent") {
      const updateResult = await this.store.update(fromResult.value, {
        parent_id: toResult.value,
        updated_at: now,
      });
      if (!updateResult.ok) return updateResult;
    }

    return ok(addResult.value);
  }

  // ── Unlink ───────────────────────────────────────────────────────────────

  /**
   * Remove links between two documents.
   * Removes all link types between the pair.
   */
  async unlink(
    fromIdOrSlug: string,
    toIdOrSlug: string,
  ): Promise<Result<void, LoreError>> {
    const fromResult = await this.resolve(fromIdOrSlug);
    if (!fromResult.ok) return fromResult;

    const toResult = await this.resolve(toIdOrSlug);
    if (!toResult.ok) return toResult;

    // Find all links between them in both directions and remove
    const linksResult = await this.store.findLinks(fromResult.value, "out");
    if (!linksResult.ok) return linksResult;

    for (const link of linksResult.value) {
      if (link.to_id === toResult.value) {
        const removeResult = await this.store.removeLink(
          fromResult.value,
          toResult.value,
          link.link_type,
        );
        if (!removeResult.ok) return removeResult;
      }
    }

    return ok(undefined);
  }

  // ── Status ───────────────────────────────────────────────────────────────

  /** Aggregate corpus statistics. */
  async status(): Promise<Result<CorpusStatus, LoreError>> {
    const allDocsResult = await this.store.findMany({ exclude_deleted: false });
    if (!allDocsResult.ok) return allDocsResult;

    const allDocs = allDocsResult.value;
    const activeDocs = allDocs.filter((d) => d.deleted_at === null);

    const by_type: Record<string, number> = {};
    const by_status: Record<string, number> = {};

    for (const doc of activeDocs) {
      by_type[doc.type] = (by_type[doc.type] ?? 0) + 1;
      by_status[doc.status] = (by_status[doc.status] ?? 0) + 1;
    }

    const lastUpdated =
      activeDocs.length > 0
        ? activeDocs.reduce((latest, d) =>
            d.updated_at > latest ? d.updated_at : latest,
            activeDocs[0]!.updated_at,
          )
        : new Date().toISOString();

    return ok({
      total_docs: activeDocs.length,
      by_type,
      by_status,
      last_updated: lastUpdated,
      db_size_bytes: 0, // In-memory has no disk size; SQLiteStore would provide real value
    });
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private async buildTreeNode(
    doc: DocRecord,
    remainingDepth: number,
  ): Promise<Result<TreeNode, LoreError>> {
    const summary = toDocSummary(doc);

    if (remainingDepth <= 0) {
      return ok({ doc: summary, children: [] });
    }

    const childrenResult = await this.store.findMany({ parent_id: doc.id });
    if (!childrenResult.ok) return childrenResult;

    const children: TreeNode[] = [];
    for (const child of childrenResult.value) {
      const childNodeResult = await this.buildTreeNode(child, remainingDepth - 1);
      if (!childNodeResult.ok) return childNodeResult;
      children.push(childNodeResult.value);
    }

    return ok({ doc: summary, children });
  }

  /**
   * Build substring-match suggestions from all doc IDs.
   * Used when a ULID lookup fails.
   */
  private async buildSuggestions(query: string): Promise<string[]> {
    const allResult = await this.store.findMany({});
    if (!allResult.ok) return [];
    const lower = query.toLowerCase();
    return allResult.value
      .filter((d) => d.id.toLowerCase().includes(lower) || d.slug.includes(lower))
      .map((d) => d.slug)
      .slice(0, 5);
  }

  /**
   * Build substring-match suggestions from all slugs.
   * Used when a slug lookup fails.
   */
  private async buildSlugSuggestions(query: string): Promise<string[]> {
    const allResult = await this.store.findMany({});
    if (!allResult.ok) return [];
    const lower = query.toLowerCase();
    return allResult.value
      .filter((d) => d.slug.includes(lower) || d.title.toLowerCase().includes(lower))
      .map((d) => d.slug)
      .slice(0, 5);
  }
}

// ─── Helper functions ──────────────────────────────────────────────────────

function toDocSummary(doc: DocRecord): DocSummary {
  return {
    id: doc.id,
    slug: doc.slug,
    type: doc.type,
    title: doc.title,
    status: doc.status,
    updated_at: doc.updated_at,
  };
}
