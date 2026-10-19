/**
 * lore ac — manage structured acceptance criteria on a spec document.
 *
 * Subcommands:
 *   add  <spec> <id> --statement <s> --mode <script|ai|human>
 *          script: --oracle <tsc|test|lint|build|e2e|other> --command <cmd>
 *                  [--allow-missing-path <reason>] — D8 escape (spec-oracle-
 *                  executability-a-runner-s-discovery-refusal-is-not-a §D8,
 *                  task-wire-allow-missing-path-and-the-unredeemed-declaration):
 *                  a `--command` naming a test-file-like path that does not
 *                  exist on disk is REFUSED (exit 4) unless this flag supplies
 *                  a non-empty reason — a red-first AC may legitimately name a
 *                  test not yet written. An empty string (`--allow-missing-path
 *                  ""`) is treated as NO reason and still refuses. The
 *                  declaration is tracked; `lore status --json`'s
 *                  `unredeemed_allow_missing_path_count` field (and the
 *                  matching human-view line) reports how many such
 *                  declarations still name an absent path — it drops as soon
 *                  as the file is created, no further command needed.
 *                  [--falsifier-path <p> --falsifier-find <text> --falsifier-replace
 *                  <text> --falsifier-exit-code <n>] — a DECLARED falsifier
 *                  (spec-falsifiability-reachability-a-feedable-checkpoint-an
 *                  §D2): a named source-file mutation this AC's author
 *                  asserts will make `--command` fail with EXACTLY the given
 *                  exit code. All four flags are required together (a
 *                  partial set fails schema validation naming the missing
 *                  field) — consumed ONLY by the attested-red runner
 *                  (`lore verify --falsify`, `VerifyRunnerService.verifyFalsifier`),
 *                  never by ordinary green-path `lore verify`. NOT (yet)
 *                  wired onto `ac set` — see this file's own header note on
 *                  that scope limit.
 *          ai:     --rubric <text>
 *          human:  --note <text>  (optional)
 *   list <spec> [--json]           List declared criteria (+ per-AC coverage when
 *                                   the spec has a child plan; dangling ac_ref ids).
 *                                   An attested-pass criterion renders `⚑✔` (SPEC-039
 *                                   §2 D8) and either badge appends "(n attested)".
 *                                   An AC with only `inconclusive` evidence renders
 *                                   `⚑?` (SPEC-061 §Scope D5) — distinct from `·`
 *                                   (never verified at all). An AC with only
 *                                   `expected-fail` evidence renders `⚑R` (spec-
 *                                   workflow-hardening-evidence-red-vocabulary-claim-
 *                                   worktree §M1, AC-WH-1) — distinct from both `·`
 *                                   and `⚑?`; NEVER counted as green. A criterion whose
 *                                   derived state is `pass_unfalsified` (spec-oracle-
 *                                   tier-falsifiability-a-criterion-never-observed-red
 *                                   M1 surfacing, AC-FALS-2/5) renders the SAME `✔`
 *                                   badge as a plain pass (never a distinct color/glyph
 *                                   there — 82% of this corpus's criteria measure this
 *                                   state, so the badge itself stays neutral) plus a
 *                                   trailing ` [pass_unfalsified]` line marker, ABSENT
 *                                   once the criterion has falsified evidence (a real
 *                                   `expected-fail`/`fail` ref). `--json`'s `coverage[]`
 *                                   entries additionally carry that same derived `state`
 *                                   string per criterion (AC-FALS-4), alongside the raw
 *                                   `falsified` count `AcCoverageFact` already provides.
 *                                   A criterion superseded by a strictly-newer attested
 *                                   pass (M4) renders `✘S`, distinct from plain `✘`; one
 *                                   whose `falsified` fails runtime well-formedness (M5)
 *                                   renders `⚠` (AC-FALS-19) — see `coverageBadge`'s own
 *                                   JSDoc for the full rationale.
 *                                   A criterion carrying evidence recorded before its
 *                                   script command was REWRITTEN (spec-the-defect-channel-
 *                                   cannot-be-honestly-maintained-an §M5, AC-DC-10) gets a
 *                                   second trailing marker, ` [retired_oracle_evidence:
 *                                   prior_refs=<n> current_refs=<n> generation=<n>]` — see
 *                                   {@link retiredOracleMarker}. Its BADGE stays green on
 *                                   purpose (the split is additive reporting, never an
 *                                   eighth `deriveAcCoverageState`), so this marker is the
 *                                   only thing distinguishing evidence produced by the
 *                                   CURRENT oracle from evidence produced by the one it
 *                                   replaced. `--json`'s `coverage[]` entries carry the
 *                                   SAME split as the structured `oracle_generation` key —
 *                                   `AcCoverageFact`'s own field, serialized verbatim (see
 *                                   {@link withCoverageState}), never re-flattened into
 *                                   prose a consumer would have to re-parse.
 *   cite <spec> <id> <BR-n>... [--remove]
 *                                   Cite (or drop) baseline rule ids on one criterion
 *                                   (baseline slice 1 §C4, AC-BLS1-6). REPORT-ONLY: a
 *                                   dangling / deprecated / retired id is stored and printed
 *                                   as one stderr `Warning:` line per id, exit 0. Never
 *                                   demotes an approved spec; logs one version. `add`/`set`
 *                                   take `--cite BR-n` (repeatable; `set` REPLACES, `--cite ""`
 *                                   clears) with the same warnings. `add` prints a one-line
 *                                   stderr hint for an uncited AC ONLY when the corpus has >= 1
 *                                   baseline doc (corpora without one print what they always did).
 *                                   Surface: CLI only — MCP exposes no `ac` tools today.
 *   rm   <spec> <id> [--force]     Remove a criterion (exit 4 if evidence still
 *                                   references it, unless --force).
 *   set  <spec> <id> [--statement <s>] [--oracle <o>] [--command <c>] [--timeout-ms <n>|''] [--rubric <r>]
 *        [--note <n>] [--covers <req-id>] [--allow-missing-path <reason>]
 *        [--falsifier-path <p> --falsifier-find <text> --falsifier-replace <text>
 *         --falsifier-exit-code <n>]
 *                                   In-place edit of ONE declared criterion
 *                                   (spec-lore-ac-set-in-place-edit-of-a-declared-
 *                                   acceptance D1-D6). `id`/`mode` are NOT editable —
 *                                   `--mode` exits 2 naming the rm+add path (D1). At
 *                                   least one other flag is required — zero flags
 *                                   exits 2 (D3), never a silent no-op. `--statement`/
 *                                   `--covers` are mode-agnostic; `--oracle`/`--command`
 *                                   (script) / `--rubric` (ai) / `--note` (human) exit 4
 *                                   against a criterion of a different mode (D5). On a
 *                                   LOCKED spec (ever approved) it is refused, exit 4,
 *                                   `gate:record-edit` (spec-documents-are-living-or-records
 *                                   D6/D12); on an unlocked spec that is `approved` it
 *                                   demotes it to `draft`, like a content/title edit (D2).
 *                                   `--covers` REPLACES
 *                                   `requirement_refs` wholesale across repeated flags in
 *                                   one call; `--covers ""` clears it to `[]`.
 *                                   `--allow-missing-path` is the SAME D8 escape `add`
 *                                   documents above — re-checked against the (possibly
 *                                   untouched) resulting command on every `set`, per
 *                                   `AcService.setCriterion`'s own JSDoc.
 *                                   `--falsifier-*` (task-make-lore-ac-set-accept-the-
 *                                   falsifier-flags-its-own-error) is NOW wired here too —
 *                                   editing a declared falsifier no longer requires the
 *                                   destructive `ac rm --force` + `ac add --falsifier-*`
 *                                   round-trip the previous revision of this header
 *                                   documented as a NAMED gap. All four flags are
 *                                   REQUIRED TOGETHER, exactly like `add` (a partial set
 *                                   fails schema validation naming the missing field) —
 *                                   REPLACES the whole `verify.falsifier` object; passing
 *                                   NONE of the four leaves an existing falsifier
 *                                   untouched (`SetCriterionPatch.falsifier`'s own JSDoc,
 *                                   `service/ac-service.ts`, documents the
 *                                   require-all-four-together partial-update contract and
 *                                   why a field-level merge onto a stale value was
 *                                   rejected); exits 4 against a non-script-mode criterion
 *                                   (D5, same shape as `--oracle`/`--command`).
 *
 * `add`/`rm`/`set` on a LOCKED spec (one that has ever been approved) are REFUSED with exit 4,
 * `gate:record-edit` (spec-documents-are-living-or-records D6/D12): an added, removed or edited
 * criterion changes what was accepted, so it belongs to a new spec. `cite` is NOT a rewrite and is
 * not refused. The approved->draft demotion below therefore only ever fires for a spec the lock
 * does not cover (the gate disabled via `workflow.gates."record-edit".enabled: false`).
 *
 * `add`/`set` additionally print the approved->draft demotion an edit MAY trigger
 * (spec-governance-visibility-an-armed-gate-that-vacuously-passes §B2, AC-GV-4) —
 * see {@link reportDemotionIfAny}. The demotion rule itself is unchanged
 * (`resolveStatusAfterContractEdit`, `@lore/core`); only its historical silence
 * (this file's own module header, pre-AC-GV-4, documented it in a comment only)
 * was the defect. Printed to stderr on EITHER subcommand, in BOTH --json and
 * human mode, ONLY when the write actually observed an approved->draft
 * transition — a write that does not (an already-draft spec, a rejected write,
 * or `ac add`, which per `AcService.writeCriteria` never changes status at all)
 * prints neither the demotion line nor its descendant-claim-blocking count.
 *
 * All subcommands accept --json for machine-readable output (SPEC-003 §4).
 * Exit codes per SPEC-003 §5 (via utils.ts::exitCode):
 *   0 = success
 *   2 = CLI usage error (`set --mode`, `set` with zero field flags — both
 *       argv-decidable, judged before any service call, spec-lore-ac-set-in-place-
 *       edit-of-a-declared-acceptance D5a)
 *   3 = DOC_NOT_FOUND (spec not found)
 *   4 = VALIDATION_ERROR (malformed criterion, duplicate id, 50-entry cap, unknown
 *       id on rm/set naming the declared ids, evidence blocking rm without --force,
 *       a mode-inconsistent flag on set naming the flag and the actual mode, a
 *       script-mode --command naming a path that does not exist with no non-empty
 *       --allow-missing-path reason — D8)
 *   5 = STALE_VERSION
 *
 * Source: SPEC-038 §4, §6 AC-ACODE-7; SPEC-039 §2 D8 (attested coverage annotation);
 *   SPEC-061 §Scope D5 (inconclusive badge); SPEC-070 AC-070-12 (shared fail-first
 *   precedence via @lore/core's deriveAcCoverageState); spec-workflow-hardening-
 *   evidence-red-vocabulary-claim-worktree §M1 AC-WH-1 (expected-fail badge);
 *   spec-lore-ac-set-in-place-edit-of-a-declared-acceptance D1-D6 (`set` subcommand);
 *   spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1/M4/M5
 *   (pass_unfalsified/fail_superseded/not_measured badges, AC-FALS-2/5/19);
 *   spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a §D8 +
 *   task-wire-allow-missing-path-and-the-unredeemed-declaration (`--allow-missing-path`
 *   PRODUCTION wiring — the D8 escape was service-layer-only and unit-tested but
 *   unreachable from a real `lore ac add`/`ac set` invocation until this task);
 *   spec-falsifiability-reachability-a-feedable-checkpoint-an §D2 (`--falsifier-*`
 *   declared-falsifier authoring, now on BOTH `add` and `set`);
 *   task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error (`set` wiring +
 *   the suggested-command-integrity scanner, AC-FR-9,
 *   scripts/tests/error-message-commands-executable.test.ts);
 *   spec-the-defect-channel-cannot-be-honestly-maintained-an §M5 AC-DC-10 +
 *   task-wire-the-oracle-generation-split-to-a-read-surface-so-a (the retired-oracle
 *   marker — §M5's aggregator half landed with NO renderer reading it, so a
 *   polarity-reversed oracle still displayed as plain green; oracle:
 *   packages/lore/tests/integration/cli/ac-oracle-generation-surface.bun.test.ts,
 *   which SPAWNS this command because a unit test over `computeAcCoverage` passes
 *   whether or not any renderer reads the field)
 */

