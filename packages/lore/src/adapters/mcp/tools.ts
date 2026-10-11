/**
 * MCP tool registrations — 30 lore_* tools (16 original + 4 SPEC-025 task-workflow tools
 * + 1 SPEC-026 assess tool + 1 SPEC-035 audit tool + 1 SPEC-034 review tool
 * + 1 SPEC-039 verify tool + 1 IoC vertical-slice tech-spec §4.1/§11 P4 feed tool
 * + 2 SPEC-041 session tools: lore_bootstrap, lore_handoff; lore_feed additionally
 * gains a session-resume dispatch branch, SPEC-041 §3 D5
 * + 1 SPEC-042 tool: lore_anchor_set; lore_claim gains machine/worktree, lore_create
 * gains file_anchors, SPEC-042 §Design Decisions D9
 * + 1 SPEC-043 tool: lore_invalidate; lore_get gains computed validity_state,
 * lore_create gains supersedes, lore_search/lore_list gain include_invalid,
 * SPEC-043 §Design Decisions D6
 * + 1 SPEC-044 tool: lore_staleness_probe (batch/single-doc/list); lore_status and
 * lore_bootstrap gain computed open_stale_candidates, SPEC-044 §Design Decisions D10, D14
 * + no new tool for SPEC-045 (doc-code drift oracle): lore_status gains check_drift?
 * (migrated off the argless 3-arg form), lore_anchor_set gains spec-target declarative
 * REPLACE, lore_bootstrap gains computed code_anchor_specs, SPEC-045 §Design Decisions D7).
 * + no new tool for pagination hardening (unbounded-payload review): lore_list's
 * limit/offset are now pushed into a store-level LIMIT/OFFSET (were previously an
 * in-memory .slice() over an unbounded fetch); an omitted limit defaults to
 * MCP_LIST_DEFAULT_LIMIT (this surface only — the CLI stays fully unbounded by
 * default) and every response carries `truncated: boolean`, never a silent cap.
 * + 1 SPEC-054 tool: lore_uat_record; + 1 SPEC-055 tool: lore_requirement_add
 * + 1 SPEC-056 tool: lore_phase_status (task-skill-implement-cli-mcp-surfaces-
 * checklist-ref-evidence) — computed phase completion scorecard, thin pipe over
 * `../cli/phase-wiring.js::getPhaseStatus`. lore_evidence_add gains optional
 * checklist_ref and target-type dispatch (task vs phase, mirrors the CLI's
 * `lore evidence` retry-based dispatch).
 * + no new tool for SPEC-070 (deterministic task-dispatch bundle, §Design D8):
 * lore_feed gains `phase`/`task` optional fields and two dedicated dispatch
 * branches — checkpoint "phase-start" now returns the REAL PhaseStartPack (closes
 * the SPEC-056 deferred phase-start MCP gap — it previously fell through to the
 * generic advisory note) and checkpoint "task-start" returns the REAL TaskStartPack,
 * both via the SAME wiring (`../cli/phase-wiring.js::buildPhaseFeedFlowDeps`,
 * `../cli/task-feed-wiring.js::buildTaskFeedFlowDeps`) the CLI `lore feed
 * phase-start`/`lore feed task-start` dispatches call, so CLI/MCP payloads are
 * deep-equal by construction. Review Fix F7/F8 (dispatch-triplication + schema
 * laxness): `lore_feed`'s branch membership + per-checkpoint required-field
 * validation now derive from `../../flows/feed-flow.js::SPECIAL_FEED_CHECKPOINTS`
 * (the SAME descriptor the CLI's `commands/feed.ts` asserts handler coverage
 * against at module init) instead of three independently-maintained `if` checks,
 * and a contradictory field combo (`task-start` + `phase`, `phase-start` + `task`,
 * or ANY non-special checkpoint carrying `task`/`phase`) is rejected up front with
 * `VALIDATION_ERROR` instead of silently ignoring the extraneous field.
 *
 * `lore_evidence_add` gains the missing-oracle-file precheck (defect:
 * task-mcp-lore-evidence-add-bypasses-the-oracle-file-existence) — a self-reported
 * `oracle: "test"|"e2e"`, `result: "pass"` call referencing a test-file token that
 * does not exist on disk now returns `isError` `VALIDATION_ERROR` BEFORE the
 * task/phase dispatch, via the SAME shared gate + extractor the CLI's `lore evidence`
 * command uses (`findMissingOracleFilesForEvidence`, `../cli/evidence-precheck.js`).
 *
 * `lore_evidence_add` gains an optional `caller_cwd` field (defect: task-lore-
 * evidence-s-oracle-file-precheck-resolves-against-the, MEASURED 2026-08-01 by
 * directly invoking this session's own connected `lore_evidence_add` tool
 * against a file that exists ONLY in a linked git worktree — reproduced
 * exactly, whereas the CLI's `lore evidence` correctly found the SAME file via
 * its own `process.cwd()`). Root cause: this MCP server is a long-lived stdio
 * process — its `process.cwd()` reflects wherever THAT PROCESS was launched
 * from, once, at startup; it is NOT re-observed per tool call, so it does not
 * track "which directory the calling agent is logically operating in right
 * now" the way a fresh CLI subprocess's `process.cwd()` does. `caller_cwd`
 * (absolute path, optional — omitted is BYTE-IDENTICAL to pre-fix behavior)
 * lets the calling agent declare its own real directory; threaded as an
 * ADDITIONAL root candidate (`findMissingOracleFilesForEvidence`'s
 * `additionalCwds`, `../cli/evidence-precheck.js`) alongside the existing
 * `process.cwd()`/`app.repoRoot` roots — never a replacement, so a genuinely
 * missing file still fails every root, `caller_cwd` included. Mirrors `lore
 * verify`'s `--execution-root` escape hatch (SPEC-063) for the identical class
 * of "a process cannot autonomously know its correct execution root" problem.
 * The refusal message also now names every root checked (`describePrecheckRoots`,
 * same module) — the pre-fix message named none, leaving an author unable to
 * tell "your file is missing" from "the precheck looked in the wrong tree".
 *
 * `lore_evidence_add` gains the mixed-runner invocation guard (defect: task-
 * vitest-run-silently-drops-a-bun-test-ts-named-alongside-a) — a self-reported
 * `oracle: "test"|"e2e"`, `result: "pass"` call whose `command` is a single
 * `vitest run` invocation naming a `.bun.test.ts` path alongside a real vitest
 * file (or the symmetric `bun test` invocation naming a plain `.test.ts` file)
 * now returns `isError` `VALIDATION_ERROR` — the runner silently executes only
 * the files belonging to the invoked runner and exits 0 with no warning about
 * the rest. Same shared-decision CLI/MCP split as the two guards above
 * (`findMixedRunnerRefusal`, `../cli/evidence-precheck.js`).
 *
 * `lore_evidence_add` gains the pipe-refusal guard (task-wire-findpiperefusal-
 * into-the-live-lore-evidence-and-mcp, SPEC oracle-tier-falsifiability-a-
 * criterion-never-observed-red M2, ADR falsifiability-moves-from-the-task-
 * tier-to-the-oracle-tier) — a self-reported `oracle: "test"|"e2e"`,
 * `result: "pass"` call whose `command` contains an unquoted, non-`||` shell
 * pipe now returns `isError` `VALIDATION_ERROR`: `$?` observed after a pipe
 * belongs to the LAST stage of the pipeline, never the oracle the call means
 * to assert about. `capture: true` is the load-bearing escape — a captured
 * run's exit code is measured directly by this server, so the pipe hazard
 * does not apply. Same shared-decision CLI/MCP split as the guards above
 * (`findPipeRefusal`, `../cli/evidence-precheck.js`) — `findPipeRefusal`
 * itself was authored and tested earlier but NEITHER adapter called it until
 * this fix, so the guard was dormant on both surfaces.
 *
 * `lore_evidence_add` gains the discovery-refusal guard (task-wire-the-
 * discovery-refusal-guard-into-the-evidence-capture, spec-oracle-
 * executability-a-runner-s-discovery-refusal-is-not-a §M6.2's evidence-path
 * sibling, AC-OX-12) — a `capture: true` call whose fail-family `result`
 * (`"fail"`/`"expected-fail"`) is measured against a REAL exit code that
 * turns out to be a runner's own discovery-refusal phrase (vitest/bun test/
 * playwright reporting "found no matching test file", never distinguishable
 * from a genuine assertion failure by exit code alone) now returns `isError`
 * `VALIDATION_ERROR` instead of recording a `capture_source: "runner"` row
 * for a run that measured NOTHING. `lore verify`'s own §M6.2 call site
 * (`../../service/verify-runner-service.ts`) already downgraded this exact
 * shape to `"inconclusive"` for the ATTESTED path — `findDiscoveryRefusal`
 * (`@lore/core`) had exactly ONE production consumer before this task. Same
 * shared-decision CLI/MCP split as every guard above
 * (`findCapturedFailDiscoveryRefusal`, `../cli/evidence-precheck.js`).
 *
 * `lore_evidence_add` and `lore_release` now thread `caller_cwd` through to
 * `TaskWorkflowService.addEvidence`/`release`'s uncommitted-worktree
 * attestation guard (defect: task-lore-evidence-add-and-lore-release-over-
 * mcp-get-no — the SECOND instance of an optional-new-parameter silently
 * leaving an adapter unwired this session, see
 * task-the-mcp-assess-adapter-still-calls-derivecommitsetforplan) — neither
 * tool passed `callerCwd` at all before this fix, so the Q3 opt-in-hole close
 * (task-lore-evidence-and-lore-release-accept-an-attestation-from) was
 * silently absent on this surface. `lore_release` gains a NEW `caller_cwd`
 * field; `lore_evidence_add` reuses its PRE-EXISTING one (added earlier for
 * the oracle-file-existence precheck) for this second, orthogonal purpose.
 * See the module section header directly above `resolveMcpCallerCwd` (this
 * file's own Helpers section) for the full three-question review.
 *
 * ⛔ REMOVED 2026-08-02 (task-the-uncommitted-worktree-guard-treats-no-claim-
 * at-all-as-a): this adapter used to carry its OWN `hasRecordedTaskClaim`
 * pre-check (a `corpusService.get` round-trip) purely to stop a never-claimed
 * task's real `caller_cwd` from reaching the worktree guard's Q3 escalation
 * — because `TaskWorkflowService.checkUncommittedAttestationWorktree` could
 * not itself tell "no claim at all" apart from "a claim that recorded no
 * worktree" (both read as `claim?.worktree === undefined`). That service bug
 * is now fixed at its root (`hasRecordedClaim` inside task-workflow-
 * service.ts), so a SECOND adapter-side copy of the same "is there a claim"
 * predicate would only invite the next divergence between CLI and MCP — the
 * exact argument this corpus already used to make `deriveCommitSetForPlan`'s
 * parameters required. `resolveMcpCallerCwd` now takes ONE parameter and
 * `hasRecordedTaskClaim`/the `hasClaim` pre-check at both call sites are
 * gone; the service handles the no-claim case unconditionally, for every
 * adapter, without this file computing it a second time.
 *
 * `lore_create` gains an optional `caller_cwd` field (spec-corpus-resolution-
 * carries-provenance-and-a-foreign-write §D5, AC-CP-5(a)/(b)) — the adapter
 * matrix's "MCP inherits" row. Unlike the CLI (`adapters/cli/loader.ts`,
 * ambient — one `process.cwd()` read per fresh subprocess, frozen for that
 * whole invocation) this server is long-lived and stdio-driven, so the guard
 * cannot be set up once at startup and stay correct for every later call —
 * `resolveMcpCorpusProvenance` (this file's own Helpers section) resolves
 * the caller's provenance PER CALL from `caller_cwd`, reusing the CLI's own
 * `resolveCorpus()` verbatim, and `checkMcpForeignCorpusWrite` runs the SAME
 * exported `checkForeignCorpusWrite`/`foreignCorpusWriteRefusalError` pair
 * the CLI's `CorpusService.refuseIfForeignCorpusWrite` calls — one refusal
 * vocabulary, never a second MCP-side implementation. ABSENT `caller_cwd` is
 * treated exactly like HTTP's own named exemption (`provenance: null`,
 * always inert) rather than falling back to this server's own frozen
 * startup cwd — see that function's own header for why. `lore_create` is
 * the one non-lifecycle write tool wired to this today; the check itself is
 * adapter-agnostic and reusable the moment a future task threads
 * `caller_cwd` through `lore_set`/`lore_link`/`lore_unlink`.
 *
 * ⛔ NO AC-DECLARING TOOL EXISTS ON THIS SURFACE (there is no `lore_ac_add`/`lore_ac_set`;
 * `lore ac add|set|rm|cite` — `../cli/commands/ac.ts` — are the ONLY writers of
 * `spec.extra.acceptance_criteria`). `lore_set` replaces `extra` wholesale, so it could
 * otherwise rewrite the criteria; it cannot: `CorpusService.set` routes every write through
 * `service/ac-write-chokepoint.ts::applyAcChange` and refuses a changed array with
 * `AC_WRITE_NOT_VIA_AC_VERB` (a byte-identical echo of the stored array passes). The refusal
 * lives in the SERVICE layer, so this adapter only renders it as `isError` — it has no gate
 * of its own. The D8 `--allow-missing-path` escape remains unreachable from MCP (no AC verb).
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
 * Public surface: `registerTools(server, app, getConfig?): void` (`getConfig` is a
 * SPEC-070 F6 additive optional third param — a config GETTER, called per "task-start"
 * `lore_feed` invocation, not a one-time snapshot — see its own JSDoc below)
 * Invariants: one registration per tool name; every tool returns `{ content: [text] }` or
 *   `{ content: [text], isError: true }` (never throws across the MCP boundary).
 * Side-effect class: IO (reads/writes corpus via App services; no network I/O itself).
 * Source: SPEC-008 §3
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { App } from "../../app.js";
import { runWithAuditSurface } from "../../store/audit-surface.js";
import { McpCallScope, actorSourceOfName, requireCallIdentity } from "./call-scope.js";
import type { LoreError, LoreConfig, CorpusProvenance } from "@lore/core";
import type { LinkType } from "@lore/core";
import { renderAssessmentContent } from "@lore/core";
import type { NewReviewJudgment, ReviewJudgment, Result, TreeBlueprint } from "@lore/core";
import type { SetRulePatch } from "../../service/rule-service.js";
import { ORACLE_KINDS, runDeterministicChecks, resolveCaptureTimeoutMs, resolveForeignCorpusWriteGateEnabled } from "@lore/core";
import {
  handoffExtraSchema,
  uatVerdictSchema,
  REQUIREMENT_PRIORITIES,
  extractFileAnchors,
  BASELINE_NODE_KINDS,
  BASELINE_TREES,
  RULE_CONFIDENCES,
  RULE_ENFORCEMENTS,
  RULE_LIFECYCLES,
} from "@lore/core";
import { KNOWLEDGE_SUB_TYPES } from "@lore/core";
import { buildUnconfiguredUpstreamRemedy, ISSUE_CATEGORY_MAX_LENGTH, ISSUE_SEVERITIES } from "@lore/core";
import { resolveSubTypeFilter } from "../../service/corpus-service.js";
// spec-a-github-filed-defect-must-be-claimable-one-ingest-seam AC-GR-11 —
// `readGithubIssueRef` is pure/store-free (no `gh`/`bun:sqlite` deps, see
// its own module header), so — unlike `report-issue-wiring.js` below —
// this import stays static: it locates the task `fileGithubIssue` just
// minted by its stored GitHub pointer, never by recomputing a slug this
// handler has no `repo_id` to recompute it from.
import { readGithubIssueRef } from "../../service/resolution-projector.js";
import type { HandoffExtra } from "@lore/core";
import { isAssessAiBraked } from "../../ai/resolve-ai.js";
import { REVIEW_PROMPT_VERSION } from "../../ai/review-template.js";
import { CORPUS_SCHEMA_INFO } from "./schema-info.js";
import { runCalibrationHook } from "../../flows/calibration-hook.js";
import {
  buildFeed,
  buildResumeFeed,
  SESSION_RESUME_CHECKPOINT,
  SPECIAL_FEED_CHECKPOINTS,
} from "../../flows/feed-flow.js";
import { buildPhaseStartPack, PHASE_START_CHECKPOINT } from "../../flows/phase-feed-flow.js";
import { buildTaskStartPack, TASK_START_CHECKPOINT } from "../../flows/task-feed-flow.js";
import { buildTaskFeedFlowDeps, resolveTaskStartBudgets } from "../cli/task-feed-wiring.js";
import { createWithSupersedes, renderSupersedeRepairMessage } from "../../flows/supersede-flow.js";
// spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5, AC-CP-5 —
// the SAME exported predicate/error-factory the CLI's `CorpusService.
// refuseIfForeignCorpusWrite` calls (never a paraphrased MCP-side copy), and
// the CLI adapter's OWN composition-boundary corpus resolver, reused verbatim
// against THIS call's `caller_cwd` instead of a fresh CLI subprocess's
// `process.cwd()` — see `resolveMcpCorpusProvenance`'s own header below.
import { checkForeignCorpusWrite, foreignCorpusWriteRefusalError } from "../../service/foreign-corpus-write-guard.js";
import { resolveCorpus } from "../cli/corpus-resolution.js";
// reason: SPEC-102 — resolveActorWithSource lives in @lore/core/node (node:os
// only, no bun:sqlite) — safe to import here without breaking this file's
// vitest-reachability (mirrors this module's own precedent of lazy-importing
// ONLY bun:sqlite-tainted deps, not every Node-adjacent one).
import { resolveActorWithSource } from "@lore/core/node";
import { computeValidityState } from "../../flows/validity-state.js";
import {
  buildStalenessBatchJsonPayload,
  buildStalenessFlowDeps,
  buildStalenessListJsonPayload,
  buildStalenessSingleJsonPayload,
  listFreshStalenessEscalates,
} from "../../flows/staleness-flow.js";
import { buildDriftFlowDeps, buildListSpecs, countArmedSpecs, runDrift } from "../../flows/drift-flow.js";
import { loadTreeBlueprint } from "../../flows/blueprint-flow.js";
import { buildFileAnchorProbeContext, buildRealFsProbe } from "../real-fs-probe.js";
import { collectFileAnchorResolution } from "../../service/anchor-resolution.js";
import { buildAssessSummaryText } from "./assess-render.js";
import { requirePhaseWorkflowService, getPhaseStatus, buildPhaseFeedFlowDeps } from "../cli/phase-wiring.js";
import { deriveCommitSetForPlan, type DiffSourceRecord } from "../cli/assess-commit-derivation.js";
import {
  findMissingOracleFilesForEvidence,
  findFilteredPassRefusal,
  findMixedRunnerRefusal,
  findCaptureFlagConflict,
  findPipeRefusal,
  findCapturedFailDiscoveryRefusal,
  describePrecheckRoots,
} from "../cli/evidence-precheck.js";
import { captureOracleCommand, type EvidenceProvenance } from "../evidence-capture.js";
import { hasZeroReleaseEvidence, ZERO_EVIDENCE_RELEASE_WARNING } from "../../service/task-workflow-service.js";
import { existsSync } from "node:fs";

// ─── Schema Constants ────────────────────────────────────────────────────────
// Each schema is a `z.object(...)` instance (AnySchema), NOT an inline ZodRawShape literal.
// Keeping them as const-level declarations ensures tsc resolves their types once,
// not once per callsite × overload combination.
// reason: see ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA — inline raw shapes cause 912s check time

/** Valid document types accepted by all lore_* tools. */
const DOC_TYPE_ENUM = z.enum(["prd", "spec", "adr", "plan", "knowledge", "task"]);

