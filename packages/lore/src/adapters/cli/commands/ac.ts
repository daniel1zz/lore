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
 *   rm   <spec> <id> [--force]     Remove a criterion (exit 4 if evidence still
 *                                   references it, unless --force).
 *   set  <spec> <id> [--statement <s>] [--oracle <o>] [--command <c>] [--rubric <r>]
 *        [--note <n>] [--covers <req-id>] [--allow-missing-path <reason>]
 *                                   In-place edit of ONE declared criterion
 *                                   (spec-lore-ac-set-in-place-edit-of-a-declared-
 *                                   acceptance D1-D6). `id`/`mode` are NOT editable —
 *                                   `--mode` exits 2 naming the rm+add path (D1). At
 *                                   least one other flag is required — zero flags
 *                                   exits 2 (D3), never a silent no-op. `--statement`/
 *                                   `--covers` are mode-agnostic; `--oracle`/`--command`
 *                                   (script) / `--rubric` (ai) / `--note` (human) exit 4
 *                                   against a criterion of a different mode (D5). On an
 *                                   `approved` spec this demotes it to `draft`, exactly
 *                                   like a content/title edit (D2). `--covers` REPLACES
 *                                   `requirement_refs` wholesale across repeated flags in
 *                                   one call; `--covers ""` clears it to `[]`.
 *                                   `--allow-missing-path` is the SAME D8 escape `add`
 *                                   documents above — re-checked against the (possibly
 *                                   untouched) resulting command on every `set`, per
 *                                   `AcService.setCriterion`'s own JSDoc.
 *                                   NOTE: `--falsifier-*` (documented on `add` above) is
 *                                   deliberately NOT wired here — `SetCriterionPatch`/
 *                                   `AcService.setCriterion` (`service/ac-service.ts`) sit
 *                                   outside this task's file anchors, so changing a
 *                                   falsifier on an already-declared AC currently requires
 *                                   `ac rm --force` then `ac add --falsifier-*` again. A
 *                                   NAMED follow-up gap, not an oversight — reported
 *                                   explicitly (task-build-the-attested-red-runner-a-
 *                                   declared-falsifier-applied's own final report).
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
 *   on `add` — declared-falsifier authoring)
 */

import { defineCommand } from "citty";
import { existsSync } from "fs";
import { dirname } from "path";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { deriveAcCoverageState, getAllowedTransitions, ok } from "@lore/core";
import type { AcceptanceCriterion, AcCoverageFact, LoreError, Result } from "@lore/core";
import type { AcService, AcListResult, DeclarePathOpts, SetCriterionPatch } from "../../../service/ac-service.js";
import type { App } from "../../../app.js";
// reason: `isPlanMember` is SHARED, store-less predicate infrastructure (its own
// module header: "not a service... exactly the shared infrastructure that pattern
// exists to permit"), not the sibling `ac-service.ts` this task's file anchors
// forbid editing — see {@link countBlockedDescendantTasks}.
import { isPlanMember } from "../../../service/plan-membership.js";

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

