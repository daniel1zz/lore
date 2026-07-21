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
 *                                   (never verified at all).
 *   rm   <spec> <id> [--force]     Remove a criterion (exit 4 if evidence still
 *                                   references it, unless --force).
 *
 * All subcommands accept --json for machine-readable output (SPEC-003 §4).
 * Exit codes per SPEC-003 §5 (via utils.ts::exitCode):
 *   0 = success
 *   3 = DOC_NOT_FOUND (spec not found)
 *   4 = VALIDATION_ERROR (malformed criterion, duplicate id, 50-entry cap, unknown
 *       id on rm, evidence blocking rm without --force)
 *   5 = STALE_VERSION
 *
 * Source: SPEC-038 §4, §6 AC-ACODE-7; SPEC-039 §2 D8 (attested coverage annotation);
 *   SPEC-061 §Scope D5 (inconclusive badge)
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError } from "../utils.js";
import type { AcceptanceCriterion } from "@lore/core";
import type { AcService, AcListResult } from "../../../service/ac-service.js";
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
    description: "Manage structured acceptance criteria on a spec (add / list / rm)",
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
            console.log(JSON.stringify({ ok: true, data: result.value }, null, 2));
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
 */
function renderCriteriaList(result: AcListResult): void {
  for (const criterion of result.criteria) {
    const badge = result.coverage !== null ? `${coverageBadge(result.coverage, criterion.id)} ` : "";
    console.log(`  ${badge}${criterion.id} — ${criterion.statement} [${describeVerify(criterion.verify)}]`);
  }
  if (result.dangling.length > 0) {
    console.log(
      `\nDangling ac_ref (evidence references ids no longer declared): ${result.dangling.join(", ")}`,
    );
  }
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
 * SPEC-061 §Scope D5: when neither `pass` nor `fail` is > 0 but `fact.refs` holds at
 * least one `"inconclusive"` entry, renders `⚑?(n)` — n is the inconclusive ref count.
 * `computeAcCoverage` deliberately does NOT surface a dedicated `inconclusive` count on
 * `AcCoverageFact` (D6: "no presentation pre-aggregation… renderers live with each
 * consumer") — this function derives it here from `fact.refs`, the same way it derives
 * every other badge shape. This branch is checked LAST (after fail/pass), so an AC that
 * somehow has both a real pass/fail AND an inconclusive entry still renders its
 * pass/fail badge — an inconclusive result never masks a real attested outcome.
 * `·` is reserved for TRUE zero-evidence (no `fact`, or `fact.refs` entirely empty) —
 * never conflated with "ran but inconclusive".
 *
 * Exported (unlike this file's other render helpers) so its deterministic formatting is
 * directly vitest-unit-testable without spawning the CLI or a real store (SPEC-039 §6).
 */
export function coverageBadge(coverage: AcListResult["coverage"], acId: string): string {
  const fact = coverage?.find((f) => f.ac_id === acId);
  if (fact === undefined) return "·";
  if (fact.fail > 0) {
    const attestedNote = fact.attested_fail > 0 ? `, ${fact.attested_fail} attested` : "";
    return `✘(${fact.pass}/${fact.fail}${attestedNote})`;
  }
  if (fact.pass > 0) {
    const prefix = fact.attested_pass > 0 ? "⚑✔" : "✔";
    const attestedNote = fact.attested_pass > 0 ? `, ${fact.attested_pass} attested` : "";
    return `${prefix}(${fact.pass}/${fact.fail}${attestedNote})`;
  }
  const inconclusiveCount = fact.refs.filter((r) => r.result === "inconclusive").length;
  if (inconclusiveCount > 0) {
    return `⚑?(${inconclusiveCount})`;
  }
  return "·";
}
