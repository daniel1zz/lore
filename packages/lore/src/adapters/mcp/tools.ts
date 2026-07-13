/**
 * MCP tool registrations — 30 lore_* tools (16 original + 4 SPEC-025 task-workflow tools
 * + 1 SPEC-026 assess tool + 1 SPEC-035 audit tool + 1 SPEC-034 review tool
 * + 1 SPEC-039 verify tool + 1 IoC vertical-slice tech-spec §4.1/§11 P4 feed tool
 * + 2 SPEC-041 session tools: lore_bootstrap, lore_handoff; lore_feed additionally
 * gains a session-resume dispatch branch, SPEC-041 §3 D5
 * + 1 SPEC-042 tool: lore_anchor_set; lore_claim gains machine/worktree, lore_create
 * gains file_anchors, SPEC-042 §Design Decisions D9
 * + 1 SPEC-043 tool: lore_invalidate; lore_get gains computed validity_state,
 * lore_create gains supersedes/by, lore_search/lore_list gain include_invalid,
 * SPEC-043 §Design Decisions D6
 * + 1 SPEC-044 tool: lore_staleness_probe (batch/single-doc/list); lore_status and
 * lore_bootstrap gain computed open_stale_candidates, SPEC-044 §Design Decisions D10, D14
 * + no new tool for SPEC-045 (doc-code drift oracle): lore_status gains check_drift?
 * (migrated off the argless 3-arg form), lore_anchor_set gains spec-target declarative
 * REPLACE, lore_bootstrap gains computed code_anchor_specs, SPEC-045 §Design Decisions D7).
 *
 * Architecture: Tools with input use the `registerToolWithArgs` helper defined below, which:
 *   1. Calls `server.tool(name, desc, handler)` in 3-arg form (avoids ZodRawShapeCompat type bomb)
 *   2. Immediately patches `_registeredTools[name].inputSchema = schema` on the registered tool
 *   3. At runtime the SDK then calls `handler(validatedArgs, extra)` (2-arg form), so the handler's
 *      first parameter receives the SDK-validated args directly.
 *
 * Reason: The 4-arg `server.tool(name, desc, {zodRawShape}, cb)` form triggers
 * `ShapeOutput<Args extends ZodRawShapeCompat>` — a mapped conditional type that distributes
 * `z3.infer<S> | z4.output<S>` across every property key of an inline object literal.
 * With 16 callsites × 8 SDK overloads × 39 inline Zod fields, tsc heap explodes to >7 GB and
 * OOMs. The 3-arg form skips ZodRawShapeCompat resolution entirely. Using `registerTool` with
 * `inputSchema: z.object(...)` also fails: TypeScript structurally matches `ZodObject<Shape>`
 * against `ZodRawShapeCompat` before `AnySchema`, still triggering `ShapeOutput<ZodObject<...>>`.
 * Patching `inputSchema` post-registration bypasses TypeScript inference entirely while preserving
 * correct runtime behaviour (SDK reads `tool.inputSchema` at call time, not registration time).
 * — reason: ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA §"Fast Path" Pattern 1 (implementation note)
 *
 * Public surface: `registerTools(server, app): void`
 * Invariants: one registration per tool name; every tool returns `{ content: [text] }` or
 *   `{ content: [text], isError: true }` (never throws across the MCP boundary).
 * Side-effect class: IO (reads/writes corpus via App services; no network I/O itself).
 * Source: SPEC-008 §3
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { App } from "../../app.js";
import type { LoreError } from "@lore/core";
import type { LinkType } from "@lore/core";
import { renderAssessmentContent } from "@lore/core";
import type { NewReviewJudgment, ReviewJudgment, Result, TreeBlueprint } from "@lore/core";
import { ORACLE_KINDS, parseTreeBlueprint, runDeterministicChecks } from "@lore/core";
import { handoffExtraSchema } from "@lore/core";
import type { HandoffExtra } from "@lore/core";
import { isAssessAiBraked } from "../../ai/resolve-ai.js";
import { REVIEW_PROMPT_VERSION } from "../../ai/review-template.js";
import { CORPUS_SCHEMA_INFO } from "./schema-info.js";
import { runCalibrationHook } from "../../flows/calibration-hook.js";
import { buildFeed, buildResumeFeed, SESSION_RESUME_CHECKPOINT } from "../../flows/feed-flow.js";
import { createWithSupersedes, renderSupersedeRepairMessage } from "../../flows/supersede-flow.js";
import { computeValidityState } from "../../flows/validity-state.js";
import {
  buildStalenessBatchJsonPayload,
  buildStalenessFlowDeps,
  buildStalenessListJsonPayload,
  buildStalenessSingleJsonPayload,
  listFreshStalenessEscalates,
} from "../../flows/staleness-flow.js";
import { buildDriftFlowDeps, buildListSpecs, countArmedSpecs, runDrift } from "../../flows/drift-flow.js";
import { buildRealFsProbe } from "../real-fs-probe.js";
import { buildAssessSummaryText } from "./assess-render.js";

// ─── Schema Constants ────────────────────────────────────────────────────────
// Each schema is a `z.object(...)` instance (AnySchema), NOT an inline ZodRawShape literal.
// Keeping them as const-level declarations ensures tsc resolves their types once,
// not once per callsite × overload combination.
// reason: see ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA — inline raw shapes cause 912s check time

/** Valid document types accepted by all lore_* tools. */
const DOC_TYPE_ENUM = z.enum(["prd", "spec", "adr", "plan", "knowledge", "task"]);

/** Valid document status values accepted by lore_set and lore_list filters. */
const DOC_STATUS_ENUM = z.enum([
  "draft",
  "in-review",
  "approved",
  "active",
  "archived",
  "deprecated",
]);

/** Input schema for lore_create. */
export const LoreCreateSchema = z.object({
  type: DOC_TYPE_ENUM,
  title: z.string().min(1),
  content: z.string().optional(),
  parent_id: z.string().optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.unknown()).optional(),
  /**
   * Whether to invoke AI content generation.
   * Defaults to false — MCP callers are always AI agents (claude-on-claude nesting
   * is wasteful). Pass `ai: true` to explicitly opt in to AI generation.
   * SPEC-024 AC-NOAI-4 / AC-NOAI-5; also documented in SPEC-008 §3 lore_create row.
   */
  ai: z.boolean().default(false),
  /**
   * [task branch only] Candidate `file_anchors` entries (SPEC-042 §Design
   * Decisions D3, D9) — merged into `extra.file_anchors` before the call
   * reaches `CorpusService.create`, which is the single validation +
   * normalization gate (`normalizeFileAnchors`, `@lore/core`). Raw, unvalidated
   * strings — a malformed entry fails loud with VALIDATION_ERROR, same as the
   * CLI's repeatable `--anchor` flag.
   */
  file_anchors: z.array(z.string()).optional(),
  /**
   * ID or slug of an existing knowledge/adr doc this new doc supersedes
   * (SPEC-043 §Design Decisions D11) — composes `CorpusService.create` THEN
   * `ValidityService.invalidate(supersedes, {supersededBy: newDoc.id, by})` via
   * the shared `createWithSupersedes` orchestration (`flows/supersede-flow.ts`),
   * the SAME function the CLI's `lore create --supersedes` uses. Requires `by`
   * (below) — omitting `by` while `supersedes` is set is a VALIDATION_ERROR.
   */
  supersedes: z.string().optional(),
  /**
   * Actor identity for the invalidate step when `supersedes` is set (SPEC-043
   * §Design Decisions D11) — MCP callers pass this explicitly, same actor-identity
   * precedent as `lore_claim`/`lore_release`/`lore_evidence_add`. Meaningless
   * (ignored) when `supersedes` is omitted.
   */
  by: z.string().optional(),
});

/** Input schema for lore_get. */
export const LoreGetSchema = z.object({
  id_or_slug: z.string(),
  resolve_mdx: z.boolean().optional(),
  include_navigation: z.boolean().optional(),
});

/** Input schema for lore_set. */
export const LoreSetSchema = z.object({
  id_or_slug: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  status: DOC_STATUS_ENUM.optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.unknown()).optional(),
  slug: z.string().optional(),
});

/** Input schema for lore_delete. */
export const LoreDeleteSchema = z.object({
  id_or_slug: z.string(),
  confirm: z.literal(true),
});

/** Input schema for lore_list. */
export const LoreListSchema = z.object({
  type: DOC_TYPE_ENUM.optional(),
  status: DOC_STATUS_ENUM.optional(),
  since: z.string().optional(),
  author: z.string().optional(),
  tag: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().min(0).optional(),
  /**
   * ID or slug of a skill doc — when set, lists the artifacts it governs (its
   * outbound `governs` links) via `CorpusService.listGovernedBy`, ignoring every
   * other filter field (mirrors the CLI `--governed-by` short-circuit). SPEC IoC
   * vertical-slice tech-spec §4.1 P4.
   */
  governed_by: z.string().optional(),
  /** See {@link LoreSearchSchema.include_invalid} — same escape, CLI `--include-invalid` mirror. */
  include_invalid: z.boolean().optional(),
});

