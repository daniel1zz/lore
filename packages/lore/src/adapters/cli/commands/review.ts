/**
 * lore review <doc> [--ai|--no-ai] [--json]
 * lore review --pending [--ai|--no-ai] [--json]
 * lore review --staleness [--limit] [--min-age-days] [--fail-on-candidate] [--json]
 * lore review <doc> --staleness [--fail-on-candidate] [--json]
 * lore review --staleness --list [--json]
 * lore review backfill-ledger [--json]
 *
 * `backfill-ledger` (SPEC-103 §Mechanisms M2, §Design Decisions D3) is a reserved
 * positional verb, intercepted BEFORE any of the AI-judge/staleness logic below:
 * an idempotent one-shot sweep that fast-tracks every EXISTING draft ledger
 * knowledge doc (assessment/retro/handoff/uat) to `approved` — no AI call, no
 * flag-mutex interaction with `--pending`/`--staleness`/`--ai`.
 *
 * Structured AI review judgment (SPEC-034 §4) PLUS staleness probing (SPEC-044
 * §Design Decisions D6, D7, D9, D11). Orchestration pipe for the pre-existing REGULAR
 * review path:
 *   1. Load `lore.tree.yaml` if present (optional — absence degrades the
 *      tree_position check to "skipped", never fatal; a PRESENT-but-invalid
 *      blueprint IS fatal, same as `lore status --check-tree`).
 *   2. `corpusService.getReviewBundle(doc, blueprint?)` — assemble {doc, parent?,
 *      links, brokenLinkTargets?, blueprint?}.
 *   3. `runDeterministicChecks(bundle)` (pure fn, @lore/core) — five mechanical
 *      pre-checks, always run before any AI call.
 *   4. Any check outcome === "fail" → record a judgment WITHOUT invoking the AI
 *      provider: decision="reject", confidence=1.0, reasons derived from the
 *      failed checks, judge identity `{provider:"deterministic-checks", ...}`.
 *   5. Otherwise → `aiProviderService.judgeDoc(bundle, checks)` → one corrective
 *      retry (inside judgeDoc) → `judgmentService.record(...)`.
 *
 * `--pending` batches step 1-5 over every doc `reviewService.pending()` returns.
 * Per-doc failures are COLLECTED, not fatal — the batch only exits non-zero if EVERY
 * doc failed: with the failures' shared code (4 validation, 6 AI provider), or 1 when
 * the causes differ (`summarizeBatchFailures`); otherwise exit 0. Per-code counts go to stderr.
 *
 * `--staleness` is a SEPARATE pipeline (D9) — deterministic pre-checks (SPEC-034)
 * explicitly do NOT run for it. Batch mode (`lore review --staleness`) assembles
 * priority-sorted candidates via `StalenessProbeService.probeBatch`; single-doc mode
 * (`lore review <doc> --staleness`) via `probeOne` (bypasses selection filters, still
 * refuses an already-invalidated target); `--list` is a read-only fresh-escalate
 * listing with NO provider call at all (`flows/staleness-flow.ts::listFreshStalenessEscalates`,
 * the SAME derivation site `lore status`/`lore bootstrap` use, D14).
 *
 * AI-intent command semantics (mirrors `lore assess` EXACTLY, SPEC-026 §3 D5) apply to
 * BOTH the regular review path and staleness probing (D7) — the command name IS the AI
 * intent. `--no-ai` always exits 2 (no non-AI mode) EXCEPT when `--staleness --list` is
 * passed (`--list` is a pure read, no provider call — D7/D9). The built-in per-surface
 * AI-off default (agent/mcp/http_token) does NOT brake either path; only an EXPLICIT
 * `ai.default_per_surface.<surface> = false` config override does. This brake check runs
 * BEFORE the deterministic checks / candidate assembly for every mode except
 * `--staleness --list`.
 *
 * Flag mutexes are synchronous, before ANY IO (D9 review U11): `--ai`+`--no-ai` → exit 2;
 * `--pending`+`--staleness` → exit 2 (disjoint populations, review U1/U6); a doc-or-pending
 * requirement (extended to also accept `--staleness` batch mode with no doc positional).
 *
 * Exit codes: 0 on any recorded judgment/probe (approve/reject/escalate/holds/stale_candidate
 * all count as success — the command's job is "record a judgment", not "get an approval"),
 * EXCEPT `--fail-on-candidate` on a staleness path, which exits 3 when ≥1 FRESH
 * stale_candidate result exists (D9 review U7, a `status --check-tree`-style CI gate);
 * 6 on AI provider failure (no judgment row is written; a staleness BATCH only exits 6
 * when EVERY probe in the batch failed — D9 review U3 collect-and-continue idiom);
 * standard LoreError codes (1/3/4/5) otherwise (blueprint invalid, doc not found,
 * record() validation failure, an already-invalidated single-doc staleness target, etc).
 *
 * Source: SPEC-034 §1, §4, §6; SPEC-044 §Design Decisions D6, D7, D9, D11
 */

