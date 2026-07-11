/**
 * lore gate — corpus-governed creation-time interception commands (IoC vertical-slice
 * tech-spec §4.1/§11). One "deterministic zone" gate per governed doc-creation flow;
 * `spec-create` and `spec-promote` are its two subcommands (hence the group/subcommand
 * shape rather than flat `gate-spec-create` / `gate-spec-promote` command names).
 *
 * `lore gate spec-create --input-json '<json>'` runs the three pure predicates from
 * `../../../service/gate-predicates.js` against a CANDIDATE spec-creation payload
 * (never an already-created doc — this gate runs BEFORE `lore create` / `lore_create`,
 * as a pre-flight check an AI agent or CI hook shells out to) and either:
 *   - all three pass → prints "gate: pass", exit 0.
 *   - any fail → prints a `gate-feeding.js::renderFeedingPack` block (rule doc slice +
 *     parent doc slice + machine-readable `missing` reasons) to stdout, exit 4.
 *
 * `lore gate spec-promote --spec <id-or-slug>` gates an ALREADY-CREATED spec ahead of
 * approval — the deterministic zone here is narrower than spec-create's: does the spec
 * declare ≥1 structured acceptance criterion (`spec.extra.acceptance_criteria`, SPEC-038,
 * counted via `AcService.listCriteria` — the same SSOT `lore ac list` reads)?
 *   - 0 declared → exit 4, "no acceptance criteria" message (deterministic, hard block).
 *   - ≥1 declared → "gate: pass", exit 0, ALWAYS (the AC-count check is the only thing
 *     that can fail this gate).
 * After a pass, the command makes a SECOND, PURELY ADVISORY attempt: it runs the
 * SPEC-034 AI judge (`CorpusService.getReviewBundle` → `runDeterministicChecks` →
 * `AIProviderService.judgeDoc`, same call shape `lore review` uses) and prints a
 * decision/confidence/blocking-questions summary to STDERR. This is the "probabilistic
 * zone" half of the deterministic/probabilistic split (IoC tech-spec §4.1 INV2): the
 * judge's verdict — or its outright unavailability (no configured/reachable provider,
 * malformed response, etc.) — is NEVER allowed to change the exit code that the
 * deterministic AC-count check already settled. A judge failure degrades to a one-line
 * "judge advisory unavailable" stderr note, not a silent skip and not a hard failure.
 * No `review_judgments` row is persisted by this command — `lore review` remains the
 * sole persistence path for judgments; this is a disposable, in-band advisory only.
 *
 * `lore gate plan-promote --plan <id-or-slug>` and `lore gate task-claim --task
 * <id-or-slug>` are the two "commit-time cross-tier gates": they gate an
 * ALREADY-CREATED plan (ahead of promotion) / task (ahead of being claimed) against
 * its ANCESTOR spec's approval + AC status, walking the SAME task→plan→ancestor-spec
 * chain `evaluateReadiness`'s `upstream_unapproved` advisory uses
 * (`CorpusService.getPlanBundle`, `@lore/core` task-workflow.ts) — the plan/task's
 * OWN status is never inspected, only its ancestor spec's. When the plan/task has no
 * spec-tier ancestor at all (parented directly under a `prd`, or unparented) there is
 * no upstream edge to gate, so both checkpoints PASS vacuously (never a failure) —
 * see `checkpoint-registry.js`'s third module invariant.
 *   - `plan-promote`: ancestor spec must be `approved` AND declare ≥1 structured
 *     acceptance criterion (`upstreamApproved` + `upstreamHasAcceptanceCriteria`).
 *   - `task-claim`: ancestor spec must be `approved` (`upstreamApproved`); ADDITIONALLY
 *     (SPEC-042 §Design Decisions D5) a fresh sibling claim in the same plan whose
 *     declared `file_anchors` overlap this task's own also blocks
 *     (`noAnchorOverlap`) — evaluated UNCONDITIONALLY, not gated by whether a
 *     spec-tier ancestor exists (unlike `upstreamApproved`). `--by` (or
 *     `$LORE_ACTOR`/OS username) supplies the candidate actor identity the overlap
 *     predicate's "different actor" test needs; this pre-flight check reaches the
 *     IDENTICAL verdict `lore claim` itself would for the same task/actor —
 *     `buildAnchorGateContext` (`checkpoint-registry.js`) is the shared ctx-builder
 *     both this command and `TaskWorkflowService.claim`'s `GateEnforcer` path use.
 *
 * `LORE_GATE_BYPASS=1` short-circuits to exit 0 before ANY parsing or checking, for
 * ALL FOUR subcommands — an escape hatch for callers that must not be blocked
 * (documented, not silent: every invocation under bypass still goes through the CLI,
 * so it is audit-log-visible at the shell/process level even though this command
 * itself performs no corpus writes).
 *
 * `.lore/config.yaml`'s `workflow.gates.<checkpoint>.enabled` (SPEC-0XX, `@lore/core`
 * `resolveGateEnabled`) is a SECOND, narrower escape hatch — it disables exactly ONE
 * checkpoint rather than all four, and only when explicitly set to `false` (absence of
 * the whole config, `workflow`, `gates`, or the per-checkpoint entry all mean "enabled" —
 * backward compatible with every config written before this field existed). Precedence,
 * highest first: (1) `LORE_GATE_BYPASS=1` — checked before config is even loaded; (2)
 * per-checkpoint `enabled: false` — checked immediately after `loadLoreApp()`, before any
 * predicate runs; (3) the checkpoint's own deterministic predicates. A disabled checkpoint
 * prints a one-line stderr note (`gate: <checkpoint> disabled by config`) and exits 0 —
 * see each subcommand's `run()`.
 *
 * Exit codes (plan-promote / task-claim):
 *   0 = no spec-tier ancestor (vacuous pass), OR ancestor spec passes its checkpoint's
 *       predicates, OR LORE_GATE_BYPASS=1
 *   3 = the target plan/task does not resolve (DOC_NOT_FOUND / SLUG_NOT_FOUND)
 *   4 = target resolves but is the wrong doc type (VALIDATION_ERROR), OR a spec-tier
 *       ancestor exists but fails its checkpoint's predicates
 *
 * Exit codes (spec-create):
 *   0 = all predicates passed, OR LORE_GATE_BYPASS=1
 *   2 = --input-json missing / malformed JSON / does not match the expected shape
 *       (CLI-usage error, not a `LoreError` — mirrors evidence.ts's mutually-exclusive-
 *       flags convention, not utils.ts::exitCode's LoreError-only mapping)
 *   4 = at least one gate predicate failed (VALIDATION_ERROR family, utils.ts::exitCode)
 *   1 = corpus read failure while resolving the parent doc or the rule doc (STORE_ERROR)
 *
 * Exit codes (spec-promote):
 *   0 = ≥1 acceptance criterion declared, OR LORE_GATE_BYPASS=1 — the judge advisory
 *       (present or absent, approve/reject/escalate) never changes this
 *   3 = spec does not resolve (DOC_NOT_FOUND / SLUG_NOT_FOUND, utils.ts::exitCode)
 *   4 = resolves but is not a spec (VALIDATION_ERROR), OR resolves as a spec with zero
 *       declared acceptance criteria
 *
 * Both subcommands' deterministic decision logic (the predicate checks themselves,
 * plus the failure feeding-pack / message rendering) now lives behind
 * `../../../service/checkpoint-registry.js::checkpointRegistry` — this file only
 * performs the store/IO reads (`resolveParentDoc`, `findFeedingSkill`,
 * `AcService.listCriteria`) and dispatches through the registry's `check`/`feed`
 * callbacks. This is a pure refactor: exit codes, stdout feeding-pack text, and stderr
 * judge advisory are all UNCHANGED from the pre-registry inline-predicate shape.
 * `renderDocMarkdown` and `resolveParentDoc` now live in `../../../flows/feed-flow.js`
 * (moved out, unchanged) so `lore feed`'s advisory PULL and this gate's violation PUSH
 * share exactly one MDX-rendering and parent-resolution implementation — see that
 * module's header for the P4 slice this enables.
 *
 * Source: IoC vertical-slice tech-spec §4.1/§5.1/§11 ("deterministic zone" +
 * "active feeding" + INV2 "probabilistic zone is advisory-only")
 */