/** Input schema for lore_search. */
export const LoreSearchSchema = z.object({
  query: z.string().min(1),
  type: DOC_TYPE_ENUM.optional(),
  limit: z.number().int().positive().optional(),
  /**
   * SPEC-043 §Design Decisions D3 escape — when `true`, invalidated `knowledge`/`adr`
   * docs are included in results (excluded by default). Mirrors the CLI's
   * `--include-invalid` flag.
   */
  include_invalid: z.boolean().optional(),
});

/** Input schema for lore_tree. */
export const LoreTreeSchema = z.object({
  root: z.string().optional(),
  depth: z.number().int().positive().optional(),
});

/** Input schema for lore_link. */
export const LoreLinkSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z
    .enum([
      "parent",
      "implements",
      "informs",
      "supersedes",
      "relates-to",
      "blocks",
      "governs",
    ])
    .optional()
    .default("relates-to"),
});

/** Input schema for lore_log. */
export const LoreLogSchema = z.object({
  id_or_slug: z.string(),
  limit: z.number().int().positive().optional(),
});

/** Input schema for lore_diff. */
export const LoreDiffSchema = z.object({
  id_or_slug: z.string(),
  from: z.number().int().positive().optional(),
  to: z.number().int().positive().optional(),
});

/**
 * Input schema for lore_pending.
 * `include_judgments` (SPEC-034 §6): when true, each returned doc gains a
 * `judgment: ReviewJudgment | null` field (its latest review judgment, or `null` if
 * never reviewed) — the MCP-surface equivalent of the CLI `lore pending` badge column.
 */
export const LorePendingSchema = z.object({
  author: z.string().optional(),
  type: DOC_TYPE_ENUM.optional(),
  include_judgments: z.boolean().optional(),
});

/**
 * Input schema for lore_approve. `calibration_note` (SPEC-033 F1) plumbs through to
 * the shared implicit calibration hook's `note` param (→ `delta_reasons[0]` on the
 * persisted calibration row) — same field the CLI's `--calibration-note` flag feeds.
 */
export const LoreApproveSchema = z.object({
  id_or_slug: z.string(),
  reviewer: z.string().optional(),
  calibration_note: z.string().optional(),
});

/** Input schema for lore_context_bundle. */
export const LoreContextBundleSchema = z.object({
  id_or_slug: z.string(),
  max_depth: z.number().int().positive().optional(),
});

/**
 * Input schema for lore_status (SPEC-045 §Design Decisions D7) — this tool's
 * FIRST input schema; it was registered argless (3-arg form, no schema patch)
 * before this. `check_drift` is OPTIONAL — an omitted/`false` value keeps the
 * response byte-identical to the pre-SPEC-045 shape (REGRESSION, AC-DR-5); when
 * `true`, the response gains a `code_drift` field (`CodeDriftPayload`,
 * `../../flows/drift-flow.js`, the SAME shape CLI `lore status --check-drift
 * --json`'s `data.code_drift` carries).
 */
export const LoreStatusSchema = z.object({
  check_drift: z.boolean().optional(),
});

/** Input schema for lore_batch. */
export const LoreBatchSchema = z.object({
  // reason: op uses z.string() (not enum) so unknown ops reach executeBatchOp's default
  // case and return { ok: false } in results instead of failing the entire batch request.
  operations: z.array(
    z.object({
      op: z.string(),
      args: z.record(z.unknown()),
    }),
  ),
});

/**
 * Oracle kinds accepted by lore_evidence_add (SPEC-025 §4 AC-WF-1). Sourced from
 * `@lore/core`'s `ORACLE_KINDS` SSOT tuple (SPEC-038 §7 D3, AC-ACODE-8) rather
 * than a redeclared literal.
 */
const EVIDENCE_ORACLE_ENUM = z.enum(ORACLE_KINDS);

/** Oracle outcomes accepted by lore_evidence_add. */
const EVIDENCE_RESULT_ENUM = z.enum(["pass", "fail"]);

/**
 * Input schema for lore_claim.
 * `by` is required (not defaulted) — MCP callers pass actor identity explicitly
 * (SPEC-025 §8.3 "MCP callers pass `by` explicitly"), unlike the CLI which falls
 * back to $LORE_ACTOR / OS username.
 * `machine`/`worktree` (SPEC-042 §Design Decisions D2, D9) — BOTH explicit-only
 * on this surface (no ambient auto-capture server-side; the server process's own
 * hostname/cwd would describe the MCP server, not the caller's session). The
 * CLI auto-captures `machine` as `os.hostname()`; MCP callers must pass it
 * themselves if they want it recorded.
 */
export const LoreClaimSchema = z.object({
  id_or_slug: z.string(),
  by: z.string().min(1),
  branch: z.string().optional(),
  machine: z.string().optional(),
  worktree: z.string().optional(),
  steal: z.boolean().optional(),
});

/** Input schema for lore_release. */
export const LoreReleaseSchema = z.object({
  id_or_slug: z.string(),
  by: z.string().min(1),
  reason: z.string().optional(),
  force: z.boolean().optional(),
});

/**
 * Input schema for lore_evidence_add.
 * `ac_ref` — optional pointer to a structured AC id declared on the plan's parent
 * spec (SPEC-038 §4). Passed through untouched; cross-entity validation that it
 * names a *declared* AC lives in `TaskWorkflowService.addEvidence` (SPEC-038 §4 D4),
 * not this schema.
 */
export const LoreEvidenceAddSchema = z.object({
  id_or_slug: z.string(),
  oracle: EVIDENCE_ORACLE_ENUM,
  command: z.string().min(1),
  result: EVIDENCE_RESULT_ENUM,
  output_tail: z.string().max(4000).optional(),
  recorded_by: z.string().min(1),
  ac_ref: z.string().optional(),
});

/** Input schema for lore_ready. */
export const LoreReadySchema = z.object({
  plan_id_or_slug: z.string(),
});

/**
 * Input schema for lore_anchor_set (SPEC-042 §Design Decisions D9; extended by
 * SPEC-045 §Design Decisions D7 to dispatch by target doc type) — resolves
 * `id_or_slug` FIRST, then dispatches:
 *   - task target → declarative REPLACE of `file_anchors` via
 *     `TaskWorkflowService.setAnchors`, read-modify-write on `extra` (preserves
 *     `extra.claim`/`extra.verification_evidence` untouched, AC-S3-5) — NOT
 *     routed through `lore_set`'s wholesale-`extra` replace (D3: that would
 *     silently delete those other services' owned state); a `#`-carrying entry
 *     is rejected loud (byte-identical to the pre-SPEC-045 behavior, naming the
 *     spec code-anchor grammar).
 *   - **spec target → ALSO declarative REPLACE (`DriftCheckService.setCodeAnchors`)
 *     — but this DIVERGES from the CLI's `lore anchor add`/`rm`, which are
 *     INCREMENTAL (union/difference). This tool always OVERWRITES the entire
 *     `code_anchors` array with `anchors` — use the CLI for incremental edits.**
 *     `by` is accepted for schema uniformity but NOT consumed on this branch
 *     (spec anchor writes are attributed to "system", mirroring `AcService`).
 *   - any other type → `VALIDATION_ERROR`, naming "task or spec".
 * `by` is required, same MCP actor-identity precedent as
 * `lore_claim`/`lore_release`/`lore_evidence_add`.
 */
export const LoreAnchorSetSchema = z.object({
  id_or_slug: z.string(),
  anchors: z.array(z.string()),
  by: z.string().min(1),
});

/**
 * Input schema for lore_assess (SPEC-026).
 * `diff_text` — optional pre-acquired diff content (MCP has no subprocess/file-read seam
 * like the CLI's `--diff`/`--diff-file` — callers that want diff context read/generate it
 * themselves and pass the text directly).
 * `ai` — explicit AI opt-in/out. Unlike lore_create's `ai` (default false — MCP callers are
 * always agents), assess has no non-AI mode (SPEC-026 §3 D5: the tool name IS the AI intent).
 * Passing `ai: false` is a contradiction (mirrors CLI `--no-ai` → exit 2) and always errors.
 */
export const LoreAssessSchema = z.object({
  plan_id_or_slug: z.string(),
  diff_text: z.string().optional(),
  ai: z.boolean().optional(),
});

/**
 * Input schema for lore_audit (SPEC-035 §2).
 * Query mode (default): `id_or_slug`/`actor`/`action`/`since`/`limit` map to
 * `AuditFilters` — all optional, combinable. Verify mode (`verify: true`): runs
 * the versions⋈audit completeness oracle instead; `since` overrides the
 * configured `audit.verify_since` watermark for this call only; the other query
 * filters are ignored in this mode.
 */
