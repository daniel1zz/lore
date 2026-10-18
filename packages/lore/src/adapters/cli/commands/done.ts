/**
 * lore done <task> [--override-attestation "<reason>" |
 *   --override-attestation-cite <n>] [--declare-no-new-tests "<reason>"] —
 * evidence-validated, atomic-from-the-caller's-perspective lifecycle walk to
 * `"archived"` for a task OR phase
 * document (spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3,
 * AC-WH-3).
 *
 * Closes the gap the EXECUTE loop (claim → evidence → release) leaves: a released
 * task stays `draft` forever, which readiness's `blocks`-link computation never
 * treats as "met" (only `archived`/`deprecated` are terminal) — sessions were forced
 * into hand-rolled `lore set --status` choreography (three writes) to unblock a
 * dependent task. `lore done` is the ONE command replacing that choreography.
 *
 * Refuses (VALIDATION_ERROR, exit 4) when the target holds no RUNNER-ATTESTED
 * `result: "pass"` evidence entry — i.e. no entry with BOTH `result: "pass"` AND
 * an `attestation` (adr-lore-done-requires-a-runner-attested-pass-the-sixth-
 * false: a self-reported-only pass, the ONLY shape any `lore evidence` write can
 * produce, is no longer sufficient to archive) — OR a FRESH claim is held by a
 * DIFFERENT actor than the invoking identity (`"expected-fail"`/`"fail"`/`"inconclusive"` never
 * count as a pass either way — see `TaskWorkflowService.done`'s own JSDoc). An
 * already-terminal target is an idempotent NO-OP (exit 0, unchanged doc) — a
 * second `lore done` after a first succeeded never fails, evaluated BEFORE any
 * evidence check.
 *
 * `--override-attestation "<reason>"` is the audited escape hatch
 * (adr-lore-done-requires-a-runner-attested-pass-the-sixth-false) for
 * verification `lore verify` structurally cannot perform (`--oracle manual`
 * browser/visual checks; any oracle with no script-mode AC to bind to) — mirrors
 * `lore approve --override-judgment`/`lore outline exempt --reason`'s shape: an
 * explicit flag carrying a MANDATORY free-text reason, written verbatim to every
 * lifecycle step's audit entry (never silent, never defaulted, no env-var form).
 * A blank/whitespace-only reason is a CLI USAGE ERROR (exit 2) — checked HERE,
 * before `app` is even loaded, mirroring `commands/set.ts`'s `--refine`
 * non-empty-prompt precedent and `commands/outline.ts`'s `exempt --reason` guard
 * — never forwarded to the service as an empty string (the service re-checks it
 * too, defensively, for any OTHER caller that builds `DoneOpts` directly; see
 * `TaskWorkflowService.done`'s own JSDoc). The predicate itself lives ENTIRELY in
 * `TaskWorkflowService`/`PhaseWorkflowService` (never here) — this command only
 * resolves args, forwards the (validated) reason, and renders the result.
 *
 * `--override-attestation-cite <n>` (task-lore-done-override-attestation-
 * demands-fresh-prose-that) is an ADDED, ALTERNATIVE way to satisfy the SAME
 * attestation floor `--override-attestation` bypasses — CITING an existing
 * `extra.verification_evidence` row (1-based `n`) instead of retyping its
 * measurement as fresh prose. Free-text `--override-attestation` keeps
 * working completely unchanged; this flag is mutually exclusive with it (both
 * given at once → CLI USAGE ERROR, exit 2, before `app` loads). Unlike the
 * free-text flag, this ONE lives entirely in this adapter file
 * ({@link resolveEvidenceCitation}, above) rather than the service layer — it
 * reads the target's ALREADY-STORED evidence via `corpusService.get` (the same
 * resolve-then-validate shape `commands/scope.ts` uses) and REFUSES
 * (VALIDATION_ERROR, exit 4, archiving nothing) when the cited row cannot bear
 * the weight of a bypass: zero evidence rows, an out-of-range index, a
 * `result` other than `"pass"`, or an absent/blank `output_tail`. A syntax-
 * invalid index (not a bare non-negative integer) is instead a CLI USAGE
 * ERROR (exit 2), checked before `app` loads, mirroring the blank-reason
 * checks above — range/content validity needs the corpus, syntax does not. On
 * success, the row's identifying fields (`oracle`/`command`/`result`/
 * `recorded_at`/`recorded_by`/`capture_source`) are snapshotted verbatim into
 * a composed string, which is then forwarded as the EXACT SAME
 * `DoneOpts.overrideReason` the free-text flag populates — so the audit trail,
 * the "ignored when an attested pass already satisfies the floor" behaviour,
 * and every downstream consumer stay byte-identical between the two paths.
 * `capture_source` is rendered EXACTLY as stored (including a literal
 * `"unspecified"` for a pre-capture_source legacy row) — never inferred,
 * never described as "attested": a cited row is, by construction, never a
 * runner-attested pass (one would already satisfy the floor outright), so
 * this citation can never launder a self-report into something that reads as
 * attested.
 *
 * MCP: NOT plumbed. `lore_done` does not exist on the MCP tool surface at all
 * (verified 2026-08-01: `grep -c "lore_done" packages/lore/src/adapters/mcp/
 * tools.ts` → 0; `grep -rln "\.done(" packages/lore/src/adapters` → this file
 * only) — there is no MCP call site to plumb the escape hatch onto. Should a
 * future `lore_done` MCP tool ever be added, it inherits the attestation floor
 * automatically (service-layer predicate) and would need its OWN explicit
 * `overrideReason` tool argument, same audited-and-mandatory shape as here.
 *
 * `--declare-no-new-tests "<reason>"` is the SAME audited-escape shape for a
 * DIFFERENT, INDEPENDENT floor (task-a-non-empty-output-tail-can-be-hand-
 * authored-prose-and-the): the red-first discipline inverted to opt-OUT. A
 * task that has DECLARED `extra.ac_scope` — keyed on the KEY'S PRESENCE, so the
 * explicit-empty `--ac-scope ""` form arms it too (task-the-ac-scope-re-keying-
 * left-the-red-first-floor-unarmed) — with zero `"expected-fail"`/`"fail"`
 * evidence rows and no `extra.red_first: true` opt-in cannot archive without
 * this mandatory free-text justification for why no new RED test was recorded
 * — written verbatim to every lifecycle step's audit entry as
 * `details.no_new_tests_reason` (+ `details.no_new_tests_declared: true`). A
 * blank/whitespace-only reason is a CLI USAGE ERROR (exit 2), checked HERE the
 * same way `--override-attestation` is, before `app` is even loaded; the
 * service re-checks it too, defensively. IGNORED entirely when this floor does
 * not apply (no `ac_scope` KEY at all, an opted-in red_first claim, or a genuine
 * red evidence row already satisfies it) — never a blanket "always audit"
 * switch, and never a substitute for `--override-attestation` (the two escape
 * hatches bypass two DIFFERENT floors and may both be supplied on the same
 * call if both floors are unmet).
 *
 * ⛔ NAMED `--declare-no-new-tests`, NOT `--no-new-tests` — citty's underlying
 * arg parser (mri) treats any flag whose OWN name starts with the literal
 * prefix `no-` as a BOOLEAN NEGATION of the remainder (`--no-foo` -> `{foo:
 * false}`), discarding a following value entirely regardless of whether `foo`
 * is even a declared flag. `--no-new-tests "<reason>"` was measured to parse
 * as `{"new-tests": false}` with the reason silently dropped — this flag's
 * final name deliberately avoids the `no-` prefix so its value always survives
 * parsing.
 *
 * PHASE DOCS ARE UNAFFECTED BY ANY ESCAPE HATCH: `PhaseWorkflowService.done`
 * (a separate file, out of this feature's declared scope) still gates on the
 * pre-existing `result: "pass"` floor only — it never grew an attestation
 * requirement or a no-new-tests floor, so it has nothing to override.
 * `--override-attestation`/`--override-attestation-cite`/`--declare-no-new-
 * tests` all resolve into the SAME `doneOpts.overrideReason`/`noNewTestsReason`
 * object used for the phase-fallback retry below (see Target-type dispatch)
 * purely because that object is shared; the phase path silently ignores both
 * fields (`PhaseWorkflowService.done`'s own `DoneOpts` consumption never reads
 * `overrideReason`/`noNewTestsReason`) — never any effect, never an error
 * either, regardless of which of the two mutually-exclusive flags produced the
 * `overrideReason` value.
 *
 * Target-type dispatch (mirrors `commands/release.ts`/`commands/evidence.ts`'s SPEC-056
 * pattern exactly): `TaskWorkflowService.done` is ALWAYS tried FIRST, UNCHANGED — a
 * successful call, a DOC_NOT_FOUND, or any other error stays byte-identical. ONLY when
 * that call fails with its own `VALIDATION_ERROR {field: "type", value: "phase"}` does
 * this adapter retry via `PhaseWorkflowService.done`.
 *
 * Actor identity: the invoking run, via utils.ts::resolveActor — this command takes no `--by`.
 *
 * Exit codes: 0 = success (incl. idempotent no-op), 2 = CLI usage error
 *   (`--override-attestation`/`--declare-no-new-tests` given with a blank/
 *   whitespace-only reason; `--override-attestation-cite` given a non-
 *   positive-integer value; or both `--override-attestation` and
 *   `--override-attestation-cite` given together), 3 = DOC_NOT_FOUND, 4 =
 *   VALIDATION_ERROR (not a task/phase / no runner-attested passing evidence
 *   and no override / a declared ac_scope with no red_first opt-in, no red
 *   evidence row, and no `--declare-no-new-tests` reason / fresh foreign claim
 *   / illegal lifecycle step / `--override-attestation-cite`'s row is out of
 *   range, not `result:pass`, or has an empty `output_tail`), 5 =
 *   STALE_VERSION.
 *
 * Source: spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M3, AC-WH-3;
 *   adr-lore-done-requires-a-runner-attested-pass-the-sixth-false /
 *   task-lore-done-accepts-an-unattested-self-reported-pass-as;
 *   task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the (--declare-no-new-tests);
 *   task-lore-done-override-attestation-demands-fresh-prose-that (--override-attestation-cite)
 */

