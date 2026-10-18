/**
 * lore report-issue --title <t> --description <d> --expected <e> --actual <a>
 *   [--repro-command <cmd>] [--severity <s>] [--category <c>] [--tags <t1,t2>] [--json]
 * lore report-issue --list [--json]
 *
 * ── GitHub intake path (spec-the-defect-channel-reaches-no-machine-but-its-own-github P2, AC-GI-1) ──
 * Filing goes through `report-issue-wiring.ts::fileGithubIssue`, itself
 * calling `GitHubIntakePort`, whenever `feedback.upstream` resolves to the
 * GITHUB shape (`{repo: "owner/name"}`). `--severity`/`--category` are
 * REQUIRED (not optional) on this path: `frontMatterCodec`'s closed
 * six-field set has no undeclared-label representation. `--tags`
 * (comma-separated) is likewise GitHub-path-only. `--list` against this
 * shape DELEGATES (spec-a-github-filed-defect-must-be-claimable-one-ingest-
 * seam, AC-GR-1/2/10/12) to `commands/issues.ts::runGithubIssuesListing` —
 * reached via a lazy `await import("./issues.js")` (mirrors `adapters/mcp/
 * tools.ts`'s own lazy import of this file) so `lore report-issue`'s cold
 * start does not also pull in `lore issues`'s module. `lore issues` is the
 * canonical read verb this command's `--list` flag now points to (both its
 * own help text and `meta.description` below name it); this command holds
 * NO second listing implementation of its own.
 *
 * ── The legacy SQLite shape is RETIRED (P4, spec-the-defect-channel-reaches-
 * no-machine-but-its-own-github) ──
 * A `feedback.upstream` configured with the legacy `{root_prd, ...}` shape
 * (no `repo`) is refused loudly on EVERY invocation of this command —
 * `IssueReportService` and the SQLite `UpstreamPort` it drove are deleted
 * outright, so there is no transport left to file or list through for that
 * shape. `corpus_path`/`transport` still PARSE (warned-on-by-name at config
 * load, see `@lore/core`'s `FeedbackConfigSchema`) but nothing here acts on
 * them — the refusal names `feedback.upstream.repo` as the way forward.
 * ⛔ `--auto-config` and its self-provisioning machinery
 * (`resolveUpstreamFromInstalledBinary`/`provisionFeedbackUpstream`,
 * spec-out-of-box-reporting-channel-report-issue-self-provisions T3/T4) are
 * deleted WITH it: self-provisioning only ever produced the now-unusable
 * legacy shape, so keeping the flag would let a caller "successfully"
 * configure something that does nothing.
 *
 * ── §M4/§M6 (spec-the-defect-channel-cannot-be-honestly-maintained-an) ──
 * `--list` NAMES the corpus its rows describe: its first human output line is
 * `formatIssueCorpusLine(...)`'s fixed `Corpus: ` prefix plus the CONFIGURED
 * UPSTREAM's absolute path, and `--json` carries the same value as
 * `data.corpus_path`. The sibling `lore issues` emits the identical header for
 * the corpus IT read, which is how the measured 0-vs-12 divergence (see that
 * file's header) becomes visible from either surface instead of requiring a
 * reader to know which side each command talks to.
 *
 * `--severity`/`--category` are ORDERING-ONLY triage labels the FILER declares
 * (§M6). They are written into the issue's front matter, read back off the
 * UPSTREAM issue, and rendered as columns on read surfaces. ⛔ They change NO
 * admission decision.
 *
 * `--list` and any of `--title`/`--description`/`--expected`/`--actual`/
 * `--repro-command` together is a usage error (exit 2, checked BEFORE any
 * IO) — mirrors `assess.ts`'s `--diff`/`--diff-file` mutex-check convention.
 * Filing mode also requires `--title`/`--description`/`--expected`/`--actual`
 * (aggregated into ONE missing-flags message, exit 2) — `--repro-command` is
 * the only optional report field.
 *
 * Actor resolution mirrors `claim.ts`: `resolveActor()` (session tier, then
 * OS username — no `--by` flag on this command, since
 * SPEC-072's task packet declares only the flags in this header).
 *
 * When `feedback.upstream` is unconfigured at all
 * (`classifyFeedbackUpstream(config).kind === "unconfigured"`, see below),
 * this command returns `@lore/core`'s exported
 * `buildUnconfiguredUpstreamRemedy()` — the SAME actionable error for BOTH
 * the filing path and `--list` (single wording SSOT, AC-OOB-1), and now ALSO
 * the identical error the MCP `lore_report_issue` tool returns on the same
 * condition (spec-governance-defaults-must-ship-and-every-recorded-gap-must
 * D3, AC-GD-2). Collapsing onto that ONE shared, imported builder is what
 * makes "the CLI's remedy" and every other surface's remedy the same remedy
 * BY CONSTRUCTION, not by two literals that happen to read alike today.
 *
 * Every failure is a `LoreError`, mapped through the normal
 * `exitCode()`/`formatError()` pipeline — most report-filing failures are
 * `VALIDATION_ERROR` (exit 4): unconfigured `feedback.upstream`, a
 * legacy-shaped `feedback.upstream` (now refused, see above), or (GitHub
 * path) a target/auth failure from `GitHubIntakePort`.
 *
 * Source: SPEC-072 §4 Public Interface, §5 check sequence, §11 Downstream
 * Handoff; task-skill-implement-t5-wiring-cli-report-issue-mcp-lore-report;
 * spec-the-defect-channel-reaches-no-machine-but-its-own-github P2/P4.
 */

