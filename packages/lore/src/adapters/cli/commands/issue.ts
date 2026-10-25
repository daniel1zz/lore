/**
 * `lore issue adopt <n> [--plan <plan>]` and `lore issue resolve <n> --state <verdict> --reason <text>`
 * (spec-github-owns-issue-report-state-no-mirror-task-work-carries D6, AC-GS-5, AC-GS-6, AC-GS-7).
 *
 * GitHub owns every issue fact; the corpus owns only the work that resolves an issue (a CARRIER: a task or plan
 * naming it in `extra.issues`). So:
 *
 * `adopt` creates exactly ONE draft carrier task for one OPEN listed issue — `task-issue-<repo_id>-<n>`
 * (`-r<k>` after k dead carriers), `extra.issues=[{repo_id,number}]`, a member of `--plan` (must be a live plan,
 * else exit 4) or ad-hoc under the root PRD. GitHub is only read. IDEMPOTENT and RACE-SAFE: an issue that already
 * has a live carrier prints `Already adopted: <slug>` (exit 0, nothing created); two sessions adopting at once
 * compute the same slug and `CorpusService.create`'s `DUPLICATE_SLUG` is the arbiter — the loser prints the same
 * line and exits 0. An issue closed on GitHub, or whose carrier is already archived, is exit 4. The decision lives
 * in `service/issue-adoption.ts`.
 *
 * `resolve` records a NOT-FIXED verdict (`rejected|wontfix|superseded|duplicate`) and writes ONLY to GitHub — one
 * comment (reason + pointer + hidden `<!-- lore-resolve:<state> -->` marker), the close with its `state_reason`, the
 * `resolution:<verdict>` label — and NOTHING to the corpus (no document, version or audit row). `fixed` is not
 * writable here: it is reached only by archiving a carrier, and is refused (exit 4) BEFORE the corpus is opened or
 * GitHub contacted. An issue that a live carrier names, or that is already `fixed`, is refused (exit 4) naming the
 * carrier(s). Re-running is idempotent (the marker); a partial GitHub failure exits with the failing call's own kind
 * (8/9/10/4) after printing which steps landed. The sequence lives in `service/issue-verdict.ts`.
 *
 * Exit codes: 0 success (including 'Already adopted' and an idempotent re-run); 4 validation/refusal; 8 auth
 * required; 9 transport unavailable; 10 rate limited; otherwise the failing call's own `exitCode()`.
 *
 * Side-effect class: IO. `adopt` writes one corpus task; `resolve` writes GitHub only.
 */

import { defineLoreCommand } from "../cli-exit.js";

import { loadLoreApp } from "../loader.js";
import { exitCode, formatErrorFor, resolveActor } from "../utils.js";
import { GhRunner, createNodeGhExecFile } from "../../../service/gh-runner.js";
import { buildCarrierTaskInput, decideAdoption } from "../../../service/issue-adoption.js";
import {
  GhIssueVerdictWriter,
  VERDICT_STATES,
  recordIssueVerdict,
  type VerdictReport,
  type VerdictState,
} from "../../../service/issue-verdict.js";
import { classifyFeedbackUpstream, resolveGithubIssueListing, resolveGithubStatusRows } from "../report-issue-wiring.js";
import { invocationOf } from "../command-invocation.js";
import { buildUnconfiguredUpstreamRemedy, isInvalidated, type DocRecord, type LoreError } from "@lore/core";
import { printLine } from "../output.js";

/** The verdicts `resolve --state` accepts, rendered once for every refusal and the help text. */
const VALID_STATE_LIST = VERDICT_STATES.join(", ");

function isVerdictState(value: string): value is VerdictState {
  return (VERDICT_STATES as readonly string[]).includes(value);
}

/** Trimmed string value of a citty arg, or `""` when absent/not a string. */
function readStringArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value.trim() : "";
}

function validationError(field: string, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, ...(value !== undefined ? { value } : {}) };
}

