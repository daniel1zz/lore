/**
 * lore autonomy — the governed autonomy threshold record (AC-AU-9, ADR D8).
 *
 *   lore autonomy show [--json]                       the live class table, regenerable patterns and integrity
 *   lore autonomy set <class> [--tier --threshold --prior --recoverability --judge]
 *   lore autonomy regenerable add|rm <pattern>        the worktree-remove regenerable set
 *   lore autonomy verify-pushed-heads [--record]      the local decision log must reproduce every head already
 *                                                     pushed (hooks/pre-push; --record notes the current head)
 *
 * Tightening applies at once with an auto write record. Loosening is class `governance-loosen` (human-always): the
 * command opens a pending decision and exits 4 printing its id; after the human answers it with `lore decide <id> --accept`, re-running
 * the SAME command applies it. A record whose content no longer matches its decision-log chain is refused here and
 * makes every class escalate (see `lore status`, `lore pending`).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-9.
 */
import { applyClassEdit, type ClassEdit, type GovernedThresholds, type Invocation, type LoreError, type Result, RECOVERABILITY_SCORE } from "@lore/core";

import { defineLoreCommand } from "../cli-exit.js";
import { DecisionService } from "../../../service/decision-service.js";
import type { GovernedAutonomy, ProposeOutcome } from "../../../service/autonomy-threshold-service.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { recordPushedHead, pushedHeadsPath, readPushedHeads, verifyPushedHeads } from "../autonomy-heads.js";
import { loadLoreApp } from "../loader.js";
import { invocationOf } from "../command-invocation.js";
import { exitCode, formatError, formatErrorFor, formatTable } from "../utils.js";
import type { ExitReport } from "../cli-exit.js";

/** Exit code when a loosening was escalated to the human: 4, the spec's escalate exit (AC-AU-7) and the gate-denial convention. */
const NEEDS_HUMAN_EXIT = 4;

interface Opened {
  readonly service: DecisionService;
  readonly dbPath: string;
}

/** Opens the corpus store for one verb; `fn` runs with the service, the store and app are closed after. */
async function withDecisions(inv: Invocation, fn: (opened: Opened) => Promise<number>): Promise<ExitReport> {
  const { app, dbPath } = loadLoreApp({ inv });
  let store: SQLiteStore | undefined;
  try {
    const identity = await app.verifiedInvocationIdentity?.();
    if (identity !== undefined && !identity.ok) {
      inv.io.stderr.write(`${formatErrorFor(inv, identity.error)}\n`);
      return exitCode(identity.error);
    }
    store = new SQLiteStore(dbPath);
    return await fn({ service: new DecisionService({ store, executorRun: identity?.value?.harnessRun ?? null }), dbPath });
  } finally {
    store?.close();
    app.close();
  }
}

function fail(inv: Invocation, error: LoreError): number {
  inv.io.stderr.write(`${formatErrorFor(inv, error)}\n`);
  return exitCode(error);
}

function renderGoverned(governed: GovernedAutonomy): string {
  const rows = Object.entries(governed.record.classes).map(([id, c]) =>
    c.tier === "human-always"
      ? [id, "human-always", "-", "-", "-", String(c.usesJudge)]
      : [id, "normal", String(c.threshold), String(c.priorConfidence), c.declaredRecoverability, String(c.usesJudge)],
  );
  const table = formatTable(["class", "tier", "threshold", "prior C", "declared R", "judge"], rows);
  const integrity = governed.integrity;
  const line =
    integrity.state === "broken"
      ? `Integrity: BROKEN (${integrity.reason}) — ${integrity.detail}. Every class escalates until the human accepts the threshold-integrity decision (lore pending).`
      : integrity.state === "unseeded"
        ? "Integrity: unseeded (the code seed is live; run any lore autonomy verb to record it)"
        : integrity.state === "confirmed"
          ? `Integrity: confirmed by the human (decision record ${integrity.record_id})`
          : `Integrity: intact (write record ${integrity.write_record_id})`;
  return `${table}\n\nworktree-remove regenerable set:\n${governed.regenerablePatterns.map((p) => `  ${p}`).join("\n")}\n\n${line}`;
}

