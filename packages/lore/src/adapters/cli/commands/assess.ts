/**
 * lore assess <plan> [--diff <git-range> | --diff-file <path>] [--json] [--ai|--no-ai]
 *
 * AI plan-outcome assessment (LLM-as-judge). Sends the plan, its spec's ACs (when the
 * plan is parented under a spec), every child task's evidence trail, and an optional
 * code diff to the configured AI provider; persists the structured judgment as a
 * `knowledge` doc (sub_type="assessment") linked to the plan via an `informs` link.
 *
 * Flow (SPEC-026 §8.3, SPEC-028 AC-AE-1, SPEC-106): resolve → corpusService.getPlanBundle →
 * (zero tasks → exit 4, before any AI call) → staleness advisory (corpusService
 * .getAssessmentFreshness + gate-predicates.assessmentFreshness, stderr-only, NEVER
 * blocking — SPEC-106 D3) → diff acquisition (--diff shells `git diff <range>`;
 * --diff-file reads a file; both → exit 2) → pre-flight diff-budget warning
 * (stderr-only, fires when diffText exceeds ai.assess.max_diff_chars, BEFORE the provider
 * call) → AI surface-brake check → aiProviderService.assessPlan → corpusService.create
 * (knowledge, sub_type=assessment) → corpusService.link (informs) → human render
 * (verdict + score table) or --json envelope.
 *
 * AI default (SPEC-026 §3 D5): unlike `set --regenerate`/`--refine`, assess has no
 * non-AI mode — the command name IS the AI intent. It runs with AI on every surface by
 * default; only an EXPLICIT `ai.default_per_surface.<surface> = false` config override
 * requires `--ai` to proceed. `--no-ai` is always a contradiction → exit 2.
 *
 * Diff-range scope-mismatch warning (hotfix task-assess-diff-range-scope-mismatch-warning):
 * `result.scope_warning` (computed by `aiProviderService.assessPlan`, never this adapter)
 * is a non-blocking advisory printed after the summary in text mode, and surfaced under a
 * stable `data.scope_warning` key in `--json` output — never affects verdict/exit code.
 *
 * Staleness advisory (SPEC-106 §Design Decisions D2/D3/D5, AC-FRESH-4): this run's OWN
 * write always proceeds regardless of what the advisory found — `lore assess` is the
 * remedy for a stale assessment (an assessment whose own follow-up hardening merged
 * after it ran), so gating it on that condition would be a deadlock. The SAME
 * freshness facts feed `plan-close`'s (checkpoint-registry.ts) BLOCKING
 * `assessmentFreshness` predicate — one shared computation (`CorpusService
 * .getAssessmentFreshness`), never two.
 *
 * Commit-set auto-derivation (task-lore-assess-asks-the-caller-for-a-git-range-that-
 * cannot-be): when NEITHER `--diff` NOR `--diff-file` is passed, this command no longer
 * defaults to "no diff" — it derives the plan's own commit set from git history itself
 * (`../assess-commit-derivation.js::deriveCommitSetForPlan`), immune to the interleaving
 * that makes a caller-supplied contiguous range wrong under concurrency. `--diff`/
 * `--diff-file` remain explicit overrides, unchanged. Every run — explicit override,
 * auto-derived, or "no commits found" — records its `diff_source` on the persisted
 * `extra` (additive `knowledgeExtraSchema.passthrough()` key, no core schema change) and
 * in the `--json` envelope, so `diff_available` alone is never the only signal an
 * auditor has for telling a complete diff from a partial one.
 *
 * `--diff`'s git-diff maxBuffer (task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-
 * over-1): the `spawnSync("git", ["diff", ...])` call sizes its `maxBuffer` against the
 * EFFECTIVE `ai.assess.max_diff_chars` (`../assess-render.js::computeGitDiffMaxBuffer`,
 * 4 bytes/char worst-case UTF-8) instead of Node's arbitrary 1 MiB default — an ordinary
 * multi-task-plan diff can exceed 1 MiB. A confirmed `error.code === "ENOBUFS"` renders a
 * dedicated message naming the buffer size and the `ai.assess.max_diff_chars` knob
 * (`../assess-render.js::formatGitDiffEnobufsMessage`) instead of the generic "git diff
 * ... failed: spawnSync ENOBUFS", which sent an operator to look at git for a failure
 * that was entirely this call site's own buffer ceiling. Every OTHER spawn failure
 * (non-zero exit, ENOENT, ...) still renders the pre-existing generic message, unchanged.
 *
 * Convention-mismatch vs genuine absence (task-lore-assess-derives-a-plan-s-commits-by-
 * grepping-task): auto-derivation now tells apart TWO zero-commit causes instead of
 * folding them into one. This command computes `allTasksArchived` (every task's
 * `status === "archived"`) from the ALREADY-LOADED bundle and passes it to
 * `deriveCommitSetForPlan` — a zero-match result on an all-archived plan is a
 * CONTRADICTION (archived tasks have merged work by definition) and comes back as the
 * distinct `"unverifiable_convention_mismatch"` status, never silently folded into
 * `"no_commits_found"` (which stays reserved for a plan that plausibly has no merged work
 * yet). The distinct status is threaded to `aiProviderService.assessPlan` as
 * `commitDerivationUnverifiable`, which forbids the judge's `scope_fidelity` dimension
 * score from ever publishing in that state (SPEC-lore's own three-question ADR review;
 * enforced at the SERVICE layer, `ai-provider-service.ts::forceScopeFidelityUnverifiable`
 * — never by editing the prompt template).
 *
 * Source: SPEC-026 §3 D1-D5; §4 AC-ASSESS-1, AC-ASSESS-6, AC-ASSESS-8, AC-ASSESS-9;
 * SPEC-028 AC-AE-1; task-assess-diff-range-scope-mismatch-warning; SPEC-106 AC-FRESH-4;
 * task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be;
 * task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1;
 * task-lore-assess-derives-a-plan-s-commits-by-grepping-task
 */

