/**
 * CorpusService — primary CRUD + graph + search service for the Lore corpus.
 * All methods return Promise<Result<T, LoreError>>. No thrown exceptions cross this boundary.
 * Source: SPEC-001 §3.1
 */

import { isDeepStrictEqual } from "node:util";
import { ulid } from "ulidx";
import { err, ok, DEDICATED_EXTRA_KEYS, type Result } from "@lore/core";
import { admitAcWrite, applyAcChange } from "./ac-write-chokepoint.js";
import type { LoreError } from "@lore/core";
// reason: getTransliterateCjk/containsCjk (SPEC-068 D1, hotfix 2026-07-23) are
// Node-only-subpath-gated purely for the browser-safety barrel-isolation
// invariant (packages/core/src/CLAUDE.md) — this service file is always
// server-side, same precedent config-service.ts/global-config-service.ts
// already set for direct `@lore/core/node` imports.
import { containsCjk, getTransliterateCjk } from "@lore/core/node";
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
  ORDINAL_REGISTRY,
  isSelfDeclaredOrdinalTitle,
  SELF_DECLARED_ORDINAL_TITLE_REFUSAL,
  computePlanCloseCascadeTargets,
  isLedgerKnowledgeSubType,
  computeAcCoverage,
  extractDeclaredAcScope,
  resolveGoverningSpecByAcScope,
  resolveStatusAfterContractEdit,
  // reason: BOTH halves of the --sub-type usage contract read their authority
  // from @lore/core rather than restating it — KNOWLEDGE_SUB_TYPES (types.ts) is
  // the value-set SSOT and knowledgeSubTypeSchema is the parser built from it, so
  // a tenth sub-type becomes filterable and nameable with no edit here.
  KNOWLEDGE_SUB_TYPES,
  knowledgeSubTypeSchema,
} from "@lore/core";
import type { KnowledgeSubType, RuleIdPrefix } from "@lore/core";
import type {
  CreateDocInput,
  DocPatch,
  UatVerdict,
  RequirementCoverage,
  SpecKind,
  VersionRecord,
  VersionAction,
  AuditEntry,
  ArchiveCandidateRule,
  AcceptanceCriterion,
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
import { requireSpecCitesLiveRule, specCitesLiveRuleInCorpus } from "./spec-approval-citation.js";
import { ownProposedRules } from "./rule-changes.js";
import type { RuleChangeLandingPort } from "./rule-landing-port.js";
import { isParentlessType, isValidParentType, parentlessRefusalMessage, PARENT_TYPE_CONTRACT } from "@lore/core";
import type {
  ProposedRuleWrite,
  ProvenanceWriteExtras,
  RuleLeafPatch,
  SearchHit,
  StoreInterface,
} from "../store/store-interface.js";
import { NoOpTelemetry, type Telemetry, type TelemetryEvent } from "@lore/core";
import type { PlanBundle } from "@lore/core";
import type { ReviewBundle } from "@lore/core";
import type { TreeBlueprint } from "@lore/core";
import { resolveWriteActorFor, WriteActorUnresolvedError } from "../store/write-context-store.js";
import { describeLoreError, GateEnforcer } from "./gate-enforcer.js";
import type { TraceRecorder } from "./trace-recorder.js";
import type { GateContext } from "./checkpoint-registry.js";
import {
  computeArmedGates,
  buildUpstreamSpecContext,
  checkpointRegistry,
  countScriptModeAcceptanceCriteria,
  describeCheckpointVacuity,
  isNonPlanParentError,
  PLAN_CLOSE_VACUITY_NOTICE_FIELD,
  PLAN_CLOSE_UNMEASURED_CITED_RULES_FIELD,
} from "./checkpoint-registry.js";
import { attestationExemptKindValid, type CitedRuleUnknown, type CitedRuleViolation } from "./gate-predicates.js";
import type { RuleStateFull } from "./rule-state-service.js";
import { resolveDoc, ULID_REGEX } from "./resolve.js";
import { loadStampBindingContext, type RadiusDiffPort } from "./stamp-binding-reader.js";
import { computeStampVerdictDistribution, type StampVerdictDistribution } from "./gate-predicates.js";
import { collectKnownRuleIds } from "./baseline-rule-ids.js";
import { buildRuleIndex, collectLiveScriptCitedRuleIds } from "./ac-citations.js";
import { pickBaselineRoot, pickStrategyDocument } from "./navigation-roots.js";
import { hasIssueReport, type ResolvesInEdgeLike, type ResolutionSourceDocLike } from "./issue-resolution.js";
import type { ArchiveIssueClosePort, IssueCloseItem } from "./issue-close-on-archive.js";
import { isPlanMember } from "./plan-membership.js";
import { bodyDiffers, RecordLockService, type RecordEditOp } from "./record-lock-service.js";
import { ANCHOR_SCANNED_DOC_TYPES } from "./drift-check-service.js";
// reason: NOT a cross-service import — `service/CLAUDE.md`'s "no cross-service imports"
// rule scopes "service" to a store-holding class composed in `app.ts`. These four are
// the STORE-FREE pure read-surface projection helpers that module also exports, and they
// are the declared SSOT for "how a read surface carries validity"
// (task-an-invalidated-doc-is-indistinguishable-from-a-live-one-in). Re-deriving the
// projection here instead would be the exact SSOT fork that rule's own carve-out warns
// about ("two JSDocs cited this line to justify duplicating a predicate instead").
import {
  selectLiveDocs,
  withValidityStatus,
  type WithValidityStatus,
} from "./validity-service.js";
import {
  checkForeignCorpusWrite,
  CorpusWriteAuthority,
  foreignCorpusWriteRefusalError,
  type CorpusWriteAuthorityContext,
  type ForeignCorpusWriteContext,
} from "./foreign-corpus-write-guard.js";

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

/**
 * Named source label for {@link FALLBACK_SPEC_CREATE_RULE_MARKDOWN} — spec-
 * governance-visibility-an-armed-gate-that-vacuously-passes §B3. Rendered
 * into `renderFeedingPack`'s `[source: ..., trust: ...]` header exactly like
 * a real corpus doc's slug would be; deliberately NOT the literal string
 * `"unknown"` (that string is `feedSpecCreate`'s OWN `ctx.ruleSource ??
 * "unknown"` fallback for a truly absent field — this constant exists so
 * `ruleSource` is never absent in the first place when the corpus lookup
 * misses).
 */
const FALLBACK_SPEC_CREATE_RULE_SOURCE = "built-in fallback (no seeded rule doc)";

/**
 * Compiled-in spec-create rule slice — spec-governance-visibility-an-armed-
 * gate-that-vacuously-passes §B3 ("a fresh consumer install receives an
 * empty feeding pack"). `findFeedingSkill(SPEC_CREATE_FEEDING_SCOPE)` below
 * is a CORPUS read: a project that just ran `lore init` has zero `knowledge`
 * docs, so that lookup always misses there, and — pre-this-constant — the
 * feeding pack degraded to a bare `[source: unknown]` discriminator with an
 * EMPTY rule slice, defeating the whole "a denial carries the rule that
 * explains it" design (IoC vertical-slice tech-spec §4.1/§11).
 *
 * This is deliberately a SEPARATE literal from
 * `scripts/seed-write-spec-rule.ts`'s `WRITE_SPEC_RULE_CONTENT` (the doc this
 * repo's OWN corpus is seeded with) rather than an import of it:
 * `scripts/` is dev/CI tooling, never part of any distributed package or the
 * compiled `dist/lore` binary (project CLAUDE.md "distribution-first" rule —
 * a fix must land on a surface that SHIPS). A consumer who has only ever run
 * `lore init` has no `scripts/` directory at all, so that module cannot be
 * this fallback's SSOT; this string ships instead as compiled TypeScript
 * inside `corpus-service.ts` itself, landing in `dist/lore` on every build
 * regardless of corpus state, `lore init` having run, or which binary
 * version most recently ran it.
 *
 * A team that wants richer, editable rules than this trims-for-800-chars
 * fallback seeds their OWN approved `knowledge` doc
 * (`extra.sub_type: "skill"`, `extra.skill.applies_to: "spec"`) — the moment
 * one exists, `findFeedingSkill` finds it and this constant is never
 * consulted again (see the call site below).
 */
const FALLBACK_SPEC_CREATE_RULE_MARKDOWN = `## Rules a candidate spec must satisfy

1. **No parent.** A spec takes no parent: it belongs to the product trees
   through its criteria's citations of rules (\`lore ac cite\`). A spec created
   with a parent is rejected.
2. **Declared spec_kind.** Declare \`extra.spec_kind\` as one of \`feature\`,
   \`tech\`, or \`design\` (defaults to \`feature\` when absent).
3. **Required skeleton sections.** Content must include at minimum:
   \`## Overview/Goal\`, \`## Scope\`, \`## Acceptance Criteria\`.
4. **Deterministic, oracle-verifiable acceptance criteria.** Every AC must be
   checkable by a deterministic oracle (exit code, test assertion, concrete
   observable outcome) — vague verbs ("works", "support") are rejected.
5. **Structured AC via \`lore ac add\`.** Once the skeleton exists, add
   machine-checkable criteria with
   \`lore ac add <spec> <id> --statement <s> --mode <script|ai|human>\`.

This is a BUILT-IN fallback: no approved \`knowledge\` doc with
\`extra.sub_type: "skill"\` and \`extra.skill.applies_to: "spec"\` exists in
this corpus yet. Seed your own team-editable version with
\`lore create knowledge --sub-type skill\` (title, content, then
\`extra.skill.applies_to: "spec"\`) to replace this fallback.
`;

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
 *   (`resolveActorWithSource`: session tier → OS username).
 * - `attributeCreatedBy` — when `true`, the SAME resolved actor ALSO stamps
 *   `doc.created_by` (create only) and `versionRecord.created_by`
 *   (create/set/delete). RETAINED but inert since spec-run-identity-slice-1 D1: every
 *   write now stamps the resolved actor on `created_by`, so the flag no longer changes
 *   anything (kept only so the HTTP adapter's call sites keep compiling). Formerly wired ONLY
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
 * Options of {@link CorpusService.set}.
 *
 * `correction` is the audited exit from the record-edit gate (spec-documents-are-living-or-records
 * D4/D15, BR-1049): a typo-level fix of a LOCKED record that writes EXACTLY ONE version, keeps the
 * record's status (no BR-722 demotion, no ledger re-approve second write) and carries `reason` in the
 * version's `change_summary` and the audit row. `reason` must be non-blank; it cannot ride along with
 * a status change. On a doc that is not a locked record it records the reason and otherwise behaves
 * like a normal edit — the exit never becomes a way around BR-722 for an unlocked doc.
 */
export interface SetOptions extends WriteActorOpts {
  readonly expectedVersion?: number;
  readonly correction?: { readonly reason: string };
}

/**
 * The approval path `set(status: "approved")` delegates to (spec-approval-and-plan-closure-go-through-
 * the-same-checks-on D1/D2, BR-1071). Declared STRUCTURALLY here so this service never imports
 * `review-service.ts` (no cross-service imports); `app.ts` wires `ReviewService.approve` into it.
 * The result is read as a `DocRecord` — `ApproveResult` is one, plus an optional advisory field.
 */
export interface ApprovalPort {
  approve(
    idOrSlug: string,
    opts: { readonly reviewer: string; readonly expectedVersion?: number },
  ): Promise<Result<DocRecord, LoreError>>;
}

/**
 * The `lore done` floors as data, for callers that must not archive a task past one (plan-close
 * cascade, archive sweep; spec-approval-and-plan-closure-go-through-the-same-checks-on D5, BR-1072).
 * Declared STRUCTURALLY so this service never imports `task-workflow-service.ts`; `app.ts` wires
 * `TaskWorkflowService.checkDoneFloors` into it. `ok(null)` = every floor met; `ok({floor, error})` =
 * the first failing floor with the exact error `done()` would return (`error.details.floor === floor`).
 */
export interface DoneFloorPort {
  checkDoneFloors(
    taskIdOrSlug: string,
  ): Promise<Result<{ readonly floor: string; readonly error: LoreError } | null, LoreError>>;
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

/**
 * Structural JSON equality: arrays compare element-by-element IN ORDER, objects by key set
 * (key order irrelevant), primitives by `Object.is`. `undefined` equals only `undefined`.
 * Used by the dedicated-extra-key replace guard — `extra` is JSON data, so no Date/Map cases.
 */
function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => jsonDeepEqual(item, b[index]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  if (aKeys.length !== Object.keys(bRecord).length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(bRecord, key) && jsonDeepEqual(aRecord[key], bRecord[key]),
  );
}

/**
 * First `DEDICATED_EXTRA_KEYS` entry of `existing.type` whose value in `incomingExtra` is not
 * deep-equal to the stored one (dropped, added, replaced or reordered); `null` when the doc
 * type has no registered keys or every guarded key is echoed unchanged.
 */
function findDedicatedExtraKeyViolation(
  existing: DocRecord,
  incomingExtra: Record<string, unknown>,
): { key: string; writer: string } | null {
  const guarded = DEDICATED_EXTRA_KEYS[existing.type];
  if (guarded === undefined) return null;
  for (const entry of guarded) {
    if (!jsonDeepEqual(existing.extra[entry.key], incomingExtra[entry.key])) {
      return { key: entry.key, writer: entry.writer };
    }
  }
  return null;
}

/** Time seam (D3/D10 convention) — never `Date.now()` read directly in method bodies. */
const defaultNow = (): string => new Date().toISOString();

// ─── Task phase namespace, resolved by PLAN MEMBERSHIP ───────────────────────

/**
 * Which plan's declared `extra.phases[]` govern a task's `extra.phase` — resolved
 * by MEMBERSHIP (`extra.plan_id`, via {@link isPlanMember}), never by the
 * `parent_id` proxy.
 *
 * `lore create task --plan-id P --parent Q` with `P !== Q` is a SUPPORTED shape
 * (SPEC-065 D4; `--parent` merely DEFAULTS to `--plan-id`), and every
 * phase-scoped READ already resolves the namespace by membership
 * (`PhaseService.findTasksByPhase`). A `parent_id`-keyed write-time check
 * therefore validated a diverged member's phase name against the FILING parent's
 * namespace while every later read looked it up in the OWNING plan's — the tenth
 * site of this codebase's plan-membership family, and its first on a write path
 * (`task-the-tenth-plan-member-site-is-a-write-path-create-time`).
 *
 * Three distinct states, deliberately NOT collapsed into one "invalid phase"
 * outcome: each needs a different repair, and a single message could not name it.
 */
type TaskPhaseNamespace =
  /**
   * The task declares no `extra.plan_id`, so it is a member of no plan and has NO
   * phase namespace to check against. Reached by an `--adhoc` task (planless BY
   * DESIGN — SPEC-069 D2) and by a `set` patch whose wholesale-replaced `extra`
   * omits the field.
   */
  | { readonly kind: "no-membership" }
  /**
   * `extra.plan_id` is declared but matches no live plan in this corpus — e.g. a
   * slug or short prefix where the canonical ULID belongs. ⛔ Deliberately NOT
   * repaired by running the value through `resolve()`: every phase-scoped READ
   * compares `extra.plan_id` to a plan id verbatim ({@link isPlanMember}), so a
   * non-canonical value makes the task a member of nothing no matter what a
   * write-time resolver would have accepted. Widening here would re-create the
   * write/read namespace split this type exists to close.
   */
  | { readonly kind: "unresolvable-membership"; readonly declaredPlanId: string }
  /** Resolved: `plan.extra.phases[]` IS the namespace the phase name is checked against. */
  | { readonly kind: "owning-plan"; readonly plan: DocRecord };

/**
 * Inert `task`-shaped record whose ONLY use is to satisfy {@link isPlanMember}'s
 * `DocRecord` parameter when no stored row is available to pass.
 *
 * reason: the shared predicate (`plan-membership.ts` — the codebase's ONLY
 * definition, pinned by `isplanmember-single-definition.test.ts` and
 * `bun run check:plan-member-sites`) reads exactly one field, `extra`, but is
 * typed over the whole `DocRecord`. Both write paths need the answer BEFORE such
 * a record exists: `create` has not inserted the row yet, and `set` must judge
 * the PATCH's `extra` — not the stored one — because `extra` is replaced
 * wholesale, so the stored `plan_id` may be about to disappear. Spreading this
 * shell with the candidate `extra` bag is a predicate ADAPTER; re-implementing
 * `extra.plan_id === planId` inline instead is exactly the drift that produced
 * three byte-identical copies of the predicate and ten one-at-a-time site fixes.
 *
 * ⛔ Never persisted, never returned, never compared against a stored row: the
 * only consumer is {@link CorpusService._resolveTaskPhaseNamespace}, which reads
 * back nothing but the predicate's boolean. The non-`extra` fields are inert
 * placeholders (empty ids, `version: 0`) precisely so a copy that ever escaped
 * would be obviously unreal rather than plausibly a row.
 */
const PLAN_MEMBERSHIP_PROBE_TASK: DocRecord = Object.freeze({
  id: "",
  slug: "",
  type: "task",
  role: "plan",
  title: "",
  status: "draft",
  priority: "medium",
  content: "",
  parent_id: null,
  created_at: "",
  updated_at: "",
  created_by: "",
  version: 0,
  deleted_at: null,
  tags: [],
  extra: {},
  ordinal: null,
});

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
   * Forwarded VERBATIM to {@link StoreInterface.findMany} — see
   * {@link StoreFilters.sub_type} for the contract, including the ⛔ "predicate
   * in the query, never after the pagination window" rule this service layer
   * must not undermine.
   *
   * ⛔ This service applies NO filtering of its own for it (unlike
   * `include_invalid`, which IS a post-store step here). If you find yourself
   * adding a `.filter((d) => d.extra.sub_type === …)` in this file, that is the
   * post-window bug — put the predicate in the store instead.
   *
   * @see spec-a-write-side-fact-with-no-read-side-address-counts-with-no §Scope M3
   */
  sub_type?: KnowledgeSubType;
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
  /** See {@link ListFilters.sub_type} — same store-level predicate, same ⛔ no-post-filter rule. */
  sub_type?: KnowledgeSubType;
}

/**
 * Outcome of {@link resolveSubTypeFilter} — a discriminated union so a refusal
 * can never be read as "no filter requested" (which is exactly how a usage error
 * would degrade into a silently empty result set).
 */
export type SubTypeFilterResolution =
  | { readonly ok: true; readonly sub_type: KnowledgeSubType | undefined }
  | { readonly ok: false; readonly message: string };

/**
 * The ONE place the `--sub-type` USAGE CONTRACT lives: a knowledge sub-type is
 * only a meaningful retrieval predicate under `type: "knowledge"`, so every other
 * shape is refused BY NAME rather than silently returning zero rows.
 *
 * Four consumers share this seam — CLI `lore list`, CLI `lore search`, MCP
 * `lore_list`, MCP `lore_search`. ⛔ Do NOT re-derive the rule at a consumer: the
 * `listGovernedBy` precedent in this same file records what that costs (a fix
 * landed on one consumer while the shared seam kept the old behaviour). Each
 * consumer maps a refusal to its OWN surface's vocabulary — the CLI to exit code
 * 2 (usage error, per `adapters/cli/utils.ts::exitCode`), MCP to an `isError`
 * payload — which is why this returns a message rather than a `LoreError`
 * (`VALIDATION_ERROR` maps to exit 4, and AC-RR-6 requires exactly 2).
 *
 * JUDGMENT recorded here: the message is worded in CLI-FLAG vocabulary
 * (`--sub-type` / `--type knowledge`) on BOTH surfaces, rather than being
 * parameterised per caller. AC-RR-6 requires those exact tokens in the CLI's
 * stderr, and MCP callers get the field-correct name separately and
 * machine-readably as the refusal's `field: "sub_type"` — so the one place the
 * spelling could mislead already carries the right one beside it. A spelling
 * parameter was considered and rejected: it would put the two surfaces'
 * wordings back in two places, which is the drift this seam exists to prevent.
 *
 * Side-effect class: pure.
 *
 * @param rawSubType - The requested sub-type, exactly as the caller supplied it
 *   (an empty string is a MALFORMED value, deliberately not treated as absent);
 *   `undefined` means the caller asked for no sub-type filter at all.
 * @param rawType - The requested doc type, or `undefined` when the caller passed
 *   none. There is no implicit type: an absent `type` with a present `sub_type`
 *   is a refusal, not a defaulted `"knowledge"`.
 * @returns `{ok: true, sub_type}` — with `sub_type: undefined` when none was
 *   requested — or `{ok: false, message}` naming the conflict and the legal shape.
 * @example
 * resolveSubTypeFilter("retro", "knowledge"); // => { ok: true, sub_type: "retro" }
 * resolveSubTypeFilter(undefined, "spec");    // => { ok: true, sub_type: undefined }
 * resolveSubTypeFilter("retro", "spec");      // => { ok: false, message: "…--type spec…" }
 * resolveSubTypeFilter("retro", undefined);   // => { ok: false, message: "…requires --type knowledge…" }
 * resolveSubTypeFilter("handof", "knowledge");// => { ok: false, message: "…'handof'…Valid values…" }
 * @see spec-a-write-side-fact-with-no-read-side-address-counts-with-no §Scope M3, AC-RR-6
 */
export function resolveSubTypeFilter(
  rawSubType: string | undefined,
  rawType: string | undefined,
): SubTypeFilterResolution {
  if (rawSubType === undefined) return { ok: true, sub_type: undefined };

  const legalValues = KNOWLEDGE_SUB_TYPES.join(" | ");
  if (rawType === undefined) {
    return {
      ok: false,
      message:
        "Error: --sub-type requires --type knowledge — only knowledge documents carry a sub_type.\n" +
        `  Pass --type knowledge, or drop --sub-type. Valid values: ${legalValues}`,
    };
  }
  if (rawType !== "knowledge") {
    return {
      ok: false,
      message:
        `Error: --sub-type cannot be combined with --type ${rawType} — ` +
        "only knowledge documents carry a sub_type.\n" +
        `  Use --type knowledge with --sub-type, or drop --sub-type. Valid values: ${legalValues}`,
    };
  }

  const parsed = knowledgeSubTypeSchema.safeParse(rawSubType);
  if (!parsed.success) {
    return {
      ok: false,
      message: `Error: Invalid --sub-type '${rawSubType}'.\n  Valid values: ${legalValues}`,
    };
  }
  return { ok: true, sub_type: parsed.data };
}

export interface TreeOpts {
  depth?: number;
}

export interface TreeNode {
  doc: DocSummary;
  children: TreeNode[];
}

export interface CorpusStatus {
  /**
   * LIVE (non-retracted, non-deleted) document count — see {@link CorpusService.status}'s
   * own JSDoc for why retracted docs are excluded here and counted in
   * {@link CorpusStatus.invalid_docs} instead.
   */
  total_docs: number;
  /**
   * How many non-deleted docs are currently RETRACTED (invalidated at the snapshot
   * instant) and therefore excluded from `total_docs`/`by_type`/`by_status`
   * (task-validity-landed-on-lore-list-only-the-dispatch-surface, Required #3).
   *
   * ⛔ ALWAYS present, `0` when nothing is retracted — never omitted. An omitted count
   * is the same silence class as the uncounted-retraction defect this field closes, and
   * it also makes the exclusion PROVABLE from one payload: `total_docs + invalid_docs`
   * is the count this field's absence used to report. Same "empty is a fact, not absent
   * data" convention as `invalidated_feeding_source_warnings` below.
   */
  invalid_docs: number;
  /** Live-doc counts per type (retracted docs excluded — see `total_docs`). */
  by_type: Record<string, number>;
  /** Live-doc counts per workflow status (retracted docs excluded — see `total_docs`). */
  by_status: Record<string, number>;
  /**
   * The most recent `updated_at` across ALL non-deleted docs, retracted INCLUDED — this
   * answers "when did the corpus last change", and a retraction is a change (see
   * {@link CorpusService.status}'s JSDoc).
   */
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
  /**
   * `floor` is present iff the skip is a `lore done` floor refusal (the first failing floor's id,
   * from the injected {@link DoneFloorPort}); a fresh-claim skip carries no `floor`.
   */
  readonly skipped: ReadonlyArray<{ doc_id: DocId; slug: string; reason: string; floor?: string }>;
  readonly failed: ReadonlyArray<{ doc_id: DocId; slug: string; reason: string }>;
  /**
   * Lines from the post-archive issue-close step for the cascaded tasks (spec-archiving-the-work-that-
   * resolves-a-defect-report-closes D4). Absent when no archive port is wired.
   */
  readonly issueClose?: ReadonlyArray<IssueCloseItem>;
}

/**
 * What {@link CorpusService.set} returns: the updated doc, plus `cascade` for an actual plan close and
 * `issueClose` — the post-archive GitHub issue step's lines — for ANY transition to `archived` when the
 * archive port is wired (possibly empty). Absent otherwise.
 */
export type CorpusSetResult = DocRecord & { cascade?: PlanCloseCascadeResult; issueClose?: IssueCloseItem[] };

// ─── The one write route (spec-defect-clusters-round-1 D3, AC-DCL-3) ────────

/** The doc fields a {@link DocWriteRequest} may change. `version` / `updated_at` are NEVER in a patch: the route owns them. */
export type DocWritePatch = Partial<
  Pick<DocRecord, "content" | "extra" | "title" | "status" | "parent_id" | "tags" | "priority">
>;

/**
 * One document change, as every service states it to {@link CorpusService.writeDoc}.
 * The route supplies everything else: the CAS guard, the version number, the version row, the audit row
 * (caller actor + run), the foreign-corpus refusal, the record lock and the transaction.
 */
export interface DocWriteRequest {
  /** The doc as the caller read it: its `version` is the CAS guard and the base of the new version number. */
  readonly doc: DocRecord;
  readonly patch: DocWritePatch;
  /** `VersionRecord.action` of the version row (almost always `"update"`; `"restore"` for a restore). */
  readonly action: VersionAction;
  /** `VersionRecord.change_summary`. */
  readonly changeSummary?: string;
  /** `AuditEntry.action`. */
  readonly auditAction: string;
  /** Operation-specific audit `details`; the route adds `version` / `new_version`. */
  readonly auditDetails?: Readonly<Record<string, unknown>>;
  /** `AuditEntry.session_id`; defaults to the doc id. */
  readonly auditSessionId?: string;
  /**
   * Record-edit gate: the rewrite path this write is on, or `"none"` when the write is a sanctioned
   * lifecycle/metadata edit the lock does not protect (validity, rule/requirement `extra`, ordinal metadata).
   * `"content"` compares `patch.content` / `patch.title` against the stored doc, so a write that leaves both
   * unchanged is not refused.
   */
  readonly lock: RecordEditOp | "none";
  /** Explicit actor; absent = the store write context's claimed name (never `created_by`, never "system"). */
  readonly by?: string;
  /** Same-transaction extras (citation-gate liveness, extra audit rows). */
  readonly extras?: ProvenanceWriteExtras;
  /** Timestamp seam; default now. */
  readonly now?: string;
  /**
   * `true` when the CALLER holds a declared-intent fact that authorizes a write into a foreign (linked-worktree
   * resolved) corpus: a claim lease that names a worktree (task/phase lifecycle writes), or a `CorpusWriteAuthority`
   * grant already taken for this very write (baseline-scoped authoring). Absent = no intent = refused on a foreign
   * crossing, which is what every non-lifecycle write wants.
   */
  readonly foreignIntent?: boolean;
  /**
   * Owner leaves of an owned-by-only site-map write (`RuleService.setSiteMap`): when `doc` itself is outside the
   * caller's lease scope, a lease covering every one of these authorizes the write instead
   * ({@link CorpusWriteAuthority.decide}). Absent = the target's own scope decides.
   */
  readonly scopeProof?: readonly DocRecord[];
  /**
   * `"bump"` (default): the write is a new version of the doc — one `updateWithProvenance` transaction carrying the
   * version row. `"keep"`: a status move that is NOT a new version (a reject returning an in-review doc to draft keeps
   * its version, so a judgment recorded against it stays fresh): the doc update, then ONE audit row whose `version`
   * is the unchanged one, and no version row (a second row at the same version cannot exist). The two steps are not
   * one transaction — the store has no primitive that updates a doc and audits without a version row — which is
   * exactly how the reject path wrote them before AC-DCL-5.
   */
  readonly versioning?: "bump" | "keep";
}

/** Outcome of {@link CorpusService.writeDoc}: `written: false` means the patch changed nothing and NOTHING was written. */
export interface DocWriteOutcome {
  readonly doc: DocRecord;
  readonly written: boolean;
}

/** One new document, as every service states it to {@link CorpusService.insertDoc}. */
export interface DocInsertRequest {
  readonly doc: DocRecord;
  readonly changeSummary?: string;
  readonly auditAction: string;
  readonly auditDetails?: Readonly<Record<string, unknown>>;
  readonly auditSessionId?: string;
  readonly by?: string;
  /** See {@link DocWriteRequest.foreignIntent}. */
  readonly foreignIntent?: boolean;
}

/**
 * One audit row with no version bump (a judgment, a state-binding skip, an issue-close step, an adoption record,
 * a foreign-corpus decision), as {@link CorpusService.appendAudit} takes it.
 */
export interface AuditAppendRequest {
  readonly action: string;
  readonly sessionId: string;
  readonly docId?: DocId;
  /** Operation-specific `details`; written verbatim (an audit-only row carries no `version` join key). */
  readonly details?: Readonly<Record<string, unknown>>;
  /** Explicit actor; absent = the store write context's claimed name. */
  readonly by?: string;
  /** Timestamp seam; default now. */
  readonly timestamp?: string;
  /** See {@link DocWriteRequest.foreignIntent}. */
  readonly foreignIntent?: boolean;
  /**
   * `"refuse"` (default): a foreign crossing without intent is refused like any other write.
   * `"record"`: this row IS the record of a foreign-corpus decision that was already taken (the scoped
   * authorization the guard just granted) — refusing the record of an authorization would be circular, so the
   * refusal predicate is not applied. The row still names the caller and the run.
   */
  readonly foreign?: "refuse" | "record";
}

/** A parent re-pointing (a hierarchy migration), as {@link CorpusService.setDocParent} takes it. */
export interface DocParentRequest {
  readonly docId: DocId;
  /** The new parent, or `null` to clear it (which also removes the doc's `parent` link edge). */
  readonly parentId: DocId | null;
  readonly auditAction: string;
  readonly auditSessionId: string;
  readonly auditDetails?: Readonly<Record<string, unknown>>;
  readonly by?: string;
}

/** A registry-reserved `proposed` rule id written into a spec's change set, as {@link CorpusService.reserveProposedRule} takes it. */
export interface ProposedRuleReserveRequest {
  /** The spec write (CAS base, builder of the new `extra`, owner leaf, optional status, change summary). */
  readonly write: ProposedRuleWrite;
  /** Id family; the change set is business-only today. */
  readonly family: RuleIdPrefix;
  /** Operation-specific audit `details`; the route adds `rule_id`, `version` and `new_version`. */
  readonly auditDetails: Readonly<Record<string, unknown>>;
  readonly by?: string;
  /** See {@link DocWriteRequest.foreignIntent}. */
  readonly foreignIntent?: boolean;
}

/** A store-owned rule move, as {@link CorpusService.moveRule} takes it. */
export interface RuleMoveRequest {
  readonly ruleId: string;
  readonly from: RuleLeafPatch;
  readonly to: RuleLeafPatch;
  readonly auditDetails: Readonly<Record<string, unknown>>;
  readonly by?: string;
}

/** A registry-allocated rule add, as {@link CorpusService.allocateRule} takes it. */
export interface RuleAllocateRequest {
  /** The leaf as read (CAS base). */
  readonly leaf: DocRecord;
  /** Pure builder of the leaf's new `extra` given the allocated id. */
  readonly buildExtra: (ruleId: string) => Record<string, unknown>;
  /** Id family (`BR` | `AS` | `AD`). */
  readonly family: RuleIdPrefix;
  readonly by?: string;
}

/**
 * What every non-corpus service holds instead of the store's write methods: the write-route surface of
 * {@link CorpusService}, as a `Pick` of the class itself (not a parallel interface) so each call resolves to
 * the one implementation — the baseline census follows it, and the signatures cannot drift from it.
 * Services never call `store.update` / `insertVersion` / `appendAuditEntry` / `*WithProvenance` themselves
 * (the static scan in single-write-path.bun.test.ts enforces it).
 */
export type DocWritePort = Pick<
  CorpusService,
  "writeDoc" | "insertDoc" | "assertWritable" | "reserveProposedRule" | "setDocParent" | "appendAudit" | "assignOrdinalForRepair" | "moveRule" | "allocateRule" | "describeRecordLock"
>;

/** The post-patch value of one patched field of `doc`. */
function patchedFieldsUnchanged(doc: DocRecord, patch: DocWritePatch): boolean {
  for (const key of Object.keys(patch) as (keyof DocWritePatch)[]) {
    const incoming = patch[key];
    if (incoming === undefined) continue;
    if (key === "content") {
      if (bodyDiffers(doc.content, incoming as string)) return false;
      continue;
    }
    if (!isDeepStrictEqual(incoming, doc[key])) return false;
  }
  return true;
}

/** `patch` without its `undefined`-valued keys (exactOptionalPropertyTypes: an undefined key must not overwrite). */
function definedOnly(patch: DocWritePatch): DocWritePatch {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as DocWritePatch;
}

/**
 * The write route a service falls back to when its composition root handed it none: a bare `CorpusService`
 * with an ungated record lock and an inert foreign-corpus context. Same convention as every other optional
 * wiring (`new GateEnforcer(undefined)`, "bare `new XService(store)` stays ungated"): production composes
 * the REAL `corpusService` into each service in `app.ts` (asserted by single-write-path.bun.test.ts), and
 * only a unit test constructing a service over a bare store reaches this. A service that already holds its own
 * `RecordLockService` passes it, so its record-edit gate configuration is the one the write route applies.
 */
export function bareDocWriter(store: StoreInterface, recordLock?: RecordLockService): DocWritePort {
  return new CorpusService(store, recordLock ?? new RecordLockService(store, new GateEnforcer(undefined)));
}

// ─── CorpusService ─────────────────────────────────────────────────────────

export class CorpusService {
  private readonly telemetry: Telemetry;
  /**
   * The foreign-corpus-write guard's ambient facts (spec-corpus-resolution-
   * carries-provenance-and-a-foreign-write §D5) — MUTABLE, set post-
   * construction via {@link setForeignCorpusWriteContext}, NEVER threaded
   * through the constructor. Defaults to `{provenance: null, enabled: true}`:
   * `provenance: null` makes `checkForeignCorpusWrite` ALWAYS allow (see that
   * function's own decision table), so every one of this codebase's ~3700
   * bare `new CorpusService(store)` unit-test constructions — which never
   * call the setter — stays byte-identical to pre-guard behavior. Only
   * `adapters/cli/loader.ts`'s `loadLoreApp()` calls the setter, with the
   * REAL resolved provenance for the current CLI process.
   */
  private foreignCorpusWriteContext: ForeignCorpusWriteContext = { provenance: null, enabled: true };

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
    /**
     * REQUIRED (spec-documents-are-living-or-records D17): every rewrite path in `set()` asks this
     * before it writes. Never optional — an unwired service must fail to construct, not silently
     * leave the record-edit gate off.
     */
    private readonly recordLock: RecordLockService,
    telemetry: Telemetry = new NoOpTelemetry(),
    private readonly claimTtlMinutes?: number,
    private readonly gateEnforcer?: GateEnforcer,
    private readonly traceRecorder?: TraceRecorder,
    private readonly ledgerAutoApprove?: boolean,
  ) {
    this.telemetry = telemetry;
  }

  /**
   * Arms the citation gate for `create`'s inline acceptance criteria (spec-baseline-slice-2 §C3/§C4,
   * AC-BLS2-2): create is a SANCTIONED AC write path, so it must not bypass the gate `AcService` applies
   * to `ac add|set|cite`. Called once by `app.ts` with the raw `workflow.gates."ac-cite"` entry; absent
   * (every bare `new CorpusService(store)`) ⇒ create is ungated, byte-identical to before.
   *
   * @param rawGateConfig - the raw, untrusted gate entry (`undefined` = not configured)
   */
  setCiteGate(rawGateConfig: unknown): void {
    this.citeGate = { raw: rawGateConfig };
  }

  /** Present iff {@link setCiteGate} was called; `raw` is validated per write by the chokepoint. */
  private citeGate: { raw: unknown } | undefined;

  /**
   * Hands the corpus service the rule-state reader `plan-close`'s cited-rule-state predicate needs
   * (BR-984). Called once by `app.ts` (real git port); absent (every bare `new CorpusService(store)`)
   * ⇒ the predicate has no rule state and refuses nothing, byte-identical to a plan whose spec cites no rule.
   *
   * @param service - anything exposing `RuleStateService.full()`
   */
  setRuleStateService(service: { full(): Promise<Result<RuleStateFull, LoreError>> }): void {
    this.ruleStateService = service;
  }

  /**
   * Hands the corpus service the diff port the RADIUS axis of the attestation floor measures through
   * (SPEC-143 AC-CT-9: a stamped row whose blast radius changed since its recorded HEAD is stale). Called once
   * by `app.ts`; absent (every bare `new CorpusService(store)`) ⇒ every stamped row's radius is `unmeasured`,
   * which the floor ACCEPTS, byte-identical to a corpus whose radius was never measurable.
   */
  setStampRadiusDiff(port: RadiusDiffPort): void {
    this.stampRadiusDiff = port;
  }

  /** Present iff {@link setStampRadiusDiff} was called. */
  private stampRadiusDiff: RadiusDiffPort | undefined;

  /**
   * The stamp-verdict distribution (SPEC-143 AC-CT-9(d)) over every attested row of `docs`: five readings,
   * `radius_unmeasured` on its own, derived by the ONE exported predicate (`computeStampVerdictDistribution`)
   * that `lore assess` and `lore status` both render — never re-derived by an adapter.
   *
   * @param docs - task/phase documents whose evidence is bucketed
   * @returns the distribution, or the store error the binding read hit (never swallowed into "unarmed")
   */
  async stampVerdictDistribution(
    docs: readonly DocRecord[],
  ): Promise<Result<StampVerdictDistribution, LoreError>> {
    const binding = await loadStampBindingContext(this.store, docs, this.stampRadiusDiff);
    if (!binding.ok) return binding;
    return ok(computeStampVerdictDistribution(docs, binding.value));
  }

  /** Present iff {@link setRuleStateService} was called. */
  private ruleStateService: { full(): Promise<Result<RuleStateFull, LoreError>> } | undefined;

  /**
   * Hands the corpus service the one writer from a spec's rule change set to the baseline tree (D3 of
   * spec-a-spec-carries-its-rule-changes-the-baseline-takes-them). With it armed, closing a plan whose spec has an
   * unlanded change set LANDS the change set first and is refused while landing would fail, and moving a spec to
   * `deprecated` retires its still-proposed ids "never landed". Called once by `app.ts`; absent (every bare
   * `new CorpusService(store)`) ⇒ neither happens, byte-identical to a corpus with no change sets.
   *
   * @param port - anything exposing `RuleChangeService.apply`
   */
  setRuleChangeLanding(port: RuleChangeLandingPort): void {
    this.ruleChangeLanding = port;
  }

  /** Present iff {@link setRuleChangeLanding} was called. */
  private ruleChangeLanding: RuleChangeLandingPort | undefined;

  /**
   * Hands the corpus service the approval path a `set(status: "approved")` must take (BR-1071): the
   * same judgment, spec/plan-promote and rule-citation checks as `lore approve`, recorded as an approval.
   * Called once per App construction site in `app.ts`. An unwired service (every bare
   * `new CorpusService(store)`) approves with NO gate and writes directly — tests only; production
   * wiring is guarded by AC-AP-7.
   *
   * @param port - anything exposing `ReviewService.approve`'s call shape
   */
  setApprovalPort(port: ApprovalPort): void {
    this.approvalPort = port;
  }

  /** Present iff {@link setApprovalPort} was called. */
  private approvalPort: ApprovalPort | undefined;

  /**
   * Hands the corpus service the done-floor check a plan close / sweep must apply to each task
   * (BR-1072). Called once per App construction site in `app.ts` (guarded by AC-AP-7). An unwired
   * service (every bare `new CorpusService(store)`) has no port: tests only.
   *
   * @param port - anything exposing `TaskWorkflowService.checkDoneFloors`'s call shape
   */
  setDoneFloorPort(port: DoneFloorPort): void {
    this.doneFloorPort = port;
  }

  /** Present iff {@link setDoneFloorPort} was called. */
  private doneFloorPort: DoneFloorPort | undefined;

  /**
   * Hands the corpus service the post-archive step that closes the GitHub issues of the defect reports
   * an archived document resolves (spec-archiving-the-work-that-resolves-a-defect-report-closes D4).
   * Called once per App construction site in `app.ts`. An unwired service (every bare
   * `new CorpusService(store)`) runs no step: tests only.
   *
   * @param port - the shared step instance (the same one `TaskWorkflowService` holds)
   */
  setArchiveIssueClosePort(port: ArchiveIssueClosePort): void {
    this.archiveIssueClosePort = port;
  }

  /** Present iff {@link setArchiveIssueClosePort} was called. */
  private archiveIssueClosePort: ArchiveIssueClosePort | undefined;

  /** Runs the post-archive step for one just-archived doc; `[]` when no port is wired. */
  private async runArchiveIssueClose(doc: DocRecord, actor: string): Promise<IssueCloseItem[]> {
    if (this.archiveIssueClosePort === undefined) return [];
    return this.archiveIssueClosePort.onArchived(doc, actor);
  }

  /**
   * Sets the foreign-corpus-write guard's ambient facts for every write this
   * instance performs from now on (spec-corpus-resolution-carries-
   * provenance-and-a-foreign-write §D5). Called EXACTLY ONCE per CLI process
   * by `adapters/cli/loader.ts`'s `loadLoreApp()`, right after `createApp()`
   * returns — mirrors that same function's existing `app.callerSurface = ...`
   * post-construction assignment. Never called by any bare unit-test
   * construction, which is what keeps {@link foreignCorpusWriteContext}'s
   * `{provenance: null, enabled: true}` default byte-identical to pre-guard
   * behavior for all of them (`provenance: null` alone makes the guard inert
   * regardless of `enabled` — see `checkForeignCorpusWrite`'s decision table).
   *
   * @param context - See {@link ForeignCorpusWriteContext}.
   */
  setForeignCorpusWriteContext(context: ForeignCorpusWriteContext): void {
    this.foreignCorpusWriteContext = context;
  }

  /**
   * Runs {@link checkForeignCorpusWrite} against this instance's current
   * {@link foreignCorpusWriteContext} for a NON-LIFECYCLE write (create/set/
   * link/unlink/delete — none of these have a task-claim lease to declare
   * intent on, so `intentDeclared` is always `false` here). The ONE call site
   * every guarded write method below shares, so the decision can never drift
   * between them.
   *
   * @returns `undefined` when the write may proceed; a ready-to-return
   *   `err(...)` `Result` when it must be refused.
   */
  private async refuseIfForeignCorpusWrite<T>(
    intentDeclared = false,
    targets: readonly DocRecord[] = [],
    scopeProof?: readonly DocRecord[],
  ): Promise<Result<T, LoreError> | undefined> {
    const verdict = checkForeignCorpusWrite(this.foreignCorpusWriteContext, intentDeclared);
    if (verdict.allowed) return undefined;
    // reason: claim-scoped corpus authoring (spec-baseline-slice-2 §C8, issue #39) — a worktree implementer whose fresh
    // claim lease declares a `corpus_scope` covering every baseline target may write there. The decision is the
    // authority's ONE `decide`, the same call the service-level authorization report makes, so a report and the write
    // it reports on cannot disagree. No armed authority ⇒ the plain refusal below.
    if (this.corpusWriteAuthority !== undefined) {
      const decided = await this.corpusWriteAuthority.decide(targets, scopeProof);
      return decided.ok ? undefined : err(decided.error);
    }
    return err(foreignCorpusWriteRefusalError(verdict));
  }

  /**
   * Arms the claim-scoped corpus-write authority the write route consults before refusing a foreign-corpus write
   * (see {@link refuseIfForeignCorpusWrite}). Called once per CLI process by `adapters/cli/loader.ts`, next to
   * {@link setForeignCorpusWriteContext}. Unarmed (every bare construction) ⇒ the route refuses every foreign write.
   */
  setCorpusWriteContext(context: CorpusWriteAuthorityContext): void {
    this.corpusWriteAuthority = new CorpusWriteAuthority(this.store, context, this);
  }

  private corpusWriteAuthority: CorpusWriteAuthority | undefined;

  // ── The one write route ────────────────────────────────────────────────────

  /** {@link writeDoc}'s `versioning: "keep"` leg: CAS-guarded doc update, then the audit row; no version row. */
  private async writeDocKeepingVersion(
    request: DocWriteRequest,
    actor: string,
    now: string,
  ): Promise<Result<DocWriteOutcome, LoreError>> {
    const { doc, patch } = request;
    const updated = await this.store.update(
      doc.id,
      { ...definedOnly(patch), updated_at: now },
      { expected_version: doc.version },
    );
    if (!updated.ok) return updated;
    const audited = await this.store.appendAuditEntry({
      timestamp: now,
      actor,
      session_id: request.auditSessionId ?? doc.id,
      action: request.auditAction,
      doc_id: doc.id,
      details: { ...request.auditDetails, version: doc.version },
    });
    if (!audited.ok) return audited;
    return ok({ doc: updated.value, written: true });
  }

  /**
   * THE write route for changing an existing document (spec-defect-clusters-round-1 D3). In order: the
   * foreign-corpus refusal, the no-op check (a patch that changes nothing writes nothing and returns
   * `written: false`), the record-lock check for `request.lock`, then ONE `updateWithProvenance` transaction
   * carrying the doc update, its version row and its audit row — all three land or none do. The version
   * row and audit row name the CALLING actor (`request.by`, else the store write context's claimed name);
   * the store's write context stamps the run. Never the doc's creator, never "system".
   *
   * @param request - See {@link DocWriteRequest}.
   * @returns the post-write doc with `written: true`; the unchanged doc with `written: false`; or the refusal
   *   (`gate:corpus-write:foreign-provenance`, `gate:record-edit`, `STALE_VERSION`, a store error).
   */
  async writeDoc(request: DocWriteRequest): Promise<Result<DocWriteOutcome, LoreError>> {
    const refusal = await this.refuseIfForeignCorpusWrite<DocWriteOutcome>(request.foreignIntent === true, [request.doc], request.scopeProof);
    if (refusal !== undefined) return refusal;
    const { doc, patch } = request;
    if (patchedFieldsUnchanged(doc, patch)) return ok({ doc, written: false });

    if (request.lock !== "none") {
      const gate = await this.recordLock.assertEditable(doc, request.lock, {
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.extra !== undefined ? { extra: patch.extra } : {}),
      });
      if (!gate.ok) return gate;
    }

    const actor = this.resolveWriteActorResult(request.by);
    if (!actor.ok) return actor;
    const now = request.now ?? new Date().toISOString();
    if (request.versioning === "keep") return this.writeDocKeepingVersion(request, actor.value, now);
    const newVersion = doc.version + 1;
    const after: DocRecord = { ...doc, ...definedOnly(patch), version: newVersion, updated_at: now };
    const versionRecord: VersionRecord = {
      doc_id: doc.id,
      version: newVersion,
      content: after.content,
      extra: after.extra,
      status: after.status,
      title: after.title,
      action: request.action,
      created_at: now,
      created_by: actor.value,
      ...(request.changeSummary !== undefined ? { change_summary: request.changeSummary } : {}),
      // reason: SPEC-072 D4 — a write never changes the slug, so the snapshot carries the doc's current one.
      slug: doc.slug,
    };
    const written = await this.store.updateWithProvenance(
      doc.id,
      { ...definedOnly(patch), version: newVersion, updated_at: now },
      { expected_version: doc.version },
      versionRecord,
      {
        timestamp: now,
        actor: actor.value,
        session_id: request.auditSessionId ?? doc.id,
        action: request.auditAction,
        doc_id: doc.id,
        // reason: SPEC-035 §2 — `version` is the join key AuditService.verify matches against the version row.
        details: { ...request.auditDetails, version: newVersion, new_version: newVersion },
      },
      request.extras,
    );
    if (!written.ok) return written;
    return ok({ doc: written.value, written: true });
  }

  /**
   * THE write route for adding a NEW document that arrives with its own identity and timestamps (an import
   * or a migration-created doc). Foreign-corpus refusal, then ONE `insertWithProvenance` transaction (doc +
   * version 1 + audit), attributed to the calling actor.
   *
   * @param request - See {@link DocInsertRequest}.
   */
  async insertDoc(request: DocInsertRequest): Promise<Result<DocRecord, LoreError>> {
    const refusal = await this.refuseIfForeignCorpusWrite<DocRecord>(request.foreignIntent === true, [request.doc]);
    if (refusal !== undefined) return refusal;
    const actor = this.resolveWriteActorResult(request.by);
    if (!actor.ok) return actor;
    const { doc } = request;
    const versionRecord: VersionRecord = {
      doc_id: doc.id,
      version: doc.version,
      content: doc.content,
      extra: doc.extra,
      status: doc.status,
      title: doc.title,
      action: "create",
      created_at: doc.created_at,
      created_by: actor.value,
      ...(request.changeSummary !== undefined ? { change_summary: request.changeSummary } : {}),
      slug: doc.slug,
    };
    return this.store.insertWithProvenance(doc, versionRecord, {
      timestamp: doc.created_at,
      actor: actor.value,
      session_id: request.auditSessionId ?? doc.id,
      action: request.auditAction,
      doc_id: doc.id,
      details: { ...request.auditDetails, version: doc.version },
    });
  }

  /**
   * Route for reserving a `proposed` rule id inside a spec's change set: foreign-corpus refusal, the store's ONE
   * transaction (allocate the id, CAS-update the spec, write its version row — stamped with the invocation's run,
   * register the id as `proposed`), then the audit row as the calling actor.
   *
   * @param request - See {@link ProposedRuleReserveRequest}.
   */
  async reserveProposedRule(
    request: ProposedRuleReserveRequest,
  ): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>> {
    const refusal = await this.refuseIfForeignCorpusWrite<{ ruleId: string; doc: DocRecord }>(request.foreignIntent === true);
    if (refusal !== undefined) return refusal;
    const actor = this.resolveWriteActorResult(request.by);
    if (!actor.ok) return actor;
    const reserved = await this.store.reserveProposedRuleAndUpdateSpec(request.write, actor.value, request.family);
    if (!reserved.ok) return reserved;
    const audited = await this.store.appendAuditEntry({
      timestamp: new Date().toISOString(),
      actor: actor.value,
      session_id: reserved.value.doc.id,
      action: "update",
      doc_id: reserved.value.doc.id,
      details: {
        ...request.auditDetails,
        rule_id: reserved.value.ruleId,
        version: reserved.value.doc.version,
        new_version: reserved.value.doc.version,
      },
    });
    if (!audited.ok) return audited;
    return reserved;
  }

  /**
   * The foreign-corpus refusal alone, for a caller whose operation writes something this route does not carry
   * (a judgment row) BEFORE the routed write: asking first keeps a refused call from leaving that earlier row behind.
   *
   * @param foreignIntent - See {@link DocWriteRequest.foreignIntent}.
   * @returns `ok` when a write into this corpus is allowed; the `gate:corpus-write:foreign-provenance` refusal otherwise.
   */
  async assertWritable(foreignIntent = false): Promise<Result<void, LoreError>> {
    return (await this.refuseIfForeignCorpusWrite<void>(foreignIntent)) ?? ok(undefined);
  }

  /**
   * THE write route for re-pointing a doc's parent (a hierarchy migration): foreign-corpus refusal, then the
   * store's ONE transaction (`setDocParentWithProvenance`: the parent write, the `parent` link-edge removal on a
   * clear, the audit row) naming the calling actor. The migration's audit row is its record: it bumps no version.
   *
   * @param request - See {@link DocParentRequest}.
   */
  async setDocParent(request: DocParentRequest): Promise<Result<DocRecord, LoreError>> {
    const refusal = await this.refuseIfForeignCorpusWrite<DocRecord>();
    if (refusal !== undefined) return refusal;
    const actor = this.resolveWriteActorResult(request.by);
    if (!actor.ok) return actor;
    return this.store.setDocParentWithProvenance(request.docId, request.parentId, {
      timestamp: new Date().toISOString(),
      actor: actor.value,
      session_id: request.auditSessionId,
      action: request.auditAction,
      doc_id: request.docId,
      ...(request.auditDetails !== undefined ? { details: { ...request.auditDetails } } : {}),
    });
  }

  /**
   * THE write route for an audit row that bumps no version (a judgment, a state-binding skip, an issue-close step,
   * an adoption record, a foreign-corpus decision): foreign-corpus refusal (unless `request.foreign` is
   * `"record"`), then ONE audit append naming the calling actor; the store's write context stamps the run.
   *
   * @param request - See {@link AuditAppendRequest}.
   */
  async appendAudit(request: AuditAppendRequest): Promise<Result<void, LoreError>> {
    if (request.foreign !== "record") {
      const refusal = await this.refuseIfForeignCorpusWrite<void>(request.foreignIntent === true);
      if (refusal !== undefined) return refusal;
    }
    const actor = this.resolveWriteActorResult(request.by);
    if (!actor.ok) return actor;
    return this.store.appendAuditEntry({
      timestamp: request.timestamp ?? new Date().toISOString(),
      actor: actor.value,
      session_id: request.sessionId,
      action: request.action,
      ...(request.docId !== undefined ? { doc_id: request.docId } : {}),
      ...(request.details !== undefined ? { details: { ...request.details } } : {}),
    });
  }

  /**
   * Route for the ordinal repair-assignment: foreign-corpus refusal, then the store's ONE transaction
   * (`assignOrdinalForRepairWithProvenance`) carrying the ordinal write, the version row and the audit row, both
   * naming the calling actor. All three land or none do: a failure of the version or audit insert leaves the doc
   * on its previous ordinal and version. A repeat call at the same ordinal is a no-op that writes nothing.
   *
   * @param doc - The doc as read (its `version` is the CAS base: the new version is `doc.version + 1`).
   * @param ordinal - The target ordinal, computed by the caller to be free.
   */
  async assignOrdinalForRepair(
    doc: DocRecord,
    ordinal: number,
    by?: string,
    now: string = new Date().toISOString(),
  ): Promise<Result<DocWriteOutcome, LoreError>> {
    const refusal = await this.refuseIfForeignCorpusWrite<DocWriteOutcome>();
    if (refusal !== undefined) return refusal;
    const actor = this.resolveWriteActorResult(by);
    if (!actor.ok) return actor;
    const newVersion = doc.version + 1;
    const assigned = await this.store.assignOrdinalForRepairWithProvenance(
      doc.id,
      ordinal,
      {
        doc_id: doc.id,
        version: newVersion,
        content: doc.content,
        extra: doc.extra,
        status: doc.status,
        title: doc.title,
        action: "update",
        created_at: now,
        created_by: actor.value,
        change_summary: `Ordinal ${ordinal} assigned (ordinal migration)`,
        slug: doc.slug,
      },
      {
        timestamp: now,
        actor: actor.value,
        session_id: `ordinal-migration-${doc.id}`,
        action: "ordinal-backfill",
        doc_id: doc.id,
        details: { new_ordinal: ordinal, version: newVersion, new_version: newVersion },
      },
    );
    if (!assigned.ok) return assigned;
    return ok({ doc: assigned.value, written: assigned.value.version !== doc.version });
  }

  /**
   * Route for a registered rule move: foreign-corpus refusal, then the store's ONE transaction that
   * CAS-updates both leaves, writes their version rows and repoints the registry (the store stamps the run on
   * those rows through `RuleLeafPatch.harness_run`), then one audit row per leaf, attributed to the caller.
   *
   * @param request - See {@link RuleMoveRequest}.
   */
  async moveRule(request: RuleMoveRequest): Promise<Result<{ from: DocRecord; to: DocRecord }, LoreError>> {
    const moveTargets: DocRecord[] = [];
    for (const id of [request.from.id, request.to.id]) {
      const found = await this.store.find(id);
      if (!found.ok) return found;
      if (found.value !== null) moveTargets.push(found.value);
    }
    const refusal = await this.refuseIfForeignCorpusWrite<{ from: DocRecord; to: DocRecord }>(false, moveTargets);
    if (refusal !== undefined) return refusal;
    const actor = this.resolveWriteActorResult(request.by);
    if (!actor.ok) return actor;
    const moved = await this.store.moveRule(request.ruleId, request.from, request.to, actor.value);
    if (!moved.ok) return moved;
    for (const doc of [moved.value.from, moved.value.to]) {
      const audited = await this.store.appendAuditEntry({
        timestamp: new Date().toISOString(),
        actor: actor.value,
        session_id: doc.id,
        action: "update",
        doc_id: doc.id,
        details: { ...request.auditDetails, operation: "rule-move", version: doc.version, new_version: doc.version },
      });
      if (!audited.ok) return audited;
    }
    return moved;
  }

  /**
   * Route for a registry-allocated rule add: foreign-corpus refusal, the store's ONE transaction (allocate the
   * next id, CAS-update the leaf, write its version row — stamped with the invocation's run), then the audit
   * row as the calling actor.
   *
   * @param request - See {@link RuleAllocateRequest}.
   */
  async allocateRule(request: RuleAllocateRequest): Promise<Result<{ ruleId: string; doc: DocRecord }, LoreError>> {
    const refusal = await this.refuseIfForeignCorpusWrite<{ ruleId: string; doc: DocRecord }>(false, [request.leaf]);
    if (refusal !== undefined) return refusal;
    const actor = this.resolveWriteActorResult(request.by);
    if (!actor.ok) return actor;
    const { leaf } = request;
    const allocated = await this.store.allocateRuleAndUpdateLeaf(
      leaf.id,
      leaf.version,
      request.buildExtra,
      actor.value,
      request.family,
    );
    if (!allocated.ok) return allocated;
    const audited = await this.store.appendAuditEntry({
      timestamp: new Date().toISOString(),
      actor: actor.value,
      session_id: allocated.value.doc.id,
      action: "update",
      doc_id: allocated.value.doc.id,
      details: {
        rule_id: allocated.value.ruleId,
        operation: "rule-add",
        version: allocated.value.doc.version,
        new_version: allocated.value.doc.version,
      },
    });
    if (!audited.ok) return audited;
    return allocated;
  }

  /**
   * The record-lock verdict {@link writeDoc} reaches for a text rewrite, WITHOUT evaluating the gate: lets a dry
   * run report the refusal a live run would hit while writing nothing (the gate leaves a trace row even when it
   * passes). Same lock facts (`RecordLockService.resolve`), so the verdict cannot drift from the live one.
   *
   * @returns `ok(undefined)` when `doc` is not a locked record; `ok(message)` naming `RECORD_LOCKED` when it is.
   */
  async describeRecordLock(doc: DocRecord): Promise<Result<string | undefined, LoreError>> {
    const lock = await this.recordLock.resolve(doc);
    if (!lock.ok) return lock;
    if (!(lock.value.standing === "record" && lock.value.locked)) return ok(undefined);
    return ok(`Gate "record-edit" would block: RECORD_LOCKED — ${doc.slug} is a locked record (${lock.value.reason})`);
  }

  /** {@link resolveWriteActor} as a `Result`: an unwired write context is a refusal, not a throw. */
  private resolveWriteActorResult(by?: string): Result<string, LoreError> {
    try {
      return ok(this.resolveWriteActor(by));
    } catch (e) {
      if (e instanceof WriteActorUnresolvedError) return err(e.error);
      throw e;
    }
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
   * the SAME session-tier/OS-username precedence chain
   * the CLI's `resolveActor` already applies (`resolveActorWithSource`,
   * `@lore/core/node`), reused here so a service-layer write (through the
   * CLI, MCP, or HTTP dashboard) is always attributed to a real name when its caller
   * doesn't (or can't) supply `opts.by`: the name of the store's write context
   * (`withWriteContext`, resolved once at the CLI entry) comes before the env chain.
   *
   * @param by - Explicit actor value threaded from the caller's `opts.by`
   *   (adapters resolve their own surface's actor identity and pass it
   *   here); `undefined` falls through to the env chain.
   * @returns The resolved actor string — never empty.
   */
  private resolveWriteActor(by?: string): string {
    return resolveWriteActorFor(this.store, by);
  }

  /**
   * Pre-flight for an AI body rewrite (`lore set --regenerate|--refine`): refuse BEFORE the paid AI call
   * when `doc` is a locked record (spec D4/D15). Reads the lock verdict through the SAME
   * {@link RecordLockService} `set` uses — no second lock implementation — and only when it is locked asks
   * the gate for the real refusal, so a passing (living / unlocked) doc leaves no extra `gate_passed` row
   * (the write's own gate evaluation records that).
   *
   * @param doc - The stored document the AI would rewrite.
   * @returns `ok` when the rewrite may proceed to the AI call; otherwise the `gate:record-edit`
   *   `VALIDATION_ERROR` (exit 4), or the store/validation error the lock facts produced.
   */
  async assertAiRewriteAllowed(doc: DocRecord): Promise<Result<void, LoreError>> {
    const lock = await this.recordLock.resolve(doc);
    if (!lock.ok) return lock;
    if (!(lock.value.standing === "record" && lock.value.locked)) return ok(undefined);
    return this.recordLock.assertEditable(doc, "ai-rewrite");
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
   * Validates via createDocInputSchema, generates a ULID id, resolves parent,
   * inserts doc + version record + audit entry.
   *
   * Slug: `input.slug` when supplied is used VERBATIM (D2,
   * spec-a-github-filed-defect-must-be-claimable-one-ingest-seam) — the
   * store's UNIQUE index on `docs.slug` is then the sole arbiter of identity,
   * and a collision returns a typed `DUPLICATE_SLUG` error (never a silently
   * aliased "-2" suffix). Absent `input.slug` (every pre-existing caller)
   * generates a collision-free slug via `slugifyWithCollision`, byte-identical
   * to pre-D2 behavior.
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
   * `opts.allowHandoff: true` skipping exactly TWO of its rejections and nothing
   * else — (a) the handoff writer-identity rejection below, and (b) the
   * foreign-corpus-write provenance guard at the top of `_createImpl`
   * (spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5's SECOND
   * named exemption, asserted by AC-CP-3 cell 4). ⛔ Those two are DIFFERENT
   * rejections that merely happen to key on the same flag: (a) answers "who may
   * author this sub_type", (b) answers "may this process write a corpus it does
   * not own". Do not reason about one from the other.
   * Never registered on any CLI/MCP/HTTP adapter — its only production caller is
   * `SessionService.writeHandoff`, bound in `app.ts` as
   * `corpusService.createHandoffDoc.bind(corpusService)` the same way
   * `resolveDeclaredAcIds`/`recordVerifiedEvidence` are bound. Callers passing a
   * non-handoff `input` (any other type/sub_type) are still fully validated —
   * `allowHandoff` widens ONLY those two rejections, nothing else in the pipeline
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
   * doc with `extra.sub_type: "uat"` may be created. Mirrors {@link createHandoffDoc}
   * exactly, including WHICH rejections the flag skips: `opts.allowUat: true` skips
   * the uat writer-identity rejection below AND the foreign-corpus-write provenance
   * guard at the top of `_createImpl` (§D5's second named exemption, AC-CP-3 cell 4)
   * — see that method's doc for why the two must not be reasoned about as one.
   * The public `create()` / `lore create` path keeps
   * rejecting sub_type "uat" so the typed `extra.uat` payload can never be hand-forged.
   * `UatService.record` is its production caller (bound in `app.ts`).
   *
   * ⛔ Only the DOC create is exempt. `UatService.record` also writes an `informs`
   * link, and it does so through the injected `store.addLink` port rather than
   * `CorpusService.link` (`app.ts`), so that link never reaches the guard either.
   * Routing it through `CorpusService.link` would refuse the second half of every
   * foreign `lore uat record` and leave the loud half-failure that service's own
   * `@invariant` describes — which is what AC-CP-3 cell 4 measures end-to-end.
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
    // reason: spec-corpus-resolution-carries-provenance-and-a-foreign-write
    // §D5/AC-CP-3 cell 3 — `lore create <type>` (and every OTHER non-lifecycle
    // write below) has no task-claim lease to declare intent on, so it is
    // ALWAYS refused when this instance's resolved corpus provenance is a
    // foreign git-common-dir crossing.
    //
    // The `allowHandoff`/`allowUat` skip is that spec's SECOND named exemption
    // — seam-shaped rather than adapter-shaped. Its reason and its narrowness
    // argument live in §D5 and are deliberately NOT restated here: a second
    // copy of a rationale is a second thing that can drift out of agreement
    // with the spec it came from.
    //
    // ⛔ It is FALSIFIABLE, not merely reasoned: AC-CP-3 cells 3 and 4 fence it
    // from both sides (`tests/e2e/foreign-corpus-write-guard.bun.test.ts`).
    // Widening this condition to cover ordinary creates reddens cell 3;
    // narrowing or deleting it reddens cell 4. Both directions were measured by
    // probe on 2026-08-12 — so a future change here has an oracle, and changing
    // it without reading §D5 first is a spec change wearing a refactor's
    // clothes.
    if (opts?.allowHandoff !== true && opts?.allowUat !== true) {
      const refusal = await this.refuseIfForeignCorpusWrite<CreateDocResult>();
      if (refusal !== undefined) return refusal;
    }

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

    // AC write chokepoint (spec-baseline-slice-2 §C3, AC-BLS2-1; amendment log 2026-10-08):
    // create is a SANCTIONED path — inline criteria are additions, re-validated here, and the
    // `acQuantifiable` spec-create gate below runs on the same array (baseline rule BR-5).
    // Runs before any store write so a refused create leaves no doc behind.
    const acGate = applyAcChange("create", undefined, data.extra);
    if (!acGate.ok) return acGate;

    // SPEC-079 G2 — resolved once per call, reused for this create's audit entry.
    const resolvedActor = this.resolveWriteActor(opts?.by);

    // Baseline create-time guard (spec-baseline-slice-1-rules-with-permanent-ids-ac-citations
    // AC-BLS1-1). reason: rule ids are minted ONLY by the registry allocator
    // (`lore rule add`). A baseline doc created with `extra.rules` already inside would carry
    // ids the registry never saw, and a later allocation could issue the same `BR-n` twice.
    // Lives in create() so CLI, MCP and HTTP all inherit it. `depends_on` may only name ids that
    // exist (registry or a leaf), the same check `lore baseline depends` runs.
    if (data.type === "baseline" && data.extra !== undefined) {
      const carriedRules = data.extra["rules"];
      if (Array.isArray(carriedRules) && carriedRules.length > 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "extra.rules",
          message:
            "a baseline doc cannot be created with rules already inside — rule ids are allocated " +
            "by the registry; create the leaf empty and use `lore rule add` for each rule",
          value: carriedRules,
        });
      }
      const carriedDeps = data.extra["depends_on"];
      if (Array.isArray(carriedDeps) && carriedDeps.length > 0) {
        const registry = await this.store.listRuleRegistry();
        if (!registry.ok) return registry;
        const leaves = await this.store.findMany({ type: "baseline" });
        if (!leaves.ok) return leaves;
        const known = collectKnownRuleIds(leaves.value, registry.value);
        const unknown = carriedDeps.filter((id) => typeof id !== "string" || !known.has(id));
        if (unknown.length > 0) {
          return err({
            code: "VALIDATION_ERROR",
            field: "extra.depends_on",
            message:
              `depends_on names rule id(s) that exist nowhere in the registry or baseline tree: ${unknown.join(", ")} — ` +
              "create the leaf without depends_on and use `lore baseline depends --add` once the rules exist",
            value: unknown,
          });
        }
      }
    }

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

    // BR-1/BR-2: a spec takes no parent — refused before anything is resolved or written.
    // reason: VALIDATION_ERROR (exit 4) rather than INVALID_PARENT_TYPE, whose message lists
    // allowed parent types; for a spec the answer is "none, cite rules instead".
    if (isParentlessType(data.type) && data.parent_id) {
      return err({
        code: "VALIDATION_ERROR",
        field: "parent_id",
        message: parentlessRefusalMessage(data.type),
        value: data.parent_id,
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

    // Cross-entity phase validation for tasks with extra.phase (AC-PHASE-3, SPEC-023 §4),
    // resolved against the plan this task is a MEMBER of — see
    // `_validateTaskPhase`/`_resolveTaskPhaseNamespace` for the whole rule and the
    // membership-vs-`parent_id` history. Deliberately NOT gated on
    // `resolvedParentId !== null`: where the task is FILED has no bearing on which
    // phase namespace governs it, and the old parent gate is exactly what made a
    // supported `--plan-id P --parent Q` task read Q's phases. Tasks without
    // `extra.phase` short-circuit inside the helper.
    if (data.type === "task") {
      const phaseValidation = await this._validateTaskPhase(data.extra ?? {});
      if (!phaseValidation.ok) return phaseValidation;
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

    // Create-time code_anchors GRAMMAR validation (SPEC-045 §Design Decisions
    // D6a, widened doc-type-agnostic by spec-a-write-side-fact-with-no-read-
    // side-address-counts-with-no §M2/AC-RR-9). reason: specExtraSchema/
    // knowledgeExtraSchema only shape-check code_anchors (bare array of
    // strings) — the per-entry `path[#Symbol]` grammar lives in the shared
    // pure `parseCodeAnchor` (@lore/core, code-anchors.ts), run per-entry on
    // the FULL raw string (never batch-normalized — SPEC-045 review S3).
    // Mirrors the task file_anchors branch immediately above, but this is
    // VALIDATION ONLY — unlike file_anchors, code_anchors entries are NOT
    // rewritten/normalized here ("they just must PARSE", D6a) — a
    // grammar-valid raw string persists verbatim. Filesystem verification is
    // `lore status --check-drift`'s job, never a write-time check. Gated on
    // `ANCHOR_SCANNED_DOC_TYPES` (`drift-check-service.ts`, currently
    // spec+knowledge) rather than a literal `type === "spec"` — that literal
    // was the MCP side door: `lore_create`/`lore_set` accept `extra` directly
    // (no CLI-only gate to fall back on), so a knowledge doc's
    // grammar-invalid entry rode through unchecked while `extractParsedCodeAnchors`
    // (drift-check-service.ts) silently skipped it at scan time — a stored
    // fact with zero drift coverage, never surfaced as a refusal.
    if (ANCHOR_SCANNED_DOC_TYPES.includes(data.type)) {
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

    // D2 (spec-a-github-filed-defect-must-be-claimable-one-ingest-seam): a
    // caller-supplied `data.slug` is used VERBATIM — the store's UNIQUE index
    // on `docs.slug` becomes the SOLE arbiter of identity. No collision
    // suffixing, no CJK-transliteration lookup: a colliding verbatim slug
    // surfaces as the store's typed `DUPLICATE_SLUG` on the insert below
    // (AC-GR-4), never a silently aliased "-2" suffix. Deliberately no
    // `findBySlug` pre-check here — a check-then-insert would reopen the exact
    // TOCTOU race this path exists to close; the store's UNIQUE constraint is
    // the only correct arbiter under concurrent writers. Absent `data.slug`
    // (every pre-existing caller) falls through to the original
    // collision-avoiding generator below, byte-identical to pre-D2 behavior.
    let slug: string;
    if (data.slug !== undefined) {
      slug = data.slug;
    } else {
      // Generate collision-free slug. transliterate: getTransliterateCjk (SPEC-068
      // D1) — CJK titles get a pinyin-derived slug instead of collapsing to the
      // bare type name (kebab's [^a-z0-9]+ strips every non-ASCII character
      // otherwise). Only awaited when the title actually contains CJK — an
      // ASCII-only title never pays the pinyin-pro load cost.
      // reason: exactOptionalPropertyTypes forbids `{ transliterate: undefined }`
      // — omit the key entirely (not just set it undefined) when the title has
      // no CJK, rather than always spreading an `undefined`-valued property.
      const slugOpts = containsCjk(data.title) ? { transliterate: await getTransliterateCjk() } : undefined;
      slug = await slugifyWithCollision(
        data.type,
        data.title,
        async (candidate) => {
          const r = await this.store.findBySlug(candidate);
          return r.ok && r.value !== null;
        },
        slugOpts,
      );
    }

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
      // lookup falls back to `FALLBACK_SPEC_CREATE_RULE_SOURCE`/`_MARKDOWN`
      // (spec-governance-visibility-an-armed-gate-that-vacuously-passes §B3) —
      // NEVER a bare `[source: unknown]` with an empty rule slice, which is what
      // EVERY fresh-`lore init` corpus produced before this fallback existed (zero
      // approved `knowledge/skill` docs to find yet). This still degrades to a
      // never-thrown, never-differently-shaped Result either way (mirrors
      // `writeProvenanceLink`'s fail-soft posture elsewhere in this file) — it is
      // strictly more information than the bare discriminator, on BOTH the
      // "corpus genuinely empty" and "store read failed" branches below.
      let ruleEnrichment: Pick<GateContext, "ruleSource" | "ruleMarkdown"> = {};
      if (this.gateEnforcer.isEnabled("spec-create")) {
        const feedingSkillResult = await this.findFeedingSkill(SPEC_CREATE_FEEDING_SCOPE);
        if (feedingSkillResult.ok && feedingSkillResult.value !== null) {
          ruleEnrichment = {
            ruleSource: feedingSkillResult.value.slug,
            ruleMarkdown: feedingSkillResult.value.content,
          };
        } else {
          ruleEnrichment = {
            ruleSource: FALLBACK_SPEC_CREATE_RULE_SOURCE,
            ruleMarkdown: FALLBACK_SPEC_CREATE_RULE_MARKDOWN,
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
        // reason: AC-FR-8/D7 (task-derive-lore-feed-s-checkpoint-set-from-the-
        // registry-make) — `id` (generated above) is the row this candidate will
        // actually get once this gate passes; threaded ONLY for
        // `GateEnforcer.enforce`'s own `gate_passed` audit `doc_id` (never read by
        // `checkSpecCreate`/`feedSpecCreate`, see `GateContext.targetDocId`'s JSDoc).
        targetDocId: id,
      };
      const gateResult = this.gateEnforcer.enforce("spec-create", gateCtx);
      if (!gateResult.ok) return gateResult;
    }

    // Gate `task-create` (spec-declaring-ac-scope-is-required-at-task-creation-
    // so-the): a task whose parent plan resolves a spec-tier ancestor declaring
    // >= 1 script-mode acceptance criterion must declare extra.ac_scope (D1/D2)
    // before it may be created — closes the reachability hole where `lore
    // verify` refuses a task's ac_scope-absent evidence with nothing at
    // authoring time requiring the declaration. Checked BEFORE the getPlanBundle
    // IO below (mirrors TaskWorkflowService.enforceClaimGate's isEnabled-before-
    // IO order for the SAME reason: a disabled checkpoint must stay byte-
    // identical to pre-this-change behavior, never blocked by a broken
    // ancestor-spec lookup). An --adhoc task's resolvedParentId is the corpus
    // root PRD (not a plan, see the ad-hoc auto-parenting block above) —
    // getPlanBundle on it fails with isNonPlanParentError, which this treats as
    // D3's vacuous "no spec-tier ancestor" pass, the SAME structural shape
    // enforceClaimGate already uses for task-claim's identical ad-hoc case
    // (never an exemption: an ad-hoc task that wants attested evidence still
    // needs ac_scope, since VerifyRunnerService.verifyAdhocTask resolves its
    // governing spec THROUGH that field).
    if (data.type === "task" && this.gateEnforcer && this.gateEnforcer.isEnabled("task-create")) {
      let upstreamCtx: GateContext = { hasSpecParent: false };
      if (resolvedParentId !== null) {
        const bundleResult = await this.getPlanBundle(resolvedParentId);
        if (!bundleResult.ok) {
          if (!isNonPlanParentError(bundleResult.error)) return bundleResult;
          // reason: a non-plan parent (the --adhoc root-PRD auto-parenting
          // branch above) has no spec-tier ancestor to resolve against — D3
          // vacuous pass, never an exemption. `upstreamCtx` keeps its
          // `hasSpecParent: false` default from initialization above.
        } else {
          const spec = bundleResult.value.spec;
          upstreamCtx = {
            ...buildUpstreamSpecContext(spec),
            ...(spec !== undefined
              ? { parentSpecScriptAcCount: countScriptModeAcceptanceCriteria(spec) }
              : {}),
          };
        }
      }
      const taskCreateGateResult = this.gateEnforcer.enforce("task-create", {
        ...upstreamCtx,
        candidateAcScopeDeclared: Array.isArray(data.extra?.["ac_scope"]),
        targetIdOrSlug: slug,
        // reason: AC-FR-8/D7 — see the spec-create gate block above's identical note.
        targetDocId: id,
      });
      if (!taskCreateGateResult.ok) return taskCreateGateResult;
    }

    // Citation gate on create's inline criteria (spec-baseline-slice-2 §C3: create is a sanctioned AC path
    // whose criteria are additions "with the same citation gate"). Decided by the SAME chokepoint function
    // `AcService` uses; runs before the insert, so a refused create leaves no doc behind. Report-mode
    // would-refuse rows are appended after the insert (the doc id exists only then in the store).
    // Residual (documented, D6): create's liveness read is the chokepoint's early read — the creating
    // transaction (`insertWithProvenance`) has no in-transaction re-read; a cite that loses a race with a
    // retire still shows in `cites_to_inactive` (flagged), it is just not refused.
    let citeGateAudit: AuditEntry[] = [];
    if (this.citeGate !== undefined && data.type === "spec") {
      const inline = specAcceptanceCriteriaSchema.safeParse(resolvedExtra["acceptance_criteria"]);
      if (inline.success && inline.data.length > 0) {
        const anchors = resolvedExtra["code_anchors"];
        const admission = await admitAcWrite(this.store, {
          rawGateConfig: this.citeGate.raw,
          target: {
            id,
            slug,
            anchors: Array.isArray(anchors) ? (anchors as unknown[]).filter((a): a is string => typeof a === "string") : [],
          },
          existing: [],
          next: inline.data,
          actor: resolvedActor,
          creating: true,
        });
        if (!admission.ok) return admission;
        citeGateAudit = admission.value.wouldRefuseAudit;
      }
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
      // reason: the SAME resolved actor as the audit entry (spec-run-identity-slice-1 D1/D4) — one author
      // per write, never the literal historical default.
      created_by: resolvedActor,
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
      // SPEC-079 G2 / spec-run-identity-slice-1 D1 — resolved actor (explicit `by` > write-context name >
      // session tier > OS username); `doc.created_by` and the versions row carry the SAME value.
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

    for (const entry of citeGateAudit) {
      const recorded = await this.store.appendAuditEntry(entry);
      if (!recorded.ok) return recorded;
    }

    // Provenance auto-write (IoC vertical-slice tech-spec §4.1 P4, "governs" edge from
    // the feeding skill to the artifact it fed) — fail-soft by construction, see
    // writeProvenanceLink's JSDoc. The created doc is already durably persisted above;
    // this is metadata layered on top and must never turn a successful create into an
    // error.
    await this.writeProvenanceLink(insertResult.value, resolvedActor);

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
  private async writeProvenanceLink(newDoc: DocRecord, actor: string): Promise<void> {
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
        created_by: actor,
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
    opts?: SetOptions,
  ): Promise<Result<CorpusSetResult, LoreError>> {
    // reason: spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5.
    {
      const refusal = await this.refuseIfForeignCorpusWrite<CorpusSetResult>();
      if (refusal !== undefined) return refusal;
    }

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

    // BR-1071 (issues #65 #50) — setting a status to approved IS an approval: it takes the approve path
    // (judgment, spec/plan-promote, rule-citation checks; an `approve` version + audit row), never a
    // direct write that skips them. A pure approval carries no other change (D4): a changed field or a
    // correction next to `approved` is refused before any write, naming the two-step form. A resend of
    // a stored value is not a change (the dashboard and MCP resend whole forms).
    if (parsedPatch.data.status === "approved" && existing.status !== "approved" && this.approvalPort !== undefined) {
      const patchData = parsedPatch.data;
      const changed: string[] = [];
      if (patchData.title !== undefined && patchData.title !== existing.title) changed.push("title");
      if (patchData.content !== undefined && bodyDiffers(existing.content, patchData.content)) changed.push("content");
      if (patchData.priority !== undefined && patchData.priority !== existing.priority) changed.push("priority");
      if (patchData.slug !== undefined && patchData.slug !== existing.slug) changed.push("slug");
      if (patchData.tags !== undefined && !isDeepStrictEqual(patchData.tags, existing.tags)) changed.push("tags");
      if (patchData.extra !== undefined && !isDeepStrictEqual(patchData.extra, existing.extra)) changed.push("extra");
      if (opts?.correction !== undefined) changed.push("correction");
      if (changed.length > 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "status",
          message:
            `setting status to approved is an approval and carries no other change, but this call also changes ` +
            `${changed.join(", ")} — make the edit first with "lore set", then approve in a separate step ` +
            `("lore set --status approved" or "lore approve")`,
          value: patchData.status,
        });
      }
      const approved = await this.approvalPort.approve(existing.id, {
        reviewer: this.resolveWriteActor(opts?.by),
        ...(opts?.expectedVersion !== undefined ? { expectedVersion: opts.expectedVersion } : {}),
      });
      if (!approved.ok) return approved;
      return ok(approved.value);
    }

    // record-edit gate (spec-documents-are-living-or-records D4/D6/D13/D14) — BEFORE any write and before
    // the rest of this method's validation, so a locked record's refusal is never masked by an unrelated
    // complaint. The trigger is a DIFFERENCE from the stored doc (body/title, extra.sub_type), never mere
    // presence: the dashboard and MCP resend content on a tag save. A correction bypasses the gate.
    const correction = opts?.correction;
    let correctionApplies = false;
    if (correction !== undefined) {
      if (correction.reason.trim().length === 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "correction.reason",
          message: "a correction needs a non-empty reason (--correction \"<why this is a fix, not a change>\")",
          value: correction.reason,
        });
      }
      if (parsedPatch.data.status !== undefined && parsedPatch.data.status !== existing.status) {
        return err({
          code: "VALIDATION_ERROR",
          field: "correction",
          message:
            "a correction fixes text and keeps the record's status; it cannot be combined with a status change — " +
            "make the status change in a separate `lore set --status`",
          value: parsedPatch.data.status,
        });
      }
      const lockResult = await this.recordLock.resolve(existing);
      if (!lockResult.ok) return lockResult;
      correctionApplies = lockResult.value.standing === "record" && lockResult.value.locked;
      // reason: D13 — an `extra.sub_type` change on a locked knowledge record is a KIND change (retro→reference
      // would flip it to living and unlock it), never a text fix. A correction may not carry one, so the kind
      // check runs here too and a refusal is the same gate:record-edit error (exit 4) a plain set gets.
      if (correctionApplies) {
        const kindGate = await this.recordLock.assertEditable(
          existing,
          "kind",
          parsedPatch.data.extra !== undefined ? { extra: parsedPatch.data.extra } : {},
        );
        if (!kindGate.ok) return kindGate;
      }
    } else {
      const contentGate = await this.recordLock.assertEditable(existing, "content", {
        ...(parsedPatch.data.content !== undefined ? { content: parsedPatch.data.content } : {}),
        ...(parsedPatch.data.title !== undefined ? { title: parsedPatch.data.title } : {}),
      });
      if (!contentGate.ok) return contentGate;
      const kindGate = await this.recordLock.assertEditable(
        existing,
        "kind",
        parsedPatch.data.extra !== undefined ? { extra: parsedPatch.data.extra } : {},
      );
      if (!kindGate.ok) return kindGate;
    }

    // Reset to draft if content/title changed on approved doc
    let newStatus = parsedPatch.data.status ?? existing.status;
    // reason: spec D14 — the demotion trigger is a DIFFERENCE too. A resend of the stored text (a tag save
    // from the dashboard) is not an edit, and demoting a locked record on it would reopen it by the back
    // door. `bodyDiffers` compares canonicalised text, so a re-save of the same body reads as unchanged.
    const contentOrTitleChanged =
      (parsedPatch.data.content !== undefined && bodyDiffers(existing.content, parsedPatch.data.content)) ||
      (parsedPatch.data.title !== undefined && parsedPatch.data.title !== existing.title);
    // reason: this is an INTERNAL lifecycle invariant (SPEC-002 §3), not a
    // user-requested transition — approved→draft is deliberately absent from
    // VALID_TRANSITIONS (only active/archived/deprecated follow "approved"),
    // so the isValidTransition check below must not see this as the user's
    // ask. It also unconditionally OVERRIDES any status the caller requested
    // in the same patch, matching the pre-existing behavior this block always
    // had (a content/title edit on an approved doc always demotes to draft).
    //
    // The RULE itself (trigger AND target status) lives in ONE place:
    // `@lore/core`'s `resolveStatusAfterContractEdit`, beside `VALID_TRANSITIONS`.
    // `AcService.setCriterion` calls that same function for an in-place
    // acceptance-criterion edit (spec-lore-ac-set-in-place-edit-of-a-declared-
    // acceptance D2). ⛔ Never re-inline the `=== "approved"` / `"draft"` literals
    // here: the rule was mirrored across the two services until 2026-08-01 and the
    // cross-referencing comments were the only thing holding them together —
    // `tests/unit/service/demotion-rule-ssot.test.ts` now stubs the shared function
    // and fails if EITHER call site stops following it.
    // reason: a correction on a locked record writes ONE version and keeps its status (D15) — it skips this
    // demotion, and `isApprovedAutoResetToDraft` staying false also skips the ledger re-approve second write.
    const demotedStatus = correctionApplies
      ? existing.status
      : resolveStatusAfterContractEdit(existing.status, contentOrTitleChanged);
    const isApprovedAutoResetToDraft = demotedStatus !== existing.status;
    if (isApprovedAutoResetToDraft) {
      newStatus = demotedStatus;
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

    // reason: DCL-1 (b), issues #174 / BR-212 — `lore set --status archived` is an archive route like `lore done`,
    // plan close and the sweep, and archives a task only if `lore done`'s floors would let it through. The
    // check is the ONE copy of the floors (`DoneFloorPort`); the refusal is the exact error `done()` returns
    // (`details.floor` names the floor), nothing is written. An UNWIRED service (bare unit construction)
    // keeps the pre-port behaviour, as plan close does.
    if (
      existing.type === "task" &&
      newStatus === "archived" &&
      existing.status !== "archived" &&
      this.doneFloorPort !== undefined
    ) {
      const floorResult = await this.doneFloorPort.checkDoneFloors(existing.id);
      if (!floorResult.ok) return floorResult;
      if (floorResult.value !== null) return err(floorResult.value.error);
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
            `${SELF_DECLARED_ORDINAL_TITLE_REFUSAL} — the ordinal is allocated automatically; write the bare title`,
          value: parsedPatch.data.title,
        });
      }
      docPatch.title = parsedPatch.data.title;
    }
    // reason: canonicalise content at write time (same invariant as _createImpl).
    // Ensures corpus always stores normalised body; sync-docs roundtrip is then lossless.
    // Source: SPEC-021 §4; empty content stays "".
    // reason: a resend whose canonical form equals the stored body is not an edit (D14) — writing it would put a
    // whitespace-normalised body version on a locked record the gate just judged unchanged. Keep stored bytes.
    if (parsedPatch.data.content !== undefined && bodyDiffers(existing.content, parsedPatch.data.content)) {
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

    // AC write chokepoint (spec-baseline-slice-2 §C3, AC-BLS2-1): a wholesale `extra` that changes
    // `acceptance_criteria` is refused — only the `AcService` verbs may change it. Placed in
    // `set()` so CLI `lore set`, MCP `lore_set` and HTTP PATCH inherit it with no adapter copy.
    if (parsedPatch.data.extra !== undefined) {
      const acGate = applyAcChange("wholesale", existing.extra, parsedPatch.data.extra, existing.id);
      if (!acGate.ok) return acGate;
    }

    // Dedicated-verb replace guard (spec-baseline-slice-1-rules-with-permanent-ids-ac-citations
    // §C3, QA-2), driven by the `DEDICATED_EXTRA_KEYS` table in @lore/core. STRONGER than the
    // drop-only guard above: a registered key whose incoming value is dropped, added, replaced
    // OR merely reordered (deep-equal, array order significant) is refused, because `extra`
    // replaces wholesale and `rules`/`glossary` are order-bearing, id-bearing data owned by one
    // verb. An `extra` that echoes every guarded key byte-equal stays allowed. Living in
    // `set()` makes the CLI `lore set`, MCP `lore_set` and HTTP PATCH inherit it with no
    // per-adapter copy. Only doc types listed in the table are guarded (today: baseline).
    if (parsedPatch.data.extra !== undefined) {
      const violation = findDedicatedExtraKeyViolation(existing, parsedPatch.data.extra);
      if (violation !== null) {
        return err({
          code: "VALIDATION_ERROR",
          field: `extra.${violation.key}`,
          message:
            `extra.${violation.key} on a ${existing.type} doc is owned by \`${violation.writer}\` — ` +
            `\`lore set\` replaces \`extra\` wholesale and must not drop, replace or reorder it. ` +
            `Use \`${violation.writer}\` instead, or pass the current value byte-equal.`,
          value: parsedPatch.data.extra[violation.key],
        });
      }
    }

    // Guard: extra.outline (SPEC-080 C1; its writers were retired by BR-985) — STRONGER than the
    // drop-only guard immediately above: ANY direct patch whose `extra` carries
    // an "outline" key is rejected outright, even a byte-identical restate of
    // the doc's current outline (no value-equality escape hatch, unlike the
    // extra.validity guard below which tolerates a same-value restate). Since slice 3a no verb writes
    // this field at all: the stored outline is read-only history superseded by the baseline tree.
    if (parsedPatch.data.extra !== undefined && Object.prototype.hasOwnProperty.call(parsedPatch.data.extra, "outline")) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.outline",
        message: "extra.outline cannot be changed via `lore set` — outline writes are retired; record the structure with `lore baseline add` instead",
        value: parsedPatch.data.extra["outline"],
      });
    }

    // Cross-entity phase validation when updating a task's extra.phase (AC-PHASE-3,
    // SPEC-023 §4) — the SAME `_validateTaskPhase` call `_createImpl` makes, against
    // the PATCH's `extra` because `extra` is replaced wholesale (a patch can move the
    // task's declared membership, or drop it, in the same write that sets the phase).
    // reason: one shared method, not a second copy — the two copies this replaced were
    // already drifting in their gate condition (`resolvedParentId` vs
    // `existing.parent_id`), which is how a create/`set` disagreement would arrive.
    if (existing.type === "task" && parsedPatch.data.extra !== undefined) {
      const phaseValidation = await this._validateTaskPhase(parsedPatch.data.extra);
      if (!phaseValidation.ok) return phaseValidation;
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

    // code_anchors GRAMMAR re-validation when updating a spec/knowledge doc's
    // extra (SPEC-045 §Design Decisions D6a, widened doc-type-agnostic by
    // spec-a-write-side-fact-with-no-read-side-address-counts-with-no §M2/
    // AC-RR-9). reason: specExtraSchema/knowledgeExtraSchema (re-parsed above/
    // below) only shape-check code_anchors (bare array of strings) — the
    // per-entry `path[#Symbol]` grammar is a SEPARATE check via the shared
    // pure `parseCodeAnchor` (@lore/core), run here so `lore set` / HTTP PATCH
    // / MCP `lore_set` can't smuggle a malformed anchor past the shape-only
    // Zod gate (mirrors D6a's "no side doors" requirement, same shape as the
    // ac_scope/spec_kind cross-cutting checks immediately above/below).
    // Validation only — a grammar-valid incoming array persists verbatim, no
    // rewrite ("they just must PARSE", D6a); the RMW verbs
    // (DriftCheckService.addCodeAnchors/removeCodeAnchors) remain the
    // sanctioned normalize-on-write path. Gated on `ANCHOR_SCANNED_DOC_TYPES`
    // rather than a literal `type === "spec"` — that literal was the MCP side
    // door this AC closes: a knowledge doc's `extra.code_anchors` patched
    // through `lore_set` rode past this check entirely, byte-identical extra
    // never re-validated for grammar before persisting.
    if (ANCHOR_SCANNED_DOC_TYPES.includes(existing.type) && parsedPatch.data.extra !== undefined) {
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
        // reason: AC-FR-8/D7 — see corpus-service.ts's spec-create gate block's
        // identical note; `existing.id` is the RESOLVED doc's real id, never its slug.
        targetDocId: existing.id,
      });
      if (!gateResult.ok) return gateResult;
    }

    // BR-1007 on the `set` promotion path — unconditional (no gateEnforcer, no config switch),
    // placed AFTER the spec-promote gate so a spec that fails a gate on its own merits is refused
    // for that reason first. Same predicate `ReviewService.approve` runs (spec-approval-citation.ts).
    if (existing.type === "spec" && newStatus === "approved" && existing.status !== "approved") {
      const effectiveExtra = parsedPatch.data.extra !== undefined ? parsedPatch.data.extra : existing.extra;
      const cited = await requireSpecCitesLiveRule(this.store, existing.slug, effectiveExtra["acceptance_criteria"], ownProposedRules(effectiveExtra));
      if (!cited.ok) return cited;
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
    //   - `citedRuleStateClean` (BR-984, OPT-IN via a DEFAULT-OFF config knob):
    //     evaluated only when `GateEnforcer.isCitedRuleCheckEnabled()` is true and a rule-state
    //     service is wired — see the dedicated block below.
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
      const citedRuleCheckEnabled = this.gateEnforcer.isCitedRuleCheckEnabled();
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

      // reason: AC-FR-8/D7 — see corpus-service.ts's spec-create gate block's
      // identical note; `existing.id` is the RESOLVED plan's real id, never its slug.
      let citedRuleUnknowns: CitedRuleUnknown[] = [];
      let planCloseCtx: GateContext = { targetIdOrSlug: existing.slug, targetDocId: existing.id };

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
      // cited-rule-state branch both need `getPlanBundle` (the former for its
      // tasks' evidence counts, the latter for its resolved ancestor spec) — fetched AT MOST ONCE for this whole
      // block, never once per sub-gate. `!exemptKindValid` (spec-verify-
      // reachability-plan-promote-early-warning §Scope M3) joins the SAME
      // condition `checkPlanClose` uses to decide whether `attestationFloor`
      // itself runs — a plan claiming exemption with an invalid/missing kind
      // still needs its tasks' evidence counts for the feeding pack's
      // offending-task diagnostics.
      const needsBundle =
        !attestationExempt || !exemptKindValid || (citedRuleCheckEnabled && this.ruleStateService !== undefined);
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
        // SPEC-143 AC-CT-3 — the stamp axis rides the same counting call: `unbound` rows leave
        // `attestedCount` and a task attested only by them is refused by `attestationFloor`.
        const stampBinding = await loadStampBindingContext(this.store, bundleResult!.value.tasks, this.stampRadiusDiff);
        if (!stampBinding.ok) return stampBinding;
        const planTasksAttestation = buildTaskAttestationInfos(bundleResult!.value.tasks, stampBinding.value);
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

      planCloseCtx = { ...planCloseCtx, citedRuleCheckEnabled };
      // reason: BR-984 — the cited-rule-state predicate. `bundle.spec` is undefined for a PRD-parented or
      // unparented plan (getPlanBundle's own contract): nothing is cited, so `citedRuleViolations` stays
      // unset and `checkPlanClose` pushes nothing. Knob off (default) never reads rule state at all.
      if (citedRuleCheckEnabled && this.ruleStateService !== undefined) {
        const spec = bundleResult!.value.spec;
        if (spec !== undefined) {
          const violationsResult = await this.resolveCitedRuleViolations(spec);
          if (!violationsResult.ok) return violationsResult;
          citedRuleUnknowns = violationsResult.value.unknowns;
          planCloseCtx = {
            ...planCloseCtx,
            citedRuleViolations: violationsResult.value.violations,
            citedRuleUnknowns,
          };
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

      // reason: task-assert-the-plan-close-vacuity-discriminator-on-the-render
      // (spec-governance-visibility-an-armed-gate-that-vacuously-passes §AC-GV-6)
      // — `enforce()` above already ran `checkpointRegistry["plan-close"].check`
      // internally and, via `warnVacuousCheckpoint`, already prints THIS SAME
      // notice to stderr when the run was fully vacuous — that pre-existing
      // mechanism is the human-render half of the discriminator. Nothing put
      // the fact anywhere a `--json` consumer could read: measured directly
      // (throwaway-corpus probe, not assumed) that a vacuous and a satisfied
      // close both serialized to `"extra": {}"` before this line existed. This
      // recomputes the SAME pure check via the SAME exported functions
      // `enforce()` used (never a second, divergent implementation) purely to
      // READ the verdict back out, since `enforce()`'s own signature returns
      // only ok/err on all seven checkpoints and widening it would ripple into
      // every other call site's pinned `Result<void, LoreError>` return type.
      // Written to `extra` ONLY when vacuous — a satisfied close, or a
      // fully-exempted one (already announced via
      // `formatAttestationExemptionNotice`), gets no new key at all, so every
      // pre-existing satisfied-close fixture's `extra` shape stays untouched.
      //
      // reason: `planCloseCheckpointDef` is provably defined here — the
      // `enforce("plan-close", …)` call two lines above already resolved this
      // SAME registry key and would have thrown its own "checkpoint not
      // registered" internal-invariant error otherwise (checkpoint-registry.ts's
      // second module invariant: all `GateCheckpoint` members are registered).
      // The check is still explicit, never a `!` assertion, so a future
      // registry edit that broke that invariant fails loud HERE too, not only
      // inside `enforce()`.
      const planCloseCheckpointDef = checkpointRegistry["plan-close"];
      if (planCloseCheckpointDef === undefined) {
        throw new Error('Internal error: gate checkpoint "plan-close" not registered');
      }
      const planCloseVacuityNotice = describeCheckpointVacuity(
        "plan-close",
        planCloseCheckpointDef.check(planCloseCtx),
      );
      if (planCloseVacuityNotice !== null) {
        docPatch.extra = { ...effectiveExtra, [PLAN_CLOSE_VACUITY_NOTICE_FIELD]: planCloseVacuityNotice };
      }
      // reason: BR-984 - the closed plan records which cited rules were unmeasured, so the report is not stderr-only.
      if (citedRuleUnknowns.length > 0) {
        docPatch.extra = {
          ...(docPatch.extra ?? effectiveExtra),
          [PLAN_CLOSE_UNMEASURED_CITED_RULES_FIELD]: citedRuleUnknowns.map((u) => ({ rule_id: u.rule_id, reason: u.reason })),
        };
      }
    }

    // Landing of the plan's spec's rule change set (D3 of spec-a-spec-carries-its-rule-changes-the-baseline-
    // takes-them): closing the plan is the moment the spec lands, so `apply` runs HERE, after every plan-close
    // gate has passed and before the plan's own write. Unconditional on `gateEnforcer` (like the cascade): it is
    // a data-integrity step, not an advisory predicate. A refusal (a citing criterion without a runner-attested
    // pass) refuses the close and names the criteria; `apply` is idempotent, so a close that later fails on a
    // stale write simply re-runs it as a no-op.
    if (isPlanClosing && this.ruleChangeLanding !== undefined && existing.parent_id !== null) {
      const parent = await this.store.find(existing.parent_id);
      if (!parent.ok) return parent;
      if (parent.value !== null && parent.value.type === "spec") {
        const landed = await this.ruleChangeLanding.apply(parent.value.slug, { by: this.resolveWriteActor(opts?.by) });
        if (!landed.ok) return landed;
      }
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
      // reason: the SAME resolved actor as the audit entry (spec-run-identity-slice-1 D1/D4).
      created_by: resolvedActor,
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
      ...(correction !== undefined ? { change_summary: `Correction: ${correction.reason.trim()}` } : {}),
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
        // SPEC-079 G2 — the resolved actor.
        actor: resolvedActor,
        session_id: existing.id,
        action: "update",
        doc_id: existing.id,
        // reason: SPEC-035 §2 — `version` (not just the pre-existing `new_version`
        // alias) is the join key AuditService.verify matches against the versions
        // row's own `version` field.
        details: {
          patch: parsedPatch.data,
          new_version: newVersion,
          version: newVersion,
          ...(correction !== undefined ? { correction: { reason: correction.reason.trim() } } : {}),
        },
      },
    );
    if (!updateResult.ok) return updateResult;

    // A spec moved to `deprecated` before its change set landed abandons it: its still-proposed ids become
    // `retired` "never landed: <spec>" (spec-a-spec-carries-its-rule-changes-the-baseline-takes-them, Edge cases).
    // After the status write, so a refused/stale deprecation never retires anything; `apply` on a deprecated spec
    // is idempotent, so a failure here is repaired by re-running `lore rule apply <spec>` (named in the error).
    if (existing.type === "spec" && newStatus === "deprecated" && existing.status !== "deprecated" && this.ruleChangeLanding !== undefined) {
      const abandoned = await this.ruleChangeLanding.apply(existing.slug, { by: resolvedActor });
      if (!abandoned.ok) {
        return err({
          code: "VALIDATION_ERROR",
          field: "rule_changes",
          message:
            `${existing.slug} is now deprecated, but retiring its proposed rules failed (${abandoned.error.code}); ` +
            `re-run \`lore rule apply ${existing.slug}\` to retire them`,
          value: abandoned.error,
        });
      }
    }

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
    // spec-archiving-the-work-that-resolves-a-defect-report-closes D1/D4 — post-commit, never fatal: the
    // step returns lines, not an error, because the archive above is already committed.
    const isArchiving = newStatus === "archived" && existing.status !== "archived";
    const ownIssueClose = isArchiving ? await this.runArchiveIssueClose(updateResult.value, resolvedActor) : [];
    const withIssueClose = (lines: IssueCloseItem[]): { issueClose?: IssueCloseItem[] } =>
      this.archiveIssueClosePort !== undefined && isArchiving ? { issueClose: lines } : {};

    if (isPlanClosing) {
      const cascade = await this.cascadeArchiveOnPlanClose(updateResult.value, now, resolvedActor);
      return ok({
        ...updateResult.value,
        cascade,
        ...withIssueClose([...ownIssueClose, ...(cascade.issueClose ?? [])]),
      });
    }

    return ok({ ...updateResult.value, ...withIssueClose(ownIssueClose) });
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
    // reason: task-eight-more-plan-member-queries-still-key-on-parent-id — a
    // `parent_id`-keyed query here is a WRITE-PATH defect, not a cosmetic one:
    // it would ARCHIVE a non-member (a task merely parented under this closing
    // plan via `--parent`, whose `extra.plan_id` points elsewhere) and STRAND
    // a real diverged member (whose `extra.plan_id === plan.id` but whose
    // `parent_id` points elsewhere, so a `parent_id`-keyed fetch never even
    // sees it). `isPlanMember` (`extra.plan_id`, the DECLARED property — see
    // its own JSDoc) replaces the `parent_id` proxy so every real member is
    // archived and every non-member is left alone; no disagreement-reporting
    // signal is needed here (unlike the parent task's `computePlanNowFullyTerminal`
    // site) because this is a plain correct-field READ, not a computation that
    // can be silently satisfied by an empty set — the store has no
    // `extra.plan_id` filter, so this is a corpus-wide `type: "task"` findMany
    // (same accepted tradeoff as `TaskWorkflowService.ready`/
    // `computePlanNowFullyTerminal`), filtered in memory.
    const allTasksResult = await this.store.findMany({ type: "task" });
    const tasksResult = allTasksResult.ok
      ? ok(allTasksResult.value.filter((t) => isPlanMember(t, plan.id)))
      : allTasksResult;
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
    const issueClose: IssueCloseItem[] = [];
    const failed: Array<{ doc_id: DocId; slug: string; reason: string }> = [];
    const skipped: Array<{ doc_id: DocId; slug: string; reason: string; floor?: string }> = [
      ...plan_.skipped,
    ];

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

      // reason: spec-approval-and-plan-closure-go-through-the-same-checks-on D5/D6 (BR-1072) — a
      // member task is archived only if `lore done`'s floors would let it through. The check is
      // the injected port (the ONE copy of the floors, `TaskWorkflowService.checkDoneFloors`);
      // this service never re-derives a floor. Port `err` => `failed` (a store-level fault is not
      // a verdict), a refusal => `skipped` with the floor id, task left untouched. Handoffs have
      // no floors. Deliberately NOT gated by `workflow.gates."plan-close".enabled` (BR-214).
      // An UNWIRED service (bare `new CorpusService(store)`, no port) keeps the pre-port
      // behaviour (spec D3): every unclaimed task archives.
      if (target.kind === "task" && this.doneFloorPort !== undefined) {
        const floorResult = await this.doneFloorPort.checkDoneFloors(doc.id);
        if (!floorResult.ok) {
          failed.push({
            doc_id: doc.id,
            slug: doc.slug,
            reason: `done-floor check failed: ${describeLoreError(floorResult.error)}`,
          });
          continue;
        }
        if (floorResult.value !== null) {
          skipped.push({
            doc_id: doc.id,
            slug: doc.slug,
            reason: `refused by ${floorResult.value.floor}`,
            floor: floorResult.value.floor,
          });
          continue;
        }
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
      // reason: a cascaded TASK may itself resolve a defect report (D4: every archive path reaches the
      // step). The doc is the post-write state `updateWithProvenance` returned.
      if (target.kind === "task") issueClose.push(...(await this.runArchiveIssueClose(writeResult.value, actor)));
    }

    return {
      archived,
      skipped,
      failed,
      ...(this.archiveIssueClosePort !== undefined ? { issueClose } : {}),
    };
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
  ): Promise<Result<DocRecord & { issueClose?: IssueCloseItem[] }, LoreError>> {
    // reason: spec-approval-and-plan-closure-go-through-the-same-checks-on D8 / AC-AP-10 (BR-1072) —
    // a straggler task is archived only if `lore done`'s floors would let it through; a refusal comes
    // back as the exact `done()` error (`error.details.floor` names the floor), nothing is written.
    const floorResult = await this.checkSweepCandidateFloor(doc, rule);
    if (!floorResult.ok) return floorResult;
    if (floorResult.value !== null) return err(floorResult.value.error);

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
    if (!writeResult.ok) return writeResult;
    // spec-archiving-the-work-that-resolves-a-defect-report-closes D4 — the sweep is an archive path too.
    if (this.archiveIssueClosePort === undefined) return writeResult;
    return ok({ ...writeResult.value, issueClose: await this.runArchiveIssueClose(writeResult.value, resolvedActor) });
  }

  /**
   * Which `lore done` floor, if any, would refuse archiving this sweep candidate — read-only, the
   * ONE place the sweep (`--sweep` report and `--apply`) asks the injected {@link DoneFloorPort}.
   * Only the R4 task straggler rule is floor-gated; handoff rules (R2/R3) have no floors.
   *
   * An UNWIRED service (bare `new CorpusService(store)`, no port) keeps the pre-port behaviour
   * (spec D3 "unconditional"): `ok(null)`, every candidate passes.
   *
   * @returns `ok(null)` = archivable; `ok({floor, error})` = refused; `err` = the port itself failed
   *   (a store-level fault is not a verdict).
   */
  async checkSweepCandidateFloor(
    doc: DocRecord,
    rule: ArchiveCandidateRule,
  ): Promise<Result<{ readonly floor: string; readonly error: LoreError } | null, LoreError>> {
    if (rule !== "done_plan_straggler" || this.doneFloorPort === undefined) return ok(null);
    return this.doneFloorPort.checkDoneFloors(doc.id);
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
    // reason: spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5 —
    // checked BEFORE the confirm gate, since a foreign write is refused
    // regardless of confirmation state.
    {
      const refusal = await this.refuseIfForeignCorpusWrite<{ id: DocId; recoverable_until: string }>();
      if (refusal !== undefined) return refusal;
    }

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
      // reason: the SAME resolved actor as the audit entry (spec-run-identity-slice-1 D1/D4).
      created_by: resolvedActor,
    };
    const auditEntry: AuditEntry = {
      timestamp: now,
      // SPEC-079 G2 — the resolved actor.
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
   * @param now - Time seam (D3) — drives the default invalidated-doc
   *   exclusion (knowledge/adr/task, per `ValidityService.VALIDITY_ELIGIBLE_TYPES`);
   *   defaults to `() => new Date().toISOString()`.
   */
  async list(
    filters: ListFilters,
    now: () => string = defaultNow,
  ): Promise<Result<{ docs: DocSummary[]; total: number; omitted_invalid: number }, LoreError>> {
    const startMs = Date.now();
    const { include_invalid, ...storeFilters } = filters;
    const storeResult = await this.store.findMany(storeFilters);
    if (!storeResult.ok) {
      this.recordTelemetryEvent("list", startMs, storeResult, { filter_type: filters.type });
      return storeResult;
    }

    // SPEC-043 D3 — invalidated docs (knowledge/adr/task, per
    // ValidityService.VALIDITY_ELIGIBLE_TYPES — task added by
    // task-a-task-cannot-be-retracted-supersedes-emits-a-repair) are excluded
    // by default from this list-shaped read; isInvalidated is a no-op for
    // every OTHER doc type (they never carry extra.validity), so this filter
    // naturally scopes itself.
    const nowIso = now();
    const visibleDocs =
      include_invalid === true
        ? storeResult.value
        : storeResult.value.filter((d) => !isInvalidated(d, nowIso));

    // F4 (AC-CRIT-6) — the count of rows THIS filter step removed, so a caller can
    // tell "nothing matched" from "matches were hidden as invalidated". Always 0
    // under include_invalid. Counted over the fetched (possibly paged) window.
    const omittedInvalid = storeResult.value.length - visibleDocs.length;
    const docs = visibleDocs.map((d) => this.toSummary(d));
    const result = ok({ docs, total: docs.length, omitted_invalid: omittedInvalid });
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
   * ## Validity is gated HERE, not at each reader
   * (task-validity-landed-on-lore-list-only-the-dispatch-surface, Required #6)
   *
   * This method used to return `DocSummary` rows, which carry no `extra` — so neither
   * SPEC-043 D3's default exclusion nor the `validity_status` projection was COMPUTABLE
   * by its readers, and `lore list --governed-by` was left as the one ungated branch
   * while every other `lore list` branch was fixed (that residual was named verbatim in
   * `commands/list.ts`'s header). It now returns FULL records carrying the projection,
   * and applies the exclusion itself.
   *
   * ⛔ The gate lives in this method, not in `commands/list.ts` + `mcp/tools.ts`
   * separately: those are TWO consumers of one traversal, and a fix landed on one
   * consumer while the shared seam kept the old behaviour is the exact failure this
   * whole task family is about. The `include_invalid` opt mirrors {@link list}'s and
   * {@link search}'s escape so all three read surfaces have ONE shape.
   *
   * @param skillIdOrSlug - ID or slug of the governing skill doc
   * @param opts - `include_invalid: true` restores retracted governed artifacts
   *   (excluded by default), mirroring {@link ListFilters.include_invalid}
   * @param now - Time seam (D3 convention) driving the exclusion AND the projection —
   *   one injected instant per call, so a single listing can never straddle two "now"s
   * @returns `ok({docs, total})` where every record carries `validity_status` — empty
   *   when the skill has no `governs` links; `DOC_NOT_FOUND` when `skillIdOrSlug`
   *   doesn't resolve
   * @example
   * const result = await corpusService.listGovernedBy("knowledge-write-spec-rules");
   * if (result.ok) console.log(result.value.docs.map((d) => d.slug));
   * @example
   * // retracted artifacts too, each flagged `validity_status.invalidated: true`
   * await corpusService.listGovernedBy("knowledge-write-spec-rules", { include_invalid: true });
   */
  async listGovernedBy(
    skillIdOrSlug: string,
    opts?: { include_invalid?: boolean },
    now: () => string = defaultNow,
  ): Promise<Result<{ docs: WithValidityStatus<DocRecord>[]; total: number }, LoreError>> {
    const startMs = Date.now();
    const resolveResult = await this.resolve(skillIdOrSlug);
    if (!resolveResult.ok) return resolveResult;

    const linksResult = await this.store.findLinks(resolveResult.value, "out");
    if (!linksResult.ok) return linksResult;

    const governedIds = linksResult.value
      .filter((link) => link.link_type === "governs")
      .map((link) => link.to_id);

    const found: DocRecord[] = [];
    for (const docId of governedIds) {
      const docResult = await this.store.find(docId);
      if (docResult.ok && docResult.value !== null && docResult.value.deleted_at === null) {
        found.push(docResult.value);
      }
    }

    // Order is load-bearing and mirrors `commands/list.ts::fetchGatedFullDocs`: EXCLUDE
    // first (unless opted out), then CARRY the verdict on whatever survives. Both steps
    // come from the shipped SSOT helpers — never a local `extra.validity` inspection.
    const nowIso = now();
    const visible = opts?.include_invalid === true ? found : selectLiveDocs(found, nowIso);
    const docs = withValidityStatus(visible, nowIso);

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
   * @param now - Time seam (D3) — drives the default invalidated-doc
   *   exclusion (knowledge/adr/task, per `ValidityService.VALIDITY_ELIGIBLE_TYPES`);
   *   defaults to `() => new Date().toISOString()`.
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

    // SPEC-043 D3 — invalidated hits (knowledge/adr/task) are excluded by
    // default. The narrow SearchHit.validity projection (SPEC-037/SPEC-043) makes this computable
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
   * The strategy document (first PRD, `created_at` ASC) — the SSOT every navigation caller shares
   * (see `navigation-roots.ts`). `ok(null)` when the corpus has no live PRD.
   */
  async findStrategyDocument(): Promise<Result<DocRecord | null, LoreError>> {
    const prdsResult = await this.store.findMany({ type: "prd" });
    if (!prdsResult.ok) return prdsResult;
    return ok(pickStrategyDocument(prdsResult.value) ?? null);
  }

  /**
   * The baseline root (`extra.node === "root"`; oldest created when several exist) or `ok(null)`.
   */
  async findBaselineRoot(): Promise<Result<DocRecord | null, LoreError>> {
    const baselineResult = await this.store.findMany({ type: "baseline" });
    if (!baselineResult.ok) return baselineResult;
    return ok(pickBaselineRoot(baselineResult.value) ?? null);
  }

  /**
   * Build a document tree starting from rootIdOrSlug. With no root given the default is the
   * baseline root when one exists, else the strategy document (first PRD). An explicit root is
   * never redirected (AC-BLS3-3, BR-981/BR-982).
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
      const baselineRootResult = await this.findBaselineRoot();
      if (!baselineRootResult.ok) return baselineRootResult;
      const strategyResult = baselineRootResult.value === null ? await this.findStrategyDocument() : baselineRootResult;
      if (!strategyResult.ok) return strategyResult;
      const first = baselineRootResult.value ?? strategyResult.value;
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
    //
    // reason: task-eight-more-plan-member-queries-still-key-on-parent-id — the task
    // half is member-filtered via `isPlanMember` (`extra.plan_id`), never a bare
    // `parent_id` match. This `tasks[]` feeds `checkpoint-registry.ts::
    // buildAnchorGateContext`'s `siblingClaims` (via `task-workflow-service.ts`'s
    // `task-claim` gate check), so a `parent_id`-keyed miss here is not cosmetic: a
    // diverged member's OWN claim/anchors would be invisible to `noAnchorOverlap`,
    // silently admitting an anchor-conflicting claim the gate exists to block — and a
    // task merely PARENTED here (but belonging to a different plan) would wrongly
    // appear as this plan's sibling. The `phase` half stays `parent_id`-keyed
    // unchanged: phase docs have no `extra.plan_id` field at all (SPEC-023), so
    // `parent_id` is the ONLY structural link for them — this task's defect is
    // task-membership-specific, not a general `parent_id` ban.
    const allTasksResult = await this.store.findMany({ type: "task" });
    const tasksResult = allTasksResult.ok
      ? ok(allTasksResult.value.filter((t) => isPlanMember(t, plan.id)))
      : allTasksResult;
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

    // reason: task-eight-more-plan-member-queries-still-key-on-parent-id — this feeds
    // the `assessmentFreshness` gate-predicate advisory (non-blocking); a
    // `parent_id`-keyed miss on a diverged member would silently under-report task
    // activity, making a plan with genuinely-recent diverged-member work read as
    // stale. `isPlanMember` (`extra.plan_id`) replaces the proxy; the `phase` query
    // stays `parent_id`-keyed (phase docs carry no `extra.plan_id`, SPEC-023).
    const allTasksResult = await this.store.findMany({ type: "task" });
    const tasksResult = allTasksResult.ok
      ? ok(allTasksResult.value.filter((t) => isPlanMember(t, planId)))
      : allTasksResult;
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
   * The rules the closing plan's spec criteria cite whose state makes the close refuse (BR-984):
   * `contradicted`, or `stale` (BR-984: ANY citing spec's code changed after its criterion's latest
   * attested pass, by any plan). A fresh attested pass of the stale criterion makes the rule `verified`,
   * so it no longer lists here. `verified`, `unverified` and `unknown` never refuse. Each violation
   * carries the per-input `offences` `RuleStateService.full()` computed, for the refusal to name.
   *
   * @param spec - The closing plan's resolved ancestor spec (`PlanBundle.spec`).
   * @returns `ok([])` when the spec cites nothing (rule state is then not even read), when no
   *   rule-state service is wired, or when every cited rule is fine; `err` when the spec's stored
   *   criteria are unreadable or rule state could not be computed.
   */
  private async resolveCitedRuleViolations(
    spec: DocRecord,
  ): Promise<Result<{ violations: CitedRuleViolation[]; unknowns: CitedRuleUnknown[] }, LoreError>> {
    const none = { violations: [], unknowns: [] };
    const ruleState = this.ruleStateService;
    if (ruleState === undefined) return ok(none);
    const raw = spec.extra["acceptance_criteria"];
    if (raw === undefined) return ok(none);
    const parsed = specAcceptanceCriteriaSchema.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "VALIDATION_ERROR",
        message: `plan-close cannot read the acceptance criteria of ${spec.slug} to find the rules it cites: ${parsed.error.message}`,
        field: "extra.acceptance_criteria",
      });
    }
    const cited = new Set(parsed.data.flatMap((criterion) => criterion.cites ?? []));
    if (cited.size === 0) return ok(none);
    const full = await ruleState.full();
    if (!full.ok) return full;
    const violations: CitedRuleViolation[] = [];
    const unknowns: CitedRuleUnknown[] = [];
    const unmeasurable: string[] = [];
    for (const rule of full.value.rules) {
      if (!cited.has(rule.rule_id)) continue;
      if (rule.state === "contradicted" || rule.state === "stale") {
        violations.push({ rule_id: rule.rule_id, state: rule.state, offences: rule.offences });
      } else if (rule.state === "unknown" && rule.unknown_reason !== undefined) {
        // reason: BR-984 - git-unavailable is a failed measurement and refuses; the other reasons are facts about
        // the recorded evidence or the spec's own choice (no anchors) and are reported, not refused.
        if (rule.unknown_reason === "git-unavailable") unmeasurable.push(rule.rule_id);
        else unknowns.push({ rule_id: rule.rule_id, reason: rule.unknown_reason });
      }
    }
    if (unmeasurable.length > 0) {
      return err({
        code: "VALIDATION_ERROR",
        message:
          `plan-close cannot close ${spec.slug}: the state of cited rule(s) ${unmeasurable.join(", ")} could not be measured ` +
          `(git-unavailable: git did not answer for HEAD or the citing pass's commit). Restore git access, then close again.`,
        field: "gate:plan-close:cited-rule-measurement",
      });
    }
    return ok({ violations, unknowns });
  }

  /**
   * BR-1007 measure for a read-only caller (the `lore gate spec-promote` pre-flight): does at least one
   * criterion cite a live BR/AS rule? The SAME measure `approve` and `set` refuse on
   * (`specCitesLiveRuleInCorpus`) — exposed here because adapters hold no store.
   *
   * @param specExtra - the spec's `extra` as stored: its `acceptance_criteria` and its own change set
   *   (`rule_changes`), whose proposed ids count as citable by THIS spec only
   * @returns `ok(true | false)`; a store read failure is returned as itself (never read as "cites nothing")
   */
  async specCitesLiveRule(specExtra: Readonly<Record<string, unknown>>): Promise<Result<boolean, LoreError>> {
    return specCitesLiveRuleInCorpus(this.store, specExtra["acceptance_criteria"], ownProposedRules(specExtra));
  }

  /**
   * Computes requirement→AC coverage for a PRD (SPEC-055) — the read behind
   * `lore status --check-requirements`. Resolves the PRD, reads its declared requirement
   * inventory, gathers every `requirement_refs` id across the acceptance criteria of EVERY spec
   * that is not deleted (BR-418, BR-420: a spec has no parent, so no PRD owns a subset of them),
   * and partitions the inventory via the pure `computeRequirementCoverage` (`@lore/core`) — a
   * requirement covered IFF some such spec's AC references its id.
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

    // reason: BR-420 / BR-692 — coverage counts the criteria of every spec that is not deleted,
    // whatever its status and wherever it is filed. Specs take no parent (BR-2), so the PRD's
    // children are never the universe; one corpus-wide read serves both the AC refs and the cites.
    const allSpecsResult = await this.store.findMany({ type: "spec" });
    if (!allSpecsResult.ok) return allSpecsResult;
    const refs: string[] = [];
    for (const spec of allSpecsResult.value) {
      const parsedAcs = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
      if (!parsedAcs.success) continue;
      for (const ac of parsedAcs.data) {
        for (const ref of ac.requirement_refs ?? []) refs.push(ref);
      }
    }

    // reason: BR-983 — a migrated requirement is covered by citations, looked up over the same
    // corpus-wide spec set (a spec belongs to the trees through its criteria's citations, never
    // through a parent — ADR decision 5). Liveness of the rule is enforced only once the corpus
    // holds baseline docs.
    const leavesResult = await this.store.findMany({ type: "baseline" });
    if (!leavesResult.ok) return leavesResult;
    const ruleIndex = leavesResult.value.length > 0 ? buildRuleIndex(leavesResult.value) : undefined;
    const citedRuleIds = collectLiveScriptCitedRuleIds(allSpecsResult.value, ruleIndex);

    return ok(computeRequirementCoverage(requirements, refs, citedRuleIds));
  }

  // ── Declared AC Ids (SPEC-038 §4, §7 D4) ────────────────────────────────

  /**
   * Resolve the plan document a `resolveDeclaredAc*`-family lookup starts from — the
   * `resolve` → `store.find` → type-check preamble shared verbatim by
   * {@link resolveDeclaredAcIds} and {@link resolveDeclaredAcCriteria} (the id-set and
   * full-criteria views of the SAME plan→parent-spec walk), so the two can never
   * disagree about which plan a given id/slug names — only about how much of what
   * they find they hand back.
   *
   * @param planIdOrSlug - Plan document ULID or slug (typically a task's `parent_id`)
   * @returns The resolved plan `DocRecord`
   * @throws DOC_NOT_FOUND when planIdOrSlug does not resolve at all; VALIDATION_ERROR
   *   when the resolved doc is not a plan
   */
  private async _resolvePlanForAcLookup(planIdOrSlug: string): Promise<Result<DocRecord, LoreError>> {
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

    return ok(plan);
  }

  /**
   * Resolve the set of acceptance-criterion ids declared on a plan's parent spec —
   * the single cross-entity traversal locus for `ac_ref` validation, same family as
   * `getPlanBundle` (plan → parent spec). CorpusService owns this walk because
   * services never cross-import (service/CLAUDE.md "no cross-service calls");
   * `TaskWorkflowService.addEvidence` consumes it via a narrow injected port
   * (`resolveDeclaredAcIds.bind(corpusService)`, wired in `app.ts`) rather than
   * gaining graph-walking responsibility itself (SPEC-038 §7 D4). A bare id set is
   * all `addEvidence`'s existence check needs; a consumer that needs the full
   * criterion object (e.g. its `oracle_generation`) reads {@link resolveDeclaredAcCriteria}
   * instead — the two share one traversal ({@link _resolveDeclaredAcCriteriaForParent})
   * and can never drift apart (task-widen-the-declared-ac-port-to-carry-criteria-so-the).
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
    const planResult = await this._resolvePlanForAcLookup(planIdOrSlug);
    if (!planResult.ok) return planResult;
    return this._resolveDeclaredAcIdsForParent(planResult.value.parent_id);
  }

  /**
   * The FULL-criteria sibling of {@link resolveDeclaredAcIds} — same plan → parent-spec
   * walk (via {@link _resolvePlanForAcLookup} / {@link _resolveDeclaredAcCriteriaForParent}),
   * but hands back the criterion OBJECTS rather than a bare id set. Exists because a
   * `Set<string>` cannot answer "what generation is that criterion in", which is exactly
   * what `TaskWorkflowService.resolveAcOracleGeneration` needs — before this port existed,
   * that method owned its own private traversal of the same edges (deleted by
   * task-widen-the-declared-ac-port-to-carry-criteria-so-the) precisely because neither
   * injected port could carry more than ids. Injected into `TaskWorkflowService` in
   * `app.ts` the same way `resolveDeclaredAcIds` is; nothing else currently consumes it.
   *
   * @param planIdOrSlug - Plan document ULID or slug (typically a task's `parent_id`)
   * @returns The declared criteria when the plan is parented under a spec with a
   *   schema-valid `extra.acceptance_criteria` array; `null` when the plan has no
   *   parent, the parent isn't a spec, or the parent spec has no structured AC — a
   *   FACT, never a thrown error for this class of absence (same contract as
   *   `resolveDeclaredAcIds`).
   * @throws DOC_NOT_FOUND when planIdOrSlug does not resolve at all; VALIDATION_ERROR
   *   when the resolved doc is not a plan
   *
   * Source: task-widen-the-declared-ac-port-to-carry-criteria-so-the
   */
  async resolveDeclaredAcCriteria(
    planIdOrSlug: string,
  ): Promise<Result<AcceptanceCriterion[] | null, LoreError>> {
    const planResult = await this._resolvePlanForAcLookup(planIdOrSlug);
    if (!planResult.ok) return planResult;
    return this._resolveDeclaredAcCriteriaForParent(planResult.value.parent_id);
  }

  /**
   * The "parent → declared AC id set" half of {@link resolveDeclaredAcIds}, factored out
   * so `_createImpl`/`set`'s SPEC-040 §T2 D5 `extra.ac_scope` cross-entity validation can
   * reuse the identical parent-spec walk WITHOUT first resolving a plan that, at create
   * time, doesn't exist as a persisted doc yet (`resolveDeclaredAcIds` itself always takes
   * an id/slug and re-fetches the plan row first — not usable mid-`_createImpl`). A thin
   * id-projecting wrapper over {@link _resolveDeclaredAcCriteriaForParent} — the criteria
   * walk is the ONE traversal; this is a derived view, never a second copy of it.
   *
   * @param parentId - A plan's `parent_id` (already resolved by the caller)
   * @returns Same contract as `resolveDeclaredAcIds`: `Set<string>` when `parentId` points
   *   at a live spec with schema-valid `extra.acceptance_criteria`; `null` (a fact, never
   *   an error) for a null parentId, a non-spec parent, or a spec with no valid declared AC
   */
  private async _resolveDeclaredAcIdsForParent(
    parentId: DocId | null,
  ): Promise<Result<Set<string> | null, LoreError>> {
    const criteriaResult = await this._resolveDeclaredAcCriteriaForParent(parentId);
    if (!criteriaResult.ok) return criteriaResult;
    const criteria = criteriaResult.value;
    return ok(criteria === null ? null : new Set(criteria.map((c) => c.id)));
  }

  /**
   * The "parent → declared AC criteria" walk itself — the ONE traversal
   * {@link _resolveDeclaredAcIdsForParent} (id-set view) and {@link resolveDeclaredAcCriteria}
   * (public, full-criteria view) both read through, so a future third view is a third
   * thin wrapper here, never a third copy of this lookup.
   *
   * @param parentId - A plan's `parent_id` (already resolved by the caller)
   * @returns The declared criteria when `parentId` points at a live spec with a
   *   schema-valid `extra.acceptance_criteria` array; `null` (a fact, never an error)
   *   for a null parentId, a non-spec parent, or a spec with no valid declared AC
   */
  private async _resolveDeclaredAcCriteriaForParent(
    parentId: DocId | null,
  ): Promise<Result<AcceptanceCriterion[] | null, LoreError>> {
    if (parentId === null) return ok(null);
    const parentResult = await this.store.find(parentId);
    if (!parentResult.ok) return parentResult;
    const parent = parentResult.value;
    if (parent === null || parent.type !== "spec") return ok(null);

    const parsed = specAcceptanceCriteriaSchema.safeParse(parent.extra["acceptance_criteria"]);
    if (!parsed.success) return ok(null);

    return ok(parsed.data);
  }

  /**
   * Resolve which plan's phase namespace governs a task, from the `extra` bag
   * that is ABOUT TO BE PERSISTED — by membership, via {@link isPlanMember}.
   *
   * Scans the plan set and asks the shared predicate, which is the SAME shape
   * every other plan-scoped query in this codebase uses (`getPlanBundle`,
   * `PhaseService.findTasksByPhase`, `PhaseMigrationService.migrateTasks`) — so
   * write-time and read-time can never disagree about who owns a task. ⛔ Do not
   * "optimise" this into a direct `store.find(extra.plan_id)`: the id lookup that
   * replaces it reads as an innocent `plan.id === someLocalConst` comparison
   * which `bun run check:plan-member-sites` cannot see, so the membership rule
   * would silently leave the shared predicate behind again.
   *
   * @param candidateExtra - The task's post-write `extra` bag: `data.extra` on
   *   create, and the PATCH's `extra` on `set` (which replaces wholesale, so the
   *   stored bag is not the one that will govern the doc after the write).
   * @returns The resolved {@link TaskPhaseNamespace} — a FACT, never an error:
   *   "this task has no membership" and "its declared membership matches no plan"
   *   are both legitimate resolutions whose consequences the caller decides.
   *   `err` only propagates a store failure.
   * @example
   * // task created with `--plan-id P --parent Q`:
   * await this._resolveTaskPhaseNamespace({ plan_id: P, phase: "Phase A" });
   * // => { kind: "owning-plan", plan: <P> }   (never Q, whatever parent_id says)
   */
  private async _resolveTaskPhaseNamespace(
    candidateExtra: Record<string, unknown>,
  ): Promise<Result<TaskPhaseNamespace, LoreError>> {
    // reason: a READ of the declared field (to report it and to bound the scan),
    // never a membership comparison — the comparison is isPlanMember's alone.
    // Same read `PhaseMigrationService.computeDeclinedTaskWarnings` makes for its
    // `planIdLabel`, adjudicated there for the identical reason.
    const declaredPlanId = candidateExtra["plan_id"];
    if (typeof declaredPlanId !== "string" || declaredPlanId.length === 0) {
      return ok({ kind: "no-membership" });
    }

    const plansResult = await this.store.findMany({ type: "plan" });
    if (!plansResult.ok) return plansResult;

    const membershipProbe: DocRecord = { ...PLAN_MEMBERSHIP_PROBE_TASK, extra: candidateExtra };
    const owningPlan = plansResult.value.find((plan) => isPlanMember(membershipProbe, plan.id));
    if (owningPlan === undefined) {
      return ok({ kind: "unresolvable-membership", declaredPlanId });
    }
    return ok({ kind: "owning-plan", plan: owningPlan });
  }

  /**
   * Cross-entity `extra.phase` validation for a task, shared verbatim by
   * `_createImpl` and {@link set} (AC-PHASE-3, SPEC-023 §4). Zod cannot express a
   * cross-document constraint, so it lives here; both write paths call THIS one
   * method so a phase name can never be accepted at create and refused by an
   * otherwise-identical `set`, or vice versa.
   *
   * Every refusal names WHICH plan's namespace was consulted — the Silence
   * requirement of `task-the-tenth-plan-member-site-is-a-write-path-create-time`:
   * the pre-fix message quoted phases the author had never referenced (the filing
   * parent's), with nothing on the surface to say a different plan had been read.
   *
   * ⛔ An UNDECLARED phase name is refused only for a task whose owning plan is
   * resolvable and does not declare it. Nothing here refuses a phase TITLE that
   * exists in the corpus but no plan declares — `PhaseMigrationService.buildGroups`
   * creates exactly those by design (its one-group-per-task fallback), and this
   * check never runs over migration output.
   *
   * ## Retroactive policy (armed 2026-08-03)
   *
   * This is a WRITE-path predicate change, so it re-judges the back-catalogue at
   * each doc's NEXT write, not at arming time — the shape
   * `knowledge-retro-a-newly-built-gate-leaves-every-pre-existing` records. The
   * scope was therefore MEASURED before the change, over all 599 task docs in this
   * repo's corpus (`lore list --type task --json --include-invalid`, incl.
   * archived + invalidated):
   *
   * - `parent_id !== extra.plan_id` (diverged, non-adhoc): **0**
   * - diverged AND carrying `extra.phase`: **0**  ← the affected set, asserted EMPTY
   * - non-adhoc tasks with no `extra.plan_id`: **0**
   * - `--adhoc` tasks carrying `extra.phase`: **0** of 147 adhoc tasks
   * - undiverged tasks carrying `extra.phase`: **340** — all validated against the
   *   plan that is simultaneously their parent, so byte-identical either way
   * - non-adhoc tasks whose `extra.plan_id` resolves to NO live plan: **0** (all 340
   *   phase-carrying tasks resolve, against 114 live plans) — the separate scope of
   *   the `unresolvable-membership` refusal, which the divergence count above does
   *   NOT cover and which an earlier reading of this task's scope missed
   *
   * DECISION: **no sweep, and no per-doc exemption is needed** — the affected set is
   * empty, so every existing doc validates identically before and after. The
   * measurement (not the absence of a report) is the evidence: the same predicate
   * run inverted reported 452 agreements, and an injected synthetic diverged doc was
   * detected, so the empty result came from a live query rather than a dead one.
   * Should a diverged phase-carrying task ever be authored against a corpus whose
   * plans have since renamed a phase, the refusal above names the owning plan and
   * its declared names — repair the DOC (`lore create task --phase` /
   * `lore phase rename`), never this predicate.
   *
   * @param candidateExtra - The task's post-write `extra` bag (see
   *   {@link _resolveTaskPhaseNamespace}).
   * @returns `ok(null)` when there is nothing to check (no `extra.phase` string)
   *   or the name is declared by the owning plan; `VALIDATION_ERROR` on
   *   `field: "extra.phase"` otherwise.
   */
  private async _validateTaskPhase(
    candidateExtra: Record<string, unknown>,
  ): Promise<Result<null, LoreError>> {
    const taskPhase = candidateExtra["phase"];
    if (typeof taskPhase !== "string") return ok(null);

    const namespaceResult = await this._resolveTaskPhaseNamespace(candidateExtra);
    if (!namespaceResult.ok) return namespaceResult;
    const namespace = namespaceResult.value;

    if (namespace.kind === "no-membership") {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.phase",
        message:
          `task references phase "${taskPhase}" but declares no extra.plan_id, so it is a member ` +
          "of no plan and has no phase namespace to validate against. Plan membership IS " +
          "extra.plan_id (never parent_id) — declare it, or drop extra.phase. An --adhoc task " +
          "is planless by design and can never carry a phase.",
        value: taskPhase,
      });
    }

    if (namespace.kind === "unresolvable-membership") {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.phase",
        message:
          `task references phase "${taskPhase}" but its declared extra.plan_id ` +
          `"${namespace.declaredPlanId}" matches no plan in this corpus, so the phase namespace ` +
          "to validate against cannot be resolved. extra.plan_id must be a plan's canonical " +
          "ULID — a slug or short prefix makes the task a member of nothing at every " +
          "phase-scoped read too, so it is not accepted here either.",
        value: taskPhase,
      });
    }

    const owningPlan = namespace.plan;
    const declaredPhases = owningPlan.extra["phases"];
    const phasesArray = Array.isArray(declaredPhases) ? declaredPhases : null;
    if (!phasesArray || phasesArray.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "extra.phase",
        message:
          `task references phase "${taskPhase}" but its plan ${owningPlan.slug} ` +
          `(${owningPlan.id}) declares no phases`,
        value: taskPhase,
      });
    }

    const match = phasesArray.find(
      (p): p is { name: string; description?: string } =>
        typeof p === "object" && p !== null && (p as Record<string, unknown>)["name"] === taskPhase,
    );
    if (match) return ok(null);

    const knownNames = phasesArray
      .filter((p): p is { name: string } => typeof p === "object" && p !== null)
      .map((p) => (p as { name: string }).name)
      .join(", ");
    return err({
      code: "VALIDATION_ERROR",
      field: "extra.phase",
      message:
        `unknown phase "${taskPhase}"; its plan ${owningPlan.slug} (${owningPlan.id}) declares: ` +
        `[${knownNames}]`,
      value: taskPhase,
    });
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
    const criteriaResult = await this.resolveDeclaredAcCriteriaForAdhocTask(task);
    if (!criteriaResult.ok) return criteriaResult;
    return ok(new Set(criteriaResult.value.map((c) => c.id)));
  }

  /**
   * The FULL-criteria sibling of {@link resolveDeclaredAcIdsForAdhocTask} — same
   * declared-`ac_scope` → governing-spec search, but hands back the criterion
   * OBJECTS rather than a bare id set (same "why" as {@link resolveDeclaredAcCriteria}
   * for the plan-owned case: a `Set<string>` cannot answer "what generation is that
   * criterion in", which `TaskWorkflowService.resolveAcOracleGeneration` needs for
   * an `--adhoc` task's evidence too). Injected into `TaskWorkflowService` in
   * `app.ts` alongside `resolveDeclaredAcCriteria`; nothing else consumes it.
   * {@link resolveDeclaredAcIdsForAdhocTask} is now a thin id-projecting wrapper
   * over THIS method — one search, two views, never two traversals.
   *
   * @param task - The ALREADY-RESOLVED target ad-hoc task (caller resolves by
   *   id/slug; this method does no id resolution of its own).
   * @returns Every AC criterion declared on the ONE spec that fully covers the
   *   task's declared ac_scope. UNLIKE `resolveDeclaredAcCriteria`, there is no
   *   `null` ("nothing declared") case: an ad-hoc task's ac_scope IS the only
   *   signal available to resolve a governing spec, so an absent/empty scope is
   *   itself a hard refusal, never "nothing to check against".
   * @throws VALIDATION_ERROR field `ac_scope` — ac_scope absent, empty, or
   *   matches zero/multiple specs (same message family
   *   `resolveDeclaredAcIdsForAdhocTask`/`VerifyRunnerService.verifyAdhocTask` raise).
   *
   * Source: task-widen-the-declared-ac-port-to-carry-criteria-so-the
   */
  async resolveDeclaredAcCriteriaForAdhocTask(
    task: DocRecord,
    now: () => string = defaultNow,
  ): Promise<Result<AcceptanceCriterion[], LoreError>> {
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
      now(),
    );
    if (!resolveResult.ok) return resolveResult;

    return ok(resolveResult.value.criteria);
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
   *   SAME resolved actor (`opts.by` > env chain) as the audit row (G2).
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
    // reason: spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5.
    {
      const refusal = await this.refuseIfForeignCorpusWrite<LinkRecord>();
      if (refusal !== undefined) return refusal;
    }

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

      // BR-2: a spec is never filed under a document by a parent link either.
      if (isParentlessType(fromDoc.type)) {
        return err({
          code: "VALIDATION_ERROR",
          field: "type",
          message: parentlessRefusalMessage(fromDoc.type),
          value: type,
        });
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

    // #123 / AD-13 — the link row, (for type=parent) the from doc's parent_id, and the audit entry
    // commit or roll back TOGETHER in one store transaction; a failure leaves no partial state.
    //
    // SPEC-079 G1 — relationship provenance: one audit entry per successful
    // link(), audit-only (no versions row — a link is not a doc-content
    // snapshot, so it deliberately joins no VERSION_ACTION_AUDIT_FAMILY member,
    // audit-service.ts). session_id follows the pre-existing doc-id-valued
    // convention (unchanged by this spec, out of scope) — keyed on the FROM doc,
    // same as doc_id.
    return this.store.addLinkWithProvenance(linkRecord, {
      timestamp: now,
      actor: resolvedActor,
      session_id: fromResult.value,
      action: "link",
      doc_id: fromResult.value,
      details: { to_id: toResult.value, link_type: type },
    });
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
    // reason: spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5.
    {
      const refusal = await this.refuseIfForeignCorpusWrite<void>();
      if (refusal !== undefined) return refusal;
    }

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
   * ## The counts are LIVE counts, and the retracted count is reported, not dropped
   * (task-validity-landed-on-lore-list-only-the-dispatch-surface, Required #3)
   *
   * MEASURED before this fix: `total_docs`/`by_type`/`by_status` counted RETRACTED docs
   * as live work. A corpus-health number that silently overstates live work is the same
   * shape as the readiness inflation this repo has already measured once — and health
   * numbers are exactly what a team reads to decide whether the corpus is in order.
   *
   * ⛔ The retracted docs are EXCLUDED from the three counts and their number is
   * reported as {@link CorpusStatus.invalid_docs}, never simply dropped: an omitted
   * count is the same silence class as an uncounted retraction. `invalid_docs` is
   * ALWAYS present (`0` when nothing is retracted), following
   * `invalidated_feeding_source_warnings`'s "empty is a fact, not absent data" precedent.
   *
   * ⛔ `last_updated` deliberately still spans ALL non-deleted docs, retracted included:
   * it answers "when did this corpus last CHANGE", and a retraction is a change. Scoping
   * it to live docs would report a stale instant right after the very write that
   * retracted the newest doc.
   *
   * @param now - Time seam (D8/D3 convention) — drives the live/retracted split of every
   *   count below AND the invalidated-feeding-source warning, from ONE instant;
   *   defaults to `() => new Date().toISOString()`.
   */
  async status(now: () => string = defaultNow): Promise<Result<CorpusStatus, LoreError>> {
    const allDocsResult = await this.store.findMany({ exclude_deleted: false });
    if (!allDocsResult.ok) return allDocsResult;

    const allDocs = allDocsResult.value;
    const activeDocs = allDocs.filter((d) => d.deleted_at === null);

    // ONE instant for the whole snapshot — the count split below and the D8 warning
    // further down must agree on it (two reads would let a doc be retracted for one and
    // live for the other within a single `lore status`).
    const nowIso = now();
    // The SSOT exclusion helper, not a local `extra.validity` inspection — same predicate
    // `list`/`search`/`listGovernedBy`/`ready` apply, so "what counts as live" has one
    // definition across every read surface.
    const liveDocs = selectLiveDocs(activeDocs, nowIso);
    const invalidDocs = activeDocs.length - liveDocs.length;

    const by_type: Record<string, number> = {};
    const by_status: Record<string, number> = {};

    for (const doc of liveDocs) {
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
    // reason: keyed over activeDocs (NOT liveDocs) on purpose — the whole point of this
    // warning is to name a feeding source that IS retracted, so filtering retracted docs
    // out of the lookup map would make it structurally unable to ever fire.
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
      total_docs: liveDocs.length,
      invalid_docs: invalidDocs,
      by_type,
      by_status,
      last_updated: lastUpdated,
      db_size_bytes: dbSizeResult.value,
      invalidated_feeding_source_warnings: invalidatedFeedingSourceWarnings,
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