import { defineLoreCommand } from "../cli-exit.js";

import { existsSync } from "fs";
import { dirname } from "path";
import { loadLoreApp } from "../loader.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { AcExemptionService } from "../../../service/ac-exemption-service.js";
import { DecisionService } from "../../../service/decision-service.js";
import { createOverrideDecisionPort } from "../../../service/override-decision.js";
import { exitCode, formatError, formatErrorFor, resolveActor } from "../utils.js";
import { deriveAcCoverageState, findModeForeignDetail, getAllowedTransitions, modeForeignDetailMessage, ok } from "@lore/core";
import type { AcceptanceCriterion, AcCoverageFact, Invocation, LoreError, Result } from "@lore/core";
import type { AcService, AcListResult, DeclarePathOpts, SetCriterionOpts, SetCriterionPatch } from "../../../service/ac-service.js";
import type { App } from "../../../app.js";
import type { CiteWarning } from "../../../service/ac-citations.js";
// reason: `isPlanMember` is SHARED, store-less predicate infrastructure (its own
// module header: "not a service... exactly the shared infrastructure that pattern
// exists to permit"), not the sibling `ac-service.ts` this task's file anchors
// forbid editing — see {@link countBlockedDescendantTasks}.
import { isPlanMember } from "../../../service/plan-membership.js";
import { invocationOf } from "../command-invocation.js";
import { printLine } from "../output.js";
import type { CliIo } from "../output.js";
import type { ExitReport } from "../cli-exit.js";

/**
 * `App.acService` is typed optional only to keep pre-existing hand-built App test
 * stubs (outside this task's file anchors) compiling — see its JSDoc in app.ts.
 * `loadLoreApp()` (this adapter's only App source) always returns a fully-wired
 * App from `createApp`, so this assertion never actually fires in the CLI.
 */
function requireAcService(app: App): AcService {
  if (app.acService === undefined) {
    throw new Error("Internal error: AcService not wired on App");
  }
  return app.acService;
}

