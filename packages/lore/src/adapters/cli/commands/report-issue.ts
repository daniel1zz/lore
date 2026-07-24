/**
 * lore report-issue --title <t> --description <d> --expected <e> --actual <a>
 *   [--repro-command <cmd>] [--json]
 * lore report-issue --list [--json]
 *
 * Files a structured lore-defect report directly into a configured upstream
 * corpus (SPEC-072), landing there as a draft ad-hoc task in the upstream
 * pending-review queue. `--list` shows this consumer corpus's filed history,
 * joined LIVE with upstream status (including rejection reasons, T5
 * `UpstreamPort.getDocStatus`) — a separate read-only mode, mutually
 * exclusive with the report-filing flags.
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
 * Every failure from `IssueReportService` is a `LoreError`, mapped through the
 * normal `exitCode()`/`formatError()` pipeline — most report-filing failures
 * are `VALIDATION_ERROR` (exit 4): unconfigured `feedback.upstream` (naming
 * both required config keys with a literal YAML example), root-PRD mismatch,
 * version skew, upstream `sync.enabled`, and the per-reporter open-report cap.
 *
 * Source: SPEC-072 §4 Public Interface, §5 check sequence, §11 Downstream
 * Handoff; task-skill-implement-t5-wiring-cli-report-issue-mcp-lore-report.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatTable, resolveActor } from "../utils.js";
import {
  buildIssueReportDeps,
  resolveConsumerCorpusRoot,
  resolveFeedbackUpstreamCfg,
} from "../report-issue-wiring.js";
import { IssueReportService, buildUnconfiguredUpstreamError } from "../../../service/issue-report-service.js";

/** The report-filing flags — mutually exclusive with `--list` (checked as a group). */
const REPORT_FLAGS = ["title", "description", "expected", "actual", "repro-command"] as const;

/** The report-filing flags that are REQUIRED when NOT using `--list`. */
const REQUIRED_REPORT_FLAGS = ["title", "description", "expected", "actual"] as const;

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

      if (isList) {
        if (cfg === undefined) {
          const error = buildUnconfiguredUpstreamError();
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        const result = await service.list(cfg);
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

        const headers = ["Doc ID", "Title", "Filed At", "Status", "Rejection Reason"];
        const rows = result.value.map((row) => [
          row.upstream_doc_id,
          row.title,
          row.at,
          row.status,
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
        cfg,
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