import { defineCommand } from "citty";
import {
  buildUnconfiguredUpstreamRemedy,
  err,
  isIssueSeverity,
  ISSUE_CATEGORY_MAX_LENGTH,
  ISSUE_SEVERITIES,
  ok,
  type IssueSeverity,
  type LoreError,
  type Result,
} from "@lore/core";
import { resolveActorWithSource } from "@lore/core/node";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatErrorFor, resolveActor } from "../utils.js";
import { classifyFeedbackUpstream, fileGithubIssue, resolveConsumerCorpusRoot } from "../report-issue-wiring.js";
import { invocationOf } from "../command-invocation.js";

/**
 * The report-filing flags — mutually exclusive with `--list` (checked as a group).
 *
 * §M6's two triage labels JOIN this list rather than getting their own check: they
 * are filing-mode fields like every other entry, and a separate mutex check would
 * be a second place for the rule to drift.
 */
const REPORT_FLAGS = [
  "title",
  "description",
  "expected",
  "actual",
  "repro-command",
  "severity",
  "category",
  "tags",
] as const;

/** The report-filing flags that are REQUIRED when NOT using `--list`. */
const REQUIRED_REPORT_FLAGS = ["title", "description", "expected", "actual"] as const;

/**
 * §M6 — validates the two ORDERING-ONLY triage labels BEFORE any IO, returning the
 * values to persist.
 *
 * ⛔ Both refusals are USAGE errors (exit 2) that NAME the offending value and the
 * accepted set, and they are checked here rather than left to the service: an
 * unrecognised severity is a caller mistake, not an upstream policy outcome.
 * ⛔ And they must be DISTINGUISHABLE from `strict-flags.ts`'s own exit-2
 * unknown-flag refusal — which already fired for `--severity` before this
 * mechanism existed, making an exit-code-only oracle green against zero
 * implementation. Naming the value and the valid set is what separates the two,
 * and AC-DC-7's ERROR case asserts exactly that separation.
 *
 * @param severityArg - the raw `--severity` value, or `undefined`
 * @param categoryArg - the raw `--category` value, or `undefined`
 * @returns the validated labels (keys ABSENT when undeclared, so nothing
 *   fabricates a level downstream); `err(VALIDATION_ERROR)` naming the offender
 */