import { defineCommand } from "citty";
import { err, extractEvidence, ok } from "@lore/core";
import type { DocRecord, EvidenceEntry, LoreError, Result } from "@lore/core";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, resolveActor } from "../utils.js";
import { requirePhaseWorkflowService } from "../phase-wiring.js";
import { resolveCallerSession } from "../caller-session.js";
import { formatDoneMessage, formatLastTaskAdvisory } from "../done-render.js";
import { emitIssueCloseItems } from "../issue-close-output.js";
import { invocationOf } from "../command-invocation.js";

/**
 * Resolves `--override-attestation-cite <n>`'s citation into a self-contained
 * override-reason string — the cheaper alternative to retyping a measurement
 * already recorded as an `extra.verification_evidence` row
 * (task-lore-done-override-attestation-demands-fresh-prose-that).
 *
 * `n` is a 1-BASED index into the task's evidence array. Rows carry no id
 * field, so a stable reference has to be either the index or `recorded_at`;
 * the index wins here because `verification_evidence` is append-only and NEVER
 * truncated to make room — `TaskWorkflowService.addEvidence` refuses a 51st
 * row outright rather than evicting the oldest — so a given index keeps
 * pointing at the same row for the entire life of the task, and it needs no
 * `lore get --json` round-trip through timestamp strings to use. `recorded_at`
 * was the rejected alternative: two rows can legitimately share a
 * millisecond-resolution timestamp, and matching by index is also exactly
 * what a human reading `lore get <task> --json`'s array already does mentally
 * (1-based here only to keep "row 1" out of off-by-one territory).
 *
 * Refuses (never archives anything) when the cited row cannot bear the weight
 * of an attestation-floor bypass: the task holds zero evidence rows, the
 * index is out of the valid `1..rows.length` range, the row's `result` is not
 * `"pass"`, or the row's `output_tail` is absent/blank (the same "an empty
 * tail is not coverage" rule this repo applies everywhere else evidence is
 * judged — task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the).
 * Each refusal is a `VALIDATION_ERROR` naming the row and the exact reason —
 * never a silent fallback to "no citation."
 *
 * On success, SNAPSHOTS the row's identifying fields (`oracle`/`command`/
 * `result`/`recorded_at`/`recorded_by`/`capture_source`) into the returned
 * string verbatim — not just the index. That string becomes
 * `DoneOpts.overrideReason`, which `writeTaskStatus` persists onto every
 * lifecycle step's own audit `details` as `override_reason`, so the archived
 * record stays self-contained for an auditor who will never go back to
 * re-read the task. `capture_source` renders EXACTLY as stored, including the
 * literal `"unspecified"` marker for a pre-capture_source legacy row — never
 * inferred, never upgraded to imply attestation. This function never reads or
 * emits the word "attested"/`attestation`: a cited row is, by construction,
 * never a runner-attested pass (if one existed on this task, `_doneImpl`
 * would already satisfy the floor without ever reaching `overrideReason`), so
 * there is nothing here that could launder a self-report into something that
 * reads as attested — the snapshot states the row's OWN `capture_source`
 * plainly instead.
 *
 * @param app - Composition root (only `corpusService.get` is used)
 * @param idOrSlug - Same target `lore done` itself resolves
 * @param index - The 1-based row index from `--override-attestation-cite`
 * @returns The composed reason string, or the `VALIDATION_ERROR`/`DOC_NOT_FOUND`
 *   naming exactly why the citation was refused
 */