/** `--state fixed`: never writable here. Names the real way to a fixed issue. Checked before anything is contacted. */
function fixedNotSettableError(): LoreError {
  return validationError(
    "state",
    `'fixed' cannot be recorded with 'lore issue resolve': an issue is fixed only by archiving the work that carries it ` +
      `(create it with 'lore create task --issue <n>' or adopt it with 'lore issue adopt <n>', then archive that work). ` +
      `Valid values here: ${VALID_STATE_LIST}.`,
    "fixed",
  );
}

function invalidStateError(value: string | undefined): LoreError {
  return validationError("state", `Invalid --state '${value ?? ""}'. Valid values: ${VALID_STATE_LIST}.`, value);
}

function missingReasonError(): LoreError {
  return validationError("reason", `--reason is required (non-empty) when resolving an issue as ${VALID_STATE_LIST}.`);
}

function invalidIssueNumberError(raw: string): LoreError {
  return validationError(
    "number",
    `'${raw}' is not a valid GitHub issue number (a positive integer) — pass the number 'lore issues' printed.`,
    raw,
  );
}

function issueNotListedError(issueNumber: number, repo: string, listedCount: number): LoreError {
  return validationError(
    "number",
    `GitHub issue #${issueNumber} was not found in ${repo}'s live listing (${listedCount} issue(s) currently listed) — ` +
      "run 'lore issues' to see what is adoptable, or check the number.",
    issueNumber,
  );
}

/** Shared by both subcommands: the configured upstream must be a GitHub repository. */
function classifyOrRefuse(
  classification: ReturnType<typeof classifyFeedbackUpstream>,
): { readonly ok: true; readonly cfg: Extract<ReturnType<typeof classifyFeedbackUpstream>, { kind: "github" }>["cfg"] } | { readonly ok: false; readonly error: LoreError } {
  if (classification.kind === "unconfigured") return { ok: false, error: buildUnconfiguredUpstreamRemedy() };
  if (classification.kind === "retired") return { ok: false, error: classification.error };
  return { ok: true, cfg: classification.cfg };
}

/** A plan is live when it is a plan, neither archived nor deprecated, and not invalidated at `nowIso`. */
function isLivePlan(doc: DocRecord, nowIso: string): boolean {
  return doc.type === "plan" && doc.status !== "archived" && doc.status !== "deprecated" && !isInvalidated(doc, nowIso);
}

/** Statuses in which a live or finished carrier owns the issue, so a verdict would leave a rejected issue with live work. */
const CARRIER_OWNED_STATUSES: ReadonlySet<string> = new Set(["adopted", "resolving", "fixed (close pending)", "fixed"]);

function carrierOwnedError(issueNumber: number, status: string, carrierSlugs: readonly string[]): LoreError {
  const remedy =
    status === "fixed"
      ? "a fixed issue is not re-judged"
      : status === "fixed (close pending)"
        ? "its work is archived — run 'lore issues --sync' to close it"
        : "retire the work first (deprecate it), then resolve the issue";
  return validationError(
    "number",
    `issue #${issueNumber} is '${status}' — named by ${carrierSlugs.join(", ")}: ${remedy}. Nothing was written.`,
    issueNumber,
  );
}

/** Every task and plan with `extra.issues`, archived ones included — the carrier index `adopt` decides against. */
async function listCarrierDocs(
  corpusService: ReturnType<typeof loadLoreApp>["app"]["corpusService"],
): Promise<{ readonly ok: true; readonly docs: readonly DocRecord[] } | { readonly ok: false; readonly error: LoreError }> {
  const docs: DocRecord[] = [];
  for (const type of ["task", "plan"] as const) {
    const listed = await corpusService.listFull({ type });
    if (!listed.ok) return { ok: false, error: listed.error };
    docs.push(...listed.value.docs.filter((doc) => Array.isArray((doc.extra as Record<string, unknown> | null | undefined)?.["issues"])));
  }
  return { ok: true, docs };
}

