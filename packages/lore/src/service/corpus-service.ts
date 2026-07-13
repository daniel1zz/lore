/**
 * CorpusService — primary CRUD + graph + search service for the Lore corpus.
 * All methods return Promise<Result<T, LoreError>>. No thrown exceptions cross this boundary.
 * Source: SPEC-001 §3.1
 */

import { ulid } from "ulidx";
import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import {
  adrExtraSchema,
  canonicaliseBody,
  createDocInputSchema,
  deriveTypeMeta,
  docPatchSchema,
  extractValidity,
  getAllowedTransitions,
  isInvalidated,
  isValidTransition,
  knowledgeExtraSchema,
  planAcScopeSchema,
  slugifyWithCollision,
  specAcceptanceCriteriaSchema,
  specExtraSchema,
  normalizeFileAnchors,
  parseCodeAnchor,
  validityEqual,
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
import type { GateEnforcer } from "./gate-enforcer.js";
import type { GateContext } from "./checkpoint-registry.js";
import { computeArmedGates } from "./checkpoint-registry.js";

// ─── Local types (mirror SPEC-001 §3.1 interfaces) ────────────────────────

/** ULID regex — 26 uppercase/digit chars */
const ULID_RE = /^[0-9A-Z]{26}$/;

/** Check if input looks like a ULID */
function isUlid(input: string): boolean {
  return ULID_RE.test(input);
}

/** Time seam (D3/D10 convention) — never `Date.now()` read directly in method bodies. */
const defaultNow = (): string => new Date().toISOString();

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
  /**
   * SPEC-043 D3 escape — when `true`, invalidated `knowledge`/`adr` docs are included
   * (the pre-SPEC-043 default: none are ever excluded). Stripped before the filter
   * object is forwarded to `StoreInterface.findMany` (not a store-level filter).
   */
  include_invalid?: boolean;
}

export interface SearchFilters {
  type?: DocType;
  status?: DocStatus;
  tags?: string[];
  /** See {@link ListFilters.include_invalid} — same escape, same strip-before-store rule. */
  include_invalid?: boolean;
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
  /**
   * SPEC-043 D8 — one human-readable warning per ARMED gate checkpoint whose
   * discovered feeding-skill source doc is currently invalidated. Computed via the
   * SAME `computeArmedGates` helper `SessionService.bootstrap`'s `armed_gates[]` uses
   * (never a second derivation of "which gates are armed / what feeds them").
   * Empty when nothing is invalidated (never omitted — always a fact, not absent data).
   */
  invalidated_feeding_source_warnings: string[];
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
   * @param gateEnforcer - OPTIONAL service-layer gate enforcement (retro follow-up item
   *   8, defense-in-depth) — when present, `_createImpl` runs the `spec-create`
   *   checkpoint and `set` runs the `spec-promote` checkpoint on a spec's draft→approved
   *   transition, both via `GateEnforcer.enforce` (`./gate-enforcer.js`), the SAME
   *   `checkpointRegistry` decision logic `lore gate` dispatches through. Absent (the
   *   default) → ungated, byte-identical to pre-GateEnforcer behavior — this is what
   *   keeps every bare `new CorpusService(store)` unit test construction green. Only
   *   `app.ts`'s production composition root wires a real instance.
   */
  constructor(
    private readonly store: StoreInterface,
    telemetry: Telemetry = new NoOpTelemetry(),
    private readonly claimTtlMinutes?: number,
    private readonly gateEnforcer?: GateEnforcer,
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
   *
   * @invariant Rejects `type: "knowledge"` + `extra.sub_type: "handoff"` with
   *   `VALIDATION_ERROR` — see {@link createHandoffDoc} for the sole legitimate
   *   creation path for that sub_type (SPEC-041 §3 D4).
   */
  async create(input: CreateDocInput): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._createImpl(input);
    this.recordTelemetryEvent("create", startMs, result, { type: input.type });
    return result;
  }