export default defineLoreCommand({
  meta: {
    name: "ac",
    description: "Manage structured acceptance criteria on a spec (add / list / rm / set)",
  },
  subCommands: {
    add: defineLoreCommand({
      meta: { name: "add", description: "Append a new acceptance criterion to a spec" },
      args: {
        spec: {
          type: "positional",
          description: "Spec document ID or slug",
          required: true,
        },
        id: {
          type: "positional",
          description: "Criterion id, e.g. AC-FEATURE-1",
          required: true,
        },
        statement: {
          type: "string",
          description: "What the criterion asserts",
          required: true,
        },
        mode: {
          type: "string",
          description: "Verify mode: script | ai | human",
          required: true,
        },
        oracle: {
          type: "string",
          description: "script mode only: tsc | test | lint | build | e2e | other",
        },
        command: {
          type: "string",
          description: "script mode only: exact command to run",
        },
        "timeout-ms": {
          type: "string",
          description:
            "script mode only: per-AC verify timeout in ms (positive integer; stored as verify.timeout_ms, " +
            "overrides the verify default for a long oracle)",
        },
        rubric: {
          type: "string",
          description: "ai mode only: judging rubric text",
        },
        note: {
          type: "string",
          description: "human mode only: optional free-text note",
        },
        covers: {
          type: "string",
          description: "[repeatable] PRD requirement id this AC covers, e.g. R-1 (SPEC-055)",
        },
        cite: {
          type: "string",
          description:
            "[repeatable] baseline rule id this AC cites, e.g. BR-12 — report-only: a dangling/inactive id is stored and warned",
        },
        "allow-missing-path": {
          type: "string",
          description:
            "D8 escape: REQUIRED non-empty reason to declare a script-mode --command naming a test path " +
            "not yet on disk (e.g. a red-first AC). Empty/absent reason is refused when a path is missing.",
        },
        "falsifier-path": {
          type: "string",
          description:
            "script mode only: DECLARED falsifier (spec-falsifiability-reachability §D2) — repo-relative " +
            "path to the file --falsifier-find/--falsifier-replace mutate. Required together with the " +
            "other three --falsifier-* flags.",
        },
        "falsifier-find": {
          type: "string",
          description:
            "script mode only: literal substring that MUST be present in --falsifier-path's content at " +
            "attested-red run time — a stale falsifier is refused loud, never silently skipped.",
        },
        "falsifier-replace": {
          type: "string",
          description: "script mode only: replacement text for --falsifier-find's FIRST occurrence.",
        },
        "falsifier-exit-code": {
          type: "string",
          description:
            "script mode only: the EXACT exit code (never \"non-zero\"; a whole number from 1 to 255) this mutation is declared to " +
            "produce when --command runs against the mutated file.",
        },
        correction: {
          type: "string",
          description: "NOT accepted here — exits 2; a correction fixes ONE existing criterion: `lore ac set --correction`",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const correctionRefusal = refuseCorrectionFlag(inv.io, args, "add");
        if (correctionRefusal !== undefined) return correctionRefusal;
        const timeoutRefusal = refuseBadTimeoutMs(inv.io, args, "add");
        if (timeoutRefusal !== undefined) return timeoutRefusal;
        const foreignRefusal = refuseModeForeignDetail(inv.io, args);
        if (foreignRefusal !== undefined) return foreignRefusal;
        const { app, dbPath } = loadLoreApp({ inv });
        try {
          const beforeStatus = await fetchSpecStatus(app, args.spec as string);

          const criterion = buildCriterionCandidate(args);
          const result = await requireAcService(app).addCriterion(
            args.spec as string,
            criterion,
            { ...buildDeclarePathOpts(args, dbPath, inv), onAdvisory: (advisory: string): void => printAdvisory(inv.io, advisory) },
          );

          if (!result.ok) {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            return exitCode(result.error);
          }

          await reportDemotionIfAny(inv.io, app, args.spec as string, beforeStatus);
          await reportCiteFeedbackOnAdd(inv, requireAcService(app), args.spec as string, args.id as string, criterion);

          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { criteria: result.value } }, null, 2));
            return 0;
          }

          printLine(inv.io.stdout, `Added acceptance criterion "${args.id as string}" to spec ${args.spec as string}`);
          renderCriteriaList(inv.io, { criteria: result.value, coverage: null, dangling: [] });
        } finally {
          app.close();
        }
        return 0;
      },
    }),

    list: defineLoreCommand({
      meta: { name: "list", description: "List declared acceptance criteria for a spec" },
      args: {
        spec: {
          type: "positional",
          description: "Spec document ID or slug",
          required: true,
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const { app, dbPath } = loadLoreApp({ inv });
        try {
          const result = await requireAcService(app).listCriteria(args.spec as string, {
            fileExists: existsSync,
            cwd: inv.cwd,
            corpusRoot: dirname(dirname(dbPath)),
          });

          if (!result.ok) {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            return exitCode(result.error);
          }

          if (args.json) {
            printLine(inv.io.stdout, 
              JSON.stringify(
                { ok: true, data: { ...result.value, coverage: withCoverageState(result.value.coverage) } },
                null,
                2,
              ),
            );
            return 0;
          }

          if (result.value.criteria.length === 0) {
            printLine(inv.io.stdout, "No acceptance criteria declared on this spec.");
            return 0;
          }

          renderCriteriaList(inv.io, result.value);
        } finally {
          app.close();
        }
        return 0;
      },
    }),

    exempt: defineLoreCommand({
      meta: {
        name: "exempt",
        description:
          "Exempt one uncited criterion from the citation gate for a bounded time (needs --reason and --expires; active exemptions are capped at 10% of live criteria)",
      },
      args: {
        spec: { type: "positional", description: "Spec document ID or slug", required: true },
        id: { type: "positional", description: "Criterion id to exempt, e.g. AC-FEATURE-1", required: true },
        reason: { type: "string", description: "Why this criterion cannot cite a rule yet (required, non-blank)" },
        expires: { type: "string", description: "ISO 8601 date/time the exemption lapses; must be in the future (required)" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        // reason: the exemption table is read/written through a second store handle because `App`
        // does not expose its store (same precedent as `lore status`'s baseline block).
        const { app, dbPath } = loadLoreApp({ inv });
        const store = new SQLiteStore(dbPath);
        try {
          // reason: AC-AU-7 — the grant asks decide() (class ac-exempt) through the decision log on this same store.
          const overrides = createOverrideDecisionPort(new DecisionService({ store, executorRun: null }));
          const result = await new AcExemptionService(store, undefined, overrides).grant({
            specIdOrSlug: args.spec as string,
            acId: args.id as string,
            reason: args.reason as string,
            expiresAt: args.expires as string,
            by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user),
          });
          if (!result.ok) {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            return exitCode(result.error);
          }
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { exemption: result.value } }, null, 2));
            return 0;
          }
          printLine(inv.io.stdout, 
            `Exempted ${args.id as string} on spec ${args.spec as string} until ${result.value.expires_at} (by ${result.value.granted_by})`,
          );
        } finally {
          store.close();
          app.close();
        }
        return 0;
      },
    }),
    cite: defineLoreCommand({
      meta: {
        name: "cite",
        description:
          "Cite (or --remove) baseline rule ids on one criterion — report-only, never demotes an approved spec",
      },
      args: {
        spec: {
          type: "positional",
          description: "Spec document ID or slug",
          required: true,
        },
        id: {
          type: "positional",
          description: "Criterion id to cite from, e.g. AC-FEATURE-1",
          required: true,
        },
        rule: {
          type: "positional",
          description: "Baseline rule id(s) BR-<n> — one or more positionals",
          required: true,
        },
        remove: {
          type: "boolean",
          description: "Remove these ids from the criterion's cites instead of adding them",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        // `args._` carries EVERY positional token (spec, id, then each rule id) — citty
        // declares only the first `rule`; the rest survive on `_` (see anchor.ts's note).
        const ruleIds = ((args._ ?? []) as string[]).slice(2);
        const { app } = loadLoreApp({ inv });
        try {
          const result = await requireAcService(app).citeCriterion(
            args.spec as string,
            args.id as string,
            ruleIds,
            { remove: args.remove === true },
            { by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user) },
          );

          if (!result.ok) {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            return exitCode(result.error);
          }

          printCiteWarnings(inv.io, result.value.warnings);

          if (args.json) {
            printLine(inv.io.stdout, 
              JSON.stringify(
                { ok: true, data: { criteria: result.value.criteria, warnings: result.value.warnings } },
                null,
                2,
              ),
            );
            return 0;
          }

          const verb = args.remove === true ? "Removed citation(s) from" : "Cited";
          const cites = result.value.criteria.find((c) => c.id === (args.id as string))?.cites ?? [];
          printLine(inv.io.stdout, 
            `${verb} acceptance criterion "${args.id as string}" on spec ${args.spec as string} — ` +
              `cites: ${cites.length > 0 ? cites.join(", ") : "(none)"}`,
          );
        } finally {
          app.close();
        }
        return 0;
      },
    }),

    rm: defineLoreCommand({
      meta: {
        name: "rm",
        description: "Remove a declared acceptance criterion (fails if evidence still references it)",
      },
      args: {
        spec: {
          type: "positional",
          description: "Spec document ID or slug",
          required: true,
        },
        id: {
          type: "positional",
          description: "Criterion id to remove",
          required: true,
        },
        force: {
          type: "boolean",
          description: "Remove even when evidence still references this id (existing ac_ref becomes dangling)",
        },
        correction: {
          type: "string",
          description: "NOT accepted here — exits 2; a correction fixes ONE existing criterion: `lore ac set --correction`",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const correctionRefusal = refuseCorrectionFlag(inv.io, args, "rm");
        if (correctionRefusal !== undefined) return correctionRefusal;
        const { app } = loadLoreApp({ inv });
        try {
          const result = await requireAcService(app).removeCriterion(args.spec as string, args.id as string, {
            force: args.force === true,
            by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user),
          });

          if (!result.ok) {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            return exitCode(result.error);
          }

          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { criteria: result.value } }, null, 2));
            return 0;
          }

          printLine(inv.io.stdout, `Removed acceptance criterion "${args.id as string}" from spec ${args.spec as string}`);
          if (result.value.length > 0) {
            renderCriteriaList(inv.io, { criteria: result.value, coverage: null, dangling: [] });
          } else {
            printLine(inv.io.stdout, "No acceptance criteria remaining.");
          }
        } finally {
          app.close();
        }
        return 0;
      },
    }),

    supersede: defineLoreCommand({
      meta: {
        name: "supersede",
        description:
          "Mark a criterion superseded by another spec's criterion: verify skips it, it becomes immutable, the spec is not demoted",
      },
      args: {
        spec: { type: "positional", description: "Spec document ID or slug", required: true },
        id: { type: "positional", description: "Criterion id to supersede", required: true },
        by: {
          type: "string",
          description: "REQUIRED: the superseding criterion as <spec>:<AC-ID> (spec id or slug)",
        },
        reason: { type: "string", description: "REQUIRED: why the criterion is superseded (non-empty)" },
        json: { type: "boolean", description: "Output result as JSON" },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        // argv-decidable: exit 2 before the app loads or anything is written.
        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (reason === "") {
          inv.io.stderr.write('Error: lore ac supersede requires a non-empty --reason "<why>".\n');
          return 2;
        }
        const byRaw = typeof args.by === "string" ? args.by : "";
        const sep = byRaw.lastIndexOf(":");
        if (sep <= 0 || sep === byRaw.length - 1) {
          inv.io.stderr.write("Error: lore ac supersede requires --by <spec>:<AC-ID>.\n");
          return 2;
        }
        const { app } = loadLoreApp({ inv });
        try {
          const result = await requireAcService(app).supersedeCriterion(
            args.spec as string,
            args.id as string,
            { spec: byRaw.slice(0, sep), ac: byRaw.slice(sep + 1) },
            reason,
            { by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user) },
          );
          if (!result.ok) {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            return exitCode(result.error);
          }
          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { criteria: result.value } }, null, 2));
            return 0;
          }
          printLine(
            inv.io.stdout,
            `Superseded acceptance criterion "${args.id as string}" on spec ${args.spec as string} by ${byRaw} (spec status unchanged)`,
          );
        } finally {
          app.close();
        }
        return 0;
      },
    }),

    set: defineLoreCommand({
      meta: {
        name: "set",
        description: "Edit one declared acceptance criterion in place (id/mode are NOT editable)",
      },
      args: {
        spec: {
          type: "positional",
          description: "Spec document ID or slug",
          required: true,
        },
        id: {
          type: "positional",
          description: "Criterion id to edit",
          required: true,
        },
        statement: {
          type: "string",
          description: "Replace the statement (mode-agnostic)",
        },
        oracle: {
          type: "string",
          description: "script mode only: replace the oracle (tsc|test|lint|build|e2e|other)",
        },
        command: {
          type: "string",
          description: "script mode only: replace the command",
        },
        "timeout-ms": {
          type: "string",
          description:
            "script mode only: set verify.timeout_ms (positive integer ms); pass '' to remove the field",
        },
        rubric: {
          type: "string",
          description: "ai mode only: replace the judging rubric text",
        },
        note: {
          type: "string",
          description: "human mode only: replace the free-text note",
        },
        covers: {
          type: "string",
          description:
            "[repeatable] replace covered PRD requirement ids wholesale (mode-agnostic); pass '' to clear to []",
        },
        cite: {
          type: "string",
          description:
            "[repeatable] REPLACE the cited baseline rule ids wholesale (mode-agnostic, report-only); pass '' to clear",
        },
        "allow-missing-path": {
          type: "string",
          description:
            "D8 escape: REQUIRED non-empty reason to declare a script-mode command naming a test path not yet " +
            "on disk. Empty/absent reason is refused when the (possibly untouched) resulting command is missing.",
        },
        "falsifier-path": {
          type: "string",
          description:
            "script mode only: REPLACE the declared falsifier's repo-relative path (spec-falsifiability-" +
            "reachability §D2). Required together with the other three --falsifier-* flags — a partial set " +
            "fails schema validation naming the missing field, same as `ac add`. Passing NONE of the four " +
            "leaves an existing falsifier untouched (no field-level merge — see AcService.SetCriterionPatch).",
        },
        "falsifier-find": {
          type: "string",
          description: "script mode only: REPLACE the falsifier's literal find-text. Required together with the " +
            "other three --falsifier-* flags.",
        },
        "falsifier-replace": {
          type: "string",
          description: "script mode only: REPLACE the falsifier's replacement text for --falsifier-find's FIRST " +
            "occurrence. Required together with the other three --falsifier-* flags.",
        },
        "falsifier-exit-code": {
          type: "string",
          description:
            "script mode only: REPLACE the EXACT exit code (never \"non-zero\"; a whole number from 1 to 255) the mutation is declared to " +
            "produce. Required together with the other three --falsifier-* flags.",
        },
        correction: {
          type: "string",
          description:
            "Reason for an audited fix of this ONE criterion on a LOCKED (approved) spec: skips the record-edit " +
            "refusal and the approved→draft demotion, writes one version, keeps the status, records the reason. " +
            "Must be non-empty. `ac add|rm` have no correction exit.",
        },
        mode: {
          type: "string",
          description: "NOT editable — exits 2; use `ac rm --force` then `ac add --mode <new>` instead",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        // D1/D5a — argv-decidable, judged BEFORE the app/store is even opened:
        // `--mode` names a rule the command line alone already violates.
        if (typeof args.mode === "string") {
          inv.io.stderr.write(
            "Error: --mode cannot be changed via `lore ac set` — mode reinterprets every historical " +
              "evidence row attributed to this id. Use `lore ac rm --force <spec> <id>` then " +
              "`lore ac add <spec> <id> --mode <new-mode> ...` instead.\n",
          );
          return 2;
        }

        const timeoutRefusal = refuseBadTimeoutMs(inv.io, args, "set");
        if (timeoutRefusal !== undefined) return timeoutRefusal;
        const patch = buildSetPatch(args);
        if (patch === null) {
          inv.io.stderr.write(
            "Error: lore ac set requires at least one field to change: --statement, --oracle, --command, " +
              "--timeout-ms, --rubric, --note, --covers, --cite, --falsifier-path/-find/-replace/-exit-code\n",
          );
          return 2;
        }

        // --correction needs a non-empty reason: argv-decidable, so exit 2 BEFORE the app loads or anything
        // is written (BR-1069, mirrors `lore set --correction`).
        let correctionOpt: { reason: string } | undefined;
        if (args.correction !== undefined) {
          const reason = typeof args.correction === "string" ? args.correction.trim() : "";
          if (reason === "") {
            inv.io.stderr.write('Error: --correction requires a non-empty reason (--correction "<why this is a fix>").\n');
            return 2;
          }
          correctionOpt = { reason };
        }

        const { app, dbPath } = loadLoreApp({ inv });
        try {
          const beforeStatus = await fetchSpecStatus(app, args.spec as string);

          const setOpts: SetCriterionOpts = {
            ...buildDeclarePathOpts(args, dbPath, inv),
            onAdvisory: (advisory: string): void => printAdvisory(inv.io, advisory),
            ...(correctionOpt !== undefined ? { correction: correctionOpt } : {}),
          };
          const result = await requireAcService(app).setCriterion(
            args.spec as string,
            args.id as string,
            patch,
            setOpts,
          );

          if (!result.ok) {
            inv.io.stderr.write(formatErrorFor(inv, result.error) + "\n");
            return exitCode(result.error);
          }

          await reportDemotionIfAny(inv.io, app, args.spec as string, beforeStatus);
          if (patch.cites !== undefined) await reportCiteWarnings(inv, requireAcService(app), patch.cites, args.spec as string);

          if (args.json) {
            printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { criteria: result.value } }, null, 2));
            return 0;
          }

          printLine(inv.io.stdout, `Updated acceptance criterion "${args.id as string}" on spec ${args.spec as string}`);
          if (correctionOpt !== undefined) printLine(inv.io.stdout, `  (correction recorded: ${correctionOpt.reason})`);
          renderCriteriaList(inv.io, { criteria: result.value, coverage: null, dangling: [] });
        } finally {
          app.close();
        }
        return 0;
      },
    }),
  },
});

