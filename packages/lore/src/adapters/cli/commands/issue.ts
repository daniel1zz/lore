/**
 * `lore issue resolve <issue> --state rejected|wontfix|superseded|duplicate
 *   --reason <r> [--superseded-by <doc> | --duplicate-of <doc>] [--by <actor>] [--json]`
 *
 * The four writable states and their pointer requirements are CONSUMED from
 * `service/issue-resolution.js`'s SSOT (`EXPLICIT_TERMINAL_RESOLUTIONS` +
 * `reachOfTerminalResolution`), ⛔ never re-listed here — AC-DC-9 asserts one
 * definition site repo-wide.
 *
 * spec-the-defect-channel-cannot-be-honestly-maintained-an §M3 added the two
 * NON-DEROGATORY states. Each REQUIRES its pointer, and the pointer MUST resolve
 * to an existing doc BEFORE anything is written (AC-DC-4): a `superseded` state
 * with a dangling pointer retires a real defect report while recording nothing a
 * reader could follow, which is operationally the same silent trash can as
 * `rejected` — the defect §M3 fixes, not a milder version of the fix. Both
 * states are members of the shared terminal set, so they also RELEASE
 * open-report cap quota (§M1) and stay visible under `lore issues --resolved`.
 *
 * D3 (spec-issue-closure-loop-computed-resolution-agent-reachable) — the ONLY
 * writer of `extra.issue_report.resolution`, an explicit terminal state that
 * WINS over resolves-edge computation (`computeIssueResolution`'s precedence
 * rule 1 — `../../../service/issue-resolution.js`, landed by P1). `--state
 * fixed` is REJECTED unconditionally, BEFORE any doc lookup: the only path to
 * a `fixed` resolution is a `resolves` edge (`lore link --type resolves
 * <fixer> <issue>`) whose source doc reaches `active`/`archived` (D1/D2).
 * This command never writes `fixed` under any input — there is no branch in
 * this file that can produce that value.
 *
 * Read-modify-write over `CorpusService.get`/`set` — no dedicated service
 * method exists for this narrow write (this task's file anchors did not
 * include a service file; see the task doc's "Added after P1 landed"
 * section). Every OTHER `extra` key on the target task (`adhoc`,
 * `file_anchors`, `claim`, `verification_evidence`, and every sibling
 * `issue_report` field — `reporter_project`, `expected`, `actual`, etc.) is
 * preserved untouched: only `issue_report.resolution` is replaced, mirroring
 * the RMW-merge shape `commands/set.ts`'s `--kind` branch and
 * `TaskWorkflowService`'s anchor mutations both use for the same "`set()`
 * replaces `extra` wholesale" footgun (`corpus-service.ts`'s own
 * `findDroppedStructuredExtraField` guard documents the incident this
 * pattern avoids).
 *
 * Exit codes: 0 success; 3 DOC_NOT_FOUND (unknown --issue); 4
 * VALIDATION_ERROR (`--state fixed`, an unrecognized --state value, empty/
 * missing --reason, a target lacking `extra.issue_report`, a REQUIRED pointer
 * that is missing / unresolvable / self-referential, or a pointer flag passed
 * for a state that takes none — an unresolvable pointer is re-typed from
 * DOC_NOT_FOUND so every pointer refusal shares one exit code, see
 * {@link unresolvablePointerError}); 5 STALE_VERSION (concurrent write race on
 * the target task).
 *
 * Source: spec-issue-closure-loop-computed-resolution-agent-reachable §D3,
 *   AC-ICL-3, AC-ICL-4;
 *   spec-the-defect-channel-cannot-be-honestly-maintained-an §M3, AC-DC-4.
 */

import { defineCommand } from "citty";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import {
  hasIssueReport,
  computeIssueResolution,
  EXPLICIT_TERMINAL_RESOLUTIONS,
  reachOfTerminalResolution,
  type ExplicitTerminalResolution,
} from "../../../service/issue-resolution.js";
import type { LoreError } from "@lore/core";

/**
 * The states this command may persist — CONSUMED from
 * `service/issue-resolution.js`'s SSOT, ⛔ never re-listed here
 * (spec-the-defect-channel-cannot-be-honestly-maintained-an §M1/§M3, AC-DC-9).
 * `"fixed"`/`"closed"` are structurally absent from that subset because their
 * declared route is not `issue-resolve`; see {@link fixedNotSettableError}.
 */
const VALID_STATE_LIST = [...EXPLICIT_TERMINAL_RESOLUTIONS].join(", ");

