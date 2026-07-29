/**
 * lore report-issue --title <t> --description <d> --expected <e> --actual <a>
 *   [--repro-command <cmd>] [--auto-config] [--json]
 * lore report-issue --list [--json]
 *
 * Files a structured lore-defect report directly into a configured upstream
 * corpus (SPEC-072), landing there as a draft ad-hoc task in the upstream
 * pending-review queue. `--list` shows this consumer corpus's filed history,
 * joined LIVE with the upstream DEFECT's computed resolution (D6,
 * spec-issue-closure-loop-computed-resolution-agent-reachable; including
 * rejection/wontfix reasons, `UpstreamPort.getResolution`) — a separate
 * read-only mode, mutually exclusive with the report-filing flags. The raw
 * upstream doc status is demoted to a secondary debugging column
 * (`doc_status`); it is NOT the primary signal a reporting agent should read
 * anymore (a `draft` issue task whose fix shipped as a separate archived doc
 * now correctly prints `fixed`, not `draft`).
 *
 * `--list` and any of `--title`/`--description`/`--expected`/`--actual`/
 * `--repro-command` together is a usage error (exit 2, checked BEFORE any
 * IO) — mirrors `assess.ts`'s `--diff`/`--diff-file` mutex-check convention.
 * Filing mode also requires `--title`/`--description`/`--expected`/`--actual`
 * (aggregated into ONE missing-flags message, exit 2) — `--repro-command` is
 * the only optional report field.
 *
 * Actor resolution mirrors `claim.ts`: `resolveActor()` (`$LORE_ACTOR` env var,
 * then session tier, then OS username — no `--by` flag on this command, since
 * SPEC-072's task packet declares only the flags in this header).
 *
 * ── Self-provisioning (spec-out-of-box-reporting-channel-report-issue-self-provisions T4) ──
 * When `feedback.upstream` is unconfigured, this is the ONE seam that decides
 * WHEN to call `report-issue-wiring.ts`'s `resolveUpstreamFromInstalledBinary`/
 * `provisionFeedbackUpstream` (that module intentionally never wires the CLI
 * flag itself — see its own header). `--auto-config` is the explicit,
 * non-interactive approval a non-TTY caller must pass before this command
 * self-provisions: absent it, `resolveEffectiveUpstreamCfg` below returns the
 * SAME actionable "run with --auto-config" error for BOTH the filing path and
 * `--list` (single wording SSOT, AC-OOB-1) — deliberately replacing
 * `IssueReportService`'s own `buildUnconfiguredUpstreamError()` hand-edit-YAML
 * template at this CLI layer only (that function's template guidance is
 * exactly what AC-OOB-1 requires ZERO occurrences of in stderr). An
 * ALREADY-configured `feedback.upstream` short-circuits straight through
 * without ever attempting resolution, `--auto-config` or not (AC-OOB-4a).
 *
 * Every failure from `IssueReportService` is a `LoreError`, mapped through the
 * normal `exitCode()`/`formatError()` pipeline — most report-filing failures
 * are `VALIDATION_ERROR` (exit 4): unconfigured `feedback.upstream` (now the
 * `--auto-config` provision hint above, not hand-edit-YAML prose), root-PRD
 * mismatch, version skew, upstream `sync.enabled`, and the per-reporter
 * open-report cap.
 *
 * Source: SPEC-072 §4 Public Interface, §5 check sequence, §11 Downstream
 * Handoff; task-skill-implement-t5-wiring-cli-report-issue-mcp-lore-report;
 * spec-out-of-box-reporting-channel-report-issue-self-provisions §Design,
 * §Acceptance Criteria AC-OOB-1..5.
 */

import { defineCommand } from "citty";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable, resolveActor } from "../utils.js";
import {
  buildIssueReportDeps,
  provisionFeedbackUpstream,
  resolveConsumerCorpusRoot,
  resolveFeedbackUpstreamCfg,
  resolveUpstreamFromInstalledBinary,
  type UpstreamCfg,
} from "../report-issue-wiring.js";
import { IssueReportService } from "../../../service/issue-report-service.js";

/** The report-filing flags — mutually exclusive with `--list` (checked as a group). */
const REPORT_FLAGS = ["title", "description", "expected", "actual", "repro-command"] as const;