const printAdvisory = (io: CliIo, advisory: string): void => {
  io.stderr.write(advisory + "\n");
};

/**
 * `lore ac add|rm` accept NO correction (BR-1069, D4): a new or removed criterion is a new decision, not a
 * fix. When `--correction` is on the command line, write the refusal naming the only criterion correction
 * and set exit 2 — argv-decidable, so this runs BEFORE the app loads.
 *
 * @returns the refusal's exit code (2) when the call was refused (the caller must return it), else `undefined`.
 */
function refuseCorrectionFlag(io: CliIo, args: Record<string, unknown>, verb: "add" | "rm"): number | undefined {
  if (args.correction === undefined) return undefined;
  io.stderr.write(
    `Error: lore ac ${verb} does not accept --correction — a ${verb === "add" ? "new" : "removed"} criterion is a ` +
      "new decision, not a fix. The only criterion correction is `lore ac set --correction \"<reason>\"` on ONE existing criterion.\n",
  );
  return 2;
}

// ─── --timeout-ms validation ─────────────────────────────────────────────────

/**
 * Argv-decidable guard for `--timeout-ms` (AC-level `verify.timeout_ms`): the value must be a
 * positive integer made only of digits. `ac set` additionally accepts `''` (removes the field).
 * Violation writes a stderr line and returns exit 4 (validation) so the caller stops
 * BEFORE the app/store is opened. `ac add --mode <non-script> --timeout-ms` is refused the same way
 * (script mode only); `ac set` on a non-script criterion is refused by `AcService.setCriterion`.
 *
 * @param args - raw citty args
 * @param verb - which subcommand is running (only `set` accepts the `''` clear sentinel)
 * @returns the refusal's exit code (4) when the command was refused (caller must return it), else `undefined`
 */
function refuseBadTimeoutMs(io: CliIo, args: Record<string, unknown>, verb: "add" | "set"): number | undefined {
  const raw = args["timeout-ms"];
  if (raw === undefined) return undefined;
  const fail = (io: CliIo, why: string): number => {
    io.stderr.write(`Error: --timeout-ms ${why}\n`);
    return 4;
  };
  if (typeof raw !== "string") return fail(io, "must be a positive integer number of milliseconds");
  if (verb === "set" && raw === "") return undefined;
  if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0) {
    return fail(io, `must be a positive integer number of milliseconds (got "${raw}")`);
  }
  return undefined;
}

/**
 * `ac add` half of the mode-foreign-detail refusal: the SAME validator `ac set` uses
 * (`findModeForeignDetail`, `@lore/core`), run on argv before the app opens. A detail
 * that belongs to another mode is refused (exit 4), never silently dropped.
 */
function refuseModeForeignDetail(io: CliIo, args: Record<string, unknown>): number | undefined {
  const mode = args.mode;
  if (mode !== "script" && mode !== "ai" && mode !== "human") return undefined; // schema names the bad mode
  const has = (k: string): boolean => typeof args[k] === "string";
  const found = findModeForeignDetail(mode, {
    oracle: has("oracle"),
    command: has("command"),
    timeout_ms: has("timeout-ms"),
    falsifier: ["falsifier-path", "falsifier-find", "falsifier-replace", "falsifier-exit-code"].some(has),
    rubric: has("rubric"),
    note: has("note"),
  });
  if (found === undefined) return undefined;
  io.stderr.write(`Error: ${modeForeignDetailMessage(String(args.id), found, mode)}\n`);
  return 4;
}

// ─── Input Assembly ──────────────────────────────────────────────────────────

/**
 * Assemble a candidate criterion object from raw CLI args — deliberately untyped
 * (`unknown` at the AcService boundary): schema validation (`acceptanceCriterionSchema`
 * via `specAcceptanceCriteriaSchema`) is the single source of truth for whether the
 * mode-specific fields (oracle+command / rubric / note) are actually present and
 * well-formed. This function only shapes the object; it does not validate it.
 */