/** True iff `value` is a state `lore issue resolve` may write. */
function isExplicitTerminalState(value: string): value is ExplicitTerminalResolution {
  return (EXPLICIT_TERMINAL_RESOLUTIONS as ReadonlySet<string>).has(value);
}

/** One `--state`-to-pointer-flag binding, derived from the reach table's declared pointer requirement. */
interface PointerFlagBinding {
  readonly state: ExplicitTerminalResolution;
  /** The user-facing flag, e.g. `--superseded-by`. */
  readonly flag: string;
  /** The citty args key (the flag minus its leading dashes). */
  readonly argName: string;
  /** Where the resolved doc id is persisted inside `extra.issue_report.resolution`. */
  readonly extraKey: string;
  /** Noun phrase for what the pointer must name — read from the SSOT, never re-worded per refusal. */
  readonly names: string;
}

/**
 * Every state that REQUIRES a pointer, derived from
 * `reachOfTerminalResolution` — so adding a third pointer-carrying state needs
 * no edit here beyond the `args` declaration below.
 *
 * ⛔ Coupling worth knowing about: citty needs its flags declared STATICALLY in
 * `args`, so the two flag names appear literally there as well. They cannot
 * drift SILENTLY — a flag present in the table but missing from `args` makes the
 * required pointer unsuppliable, i.e. every attempt at that state fails loud,
 * and `tests/integration/cli/issue-resolve-pointer-required.bun.test.ts` drives
 * both flags end-to-end.
 */
const POINTER_FLAG_BINDINGS: readonly PointerFlagBinding[] = [...EXPLICIT_TERMINAL_RESOLUTIONS].flatMap((state) => {
  const pointer = reachOfTerminalResolution(state).pointer;
  if (pointer === null) return [];
  return [
    {
      state,
      flag: pointer.flag,
      argName: pointer.flag.replace(/^-+/, ""),
      extraKey: pointer.extra_key,
      names: pointer.names,
    },
  ];
});

/** Trimmed string value of a citty arg, or `""` when absent/not a string. */
function readStringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * `code` plus `message` when the variant carries one — only 4 of the 16
 * `LoreError` variants do. Same name and shape as
 * `service/issue-report-service.ts::describeLoreErrorWithCode`; both quote a
 * failure's CLASSIFICATION into a refusal a caller has to act on.
 */
function describeLoreErrorWithCode(error: LoreError): string {
  return "message" in error ? `${error.code}: ${error.message}` : error.code;
}

/**
 * AC-ICL-3 — the unconditional `--state fixed` rejection. Names `lore link`
 * and `resolves` verbatim so a caller can copy-paste the real fix; checked in
 * `run()` BEFORE any app load or doc resolution, so it fires even when
 * `<issue>` does not exist or is not a task at all — "fixed" is never a
 * writable value here, full stop.
 */
function fixedNotSettableError(): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "state",
    message:
      "'fixed' is a COMPUTED resolution, never hand-set. The only path to 'fixed' is " +
      "`lore link --type resolves <fixer-doc> <issue>` (once the fixer doc reaches " +
      "active/archived). Use --state rejected or --state wontfix here instead.",
    value: "fixed",
  };
}

/** Any `--state` value that is neither a legal explicit state nor the specially-handled `"fixed"`. */
function invalidStateError(value: string | undefined): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "state",
    message:
      `Invalid --state '${value ?? ""}'. Valid values: ${VALID_STATE_LIST} ` +
      "('fixed' is computed via `lore link --type resolves`, never passed here).",
    value,
  };
}

/** `--reason` is required and must be non-empty when writing an explicit terminal state. */
function missingReasonError(): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "reason",
    message: `--reason is required (non-empty) when resolving an issue as ${VALID_STATE_LIST}.`,
  };
}

/**
 * §M3 — a NON-DEROGATORY terminal state was requested with no pointer. Refused
 * BEFORE the app is even loaded, so nothing is written: without the pointer the
 * state would carry no more information than `rejected`, which is the defect
 * §M3 exists to fix rather than a milder form of the fix.
 */
function missingPointerError(binding: PointerFlagBinding): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: binding.argName,
    message:
      `--state ${binding.state} REQUIRES ${binding.flag} <doc>, naming ${binding.names} — ` +
      "without it the state records nothing a reader could act on, and is indistinguishable " +
      "from --state rejected. Pass an existing doc id or slug.",
  };
}

/** A pointer flag was supplied for a state that takes no pointer — a contradiction, never silently dropped. */
function pointerForWrongStateError(binding: PointerFlagBinding, state: ExplicitTerminalResolution): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: binding.argName,
    message:
      `${binding.flag} is only valid with --state ${binding.state}, but --state ${state} was requested. ` +
      "Drop the flag, or resolve with the state it belongs to.",
    value: state,
  };
}

