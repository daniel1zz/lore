/**
 * CorpusService — primary CRUD + graph + search service for the Lore corpus.
 * All methods return Promise<Result<T, LoreError>>. No thrown exceptions cross this boundary.
 * Source: SPEC-001 §3.1
 */

import { ulid } from "ulidx";
import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
// reason: getTransliterateCjk/containsCjk (SPEC-068 D1, hotfix 2026-07-23) are
// Node-only-subpath-gated purely for the browser-safety barrel-isolation
// invariant (packages/core/src/CLAUDE.md) — this service file is always
// server-side, same precedent config-service.ts/global-config-service.ts
// already set for direct `@lore/core/node` imports.
import { containsCjk, getTransliterateCjk, resolveActorWithSource } from "@lore/core/node";
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
  uatVerdictSchema,
  isP0Accepted,
  prdRequirementsSchema,
  computeRequirementCoverage,
  SPEC_KINDS,
  buildTaskAttestationInfos,
  deriveDeclaredScopeCoverage,
  extractPrdSyncExempt,
  prdSyncExemptEqual,
  extractClaim,
  ORDINAL_REGISTRY,
  isSelfDeclaredOrdinalTitle,
  computePlanCloseCascadeTargets,
  isLedgerKnowledgeSubType,
  computeAcCoverage,
  extractDeclaredAcScope,
  resolveGoverningSpecByAcScope,
} from "@lore/core";
import type {
  CreateDocInput,
  DocPatch,
  UatVerdict,
  RequirementCoverage,
  SpecKind,
  VersionRecord,
  AuditEntry,
  ArchiveCandidateRule,
} from "@lore/core";
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
import type { TraceRecorder } from "./trace-recorder.js";
import type { GateContext } from "./checkpoint-registry.js";
import {
  computeArmedGates,
  buildUpstreamSpecContext,
  countScriptModeAcceptanceCriteria,
} from "./checkpoint-registry.js";
import { attestationExemptKindValid } from "./gate-predicates.js";
import { resolvePrdSyncDomainDoc } from "./prd-sync-domain-doc.js";
import { resolveDoc, ULID_REGEX } from "./resolve.js";
import { hasIssueReport, type ResolvesInEdgeLike, type ResolutionSourceDocLike } from "./issue-resolution.js";

/**
 * `checkpointRegistry`'s `"spec-create"` checkpoint always produces a `"spec"` doc
 * (`flows/feed-flow.ts::CHECKPOINT_PRODUCED_TYPE` is the SSOT map for this fact,
 * mirrored by `gate.ts::SPEC_CREATE_PRODUCED_TYPE`) — reproduced here as a local
 * literal rather than importing from `flows/`, since services never import from the
 * adapter-composition layer (service/CLAUDE.md "no cross-service calls" /
 * `../../CLAUDE.md` layer-stack invariant). Safe because the ONLY call site
 * (`_createImpl`'s spec-create gate context enrichment, SPEC-049 §Design Decisions
 * D3) already runs inside a `data.type === "spec"` branch — this constant just
 * documents WHY `"spec"` is the right `findFeedingSkill` scope there, it is not a
 * second independently-drifting derivation of the checkpoint→type mapping.
 */
const SPEC_CREATE_FEEDING_SCOPE = "spec";

// ─── Local types (mirror SPEC-001 §3.1 interfaces) ────────────────────────

/**
 * Check if input looks like a ULID.
 *
 * Delegates to `resolve.ts`'s exported `ULID_REGEX` — the SAME widened
 * (`{25,26}` chars, any letter) pattern `resolveDoc` itself tests input
 * against (task-skill-implement-fix-corpusservice-resolve-duplicate; the
 * widening's own rationale, incl. the SPEC-056 T4 test-fixture discovery
 * this class of check exists for, now lives on `ULID_REGEX`'s JSDoc — this
 * function is a thin, non-duplicating wrapper, not a second definition).
 * Used only by `resolve()` below, to pick which fuzzy-suggestion helper
 * (`buildSuggestions` vs `buildSlugSuggestions`) enriches a bare
 * `DOC_NOT_FOUND` miss.
 */
function isUlid(input: string): boolean {
  return ULID_REGEX.test(input);
}

/**
 * Doc types eligible for the create-time orphan advisory
 * (task-create-time-orphan-advisory-warn-or-default-parent-to-root, dogfood finding
 * 2026-07-25) — `spec`/`task` are excluded because `createDocInputSchema`'s superRefine
 * already mandates their `parent_id` (a parentless create of either fails VALIDATION_ERROR
 * before `_createImpl` ever reaches the advisory computation below, so they could never
 * trigger it anyway); `prd` is excluded because it IS the root the advisory would name.
 */
const ORPHAN_ADVISORY_TYPES: ReadonlySet<DocType> = new Set(["adr", "plan", "knowledge"]);

/**
 * `CorpusService.create`'s return value — a `DocRecord` plus an OPTIONAL,
 * non-persisted `orphan_advisory` string (task-create-time-orphan-advisory-...). The
 * advisory is NEVER written to the `docs` table (see `_createImpl`'s final `return`) —
 * it exists purely so the calling adapter (CLI/MCP/HTTP) can surface a one-line,
 * non-blocking repair hint. Structurally a superset of `DocRecord`, so every
 * pre-existing caller that only destructures known `DocRecord` fields (or treats the
 * value as a plain `DocRecord`) keeps compiling unchanged — `createHandoffDoc`/
 * `createUatDoc` deliberately keep their OWN return type as plain `DocRecord` (their
 * internal-bypass callers, `SessionService.writeHandoff`/`UatService.record`, don't
 * consume the advisory) even though both share this same `_createImpl` body.
 */
export type CreateDocResult = DocRecord & { readonly orphan_advisory?: string };

/**
 * Actor-attribution options shared by every mutating `CorpusService` method that
 * writes an audit-trail `actor` and/or a `created_by` field (`create`/`set`/`delete`).
 *
 * - `by` — explicit actor value threaded from the caller's own resolution (CLI's
 *   `resolveActor`, an MCP tool's required `by` arg, or an HTTP bearer token's
 *   API-key name). `undefined` falls through to `resolveWriteActor`'s env chain
 *   (`resolveActorWithSource`: `$LORE_ACTOR` → session tier → OS username).
 * - `attributeCreatedBy` — when `true`, the SAME resolved actor ALSO stamps
 *   `doc.created_by` (create only) and `versionRecord.created_by`
 *   (create/set/delete), instead of the historical literal `"system"` default
 *   SPEC-079 G2 deliberately left in place. Opt-in and additive: every
 *   pre-existing caller that omits it keeps the exact byte-for-byte `"system"`
 *   behavior regression-pinned by `audit-actor-fidelity.test.ts`. Wired ONLY
 *   from the HTTP adapter's cookie-session write paths (`adr-dashboard-cookie-
 *   session-writes-attribute-author-via`) — a human using the dashboard on the
 *   SAME machine as `lore serve` (SPEC-016's local-bootstrap model) has an
 *   honest fallback identity (OS username) that a bearer-token agent caller
 *   does not; bearer/CLI/MCP writes are UNCHANGED (never pass this flag).
 */
export interface WriteActorOpts {
  readonly by?: string;
  readonly attributeCreatedBy?: boolean;
}

/**
 * Names a structured `extra` field that a `lore set` / HTTP PATCH / MCP `lore_set`
 * patch would silently DROP, plus the dedicated writer that should be used instead.
 * `null` means no drop detected — the common case.
 *
 * @invariant `docPatch.extra` REPLACES `existing.extra` WHOLESALE (this file's own
 *   `set()` assembly: `if (parsedPatch.data.extra !== undefined) docPatch.extra =
 *   parsedPatch.data.extra;` — never a merge). A field is "dropped" when it was
 *   PRESENT (non-empty) on the CURRENT doc and ABSENT from the INCOMING patch's
 *   `extra` — mirrors SPEC-043's `extra.validity` writer-guard (present/current
 *   comparison), generalized from "must not change" to "must not vanish".
 *
 * @remarks Incident (2026-07-25): a `plan-promote` feeding pack told a caller to
 *   recover via `lore_set extra {"requires_uat": true}`. Followed literally over
 *   MCP, the write replaced `extra` wholesale and the plan lost its 4
 *   `extra.phases` entries — discovered only when a later `lore create task
 *   --phase` failed with "parent plan declares no phases". Guards the three
 *   structured fields with a documented dedicated-writer seam reachable through
 *   this generic path: `plan.extra.phases` (`PhaseService` — `lore phase add`),
 *   `task.extra.claim` (`TaskWorkflowService` — `lore claim` / `lore release`),
 *   `task.extra.verification_evidence` (`TaskWorkflowService` — `lore evidence`).
 *   `task.extra.file_anchors` is DELIBERATELY excluded — `taskExtraSchema`'s own
 *   JSDoc (`@lore/core`) already documents `lore set` as never a sanctioned write
 *   path for anchors ("a wholesale-extra replace flag was deliberately not built
 *   for anchors"), so guarding a drop there would be scope creep past this
 *   incident's actual blast radius (fields `lore set` legitimately CAN write, but
 *   must not do so destructively).
 */
function findDroppedStructuredExtraField(
  existing: DocRecord,
  incomingExtra: Record<string, unknown>,
): { field: string; writerHint: string } | null {
  if (existing.type === "plan") {
    const phasesBefore = existing.extra["phases"];
    const hadPhases = Array.isArray(phasesBefore) && phasesBefore.length > 0;
    if (hadPhases && incomingExtra["phases"] === undefined) {
      return { field: "extra.phases", writerHint: "`lore phase add`" };
    }
  }
  if (existing.type === "task") {
    const claimBefore = existing.extra["claim"];
    if (claimBefore !== undefined && claimBefore !== null && incomingExtra["claim"] === undefined) {
      return { field: "extra.claim", writerHint: "`lore claim` / `lore release`" };
    }
    const evidenceBefore = existing.extra["verification_evidence"];
    const hadEvidence = Array.isArray(evidenceBefore) && evidenceBefore.length > 0;
    if (hadEvidence && incomingExtra["verification_evidence"] === undefined) {
      return { field: "extra.verification_evidence", writerHint: "`lore evidence`" };
    }
  }
  return null;
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
  /**
   * Forwarded verbatim to {@link StoreInterface.findMany} — see
   * {@link StoreFilters.limit} for the full contract (omitted → unbounded,
   * byte-identical to pre-pagination behavior).
   *
   * `list()`'s `total` field is (and always was, even before pagination)
   * "count of docs actually returned by this call", never "count of all rows
   * matching the filter in the corpus" — so paging composes without a
   * separate unpaged count query. When BOTH `limit`/`offset` AND
   * `include_invalid` (default `false`) are combined on a `knowledge`/`adr`
   * listing, the store-level page is taken FIRST and the invalidated-doc
   * filter is applied to that page afterward — a page may legitimately
   * return fewer than `limit` docs when some of its rows are invalidated.
   * Widen the page (`limit`) or pass `include_invalid: true` if an exact
   * page size is required for that case.
   */
  limit?: number;
  /** See {@link ListFilters.limit}. */
  offset?: number;
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
  /**
   * SPEC-080 §C4 — every ACTIVE plan currently carrying a valid
   * `extra.prd_sync_exempt` (`extractPrdSyncExempt` returning non-`undefined`),
   * pointer-only (slug — never the exemption's `reason`/`by`/`at`, mirroring
   * `invalidated_feeding_source_warnings`'s pointer-not-dump shape). Closes the
   * SPEC-069 `attestation_exempt` field's documented invisibility gap (zero
   * status/doctor/dashboard surfacing) — that miss is not repeated here.
   * Follows the EXACT same convention `invalidated_feeding_source_warnings`
   * already established: empty when nothing is exempt (never omitted — always
   * a fact, not absent data).
   */
  exempt_plans: Array<{ slug: string }>;
}

/**
 * Result of the R1 plan-close cascade `set()` runs inline immediately after a
 * plan's OWN archival write commits (spec-lifecycle-archival-plan-close-cascade-deterministic
 * §Design Decisions D2). Spliced onto the returned `DocRecord` as an
 * additional `cascade` property (see `set()`'s own JSDoc for why this is a
 * backward-compatible widening rather than a `set()` signature change) —
 * present ONLY for an actual plan→archived transition, absent for every other
 * `set()` call (never present-as-empty).
 *
 * @invariant `failed`/`skipped` are LOUD, never silent — a cascade failure on
 *   one doc never rolls back the plan's own archival (D2), but it is always
 *   itemized here rather than swallowed.
 */
export interface PlanCloseCascadeResult {
  readonly archived: ReadonlyArray<{ doc_id: DocId; slug: string; kind: "task" | "handoff" }>;
  readonly skipped: ReadonlyArray<{ doc_id: DocId; slug: string; reason: string }>;
  readonly failed: ReadonlyArray<{ doc_id: DocId; slug: string; reason: string }>;
}

/**
 * The two candidate attributors `hasPrdSyncContentDiffInWindow` checks a
 * qualifying domain-doc edit against (spec-plan-close-predicates-measure-
 * invariants-an-applicability §D6) — the closing plan's own identifiers, and
 * its governing (ancestor) spec's identifiers. Both `id` AND `slug` are
 * carried per referent because a content author might reasonably type
 * either one; edge attribution is matched purely by `id` (link rows are
 * id-addressed). Module-private — never part of `CorpusService`'s public
 * surface, this is plumbing between one gate-assembly call site and one
 * private method.
 */