function validateTriageLabels(
  severityArg: string | undefined,
  categoryArg: string | undefined,
): Result<{ severity?: IssueSeverity; category?: string }, LoreError> {
  let severity: IssueSeverity | undefined;
  if (severityArg !== undefined) {
    const trimmed = severityArg.trim();
    if (!isIssueSeverity(trimmed)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "severity",
        message:
          `Invalid --severity '${severityArg}'. Valid values: ${ISSUE_SEVERITIES.join(", ")}. ` +
          "Severity is an ordering-only label — it never changes whether a report is accepted.",
        value: severityArg,
      });
    }
    severity = trimmed;
  }

  let category: string | undefined;
  if (categoryArg !== undefined) {
    const trimmed = categoryArg.trim();
    if (trimmed.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "category",
        message: "--category must be a non-empty label (omit the flag to declare none).",
        value: categoryArg,
      });
    }
    if (trimmed.length > ISSUE_CATEGORY_MAX_LENGTH) {
      return err({
        code: "VALIDATION_ERROR",
        field: "category",
        message:
          `--category is limited to ${ISSUE_CATEGORY_MAX_LENGTH} characters ` +
          `(got ${trimmed.length}) — it is rendered as a column on both issue read surfaces.`,
        value: categoryArg,
      });
    }
    category = trimmed;
  }

  return ok({
    ...(severity !== undefined ? { severity } : {}),
    ...(category !== undefined ? { category } : {}),
  });
}