export const LoreAuditSchema = z.object({
  id_or_slug: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().optional(),
  since: z.string().optional(),
  limit: z.number().int().positive().optional(),
  verify: z.boolean().optional(),
});

/**
 * Input schema for lore_review (SPEC-034 §6).
 * `by` is required (not defaulted) — same MCP precedent as lore_claim/lore_release/
 * lore_evidence_add/lore_ready: MCP callers pass actor identity explicitly, unlike the
 * CLI's $LORE_ACTOR/OS-username fallback. Same orchestration as the CLI's single-doc
 * `lore review <doc>`: deterministic pre-checks first, AI judge only when they all
 * pass/skip. No `ai` override field — the surface-brake check runs unconditionally
 * (mirrors `lore review`'s CLI behavior: a braked surface cannot run review at all).
 */
export const LoreReviewSchema = z.object({
  id_or_slug: z.string(),
  by: z.string().min(1),
});

/**
 * Input schema for lore_staleness_probe (SPEC-044 §Design Decisions D10) — the MCP
 * counterpart to `lore review --staleness`. `by` is required (not defaulted) — same
 * MCP actor-identity precedent as `lore_claim`/`lore_release`/`lore_review`/`lore_verify`;
 * it is ALSO the audit-row actor for every probe this call commissions (D4), load-bearing.
 * `list: true` is a pure read (no provider call, D7/D9) — `id_or_slug` set switches to
 * single-doc mode (bypasses candidate selection filters, still refuses an already-
 * invalidated target); otherwise batch mode, `limit`/`min_age_days` overriding
 * `workflow.staleness.*` config defaults for this invocation only.
 */
export const LoreStalenessProbeSchema = z.object({
  limit: z.number().int().positive().optional(),
  min_age_days: z.number().int().nonnegative().optional(),
  id_or_slug: z.string().optional(),
  list: z.boolean().optional(),
  by: z.string().min(1),
});

/**
 * Input schema for lore_verify (SPEC-039 §2, §4 AC-VRF-10).
 * `ac` — optional subset of declared AC ids to run (omitted = every declared
 * script-mode AC on the plan's parent spec). `task` — optional explicit target
 * task override (wins over claim-based resolution, `resolveTargetTask` in
 * `@lore/core`). `by` is required (not defaulted) — same MCP actor-identity
 * precedent as lore_claim/lore_release/lore_evidence_add/lore_ready: MCP
 * callers pass actor identity explicitly, unlike the CLI's
 * $LORE_ACTOR/OS-username fallback.
 */
export const LoreVerifySchema = z.object({
  plan: z.string(),
  ac: z.array(z.string()).optional(),
  task: z.string().optional(),
  by: z.string().min(1),
});

/**
 * Input schema for lore_feed (IoC vertical-slice tech-spec §4.1/§11, P4 slice;
 * extended by SPEC-041 §3 D5 for the session-resume dispatch).
 * `checkpoint` — e.g. `"spec-create"`, mapped to a produced-type via
 * `CHECKPOINT_PRODUCED_TYPE` (`../../flows/feed-flow.js`). `parent_id_or_slug` —
 * optional intended-parent doc whose MDX-resolved summary is included in the feed
 * when supplied, mirroring the CLI's `--parent`. `plan`/`handoff`/`by` are only
 * meaningful when `checkpoint === "session-resume"` — forwarded verbatim to
 * `SessionService.resume` via `buildResumeFeed`, mirroring the CLI's
 * `--plan`/`--handoff`/`--by`.
 */
export const LoreFeedSchema = z.object({
  checkpoint: z.string(),
  parent_id_or_slug: z.string().optional(),
  plan: z.string().optional(),
  handoff: z.string().optional(),
  by: z.string().optional(),
});

/**
 * Input schema for lore_bootstrap (SPEC-041 §3 D2) — the S1 volatile session
 * pointer-set. `by` is required (not defaulted) — same MCP actor-identity
 * precedent as lore_claim/lore_release/lore_evidence_add/lore_ready/lore_review/
 * lore_verify: MCP callers pass actor identity explicitly, unlike the CLI's
 * $LORE_ACTOR/OS-username fallback. Only filters `my_claims`; every other field
 * is corpus-wide regardless of `by`.
 */
export const LoreBootstrapSchema = z.object({
  by: z.string().min(1),
});

/**
 * Input schema for lore_invalidate (SPEC-043 §Design Decisions D2, D6) — the SOLE MCP
 * write path for a `knowledge`/`adr` doc's bi-temporal `extra.validity`. `by` is
 * required (not defaulted) — same MCP actor-identity precedent as `lore_claim`/
 * `lore_release`/`lore_evidence_add`. `superseded_by` is resolved and PERSISTED as its
 * ULID (never the raw id-or-slug). `undo` clears a prior invalidation instead of
 * setting one; `decision_status_unchanged` surfaces structurally on the response when
 * an ADR's `decision_status: "superseded"` is NOT auto-reverted by `undo` (review U7 —
 * MCP agents never read CLI help text).
 */
export const LoreInvalidateSchema = z.object({
  id_or_slug: z.string(),
  by: z.string().min(1),
  superseded_by: z.string().optional(),
  reason: z.string().max(500).optional(),
  undo: z.boolean().optional(),
});

/**
 * Input schema for lore_handoff (SPEC-041 §3 D3, D6) — reuses `handoffExtraSchema`
 * directly (SSOT; no redeclaration) since the MCP tool's typed fields ARE
 * `extra.handoff` verbatim (D6: "MCP lore_handoff takes the typed fields
 * directly"). `by` is already required by `handoffExtraSchema` (`min(1)`), same
 * MCP actor-identity precedent as the other task-workflow/session tools.
 */
export const LoreHandoffSchema = handoffExtraSchema;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wraps a value as MCP text content.
 * @param value - Any JSON-serializable value
 * @returns MCP CallToolResult with one text content item
 */
function textContent(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Wraps a LoreError as an MCP error response.
 * @param error - Structured LoreError from a service Result
 * @returns MCP CallToolResult with isError=true
 */
function errorContent(error: LoreError) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(error) }],
    isError: true as const,
  };
}

// ─── Tool Registration Helper ─────────────────────────────────────────────────

/**
 * Internal type for accessing McpServer's registered tool registry.
 * Provides access to `inputSchema` field that is patched post-registration.
 * Cast chain: McpServer → unknown → McpToolRegistry (avoids private-field collision).
 * reason: registerToolWithArgs helper needs to write inputSchema after 3-arg registration
 */
type McpToolRegistry = {
  _registeredTools: Record<string, { inputSchema?: unknown }>;
};

/**
 * Registers an MCP tool with typed input validation using the 3-arg form.
 *
 * Strategy:
 *   1. Calls `server.tool(name, desc, handler)` in 3-arg form — TypeScript sees
 *      `handler: (extra: RequestHandlerExtra) => Promise<CallToolResult>`, so it never
 *      evaluates `ShapeOutput<ZodRawShapeCompat>` (the source of the tsc OOM).
 *   2. Immediately patches `_registeredTools[name].inputSchema = schema` so the SDK's
 *      `executeToolHandler` takes the `handler(validatedArgs, extra)` branch at runtime.
 *   3. The handler's first parameter therefore receives the SDK-validated args (typed T),
 *      not `RequestHandlerExtra`. The second arg (extra) is ignored by our handlers.
 *
 * @param server - McpServer instance (accessed via internal _registeredTools for patch)
 * @param name - Tool name (must match MCP tool list)
 * @param desc - Tool description shown to clients
 * @param schema - Zod schema for input validation (used by SDK at call time)
 * @param handler - Typed handler receiving validated args of type T
 *
 * @throws Never — all errors are returned as `{ isError: true }` MCP responses
 *
 * reason: ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA §"Fast Path" Pattern 1 (post-registration patch)
 * fence: do NOT change to 4-arg form or registerTool(inputSchema: z.object(...)) —
 *   those trigger ShapeOutput<ZodRawShapeCompat> which OOMs tsc at 4 GB heap.
 * reason: `schema`'s 3rd generic (Input) is pinned to `unknown` rather than left to
 *   default to `T` — a schema with `.default(...)` fields (e.g. `handoffExtraSchema`,
 *   SPEC-041) has an Input type narrower than its Output type (defaulted fields are
 *   optional pre-parse, required post-parse); `z.ZodType<T>`'s implicit `Input = T`
 *   default rejected such schemas even though `T` (the Output/parsed type, what the
 *   handler actually receives) inferred correctly. Widening Input to `unknown` only
 *   loosens the constraint — every pre-existing call site (Input === Output) still
 *   satisfies it trivially, and `T` inference (driven by the Output position) is unaffected.
 */