function renderVerdictSteps(report: VerdictReport): string[] {
  return [`  comment: ${report.comment}`, `  close: ${report.close}`, `  label: ${report.label}`];
}

export default defineLoreCommand({
  meta: {
    name: "issue",
    description: "Work with GitHub issues (adopt one as a carrier task, resolve one as not fixed)",
  },
  subCommands: {
    adopt: defineLoreCommand({
      meta: {
        name: "adopt",
        description:
          "Create one draft carrier task for one open listed GitHub issue (idempotent: an already-adopted issue reports its carrier, exit 0)",
      },
      args: {
        number: {
          type: "positional",
          description: "GitHub issue number to adopt, as printed by `lore issues`",
          required: true,
        },
        plan: {
          type: "string",
          description: "Live plan (id or slug) the task joins; omitted: an ad-hoc task under the root PRD",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const inv = invocationOf(context);
        const { args } = context;
        const argRecord = args as unknown as Record<string, unknown>;
        const rawNumber = readStringArg(argRecord, "number");
        const issueNumber = Number(rawNumber);
        if (!/^[1-9]\d*$/.test(rawNumber) || !Number.isSafeInteger(issueNumber)) {
          const error = invalidIssueNumberError(rawNumber);
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }
        const planArg = readStringArg(argRecord, "plan");

        const { app, config } = loadLoreApp({ inv });
        try {
          const classified = classifyOrRefuse(classifyFeedbackUpstream(config));
          if (!classified.ok) {
            inv.io.stderr.write(formatErrorFor(inv, classified.error) + "\n");
            return exitCode(classified.error);
          }
          const cfg = classified.cfg;
          const nowIso = new Date().toISOString();

          // reason: the plan is validated BEFORE GitHub is contacted — a dead plan creates nothing and costs no request.
          let planId: string | undefined;
          if (planArg.length > 0) {
            const planResult = await app.corpusService.get(planArg);
            const planDoc = planResult.ok ? planResult.value.doc : undefined;
            if (planDoc === undefined || !isLivePlan(planDoc, nowIso)) {
              const error = validationError(
                "plan",
                planDoc === undefined
                  ? `--plan '${planArg}' does not resolve to a plan in this corpus — nothing was created.`
                  : `--plan '${planDoc.slug}' is not a live plan (${planDoc.type}, ${planDoc.status}) — adopt into a live plan, or omit --plan for an ad-hoc task. Nothing was created.`,
                planArg,
              );
              inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
              return exitCode(error);
            }
            planId = planDoc.id;
          }

          // reason: the carrier index is read BEFORE the GitHub listing, so everything the decision depends on is
          // fixed before the slow network call; two simultaneous adopters then both decide `create` from the same
          // empty index and only the `DUPLICATE_SLUG` arbiter below separates them (the AC-GS-7 race test relies on it).
          const carriers = await listCarrierDocs(app.corpusService);
          if (!carriers.ok) {
            inv.io.stderr.write(formatErrorFor(inv, carriers.error) + "\n");
            return exitCode(carriers.error);
          }

          const listingResult = await resolveGithubIssueListing(inv.io, cfg, inv);
          if (!listingResult.ok) {
            inv.io.stderr.write(formatErrorFor(inv, listingResult.error) + "\n");
            return exitCode(listingResult.error);
          }
          const { issues, repoId } = listingResult.value;
          const issue = issues.find((candidate) => candidate.number === issueNumber);
          if (issue === undefined) {
            const error = issueNotListedError(issueNumber, cfg.repo, issues.length);
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }

          const decision = decideAdoption(issue, repoId, carriers.docs, nowIso);
          if (decision.kind === "closed_on_github") {
            const error = validationError("number", `GitHub issue #${issueNumber} is closed — there is nothing to adopt.`, issueNumber);
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }
          if (decision.kind === "archived_carrier") {
            const error = validationError(
              "number",
              `GitHub issue #${issueNumber} is named by archived work (${decision.slug}) — there is nothing to adopt; run 'lore issues --sync' to close it.`,
              issueNumber,
            );
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }

          const reportAlreadyAdopted = async (id: string): Promise<number> => {
            const existing = await app.corpusService.get(id);
            if (!existing.ok) {
              inv.io.stderr.write(formatErrorFor(inv, existing.error) + "\n");
              return exitCode(existing.error);
            }
            const doc = existing.value.doc;
            if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { doc, already_adopted: true } }, null, 2));
            else printLine(inv.io.stdout, `Already adopted: ${doc.slug}`);
            return 0;
          };

          if (decision.kind === "already_adopted") return await reportAlreadyAdopted(decision.id);

          const by = resolveActor(inv);
          const createResult = await app.corpusService.create(
            buildCarrierTaskInput({ issue, repo: cfg.repo, repoId, slug: decision.slug, ...(planId !== undefined ? { planId } : {}) }),
            { by },
          );
          if (!createResult.ok) {
            // reason: DUPLICATE_SLUG on the deterministic carrier slug IS the race arbiter — a concurrent session
            // created the same carrier between our read and our write. Report that winner and exit 0; any other
            // failure is real and is echoed with its own exit code.
            if (createResult.error.code === "DUPLICATE_SLUG") return await reportAlreadyAdopted(createResult.error.existing_id);
            inv.io.stderr.write(formatErrorFor(inv, createResult.error) + "\n");
            return exitCode(createResult.error);
          }

          const created = createResult.value;
          if (args.json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { doc: created, already_adopted: false } }, null, 2));
          else printLine(inv.io.stdout, `Adopted GitHub issue #${issueNumber} as ${created.slug}.`);
        } finally {
          app.close();
        }
        return 0;
      },
    }),
    resolve: defineLoreCommand({
      meta: {
        name: "resolve",
        description: `Record a not-fixed verdict (${VALID_STATE_LIST}) on a GitHub issue: writes only GitHub (comment, close, label), nothing to the corpus`,
      },
      args: {
        issue: {
          type: "positional",
          description: "GitHub issue number, as printed by `lore issues`",
          required: true,
        },
        state: {
          type: "string",
          description: `Verdict: ${VERDICT_STATES.join(" | ")} ('fixed' is reached only by archiving a carrier)`,
        },
        reason: {
          type: "string",
          description: "Human-readable reason, posted as the comment (required, non-blank)",
        },
        of: {
          type: "string",
          description: "With --state duplicate: the other issue number this one duplicates",
        },
        by: {
          type: "string",
          description: "With --state superseded: the issue number or corpus doc (id or slug) that supersedes it",
        },
        json: {
          type: "boolean",
          description: "Output result as JSON",
        },
      },
      async run(context): Promise<number> {
        const { args } = context;
        const inv = invocationOf(context);
        const argRecord = args as unknown as Record<string, unknown>;
        const state = typeof args.state === "string" ? args.state : undefined;

        // reason: every argv check runs BEFORE the corpus is opened and before any GitHub call — a refused
        // invocation provably contacts nothing (AC-GS-5: the stub log is empty, not even `gh api user`).
        if (state === "fixed") {
          const error = fixedNotSettableError();
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }
        if (state === undefined || !isVerdictState(state)) {
          const error = invalidStateError(state);
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }
        const reason = readStringArg(argRecord, "reason");
        if (reason.length === 0) {
          const error = missingReasonError();
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }
        const rawNumber = readStringArg(argRecord, "issue");
        const issueNumber = Number(rawNumber);
        if (!/^[1-9]\d*$/.test(rawNumber) || !Number.isSafeInteger(issueNumber)) {
          const error = invalidIssueNumberError(rawNumber);
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }
        const ofArg = readStringArg(argRecord, "of");
        const byArg = readStringArg(argRecord, "by");
        if (ofArg.length > 0 && state !== "duplicate") {
          const error = validationError("of", `--of is only valid with --state duplicate, but --state ${state} was requested.`, ofArg);
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }
        if (byArg.length > 0 && state !== "superseded") {
          const error = validationError("by", `--by is only valid with --state superseded, but --state ${state} was requested.`, byArg);
          inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
          return exitCode(error);
        }

        const { app, config } = loadLoreApp({ inv });
        try {
          const classified = classifyOrRefuse(classifyFeedbackUpstream(config));
          if (!classified.ok) {
            inv.io.stderr.write(formatErrorFor(inv, classified.error) + "\n");
            return exitCode(classified.error);
          }
          const cfg = classified.cfg;

          const joined = await resolveGithubStatusRows(inv.io, app.corpusService, cfg, inv);
          if (!joined.ok) {
            inv.io.stderr.write(formatErrorFor(inv, joined.error) + "\n");
            return exitCode(joined.error);
          }
          const { repoId, issues, rows } = joined.value;
          const row = rows.find((candidate) => candidate.issue.number === issueNumber);
          if (row === undefined) {
            const error = issueNotListedError(issueNumber, cfg.repo, issues.length);
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }
          if (CARRIER_OWNED_STATUSES.has(row.status)) {
            const error = carrierOwnedError(issueNumber, row.status, row.carrierSlugs);
            inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
            return exitCode(error);
          }

          // Pointer resolution: validated while nothing has been written.
          let pointerNote: string | undefined;
          const isListedOtherIssue = (n: number): boolean => n !== issueNumber && issues.some((candidate) => candidate.number === n);
          if (ofArg.length > 0) {
            const target = /^[1-9]\d*$/.test(ofArg) ? Number(ofArg) : undefined;
            if (target === undefined || !isListedOtherIssue(target)) {
              const error = validationError("of", `--of '${ofArg}' must be ANOTHER issue number present in ${cfg.repo}'s live listing.`, ofArg);
              inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
              return exitCode(error);
            }
            pointerNote = `Duplicate of #${target}`;
          }
          if (byArg.length > 0) {
            if (/^[1-9]\d*$/.test(byArg)) {
              if (!isListedOtherIssue(Number(byArg))) {
                const error = validationError("by", `--by ${byArg} must be ANOTHER issue number present in ${cfg.repo}'s live listing.`, byArg);
                inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
                return exitCode(error);
              }
              pointerNote = `Superseded by #${byArg}`;
            } else {
              const byDoc = await app.corpusService.get(byArg);
              if (!byDoc.ok) {
                const error = validationError("by", `--by '${byArg}' is neither a listed issue number nor an existing corpus doc (${byDoc.error.code}).`, byArg);
                inv.io.stderr.write(formatErrorFor(inv, error) + "\n");
                return exitCode(error);
              }
              pointerNote = `Superseded by ${byDoc.value.doc.slug} (${byDoc.value.doc.id})`;
            }
          }

          const port = new GhIssueVerdictWriter(new GhRunner({ execFile: createNodeGhExecFile(inv.cwd), env: inv.env }));
          const report = await recordIssueVerdict(
            port,
            {
              ref: { repo: cfg.repo, issueNumber, repo_id: repoId },
              state: row.issue.state,
              stateReason: row.issue.state_reason,
            },
            state,
            reason,
            pointerNote,
          );

          if (args.json) {
            printLine(
              inv.io.stdout,
              JSON.stringify(
                { ok: report.failure === undefined, data: { number: issueNumber, state, comment: report.comment, close: report.close, label: report.label } },
                null,
                2,
              ),
            );
          } else {
            printLine(inv.io.stdout, `Issue #${issueNumber} (${cfg.repo}) as '${state}':`);
            for (const line of renderVerdictSteps(report)) printLine(inv.io.stdout, line);
          }
          if (report.failure !== undefined) {
            inv.io.stderr.write(formatErrorFor(inv, report.failure) + "\n");
            return exitCode(report.failure);
          }
        } finally {
          app.close();
        }
        return 0;
      },
    }),
  },
});