async function resolveEvidenceCitation(
  app: ReturnType<typeof loadLoreApp>["app"],
  idOrSlug: string,
  index: number,
): Promise<Result<string, LoreError>> {
  const docResult = await app.corpusService.get(idOrSlug);
  if (!docResult.ok) return docResult;
  const target: DocRecord = docResult.value.doc;
  const rows: EvidenceEntry[] = extractEvidence(target);

  if (rows.length === 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "override-attestation-cite",
      message:
        `Task "${target.slug}" holds zero extra.verification_evidence rows — there is ` +
        "nothing --override-attestation-cite can point at. Use " +
        '--override-attestation "<reason>" instead.',
      value: index,
    });
  }
  if (index < 1 || index > rows.length) {
    return err({
      code: "VALIDATION_ERROR",
      field: "override-attestation-cite",
      message:
        `--override-attestation-cite ${index} is out of range — task "${target.slug}" holds ` +
        `${rows.length} verification_evidence row(s) (valid 1-based indices: 1..${rows.length}).`,
      value: index,
    });
  }

  const row = rows[index - 1] as EvidenceEntry;
  if (row.result !== "pass") {
    return err({
      code: "VALIDATION_ERROR",
      field: "override-attestation-cite",
      message:
        `Cited verification_evidence[${index}] on task "${target.slug}" has result ` +
        `"${row.result}", not "pass" — --override-attestation-cite refuses to bypass the ` +
        "attestation floor with a row that never passed.",
      value: { index, result: row.result },
    });
  }
  const tailIsEmpty = row.output_tail === undefined || row.output_tail.trim().length === 0;
  if (tailIsEmpty) {
    return err({
      code: "VALIDATION_ERROR",
      field: "override-attestation-cite",
      message:
        `Cited verification_evidence[${index}] on task "${target.slug}" has an empty ` +
        "output_tail — an empty tail does not count as evidence anywhere else in this repo, " +
        "so --override-attestation-cite refuses it too.",
      value: { index },
    });
  }

  return ok(
    "lore done --override-attestation-cite: snapshot of extra.verification_evidence" +
      `[${index}] (1-based) on "${target.slug}" — oracle=${row.oracle}; command=${row.command}; ` +
      `result=${row.result}; recorded_at=${row.recorded_at}; recorded_by=${row.recorded_by}; ` +
      `capture_source=${row.capture_source ?? "unspecified"}.`,
  );
}