interface PrdSyncAttributionTargets {
  readonly planId: DocId;
  readonly planSlug: string;
  readonly specId: DocId;
  readonly specSlug: string;
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
   * @param traceRecorder - OPTIONAL SPEC-102 read-instrumentation port — when present,
   *   `get`/`search` fire a fire-and-forget trace row via `TraceRecorder.recordGet`/
   *   `recordSearch` (`./trace-recorder.js`) AFTER the store call succeeds, never
   *   before and never on a failed lookup. Absent (the default) → zero trace writes,
   *   byte-identical to pre-SPEC-102 behavior — same "absent in bare tests, present in
   *   production" shape as `gateEnforcer`.
   * @param ledgerAutoApprove - OPTIONAL SPEC-103 §Mechanisms M1 kill switch — resolved
   *   config value (`resolveLedgerAutoApprove`, `@lore/core`, default `true`). When
   *   `true`, `_createImpl` fast-tracks a ledger knowledge doc (assessment/retro/
   *   handoff/uat, `isLedgerKnowledgeSubType`) draft→approved in the SAME create write,
   *   and `set` applies the reset→re-fast-track (D4) on an edit to an approved ledger
   *   doc as TWO separate, individually-atomic writes within the same `set()` call —
   *   NOT one cross-write transaction (see `set`'s own inline comment at the
   *   re-fast-track call site for the accepted residual this leaves). Absent/`undefined`
   *   (every bare `new CorpusService(store)` unit-test
   *   construction) → feature OFF, byte-identical to pre-SPEC-103 behavior — same
   *   "absent in bare tests, present in production" shape as `gateEnforcer`/
   *   `traceRecorder`; only `app.ts`'s composition root resolves and wires the real
   *   config-default-`true` value.
   */
  constructor(
    private readonly store: StoreInterface,
    telemetry: Telemetry = new NoOpTelemetry(),
    private readonly claimTtlMinutes?: number,
    private readonly gateEnforcer?: GateEnforcer,
    private readonly traceRecorder?: TraceRecorder,
    private readonly ledgerAutoApprove?: boolean,
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

  /**
   * Resolve the acting identity for a write (SPEC-079 G2 actor fidelity) —
   * the SAME `--by`/`$LORE_ACTOR`/session-tier/OS-username precedence chain
   * the CLI's `resolveActor` already applies (`resolveActorWithSource`,
   * `@lore/core/node`), reused here so a service-layer write (through the
   * CLI, MCP, or HTTP dashboard) is never silently attributed to the literal
   * `"system"` when its caller doesn't (or can't) supply `opts.by`.
   *
   * @param by - Explicit actor value threaded from the caller's `opts.by`
   *   (adapters resolve their own surface's actor identity and pass it
   *   here); `undefined` falls through to the env chain.
   * @returns The resolved actor string — never empty.
   */
  private resolveWriteActor(by?: string): string {
    return resolveActorWithSource(by, process.env).actor;
  }

  // ── Resolve ──────────────────────────────────────────────────────────────

  /**
   * Resolve any string input to a DocId.
   *
   * Delegates the actual resolution to `resolveDoc` (`./resolve.js`) — the
   * SAME SSOT every other service (`ReviewService`, `TaskWorkflowService`,
   * `AcService`, etc., per `service/CLAUDE.md`) already resolves
   * id-or-slug arguments through. This method used to duplicate that
   * resolution logic by hand (exact ULID/slug match only) and had drifted
   * out of sync with it — missing BOTH the SPEC-084 ordinal-ref step
   * (`"SPEC-84"` → `parseOrdinalRef` → `store.findByTypeOrdinal`) and the
   * SPEC-065 unique id-prefix fallback, so `dist/lore get ADR-1` /
   * `set`/`delete` on an ordinal-style reference — or a truncated id-prefix
   * — exited `DOC_NOT_FOUND` even though the doc existed
   * (task-skill-implement-fix-corpusservice-resolve-duplicate).
   *
   * @invariant On a `DOC_NOT_FOUND` miss `resolveDoc` did NOT already
   *   annotate with its own prefix-truncation diagnostic, this method
   *   enriches the error with CorpusService's pre-existing, richer
   *   substring-fuzzy suggestions (`buildSuggestions`/`buildSlugSuggestions`
   *   below) — a legitimate CorpusService-specific UX behavior (surfaced via
   *   `describeLoreError`'s "Did you mean one of: …?", CLI `utils.ts`),
   *   deliberately preserved rather than silently dropped by this
   *   delegation. When `resolveDoc` DID supply a diagnostic (the input was
   *   prefix-shaped), that diagnostic wins — it is more specific than a
   *   generic fuzzy match.
   */
  async resolve(input: string): Promise<Result<DocId, LoreError>> {
    const result = await resolveDoc(this.store, input);
    if (result.ok) return ok(result.value.id);

    if (
      result.error.code === "DOC_NOT_FOUND" &&
      !(result.error.suggestions && result.error.suggestions.length > 0)
    ) {
      const suggestions = isUlid(input)
        ? await this.buildSuggestions(input)
        : await this.buildSlugSuggestions(input);
      if (suggestions.length > 0) {
        return err({ ...result.error, suggestions });
      }
    }

    return result;
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
  async create(
    input: CreateDocInput,
    opts?: WriteActorOpts,
  ): Promise<Result<CreateDocResult, LoreError>> {
    const startMs = Date.now();
    const result = await this._createImpl(input, opts);
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

  /**
   * Internal creation seam for SPEC-054 UAT verdict docs — the SOLE way a `knowledge`
   * doc with `extra.sub_type: "uat"` may be created. Mirrors {@link createHandoffDoc}:
   * runs the full `_createImpl` pipeline with ONLY the uat writer-identity rejection
   * skipped (`opts.allowUat: true`). The public `create()` / `lore create` path keeps
   * rejecting sub_type "uat" so the typed `extra.uat` payload can never be hand-forged.
   * `UatService.record` is its production caller (bound in `app.ts`).
   */
  async createUatDoc(input: CreateDocInput): Promise<Result<DocRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._createImpl(input, { allowUat: true });
    this.recordTelemetryEvent("create", startMs, result, { type: input.type });
    return result;
  }

  private async _createImpl(
    input: CreateDocInput,
    opts?: WriteActorOpts & { allowHandoff?: boolean; allowUat?: boolean },
  ): Promise<Result<CreateDocResult, LoreError>> {
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

    // SPEC-079 G2 — resolved once per call, reused for this create's audit entry.
    const resolvedActor = this.resolveWriteActor(opts?.by);

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

    // Write-path exclusivity for knowledge sub_type "uat" (SPEC-054) — same
    // writer-identity guard as "handoff" above: extra.uat is user-supplied data, so a Zod
    // presence check alone (knowledgeExtraSchema) cannot enforce "only `lore uat record`
    // may write this sub_type." `opts.allowUat` is the internal bypass ONLY
    // `createUatDoc` sets — never exposed on the public `create()` overload.
    if (
      data.type === "knowledge" &&
      (data.extra?.["sub_type"] as unknown) === "uat" &&
      opts?.allowUat !== true
    ) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.sub_type",
        message:
          'knowledge sub_type "uat" may only be created via `lore uat record` — ' +
          "direct creation through `lore create` / `lore_create` is not permitted",
        value: "uat",
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
    // reason: SPEC-049 §Design Decisions D3 — captured alongside resolvedParentType
    // so the spec-create gate below can thread `GateContext.parentMarkdown` without
    // a second `store.find` call. Unlike `gate.ts::runSpecCreateGate`'s
    // `renderDocMarkdown` (which MDX-splices via `OutlineService.resolve`), this is
    // the RAW `parentDoc.content` — CorpusService must not import OutlineService
    // (no cross-service calls, service/CLAUDE.md), so the feeding pack's parent
    // slice here is unresolved markdown, same as every other GateContext field this
    // service already builds without adapter-layer help.
    let resolvedParentMarkdown: string | null = null;
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
      resolvedParentMarkdown = parentDoc.content;
    }

    // Ad-hoc task auto-parenting to the corpus root PRD (SPEC-069 §Design
    // Decisions D2). reason: an ad-hoc task deliberately supplies NO
    // --parent/--plan-id — `taskExtraSchema`'s superRefine (schemas.ts)
    // relaxes `plan_id`, and `createDocInputSchema`'s superRefine relaxes the
    // top-level `parent_id` requirement, for exactly this shape
    // (`extra.adhoc === true`). CorpusService, not the CLI, resolves the
    // actual parent here so every ad-hoc task lands on the SAME anchor
    // regardless of caller surface (CLI/MCP/HTTP all reach this one code
    // path). Reuses the exact "first PRD" lookup `tree()`'s no-root-given
    // default already uses (`store.findMany({type: "prd"})[0]`) — no new
    // root-finding heuristic introduced. Deliberately bypasses
    // `isValidParentType`/`PARENT_TYPE_CONTRACT` (whose only declared task
    // parent is `plan`) — SPEC-069 D2 explicitly parents ad-hoc tasks to the
    // root PRD "for tree reachability", a narrower purpose than full
    // parent-type membership; widening `PARENT_TYPE_CONTRACT.task` itself
    // would legalize task→prd for EVERY task (including a --plan-id-less,
    // non-adhoc caller forcing --parent to a PRD), which is not this design's
    // intent.
    if (data.type === "task" && data.parent_id === undefined && data.extra?.["adhoc"] === true) {
      const prdsResult = await this.store.findMany({ type: "prd" });
      if (!prdsResult.ok) return prdsResult;
      const rootPrd = prdsResult.value[0];
      if (!rootPrd) {
        return err({
          code: "VALIDATION_ERROR",
          field: "parent_id",
          message:
            "cannot create an --adhoc task: no root PRD exists in this corpus to parent it to",
        });
      }
      resolvedParentId = rootPrd.id;
      resolvedParentType = rootPrd.type;
      resolvedParentMarkdown = rootPrd.content;
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

    // Generate collision-free slug. transliterate: getTransliterateCjk (SPEC-068
    // D1) — CJK titles get a pinyin-derived slug instead of collapsing to the
    // bare type name (kebab's [^a-z0-9]+ strips every non-ASCII character
    // otherwise). Only awaited when the title actually contains CJK — an
    // ASCII-only title never pays the pinyin-pro load cost.
    // reason: exactOptionalPropertyTypes forbids `{ transliterate: undefined }`
    // — omit the key entirely (not just set it undefined) when the title has
    // no CJK, rather than always spreading an `undefined`-valued property.
    const slugOpts = containsCjk(data.title) ? { transliterate: await getTransliterateCjk() } : undefined;
    const slug = await slugifyWithCollision(
      data.type,
      data.title,
      async (candidate) => {
        const r = await this.store.findBySlug(candidate);
        return r.ok && r.value !== null;
      },
      slugOpts,
    );

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

    // SPEC-103 §Mechanisms M1 — ledger fast-track (D1: knowledge sub_types
    // assessment/retro/handoff/uat ONLY; `task` is deliberately excluded, see
    // `isLedgerKnowledgeSubType`'s own JSDoc). Reads `resolvedExtra` — the SAME
    // object that becomes `doc.extra` below — never a second, independently-derived
    // sub_type source. `this.ledgerAutoApprove === true` (not `!== false`) means
    // every bare unit-test construction (the field defaults to `undefined`) keeps
    // this OFF, byte-identical to pre-SPEC-103 behavior (constructor JSDoc).
    const shouldLedgerFastTrack =
      this.ledgerAutoApprove === true &&
      data.type === "knowledge" &&
      isLedgerKnowledgeSubType(resolvedExtra["sub_type"]);

    // SPEC-084 §Changed semantics "Allocation timing" — WHETHER to allocate a
    // store-atomic ordinal is decided HERE (service layer); HOW (MAX+1 +
    // insert + bounded retry, transaction-scoped) lives entirely in
    // `store.insertWithAllocatedOrdinal` (SPEC-084 D1) — this service never
    // computes a candidate ordinal itself, only the boolean gate. Eligible
    // iff `data.type` is a registry key AND the resolved kind (same
    // `resolvedExtra["spec_kind"]` the spec-create gate ctx above reads) is
    // not one of that entry's `exemptKinds` (data, not logic — SPEC-084 D4).
    const ordinalRegistryEntry = ORDINAL_REGISTRY[data.type];
    const candidateOrdinalKind =
      typeof resolvedExtra["spec_kind"] === "string" ? resolvedExtra["spec_kind"] : undefined;
    const isExemptOrdinalKind =
      ordinalRegistryEntry?.exemptKinds !== undefined &&
      candidateOrdinalKind !== undefined &&
      ordinalRegistryEntry.exemptKinds.includes(candidateOrdinalKind);
    const shouldAllocateOrdinal = ordinalRegistryEntry !== undefined && !isExemptOrdinalKind;

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
      // reason: SPEC-049 §Design Decisions D3 — a blocked verdict now embeds the
      // full feeding pack (GateEnforcer D1), and spec-create's pack quotes the
      // governing rule doc (`ruleSource`/`ruleMarkdown`). Pre-fetching it here is
      // the ONE extra store read `gate.ts::runSpecCreateGate` already pays for the
      // identical lookup — skipped entirely when the checkpoint is disabled
      // (`isEnabled` short-circuits BEFORE the read, mirroring `gate.ts`'s own
      // isGateDisabledByConfig-before-runXGate order) so a disabled checkpoint
      // stays byte-identical to pre-D3 behavior (zero extra IO). A missing/failed
      // lookup leaves `ruleSource`/`ruleMarkdown` absent — the pack degrades to
      // `[source: unknown]` (never a second, differently-shaped error; mirrors
      // `writeProvenanceLink`'s fail-soft posture elsewhere in this file) — still
      // strictly more information than the pre-D3 bare discriminator.
      let ruleEnrichment: Pick<GateContext, "ruleSource" | "ruleMarkdown"> = {};
      if (this.gateEnforcer.isEnabled("spec-create")) {
        const feedingSkillResult = await this.findFeedingSkill(SPEC_CREATE_FEEDING_SCOPE);
        if (feedingSkillResult.ok && feedingSkillResult.value !== null) {
          ruleEnrichment = {
            ruleSource: feedingSkillResult.value.slug,
            ruleMarkdown: feedingSkillResult.value.content,
          };
        }
      }
      // reason: AC-Quantifiability Gate spec §Design — a spec created with INLINE
      // `extra.acceptance_criteria` (the service-layer create path; `lore ac add`
      // is the more common post-create path and has its own immediate lint in
      // `AcService.addCriterion`) must not slip an unquantified abstract-quality
      // AC past spec-create. `undefined` when absent/malformed — `acQuantifiable`'s
      // vacuous-pass semantics treat that identically to "no ACs declared yet".
      const acceptanceCriteriaParsed = specAcceptanceCriteriaSchema.safeParse(
        resolvedExtra["acceptance_criteria"],
      );
      const gateCtx: GateContext = {
        parentType: resolvedParentType,
        ...(typeof resolvedExtra["spec_kind"] === "string"
          ? { specKind: resolvedExtra["spec_kind"] }
          : {}),
        content: data.content ?? "",
        ...ruleEnrichment,
        ...(resolvedParentMarkdown !== null ? { parentMarkdown: resolvedParentMarkdown } : {}),
        ...(acceptanceCriteriaParsed.success ? { acceptanceCriteria: acceptanceCriteriaParsed.data } : {}),
        acQuantifiableEnabled: this.gateEnforcer.isAcQuantifiableEnabled("spec-create"),
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
      // SPEC-103 §Mechanisms M1 — a fast-tracked ledger doc lands "approved" in
      // THIS same write; every other doc (including a ledger sub_type when the
      // kill switch is off) keeps the pre-existing "draft" default.
      status: shouldLedgerFastTrack ? "approved" : "draft",
      priority: data.priority ?? "medium",
      // reason: canonicalise at write time so corpus content is always normalised.
      // Prevents roundtrip whitespace drift between export-docs and sync-docs.
      // Source: SPEC-021 §4 "CRITICAL — whitespace parity"; empty content stays "".
      content: data.content !== undefined && data.content !== "" ? canonicaliseBody(data.content) : (data.content ?? ""),
      parent_id: resolvedParentId,
      created_at: now,
      updated_at: now,
      // reason: literal "system" is the historical default (SPEC-079 G2 left it
      // out of scope); `opts.attributeCreatedBy` (cookie-session HTTP writes
      // only, see WriteActorOpts) opts into the SAME resolved actor already
      // computed above for the audit entry — see `adr-dashboard-cookie-session-
      // writes-attribute-author-via`.
      created_by: opts?.attributeCreatedBy === true ? resolvedActor : "system",
      version: 1,
      deleted_at: null,
      tags: data.tags ?? [],
      extra: resolvedExtra,
      // reason: SPEC-084 §Module Boundary — explicit `null` (never a bare
      // `undefined`) for every create, eligible or not. `insertWithAllocatedOrdinal`
      // (below, eligible path only) IGNORES/OVERWRITES this input value with the
      // real allocated candidate per its own StoreInterface contract, so this
      // literal only matters for the non-eligible branch — where it must read as
      // a real `null` (not an absent key) for callers like `formatDocDisplayId`
      // and this suite's own `.ordinal).toBeNull()` assertion.
      ordinal: null,
    };

    // BUG-002 (audit finding) — insert + version-1 snapshot + create audit entry
    // as ONE atomic composite write (StoreInterface.insertWithProvenance /
    // insertWithAllocatedOrdinalAndProvenance): the pre-fix code ran these as
    // three independent `await`s, so a version/audit failure after a
    // successful insert left a PERMANENTLY orphaned doc (zero version
    // history, zero audit trail, no signal to the caller that partial state
    // landed). All three writes now commit or roll back together for BOTH
    // the numbered and non-numbered create paths — see insertWithProvenance's
    // JSDoc on StoreInterface for the per-store atomicity mechanism (SQLite:
    // BEGIN IMMEDIATE/COMMIT/ROLLBACK; Turso: a real client.transaction();
    // InMemory: manual undo-on-failure).
    const creationVersion: VersionRecord = {
      doc_id: id,
      version: 1,
      content: doc.content,
      extra: doc.extra,
      status: doc.status,
      title: doc.title,
      action: "create",
      created_at: now,
      created_by: doc.created_by,
      // SPEC-072 D1/D2 — version rows write the doc's slug from now on.
      slug: doc.slug,
    };
    const creationAudit: AuditEntry = {
      timestamp: now,
      // SPEC-079 G2 — resolved actor (--by > $LORE_ACTOR > session tier > OS
      // username), never the literal "system". `doc.created_by`/the versions
      // row above are OUT of this spec's scope (unchanged, still "system") —
      // see corpus-service.ts's SPEC-079 note at the top of this method.
      actor: resolvedActor,
      session_id: id,
      action: "create",
      doc_id: id,
      // reason: SPEC-035 §2 — every audit writer stamps the version its action
      // produced (`details.version`), so AuditService.verify can join versions⋈audit
      // on an exact (doc_id, version) pair. Creation always produces version 1.
      // `auto: "ledger-fast-track"` (SPEC-103 M1, AC-TIER-1) marks the ONE audit row
      // this create write produces as the fast-track event — never a second row for
      // create (unlike `set`'s edit-reset case, which needs two, see D4).
      details: {
        type: doc.type,
        slug: doc.slug,
        version: 1,
        ...(shouldLedgerFastTrack ? { auto: "ledger-fast-track" } : {}),
      },
    };

    // reason: SPEC-084 D1 follow-up (closes the BUG-002 window this method's
    // numbered path had reintroduced) — `insertWithAllocatedOrdinalAndProvenance`
    // is the ordinal-aware sibling of `insertWithProvenance`, combining the
    // MAX+1/bounded-retry allocation with the doc+version+audit atomicity in
    // ONE transaction. The numbered and non-numbered branches now share the
    // SAME atomicity guarantee; only WHICH store method allocates the
    // ordinal differs.
    const insertResult: Result<DocRecord, LoreError> = shouldAllocateOrdinal
      ? await this.store.insertWithAllocatedOrdinalAndProvenance(doc, creationVersion, creationAudit)
      : await this.store.insertWithProvenance(doc, creationVersion, creationAudit);
    if (!insertResult.ok) return insertResult;

    // Provenance auto-write (IoC vertical-slice tech-spec §4.1 P4, "governs" edge from
    // the feeding skill to the artifact it fed) — fail-soft by construction, see
    // writeProvenanceLink's JSDoc. The created doc is already durably persisted above;
    // this is metadata layered on top and must never turn a successful create into an
    // error.
    await this.writeProvenanceLink(insertResult.value);

    // Create-time orphan advisory (task-create-time-orphan-advisory-warn-or-default-
    // parent-to-root). reason: skipped entirely for the internal handoff/uat bypass
    // paths (`opts.allowHandoff`/`opts.allowUat`) — those knowledge docs are linked to
    // their subject via a graph `informs` edge, not `parent_id`, so a null parent there
    // is expected shape, not an omission the advisory should ever flag.
    const orphanAdvisory =
      opts?.allowHandoff !== true && opts?.allowUat !== true
        ? await this.computeOrphanAdvisory(data.type, resolvedParentId, insertResult.value.slug)
        : undefined;

    return ok(
      orphanAdvisory !== undefined
        ? { ...insertResult.value, orphan_advisory: orphanAdvisory }
        : insertResult.value,
    );
  }

  /**
   * Create-time orphan advisory (task-create-time-orphan-advisory-warn-or-default-
   * parent-to-root, dogfood finding 2026-07-25): a non-blocking, informational note —
   * never an error, never a parent mutation — for a parentless adr/plan/knowledge
   * create WHILE a root PRD already exists in the corpus.
   *
   * @invariant Orchestrator decision: ADVISORY-ONLY, never default-parenting. Silently
   *   changing `parent_id` on a flagless create would be implicit magic; the SPEC-069
   *   `--adhoc` auto-parenting precedent (`_createImpl`'s ad-hoc task block above) only
   *   fires under an EXPLICIT `--adhoc` flag, never implicitly for a plain create.
   * @invariant Deliberately silent when no root PRD exists yet — the SAME pre-PRD-
   *   exploration deadlock rationale `spec`/`task`'s mandatory `parent_id` was carved
   *   around (module header, "Gap" section of the governing task). Reuses the EXACT
   *   "first PRD" lookup the ad-hoc auto-parenting block above already uses
   *   (`store.findMany({type:"prd"})[0]`) — no second root-finding heuristic introduced.
   * @param type - The doc's type; only `ORPHAN_ADVISORY_TYPES` members can trigger this.
   * @param resolvedParentId - The already-resolved parent id (`null` = no parent supplied).
   * @param slug - The just-created doc's own slug, named in the repair command.
   * @returns `undefined` when not applicable (wrong type, parent supplied, no root PRD,
   *   or the root-PRD lookup itself failed — a read failure degrades silently rather
   *   than turning a successful create into an error) — a fact, never surfaced as an
   *   error; a one-line repair-command string otherwise.
   */
  private async computeOrphanAdvisory(
    type: DocType,
    resolvedParentId: DocId | null,
    slug: string,
  ): Promise<string | undefined> {
    if (resolvedParentId !== null || !ORPHAN_ADVISORY_TYPES.has(type)) return undefined;
    const prdsResult = await this.store.findMany({ type: "prd" });
    if (!prdsResult.ok) return undefined;
    const rootPrd = prdsResult.value[0];
    if (!rootPrd) return undefined;
    return (
      `Advisory: '${slug}' has no parent — consider ` +
      `\`lore link ${slug} ${rootPrd.slug} --type parent\` to attach it to the root PRD.`
    );
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
    // reason: SPEC-102 — fire-and-forget trace row AFTER the store call
    // succeeds, never before and never on a failed lookup (a NOT_FOUND/
    // STORE_ERROR result records nothing — "get" traces a REAL doc read).
    // `traceRecorder` is absent in every bare test construction, mirroring
    // `gateEnforcer`'s identical optional-DI shape.
    if (result.ok && this.traceRecorder !== undefined) {
      this.traceRecorder.recordGet(this.resolveWriteActor(undefined), result.value.doc.id);
    }
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

    // Related — non-parent outbound links. Batch the "other side" doc fetch into
    // ONE findByIds call instead of one store.find per link (SPEC review M6) —
    // gather the distinct other-side ids first, then resolve from the returned map.
    const linksResult = await this.store.findLinks(doc.id, "both");
    const related: Array<DocSummary & { link_type: LinkType }> = [];

    if (linksResult.ok) {
      const nonParentLinks = linksResult.value.filter((l) => l.link_type !== "parent");
      const otherIds = Array.from(
        new Set(nonParentLinks.map((link) => (link.from_id === doc.id ? link.to_id : link.from_id))),
      );
      // reason: skip the round trip entirely when there's nothing to batch — a doc
      // with zero non-parent links (or only a parent link) has no otherIds, so
      // findByIds([]) would be a pointless call even though the store short-circuits
      // it before touching SQL.
      const othersResult = otherIds.length > 0 ? await this.store.findByIds(otherIds) : ok(new Map<DocId, DocRecord>());
      if (othersResult.ok) {
        for (const link of nonParentLinks) {
          const otherId = link.from_id === doc.id ? link.to_id : link.from_id;
          const other = othersResult.value.get(otherId);
          if (other !== undefined) {
            related.push({ ...this.toSummary(other), link_type: link.link_type });
          }
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
   *
   * @param opts.expectedVersion - BUG-003 (audit finding) fix. When supplied, this
   *   is the version the CALLER's own optimistic-concurrency check (e.g. the
   *   dashboard's `If-Match` header) was made against, and it is threaded straight
   *   through as the store's CAS `expected_version` guard — REPLACING this method's
   *   own internal fresh-read of `existing.version`. Pre-fix, `set()` always CAS'd
   *   against its OWN just-resolved `existing.version`, making a route-level
   *   precheck (`checkConcurrency`) purely advisory: two callers who both read the
   *   doc at v5 and both pass their own precheck could BOTH reach `set()`, and the
   *   second one's fresh internal read would already see v6 (the first one's
   *   commit) — CAS'ing against ITS OWN fresh v6 read instead of the v5 the caller
   *   actually validated against, silently overwriting the first writer's commit
   *   with no conflict ever surfacing (a classic lost update). Passing
   *   `expectedVersion` closes that gap: the second caller's declared v5 no longer
   *   matches the row's true current version (6) by the time the write executes,
   *   so the store's CAS correctly returns `STALE_VERSION` instead of silently
   *   succeeding. Omitted (the pre-existing default) → behavior is BYTE-IDENTICAL
   *   to before this fix (CAS against this call's own fresh `existing.version`).
   */
  /**
   * @returns `ok(doc)` — `doc` is the updated `DocRecord`. For an ACTUAL plan→archived
   *   transition (SPEC-lifecycle-archival R1), `doc` carries an ADDITIONAL `cascade`
   *   property (`PlanCloseCascadeResult`) reporting which direct child tasks/handoffs
   *   were archived, skipped (fresh claim), or failed — see `cascadeArchiveOnPlanClose`'s
   *   JSDoc. Absent for every other call (never present-as-empty). This is a
   *   backward-compatible WIDENING of the pre-existing `DocRecord` return shape (an
   *   additional optional field), not a breaking signature change — every caller that
   *   only reads standard `DocRecord` fields is unaffected.
   */
  async set(
    idOrSlug: string,
    patch: DocPatch,
    opts?: WriteActorOpts & { expectedVersion?: number },
  ): Promise<Result<DocRecord & { cascade?: PlanCloseCascadeResult }, LoreError>> {
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
      !isValidTransition(existing.status, newStatus, existing.type)
    ) {
      return err({
        code: "INVALID_TRANSITION",
        from: existing.status,
        to: newStatus,
        allowed: getAllowedTransitions(existing.status, existing.type),
      });
    }

    const newVersion = existing.version + 1;

    // Build patch explicitly — exactOptionalPropertyTypes requires no undefined values in Partial<DocRecord>
    const docPatch: Partial<DocRecord> = {
      status: newStatus,
      version: newVersion,
      updated_at: now,
    };
    if (parsedPatch.data.title !== undefined) {
      // SPEC-084 §Changed semantics D6 "same re-check on set" — createDocInputSchema's
      // superRefine (schemas.ts) only guards the CREATE path; `docPatchSchema.title`
      // is untyped prose, so a rename must be independently re-checked here, or
      // `lore set --title "SPEC-099 — …"` reintroduces the exact self-declared-number
      // race the store-atomic allocator exists to kill. Applies regardless of the
      // doc's CURRENT (or incoming) spec_kind — isSelfDeclaredOrdinalTitle's own
      // contract restricts purely on `type`, since an exempt-kind doc can still flip
      // to numbered later and must never have carried a squatted title in the interim.
      if (isSelfDeclaredOrdinalTitle(existing.type, parsedPatch.data.title)) {
        return err({
          code: "VALIDATION_ERROR",
          field: "title",
          message:
            "title must not self-declare a SPEC-/ADR- number — the ordinal is allocated automatically; write the bare title",
          value: parsedPatch.data.title,
        });
      }
      docPatch.title = parsedPatch.data.title;
    }
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

    // Slug repair path (`lore set --slug`, SPEC-068 D5). `docPatchSchema.safeParse`
    // above already rejected a slugSchema-invalid candidate; the remaining
    // responsibility here is uniqueness. A patch that RESTATES the doc's OWN
    // current slug is a no-op by construction — `store.findBySlug` resolves to
    // THIS doc itself, so the `holder.id !== existing.id` check below never fires
    // and the lookup is skipped entirely (the `!== existing.slug` guard), leaving
    // `docPatch.slug` set to the same value the doc already has (a harmless
    // rewrite, not a special-cased early return — AC-068-8 "unchanged is a
    // no-op"). Slug is deliberately NOT part of the approved→draft auto-reset
    // trigger above (`contentOrTitleChanged`) — it is an address, not content.
    if (parsedPatch.data.slug !== undefined && parsedPatch.data.slug !== existing.slug) {
      const holderResult = await this.store.findBySlug(parsedPatch.data.slug);
      if (!holderResult.ok) return holderResult;
      if (holderResult.value !== null && holderResult.value.id !== existing.id) {
        return err({
          code: "VALIDATION_ERROR",
          field: "slug",
          message:
            `slug "${parsedPatch.data.slug}" is already taken by ` +
            `${holderResult.value.slug} (id ${holderResult.value.id})`,
          value: parsedPatch.data.slug,
        });
      }
    }

    // Destructive-wholesale-replace guard (task-gate-feeding-pack-recovery-via-lore-set-
    // extra-wholesale, 2026-07-25 incident). reason: docPatch.extra REPLACES existing.extra
    // wholesale (assembled two lines above this block) — there is no merge semantics
    // anywhere on this write path. A patch omitting a structured field that a DEDICATED
    // writer service owns (plan.extra.phases / task.extra.claim /
    // task.extra.verification_evidence) silently deletes it. Mirrors SPEC-043's
    // extra.validity writer-guard (below) but for "must not vanish" rather than "must not
    // change" — see findDroppedStructuredExtraField's JSDoc for the full incident + scope
    // rationale (why file_anchors is deliberately excluded).
    if (parsedPatch.data.extra !== undefined) {
      const dropped = findDroppedStructuredExtraField(existing, parsedPatch.data.extra);
      if (dropped !== null) {
        return err({
          code: "VALIDATION_ERROR",
          field: dropped.field,
          message:
            `${dropped.field} would be dropped by this patch — \`extra\` REPLACES the whole ` +
            `field wholesale, it does not merge with the doc's current extra. Use ` +
            `${dropped.writerHint} instead, or fetch the current extra via \`lore get ` +
            `${existing.slug} --json\` (read \`.extra\`), merge your change into it, and pass ` +
            `the FULL merged object as \`extra\`.`,
          value: parsedPatch.data.extra,
        });
      }
    }

    // Dedicated-writer guard: extra.outline (SPEC-080 C1) — STRONGER than the
    // drop-only guard immediately above: ANY direct patch whose `extra` carries
    // an "outline" key is rejected outright, even a byte-identical restate of
    // the doc's current outline (no value-equality escape hatch, unlike the
    // extra.validity guard below which tolerates a same-value restate). Only
    // `lore outline set` (PrdOutlineService's single-entry CAS patch) may ever
    // touch this field.
    if (parsedPatch.data.extra !== undefined && Object.prototype.hasOwnProperty.call(parsedPatch.data.extra, "outline")) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.outline",
        message: "extra.outline cannot be changed via `lore set` — use `lore outline set` instead",
        value: parsedPatch.data.extra["outline"],
      });
    }

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

    // plan.extra.prd_sync_exempt dedicated-writer guard (SPEC-080 C4) — mirrors
    // extra.validity's D10 shape immediately above, not the phases/claim/
    // verification_evidence "drop-only" shape: a patch whose extra.prd_sync_exempt
    // DIFFERS from the plan's CURRENT one — added where none existed, changed to a
    // different value, OR dropped — is rejected outright. Only `lore outline exempt`
    // (PrdOutlineService.exempt) may ever change this field. A patch that RESTATES
    // the current exemption verbatim (or that never mentions the key at all, on a
    // plan with no exemption) is a no-op by this check and proceeds normally.
    if (existing.type === "plan" && parsedPatch.data.extra !== undefined) {
      const incomingExempt = extractPrdSyncExempt({ extra: parsedPatch.data.extra });
      const currentExempt = extractPrdSyncExempt(existing);
      if (!prdSyncExemptEqual(incomingExempt, currentExempt)) {
        return err({
          code: "VALIDATION_ERROR",
          field: "extra.prd_sync_exempt",
          message:
            "extra.prd_sync_exempt cannot be changed via `lore set` — use `lore outline exempt` instead",
          value: parsedPatch.data.extra["prd_sync_exempt"],
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
      // reason: SPEC-058 D2 — oracleCoverage judges the spec against ITS OWN
      // spec_kind's configured profile. `effectiveExtra["spec_kind"]` mirrors the
      // value docPatch will actually persist (see this block's own comment above);
      // an absent/invalid value falls back to "feature" — the same create-time
      // default `_createImpl` already applies, never a second divergent default.
      const effectiveSpecKindRaw = effectiveExtra["spec_kind"];
      const effectiveSpecKind: SpecKind =
        typeof effectiveSpecKindRaw === "string" &&
        (SPEC_KINDS as readonly string[]).includes(effectiveSpecKindRaw)
          ? (effectiveSpecKindRaw as SpecKind)
          : "feature";
      const gateResult = this.gateEnforcer.enforce("spec-promote", {
        acceptanceCriteriaCount,
        specIdOrSlug: existing.slug,
        // reason: task-spec-promote-base-1-ac-rule-is-spec-kind-agnostic-spec-080
        // AC4 — feedSpecPromote's denial message names the RESOLVED kind, never a
        // hardcoded default; this is the SAME effectiveSpecKind already computed
        // above for verificationProfile, never a second lookup.
        specKind: effectiveSpecKind,
        ...(parsed.success ? { acceptanceCriteria: parsed.data } : {}),
        acQuantifiableEnabled: this.gateEnforcer.isAcQuantifiableEnabled("spec-promote"),
        verificationProfile: this.gateEnforcer.resolveVerificationProfile(effectiveSpecKind),
        oracleCoverageEnabled: this.gateEnforcer.isOracleCoverageEnabled(),
      });
      if (!gateResult.ok) return gateResult;
    }

    // Gate `plan-close` on a plan's → archived TRANSITION reached via `set` (SPEC-054 +
    // SPEC-069 §Design Decisions D1 + SPEC-080 §C4). `archived` is the lifecycle
    // terminal — "closing" a plan. Only fires for an ACTUAL close
    // (`existing.status !== "archived"`, so re-archiving is a no-op that never
    // re-blocks). Three independent sub-gates share this block:
    //   - `uatP0Accepted` (SPEC-054, OPT-IN): only evaluated when the plan declares
    //     `extra.requires_uat === true` — an opt-out plan archives unaffected (D2).
    //   - `attestationFloor` (SPEC-069, OPT-OUT): evaluated for EVERY closing plan unless
    //     it declares `extra.attestation_exempt: true` PLUS a non-empty
    //     `extra.attestation_exempt_reason` (a bare `attestation_exempt: true` with no
    //     reason is treated as NOT exempt — D1's "缺 reason 视同未豁免" rule) PLUS a valid
    //     `extra.attestation_exempt_kind` (spec-verify-reachability-plan-promote-early-
    //     warning §Scope M3 / §Design Decisions D3 — a missing/invalid kind does NOT
    //     satisfy the floor, `attestationFloor` still runs as if not exempt).
    //   - `prdOutlineSynced` (SPEC-080 §C4, OPT-IN via a DEFAULT-OFF config knob):
    //     evaluated only when `GateEnforcer.isPrdSyncEnabled()` is true AND the plan
    //     declares no valid `extra.prd_sync_exempt` — see the dedicated block below.
    //   - `assessmentFreshness` (SPEC-106, OPT-OUT): evaluated for EVERY closing plan
    //     unless it declares `extra.assessment_freshness_exempt: true` PLUS a
    //     non-empty `extra.assessment_freshness_exempt_reason` (mirrors
    //     `attestation_exempt`'s flag+reason shape exactly, D4 — no separate "exempt
    //     kind" taxonomy for this one). Vacuous pass when the plan has no linked
    //     assessment or no evidence/done task activity at all (D5).
    //
    // reason: `isPlanClosing` is reused below (after the write commits) to fire the
    // R1 plan-close cascade (spec-lifecycle-archival-plan-close-cascade-deterministic
    // §Design Decisions D2) — deliberately NOT gated on `this.gateEnforcer`/
    // `isEnabled("plan-close")` the way the sub-gate block immediately below is: the
    // cascade is a data-integrity mechanism independent of whether the ADVISORY
    // plan-close gate itself is configured on, so a corpus running with the gate
    // disabled still gets its execution-scoped docs cleaned up on close.
    const isPlanClosing =
      existing.type === "plan" && newStatus === "archived" && existing.status !== "archived";

    if (isPlanClosing && this.gateEnforcer && this.gateEnforcer.isEnabled("plan-close")) {
      const effectiveExtra = (parsedPatch.data.extra !== undefined
        ? parsedPatch.data.extra
        : existing.extra) as Record<string, unknown>;
      // ─── PLAN-CLOSE GATE-READ EXTRA FIELDS (AC-069-12 scan region) ────────
      // ⛔ Every plan-level `extra.*` field this block reads MUST have an
      // authoring surface under `packages/lore/src/adapters`. A gate that
      // demands a field no surface can author fails SILENT — measured: both
      // `attestation_exempt` and `assessment_freshness_exempt` shipped
      // gate-read with no writer, and with the only sanctioned opt-out
      // unreachable, four plans were archived by riding a vacuous predicate
      // instead. `tests/unit/cli/plan-exempt-attestation.test.ts` (AC-069-12)
      // scans BETWEEN these two sentinels and fails when a field read here has
      // no writer, so the next one fails a test instead of an incident.
      // Adding a read here ⇒ add the writer AND its row in that test's
      // AUTHORING_SURFACES map. Reads mediated by a helper (rather than a
      // literal `effectiveExtra["…"]` subscript) must be registered in the same
      // test's HELPER_READS map — an unregistered `extract*`/`resolve*` call in
      // this region fails the scan by construction. Keep both sentinels intact:
      // the scan THROWS (never silently passes) when it cannot find them.
      const requiresUat = effectiveExtra["requires_uat"] === true;
      const attestationExemptReason = effectiveExtra["attestation_exempt_reason"];
      const attestationExempt =
        effectiveExtra["attestation_exempt"] === true &&
        typeof attestationExemptReason === "string" &&
        attestationExemptReason.trim().length > 0;
      // reason: spec-verify-reachability-plan-promote-early-warning §Scope M3 —
      // the raw, UNVALIDATED kind is threaded through to `checkPlanClose`
      // (`attestationExemptKindValid` there is the SOLE fail-loud enforcement
      // point); `exemptKindValid` here is only a local optimization signal for
      // whether `getPlanBundle` needs fetching below, re-deriving the SAME
      // predicate rather than duplicating its enum logic.
      const attestationExemptKindRaw = effectiveExtra["attestation_exempt_kind"];
      const attestationExemptKind =
        typeof attestationExemptKindRaw === "string" ? attestationExemptKindRaw : undefined;
      const exemptKindValid = attestationExemptKindValid(attestationExempt, attestationExemptKind).ok;
      const prdSyncEnabled = this.gateEnforcer.isPrdSyncEnabled();
      const prdSyncExempt = extractPrdSyncExempt({ extra: effectiveExtra }) !== undefined;
      // reason: SPEC-106 §Design Decisions D4 — mirrors `attestationExempt`'s
      // flag-plus-non-empty-reason resolution EXACTLY (a bare
      // `assessment_freshness_exempt: true` with no reason is NOT exempt); there
      // is no separate "exempt kind" taxonomy for this predicate.
      const assessmentFreshnessExemptReason = effectiveExtra["assessment_freshness_exempt_reason"];
      const assessmentFreshnessExempt =
        effectiveExtra["assessment_freshness_exempt"] === true &&
        typeof assessmentFreshnessExemptReason === "string" &&
        assessmentFreshnessExemptReason.trim().length > 0;
      // ─── END PLAN-CLOSE GATE-READ EXTRA FIELDS ────────────────────────────

      let planCloseCtx: GateContext = { targetIdOrSlug: existing.slug };

      if (requiresUat) {
        const uatResult = await this.getLatestUatVerdict(existing.id);
        if (!uatResult.ok) return uatResult;
        planCloseCtx = {
          ...planCloseCtx,
          requiresUat: true,
          uatVerdictPresent: uatResult.value.present,
          uatP0Accepted: uatResult.value.p0Accepted,
          uatUncoveredP0: uatResult.value.uncoveredP0,
        };
      }

      planCloseCtx = {
        ...planCloseCtx,
        attestationExempt,
        ...(attestationExemptKind !== undefined ? { attestationExemptKind } : {}),
      };

      // reason: SPEC-080 §C4 — the attestation-floor branch and the
      // prdOutlineSynced branch both need `getPlanBundle` (the former for its
      // tasks' evidence counts, the latter for its tasks' claim timestamps AND
      // its resolved ancestor spec) — fetched AT MOST ONCE for this whole
      // block, never once per sub-gate. `!exemptKindValid` (spec-verify-
      // reachability-plan-promote-early-warning §Scope M3) joins the SAME
      // condition `checkPlanClose` uses to decide whether `attestationFloor`
      // itself runs — a plan claiming exemption with an invalid/missing kind
      // still needs its tasks' evidence counts for the feeding pack's
      // offending-task diagnostics.
      const needsBundle = !attestationExempt || !exemptKindValid || (prdSyncEnabled && !prdSyncExempt);
      const bundleResult = needsBundle ? await this.getPlanBundle(existing.id) : undefined;
      if (bundleResult !== undefined && !bundleResult.ok) return bundleResult;

      // reason: spec-plan-closure-must-be-loud-terminality-divergence-silent
      // §Design Decisions DD-4(a) — the live 2026-07-28 incident's root cause.
      // `getPlanBundle` has ALREADY resolved `bundle.spec` (the plan's
      // ancestor spec, or `undefined` when it has none) whenever `bundleResult`
      // is fetched above; this call site used to just drop that resolved fact
      // on the floor, leaving `hasSpecParent`/`parentSpecScriptAcCount`
      // permanently unset on `planCloseCtx` — which `verifyReachability`
      // (DD-4(b), gate-predicates.ts) then read as `undefined`, an outcome it
      // used to conflate with "resolved a genuinely non-spec parent" and
      // render as the false claim "no spec-tier ancestor at all". Threading
      // `buildUpstreamSpecContext(bundle.spec)` here — the SAME derivation
      // `plan-promote`/`task-claim` already use — makes this ctx a RESOLVED
      // fact (`hasSpecParent: true` or `false`, never left absent) whenever a
      // bundle was fetched at all; `countScriptModeAcceptanceCriteria` is the
      // SAME script-AC counter `ReviewService`'s plan-promote branch uses
      // (relocated to checkpoint-registry.ts for this exact reuse — see that
      // function's own JSDoc), never a second hand-rolled counter.
      if (bundleResult !== undefined) {
        const bundle = bundleResult.value;
        planCloseCtx = {
          ...planCloseCtx,
          ...buildUpstreamSpecContext(bundle.spec),
          ...(bundle.spec !== undefined
            ? { parentSpecScriptAcCount: countScriptModeAcceptanceCriteria(bundle.spec) }
            : {}),
        };
      }

      if (!attestationExempt || !exemptKindValid) {
        // reason: SPEC-075 D6 — the evidence/attested counting SSOT moved to
        // @lore/core's buildTaskAttestationInfos (evidence-panel.ts), which the
        // dashboard adjudication workbench's plan Evidence-panel branch also
        // calls; this call site no longer re-derives the same counts inline.
        const planTasksAttestation = buildTaskAttestationInfos(bundleResult!.value.tasks);
        // reason: spec-plan-close-predicates-measure-invariants-an-applicability
        // §D3/§D5 — per-claimed-AC attested-coverage facts, computed via the
        // SAME `computeAcCoverage` (@lore/core) AND the SAME declared-criteria
        // extraction (`specAcceptanceCriteriaSchema.safeParse` over
        // `spec.extra.acceptance_criteria`) that `countScriptModeAcceptanceCriteria`
        // (checkpoint-registry.ts, reused a few lines above via
        // `buildUpstreamSpecContext`) already applies to the SAME resolved
        // `bundle.spec` — no hand-rolled second extraction. `[]` when the plan
        // has no spec-tier ancestor at all (`bundle.spec === undefined`),
        // mirroring `parentSpecScriptAcCount`'s "populate only when relevant"
        // shape: a plan with nothing upstream has nothing to claim against.
        const declaredAcParsed = specAcceptanceCriteriaSchema.safeParse(
          bundleResult!.value.spec?.extra["acceptance_criteria"],
        );
        const declaredCriteria = declaredAcParsed.success ? declaredAcParsed.data : [];
        const planClaimedAcCoverage =
          bundleResult!.value.spec !== undefined
            ? computeAcCoverage(declaredCriteria, bundleResult!.value.tasks)
            : [];
        // reason: spec-declared-scope-attestation-contract-task-owned-ac-scope
        // §Facts D4 — the coverage conjunct's input is the DECLARED scope, not the
        // evidence-derived coverage above. Only this call site holds the task
        // DOCUMENTS that carry `extra.ac_scope`, so it resolves the fact and
        // threads it through `GateContext`; the predicate layer stays pure. Always
        // populated whenever this branch runs (never left absent, which
        // `checkPlanClose` would have to read as "undeclared").
        const planDeclaredScopeCoverage = deriveDeclaredScopeCoverage(
          bundleResult!.value.tasks,
          planClaimedAcCoverage,
        );
        planCloseCtx = {
          ...planCloseCtx,
          planTasksAttestation,
          attestationMinRatio: this.gateEnforcer.resolveAttestationMinRatio(),
          planClaimedAcCoverage,
          planDeclaredScopeCoverage,
        };
      }

      planCloseCtx = { ...planCloseCtx, prdSyncEnabled };
      if (prdSyncEnabled) {
        if (prdSyncExempt) {
          planCloseCtx = { ...planCloseCtx, prdSyncSynced: true };
        } else {
          const bundle = bundleResult!.value;
          // reason: `bundle.spec` is undefined for a PRD-parented or unparented
          // plan (getPlanBundle's own contract) — mirrors `hasSpecParent`'s
          // "no upstream spec edge, nothing to gate" vacuous-pass shape:
          // `prdSyncSynced` is left unset, and `checkPlanClose` only pushes
          // `prdOutlineSynced`'s result when that field IS set.
          if (bundle.spec !== undefined) {
            const domainDocResult = await resolvePrdSyncDomainDoc(this.store, bundle.spec);
            if (!domainDocResult.ok) return domainDocResult;
            const domainDoc = domainDocResult.value;
            if (domainDoc === null) {
              // reason: spec-plan-close-predicates-measure-invariants-an-
              // applicability §Design Decisions D1/D6 — the ancestor spec
              // resolving NO domain doc at all is a FACT about the corpus graph
              // (`resolvePrdSyncDomainDoc`'s own "ok(null), a FACT, never an
              // error" contract), not a violation two modules away. Passing
              // `null` through (never a fabricated `false`) is what lets
              // `prdOutlineSynced` return `notApplicable` instead of the
              // pre-fix, no-correct-action-clears-it denial — the measured
              // defect this fixes (`spec-context-provenance…`'s parent is the
              // root PRD with no `implements` edge).
              planCloseCtx = { ...planCloseCtx, prdSyncSynced: null };
            } else {
              const windowOpen = this.resolvePrdSyncWindowOpen(bundle.tasks, existing.created_at);
              // reason: spec-plan-close-predicates-measure-invariants-an-
              // applicability §D6 — `existing` IS the closing plan (this whole
              // block runs inside `isPlanClosing`'s `existing.type === "plan"`
              // branch) and `bundle.spec` is its resolved ancestor spec (the
              // SAME `bundle.spec !== undefined` guard this `else` branch is
              // nested inside) — both already-resolved docs, no extra IO.
              const diffResult = await this.hasPrdSyncContentDiffInWindow(domainDoc.id, windowOpen, now, {
                planId: existing.id,
                planSlug: existing.slug,
                specId: bundle.spec.id,
                specSlug: bundle.spec.slug,
              });
              if (!diffResult.ok) return diffResult;
              planCloseCtx = {
                ...planCloseCtx,
                prdSyncSynced: diffResult.value,
                prdSyncDomainDocSlug: domainDoc.slug,
              };
            }
          }
        }
      }

      planCloseCtx = { ...planCloseCtx, assessmentFreshnessExempt };
      if (!assessmentFreshnessExempt) {
        const freshnessResult = await this.getAssessmentFreshness(existing.id);
        if (!freshnessResult.ok) return freshnessResult;
        planCloseCtx = { ...planCloseCtx, ...freshnessResult.value };
      }

      const gateResult = this.gateEnforcer.enforce("plan-close", planCloseCtx);
      if (!gateResult.ok) return gateResult;
    }

    // BUG-002 (audit finding) — update + version snapshot + update audit entry as
    // ONE atomic composite write (StoreInterface.updateWithProvenance), mirroring
    // _createImpl's fix above. The version snapshot's content/extra/status/title
    // are derived from `docPatch` merged over `existing` — EXACTLY the same merge
    // `store.update`/`updateWithProvenance` perform internally (`{...current,
    // ...patch}`) — so this stays correct WITHOUT needing the store's return value
    // first (a chicken-and-egg the single composite call would otherwise create).
    //
    // BUG-003 (audit finding) fix: `expected_version` is `opts?.expectedVersion ??
    // existing.version` — see this method's own JSDoc `@param opts.expectedVersion`
    // for the full race this closes.
    //
    // reason: resolved ONCE, reused for both the version snapshot's `created_by`
    // (when `opts.attributeCreatedBy` opts in — see WriteActorOpts) and the audit
    // entry's `actor` below — a single source of truth for "who made this write",
    // never two independently-resolved values that could disagree.
    const resolvedActor = this.resolveWriteActor(opts?.by);
    const versionRecord: VersionRecord = {
      doc_id: existing.id,
      version: newVersion,
      content: docPatch.content ?? existing.content,
      extra: docPatch.extra ?? existing.extra,
      status: docPatch.status ?? existing.status,
      title: docPatch.title ?? existing.title,
      action: "update",
      created_at: now,
      // reason: literal "system" is the historical default (SPEC-079 G2 left it
      // out of scope); `opts.attributeCreatedBy` (cookie-session HTTP writes
      // only) opts into the resolved actor — see `adr-dashboard-cookie-session-
      // writes-attribute-author-via`.
      created_by: opts?.attributeCreatedBy === true ? resolvedActor : "system",
      // reason: SPEC-072 D1 — `slug` follows the EXACT same "state as of this
      // version" convention as content/extra/status/title above (docPatch's
      // new value when the patch changed it, else the unchanged existing
      // value). A `lore set --slug` rename therefore makes THIS row carry the
      // NEW slug; the OLD (pre-rename) slug remains readable on the PREVIOUS
      // version row (which, once this feature has been live since its own
      // creation, already carries the doc's slug at that point in time) —
      // `lore log --json` walking the full history recovers "what was the
      // slug at any historical version" (the spec's stated problem) without
      // this row needing a special before/after carve-out.
      slug: docPatch.slug ?? existing.slug,
    };

    // SPEC-084 §Changed semantics "Kind-flip semantics" — a spec_kind
    // transition FROM an exempt kind TO a numbered one must allocate an
    // ordinal at this write; the reverse (numbered→exempt) KEEPS whatever
    // ordinal already exists (never retracted/changed/reassigned — the
    // store method itself refuses a row that already carries one). Only
    // `ORDINAL_REGISTRY.spec` declares `exemptKinds` today, so this block is
    // a no-op for every other type/entry (`kindOrdinalEntry?.exemptKinds`
    // guards that). `versionRecord.extra` above already IS the final
    // post-patch extra (docPatch.extra when the caller supplied one, else
    // unchanged existing.extra) — reused here rather than re-deriving it.
    const kindOrdinalEntry = ORDINAL_REGISTRY[existing.type];
    let shouldAllocateOrdinalOnKindFlip = false;
    if (
      kindOrdinalEntry?.exemptKinds !== undefined &&
      (existing.ordinal === null || existing.ordinal === undefined)
    ) {
      // reason: the only registry entry with `exemptKinds` today is `spec`,
      // whose kind field is `extra.spec_kind` and whose absent/malformed
      // value already defaults to "feature" at create time (`_createImpl`'s
      // spec_kind default, mirrored — not re-derived — here). A future
      // ORDINAL_REGISTRY entry adding `exemptKinds` for a type with a
      // differently-named kind field would need this block widened.
      const resolveOrdinalKind = (extra: Record<string, unknown>): string => {
        const raw = extra["spec_kind"];
        return typeof raw === "string" && (SPEC_KINDS as readonly string[]).includes(raw)
          ? raw
          : "feature";
      };
      const existingKind = resolveOrdinalKind(existing.extra);
      const finalKind = resolveOrdinalKind(versionRecord.extra);
      const wasExemptKind = kindOrdinalEntry.exemptKinds.includes(existingKind);
      const isNowExemptKind = kindOrdinalEntry.exemptKinds.includes(finalKind);
      shouldAllocateOrdinalOnKindFlip = wasExemptKind && !isNowExemptKind;
    }

    const updateResult = await this.store.updateWithProvenance(
      existing.id,
      docPatch,
      { expected_version: opts?.expectedVersion ?? existing.version },
      versionRecord,
      {
        timestamp: now,
        // SPEC-079 G2 — resolved actor, never the literal "system".
        actor: resolvedActor,
        session_id: existing.id,
        action: "update",
        doc_id: existing.id,
        // reason: SPEC-035 §2 — `version` (not just the pre-existing `new_version`
        // alias) is the join key AuditService.verify matches against the versions
        // row's own `version` field.
        details: { patch: parsedPatch.data, new_version: newVersion, version: newVersion },
      },
    );
    if (!updateResult.ok) return updateResult;

    // SPEC-103 §Mechanisms M1, §Design Decisions D4 — uniform edit-reset semantics:
    // an edit to an approved ledger doc (assessment/retro/handoff/uat) still applies
    // the SAME approved→draft reset every other type gets (the write immediately
    // above, unchanged), THEN re-fast-tracks it back to approved via a SECOND
    // `updateWithProvenance` call within this SAME `set()` invocation — both steps
    // audited (this row's `details.auto = "ledger-fast-track"` names the second step;
    // the first write's own "update" audit row, already committed above, is unchanged
    // and untagged).
    //
    // reason: task-t3-hardening-reachable-override-escape-real-ai-provenance (verify-first
    // finding) — this is honestly TWO SEPARATE, individually-atomic `updateWithProvenance`
    // writes, NOT one cross-write transaction/CAS spanning both. Each call is atomic on its
    // own (doc patch + version row + audit row as one composite write, per StoreInterface's
    // own contract) but there is no shared transaction wrapping the pair: a crash/failure
    // in the gap between the reset write above committing and this re-fast-track write
    // starting leaves the doc "draft" at `resetVersion`, with only the untagged "update"
    // audit row — recoverable by a subsequent `set()`/`approve()` call, never silently lost,
    // but NOT the atomic guarantee the word "atomically" previously (incorrectly) claimed
    // here. This is an ACCEPTED residual (same class of window `ReviewService.approve`'s own
    // JSDoc documents for its post-write plan-promote re-check) — closing it fully would need
    // a NEW `StoreInterface` primitive for a two-row atomic write, out of this task's scope
    // (current frozen T2 store contract has no such call). One extra audit row + version bump
    // is the accepted cost (D4 rationale: "bypass-the-reset alternative rejected — history
    // inconsistency") — version history stays exactly as type-uniform as every other
    // approved-doc content/title edit, just with one additional row appended.
    // `effectiveExtraForLedger` mirrors this method's pre-existing `effectiveExtra`
    // pattern (spec-promote branch above): the patch's own `extra` when supplied,
    // else the doc's unchanged existing extra — never a second, divergent read.
    if (isApprovedAutoResetToDraft && this.ledgerAutoApprove === true) {
      const effectiveExtraForLedger = (docPatch.extra ?? existing.extra) as Record<string, unknown>;
      if (existing.type === "knowledge" && isLedgerKnowledgeSubType(effectiveExtraForLedger["sub_type"])) {
        const resetVersion = updateResult.value.version;
        const refastVersion = resetVersion + 1;
        const refastVersionRecord: VersionRecord = {
          doc_id: existing.id,
          version: refastVersion,
          content: updateResult.value.content,
          extra: updateResult.value.extra,
          status: "approved",
          title: updateResult.value.title,
          action: "update",
          created_at: now,
          created_by: versionRecord.created_by,
          slug: updateResult.value.slug,
        };
        const refastResult = await this.store.updateWithProvenance(
          existing.id,
          { status: "approved", version: refastVersion, updated_at: now },
          { expected_version: resetVersion },
          refastVersionRecord,
          {
            timestamp: now,
            actor: resolvedActor,
            session_id: existing.id,
            action: "update",
            doc_id: existing.id,
            details: { auto: "ledger-fast-track", version: refastVersion, reset_version: resetVersion },
          },
        );
        if (!refastResult.ok) return refastResult;
        return ok(refastResult.value);
      }
    }

    if (shouldAllocateOrdinalOnKindFlip) {
      // reason: SPEC-084 D1 — `allocateOrdinalForExisting` is the UPDATE-scoped
      // sibling of `insertWithAllocatedOrdinal`; it CAS-guards on the version
      // `updateWithProvenance` above just produced (not `existing.version` —
      // the patch write already bumped it by one) and bumps it again by one
      // on success. Two version bumps for what was conceptually one `set()`
      // call is an accepted consequence of the frozen T2 store contract
      // having no single call that does both the patch AND the ordinal
      // allocation atomically (same documented tradeoff as _createImpl's
      // numbered-type path above).
      const allocResult = await this.store.allocateOrdinalForExisting(
        existing.id,
        updateResult.value.version,
      );
      if (!allocResult.ok) return allocResult;
      return ok(allocResult.value);
    }

    // R1 plan-close cascade (spec-lifecycle-archival-plan-close-cascade-deterministic
    // §Design Decisions D2) — runs in the SAME logical operation as the plan's own
    // archival write, immediately after it commits. Never rolls back the plan's own
    // write on a per-doc cascade failure (D2) — `cascade` is spliced onto the
    // returned doc as an ADDITIONAL property (see `PlanCloseCascadeResult`'s own
    // JSDoc), never a `set()` signature change, so every pre-existing caller that
    // only reads `DocRecord` fields stays byte-identical.
    if (isPlanClosing) {
      const cascade = await this.cascadeArchiveOnPlanClose(updateResult.value, now, resolvedActor);
      return ok({ ...updateResult.value, cascade });
    }

    return ok(updateResult.value);
  }

  /**
   * Archives a plan's direct `task`/`handoff` children per the R1 cascade rule
   * (`computePlanCloseCascadeTargets`, `@lore/core`) — called ONLY from `set()`
   * immediately after a plan's own → archived write commits. Each cascaded doc gets
   * its OWN status write + audit entry (`action: "archive-cascade"`, distinguishable
   * from a plain `lore set --status archived` in the audit log); a write failure on
   * one doc is collected into `failed` and never aborts the loop or the caller's
   * already-committed plan archival (D2 — loud, never silent, never a rollback).
   *
   * @param plan - The plan doc AFTER its own archival write committed (`updateResult.value`).
   * @param nowIso - The SAME `now` `set()` resolved for its own write — one clock
   *   reading for the whole logical operation.
   * @param actor - The SAME resolved actor `set()`'s own audit entry used.
   */
  private async cascadeArchiveOnPlanClose(
    plan: DocRecord,
    nowIso: string,
    actor: string,
  ): Promise<PlanCloseCascadeResult> {
    const tasksResult = await this.store.findMany({ parent_id: plan.id, type: "task" });
    const handoffsResult = await this.store.findMany({ parent_id: plan.id, type: "knowledge" });
    if (!tasksResult.ok || !handoffsResult.ok) {
      // reason: an enumeration failure here is a store-level fault, not a per-doc
      // outcome — reported as a single failed entry keyed to the plan itself rather
      // than silently returning an empty (and therefore misleadingly "nothing to do")
      // cascade result.
      return {
        archived: [],
        skipped: [],
        failed: [
          {
            doc_id: plan.id,
            slug: plan.slug,
            reason: "failed to enumerate plan children for cascade",
          },
        ],
      };
    }

    const handoffChildren = handoffsResult.value.filter((doc) => {
      const parsed = knowledgeExtraSchema.safeParse(doc.extra);
      return parsed.success && parsed.data.sub_type === "handoff";
    });
    const children = [...tasksResult.value, ...handoffChildren];

    // reason: 120 mirrors WorkflowConfigSchema's own claim_ttl_minutes default —
    // the same fallback `deriveTypeMeta`'s bare-constructor callers implicitly rely
    // on elsewhere in this file when `claimTtlMinutes` DI is absent.
    const plan_ = computePlanCloseCascadeTargets(children, nowIso, this.claimTtlMinutes ?? 120);

    const archived: Array<{ doc_id: DocId; slug: string; kind: "task" | "handoff" }> = [];
    const failed: Array<{ doc_id: DocId; slug: string; reason: string }> = [];

    for (const target of plan_.toArchive) {
      const doc = children.find((c) => c.id === target.doc_id);
      if (doc === undefined) {
        // reason: can't happen — `target.doc_id` was derived FROM `children` by
        // `computePlanCloseCascadeTargets` above; kept as a fail-loud guard rather
        // than a non-null assertion so a future refactor of either side can't
        // silently reintroduce a mismatch.
        failed.push({ doc_id: target.doc_id, slug: target.slug, reason: "cascade target not found in children" });
        continue;
      }
      if (!isValidTransition(doc.status, "archived", doc.type)) {
        failed.push({
          doc_id: doc.id,
          slug: doc.slug,
          reason: `invalid transition ${doc.status} -> archived`,
        });
        continue;
      }

      const newVersion = doc.version + 1;
      const versionRecord: VersionRecord = {
        doc_id: doc.id,
        version: newVersion,
        content: doc.content,
        extra: doc.extra,
        status: "archived",
        title: doc.title,
        action: "update",
        created_at: nowIso,
        created_by: actor,
        slug: doc.slug,
      };
      const writeResult = await this.store.updateWithProvenance(
        doc.id,
        { status: "archived", version: newVersion, updated_at: nowIso },
        { expected_version: doc.version },
        versionRecord,
        {
          timestamp: nowIso,
          actor,
          session_id: doc.id,
          // reason: distinguishable audit action (SPEC-lifecycle-archival D2) —
          // versions row stays `action: "update"` (VersionAction has no "cascade"
          // member); the AUDIT entry's `action` is free-form (AuditEntry.action:
          // string), mirroring the pre-existing TaskWorkflowService/ValidityService
          // "update" versions-row + specific-audit-action precedent
          // (claim/release/evidence/anchors/invalidate, audit-service.ts's
          // VERSION_ACTION_AUDIT_FAMILY). "archive-cascade" is added to that same
          // family below so `lore audit --verify`'s completeness join recognizes it.
          action: "archive-cascade",
          doc_id: doc.id,
          details: { plan_id: plan.id, plan_slug: plan.slug, kind: target.kind, version: newVersion },
        },
      );
      if (!writeResult.ok) {
        failed.push({ doc_id: doc.id, slug: doc.slug, reason: `write failed: ${writeResult.error.code}` });
        continue;
      }
      archived.push({ doc_id: doc.id, slug: doc.slug, kind: target.kind });
    }

    return { archived, skipped: plan_.skipped, failed };
  }

  /**
   * Applies one `lore archive --apply` sweep candidate (`ArchiveCandidateRule` R2-R4,
   * `computeArchiveCandidates` @lore/core) — a status write to `archived` audited under
   * `action: "archive-sweep"` (distinguishable from both a plain `lore set` and the R1
   * cascade's `archive-cascade`). Unlike the cascade above, this is a PUBLIC entry
   * point: the `lore archive --apply` CLI command resolves candidates itself (same
   * `computeArchiveCandidates` call the `--sweep` report uses) and calls this once per
   * candidate, so the CLI can print an individual per-doc outcome line.
   *
   * @param doc - The FULL candidate doc (the CLI already has it in hand from
   *   `corpusService.listFull({})` — no redundant re-fetch here).
   * @param rule - Which R2-R4 rule flagged this candidate (recorded in the audit details).
   * @param reason - The candidate's human-readable reason (recorded in the audit details).
   * @param opts - Standard `WriteActorOpts` — actor resolution mirrors every other
   *   write method on this service (D5: "never `system`").
   * @returns `ok(DocRecord)` of the archived doc, or `err(INVALID_TRANSITION)` /
   *   the underlying store error on failure — never throws.
   */
  async archiveSweepCandidate(
    doc: DocRecord,
    rule: ArchiveCandidateRule,
    reason: string,
    opts?: WriteActorOpts,
  ): Promise<Result<DocRecord, LoreError>> {
    if (!isValidTransition(doc.status, "archived", doc.type)) {
      return err({
        code: "INVALID_TRANSITION",
        from: doc.status,
        to: "archived",
        allowed: getAllowedTransitions(doc.status, doc.type),
      });
    }

    const now = new Date().toISOString();
    const resolvedActor = this.resolveWriteActor(opts?.by);
    const newVersion = doc.version + 1;
    const versionRecord: VersionRecord = {
      doc_id: doc.id,
      version: newVersion,
      content: doc.content,
      extra: doc.extra,
      status: "archived",
      title: doc.title,
      action: "update",
      created_at: now,
      created_by: resolvedActor,
      slug: doc.slug,
    };
    const writeResult = await this.store.updateWithProvenance(
      doc.id,
      { status: "archived", version: newVersion, updated_at: now },
      { expected_version: doc.version },
      versionRecord,
      {
        timestamp: now,
        actor: resolvedActor,
        session_id: doc.id,
        action: "archive-sweep",
        doc_id: doc.id,
        details: { rule, reason, version: newVersion },
      },
    );
    return writeResult;
  }

  // ── Delete ───────────────────────────────────────────────────────────────

  /**
   * Soft-delete a document.
   * Requires confirm=true, otherwise returns DELETE_REQUIRES_CONFIRM.
   */
  async delete(
    idOrSlug: string,
    confirm: boolean,
    opts?: WriteActorOpts,
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
    const now = new Date().toISOString();
    const recoverableUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    // reason: resolved ONCE, reused for both the version sentinel's `created_by`
    // (when `opts.attributeCreatedBy` opts in) and the audit entry's `actor` below.
    const resolvedActor = this.resolveWriteActor(opts?.by);

    // BUG-002 (audit finding) — soft-delete + version-0 sentinel + delete audit
    // entry as ONE atomic composite write (StoreInterface.softDeleteWithProvenance),
    // mirroring _createImpl's/set's fix above.
    // reason: SPEC-072 D2 — deliberately no `slug` here. This is the
    // pre-existing version-0 SENTINEL row (content/title already blank, not
    // real snapshots — see the surrounding comment above), and `delete()`
    // only ever resolves an id here (never fetches the full doc), so there is
    // no slug value on hand without an extra read purely to populate a
    // placeholder field on a row that isn't a real state snapshot to begin
    // with. Omitted (never a bare `null`/empty-string placeholder) —
    // consumers already treat an absent `slug` as legacy-row-shaped.
    const versionRecord: VersionRecord = {
      doc_id: id,
      version: 0,
      content: "",
      extra: {},
      status: "archived",
      title: "",
      action: "delete",
      created_at: now,
      // reason: literal "system" is the historical default (SPEC-079 G2 left it
      // out of scope); `opts.attributeCreatedBy` (cookie-session HTTP writes
      // only) opts into the resolved actor — see `adr-dashboard-cookie-session-
      // writes-attribute-author-via`.
      created_by: opts?.attributeCreatedBy === true ? resolvedActor : "system",
    };
    const auditEntry: AuditEntry = {
      timestamp: now,
      // SPEC-079 G2 — resolved actor, never the literal "system".
      actor: resolvedActor,
      session_id: id,
      action: "delete",
      doc_id: id,
      // reason: SPEC-035 §2 — additive for writer-coverage consistency, even though
      // `delete` sits outside AuditService.verify's VERIFIABLE_VERSION_ACTIONS set
      // (a soft-deleted doc's version-0 sentinel row isn't part of the reconcile
      // walk). Matches the sentinel `version: 0` the versions row above carries.
      details: { recoverable_until: recoverableUntil, version: 0 },
    };

    const deleteResult = await this.store.softDeleteWithProvenance(id, versionRecord, auditEntry);
    if (!deleteResult.ok) return deleteResult;

    return ok({ id, recoverable_until: recoverableUntil });
  }

  // ── List ─────────────────────────────────────────────────────────────────

  /**
   * List documents matching filters. Returns DocSummary[] with total count.
   * Telemetry: records one event with filter type (if any) and result count.
   *
   * @param filters - Standard filters plus SPEC-043 D3's `include_invalid` escape
   *   and optional `limit`/`offset` paging (forwarded to `StoreInterface.findMany`
   *   — see {@link ListFilters.limit} for the paging + `include_invalid`
   *   interaction). Omitted `limit`/`offset` → unbounded, byte-identical to
   *   pre-pagination behavior.
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
   * @param filters - Same filter set as list(), including optional `limit`/`offset`
   *   paging (forwarded to `StoreInterface.findMany` verbatim — unlike list(), there
   *   is no `include_invalid` post-filter step here, so a paged result is always
   *   exactly `limit` rows, never fewer, short of the store legitimately running out).
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
    // reason: SPEC-102 — fire-and-forget trace row with the REAL hit count
    // (post SPEC-043 D3 invalidated-hit filtering — `visibleHits.length`, the
    // same count a caller actually sees), never the raw pre-filter store hit
    // count. `traceRecorder` absent in bare test constructions (mirrors `get`).
    if (this.traceRecorder !== undefined) {
      this.traceRecorder.recordSearch(this.resolveWriteActor(undefined), query, visibleHits.length);
    }
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

    // reason: SPEC-056 T4 (D2 read tolerance) — a plan's execution-tier children may be
    // legacy `task` docs, `phase` docs (post-migration), or a corpus mid-migration
    // holding BOTH. `tasksResult`/`PlanBundle.tasks` stays the field NAME (out of this
    // task's scope to rename — see PhaseWorkflowService's own `.task` field-name
    // invariant, same rationale: renaming ripples into every `getPlanBundle` consumer,
    // not just this one call site) but now POPULATES from both doc types. Two
    // type-filtered `findMany` calls (the store interface has no multi-type filter),
    // never a single unfiltered scan of the plan's children.
    const tasksResult = await this.store.findMany({ parent_id: plan.id, type: "task" });
    if (!tasksResult.ok) return tasksResult;
    const phasesResult = await this.store.findMany({ parent_id: plan.id, type: "phase" });
    if (!phasesResult.ok) return phasesResult;
    const planChildren = [...tasksResult.value, ...phasesResult.value];

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
      tasks: planChildren,
      knowledge_links: knowledgeLinks,
    });
  }

  /**
   * Resolves a plan's LATEST linked UAT verdict (SPEC-054) — the SINGLE read the
   * `plan-close` gate (`set`, below) and `lore uat show` both consume. Walks the plan's
   * INCOMING `informs` links, fetches each source doc, keeps only `knowledge` docs whose
   * `extra.sub_type === "uat"` with a Zod-valid `extra.uat`, and returns the most-recent
   * one by `created_at` (the verdict authored last wins — a re-run supersedes a prior one).
   *
   * @param planIdOrSlug - The plan whose latest UAT verdict to resolve.
   * @returns `ok({present, p0Accepted, uncoveredP0, verdict?, docSlug?})` — `present:false`
   *   with the other fields at their empty defaults when no UAT verdict is linked (a FACT,
   *   never an error); `p0Accepted` is `isP0Accepted(latest)` (SPEC-054 D4). Only a genuine
   *   resolve/store failure returns `err`.
   */
  async getLatestUatVerdict(planIdOrSlug: string): Promise<
    Result<
      { present: boolean; p0Accepted: boolean; uncoveredP0: string[]; verdict?: UatVerdict; docSlug?: string },
      LoreError
    >
  > {
    const resolveResult = await this.resolve(planIdOrSlug);
    if (!resolveResult.ok) return resolveResult;

    const linksResult = await this.store.findLinks(resolveResult.value, "in");
    if (!linksResult.ok) return linksResult;
    const informsSources = linksResult.value
      .filter((link) => link.link_type === "informs" && link.to_id === resolveResult.value)
      .map((link) => link.from_id);

    let latest: { doc: DocRecord; verdict: UatVerdict } | undefined;
    for (const sourceId of informsSources) {
      const docResult = await this.store.find(sourceId);
      if (!docResult.ok) return docResult;
      const doc = docResult.value;
      if (doc === null || doc.deleted_at !== null || doc.type !== "knowledge") continue;
      const parsedExtra = knowledgeExtraSchema.safeParse(doc.extra);
      if (!parsedExtra.success || parsedExtra.data.sub_type !== "uat") continue;
      const parsedVerdict = uatVerdictSchema.safeParse(parsedExtra.data.uat);
      if (!parsedVerdict.success) continue;
      if (latest === undefined || doc.created_at > latest.doc.created_at) {
        latest = { doc, verdict: parsedVerdict.data };
      }
    }

    if (latest === undefined) {
      return ok({ present: false, p0Accepted: false, uncoveredP0: [] });
    }
    return ok({
      present: true,
      p0Accepted: isP0Accepted(latest.verdict),
      uncoveredP0: latest.verdict.requirement_coverage.uncovered_p0,
      verdict: latest.verdict,
      docSlug: latest.doc.slug,
    });
  }

  /**
   * Resolves a plan's newest linked (`informs`) assessment doc's `created_at`
   * (SPEC-106 §Design Decisions D2) — walks the plan's INCOMING `informs` links
   * (mirrors {@link getLatestUatVerdict}'s exact shape, narrowed to
   * `sub_type === "assessment"` instead of `"uat"`) and returns the most recent
   * one. Assessment docs are write-once (`lore assess` never edits one after
   * creation, `commands/assess.ts`), so `created_at` is the correct freshness
   * timestamp for this doc — unlike a TASK's `updated_at`, which
   * {@link getAssessmentFreshness} deliberately never reads.
   *
   * @returns `undefined` when no assessment is linked to the plan at all — the
   *   "no assessment yet" vacuous-pass case `assessmentFreshness`
   *   (gate-predicates.ts) treats identically to "no task activity".
   */
  private async resolveNewestAssessmentAt(planId: string): Promise<Result<string | undefined, LoreError>> {
    const linksResult = await this.store.findLinks(planId, "in");
    if (!linksResult.ok) return linksResult;
    const informsSources = linksResult.value
      .filter((link) => link.link_type === "informs" && link.to_id === planId)
      .map((link) => link.from_id);

    let newest: string | undefined;
    for (const sourceId of informsSources) {
      const docResult = await this.store.find(sourceId);
      if (!docResult.ok) return docResult;
      const doc = docResult.value;
      if (doc === null || doc.deleted_at !== null || doc.type !== "knowledge") continue;
      const parsedExtra = knowledgeExtraSchema.safeParse(doc.extra);
      if (!parsedExtra.success || parsedExtra.data.sub_type !== "assessment") continue;
      if (newest === undefined || doc.created_at > newest) {
        newest = doc.created_at;
      }
    }
    return ok(newest);
  }

  /**
   * Resolves the newest `evidence`/`done` AUDIT-row timestamp among `tasks`
   * (SPEC-106 §Design Decisions D2) — deliberately AUDIT rows, never doc
   * `updated_at` (the latter moves on cosmetic edits — anchor adds, link
   * writes, a bare status change — that carry no new outcome information an
   * assessment would need to re-judge, AC-FRESH-3). "Evidence" activity is any
   * audit row with `action === "evidence"` (`TaskWorkflowService.addEvidence`'s
   * `writeTaskExtra` call); "done" activity is any row with
   * `action === "update"` AND `details.done === true` (`TaskWorkflowService
   * .done`'s `writeTaskStatus` call deliberately shares the generic "update"
   * action label with an unrelated `lore set --status` write — see that
   * method's own JSDoc — so `details.done` is the only reliable
   * discriminator). One `queryAudit` call per task — bounded by the plan's own
   * task set, never a corpus-wide scan (SPEC-106's own NFR).
   *
   * @returns `undefined` when `tasks` is empty, or none of them carry any
   *   evidence/done audit row — the "no task activity" vacuous-pass case.
   */
  private async resolveNewestTaskActivityAt(tasks: DocRecord[]): Promise<Result<string | undefined, LoreError>> {
    let newest: string | undefined;
    for (const task of tasks) {
      const auditResult = await this.store.queryAudit({ doc_id: task.id });
      if (!auditResult.ok) return auditResult;
      for (const entry of auditResult.value) {
        const isEvidence = entry.action === "evidence";
        const isDone = entry.action === "update" && entry.details?.["done"] === true;
        if (!isEvidence && !isDone) continue;
        if (newest === undefined || entry.timestamp > newest) {
          newest = entry.timestamp;
        }
      }
    }
    return ok(newest);
  }

  /**
   * Resolves the two facts the `plan-close` gate's `assessmentFreshness`
   * predicate (gate-predicates.ts) needs, AND the ONLY read `lore assess` itself
   * consults for its own non-blocking staleness advisory (SPEC-106 §Design
   * Decisions D2/D3/D5) — one shared computation, never two independently
   * maintained copies (mirrors this module's `buildUpstreamSpecContext`
   * precedent one tier over in `checkpoint-registry.ts`). Read-side only, never
   * stored (D5) — a persisted `assessment_stale` field would itself go stale.
   *
   * @param planIdOrSlug - The plan to resolve freshness facts for.
   * @returns `ok({newestAssessmentAt?, newestTaskActivityAt?})` — either or both
   *   keys OMITTED (not `undefined`-valued) when unresolved, so a caller
   *   spreading this into a `GateContext` never overwrites an already-set field
   *   with an explicit `undefined`.
   */
  async getAssessmentFreshness(
    planIdOrSlug: string,
  ): Promise<Result<{ newestAssessmentAt?: string; newestTaskActivityAt?: string }, LoreError>> {
    const resolveResult = await this.resolve(planIdOrSlug);
    if (!resolveResult.ok) return resolveResult;
    const planId = resolveResult.value;

    const newestAssessmentResult = await this.resolveNewestAssessmentAt(planId);
    if (!newestAssessmentResult.ok) return newestAssessmentResult;

    const tasksResult = await this.store.findMany({ parent_id: planId, type: "task" });
    if (!tasksResult.ok) return tasksResult;
    const phasesResult = await this.store.findMany({ parent_id: planId, type: "phase" });
    if (!phasesResult.ok) return phasesResult;
    const tasks = [...tasksResult.value, ...phasesResult.value];

    const newestActivityResult = await this.resolveNewestTaskActivityAt(tasks);
    if (!newestActivityResult.ok) return newestActivityResult;

    return ok({
      ...(newestAssessmentResult.value !== undefined ? { newestAssessmentAt: newestAssessmentResult.value } : {}),
      ...(newestActivityResult.value !== undefined ? { newestTaskActivityAt: newestActivityResult.value } : {}),
    });
  }

  /**
   * Resolves the plan-close `prdOutlineSynced` predicate's window-OPEN bound
   * (SPEC-080 §C4): the EARLIEST `extra.claim.at` across the plan's tasks, falling
   * back to the plan's OWN `created_at` when no task ever recorded a claim. Pure (no
   * IO) given the already-fetched `tasks` array from `getPlanBundle` — `extractClaim`
   * (`@lore/core`) degrades a claim-less task to `undefined`, filtered out here. ISO
   * 8601 timestamps compare correctly via plain string `<` (same convention the rest
   * of this codebase's window/staleness logic relies on).
   *
   * @param tasks - The closing plan's tasks (`PlanBundle.tasks`).
   * @param planCreatedAt - The plan's own `created_at`, the fallback bound.
   */
  private resolvePrdSyncWindowOpen(tasks: DocRecord[], planCreatedAt: string): string {
    const claimTimes = tasks
      .map((task) => extractClaim(task)?.at)
      .filter((at): at is string => at !== undefined);
    if (claimTimes.length === 0) {
      return planCreatedAt;
    }
    return claimTimes.reduce((earliest, at) => (at < earliest ? at : earliest));
  }

  /**
   * Whether the domain doc `domainDocId` was substantively edited within
   * `[windowOpen, windowClose]` (SPEC-080 §C4: "`[earliest-claim-at (fallback
   * plan created_at), close-write)`, start-inclusive end-exclusive" — the
   * CLOSE bound is compared INCLUSIVELY here, see below) AND that edit is
   * ATTRIBUTABLE to the closing plan (spec-plan-close-predicates-measure-
   * invariants-an-applicability §D6 — added by T3; the window and the
   * content-diff judgment below are UNCHANGED from SPEC-080 §C4, attribution
   * is an ADDITIONAL conjunct never a replacement).
   *
   * "Substantively edited" is judged against the RAW content string the
   * caller submitted (`details.patch.content` on the doc's `"update"` audit
   * entries — `CorpusService.set`'s audit write always stamps the untouched
   * `parsedPatch.data` under `details.patch`, the SAME raw shape SPEC-035
   * §2's completeness oracle already reads back out of audit), compared
   * against the doc's STORED content immediately before that write (the
   * version numbered one less than the update's own, read from
   * `findVersions`) — deliberately NEVER the post-canonicalisation
   * `VersionRecord.content` alone. Two DIFFERENT raw inputs can collapse onto
   * the SAME stored bytes — `canonicaliseBody`'s full `.trim()` erases a
   * single appended trailing space, for instance — and SPEC-080 §C4's own RED
   * suite drives EXACTLY that "whitespace-only edit" scenario, expecting it
   * to satisfy the content-diff half of this predicate (a documented residual
   * gameability: "converts silent drift into a visible, audited,
   * diff-inspectable act", not a bug to defend against). A TRUE no-op resave
   * (the caller resubmits the doc's own current canonicalised content
   * byte-for-byte) still correctly yields `false` here — `rawContent ===
   * predecessorContent` in that case — so this stays a genuine
   * content-authored check, not a bare version-bump proxy (T3's rejection: "a
   * content-blind predicate would be trivially gameable"). A doc's own
   * creation (`"create"`-action audit entry, no `"update"` counterpart) is
   * structurally excluded by the `action: "update"` filter below — the "no
   * predecessor to diff against" case.
   *
   * ATTRIBUTION (T3, §D6): a qualifying content diff satisfies this predicate
   * ONLY when at least one of two attributors holds —
   *   - **content attribution**: the update's raw submitted content contains
   *     the closing plan's `slug` or `id`, OR the governing spec's `slug` or
   *     `id`;
   *   - **edge attribution**: a `relates-to` or `informs` link (either
   *     direction) exists between the domain doc and the closing plan, or
   *     between the domain doc and the governing spec — resolved ONCE per
   *     call (a doc-level fact, not per audit entry) via
   *     {@link hasPrdSyncEdgeAttribution} and AND-ed into every entry the loop
   *     below considers.
   * Structural relations are DELIBERATELY EXCLUDED from edge attribution: the
   * domain doc being the governing spec's OWN `parent_id`, and the spec's
   * `implements` edge to it, are the very relations {@link
   * resolvePrdSyncDomainDoc} used to FIND the domain doc in the first place —
   * accepting either as an attributor would make this conjunct vacuously true
   * for every plan whose ancestry resolves a domain doc at all, reproducing
   * the exact concurrent-session false-pass defect T3 fixes. Only `relates-to`
   * and `informs` edges count; `parent`/`implements`/`blocks`/any other link
   * type does not, structural or otherwise.
   *
   * KNOWN RESIDUAL (§D6, accepted per the upstream ADR, NOT fixed here — do
   * not silently drop the spec-level attributor to "solve" it): spec-level
   * attribution (a mention of, or edge to, the GOVERNING SPEC rather than the
   * plan itself) cannot discriminate between SIBLING plans under that same
   * spec — two concurrently-closing plans sharing one ancestor spec can both
   * satisfy a spec-level attributor from the same edit. Plan-level
   * attribution is strictly stronger and is what kills the measured
   * concurrent-session false pass (two DIFFERENT sessions editing the SAME
   * domain doc for DIFFERENT, unrelated plans); spec-level attribution is
   * accepted as a coarser, still-real signal, recorded here as the residual
   * rather than presented as full attribution.
   *
   * The CLOSE bound is compared INCLUSIVELY (`<=`, not the spec prose's
   * literal `<`) — `windowClose` is the plan-close write's own `now`,
   * captured via `new Date().toISOString()` at millisecond resolution; a
   * domain-doc edit performed (via a fully-awaited prior `set()` call)
   * IMMEDIATELY before the plan-close call, as every RED-suite HAPPY scenario
   * does, routinely lands in the SAME millisecond under `InMemoryStore`'s
   * near-zero IO latency — an exclusive close would then spuriously deny a
   * plan whose domain doc genuinely WAS updated moments earlier. No audit
   * entry can ever be timestamped strictly AFTER `windowClose` within this
   * same synchronous gate check (it is captured before any further writes in
   * this call), so inclusive-vs-exclusive at the exact boundary instant is
   * unobservable in practice — this is a tie-breaking implementation choice,
   * not a widening of the window's real semantics.
   *
   * @param domainDocId - The resolved domain doc's id.
   * @param windowOpen - Window-open bound (inclusive), from {@link resolvePrdSyncWindowOpen}.
   * @param windowClose - Window-close bound (inclusive, see above) — the plan-close
   *   write's own `now` (the SAME timestamp its own version/audit rows use).
   * @param attribution - The closing plan's and governing spec's `{id, slug}`
   *   pairs — both content and edge attribution are checked against BOTH
   *   referents (see KNOWN RESIDUAL above for why the spec-level half is
   *   deliberately weaker, not deliberately absent).
   */
  private async hasPrdSyncContentDiffInWindow(
    domainDocId: DocId,
    windowOpen: string,
    windowClose: string,
    attribution: PrdSyncAttributionTargets,
  ): Promise<Result<boolean, LoreError>> {
    const versionsResult = await this.store.findVersions(domainDocId);
    if (!versionsResult.ok) return versionsResult;
    const contentByVersion = new Map<number, string>();
    for (const version of versionsResult.value) {
      contentByVersion.set(version.version, version.content);
    }

    const auditResult = await this.store.queryAudit({ doc_id: domainDocId, action: "update" });
    if (!auditResult.ok) return auditResult;

    // reason: a doc-level fact (not per-entry), resolved ONCE and AND-ed into
    // every audit entry the loop below considers — see this method's own
    // JSDoc "ATTRIBUTION" section.
    const edgeAttributedResult = await this.hasPrdSyncEdgeAttribution(domainDocId, attribution);
    if (!edgeAttributedResult.ok) return edgeAttributedResult;
    const edgeAttributed = edgeAttributedResult.value;

    for (const entry of auditResult.value) {
      if (entry.timestamp < windowOpen || entry.timestamp > windowClose) continue;
      const patch = entry.details?.["patch"] as Record<string, unknown> | undefined;
      const rawContent = patch?.["content"];
      if (typeof rawContent !== "string") continue;
      const entryVersion = entry.details?.["version"];
      if (typeof entryVersion !== "number") continue;
      const predecessorContent = contentByVersion.get(entryVersion - 1);
      if (predecessorContent === undefined) continue;
      if (rawContent === predecessorContent) continue;
      const contentAttributed =
        rawContent.includes(attribution.planSlug) ||
        rawContent.includes(attribution.planId) ||
        rawContent.includes(attribution.specSlug) ||
        rawContent.includes(attribution.specId);
      if (contentAttributed || edgeAttributed) {
        return ok(true);
      }
    }
    return ok(false);
  }

  /**
   * Whether a `relates-to` or `informs` link (either direction) exists
   * between `domainDocId` and either attribution referent (the closing plan
   * or its governing spec) — the "edge attribution" half of {@link
   * hasPrdSyncContentDiffInWindow}'s §D6 attribution conjunct. A doc-level
   * fact independent of any particular audit entry, hence resolved once by
   * the caller and reused across its whole loop.
   *
   * Deliberately EXCLUDES `parent`/`implements` (and every other link type):
   * those are the structural relations {@link resolvePrdSyncDomainDoc} used
   * to FIND `domainDocId` in the first place, so counting them here would
   * make attribution vacuously true for every resolvable domain doc — see
   * the "ATTRIBUTION" section of {@link hasPrdSyncContentDiffInWindow}'s
   * JSDoc for the full rationale.
   *
   * @param domainDocId - The resolved domain doc's id.
   * @param attribution - The closing plan's and governing spec's ids (slugs
   *   are irrelevant here — link edges are id-addressed).
   * @returns `ok(true)` iff at least one `relates-to`/`informs` link row
   *   connects `domainDocId` to the plan's id or the spec's id, in either
   *   direction.
   */
  private async hasPrdSyncEdgeAttribution(
    domainDocId: DocId,
    attribution: PrdSyncAttributionTargets,
  ): Promise<Result<boolean, LoreError>> {
    const linksResult = await this.store.findLinks(domainDocId, "both");
    if (!linksResult.ok) return linksResult;
    const attributorIds = new Set<DocId>([attribution.planId, attribution.specId]);
    const attributed = linksResult.value.some(
      (link) =>
        (link.link_type === "relates-to" || link.link_type === "informs") &&
        (attributorIds.has(link.from_id) || attributorIds.has(link.to_id)),
    );
    return ok(attributed);
  }

  /**
   * Computes requirement→AC coverage for a PRD (SPEC-055) — the read behind
   * `lore status --check-requirements`. Resolves the PRD, reads its declared requirement
   * inventory, gathers every `requirement_refs` id across its descendant specs' acceptance
   * criteria, and partitions the inventory via the pure `computeRequirementCoverage`
   * (`@lore/core`) — a requirement covered IFF some descendant AC references its id.
   *
   * @param prdIdOrSlug - The PRD whose requirement coverage to compute.
   * @returns `ok(RequirementCoverage)` — all-empty for a PRD with no declared requirements
   *   (vacuous). `err` on an unresolvable target or a non-`prd` type.
   */
  async computeRequirementCoverageForPrd(
    prdIdOrSlug: string,
  ): Promise<Result<RequirementCoverage, LoreError>> {
    const resolveResult = await this.resolve(prdIdOrSlug);
    if (!resolveResult.ok) return resolveResult;

    const prdResult = await this.store.find(resolveResult.value);
    if (!prdResult.ok) return prdResult;
    const prd = prdResult.value;
    if (prd === null || prd.deleted_at !== null) {
      return err({ code: "DOC_NOT_FOUND", id: resolveResult.value });
    }
    if (prd.type !== "prd") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a prd document; got type '${prd.type}'`,
        value: prd.type,
      });
    }

    const parsedReqs = prdRequirementsSchema.safeParse(prd.extra["requirements"]);
    const requirements = parsedReqs.success ? parsedReqs.data : [];

    const specsResult = await this.store.findMany({ parent_id: prd.id, type: "spec" });
    if (!specsResult.ok) return specsResult;
    const refs: string[] = [];
    for (const spec of specsResult.value) {
      const parsedAcs = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
      if (!parsedAcs.success) continue;
      for (const ac of parsedAcs.data) {
        for (const ref of ac.requirement_refs ?? []) refs.push(ref);
      }
    }

    return ok(computeRequirementCoverage(requirements, refs));
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

  /**
   * The `--adhoc`-task sibling of {@link resolveDeclaredAcIds} (task-an-ad-hoc-
   * task-s-attested-evidence-cannot-carry-ac-ref). An `--adhoc` task (SPEC-069
   * §Design Decisions D2) has no `plan_id` and is parented to the corpus root
   * PRD by construction, so `resolveDeclaredAcIds`'s hard `Expected a plan
   * document` requirement can NEVER be satisfied for it — the SAME `Expected a
   * plan document; got type 'prd'` refusal `VerifyRunnerService.verifyAdhocTask`
   * was filed to fix, one layer deeper (reproduced by `TaskWorkflowService.
   * appendEvidenceEntry`'s cross-entity `ac_ref` check, which used to call
   * `resolveDeclaredAcIds(task.parent_id)` unconditionally).
   *
   * Resolves the governing spec via the task's OWN declared `extra.ac_scope`
   * instead of a plan→spec walk, using `resolveGoverningSpecByAcScope`
   * (`@lore/core`) — the EXACT SAME search `VerifyRunnerService.verifyAdhocTask`
   * runs to find its own governing spec — so the two surfaces can never
   * disagree about which spec governs a given ad-hoc task. Never guesses: an
   * absent/empty ac_scope, or one matching zero/multiple specs, all refuse loud
   * rather than picking a spec arbitrarily.
   *
   * @param task - The ALREADY-RESOLVED target ad-hoc task (caller resolves by
   *   id/slug; this method does no id resolution of its own — same contract as
   *   `VerifyRunnerService.verifyAdhocTask`'s own `task` param).
   * @returns `Set<string>` of every AC id declared on the ONE spec that fully
   *   covers the task's declared ac_scope. UNLIKE `resolveDeclaredAcIds`, there
   *   is no `null` ("nothing declared") case: an ad-hoc task's ac_scope IS the
   *   only signal available to resolve a governing spec, so an absent/empty
   *   scope is itself a hard refusal, never "nothing to check against".
   * @throws VALIDATION_ERROR field `ac_scope` — ac_scope absent, empty, or
   *   matches zero/multiple specs (same message family
   *   `VerifyRunnerService.verifyAdhocTask` raises).
   *
   * Source: task-an-ad-hoc-task-s-attested-evidence-cannot-carry-ac-ref
   */
  async resolveDeclaredAcIdsForAdhocTask(task: DocRecord): Promise<Result<Set<string>, LoreError>> {
    const declared = extractDeclaredAcScope(task);
    if (declared === undefined) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `ad-hoc task "${task.slug}" has no declared ac_scope, so its governing spec cannot ` +
          "be resolved (no plan/spec link exists for an --adhoc task, SPEC-069 D2) — declare " +
          `one with 'lore scope add ${task.slug} <AC-ID>' first.`,
        value: task.slug,
      });
    }
    if (declared.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "ac_scope",
        message:
          `ad-hoc task "${task.slug}" declares no acceptance criterion — its ac_scope is an ` +
          "EMPTY array, so there is no declared AC id to resolve a governing spec from. " +
          `Re-declare with 'lore scope add ${task.slug} <AC-ID>' before recording evidence.`,
        value: task.slug,
      });
    }

    const specsResult = await this.store.findMany({ type: "spec" });
    if (!specsResult.ok) return specsResult;

    const resolveResult = resolveGoverningSpecByAcScope(
      declared,
      specsResult.value,
      `ad-hoc task "${task.slug}"`,
    );
    if (!resolveResult.ok) return resolveResult;

    return ok(new Set(resolveResult.value.criteria.map((c) => c.id)));
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
   *
   * @invariant SPEC-079 G1 (relationship provenance) — on success, writes
   *   exactly ONE audit entry (`action: "link"`, `doc_id` = the FROM doc,
   *   `details: {to_id, link_type}`) — AUDIT-ONLY, no `versions` row (a link
   *   is not a doc-content snapshot). `linkRecord.created_by` carries the
   *   SAME resolved actor (`opts.by` > env chain) rather than the literal
   *   `"system"` (G2).
   */
  async link(
    fromIdOrSlug: string,
    toIdOrSlug: string,
    type: LinkType,
    opts?: { by?: string },
  ): Promise<Result<LinkRecord, LoreError>> {
    const startMs = Date.now();
    const result = await this._linkImpl(fromIdOrSlug, toIdOrSlug, type, opts);
    this.recordTelemetryEvent("link", startMs, result, { link_type: type });
    return result;
  }

  private async _linkImpl(
    fromIdOrSlug: string,
    toIdOrSlug: string,
    type: LinkType,
    opts?: { by?: string },
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

    // D1b (spec-issue-closure-loop-computed-resolution-agent-reachable) —
    // a `resolves` edge's `to` MUST be a task carrying `extra.issue_report`
    // (an issue task). Enforced here, the shared link write path, so CLI,
    // MCP, and HTTP are all covered by one implementation. `hasIssueReport`
    // (issue-resolution.ts) is the same defensive presence predicate D2's
    // `computeIssueResolution` builds on.
    if (type === "resolves") {
      const toDocResult = await this.store.find(toResult.value);
      if (!toDocResult.ok) return toDocResult;
      const toDoc = toDocResult.value;
      if (toDoc === null || toDoc.deleted_at !== null) {
        return err({ code: "DOC_NOT_FOUND", id: toResult.value });
      }

      if (toDoc.type !== "task" || !hasIssueReport(toDoc.extra)) {
        return err({
          code: "VALIDATION_ERROR",
          field: "to",
          message:
            "resolves edge target must be a task carrying extra.issue_report (an issue task)",
          value: { id: toResult.value, type: toDoc.type },
        });
      }
    }

    const now = new Date().toISOString();
    // SPEC-079 G2 — resolved once, reused for both the LinkRecord's
    // created_by and this call's audit entry below.
    const resolvedActor = this.resolveWriteActor(opts?.by);
    const linkRecord: LinkRecord = {
      from_id: fromResult.value,
      to_id: toResult.value,
      link_type: type,
      created_at: now,
      created_by: resolvedActor,
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

    // SPEC-079 G1 — relationship provenance: one audit entry per successful
    // link(), audit-only (no versions row — a link is not a doc-content
    // snapshot, so it deliberately joins no VERSION_ACTION_AUDIT_FAMILY member,
    // audit-service.ts). session_id follows the pre-existing doc-id-valued
    // convention (unchanged by this spec, out of scope) — keyed on the FROM doc,
    // same as doc_id.
    const auditResult = await this.store.appendAuditEntry({
      timestamp: now,
      actor: resolvedActor,
      session_id: fromResult.value,
      action: "link",
      doc_id: fromResult.value,
      details: { to_id: toResult.value, link_type: type },
    });
    if (!auditResult.ok) return auditResult;

    return ok(addResult.value);
  }

  // ── Unlink ───────────────────────────────────────────────────────────────

  /**
   * Remove links between two documents.
   * Removes all link types between the pair.
   *
   * @invariant SPEC-079 G1 (relationship provenance) — when at least one
   *   link was actually removed, writes exactly ONE audit entry
   *   (`action: "unlink"`, `doc_id` = the FROM doc, `details: {to_id,
   *   link_type}` where `link_type` is the FULL array of removed types, not
   *   one entry per type). A no-op call (no matching link between the pair)
   *   writes no audit entry — there is no real state change to attribute.
   */
  async unlink(
    fromIdOrSlug: string,
    toIdOrSlug: string,
    opts?: { by?: string },
  ): Promise<Result<void, LoreError>> {
    const fromResult = await this.resolve(fromIdOrSlug);
    if (!fromResult.ok) return fromResult;

    const toResult = await this.resolve(toIdOrSlug);
    if (!toResult.ok) return toResult;

    // Find all links between them in both directions and remove
    const linksResult = await this.store.findLinks(fromResult.value, "out");
    if (!linksResult.ok) return linksResult;

    const removedTypes: LinkType[] = [];
    for (const link of linksResult.value) {
      if (link.to_id === toResult.value) {
        const removeResult = await this.store.removeLink(
          fromResult.value,
          toResult.value,
          link.link_type,
        );
        if (!removeResult.ok) return removeResult;
        removedTypes.push(link.link_type);
      }
    }

    if (removedTypes.length > 0) {
      const auditResult = await this.store.appendAuditEntry({
        timestamp: new Date().toISOString(),
        actor: this.resolveWriteActor(opts?.by),
        session_id: fromResult.value,
        action: "unlink",
        doc_id: fromResult.value,
        details: { to_id: toResult.value, link_type: removedTypes },
      });
      if (!auditResult.ok) return auditResult;
    }

    return ok(undefined);
  }

  /**
   * D7 (spec-issue-closure-loop-computed-resolution-agent-reachable) — the
   * ONE cross-doc read-orchestration locus (per this module's own "never
   * duplicated into an adapter" convention, see `service/CLAUDE.md`) for
   * gathering what `computeIssueResolution` (`issue-resolution.ts`) needs for
   * a SET of issue task ids: every `resolves` in-edge targeting any of them,
   * plus the lifecycle status of each edge's source doc. Read-only
   * counterpart to `link()`'s resolves-edge write validation above (D1b) —
   * same module, same `resolves` concept, opposite direction (read vs write).
   *
   * Batched in exactly two round trips total, never one per issue:
   * `findLinksByToIds` (all in-edges across the whole `issueIds` set) then
   * `findByIds` (all distinct source docs the edges reference) — the same
   * "batch the join, don't N+1" shape `get()`'s own `related` navigation
   * uses above (SPEC review M6) and `TaskWorkflowService`/`PhaseWorkflowService`
   * use for `blocks`-link readiness (`findLinksByToIds` call sites).
   *
   * Deliberately NOT folded into `get()`'s `navigation.related` (which mixes
   * BOTH link directions with no direction tag on each entry) — `resolves`
   * in-edges only would be ambiguous to recover from that shape whenever a
   * candidate doc also happens to be the FROM side of an unrelated `resolves`
   * edge (schema-legal: `link()`'s D1b check only constrains the TO side).
   *
   * Consumed today by the HTTP issue-reports projection
   * (`adapters/http/issue-reports-routes.ts` D7); the CLI equivalents
   * (`lore issues`, `lore status --check-issues`) are a separate task's scope
   * and are expected to call this SAME method rather than re-deriving the
   * join — see this module's "never duplicated into an adapter" invariant.
   *
   * @param issueIds - candidate issue task ids. This method applies NO
   *   `extra.issue_report` presence filter itself — callers already know
   *   which ids are issue tasks (e.g. via `hasIssueReport`); passing a
   *   non-issue id here is harmless (it just gets an empty in-edge list back)
   *   but is the caller's responsibility to have already filtered.
   * @returns `ok(map)` — `map` has ONE entry per `issueId` passed in (an id
   *   with zero resolves in-edges still maps to `{resolvesInEdges: [],
   *   sourceDocs: []}`, never absent), ready to hand straight to
   *   `computeIssueResolution`. `ok(new Map())` immediately when `issueIds`
   *   is empty (no store round trip). Propagates the first store error from
   *   either batched call.
   * @example
   *   const ctxById = await corpusService.getResolvesInEdgesForIssues(["task-1"]);
   *   // ctxById.value.get("task-1") -> {resolvesInEdges: [...], sourceDocs: [...]}
   */
  async getResolvesInEdgesForIssues(
    issueIds: DocId[],
  ): Promise<
    Result<Map<DocId, { resolvesInEdges: ResolvesInEdgeLike[]; sourceDocs: ResolutionSourceDocLike[] }>, LoreError>
  > {
    if (issueIds.length === 0) return ok(new Map());

    const linksResult = await this.store.findLinksByToIds(issueIds, "resolves");
    if (!linksResult.ok) return linksResult;

    const edgesByIssueId = new Map<DocId, ResolvesInEdgeLike[]>();
    for (const id of issueIds) edgesByIssueId.set(id, []);
    for (const link of linksResult.value) {
      edgesByIssueId.get(link.to_id)?.push({ from_id: link.from_id });
    }

    const sourceIds = Array.from(new Set(linksResult.value.map((link) => link.from_id)));
    const sourceDocsResult =
      sourceIds.length > 0 ? await this.store.findByIds(sourceIds) : ok(new Map<DocId, DocRecord>());
    if (!sourceDocsResult.ok) return sourceDocsResult;

    const result = new Map<
      DocId,
      { resolvesInEdges: ResolvesInEdgeLike[]; sourceDocs: ResolutionSourceDocLike[] }
    >();
    for (const id of issueIds) {
      const resolvesInEdges = edgesByIssueId.get(id) ?? [];
      const sourceDocs = resolvesInEdges
        .map((edge) => sourceDocsResult.value.get(edge.from_id))
        .filter((doc): doc is DocRecord => doc !== undefined)
        .map((doc) => ({ id: doc.id, status: doc.status }));
      result.set(id, { resolvesInEdges, sourceDocs });
    }

    return ok(result);
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

    // SPEC-080 §C4 — exempt-plans surfacing (see CorpusStatus.exempt_plans's own
    // JSDoc for why this exists). Pointer-only; sourced via the SAME
    // `extractPrdSyncExempt` (`@lore/core`) the plan-close gate itself consults —
    // never a second hand-rolled `extra.prd_sync_exempt` shape check.
    const exemptPlans = activeDocs
      .filter((d) => d.type === "plan" && extractPrdSyncExempt(d) !== undefined)
      .map((d) => ({ slug: d.slug }));

    return ok({
      total_docs: activeDocs.length,
      by_type,
      by_status,
      last_updated: lastUpdated,
      db_size_bytes: dbSizeResult.value,
      invalidated_feeding_source_warnings: invalidatedFeedingSourceWarnings,
      exempt_plans: exemptPlans,
    });
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /**
   * BUG-008 (audit finding) hard backstop — independent of the caller-supplied
   * `TreeOpts.depth` (see `tree()`, `remainingDepth` below). Mirrors `_getImpl`'s
   * `ANCESTOR_DEPTH_CAP` guard (same class of "bound recursion against untrusted
   * tree shape" hardening, applied to the DESCENDANT walk instead of the
   * ancestor walk). Guards two failure modes `remainingDepth <= 0` alone cannot
   * catch:
   *   1. A `depth` value that bypasses the termination check entirely — `NaN <=
   *      0` and `Infinity <= 0` are both `false` in JS, so a NaN/Infinity/huge
   *      `TreeOpts.depth` would recurse without bound (CLI-side numeric
   *      validation of `--depth` is a SEPARATE, already-covered concern — this
   *      is the service-layer backstop for every OTHER caller: MCP, HTTP,
   *      direct service consumers).
   *   2. A manufactured multi-hop `parent_id` cycle (A→B→C→A) in stored data —
   *      `addLink`'s `detectParentCycle` blocks a NEW cycling link at write
   *      time, but does not retroactively validate the whole corpus, so a
   *      direct store write or a migration defect could still leave one on
   *      disk; combined with an unbounded `depth`, that cycle would recurse
   *      forever.
   */
  private static readonly TREE_NODE_DEPTH_CAP = 20;

  private async buildTreeNode(
    doc: DocRecord,
    remainingDepth: number,
    hardDepthBudget: number = CorpusService.TREE_NODE_DEPTH_CAP,
  ): Promise<Result<TreeNode, LoreError>> {
    const summary = this.toSummary(doc);

    // reason: hardDepthBudget is decremented on EVERY recursive call regardless
    // of remainingDepth's validity, so a NaN/Infinity/absurd remainingDepth
    // (which never satisfies `remainingDepth <= 0`) still terminates within
    // TREE_NODE_DEPTH_CAP levels — the subtree is truncated rather than
    // recursing without bound (BUG-008).
    if (remainingDepth <= 0 || hardDepthBudget <= 0) {
      return ok({ doc: summary, children: [] });
    }

    const childrenResult = await this.store.findMany({ parent_id: doc.id });
    if (!childrenResult.ok) return childrenResult;

    const children: TreeNode[] = [];
    for (const child of childrenResult.value) {
      const childNodeResult = await this.buildTreeNode(child, remainingDepth - 1, hardDepthBudget - 1);
      if (!childNodeResult.ok) return childNodeResult;
      children.push(childNodeResult.value);
    }

    return ok({ doc: summary, children });
  }

  /**
   * Build substring-match suggestions from all doc IDs.
   * Used by `resolve()` to enrich a ULID-shaped `DOC_NOT_FOUND` miss that
   * `resolveDoc` did not already annotate with its own prefix diagnostic.
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
   * Used by `resolve()` to enrich a non-ULID-shaped `DOC_NOT_FOUND` miss that
   * `resolveDoc` did not already annotate with its own prefix diagnostic.
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