function buildCriterionCandidate(args: Record<string, unknown>): unknown {
  const mode = args.mode as string;
  let verify: Record<string, unknown>;
  if (mode === "script") {
    const falsifier = buildFalsifierCandidate(args);
    verify = {
      mode: "script",
      ...(typeof args.oracle === "string" ? { oracle: args.oracle } : {}),
      ...(typeof args.command === "string" ? { command: args.command } : {}),
      ...(typeof args["timeout-ms"] === "string" ? { timeout_ms: Number(args["timeout-ms"]) } : {}),
      ...(falsifier !== undefined ? { falsifier } : {}),
    };
  } else if (mode === "ai") {
    verify = {
      mode: "ai",
      ...(typeof args.rubric === "string" ? { rubric: args.rubric } : {}),
    };
  } else if (mode === "human") {
    verify = {
      mode: "human",
      ...(typeof args.note === "string" ? { note: args.note } : {}),
    };
  } else {
    // reason: an unrecognized mode string fails schema validation's discriminated
    // union (no matching branch) — surfaces as VALIDATION_ERROR from addCriterion,
    // not a CLI-side pre-check. Passed through verbatim so the error message names
    // the actual bad value.
    verify = { mode };
  }

  // reason: SPEC-055 — citty yields a string for one --covers, an array for ≥2, undefined for
  // zero. Normalize to a string array; omit the key entirely when none (so a criterion with no
  // --covers stays byte-identical to pre-SPEC-055, matching the schema's optional field).
  const coversRaw = args.covers;
  const requirement_refs =
    typeof coversRaw === "string" ? [coversRaw] : Array.isArray(coversRaw) ? (coversRaw as string[]) : undefined;

  const cites = normalizeCiteFlag(args.cite);

  return {
    id: args.id as string,
    statement: args.statement as string,
    verify,
    ...(requirement_refs !== undefined ? { requirement_refs } : {}),
    ...(cites !== undefined && cites.length > 0 ? { cites } : {}),
  };
}

/**
 * Assemble a candidate `falsifier` object from raw CLI args (spec-
 * falsifiability-reachability-a-feedable-checkpoint-an §D2) — deliberately
 * untyped, same rationale {@link buildCriterionCandidate}'s own JSDoc states:
 * `acFalsifierSchema` (via `acceptanceCriterionSchema`'s script branch,
 * `@lore/core`) is the single source of truth for whether all four fields
 * are present and well-formed. This function only shapes the object; a
 * PARTIAL set of `--falsifier-*` flags (e.g. `--falsifier-path` with no
 * `--falsifier-exit-code`) is passed through as-is and fails schema
 * validation naming the missing field — never silently dropped or defaulted.
 *
 * Shared VERBATIM by BOTH `add`'s {@link buildCriterionCandidate} and `set`'s
 * `buildSetPatch` (task-make-lore-ac-set-accept-the-falsifier-flags-its-own-error)
 * — one assembly function, never a second copy for `set`. On `set`, `undefined`
 * here means "no `--falsifier-*` flag at all", which `AcService.setCriterion`
 * (`SetCriterionPatch.falsifier`) treats as "leave the existing falsifier
 * untouched" — never as "clear it".
 *
 * @returns `undefined` when NONE of the four flags were passed (the common
 *   case — a script-mode AC with no falsifier declared, or a `set` call not
 *   touching the falsifier at all); a shaped candidate object otherwise, keyed
 *   by `--falsifier-path`'s presence (the flag every other one is documented
 *   as "required together with").
 */
function buildFalsifierCandidate(args: Record<string, unknown>): unknown {
  const path = args["falsifier-path"];
  const find = args["falsifier-find"];
  const replace = args["falsifier-replace"];
  const exitCodeRaw = args["falsifier-exit-code"];
  if (
    typeof path !== "string" &&
    typeof find !== "string" &&
    typeof replace !== "string" &&
    typeof exitCodeRaw !== "string"
  ) {
    return undefined;
  }
  return {
    ...(typeof path === "string" ? { path } : {}),
    ...(typeof find === "string" ? { find } : {}),
    ...(typeof replace === "string" ? { replace } : {}),
    // reason: citty yields every flag as a string; `acFalsifierSchema.expected_exit_code`
    // is `z.number().int()` — a non-numeric string (e.g. "abc") becomes `NaN`, which
    // Zod's `z.number()` REJECTS (NaN is not a valid `number` per Zod's own check),
    // so a malformed value fails loud through schema validation rather than silently
    // coercing to 0.
    ...(typeof exitCodeRaw === "string" ? { expected_exit_code: Number(exitCodeRaw) } : {}),
  };
}

/**
 * PRODUCTION wiring for `AcService.addCriterion`/`setCriterion`'s D8
 * declaration-time path-existence check (spec-oracle-executability-a-runner-
 * s-discovery-refusal-is-not-a §D8, task-wire-allow-missing-path-and-the-
 * unredeemed-declaration) — the mechanism landed service-layer-only and
 * unit-tested (task-promote-the-oracle-file-existence-primitives-into-lore)
 * but was UNREACHABLE from a real `lore ac add`/`ac set` invocation until
 * this call site started supplying it.
 *
 * `pathContext` is ALWAYS supplied (unlike `DeclarePathOpts`'s own opt-in
 * default) — a real CLI invocation's `process.cwd()` is correct by
 * construction (a fresh subprocess per invocation inherits the caller's real
 * shell cwd; same rationale `commands/evidence.ts`'s own precheck
 * construction documents for its identical `existsSync`/cwd/corpusRoot
 * shape). `corpusRoot` is derived the SAME way that precheck derives it:
 * `dbPath` is always `<corpusRoot>/.lore/lore.db`, so the corpus root sits
 * two directories up.
 *
 * `allowMissingPath` is read from `--allow-missing-path` VERBATIM — an
 * explicitly empty string (`--allow-missing-path ""`) is passed through
 * unchanged, not normalized to `undefined` here: `checkDeclaredPathExistence`
 * (`ac-service.ts`) is the SINGLE place that decides an empty/whitespace-only
 * reason is "no reason supplied" (`.trim().length === 0`), so the refusal
 * message stays byte-identical whether the caller is this CLI or a future
 * second adapter — this function does not pre-judge that decision.
 *
 * @param args - raw citty args (the same untyped `Record<string, unknown>`
 *   shape {@link buildCriterionCandidate}/`buildSetPatch` already accept)
 * @param dbPath - the discovered `.lore/lore.db` path `loadLoreApp()` returns
 * @param inv - the running command's Invocation (cwd for the path context, env + cwd for the actor)
 */
function buildDeclarePathOpts(args: Record<string, unknown>, dbPath: string, inv: Invocation): DeclarePathOpts {
  const reason = args["allow-missing-path"];
  return {
    by: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user),
    pathContext: {
      fileExists: existsSync,
      cwd: inv.cwd,
      corpusRoot: dirname(dirname(dbPath)),
    },
    ...(typeof reason === "string" ? { allowMissingPath: reason } : {}),
  };
}

/**
 * Assemble a {@link SetCriterionPatch} from raw CLI args for `lore ac set` — returns
 * `null` when NO field flag was passed at all (D3's zero-flag no-op case), which the
 * caller treats as an argv-decidable exit-2 usage error before ever opening the app
 * (D5a: judged from the command line alone, the document is never opened for this
 * check). `--mode` is deliberately absent here — it is rejected earlier, in `run`,
 * before this function is even called.
 *
 * @remarks `--covers` mirrors `buildCriterionCandidate`'s citty normalization (string
 *   for one occurrence, array for ≥2, undefined for zero) with ONE addition specific
 *   to `set` (D1): a SINGLE occurrence of the empty string (`--covers ""`) is the
 *   documented "clear to `[]`" sentinel, distinct from `add`'s "no `--covers` at all
 *   means no `requirement_refs` field" (there is no prior value to clear on `add`).
 * @remarks `--falsifier-*` reuses {@link buildFalsifierCandidate} VERBATIM — the SAME
 *   assembly function `add` already uses, never a second copy. That function returns
 *   `undefined` only when NONE of the four flags were passed (leaves the patch field
 *   absent, so `AcService.setCriterion` leaves any existing falsifier untouched);
 *   otherwise it shapes WHATEVER subset was passed — a partial set is NOT rejected
 *   here, it is passed through to fail `specAcceptanceCriteriaSchema` naming the
 *   missing field(s), the require-all-four-together contract `SetCriterionPatch.falsifier`'s
 *   own JSDoc documents.
 */
function buildSetPatch(args: Record<string, unknown>): SetCriterionPatch | null {
  const patch: SetCriterionPatch = {};
  if (typeof args.statement === "string") patch.statement = args.statement;
  if (typeof args.oracle === "string") patch.oracle = args.oracle;
  if (typeof args.command === "string") patch.command = args.command;
  // '' clears (null); a non-empty value was already validated by refuseBadTimeoutMs.
  if (typeof args["timeout-ms"] === "string") {
    patch.timeout_ms = args["timeout-ms"] === "" ? null : Number(args["timeout-ms"]);
  }
  if (typeof args.rubric === "string") patch.rubric = args.rubric;
  if (typeof args.note === "string") patch.note = args.note;

  const coversRaw = args.covers;
  if (typeof coversRaw === "string") {
    patch.covers = coversRaw === "" ? [] : [coversRaw];
  } else if (Array.isArray(coversRaw)) {
    patch.covers = coversRaw as string[];
  }

  // §C4 — `--cite` REPLACES the list; a single `--cite ""` clears it (same sentinel as `--covers`).
  const cites = normalizeCiteFlag(args.cite);
  if (cites !== undefined) patch.cites = cites;

  const falsifier = buildFalsifierCandidate(args);
  if (falsifier !== undefined) patch.falsifier = falsifier;

  return Object.keys(patch).length === 0 ? null : patch;
}

// ─── Citations (baseline slice 1 §C4) ────────────────────────────────────────

/**
 * citty yields a string for one `--cite`, an array for >=2, undefined for zero. A lone `""`
 * normalizes to `[]` (the `set` clear sentinel; `add` drops an empty list entirely).
 */