function renderOutcome(outcome: ProposeOutcome): { text: string; code: number } {
  switch (outcome.kind) {
    case "noop":
      return { text: "No change: the record already holds these values.", code: 0 };
    case "applied":
      return {
        text: `Applied (write record ${outcome.write_record_id}${outcome.approved_by_record === null ? ", tightening" : `, approved by human decision record ${outcome.approved_by_record}`}):\n${[...outcome.change.tightened, ...outcome.change.loosened].map((l) => `  ${l}`).join("\n")}`,
        code: 0,
      };
    case "escalated":
      return {
        text: `Not applied: this change LOOSENS governance (class governance-loosen, human-always):\n${outcome.change.loosened.map((l) => `  ${l}`).join("\n")}\nPending decision ${outcome.pending_id} created. A human answers it with: lore decide ${outcome.pending_id} --accept (or --reject); re-run this same command afterwards.`,
        code: NEEDS_HUMAN_EXIT,
      };
    case "refused":
      return {
        text: `Refused: the threshold record fails its integrity check (${outcome.integrity.reason}: ${outcome.integrity.detail}). Resolve the threshold-integrity decision first (lore pending, lore decide).`,
        code: 1,
      };
  }
}

async function propose(inv: Invocation, opened: Opened, build: (current: GovernedThresholds) => { ok: true; record: GovernedThresholds } | { ok: false; message: string }): Promise<number> {
  const thresholds = opened.service.thresholds();
  const seeded = await thresholds.ensureSeeded();
  if (!seeded.ok) return fail(inv, seeded.error);
  const next = build(seeded.value.record);
  if (!next.ok) {
    inv.io.stderr.write(`Error: ${next.message}\n`);
    return 4;
  }
  const outcome: Result<ProposeOutcome, LoreError> = await thresholds.propose(next.record, opened.service);
  if (!outcome.ok) return fail(inv, outcome.error);
  const rendered = renderOutcome(outcome.value);
  (rendered.code === 0 ? inv.io.stdout : inv.io.stderr).write(`${rendered.text}\n`);
  return rendered.code;
}

function numberArg(name: string, value: unknown): number | string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : `--${name} needs a number, got "${String(value)}"`;
}

const show = defineLoreCommand({
  meta: { name: "show", description: "Show the governed class table, regenerable patterns and the record's integrity" },
  args: { json: { type: "boolean", description: "Output as JSON" } },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    return await withDecisions(inv, async ({ service }) => {
      const seeded = await service.thresholds().ensureSeeded();
      if (!seeded.ok) return fail(inv, seeded.error);
      inv.io.stdout.write(`${args.json === true ? JSON.stringify({ ok: true, data: { record: seeded.value.record, regenerable: seeded.value.regenerablePatterns, integrity: seeded.value.integrity } }, null, 2) : renderGoverned(seeded.value)}\n`);
      return 0;
    });
  },
});

const set = defineLoreCommand({
  meta: { name: "set", description: "Edit one class's governed values; tightening applies, loosening escalates to the human" },
  args: {
    class: { type: "positional", description: "Operation class id (see `lore autonomy show`)", required: true },
    tier: { type: "string", description: "normal | human-always" },
    threshold: { type: "string", description: "Auto threshold in [0,1] (normal classes)" },
    prior: { type: "string", description: "Prior confidence C in [0,1] (normal classes)" },
    recoverability: { type: "string", description: `Declared recoverability: ${Object.keys(RECOVERABILITY_SCORE).join(" | ")}` },
    judge: { type: "string", description: "true | false — whether the class asks for an LLM review" },
  },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    const edit: { -readonly [K in keyof ClassEdit]: ClassEdit[K] } = {};
    const problems: string[] = [];
    if (args.tier !== undefined) {
      if (args.tier === "normal" || args.tier === "human-always") edit.tier = args.tier;
      else problems.push(`--tier must be normal or human-always, got "${String(args.tier)}"`);
    }
    for (const [flag, key] of [["threshold", "threshold"], ["prior", "priorConfidence"]] as const) {
      const raw = args[flag];
      if (raw === undefined) continue;
      const value = numberArg(flag, raw);
      if (typeof value === "number") edit[key] = value;
      else problems.push(value);
    }
    if (args.recoverability !== undefined) {
      if (Object.hasOwn(RECOVERABILITY_SCORE, String(args.recoverability))) edit.declaredRecoverability = args.recoverability as keyof typeof RECOVERABILITY_SCORE;
      else problems.push(`--recoverability must be one of ${Object.keys(RECOVERABILITY_SCORE).join(", ")}`);
    }
    if (args.judge !== undefined) {
      if (args.judge === "true" || args.judge === "false") edit.usesJudge = args.judge === "true";
      else problems.push('--judge must be "true" or "false"');
    }
    if (problems.length === 0 && Object.keys(edit).length === 0) problems.push("nothing to change: pass at least one of --tier --threshold --prior --recoverability --judge");
    if (problems.length > 0) {
      inv.io.stderr.write(`Error: ${problems.join("; ")}\n`);
      return 4;
    }
    return await withDecisions(inv, (opened) => propose(inv, opened, (current) => applyClassEdit(current, String(args.class), edit)));
  },
});

