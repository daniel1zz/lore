/**
 * lore gate — corpus-governed creation-time interception commands (IoC vertical-slice
 * tech-spec §4.1/§11). One "deterministic zone" gate per governed doc-creation flow;
 * `spec-create` and `spec-promote` are its two subcommands (hence the group/subcommand
 * shape rather than flat `gate-spec-create` / `gate-spec-promote` command names).
 * `plan-promote` / `task-claim` / `phase-claim` (SPEC-056 D2/D7 — task-skill-implement-
 * cli-mcp-surfaces-checklist-ref-evidence) join the same command group as
 * "commit-time cross-tier gates" — see the dedicated paragraph below.
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
 * declare ≥ its resolved `spec_kind`'s AC-count floor (`spec.extra.acceptance_criteria`,
 * SPEC-038, counted via `AcService.listCriteria` — the same SSOT `lore ac list` reads;
 * SPEC-058 `workflow.verification_profiles.<kind>.min_acs`, default 1, resolved from
 * the target spec's OWN `extra.spec_kind` — task-lore-gate-spec-promote-cli-pre-flight-
 * is-not-spec-kind, the SAME resolution `CorpusService.set`/`ReviewService.approve`
 * already apply on their own spec-promote gate call sites), AND every declared
 * criterion passes `acQuantifiable`, AND (when the resolved profile declares
 * `required_oracles`) `oracleCoverage`?
 *   - floor not met → exit 4, "no structured acceptance criteria" message naming the
 *     resolved floor + kind (deterministic, hard block).
 *   - floor met but `acQuantifiable`/`oracleCoverage` fails → exit 4, naming the
 *     offending AC/oracle.
 *   - all three pass → "gate: pass", exit 0.
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
 * `lore gate plan-promote --plan <id-or-slug>`, `lore gate task-claim --task
 * <id-or-slug>`, and `lore gate phase-claim --phase <id-or-slug>` (SPEC-056 D2/D7) are
 * the "commit-time cross-tier gates": they gate an ALREADY-CREATED plan (ahead of
 * promotion) / task or phase (ahead of being claimed) against its ANCESTOR spec's
 * approval + AC status, walking the SAME task→plan→ancestor-spec chain
 * `evaluateReadiness`'s `upstream_unapproved` advisory uses
 * (`CorpusService.getPlanBundle`, `@lore/core` task-workflow.ts) — the plan/task/
 * phase's OWN status is never inspected, only its ancestor spec's. When the target has
 * no spec-tier ancestor at all (parented directly under a `prd`, or unparented) there
 * is no upstream edge to gate, so all three checkpoints PASS vacuously (never a
 * failure) — see `checkpoint-registry.js`'s third module invariant.
 *   - `plan-promote`: ancestor spec must be `approved` AND declare ≥1 structured
 *     acceptance criterion (`upstreamApproved` + `upstreamHasAcceptanceCriteria`).
 *   - `task-claim` / `phase-claim`: ancestor spec must be `approved`
 *     (`upstreamApproved`); ADDITIONALLY (SPEC-042 §Design Decisions D5) a fresh
 *     sibling claim in the same plan whose declared `file_anchors` overlap this
 *     target's own also blocks (`noAnchorOverlap`) — evaluated UNCONDITIONALLY, not
 *     gated by whether a spec-tier ancestor exists (unlike `upstreamApproved`).
 *     `phase-claim` reuses `checkTaskClaim` VERBATIM (`checkpoint-registry.ts`'s D2/D7
 *     module invariant — the predicate is doc-type-agnostic) and the SAME
 *     `workflow.gates."task-claim".anchor_overlap.enabled` knob (no dedicated
 *     phase-claim sub-knob exists yet, mirroring `PhaseWorkflowService.
 *     enforceClaimGate`'s identical interim choice). The resolved invoking identity supplies the candidate actor identity the overlap
 *     predicate's "different actor" test needs; this pre-flight check reaches the IDENTICAL
 *     verdict `lore claim`/`PhaseWorkflowService.claim` themselves would for the same
 *     target/actor — `buildAnchorGateContext` (`checkpoint-registry.js`) is the shared
 *     ctx-builder every one of these call sites uses.
 *
 * `LORE_GATE_BYPASS=1` short-circuits to exit 0 before ANY parsing or checking, for
 * ALL FIVE subcommands — an escape hatch for callers that must not be blocked. It
 * keeps its unconditional exit-0 guarantee (SPEC-080 §Design Decisions D3), but now
 * (SPEC-080 G4) makes ONE best-effort attempt to open the corpus and write a
 * `gate_skipped` audit entry (mechanism `"env_bypass"`) BEFORE exiting —
 * `../gate-bypass-audit.js::runGateEnvBypassAudit` holds this decision logic
 * (never throws, never blocks the exit). When the corpus is unreachable (no
 * `.lore/lore.db` discoverable, or the store fails to open), it prints one
 * `gate bypass NOT audited: <reason>` stderr line and STILL exits 0 — the escape
 * hatch's reliability contract is unchanged, only its silence is removed.
 *
 * ⛔ Scope boundary (task-lore-gate-bypass-honored-by-lore-gate-subcommands-but,
 * Design Decision Option B): `LORE_GATE_BYPASS=1` is scoped to THIS command alone —
 * it has NO effect on the identical checkpoint predicates `GateEnforcer.enforce`
 * (`../../../service/gate-enforcer.js`) runs inline inside `CorpusService.create`/
 * `set`, `ReviewService.approve`, and `TaskWorkflowService.claim` (CLI writes, MCP,
 * and the HTTP dashboard all go through that path, never through this file). A
 * caller who exports this variable and then hits one of those write paths still
 * gets denied if the checkpoint fails — but as of this task, that denial's message
 * explicitly says so (see `GateEnforcer`'s module header, "Design Decision — the
 * LORE_GATE_BYPASS=1 write-path boundary"), naming the actually-supported write-path
 * escape hatch (`workflow.gates.<checkpoint>.enabled: false`) instead of leaving the
 * reader to infer why a "bypass" did not bypass anything.
 *
 * `.lore/config.yaml`'s `workflow.gates.<checkpoint>.enabled` is a SEPARATE gate-skip
 * mechanism (mechanism `"config_disabled"`) with its OWN, service-layer-shared audit
 * trace — see `GateEnforcer.enforce`'s config-disabled branch
 * (`../../../service/gate-enforcer.js`); this CLI file's `isGateDisabledByConfig`
 * below is a pre-flight-only check with no service-layer counterpart to reuse, so it
 * does NOT write a `gate_skipped` entry itself (SPEC-080 §Scope only covers the two
 * mechanisms named above, and this CLI-side config check is a documented pre-existing
 * escape hatch distinct from `GateEnforcer`'s own).
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
 * Exit codes (plan-promote / task-claim / phase-claim):
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
 * STRUCTURED-`extra` LOSS NOTICE — THIS IS THE SHARP END
 * (task-the-shared-renderdocmarkdown-seam-still-drops-structured). A denial's feeding
 * pack exists to tell an agent how to fix its REJECTED write; that is the moment a
 * structured `extra` (`issue_report`, `verification_evidence`, `claim`, `ac_scope`) is
 * most load-bearing and least substitutable, because the agent is mid-write and acting on
 * the pack alone. Until that task, BOTH of this file's `renderDocMarkdown` call sites —
 * the `--parent`/`parent_id` slice and `findFeedingSkill`'s "active feeding rule source"
 * slice — handed back a projection that dropped every such value in silence. This file
 * adds NO wiring: `renderDocMarkdown` announces at the SEAM, so both slices inherit it,
 * and so does any future call site. ⛔ Never re-introduce a per-call-site notice here.
 * ⛔ The notice is placed ABOVE the body precisely so `../../../service/gate-feeding.js`'s
 * 800-char LEADING-slice truncation cannot swallow it on a real (multi-KB) doc.
 *
 * `emitGateReportIssueHint` (SPEC-073) is called from all FIVE `isCheckpointBlocked`
 * branches (spec-create, spec-promote, plan-promote, task-claim, phase-claim) right
 * after each checkpoint's own feeding-pack output, appending a one-line "file this
 * upstream" hint to STDERR when the consumer has `feedback.upstream` configured
 * (SPEC-072) — never on the ALLOW branch, never when unconfigured. Shares its wording
 * (`../report-issue-hint.js::buildReportIssueHint`) with `loader.ts`'s `"internal"`
 * errClass sibling.
 *
 * `lore gate plan-close --explain` (spec-plan-close-predicates-measure-invariants-
 * an-applicability §D7) is a SIXTH subcommand, but NOT a pre-flight gate check like
 * the five above — `plan-close`'s real predicates run only inside `CorpusService.set`'s
 * archival transition (there is no candidate-plan pre-flight equivalent). It prints
 * `PREDICATE_CONTRACTS` (`../../../service/predicate-contracts.js`) — every plan-close
 * predicate's invariant, measured proxy, and known false-pass/false-block deltas — so an
 * operator blocked on correctly-executed work reads the delta instead of reaching for an
 * exemption. Purely additive and offline: no corpus read, no `LORE_GATE_BYPASS` check, no
 * exit-code interaction with the other five subcommands.
 *
 * Source: IoC vertical-slice tech-spec §4.1/§5.1/§11 ("deterministic zone" +
 * "active feeding" + INV2 "probabilistic zone is advisory-only")
 *         SPEC-073 §Design (error-path report-issue hint, "gate" errClass)
 *         spec-plan-close-predicates-measure-invariants-an-applicability §D7
 *         ("gate plan-close --explain")
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
  isNonPlanParentError,
  type CheckpointDef,
  type GateCheckpoint,
  type GateContext,
} from "../../../service/checkpoint-registry.js";
import { resolveClaimSessionId } from "../../../service/task-workflow-service.js";
import {
  runDeterministicChecks,
  resolveGateEnabled,
  resolveAnchorOverlapGateEnabled,
  resolveAcQuantifiableGateEnabled,
  resolveOracleCoverageGateEnabled,
  resolveVerificationProfile,
  specAcceptanceCriteriaSchema,
  SPEC_KINDS,
} from "@lore/core";
import type { App } from "../../../app.js";
import type { AcService } from "../../../service/ac-service.js";
import type { LoreConfig, LoreError, NewReviewJudgment, SpecKind } from "@lore/core";
import type { RecordGateSkip } from "../../../service/gate-enforcer.js";
import {
  renderDocMarkdown,
  resolveParentDoc,
  CHECKPOINT_PRODUCED_TYPE,
} from "../../../flows/feed-flow.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";
// reason: this file already imports "../loader.js" (bun:sqlite via createApp), so it
// is bun-only and never vitest-reachable — no lazy-import indirection needed for
// report-issue-wiring.ts's transitive bun:sqlite value-imports (mirrors loader.ts's
// identical note).
import { buildReportIssueHint } from "../report-issue-hint.js";
import { resolveFeedbackUpstreamCfg } from "../report-issue-wiring.js";
// reason: SPEC-080 G4 — `../gate-bypass-audit.js` is itself vitest-safe (no
// bun:sqlite import), but this file's OWN use of it needs a real store, hence the
// direct SQLiteStore import here rather than going through `loadLoreApp()` (which
// calls `process.exit(1)` on a missing corpus — the bypass path must never do
// that, see `openBypassRecordGateSkip` below).
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { findLoreDbPathQuiet, runGateEnvBypassAudit } from "../gate-bypass-audit.js";
import { renderPredicateContractsExplain } from "../../../service/predicate-contracts.js";

/**
 * Real `GateBypassAuditDeps.openRecordGateSkip` wiring for the `LORE_GATE_BYPASS=1`
 * escape hatch (SPEC-080 G4) — deliberately bypasses `loadLoreApp()` (which calls
 * `process.exit(1)` on a missing/corrupted corpus, breaking this path's own
 * unconditional exit-0 guarantee) in favor of a minimal, defensive open: discover
 * `.lore/lore.db` via `findLoreDbPathQuiet()` (returns `undefined`, never exits, on
 * a miss) and construct a bare `SQLiteStore` directly — this bypass audit needs
 * nothing beyond `appendAuditEntry`, not the full `App` composition root (AI
 * provider registry, telemetry, etc.), so there is strictly less that can go wrong
 * on this already-defensive path. A `SQLiteStore` construction failure (e.g. a
 * corrupted `.lore/lore.db`, mirrors `loader.ts`'s identical SPEC-073 catch)
 * degrades to `null` — "unreachable" — rather than throwing, though
 * `runGateEnvBypassAudit` also tolerates a throw from this port if one ever
 * slipped through. The opened store is deliberately left open (not `.close()`d) —
 * this CLI invocation exits immediately after via `process.exitCode = 0`, and the
 * OS reclaims the file descriptor at process exit; the write itself is already
 * awaited by `runGateEnvBypassAudit` before that exit, so no data loss window
 * exists.
 */