export default defineCommand({
  meta: {
    name: "done",
    description:
      "Evidence-validated lifecycle walk to archived — validates passing evidence + no fresh foreign claim",
  },
  args: {
    task: {
      type: "positional",
      description: "Task (or phase) document ID or slug",
      required: true,
    },
    "override-attestation": {
      type: "string",
      description:
        "Audited escape hatch (adr-lore-done-requires-a-runner-attested-pass-the-sixth-false) — " +
        "archive without a runner-attested result:pass evidence row, for verification `lore verify` " +
        "structurally cannot perform. MANDATORY free-text reason as the flag's own value, written " +
        "verbatim to the audit trail. A blank/whitespace-only value is a usage error (exit 2). " +
        "Mutually exclusive with --override-attestation-cite.",
    },
    "override-attestation-cite": {
      type: "string",
      description:
        "Alternative to --override-attestation (task-lore-done-override-attestation-demands-" +
        "fresh-prose-that): cites an EXISTING extra.verification_evidence row by its 1-based " +
        "index instead of retyping its measurement as fresh prose. The cited row MUST have " +
        "result:pass and a non-empty output_tail, or the call refuses (VALIDATION_ERROR, exit 4) " +
        "and archives nothing. The row's identifying fields are snapshotted verbatim into the " +
        "audit trail. Mutually exclusive with --override-attestation.",
    },
    "declare-no-new-tests": {
      type: "string",
      description:
        "Audited escape hatch (task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the) — " +
        "archive a task declaring extra.ac_scope (an EXPLICITLY EMPTY declaration, i.e. --ac-scope " +
        '"", counts too) with no red (expected-fail/fail) evidence row and ' +
        "no extra.red_first opt-in. MANDATORY free-text reason as the flag's own value, written " +
        "verbatim to the audit trail. A blank/whitespace-only value is a usage error (exit 2). " +
        "NOT named --no-new-tests: citty's mri parser treats a --no-<x> flag as a boolean " +
        "negation, silently discarding a following value.",
    },
    json: {
      type: "boolean",
      description: "Output result as JSON",
    },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    // reason: CLI usage-error validation (exit 2) — checked BEFORE loadLoreApp(), same
    // shape as commands/set.ts's `--refine` non-empty-prompt guard and commands/
    // outline.ts's `exempt --reason` guard. A PRESENT-but-blank value is rejected;
    // an ABSENT flag is legal (no override requested) and falls through untouched.
    const overrideAttestationRaw = args["override-attestation"];
    const hasOverrideAttestation = typeof overrideAttestationRaw === "string";
    if (hasOverrideAttestation && overrideAttestationRaw.trim() === "") {
      process.stderr.write(
        "Error: --override-attestation requires a non-empty, non-whitespace reason.\n",
      );
      process.exit(2);
    }

    // reason: task-lore-done-override-attestation-demands-fresh-prose-that —
    // the citation alternative to the free-text reason immediately above. Both
    // flags satisfy the SAME attestation floor, so accepting both at once would
    // be ambiguous about which snapshot wins — refused as a CLI usage error
    // (exit 2), same shape/timing as the blank-reason checks (before
    // loadLoreApp() is even called, so a malformed flag never touches the
    // corpus). Syntax only here (a bare positive-integer string); the SEMANTIC
    // checks (range / result / output_tail) need the task's own stored evidence
    // and run after loadLoreApp() below, in resolveEvidenceCitation.
    const overrideAttestationCiteRaw = args["override-attestation-cite"];
    const hasOverrideAttestationCite = typeof overrideAttestationCiteRaw === "string";
    if (hasOverrideAttestation && hasOverrideAttestationCite) {
      process.stderr.write(
        "Error: --override-attestation and --override-attestation-cite are mutually exclusive " +
          "— pass a free-text reason OR cite an existing evidence row, not both.\n",
      );
      process.exit(2);
    }
    let overrideAttestationCiteIndex: number | undefined;
    if (hasOverrideAttestationCite) {
      const trimmedCite = overrideAttestationCiteRaw.trim();
      if (!/^[0-9]+$/.test(trimmedCite)) {
        process.stderr.write(
          "Error: --override-attestation-cite requires a positive 1-based integer row index, " +
            `got "${overrideAttestationCiteRaw}".\n`,
        );
        process.exit(2);
      }
      overrideAttestationCiteIndex = Number(trimmedCite);
    }

    // reason: task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the —
    // the SAME CLI usage-error shape as --override-attestation immediately
    // above, for the independent no-new-tests floor's own escape hatch.
    const noNewTestsRaw = args["declare-no-new-tests"];
    const hasNoNewTests = typeof noNewTestsRaw === "string";
    if (hasNoNewTests && noNewTestsRaw.trim() === "") {
      process.stderr.write("Error: --declare-no-new-tests requires a non-empty, non-whitespace reason.\n");
      process.exit(2);
    }

    const { app } = loadLoreApp({ inv });
    try {
      // reason: the citation's SEMANTIC checks need the task's stored evidence,
      // so they run here (after loadLoreApp) rather than in the syntax block
      // above. A refusal here formats+exits exactly like every other error
      // path below (formatError/exitCode over a hand-built LoreError, mirroring
      // commands/scope.ts's resolve-then-validate precedent) — archiving
      // nothing, never reaching taskWorkflowService.done at all.
      let citedOverrideReason: string | undefined;
      if (overrideAttestationCiteIndex !== undefined) {
        const citeResult = await resolveEvidenceCitation(
          app,
          args.task as string,
          overrideAttestationCiteIndex,
        );
        if (!citeResult.ok) {
          process.stderr.write(formatError(citeResult.error) + "\n");
          process.exitCode = exitCode(citeResult.error);
          return;
        }
        citedOverrideReason = citeResult.value;
      }

      // reason: BR-1056 — the holder check compares RUNS, so the caller's run is the invocation's VERIFIED run
      // (unregistered -> null + one warning), resolved once and passed EXPLICITLY like `claim`/`release` do.
      const verifiedIdentity = await app.verifiedInvocationIdentity?.();
      if (verifiedIdentity !== undefined && !verifiedIdentity.ok) {
        process.stderr.write(formatError(verifiedIdentity.error) + "\n");
        process.exitCode = exitCode(verifiedIdentity.error);
        return;
      }
      const by = resolveActor(undefined, inv.env, inv.cwd);
      // reason: the worktree-removal test's "mine" side (D2) — raw session id, unknown stays absent.
      const callerSession = resolveCallerSession(undefined, inv.env);
      const doneOpts = {
        by,
        harnessRun: verifiedIdentity?.value?.harnessRun ?? null,
        source: app.callerSurface,
        ...(callerSession !== undefined ? { callerSession } : {}),
        ...(hasOverrideAttestation ? { overrideReason: overrideAttestationRaw } : {}),
        ...(citedOverrideReason !== undefined ? { overrideReason: citedOverrideReason } : {}),
        ...(hasNoNewTests ? { noNewTestsReason: noNewTestsRaw } : {}),
      };

      // reason: SPEC-056-style target-type dispatch (see module header) — try
      // taskWorkflowService FIRST, UNCHANGED; retry via phaseWorkflowService ONLY on
      // its own {field: "type", value: "phase"} rejection.
      let result = await app.taskWorkflowService.done(args.task as string, doneOpts);
      if (
        !result.ok &&
        result.error.code === "VALIDATION_ERROR" &&
        result.error.field === "type" &&
        result.error.value === "phase"
      ) {
        result = await requirePhaseWorkflowService(app).done(args.task as string, doneOpts);
      }

      if (!result.ok) {
        process.stderr.write(formatError(result.error) + "\n");
        process.exitCode = exitCode(result.error);
        return;
      }

      // reason: DD-2 last-task advisory (spec-plan-closure-must-be-loud-terminality-
      // divergence-silent, AC-CLOSURE-3) — stderr-only side channel, printed in BOTH
      // --json and human-readable modes, never altering stdout's normal success
      // output. No once-per-process guard (unlike resolveActorWithIdentitySource's
      // precedent) — this fires at most once per plan, ever.
      const lastTaskAdvisory = formatLastTaskAdvisory(result.value);
      if (lastTaskAdvisory !== undefined) {
        process.stderr.write(lastTaskAdvisory + "\n");
      }

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              data: {
                doc: result.value.task,
                already_done: result.value.already_done,
                transitions: result.value.transitions,
                ...(result.value.worktree_outcomes !== undefined ? { worktree_outcomes: result.value.worktree_outcomes } : {}),
                ...(result.value.issue_close !== undefined ? { issue_close: result.value.issue_close } : {}),
              },
            },
            null,
            2,
          ),
        );
        emitIssueCloseItems(result.value.issue_close, { json: true });
        return;
      }

      console.log(formatDoneMessage(result.value));
      emitIssueCloseItems(result.value.issue_close, { json: false });
    } finally {
      app.close();
    }
  },
});