  /**
   * Internal creation seam for SPEC-041 S2 handoff docs — the SOLE way a `knowledge`
   * doc with `extra.sub_type: "handoff"` may be created. Mirrors
   * `TaskWorkflowService.recordVerifiedEvidence`'s sole-injection-site pattern
   * (SPEC-039 §2 D2): runs the IDENTICAL `_createImpl` pipeline `create()` does, with
   * ONLY the handoff writer-identity rejection skipped (`opts.allowHandoff: true`).
   * Never registered on any CLI/MCP/HTTP adapter — its only production caller is
   * `SessionService.writeHandoff`, bound in `app.ts` as
   * `corpusService.createHandoffDoc.bind(corpusService)` the same way
   * `resolveDeclaredAcIds`/`recordVerifiedEvidence` are bound. Callers passing a
   * non-handoff `input` (any other type/sub_type) are still fully validated —
   * `allowHandoff` only widens the ONE rejection above, nothing else in the pipeline
   * changes.
   *
   * @param input - Same shape `create()` accepts; expected (not enforced here) to be a
   *   `type: "knowledge"`, `extra.sub_type: "handoff"` payload — `SessionService`
   *   builds this from a Zod-valid `HandoffExtra` before calling.
   * @returns Same `Result<DocRecord, LoreError>` contract as `create()`.
   */
  async createHandoffDoc(input: CreateDocInput): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._createImpl(input, { allowHandoff: true });
    this.recordTelemetryEvent("create", startMs, result, { type: input.type });
    return result;
  }

  private async _createImpl(
    input: CreateDocInput,
    opts?: { allowHandoff?: boolean },
  ): Promise<Result<DocRecord, LoreError>> {
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

    // Write-path exclusivity for knowledge sub_type "handoff" (SPEC-041 §3 D4).
    // reason: a Zod superRefine presence check (knowledgeExtraSchema, schemas.ts) can
    // only verify extra.handoff is SHAPE-valid — it cannot see WHO is calling create(),
    // so it cannot enforce "only `lore handoff` may write this sub_type." extra.handoff
    // is user-supplied data (unlike an LLM-generated assessment blob), so a presence
    // check alone is forgeable: any caller could hand-assemble a valid extra.handoff
    // payload and call `lore create` directly. This writer-identity guard mirrors the
    // SPEC-039 D2 attestation precedent (recordVerifiedEvidence's sole-injection-site
    // pattern), not the SPEC-026 assessment precedent. `opts.allowHandoff` is the
    // internal bypass flag ONLY `createHandoffDoc` (below) sets — never exposed on the
    // public `create()` overload, so no adapter (CLI/MCP/HTTP) can pass it through.
    if (
      data.type === "knowledge" &&
      (data.extra?.["sub_type"] as unknown) === "handoff" &&
      opts?.allowHandoff !== true
    ) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.sub_type",
        message:
          'knowledge sub_type "handoff" may only be created via `lore handoff` — ' +
          "direct creation through `lore create` / `lore_create` is not permitted",
        value: "handoff",
      });
    }

    // Resolve parent if provided
    let resolvedParentId: DocId | null = null;
    // reason: captured alongside resolvedParentId so the spec-create gate below (and
    // ONLY that gate) can see the parent's type without a second store.find call —
    // null both when there's no parent_id at all and when parent_id was supplied (the
    // gate's own parentLegal predicate distinguishes those cases identically, via
    // GateContext.parentType: null).
    let resolvedParentType: string | null = null;
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
      resolvedParentType = parentDoc.type;
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

    // Cross-entity ac_scope validation for plans (SPEC-040 §T2 D5).
    // reason: planAcScopeSchema (schemas.ts, invoked by createDocInputSchema's superRefine
    // for type==="plan") already guarantees a non-empty array of non-empty AC-id strings
    // when extra.ac_scope is present at all — this block adds the cross-DOCUMENT membership
    // check Zod cannot express: every scoped id must be declared on the plan's parent spec,
    // and the plan must actually HAVE a spec parent with declared criteria at all. Mirrors
    // the task extra.phase cross-entity pattern immediately above.
    if (data.type === "plan") {
      const acScope = data.extra?.["ac_scope"];
      if (Array.isArray(acScope) && acScope.length > 0) {
        const declaredResult = await this._resolveDeclaredAcIdsForParent(resolvedParentId);
        if (!declaredResult.ok) return declaredResult;
        const declared = declaredResult.value;
        if (declared === null) {
          return err({
            code: "VALIDATION_ERROR",
            field: "extra.ac_scope",
            message:
              "plan declares extra.ac_scope but its parent is not a spec with declared acceptance criteria",
            value: acScope,
          });
        }
        const unknownIds = (acScope as unknown[]).filter(
          (id) => typeof id !== "string" || !declared.has(id),
        );
        if (unknownIds.length > 0) {
          return err({
            code: "VALIDATION_ERROR",
            field: "extra.ac_scope",
            message:
              `plan extra.ac_scope references id(s) not declared on parent spec: ` +
              `${unknownIds.join(", ")}. Declared ids: ${Array.from(declared).join(", ")}.`,
            value: unknownIds,
          });
        }
      }
    }

    // Create-time file_anchors validation + normalization for tasks (SPEC-042
    // §Design Decisions D3). reason: taskExtraSchema only shape-checks
    // file_anchors (bounded array of bounded strings) — the deeper
    // normalization rules (no leading "/", no "..", no "\", trailing-slash
    // directory-scope semantics, dedup) live in the shared pure
    // `normalizeFileAnchors` (@lore/core, file-anchors.ts), so create-time and
    // TaskWorkflowService's anchor-mutation verbs enforce identically — never
    // re-derived here. No cross-DOCUMENT component (unlike phase/ac_scope
    // above) — colocated in this method only because CreateDocInput's `extra`
    // bag is only available here; the NORMALIZED result is folded into
    // resolvedExtra below (raw, un-normalized input is never persisted).
    let normalizedFileAnchors: string[] | undefined;
    if (data.type === "task") {
      const rawAnchors = data.extra?.["file_anchors"];
      if (rawAnchors !== undefined) {
        if (!Array.isArray(rawAnchors) || !rawAnchors.every((a) => typeof a === "string")) {
          return err({
            code: "VALIDATION_ERROR",
            field: "extra.file_anchors",
            message: "extra.file_anchors must be an array of strings",
            value: rawAnchors,
          });
        }
        const normalizedResult = normalizeFileAnchors(rawAnchors as string[]);
        if (!normalizedResult.ok) return normalizedResult;
        normalizedFileAnchors = normalizedResult.value;
      }
    }

    // Create-time code_anchors GRAMMAR validation for specs (SPEC-045 §Design
    // Decisions D6a). reason: specExtraSchema only shape-checks code_anchors
    // (bare array of strings) — the per-entry `path[#Symbol]` grammar lives in
    // the shared pure `parseCodeAnchor` (@lore/core, code-anchors.ts), run
    // per-entry on the FULL raw string (never batch-normalized — SPEC-045
    // review S3). Mirrors the task file_anchors branch immediately above, but
    // this is VALIDATION ONLY — unlike file_anchors, code_anchors entries are
    // NOT rewritten/normalized here ("they just must PARSE", D6a) — a
    // grammar-valid raw string persists verbatim. Filesystem verification is
    // `lore status --check-drift`'s job, never a write-time check.
    if (data.type === "spec") {
      const rawCodeAnchors = data.extra?.["code_anchors"];
      if (rawCodeAnchors !== undefined) {
        if (!Array.isArray(rawCodeAnchors) || !rawCodeAnchors.every((a) => typeof a === "string")) {
          return err({
            code: "VALIDATION_ERROR",
            field: "extra.code_anchors",
            message: "extra.code_anchors must be an array of strings",
            value: rawCodeAnchors,
          });
        }
        for (const raw of rawCodeAnchors as string[]) {
          const parsedResult = parseCodeAnchor(raw);
          if (!parsedResult.ok) return parsedResult;
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
    const specKindDefaultedExtra: Record<string, unknown> =
      data.type === "spec" && data.extra?.["spec_kind"] === undefined
        ? { ...(data.extra ?? {}), spec_kind: "feature" }
        : (data.extra ?? {});

    // Overlay the normalized file_anchors (if any were validated above) on top
    // of the spec_kind-defaulted extra — the two defaults are independent
    // (never both apply to the same doc type) but composed this way so a
    // future third create-time extra transform can chain the same way.
    const resolvedExtra: Record<string, unknown> =
      normalizedFileAnchors !== undefined
        ? { ...specKindDefaultedExtra, file_anchors: normalizedFileAnchors }
        : specKindDefaultedExtra;

    // Gate `spec-create` (retro follow-up item 8, defense-in-depth): the SAME
    // deterministic checkpoint `lore gate spec-create` runs as a pre-flight hook
    // shell-out, now also enforced HERE so MCP `lore_create` / HTTP dashboard create /
    // any direct-service caller can't bypass it by skipping the CLI hook. Only fires
    // for `type === "spec"` (the checkpoint's produced type) and only when this
    // service was constructed with a `gateEnforcer` (absent in every bare unit-test
    // construction — see constructor JSDoc). Runs against the EFFECTIVE spec_kind
    // (post-default, `resolvedExtra["spec_kind"]`) and the same `data.content ?? ""`
    // the CLI's `lore gate spec-create --input-json` candidate payload uses — this is
    // still a pre-write check (the doc row below doesn't exist yet), so failing here
    // returns BEFORE any store.insert.
    if (data.type === "spec" && this.gateEnforcer) {
      const gateCtx: GateContext = {
        parentType: resolvedParentType,
        ...(typeof resolvedExtra["spec_kind"] === "string"
          ? { specKind: resolvedExtra["spec_kind"] }
          : {}),
        content: data.content ?? "",
      };
      const gateResult = this.gateEnforcer.enforce("spec-create", gateCtx);
      if (!gateResult.ok) return gateResult;
    }

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

    // Provenance auto-write (IoC vertical-slice tech-spec §4.1 P4, "governs" edge from
    // the feeding skill to the artifact it fed) — fail-soft by construction, see
    // writeProvenanceLink's JSDoc. The created doc is already durably persisted above;
    // this is metadata layered on top and must never turn a successful create into an
    // error.
    await this.writeProvenanceLink(insertResult.value);

    return ok(insertResult.value);
  }

  /**
   * Write the `skill --governs--> newDoc` provenance link discovered via
   * {@link findFeedingSkill}, if an approved feeding skill exists for `newDoc.type`.
   *
   * Fire-and-forget by design: the just-created doc is the create path's SSOT, and
   * this link is provenance metadata about how the doc came to exist, not a
   * correctness dependency of the create itself. Every failure mode — the feeding-skill
   * lookup erroring, the link write erroring, or an unexpected throw from either — is
   * caught here and recorded via telemetry; none of them are ever re-thrown or turned
   * into an `err()` for the caller.
   *
   * Idempotent: before writing, checks the candidate skill's existing outbound
   * `governs` links for one already pointing at `newDoc.id`, skipping the write if
   * found — so re-running this step for the same (skill, doc) pair never duplicates
   * the edge. `store.addLink` independently rejects exact `(from, to, link_type)`
   * duplicates with `DUPLICATE_LINK`, which this treats as "already provisioned"
   * rather than a failure — a second line of defence against a race between the
   * pre-check and the write, not the primary idempotency mechanism.
   *
   * @param newDoc - The doc just persisted by `_createImpl` (row + version + audit
   *   entry already committed before this is called)
   * @invariant Never throws. Never returns a value the caller must inspect — this
   *   method exists purely for its side effect and its own failure is not the
   *   caller's concern.
   */
  private async writeProvenanceLink(newDoc: DocRecord): Promise<void> {
    try {
      const skillResult = await this.findFeedingSkill(newDoc.type);
      if (!skillResult.ok) {
        this.recordProvenanceFailure("find_feeding_skill", skillResult.error.code, newDoc);
        return;
      }

      const skill = skillResult.value;
      // reason: ok(null) is a fact ("no approved feeding skill declares this scope"),
      // not a failure — most doc types have none, this is the common case.
      if (skill === null) return;

      const existingLinksResult = await this.store.findLinks(skill.id, "out");
      if (existingLinksResult.ok) {
        const alreadyGoverns = existingLinksResult.value.some(
          (link) => link.link_type === "governs" && link.to_id === newDoc.id,
        );
        if (alreadyGoverns) return; // idempotent — edge already provisioned
      }
      // reason: if the existence check itself failed, still attempt the write below —
      // store.addLink's own DUPLICATE_LINK rejection is the fallback dedup guard.

      const linkResult = await this.store.addLink({
        from_id: skill.id,
        to_id: newDoc.id,
        link_type: "governs",
        created_at: new Date().toISOString(),
        created_by: "system",
      });

      if (!linkResult.ok && linkResult.error.code !== "DUPLICATE_LINK") {
        this.recordProvenanceFailure("add_link", linkResult.error.code, newDoc, skill.id);
      }
    } catch (error) {
      this.recordProvenanceFailure(
        "unexpected_throw",
        error instanceof Error ? error.message : String(error),
        newDoc,
      );
    }
  }

  /**
   * Record a provenance-write failure via telemetry (never console, never a thrown
   * error) — the structured logging surface this codebase uses in place of a
   * console-based logger (mirrors {@link recordTelemetryEvent}'s `Telemetry.record`
   * call, which is documented to never throw even if the underlying sink fails).
   *
   * @param stage - Which step of {@link writeProvenanceLink} failed
   * @param errorCode - The `LoreError.code` (or a caught throw's message) for context
   * @param newDoc - The doc the provenance write was attempted for
   * @param skillId - The feeding skill's id, when the failure happened after it was resolved
   */
  private recordProvenanceFailure(
    stage: "find_feeding_skill" | "add_link" | "unexpected_throw",
    errorCode: string,
    newDoc: DocRecord,
    skillId?: DocId,
  ): void {
    this.telemetry.record({
      ts: new Date().toISOString(),
      service: "CorpusService",
      method: "provenance",
      ok: false,
      duration_ms: 0,
      error_code: errorCode,
      meta: {
        stage,
        doc_id: newDoc.id,
        doc_type: newDoc.type,
        ...(skillId !== undefined ? { skill_id: skillId } : {}),
      },
    });
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
    // reason: this is an INTERNAL lifecycle invariant (SPEC-002 §3), not a
    // user-requested transition — approved→draft is deliberately absent from
    // VALID_TRANSITIONS (only active/archived/deprecated follow "approved"),
    // so the isValidTransition check below must not see this as the user's
    // ask. It also unconditionally OVERRIDES any status the caller requested
    // in the same patch, matching the pre-existing behavior this block always
    // had (a content/title edit on an approved doc always demotes to draft).
    const isApprovedAutoResetToDraft = existing.status === "approved" && contentOrTitleChanged;
    if (isApprovedAutoResetToDraft) {
      newStatus = "draft";
    }

    // Reject illegal USER-requested lifecycle transitions (B1 blocker fix) —
    // pre-fix, set() never consulted VALID_TRANSITIONS at all (only
    // ReviewService.approve/reject did), so `lore set --status`, the HTTP
    // dashboard PATCH route, and MCP `lore_set` could all force an illegal
    // jump (archived→active, approved→draft, draft→archived — the last skips
    // every workflow gate, since GateEnforcer's spec-promote check only fires
    // on a →approved transition). The auto-reset above is exempted: it is not
    // a user-requested transition, it's a sanctioned internal side effect.
    if (
      !isApprovedAutoResetToDraft &&
      newStatus !== existing.status &&
      !isValidTransition(existing.status, newStatus)
    ) {
      return err({
        code: "INVALID_TRANSITION",
        from: existing.status,
        to: newStatus,
        allowed: getAllowedTransitions(existing.status),
      });
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

    // Cross-entity ac_scope validation when updating a plan's extra.ac_scope (SPEC-040 §T2 D5).
    // reason: docPatchSchema.extra is untyped z.record(z.unknown()) — unlike _createImpl,
    // set() never routes through createDocInputSchema's superRefine, so the shape check
    // (non-empty array of non-empty strings, planAcScopeSchema) AND the cross-document
    // membership check both live here, mirroring the spec_kind validation immediately below.
    if (existing.type === "plan" && parsedPatch.data.extra !== undefined) {
      const acScopeCandidate = parsedPatch.data.extra["ac_scope"];
      if (acScopeCandidate !== undefined) {
        const acScopeParsed = planAcScopeSchema.safeParse(acScopeCandidate);
        if (!acScopeParsed.success) {
          return err({
            code: "VALIDATION_ERROR",
            field: "extra.ac_scope",
            message: "extra.ac_scope must be a non-empty array of non-empty AC-id strings",
            value: acScopeCandidate,
          });
        }
        const declaredResult = await this._resolveDeclaredAcIdsForParent(existing.parent_id);
        if (!declaredResult.ok) return declaredResult;
        const declared = declaredResult.value;
        if (declared === null) {
          return err({
            code: "VALIDATION_ERROR",
            field: "extra.ac_scope",
            message:
              "plan declares extra.ac_scope but its parent is not a spec with declared acceptance criteria",
            value: acScopeCandidate,
          });
        }
        const unknownIds = acScopeParsed.data.filter((id) => !declared.has(id));
        if (unknownIds.length > 0) {
          return err({
            code: "VALIDATION_ERROR",
            field: "extra.ac_scope",
            message:
              `plan extra.ac_scope references id(s) not declared on parent spec: ` +
              `${unknownIds.join(", ")}. Declared ids: ${Array.from(declared).join(", ")}.`,
            value: unknownIds,
          });
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

    // code_anchors GRAMMAR re-validation when updating a spec's extra (SPEC-045
    // §Design Decisions D6a). reason: specExtraSchema (just re-parsed above) only
    // shape-checks code_anchors (bare array of strings) — the per-entry
    // `path[#Symbol]` grammar is a SEPARATE check via the shared pure
    // `parseCodeAnchor` (@lore/core), run here so `lore set` / HTTP PATCH / MCP
    // `lore_set` can't smuggle a malformed anchor past the shape-only Zod gate
    // (mirrors D6a's "no side doors" requirement, same shape as the ac_scope/
    // spec_kind cross-cutting checks immediately above/below). Validation only —
    // a grammar-valid incoming array persists verbatim, no rewrite ("they just
    // must PARSE", D6a); the RMW verbs (DriftCheckService.addCodeAnchors/
    // removeCodeAnchors) remain the sanctioned normalize-on-write path.
    if (existing.type === "spec" && parsedPatch.data.extra !== undefined) {
      const rawCodeAnchors = parsedPatch.data.extra["code_anchors"];
      if (rawCodeAnchors !== undefined) {
        if (!Array.isArray(rawCodeAnchors) || !rawCodeAnchors.every((a) => typeof a === "string")) {
          return err({
            code: "VALIDATION_ERROR",
            field: "extra.code_anchors",
            message: "extra.code_anchors must be an array of strings",
            value: rawCodeAnchors,
          });
        }
        for (const raw of rawCodeAnchors as string[]) {
          const parsedResult = parseCodeAnchor(raw);
          if (!parsedResult.ok) return parsedResult;
        }
      }
    }

    // knowledge/adr extra re-validation + D10 writer-identity guard (SPEC-043 §Design
    // Decisions D10) — closes the "set() was an unguarded second write path onto
    // extra.validity" hole (review S2). Two checks, in this order:
    //   1. Shape: re-parse the incoming extra against its type-specific schema (the
    //      SAME schema _createImpl's superRefine delegates to) so a malformed
    //      extra.validity is rejected with the REAL issue — even when
    //      extra.decision_status is otherwise valid (D10/S1 regression: the ADR
    //      create-path issue-collapse bug, now fixed at both write paths).
    //   2. Writer guard: once shape-valid, a patch whose extra.validity DIFFERS from
    //      the doc's CURRENT extra.validity is rejected — `lore invalidate`
    //      (ValidityService) is the sole path allowed to change it.
    if ((existing.type === "adr" || existing.type === "knowledge") && parsedPatch.data.extra !== undefined) {
      const extraSchema = existing.type === "adr" ? adrExtraSchema : knowledgeExtraSchema;
      const extraResult = extraSchema.safeParse(parsedPatch.data.extra);
      if (!extraResult.success) {
        const issue = extraResult.error.issues[0];
        return err({
          code: "VALIDATION_ERROR",
          field: issue ? `extra.${String(issue.path.join("."))}` : "extra",
          message: issue ? issue.message : `invalid ${existing.type} extra`,
          value: parsedPatch.data.extra,
        });
      }

      const incomingValidity = extractValidity({ extra: parsedPatch.data.extra });
      const currentValidity = extractValidity(existing);
      if (!validityEqual(incomingValidity, currentValidity)) {
        return err({
          code: "VALIDATION_ERROR",
          field: "extra.validity",
          message: "extra.validity cannot be changed via `lore set` — use `lore invalidate` instead",
          value: parsedPatch.data.extra["validity"],
        });
      }
    }

    // Gate `spec-promote` on a spec's draft→approved TRANSITION reached via `set`
    // (retro follow-up item 8, defense-in-depth) — `set` is a SECOND write path
    // (besides `ReviewService.approve`) that can push a spec straight to "approved"
    // (`docPatch.status`, exposed as `lore set --status approved` / HTTP `PATCH` /
    // MCP `lore_set`); without this check that path bypasses spec-promote's ≥1
    // declared-acceptance-criterion gate entirely. Only fires on an ACTUAL promotion
    // (`existing.status !== "approved"`) — re-patching an already-approved spec with
    // `status: "approved"` again is a no-op transition, not a new promotion event, and
    // must not re-block on it. `effectiveExtra` mirrors the value `docPatch.extra`
    // will actually persist (patch.extra REPLACES existing.extra wholesale, per this
    // method's own docPatch assembly above — never merged).
    if (
      existing.type === "spec" &&
      newStatus === "approved" &&
      existing.status !== "approved" &&
      this.gateEnforcer
    ) {
      const effectiveExtra = parsedPatch.data.extra !== undefined ? parsedPatch.data.extra : existing.extra;
      const parsed = specAcceptanceCriteriaSchema.safeParse(effectiveExtra["acceptance_criteria"]);
      const acceptanceCriteriaCount = parsed.success ? parsed.data.length : 0;
      const gateResult = this.gateEnforcer.enforce("spec-promote", {
        acceptanceCriteriaCount,
        specIdOrSlug: existing.slug,
      });
      if (!gateResult.ok) return gateResult;
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
   *
   * @param filters - Standard filters plus SPEC-043 D3's `include_invalid` escape.
   * @param now - Time seam (D3) — drives the default invalidated-knowledge/adr
   *   exclusion; defaults to `() => new Date().toISOString()`.
   */
  async list(
    filters: ListFilters,
    now: () => string = defaultNow,
  ): Promise<Result<{ docs: DocSummary[]; total: number }, LoreError>> {
    const startMs = Date.now();
    const { include_invalid, ...storeFilters } = filters;
    const storeResult = await this.store.findMany(storeFilters);
    if (!storeResult.ok) {
      this.recordTelemetryEvent("list", startMs, storeResult, { filter_type: filters.type });
      return storeResult;
    }

    // SPEC-043 D3 — invalidated knowledge/adr docs are excluded by default from this
    // list-shaped read; isInvalidated is a no-op for every other doc type (they never
    // carry extra.validity), so this filter naturally scopes itself.
    const nowIso = now();
    const visibleDocs =
      include_invalid === true
        ? storeResult.value
        : storeResult.value.filter((d) => !isInvalidated(d, nowIso));

    const docs = visibleDocs.map((d) => this.toSummary(d));
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

  /**
   * List the artifacts a skill governs — the reverse-query counterpart to
   * {@link writeProvenanceLink}'s auto-written `skill --governs--> artifact` edges
   * (IoC vertical-slice tech-spec §4.1 P4). Resolves `skillIdOrSlug`, reads its
   * outbound `governs` links, and fetches each target doc.
   *
   * This is a link-table traversal, not a column filter — {@link StoreFilters} has no
   * "id in link targets" predicate, so it cannot be expressed as an addition to
   * {@link list}'s filter object (same reasoning as the `--phase` client-side filter
   * in the CLI `list` command). A soft-deleted or otherwise missing target doc is
   * silently excluded from the result rather than erroring the whole query — a single
   * dangling link must not make the entire governed-artifact list unusable.
   *
   * @param skillIdOrSlug - ID or slug of the governing skill doc
   * @returns `ok({docs, total})` — empty when the skill has no `governs` links, or
   *   `skillIdOrSlug` doesn't resolve → `DOC_NOT_FOUND`
   * @example
   * const result = await corpusService.listGovernedBy("knowledge-write-spec-rules");
   * if (result.ok) console.log(result.value.docs.map((d) => d.slug));
   */
  async listGovernedBy(
    skillIdOrSlug: string,
  ): Promise<Result<{ docs: DocSummary[]; total: number }, LoreError>> {
    const startMs = Date.now();
    const resolveResult = await this.resolve(skillIdOrSlug);
    if (!resolveResult.ok) return resolveResult;

    const linksResult = await this.store.findLinks(resolveResult.value, "out");
    if (!linksResult.ok) return linksResult;

    const governedIds = linksResult.value
      .filter((link) => link.link_type === "governs")
      .map((link) => link.to_id);

    const docs: DocSummary[] = [];
    for (const docId of governedIds) {
      const docResult = await this.store.find(docId);
      if (docResult.ok && docResult.value !== null && docResult.value.deleted_at === null) {
        docs.push(this.toSummary(docResult.value));
      }
    }

    const result = ok({ docs, total: docs.length });
    this.recordTelemetryEvent("list", startMs, result, {
      governed_by: skillIdOrSlug,
      count: docs.length,
    });
    return result;
  }

  // ── Search ───────────────────────────────────────────────────────────────

  /**
   * Full-text search delegated to store.
   * Telemetry: records one event with query length and result count.
   *
   * @param filters - Standard filters plus SPEC-043 D3's `include_invalid` escape.
   * @param now - Time seam (D3) — drives the default invalidated-knowledge/adr
   *   exclusion; defaults to `() => new Date().toISOString()`.
   */
  async search(
    query: string,
    filters?: SearchFilters,
    now: () => string = defaultNow,
  ): Promise<Result<{ results: SearchHit[] }, LoreError>> {
    const startMs = Date.now();
    const { include_invalid, ...storeFilters } = filters ?? {};
    const storeResult = await this.store.search(query, storeFilters);
    if (!storeResult.ok) {
      this.recordTelemetryEvent("search", startMs, storeResult, { query_length: query.length });
      return storeResult;
    }

    // SPEC-043 D3 — invalidated knowledge/adr hits are excluded by default. The
    // narrow SearchHit.validity projection (SPEC-037/SPEC-043) makes this computable
    // with ZERO extra store reads (review S3's "no N+1 per-hit fetch") — order of
    // surviving hits is preserved either way (AC-MH-5's order-preservation oracle).
    const nowIso = now();
    const visibleHits =
      include_invalid === true
        ? storeResult.value
        : storeResult.value.filter((hit) => !isInvalidated(hit, nowIso));

    const result = ok({ results: visibleHits });
    this.recordTelemetryEvent("search", startMs, result, { query_length: query.length, hits: visibleHits.length });
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
   * const { plan, spec, tasks, knowledge_links } = bundleResult.value; // spec is undefined for PRD-parented plans
   *
   * Source: SPEC-026 §4 AC-ASSESS-12; SPEC-040 §T2 (knowledge_links)
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

    // reason: SPEC-040 §T2 — knowledge_links is a POINTER list only ({slug, sub_type,
    // title}), never content, of `knowledge` docs linked to the plan via `informs` or
    // `relates-to`. Always populated (possibly []) — never omitted — so
    // computeAssessmentFacts (@lore/core) can distinguish "we checked, there are none"
    // (source: "bundle") from "this bundle predates knowledge_links" (source: "unavailable",
    // only possible for a bundle NOT built by this method).
    const linksResult = await this.store.findLinks(plan.id, "both");
    if (!linksResult.ok) return linksResult;
    const knowledgeLinkCandidates = linksResult.value.filter(
      (link) => link.link_type === "informs" || link.link_type === "relates-to",
    );
    const knowledgeLinks: NonNullable<PlanBundle["knowledge_links"]> = [];
    for (const link of knowledgeLinkCandidates) {
      const otherId = link.from_id === plan.id ? link.to_id : link.from_id;
      const otherResult = await this.store.find(otherId);
      if (!otherResult.ok) return otherResult;
      const other = otherResult.value;
      if (other === null || other.deleted_at !== null || other.type !== "knowledge") continue;
      const parsedKnowledge = knowledgeExtraSchema.safeParse(other.extra);
      const subType = parsedKnowledge.success ? parsedKnowledge.data.sub_type : "unknown";
      knowledgeLinks.push({ slug: other.slug, sub_type: subType, title: other.title });
    }

    return ok({
      plan,
      ...(spec !== undefined ? { spec } : {}),
      tasks: tasksResult.value,
      knowledge_links: knowledgeLinks,
    });
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

    return this._resolveDeclaredAcIdsForParent(plan.parent_id);
  }

  /**
   * The "parent → declared AC id set" half of {@link resolveDeclaredAcIds}, factored out
   * so `_createImpl`/`set`'s SPEC-040 §T2 D5 `extra.ac_scope` cross-entity validation can
   * reuse the identical parent-spec walk WITHOUT first resolving a plan that, at create
   * time, doesn't exist as a persisted doc yet (`resolveDeclaredAcIds` itself always takes
   * an id/slug and re-fetches the plan row first — not usable mid-`_createImpl`).
   *
   * @param parentId - A plan's `parent_id` (already resolved by the caller)
   * @returns Same contract as `resolveDeclaredAcIds`: `Set<string>` when `parentId` points
   *   at a live spec with schema-valid `extra.acceptance_criteria`; `null` (a fact, never
   *   an error) for a null parentId, a non-spec parent, or a spec with no valid declared AC
   */
  private async _resolveDeclaredAcIdsForParent(
    parentId: DocId | null,
  ): Promise<Result<Set<string> | null, LoreError>> {
    if (parentId === null) return ok(null);
    const parentResult = await this.store.find(parentId);
    if (!parentResult.ok) return parentResult;
    const parent = parentResult.value;
    if (parent === null || parent.type !== "spec") return ok(null);

    const parsed = specAcceptanceCriteriaSchema.safeParse(parent.extra["acceptance_criteria"]);
    if (!parsed.success) return ok(null);

    return ok(new Set(parsed.data.map((c) => c.id)));
  }

  // ── Feeding Skill Discovery (IoC vertical-slice tech-spec §4.1/§11, P1 slice-2) ──

  /**
   * Finds the most-recently-updated APPROVED `knowledge` doc with `sub_type: "skill"`
   * whose `extra.skill.applies_to` matches `appliesTo`. Generalizes `lore gate`'s
   * "active feeding" rule-doc lookup from a hardcoded title literal
   * (`gate.ts`'s superseded `WRITE_SPEC_RULE_TITLE` + `findApprovedRuleDoc`) to a
   * declared-scope discovery — any future gate can find its own feeding source by
   * pointing a `knowledge/skill` doc's `extra.skill.applies_to` at the gate's name,
   * with no new per-gate literal required.
   *
   * @invariant Only ever considers `status === "approved"` docs — a draft/in-review
   *   skill doc with a matching `applies_to` is invisible to this lookup, mirroring
   *   the review-gate convention used throughout this module (`getReviewBundle` and
   *   the superseded `gate.ts::findApprovedRuleDoc` both apply the same restriction).
   * @param appliesTo - Scope to match against `extra.skill.applies_to` (e.g. "spec").
   * @returns `ok(doc)` for the matching doc with the latest `updated_at` when ≥1
   *   approved `knowledge/skill` doc declares this scope; `ok(null)` when none do — a
   *   fact, not an error, so callers degrade to a placeholder rather than hard-failing.
   * @example
   * const result = await corpusService.findFeedingSkill("spec");
   * if (result.ok && result.value !== null) {
   *   console.log(result.value.slug); // e.g. "knowledge-write-spec-rules"
   * }
   *
   * Source: IoC vertical-slice tech-spec §4.1/§11 (P1 slice-2, applies_to discovery)
   */
  async findFeedingSkill(appliesTo: string): Promise<Result<DocRecord | null, LoreError>> {
    const listResult = await this.store.findMany({ type: "knowledge", status: "approved" });
    if (!listResult.ok) return listResult;

    const matches = listResult.value.filter((doc) => {
      const parsed = knowledgeExtraSchema.safeParse(doc.extra);
      return (
        parsed.success && parsed.data.sub_type === "skill" && parsed.data.skill?.applies_to === appliesTo
      );
    });

    if (matches.length === 0) return ok(null);

    const latest = matches.reduce((newest, doc) => (doc.updated_at > newest.updated_at ? doc : newest));
    return ok(latest);
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

  /**
   * Aggregate corpus statistics.
   *
   * @param now - Time seam (D8/D3 convention) — drives the invalidated-feeding-source
   *   warning below; defaults to `() => new Date().toISOString()`.
   */
  async status(now: () => string = defaultNow): Promise<Result<CorpusStatus, LoreError>> {
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

    // SPEC-043 D8 — invalidated-feeding-source warning, computed via the SAME
    // computeArmedGates helper SessionService.bootstrap's armed_gates[] uses (never a
    // second derivation of "which gates are armed / what feeds them"). Reuses THIS
    // service's own optional gateEnforcer for per-checkpoint enablement, when wired —
    // absent (bare unit-test construction) degrades to "everything enabled", the same
    // default GateEnforcer/SessionService already apply.
    const nowIso = now();
    const bySlug = new Map(activeDocs.map((d) => [d.slug, d] as const));
    const approvedSkillDocs = activeDocs
      .filter((d) => d.type === "knowledge" && d.status === "approved")
      .map((d) => ({ doc: d, parsed: knowledgeExtraSchema.safeParse(d.extra) }))
      .filter(({ parsed }) => parsed.success && parsed.data.sub_type === "skill")
      .map(({ doc, parsed }) => ({
        slug: doc.slug,
        updated_at: doc.updated_at,
        appliesTo: parsed.success ? parsed.data.skill?.applies_to : undefined,
      }));
    const isCheckpointEnabled = this.gateEnforcer
      ? this.gateEnforcer.isEnabled.bind(this.gateEnforcer)
      : () => true;
    const armedGates = computeArmedGates(approvedSkillDocs, isCheckpointEnabled);
    const invalidatedFeedingSourceWarnings: string[] = [];
    for (const gate of armedGates) {
      if (gate.feeding_source_slug === null) continue;
      const skillDoc = bySlug.get(gate.feeding_source_slug);
      if (skillDoc !== undefined && isInvalidated(skillDoc, nowIso)) {
        invalidatedFeedingSourceWarnings.push(
          `gate "${gate.checkpoint}" feeding source "${gate.feeding_source_slug}" is invalidated`,
        );
      }
    }

    return ok({
      total_docs: activeDocs.length,
      by_type,
      by_status,
      last_updated: lastUpdated,
      db_size_bytes: dbSizeResult.value,
      invalidated_feeding_source_warnings: invalidatedFeedingSourceWarnings,
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