function registerToolWithArgs<T>(
  server: McpServer,
  name: string,
  desc: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  handler: (args: T) => Promise<CallToolResult>,
): void {
  // Step 1: 3-arg registration — avoids ZodRawShapeCompat inference entirely
  // The handler is cast to () => Promise<CallToolResult> so TypeScript resolves
  // it as ToolCallback<undefined> (no ShapeOutput computation).
  server.tool(name, desc, handler as unknown as () => Promise<CallToolResult>);

  // Step 2: Post-registration inputSchema patch — restores correct runtime routing.
  // The SDK reads tool.inputSchema at CALL TIME (not registration time), so patching
  // here ensures validateToolInput → handler(validatedArgs, extra) path is taken.
  const registry = server as unknown as McpToolRegistry;
  const registered = registry._registeredTools[name];
  if (registered) {
    registered.inputSchema = schema;
  }
}

// ─── SPEC-034 §4 review orchestration (lore_review) ─────────────────────────

/**
 * Load `lore.tree.yaml` from cwd if present — the MCP-surface equivalent of the CLI
 * `lore review`'s blueprint loader. Returns `{ok: true, blueprint: undefined}` when the
 * file is absent (the tree_position check degrades to "skipped", never a silent pass);
 * a PRESENT-but-invalid blueprint is a config error, returned as an err() so the tool
 * handler can respond with `isError: true` (an MCP tool must never call process.exit).
 */
function loadBlueprintForMcp(): Result<TreeBlueprint | undefined, LoreError> {
  const blueprintPath = join(process.cwd(), "lore.tree.yaml");
  if (!existsSync(blueprintPath)) return { ok: true, value: undefined };

  const raw = readFileSync(blueprintPath, "utf8");
  const parsed = parseTreeBlueprint(raw);
  if (!parsed.ok) return parsed;
  return { ok: true, value: parsed.value };
}

/**
 * Review one document end-to-end for the lore_review MCP tool — deliberately mirrors
 * (rather than imports) the CLI's `adapters/cli/commands/review.ts::reviewOneDoc`: each
 * adapter is its own thin orchestration pipe over the same services (established
 * precedent — compare `assess.ts` vs this file's `lore_assess` handler, which duplicate
 * the same zero-task-gate + persist sequence rather than sharing a helper module).
 */
async function reviewDocViaMcp(
  app: App,
  idOrSlug: string,
  blueprint: TreeBlueprint | undefined,
): Promise<Result<ReviewJudgment, LoreError>> {
  const bundleResult = await app.corpusService.getReviewBundle(idOrSlug, blueprint);
  if (!bundleResult.ok) return bundleResult;
  const bundle = bundleResult.value;

  const checks = runDeterministicChecks(bundle);
  const failedChecks = checks.filter((c) => c.outcome === "fail");

  if (failedChecks.length > 0) {
    const newJudgment: NewReviewJudgment = {
      doc_id: bundle.doc.id,
      doc_version: bundle.doc.version,
      decision: "reject",
      confidence: 1.0,
      reasons: failedChecks.map((c) => ({
        dimension: c.check,
        finding: c.detail ?? `${c.check} check failed`,
      })),
      checks,
      blocking_questions: [],
      judge: { provider: "deterministic-checks", model: "n/a", prompt_version: REVIEW_PROMPT_VERSION },
    };
    return app.judgmentService.record(newJudgment);
  }

  const judgeResult = await app.aiProviderService.judgeDoc(bundle, checks, { source: app.callerSurface });
  if (!judgeResult.ok) return judgeResult;

  return app.judgmentService.record(judgeResult.value);
}

// ─── Tool Registrations ──────────────────────────────────────────────────────

/**
 * Registers all 30 lore_* MCP tools on the given server (16 original + 4 SPEC-025
 * task-workflow tools: lore_claim, lore_release, lore_evidence_add, lore_ready;
 * + lore_assess (SPEC-026); + lore_audit (SPEC-035); + lore_review (SPEC-034);
 * + lore_verify (SPEC-039); + lore_feed (IoC vertical-slice tech-spec §4.1/§11 P4);
 * + lore_bootstrap, lore_handoff (SPEC-041 §3 D2, D3, D6) — lore_feed additionally
 * gains a session-resume dispatch branch (SPEC-041 §3 D5)
 * + lore_anchor_set (SPEC-042 §Design Decisions D9) — lore_claim gains machine/
 * worktree, lore_create gains file_anchors
 * + lore_invalidate (SPEC-043 §Design Decisions D6) — lore_get gains computed
 * validity_state, lore_create gains supersedes/by, lore_search/lore_list gain
 * include_invalid
 * + lore_staleness_probe (SPEC-044 §Design Decisions D10) — lore_status/lore_bootstrap
 * gain computed open_stale_candidates (D14)
 * + lore_status gains `check_drift?: boolean` — migrated OFF the argless 3-arg
 * registration form onto `registerToolWithArgs` (its FIRST input schema; argless
 * calls stay byte-identical, REGRESSION); lore_anchor_set gains spec-target
 * declarative REPLACE dispatch; lore_bootstrap gains computed `code_anchor_specs`
 * (SPEC-045 §Design Decisions D7)).
 *
 * Tools with input use `registerToolWithArgs` (avoids ZodRawShapeCompat type bomb).
 * Tools without input (`lore_schema`) use plain `server.tool(name, desc, cb)`.
 *
 * @param server - The McpServer instance to register tools on
 * @param app - The composition root providing access to all services
 */
