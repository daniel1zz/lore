/**
 * lore assess <plan> [--diff <git-range> | --diff-file <path>] [--json] [--ai|--no-ai]
 *
 * AI plan-outcome assessment (LLM-as-judge). Sends the plan, its spec's ACs (when the
 * plan is parented under a spec), every child task's evidence trail, and an optional
 * code diff to the configured AI provider; persists the structured judgment as a
 * `knowledge` doc (sub_type="assessment") linked to the plan via an `informs` link.
 *
 * Flow (SPEC-026 §8.3): resolve → corpusService.getPlanBundle → (zero tasks → exit 4,
 * before any AI call) → diff acquisition (--diff shells `git diff <range>`; --diff-file
 * reads a file; both → exit 2) → AI surface-brake check → aiProviderService.assessPlan →
 * corpusService.create (knowledge, sub_type=assessment) → corpusService.link (informs) →
 * human render (verdict + score table) or --json envelope.
 *
 * AI default (SPEC-026 §3 D5): unlike `set --regenerate`/`--refine`, assess has no
 * non-AI mode — the command name IS the AI intent. It runs with AI on every surface by
 * default; only an EXPLICIT `ai.default_per_surface.<surface> = false` config override
 * requires `--ai` to proceed. `--no-ai` is always a contradiction → exit 2.
 *
 * Source: SPEC-026 §3 D1-D5; §4 AC-ASSESS-1, AC-ASSESS-6, AC-ASSESS-8, AC-ASSESS-9
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable } from "../utils.js";
import { isAssessAiBraked } from "../../../ai/resolve-ai.js";
import { renderAssessmentContent, type AssessmentResult } from "@lore/core";

/** Human-readable verdict + AC score table rendering for terminal output. */
function formatAssessmentSummary(result: AssessmentResult): string {
  const lines: string[] = [];
  lines.push(`Verdict: ${result.verdict} (score: ${result.overall_score}/100)`);
  lines.push("");

  if (result.ac_scores.length > 0) {
    lines.push(
      formatTable(
        ["AC", "Score", "Reasoning"],
        result.ac_scores.map((ac) => [ac.ac_id, String(ac.score), ac.reasoning]),
      ),
    );
    lines.push("");
  }

  if (result.gaps.length > 0) {
    lines.push("Gaps:");
    for (const g of result.gaps) lines.push(`  - ${g}`);
    lines.push("");
  }

  if (result.recommendations.length > 0) {
    lines.push("Recommendations:");
    for (const r of result.recommendations) lines.push(`  - ${r}`);
    lines.push("");
  }

  lines.push(
    `Judge: ${result.judgment.provider} (prompt v${result.judgment.prompt_version}, ` +
      `${result.judgment.duration_ms}ms, retried: ${result.judgment.retried}` +
      (result.judgment.truncated.length > 0 ? `, truncated: ${result.judgment.truncated.join(", ")}` : "") +
      `)`,
  );

  return lines.join("\n");
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
  async run({ args }) {
    // ─── Step 1: argument mutex checks (synchronous, before any IO) ────────────
    const rawArgv = process.argv;
    const hasExplicitAi = rawArgv.includes("--ai");
    const hasExplicitNoAi = rawArgv.includes("--no-ai");

    if (hasExplicitAi && hasExplicitNoAi) {
      process.stderr.write("Error: --ai and --no-ai are mutually exclusive. Pass only one.\n");
      process.exit(2);
    }
    if (hasExplicitNoAi) {
      // reason: assess has no non-AI mode (SPEC-026 §3 D5) — the command name IS the AI
      // intent, so --no-ai is always a contradiction, unlike `set --regenerate`'s optional
      // AI path.
      process.stderr.write("Error: lore assess requires AI; --no-ai is a contradiction. Omit the flag to proceed.\n");
      process.exit(2);
    }
    if (args.diff !== undefined && args["diff-file"] !== undefined) {
      process.stderr.write("Error: --diff and --diff-file are mutually exclusive.\n");
      process.exit(2);
    }

    const { app } = loadLoreApp();
    try {
      // ─── Step 2: resolve plan + assemble bundle ───────────────────────────────
      const bundleResult = await app.corpusService.getPlanBundle(args.plan);
      if (!bundleResult.ok) {
        process.stderr.write(formatError(bundleResult.error) + "\n");
        process.exitCode = exitCode(bundleResult.error);
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
        process.stderr.write(formatError(noTasksError) + "\n");
        process.exitCode = exitCode(noTasksError);
        return;
      }

      // ─── Step 3: diff acquisition (CLI layer only — SPEC-026 §3 D3) ───────────
      let diffText: string | undefined;
      if (args.diff !== undefined) {
        const gitResult = spawnSync("git", ["diff", args.diff], { encoding: "utf8" });
        if (gitResult.error || gitResult.status !== 0) {
          const reason = gitResult.error?.message ?? gitResult.stderr?.trim() ?? `git exited ${gitResult.status}`;
          process.stderr.write(`Error: git diff ${args.diff} failed: ${reason}\n`);
          process.exitCode = 2;
          return;
        }
        diffText = gitResult.stdout;
      } else if (args["diff-file"] !== undefined) {
        try {
          diffText = readFileSync(args["diff-file"], "utf8");
        } catch (e) {
          const message = e instanceof Error ? e.message : "unknown error";
          process.stderr.write(`Error: could not read --diff-file: ${message}\n`);
          process.exitCode = 2;
          return;
        }
      }

      // ─── Step 4: AI surface-brake check (SPEC-026 §3 D5) ──────────────────────
      // reason: unlike set.ts, assess has no non-AI mode, so the built-in per-surface
      // false default (agent/mcp/http_token) does NOT block it — only an explicit config
      // override does (isAssessAiBraked checks resolveAiDefault's "config" source tier).
      if (!hasExplicitAi) {
        const resolved = app.resolveAiDefault(undefined);
        if (isAssessAiBraked(resolved)) {
          process.stderr.write(
            "Error: AI is required for `lore assess` but is disabled for this surface by " +
              "config.ai.default_per_surface. Pass --ai to override.\n",
          );
          process.exitCode = 2;
          return;
        }
      }

      const showSpinner = process.stderr.isTTY && !args.json;
      if (showSpinner) {
        process.stderr.write(`⏳ Assessing via ${app.aiProviderService.activeProviderName}...\n`);
      }

      // ─── Step 5: invoke the judge ──────────────────────────────────────────────
      const assessResult = await app.aiProviderService.assessPlan(bundle, {
        ...(diffText !== undefined ? { diffText } : {}),
        source: app.callerSurface,
      });
      if (!assessResult.ok) {
        process.stderr.write(formatError(assessResult.error) + "\n");
        process.exitCode = exitCode(assessResult.error);
        return;
      }
      const result = assessResult.value;

      if (showSpinner) {
        process.stderr.write(`✓ Assessment complete: ${result.verdict} (${result.overall_score}/100)\n`);
      }

      // ─── Step 6: persist as a knowledge doc, linked to the plan ────────────────
      const dateStr = new Date().toISOString().slice(0, 10);
      const createResult = await app.corpusService.create({
        type: "knowledge",
        title: `Assessment: ${bundle.plan.title} (${dateStr})`,
        parent_id: bundle.plan.id,
        extra: { sub_type: "assessment", assessment: result },
        content: renderAssessmentContent(result),
      });
      if (!createResult.ok) {
        process.stderr.write(formatError(createResult.error) + "\n");
        process.exitCode = exitCode(createResult.error);
        return;
      }
      const assessmentDoc = createResult.value;

      const linkResult = await app.corpusService.link(assessmentDoc.id, bundle.plan.id, "informs");
      if (!linkResult.ok) {
        process.stderr.write(formatError(linkResult.error) + "\n");
        process.exitCode = exitCode(linkResult.error);
        return;
      }

      // ─── Step 7: render ─────────────────────────────────────────────────────────
      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { assessment: assessmentDoc, result } }, null, 2));
        return;
      }

      console.log(formatAssessmentSummary(result));
      console.log("");
      console.log(`Saved as ${assessmentDoc.slug} (linked to ${bundle.plan.slug} via informs)`);
    } finally {
      app.close();
    }
  },
});