import { spawnSync } from "node:child_process";
import { exitCli, setExitCode } from "../run-scope.js";
import { readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor } from "../utils.js";
import { ASSESS_NEWER_TASK_ACTIVITY, ASSESS_NO_COMMITS_DERIVED } from "../cli-refusal-messages.js";
import { isAssessAiBraked } from "../../../ai/resolve-ai.js";
import { renderAssessmentContent } from "@lore/core";
import {
  formatAssessmentSummary,
  computeGitDiffMaxBuffer,
  formatGitDiffEnobufsMessage,
  computeCaptureSourceDistribution,
  formatCaptureSourceLine,
  formatStampVerdictLine,
} from "../assess-render.js";
import { assessmentFreshness } from "../../../service/gate-predicates.js";
import { deriveCommitSetForPlan, type DiffSourceRecord } from "../assess-commit-derivation.js";
import { collectRecordedRanges } from "../../../service/task-commit-range.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";

/** One-line stderr/text summary of how this run's diff (if any) was obtained. */
function formatDiffSourceLine(source: DiffSourceRecord): string {
  switch (source.mode) {
    case "explicit_diff":
      return `Diff source: --diff ${source.range} (explicit override)`;
    case "explicit_diff_file":
      return `Diff source: --diff-file ${source.path} (explicit override)`;
    case "explicit_diff_text":
      // reason: unreachable from the CLI (only MCP's diff_text override produces this
      // variant) — kept so the switch stays exhaustively typed against the shared union.
      return "Diff source: diff_text (explicit override)";
    case "auto_derived":
      if (source.status === "derived") {
        const measuredZero = source.tasks_without_commits.length - source.tasks_not_measured.length;
        const gapNote =
          (source.tasks_not_measured.length > 0
            ? ` (${String(source.tasks_not_measured.length)} task(s) NOT MEASURED: no recorded commit range and no slug match)`
            : "") + (measuredZero > 0 ? ` (${String(measuredZero)} task(s) recorded an empty commit range)` : "");
        return `Diff source: derived from ${String(source.commits.length)} commit(s) across this plan's tasks${gapNote}`;
      }
      if (source.status === "unverifiable_convention_mismatch") {
        return (
          "Diff source: unverifiable — every task in this plan is archived (merged work by " +
          "definition) but no commit mentions any task slug; a commit-message CONVENTION " +
          "MISMATCH, not evidence of missing work"
        );
      }
      return `Diff source: none — ${ASSESS_NO_COMMITS_DERIVED} for this plan's tasks`;
  }
}