function regenerableVerb(name: "add" | "rm") {
  return defineLoreCommand({
    meta: { name, description: name === "add" ? "Add a worktree-remove regenerable pattern (LOOSENING: human-only)" : "Remove a worktree-remove regenerable pattern (tightening)" },
    args: { pattern: { type: "positional", description: "gitignore-style pattern, e.g. dist-npm/", required: true } },
    async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
      const pattern = String(args.pattern);
      return await withDecisions(inv, (opened) =>
        propose(inv, opened, (current) => {
          const has = current.worktreeRemoveRegenerable.includes(pattern);
          if (name === "add" && has) return { ok: true, record: current };
          if (name === "rm" && !has) return { ok: false, message: `pattern "${pattern}" is not in the regenerable set` };
          return {
            ok: true,
            record: { ...current, worktreeRemoveRegenerable: name === "add" ? [...current.worktreeRemoveRegenerable, pattern] : current.worktreeRemoveRegenerable.filter((p) => p !== pattern) },
          };
        }),
      );
    },
  });
}

const regenerable = defineLoreCommand({
  meta: { name: "regenerable", description: "Edit the worktree-remove regenerable pattern set" },
  subCommands: { add: regenerableVerb("add"), rm: regenerableVerb("rm") },
});

const verifyPushedHeadsCommand = defineLoreCommand({
  meta: { name: "verify-pushed-heads", description: "Check the local decision log reproduces every chain head already pushed (hooks/pre-push)" },
  args: { record: { type: "boolean", description: "After a clean check, record the current head as pushed" } },
  async run(context) {
    const { args } = context;
    const inv = invocationOf(context);
    return await withDecisions(inv, async ({ service, dbPath }) => {
      const ledger = pushedHeadsPath(dbPath);
      const heads = readPushedHeads(ledger);
      if (!heads.ok) return fail(inv, heads.error);
      const rows = await service.chainRows();
      if (!rows.ok) return fail(inv, rows.error);
      const verdict = verifyPushedHeads(rows.value, heads.value);
      if (!verdict.clean) {
        inv.io.stderr.write(`Decision log does NOT reproduce ${verdict.failures.length} head(s) already pushed — the local database was rewritten:\n`);
        for (const { head, why } of verdict.failures) inv.io.stderr.write(`  head row ${head.head_id} (${head.recorded_at}): ${why.reason} — ${why.detail}\n`);
        return 1;
      }
      if (args.record === true) {
        const head = await service.chainHead();
        if (!head.ok) return fail(inv, head.error);
        if (head.value !== null) {
          const recorded = recordPushedHead(ledger, head.value, new Date().toISOString());
          if (!recorded.ok) return fail(inv, recorded.error);
        }
      }
      inv.io.stdout.write(`Decision log reproduces all ${verdict.checked} pushed head(s).\n`);
      return 0;
    });
  },
});

export default defineLoreCommand({
  meta: { name: "autonomy", description: "Governed autonomy thresholds: show, set (tighten applies, loosen escalates), regenerable add|rm, verify-pushed-heads (AC-AU-9)" },
  subCommands: { show, set, regenerable, "verify-pushed-heads": verifyPushedHeadsCommand },
});