export default defineCommand({
  meta: {
    name: "ac",
    description: "Manage structured acceptance criteria on a spec (add / list / rm / set)",
  },
  subCommands: {
    add: defineCommand({
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
            "script mode only: the EXACT exit code (never \"non-zero\") this mutation is declared to " +
            "produce when --command runs against the mutated file.",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app, dbPath } = loadLoreApp();
        try {
          const beforeStatus = await fetchSpecStatus(app, args.spec as string);

          const criterion = buildCriterionCandidate(args);
          const result = await requireAcService(app).addCriterion(
            args.spec as string,
            criterion,
            buildDeclarePathOpts(args, dbPath),
          );

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          await reportDemotionIfAny(app, args.spec as string, beforeStatus);

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { criteria: result.value } }, null, 2));
            return;
          }

          console.log(`Added acceptance criterion "${args.id as string}" to spec ${args.spec as string}`);
          renderCriteriaList({ criteria: result.value, coverage: null, dangling: [] });
        } finally {
          app.close();
        }
      },
    }),

    list: defineCommand({
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
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const result = await requireAcService(app).listCriteria(args.spec as string);

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(
              JSON.stringify(
                { ok: true, data: { ...result.value, coverage: withCoverageState(result.value.coverage) } },
                null,
                2,
              ),
            );
            return;
          }

          if (result.value.criteria.length === 0) {
            console.log("No acceptance criteria declared on this spec.");
            return;
          }

          renderCriteriaList(result.value);
        } finally {
          app.close();
        }
      },
    }),

    rm: defineCommand({
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
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const result = await requireAcService(app).removeCriterion(args.spec as string, args.id as string, {
            force: args.force === true,
          });

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { criteria: result.value } }, null, 2));
            return;
          }

          console.log(`Removed acceptance criterion "${args.id as string}" from spec ${args.spec as string}`);
          if (result.value.length > 0) {
            renderCriteriaList({ criteria: result.value, coverage: null, dangling: [] });
          } else {
            console.log("No acceptance criteria remaining.");
          }
        } finally {
          app.close();
        }
      },
    }),

    set: defineCommand({
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
        "allow-missing-path": {
          type: "string",
          description:
            "D8 escape: REQUIRED non-empty reason to declare a script-mode command naming a test path not yet " +
            "on disk. Empty/absent reason is refused when the (possibly untouched) resulting command is missing.",
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
      async run({ args }) {
        // D1/D5a — argv-decidable, judged BEFORE the app/store is even opened:
        // `--mode` names a rule the command line alone already violates.
        if (typeof args.mode === "string") {
          process.stderr.write(
            "Error: --mode cannot be changed via `lore ac set` — mode reinterprets every historical " +
              "evidence row attributed to this id. Use `lore ac rm --force <spec> <id>` then " +
              "`lore ac add <spec> <id> --mode <new-mode> ...` instead.\n",
          );
          process.exitCode = 2;
          return;
        }

        const patch = buildSetPatch(args);
        if (patch === null) {
          process.stderr.write(
            "Error: lore ac set requires at least one field to change: --statement, --oracle, --command, --rubric, --note, --covers\n",
          );
          process.exitCode = 2;
          return;
        }

        const { app, dbPath } = loadLoreApp();
        try {
          const beforeStatus = await fetchSpecStatus(app, args.spec as string);

          const result = await requireAcService(app).setCriterion(
            args.spec as string,
            args.id as string,
            patch,
            buildDeclarePathOpts(args, dbPath),
          );

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

          await reportDemotionIfAny(app, args.spec as string, beforeStatus);

          if (args.json) {
            console.log(JSON.stringify({ ok: true, data: { criteria: result.value } }, null, 2));
            return;
          }

          console.log(`Updated acceptance criterion "${args.id as string}" on spec ${args.spec as string}`);
          renderCriteriaList({ criteria: result.value, coverage: null, dangling: [] });
        } finally {
          app.close();
        }
      },
    }),
  },
});

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

  return {
    id: args.id as string,
    statement: args.statement as string,
    verify,
    ...(requirement_refs !== undefined ? { requirement_refs } : {}),
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
 * @returns `undefined` when NONE of the four flags were passed (the common
 *   case — a script-mode AC with no falsifier declared); a shaped candidate
 *   object otherwise, keyed by `--falsifier-path`'s presence (the flag every
 *   other one is documented as "required together with").
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
 */
function buildDeclarePathOpts(args: Record<string, unknown>, dbPath: string): DeclarePathOpts {
  const reason = args["allow-missing-path"];
  return {
    pathContext: {
      fileExists: existsSync,
      cwd: process.cwd(),
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
 */
function buildSetPatch(args: Record<string, unknown>): SetCriterionPatch | null {
  const patch: SetCriterionPatch = {};
  if (typeof args.statement === "string") patch.statement = args.statement;
  if (typeof args.oracle === "string") patch.oracle = args.oracle;
  if (typeof args.command === "string") patch.command = args.command;
  if (typeof args.rubric === "string") patch.rubric = args.rubric;
  if (typeof args.note === "string") patch.note = args.note;

  const coversRaw = args.covers;
  if (typeof coversRaw === "string") {
    patch.covers = coversRaw === "" ? [] : [coversRaw];
  } else if (Array.isArray(coversRaw)) {
    patch.covers = coversRaw as string[];
  }

  return Object.keys(patch).length === 0 ? null : patch;
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
 * (AC-GV-4). Fires ONLY when the OBSERVED status actually moved from
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
async function reportDemotionIfAny(
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

  process.stderr.write(
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
function renderCriteriaList(result: AcListResult): void {
  for (const criterion of result.criteria) {
    const badge = result.coverage !== null ? `${coverageBadge(result.coverage, criterion.id)} ` : "";
    const marker = passUnfalsifiedMarker(result.coverage, criterion.id);
    console.log(`  ${badge}${criterion.id} — ${criterion.statement} [${describeVerify(criterion.verify)}]${marker}`);
  }
  if (result.dangling.length > 0) {
    console.log(
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
 * here. `state` is NOT stored anywhere on the fact itself; it is always computed
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