export default defineCommand({
  meta: {
    name: "assess",
    description: "AI plan-outcome assessment (LLM-as-judge) — judge a plan against its spec's ACs and its tasks' evidence",
  },
  args: {
    plan: {
      type: "positional",
      description: "Plan document ID or slug to assess",
      required: true,
    },
    diff: {
      type: "string",
      description: "Git diff range (e.g. HEAD~3..HEAD) — shells `git diff <range>`. Mutually exclusive with --diff-file.",
    },
    "diff-file": {
      type: "string",
      description: "Path to a file containing pre-generated diff text. Mutually exclusive with --diff.",
    },
    json: {
      type: "boolean",
      description: "Output the full assessment result envelope as JSON",
    },
    ai: {
      type: "boolean",
      // reason: SPEC-024/026 tri-state AI flag — same argv-scan pattern as create.ts/set.ts
      // (mri collapses --ai/no-flag; the real detection happens via process.argv below).
      description: "Explicitly confirm AI use (rarely needed — assess defaults to AI on every surface). Pass --no-ai to abort (always exit 2 — assess has no non-AI mode).",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    // ─── Step 1: argument mutex checks (synchronous, before any IO) ────────────
    const rawArgv = inv.argv;
    const hasExplicitAi = rawArgv.includes("--ai");
    const hasExplicitNoAi = rawArgv.includes("--no-ai");

    if (hasExplicitAi && hasExplicitNoAi) {
      inv.io.stderr.write("Error: --ai and --no-ai are mutually exclusive. Pass only one.\n");
      exitCli(2);
    }
    if (hasExplicitNoAi) {
      // reason: assess has no non-AI mode (SPEC-026 §3 D5) — the command name IS the AI
      // intent, so --no-ai is always a contradiction, unlike `set --regenerate`'s optional
      // AI path.
      inv.io.stderr.write("Error: lore assess requires AI; --no-ai is a contradiction. Omit the flag to proceed.\n");
      exitCli(2);
    }
    if (args.diff !== undefined && args["diff-file"] !== undefined) {
      inv.io.stderr.write("Error: --diff and --diff-file are mutually exclusive.\n");
      exitCli(2);
    }

    const { app } = loadLoreApp({ inv });
    try {
      // ─── Step 2: resolve plan + assemble bundle ───────────────────────────────
      const bundleResult = await app.corpusService.getPlanBundle(args.plan);
      if (!bundleResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, bundleResult.error) + "\n");
        setExitCode(exitCode(bundleResult.error));
        return;
      }
      const bundle = bundleResult.value;

      // AC-ASSESS-8: zero child tasks → VALIDATION_ERROR before any AI call.
      if (bundle.tasks.length === 0) {
        const noTasksError = {
          code: "VALIDATION_ERROR" as const,
          field: "tasks",
          message: `Plan '${bundle.plan.slug}' has zero child tasks — nothing to assess.`,
        };
        inv.io.stderr.write(formatErrorFor(inv, noTasksError) + "\n");
        setExitCode(exitCode(noTasksError));
        return;
      }

      // ─── Step 2.5: staleness advisory (SPEC-106 §Design Decisions D3) ─────────
      // reason: `lore assess` is the REMEDY for a stale assessment (D2's motivating
      // incident: an assessment whose own follow-up hardening merged after it ran) —
      // gating this command on the condition it cures would be a deadlock, so this is
      // a loud, non-blocking stderr advisory only. Runs BEFORE the (possibly slow/
      // costly) AI call so the operator sees it as early as possible; a genuine
      // resolve/store failure here still propagates as a real error (this is IO
      // failure handling, not a staleness gate) — it never silently swallows.
      const freshnessResult = await app.corpusService.getAssessmentFreshness(bundle.plan.id);
      if (!freshnessResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, freshnessResult.error) + "\n");
        setExitCode(exitCode(freshnessResult.error));
        return;
      }
      const freshness = freshnessResult.value;
      const freshnessCheck = assessmentFreshness(freshness.newestAssessmentAt, freshness.newestTaskActivityAt);
      if (!freshnessCheck.ok) {
        inv.io.stderr.write(
          `Warning: the stored assessment for '${bundle.plan.slug}' (recorded ${freshness.newestAssessmentAt}) ` +
            `is already stale — ${ASSESS_NEWER_TASK_ACTIVITY} ${freshness.newestTaskActivityAt}. This run ` +
            `will still produce and save a fresh assessment (\`lore assess\` never refuses; it is the remedy).\n`,
        );
      }

      // ─── Step 3: diff acquisition (CLI layer only — SPEC-026 §3 D3) ───────────
      // reason: read ONCE, before diff acquisition, so the maxBuffer sizing below (AC-1,
      // task-lore-assess-diff-spawnsync-sets-no-maxbuffer-a-diff-over-1) and the
      // pre-flight budget warning in Step 3.5 share the SAME effective value — never two
      // reads that could observe a config edit landing between them.
      const maxDiffChars = app.aiProviderService.assessMaxDiffChars;
      let diffText: string | undefined;
      let diffSource: DiffSourceRecord;
      // reason: task-lore-assess-derives-a-plan-s-commits-by-grepping-task AC #3 — set ONLY
      // by the auto-derived branch below when the derivation reports
      // "unverifiable_convention_mismatch"; forwarded to assessPlan so the SERVICE layer
      // (never this adapter, never the prompt template) forbids scope_fidelity from
      // publishing an absence-based score in that state.
      let commitDerivationUnverifiable = false;
      if (args.diff !== undefined) {
        // reason: Node's default maxBuffer (1 MiB) is an arbitrary constant unrelated to
        // this command's own diff-size budget — an ordinary multi-task-plan diff can
        // exceed it. computeGitDiffMaxBuffer sizes the buffer against the EFFECTIVE
        // ai.assess.max_diff_chars instead (task-lore-assess-diff-spawnsync-sets-no-
        // maxbuffer-a-diff-over-1, AC-1).
        const maxBuffer = computeGitDiffMaxBuffer(maxDiffChars);
        const gitResult = spawnSync("git", ["diff", args.diff], { encoding: "utf8", maxBuffer });
        if (gitResult.error || gitResult.status !== 0) {
          // reason: ENOBUFS is THIS call site's own buffer ceiling, not a git failure —
          // name the buffer + the ai.assess.max_diff_chars knob instead of rendering the
          // generic "git diff ... failed: spawnSync ENOBUFS" message, which sends an
          // operator to look at git (AC-2, same task).
          if (gitResult.error && (gitResult.error as NodeJS.ErrnoException).code === "ENOBUFS") {
            inv.io.stderr.write(formatGitDiffEnobufsMessage(args.diff, maxBuffer, maxDiffChars) + "\n");
            setExitCode(2);
            return;
          }
          const reason = gitResult.error?.message ?? gitResult.stderr?.trim() ?? `git exited ${gitResult.status}`;
          inv.io.stderr.write(`Error: git diff ${args.diff} failed: ${reason}\n`);
          setExitCode(2);
          return;
        }
        diffText = gitResult.stdout;
        diffSource = { mode: "explicit_diff", range: args.diff };
      } else if (args["diff-file"] !== undefined) {
        try {
          diffText = readFileSync(args["diff-file"], "utf8");
        } catch (e) {
          const message = e instanceof Error ? e.message : "unknown error";
          inv.io.stderr.write(`Error: could not read --diff-file: ${message}\n`);
          setExitCode(2);
          return;
        }
        diffSource = { mode: "explicit_diff_file", path: args["diff-file"] };
      } else {
        // reason: task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be —
        // replaces "no diff by default" with "derive it from the plan's own tasks by
        // default". A plan's commits are not contiguous in main under concurrency, so
        // there is no correct contiguous range to ask the caller for; this finds the
        // plan's own commits by CONTENT (exact task-slug match) instead of position.
        //
        // reason: task-lore-assess-derives-a-plan-s-commits-by-grepping-task — every task
        // already `archived` means merged work exists BY DEFINITION (VALID_TRANSITIONS,
        // @lore/core); a zero-match derivation in that state is a commit-message CONVENTION
        // MISMATCH, not genuine absence, so it must be told apart from a plan that plausibly
        // has no merged work yet.
        const allTasksArchived = bundle.tasks.every((t) => t.status === "archived");
        const derivation = deriveCommitSetForPlan(
          inv.cwd,
          bundle.tasks.map((t) => t.slug),
          allTasksArchived,
          collectRecordedRanges(bundle.tasks),
        );
        diffSource = { mode: "auto_derived", ...derivation };
        if (derivation.status === "derived") {
          diffText = derivation.diff_text;
          const gapNote =
            (derivation.tasks_not_measured.length > 0
              ? ` (${String(derivation.tasks_not_measured.length)} task(s) NOT MEASURED — no recorded commit range and ` +
                `no slug match, which is not the same as zero commits: ${derivation.tasks_not_measured.join(", ")})`
              : "") +
            (derivation.tasks_without_commits.length > derivation.tasks_not_measured.length
              ? ` (${String(derivation.tasks_without_commits.length - derivation.tasks_not_measured.length)} task(s) recorded an empty commit range)`
              : "");
          inv.io.stderr.write(
            `Derived diff from ${String(derivation.commits.length)} commit(s) across this plan's tasks${gapNote}.\n`,
          );
        } else if (derivation.status === "unverifiable_convention_mismatch") {
          commitDerivationUnverifiable = true;
          inv.io.stderr.write(
            `Warning: every one of this plan's ${String(bundle.tasks.length)} task(s) is already archived ` +
              "(merged work exists by definition) but no commit mentions any of their slugs — this is a " +
              "commit-message CONVENTION MISMATCH, not evidence of missing work. The scope_fidelity dimension " +
              "will be reported unverifiable, never absence-scored, for this run. Pass --diff/--diff-file to " +
              "supply a diff explicitly.\n",
          );
        } else {
          inv.io.stderr.write(
            `Warning: ${ASSESS_NO_COMMITS_DERIVED} for this plan's ${String(bundle.tasks.length)} task(s) — ` +
              "proceeding without a diff. This can mean the plan has no merged code changes yet, or its commit " +
              "history was squashed/rewritten and no longer references the task slugs. Pass --diff/--diff-file " +
              "to supply one explicitly.\n",
          );
        }
      }

      // ─── Step 3.5: pre-flight diff-budget warning (SPEC-028 AC-AE-1) ──────────
      // reason: printed BEFORE the provider call, stderr-only so --json stdout stays a
      // clean envelope. Actual truncation (file-boundary, not blind tail cut) happens
      // later inside buildAssessPrompt via truncateDiffByFile — this is advance notice.
      if (diffText !== undefined) {
        if (diffText.length > maxDiffChars) {
          inv.io.stderr.write(
            `Warning: diff is ${diffText.length} chars, exceeding the configured ai.assess.max_diff_chars ` +
              `budget of ${maxDiffChars}. It will be truncated by file (production source kept first, then ` +
              `tests, then everything else — no file is cut in half). To include the full diff, curate a ` +
              `smaller diff with --diff-file, or raise ai.assess.max_diff_chars in .lore/config.yaml.\n`,
          );
        }
      }

      // ─── Step 4: AI surface-brake check (SPEC-026 §3 D5) ──────────────────────
      // reason: unlike set.ts, assess has no non-AI mode, so the built-in per-surface
      // false default (agent/mcp/http_token) does NOT block it — only an explicit config
      // override does (isAssessAiBraked checks resolveAiDefault's "config" source tier).
      if (!hasExplicitAi) {
        const resolved = app.resolveAiDefault(undefined);
        if (isAssessAiBraked(resolved)) {
          inv.io.stderr.write(
            "Error: AI is required for `lore assess` but is disabled for this surface by " +
              "config.ai.default_per_surface. Pass --ai to override.\n",
          );
          setExitCode(2);
          return;
        }
      }

      const showSpinner = process.stderr.isTTY && !args.json;
      if (showSpinner) {
        inv.io.stderr.write(`⏳ Assessing via ${app.aiProviderService.activeProviderName}...\n`);
      }

      // ─── Step 5: invoke the judge ──────────────────────────────────────────────
      // reason: task-lore-assess-derives-a-plan-s-commits-by-grepping-task AC #3 —
      // `commitDerivationUnverifiable` is forwarded so the SERVICE layer forbids
      // scope_fidelity from publishing an absence-based score in that state; `false`
      // (the initialized default) on every OTHER path (explicit --diff/--diff-file, or a
      // genuinely commit-less plan) is a true, deliberate value, not an omission.
      //
      // reason: D6 (spec-judgment-surfaces-must-verify-before-they-certify-machine,
      // task-thread-diff-source-through-the-cli-and-mcp-assess-adapters) — `diffSource`
      // (this command's own already-computed `DiffSourceRecord` local, assigned on every
      // branch of Step 3 above) is now threaded into `opts.diffSource` so
      // `resolveAssessedCommit`/`verifyFindingPaths` (AC-JV-1, D2, D3) have a referent to
      // check finding paths against. Every field name/shape on `DiffSourceRecord` matches
      // `AssessDiffSource` exactly (see that type's own JSDoc), so this needs zero cast —
      // before this line, `opts.diffSource` was never supplied at all, and every live run
      // resolved to `paths_verified.unchecked` regardless of how much diff provenance this
      // command had already gathered (measured 2026-08-11, immediately after AC-JV-1
      // earned an attested pass at the service layer — see AC-JV-5).
      const assessResult = await app.aiProviderService.assessPlan(bundle, {
        ...(diffText !== undefined ? { diffText } : {}),
        source: app.callerSurface,
        commitDerivationUnverifiable,
        diffSource,
        repoRoot: inv.cwd,
      });
      if (!assessResult.ok) {
        // reason: assess has no non-AI mode (SPEC-026 §3 D5) — the shared AI_PROVIDER_ERROR
        // hint's default "Retry with --no-ai" is actively misleading here (SPEC-029 AC-AR-5,
        // AC-AR-4 preserves the underlying error shape/exit code unchanged).
        inv.io.stderr.write(formatErrorFor(inv, assessResult.error, { aiHasNoFallback: true }) + "\n");
        setExitCode(exitCode(assessResult.error));
        return;
      }
      const result = assessResult.value;

      if (showSpinner) {
        // SPEC-067 D4: overall_score is omitted at 100% task-truncation coverage.
        const scoreLabel = result.overall_score !== undefined ? `${result.overall_score}/100` : "N/A (fully truncated)";
        inv.io.stderr.write(`✓ Assessment complete: ${result.verdict} (${scoreLabel})\n`);
      }

      // ─── Step 5.5: capture_source distribution (AC-FR-5, G4) ──────────────────
      // reason: computed BEFORE persistence — deterministic, from the
      // already-loaded bundle, never touching the AI judge's own `result`.
      const captureSourceDistribution = computeCaptureSourceDistribution(bundle);
      // reason: SPEC-143 AC-CT-9(d) — the SECOND axis over the same rows (stamp verdict), through the ONE
      // exported predicate `lore status` also renders; reported alongside, never merged into capture_source.
      const stampVerdictResult = await app.corpusService.stampVerdictDistribution(bundle.tasks);
      if (!stampVerdictResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, stampVerdictResult.error) + "\n");
        setExitCode(exitCode(stampVerdictResult.error));
        return;
      }
      const stampVerdictDistribution = stampVerdictResult.value;

      // ─── Step 6: persist as a knowledge doc, linked to the plan ────────────────
      const dateStr = new Date().toISOString().slice(0, 10);
      const createResult = await app.corpusService.create({
        type: "knowledge",
        title: `Assessment: ${bundle.plan.title} (${dateStr})`,
        parent_id: bundle.plan.id,
        // reason: `diff_source` is additive on the passthrough `extra` object (never a
        // core `assessmentResultSchema` change) — records HOW this run's diff (if any)
        // was obtained, so `diff_available` alone is never the only auditable signal
        // (task-lore-assess-asks-the-caller-for-a-git-range-that-cannot-be, AC #3).
        extra: { sub_type: "assessment", assessment: result, diff_source: diffSource },
        content: renderAssessmentContent(result),
      });
      if (!createResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, createResult.error) + "\n");
        setExitCode(exitCode(createResult.error));
        return;
      }
      const assessmentDoc = createResult.value;

      const linkResult = await app.corpusService.link(assessmentDoc.id, bundle.plan.id, "informs");
      if (!linkResult.ok) {
        inv.io.stderr.write(formatErrorFor(inv, linkResult.error) + "\n");
        setExitCode(exitCode(linkResult.error));
        return;
      }

      // ─── Step 7: render ─────────────────────────────────────────────────────────
      // reason: hotfix (task-assess-diff-range-scope-mismatch-warning) — a non-blocking
      // advisory, computed by assessPlan and persisted on `result.scope_warning`. Surfaced
      // under the stable top-level `data.scope_warning` key (in addition to its copy
      // inside `data.result`) so a caller doesn't need to know it lives nested — `undefined`
      // is dropped by JSON.stringify, so the key is simply absent when no warning fired.
      if (args.json) {
        printLine(inv.io.stdout, 
          JSON.stringify(
            {
              ok: true,
              data: {
                assessment: assessmentDoc,
                result,
                scope_warning: result.scope_warning,
                diff_source: diffSource,
                // reason: AC-FR-5/G4 — printed ALONGSIDE result.facts.regression
                // .attested_evidence_ratio (the pre-existing attested ratio this
                // envelope already carries), a top-level sibling key so a
                // consumer never needs to know the attested one lives nested.
                capture_source: {
                  runner_count: captureSourceDistribution.runnerCount,
                  self_report_count: captureSourceDistribution.selfReportCount,
                  runner_unattested_count: captureSourceDistribution.runnerUnattestedCount,
                  ratio: captureSourceDistribution.ratio,
                },
                stamp_verdicts: stampVerdictDistribution,
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      printLine(inv.io.stdout, formatAssessmentSummary(result));
      if (result.scope_warning) {
        printLine(inv.io.stdout, "");
        printLine(inv.io.stdout, result.scope_warning.message);
      }
      printLine(inv.io.stdout, "");
      // reason: AC-FR-5/G4 — printed alongside result.facts.regression
      // .attested_evidence_ratio, when present (a legacy pre-SPEC-040 result
      // would carry no `facts` at all — additive, never a thrown error).
      const attestedRatio = result.facts?.regression.attested_evidence_ratio;
      printLine(inv.io.stdout, formatCaptureSourceLine(captureSourceDistribution, attestedRatio));
      printLine(inv.io.stdout, formatStampVerdictLine(stampVerdictDistribution));
      printLine(inv.io.stdout, formatDiffSourceLine(diffSource));
      printLine(inv.io.stdout, `Saved as ${assessmentDoc.slug} (linked to ${bundle.plan.slug} via informs)`);
    } finally {
      app.close();
    }
  },
});