export default defineCommand({
  meta: {
    name: "report-issue",
    description:
      "File a structured lore-defect report into a configured upstream corpus. --list delegates to 'lore issues', " +
      "the canonical read verb — use that directly for the full flag set (--open/--resolved/--all/--local/--severity/--category)",
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
    severity: {
      type: "string",
      // reason: the accepted values are RENDERED from the SSOT vocabulary, never
      // typed out — the same discipline `commands/issues.ts` applies to the
      // terminal-resolution set, and for the same reason (a hand-written help
      // string is how a list silently rots out of date).
      description: `Ordering-only severity label (${ISSUE_SEVERITIES.join(" | ")}) — never changes whether a report is accepted (optional)`,
    },
    category: {
      type: "string",
      description: `Ordering-only free-text category label, max ${ISSUE_CATEGORY_MAX_LENGTH} chars — never changes whether a report is accepted (optional)`,
    },
    tags: {
      type: "string",
      description:
        "Comma-separated reporter-supplied tags (spec-the-defect-channel-reaches-no-machine-but-its-own-github " +
        "front-matter field 'tags') — GitHub-configured upstream only; omit for none.",
    },
    list: {
      type: "boolean",
      description:
        "List previously filed reports with live upstream status, instead of filing a new one — delegates to " +
        "'lore issues' (the canonical read verb; use it directly for --open/--resolved/--all/--local/--severity/--category)",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
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

    // §M6 triage labels, validated HERE — synchronously, before any IO — so a
    // rejected value provably writes zero bytes (AC-DC-7's ERROR case asserts the
    // upstream report count is unchanged afterwards).
    //
    // reason: rendered as `Usage error:` + exit 2, matching the two sibling checks
    // above rather than `formatError`/`exitCode()`'s VALIDATION_ERROR → 4. An
    // unrecognised `--severity` value is a CALLER mistake in the same class as a
    // missing required flag, not an upstream policy outcome; `validateTriageLabels`
    // still returns a structured `LoreError` so the field/value survive for any
    // future non-CLI caller.
    const triageResult = validateTriageLabels(
      typeof args.severity === "string" ? args.severity : undefined,
      typeof args.category === "string" ? args.category : undefined,
    );
    if (!triageResult.ok) {
      const detail = "message" in triageResult.error ? triageResult.error.message : triageResult.error.code;
      process.stderr.write(`Usage error: ${detail}\n`);
      process.exit(2);
    }
    const triageLabels = triageResult.value;

    const { app, config } = loadLoreApp({ inv });
    try {
      const corpusRoot = resolveConsumerCorpusRoot(inv);

      // reason: ONE shared classifier (spec-lore-issues-falls-through-to-the-
      // local-corpus-on-a-retired D1) — `commands/issues.ts` consumes the
      // SAME function, so a retired-shape upstream cannot drift back into
      // two independently-derived verdicts.
      const classification = classifyFeedbackUpstream(config);

      if (classification.kind === "unconfigured") {
        const unconfiguredError = buildUnconfiguredUpstreamRemedy();
        process.stderr.write(formatErrorFor(inv, unconfiguredError) + "\n");
        process.exitCode = exitCode(unconfiguredError);
        return;
      }

      // ─── Legacy SQLite-shaped upstream: retired, refused loudly (P4) — see
      // this file's own header. Checked BEFORE any list/filing dispatch since
      // neither has a transport left to run against this shape. The refusal
      // literal lives ONLY inside `classifyFeedbackUpstream` (spec D1) — this
      // command never holds its own copy.
      if (classification.kind === "retired") {
        process.stderr.write(formatErrorFor(inv, classification.error) + "\n");
        process.exitCode = exitCode(classification.error);
        return;
      }

      // `classification.kind === "github"` from here on.
      const effectiveCfg = classification.cfg;

      // ─── GitHub-configured upstream: the LIVE path (GitHubIntakePort +
      // frontMatterCodec + ReceiptLogV2) — see report-issue-wiring.ts::
      // fileGithubIssue's own header. `--list` against this shape DELEGATES
      // to `commands/issues.ts::runGithubIssuesListing` (spec-a-github-
      // filed-defect-must-be-claimable-one-ingest-seam, AC-GR-1/2/10/12) —
      // this file holds NO second listing implementation. A LAZY
      // `import("./issues.js")` keeps this command's own cold start from
      // also pulling in `lore issues`'s module (mirrors `adapters/mcp/
      // tools.ts`'s existing lazy import of THIS file). `--open`/
      // `--resolved`/`--all`/`--severity`/`--category`/`--verify` are not
      // flags on this command at all, so this branch always runs the plain,
      // unfiltered GitHub listing — the same one `lore issues` (no flags)
      // renders.
      if (isList) {
        const { runGithubIssuesListing } = await import("./issues.js");
        await runGithubIssuesListing(inv, app, effectiveCfg, corpusRoot, args.json === true, inv);
        return;
      }

      if (triageLabels.severity === undefined || triageLabels.category === undefined) {
        const missingFlags = [
          triageLabels.severity === undefined ? "--severity" : undefined,
          triageLabels.category === undefined ? "--category" : undefined,
        ].filter((flag): flag is string => flag !== undefined);
        process.stderr.write(
          `Usage error: filing into a GitHub-configured feedback.upstream requires ` +
            `${missingFlags.join(" and ")} (the front-matter schema's severity/category fields are not optional).\n`,
        );
        process.exit(2);
      }

      const tagsArg = args.tags;
      const tags =
        typeof tagsArg === "string" && tagsArg.trim().length > 0
          ? tagsArg
              .split(",")
              .map((tag) => tag.trim())
              .filter((tag) => tag.length > 0)
          : [];

      const { actor, source: actorSource } = resolveActorWithSource(undefined, inv.env, () => inv.user);
      const reproCommand = args["repro-command"];

      const githubResult = await fileGithubIssue(
        {
          title: args.title as string,
          description: args.description as string,
          expected: args.expected as string,
          actual: args.actual as string,
          ...(typeof reproCommand === "string" ? { repro_command: reproCommand } : {}),
          severity: triageLabels.severity,
          category: triageLabels.category,
          tags,
        },
        effectiveCfg,
        {
          consumerCorpusRoot: corpusRoot,
          corpusService: app.corpusService,
          actor,
          actorSource,
          home: inv.paths.home,
          env: inv.env,
        },
      );

      if (!githubResult.ok) {
        process.stderr.write(formatErrorFor(inv, githubResult.error) + "\n");
        process.exitCode = exitCode(githubResult.error);
        return;
      }

      if (args.json) {
        console.log(JSON.stringify({ ok: true, data: githubResult.value }, null, 2));
        return;
      }

      console.log(
        `${githubResult.value.retried ? "Already filed" : "Filed"} as issue #${githubResult.value.number} (${githubResult.value.url})`,
      );
      if (githubResult.value.dedup_degraded) {
        console.log("Warning: duplicate-report check degraded (advisory search failed) — filed anyway.");
      }
      if (githubResult.value.possible_duplicates.length > 0) {
        console.log(`Possible duplicates: ${githubResult.value.possible_duplicates.join(", ")}`);
      }
    } finally {
      app.close();
    }
  },
});