/**
 * The pointer named a doc that does not resolve. Deliberately re-typed to
 * `VALIDATION_ERROR` (exit 4) rather than propagating the underlying
 * `DOC_NOT_FOUND` (exit 3): the fact being reported is "this FLAG's value is
 * invalid", not "the document you asked to read is missing" — and AC-DC-4 pins
 * the exit code so a caller's error handling can treat every pointer refusal
 * identically. The underlying failure is quoted, never swallowed.
 */
function unresolvablePointerError(binding: PointerFlagBinding, value: string, cause: LoreError): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: binding.argName,
    message:
      `${binding.flag} '${value}' does not resolve to an existing doc in this corpus ` +
      `(${describeLoreErrorWithCode(cause)}) — nothing was written. A ${binding.state} resolution must ` +
      `name ${binding.names}, otherwise it is a silent trash can.`,
    value,
  };
}

/** A report pointing at ITSELF carries no information — the same emptiness the required pointer exists to prevent. */
function selfPointerError(binding: PointerFlagBinding, slug: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: binding.argName,
    message:
      `${binding.flag} points at the report being resolved ('${slug}') — it must name ` +
      `${binding.names}, which cannot be the report itself.`,
    value: slug,
  };
}

/** The target resolved fine but does not carry `extra.issue_report` — not an issue task. */
function notAnIssueError(slug: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "issue",
    message:
      `Document "${slug}" does not carry extra.issue_report — only a filed issue report ` +
      "(created via the upstream `lore report-issue` consumer flow) can be resolved.",
    value: slug,
  };
}