import { defineLoreCommand, exitCli } from "../cli-exit.js";
import { loadLoreApp } from "../loader.js";
import {
  exitCode,
  formatError, formatErrorFor,
  formatStalenessBadge,
  formatTable,
  parsePositiveIntArg,
  resolveActor,
} from "../utils.js";
import { isAssessAiBraked } from "../../../ai/resolve-ai.js";
import { REVIEW_PROMPT_VERSION } from "../../../ai/review-template.js";
import {
  formatJudgmentSummary,
  renderSupersededCandidateNudgeBlock,
  renderTruncationBlock,
  renderBatchFailureCounts,
  summarizeBatchFailures,
} from "../review-render.js";
import {
  buildStalenessBatchJsonPayload,
  buildStalenessFlowDeps,
  buildStalenessListJsonPayload,
  buildStalenessSingleJsonPayload,
  listFreshStalenessEscalates,
  renderStalenessRepairCommand,
  type StalenessFlowDeps,
} from "../../../flows/staleness-flow.js";
import { loadTreeBlueprint } from "../../../flows/blueprint-flow.js";
import { ok, resolveStalenessDefaults, runDeterministicChecks } from "@lore/core";
import { refuseDocWithPending, refuseFilterValue } from "../filter-values.js";
import type { Invocation } from "@lore/core";
import type {
  CheckResult,
  LoreError,
  NewReviewJudgment,
  Result,
  ReviewBundle,
  ReviewJudgment,
  TreeBlueprint,
} from "@lore/core";
import type { PendingDoc } from "../../../service/review-service.js";
import type { StalenessBatchResult, StalenessProbeOutcome } from "../../../service/staleness-probe-service.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/** Structural type of the wired App, without importing app.ts's bun:sqlite-reachable module. */
type App = ReturnType<typeof loadLoreApp>["app"];

/**
 * Load `lore.tree.yaml` from cwd if present. Returns `undefined` when absent
 * (the deterministic tree_position check degrades to "skipped", never a
 * silent pass — see review-checks.ts's own invariant). A PRESENT-but-invalid
 * blueprint is a config error worth surfacing loudly, so the caller treats a
 * parse failure as fatal (mirrors `lore status --check-tree`).
 */
function loadBlueprintOrExit(inv: Invocation): TreeBlueprint | undefined {
  const loaded = loadTreeBlueprint(inv.cwd);
  if (loaded.status === "missing") return undefined;
  if (loaded.status === "invalid") {
    inv.io.stderr.write(formatErrorFor(inv, loaded.error) + "\n");
    exitCli(4);
  }
  return loaded.blueprint;
}