async function openBypassRecordGateSkip(): Promise<RecordGateSkip | null> {
  const dbPath = findLoreDbPathQuiet();
  if (dbPath === undefined) return null;
  try {
    const store = new SQLiteStore(dbPath);
    return store.appendAuditEntry.bind(store);
  } catch {
    return null;
  }
}

/**
 * One-line call-site wrapper around `runGateEnvBypassAudit` binding the real
 * `openBypassRecordGateSkip` port — every one of this file's FIVE
 * `LORE_GATE_BYPASS=1` branches calls this instead of repeating the deps object
 * literal five times.
 */
async function auditGateBypass(checkpoint: GateCheckpoint): Promise<void> {
  await runGateEnvBypassAudit(checkpoint, { openRecordGateSkip: openBypassRecordGateSkip });
}

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
 * (`../../mcp/tools.js::LoreCreateSchema`) but scoped to only the fields the gate
 * predicates consume — including `acQuantifiable` (AC-Quantifiability Gate spec
 * §Design), the CLI-preflight parity fix that threads `extra.acceptance_criteria`
 * into the same `GateContext` the service-layer `GateEnforcer` already builds
 * (`CorpusService._createImpl`). `extra.acceptance_criteria` is typed `z.unknown()`
 * here — this schema only gates SHAPE-of-envelope, not AC content; the actual
 * `specAcceptanceCriteriaSchema.safeParse` (in `runSpecCreateGate`) is the real
 * validation, and a malformed/absent array degrades to `acceptanceCriteria`
 * undefined — `acQuantifiable`'s vacuous-pass semantics treat that identically to
 * "no ACs declared yet". `.passthrough()` so callers may pass the FULL
 * `lore_create` payload (e.g. `tags`, `ai`) without this schema rejecting the
 * extra keys — this gate only reads a subset, it does not re-validate the whole
 * create contract (that is `createDocInputSchema`'s job, at actual creation time).
 */
const gateSpecCreateInputSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    parent_id: z.string().optional(),
    content: z.string().optional(),
    extra: z
      .object({ spec_kind: z.string().optional(), acceptance_criteria: z.unknown().optional() })
      .passthrough()
      .optional(),
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
          "Deterministic pre-flight gate for spec creation: no parent (BR-2), valid spec_kind, required skeleton",
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
        // LORE_GATE_BYPASS=1: exit 0 before ANY parsing or checking (module header;
        // SPEC-080 G4 — best-effort env_bypass audit trace, exit-0 unconditional).
        if (process.env["LORE_GATE_BYPASS"] === "1") {
          await auditGateBypass("spec-create");
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
          await runSpecCreateGate(app, parsed.data, config);
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
        // LORE_GATE_BYPASS=1: exit 0 before ANY parsing or checking (module header;
        // SPEC-080 G4 — best-effort env_bypass audit trace, exit-0 unconditional).
        if (process.env["LORE_GATE_BYPASS"] === "1") {
          await auditGateBypass("spec-promote");
          process.exitCode = 0;
          return;
        }

        const { app, config } = loadLoreApp();
        try {
          if (isGateDisabledByConfig("spec-promote", config)) return;
          await runSpecPromoteGate(app, args.spec as string, config);
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
        // LORE_GATE_BYPASS=1: exit 0 before ANY parsing or checking (module header;
        // SPEC-080 G4 — best-effort env_bypass audit trace, exit-0 unconditional).
        if (process.env["LORE_GATE_BYPASS"] === "1") {
          await auditGateBypass("plan-promote");
          process.exitCode = 0;
          return;
        }

        const { app, config } = loadLoreApp();
        try {
          if (isGateDisabledByConfig("plan-promote", config)) return;
          await runPlanPromoteGate(app, args.plan as string, config);
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
      },
      async run({ args }) {
        // LORE_GATE_BYPASS=1: exit 0 before ANY parsing or checking (module header;
        // SPEC-080 G4 — best-effort env_bypass audit trace, exit-0 unconditional).
        if (process.env["LORE_GATE_BYPASS"] === "1") {
          await auditGateBypass("task-claim");
          process.exitCode = 0;
          return;
        }

        const { app, config } = loadLoreApp();
        try {
          if (isGateDisabledByConfig("task-claim", config)) return;
          const by = resolveActor();
          await runTaskClaimGate(app, args.task as string, by, config);
        } finally {
          app.close();
        }
      },
    }),

    "phase-claim": defineCommand({
      meta: {
        name: "phase-claim",
        description:
          "Deterministic commit-time gate for claiming a phase document (SPEC-056 D2/D7 " +
          "— the phase-doc-typed sibling of task-claim, reusing the SAME checkTaskClaim " +
          "predicate): when the phase's plan has a spec-tier ancestor, it must be " +
          "approved; a fresh sibling claim in the same plan whose declared file_anchors " +
          "overlap this phase's own also blocks; a plan with no spec-tier ancestor and " +
          "no siblings with overlapping anchors passes vacuously",
      },
      args: {
        phase: {
          type: "string",
          description: "Phase document ID or slug to gate",
          required: true,
        },
      },
      async run({ args }) {
        // LORE_GATE_BYPASS=1: exit 0 before ANY parsing or checking (module header;
        // SPEC-080 G4 — best-effort env_bypass audit trace, exit-0 unconditional).
        if (process.env["LORE_GATE_BYPASS"] === "1") {
          await auditGateBypass("phase-claim");
          process.exitCode = 0;
          return;
        }

        const { app, config } = loadLoreApp();
        try {
          if (isGateDisabledByConfig("phase-claim", config)) return;
          const by = resolveActor();
          await runPhaseClaimGate(app, args.phase as string, by, config);
        } finally {
          app.close();
        }
      },
    }),

    "plan-close": defineCommand({
      meta: {
        name: "plan-close",
        description:
          "Additive, informational-only subcommand (spec-plan-close-predicates-measure-" +
          "invariants-an-applicability §D7): `--explain` prints the plan-close predicate " +
          "contract table (PREDICATE_CONTRACTS) — invariant, measured proxy, and known " +
          "false-pass/false-block deltas per predicate. This is NOT a pre-flight gate " +
          "check (unlike spec-create/spec-promote/plan-promote/task-claim/phase-claim " +
          "above) — plan-close's real predicates run only at `lore set`'s archival " +
          "transition, and this subcommand never touches the corpus.",
      },
      args: {
        explain: {
          type: "boolean",
          description:
            "Print every plan-close predicate's field/invariant/measured/known-delta " +
            "contract (order matters: run as `lore gate plan-close --explain`, not " +
            "`lore gate --explain plan-close` — citty resolves the checkpoint token as " +
            "a subcommand name first, so a flag preceding it is dropped)",
          default: false,
        },
      },
      async run({ args }) {
        // reason: unlike the five checkpoint subcommands above, this one never
        // reads the corpus or runs a predicate — it is a pure, offline render
        // of the static contract table, so it deliberately has no
        // LORE_GATE_BYPASS / isGateDisabledByConfig / loadLoreApp call site.
        if (!args.explain) {
          process.stderr.write(
            "gate plan-close: pass --explain to print the predicate contract table " +
              "(plan-close has no other CLI pre-flight check yet — its real gate runs " +
              "at `lore set`'s archival transition).\n",
          );
          process.exitCode = 2;
          return;
        }
        // reason: matches this file's established stdout convention for the
        // other five subcommands' pass/feed output (`console.log`, not
        // `process.stdout.write`) — CLI surface.
        console.log(renderPredicateContractsExplain("plan-close"));
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
 * Runs the `gate-predicates.js` checks against `input` (`parentLegal` / `specKindValid`
 * / `hasSkeleton` / `acQuantifiable`), printing either a pass marker (exit 0) or a
 * `renderFeedingPack` violation block (exit 4) to stdout.
 *
 * `acQuantifiable` (AC-Quantifiability Gate spec §Design, CLI-preflight parity fix)
 * consumes `input.extra.acceptance_criteria` — the SAME field
 * `CorpusService._createImpl`'s service-layer `GateEnforcer` path already lints for
 * a real `lore create spec` / `lore_create` call. Parsing it here (rather than
 * trusting the untyped `.passthrough()` value) means a candidate whose ACs don't
 * even match `specAcceptanceCriteriaSchema`'s shape degrades to `acceptanceCriteria`
 * undefined — `acQuantifiable`'s vacuous-pass semantics, not a second validation
 * error this gate was never designed to surface (the real create-time write still
 * enforces AC shape via `createDocInputSchema`).
 *
 * @param app - Wired `App` (from `loadLoreApp()`), used to resolve the candidate's
 *   parent doc and the approved rule doc — read-only, no corpus writes.
 * @param input - Validated candidate spec-creation payload.
 * @param config - `loadLoreApp()`'s resolved project config — forwarded to
 *   `resolveAcQuantifiableGateEnabled` so this pre-flight gate honors the SAME
 *   `workflow.gates."spec-create".ac_quantifiable.enabled` sub-key
 *   `GateEnforcer.isAcQuantifiableEnabled()` reads; no second, independently-drifting
 *   config read.
 */
async function runSpecCreateGate(
  app: App,
  input: GateSpecCreateInput,
  config: LoreConfig | undefined,
): Promise<void> {
  const parentDoc = await resolveParentDoc(app, input.parent_id);
  const checkpoint = requireCheckpoint("spec-create");

  const acceptanceCriteriaParsed = specAcceptanceCriteriaSchema.safeParse(
    input.extra?.acceptance_criteria,
  );
  const ctx: GateContext = {
    // reason: BR-2 — a spec takes no parent, so a parent_id that names ANY document, or one that
    // resolves to nothing, is refused; `parentLegal` only needs to know a parent was named.
    parentType: parentDoc !== null ? parentDoc.type : input.parent_id !== undefined ? "unresolved" : null,
    ...(input.extra?.spec_kind !== undefined ? { specKind: input.extra.spec_kind } : {}),
    content: input.content ?? "",
    ...(acceptanceCriteriaParsed.success
      ? { acceptanceCriteria: acceptanceCriteriaParsed.data }
      : {}),
    acQuantifiableEnabled: resolveAcQuantifiableGateEnabled(config, "spec-create"),
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

  const failures = selectFailures(results);
  console.log(checkpoint.feed(feedCtx, failures));
  emitGateReportIssueHint(config);
  recordHookGateDeny(app, "spec-create", failures, undefined);
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
 * SPEC-102 D7 — fires the HOOK-layer `kind="gate_deny"` trace row for one of
 * this file's five `isCheckpointBlocked` branches. `layer: "hook"`
 * disambiguates from `GateEnforcer.enforce`'s own `layer: "service"` deny
 * (the two layers see different traffic: `lore gate` PRE-EMPTS a blocked
 * service call entirely, so recording both is deliberate, not double-counting
 * the SAME event). A no-op when `app.traceRecorder` is absent (trace.enabled
 * resolves false) — mirrors every other optional-DI trace call site.
 *
 * @param actor - Explicit actor when this checkpoint's runner already has one
 *   (`task-claim`/`phase-claim`'s `by` param); `undefined` falls back to
 *   `resolveActor()`'s own resolution — the SAME
 *   resolution every other actor-needing call in this file already uses.
 */
function recordHookGateDeny(
  app: App,
  checkpoint: GateCheckpoint,
  failures: ReturnType<typeof selectFailures>,
  targetIdOrSlug: string | undefined,
  actor?: string,
): void {
  if (app.traceRecorder === undefined) return;
  const resolvedActor = actor ?? resolveActor();
  app.traceRecorder.recordGateDeny(
    resolvedActor,
    checkpoint,
    failures.map((f) => f.reason),
    targetIdOrSlug,
    "hook",
  );
}

/**
 * Best-effort SPEC-073 report-issue hint for a gate denial's stderr output — the
 * SAME `errClass: "gate"` classification `loader.ts`'s `"internal"` sibling uses,
 * shared wording (`report-issue-hint.ts::buildReportIssueHint`). Called from every
 * one of this file's FIVE `isCheckpointBlocked` branches (spec-create, spec-promote,
 * plan-promote, task-claim, phase-claim) right after the checkpoint's own feeding-pack
 * output — never before it, so the hint always reads as a trailing note, not the
 * primary denial content. Wrapped in a `try/catch` so a hint-resolution failure can
 * NEVER turn a working gate-deny path into a crash; prints nothing when the hint
 * resolves to `null` (unconfigured consumer) — every pre-SPEC-073 blocked-output
 * byte sequence is otherwise untouched.
 *
 * @param config - `loadLoreApp()`'s resolved project config (may be `undefined`) —
 *   the SAME value each `run{X}Gate` function already threads through for
 *   `resolveAcQuantifiableGateEnabled`/`resolveAnchorOverlapGateEnabled`; no second
 *   config parse.
 */
function emitGateReportIssueHint(config: LoreConfig | undefined): void {
  let hint: string | null = null;
  try {
    hint = buildReportIssueHint("gate", resolveFeedbackUpstreamCfg(config) !== undefined);
  } catch {
    hint = null;
  }
  if (hint !== null) process.stderr.write(hint + "\n"); // CLI surface
}

/**
 * Runs the `plan-promote` checkpoint against an already-created plan: resolves the
 * plan's ancestor spec via `CorpusService.getPlanBundle` (the SAME plan→parent-spec
 * traversal `TaskWorkflowService.ready()` uses to compute `upstream_unapproved`), then
 * dispatches through `checkpointRegistry["plan-promote"]`.
 *
 * @param app - Wired `App` (from `loadLoreApp()`).
 * @param planIdOrSlug - Plan document ULID or slug to gate.
 * @param config - `loadLoreApp()`'s resolved project config — forwarded ONLY to
 *   `emitGateReportIssueHint` (SPEC-073); `plan-promote`'s own predicates read no
 *   config-driven knob today, unlike its `task-claim`/`phase-claim`/`spec-create`/
 *   `spec-promote` siblings, which is why this parameter is new to this function.
 */
async function runPlanPromoteGate(
  app: App,
  planIdOrSlug: string,
  config: LoreConfig | undefined,
): Promise<void> {
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
    const failures = selectFailures(results);
    console.log(checkpoint.feed(ctx, failures));
    emitGateReportIssueHint(config);
    recordHookGateDeny(app, "plan-promote", failures, planIdOrSlug);
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
 * SPEC-069 ad-hoc gap fix (task-fix-spec-069-gap-adhoc-task-claim-structurally-
 * impossible): a `--adhoc` task's `parent_id` is the root PRD (non-null, but not a
 * `plan`), so `getPlanBundle` used to hard-fail this gate with "Expected a plan
 * document" for the ENTIRE `--adhoc` channel. `isNonPlanParentError` distinguishes
 * that specific, structural failure shape from every other `getPlanBundle` error and
 * routes it through the vacuous-pass-on-upstream-spec branch, while still running
 * `noAnchorOverlap` against `app.taskWorkflowService.findAdhocSiblingTasks()` (every
 * other corpus-wide `extra.adhoc === true` task) — never an empty sibling list, which
 * would silently disable this predicate for every ad-hoc task. See the inline `reason`
 * comment at that branch.
 *
 * Session parity (task-two-concurrent-orchestrators-both-resolve-to-agent-main): the
 * anchor mutex now compares the CAPTURED session instance, not the `by` string, so this
 * pre-flight reads `$CLAUDE_CODE_SESSION_ID`/`$CLAUDE_SESSION_ID` through the SAME
 * `resolveClaimSessionId` the service's claim path uses and threads it into
 * `buildAnchorGateContext`. Omitting it here would make the dry-run stricter than the
 * real command (every same-actor overlap would read as "session not measured"), i.e. a
 * pre-flight refusing what `lore claim` accepts. {@link runPhaseClaimGate} below now
 * does the IDENTICAL read for the IDENTICAL reason — the two surfaces are symmetric
 * again (task-phaseworkflowservice-claim-captures-no-session-id-so-every §Required fix
 * 4: pre-flight and claim must never be threaded differently). A previous revision of
 * this paragraph documented a deliberate asymmetry, valid only while
 * `PhaseWorkflowService.claim` captured nothing at all.
 *
 * @param app - Wired `App` (from `loadLoreApp()`).
 * @param taskIdOrSlug - Task document ULID or slug to gate.
 * @param by - The actor attempting the claim (feeds `noAnchorOverlap`'s "different
 *   actor" test) — resolved by the caller via `resolveActor`, same precedent as `lore claim`.
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
  // reason: anchor-overlap PARITY with the real claim (this function's own header
  // invariant) — `TaskWorkflowService.claim` captures the session instance from
  // `process.env` and feeds it to `noAnchorOverlap`
  // (task-two-concurrent-orchestrators-both-resolve-to-agent-main). Without this
  // read, the dry-run would evaluate the SAME pair as "session not measured" and
  // print a refusal the real claim does not produce — a pre-flight that
  // contradicts the command it previews is worse than no pre-flight. An unusable
  // session id is surfaced here exactly as `claim()` surfaces it, never ignored.
  const sessionIdResult = resolveClaimSessionId(process.env);
  if (!sessionIdResult.ok) {
    process.stderr.write(formatError(sessionIdResult.error) + "\n");
    process.exitCode = exitCode(sessionIdResult.error);
    return;
  }
  const candidateSessionId = sessionIdResult.value;

  // reason: BR-1056 — parity with the real claim: its overlap test compares holders by the claimant's VERIFIED
  // run, so the dry-run reads the same invocation identity (unregistered -> null + one warning).
  const verifiedIdentity = await app.verifiedInvocationIdentity?.();
  if (verifiedIdentity !== undefined && !verifiedIdentity.ok) {
    process.stderr.write(formatError(verifiedIdentity.error) + "\n");
    process.exitCode = exitCode(verifiedIdentity.error);
    return;
  }
  const candidateRun = verifiedIdentity?.value?.harnessRun ?? null;

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
      ...buildAnchorGateContext(by, task, [], nowIso, ttlMinutes, candidateSessionId),
      targetIdOrSlug: taskIdOrSlug,
      candidateRun,
      anchorOverlapEnabled,
    };
  } else {
    const bundleResult = await app.corpusService.getPlanBundle(task.parent_id);
    if (!bundleResult.ok) {
      // reason: SPEC-069 ad-hoc gap fix (task-fix-spec-069-gap-adhoc-task-claim-
      // structurally-impossible) — every `--adhoc` task (SPEC-069 D2) is auto-
      // parented to the root PRD, a NON-null `parent_id` that resolves but isn't
      // `type: "plan"`. `getPlanBundle` reports that SPECIFIC shape via
      // `isNonPlanParentError` (checkpoint-registry.ts); routed through the SAME
      // "no governing plan" vacuous-pass-on-upstreamApproved treatment as
      // `parent_id === null` above, mirroring `TaskWorkflowService.
      // enforceClaimGate`'s identical fix — but `noAnchorOverlap` still runs
      // against REAL corpus-wide ad-hoc siblings (`findAdhocSiblingTasks`), not
      // an empty list, so this pre-flight gate keeps reaching the IDENTICAL
      // verdict `lore claim` itself now reaches for the same task/actor (the
      // anchor-overlap-parity invariant this function's own header documents).
      // Every OTHER `getPlanBundle` failure (unresolvable/soft-deleted parent,
      // store error) still exits loud, unchanged.
      if (!isNonPlanParentError(bundleResult.error)) {
        process.stderr.write(formatError(bundleResult.error) + "\n");
        process.exitCode = exitCode(bundleResult.error);
        return;
      }
      const siblingsResult = await app.taskWorkflowService.findAdhocSiblingTasks();
      if (!siblingsResult.ok) {
        process.stderr.write(formatError(siblingsResult.error) + "\n");
        process.exitCode = exitCode(siblingsResult.error);
        return;
      }
      ctx = {
        ...buildUpstreamSpecContext(undefined),
        ...buildAnchorGateContext(by, task, siblingsResult.value, nowIso, ttlMinutes, candidateSessionId),
        targetIdOrSlug: taskIdOrSlug,
        candidateRun,
        anchorOverlapEnabled,
      };
    } else {
      ctx = {
        ...buildUpstreamSpecContext(bundleResult.value.spec),
        ...buildAnchorGateContext(by, task, bundleResult.value.tasks, nowIso, ttlMinutes, candidateSessionId),
        targetIdOrSlug: taskIdOrSlug,
        candidateRun,
        anchorOverlapEnabled,
      };
    }
  }

  const results = checkpoint.check(ctx);

  if (isCheckpointBlocked(results)) {
    const failures = selectFailures(results);
    console.log(checkpoint.feed(ctx, failures));
    emitGateReportIssueHint(config);
    recordHookGateDeny(app, "task-claim", failures, taskIdOrSlug, by);
    process.exitCode = 4;
    return;
  }

  console.log("gate: pass");
  process.exitCode = 0;
}

/**
 * Runs the `phase-claim` checkpoint against an already-created phase document
 * (SPEC-056 D2/D7) — mirrors `runTaskClaimGate` exactly, substituting `phase` doc-type
 * validation and `requirePhaseWorkflowService(app).claimTtlMinutes` for
 * `app.taskWorkflowService.claimTtlMinutes` (the checkpoint predicates themselves are
 * IDENTICAL — `checkTaskClaim`, reused verbatim by `checkpointRegistry["phase-claim"]`,
 * `service/checkpoint-registry.ts`'s own D2/D7 module invariant). `resolveAnchorOverlapGateEnabled`
 * is called WITHOUT a checkpoint argument (it only reads the `task-claim` knob) —
 * `PhaseWorkflowService.enforceClaimGate` documents this SAME interim choice: no
 * phase-claim-scoped `anchor_overlap.enabled` sub-knob exists yet, so this pre-flight
 * CLI gate reuses the identical `workflow.gates."task-claim".anchor_overlap.enabled`
 * value the service-layer path already reads, keeping the two surfaces' verdicts in sync.
 *
 * Session parity (task-phaseworkflowservice-claim-captures-no-session-id-so-every
 * §Required fix 4, AC-4): `PhaseWorkflowService.claim` now CAPTURES the session instance
 * from `$CLAUDE_CODE_SESSION_ID`/`$CLAUDE_SESSION_ID`, so this pre-flight reads it
 * through the SAME `resolveClaimSessionId` and threads it into `buildAnchorGateContext`
 * — byte-for-byte what `runTaskClaimGate` above does. Threading it in only ONE of the
 * two places is the failure mode this pairing exists to prevent: omit it here and every
 * same-actor overlap would print a `ANCHOR_OVERLAP_SESSION_UNMEASURED` refusal the real
 * `lore claim <phase>` does not produce (a dry-run contradicting the command it
 * previews); pass it here while the service captured nothing would be the mirror lie.
 *
 * @param app - Wired `App` (from `loadLoreApp()`).
 * @param phaseIdOrSlug - Phase document ULID or slug to gate.
 * @param by - The actor attempting the claim (feeds `noAnchorOverlap`'s "different
 *   actor" test) — resolved by the caller via `resolveActor`, same precedent as
 *   `lore claim`/`runTaskClaimGate`.
 * @param config - `loadLoreApp()`'s resolved project config — forwarded to
 *   `resolveAnchorOverlapGateEnabled` (see above).
 */
async function runPhaseClaimGate(
  app: App,
  phaseIdOrSlug: string,
  by: string,
  config: LoreConfig | undefined,
): Promise<void> {
  const phaseResult = await app.corpusService.get(phaseIdOrSlug);
  if (!phaseResult.ok) {
    process.stderr.write(formatError(phaseResult.error) + "\n");
    process.exitCode = exitCode(phaseResult.error);
    return;
  }

  const phase = phaseResult.value.doc;
  if (phase.type !== "phase") {
    const error: LoreError = {
      code: "VALIDATION_ERROR",
      field: "type",
      message: `Expected a phase document; got type '${phase.type}'`,
      value: phase.type,
    };
    process.stderr.write(formatError(error) + "\n");
    process.exitCode = exitCode(error);
    return;
  }

  const checkpoint = requireCheckpoint("phase-claim");
  const nowIso = new Date().toISOString();
  const ttlMinutes = requirePhaseWorkflowService(app).claimTtlMinutes;
  const anchorOverlapEnabled = resolveAnchorOverlapGateEnabled(config);
  // reason: anchor-overlap PARITY with the real phase claim (this function's own header
  // paragraph) — `PhaseWorkflowService.claim` captures the session instance from
  // `process.env` and feeds it to `noAnchorOverlap`
  // (task-phaseworkflowservice-claim-captures-no-session-id-so-every). Identical read,
  // identical surfacing of an unusable id, as `runTaskClaimGate` above.
  const sessionIdResult = resolveClaimSessionId(process.env);
  if (!sessionIdResult.ok) {
    process.stderr.write(formatError(sessionIdResult.error) + "\n");
    process.exitCode = exitCode(sessionIdResult.error);
    return;
  }
  const candidateSessionId = sessionIdResult.value;

  // reason: mirrors runTaskClaimGate's identical null-parent_id edge case (a phase's
  // parent_id is schema-required to be its plan — a null here can only happen on a
  // legacy/corrupted row); see that function's identical comment for the full
  // rationale of the synthetic "no spec parent, no siblings" context.
  let ctx: GateContext;
  if (phase.parent_id === null) {
    ctx = {
      ...buildUpstreamSpecContext(undefined),
      ...buildAnchorGateContext(by, phase, [], nowIso, ttlMinutes, candidateSessionId),
      targetIdOrSlug: phaseIdOrSlug,
      anchorOverlapEnabled,
    };
  } else {
    const bundleResult = await app.corpusService.getPlanBundle(phase.parent_id);
    if (!bundleResult.ok) {
      process.stderr.write(formatError(bundleResult.error) + "\n");
      process.exitCode = exitCode(bundleResult.error);
      return;
    }
    ctx = {
      ...buildUpstreamSpecContext(bundleResult.value.spec),
      ...buildAnchorGateContext(by, phase, bundleResult.value.tasks, nowIso, ttlMinutes, candidateSessionId),
      targetIdOrSlug: phaseIdOrSlug,
      anchorOverlapEnabled,
    };
  }

  const results = checkpoint.check(ctx);

  if (isCheckpointBlocked(results)) {
    const failures = selectFailures(results);
    console.log(checkpoint.feed(ctx, failures));
    emitGateReportIssueHint(config);
    recordHookGateDeny(app, "phase-claim", failures, phaseIdOrSlug, by);
    process.exitCode = 4;
    return;
  }

  console.log("gate: pass");
  process.exitCode = 0;
}

/**
 * Runs the `spec-promote` deterministic zone (a `spec_kind`-resolved AC-count floor —
 * SPEC-058 min_acs, default 1 — AND every declared criterion must pass `acQuantifiable`
 * AND, when a verification profile declares `required_oracles`, `oracleCoverage`, AND at least one
 * criterion must cite a live BR/AS rule — BR-1007, the same refusal `approve` gives)
 * against an already-created spec, then makes a best-effort, exit-code-inert judge
 * advisory attempt (module header, INV2). The deterministic outcome is settled and
 * printed BEFORE the advisory attempt runs, so a slow/unreachable AI provider can never
 * delay or flip the gate's verdict — it can only add a trailing stderr note.
 *
 * `criteria` (from `AcService.listCriteria`, the SAME SSOT `lore ac list` reads) is
 * already the exact `AcceptanceCriterion[]` shape `GateContext.acceptanceCriteria`
 * needs — no re-parse required here, unlike `runSpecCreateGate`'s untyped candidate
 * JSON.
 *
 * `specKind`/`verificationProfile` resolution (task-lore-gate-spec-promote-cli-pre-
 * flight-is-not-spec-kind, SPEC-058 CLI/service-layer parity fix) mirrors the SAME
 * pattern `CorpusService.set` (`effectiveSpecKind`) and `ReviewService.approve`
 * (`resolveSpecKindOrDefault`) already apply on their own spec-promote gate call
 * sites: a raw `extra.spec_kind` string outside {@link SPEC_KINDS} (or absent —
 * `AcService.listCriteria`'s success above already proved the doc resolves and is a
 * spec) falls back to `"feature"`, the SAME default `CorpusService._createImpl`
 * applies at spec-creation time. This is the ONE store read the CLI pays that the two
 * service call sites don't — they already have the target `DocRecord` in hand from
 * their own write path, the CLI doesn't. `verificationProfile` is resolved exactly
 * ONCE per invocation from that resolved `specKind` and threaded onto BOTH
 * `acCountMeetsFloor` and `oracleCoverage` (both read `ctx.verificationProfile` —
 * `checkSpecPromote`, checkpoint-registry.ts) — before this fix neither predicate here
 * ever saw a resolved profile, so `oracleCoverage` silently vacuous-passed regardless
 * of `workflow.verification_profiles.<kind>.required_oracles` config.
 *
 * @param app - Wired `App` (from `loadLoreApp()`).
 * @param specIdOrSlug - Spec document ULID or slug to gate.
 * @param config - `loadLoreApp()`'s resolved project config — forwarded to
 *   `resolveAcQuantifiableGateEnabled`/`resolveOracleCoverageGateEnabled`/
 *   `resolveVerificationProfile` so this pre-flight gate honors the SAME
 *   `workflow.gates."spec-promote".*` sub-keys and `workflow.verification_profiles.*`
 *   entries `GateEnforcer`'s service-layer path reads; no second, independently-
 *   drifting config read.
 */
async function runSpecPromoteGate(
  app: App,
  specIdOrSlug: string,
  config: LoreConfig | undefined,
): Promise<void> {
  const listResult = await requireAcService(app).listCriteria(specIdOrSlug);
  if (!listResult.ok) {
    process.stderr.write(formatError(listResult.error) + "\n");
    process.exitCode = exitCode(listResult.error);
    return;
  }

  // reason: task-lore-gate-spec-promote-cli-pre-flight-is-not-spec-kind — the
  // `listResult.ok` check above already proved `specIdOrSlug` resolves to an
  // existing `spec` doc (AcService.listCriteria rejects non-spec targets), so this
  // second lookup cannot newly fail on a target this call would otherwise reject.
  const specResult = await app.corpusService.get(specIdOrSlug);
  if (!specResult.ok) {
    process.stderr.write(formatError(specResult.error) + "\n");
    process.exitCode = exitCode(specResult.error);
    return;
  }
  const rawSpecKind = specResult.value.doc.extra["spec_kind"];
  const specKind: SpecKind =
    typeof rawSpecKind === "string" && (SPEC_KINDS as readonly string[]).includes(rawSpecKind)
      ? (rawSpecKind as SpecKind)
      : "feature";
  const verificationProfile = resolveVerificationProfile(config, specKind);

  // reason: BR-1007 / issue #137 — `approve` refuses a spec none of whose criteria cites a live BR/AS
  // rule; this pre-flight must say the same. Measured with the SAME function approve uses (through
  // CorpusService), so the gate and the approval cannot disagree; a read failure is surfaced, never
  // read as "cites".
  const citesResult = await app.corpusService.specCitesLiveRule(specResult.value.doc.extra["acceptance_criteria"]);
  if (!citesResult.ok) {
    process.stderr.write(formatError(citesResult.error) + "\n");
    process.exitCode = exitCode(citesResult.error);
    return;
  }

  const { criteria } = listResult.value;
  const checkpoint = requireCheckpoint("spec-promote");
  const ctx: GateContext = {
    specCitesLiveRule: citesResult.value,
    acceptanceCriteriaCount: criteria.length,
    specIdOrSlug,
    specKind,
    acceptanceCriteria: criteria,
    acQuantifiableEnabled: resolveAcQuantifiableGateEnabled(config, "spec-promote"),
    verificationProfile,
    oracleCoverageEnabled: resolveOracleCoverageGateEnabled(config),
  };
  const results = checkpoint.check(ctx);

  if (isCheckpointBlocked(results)) {
    const failures = selectFailures(results);
    process.stderr.write(checkpoint.feed(ctx, failures));
    emitGateReportIssueHint(config);
    recordHookGateDeny(app, "spec-promote", failures, specIdOrSlug);
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