/**
 * Valid `knowledge` sub-type values accepted by `lore_list`/`lore_search`'s
 * `sub_type` retrieval filter.
 *
 * reason: built from `@lore/core`'s `KNOWLEDGE_SUB_TYPES` tuple (the value-set
 * SSOT) rather than a re-typed literal list — a tenth sub-type must not need an
 * edit here to become filterable. Declared as a module-level const per this
 * file's schema-constant rule above (ADR-01KVYFJ5G8EVB6S5NMD3PNY5KA).
 */
const KNOWLEDGE_SUB_TYPE_ENUM = z.enum(KNOWLEDGE_SUB_TYPES);

/** Valid document status values accepted by lore_set and lore_list filters. */
const DOC_STATUS_ENUM = z.enum([
  "draft",
  "in-review",
  "approved",
  "active",
  "archived",
  "deprecated",
]);

/**
 * Default page size applied to `lore_list` when the caller omits `limit`
 * (pagination hardening, unbounded-payload review). MCP callers are always
 * agents (SPEC-024) — an unpaged corpus scan is exactly the unbounded-payload
 * growth this default exists to bound. See {@link LoreListSchema}'s JSDoc for
 * the full "never a silent cap" contract (`returned`/`truncated` on every
 * response). The CLI's `lore list` has NO equivalent default — human terminal
 * usage stays fully unbounded unless `--limit` is passed explicitly.
 */
const MCP_LIST_DEFAULT_LIMIT = 100;

/**
 * The optional run attestation every write tool accepts (spec-run-identity-slice-1 D1/D3, BR-1034).
 * The agent integration's pre-tool hook sets it (`lore run attest-input`); a caller never needs to. A schema
 * that declares this field is an ATTESTED tool: {@link registerToolImpl} builds one invocation identity per call
 * from it and runs the handler against a store wrapped for that call. Absent or unregistered -> unattested.
 */
export const HARNESS_RUN_FIELD = z
  .string()
  .min(1)
  .optional()
  .describe("Harness-vouched run id; set by the agent integration, normally not by the caller");

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
   * [plan branch only] Declares that this plan requires a P0-accepted UAT
   * verdict before it may be archived (SPEC-058 plan-promote `requiresUat`
   * gate / SPEC-054 plan-close `uatP0Accepted` gate). Merged into
   * `extra.requires_uat` before the call reaches `CorpusService.create` —
   * ONLY when `true`; `false` or omitted leaves `extra.requires_uat` unset
   * (byte-identical to a call that never passed this field at all).
   *
   * Consistency with the CLI (SPEC-058 hotfix `plan-add-requires-uat-authoring-path`):
   * the CLI's `lore create <type> --requires-uat` REJECTS the flag on any
   * non-plan type as a type-flag mismatch (exit 2). This tool matches that
   * stance — passing `requires_uat: true` with `type` other than `"plan"`
   * is a VALIDATION_ERROR, never a silent ignore, so the two surfaces can
   * never silently diverge on what counts as a legal combination.
   */
  requires_uat: z.boolean().optional(),
  /**
   * ID or slug of an existing knowledge/adr doc this new doc supersedes
   * (SPEC-043 §Design Decisions D11) — composes `CorpusService.create` THEN
   * `ValidityService.invalidate(supersedes, {supersededBy: newDoc.id, by})` (the call's own identity) via
   * the shared `createWithSupersedes` orchestration (`flows/supersede-flow.ts`),
   * the SAME function the CLI's `lore create --supersedes` uses. The target's type
   * is validated BEFORE any write, inside that shared orchestration: a non-
   * knowledge/adr target (e.g. a task) returns `isError` and creates NOTHING
   * (task-mcp-lore-create-supersedes-still-creates-then-fails-the).
   */
  supersedes: z.string().optional(),
  /**
   * Actor identity for the invalidate step when `supersedes` is set (SPEC-043
   * §Design Decisions D11) — MCP callers pass this explicitly, same actor-identity
   * precedent as `lore_claim`/`lore_release`/`lore_evidence_add`. Meaningless
   * (ignored) when `supersedes` is omitted.
   */
  harness_run: HARNESS_RUN_FIELD,
  /**
   * The calling agent's OWN current working directory — same rationale as
   * `lore_evidence_add`/`lore_release`'s pre-existing `caller_cwd` field
   * (module header, "MCP has a long-lived process.cwd() problem"): this
   * server's own `process.cwd()` is frozen at startup and cannot answer
   * "which directory is the calling agent logically in right now" for THIS
   * call. Feeds the foreign-corpus-write guard's per-call provenance
   * (spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5,
   * AC-CP-5) — see `resolveMcpCorpusProvenance`'s own header (this file's
   * Helpers section) for the ABSENT-value decision. Optional; omitted is
   * byte-identical to HTTP's own named exemption (`provenance: null`, the
   * predicate is always inert).
   */
  caller_cwd: z.string().optional(),
});

/** Input schema for lore_get. */
export const LoreGetSchema = z.object({
  id_or_slug: z.string(),
  resolve_mdx: z.boolean().optional(),
  include_navigation: z.boolean().optional(),
});

/**
 * Input schema for lore_set. The resulting audit entry is attributed to the call's own
 * identity (the attested run's name) — there is no `by` argument; a caller naming one is
 * refused by the strict schema, never silently attributed elsewhere.
 */
export const LoreSetSchema = z.object({
  id_or_slug: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  status: DOC_STATUS_ENUM.optional(),
  tags: z.array(z.string()).optional(),
  extra: z.record(z.unknown()).optional(),
  slug: z.string().optional(),
  /**
   * The audited exit from the record-edit gate (spec-documents-are-living-or-records D4/D15, BR-1049):
   * a typo-level fix of a LOCKED record that writes exactly one version, keeps the status and records
   * `reason`. NOT a doc field — handlers destructure it out of the patch next to the call's resolved actor and pass it as a
   * `SetOptions.correction`, because docPatchSchema would silently strip it.
   */
  correction: z.object({ reason: z.string().min(1) }).optional(),
  harness_run: HARNESS_RUN_FIELD,
});

/** Input schema for lore_delete. Attributed to the call's own identity — see {@link LoreSetSchema}. */
export const LoreDeleteSchema = z.object({
  id_or_slug: z.string(),
  confirm: z.literal(true),
  harness_run: HARNESS_RUN_FIELD,
});

/**
 * Input schema for lore_list.
 *
 * `limit`/`offset` (pagination hardening, unbounded-payload review): unlike the CLI's
 * `--limit`/`--offset` (which default to fully unbounded — human terminal usage), an
 * OMITTED `limit` on THIS surface defaults to {@link MCP_LIST_DEFAULT_LIMIT} — MCP
 * callers are always agents, and an unbounded corpus scan is the exact unbounded-payload
 * risk this pagination work exists to close. The cap is never silent: the response
 * always carries `returned`/`truncated` so a capped call is distinguishable from a
 * complete one (never a silent cap — no-silent-fallback project norm). Passing an
 * EXPLICIT `limit` (any value, including one larger than the default) always wins over
 * the default and is honored verbatim.
 */
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
  /** See {@link LoreSearchSchema.sub_type} — same store-level predicate, CLI `--sub-type` mirror. */
  sub_type: KNOWLEDGE_SUB_TYPE_ENUM.optional(),
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
  /**
   * A `knowledge` doc's `extra.sub_type`, as a store-level retrieval predicate —
   * the CLI `--sub-type` mirror (spec-a-write-side-fact-with-no-read-side-address-counts-with-no §M3).
   *
   * ⛔ This surface exists so the MCP tools never silently lag the CLI on a
   * retrieval filter: agents are the dominant caller, and a taxonomy reachable
   * only from a terminal is not reachable at all for them.
   *
   * Requires `type: "knowledge"`. Any other `type` (or none) is an `isError`
   * refusal naming the conflict, via the same `resolveSubTypeFilter` seam the CLI
   * maps to exit 2 — never a silently empty result set.
   */
  sub_type: KNOWLEDGE_SUB_TYPE_ENUM.optional(),
});

/** Input schema for lore_tree. */
export const LoreTreeSchema = z.object({
  root: z.string().optional(),
  depth: z.number().int().positive().optional(),
});

/** Input schema for lore_link. Attributed to the call's own identity — see {@link LoreSetSchema}. */
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
  harness_run: HARNESS_RUN_FIELD,
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
  harness_run: HARNESS_RUN_FIELD,
  id_or_slug: z.string(),
  calibration_note: z.string().optional(),
});