/** Build the deterministic-only judgment for a doc that failed at least one mechanical check. */
function buildDeterministicRejectJudgment(bundle: ReviewBundle, checks: CheckResult[]): NewReviewJudgment {
  const failedChecks = checks.filter((c) => c.outcome === "fail");
  return {
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
}

/**
 * Review one document end-to-end: assemble bundle → deterministic checks →
 * (deterministic-reject short-circuit | AI judge) → record. Shared by both
 * the single-doc and `--pending` batch code paths so the orchestration logic
 * lives in exactly one place.
 *
 * @returns Result<{docSlug, judgment}, LoreError> — err() covers bundle-assembly
 *   failure, AI provider failure (AI_PROVIDER_ERROR, exit 6), and record()
 *   validation/store failure alike; the caller maps the error to an exit code.
 *   `docSlug` (SPEC-044 D11) is the reviewed doc's slug — needed by the caller to
 *   render the `renderSupersededCandidateNudgeBlock` byproduct.
 */
async function reviewOneDoc(
  app: App,
  idOrSlug: string,
  blueprint: TreeBlueprint | undefined,
): Promise<Result<{ docSlug: string; judgment: ReviewJudgment }, LoreError>> {
  const bundleResult = await app.corpusService.getReviewBundle(idOrSlug, blueprint);
  if (!bundleResult.ok) return bundleResult;
  const bundle = bundleResult.value;
  const docSlug = bundle.doc.slug;

  const checks = runDeterministicChecks(bundle);
  const anyFailed = checks.some((c) => c.outcome === "fail");

  if (anyFailed) {
    const newJudgment = buildDeterministicRejectJudgment(bundle, checks);
    const recordResult = await app.judgmentService.record(newJudgment);
    if (!recordResult.ok) return recordResult;
    return ok({ docSlug, judgment: recordResult.value });
  }

  const judgeResult = await app.aiProviderService.judgeDoc(bundle, checks, { source: app.callerSurface });
  if (!judgeResult.ok) return judgeResult;

  const recordResult = await app.judgmentService.record(judgeResult.value);
  if (!recordResult.ok) return recordResult;
  return ok({ docSlug, judgment: recordResult.value });
}

// ─── Staleness rendering (batch/single/list) ─────────────────────────────────
//
// `--json` payload construction (buildStalenessProbeJsonEntry/buildStalenessBatchJsonPayload)
// lives in flows/staleness-flow.ts — the SAME functions the MCP lore_staleness_probe tool
// calls, so AC-SP-7's "payload deep-equals CLI --json" holds by construction (D9/D10).

/** Human-readable rendering of one probe outcome. */
async function renderProbeText(inv: Invocation, flowDeps: StalenessFlowDeps, outcome: StalenessProbeOutcome): Promise<string> {
  const lines: string[] = [];
  const header = `${outcome.doc.slug} (priority=${outcome.candidate.priority}, in_degree=${outcome.candidate.in_degree}, age_days=${outcome.candidate.age_days})`;

  if (!outcome.result.ok) {
    lines.push(`${header}: ERROR — ${formatErrorFor(inv, outcome.result.error).split("\n")[0] ?? ""}`);
    return lines.join("\n");
  }

  const judgment = outcome.result.judgment;
  lines.push(`${header}: ${judgment.decision} (confidence: ${judgment.confidence.toFixed(2)})`);
  for (const reason of judgment.reasons) lines.push(`  - ${reason.finding}`);

  if (judgment.decision === "escalate") {
    for (const q of judgment.blocking_questions) lines.push(`  ? ${q}`);
    const repair = await renderStalenessRepairCommand(flowDeps, { slug: outcome.doc.slug }, judgment);
    lines.push(`  repair: ${repair.command}`);
    if (repair.unresolvedNote !== undefined) lines.push(`  note: ${repair.unresolvedNote}`);
  }

  return lines.join("\n");
}

/** Exit-code policy shared by single-doc and batch staleness probe results (D9). */
function computeStalenessExitCode(outcomes: StalenessProbeOutcome[], failOnCandidate: boolean): number {
  if (outcomes.length > 0 && outcomes.every((o) => !o.result.ok)) return 6;
  if (failOnCandidate) {
    const anyFreshEscalate = outcomes.some((o) => o.result.ok && o.result.judgment.decision === "escalate");
    if (anyFreshEscalate) return 3;
  }
  return 0;
}

export default defineLoreCommand({
  meta: {
    name: "review",
    description: "Structured AI review judgment — judge a document against deterministic checks + an LLM judge; --staleness probes high-value knowledge/adr docs for silent staleness",
  },
  args: {
    doc: {
      type: "positional",
      description: "Document ID or slug to review (omit when using --pending or batch --staleness)",
      required: false,
    },
    pending: {
      type: "boolean",
      description: "Batch-review every document in the pending (draft) queue",
    },
    staleness: {
      type: "boolean",
      description: "Probe knowledge/adr docs for silent staleness instead of a regular document review (SPEC-044)",
    },
    limit: {
      type: "string",
      description: "Max candidates to probe in batch staleness mode (default: workflow.staleness.default_limit, 5)",
    },
    "min-age-days": {
      type: "string",
      description: "Minimum age (days) since last confirmation for a candidate to qualify (default: workflow.staleness.min_age_days, 14)",
    },
    "fail-on-candidate": {
      type: "boolean",
      description: "Exit 3 when the staleness probe finds >=1 fresh stale_candidate result",
    },
    list: {
      type: "boolean",
      description: "Read-only: list docs whose latest staleness judgment is a fresh stale_candidate escalate (no AI call)",
    },
    ai: {
      type: "boolean",
      description:
        "Explicitly confirm AI use (rarely needed — review defaults to AI on every surface). Pass --no-ai to abort (always exit 2 — review has no non-AI mode, except --staleness --list which never calls AI).",
    },
    json: {
      type: "boolean",
      description: "Output the result as JSON",
    },
  },
  async run(context): Promise<number> {
    const { args } = context;
    const inv = invocationOf(context);
    // SPEC-103 §Mechanisms M2, §Design Decisions D3 — `lore review backfill-ledger`
    // reserved positional verb: idempotent one-shot ledger fast-track backfill,
    // entirely orthogonal to the AI-judge review/staleness-probe pipeline below (no
    // AI call, no flag mutex interaction) — intercepted FIRST, before Step 1's mutex
    // checks (which would otherwise misinterpret "backfill-ledger" as a doc
    // id/slug and fall through to a DOC_NOT_FOUND resolution attempt).
    if (args.doc === "backfill-ledger") {
      const { app } = loadLoreApp({ inv });
      try {
        const actor = resolveActor(inv);
        const result = await app.reviewService.backfillLedger({ actor });
        if (!result.ok) {
          inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
          return exitCode(result.error);
        }
        if (args.json) {
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: result.value }, null, 2));
        } else if (result.value.fast_tracked.length === 0) {
          printLine(inv.io.stdout, "No draft ledger docs to backfill — already up to date.");
        } else {
          printLine(inv.io.stdout, 
            `Fast-tracked ${result.value.fast_tracked.length} ledger doc(s): ` +
              result.value.fast_tracked.join(", "),
          );
        }
        for (const failure of result.value.failed) {
          inv.io.stderr.write(`Warning: failed to fast-track ${failure.slug}: ${failure.reason}\n`);
        }
        return 0;
      } finally {
        app.close();
      }
    }

    // ─── Step 1: argument mutex checks (synchronous, before any IO) ───────────
    const rawArgv = inv.argv;
    const hasExplicitAi = rawArgv.includes("--ai");
    const hasExplicitNoAi = rawArgv.includes("--no-ai");
    const isStaleness = args.staleness === true;
    const isList = args.list === true;
    // reason: D7/D9 — --list is a pure read, no provider call, so it is EXEMPT from the
    // "review/staleness has no non-AI mode" mutex/brake below.
    const isStalenessListMode = isStaleness && isList;

    // reason: AC-DCL-2 — `<doc> --pending` used to review the whole queue and ignore <doc>.
    const docWithPending = refuseDocWithPending(args.doc, args.pending === true);
    if (!docWithPending.ok) return refuseFilterValue(inv, docWithPending.error);
    if (hasExplicitAi && hasExplicitNoAi) {
      inv.io.stderr.write("Error: --ai and --no-ai are mutually exclusive. Pass only one.\n");
      exitCli(2);
    }
    // reason: D9 review U6 — --pending and --staleness address disjoint populations
    // (draft docs awaiting first review vs approved/active staleness candidates);
    // combining them is a usage error, checked before any IO (review U11).
    if (args.pending && isStaleness) {
      inv.io.stderr.write("Error: --pending and --staleness are mutually exclusive (disjoint populations).\n");
      exitCli(2);
    }
    if (hasExplicitNoAi && !isStalenessListMode) {
      // reason: review (and staleness probing) has no non-AI mode (mirrors SPEC-026 §3
      // D5 assess exactly) — the command name IS the AI intent, so --no-ai is always a
      // contradiction EXCEPT the --staleness --list read-only path (D7/D9).
      inv.io.stderr.write("Error: lore review requires AI; --no-ai is a contradiction. Omit the flag to proceed.\n");
      exitCli(2);
    }
    if (!args.pending && !isStaleness && (args.doc === undefined || args.doc === "")) {
      inv.io.stderr.write("Error: a document ID or slug is required unless --pending or batch --staleness is passed.\n");
      exitCli(2);
    }

    const { app, config } = loadLoreApp({ inv });
    try {
      // ─── Step 2: AI surface-brake check (SPEC-034 §4, mirrors assess §3 D5) ──
      // reason: like assess.ts, this braked check runs unconditionally BEFORE the
      // deterministic checks / candidate assembly — a braked surface cannot run `lore
      // review` at all, even for a doc whose deterministic checks would short-circuit
      // before any AI call. --staleness --list is exempt (no provider call, D7/D9).
      if (!isStalenessListMode && !hasExplicitAi) {
        const resolved = app.resolveAiDefault(undefined);
        if (isAssessAiBraked(resolved)) {
          inv.io.stderr.write(
            "Error: AI is required for `lore review` but is disabled for this surface by " +
              "config.ai.default_per_surface. Pass --ai to override.\n",
          );
          return 2;
        }
      }

      const actor = resolveActor(inv);

      // ─── SPEC-044: staleness probing branch ─────────────────────────────────
      if (isStaleness) {
        const flowDeps = buildStalenessFlowDeps(app);

        // ── --list: read-only, NO provider call ──────────────────────────────
        if (isList) {
          const listResult = await listFreshStalenessEscalates(flowDeps);
          if (!listResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, listResult.error) + "\n");
            return exitCode(listResult.error);
          }
          const entries = listResult.value;

          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: buildStalenessListJsonPayload(entries) }, null, 2));
            return 0;
          }

          if (entries.length === 0) {
            printLine(inv.io.stdout, "No open stale candidates.");
            return 0;
          }

          const rows = entries.map((e) => [
            e.doc.slug,
            e.doc.title.slice(0, 32),
            formatStalenessBadge(e.judgment),
          ]);
          printLine(inv.io.stdout, formatTable(["Slug", "Title", "Badge"], rows));
          printLine(inv.io.stdout, `\n${entries.length} open stale candidate${entries.length === 1 ? "" : "s"}`);
          return 0;
        }

        if (app.stalenessProbeService === undefined) {
          inv.io.stderr.write("Error: StalenessProbeService not wired on this App instance.\n");
          return 1;
        }

        const defaults = resolveStalenessDefaults(config);

        // BUG-012 audit: an unvalidated --limit (esp. a negative value, e.g. -1)
        // reaches `selectProbeCandidates`'s `.slice(0, limit)` and silently drops
        // candidates from the tail instead of erroring — validate before the call.
        let limit = defaults.default_limit;
        if (args.limit !== undefined) {
          const limitResult = parsePositiveIntArg(args.limit, "--limit", { min: 1 });
          if (!limitResult.ok) {
            inv.io.stderr.write(limitResult.message + "\n");
            return 2;
          }
          limit = limitResult.value;
        }

        let minAgeDays = defaults.min_age_days;
        if (args["min-age-days"] !== undefined) {
          const minAgeDaysResult = parsePositiveIntArg(args["min-age-days"], "--min-age-days", { min: 0 });
          if (!minAgeDaysResult.ok) {
            inv.io.stderr.write(minAgeDaysResult.message + "\n");
            return 2;
          }
          minAgeDays = minAgeDaysResult.value;
        }

        const failOnCandidate = args["fail-on-candidate"] === true;

        // ── single-doc mode: lore review <doc> --staleness ───────────────────
        if (args.doc !== undefined && args.doc !== "") {
          const outcomeResult = await app.stalenessProbeService.probeOne(args.doc, {
            by: actor,
            source: app.callerSurface,
          });
          if (!outcomeResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, outcomeResult.error) + "\n");
            return exitCode(outcomeResult.error);
          }
          const outcome = outcomeResult.value;

          if (args.json) {
            const payload = await buildStalenessSingleJsonPayload(flowDeps, outcome);
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: payload }, null, 2));
          } else {
            printLine(inv.io.stdout, await renderProbeText(inv, flowDeps, outcome));
          }

          return computeStalenessExitCode([outcome], failOnCandidate);
        }

        // ── batch mode: lore review --staleness [--limit] [--min-age-days] ──
        const batchResult = await app.stalenessProbeService.probeBatch({
          by: actor,
          limit,
          minAgeDays,
          source: app.callerSurface,
        });
        if (!batchResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, batchResult.error) + "\n");
          return exitCode(batchResult.error);
        }
        const batch: StalenessBatchResult = batchResult.value;

        if (args.json) {
          const payload = await buildStalenessBatchJsonPayload(flowDeps, batch);
          printLine(inv.io.stdout, JSON.stringify({ ok: true, data: payload }, null, 2));
        } else {
          if (batch.probes.length === 0) {
            printLine(inv.io.stdout, 
              `No staleness candidates found (total_candidates: ${batch.total_candidates}, ` +
                `skipped: ${batch.skipped.invalidated} invalidated / ${batch.skipped.too_young} too young).`,
            );
          } else {
            for (const outcome of batch.probes) {
              printLine(inv.io.stdout, await renderProbeText(inv, flowDeps, outcome));
              printLine(inv.io.stdout, "");
            }
            printLine(inv.io.stdout, 
              `${batch.probes.length} probed, ${batch.total_candidates} total candidates, ` +
                `${batch.excluded_by_limit} excluded by limit.`,
            );
          }
        }

        return computeStalenessExitCode(batch.probes, failOnCandidate);
      }

      // ─── Regular review path (SPEC-034, unchanged) ──────────────────────────
      const blueprint = loadBlueprintOrExit(inv);

      // ─── Batch mode: --pending ────────────────────────────────────────────────
      if (args.pending) {
        const pendingResult = await app.reviewService.pending();
        if (!pendingResult.ok) {
          inv.io.stderr.write(formatErrorFor(inv, pendingResult.error) + "\n");
          return exitCode(pendingResult.error);
        }
        const docs: PendingDoc[] = pendingResult.value;

        if (docs.length === 0) {
          printLine(inv.io.stdout, "No pending documents.");
          return 0;
        }

        const outcomes: Array<{ doc: PendingDoc; result: Result<{ docSlug: string; judgment: ReviewJudgment }, LoreError> }> = [];
        for (const doc of docs) {
          const result = await reviewOneDoc(app, doc.id, blueprint);
          outcomes.push({ doc, result });
        }

        const failures = outcomes.filter((o) => !o.result.ok);

        if (args.json) {
          printLine(inv.io.stdout, 
            JSON.stringify(
              {
                ok: true,
                data: {
                  requested_by: actor,
                  results: outcomes.map((o) => ({
                    doc_id: o.doc.id,
                    title: o.doc.title,
                    ...(o.result.ok ? { judgment: o.result.value.judgment } : { error: o.result.error }),
                  })),
                  total: outcomes.length,
                  failed: failures.length,
                },
              },
              null,
              2,
            ),
          );
        } else {
          const rows = outcomes.map((o) => [
            o.doc.id.slice(0, 10),
            o.doc.title.slice(0, 32),
            o.result.ok ? o.result.value.judgment.decision : "ERROR",
            o.result.ok ? o.result.value.judgment.confidence.toFixed(2) : (formatErrorFor(inv, o.result.error).split("\n")[0] ?? ""),
          ]);
          printLine(inv.io.stdout, formatTable(["ID", "Title", "Decision", "Confidence/Error"], rows));
          printLine(inv.io.stdout, `\n${outcomes.length} reviewed, ${failures.length} failed`);
        }

        if (failures.length > 0) {
          inv.io.stderr.write(`Warning: ${failures.length}/${outcomes.length} doc(s) failed review.\n`);
        }
        const failureErrors = failures.flatMap((o) => (o.result.ok ? [] : [o.result.error]));
        const summary = summarizeBatchFailures(failureErrors, outcomes.length);
        if (failureErrors.length > 0) {
          inv.io.stderr.write(`${renderBatchFailureCounts(summary.byCode)}\n`);
        }
        return summary.exitCode;
      }

      // ─── Single-doc mode ───────────────────────────────────────────────────────
      // reason: guarded above (`!args.pending && !isStaleness && args.doc === undefined`
      // → exit 2), so args.doc is guaranteed defined here.
      const docIdOrSlug = args.doc as string;
      const result = await reviewOneDoc(app, docIdOrSlug, blueprint);

      if (!result.ok) {
        inv.io.stderr.write(formatErrorFor(inv, result.error, { aiHasNoFallback: true }) + "\n");
        return exitCode(result.error);
      }
      const { docSlug, judgment } = result.value;

      if (args.json) {
        printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { requested_by: actor, judgment } }, null, 2));
        return 0;
      }

      const nudgeBlock = await renderSupersededCandidateNudgeBlock(buildStalenessFlowDeps(app), docSlug, judgment);
      printLine(inv.io.stdout, formatJudgmentSummary(judgment) + renderTruncationBlock(judgment) + nudgeBlock);
    } finally {
      app.close();
    }
    return 0;
  },
});