function normalizeCiteFlag(raw: unknown): string[] | undefined {
  if (typeof raw === "string") return raw === "" ? [] : [raw];
  if (Array.isArray(raw)) return (raw as unknown[]).filter((x): x is string => typeof x === "string");
  return undefined;
}

/** One stderr line per dangling / inactive id (stderr: advisory, never pollutes `--json`). */
function printCiteWarnings(io: CliIo, warnings: readonly CiteWarning[]): void {
  for (const w of warnings) {
    io.stderr.write(
      w.kind === "dangling"
        ? `Warning: cited rule ${w.id} does not exist in any baseline leaf (dangling) — stored anyway\n`
        : `Warning: cited rule ${w.id} is deprecated or retired (inactive) — stored anyway\n`,
    );
  }
}

/** Judge `ids` against the baseline and print the warnings; a failed lookup is reported, never swallowed. */
async function reportCiteWarnings(inv: Invocation, ac: AcService, ids: readonly string[], spec: string): Promise<void> {
  if (ids.length === 0) return;
  const checked = await ac.checkCites(ids, spec);
  if (!checked.ok) {
    inv.io.stderr.write(`Warning: could not check cited rules against the baseline: ${formatErrorFor(inv, checked.error)}\n`);
    return;
  }
  printCiteWarnings(inv.io, checked.value);
}

/**
 * `ac add` feedback: warnings for the new AC's cites, else — ONLY when the corpus holds >= 1
 * baseline doc — a one-line hint that the AC cites no rule. A corpus with no baseline prints
 * exactly what it printed before (rollback invariant AC-BLS1-8).
 */
async function reportCiteFeedbackOnAdd(inv: Invocation, 
  ac: AcService,
  spec: string,
  acId: string,
  candidate: unknown,
): Promise<void> {
  const cites = (candidate as { cites?: string[] }).cites ?? [];
  if (cites.length > 0) {
    await reportCiteWarnings(inv, ac, cites, spec);
    return;
  }
  const has = await ac.hasBaselineDocs();
  if (has.ok && has.value) {
    inv.io.stderr.write(
      `Hint: ${acId} cites no baseline rule — attach one with \`lore ac cite ${spec} ${acId} BR-<n>\`\n`,
    );
  }
}

// ─── Demotion Notice (spec-governance-visibility-an-armed-gate-that-vacuously-
//     passes §B2, AC-GV-4) ──────────────────────────────────────────────────

/**
 * Fetches a doc's CURRENT status by id-or-slug for the demotion-notice before/
 * after diff (see {@link reportDemotionIfAny}). Returns `undefined` on ANY
 * lookup failure (unresolvable slug, store error) rather than a guessed status —
 * the caller treats `undefined` as "nothing observed", never as a specific
 * status value, so a failed lookup can never be misread as "was approved" (which
 * would fabricate a demotion notice) or "was draft" (which would suppress a
 * real one).
 */
async function fetchSpecStatus(app: App, specIdOrSlug: string): Promise<string | undefined> {
  const result = await app.corpusService.get(specIdOrSlug);
  return result.ok ? result.value.doc.status : undefined;
}

/**
 * Prints the approved->draft demotion `ac add`/`ac set` may cause, plus a count
 * of descendant task docs whose future `claim` this demotion now blocks
 * (AC-GV-4). On a locked spec `ac add`/`ac set`/`ac rm` are refused before any write
 * (`gate:record-edit`), so this notice only ever appears for an UNLOCKED approved spec
 * (the gate switched off by config). Fires ONLY when the OBSERVED status actually moved from
 * `"approved"` (captured by {@link fetchSpecStatus} BEFORE the write) to
 * `"draft"` (re-read AFTER the write succeeds) — never inferred from which
 * subcommand ran. This is deliberate: `AcService.writeCriteria` only ever
 * passes an explicit `status` patch from `setCriterion` (see its own JSDoc,
 * D2) — `addCriterion`/`removeCriterion` never touch status — so diffing the
 * OBSERVED transition, rather than hardcoding "only `set` can demote", stays
 * correct even if a future write path starts demoting where it does not
 * today, and is the ONLY way to satisfy AC-GV-4's load-bearing negative half
 * (a write that does not demote must print NEITHER line, including a REJECTED
 * write, an add, or a second edit on an already-draft spec).
 *
 * Printed to stderr — never stdout — in BOTH `--json` and human-render mode
 * (mirrors `anchor add`'s established non-blocking-advisory convention,
 * `service/anchor-resolution.ts`): an advisory must never pollute `--json`'s
 * structured payload, and must fire identically regardless of `--json`.
 *
 * @param specIdOrSlug - The SAME spec argument the command was invoked with
 *   (used to re-resolve the doc; correct in the presence of the write itself
 *   having renamed the doc's slug — a slug is not part of what this call edits).
 * @param beforeStatus - The status observed by {@link fetchSpecStatus} BEFORE
 *   the write; `undefined` when that pre-read failed (see its own JSDoc) — the
 *   demotion check short-circuits immediately in that case, since a lookup
 *   failure carries no evidence of a prior "approved" state.
 */
async function reportDemotionIfAny(io: CliIo, 
  app: App,
  specIdOrSlug: string,
  beforeStatus: string | undefined,
): Promise<void> {
  if (beforeStatus !== "approved") return;

  const afterResult = await app.corpusService.get(specIdOrSlug);
  if (!afterResult.ok || afterResult.value.doc.status !== "draft") return;

  const blockedResult = await countBlockedDescendantTasks(app, afterResult.value.doc.id);
  const blastRadius = blockedResult.ok
    ? `${blockedResult.value} descendant task claim(s)`
    : `an unknown number of descendant task claims (blast-radius count unavailable: ${blockedResult.error.code})`;

  io.stderr.write(
    `Notice: this edit demoted spec "${afterResult.value.doc.slug}" from approved to draft ` +
      "(correct lifecycle behavior — an approved spec's governing contract just changed, " +
      `resolveStatusAfterContractEdit in @lore/core). It now blocks ${blastRadius} until the ` +
      "spec is re-approved.\n",
  );
}

/**
 * Counts descendant task docs — reached via the spec's DIRECT child plans
 * (`parent_id`), then {@link isPlanMember} over every task in the corpus —
 * that are NOT already in a terminal status (`getAllowedTransitions` returns
 * `[]` for a terminal doc: `"archived"`/`"deprecated"`, `@lore/core`
 * `schemas.ts`'s `VALID_TRANSITIONS`, never a locally hardcoded literal pair).
 * A terminal task is excluded because it can never be claimed again regardless
 * of the spec's status — counting it would inflate the reported blast radius
 * with a doc the demotion cannot actually affect.
 *
 * Scoped to child-plan tasks only — the SAME scoping `AcService.removeCriterion`
 * already documents on itself ("NOT (yet) extended to ad-hoc-governed tasks...
 * a NAMED follow-up gap"): an `--adhoc` task's membership in a spec's coverage
 * is resolved through a materially more expensive search
 * (`resolveGoverningSpecByAcScope` over every spec in the corpus,
 * `AcService.findAdhocGovernedTasks`) that this CLI-side advisory deliberately
 * does not re-implement — doing so here would duplicate that resolution
 * outside `AcService`, which this task's file anchors forbid editing.
 *
 * @param specId - The spec's resolved doc id (never a slug — {@link
 *   isPlanMember} and the `parent_id` filter both compare against the stored
 *   id, not a human-readable address).
 */
async function countBlockedDescendantTasks(app: App, specId: string): Promise<Result<number, LoreError>> {
  const plansResult = await app.corpusService.listFull({ parent_id: specId, type: "plan" });
  if (!plansResult.ok) return plansResult;
  const plans = plansResult.value.docs;
  if (plans.length === 0) return ok(0);

  const tasksResult = await app.corpusService.listFull({ type: "task" });
  if (!tasksResult.ok) return tasksResult;

  const blocked = tasksResult.value.docs.filter(
    (task) =>
      getAllowedTransitions(task.status, task.type).length > 0 &&
      plans.some((plan) => isPlanMember(task, plan.id)),
  );
  return ok(blocked.length);
}

// ─── Output Helpers ──────────────────────────────────────────────────────────

/**
 * Render a numbered list of acceptance criteria to stdout, with a coverage badge
 * prefix when `coverage` is present (✔ all-pass, ✘ any-fail, · no evidence yet — an
 * attested-pass criterion renders `⚑✔` instead of `✔`, SPEC-039 §2 D8) and a trailing
 * "dangling" note when evidence references undeclared ids. An AC whose ONLY evidence
 * is `inconclusive` (SPEC-061 §Scope D5) renders `⚑?` — distinct from `·` (never
 * verified at all) by design: `·` means no oracle run has ever referenced this AC,
 * `⚑?` means one DID run but couldn't attest a real result (an under/zero-matched
 * test-oracle command). Conflating the two would hide the fact that a verification
 * attempt actually happened and produced no trustworthy signal.
 *
 * spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1 surfacing
 * (AC-FALS-5): a criterion whose derived state is `pass_unfalsified` gets a trailing
 * ` [pass_unfalsified]` line marker (see {@link passUnfalsifiedMarker}) — the badge
 * itself is untouched (stays plain `✔`, see {@link coverageBadge}'s own JSDoc for why).
 */
