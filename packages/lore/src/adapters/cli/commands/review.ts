/**
 * lore review <doc> [--by] [--ai|--no-ai] [--json]
 * lore review --pending [--by] [--ai|--no-ai] [--json]
 *
 * Structured AI review judgment (SPEC-034 §4). Orchestration pipe:
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
 * Per-doc failures are COLLECTED, not fatal — the batch only exits 6 if EVERY
 * doc failed; otherwise exit 0 with a failure count on stderr.
 *
 * AI-intent command semantics (mirrors `lore assess` EXACTLY, SPEC-026 §3 D5):
 * the command name IS the AI intent. `--no-ai` always exits 2 (review has no
 * non-AI mode). The built-in per-surface AI-off default (agent/mcp/http_token)
 * does NOT brake review; only an EXPLICIT `ai.default_per_surface.<surface> =
 * false` config override does. This brake check runs BEFORE the deterministic
 * checks for BOTH modes — a braked surface cannot run `lore review` at all,
 * even for a doc whose checks would fail without ever touching the provider
 * (SPEC-034 task-C dispatch decision: simplicity over the theoretically finer
 * "only brake the AI path" cut).
 *
 * Exit codes: 0 on any recorded judgment (approve/reject/escalate all count as
 * success — the command's job is "record a judgment", not "get an approval");
 * 6 on AI provider failure (no judgment row is written); standard LoreError
 * codes (1/3/4/5) otherwise (blueprint invalid, doc not found, record()
 * validation failure, etc).
 *
 * Source: SPEC-034 §1, §4, §6
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable, resolveActor } from "../utils.js";
import { isAssessAiBraked } from "../../../ai/resolve-ai.js";
import { REVIEW_PROMPT_VERSION } from "../../../ai/review-template.js";
import { parseTreeBlueprint, runDeterministicChecks } from "@lore/core";
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

/** Structural type of the wired App, without importing app.ts's bun:sqlite-reachable module. */
type App = ReturnType<typeof loadLoreApp>["app"];

/**
 * Load `lore.tree.yaml` from cwd if present. Returns `undefined` when absent
 * (the deterministic tree_position check degrades to "skipped", never a
 * silent pass — see review-checks.ts's own invariant). A PRESENT-but-invalid
 * blueprint is a config error worth surfacing loudly, so the caller treats a
 * parse failure as fatal (mirrors `lore status --check-tree`).
 */