import { defineCommand } from "citty";
import { z } from "zod";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  selectFailures,
  buildUpstreamSpecContext,
  buildAnchorGateContext,
  type CheckpointDef,
  type GateCheckpoint,
  type GateContext,
} from "../../../service/checkpoint-registry.js";
import { runDeterministicChecks, resolveGateEnabled, resolveAnchorOverlapGateEnabled } from "@lore/core";
import type { App } from "../../../app.js";
import type { AcService } from "../../../service/ac-service.js";
import type { LoreConfig, LoreError, NewReviewJudgment } from "@lore/core";
import {
  renderDocMarkdown,
  resolveParentDoc,
  CHECKPOINT_PRODUCED_TYPE,
} from "../../../flows/feed-flow.js";

/**
 * Looks up `checkpoint` in `flows/feed-flow.ts::CHECKPOINT_PRODUCED_TYPE` — the SINGLE
 * definition site for "which doc type does this checkpoint produce" — throwing if
 * absent. This used to be a second, independently-hardcoded `"spec"` literal
 * constant in this file that could silently desync from the map; deriving it here
 * instead means there is exactly one place that fact can be edited.
 * Fail-loud (no `?? "spec"` fallback): every call site in this file passes a
 * compile-time-known checkpoint id, so this can only fire if a future edit removes an
 * entry the map currently guarantees — the same "can't happen in production, but must
 * never silently default" shape as `requireCheckpoint` below.
 */