function renderCriteriaList(io: CliIo, result: AcListResult): void {
  for (const criterion of result.criteria) {
    const badge = result.coverage !== null ? `${coverageBadge(result.coverage, criterion.id)} ` : "";
    const marker = passUnfalsifiedMarker(result.coverage, criterion.id);
    const retiredOracle = retiredOracleMarker(result.coverage, criterion.id);
    const otherCommand = otherCommandMarker(result.coverage, criterion.id);
    const oracleFiles = oracleFileMarkers(result.coverage, criterion.id);
    const supersededNote =
      criterion.superseded_by !== undefined
        ? ` [superseded by ${criterion.superseded_by.spec}:${criterion.superseded_by.ac}: ${criterion.superseded_by.reason}]`
        : "";
    printLine(io.stdout,
      `  ${badge}${criterion.id} — ${criterion.statement} [${describeVerify(criterion.verify)}]${marker}${retiredOracle}${otherCommand}${oracleFiles}${supersededNote}`,
    );
  }
  if (result.dangling.length > 0) {
    printLine(io.stdout, 
      `\nDangling ac_ref (evidence references ids no longer declared): ${result.dangling.join(", ")}`,
    );
  }
}

/**
 * Trailing human-table marker (spec-oracle-tier-falsifiability-a-criterion-never-
 * observed-red M1 surfacing, AC-FALS-5) for a criterion whose derived coverage state
 * is EXACTLY `"pass_unfalsified"` — green, but never once observed able to go red.
 * Absent for every OTHER state, INCLUDING a plain `"pass"` (a criterion that DOES
 * carry falsified evidence) — a reader can tell "this pass carries no falsifiability
 * proof" from "this pass was, at least once, shown able to go red" without decoding
 * the badge's own count numbers. Deliberately a SEPARATE line annotation rather than
 * a change to {@link coverageBadge}'s own returned string: that function's rendering
 * for `pass_unfalsified` is intentionally BYTE-IDENTICAL to plain `pass` (82.0% of
 * this corpus's criteria measure `pass_unfalsified` — a distinct color/glyph on the
 * compact count badge itself would turn the majority of every `lore ac list` run into
 * visual noise the reader learns to ignore; see `commands/ac.ts`'s own module header
 * and the governing spec's §Design). Delegates the state derivation to
 * `deriveAcCoverageState` (`@lore/core`) — the SAME SSOT {@link coverageBadge} reads —
 * never a second derivation.
 */
function passUnfalsifiedMarker(coverage: AcListResult["coverage"], acId: string): string {
  const fact = coverage?.find((f) => f.ac_id === acId);
  if (fact === undefined) return "";
  return deriveAcCoverageState(fact) === "pass_unfalsified" ? " [pass_unfalsified]" : "";
}

/**
 * Trailing human-table marker naming this criterion's RETIRED-ORACLE evidence
 * (spec-the-defect-channel-cannot-be-honestly-maintained-an §M5 read surface,
 * AC-DC-10) — evidence rows recorded before its script `verify.command` was
 * rewritten, which `AcService.setCriterion` records as an `oracle_generation` bump
 * and `computeAcCoverage` reports as `AcCoverageFact.oracle_generation`.
 *
 * The defect this closes is §Measured-not-inferred F3: one criterion carried seven
 * evidence rows spanning `grep -rq MARKER` and `! grep -rq MARKER` — a POLARITY
 * REVERSAL, two of the rows BOTH attested `exit_code: 0` — and every read surface
 * rendered a plain green badge, so nothing distinguished the rows proving the
 * current oracle from the rows proving its opposite. §M5 landed the aggregator half
 * with NO consumer, which left the badge exactly as misleading as before: a fact no
 * renderer reads is not a read surface.
 *
 * RENDERS the split, never re-derives it: the three numbers come straight from
 * `computeAcCoverage`'s own fact. Deliberately a SEPARATE line marker rather than a
 * change to {@link coverageBadge}, for the reason that function's own JSDoc gives —
 * `deriveAcCoverageState`'s seven states and their precedence are pinned by other
 * ACs and by a live-corpus old-vs-new comparison, so §M5 is ADDITIVE reporting
 * rendered BESIDE the verdict, never an eighth state routed through it. The badge on
 * a retired-oracle criterion therefore stays green on purpose; this marker is the
 * whole distinction, which is why AC-DC-10's oracle asserts BOTH on the same line.
 *
 * Unlike {@link passUnfalsifiedMarker}, this marker carries NUMBERS rather than a
 * bare flag: "some evidence predates the current oracle" is not actionable, while
 * "2 of the 3 rows behind this badge do" is — a reader can tell a criterion with one
 * stale row and a fresh attested pass from one whose ENTIRE case rests on a retired
 * oracle. The keys are the fact's OWN field names (`prior_refs`/`current_refs`, and
 * `generation` for its `current`), so the human render and the `--json` payload stay
 * greppable with one vocabulary instead of two.
 *
 * @param coverage - `AcListResult.coverage` (`null` when the spec has no coverage
 *   infrastructure at all — no marker, same as {@link passUnfalsifiedMarker})
 * @param acId - the criterion id whose fact to read
 * @returns ` [retired_oracle_evidence: prior_refs=<n> current_refs=<n> generation=<n>]`
 *   when this criterion has ≥1 prior-generation row; ` [retired_oracle_evidence:
 *   not_computed]` when the fact carries NO split; `""` otherwise (no fact, or every
 *   row was recorded under the current generation)
 */
function retiredOracleMarker(coverage: AcListResult["coverage"], acId: string): string {
  const fact = coverage?.find((f) => f.ac_id === acId);
  if (fact === undefined) return "";
  const split = fact.oracle_generation;
  // reason: branch on PRESENCE, never `?? 0` — `AcCoverageFact.oracle_generation` is
  // optional on the TYPE so hand-built fact literals stay constructible, and that
  // field's own JSDoc forbids coalescing an ABSENT split into a number: doing so
  // would render "no retired-oracle evidence" for a fact that was never measured at
  // all. Unreachable from THIS command (`AcService.listCriteria` always populates the
  // split via `computeAcCoverage`) and therefore unasserted by AC-DC-10's oracle,
  // which drives the CLI; it is still rendered distinctly rather than silently,
  // because a future caller handing `renderCriteriaList` a fact from anywhere else
  // must not read silence as a measured zero.
  if (split === undefined) return " [retired_oracle_evidence: not_computed]";
  if (split.prior_refs === 0) return "";
  return ` [retired_oracle_evidence: prior_refs=${split.prior_refs} current_refs=${split.current_refs} generation=${split.current}]`;
}

/**
 * Trailing human-table marker naming how many evidence rows tagged with this criterion ran a command other
 * than its CURRENT declared one (AC-EI-1, spec-evidence-identity-an-attested-row-counts-only-for-the). Those
 * rows are excluded from the badge's pass/fail counts and from the state; this marker is what keeps them
 * visible instead of silently dropped. RENDERS `AcCoverageFact.other_command` (counted once, in
 * `computeAcCoverage`) — never compares a row's command itself. `--json` carries the same number as the
 * `other_command` key of each `coverage[]` entry (the fact serialized verbatim, see {@link withCoverageState}).
 *
 * @param coverage - `AcListResult.coverage` (`null` when the spec has no coverage infrastructure: no marker)
 * @param acId - the criterion id whose fact to read
 * @returns ` [other_command=<n>]` when n > 0; `""` for no fact, a zero tally, or a fact that never computed one
 */
function otherCommandMarker(coverage: AcListResult["coverage"], acId: string): string {
  const fact = coverage?.find((f) => f.ac_id === acId);
  if (fact === undefined || fact.other_command === undefined || fact.other_command === 0) return "";
  return ` [other_command=${fact.other_command}]`;
}

/**
 * Trailing human-table markers for the missing-oracle check (AC-EI-2): ` [oracle_file_missing: <paths>]` naming
 * every declared oracle path absent on disk, and ` [N segment(s) not checked]` counting command segments the
 * extractor could not classify (AS-17: never read as checked-clean). `--json` carries the same facts as the
 * `oracle_file_missing` / `oracle_paths_unchecked` keys of each `coverage[]` entry.
 *
 * @param coverage - `AcListResult.coverage` (`null`: no markers)
 * @param acId - the criterion id whose fact to read
 * @returns the concatenated markers; `""` when neither applies or the fact never computed them
 */
function oracleFileMarkers(coverage: AcListResult["coverage"], acId: string): string {
  const fact = coverage?.find((f) => f.ac_id === acId);
  if (fact === undefined) return "";
  const missing = fact.oracle_file_missing ?? [];
  const unchecked = fact.oracle_paths_unchecked ?? [];
  return (
    (missing.length > 0 ? ` [oracle_file_missing: ${missing.join(", ")}]` : "") +
    (unchecked.length > 0 ? ` [${unchecked.length} segment(s) not checked]` : "")
  );
}

function describeVerify(verify: AcceptanceCriterion["verify"]): string {
  switch (verify.mode) {
    case "script":
      return `script:${verify.oracle} — ${verify.command}`;
    case "ai":
      return `ai — ${verify.rubric}`;
    case "human":
      return verify.note !== undefined ? `human — ${verify.note}` : "human";
  }
}

