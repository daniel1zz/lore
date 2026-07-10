/**
 * MCP tool registrations — 27 lore_* tools (16 original + 4 SPEC-025 task-workflow tools
 * + 1 SPEC-026 assess tool + 1 SPEC-035 audit tool + 1 SPEC-034 review tool
 * + 1 SPEC-039 verify tool + 1 IoC vertical-slice tech-spec §4.1/§11 P4 feed tool
 * + 2 SPEC-041 session tools: lore_bootstrap, lore_handoff; lore_feed additionally
 * gains a session-resume dispatch branch, SPEC-041 §3 D5).
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
});

/** Input schema for lore_search. */
export const LoreSearchSchema = z.object({
  query: z.string().min(1),
  type: DOC_TYPE_ENUM.optional(),
  limit: z.number().int().positive().optional(),
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
 */
export const LoreClaimSchema = z.object({
  id_or_slug: z.string(),
  by: z.string().min(1),
  branch: z.string().optional(),
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
 * Registers all 27 lore_* MCP tools on the given server (16 original + 4 SPEC-025
 * task-workflow tools: lore_claim, lore_release, lore_evidence_add, lore_ready;
 * + lore_assess (SPEC-026); + lore_audit (SPEC-035); + lore_review (SPEC-034);
 * + lore_verify (SPEC-039); + lore_feed (IoC vertical-slice tech-spec §4.1/§11 P4);
 * + lore_bootstrap, lore_handoff (SPEC-041 §3 D2, D3, D6) — lore_feed additionally
 * gains a session-resume dispatch branch (SPEC-041 §3 D5)).
 *
 * Tools with input use `registerToolWithArgs` (avoids ZodRawShapeCompat type bomb).
 * Tools without input (`lore_schema`, `lore_status`) use plain `server.tool(name, desc, cb)`.
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

    // Strip the `ai` field before passing to corpusService.create — it is not a corpus field.
    const { ai: _ai, ...createInput } = args;
    const result = await corpusService.create({ ...createInput, content: resolvedContent });
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
    const { type, status, since, author, tag, limit, offset, governed_by } = args;

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
    const { query, type, limit } = args;
    const filters = type !== undefined ? { type } : {};
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

  // lore_status — no input parameters; 3-arg form (correct for 0-arg tools)
  // reason: aggregate query tool, no arguments needed
  server.tool(
    "lore_status",
    "Get corpus statistics (total docs, by type, by status)",
    async () => {
      const result = await corpusService.status();
      if (!result.ok) return errorContent(result.error);
      return textContent(result.value);
    },
  );

  // ── SPEC-025 task workflow tools ──────────────────────────────────────────

  // lore_claim
  registerToolWithArgs(server, "lore_claim", "Acquire an advisory execution lease on a task", LoreClaimSchema, async (args) => {
    const result = await taskWorkflowService.claim(args.id_or_slug, {
      by: args.by,
      ...(args.branch !== undefined ? { branch: args.branch } : {}),
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
      return textContent({ report: result.value });
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
}

// ─── Batch Operation Executor ────────────────────────────────────────────────

/**
 * Executes a single named operation within a lore_batch call.
 * Returns a structured `{ ok, value }` or `{ ok, error }` result object.
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
      const r = await corpusService.create(args as Parameters<typeof corpusService.create>[0]);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "get": {
      const idOrSlug = args["id_or_slug"];
      if (typeof idOrSlug !== "string") return { ok: false, error: "id_or_slug required" };
      const r = await corpusService.get(idOrSlug);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "set": {
      const idOrSlug = args["id_or_slug"];
      if (typeof idOrSlug !== "string") return { ok: false, error: "id_or_slug required" };
      const { id_or_slug: _id, ...patch } = args;
      void _id;
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
      const from = args["from"];
      const to = args["to"];
      if (typeof from !== "string" || typeof to !== "string") {
        return { ok: false, error: "from and to required" };
      }
      const type = typeof args["type"] === "string" ? args["type"] : "relates-to";
      const r = await corpusService.link(from, to, type as Parameters<typeof corpusService.link>[2]);
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    default:
      return { ok: false, error: `Unknown operation: ${op}` };
  }
}