/** The report-filing flags that are REQUIRED when NOT using `--list`. */
const REQUIRED_REPORT_FLAGS = ["title", "description", "expected", "actual"] as const;

/**
 * The single-wording-SSOT actionable error for an unconfigured
 * `feedback.upstream` reached WITHOUT `--auto-config` — the ONE call site is
 * inside {@link resolveEffectiveUpstreamCfg} below, reached identically from
 * both the filing path and `--list` (AC-OOB-1's "single wording SSOT"
 * requirement). Deliberately contains ZERO hand-edit-YAML TEMPLATE guidance
 * (no `corpus_path: /path/to`/`root_prd: prd-lore` VALUE lines, AC-OOB-1) —
 * that template is exactly what `IssueReportService.buildUnconfiguredUpstreamError()`
 * renders, which this CLI seam supersedes for THIS command's own
 * invocation-time failure (see module header "Self-provisioning"). Still
 * names both required config KEYS in dotted-path prose form
 * (`feedback.upstream.corpus_path`/`feedback.upstream.root_prd`, no trailing
 * colon) — the pre-existing SPEC-072 regression test AC-072-2
 * (`tests/unit/service/issue-report-cross-corpus.bun.test.ts`) pins those two
 * substrings and must keep passing; "which two keys" and "how to set them"
 * are separable, and only the latter is what AC-OOB-1 requires dropped.
 */
function buildAutoConfigRequiredError(): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "feedback.upstream",
    message:
      "`feedback.upstream` is not configured — this needs both " +
      "feedback.upstream.corpus_path and feedback.upstream.root_prd. Run " +
      "`lore report-issue --auto-config` to self-provision them from this " +
      "install's own upstream lore corpus — no manual YAML editing required.",
  };
}

/**
 * Resolves the `UpstreamCfg` THIS invocation should act against, deciding
 * WHEN to self-provision — the orchestration `report-issue-wiring.ts`
 * deliberately leaves to its caller (see that module's header).
 *
 * - Already configured (`cfg !== undefined`) → returned UNCHANGED, and
 *   resolution/provisioning is NEVER attempted, `--auto-config` or not
 *   (AC-OOB-4a's byte-identical, resolution-free short-circuit).
 * - Unconfigured + `--auto-config` NOT passed → `err({@link
 *   buildAutoConfigRequiredError})` (AC-OOB-1).
 * - Unconfigured + `--auto-config` passed → resolves via
 *   `resolveUpstreamFromInstalledBinary` (pure reads + identity pin,
 *   AC-OOB-5) then, only on success, writes via `provisionFeedbackUpstream`
 *   (AC-OOB-2/3/4b) — either failure is returned VERBATIM, zero config bytes
 *   written on a resolution failure (AC-OOB-3).
 *
 * @param cfg - this consumer's current `feedback.upstream` config, or
 *   `undefined` when unconfigured (`resolveFeedbackUpstreamCfg`'s result)
 * @param autoConfig - whether `--auto-config` was passed on this invocation
 * @param consumerCorpusRoot - this consumer corpus's own root (see
 *   `resolveConsumerCorpusRoot`) — where a provisioning write, if any, lands
 */
async function resolveEffectiveUpstreamCfg(
  cfg: UpstreamCfg | undefined,
  autoConfig: boolean,
  consumerCorpusRoot: string,
): Promise<Result<UpstreamCfg, LoreError>> {
  if (cfg !== undefined) return ok(cfg);
  if (!autoConfig) return err(buildAutoConfigRequiredError());

  const resolveResult = await resolveUpstreamFromInstalledBinary();
  if (!resolveResult.ok) return resolveResult;

  const provisionResult = provisionFeedbackUpstream(consumerCorpusRoot, resolveResult.value);
  if (!provisionResult.ok) return provisionResult;

  return ok(resolveResult.value);
}

