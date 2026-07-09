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
 * `LORE_GATE_BYPASS=1` short-circuits to exit 0 before ANY parsing or checking, for
 * BOTH subcommands — an escape hatch for callers that must not be blocked (documented,
 * not silent: every invocation under bypass still goes through the CLI, so it is
 * audit-log-visible at the shell/process level even though this command itself
 * performs no corpus writes).
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
 *
 * Source: IoC vertical-slice tech-spec §4.1/§5.1/§11 ("deterministic zone" +
 * "active feeding" + INV2 "probabilistic zone is advisory-only")
 */

import { defineCommand } from "citty";
import { z } from "zod";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { renderResolvedToMarkdown } from "../../../service/outline-service.js";
import {
  checkpointRegistry,
  isCheckpointBlocked,
  selectFailures,
  type CheckpointDef,
  type GateCheckpoint,
  type GateContext,
} from "../../../service/checkpoint-registry.js";
import { runDeterministicChecks } from "@lore/core";
import type { App } from "../../../app.js";
import type { AcService } from "../../../service/ac-service.js";
import type { DocRecord, NewReviewJudgment } from "@lore/core";

/**
 * `applies_to` scope this gate discovers its feeding skill by — matches the
 * `extra.skill.applies_to` value `scripts/seed-write-spec-rule.ts` seeds on the
 * "Write-spec rules (gate feeding source)" doc. `CorpusService.findFeedingSkill`
 * discovers ANY approved `knowledge/skill` doc declaring this scope, not just that
 * specific seeded title — discovery is by declared scope, not a hardcoded title
 * literal (IoC vertical-slice tech-spec §4.1/§11, P1 slice-2).
 */
const SPEC_CREATE_SKILL_APPLIES_TO = "spec";

/** Fallback rule slice used when no approved `knowledge/skill` doc declares `applies_to: "spec"` yet. */
const RULE_DOC_MISSING_PLACEHOLDER =
  `(No approved rule doc found — run \`bun scripts/seed-write-spec-rule.ts\` to seed it. ` +
  `Expected: type=knowledge, status=approved, extra.sub_type="skill", ` +
  `extra.skill.applies_to="${SPEC_CREATE_SKILL_APPLIES_TO}".)`;

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

        const { app } = loadLoreApp();
        try {
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

        const { app } = loadLoreApp();
        try {
          await runSpecPromoteGate(app, args.spec as string);
        } finally {
          app.close();
        }
      },
    }),
  },
});

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

  if (!isCheckpointBlocked(results)) {
    console.log("gate: pass");
    process.exitCode = 0;
    return;
  }

  const rule = await findFeedingSkill(app, SPEC_CREATE_SKILL_APPLIES_TO);
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

/**
 * Resolves `parentIdOrSlug` to a full `DocRecord` via `corpusService.get`.
 *
 * @returns `null` when `parentIdOrSlug` is absent/blank OR fails to resolve (unknown
 *   id/slug, store error) — the gate's `parentLegal` predicate treats "could not
 *   resolve a parent" the same as "no parent supplied" (both fail with
 *   `PARENT_REQUIRED`), matching the bundle contract: "缺失或解析失败 → parentDoc=null".
 */
async function resolveParentDoc(
  app: App,
  parentIdOrSlug: string | undefined,
): Promise<DocRecord | null> {
  if (parentIdOrSlug === undefined || parentIdOrSlug.trim() === "") {
    return null;
  }
  const result = await app.corpusService.get(parentIdOrSlug);
  if (!result.ok) {
    return null;
  }
  return result.value.doc;
}

/**
 * Renders `doc.content` with MDX placeholders spliced in, mirroring `get.ts`'s
 * `--raw`-off pattern (`outlineService.resolve` → `renderResolvedToMarkdown`). A
 * resolution failure degrades to the raw, unspliced body rather than aborting the
 * gate — the feeding pack is advisory context, not a hard dependency on placeholder
 * resolution succeeding.
 */
async function renderDocMarkdown(app: App, doc: DocRecord): Promise<string> {
  const resolveResult = await app.outlineService.resolve(doc);
  if (!resolveResult.ok) {
    return doc.content;
  }
  return renderResolvedToMarkdown(resolveResult.value);
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
 * @param appliesTo - Scope to discover by, e.g. `SPEC_CREATE_SKILL_APPLIES_TO`.
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