export default defineCommand({
  meta: {
    name: "issue",
    description: "Manage filed issue reports (resolve)",
  },
  subCommands: {
    resolve: defineCommand({
      meta: {
        name: "resolve",
        description:
          "Record an explicit terminal resolution (rejected/wontfix) on a filed issue report",
      },
      args: {
        issue: {
          type: "positional",
          description: "Issue task document ID or slug",
          required: true,
        },
        state: {
          type: "string",
          description: `Explicit terminal state: ${[...EXPLICIT_TERMINAL_RESOLUTIONS].join(" | ")} ('fixed' is computed, never accepted here)`,
        },
        reason: {
          type: "string",
          description: "Human-readable reason (required, non-empty)",
        },
        // reason: citty resolves flags from a STATIC args map, so these two
        // names are declared literally even though their requiredness,
        // storage key and error messages all derive from
        // `POINTER_FLAG_BINDINGS`. See that const's own comment.
        "superseded-by": {
          type: "string",
          description: "REQUIRED with --state superseded: the doc (id or slug) that supersedes this report",
        },
        "duplicate-of": {
          type: "string",
          description: "REQUIRED with --state duplicate: the doc (id or slug) this report duplicates",
        },
        by: {
          type: "string",
          description: "Actor identity; defaults to $LORE_ACTOR env var, then OS username",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run({ args }) {
        const state = typeof args.state === "string" ? args.state : undefined;

        // AC-ICL-3 — checked BEFORE loadLoreApp()/any doc resolution: writes
        // NOTHING, regardless of whether <issue> even exists.
        if (state === "fixed") {
          const error = fixedNotSettableError();
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        if (state === undefined || !isExplicitTerminalState(state)) {
          const error = invalidStateError(state);
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        const reason = typeof args.reason === "string" ? args.reason.trim() : "";
        if (reason.length === 0) {
          const error = missingReasonError();
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        // §M3 pointer contract, checked BEFORE loadLoreApp() — both halves are
        // pure argv arithmetic, so a refusal here provably writes zero bytes.
        const argRecord = args as unknown as Record<string, unknown>;
        const strayPointer = POINTER_FLAG_BINDINGS.find(
          (binding) => binding.state !== state && readStringArg(argRecord, binding.argName).length > 0,
        );
        if (strayPointer !== undefined) {
          const error = pointerForWrongStateError(strayPointer, state);
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        const requiredPointer = POINTER_FLAG_BINDINGS.find((binding) => binding.state === state);
        const pointerValue = requiredPointer === undefined ? "" : readStringArg(argRecord, requiredPointer.argName);
        if (requiredPointer !== undefined && pointerValue.length === 0) {
          const error = missingPointerError(requiredPointer);
          process.stderr.write(formatError(error) + "\n");
          process.exitCode = exitCode(error);
          return;
        }

        const { app } = loadLoreApp();
        try {
          const issueId = args.issue as string;
          const getResult = await app.corpusService.get(issueId);
          if (!getResult.ok) {
            process.stderr.write(formatError(getResult.error) + "\n");
            process.exitCode = exitCode(getResult.error);
            return;
          }
          const issueDoc = getResult.value.doc;

          if (!hasIssueReport(issueDoc.extra)) {
            const error = notAnIssueError(issueDoc.slug);
            process.stderr.write(formatError(error) + "\n");
            process.exitCode = exitCode(error);
            return;
          }

          // §M3 — resolve the REQUIRED pointer against the live corpus BEFORE
          // any write. A pointer that names nothing would make `superseded`
          // indistinguishable from a silent trash can, so this refusal must
          // happen while zero bytes have been written.
          let resolvedPointer: Record<string, string> = {};
          if (requiredPointer !== undefined) {
            const pointerResult = await app.corpusService.get(pointerValue);
            if (!pointerResult.ok) {
              const error = unresolvablePointerError(requiredPointer, pointerValue, pointerResult.error);
              process.stderr.write(formatError(error) + "\n");
              process.exitCode = exitCode(error);
              return;
            }
            const pointerDoc = pointerResult.value.doc;
            if (pointerDoc.id === issueDoc.id) {
              const error = selfPointerError(requiredPointer, issueDoc.slug);
              process.stderr.write(formatError(error) + "\n");
              process.exitCode = exitCode(error);
              return;
            }
            // reason: the RESOLVED id is persisted, never the id-or-slug the
            // caller typed — a slug is editable (`CorpusService.set` accepts a
            // slug patch), so storing one would let a rename silently dangle
            // the pointer this state's whole meaning rests on.
            resolvedPointer = { [requiredPointer.extraKey]: pointerDoc.id };
          }

          const by = resolveActor(typeof args.by === "string" ? args.by : undefined);
          const nowIso = new Date().toISOString();
          const existingIssueReport = issueDoc.extra["issue_report"] as Record<string, unknown>;
          // reason: RMW merge — spread the FULL existing extra first so every
          // sibling key (claim/verification_evidence/file_anchors/adhoc, and
          // every OTHER issue_report field) survives; only issue_report.resolution
          // is replaced. CorpusService.set()'s docPatch.extra REPLACES extra
          // wholesale (no service-side merge), so this merge must happen here.
          const newExtra: Record<string, unknown> = {
            ...issueDoc.extra,
            issue_report: {
              ...existingIssueReport,
              // reason: `resolution` is REPLACED wholesale (never merged into the
              // previous one) so re-resolving from `superseded` to `duplicate`
              // cannot leave a stale `superseded_by` beside the new state — a
              // lingering pointer would assert a supersession that no longer holds.
              resolution: { state, reason, resolved_at: nowIso, resolved_by: by, ...resolvedPointer },
            },
          };

          const setResult = await app.corpusService.set(issueId, { extra: newExtra }, { by });
          if (!setResult.ok) {
            process.stderr.write(formatError(setResult.error) + "\n");
            process.exitCode = exitCode(setResult.error);
            return;
          }

          const updated = setResult.value;

          // reason: demonstrates D2's precedence rule end-to-end (the explicit
          // state we just wrote wins over any resolves-edge computation) using
          // the SAME navigation.related data get() already fetched above — no
          // second store round trip. `related` mixes in/out non-parent links
          // without exposing direction; a `resolves`-typed entry on an issue
          // task is, in every write-time-validated shape (D1b), an INBOUND edge
          // from a fixer doc, so treating each match's `id`/`status` as a
          // resolvesInEdges/sourceDocs pair is correct for every reachable
          // corpus state (an issue task cannot itself be the "from" side of a
          // resolves edge unless ITS target also carries extra.issue_report —
          // a degenerate chain this command does not need to special-case).
          const resolvesInEdges = getResult.value.navigation.related.filter(
            (r) => r.link_type === "resolves",
          );
          const computed = computeIssueResolution(
            updated,
            resolvesInEdges.map((r) => ({ from_id: r.id })),
            resolvesInEdges.map((r) => ({ id: r.id, status: r.status })),
          );

          if (args.json) {
            console.log(
              JSON.stringify({ ok: true, data: { doc: updated, resolution: computed } }, null, 2),
            );
          } else {
            const pointerNote =
              requiredPointer === undefined ? "" : ` ${requiredPointer.flag} ${resolvedPointer[requiredPointer.extraKey]}`;
            console.log(
              `Resolved ${updated.slug} as '${state}'${pointerNote} (${reason}) — resolution: ${computed}`,
            );
          }
        } finally {
          app.close();
        }
      },
    }),
  },
});