function requireCheckpointProducedType(checkpoint: string): string {
  const type = CHECKPOINT_PRODUCED_TYPE[checkpoint];
  if (type === undefined) {
    throw new Error(
      `Internal error: checkpoint "${checkpoint}" has no entry in CHECKPOINT_PRODUCED_TYPE`,
    );
  }
  return type;
}

/**
 * `applies_to` scope this gate discovers its feeding skill by — matches the
 * `extra.skill.applies_to` value `scripts/seed-write-spec-rule.ts` seeds on the
 * "Write-spec rules (gate feeding source)" doc. `CorpusService.findFeedingSkill`
 * discovers ANY approved `knowledge/skill` doc declaring this scope, not just that
 * specific seeded title — discovery is by declared scope, not a hardcoded title
 * literal (IoC vertical-slice tech-spec §4.1/§11, P1 slice-2). Derived from the SSOT
 * map (see `requireCheckpointProducedType`) rather than a second hardcoded literal.
 */
const SPEC_CREATE_PRODUCED_TYPE = requireCheckpointProducedType("spec-create");

/** Fallback rule slice used when no approved `knowledge/skill` doc declares `applies_to: "spec"` yet. */
const RULE_DOC_MISSING_PLACEHOLDER =
  `(No approved rule doc found — run \`bun scripts/seed-write-spec-rule.ts\` to seed it. ` +
  `Expected: type=knowledge, status=approved, extra.sub_type="skill", ` +
  `extra.skill.applies_to="${SPEC_CREATE_PRODUCED_TYPE}".)`;

/**
 * Candidate spec-creation payload, shaped after MCP `lore_create`'s input schema
 * (`../../mcp/tools.js::LoreCreateSchema`) but scoped to only the fields the three
 * gate predicates consume. `.passthrough()` so callers may pass the FULL `lore_create`
 * payload (e.g. `tags`, `ai`) without this schema rejecting the extra keys — this gate
 * only reads a subset, it does not re-validate the whole create contract (that is
 * `createDocInputSchema`'s job, at actual creation time).
 */
const gateSpecCreateInputSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    parent_id: z.string().optional(),
    content: z.string().optional(),
    extra: z.object({ spec_kind: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

type GateSpecCreateInput = z.infer<typeof gateSpecCreateInputSchema>;

export default defineCommand({
  meta: {
    name: "gate",
    description: "Corpus-governed creation-time interception gates (deterministic zone)",
  },
  subCommands: {
    "spec-create": defineCommand({
      meta: {
        name: "spec-create",
        description:
          "Deterministic pre-flight gate for spec creation: legal parent, valid spec_kind, required skeleton",
      },
      args: {
        "input-json": {
          type: "string",
          description:
            'JSON matching lore_create\'s input shape: {type, title, parent_id?, content, extra?: {spec_kind?}}',
          required: true,
        },
      },
      async run({ args }) {
        // LORE_GATE_BYPASS=1: exit 0 before ANY parsing or checking (module header).
        if (process.env["LORE_GATE_BYPASS"] === "1") {
          process.exitCode = 0;
          return;
        }

        const rawInputJson = args["input-json"];
        let candidate: unknown;
        try {
          candidate = JSON.parse(rawInputJson as string);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          process.stderr.write(`Error: --input-json is not valid JSON: ${message}\n`);
          process.exitCode = 2;
          return;
        }

        const parsed = gateSpecCreateInputSchema.safeParse(candidate);
        if (!parsed.success) {
          const issue = parsed.error.issues[0];
          process.stderr.write(
            `Error: --input-json does not match the expected shape: ${issue?.message ?? "invalid input"}\n`,
          );
          process.exitCode = 2;
          return;
        }

        const { app, config } = loadLoreApp();
        try {
          if (isGateDisabledByConfig("spec-create", config)) return;
          await runSpecCreateGate(app, parsed.data);
        } finally {
          app.close();
        }
      },
    }),

    "spec-promote": defineCommand({
      meta: {
        name: "spec-promote",
        description:
          "Deterministic pre-approve gate for a spec: requires ≥1 structured acceptance " +
          "criterion; a probabilistic-zone AI judge summary is printed to stderr as an " +
          "advisory that never changes the exit code (INV2)",
      },
      args: {
        spec: {
          type: "string",
          description: "Spec document ID or slug to gate",
          required: true,
        },
      },
      async run({ args }) {
        // LORE_GATE_BYPASS=1: exit 0 before ANY parsing or checking (module header).
        if (process.env["LORE_GATE_BYPASS"] === "1") {
          process.exitCode = 0;
          return;
        }

        const { app, config } = loadLoreApp();
        try {
          if (isGateDisabledByConfig("spec-promote", config)) return;
          await runSpecPromoteGate(app, args.spec as string);
        } finally {
          app.close();
        }
      },
    }),

    "plan-promote": defineCommand({
      meta: {
        name: "plan-promote",
        description:
          "Deterministic commit-time gate for promoting a plan: when the plan has a " +
          "spec-tier ancestor, it must be approved and declare ≥1 acceptance criterion; " +
          "a plan with no spec-tier ancestor passes vacuously",
      },
      args: {
        plan: {
          type: "string",
          description: "Plan document ID or slug to gate",
          required: true,
        },
      },
      async run({ args }) {
        // LORE_GATE_BYPASS=1: exit 0 before ANY parsing or checking (module header).
        if (process.env["LORE_GATE_BYPASS"] === "1") {
          process.exitCode = 0;
          return;
        }

        const { app, config } = loadLoreApp();
        try {
          if (isGateDisabledByConfig("plan-promote", config)) return;
          await runPlanPromoteGate(app, args.plan as string);
        } finally {
          app.close();
        }
      },
    }),

    "task-claim": defineCommand({
      meta: {
        name: "task-claim",
        description:
          "Deterministic commit-time gate for claiming a task: when the task's plan " +
          "has a spec-tier ancestor, it must be approved; a fresh sibling claim in " +
          "the same plan whose declared file_anchors overlap this task's own also " +
          "blocks (SPEC-042 D5); a plan with no spec-tier ancestor and no siblings " +
          "with overlapping anchors passes vacuously",
      },
      args: {
        task: {
          type: "string",
          description: "Task document ID or slug to gate",
          required: true,
        },
        by: {
          type: "string",
          description:
            "Actor identity attempting the claim (feeds the anchor-overlap 'different " +
            "actor' test, SPEC-042 D5); defaults to $LORE_ACTOR env var, then OS username " +
            "— same resolution order as `lore claim`",
        },
      },
      async run({ args }) {
        // LORE_GATE_BYPASS=1: exit 0 before ANY parsing or checking (module header).
        if (process.env["LORE_GATE_BYPASS"] === "1") {
          process.exitCode = 0;
          return;
        }

        const { app, config } = loadLoreApp();
        try {
          if (isGateDisabledByConfig("task-claim", config)) return;
          const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
          await runTaskClaimGate(app, args.task as string, by, config);
        } finally {
          app.close();
        }
      },
    }),
  },
});

/**
 * Checks `workflow.gates.<checkpoint>.enabled` (`@lore/core::resolveGateEnabled`) before
 * a checkpoint's predicates run. Precedence (module header): `LORE_GATE_BYPASS=1` (already
 * checked, before `config` was even loaded) ≥ this per-checkpoint disable ≥ the checkpoint's
 * own predicates. When explicitly disabled, writes the one-line stderr note and sets exit
 * code 0 — callers `return` immediately afterward without invoking their `runXGate` helper.
 *
 * @param checkpoint - Checkpoint id this `run()` belongs to.
 * @param config - `loadLoreApp()`'s resolved project config (may be `undefined`).
 * @returns `true` iff the checkpoint is disabled (caller must return without gating);
 *   `false` iff the caller should proceed to run the checkpoint normally.
 */
function isGateDisabledByConfig(
  checkpoint: GateCheckpoint,
  config: LoreConfig | undefined,
): boolean {
  if (resolveGateEnabled(config, checkpoint)) {
    return false;
  }
  process.stderr.write(`gate: ${checkpoint} disabled by config\n`);
  process.exitCode = 0;
  return true;
}

/**
 * Runs the three `gate-predicates.js` checks against `input`, printing either a pass
 * marker (exit 0) or a `renderFeedingPack` violation block (exit 4) to stdout.
 *
 * @param app - Wired `App` (from `loadLoreApp()`), used to resolve the candidate's
 *   parent doc and the approved rule doc — read-only, no corpus writes.
 * @param input - Validated candidate spec-creation payload.
 */
async function runSpecCreateGate(app: App, input: GateSpecCreateInput): Promise<void> {
  const parentDoc = await resolveParentDoc(app, input.parent_id);
  const checkpoint = requireCheckpoint("spec-create");

  const ctx: GateContext = {
    parentType: parentDoc !== null ? parentDoc.type : null,
    ...(input.extra?.spec_kind !== undefined ? { specKind: input.extra.spec_kind } : {}),
    content: input.content ?? "",
  };
  const results = checkpoint.check(ctx);

  // reason (§5.4 research finding, P4 T4): a best-effort PUSH of the governing skill
  // on this ALLOW branch (so an agent gets it proactively even on a clean pass, not
  // only after a violation) was investigated and rejected as infeasible at the
  // transport this gate is actually consumed through. `lore gate spec-create` is
  // invoked by `hooks/g1-spec-create.sh`, a Claude Code PreToolUse hook shim — and
  // PreToolUse's `hookSpecificOutput` schema is documented (Tier S: official Claude
  // Code docs, code.claude.com/docs/en/hooks, "Decision control" table, fetched
  // 2026-07-09) as EXACTLY `{hookEventName, permissionDecision, permissionDecisionReason}`
  // on an allow verdict — no `additionalContext` field. `additionalContext` is
  // documented there for `SessionStart` / `Setup` / `SubagentStart` / `Stop` /
  // `SubagentStop` / `PostToolUse`, but explicitly NOT for `PreToolUse` (a second,
  // independently-cached community reference, ~/.cc-switch/skills/claude-code-config/
  // references/hooks-reference.md, agrees: it scopes "Context Addition" to
  // `UserPromptSubmit`/`SessionStart` only and gives PreToolUse's allow/deny schema
  // as `{permissionDecision, updatedInput, reason}` with no context field). Two
  // independent sources agree — CONFIDENCE: HIGH. Since the shim can only pass
  // `permissionDecision`/`permissionDecisionReason` back to the model, there is no
  // channel on THIS allow branch to push the feeding pack through even if this
  // command computed one — g1-spec-create.sh would have nowhere to put it. `lore
  // feed spec-create` (P4 T2, `flows/feed-flow.ts::buildFeed`) therefore remains the
  // ONE guaranteed feed-before-produce surface: an agent PULLS the governing skill
  // ahead of writing rather than receiving it pushed on an allow. This is a
  // documented design constraint, not a gap — see the identical note in
  // `../../../../../hooks/g1-spec-create.sh`. NON-AC-blocking: this comment changes
  // no predicate, no branch, no exit code — "gate: pass" + exit 0 below is BYTE-
  // IDENTICAL to its pre-existing contract (regression-pinned by
  // `tests/integration/gate-spec-create.bun.test.ts` and this task's own
  // `tests/integration/p4-e2e-feed-provenance-loop.bun.test.ts`).
  if (!isCheckpointBlocked(results)) {
    console.log("gate: pass");
    process.exitCode = 0;
    return;
  }

  const rule = await findFeedingSkill(app, SPEC_CREATE_PRODUCED_TYPE);
  const parentMarkdown =
    parentDoc !== null ? await renderDocMarkdown(app, parentDoc) : undefined;

  const feedCtx: GateContext = {
    ...ctx,
    ruleSource: rule.source,
    ruleMarkdown: rule.markdown,
    ...(parentMarkdown !== undefined ? { parentMarkdown } : {}),
  };

  console.log(checkpoint.feed(feedCtx, selectFailures(results)));
  process.exitCode = 4;
}

/**
 * `App.acService` is typed optional only to keep pre-existing hand-built App test
 * stubs (outside this task's file anchors) compiling — mirrors `ac.ts`'s identically
 * named helper. `loadLoreApp()` (this adapter's only App source) always returns a
 * fully-wired App from `createApp`, so this assertion never actually fires in the CLI.
 */
function requireAcService(app: App): AcService {
  if (app.acService === undefined) {
    throw new Error("Internal error: AcService not wired on App");
  }
  return app.acService;
}

/**
 * Looks up `cp` in `checkpointRegistry`, throwing if absent. Both call sites in this
 * file (`"spec-create"`, `"spec-promote"`) are compile-time-known to always be
 * registered — this can only fire if a future edit removes an entry
 * `checkpointRegistry` currently guarantees, mirroring `requireAcService`'s identical
 * "can't happen in production" internal-invariant pattern in this same file.
 */
function requireCheckpoint(cp: GateCheckpoint): CheckpointDef {
  const checkpoint = checkpointRegistry[cp];
  if (checkpoint === undefined) {
    throw new Error(`Internal error: gate checkpoint "${cp}" not registered`);
  }
  return checkpoint;
}

/**
 * Runs the `plan-promote` checkpoint against an already-created plan: resolves the
 * plan's ancestor spec via `CorpusService.getPlanBundle` (the SAME plan→parent-spec
 * traversal `TaskWorkflowService.ready()` uses to compute `upstream_unapproved`), then
 * dispatches through `checkpointRegistry["plan-promote"]`.
 *
 * @param app - Wired `App` (from `loadLoreApp()`).
 * @param planIdOrSlug - Plan document ULID or slug to gate.
 */
async function runPlanPromoteGate(app: App, planIdOrSlug: string): Promise<void> {
  const bundleResult = await app.corpusService.getPlanBundle(planIdOrSlug);
  if (!bundleResult.ok) {
    process.stderr.write(formatError(bundleResult.error) + "\n");
    process.exitCode = exitCode(bundleResult.error);
    return;
  }

  const checkpoint = requireCheckpoint("plan-promote");
  const ctx: GateContext = {
    ...buildUpstreamSpecContext(bundleResult.value.spec),
    targetIdOrSlug: planIdOrSlug,
  };
  const results = checkpoint.check(ctx);

  if (isCheckpointBlocked(results)) {
    console.log(checkpoint.feed(ctx, selectFailures(results)));
    process.exitCode = 4;
    return;
  }

  console.log("gate: pass");
  process.exitCode = 0;
}

/**
 * Runs the `task-claim` checkpoint against an already-created task: resolves the task,
 * validates its type, then — via its `parent_id` (the task's plan, per SPEC-025's
 * `parent_id` + `extra.plan_id` creation contract) — resolves that plan's ancestor
 * spec AND sibling tasks via the SAME `CorpusService.getPlanBundle` traversal
 * `runPlanPromoteGate` and `TaskWorkflowService.ready()`/`enforceClaimGate` all use,
 * then dispatches through `checkpointRegistry["task-claim"]`.
 *
 * Anchor-overlap parity (SPEC-042 §Design Decisions D5, drift fix): this pre-flight
 * CLI gate must reach the IDENTICAL verdict `TaskWorkflowService.claim`'s
 * `GateEnforcer` path reaches for the same task/actor — that means feeding
 * `checkTaskClaim` a POPULATED `candidateBy`/`candidateAnchors`/`siblingClaims` ctx
 * via `buildAnchorGateContext` (`checkpoint-registry.js`), NOT just the upstream-spec
 * ctx. Before this fix, this function built ONLY `buildUpstreamSpecContext(...)` — the
 * anchor fields were always `undefined`, so `noAnchorOverlap` vacuously passed here
 * even while a real conflict blocked `lore claim` itself (the two surfaces disagreed,
 * exactly the drift retro-item-8's SSOT relocation was meant to prevent). `nowIso` is
 * resolved HERE (a CLI adapter may read the wall clock; `checkpoint-registry.ts`'s
 * pure `check`/`feed` callbacks and `GateEnforcer.enforce` may not) and `ttlMinutes`
 * is read from `app.taskWorkflowService.claimTtlMinutes` — the SAME already-resolved
 * value `lore tree`/`lore list`'s claim badges use (`resolveClaimTtlMinutes(config)`,
 * resolved ONCE in `app.ts`) — never re-derived a second time here.
 *
 * @param app - Wired `App` (from `loadLoreApp()`).
 * @param taskIdOrSlug - Task document ULID or slug to gate.
 * @param by - The actor attempting the claim (feeds `noAnchorOverlap`'s "different
 *   actor" test) — resolved by the caller via `resolveActor` (--by > $LORE_ACTOR > OS
 *   username), same precedent as `lore claim`.
 * @param config - `loadLoreApp()`'s resolved project config — forwarded to
 *   `resolveAnchorOverlapGateEnabled` so this gate honors the SAME
 *   `workflow.gates."task-claim".anchor_overlap.enabled` sub-key
 *   `GateEnforcer.isTaskClaimAnchorOverlapEnabled()` reads (SPEC-042 D6) — both call
 *   sites share the one `@lore/core` pure function; no second, independently-drifting
 *   config read was introduced.
 */
async function runTaskClaimGate(
  app: App,
  taskIdOrSlug: string,
  by: string,
  config: LoreConfig | undefined,
): Promise<void> {
  const taskResult = await app.corpusService.get(taskIdOrSlug);
  if (!taskResult.ok) {
    process.stderr.write(formatError(taskResult.error) + "\n");
    process.exitCode = exitCode(taskResult.error);
    return;
  }

  const task = taskResult.value.doc;
  if (task.type !== "task") {
    const error: LoreError = {
      code: "VALIDATION_ERROR",
      field: "type",
      message: `Expected a task document; got type '${task.type}'`,
      value: task.type,
    };
    process.stderr.write(formatError(error) + "\n");
    process.exitCode = exitCode(error);
    return;
  }

  const checkpoint = requireCheckpoint("task-claim");
  const nowIso = new Date().toISOString();
  const ttlMinutes = app.taskWorkflowService.claimTtlMinutes;
  const anchorOverlapEnabled = resolveAnchorOverlapGateEnabled(config);

  // reason: a task's parent_id is schema-required to be its plan (createDocInputSchema
  // superRefine, @lore/core/schemas.ts) — a null parent_id here can only happen on a
  // legacy/corrupted row. Routed through the SAME checkpoint as every other task, via
  // a synthetic "no spec parent, no siblings" context rather than a second hardcoded
  // pass shape: there is no plan to walk, hence no upstream edge to gate against AND
  // no sibling claims to compare anchors with — `buildAnchorGateContext(by, task, [],
  // nowIso, ttlMinutes)` correctly reduces to `{candidateBy: by, candidateAnchors:
  // extractFileAnchors(task), siblingClaims: []}` when passed an empty sibling list
  // (the SAME synthetic shape `TaskWorkflowService.enforceClaimGate` builds for this
  // identical edge case), which vacuously passes `noAnchorOverlap` — see
  // checkpoint-registry.ts's third/fourth module invariants. This keeps "gate: pass"
  // printed from exactly ONE call site below, instead of a duplicated literal on this
  // early-return path.
  let ctx: GateContext;
  if (task.parent_id === null) {
    ctx = {
      ...buildUpstreamSpecContext(undefined),
      ...buildAnchorGateContext(by, task, [], nowIso, ttlMinutes),
      targetIdOrSlug: taskIdOrSlug,
      anchorOverlapEnabled,
    };
  } else {
    const bundleResult = await app.corpusService.getPlanBundle(task.parent_id);
    if (!bundleResult.ok) {
      process.stderr.write(formatError(bundleResult.error) + "\n");
      process.exitCode = exitCode(bundleResult.error);
      return;
    }
    ctx = {
      ...buildUpstreamSpecContext(bundleResult.value.spec),
      ...buildAnchorGateContext(by, task, bundleResult.value.tasks, nowIso, ttlMinutes),
      targetIdOrSlug: taskIdOrSlug,
      anchorOverlapEnabled,
    };
  }

  const results = checkpoint.check(ctx);

  if (isCheckpointBlocked(results)) {
    console.log(checkpoint.feed(ctx, selectFailures(results)));
    process.exitCode = 4;
    return;
  }

  console.log("gate: pass");
  process.exitCode = 0;
}

/**
 * Runs the `spec-promote` deterministic zone (≥1 declared acceptance criterion) against
 * an already-created spec, then makes a best-effort, exit-code-inert judge advisory
 * attempt (module header, INV2). The deterministic outcome is settled and printed
 * BEFORE the advisory attempt runs, so a slow/unreachable AI provider can never delay
 * or flip the gate's verdict — it can only add a trailing stderr note.
 *
 * @param app - Wired `App` (from `loadLoreApp()`).
 * @param specIdOrSlug - Spec document ULID or slug to gate.
 */
async function runSpecPromoteGate(app: App, specIdOrSlug: string): Promise<void> {
  const listResult = await requireAcService(app).listCriteria(specIdOrSlug);
  if (!listResult.ok) {
    process.stderr.write(formatError(listResult.error) + "\n");
    process.exitCode = exitCode(listResult.error);
    return;
  }

  const { criteria } = listResult.value;
  const checkpoint = requireCheckpoint("spec-promote");
  const ctx: GateContext = { acceptanceCriteriaCount: criteria.length, specIdOrSlug };
  const results = checkpoint.check(ctx);

  if (isCheckpointBlocked(results)) {
    process.stderr.write(checkpoint.feed(ctx, selectFailures(results)));
    process.exitCode = 4;
    return;
  }

  console.log(`gate: pass (${criteria.length} acceptance criteria declared)`);
  process.exitCode = 0;

  // reason: the deterministic verdict above is final — everything from here on is the
  // probabilistic-zone advisory (INV2). It writes only to stderr and never touches
  // process.exitCode, regardless of outcome.
  await emitJudgeAdvisory(app, specIdOrSlug);
}

/**
 * Best-effort SPEC-034 judge advisory: assembles the same `ReviewBundle` +
 * `runDeterministicChecks` inputs `lore review` uses, invokes `AIProviderService.judgeDoc`,
 * and prints a one-block summary to stderr. Any failure along the way (bundle assembly,
 * unreachable/misconfigured provider, malformed judge output after `judgeDoc`'s own
 * corrective retry) degrades to a one-line "judge advisory unavailable" stderr note —
 * never an exception, never a process.exitCode write (module header INV2). No
 * `review_judgments` row is persisted; this is a disposable in-band advisory, not a
 * `lore review` invocation.
 */
async function emitJudgeAdvisory(app: App, specIdOrSlug: string): Promise<void> {
  const bundleResult = await app.corpusService.getReviewBundle(specIdOrSlug);
  if (!bundleResult.ok) {
    process.stderr.write(`gate: judge advisory unavailable — ${formatError(bundleResult.error)}\n`);
    return;
  }

  const checks = runDeterministicChecks(bundleResult.value);
  const judgeResult = await app.aiProviderService.judgeDoc(bundleResult.value, checks, {
    source: app.callerSurface,
  });
  if (!judgeResult.ok) {
    process.stderr.write(
      `gate: judge advisory unavailable — ${formatError(judgeResult.error, { aiHasNoFallback: true })}\n`,
    );
    return;
  }

  process.stderr.write(formatJudgeAdvisory(judgeResult.value) + "\n");
}

/** Renders a `NewReviewJudgment` as a compact, greppable stderr advisory block. */
function formatJudgeAdvisory(judgment: NewReviewJudgment): string {
  const lines = [
    `gate: judge advisory — decision=${judgment.decision} confidence=${judgment.confidence.toFixed(2)}`,
  ];
  if (judgment.decision === "escalate" && judgment.blocking_questions.length > 0) {
    lines.push("  blocking questions:");
    for (const q of judgment.blocking_questions) lines.push(`    - ${q}`);
  }
  return lines.join("\n");
}

/** One rule-doc lookup outcome: where the slice came from, and the slice itself. */
interface RuleDocLookup {
  /** Slug of the discovered skill doc, or a descriptive placeholder label when none was found. */
  source: string;
  /** Markdown slice fed to `buildFeedingPack`; `RULE_DOC_MISSING_PLACEHOLDER` when absent. */
  markdown: string;
}

/**
 * Discovers the approved `knowledge/skill` doc scoped to `appliesTo` via
 * `CorpusService.findFeedingSkill` and returns its markdown (MDX-resolved, mirroring
 * `renderDocMarkdown`) — the "active feeding" rule source for a gate's violation
 * output. Supersedes the former hardcoded-title lookup (`findApprovedRuleDoc` /
 * `WRITE_SPEC_RULE_TITLE`): any gate can now be fed by any approved skill doc that
 * declares a matching `extra.skill.applies_to`, not only the one specific seeded title.
 *
 * @param appliesTo - Scope to discover by, e.g. `SPEC_CREATE_PRODUCED_TYPE`.
 * @returns A `RuleDocLookup` with `markdown = RULE_DOC_MISSING_PLACEHOLDER` when no
 *   matching approved skill doc exists, or the discovery/get calls fail — the gate
 *   still surfaces `missing` reasons even when the rule doc itself is unavailable
 *   (backward-compat with the pre-discovery placeholder behaviour).
 */
async function findFeedingSkill(app: App, appliesTo: string): Promise<RuleDocLookup> {
  const discoveryResult = await app.corpusService.findFeedingSkill(appliesTo);
  if (!discoveryResult.ok || discoveryResult.value === null) {
    return { source: `applies_to:${appliesTo}`, markdown: RULE_DOC_MISSING_PLACEHOLDER };
  }

  const match = discoveryResult.value;
  const getResult = await app.corpusService.get(match.id);
  if (!getResult.ok) {
    return { source: match.slug, markdown: RULE_DOC_MISSING_PLACEHOLDER };
  }

  return { source: match.slug, markdown: await renderDocMarkdown(app, getResult.value.doc) };
}
