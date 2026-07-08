/**
 * CorpusService — primary CRUD + graph + search service for the Lore corpus.
 * All methods return Promise<Result<T, LoreError>>. No thrown exceptions cross this boundary.
 * Source: SPEC-001 §3.1
 */

import { ulid } from "ulidx";
import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import {
  canonicaliseBody,
  createDocInputSchema,
  deriveTypeMeta,
  docPatchSchema,
  slugifyWithCollision,
  specAcceptanceCriteriaSchema,
  specExtraSchema,
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
import type { PlanBundle } from "@lore/core";
import type { ReviewBundle } from "@lore/core";
import type { TreeBlueprint } from "@lore/core";

// ─── Local types (mirror SPEC-001 §3.1 interfaces) ────────────────────────

/** ULID regex — 26 uppercase/digit chars */
const ULID_RE = /^[0-9A-Z]{26}$/;

/** Check if input looks like a ULID */
function isUlid(input: string): boolean {
  return ULID_RE.test(input);
}

/**
 * @deprecated `resolve_mdx` is accepted for backward-compatibility with existing callers
 * (CLI `get`, MCP `lore_get`) but is intentionally NOT read by `CorpusService.get()`.
 * MDX placeholder splicing requires `OutlineService.resolve()`, and CorpusService must
 * not import OutlineService (services never cross-import — see service/CLAUDE.md
 * "Service per concern, no cross-service calls"). The seam lives at the adapter layer
 * instead: CLI `get.ts`, HTTP `routes.ts` (`?resolveMdx=true`), and MCP `tools.ts`
 * (`lore_get`) each call `app.outlineService.resolve(doc)` themselves, after calling
 * `corpusService.get()`. CLI `get.ts` additionally feeds the result into
 * `renderResolvedToMarkdown()` (outline-service.ts) to splice placeholders into the
 * printed body (SPEC-032 §3.3 AC-3) — HTTP/MCP still return the raw resolvedComponents
 * data alongside untouched `doc.content` (dashboard rendering is SPEC-033, out of
 * scope here). Source: SPEC-032 §3.3 AC-7.
 */
export interface GetOpts {
  resolve_mdx?: boolean;
}

export interface DocWithNavigation {
  doc: DocRecord;
  navigation: {
    parent: DocSummary | null;
    /**
     * The `parent_id` chain from root to direct parent, root-first, EXCLUDING the
     * current doc. Empty for root docs. See `_getImpl`'s ancestor walk for the
     * cycle-guard / depth-cap / broken-parent-ref termination rules.
     * Source: SPEC-036 §2 D1, AC-36-1, AC-36-2
     */
    ancestors: DocSummary[];
    siblings: DocSummary[];
    children: DocSummary[];
    related: Array<DocSummary & { link_type: LinkType }>;
  };
  /**
   * @deprecated Never populated by CorpusService.get() — see GetOpts.resolve_mdx above.
   * Kept only so the (already-dead) `ResolvedComponent` type below has a use site;
   * do not start writing to this field. The live equivalent is each adapter's own
   * `resolved_components` / `resolvedMdx.resolvedComponents` response field, built
   * from `OutlineService.ResolvedComponent` (a different, actually-used shape).
   */
  resolved_components?: ResolvedComponent[];
}

/**
 * @deprecated Local, unused shape — do NOT confuse with `OutlineService`'s
 * `ResolvedComponent` (`{name, props, data, position}`), which is the one every
 * adapter actually produces and `renderResolvedToMarkdown` actually consumes.
 * This one only exists to type the dead `resolved_components` field above.
 */
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
   * @param claimTtlMinutes - Task claim lease TTL in minutes, forwarded to
   *   `deriveTypeMeta` for `DocSummary.meta`'s `task.claim_stale` computation
   *   (SPEC-036 §2 D3). Same DI shape as `TaskWorkflowService`/`AuditService`'s
   *   constructor-resolved config values. Omitted (not defaulted to 120 here) when
   *   the caller doesn't wire it — `deriveTypeMeta` then omits `claim_stale` entirely
   *   rather than computing it against a value CorpusService invented.
   */
  constructor(
    private readonly store: StoreInterface,
    telemetry: Telemetry = new NoOpTelemetry(),
    private readonly claimTtlMinutes?: number,
  ) {
    this.telemetry = telemetry;
  }

  /**
   * Projects a full DocRecord to the lightweight DocSummary shape used by listings,
   * navigation, and trees. The SOLE projection site in this service — every method
   * that needs a DocSummary calls this instead of hand-rolling the shape (D3's
   * "one private toSummary(doc)" requirement).
   */
  private toSummary(doc: DocRecord): DocSummary {
    const meta = deriveTypeMeta(
      doc,
      this.claimTtlMinutes !== undefined ? { claimTtlMinutes: this.claimTtlMinutes } : undefined,
    );
    return {
      id: doc.id,
      slug: doc.slug,
      type: doc.type,
      title: doc.title,
      status: doc.status,
      updated_at: doc.updated_at,
      tags: doc.tags,
      priority: doc.priority,
      ...(meta !== undefined ? { meta } : {}),
    };
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

    // Default extra.spec_kind = "feature" for spec docs when absent (SPEC-032 §3.1).
    // reason: Zod superRefine can only addIssue, never inject a default — the schema
    // layer (specExtraSchema) validates an explicit value, this service layer
    // materializes the default. Immutable: derive a new object, never mutate data.extra.
    const resolvedExtra: Record<string, unknown> =
      data.type === "spec" && data.extra?.["spec_kind"] === undefined
        ? { ...(data.extra ?? {}), spec_kind: "feature" }
        : (data.extra ?? {});

    const doc: DocRecord = {
      id,
      slug,
      type: data.type,
      role,
      title: data.title,
      status: "draft",
      priority: data.priority ?? "medium",
      // reason: canonicalise at write time so corpus content is always normalised.
      // Prevents roundtrip whitespace drift between export-docs and sync-docs.
      // Source: SPEC-021 §4 "CRITICAL — whitespace parity"; empty content stays "".
      content: data.content !== undefined && data.content !== "" ? canonicaliseBody(data.content) : (data.content ?? ""),
      parent_id: resolvedParentId,
      created_at: now,
      updated_at: now,
      created_by: "system",
      version: 1,
      deleted_at: null,
      tags: data.tags ?? [],
      extra: resolvedExtra,
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
      // reason: SPEC-035 §2 — every audit writer stamps the version its action
      // produced (`details.version`), so AuditService.verify can join versions⋈audit
      // on an exact (doc_id, version) pair. Creation always produces version 1.
      details: { type: doc.type, slug: doc.slug, version: 1 },
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

    // Parent + ancestors — one walk up the parent_id chain (AC-36-1). `parent` is the
    // direct parent (chain[0]); `ancestors` is the full chain, root-first.
    // reason: depth cap 20 is a runaway backstop, not a feature — the corpus's own
    // tree contract caps depth at ≤5 (SPEC-036 §2 D1). A manufactured parent_id cycle
    // (AC-36-2) is caught by the seen-set below and terminates the walk, returning the
    // pre-cycle chain rather than looping forever.
    const ANCESTOR_DEPTH_CAP = 20;
    let parent: DocSummary | null = null;
    const ancestors: DocSummary[] = [];
    if (doc.parent_id !== null) {
      const seen = new Set<DocId>([doc.id]);
      const chain: DocSummary[] = [];
      let currentParentId: DocId | null = doc.parent_id;
      let depth = 0;
      while (currentParentId !== null && depth < ANCESTOR_DEPTH_CAP) {
        if (seen.has(currentParentId)) break; // reason: cycle guard (AC-36-2)
        seen.add(currentParentId);
        const nodeResult = await this.store.find(currentParentId);
        // reason: a broken parent ref (find → null, or a store error) terminates the
        // walk with whatever ancestors were already collected — the doc is still
        // viewable; tree-integrity reporting is TreeCheckService's job, not get().
        if (!nodeResult.ok || nodeResult.value === null) break;
        chain.push(this.toSummary(nodeResult.value));
        currentParentId = nodeResult.value.parent_id;
        depth++;
      }
      parent = chain[0] ?? null;
      ancestors.push(...chain.slice().reverse());
    }

    // Siblings — same parent (excluding self)
    let siblings: DocSummary[] = [];
    if (doc.parent_id !== null) {
      const siblingsResult = await this.store.findMany({ parent_id: doc.parent_id });
      if (siblingsResult.ok) {
        siblings = siblingsResult.value
          .filter((d) => d.id !== doc.id)
          .map((d) => this.toSummary(d));
      }
    }

    // Children — docs where parent_id = this doc's id
    const childrenResult = await this.store.findMany({ parent_id: doc.id });
    const children: DocSummary[] = childrenResult.ok
      ? childrenResult.value.map((d) => this.toSummary(d))
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
          related.push({ ...this.toSummary(otherResult.value), link_type: link.link_type });
        }
      }
    }

    return ok({
      doc,
      navigation: { parent, ancestors, siblings, children, related },
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
    // reason: canonicalise content at write time (same invariant as _createImpl).
    // Ensures corpus always stores normalised body; sync-docs roundtrip is then lossless.
    // Source: SPEC-021 §4; empty content stays "".
    if (parsedPatch.data.content !== undefined) {
      const raw = parsedPatch.data.content;
      docPatch.content = raw !== "" ? canonicaliseBody(raw) : raw;
    }
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

    // Cross-cutting spec_kind validation when updating a spec's extra (AC-1, SPEC-032 §3.1).
    // reason: docPatchSchema.extra is untyped z.record(z.unknown()) (docPatchSchema in
    // @lore/core) — HTTP (`body as DocPatch`) and MCP callers bypass CLI's client-side
    // --kind self-validation entirely, so an explicit unknown spec_kind would otherwise
    // persist silently. set() is the single choke point shared by CLI/HTTP/MCP; mirror the
    // task-phase cross-entity check above (same error shape). Validation only — do NOT
    // inject the "feature" default here (defaults are create-only, _createImpl above).
    if (existing.type === "spec" && parsedPatch.data.extra !== undefined) {
      const specResult = specExtraSchema.safeParse(parsedPatch.data.extra);
      if (!specResult.success) {
        const issue = specResult.error.issues[0];
        return err({
          code: "VALIDATION_ERROR",
          field: issue ? `extra.${String(issue.path.join("."))}` : "extra",
          message: issue ? issue.message : "invalid spec extra",
          value: parsedPatch.data.extra["spec_kind"],
        });
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
      // reason: SPEC-035 §2 — `version` (not just the pre-existing `new_version`
      // alias) is the join key AuditService.verify matches against the versions
      // row's own `version` field.
      details: { patch: parsedPatch.data, new_version: newVersion, version: newVersion },
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
      // reason: SPEC-035 §2 — additive for writer-coverage consistency, even though
      // `delete` sits outside AuditService.verify's VERIFIABLE_VERSION_ACTIONS set
      // (a soft-deleted doc's version-0 sentinel row isn't part of the reconcile
      // walk). Matches the sentinel `version: 0` the versions row above carries.
      details: { recoverable_until: recoverableUntil, version: 0 },
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

    const docs = storeResult.value.map((d) => this.toSummary(d));
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

  // ── Plan Bundle (SPEC-026) ──────────────────────────────────────────────

  /**
   * Assemble the read-only bundle `lore assess` judges: the plan itself, its linked
   * spec (when the plan is parented under one — undefined when it hangs directly off a
   * PRD), and every child task (including `extra`, which carries SPEC-025 evidence).
   *
   * Bundle assembly (multi-fetch orchestration) lives here rather than in the CLI/MCP
   * adapters (which must stay thin 4-call pipes) or in AIProviderService (which stays
   * store-free, matching its four existing methods) — CorpusService already owns read
   * orchestration for the analogous multi-fetch case, `tree()`. Source: SPEC-026 §3 D1.
   *
   * @param planIdOrSlug - ID or slug of the plan document to bundle
   * @returns Result<PlanBundle, LoreError> — VALIDATION_ERROR when the resolved doc is not
   *   a plan; DOC_NOT_FOUND when it does not resolve at all
   *
   * @example
   * const bundleResult = await corpusService.getPlanBundle("plan-my-feature");
   * if (!bundleResult.ok) { ... }
   * const { plan, spec, tasks } = bundleResult.value; // spec is undefined for PRD-parented plans
   *
   * Source: SPEC-026 §4 AC-ASSESS-12
   */
  async getPlanBundle(planIdOrSlug: string): Promise<Result<PlanBundle, LoreError>> {
    const resolveResult = await this.resolve(planIdOrSlug);
    if (!resolveResult.ok) return resolveResult;

    const planResult = await this.store.find(resolveResult.value);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;
    if (plan === null || plan.deleted_at !== null) {
      return err({ code: "DOC_NOT_FOUND", id: resolveResult.value });
    }
    if (plan.type !== "plan") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a plan document; got type '${plan.type}'`,
        value: plan.type,
      });
    }

    // reason: a plan's parent is either a spec or a PRD (PARENT_TYPE_CONTRACT.plan =
    // ["prd", "spec"]) or absent entirely (plan.parent_id is not required at creation).
    // Only the spec case populates `spec` — PRD-parented and unparented plans get
    // spec: undefined, not an error (AC-ASSESS-12).
    let spec: DocRecord | undefined;
    if (plan.parent_id !== null) {
      const parentResult = await this.store.find(plan.parent_id);
      if (!parentResult.ok) return parentResult;
      if (parentResult.value !== null && parentResult.value.type === "spec") {
        spec = parentResult.value;
      }
    }

    const tasksResult = await this.store.findMany({ parent_id: plan.id, type: "task" });
    if (!tasksResult.ok) return tasksResult;

    return ok({ plan, ...(spec !== undefined ? { spec } : {}), tasks: tasksResult.value });
  }

  // ── Declared AC Ids (SPEC-038 §4, §7 D4) ────────────────────────────────

  /**
   * Resolve the set of acceptance-criterion ids declared on a plan's parent spec —
   * the single cross-entity traversal locus for `ac_ref` validation, same family as
   * `getPlanBundle` (plan → parent spec). CorpusService owns this walk because
   * services never cross-import (service/CLAUDE.md "no cross-service calls");
   * `TaskWorkflowService.addEvidence` consumes it via a narrow injected port
   * (`resolveDeclaredAcIds.bind(corpusService)`, wired in `app.ts`) rather than
   * gaining graph-walking responsibility itself (SPEC-038 §7 D4).
   *
   * @param planIdOrSlug - Plan document ULID or slug (typically a task's `parent_id`)
   * @returns `Set<string>` of declared `AC-*` ids when the plan is parented under a
   *   spec that has a schema-valid `extra.acceptance_criteria` array; `null` when the
   *   plan has no parent, the parent isn't a spec, or the parent spec has no
   *   structured AC (absent or fails `specAcceptanceCriteriaSchema`) — `null` is a
   *   fact ("nothing declared"), never a thrown error for this class of absence.
   * @throws DOC_NOT_FOUND when planIdOrSlug does not resolve at all; VALIDATION_ERROR
   *   when the resolved doc is not a plan
   *
   * @example
   * const idsResult = await corpusService.resolveDeclaredAcIds("plan-my-feature");
   * if (idsResult.ok && idsResult.value?.has("AC-ACODE-1")) { ... }
   *
   * Source: SPEC-038 §4, §7 D4
   */
  async resolveDeclaredAcIds(planIdOrSlug: string): Promise<Result<Set<string> | null, LoreError>> {
    const resolveResult = await this.resolve(planIdOrSlug);
    if (!resolveResult.ok) return resolveResult;

    const planResult = await this.store.find(resolveResult.value);
    if (!planResult.ok) return planResult;
    const plan = planResult.value;
    if (plan === null || plan.deleted_at !== null) {
      return err({ code: "DOC_NOT_FOUND", id: resolveResult.value });
    }
    if (plan.type !== "plan") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a plan document; got type '${plan.type}'`,
        value: plan.type,
      });
    }

    if (plan.parent_id === null) return ok(null);
    const parentResult = await this.store.find(plan.parent_id);
    if (!parentResult.ok) return parentResult;
    const parent = parentResult.value;
    if (parent === null || parent.type !== "spec") return ok(null);

    const parsed = specAcceptanceCriteriaSchema.safeParse(parent.extra["acceptance_criteria"]);
    if (!parsed.success) return ok(null);

    return ok(new Set(parsed.data.map((c) => c.id)));
  }

  /**
   * Assemble a {@link ReviewBundle} for `lore review` — {doc, parent?, links,
   * brokenLinkTargets?, blueprint?} — the read orchestration entry point for
   * `runDeterministicChecks` and `AIProviderService.judgeDoc` (SPEC-034 §4), mirroring
   * `getPlanBundle`'s role for `assessPlan`.
   *
   * `blueprint` is param-injected rather than read from disk here: CorpusService has no
   * filesystem access (services stay store-only), so the CALLER (CLI `review.ts`) reads
   * `lore.tree.yaml` via the same loader `lore status --check-tree` already uses and
   * passes the parsed `TreeBlueprint` in. Passing `undefined` (the default) makes
   * `tree_position` degrade to "skipped" — never a silent pass — exactly as it would if
   * the file were genuinely absent from the repo.
   *
   * `brokenLinkTargets` is populated by resolving the "other side" of every link this doc
   * participates in (in or out) against the store; any id that no longer resolves to a
   * live doc is collected here rather than left for `link_integrity` to re-discover.
   *
   * @param idOrSlug - ULID or slug of the document to review
   * @param blueprint - Optional pre-parsed lore.tree.yaml blueprint (adapter-injected)
   * @returns Result<ReviewBundle, LoreError> — DOC_NOT_FOUND if idOrSlug doesn't resolve
   *   to a live doc
   *
   * @example
   * const bundleResult = await corpusService.getReviewBundle("spec-my-feature", blueprint);
   * if (!bundleResult.ok) { ... }
   * const checks = runDeterministicChecks(bundleResult.value);
   *
   * Source: SPEC-034 §1, §4
   */
  async getReviewBundle(
    idOrSlug: string,
    blueprint?: TreeBlueprint,
  ): Promise<Result<ReviewBundle, LoreError>> {
    const resolveResult = await this.resolve(idOrSlug);
    if (!resolveResult.ok) return resolveResult;

    const docResult = await this.store.find(resolveResult.value);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    if (doc === null || doc.deleted_at !== null) {
      return err({ code: "DOC_NOT_FOUND", id: resolveResult.value });
    }

    let parent: DocRecord | undefined;
    if (doc.parent_id !== null) {
      const parentResult = await this.store.find(doc.parent_id);
      if (!parentResult.ok) return parentResult;
      if (parentResult.value !== null && parentResult.value.deleted_at === null) {
        parent = parentResult.value;
      }
    }

    const linksResult = await this.store.findLinks(doc.id, "both");
    if (!linksResult.ok) return linksResult;
    const links = linksResult.value;

    // reason: resolve the "other side" of every link (the endpoint that isn't doc.id)
    // against the store — any id that no longer resolves to a live doc is a broken link.
    // One find() per link keeps this method simple and correct; getReviewBundle is a
    // single-doc, CLI-invoked read (not a hot path), so per-link round trips are an
    // acceptable trade against inventing a batch "find many by id" store method here.
    const brokenLinkTargets: DocId[] = [];
    for (const link of links) {
      const otherId = link.from_id === doc.id ? link.to_id : link.from_id;
      const otherResult = await this.store.find(otherId);
      if (!otherResult.ok) return otherResult;
      if (otherResult.value === null || otherResult.value.deleted_at !== null) {
        brokenLinkTargets.push(otherId);
      }
    }

    return ok({
      doc,
      ...(parent !== undefined ? { parent } : {}),
      links,
      ...(brokenLinkTargets.length > 0 ? { brokenLinkTargets } : {}),
      ...(blueprint !== undefined ? { blueprint } : {}),
    });
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

    const dbSizeResult = await this.store.dbSizeBytes();
    if (!dbSizeResult.ok) return dbSizeResult;

    return ok({
      total_docs: activeDocs.length,
      by_type,
      by_status,
      last_updated: lastUpdated,
      db_size_bytes: dbSizeResult.value,
    });
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private async buildTreeNode(
    doc: DocRecord,
    remainingDepth: number,
  ): Promise<Result<TreeNode, LoreError>> {
    const summary = this.toSummary(doc);

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