/** Input schema for lore_reopen (spec-documents-are-living-or-records D5). `reason` is required and non-blank (service-enforced). */
export const LoreReopenSchema = z.object({
  harness_run: HARNESS_RUN_FIELD,
  id_or_slug: z.string(),
  reason: z.string(),
  reviewer: z.string().optional(),
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
  harness_run: HARNESS_RUN_FIELD,
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

/**
 * Oracle outcomes accepted by lore_evidence_add. `"expected-fail"` (spec-
 * workflow-hardening-evidence-red-vocabulary-claim-worktree §M1, AC-WH-1)
 * records a deliberate RED-phase oracle run that fails by design — stored
 * verbatim, never counted as passing by any downstream consumer (mirrors
 * `"inconclusive"`'s "satisfies neither pass nor fail filter" property,
 * `@lore/core`'s task-workflow.ts). `"inconclusive"` itself stays excluded
 * here — it is runner-issued only (`lore_verify`'s sole write path).
 */
const EVIDENCE_RESULT_ENUM = z.enum(["pass", "fail", "expected-fail"]);

/**
 * Input schema for lore_claim.
 * The claimant is the call's own identity (the attested run); there is no `by` argument.
 * `machine`/`worktree` (SPEC-042 §Design Decisions D2, D9) — BOTH explicit-only
 * on this surface (no ambient auto-capture server-side; the server process's own
 * hostname/cwd would describe the MCP server, not the caller's session). The
 * CLI auto-captures `machine` as `os.hostname()`; MCP callers must pass it
 * themselves if they want it recorded.
 */
export const LoreClaimSchema = z.object({
  id_or_slug: z.string(),
  harness_run: HARNESS_RUN_FIELD,
  branch: z.string().optional(),
  machine: z.string().optional(),
  worktree: z.string().optional(),
  /**
   * Claim-scoped corpus authoring (spec-baseline-slice-2 §C8, AC-BLS2-8): the baseline branch this
   * worktree session may write under in the main corpus. Requires `worktree`; stored on the lease as
   * `extra.claim.corpus_scope` — same field the CLI's `--corpus-scope` writes.
   */
  corpus_scope: z.string().optional(),
  steal: z.boolean().optional(),
});

/**
 * Input schema for lore_release.
 * `caller_cwd` (task-lore-evidence-add-and-lore-release-over-mcp-get-no) —
 * see {@link LoreEvidenceAddSchema.caller_cwd}'s JSDoc for the full "MCP has
 * no meaningful `process.cwd()`" rationale; this field EXISTS SOLELY to feed
 * {@link resolveMcpCallerCwd} → `ReleaseOpts.callerCwd`, the uncommitted-
 * worktree attestation guard's Q3 mismatch check
 * (`checkUncommittedAttestationWorktree`, task-lore-evidence-and-lore-
 * release-accept-an-attestation-from) — `lore_release` had NO `caller_cwd`
 * field at all before this fix, unlike `lore_evidence_add`'s pre-existing one
 * (added earlier for an unrelated purpose, the oracle-file-existence
 * precheck). Optional: an agent that genuinely does not know its own
 * directory must not be forced to fabricate one; an omitted value degrades
 * to "not measured" (no fabricated refusal), never a silent reuse of the
 * MCP server's own irrelevant `process.cwd()`.
 */
export const LoreReleaseSchema = z.object({
  id_or_slug: z.string(),
  harness_run: HARNESS_RUN_FIELD,
  reason: z.string().optional(),
  force: z.boolean().optional(),
  caller_cwd: z.string().optional(),
});

/**
 * Input schema for lore_evidence_add.
 * `ac_ref` — optional pointer to a structured AC id declared on the plan's parent
 * spec (SPEC-038 §4). Passed through untouched; cross-entity validation that it
 * names a *declared* AC lives in `TaskWorkflowService.addEvidence` (SPEC-038 §4 D4),
 * not this schema.
 * `checklist_ref` (SPEC-056 §Design Decisions D8) — the phase-doc-typed sibling of
 * `ac_ref`: an optional pointer to a checklist item id declared on a PHASE target's
 * own `extra.checklist`. Also passed through untouched; cross-entity validation lives
 * in `PhaseWorkflowService`'s shared evidence-append path. Meaningful only when
 * `id_or_slug` resolves to a phase doc — harmless-but-unvalidated on a task target.
 */
export const LoreEvidenceAddSchema = z.object({
  id_or_slug: z.string(),
  oracle: EVIDENCE_ORACLE_ENUM,
  command: z.string().min(1),
  result: EVIDENCE_RESULT_ENUM,
  output_tail: z.string().max(4000).optional(),
  recorded_by: z.string().min(1).optional(),
  harness_run: HARNESS_RUN_FIELD,
  ac_ref: z.string().optional(),
  checklist_ref: z.string().optional(),
  /**
   * Absolute path the CALLING AGENT asserts is its own real current directory
   * (task-lore-evidence-s-oracle-file-precheck-resolves-against-the) — pass
   * this when the caller is operating from a linked git worktree, since this
   * MCP server's own `process.cwd()` (fixed at server startup) does not track
   * it. Used as an ADDITIONAL missing-oracle-file precheck root alongside the
   * server's own cwd/corpus root — never a replacement, so an omitted value
   * is byte-identical to pre-fix behavior and a genuinely missing file is
   * still refused regardless. Mirrors `lore verify`'s `--execution-root`
   * (SPEC-063).
   *
   * SECOND use (task-lore-evidence-add-and-lore-release-over-mcp-get-no):
   * also fed to {@link resolveMcpCallerCwd} → `EvidenceInput.callerCwd`, the
   * uncommitted-worktree attestation guard's Q3 mismatch check
   * (`checkUncommittedAttestationWorktree`, task-lore-evidence-and-lore-
   * release-accept-an-attestation-from) — the SAME caller-declared value,
   * reused for a SECOND, orthogonal purpose rather than a second field,
   * since both readings are "the calling agent's own real directory".
   *
   * THIRD use (task-mcp-lore-evidence-add-cannot-set-capture-source-and-has-no):
   * when {@link LoreEvidenceAddSchema.capture} is `true` this is the working
   * directory the server spawns `command` in — and it becomes REQUIRED for that
   * path specifically (refused when absent, never defaulted to the server's own
   * cwd). See `capture`'s JSDoc directly below.
   */
  caller_cwd: z.string().optional(),
  /**
   * Opt in to RUNNER CAPTURE (task-mcp-lore-evidence-add-cannot-set-capture-
   * source-and-has-no) — the MCP peer of the CLI's `lore evidence --capture`.
   * When `true`, the server runs `command` ITSELF via the shared
   * `../evidence-capture.js::captureOracleCommand`, cross-checks the real exit
   * code against the declared `result`, and records the child's real
   * stdout+stderr as `output_tail` with `capture_source: "runner"`.
   *
   * ⛔ There is deliberately NO `capture_source` input field on this schema.
   * `capture_source` is DERIVED — `"runner"` only on the path where this server
   * actually ran the command, `"self-report"` otherwise — because a
   * caller-settable label is a self-report wearing a runner's badge (option (a)
   * of the governing task, rejected by its own design review). The ONLY way a
   * caller reaches `"runner"` is by letting lore execute the command.
   *
   * Requires `caller_cwd`: this is a long-lived stdio server whose
   * `process.cwd()` was fixed at startup and is NOT where the calling agent is
   * working (the same fact that forced `caller_cwd` to exist at all), so a
   * `capture: true` without it is REFUSED rather than silently spawned in an
   * arbitrary directory. Mutually exclusive with `output_tail` and with
   * `oracle: "manual"` — the SAME `findCaptureFlagConflict` refusals the CLI
   * applies, shared verbatim so the wording cannot drift.
   */
  capture: z.boolean().optional(),
});

/** Input schema for lore_phase_status (SPEC-056 task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence). */
export const LorePhaseStatusSchema = z.object({
  id_or_slug: z.string(),
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
 *     The caller's identity is NOT consumed on this branch
 *     (spec anchor writes are attributed to "system", mirroring `AcService`).
 *   - any other type → `VALIDATION_ERROR`, naming "task or spec".
 * The writer is the call's own identity (no `by` argument).
 */
export const LoreAnchorSetSchema = z.object({
  id_or_slug: z.string(),
  anchors: z.array(z.string()),
  harness_run: HARNESS_RUN_FIELD,
});

/**
 * Input schema for lore_assess (SPEC-026).
 * `diff_text` — optional pre-acquired diff content, an explicit override (mirrors the
 * CLI's `--diff`/`--diff-file`). When OMITTED, `lore_assess` now auto-derives the plan's
 * own commit set from git history itself (`../cli/assess-commit-derivation.js`, same
 * mechanism the CLI uses via its own `process.cwd()`) instead of requiring the caller to
 * assemble a diff — task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be.
 * `ai` — explicit AI opt-in/out. Unlike lore_create's `ai` (default false — MCP callers are
 * always agents), assess has no non-AI mode (SPEC-026 §3 D5: the tool name IS the AI intent).
 * Passing `ai: false` is a contradiction (mirrors CLI `--no-ai` → exit 2) and always errors.
 */
export const LoreAssessSchema = z.object({
  harness_run: HARNESS_RUN_FIELD,
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
 * The requesting actor is the call's own identity (no `by` argument). Same orchestration as the CLI's single-doc
 * `lore review <doc>`: deterministic pre-checks first, AI judge only when they all
 * pass/skip. No `ai` override field — the surface-brake check runs unconditionally
 * (mirrors `lore review`'s CLI behavior: a braked surface cannot run review at all).
 */
export const LoreReviewSchema = z.object({
  id_or_slug: z.string(),
  harness_run: HARNESS_RUN_FIELD,
});

/**
 * Input schema for lore_staleness_probe (SPEC-044 §Design Decisions D10) — the MCP
 * counterpart to `lore review --staleness`. The call's own identity is the
 * audit-row actor for every probe this call commissions (D4), load-bearing.
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
  harness_run: HARNESS_RUN_FIELD,
});

/**
 * Input schema for lore_verify (SPEC-039 §2, §4 AC-VRF-10; §M2 trust-hardening).
 * `ac` — optional subset of declared AC ids to run (omitted = every declared
 * script-mode AC on the plan's parent spec). `task` — optional explicit target
 * task override (wins over claim-based resolution, `resolveTargetTask` in
 * `@lore/core`). The runner's actor is the call's own identity
 * (no `by` argument). `allow_new_commands` (SPEC-039 §M2,
 * default `false`) — approve every new/changed script-AC command for this
 * call without a prompt (MCP is non-interactive by design: unlike the CLI,
 * there is no TTY-confirm fallback here — an unapproved command with
 * `allow_new_commands: false` always returns `isError` naming this field).
 */
export const LoreVerifySchema = z.object({
  plan: z.string(),
  ac: z.array(z.string()).optional(),
  task: z.string().optional(),
  harness_run: HARNESS_RUN_FIELD,
  allow_new_commands: z.boolean().optional(),
});

/**
 * Input schema for lore_feed (IoC vertical-slice tech-spec §4.1/§11, P4 slice;
 * extended by SPEC-041 §3 D5 for the session-resume dispatch; extended by SPEC-056
 * for the phase-start dispatch; extended by SPEC-070 §Design Decisions D8 for the
 * task-start dispatch).
 * `checkpoint` — e.g. `"spec-create"`, mapped to a produced-type via
 * `CHECKPOINT_PRODUCED_TYPE` (`../../flows/feed-flow.js`). `parent_id_or_slug` —
 * optional intended-parent doc whose MDX-resolved summary is included in the feed
 * when supplied, mirroring the CLI's `--parent`. `plan`/`handoff`/`by` are only
 * meaningful when `checkpoint === "session-resume"` — forwarded verbatim to
 * `SessionService.resume` via `buildResumeFeed`, mirroring the CLI's
 * `--plan`/`--handoff`/`--by`. `phase` is only meaningful when
 * `checkpoint === "phase-start"` — the target phase document id/slug, mirroring the
 * CLI's `lore feed phase-start <phase>` positional. `task` is only meaningful when
 * `checkpoint === "task-start"` — the target task document id/slug, mirroring the
 * CLI's `lore feed task-start <task>` positional.
 */
export const LoreFeedSchema = z.object({
  checkpoint: z.string(),
  parent_id_or_slug: z.string().optional(),
  plan: z.string().optional(),
  handoff: z.string().optional(),
  // reason: `by` here is a session-resume FILTER (whose handoff), not an author — a read tool is never attested, so
  // an omitted `by` stays omitted instead of being filled with the server's own name.
  by: z.string().optional(),
  phase: z.string().optional(),
  task: z.string().optional(),
});

/**
 * Input schema for lore_bootstrap (SPEC-041 §3 D2) — the S1 volatile session
 * pointer-set. `by` is OPTIONAL and read-only — a FILTER naming whose `my_claims` to
 * report (default: the call's own identity); it never stamps a row (pinned in
 * `adapters/read-side-by-filters.ts`). Every other field is corpus-wide regardless of `by`.
 */
export const LoreBootstrapSchema = z.object({
  by: z.string().min(1).optional(),
  harness_run: HARNESS_RUN_FIELD,
});

/**
 * Input schema for lore_invalidate (SPEC-043 §Design Decisions D2, D6) — the SOLE MCP
 * write path for a `knowledge`/`adr`/`task` doc's bi-temporal `extra.validity` (`task`
 * added by task-a-task-cannot-be-retracted-supersedes-emits-a-repair, the same
 * retraction mechanism as the CLI). The actor is the call's own identity (no `by`).
 * `superseded_by` is resolved and PERSISTED as its ULID (never the raw id-or-slug).
 * `undo` clears a prior invalidation instead of setting one; `decision_status_unchanged`
 * surfaces structurally on the response when an ADR's `decision_status: "superseded"`
 * is NOT auto-reverted by `undo` (review U7 — MCP agents never read CLI help text).
 */
export const LoreInvalidateSchema = z.object({
  id_or_slug: z.string(),
  harness_run: HARNESS_RUN_FIELD,
  superseded_by: z.string().optional(),
  reason: z.string().max(500).optional(),
  undo: z.boolean().optional(),
});

/**
 * Input schema for lore_handoff (SPEC-041 §3 D3, D6) — reuses `handoffExtraSchema`
 * directly (SSOT; no redeclaration) since the MCP tool's typed fields ARE
 * `extra.handoff` verbatim (D6: "MCP lore_handoff takes the typed fields
 * directly"). `handoffExtraSchema` requires `by` (`min(1)`), so it is OMITTED here: the stored handoff
 * author stays non-empty because the wrapper fills `by` from the call's resolved name, while
 * `handoffExtraSchema` (the CLI contract) is untouched.
 */
export const LoreHandoffSchema = handoffExtraSchema.omit({ by: true }).extend({
  harness_run: HARNESS_RUN_FIELD,
});

/**
 * Input schema for lore_uat_record (SPEC-054) — the SOLE MCP write path for a structured
 * UAT verdict (`knowledge`/`uat`), thin pipe over `UatService.record`. `verdict` REUSES
 * `uatVerdictSchema` directly (SSOT; the tool's payload IS `extra.uat` verbatim). The recorder
 * is the call's own identity (no `by`).
 */
export const LoreUatRecordSchema = z.object({
  plan: z.string().min(1),
  harness_run: HARNESS_RUN_FIELD,
  verdict: uatVerdictSchema,
});

/**
 * Input schema for lore_requirement_add (SPEC-055) — the SOLE MCP write path for a PRD's
 * structured requirement inventory, thin pipe over `RequirementService.addRequirement`.
 * The candidate is validated fully by `prdRequirementsSchema` inside the service; this
 * schema pins the shape at the MCP boundary (`priority` from `REQUIREMENT_PRIORITIES` SSOT).
 */
export const LoreRequirementAddSchema = z.object({
  prd: z.string().min(1),
  id: z.string().min(1),
  statement: z.string().min(1),
  priority: z.enum(REQUIREMENT_PRIORITIES),
});

/**
 * Input schemas for the baseline write tools (spec-baseline-slice-1-rules-with-permanent-ids-
 * ac-citations §C3) — thin pipes over `RuleService`, the SOLE writer of a baseline doc's
 * verb-owned `extra` keys (`lore_set` refuses them via the CorpusService replace guard).
 * Enum members come from the `@lore/core` baseline SSOT, never re-typed here. The writer
 * is the call's own identity (no `by`).
 * Statement/example length limits are enforced by `baselineRuleSchema` inside the service.
 */
/**
 * Four-part standard fields (architecture `AS-n` rules only; all four or none — `baselineRuleSchema`
 * enforces it, and every `current_exceptions` id must be a live `AD-n`). Shared by rule add and set.
 */
const FOUR_PART_STANDARD_SHAPE = {
  current_reality: z.string().min(1).optional(),
  target_rule: z.string().min(1).optional(),
  current_exceptions: z.array(z.string().min(1)).optional(),
  migration: z.string().min(1).optional(),
};

export const LoreRuleAddSchema = z.object({
  leaf: z.string().min(1),
  statement: z.string().min(1),
  confidence: z.enum(RULE_CONFIDENCES),
  enforced_by: z.enum(RULE_ENFORCEMENTS),
  examples: z.array(z.string()).min(1),
  ...FOUR_PART_STANDARD_SHAPE,
  harness_run: HARNESS_RUN_FIELD,
});

export const LoreRuleSetSchema = z.object({
  rule: z.string().min(1),
  statement: z.string().min(1).optional(),
  confidence: z.enum(RULE_CONFIDENCES).optional(),
  enforced_by: z.enum(RULE_ENFORCEMENTS).optional(),
  examples: z.array(z.string()).min(1).optional(),
  lifecycle: z.enum(RULE_LIFECYCLES).optional(),
  note: z.string().min(1).optional(),
  move_to: z.string().min(1).optional(),
  ...FOUR_PART_STANDARD_SHAPE,
  harness_run: HARNESS_RUN_FIELD,
});

export const LoreRuleShowSchema = z.object({
  rule: z.string().min(1),
});

export const LoreRuleFindSchema = z
  .object({
    spec: z.string().min(1).optional(),
    file: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
  })
  .refine((a) => [a.spec, a.file, a.text].filter((v) => v !== undefined).length === 1, {
    message: "exactly one of spec, file, text is required",
  });

export const LoreRuleImpactSchema = z.object({
  rule: z.string().min(1),
});

export const LoreBaselineAddSchema = z.object({
  parent: z.string().min(1),
  tree: z.enum(BASELINE_TREES).optional(),
  node: z.enum(BASELINE_NODE_KINDS),
  label: z.string().min(1),
  title: z.string().min(1),
  content: z.string().optional(),
  harness_run: HARNESS_RUN_FIELD,
});

export const LoreBaselineSetLabelSchema = z.object({
  node: z.string().min(1),
  label: z.string().min(1),
  harness_run: HARNESS_RUN_FIELD,
});

export const LoreBaselineDependsSchema = z.object({
  leaf: z.string().min(1),
  add: z.array(z.string().min(1)).optional(),
  remove: z.array(z.string().min(1)).optional(),
  harness_run: HARNESS_RUN_FIELD,
});

export const LoreBaselineGlossaryAddSchema = z.object({
  node: z.string().min(1),
  term: z.string().min(1),
  meaning: z.string().min(1),
  note: z.string().optional(),
  harness_run: HARNESS_RUN_FIELD,
});

export const LoreBaselineGlossaryRmSchema = z.object({
  node: z.string().min(1),
  term: z.string().min(1),
  harness_run: HARNESS_RUN_FIELD,
});

/**
 * Input schema for lore_report_issue (SPEC-072 T5) — files a structured
 * lore-defect report into this CONSUMER corpus's configured upstream
 * (`feedback.upstream.repo` in `.lore/config.yaml` — GitHub only, see this
 * tool's own handler for why: `IssueReportService`, which used to speak the
 * legacy SQLite shape, is deleted outright in P4 of spec-the-defect-channel-
 * reaches-no-machine-but-its-own-github). The reporter is the call's own
 * identity (no `by` argument).
 * No `list` field on this surface — the CLI's `--list` (live-status join over
 * the local receipt log) has no MCP counterpart in this task's scope.
 *
 * §M6 (spec-the-defect-channel-cannot-be-honestly-maintained-an) adds the two
 * ORDERING-ONLY triage labels. They are declared HERE as well as on the CLI
 * deliberately: an agent surface that could not declare severity would push every
 * agent-filed report into the "no label" bucket while human CLI filings carried
 * one, making the column's meaning depend on which surface filed the row. ⛔ The
 * severity vocabulary is `ISSUE_SEVERITIES` (the shared SSOT), never a re-typed
 * `z.enum([...])` literal list, and ⛔ neither label changes any admission
 * decision on this surface either.
 */
export const LoreReportIssueSchema = z.object({
  harness_run: HARNESS_RUN_FIELD,
  title: z.string().min(1),
  description: z.string().min(1),
  expected: z.string().min(1),
  actual: z.string().min(1),
  repro_command: z.string().optional(),
  severity: z.enum(ISSUE_SEVERITIES).optional(),
  category: z.string().min(1).max(ISSUE_CATEGORY_MAX_LENGTH).optional(),
});

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

// ─── task-lore-evidence-add-and-lore-release-over-mcp-get-no ────────────────
// (this is the SECOND instance of one pattern in a single session — see the
// sibling fix for `deriveCommitSetForPlan`, task-the-mcp-assess-adapter-
// still-calls-derivecommitsetforplan — of an optional new parameter letting
// an adapter compile while providing NONE of the new behavior.)
//
// `commands/evidence.ts`/`commands/release.ts` (task-lore-evidence-and-lore-
// release-accept-an-attestation-from) populate `EvidenceInput.callerCwd`/
// `ReleaseOpts.callerCwd` with their own `process.cwd()` — a fresh CLI
// subprocess per invocation, so this is ALWAYS the real caller's directory.
// This MCP surface had NO equivalent wiring at all: neither
// `lore_evidence_add` nor `lore_release` passed `callerCwd`, so the Q3
// opt-in-hole close (a claim recording NO worktree, from a call plainly
// running inside a real git repo, refuses instead of silently passing) was
// silently absent for every MCP caller — exactly the pre-fix behavior.
//
// MCP has no equivalent to a fresh subprocess's `process.cwd()`: this
// server is a long-lived stdio process (see this module's own header) whose
// `process.cwd()` reflects wherever THAT PROCESS was launched, once, at
// startup — never "which directory the calling agent is logically operating
// in right now" (the SAME fact `lore_evidence_add`'s pre-existing
// `caller_cwd` field, added for the oracle-file-existence precheck, already
// documents). So this surface reuses that SAME caller-declared field for
// this SECOND purpose (evidence) and gains it fresh on `lore_release` (which
// had no `caller_cwd` field at all) — never the MCP server's own
// `process.cwd()`, which would be exactly the wrong value (see
// {@link resolveMcpCallerCwd}'s own JSDoc for why a wrong-but-plausible
// default is worse than an honest "not measured").
//
// MEASURED regression (this task's own dispatch, before landing): a naive
// "always thread `args.caller_cwd` through to `callerCwd` verbatim" design
// broke a PRE-EXISTING, unrelated passing test
// (`mcp-tools-task-workflow.test.ts`'s "AC-2.H1 (GREEN)" — the oracle-file
// precheck's OWN `caller_cwd` escape hatch) — that test supplies a REAL
// `caller_cwd` (`<repo>/packages/lore`, a real git working tree) on a task
// that was NEVER claimed at all, purely to help the precheck resolve a file.
// With a naive design, that SAME real path also flowed into the worktree
// guard's `callerCwd`, and since the task has no claim (`worktree ===
// undefined` collapses "claim exists without a worktree" and "no claim at
// all" into ONE branch inside the off-limits `checkUncommittedAttestationWorktree`
// — see that function's own JSDoc), the Q3 mismatch fired: `isInsideGitRepo`
// on a real repo path → refused. This is EXACTLY the widening AC-7 forbids
// ("the CLI's Q3 close targets a claim that RECORDED NO WORKTREE, not the
// absence of a claim; do not widen that"). Fix (HISTORICAL — this adapter-
// side helper was removed 2026-08-02, see the correction note below):
// `hasRecordedTaskClaim` gated whether a REAL `callerCwd` reaches the
// worktree guard at all — a task with no claim recorded got the
// not-measured sentinel for THIS purpose regardless of what `caller_cwd`
// the caller supplied, while the oracle-file precheck's OWN (unrelated,
// pre-existing) use of the SAME raw `args.caller_cwd` value was completely
// untouched by this gate.
//
// adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the — the
// three-question review this fix answers:
//
//   Q1 Proxy — is "an MCP tool call supplied `caller_cwd`" a proxy for "the
//     calling agent's real directory is known", or the property itself? It
//     is necessarily a PROXY: a caller can pass any string it likes,
//     including a stale or fabricated path. Accepted, with the same
//     mitigation the CLI's identical precheck field already relies on: the
//     value is used ONLY to ask `isInsideGitRepo` a yes/no question (never
//     trusted as "this exact tree is what was verified") — a fabricated
//     value that happens to resolve to SOME real repo produces, at worst,
//     the SAME refusal-or-pass a genuine caller_cwd would, never a forged
//     PASS on a dirty tree (the primary whole-worktree predicate stays keyed
//     off the claim's own recorded worktree, completely unaffected by this
//     field — see the module section header in task-workflow-service.ts).
//     A SECOND proxy layer used to sit on top (HISTORICAL — see the
//     correction note below): `hasRecordedTaskClaim` was itself a proxy for
//     "this call is plausibly about an actively-claimed task" — a
//     stale/foreign claim still counted. Accepted then, moot now: the
//     worktree guard's OWN authorization checks (holder/force) run
//     independently and are completely unaffected either way.
//   Q2 Silence — what does this do when the calling agent supplies NO
//     `caller_cwd`, OR when the target has no recorded claim at all? Reusing
//     the MCP server's own `process.cwd()` as a silent default was
//     REJECTED: it is almost always SOME real repo path (the server has to
//     be launched from somewhere), so it would manufacture spurious Q3
//     refusals for every caller that simply never declared its directory —
//     the "silence bug one level down" this task's own filing warns against
//     (conflating "MCP cannot know" with "the claim recorded no worktree").
//     Instead, {@link resolveMcpCallerCwd} returns the DISTINCT,
//     never-a-real-path sentinel {@link NOT_MEASURED_NO_CALLER_CWD} —
//     `isInsideGitRepo` deterministically reports `false` for it (verified
//     by this file's own test suite AND by the regression this section's
//     header describes), so BOTH "no caller_cwd declared" and "no claim
//     recorded at all" degrade to "not measured" (no fabricated refusal),
//     never silently reusing the server's own irrelevant cwd.
//   Q3 Opt-in — does this bind every MCP call, or only those that opt in?
//     `caller_cwd` stays OPTIONAL on both schemas (an agent that genuinely
//     does not know its own directory must not be forced to fabricate one,
//     and the majority of evidence/release calls have nothing to do with
//     the worktree guard at all). What is NOT optional is the WIRING itself:
//     {@link resolveMcpCallerCwd} takes a REQUIRED parameter, so every call
//     site in THIS file that constructs an evidence/release input MUST
//     explicitly resolve a `callerCwd` value — omitting the argument at a
//     call site is a compile error (`TS2554`), not a silent omission. A
//     FUTURE fourth adapter (or a new branch in this file) can still choose
//     not to call this helper at all, same residual limitation the sibling
//     `deriveCommitSetForPlan` fix already accepts — required-at-the-
//     boundary is the strongest closure available without editing the
//     off-limits service file that owns `EvidenceInput`/`ReleaseOpts`.
//
// ⛔ CORRECTED 2026-08-02 (task-the-uncommitted-worktree-guard-treats-no-
// claim-at-all-as-a) — Q1's "SECOND proxy layer", `hasRecordedTaskClaim`,
// and Q2's "no claim recorded at all" branch above are HISTORICAL: they
// described an adapter-side workaround for a bug in
// `TaskWorkflowService.checkUncommittedAttestationWorktree` itself (it could
// not tell "no claim at all" apart from "a claim recording no worktree" —
// both read as `claim?.worktree === undefined`). That bug is now fixed AT
// THE SERVICE (`hasRecordedClaim` in task-workflow-service.ts), so this
// adapter no longer needs — and no longer carries — its own copy of the same
// predicate. `resolveMcpCallerCwd` now takes ONE parameter and always
// resolves `callerCwdArg ?? NOT_MEASURED_NO_CALLER_CWD` — the "no claim
// recorded" degrade-to-not-measured behavior above is now the SERVICE's
// unconditional behavior for every adapter, not a fact this file has to
// compute and forward. Two adapters independently re-deriving "is there
// actually a claim" is exactly how the next divergence would hide — the
// same argument this corpus already used to make `deriveCommitSetForPlan`'s
// parameters required.

/**
 * Distinct sentinel meaning "this MCP call has no REAL `callerCwd` to offer
 * the worktree guard's Q3 check" (AC2, task-lore-evidence-add-and-lore-
 * release-over-mcp-get-no) — the caller declared no `caller_cwd` at all.
 * Passed through to `TaskWorkflowService.addEvidence`/`release`'s
 * `callerCwd` parameter so the Q3 mismatch check
 * (`checkUncommittedAttestationWorktree`,
 * task-lore-evidence-and-lore-release-accept-an-attestation-from) degrades
 * to "not a git repo" (`isInsideGitRepo` is a real `git rev-parse`
 * subprocess call against this literal string as a `cwd` — it fails to
 * resolve, and that failure mode degrades to `false` by that function's own
 * "never throws" contract) rather than silently reusing the CLI's
 * `undefined`-means-"skip-the-check" semantics for the ENTIRELY DIFFERENT
 * reason of "MCP genuinely cannot observe its caller's directory". Never a
 * real filesystem path by construction (no leading `/`, embeds characters no
 * real caller_cwd would ever legitimately carry) — see the module section
 * header above for the full Q1/Q2/Q3 review.
 */
const NOT_MEASURED_NO_CALLER_CWD = "<not-measured-no-caller-cwd>";

/**
 * Resolves the `callerCwd` argument threaded to
 * `TaskWorkflowService.addEvidence`/`release`'s uncommitted-worktree
 * attestation guard (task-lore-evidence-and-lore-release-accept-an-
 * attestation-from Q3) from an MCP tool's own caller-declared `caller_cwd`
 * schema field — the REQUIRED parameter here (not optional) is the
 * mechanization this task exists to add: every call site in this file that
 * builds an evidence/release service input must explicitly resolve a value
 * through this function, so a future call site cannot silently omit
 * `callerCwd` the way `lore_evidence_add`/`lore_release` themselves did
 * before this fix (see the module section header above) — and cannot
 * silently repeat the MEASURED regression that same header describes either
 * (a real `caller_cwd` leaking into the guard for a never-claimed task).
 *
 * ⛔ No longer takes a `hasRecordedClaim` parameter (removed 2026-08-02,
 * task-the-uncommitted-worktree-guard-treats-no-claim-at-all-as-a): that
 * parameter existed only to stop a never-claimed task's real `caller_cwd`
 * from reaching the worktree guard, because the SERVICE itself could not
 * yet tell "no claim at all" apart from "a claim recording no worktree".
 * The service now makes that distinction unconditionally
 * (`hasRecordedClaim` in task-workflow-service.ts) — this adapter passing
 * through a real `callerCwd` for an unclaimed task is now harmless, since
 * `checkUncommittedAttestationWorktree` short-circuits to "proceed" before
 * it ever looks at `callerCwd` in that case.
 *
 * @param callerCwdArg - The tool's own `caller_cwd` input field, verbatim
 *   (still OPTIONAL at the MCP schema level — see the module section header
 *   above for why forcing every caller to supply one is NOT the fix here).
 * @returns `callerCwdArg` unchanged when supplied; {@link
 *   NOT_MEASURED_NO_CALLER_CWD} otherwise.
 * @example
 * resolveMcpCallerCwd("/Users/agent/worktree"); // => "/Users/agent/worktree"
 * @example
 * resolveMcpCallerCwd(undefined); // => "<not-measured-no-caller-cwd>"
 */
function resolveMcpCallerCwd(callerCwdArg: string | undefined): string {
  return callerCwdArg ?? NOT_MEASURED_NO_CALLER_CWD;
}

// ─── spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5 ─────
// (AC-CP-5, "MCP inherits the guard via caller_cwd")

/**
 * Resolves the {@link ForeignCorpusWriteContext.provenance} an MCP non-
 * lifecycle write should hand the foreign-corpus-write guard for THIS call
 * (spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5's
 * adapter matrix, "MCP inherits"). Reuses the CLI adapter's OWN
 * composition-boundary function, `resolveCorpus` (`../cli/corpus-
 * resolution.js`), against `callerCwdArg` exactly as if that path were a
 * fresh CLI subprocess's own `process.cwd()` — deliberate reuse of the
 * identical resolution mechanism `loader.ts` already uses, never a second
 * implementation of it.
 *
 * ABSENT `caller_cwd` (the schema field is optional) is treated EXACTLY
 * like HTTP's own named exemption (§D5's adapter-matrix row): `null`,
 * which makes `checkForeignCorpusWrite` always allow regardless of
 * `enabled`. This is a DECISION, not an omission — an agent that supplies
 * no directory has given this guard no per-call caller directory to reason
 * about at all, and "cannot know" collapses to the SAME `null` treatment as
 * "measured and it's fine" (`foreign-corpus-write-guard.ts`'s own module
 * header already documents this for every adapter with no per-call caller
 * directory). The alternative — falling back to THIS SERVER's own frozen
 * startup `process.cwd()` — was rejected: it would silently reintroduce the
 * exact staleness `caller_cwd`'s sibling fields on `lore_evidence_add`/
 * `lore_release` already exist to avoid (module header above
 * `resolveMcpCallerCwd`), and would make the guard's answer depend on
 * wherever THIS long-lived server happened to be launched from rather than
 * on the calling agent's actual location.
 *
 * @param callerCwdArg - The tool's own `caller_cwd` input field, verbatim.
 * @returns The resolved `CorpusProvenance`, or `null` when `callerCwdArg`
 *   is absent (never calls `resolveCorpus` in that case).
 * @example
 * resolveMcpCorpusProvenance("/repo/.claude/worktrees/agent-x");
 *   // => "git_common_dir" (nested worktree, no own .lore/, repo has one)
 * @example
 * resolveMcpCorpusProvenance("/repo"); // => "own" (repo's own .lore/ present)
 * @example
 * resolveMcpCorpusProvenance(undefined); // => null — HTTP's own treatment
 */
function resolveMcpCorpusProvenance(callerCwdArg: string | undefined): CorpusProvenance | null {
  if (callerCwdArg === undefined) return null;
  return resolveCorpus(callerCwdArg)?.provenance ?? null;
}

/**
 * Runs the foreign-corpus-write guard (spec-corpus-resolution-carries-
 * provenance-and-a-foreign-write §D5, AC-CP-5(a)/(b)) for an MCP NON-
 * LIFECYCLE write tool call. `intentDeclared` is always `false` here,
 * mirroring `CorpusService.refuseIfForeignCorpusWrite`'s identical `false`
 * for the CLI's own non-lifecycle writes — none of `create`/`set`/`link`/
 * `unlink`/`delete` have a task-claim lease to declare intent on.
 * `lore_create` is the one MCP tool wired to this today (the only tool
 * carrying a `caller_cwd` field of this shape); the check itself is
 * adapter-agnostic and reusable the moment a future task threads
 * `caller_cwd` through another non-lifecycle write tool.
 *
 * Emits the SAME `FOREIGN_CORPUS_WRITE_TOKEN`-carrying `LoreError` the
 * CLI's own `refuseIfForeignCorpusWrite` produces — both surfaces call the
 * SAME exported `checkForeignCorpusWrite`/`foreignCorpusWriteRefusalError`
 * pair, never a paraphrased MCP-side copy (AC-CP-5(a)'s "one vocabulary
 * across both surfaces, asserted by equality against the CLI string").
 *
 * @param callerCwdArg - The tool's own `caller_cwd` input field, verbatim.
 * @param getConfig - The SAME zero-arg config getter `registerTools`
 *   receives, called PER INVOCATION (not memoized) so a long-lived server
 *   observes a mid-session `.lore/config.yaml` edit to
 *   `workflow.gates."corpus-write".foreign_corpus_write.enabled` — mirrors
 *   this file's pre-existing `resolveCaptureTimeoutMs(getConfig?.())` call
 *   convention.
 * @returns `undefined` when the write may proceed; a ready-to-return
 *   `errorContent(...)` payload when it must be refused.
 * @example
 * checkMcpForeignCorpusWrite("/repo/.claude/worktrees/agent-x", undefined);
 *   // => { content: [...], isError: true } — refused, foreign provenance
 * @example
 * checkMcpForeignCorpusWrite(undefined, undefined);
 *   // => undefined — no per-call caller directory, guard inert
 */
function checkMcpForeignCorpusWrite(
  callerCwdArg: string | undefined,
  getConfig: (() => LoreConfig | undefined) | undefined,
): ReturnType<typeof errorContent> | undefined {
  const verdict = checkForeignCorpusWrite(
    {
      provenance: resolveMcpCorpusProvenance(callerCwdArg),
      enabled: resolveForeignCorpusWriteGateEnabled(getConfig?.()),
    },
    false,
  );
  return verdict.allowed ? undefined : errorContent(foreignCorpusWriteRefusalError(verdict));
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
/**
 * The args an attested tool's handler receives: `harness_run` removed, `by` ALWAYS present as the call's
 * resolved name (no tool schema declares it — the wrapper supplies it, so a handler can hand the writer name to a
 * service without a second resolution), and `recorded_by` (when the schema has it) filled the same way.
 * A schema without `harness_run` is unchanged.
 */
type ResolvedArgs<T> = "harness_run" extends keyof T
  ? Omit<T, "harness_run" | "by" | "recorded_by"> & { by: string } &
      ("recorded_by" extends keyof T ? { recorded_by: string } : unknown)
  : T;

function registerToolImpl<T>(
  server: McpServer,
  scope: McpCallScope,
  name: string,
  desc: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  handler: (args: ResolvedArgs<T>) => Promise<CallToolResult>,
): void {
  // reason: spec-run-identity-slice-1 D3 — a schema that declares `harness_run` is an ATTESTED tool: every call
  // runs in its own call scope (identity from harness_run alone, store wrapped for that call). The handler then gets
  // `by`/`recorded_by` FILLED from the call's resolved name (no MCP caller names itself — BR-1055) and
  // never sees `harness_run` (it would otherwise leak into `...patch` spreads).
  const shape = schema instanceof z.ZodObject ? (schema.shape as Record<string, unknown>) : {};
  const attested = "harness_run" in shape;
  // Step 1: 3-arg registration — avoids ZodRawShapeCompat inference entirely
  // The handler is cast to () => Promise<CallToolResult> so TypeScript resolves
  // it as ToolCallback<undefined> (no ShapeOutput computation).
  // reason: AC-BLC-1 — each MCP tool call declares its audit surface explicitly (per call, not process state).
  const surfaced = (args: T): Promise<CallToolResult> =>
    runWithAuditSurface("mcp", () => {
      if (!attested) return handler(args as unknown as ResolvedArgs<T>);
      const { harness_run: harnessRun, ...rest } = args as unknown as Record<string, unknown> & { harness_run?: string };
      return scope.run({ harness_run: harnessRun }, (context) => {
        const resolved: Record<string, unknown> = { ...rest };
        // reason: a schema that still declares `by` is a read-side FILTER (lore_bootstrap, pinned in
        // read-side-by-filters.ts); it keeps the caller's value and defaults to the call's own name.
        resolved["by"] = "by" in shape && typeof rest["by"] === "string" ? rest["by"] : context.identity.claimed;
        if ("recorded_by" in shape) resolved["recorded_by"] = rest["recorded_by"] ?? context.identity.claimed;
        return handler(resolved as ResolvedArgs<T>);
      });
    });
  server.tool(name, desc, surfaced as unknown as () => Promise<CallToolResult>);

  // Step 2: Post-registration inputSchema patch — restores correct runtime routing.
  // The SDK reads tool.inputSchema at CALL TIME (not registration time), so patching
  // here ensures validateToolInput → handler(validatedArgs, extra) path is taken.
  const registry = server as unknown as McpToolRegistry;
  const registered = registry._registeredTools[name];
  if (registered) {
    // reason: spec-run-only-write-identity-and-run-end-claim-release AC-ROI-1 — a retired `by` (or any other
    // undeclared key) must FAIL the call, not be stripped: zod's default object mode silently drops unknown
    // keys, which would attribute the write to the server's own name while the caller believed it named itself.
    registered.inputSchema = schema instanceof z.ZodObject ? schema.strict() : schema;
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
  const loaded = loadTreeBlueprint(process.cwd());
  if (loaded.status === "missing") return { ok: true, value: undefined };
  if (loaded.status === "invalid") return { ok: false, error: loaded.error };
  return { ok: true, value: loaded.blueprint };
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
 * Registers all 33 lore_* MCP tools on the given server (16 original + 4 SPEC-025
 * task-workflow tools: lore_claim, lore_release, lore_evidence_add, lore_ready;
 * + lore_assess (SPEC-026); + lore_audit (SPEC-035); + lore_review (SPEC-034);
 * + lore_verify (SPEC-039); + lore_feed (IoC vertical-slice tech-spec §4.1/§11 P4);
 * + lore_bootstrap, lore_handoff (SPEC-041 §3 D2, D3, D6) — lore_feed additionally
 * gains a session-resume dispatch branch (SPEC-041 §3 D5)
 * + lore_anchor_set (SPEC-042 §Design Decisions D9) — lore_claim gains machine/
 * worktree, lore_create gains file_anchors
 * + lore_invalidate (SPEC-043 §Design Decisions D6) — lore_get gains computed
 * validity_state, lore_create gains supersedes, lore_search/lore_list gain
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
 * SPEC-070 F6 (config-staleness fix, supersedes the AC-070-9 snapshot): `registerTools`
 * gains an ADDITIVE optional third `getConfig` param — a GETTER (`() => LoreConfig |
 * undefined`), not a one-time `LoreConfig` value. `lore --mcp-server` is a long-lived
 * process; a config VALUE closed over at server-start (the pre-fix shape) could never
 * observe a `.lore/config.yaml` edit made after the server started — the CLI never had
 * this problem, since every CLI invocation is a fresh process that re-reads config from
 * scratch. `packages/lore/src/index.ts`'s `--mcp-server` branch now threads
 * `../cli/loader.js::loadProjectConfig` itself (re-runs the SAME canonical parse
 * `loadLoreApp` performs, never a second hand-rolled YAML read) as this getter, so the
 * "task-start" branch below calls `getConfig?.()` FRESH on every `lore_feed` invocation.
 * Every pre-existing call site (every test in this file) omits the third arg —
 * `getConfig` stays `undefined`, `getConfig?.()` short-circuits to `undefined`, and
 * `resolveTaskStartBudgets(undefined)` returns `{}`, so the "task-start" branch falls
 * back to `DEFAULT_TASK_START_BUDGETS` exactly as before (REGRESSION-safe). Only the
 * "task-start" branch calls it today — no other tool reads config yet, mirroring
 * `lore_staleness_probe`'s per-call `limit`/`min_age_days` override precedent (that one
 * takes the override as a per-call ARG instead, since MCP previously had no
 * config-threading seam at all; this is the first tool to close that gap for one
 * section).
 *
 * @param server - The McpServer instance to register tools on
 * @param app - The composition root providing access to all services
 * @param getConfig - A zero-arg getter returning the parsed project
 *   `.lore/config.yaml` (or `undefined` when none was found/parsed), called ONCE
 *   PER "task-start" `lore_feed` invocation rather than read from a closed-over
 *   snapshot — see this function's own JSDoc above for why a getter, not a value.
 */
export function registerTools(server: McpServer, baseApp: App, getConfig?: () => LoreConfig | undefined): void {
  // reason: spec-run-identity-slice-1 D3 — handlers are registered ONCE but each attested call runs against its own
  // call-scoped App (see call-scope.ts). `app` and the service names below are live views that resolve to the
  // current call's App, so handler bodies stay unchanged.
  const scope = new McpCallScope(baseApp);
  const app = scope.app;
  const corpusService = scope.service("corpusService");
  const versionService = scope.service("versionService");
  const reviewService = scope.service("reviewService");
  const outlineService = scope.service("outlineService");
  const taskWorkflowService = scope.service("taskWorkflowService");
  const auditService = scope.service("auditService");
  const judgmentService = scope.service("judgmentService");
  // reason: shadows the module-level registrar so every one of the call sites below binds this server's call scope.
  const registerToolWithArgs = <T,>(
    srv: McpServer,
    name: string,
    desc: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    handler: (args: ResolvedArgs<T>) => Promise<CallToolResult>,
  ): void => registerToolImpl(srv, scope, name, desc, schema, handler);

  // lore_create
  registerToolWithArgs(server, "lore_create", "Create a new document in the Lore corpus", LoreCreateSchema, async (args) => {
    // spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5,
    // AC-CP-5(a)/(b) — checked FIRST, before any other side effect
    // (including the AI-generation call below), so a refused write never
    // spends an AI call first. See checkMcpForeignCorpusWrite's own header.
    const foreignWriteRefusal = checkMcpForeignCorpusWrite(args.caller_cwd, getConfig);
    if (foreignWriteRefusal !== undefined) return foreignWriteRefusal;

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

    // SPEC-058 hotfix (plan-add-requires-uat-authoring-path): match the CLI's
    // `TYPE_SPECIFIC_FLAGS` mismatch-rejection stance for --requires-uat — a
    // `requires_uat: true` on any non-plan type is a VALIDATION_ERROR, never a
    // silent ignore, so the CLI and MCP surfaces cannot silently diverge on
    // what a legal combination is.
    if (args.requires_uat === true && args.type !== "plan") {
      return errorContent({
        code: "VALIDATION_ERROR",
        field: "requires_uat",
        message: `requires_uat is only valid for type "plan" (got "${args.type}").`,
        value: args.requires_uat,
      });
    }

    // Strip the `ai`/`file_anchors`/`requires_uat`/`supersedes`/`caller_cwd` and the wrapper-supplied `by`
    // fields before passing to corpusService.create — none is a corpus field;
    // file_anchors (SPEC-042 D9) and requires_uat (SPEC-058 hotfix, plan branch
    // only, `true` only) are folded into `extra` here so CorpusService._createImpl's
    // single validation gate sees them the same way it would from a raw extra.*
    // payload; caller_cwd was already consumed above by checkMcpForeignCorpusWrite.
    const { ai: _ai, file_anchors: fileAnchors, requires_uat: requiresUat, supersedes, by, caller_cwd: _callerCwd, ...createInput } = args;
    let mergedExtra = createInput.extra;
    if (fileAnchors !== undefined) {
      mergedExtra = { ...(mergedExtra ?? {}), file_anchors: fileAnchors };
    }
    if (createInput.type === "plan" && requiresUat === true) {
      mergedExtra = { ...(mergedExtra ?? {}), requires_uat: true };
    }
    const resolvedCreateInput = {
      ...createInput,
      content: resolvedContent,
      ...(mergedExtra !== undefined ? { extra: mergedExtra } : {}),
    };

    // SPEC-043 §Design Decisions D11 — `supersedes` composes create() THEN
    // ValidityService.invalidate() via the SAME shared orchestration the CLI's
    // `lore create --supersedes` uses (flows/supersede-flow.ts) — never a second,
    // divergent implementation of the half-failure handling. That orchestration also
    // owns the target-type eligibility precheck (task-mcp-lore-create-supersedes-
    // still-creates-then-fails-the) — it resolves `supersedes` and refuses BEFORE
    // `corpusService.create` runs, via the injected `get` port below, so this handler
    // never re-implements (or omits) that predicate.
    if (supersedes !== undefined) {
      if (app.validityService === undefined) {
        return errorContent({ code: "STORE_ERROR", message: "Internal error: ValidityService not wired on App" });
      }
      const orchResult = await createWithSupersedes(
        {
          get: corpusService.get.bind(corpusService),
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

    // SPEC-079 G2 — thread the caller-supplied actor (optional; omitted falls
    // back to CorpusService's own env-chain resolution).
    const result = await corpusService.create(
      resolvedCreateInput,
      by !== undefined ? { by } : undefined,
    );
    if (!result.ok) return errorContent(result.error);
    const { id, slug, type, status, version, orphan_advisory } = result.value;
    const payload: Record<string, unknown> = { id, slug, type, status, version };
    // Create-time orphan advisory (task-create-time-orphan-advisory-warn-or-default-
    // parent-to-root) — non-blocking, present only when CorpusService.create computed
    // one; never affects `isError`/the response's other fields.
    if (orphan_advisory !== undefined) payload["orphan_advisory"] = orphan_advisory;
    // Non-resolving `file_anchors` advisory (task-a-mistyped-task-file-anchor-is-
    // stored-and-consulted, Required #1). An MCP caller has no stderr channel it
    // reads, so the advisory travels IN the payload — same non-blocking contract
    // as `orphan_advisory` above: never sets `isError`, never blocks the write,
    // and the anchor is stored regardless (a task legitimately anchors a file it
    // is about to create). Probes the STORED, normalized anchors, so what is
    // reported is exactly what `noAnchorOverlap` will consult.
    const createdAnchors = extractFileAnchors(result.value);
    if (createdAnchors.length > 0) {
      payload["anchor_resolution"] = collectFileAnchorResolution(createdAnchors, buildFileAnchorProbeContext());
    }
    return textContent(payload);
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
    // reason: the call's `by` (supplied by the attested-call wrapper) is destructured OUT of the patch — it's an actor
    // identity for the audit entry, not a doc field; docPatchSchema doesn't declare
    // it, so leaving it inside `patch` would just be silently stripped there instead.
    // `correction` is destructured out for the same reason (spec-documents-are-living-or-records D15): it is
    // a write option, and docPatchSchema would silently strip it from the patch.
    const { id_or_slug, by, correction, ...patch } = args;
    const result = await corpusService.set(id_or_slug, patch, setOptionsFrom(by, correction));
    if (!result.ok) return errorContent(result.error);
    return textContent({ doc: result.value, version: result.value.version });
  });

  // lore_delete
  registerToolWithArgs(server, "lore_delete", "Soft-delete a document (requires confirm: true)", LoreDeleteSchema, async (args) => {
    const result = await corpusService.delete(
      args.id_or_slug,
      args.confirm,
      args.by !== undefined ? { by: args.by } : undefined,
    );
    if (!result.ok) return errorContent(result.error);
    return textContent(result.value);
  });

  // lore_list
  registerToolWithArgs(server, "lore_list", "List documents matching optional filters", LoreListSchema, async (args) => {
    const { type, status, since, author, tag, limit, offset, governed_by, include_invalid, sub_type } = args;

    // reason: the SAME `resolveSubTypeFilter` seam the CLI's `lore list` consumes
    // (spec-a-write-side-fact-with-no-read-side-address-counts-with-no §M3) — a
    // sub_type is only meaningful under type "knowledge", and a contradictory
    // combination is refused BY NAME rather than returning an exit-0/no-isError
    // empty `docs` array, which an agent cannot distinguish from "no such docs".
    // The refusal is mapped to this surface's vocabulary (isError) while the CLI
    // maps the same message to exit 2; ⛔ the RULE itself is never re-derived here.
    const subTypeResolution = resolveSubTypeFilter(sub_type, type);
    if (!subTypeResolution.ok) {
      return errorContent({
        code: "VALIDATION_ERROR",
        field: "sub_type",
        message: subTypeResolution.message,
        value: sub_type,
      });
    }

    // reason: pagination hardening (unbounded-payload review) — an omitted `limit`
    // defaults to MCP_LIST_DEFAULT_LIMIT (never an unpaged corpus-wide fetch on this
    // agent-facing surface, unlike the CLI). `probeLimit` fetches ONE row past the
    // effective page so `truncated` can be derived WITHOUT a separate corpus-wide
    // COUNT query — never a silent cap, see LoreListSchema's JSDoc.
    const effectiveLimit = limit ?? MCP_LIST_DEFAULT_LIMIT;
    const probeLimit = effectiveLimit + 1;

    // governed_by is a link-table reverse query, not a StoreFilters column predicate —
    // short-circuits to its own service method, same as the CLI's --governed-by branch.
    // listGovernedBy has no store-level limit/offset param, so paging (incl. the
    // truncation probe) is applied in-memory to its already-fetched result.
    if (governed_by !== undefined) {
      // reason: `governed_by` short-circuits to a link traversal that never builds
      // the `filters` object below, so a `sub_type` passed alongside it would be
      // SILENTLY IGNORED — the caller would get an unfiltered governed-artifact
      // list and no signal that their filter did nothing. The CLI refuses the same
      // pair (`--governed-by`'s `otherFilterKeys` names `sub-type`), so refuse it
      // here too rather than let the two surfaces disagree on what is legal.
      // ⛔ Do not "simplify" this into a silent drop to match how `type`/`status`
      // behave on this branch: that pre-existing silence is the defect this repo
      // keeps paying for, not a pattern to extend.
      if (sub_type !== undefined) {
        return errorContent({
          code: "VALIDATION_ERROR",
          field: "sub_type",
          message:
            "Error: sub_type cannot be combined with governed_by — governed_by is a link " +
            "traversal, not a column filter, and would silently ignore it.",
          value: sub_type,
        });
      }
      // SPEC-043 D3 / task-validity-landed-on-lore-list-only-the-dispatch-surface
      // Required #6 — `include_invalid` is FORWARDED to the service method, which owns
      // both the default exclusion and the `validity_status` projection. This branch
      // applies neither itself: gating it here instead would leave the CLI's
      // `--governed-by` and this tool derived from one traversal but two policies.
      const governedResult = await corpusService.listGovernedBy(governed_by, {
        include_invalid: include_invalid === true,
      });
      if (!governedResult.ok) return errorContent(governedResult.error);
      const windowed = governedResult.value.docs.slice(offset ?? 0, (offset ?? 0) + probeLimit);
      const truncated = windowed.length > effectiveLimit;
      const docs = truncated ? windowed.slice(0, effectiveLimit) : windowed;
      return textContent({ docs, total: docs.length, truncated });
    }

    const filters = {
      ...(type !== undefined ? { type } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(since !== undefined ? { since } : {}),
      ...(author !== undefined ? { created_by: author } : {}),
      ...(tag !== undefined ? { tags: [tag] } : {}),
      // SPEC-043 D3 — mirrors the CLI's --include-invalid flag.
      ...(include_invalid === true ? { include_invalid: true } : {}),
      // reason: forwarded into StoreFilters so the DB applies it alongside
      // LIMIT/OFFSET below. ⛔ Deliberately NOT filtered over `result.value.docs`
      // afterwards: this surface's `probeLimit` page is bound in SQL, so a
      // post-fetch sub_type pass would make `truncated` lie (rows dropped after
      // the limit+1 probe) on top of the paging bug M3 forbids.
      ...(subTypeResolution.sub_type !== undefined ? { sub_type: subTypeResolution.sub_type } : {}),
      // pagination hardening — store-level LIMIT/OFFSET, never an unpaged fetch.
      limit: probeLimit,
      ...(offset !== undefined ? { offset } : {}),
    };
    const result = await corpusService.list(filters);
    if (!result.ok) return errorContent(result.error);
    const truncated = result.value.docs.length > effectiveLimit;
    const docs = truncated ? result.value.docs.slice(0, effectiveLimit) : result.value.docs;
    return textContent({ docs, total: docs.length, truncated });
  });

  // lore_search
  registerToolWithArgs(server, "lore_search", "Full-text search across the corpus", LoreSearchSchema, async (args) => {
    const { query, type, limit, include_invalid, sub_type } = args;

    // reason: same shared seam as lore_list above / the CLI's `lore search` — see
    // the lore_list handler's comment for why a refusal must be isError here
    // rather than an empty `results` array.
    const subTypeResolution = resolveSubTypeFilter(sub_type, type);
    if (!subTypeResolution.ok) {
      return errorContent({
        code: "VALIDATION_ERROR",
        field: "sub_type",
        message: subTypeResolution.message,
        value: sub_type,
      });
    }

    const filters = {
      ...(type !== undefined ? { type } : {}),
      // SPEC-043 D3 — mirrors the CLI's --include-invalid flag.
      ...(include_invalid === true ? { include_invalid: true } : {}),
      // reason: forwarded into StoreFilters so the FTS5→docs join applies it —
      // ⛔ never a filter over `result.value.results`, which `limit` below already
      // slices (the CLI header records why that ordering breaks the query).
      ...(subTypeResolution.sub_type !== undefined ? { sub_type: subTypeResolution.sub_type } : {}),
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
    const result = await corpusService.link(
      args.from,
      args.to,
      linkType,
      args.by !== undefined ? { by: args.by } : undefined,
    );
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
    // reason: the approver is the call's own identity (the attested run's name) — there is no `reviewer`
    // argument, so an approve is never recorded under the literal "system".
    const reviewer = args.by;
    const result = await reviewService.approve(args.id_or_slug, { reviewer });
    if (!result.ok) return errorContent(result.error);

    // reason: SPEC-033 F1 — MCP's lore_approve is an adjudication tool, same as CLI
    // approve/HTTP dashboard approve; it MUST feed the same calibration loop, not a
    // second-class copy. The hook's `actor` is the same `reviewer` the approve was
    // recorded under. actedOnVersion = result.value.version - 1 since
    // approve() bumps the version (identical to CLI approve.ts / HTTP dashboard
    // handleDashboardApprove's computation).
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

  // lore_reopen
  registerToolWithArgs(
    server,
    "lore_reopen",
    "Reopen an approved spec that has no evidence yet, moving it back to draft so it can be edited (refused when any task holds evidence for it)",
    LoreReopenSchema,
    async (args) => {
      // reason: exactOptionalPropertyTypes - only pass reviewer when defined
      const opts = args.reviewer !== undefined ? { reviewer: args.reviewer } : {};
      const result = await reviewService.reopen(args.id_or_slug, args.reason, opts);
      if (!result.ok) return errorContent(result.error);
      return textContent({ doc: result.value });
    },
  );

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

    // reason: SPEC-102 — a SEPARATE kind="context_bundle" trace row, distinct
    // from the kind="get" row `corpusService.get` above already fired
    // (a different consumption pattern — the whole navigation bundle, not a
    // single doc read). A no-op when trace.enabled resolves false.
    app.traceRecorder?.recordContextBundle(resolveActorWithSource(undefined, process.env).actor);

    return textContent({ target: doc, linked_specs: linkedSpecs, related_adrs: relatedAdrs, active_plans: activePlans });
  });

  // lore_batch
  registerToolWithArgs(server, "lore_batch", "Execute multiple operations in sequence", LoreBatchSchema, async (args) => {
    const results: unknown[] = [];
    for (const operation of args.operations) {
      const opResult = await executeBatchOp(operation.op, operation.args, app, args.by);
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
    // reason: spec-run-identity-slice-1 D6 — the claimant's run is the call's VERIFIED run, passed EXPLICITLY
    // (services that decide on identity never read ambient state); `scope.run` verified it once for this call.
    const callIdentity = requireCallIdentity(scope);
    const result = await taskWorkflowService.claim(args.id_or_slug, {
      by: args.by,
      harnessRun: callIdentity.harnessRun,
      ...(args.branch !== undefined ? { branch: args.branch } : {}),
      ...(args.machine !== undefined ? { machine: args.machine } : {}),
      ...(args.worktree !== undefined ? { worktree: args.worktree } : {}),
      ...(args.corpus_scope !== undefined ? { corpusScope: args.corpus_scope } : {}),
      // reason: claim-time-actor-identity-guard-zero-evidence-release-advis
      // AC-IDENTITY-REJECT — the real source of the name: the tier the server's own name
      // chain resolved it from — so an OS-user fallback name is still the
      // "os-fallback" tier `actorIdentityGuard` reacts to.
      identitySource: actorSourceOfName(callIdentity.claimedSource),
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
      // reason: spec-run-identity-slice-1 D6/BR-1043 — only the holding run releases without force.
      harnessRun: requireCallIdentity(scope).harnessRun,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      force: args.force === true,
      source: "mcp",
      // reason: task-lore-evidence-add-and-lore-release-over-mcp-get-no —
      // wires the uncommitted-worktree attestation guard's Q3 mismatch check
      // through to this surface (see this file's own module section header
      // above `resolveMcpCallerCwd` for the full three-question review; the
      // "absence of a claim" distinction is now made by the SERVICE itself,
      // task-the-uncommitted-worktree-guard-treats-no-claim-at-all-as-a, so
      // this call site no longer needs its own claim pre-check).
      callerCwd: resolveMcpCallerCwd(args.caller_cwd),
    });
    if (!result.ok) return errorContent(result.error);
    // reason: AC-RELEASE-ADVISORY — same `hasZeroReleaseEvidence` check the CLI's
    // `commands/release.ts` applies; `warnings` is omitted entirely (not an empty
    // array) on the >=1-evidence path — REGRESSION: byte-identical to pre-AC-
    // RELEASE-ADVISORY output.
    if (hasZeroReleaseEvidence(result.value)) {
      return textContent({ doc: result.value, warnings: [ZERO_EVIDENCE_RELEASE_WARNING] });
    }
    return textContent({ doc: result.value });
  });

  // lore_evidence_add
  // reason: SPEC-056 target-type dispatch (task-skill-implement-cli-mcp-surfaces-
  // checklist-ref-evidence) — mirrors the CLI `lore evidence` command's dispatch
  // exactly: try taskWorkflowService FIRST, UNCHANGED (byte-identical for every
  // non-phase target, REGRESSION); retry via phaseWorkflowService ONLY on its own
  // {field: "type", value: "phase"} rejection.
  registerToolWithArgs(server, "lore_evidence_add", "Append an oracle verification record to a task or phase", LoreEvidenceAddSchema, async (args) => {
    // reason: runner capture (task-mcp-lore-evidence-add-cannot-set-capture-
    // source-and-has-no) — resolved FIRST, in the same order the CLI's
    // `commands/evidence.ts` uses (conflict guard → spawn → missing-oracle-file
    // → mixed-runner → filtered-pass), so the downstream guards below see the
    // CAPTURED tail rather than an absent one and neither surface can gate on a
    // different value than the other.
    //
    // `capture_source` is DERIVED here and stamped on EVERY write below, never
    // read from an input field: there is no `capture_source` on this tool's
    // schema, because a caller-settable label asserts what nothing measured
    // (the governing task's rejected option (a)). "runner" is reachable only by
    // letting lore execute the command.
    const captureRequested = args.capture === true;

    // reason: the SAME shared guard the CLI applies (`findCaptureFlagConflict`),
    // returning a fully-formed LoreError so scope/code/field/wording cannot
    // drift between the two surfaces — the identical sharing rationale the
    // sibling mixed-runner and filtered-pass guards below already document.
    const captureConflict = findCaptureFlagConflict({
      oracle: args.oracle,
      capture: captureRequested,
      ...(args.output_tail !== undefined ? { outputTail: args.output_tail } : {}),
    });
    if (captureConflict !== null) {
      return errorContent(captureConflict);
    }

    let capturedTail: string | undefined;
    // Absence stamps "self-report" EXPLICITLY (never omitted, never inferred
    // from the tail's shape) — same invariant the CLI holds.
    //
    // reason: SPEC-143 AC-CT-2 — a PROVENANCE PAIR, not a bare label (the
    // predecessor was `let captureSource: CaptureSource = "self-report"`). A
    // "runner" label with no attestation behind it is unrepresentable in
    // `EvidenceProvenance`, which is what stops this surface from re-minting the
    // measured false-trust row.
    let provenance: EvidenceProvenance = { capture_source: "self-report" };

    if (captureRequested) {
      // reason: MCP-SPECIFIC refusal with no CLI counterpart — a fresh CLI
      // subprocess's `process.cwd()` IS the agent's real directory, but this
      // server's was fixed when the stdio process started and is almost always
      // SOME unrelated real path. Spawning there would run the oracle in the
      // wrong tree and still label the row "runner", which is worse than not
      // offering capture at all. So this fails LOUD rather than defaulting —
      // the no-silent-fallback rule applied to a directory.
      if (args.caller_cwd === undefined) {
        return errorContent({
          code: "VALIDATION_ERROR",
          field: "caller_cwd",
          message:
            'capture: true requires caller_cwd — this MCP server\'s own process.cwd() is fixed at ' +
            "startup and is not the directory the calling agent is working in, so there is no safe " +
            "default to spawn command in. Pass caller_cwd (the absolute path the command should run " +
            "from, normally your worktree root) and retry.",
          value: true,
        });
      }
      const captured = captureOracleCommand({
        command: args.command,
        // The declared directory, passed EXPLICITLY — asserted by this fix's
        // own test suite via a relative read that resolves nowhere else.
        cwd: args.caller_cwd,
        declaredResult: args.result,
        // reason: task-the-ac-scope-re-keying-left-the-red-first-floor-unarmed
        // (face 3, item 1) — this argument was MISSING, so an MCP capture always
        // ran at the schema default while the CLI honoured the operator's
        // `workflow.evidence.capture_timeout_ms`. The loud-timeout half is
        // shared, so the surface already refused correctly; only the
        // configurability was absent, which is exactly a silently inert knob on
        // this surface (an exit-code-only check passed before and after).
        // `getConfig?.()` is called HERE, per invocation, for the SAME reason the
        // "task-start" branch does: a long-lived stdio server must observe a
        // mid-session `.lore/config.yaml` edit rather than a value frozen at
        // registration. An omitted getter yields `undefined`, which
        // `resolveCaptureTimeoutMs` resolves to the schema default — byte-identical
        // to the pre-fix behaviour for every caller that configures nothing.
        timeoutMs: resolveCaptureTimeoutMs(getConfig?.()),
      });
      if (!captured.ok) {
        return errorContent(captured.error);
      }
      capturedTail = captured.value.outputTail;
      // reason: SPEC-143 AC-CT-2 — assign the WHOLE provenance pair (label +
      // measured attestation), never a bare label. See `CapturedProvenance` in
      // `../evidence-capture.js` for the measured defect; the CLI's `--capture`
      // branch does the identical thing, so neither surface can write a row that
      // says "runner" with nothing behind it.
      provenance = captured.value.provenance;

      // reason: discovery-refusal guard (task-wire-the-discovery-refusal-guard-
      // into-the-evidence-capture, spec-oracle-executability-a-runner-s-
      // discovery-refusal-is-not-a §M6.2's evidence-path sibling, AC-OX-12) —
      // gate PARITY with the CLI is structural: both surfaces call the SAME
      // `findCapturedFailDiscoveryRefusal`, which returns the fully-formed
      // LoreError rather than a boolean, so scope/code/field/wording cannot
      // drift between them (same sharing rationale every sibling guard in this
      // handler already documents). `lore verify`'s own §M6.2 call site
      // (`service/verify-runner-service.ts`) already downgrades this exact
      // shape (a runner's discovery-refusal phrase on a nonzero exit — a
      // ZERO-EXECUTION event, never distinguishable from a genuine assertion
      // failure by exit code alone) to "inconclusive" for the ATTESTED path;
      // this closes the SAME gap for THIS server's own capture path, which had
      // no consumer of `findDiscoveryRefusal` at all before this task.
      const capturedDiscoveryRefusal = findCapturedFailDiscoveryRefusal({
        oracle: args.oracle,
        result: args.result,
        capture: captureRequested,
        command: args.command,
        outputTail: capturedTail,
      });
      if (capturedDiscoveryRefusal !== null) {
        return errorContent(capturedDiscoveryRefusal);
      }
    }

    // reason: from here down, `effectiveOutputTail` is the ONE tail every
    // downstream guard and the persisted row share — the captured output when
    // capture ran, the caller's own value otherwise (the two are mutually
    // exclusive by the conflict guard above, so this can never silently pick).
    const effectiveOutputTail = capturedTail ?? args.output_tail;

    // reason: missing-oracle-file precheck (defect: task-mcp-lore-evidence-add-
    // bypasses-the-oracle-file-existence) — this handler used to call the
    // TaskWorkflowService/PhaseWorkflowService directly, never routing through
    // `commands/evidence.ts`, so an MCP-originated self-reported `test`/`e2e`
    // pass citing a missing oracle file recorded cleanly. Mirrors the CLI
    // precheck exactly (same shared gate + extractor,
    // `findMissingOracleFilesForEvidence`, `../cli/evidence-precheck.js`) and
    // runs BEFORE the task/phase dispatch below so BOTH target types are
    // gated by ONE check, not two independently-written ones. `app.repoRoot`
    // is the corpus root (`dirname(dirname(dbPath))`, same value the CLI
    // passes as `corpusRoot` — see App's own JSDoc); always wired in
    // production, optional only for hand-built test App stubs.
    //
    // reason: `args.caller_cwd` (task-lore-evidence-s-oracle-file-precheck-
    // resolves-against-the) is an ADDITIONAL root, never a replacement for
    // `process.cwd()` — see this handler's own module-header paragraph and
    // the schema field's own JSDoc for why a long-lived MCP server needs this
    // escape hatch at all.
    const precheckRoots = {
      cwd: process.cwd(),
      ...(args.caller_cwd !== undefined ? { additionalCwds: [args.caller_cwd] } : {}),
      // reason: exactOptionalPropertyTypes — app.repoRoot is `string | undefined`;
      // conditionally spread rather than pass it verbatim (see evidence-precheck.ts's
      // matching comment on its own forwarding call).
      ...(app.repoRoot !== undefined ? { corpusRoot: app.repoRoot } : {}),
    };
    const missingOracleFiles = findMissingOracleFilesForEvidence({
      oracle: args.oracle,
      result: args.result,
      command: args.command,
      ...precheckRoots,
      fileExists: existsSync,
    });
    if (missingOracleFiles.length > 0) {
      // reason: refusal names the checked root(s) (task-lore-evidence-s-oracle-
      // file-precheck-resolves-against-the) — `describePrecheckRoots` recomputes
      // the SAME candidates `findMissingOracleFilesForEvidence` just tried
      // (SSOT, never drifts), same fix as the CLI's `commands/evidence.ts`.
      const checkedRoots = describePrecheckRoots(args.command, precheckRoots);
      return errorContent({
        code: "VALIDATION_ERROR",
        field: "command",
        message:
          `Oracle file(s) not found: ${missingOracleFiles.join(", ")}. ` +
          `Checked root(s): ${checkedRoots.join(", ")}. ` +
          'Author the oracle file or fix the path in "command"; ' +
          'use oracle: "manual" for genuinely manual checks.',
        value: args.command,
      });
    }

    // reason: mixed-runner invocation guard (defect: task-vitest-run-silently-
    // drops-a-bun-test-ts-named-alongside-a) — gate PARITY with the CLI is
    // structural: both surfaces call the SAME `findMixedRunnerRefusal`, which
    // returns the fully-formed LoreError rather than a boolean, so
    // scope/code/field/wording cannot drift. Runs after the missing-oracle-
    // file precheck above (a nonexistent path is refused for that more
    // fundamental reason first) and before the filtered-pass guard below
    // (whether the invocation would even run a named file matters before
    // asking whether a filter matched inside it) — same ordering the CLI's
    // `commands/evidence.ts` documents.
    const mixedRunnerRefusal = findMixedRunnerRefusal({
      oracle: args.oracle,
      result: args.result,
      command: args.command,
    });
    if (mixedRunnerRefusal !== null) {
      return errorContent(mixedRunnerRefusal);
    }

    // reason: pipe-refusal guard (SPEC oracle-tier-falsifiability-a-
    // criterion-never-observed-red M2; ADR falsifiability-moves-from-the-
    // task-tier-to-the-oracle-tier) — gate PARITY with the CLI is
    // structural: both surfaces call the SAME `findPipeRefusal`, which
    // returns the fully-formed LoreError rather than a boolean, so
    // scope/code/field/wording cannot drift between them. Runs after the
    // missing-oracle-file and mixed-runner guards above (a nonexistent file
    // or a dropped-runner file is a more fundamental fault than a pipe
    // hazard); ordering against the filtered-pass guard below is
    // immaterial — the two conditions are independent (`findPipeRefusal`'s
    // own header). `capture: captureRequested` is the SAME boolean already
    // resolved above — a captured run's exit code is measured directly by
    // this server, so the pipe hazard does not apply there.
    const pipeRefusal = findPipeRefusal({
      oracle: args.oracle,
      result: args.result,
      command: args.command,
      capture: captureRequested,
    });
    if (pipeRefusal !== null) {
      return errorContent(pipeRefusal);
    }

    // reason: filtered-pass matched-count guard (SPEC-061 AC-061-17) — gate
    // PARITY with the CLI is structural, not coincidental: both surfaces call
    // the SAME `findFilteredPassRefusal`, which returns the fully-formed
    // LoreError rather than a boolean, so scope/code/field/wording cannot drift
    // between them. This is the same CLI+MCP sharing the missing-oracle-file
    // precheck above already uses — an MCP-only bypass is exactly the defect
    // task-mcp-lore-evidence-add-bypasses-the-oracle-file-existence recorded
    // once already. Runs after that precheck for the same ordering reason the
    // CLI documents.
    const filteredPassRefusal = findFilteredPassRefusal({
      oracle: args.oracle,
      result: args.result,
      command: args.command,
      // reason: the CAPTURED tail when capture ran — the CLI feeds this guard
      // its post-capture tail too, so a `--capture`d filtered run proves its
      // matched count from real output on both surfaces identically.
      ...(effectiveOutputTail !== undefined ? { outputTail: effectiveOutputTail } : {}),
    });
    if (filteredPassRefusal !== null) {
      return errorContent(filteredPassRefusal);
    }

    const evidenceInput = {
      oracle: args.oracle,
      command: args.command,
      result: args.result,
      recorded_by: args.recorded_by,
      source: "mcp",
      ...(effectiveOutputTail !== undefined ? { output_tail: effectiveOutputTail } : {}),
      // reason: task-mcp-lore-evidence-add-cannot-set-capture-source-and-has-no
      // — stamped on EVERY MCP write, exactly as the CLI stamps it, so the two
      // surfaces are no longer asymmetric about provenance. Derived above from
      // whether THIS server ran the command; never a caller-supplied value.
      //
      // reason: SPEC-143 AC-CT-2 — splatted as a PAIR. On the capture path it
      // carries `capture_source: "runner"` AND the `capture_attestation` this
      // server measured, which `promoteCapturedAttestation` writes into the row's
      // `attestation`. That is now the ONE way a public write reaches
      // `attestation`; the raw `attestation` FIELD is still not accepted from a
      // caller (this module's own invariant), and `appendEvidenceEntry` still
      // forces `"runner"` for any row carrying one. ⛔ Never narrow this spread to
      // `capture_source: provenance.capture_source` — spread properties escape
      // excess-property checking, so that regression compiles silently and
      // re-mints the false trust label.
      ...provenance,
      ...(args.ac_ref !== undefined ? { ac_ref: args.ac_ref } : {}),
      ...(args.checklist_ref !== undefined ? { checklist_ref: args.checklist_ref } : {}),
      // reason: task-lore-evidence-add-and-lore-release-over-mcp-get-no —
      // wires the uncommitted-worktree attestation guard's Q3 mismatch check
      // through to this surface (see this file's own module section header
      // above `resolveMcpCallerCwd` for the full three-question review; the
      // "absence of a claim" distinction is now made by the SERVICE itself,
      // task-the-uncommitted-worktree-guard-treats-no-claim-at-all-as-a, so
      // this call site no longer needs its own claim pre-check).
      // Harmless-but-unused on the phase-workflow retry dispatch below
      // (`PhaseWorkflowService` does not implement this guard at all) —
      // `EvidenceInput` is the SAME imported type either target consumes.
      callerCwd: resolveMcpCallerCwd(args.caller_cwd),
    };

    let result = await taskWorkflowService.addEvidence(args.id_or_slug, evidenceInput);
    if (
      !result.ok &&
      result.error.code === "VALIDATION_ERROR" &&
      result.error.field === "type" &&
      result.error.value === "phase"
    ) {
      result = await requirePhaseWorkflowService(app).addEvidence(args.id_or_slug, evidenceInput);
    }

    if (!result.ok) return errorContent(result.error);
    return textContent({ doc: result.value });
  });

  // lore_phase_status (SPEC-056 task-skill-implement-cli-mcp-surfaces-checklist-ref-evidence)
  registerToolWithArgs(
    server,
    "lore_phase_status",
    "Computed completion scorecard for a phase document (SPEC-056) — the SAME payload the CLI `lore phase status` command renders",
    LorePhaseStatusSchema,
    async (args) => {
      const result = await getPhaseStatus(app, args.id_or_slug, new Date().toISOString());
      if (!result.ok) return errorContent(result.error);
      return textContent(result.value);
    },
  );

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
        // task-a-mistyped-task-file-anchor-is-stored-and-consulted (Required #1):
        // the write SUCCEEDED and the anchors are stored; `anchor_resolution`
        // reports which of them do not resolve on disk and therefore protect
        // nothing. Advisory only — never `isError`, never a refusal. The stored
        // (normalized) set is probed, not the raw `args.anchors`.
        const storedAnchors = extractFileAnchors(result.value);
        const payload: Record<string, unknown> = { doc: result.value };
        if (storedAnchors.length > 0) {
          payload["anchor_resolution"] = collectFileAnchorResolution(storedAnchors, buildFileAnchorProbeContext());
        }
        return textContent(payload);
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

      // ─── Diff acquisition: explicit diff_text override, else auto-derive ──────
      // reason: task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be —
      // mirrors the CLI's assess.ts: an explicit `diff_text` always wins (this MCP
      // surface has no subprocess/file-read seam of its own, so an override still
      // comes in as pre-acquired text); when omitted, derive the plan's own commit
      // set from git history via the SAME shared mechanism the CLI uses, instead of
      // requiring the caller to assemble a diff themselves.
      let diffText: string | undefined = args.diff_text;
      let diffSource: DiffSourceRecord;
      // reason: task-the-mcp-assess-adapter-still-calls-derivecommitsetforplan —
      // mirrors `commands/assess.ts`'s own `commitDerivationUnverifiable` local exactly:
      // set ONLY by the auto-derived branch below when the derivation reports
      // `"unverifiable_convention_mismatch"`; forwarded to `assessPlan` so the SERVICE
      // layer (never this adapter) forbids `scope_fidelity` from publishing an
      // absence-based score in that state. `false` on every OTHER path (explicit
      // `diff_text` override, or a genuinely commit-less plan) is a deliberate value,
      // never an omission — `assessPlan`'s `opts.commitDerivationUnverifiable` is a
      // REQUIRED field precisely so this adapter cannot silently skip computing it the
      // way it previously did.
      let commitDerivationUnverifiable = false;
      if (args.diff_text !== undefined) {
        diffSource = { mode: "explicit_diff_text" };
      } else {
        // reason: task-lore-assess-derives-a-plan-s-commits-by-grepping-task — every task
        // already `archived` means merged work exists BY DEFINITION (VALID_TRANSITIONS,
        // @lore/core); a zero-match derivation in that state is a commit-message
        // CONVENTION MISMATCH, not genuine absence, so it must be told apart from a plan
        // that plausibly has no merged work yet. Mirrors `commands/assess.ts` exactly —
        // `deriveCommitSetForPlan`'s `allTasksArchived` parameter is REQUIRED (no default),
        // so this computation cannot be omitted and still compile.
        const allTasksArchived = bundle.tasks.every((t) => t.status === "archived");
        const derivation = deriveCommitSetForPlan(process.cwd(), bundle.tasks.map((t) => t.slug), allTasksArchived);
        diffSource = { mode: "auto_derived", ...derivation };
        if (derivation.status === "derived") {
          diffText = derivation.diff_text;
        } else if (derivation.status === "unverifiable_convention_mismatch") {
          commitDerivationUnverifiable = true;
        }
      }

      // reason: D6 (spec-judgment-surfaces-must-verify-before-they-certify-machine,
      // task-thread-diff-source-through-the-cli-and-mcp-assess-adapters) — `diffSource`
      // (this handler's own already-computed `DiffSourceRecord` local, assigned on every
      // branch above) is now threaded into `opts.diffSource` so `resolveAssessedCommit`/
      // `verifyFindingPaths` (AC-JV-1, D2, D3) have a referent to check finding paths
      // against — mirrors the CLI's `commands/assess.ts` fix exactly; the two adapters
      // drift independently, so wiring one alone proves nothing about the other (AC-JV-5).
      const assessResult = await app.aiProviderService.assessPlan(bundle, {
        ...(diffText !== undefined ? { diffText } : {}),
        source: app.callerSurface,
        commitDerivationUnverifiable,
        diffSource,
      });
      if (!assessResult.ok) return errorContent(assessResult.error);

      const createResult = await corpusService.create({
        type: "knowledge",
        title: `Assessment: ${bundle.plan.title} (${new Date().toISOString().slice(0, 10)})`,
        parent_id: bundle.plan.id,
        // reason: `diff_source` is additive on the passthrough `extra` object (never a
        // core `assessmentResultSchema` change) — records HOW this run's diff (if any)
        // was obtained, so `diff_available` alone is never the only auditable signal
        // (AC #3, task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be).
        extra: { sub_type: "assessment", assessment: assessResult.value, diff_source: diffSource },
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
        diff_source: diffSource,
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
        // reason: SPEC-039 §M2 — MCP is non-interactive by design (no TTY-confirm
        // fallback, contrast the CLI); `confirmUnapprovedCommand` is deliberately
        // NEVER supplied here, so an unapproved command always falls through to
        // NEEDS_APPROVAL unless the caller explicitly passes allow_new_commands: true.
        ...(args.allow_new_commands === true ? { allowNewCommands: true } : {}),
      });
      if (!result.ok) return errorContent(result.error);

      return textContent(result.value);
    },
  );

  // ── IoC vertical-slice tech-spec §4.1/§11 P4: feed-before-produce PULL ────
  // (extended by SPEC-041 §3 D5 for the session-resume dispatch; extended by
  // SPEC-056 for the phase-start dispatch; extended by SPEC-070 §Design
  // Decisions D8 for the task-start dispatch)

  // lore_feed
  registerToolWithArgs(
    server,
    "lore_feed",
    'Feed-before-produce PULL: return the governing skill\'s rule slice for a checkpoint ahead of writing (advisory only, never a gate — always succeeds); checkpoint "session-resume" dispatches to SPEC-041 S2 resume, "phase-start" to the SPEC-056 phase-start pack, and "task-start" to the SPEC-070 task-start pack instead (each of the three CAN fail on an unresolvable target); a contradictory field combo (e.g. "task-start" with `phase`, or any non-special checkpoint with `task`/`phase`) is rejected with VALIDATION_ERROR',
    LoreFeedSchema,
    async (args) => {
      // SPEC-070 review Fix F8 (contradictory-combo rejection) + branch-membership/
      // required-arg lookup, BOTH derived from the SAME `SPECIAL_FEED_CHECKPOINTS`
      // descriptor (Fix F7) the CLI's `SPECIAL_CHECKPOINT_HANDLERS` table asserts
      // coverage against — never a THIRD independently-maintained set of `if` checks.
      // Runs BEFORE any branch dispatch below, so a contradictory or extraneous
      // `task`/`phase` never silently reaches (and is silently ignored by) the wrong
      // assembly: `task-start` + `phase`, `phase-start` + `task`, and a NON-special
      // checkpoint (the generic `buildFeed` path) carrying `task` OR `phase` are all
      // rejected here.
      const specialDescriptor = SPECIAL_FEED_CHECKPOINTS[args.checkpoint];
      for (const field of ["task", "phase"] as const) {
        const suppliedValue = field === "task" ? args.task : args.phase;
        if (suppliedValue === undefined) continue;
        if (specialDescriptor?.requiredArg !== field) {
          return errorContent({
            code: "VALIDATION_ERROR",
            field,
            message:
              specialDescriptor === undefined
                ? `\`${field}\` is not a valid field for checkpoint "${args.checkpoint}" (it does not dispatch to a "${field}"-scoped pack)`
                : specialDescriptor.requiredArg === null
                  ? `\`${field}\` is not valid for checkpoint "${args.checkpoint}" (this checkpoint takes no task/phase target)`
                  : `\`${field}\` is not valid for checkpoint "${args.checkpoint}" (it requires \`${specialDescriptor.requiredArg}\`, not \`${field}\`)`,
          });
        }
      }
      if (specialDescriptor !== undefined && specialDescriptor.requiredArg !== null) {
        const requiredField = specialDescriptor.requiredArg;
        const suppliedValue = requiredField === "task" ? args.task : args.phase;
        if (suppliedValue === undefined) {
          return errorContent({
            code: "VALIDATION_ERROR",
            field: requiredField,
            message: `checkpoint "${args.checkpoint}" requires a \`${requiredField}\` document id or slug`,
          });
        }
      }

      // reason: `textContent(result.value)` JSON-stringifies the whole
      // `ResumeFeedOutcome`, whose `.feed` field already carries the
      // `RESUME_SCOPE_CLOSURE` boundary block
      // (spec-context-provenance-injected-corpus-global-state-and-a D3)
      // whenever a ticket was actually found — woven in by
      // `../../flows/feed-flow.js::renderResumeFeed`, the SAME function
      // `commands/feed.ts`'s CLI `handleSessionResume` relies on for its own
      // stdout print. Do not re-append or re-derive the closure text here —
      // that would let this surface silently diverge from the CLI's.
      if (args.checkpoint === SESSION_RESUME_CHECKPOINT) {
        const result = await buildResumeFeed(app, {
          ...(args.plan !== undefined ? { plan: args.plan } : {}),
          ...(args.handoff !== undefined ? { handoff: args.handoff } : {}),
          ...(args.by !== undefined ? { by: args.by } : {}),
        });
        if (!result.ok) return errorContent(result.error);
        return textContent(result.value);
      }

      // SPEC-070 §Design Decisions D8: closes the SPEC-056 deferred phase-start MCP
      // gap — without this branch, checkpoint "phase-start" fell through to the
      // generic buildFeed path below, which has no CHECKPOINT_PRODUCED_TYPE entry
      // for "phase-start" and so degraded to a one-line "unknown checkpoint" note
      // instead of the real PhaseStartPack the CLI's `lore feed phase-start` renders.
      if (args.checkpoint === PHASE_START_CHECKPOINT) {
        if (args.phase === undefined) {
          return errorContent({
            code: "VALIDATION_ERROR",
            field: "phase",
            message: 'checkpoint "phase-start" requires a `phase` document id or slug',
          });
        }
        const deps = buildPhaseFeedFlowDeps(app);
        const result = await buildPhaseStartPack(deps, args.phase);
        if (!result.ok) return errorContent(result.error);
        return textContent(result.value);
      }

      // SPEC-070 §Design Decisions D1, D8; F6 (config-staleness fix, supersedes
      // AC-070-9's snapshot): mirrors the CLI's `lore feed task-start <task>`
      // dedicated dispatch — the SAME buildTaskFeedFlowDeps/buildTaskStartPack
      // construction, so CLI --json and this tool's response are deep-equal by
      // construction for identical corpus state. `getConfig?.()` is called HERE,
      // PER INVOCATION — not once at server-start — so a `.lore/config.yaml` edit
      // made between two `lore_feed` calls on the same long-lived server changes
      // the SECOND call's resolved budgets without a restart (AC-070-15). Budgets
      // resolve via the SAME resolveTaskStartBudgets the CLI's `handleTaskStart`
      // calls — an omitted/undefined-returning getter resolves to `{}`, so the
      // pre-fix DEFAULT_TASK_START_BUDGETS fallback is preserved byte-for-byte
      // (REGRESSION).
      if (args.checkpoint === TASK_START_CHECKPOINT) {
        if (args.task === undefined) {
          return errorContent({
            code: "VALIDATION_ERROR",
            field: "task",
            message: 'checkpoint "task-start" requires a `task` document id or slug',
          });
        }
        const deps = buildTaskFeedFlowDeps(app);
        const budgets = resolveTaskStartBudgets(getConfig?.());
        const result = await buildTaskStartPack(deps, args.task, budgets);
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

  // ── SPEC-054: UAT verdict ─────────────────────────────────────────────────

  // lore_uat_record
  registerToolWithArgs(
    server,
    "lore_uat_record",
    "Record a structured UAT verdict for a plan (knowledge/uat) — the sole MCP write path besides `lore uat record`; the plan-close gate reads it (SPEC-054)",
    LoreUatRecordSchema,
    async (args) => {
      if (app.uatService === undefined) {
        return errorContent({ code: "STORE_ERROR", message: "Internal error: UatService not wired on App" });
      }
      const result = await app.uatService.record(args.plan, args.verdict, { by: args.by });
      if (!result.ok) return errorContent(result.error);
      return textContent({ doc: result.value.doc });
    },
  );

  // ── SPEC-055: requirement inventory ────────────────────────────────────────

  // lore_requirement_add
  registerToolWithArgs(
    server,
    "lore_requirement_add",
    "Add a numbered requirement to a PRD's structured inventory (SPEC-055) — the sole MCP write path; `lore status --check-requirements` audits coverage against the ACs of every spec",
    LoreRequirementAddSchema,
    async (args) => {
      if (app.requirementService === undefined) {
        return errorContent({ code: "STORE_ERROR", message: "Internal error: RequirementService not wired on App" });
      }
      const result = await app.requirementService.addRequirement(args.prd, {
        id: args.id,
        statement: args.statement,
        priority: args.priority,
      });
      if (!result.ok) return errorContent(result.error);
      return textContent({ requirements: result.value });
    },
  );

  // ── spec-baseline-slice-1 §C3: baseline rules + node verbs ─────────────────
  // Every tool below is a thin pipe over `RuleService` (the SOLE writer of rules, label,
  // depends_on, glossary and baseline node creation); a refusal is `isError` with the LoreError.
  const withRuleService = async <T>(
    run: (svc: NonNullable<typeof app.ruleService>) => Promise<Result<T, LoreError>>,
  ) => {
    if (app.ruleService === undefined) {
      return errorContent({ code: "STORE_ERROR", message: "Internal error: RuleService not wired on App" });
    }
    const result = await run(app.ruleService);
    if (!result.ok) return errorContent(result.error);
    return textContent(result.value);
  };

  // lore_rule_add
  registerToolWithArgs(
    server,
    "lore_rule_add",
    "Append a new live rule to a baseline leaf (BR-n), architecture standard (AS-n) or debt-registry (AD-n) and allocate its permanent id; a standard may carry the four parts current_reality/target_rule/current_exceptions/migration (all or none) — the sole MCP write path for extra.rules",
    LoreRuleAddSchema,
    async (args) =>
      withRuleService((svc) =>
        svc.addRule(
          args.leaf,
          {
            statement: args.statement,
            confidence: args.confidence,
            enforced_by: args.enforced_by,
            examples: args.examples,
            ...(args.current_reality !== undefined ? { current_reality: args.current_reality } : {}),
            ...(args.target_rule !== undefined ? { target_rule: args.target_rule } : {}),
            ...(args.current_exceptions !== undefined ? { current_exceptions: args.current_exceptions } : {}),
            ...(args.migration !== undefined ? { migration: args.migration } : {}),
          },
          { by: args.by },
        ),
      ),
  );

  // lore_rule_set
  registerToolWithArgs(
    server,
    "lore_rule_set",
    "Edit a baseline rule (incl. an AS rule's four parts), advance its lifecycle (forward-only; retired needs note) or move it to another leaf keeping its id",
    LoreRuleSetSchema,
    async (args) => {
      const patch: SetRulePatch = {
        ...(args.statement !== undefined ? { statement: args.statement } : {}),
        ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
        ...(args.enforced_by !== undefined ? { enforced_by: args.enforced_by } : {}),
        ...(args.examples !== undefined ? { examples: args.examples } : {}),
        ...(args.lifecycle !== undefined ? { lifecycle: args.lifecycle } : {}),
        ...(args.note !== undefined ? { note: args.note } : {}),
        ...(args.move_to !== undefined ? { moveTo: args.move_to } : {}),
        ...(args.current_reality !== undefined ? { current_reality: args.current_reality } : {}),
        ...(args.target_rule !== undefined ? { target_rule: args.target_rule } : {}),
        ...(args.current_exceptions !== undefined ? { current_exceptions: args.current_exceptions } : {}),
        ...(args.migration !== undefined ? { migration: args.migration } : {}),
      };
      return withRuleService((svc) => svc.setRule(args.rule, patch, { by: args.by }));
    },
  );

  // lore_rule_show / lore_rule_find / lore_rule_impact — read path (spec baseline-slice-2 C6)
  const withReadService = async <S, T>(
    svc: S | undefined,
    name: string,
    run: (svc: S) => Promise<Result<T, LoreError>>,
  ) => {
    if (svc === undefined) return errorContent({ code: "STORE_ERROR", message: `Internal error: ${name} not wired on App` });
    const result = await run(svc);
    return result.ok ? textContent(result.value) : errorContent(result.error);
  };

  registerToolWithArgs(
    server,
    "lore_rule_show",
    "Show one baseline rule: statement, leaf, confidence, computed state and every citing (spec, AC)",
    LoreRuleShowSchema,
    async (args) => withReadService(app.ruleReadService, "RuleReadService", (svc) => svc.show(args.rule)),
  );

  registerToolWithArgs(
    server,
    "lore_rule_find",
    "Find baseline rule ids by spec (cited by it), file (cited by specs anchored to it) or statement text — exactly one",
    LoreRuleFindSchema,
    async (args) =>
      withReadService(app.ruleReadService, "RuleReadService", (svc) =>
        svc.find(
          args.spec !== undefined ? { spec: args.spec } : args.file !== undefined ? { file: args.file } : { text: args.text as string },
        ),
      ),
  );

  registerToolWithArgs(
    server,
    "lore_rule_impact",
    "Impact of changing or retiring a rule: citing criteria, transitively dependent leaves and depends_on cycles",
    LoreRuleImpactSchema,
    async (args) => withReadService(app.impactService, "ImpactService", (svc) => svc.impact(args.rule)),
  );

  // lore_baseline_add
  registerToolWithArgs(
    server,
    "lore_baseline_add",
    "Create a baseline node. Business (default): root under a PRD, branch/leaf under a root|branch. tree=architecture: root under a PRD, section under the architecture root, module-card|standard|debt-registry under a section",
    LoreBaselineAddSchema,
    async (args) =>
      withRuleService((svc) =>
        svc.addNode(
          args.parent,
          { ...(args.tree !== undefined ? { tree: args.tree } : {}), node: args.node, label: args.label, title: args.title, content: args.content ?? "" },
          { by: args.by },
        ),
      ),
  );

  // lore_baseline_set_label
  registerToolWithArgs(
    server,
    "lore_baseline_set_label",
    "Set a baseline node's display label (extra.label) — the sole MCP write path for it",
    LoreBaselineSetLabelSchema,
    async (args) => withRuleService((svc) => svc.setLabel(args.node, args.label, { by: args.by })),
  );

  // lore_baseline_depends
  registerToolWithArgs(
    server,
    "lore_baseline_depends",
    "Add/remove depends_on rule ids (BR-n) on a baseline leaf; every added id must exist",
    LoreBaselineDependsSchema,
    async (args) =>
      withRuleService((svc) =>
        svc.setDependsOn(
          args.leaf,
          {
            ...(args.add !== undefined ? { add: args.add } : {}),
            ...(args.remove !== undefined ? { remove: args.remove } : {}),
          },
          { by: args.by },
        ),
      ),
  );

  // lore_baseline_glossary_add
  registerToolWithArgs(
    server,
    "lore_baseline_glossary_add",
    "Define a glossary term on a baseline root|branch",
    LoreBaselineGlossaryAddSchema,
    async (args) =>
      withRuleService((svc) =>
        svc.glossaryAdd(
          args.node,
          { term: args.term, meaning: args.meaning, ...(args.note !== undefined ? { note: args.note } : {}) },
          { by: args.by },
        ),
      ),
  );

  // lore_baseline_glossary_rm
  registerToolWithArgs(
    server,
    "lore_baseline_glossary_rm",
    "Remove a glossary term from a baseline root|branch",
    LoreBaselineGlossaryRmSchema,
    async (args) => withRuleService((svc) => svc.glossaryRemove(args.node, args.term, { by: args.by })),
  );

  // ── SPEC-043: bi-temporal invalidation ────────────────────────────────────

  // lore_invalidate
  registerToolWithArgs(
    server,
    "lore_invalidate",
    "Mark a knowledge/adr/task document invalid (retract it, for a task) or undo a prior invalidation — the SOLE MCP write path for extra.validity",
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
      // BOUNDARY advisories (AC6, task-a-task-cannot-be-retracted-supersedes-
      // emits-a-repair) — same fields the CLI surfaces, so an MCP agent (who
      // never reads CLI help text) gets the SAME named-not-silent signal.
      if (result.value.task_already_terminal !== undefined) {
        payload["task_already_terminal"] = result.value.task_already_terminal;
      }
      if (result.value.task_claim_holder !== undefined) {
        payload["task_claim_holder"] = result.value.task_claim_holder;
      }
      return textContent(payload);
    },
  );

  // ── SPEC-072 T5: upstream issue reporting ──────────────────────────────────

  // lore_report_issue
  registerToolWithArgs(
    server,
    "lore_report_issue",
    "File a structured lore-defect report into this corpus's configured upstream (feedback.upstream in .lore/config.yaml) — lands as a draft ad-hoc task in the upstream pending-review queue",
    LoreReportIssueSchema,
    async (args) => {
      // ⛔ RETIRED (P4, spec-the-defect-channel-reaches-no-machine-but-its-own-
      // github): this handler used to lazy-import `report-issue-wiring.js`'s
      // `buildIssueReportDeps` and pipe straight into `IssueReportService.report`
      // for a legacy-shaped `feedback.upstream`. `IssueReportService` and the
      // SQLite `UpstreamPort` it drove are deleted outright — legacy SQLite
      // stays refused (below); GitHub now files for real (AC-GR-11,
      // spec-a-github-filed-defect-must-be-claimable-one-ingest-seam), through
      // the SAME `fileGithubIssue` `commands/report-issue.ts` calls — never a
      // second filing implementation.
      //
      // Lazy import kept for the SAME isolation reason it existed before:
      // `report-issue-wiring.js` value-imports `gh-runner.js`/
      // `github-intake-port.js`, whose transitive deps a static import here
      // would drag into the vitest graph of every tools.ts consumer
      // (mcp-tools.test.ts).
      //
      // ⛔ Shape policy comes from `classifyFeedbackUpstream`, NOT from a local
      // `resolveFeedbackUpstreamCfg` + `isGithubUpstreamCfg` chain. This handler
      // was the LAST surface still re-deriving that chain itself, and the
      // vendor-consent branch (`feedback.upstream.vendor: true`, 2026-08-25) is
      // exactly the input a hand-rolled chain gets WRONG: `isGithubUpstreamCfg`
      // tests `"repo" in cfg`, a vendor config carries no `repo`, so the old
      // chain here would have fallen through and told the caller its valid
      // config was "the retired SQLite shape". Routing through the classifier
      // also normalizes vendor -> `{repo: VENDOR_INTAKE_REPO}`, so everything
      // below this line is unchanged and cannot drift from the CLI's own
      // policy (`commands/report-issue.ts` / `commands/issues.ts`).
      const { classifyFeedbackUpstream, fileGithubIssue, resolveConsumerCorpusRoot } = await import(
        "../cli/report-issue-wiring.js"
      );
      const classification = classifyFeedbackUpstream(getConfig?.());

      if (classification.kind === "unconfigured") {
        return errorContent(buildUnconfiguredUpstreamRemedy());
      }

      // AC-GR-11 — the LIVE filing path is `GitHubIntakePort`, via
      // `report-issue-wiring.ts::fileGithubIssue`, the SAME function
      // `commands/report-issue.ts` calls whenever `feedback.upstream`
      // resolves to this shape (self-hosted `{repo}`, or `{vendor: true}`
      // already normalized onto it by the classifier).
      if (classification.kind === "github") {
        const cfg = classification.cfg;
        // `GithubReportInput.severity`/`.category` are REQUIRED (not
        // optional) — mirrors `commands/report-issue.ts`'s own precondition
        // check for the identical reason: the front-matter schema's closed
        // six-field set has no undeclared-label representation. Checked
        // here (not deferred to `fileGithubIssue`) so a caller missing
        // either gets a `VALIDATION_ERROR` naming BOTH the offending
        // field(s) and the accepted severity set, before any `gh` call.
        if (args.severity === undefined || args.category === undefined) {
          const missingTriageFields = [
            args.severity === undefined ? "severity" : undefined,
            args.category === undefined ? "category" : undefined,
          ].filter((field): field is string => field !== undefined);
          return errorContent({
            code: "VALIDATION_ERROR",
            field: missingTriageFields.join(","),
            message:
              `Filing into a GitHub-configured feedback.upstream (repo: ${cfg.repo}) requires ` +
              `${missingTriageFields.join(" and ")} (the front-matter schema's severity/category fields ` +
              `are not optional). Valid severities: ${ISSUE_SEVERITIES.join(", ")}.`,
          });
        }

        // The actor is the call identity's resolved name (no MCP caller names itself —
        // BR-1055) and
        // its source is that name's REAL source, mirroring how the CLI resolves its own
        // `actorSource` before threading it through `GithubFilingContext.actor`.
        // This module does NO actor resolution of its own (report-issue-
        // wiring.ts's own header) — never build the actor from anything else here.
        const callIdentity = requireCallIdentity(scope);
        const actor = args.by;
        const actorSource = actorSourceOfName(callIdentity.claimedSource);

        const fileResult = await fileGithubIssue(
          {
            title: args.title,
            description: args.description,
            expected: args.expected,
            actual: args.actual,
            ...(args.repro_command !== undefined ? { repro_command: args.repro_command } : {}),
            severity: args.severity,
            category: args.category,
            // No `tags` field on THIS surface (LoreReportIssueSchema's own
            // header names this gap) — an MCP-filed report always carries
            // an empty tag set.
            tags: [],
          },
          cfg,
          {
            consumerCorpusRoot: resolveConsumerCorpusRoot(),
            corpusService: app.corpusService,
            actor,
            actorSource,
          },
        );
        if (!fileResult.ok) return errorContent(fileResult.error);

        // D8/AC-GR-9's mint already landed inside `fileGithubIssue` — this
        // read locates the SAME task by its stored GitHub pointer
        // (`readGithubIssueRef`, pure/store-free) rather than recomputing
        // `githubIssueTaskSlug` from a `repo_id` this handler was never
        // given: `fileGithubIssue`'s return shape (`GithubReportResult`)
        // carries `number`/`url`, never `repo_id`. AC-GR-11 requires the
        // success payload to NAME the created task's slug.
        const taskLookup = await app.corpusService.listFull({ type: "task" });
        if (!taskLookup.ok) {
          return errorContent({
            code: "STORE_ERROR",
            message:
              `issue filed upstream as #${fileResult.value.number} (${fileResult.value.url}) but locating the ` +
              `created corpus task failed (${taskLookup.error.code}) — the upstream issue itself was NOT lost.`,
          });
        }
        const createdTask = taskLookup.value.docs.find((doc) => {
          const ref = readGithubIssueRef(doc.extra);
          return ref !== undefined && ref.repo === cfg.repo && ref.issueNumber === fileResult.value.number;
        });
        if (createdTask === undefined) {
          return errorContent({
            code: "STORE_ERROR",
            message:
              `issue filed upstream as #${fileResult.value.number} (${fileResult.value.url}) but no corpus task ` +
              `carrying that GitHub reference could be found — the upstream issue itself was NOT lost.`,
          });
        }

        return textContent({ ...fileResult.value, task_slug: createdTask.slug });
      }

      // legacy-shaped `feedback.upstream` — retired (P4): `IssueReportService`
      // and the SQLite `UpstreamPort` it drove no longer exist to file through.
      //
      // Message is the SHARED definition (spec-the-retired-shape-refusal-
      // message-has-two-byte-identical D1), now reached by carrying the
      // classifier's OWN `error` rather than by calling the builder a second
      // time here — the same wording, with one fewer place able to drift from
      // it. `classification` is narrowed to the `retired` member at this point:
      // `unconfigured` returned above and `github` returns on every path inside
      // the block above.
      return errorContent(classification.error);
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
 * Builds the `CorpusService.set` options shared by `lore_set` and the `lore_batch` `set` op, so the two
 * entry points cannot drift on how `by` / `correction` reach the service (spec-documents-are-living-or-
 * records D15). `undefined` when neither is given — byte-identical to the pre-correction call.
 */
function setOptionsFrom(
  by: string | undefined,
  correction: { reason: string } | undefined,
): { by?: string; correction?: { reason: string } } | undefined {
  if (by === undefined && correction === undefined) return undefined;
  return {
    ...(by !== undefined ? { by } : {}),
    ...(correction !== undefined ? { correction } : {}),
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
 * @param by - The call's own resolved name: one call = one identity (BR-1036), so every operation of the
 *   batch is written under it. An operation naming its own `by` is refused, never honored or dropped.
 * @returns A plain-object result suitable for inclusion in the batch results array
 */
async function executeBatchOp(
  op: string,
  args: Record<string, unknown>,
  app: App,
  by: string,
): Promise<unknown> {
  const { corpusService } = app;
  if ("by" in args) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        field: "by",
        message: "`by` is not accepted: every operation of a batch is written under the call's own identity.",
      },
    };
  }

  switch (op) {
    case "create": {
      const parsed = LoreCreateSchema.safeParse(args);
      if (!parsed.success) return { ok: false, error: zodIssueToLoreError(parsed.error, "create") };
      // reason: strip MCP-schema-only fields (ai/file_anchors/requires_uat/supersedes)
      // — the batch executor never invokes AI generation or the supersedes orchestration
      // (out of scope for lore_batch); file_anchors and requires_uat (SPEC-058 hotfix,
      // plan branch only, `true` only) still fold into extra the same way the single-op
      // lore_create handler does, so a batch-created task's declared anchors — or a
      // batch-created plan's requires_uat flag — aren't silently dropped.
      const {
        ai: _ai,
        file_anchors: fileAnchors,
        requires_uat: requiresUat,
        supersedes: _supersedes,
        // reason: BR-1036 — one call = one identity; an operation's own harness_run is ignored, never forwarded.
        harness_run: _harnessRun,
        ...createInput
      } = parsed.data;
      void _harnessRun;
      void _ai;
      void _supersedes;
      let mergedExtra = createInput.extra;
      if (fileAnchors !== undefined) {
        mergedExtra = { ...(mergedExtra ?? {}), file_anchors: fileAnchors };
      }
      if (createInput.type === "plan" && requiresUat === true) {
        mergedExtra = { ...(mergedExtra ?? {}), requires_uat: true };
      }
      const resolvedCreateInput = {
        ...createInput,
        ...(mergedExtra !== undefined ? { extra: mergedExtra } : {}),
      };
      const r = await corpusService.create(resolvedCreateInput, { by });
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
      // reason: the call's `by` is passed as the write actor, never merged into the patch — same as
      // the single-op lore_set handler above.
      const { id_or_slug: idOrSlug, correction, harness_run: _harnessRun, ...patch } = parsed.data;
      void _harnessRun;
      const r = await corpusService.set(idOrSlug, patch, setOptionsFrom(by, correction));
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    case "delete": {
      const idOrSlug = args["id_or_slug"];
      if (typeof idOrSlug !== "string") return { ok: false, error: "id_or_slug required" };
      const r = await corpusService.delete(idOrSlug, args["confirm"] === true, { by });
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
      const r = await corpusService.link(
        from,
        to,
        type as Parameters<typeof corpusService.link>[2],
        { by },
      );
      return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
    }
    default:
      return { ok: false, error: `Unknown operation: ${op}` };
  }
}