/**
 * Coverage badge for one criterion: `✔`/`✘`/`·` per the pre-existing pass/fail/none
 * convention, PLUS an attested annotation (SPEC-039 §2 D8) — an attested-pass criterion
 * renders the `⚑✔` prefix variant instead of plain `✔`, and either badge appends
 * `(n attested)` to its count parenthetical when the corresponding attested count is
 * `> 0`. Rendering ONLY: `fact.attested_pass`/`fact.attested_fail` come straight from
 * `computeAcCoverage` (`@lore/core`) — this function never re-derives "was this attested".
 *
 * **SPEC-070 AC-070-12 (review finding F3)**: the fail/attested_pass/pass PRECEDENCE
 * itself is delegated to `@lore/core`'s `deriveAcCoverageState(fact)` — the ONE shared
 * fail-first ordering `lore feed task-start`'s wiring also consumes. This function
 * renders each resulting state, it never re-decides the ordering.
 *
 * SPEC-061 §Scope D5: when the derived state is `"none"` but `fact.refs` holds at
 * least one `"inconclusive"` entry, renders `⚑?(n)` — n is the inconclusive ref count.
 * `computeAcCoverage` deliberately does NOT surface a dedicated `inconclusive` count on
 * `AcCoverageFact` (D6: "no presentation pre-aggregation… renderers live with each
 * consumer") — this function derives it here from `fact.refs`, the same way it derives
 * every other badge shape. This branch is checked LAST (after fail/pass), so an AC that
 * somehow has both a real pass/fail AND an inconclusive entry still renders its
 * pass/fail badge — an inconclusive result never masks a real attested outcome.
 *
 * spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M1 (AC-WH-1, review
 * gap — assess `01KYHYMQ…`): when the derived state is STILL `"none"` (no pass, no
 * fail, no inconclusive ref), but `fact.refs` holds at least one `"expected-fail"`
 * entry, renders `⚑R(n)` — n is the expected-fail ref count, `R` for the deliberate
 * RED-phase pin this value records (never runner-issued, always self-reported, see
 * `EvidenceRefLite`'s own JSDoc). Checked AFTER the inconclusive branch — an oracle
 * that genuinely ran but couldn't attest a result (inconclusive) is a more urgent
 * signal than a self-declared "not built yet" pin (expected-fail), so a fact somehow
 * carrying both renders `⚑?`, not `⚑R`. Distinct from BOTH `·` (no oracle run has ever
 * referenced this AC at all) and `⚑?` (an oracle DID run but produced no trustworthy
 * signal) — `⚑R` means an oracle ran, failed BY DESIGN, and nobody has since recorded
 * a real pass/fail. Conflating this with `·` would hide a known, intentional RED state
 * behind "never verified"; conflating it with a real `✘` would misreport a deliberate
 * pre-implementation stub as an unexpected failure.
 * `·` is reserved for TRUE zero-evidence (no `fact`, or `fact.refs` entirely empty) —
 * never conflated with "ran but inconclusive" or "ran, expected-fail".
 *
 * spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1 surfacing
 * (AC-FALS-2/5): `deriveAcCoverageState` can now ALSO return `"pass_unfalsified"`
 * (green, but never observed able to go red) — this function renders it with the
 * SAME plain `✔` prefix as `"pass"` (byte-identical count formatting; no distinct
 * color/glyph on the badge itself, see this function's caller {@link
 * renderCriteriaList} and {@link passUnfalsifiedMarker} for the line-level marker
 * that DOES distinguish it in the human table). Before this branch existed, a
 * `pass_unfalsified` fact fell all the way through to the inconclusive/expected-fail
 * checks below and rendered a misleading `·`/`⚑?`/`⚑R` for what is actually a real,
 * unattested pass — the exact bug this task's own file anchors were opened to fix.
 *
 * spec-oracle-tier-falsifiability-a-criterion-never-observed-red M4/M5 surfacing
 * (AC-FALS-19) — the SAME class of bug M1's fix above already named, now repeated
 * for the two states M4/M5 add to `deriveAcCoverageState`'s return union. Both get
 * their OWN explicit, distinct branch — checked BEFORE the inconclusive/expected-fail/
 * `·` residual tail — so neither ever reaches it:
 *   - `"fail_superseded"` renders `✘S(pass/fail[, n attested])` — same shape as the
 *     plain `✘` fail badge (this criterion DOES still have real fail evidence, and
 *     `falsified` counts it forever), with a distinguishing `S` for "superseded":
 *     a strictly-newer runner-attested pass exists, so this is not the SAME kind of
 *     red as an un-superseded `"fail"`. Deliberately visually distinct from BOTH
 *     plain `✘` (this criterion) and `✔`/`⚑✔` (an attested_pass would never route
 *     here — `deriveAcCoverageState` only returns `"fail_superseded"` when
 *     `fact.fail > 0`, which ALWAYS outranks `attested_pass` in the precedence).
 *   - `"not_measured"` renders `⚠(pass/fail)` — this criterion's OWN `falsified`
 *     count is malformed at runtime (M5: `undefined`/`NaN`/negative despite the
 *     type claiming `number`), so this badge deliberately does NOT reuse the plain
 *     `✔` prefix `"pass"`/`"pass_unfalsified"`/`"attested_pass"` share: a real,
 *     measured pass and "the falsifiability dimension itself could not be read"
 *     are different facts, and collapsing them would silently upgrade a data
 *     defect into an ordinary green badge. Also distinct from `⚑?` (inconclusive —
 *     an oracle ran and produced no trustworthy result) and `⚑R` (expected-fail —
 *     a self-declared RED pin): neither of those describes "the pass count is
 *     real but its falsifiability bookkeeping isn't."
 *
 * Exported (unlike this file's other render helpers) so its deterministic formatting is
 * directly vitest-unit-testable without spawning the CLI or a real store (SPEC-039 §6).
 */
export function coverageBadge(coverage: AcListResult["coverage"], acId: string): string {
  const fact = coverage?.find((f) => f.ac_id === acId);
  if (fact === undefined) return "·";

  const state = deriveAcCoverageState(fact);
  // a superseded criterion (D15) is retired: its own badge, never a count of unverified or passing evidence.
  if (state === "superseded") return "⊖";
  if (state === "fail") {
    const attestedNote = fact.attested_fail > 0 ? `, ${fact.attested_fail} attested` : "";
    return `✘(${fact.pass}/${fact.fail}${attestedNote})`;
  }
  if (state === "fail_superseded") {
    const attestedNote = fact.attested_fail > 0 ? `, ${fact.attested_fail} attested` : "";
    return `✘S(${fact.pass}/${fact.fail}${attestedNote})`;
  }
  if (state === "attested_pass" || state === "pass" || state === "pass_unfalsified") {
    const prefix = state === "attested_pass" ? "⚑✔" : "✔";
    const attestedNote = fact.attested_pass > 0 ? `, ${fact.attested_pass} attested` : "";
    return `${prefix}(${fact.pass}/${fact.fail}${attestedNote})`;
  }
  if (state === "not_measured") {
    return `⚠(${fact.pass}/${fact.fail})`;
  }
  const inconclusiveCount = fact.refs.filter((r) => r.result === "inconclusive").length;
  if (inconclusiveCount > 0) {
    return `⚑?(${inconclusiveCount})`;
  }
  const expectedFailCount = fact.refs.filter((r) => r.result === "expected-fail").length;
  if (expectedFailCount > 0) {
    return `⚑R(${expectedFailCount})`;
  }
  return "·";
}

/**
 * Augments each raw {@link AcCoverageFact} in `coverage` with its DERIVED `state`
 * string (spec-oracle-tier-falsifiability-a-criterion-never-observed-red M1
 * surfacing, AC-FALS-4) for the `--json` payload. `falsified` is already a raw
 * field on `AcCoverageFact` (M1, `@lore/core`) — serialized verbatim, untouched
 * here. So is `oracle_generation` (the §M5 current-vs-retired split, AC-DC-10): the
 * spread below is what puts it on the wire, which is deliberate — the fact's own
 * three-field shape IS the structured key a machine consumer reads, so there is no
 * parallel `--json`-only shape to keep in sync with the human marker
 * ({@link retiredOracleMarker}). ⛔ Do not "normalise" it into a flat boolean or a
 * prose string here: AC-DC-10's oracle reads `prior_refs`/`current_refs`/`current`
 * off this payload by name and cross-checks them against the rendered marker's own
 * numbers, so a payload rebuilt field-by-field (dropping the spread) goes red. `state`
 * is NOT stored anywhere on the fact itself; it is always computed
 * via `deriveAcCoverageState` (`@lore/core`), the SAME SSOT {@link coverageBadge}
 * reads — never a second derivation.
 *
 * `coverage: null` (no child plan / no ad-hoc-governed task at all — see {@link
 * AcListResult}'s own JSDoc) passes through UNCHANGED: there is no fact to derive a
 * state FROM, and fabricating one would conflate "declared but no coverage
 * infrastructure exists" with "observed, and never seen able to fail".
 *
 * @param coverage - `AcListResult.coverage`, straight from `AcService.listCriteria`.
 * @returns Each fact plus its `state`, in the SAME order (one entry per declared
 *   criterion, `computeAcCoverage`'s own "never omits a declared criterion"
 *   contract, preserved) — or `null` unchanged.
 */
function withCoverageState(
  coverage: AcListResult["coverage"],
): Array<AcCoverageFact & { state: ReturnType<typeof deriveAcCoverageState> }> | null {
  if (coverage === null) return null;
  return coverage.map((fact) => ({ ...fact, state: deriveAcCoverageState(fact) }));
}