export function registerTools(server: McpServer, app: App): void {
  const { corpusService, versionService, reviewService, outlineService, taskWorkflowService, auditService, judgmentService } = app;

  // lore_create
  registerToolWithArgs(server, "lore_create", "Create a new document in the Lore corpus", LoreCreateSchema, async (args) => {
    // SPEC-024 AC-NOAI-4/5: ai=false (default) → create with empty/provided content (no AI call).
    // ai=true → invoke AIProviderService to generate content before creating the doc.
    let resolvedContent = args.content;
    if (resolvedContent === undefined && args.ai) {
      // reason: MCP surface is always agent; explicit ai:true is the caller's opt-in.
      // Pass surface + source to AIProviderService for telemetry (AC-NOAI-8).
      const aiResult = await app.aiProviderService.generate({
        doc_type: args.type,
        title: args.title,
        caller_surface: "mcp",
        ai_default_source: "explicit_arg",
      });
      if (!aiResult.ok) return errorContent(aiResult.error);
      resolvedContent = aiResult.value.content;
    }

    // Strip the `ai`/`file_anchors`/`supersedes`/`by` fields before passing to
    // corpusService.create — none is a corpus field; file_anchors (SPEC-042 D9) is
    // folded into `extra` here so CorpusService._createImpl's single validation gate
    // sees it the same way it would from a raw extra.file_anchors payload.
    const { ai: _ai, file_anchors: fileAnchors, supersedes, by, ...createInput } = args;
    const mergedExtra =
      fileAnchors !== undefined
        ? { ...(createInput.extra ?? {}), file_anchors: fileAnchors }
        : createInput.extra;
    const resolvedCreateInput = {
      ...createInput,
      content: resolvedContent,
      ...(mergedExtra !== undefined ? { extra: mergedExtra } : {}),
    };

    // SPEC-043 §Design Decisions D11 — `supersedes` composes create() THEN
    // ValidityService.invalidate() via the SAME shared orchestration the CLI's
    // `lore create --supersedes` uses (flows/supersede-flow.ts) — never a second,
    // divergent implementation of the half-failure handling.
    if (supersedes !== undefined) {
      if (by === undefined || by.trim() === "") {
        return errorContent({
          code: "VALIDATION_ERROR",
          field: "by",
          message: "`by` is required when `supersedes` is set.",
          value: by,
        });
      }
      if (app.validityService === undefined) {
        return errorContent({ code: "STORE_ERROR", message: "Internal error: ValidityService not wired on App" });
      }
      const orchResult = await createWithSupersedes(
        {
          create: corpusService.create.bind(corpusService),
          invalidate: app.validityService.invalidate.bind(app.validityService),
        },
        resolvedCreateInput,
        supersedes,
        by,
      );
      if (!orchResult.ok) return errorContent(orchResult.error);
      const { id, slug, type, status, version } = orchResult.value.doc;
      const payload: Record<string, unknown> = { id, slug, type, status, version };
      // Loud orphan (D11, never silent) — create succeeded but invalidate() failed.
      if (orchResult.value.supersedeError !== undefined) {
        payload["supersede_error"] = orchResult.value.supersedeError;
        payload["supersede_repair_command"] = renderSupersedeRepairMessage(supersedes, slug);
      }
      return textContent(payload);
    }

    const result = await corpusService.create(resolvedCreateInput);
    if (!result.ok) return errorContent(result.error);
    const { id, slug, type, status, version } = result.value;
    return textContent({ id, slug, type, status, version });
  });

  // lore_get
  registerToolWithArgs(server, "lore_get", "Get a document by ID or slug, with optional navigation and MDX resolution", LoreGetSchema, async (args) => {
    const { id_or_slug, resolve_mdx, include_navigation } = args;
    // reason: exactOptionalPropertyTypes — only pass resolve_mdx when defined to avoid
    // assigning `undefined` to `GetOpts.resolve_mdx?: boolean` (which excludes undefined)
    const opts = resolve_mdx !== undefined ? { resolve_mdx } : {};
    const result = await corpusService.get(id_or_slug, opts);
    if (!result.ok) return errorContent(result.error);

    const payload: Record<string, unknown> = { doc: result.value.doc };
    if (include_navigation !== false) {
      payload["navigation"] = result.value.navigation;
    }
    if (resolve_mdx) {
      const resolveResult = await outlineService.resolve(result.value.doc);
      if (resolveResult.ok) {
        payload["resolved_components"] = resolveResult.value.resolvedComponents;
      }
    }
    // SPEC-043 §Design Decisions D6 — computed validity_state; MCP agents parse JSON,
    // never markdown banners (review U3). `lore_get` is the one MCP surface every
    // agent actually reads, so this is the load-bearing wiring site.
    payload["validity_state"] = await computeValidityState(app, result.value.doc);
    return textContent(payload);
  });

  // lore_set
  registerToolWithArgs(server, "lore_set", "Patch (update) an existing document", LoreSetSchema, async (args) => {
    const { id_or_slug, ...patch } = args;
    const result = await corpusService.set(id_or_slug, patch);
    if (!result.ok) return errorContent(result.error);
    return textContent({ doc: result.value, version: result.value.version });
  });

  // lore_delete
  registerToolWithArgs(server, "lore_delete", "Soft-delete a document (requires confirm: true)", LoreDeleteSchema, async (args) => {
    const result = await corpusService.delete(args.id_or_slug, args.confirm);
    if (!result.ok) return errorContent(result.error);
    return textContent(result.value);
  });

  // lore_list
  registerToolWithArgs(server, "lore_list", "List documents matching optional filters", LoreListSchema, async (args) => {
    const { type, status, since, author, tag, limit, offset, governed_by, include_invalid } = args;

    // governed_by is a link-table reverse query, not a StoreFilters column predicate —
    // short-circuits to its own service method, same as the CLI's --governed-by branch.
    if (governed_by !== undefined) {
      const governedResult = await corpusService.listGovernedBy(governed_by);
      if (!governedResult.ok) return errorContent(governedResult.error);
      const docs = limit !== undefined
        ? governedResult.value.docs.slice(offset ?? 0, (offset ?? 0) + limit)
        : governedResult.value.docs;
      return textContent({ docs, total: governedResult.value.total });
    }

    const filters = {
      ...(type !== undefined ? { type } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(author !== undefined ? { created_by: author } : {}),
      ...(tag !== undefined ? { tags: [tag] } : {}),
      // SPEC-043 D3 — mirrors the CLI's --include-invalid flag.
      ...(include_invalid === true ? { include_invalid: true } : {}),
    };
    const result = await corpusService.list(filters);
    if (!result.ok) return errorContent(result.error);
    const docs = limit !== undefined
      ? result.value.docs.slice(offset ?? 0, (offset ?? 0) + limit)
      : result.value.docs;
    return textContent({ docs, total: result.value.total });
  });

  // lore_search
  registerToolWithArgs(server, "lore_search", "Full-text search across the corpus", LoreSearchSchema, async (args) => {
    const { query, type, limit, include_invalid } = args;
    const filters = {
      ...(type !== undefined ? { type } : {}),
      // SPEC-043 D3 — mirrors the CLI's --include-invalid flag.
      ...(include_invalid === true ? { include_invalid: true } : {}),
    };
    const result = await corpusService.search(query, filters);
    if (!result.ok) return errorContent(result.error);
    const results = limit !== undefined ? result.value.results.slice(0, limit) : result.value.results;
    return textContent({ results });
  });

  // lore_tree
  registerToolWithArgs(server, "lore_tree", "Get the document tree from a root (or first PRD)", LoreTreeSchema, async (args) => {
    // reason: exactOptionalPropertyTypes — only pass depth when defined
    const opts = args.depth !== undefined ? { depth: args.depth } : {};
    const result = await corpusService.tree(args.root, opts);
    if (!result.ok) return errorContent(result.error);
    return textContent({ tree: result.value });
  });

  // lore_link
  registerToolWithArgs(server, "lore_link", "Create a link between two documents", LoreLinkSchema, async (args) => {
    // reason: args.type is declared `optional().default()` — TypeScript may widen to include
    // undefined due to ZodDefault inference quirk; the ?? fallback ensures a valid LinkType.
    const linkType = (args.type ?? "relates-to") as LinkType;
    const result = await corpusService.link(args.from, args.to, linkType);
    if (!result.ok) return errorContent(result.error);
    return textContent({ link: result.value });
  });

  // lore_log
  registerToolWithArgs(server, "lore_log", "Get version history for a document", LoreLogSchema, async (args) => {
    // reason: exactOptionalPropertyTypes — only pass limit when defined
    const opts = args.limit !== undefined ? { limit: args.limit } : {};
    const result = await versionService.log(args.id_or_slug, opts);
    if (!result.ok) return errorContent(result.error);
    return textContent({ entries: result.value });
  });

  // lore_diff
  registerToolWithArgs(server, "lore_diff", "Compute a diff between two versions of a document", LoreDiffSchema, async (args) => {
    // reason: exactOptionalPropertyTypes — only pass from/to when defined
    const opts = {
      ...(args.from !== undefined ? { from: args.from } : {}),
      ...(args.to !== undefined ? { to: args.to } : {}),
    };
    const result = await versionService.diff(args.id_or_slug, opts);
    if (!result.ok) return errorContent(result.error);
    return textContent({ diff: result.value });
  });

  // lore_pending
  registerToolWithArgs(server, "lore_pending", "List documents pending review (status=draft)", LorePendingSchema, async (args) => {
    // reason: exactOptionalPropertyTypes — only pass author/type when defined
    const filters = {
      ...(args.author !== undefined ? { author: args.author } : {}),
      ...(args.type !== undefined ? { type: args.type } : {}),
    };
    const result = await reviewService.pending(filters);
    if (!result.ok) return errorContent(result.error);

    // SPEC-034 §6: include_judgments enriches each doc with its latest review judgment
    // (or null) — the MCP-surface equivalent of the CLI `lore pending` badge column.
    if (args.include_judgments !== true) {
      return textContent({ docs: result.value });
    }

    const docsWithJudgments: unknown[] = [];
    for (const doc of result.value) {
      const judgmentResult = await judgmentService.latestFor(doc.id);
      if (!judgmentResult.ok) return errorContent(judgmentResult.error);
      docsWithJudgments.push({ ...doc, judgment: judgmentResult.value });
    }
    return textContent({ docs: docsWithJudgments });
  });

  // lore_approve
  registerToolWithArgs(server, "lore_approve", "Approve a document, transitioning it from draft to approved", LoreApproveSchema, async (args) => {
    // reason: exactOptionalPropertyTypes — only pass reviewer when defined
    const opts = args.reviewer !== undefined ? { reviewer: args.reviewer } : {};
    const result = await reviewService.approve(args.id_or_slug, opts);
    if (!result.ok) return errorContent(result.error);

    // reason: SPEC-033 F1 — MCP's lore_approve is an adjudication tool, same as CLI
    // approve/HTTP dashboard approve; it MUST feed the same calibration loop, not a
    // second-class copy. Mirrors `reviewer ?? "system"` — the exact default
    // ReviewService.approve itself falls back to when `opts.reviewer` is omitted
    // (review-service.ts) — so the hook's `actor` always matches who the approve
    // was actually recorded under. actedOnVersion = result.value.version - 1 since
    // approve() bumps the version (identical to CLI approve.ts / HTTP dashboard
    // handleDashboardApprove's computation).
    const reviewer = args.reviewer ?? "system";
    await runCalibrationHook(
      { judgmentService, telemetry: app.telemetry },
      {
        updatedDoc: result.value,
        actedOnVersion: result.value.version - 1,
        humanAction: "approve",
        actor: reviewer,
        ...(args.calibration_note !== undefined ? { note: args.calibration_note } : {}),
      },
    );

    return textContent({ doc: result.value });
  });

  // lore_schema — no input parameters; 3-arg form (correct for 0-arg tools)
  // reason: static info tool, no arguments needed
  server.tool(
    "lore_schema",
    "Return static corpus schema information (doc types, link types, required fields)",
    async () => {
      return textContent(CORPUS_SCHEMA_INFO);
    },
  );

  // lore_context_bundle
  registerToolWithArgs(server, "lore_context_bundle", "Get a document plus its parent, linked specs, related ADRs, and active plans", LoreContextBundleSchema, async (args) => {
    const targetResult = await corpusService.get(args.id_or_slug);
    if (!targetResult.ok) return errorContent(targetResult.error);

    const { doc, navigation } = targetResult.value;
    const linkedSpecs = navigation.related.filter((r) => r.type === "spec");
    const relatedAdrs = navigation.related.filter((r) => r.type === "adr");
    const plansResult = await corpusService.list({ type: "plan", status: "active" });
    const activePlans = plansResult.ok ? plansResult.value.docs : [];

    return textContent({ target: doc, linked_specs: linkedSpecs, related_adrs: relatedAdrs, active_plans: activePlans });
  });

  // lore_batch
  registerToolWithArgs(server, "lore_batch", "Execute multiple operations in sequence", LoreBatchSchema, async (args) => {
    const results: unknown[] = [];
    for (const operation of args.operations) {
      const opResult = await executeBatchOp(operation.op, operation.args, app);
      results.push(opResult);
    }
    return textContent({ results });
  });

  // lore_status (SPEC-045 §Design Decisions D7 — migrated OFF the argless 3-arg
  // form onto registerToolWithArgs; this is the tool's FIRST input schema. An
  // argless call `{}` (check_drift omitted/false) returns the byte-identical
  // pre-SPEC-045 shape — REGRESSION, AC-DR-5.)
  registerToolWithArgs(
    server,
    "lore_status",
    "Get corpus statistics (total docs, by type, by status); check_drift:true additionally verifies spec-declared code_anchors against the working tree (SPEC-045)",
    LoreStatusSchema,
    async (args) => {
      const result = await corpusService.status();
      if (!result.ok) return errorContent(result.error);
      // SPEC-044 §Design Decisions D14 — open_stale_candidates, computed by the SAME
      // query lore_staleness_probe's list mode uses (one derivation site,
      // flows/staleness-flow.ts::listFreshStalenessEscalates).
      const staleListResult = await listFreshStalenessEscalates(buildStalenessFlowDeps(app));
      if (!staleListResult.ok) return errorContent(staleListResult.error);

      const payload: Record<string, unknown> = {
        ...result.value,
        open_stale_candidates: staleListResult.value.length,
      };

      if (args.check_drift === true) {
        if (app.driftCheckService === undefined) {
          return errorContent({ code: "STORE_ERROR", message: "Internal error: DriftCheckService not wired on App" });
        }
        // reason: SPEC-045 §Design Decisions D7 — App carries no parsed LoreConfig
        // (same limitation lore_staleness_probe's limit/min_age_days fallback
        // documents), so `workflow.drift.enabled` cannot be honored from this
        // surface; MCP always runs the check (enabled) when check_drift is true.
        const deps = buildDriftFlowDeps(app, app.driftCheckService);
        const probe = buildRealFsProbe(process.cwd());
        const driftResult = await runDrift(deps, probe);
        if (!driftResult.ok) return errorContent(driftResult.error);
        payload["code_drift"] = driftResult.value;
      }

      return textContent(payload);
    },
  );

  // ── SPEC-025 task workflow tools ──────────────────────────────────────────

  // lore_claim
  registerToolWithArgs(server, "lore_claim", "Acquire an advisory execution lease on a task", LoreClaimSchema, async (args) => {
    const result = await taskWorkflowService.claim(args.id_or_slug, {
      by: args.by,
      ...(args.branch !== undefined ? { branch: args.branch } : {}),
      ...(args.machine !== undefined ? { machine: args.machine } : {}),
      ...(args.worktree !== undefined ? { worktree: args.worktree } : {}),
      steal: args.steal === true,
      // reason: MCP callers are always agents (SPEC-024) — the caller-surface discriminator
      // for AC-WF-11 telemetry is hardcoded here rather than threaded through args.
      source: "mcp",
    });
    if (!result.ok) return errorContent(result.error);
    return textContent({ doc: result.value });
  });

  // lore_release
  registerToolWithArgs(server, "lore_release", "Clear the advisory execution lease on a task", LoreReleaseSchema, async (args) => {
    const result = await taskWorkflowService.release(args.id_or_slug, {
      by: args.by,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      force: args.force === true,
      source: "mcp",
    });
    if (!result.ok) return errorContent(result.error);
    return textContent({ doc: result.value });
  });

  // lore_evidence_add
  registerToolWithArgs(server, "lore_evidence_add", "Append an oracle verification record to a task", LoreEvidenceAddSchema, async (args) => {
    const result = await taskWorkflowService.addEvidence(args.id_or_slug, {
      oracle: args.oracle,
      command: args.command,
      result: args.result,
      recorded_by: args.recorded_by,
      source: "mcp",
      ...(args.output_tail !== undefined ? { output_tail: args.output_tail } : {}),
      ...(args.ac_ref !== undefined ? { ac_ref: args.ac_ref } : {}),
    });
    if (!result.ok) return errorContent(result.error);
    return textContent({ doc: result.value });
  });

  // lore_ready
  registerToolWithArgs(server, "lore_ready", "Computed readiness report over a plan's tasks (never stored)", LoreReadySchema, async (args) => {
    const result = await taskWorkflowService.ready(args.plan_id_or_slug);
    if (!result.ok) return errorContent(result.error);
    return textContent({ ready: result.value });
  });

  // lore_anchor_set (SPEC-042 §Design Decisions D9; extended by SPEC-045
  // §Design Decisions D7 to resolve-then-dispatch by target doc type — see
  // LoreAnchorSetSchema's JSDoc for the task-vs-spec REPLACE-semantics note)
  registerToolWithArgs(
    server,
    "lore_anchor_set",
    "Declaratively REPLACE a task's file_anchors or a spec's code_anchors (read-modify-write — preserves claim/evidence on a task target, SPEC-042 D9; on a spec target this OVERWRITES the full code_anchors array — CLI `lore anchor add`/`rm` are incremental instead, SPEC-045 D7)",
    LoreAnchorSetSchema,
    async (args) => {
      const targetResult = await corpusService.get(args.id_or_slug);
      if (!targetResult.ok) return errorContent(targetResult.error);
      const target = targetResult.value.doc;

      if (target.type === "task") {
        const result = await taskWorkflowService.setAnchors(args.id_or_slug, args.anchors, {
          by: args.by,
          source: "mcp",
        });
        if (!result.ok) return errorContent(result.error);
        return textContent({ doc: result.value });
      }

      if (target.type === "spec") {
        if (app.driftCheckService === undefined) {
          return errorContent({ code: "STORE_ERROR", message: "Internal error: DriftCheckService not wired on App" });
        }
        const result = await app.driftCheckService.setCodeAnchors(args.id_or_slug, args.anchors);
        if (!result.ok) return errorContent(result.error);
        return textContent({ anchors: result.value });
      }

      return errorContent({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a task or spec document; got type '${target.type}'`,
        value: target.type,
      });
    },
  );

  // ── SPEC-026: AI plan-outcome assessment ──────────────────────────────────

  // lore_assess
  registerToolWithArgs(
    server,
    "lore_assess",
    "AI plan-outcome assessment (LLM-as-judge) — judges a plan's completion against its spec's ACs and its tasks' evidence trails, persisting an auditable knowledge doc linked to the plan",
    LoreAssessSchema,
    async (args) => {
      const bundleResult = await corpusService.getPlanBundle(args.plan_id_or_slug);
      if (!bundleResult.ok) return errorContent(bundleResult.error);
      const bundle = bundleResult.value;

      // AC-ASSESS-8: zero child tasks → VALIDATION_ERROR before any AI call.
      if (bundle.tasks.length === 0) {
        return errorContent({
          code: "VALIDATION_ERROR",
          field: "tasks",
          message: `Plan '${bundle.plan.slug}' has zero child tasks — nothing to assess.`,
        });
      }

      // reason: args.ai === false is a contradiction — assess has no non-AI mode
      // (SPEC-026 §3 D5), mirroring the CLI's `--no-ai` → exit 2.
      if (args.ai === false) {
        return errorContent({
          code: "AI_PROVIDER_ERROR",
          message: "lore_assess requires AI; ai: false is a contradiction. Omit the field or pass ai: true.",
        });
      }

      // SPEC-026 §3 D5: only an EXPLICIT config override braked (not the mcp surface's
      // built-in AI-off default) requires the caller to pass ai: true.
      const explicitAi = args.ai === true ? true : undefined;
      const resolved = app.resolveAiDefault(explicitAi);
      if (explicitAi === undefined && isAssessAiBraked(resolved)) {
        return errorContent({
          code: "AI_PROVIDER_ERROR",
          message: "AI is disabled for the mcp surface by config.ai.default_per_surface.mcp. Pass ai: true to override.",
        });
      }

      const assessResult = await app.aiProviderService.assessPlan(bundle, {
        ...(args.diff_text !== undefined ? { diffText: args.diff_text } : {}),
        source: app.callerSurface,
      });
      if (!assessResult.ok) return errorContent(assessResult.error);

      const createResult = await corpusService.create({
        type: "knowledge",
        title: `Assessment: ${bundle.plan.title} (${new Date().toISOString().slice(0, 10)})`,
        parent_id: bundle.plan.id,
        extra: { sub_type: "assessment", assessment: assessResult.value },
        content: renderAssessmentContent(assessResult.value),
      });
      if (!createResult.ok) return errorContent(createResult.error);

      const linkResult = await corpusService.link(createResult.value.id, bundle.plan.id, "informs");
      if (!linkResult.ok) return errorContent(linkResult.error);

      // reason: SPEC-040 §T3 D3 — `summary` is additive to the pre-existing
      // `assessment`/`result` envelope fields (which already carry the full typed
      // AssessmentResult verbatim); it gives an agent reading MCP text content a
      // scannable digest without re-deriving one from the nested JSON.
      return textContent({
        assessment: createResult.value,
        result: assessResult.value,
        summary: buildAssessSummaryText(assessResult.value),
      });
    },
  );

  // ── SPEC-035: audit read/verify surface ───────────────────────────────────

  // lore_audit
  registerToolWithArgs(
    server,
    "lore_audit",
    "Query the audit trail, or verify its completeness against version history (versions⋈audit reconcile)",
    LoreAuditSchema,
    async (args) => {
      if (args.verify === true) {
        const result = await auditService.verify(args.since !== undefined ? { since: args.since } : undefined);
        if (!result.ok) return errorContent(result.error);
        return textContent(result.value);
      }

      let docId: string | undefined;
      if (args.id_or_slug !== undefined) {
        const resolveResult = await corpusService.resolve(args.id_or_slug);
        if (!resolveResult.ok) return errorContent(resolveResult.error);
        docId = resolveResult.value;
      }

      const result = await auditService.query({
        ...(docId !== undefined ? { doc_id: docId } : {}),
        ...(args.actor !== undefined ? { actor: args.actor } : {}),
        ...(args.action !== undefined ? { action: args.action } : {}),
        ...(args.since !== undefined ? { since: args.since } : {}),
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
      });
      if (!result.ok) return errorContent(result.error);
      return textContent({ entries: result.value });
    },
  );

  // ── SPEC-034: structured review judgment ──────────────────────────────────

  // lore_review
  registerToolWithArgs(
    server,
    "lore_review",
    "Structured AI review judgment — deterministic pre-checks, then an LLM judge, recorded as a review judgment",
    LoreReviewSchema,
    async (args) => {
      // reason: same unconditional surface-brake check as the CLI (`lore review`,
      // SPEC-034 §4 mirrors assess §3 D5) — a braked surface cannot run review at all,
      // even for a doc whose deterministic checks would short-circuit before any AI call.
      // No `ai` override field on this tool (SPEC-034 §6) — only an explicit config
      // override can brake it, and there is no MCP-level bypass for that override.
      const resolved = app.resolveAiDefault(undefined);
      if (isAssessAiBraked(resolved)) {
        return errorContent({
          code: "AI_PROVIDER_ERROR",
          message: "AI is disabled for the mcp surface by config.ai.default_per_surface. lore_review has no override for this.",
        });
      }

      const blueprintResult = loadBlueprintForMcp();
      if (!blueprintResult.ok) return errorContent(blueprintResult.error);

      const reviewResult = await reviewDocViaMcp(app, args.id_or_slug, blueprintResult.value);
      if (!reviewResult.ok) return errorContent(reviewResult.error);

      return textContent({ requested_by: args.by, judgment: reviewResult.value });
    },
  );

  // ── SPEC-044: staleness probing ───────────────────────────────────────────

  // lore_staleness_probe
  registerToolWithArgs(
    server,
    "lore_staleness_probe",
    "Probe high-value knowledge/adr documents for silent staleness (escalation only, never auto-invalidation) — batch (priority-sorted candidates), single-doc, or a read-only fresh-escalate list (list:true, no AI call)",
    LoreStalenessProbeSchema,
    async (args) => {
      const flowDeps = buildStalenessFlowDeps(app);
      const isListMode = args.list === true;

      // ── list mode: read-only, NO provider call (D7/D9) ──────────────────
      if (isListMode) {
        const listResult = await listFreshStalenessEscalates(flowDeps);
        if (!listResult.ok) return errorContent(listResult.error);
        return textContent(buildStalenessListJsonPayload(listResult.value));
      }

      // reason: same unconditional surface-brake check as lore_review (SPEC-034 §4
      // mirrors assess §3 D5, D7) — a braked surface cannot probe at all. Exempted
      // above for list mode (no provider call).
      const resolved = app.resolveAiDefault(undefined);
      if (isAssessAiBraked(resolved)) {
        return errorContent({
          code: "AI_PROVIDER_ERROR",
          message:
            "AI is disabled for the mcp surface by config.ai.default_per_surface. lore_staleness_probe has no override for this.",
        });
      }

      if (app.stalenessProbeService === undefined) {
        return errorContent({ code: "STORE_ERROR", message: "Internal error: StalenessProbeService not wired on App" });
      }

      // ── single-doc mode ───────────────────────────────────────────────────
      if (args.id_or_slug !== undefined) {
        const outcomeResult = await app.stalenessProbeService.probeOne(args.id_or_slug, {
          by: args.by,
          source: app.callerSurface,
        });
        if (!outcomeResult.ok) return errorContent(outcomeResult.error);
        const payload = await buildStalenessSingleJsonPayload(flowDeps, outcomeResult.value);
        return textContent(payload);
      }

      // ── batch mode ─────────────────────────────────────────────────────────
      // reason: MCP's `App` does not carry the parsed LoreConfig (unlike the CLI's
      // loadLoreApp(), which returns {app, config} separately) — these literals mirror
      // WorkflowConfigSchema's own staleness.default_limit/min_age_days DEFAULTS
      // (packages/core/src/config.ts), the same "hardcoded default mirroring the schema"
      // precedent AIProviderService's own stalenessBudgets constructor default uses.
      // Explicit args.limit/args.min_age_days always override a corpus's real config
      // either way — only the OMITTED case falls back to these literals instead of the
      // corpus-configured default.
      const DEFAULT_STALENESS_LIMIT = 5;
      const DEFAULT_STALENESS_MIN_AGE_DAYS = 14;
      const batchResult = await app.stalenessProbeService.probeBatch({
        by: args.by,
        limit: args.limit ?? DEFAULT_STALENESS_LIMIT,
        minAgeDays: args.min_age_days ?? DEFAULT_STALENESS_MIN_AGE_DAYS,
        source: app.callerSurface,
      });
      if (!batchResult.ok) return errorContent(batchResult.error);

      const payload = await buildStalenessBatchJsonPayload(flowDeps, batchResult.value);
      return textContent(payload);
    },
  );

  // ── SPEC-039: trusted runner ──────────────────────────────────────────────

  // lore_verify
  registerToolWithArgs(
    server,
    "lore_verify",
    "Trusted runner — actually execute a plan's declared script-mode acceptance criteria and record the outcome as runner-attested evidence (result derived from the command's exit code, not a caller assertion)",
    LoreVerifySchema,
    async (args) => {
      // reason: App.verifyRunnerService is typed optional only to keep pre-existing
      // hand-built App test stubs (outside this task's file anchors) compiling — see
      // its JSDoc in app.ts. Every production App (createApp) always wires it.
      if (app.verifyRunnerService === undefined) {
        return errorContent({
          code: "STORE_ERROR",
          message: "Internal error: VerifyRunnerService not wired on App",
        });
      }

      const result = await app.verifyRunnerService.verifyPlan(args.plan, {
        ...(args.ac !== undefined ? { acIds: args.ac } : {}),
        ...(args.task !== undefined ? { explicitTaskIdOrSlug: args.task } : {}),
        by: args.by,
        nowIso: new Date().toISOString(),
      });
      if (!result.ok) return errorContent(result.error);

      return textContent(result.value);
    },
  );

  // ── IoC vertical-slice tech-spec §4.1/§11 P4: feed-before-produce PULL ────
  // (extended by SPEC-041 §3 D5 for the session-resume dispatch)

  // lore_feed
  registerToolWithArgs(
    server,
    "lore_feed",
    'Feed-before-produce PULL: return the governing skill\'s rule slice for a checkpoint ahead of writing (advisory only, never a gate — always succeeds); checkpoint "session-resume" dispatches to SPEC-041 S2 resume instead (can fail on an unresolvable plan/handoff target)',
    LoreFeedSchema,
    async (args) => {
      if (args.checkpoint === SESSION_RESUME_CHECKPOINT) {
        const result = await buildResumeFeed(app, {
          ...(args.plan !== undefined ? { plan: args.plan } : {}),
          ...(args.handoff !== undefined ? { handoff: args.handoff } : {}),
          ...(args.by !== undefined ? { by: args.by } : {}),
        });
        if (!result.ok) return errorContent(result.error);
        return textContent(result.value);
      }

      const outcome = await buildFeed(app, args.checkpoint, args.parent_id_or_slug);
      return textContent(outcome);
    },
  );

  // ── SPEC-041 §3 D2, D3, D6: session bootstrap + lossless handoff ──────────

  // lore_bootstrap
  registerToolWithArgs(
    server,
    "lore_bootstrap",
    "SPEC-041 S1 volatile session pointer-set (active plans, pending reviews, your claims, armed gates, latest handoffs, resume hint) — read-only, zero store mutations",
    LoreBootstrapSchema,
    async (args) => {
      if (app.sessionService === undefined) {
        return errorContent({ code: "STORE_ERROR", message: "Internal error: SessionService not wired on App" });
      }
      const result = await app.sessionService.bootstrap(args.by);
      if (!result.ok) return errorContent(result.error);
      // SPEC-044 §Design Decisions D14 — open_stale_candidates, computed by the SAME
      // query lore_staleness_probe's list mode uses (one derivation site), spliced onto
      // the report's corpus summary here rather than inside SessionService.bootstrap (a
      // service file outside this task's file anchors).
      const staleListResult = await listFreshStalenessEscalates(buildStalenessFlowDeps(app));
      if (!staleListResult.ok) return errorContent(staleListResult.error);
      // SPEC-045 §Design Decisions D5, D7 — store-only "declared code_anchors" count,
      // ZERO filesystem probing (same shared helper `lore status`'s plain-text branch
      // uses, flows/drift-flow.ts::countArmedSpecs) — never fs-probing bootstrap.
      const armedSpecsResult = await countArmedSpecs(buildListSpecs(app));
      if (!armedSpecsResult.ok) return errorContent(armedSpecsResult.error);
      const report = {
        ...result.value,
        corpus: {
          ...result.value.corpus,
          open_stale_candidates: staleListResult.value.length,
          code_anchor_specs: armedSpecsResult.value,
        },
      };
      return textContent({ report });
    },
  );

  // lore_handoff
  registerToolWithArgs(
    server,
    "lore_handoff",
    "Write a lossless session-continuity handoff document (knowledge/handoff) — the sole write path besides `lore handoff` (writer-identity guard, SPEC-041 §3 D4)",
    LoreHandoffSchema,
    async (args) => {
      if (app.sessionService === undefined) {
        return errorContent({ code: "STORE_ERROR", message: "Internal error: SessionService not wired on App" });
      }
      const result = await app.sessionService.writeHandoff(args);
      if (!result.ok) return errorContent(result.error);
      return textContent({ doc: result.value });
    },
  );

  // ── SPEC-043: bi-temporal invalidation ────────────────────────────────────

  // lore_invalidate
  registerToolWithArgs(
    server,
    "lore_invalidate",
    "Mark a knowledge/adr document invalid (or undo a prior invalidation) — the SOLE MCP write path for extra.validity",
    LoreInvalidateSchema,
    async (args) => {
      if (app.validityService === undefined) {
        return errorContent({ code: "STORE_ERROR", message: "Internal error: ValidityService not wired on App" });
      }
      const opts: Parameters<typeof app.validityService.invalidate>[1] = { by: args.by };
      if (args.superseded_by !== undefined) opts.supersededBy = args.superseded_by;
      if (args.reason !== undefined) opts.reason = args.reason;
      if (args.undo === true) opts.undo = true;

      const result = await app.validityService.invalidate(args.id_or_slug, opts);
      if (!result.ok) return errorContent(result.error);

      const payload: Record<string, unknown> = { doc: result.value.doc };
      if (result.value.decision_status_unchanged !== undefined) {
        payload["decision_status_unchanged"] = result.value.decision_status_unchanged;
      }
      return textContent(payload);
    },
  );
}

// ─── Batch Operation Executor ────────────────────────────────────────────────

/**
 * Converts the first Zod validation issue on a batch op's `args` into a
 * `LoreError` `VALIDATION_ERROR`, matching the shape `CorpusService._createImpl`
 * uses for its own `createDocInputSchema` failures (`{code, field, message}`) —
 * so a malformed batch `create`/`set`/`link` op surfaces the SAME error contract
 * a direct `lore_create`/`lore_set`/`lore_link` call would, rather than either
 * crashing on an unvalidated cast or silently coercing missing fields to
 * `undefined`.
 *
 * @param error - The ZodError from a failed `schema.safeParse(args)`
 * @param opName - Batch op name, used as the `field` fallback when the error
 *   carries no issue path (defensive — ZodError always has ≥1 issue in practice)
 * @returns A `VALIDATION_ERROR`-coded LoreError
 */
function zodIssueToLoreError(error: z.ZodError, opName: string): LoreError {
  const issue = error.issues[0];
  if (!issue) {
    return { code: "VALIDATION_ERROR", field: opName, message: "Invalid input" };
  }
  return {
    code: "VALIDATION_ERROR",
    field: issue.path.length > 0 ? issue.path.join(".") : opName,
    message: issue.message,
  };
}

/**
 * Executes a single named operation within a lore_batch call.
 * Returns a structured `{ ok, value }` or `{ ok, error }` result object.
 *
 * `create`/`set`/`link` validate `args` against the SAME Zod input schema the
 * corresponding single-op tool (`lore_create`/`lore_set`/`lore_link`) uses
 * BEFORE touching `corpusService` — every other lore_* tool is SDK-validated
 * against its schema pre-handler (see `registerToolWithArgs`); `executeBatchOp`
 * previously cast caller-supplied `args` straight to the service param type with
 * only ad-hoc presence checks (or, for `create`, no check at all), so a malformed
 * batch op could reach the service layer un-typechecked. A validation failure
 * now produces the same per-op `{ ok: false, error }` entry every other failure
 * mode already uses — the batch itself still succeeds (`isError` stays false);
 * only that one op's result entry reports the failure.
 *
 * @param op - Operation name (create | get | set | delete | list | search | link)
 * @param args - Raw arguments from the batch operation entry
 * @param app - The composition root providing corpus service
 * @returns A plain-object result suitable for inclusion in the batch results array
 */
async function executeBatchOp(
  op: string,
  args: Record<string, unknown>,
  app: App,
): Promise<unknown> {
  const { corpusService } = app;

  switch (op) {
    case "create": {
      const parsed = LoreCreateSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: zodIssueToLoreError(parsed.error, "create") };
      // reason: strip MCP-schema-only fields (ai/file_anchors/supersedes/by) — the
      // batch executor never invokes AI generation or the supersedes orchestration
      // (out of scope for lore_batch); file_anchors still folds into extra the same
      // way the single-op lore_create handler does, so a batch-created task's
      // declared anchors aren't silently dropped.
      const { ai: _ai, file_anchors: fileAnchors, supersedes: _supersedes, by: _by, ...createInput } = parsed.data;
      void _ai;
      void _supersedes;
      void _by;
      const mergedExtra =
        fileAnchors !== undefined
          ? { ...(createInput.extra ?? {}), file_anchors: fileAnchors }
          : createInput.extra;
      const resolvedCreateInput = {
        ...createInput,
        ...(mergedExtra !== undefined ? { extra: mergedExtra } : {}),
      };
      const r = await corpusService.create(resolvedCreateInput);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "get": {
      const idOrSlug = args["id_or_slug"];
      if (typeof idOrSlug !== "string") return { ok: false, error: "id_or_slug required" };
      const r = await corpusService.get(idOrSlug);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "set": {
      const parsed = LoreSetSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: zodIssueToLoreError(parsed.error, "set") };
      const { id_or_slug: idOrSlug, ...patch } = parsed.data;
      const r = await corpusService.set(idOrSlug, patch);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "delete": {
      const idOrSlug = args["id_or_slug"];
      if (typeof idOrSlug !== "string") return { ok: false, error: "id_or_slug required" };
      const r = await corpusService.delete(idOrSlug, args["confirm"] === true);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "list": {
      const r = await corpusService.list({});
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "search": {
      const query = args["query"];
      if (typeof query !== "string") return { ok: false, error: "query required" };
      const r = await corpusService.search(query);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "link": {
      const parsed = LoreLinkSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: zodIssueToLoreError(parsed.error, "link") };
      const { from, to, type } = parsed.data;
      const r = await corpusService.link(from, to, type as Parameters<typeof corpusService.link>[2]);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    default:
      return { ok: false, error: `Unknown operation: ${op}` };
  }
}