function loadBlueprintOrExit(): TreeBlueprint | undefined {
  const blueprintPath = join(process.cwd(), "lore.tree.yaml");
  if (!existsSync(blueprintPath)) return undefined;

  const raw = readFileSync(blueprintPath, "utf8");
  const parsed = parseTreeBlueprint(raw);
  if (!parsed.ok) {
    process.stderr.write(formatError(parsed.error) + "\n");
    process.exit(4);
  }
  return parsed.value;
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
 * @returns Result<ReviewJudgment, LoreError> — err() covers bundle-assembly
 *   failure, AI provider failure (AI_PROVIDER_ERROR, exit 6), and record()
 *   validation/store failure alike; the caller maps the error to an exit code.
 */
async function reviewOneDoc(
  app: App,
  idOrSlug: string,
  blueprint: TreeBlueprint | undefined,
): Promise<Result<ReviewJudgment, LoreError>> {
  const bundleResult = await app.corpusService.getReviewBundle(idOrSlug, blueprint);
  if (!bundleResult.ok) return bundleResult;
  const bundle = bundleResult.value;

  const checks = runDeterministicChecks(bundle);
  const anyFailed = checks.some((c) => c.outcome === "fail");

  if (anyFailed) {
    const newJudgment = buildDeterministicRejectJudgment(bundle, checks);
    return app.judgmentService.record(newJudgment);
  }

  const judgeResult = await app.aiProviderService.judgeDoc(bundle, checks, { source: app.callerSurface });
  if (!judgeResult.ok) return judgeResult;

  return app.judgmentService.record(judgeResult.value);
}

/** Human-readable rendering of one recorded judgment. */
function formatJudgmentSummary(judgment: ReviewJudgment): string {
  const lines: string[] = [];
  lines.push(`Decision: ${judgment.decision} (confidence: ${judgment.confidence.toFixed(2)})`);
  lines.push("");

  if (judgment.reasons.length > 0) {
    lines.push(
      formatTable(
        ["Dimension", "Finding", "Evidence"],
        judgment.reasons.map((r) => [r.dimension, r.finding, r.evidence_ref ?? ""]),
      ),
    );
    lines.push("");
  }

  if (judgment.checks.length > 0) {
    lines.push(
      formatTable(
        ["Check", "Outcome", "Detail"],
        judgment.checks.map((c) => [c.check, c.outcome, c.detail ?? ""]),
      ),
    );
    lines.push("");
  }

  if (judgment.decision === "escalate" && judgment.blocking_questions.length > 0) {
    lines.push("Blocking questions:");
    for (const q of judgment.blocking_questions) lines.push(`  - ${q}`);
    lines.push("");
  }

  lines.push(`Judge: ${judgment.judge.provider} (model: ${judgment.judge.model}, prompt v${judgment.judge.prompt_version})`);
  return lines.join("\n");
}

export default defineCommand({
  meta: {
    name: "review",
    description: "Structured AI review judgment — judge a document against deterministic checks + an LLM judge",
  },
  args: {
    doc: {
      type: "positional",
      description: "Document ID or slug to review (omit when using --pending)",
      required: false,
    },
    pending: {
      type: "boolean",
      description: "Batch-review every document in the pending (draft) queue",
    },
    by: {
      type: "string",
      description: "Actor requesting the review (defaults to $LORE_ACTOR / OS username)",
    },
    ai: {
      type: "boolean",
      description:
        "Explicitly confirm AI use (rarely needed — review defaults to AI on every surface). Pass --no-ai to abort (always exit 2 — review has no non-AI mode).",
    },
    json: {
      type: "boolean",
      description: "Output the result as JSON",
    },
  },
  async run({ args }) {
    // ─── Step 1: argument mutex checks (synchronous, before any IO) ───────────
    const rawArgv = process.argv;
    const hasExplicitAi = rawArgv.includes("--ai");
    const hasExplicitNoAi = rawArgv.includes("--no-ai");

    if (hasExplicitAi && hasExplicitNoAi) {
      process.stderr.write("Error: --ai and --no-ai are mutually exclusive. Pass only one.\n");
      process.exit(2);
    }
    if (hasExplicitNoAi) {
      // reason: review has no non-AI mode (mirrors SPEC-026 §3 D5 assess exactly) — the
      // command name IS the AI intent, so --no-ai is always a contradiction.
      process.stderr.write("Error: lore review requires AI; --no-ai is a contradiction. Omit the flag to proceed.\n");
      process.exit(2);
    }
    if (!args.pending && (args.doc === undefined || args.doc === "")) {
      process.stderr.write("Error: a document ID or slug is required unless --pending is passed.\n");
      process.exit(2);
    }

    const { app } = loadLoreApp();
    try {
      // ─── Step 2: AI surface-brake check (SPEC-034 §4, mirrors assess §3 D5) ──
      // reason: like assess.ts, this braked check runs unconditionally BEFORE the
      // deterministic checks — a braked surface cannot run `lore review` at all, even
      // for a doc whose deterministic checks would short-circuit before any AI call.
      if (!hasExplicitAi) {
        const resolved = app.resolveAiDefault(undefined);
        if (isAssessAiBraked(resolved)) {
          process.stderr.write(
            "Error: AI is required for `lore review` but is disabled for this surface by " +
              "config.ai.default_per_surface. Pass --ai to override.\n",
          );
          process.exitCode = 2;
          return;
        }
      }

      const actor = resolveActor(args.by);
      const blueprint = loadBlueprintOrExit();

      // ─── Batch mode: --pending ────────────────────────────────────────────────
      if (args.pending) {
        const pendingResult = await app.reviewService.pending();
        if (!pendingResult.ok) {
          process.stderr.write(formatError(pendingResult.error) + "\n");
          process.exitCode = exitCode(pendingResult.error);
          return;
        }
        const docs: PendingDoc[] = pendingResult.value;

        if (docs.length === 0) {
          console.log("No pending documents.");
          return;
        }

        const outcomes: Array<{ doc: PendingDoc; result: Result<ReviewJudgment, LoreError> }> = [];
        for (const doc of docs) {
          const result = await reviewOneDoc(app, doc.id, blueprint);
          outcomes.push({ doc, result });
        }

        const failures = outcomes.filter((o) => !o.result.ok);

        if (args.json) {
          console.log(
            JSON.stringify(
              {
                ok: true,
                data: {
                  requested_by: actor,
                  results: outcomes.map((o) => ({
                    doc_id: o.doc.id,
                    title: o.doc.title,
                    ...(o.result.ok ? { judgment: o.result.value } : { error: o.result.error }),
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
            o.result.ok ? o.result.value.decision : "ERROR",
            o.result.ok ? o.result.value.confidence.toFixed(2) : (formatError(o.result.error).split("\n")[0] ?? ""),
          ]);
          console.log(formatTable(["ID", "Title", "Decision", "Confidence/Error"], rows));
          console.log(`\n${outcomes.length} reviewed, ${failures.length} failed`);
        }

        if (failures.length > 0) {
          process.stderr.write(`Warning: ${failures.length}/${outcomes.length} doc(s) failed review.\n`);
        }
        if (failures.length === outcomes.length) {
          process.exitCode = 6;
        }
        return;
      }

      // ─── Single-doc mode ───────────────────────────────────────────────────────
      // reason: guarded above (`!args.pending && args.doc === undefined` → exit 2), so
      // args.doc is guaranteed defined here.
      const docIdOrSlug = args.doc as string;
      const result = await reviewOneDoc(app, docIdOrSlug, blueprint);

      if (!result.ok) {
        process.stderr.write(formatError(result.error, { aiHasNoFallback: true }) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }
      const judgment = result.value;

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: { requested_by: actor, judgment } }, null, 2));
        return;
      }

      console.log(formatJudgmentSummary(judgment));
    } finally {
      app.close();
    }
  },
});
