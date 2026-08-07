/**
 * lore ac — manage structured acceptance criteria on a spec document.
 *
 * Subcommands:
 *   add  <spec> <id> --statement <s> --mode <script|ai|human>
 *          script: --oracle <tsc|test|lint|build|e2e|other> --command <cmd>
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
 *   rm   <spec> <id> [--force]     Remove a criterion (exit 4 if evidence still
 *                                   references it, unless --force).
 *   set  <spec> <id> [--statement <s>] [--oracle <o>] [--command <c>] [--rubric <r>]
 *        [--note <n>] [--covers <req-id>]
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
 *       a mode-inconsistent flag on set naming the flag and the actual mode)
 *   5 = STALE_VERSION
 *
 * Source: SPEC-038 §4, §6 AC-ACODE-7; SPEC-039 §2 D8 (attested coverage annotation);
 *   SPEC-061 §Scope D5 (inconclusive badge); SPEC-070 AC-070-12 (shared fail-first
 *   precedence via @lore/core's deriveAcCoverageState); spec-workflow-hardening-
 *   evidence-red-vocabulary-claim-worktree §M1 AC-WH-1 (expected-fail badge);
 *   spec-lore-ac-set-in-place-edit-of-a-declared-acceptance D1-D6 (`set` subcommand)
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import { deriveAcCoverageState } from "@lore/core";
import type { AcceptanceCriterion, AcCoverageFact } from "@lore/core";
import type { AcService, AcListResult, SetCriterionPatch } from "../../../service/ac-service.js";
import type { App } from "../../../app.js";

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
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const { app } = loadLoreApp();
        try {
          const criterion = buildCriterionCandidate(args);
          const result = await requireAcService(app).addCriterion(args.spec as string, criterion);

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

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

        const { app } = loadLoreApp();
        try {
          const result = await requireAcService(app).setCriterion(args.spec as string, args.id as string, patch);

          if (!result.ok) {
            process.stderr.write(formatError(result.error) + "\n");
            process.exitCode = exitCode(result.error);
            return;
          }

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
    verify = {
      mode: "script",
      ...(typeof args.oracle === "string" ? { oracle: args.oracle } : {}),
      ...(typeof args.command === "string" ? { command: args.command } : {}),
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
  if (state === "attested_pass" || state === "pass" || state === "pass_unfalsified") {
    const prefix = state === "attested_pass" ? "⚑✔" : "✔";
    const attestedNote = fact.attested_pass > 0 ? `, ${fact.attested_pass} attested` : "";
    return `${prefix}(${fact.pass}/${fact.fail}${attestedNote})`;
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