export default defineCommand({
  meta: {
    name: "report-issue",
    description:
      "File a structured lore-defect report into a configured upstream corpus, or list previously filed reports (--list)",
  },
  args: {
    title: {
      type: "string",
      description: "Short report title (required unless --list)",
    },
    description: {
      type: "string",
      description: "Full report description (required unless --list)",
    },
    expected: {
      type: "string",
      description: "Expected behavior (required unless --list)",
    },
    actual: {
      type: "string",
      description: "Actual (observed) behavior (required unless --list)",
    },
    "repro-command": {
      type: "string",
      description: "A command that reproduces the issue (optional)",
    },
    "auto-config": {
      type: "boolean",
      description:
        "Non-interactive approval to self-provision an unconfigured feedback.upstream from " +
        "this install's own upstream corpus (required on a non-TTY; a TTY may still confirm " +
        "interactively). Never attempted when feedback.upstream is already configured.",
    },
    list: {
      type: "boolean",
      description: "List previously filed reports with live upstream status, instead of filing a new one",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run({ args }) {
    // ─── Step 1: argument mutex + required-flag checks (synchronous, before any IO) ───
    const isList = args.list === true;
    const reportFlagsPresent = REPORT_FLAGS.filter((flag) => typeof args[flag] === "string");

    if (isList && reportFlagsPresent.length > 0) {
      process.stderr.write(
        `Usage error: --list cannot be combined with ${reportFlagsPresent.map((f) => `--${f}`).join(", ")}.\n`,
      );
      process.exit(2);
    }

    if (!isList) {
      const missing = REQUIRED_REPORT_FLAGS.filter(
        (flag) => typeof args[flag] !== "string" || args[flag].length === 0,
      );
      if (missing.length > 0) {
        process.stderr.write(
          `Usage error: missing required flag(s): ${missing.map((f) => `--${f}`).join(", ")}.\n`,
        );
        process.exit(2);
      }
    }

    const { app, config } = loadLoreApp();
    try {
      const corpusRoot = resolveConsumerCorpusRoot();
      const deps = buildIssueReportDeps(corpusRoot);
      const service = new IssueReportService(deps);
      const cfg = resolveFeedbackUpstreamCfg(config);
      const autoConfig = args["auto-config"] === true;

      const effectiveCfgResult = await resolveEffectiveUpstreamCfg(cfg, autoConfig, corpusRoot);
      if (!effectiveCfgResult.ok) {
        process.stderr.write(formatError(effectiveCfgResult.error) + "\n");
        process.exitCode = exitCode(effectiveCfgResult.error);
        return;
      }
      const effectiveCfg = effectiveCfgResult.value;

      if (isList) {
        const result = await service.list(effectiveCfg);
        if (!result.ok) {
          process.stderr.write(formatError(result.error) + "\n");
          process.exitCode = exitCode(result.error);
          return;
        }

        if (args.json) {
          console.log(JSON.stringify({ ok: true, data: { rows: result.value } }, null, 2));
          return;
        }

        if (result.value.length === 0) {
          console.log("No reports filed yet from this corpus.");
          return;
        }

        // reason: "Resolution" (D6's computed resolution) is now the PRIMARY
        // signal; "Doc Status" (the upstream doc's raw lifecycle status) is
        // demoted to a debugging detail, per this file's own header.
        const headers = ["Doc ID", "Title", "Filed At", "Resolution", "Doc Status", "Reason"];
        const rows = result.value.map((row) => [
          row.upstream_doc_id,
          row.title,
          row.at,
          row.status,
          row.doc_status ?? "",
          row.rejection_reason ?? "",
        ]);
        console.log(formatTable(headers, rows));

        const allWarnings = result.value.flatMap((row) => row.warnings ?? []);
        if (allWarnings.length > 0) {
          console.log("\nWarnings:");
          for (const warning of new Set(allWarnings)) {
            console.log(`  - ${warning}`);
          }
        }
        return;
      }

      const by = resolveActor();
      const reproCommand = args["repro-command"];
      const result = await service.report(
        {
          title: args.title as string,
          description: args.description as string,
          expected: args.expected as string,
          actual: args.actual as string,
          by,
          ...(typeof reproCommand === "string" ? { repro_command: reproCommand } : {}),
        },
        effectiveCfg,
      );

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
        return;
      }

      console.log(`Filed upstream as ${result.value.upstream_doc_id}`);
      if (result.value.dedup_degraded) {
        console.log("Warning: duplicate-report check degraded (advisory search failed) — filed anyway.");
      }
      if (result.value.possible_duplicates.length > 0) {
        console.log(`Possible duplicates: ${result.value.possible_duplicates.join(", ")}`);
      }
    } finally {
      app.close();
    }
  },
});
