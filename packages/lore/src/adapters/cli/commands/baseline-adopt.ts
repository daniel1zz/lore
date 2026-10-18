/**
 * lore baseline adopt — the audited writer of the citation gate's adoption settings
 * (Baseline slice 3a, BL-8, AC-BLS3-8).
 *
 *   lore baseline adopt [--mode report|enforce] [--arm <branch-slug>]... [--disarm <branch-slug>]... [--json]
 *
 * Writes `workflow.gates."ac-cite"` in `.lore/config.yaml` and exactly ONE `baseline_adopt` audit row
 * (`details: { old, new }`, both the RAW stored settings: mode null / armed_branches [] when absent).
 * `lore status` compares the stored mode with the last row's `new.mode` to flag a hand-edited mode as unaudited.
 *
 * Contract:
 *   - A flag that is not given leaves its key as it was; every other config key and comment is untouched.
 *   - `--arm` takes a baseline BRANCH slug (unknown -> exit 3, not a branch -> exit 4); arming an armed slug or
 *     disarming an unarmed one is not an error and never duplicates; `armed_branches` keeps first-arm order.
 *   - Refusals write nothing (config byte-identical, zero rows): bad `--mode` / no flag / same slug armed and
 *     disarmed -> exit 2.
 *   - A call that changes nothing AND repeats the last adopted state writes no row and prints `no change` (exit 0).
 *     A call whose result equals a hand-edited current state (not yet attested) writes the row only.
 *   - The config is written first, the row second; a failed row append is reported loudly and leaves the config
 *     changed but unaudited, which `lore status` then (truthfully) reports as `unaudited`.
 *
 * Side-effect class: IO (config file write, one audit append).
 */

import { dirname, join } from "node:path";
import { defineCommand } from "citty";
import { CITE_GATE_MODES, err, ok } from "@lore/core";
import type { CiteGateMode, Invocation, LoreError, Result } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatErrorFor, resolveActor } from "../utils.js";
import { resolveDoc } from "../../../service/resolve.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { readAcCiteStored, seedAcCiteModeIfAbsent, writeAcCiteStored } from "../../ac-cite-config-file.js";
import type { AcCiteSeedOutcome, AcCiteStored } from "../../ac-cite-config-file.js";
import { ENFORCE_REFUSES_NOTHING_WARNING, isEnforceRefusingNothing } from "../../../service/ac-cite-status.js";

/** The audit `action` of an adopt row; `lore status` provenance reads it back. SSOT for both sides. */
export const BASELINE_ADOPT_AUDIT_ACTION = "baseline_adopt";

/** The modes `adopt` may set (`off` is the absence of adoption, not an adoption). */
const ADOPT_MODES = CITE_GATE_MODES.filter((m): m is Exclude<CiteGateMode, "off"> => m !== "off");

const ADOPT_AUDIT_SESSION_ID = "baseline-adopt";

/** Appends the ONE `baseline_adopt` audit row (the single provenance mechanism, BR-987) for `old` -> `next`. */
async function appendAdoptAuditRow(
  store: SQLiteStore,
  actor: string,
  old: AcCiteStored,
  next: AcCiteStored,
): Promise<Result<void, LoreError>> {
  const appended = await store.appendAuditEntry({
    timestamp: new Date().toISOString(),
    actor,
    session_id: ADOPT_AUDIT_SESSION_ID,
    action: BASELINE_ADOPT_AUDIT_ACTION,
    details: { old, new: next },
  });
  return appended.ok ? ok(undefined) : err(appended.error);
}

/**
 * `lore setup --project`'s mode seed as an AUDITED adoption (BR-987, AC-FIP-3): seeds `mode: report` only when
 * absent (as {@link seedAcCiteModeIfAbsent}) and, only on a real write, records the same `baseline_adopt` row
 * `lore baseline adopt` writes (actor = the setup caller), so status reads the seeded mode as `audited`.
 * A kept explicit mode writes no row. A failed row append is returned loudly (the config was already seeded).
 *
 * @param repoDir - the repo whose `.lore/` setup just initialised (the DB exists: init runs before the seed)
 * @param inv - the running command's Invocation (env + cwd for the audit row's actor)
 */
export async function seedAcCiteModeAudited(repoDir: string, inv: Invocation): Promise<Result<AcCiteSeedOutcome, LoreError>> {
  const seeded = seedAcCiteModeIfAbsent(repoDir);
  if (!seeded.ok || seeded.value.status !== "written") return seeded;
  const store = new SQLiteStore(join(repoDir, ".lore", "lore.db"));
  try {
    const row = await appendAdoptAuditRow(
      store,
      resolveActor(undefined, inv.env, inv.cwd, inv.user),
      { mode: null, armed_branches: [] },
      { mode: "report", armed_branches: [] },
    );
    if (!row.ok) return err(row.error);
    return seeded;
  } finally {
    store.close();
  }
}

function repeatable(value: unknown): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function fail(inv: Invocation, error: LoreError, json: boolean, code: number): void {
  if (json) console.log(JSON.stringify({ ok: false, error }, null, 2));
  else process.stderr.write(formatErrorFor(inv, error));
  process.exitCode = code;
}

function usageError(field: string, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, ...(value !== undefined ? { value } : {}) };
}

const sameSettings = (a: AcCiteStored, b: AcCiteStored): boolean =>
  a.mode === b.mode && a.armed_branches.length === b.armed_branches.length && a.armed_branches.every((s, i) => s === b.armed_branches[i]);

/** `details.new` of a `baseline_adopt` row as settings; `undefined` for no row or a malformed one. */
function readAdoptedSettings(row: { details?: Record<string, unknown> } | undefined): AcCiteStored | undefined {
  const next = row?.details?.["new"];
  if (typeof next !== "object" || next === null) return undefined;
  const { mode, armed_branches: armed } = next as Record<string, unknown>;
  if (!(typeof mode === "string" || mode === null) || !Array.isArray(armed) || !armed.every((s) => typeof s === "string")) return undefined;
  return { mode: mode as CiteGateMode | null, armed_branches: armed as string[] };
}

/**
 * Applies the requested change to the stored settings (pure): arm appends missing slugs in call order,
 * disarm removes the listed slugs, a given mode replaces the mode.
 */
export function computeAdoptedSettings(
  old: AcCiteStored,
  change: { readonly mode?: CiteGateMode; readonly arm: readonly string[]; readonly disarm: readonly string[] },
): AcCiteStored {
  const armed = [...old.armed_branches];
  for (const slug of change.arm) if (!armed.includes(slug)) armed.push(slug);
  return { mode: change.mode ?? old.mode, armed_branches: armed.filter((s) => !change.disarm.includes(s)) };
}

async function runAdopt(args: Record<string, unknown>, inv: Invocation): Promise<void> {
  const json = args.json === true;
  const arm = repeatable(args.arm);
  const disarm = repeatable(args.disarm);
  const modeArg = args.mode === undefined ? undefined : String(args.mode);

  if (modeArg === undefined && arm.length === 0 && disarm.length === 0) {
    return fail(inv, usageError("flags", "baseline adopt needs at least one of --mode, --arm, --disarm"), json, 2);
  }
  if (modeArg !== undefined && !(ADOPT_MODES as readonly string[]).includes(modeArg)) {
    return fail(inv, usageError("mode", `--mode must be one of ${ADOPT_MODES.join(" | ")}`, modeArg), json, 2);
  }
  const both = arm.filter((s) => disarm.includes(s));
  if (both.length > 0) {
    return fail(inv, usageError("arm", `the same branch is both --arm and --disarm: ${both.join(", ")}`, both), json, 2);
  }

  const { app, dbPath } = loadLoreApp({ inv });
  const store = new SQLiteStore(dbPath);
  try {
    // reason: --arm slugs are validated against the corpus BEFORE anything is written (all-or-nothing).
    const armedSlugs: string[] = [];
    for (const ref of arm) {
      const doc = await resolveDoc(store, ref);
      if (!doc.ok) return fail(inv, doc.error, json, exitCode(doc.error));
      if (doc.value.type !== "baseline" || doc.value.extra["node"] !== "branch") {
        return fail(inv, usageError("arm", `${ref} is not a baseline branch (armed_branches holds baseline branch slugs)`, ref), json, 4);
      }
      armedSlugs.push(doc.value.slug);
    }

    const repoDir = dirname(dirname(dbPath));
    const stored = readAcCiteStored(repoDir);
    if (!stored.ok) return fail(inv, stored.error, json, exitCode(stored.error));
    const old = stored.value;
    const next = computeAdoptedSettings(old, {
      ...(modeArg !== undefined ? { mode: modeArg as CiteGateMode } : {}),
      arm: armedSlugs,
      disarm,
    });

    const unchanged = sameSettings(old, next);
    if (unchanged) {
      // reason: "no change" needs the state to be unchanged AND already audited. A hand-edited state that
      // equals the request is not yet attested by any row, and recording it is what `adopt` is for (the status
      // provenance flips back to `audited`); only a repeat of the last adopted state is a true no-op.
      const lastRow = await store.queryAudit({ action: BASELINE_ADOPT_AUDIT_ACTION, limit: 1 });
      if (!lastRow.ok) return fail(inv, lastRow.error, json, exitCode(lastRow.error));
      const lastNew = readAdoptedSettings(lastRow.value[0]);
      if (lastNew !== undefined && sameSettings(lastNew, next)) {
        if (json) console.log(JSON.stringify({ ok: true, data: { changed: false, old, new: next } }, null, 2));
        else console.log("no change");
        return;
      }
    }

    if (!unchanged) {
      const written = writeAcCiteStored(repoDir, {
        ...(next.mode !== null ? { mode: next.mode } : {}),
        armed_branches: next.armed_branches,
      });
      if (!written.ok) return fail(inv, written.error, json, exitCode(written.error));
    }

    const audited = await appendAdoptAuditRow(store, resolveActor(undefined, inv.env, inv.cwd, inv.user), old, next);
    if (!audited.ok) {
      return fail(inv, 
        {
          code: "STORE_ERROR",
          message: `config was changed but the audit row was NOT written (status will report the mode as unaudited): ${formatErrorFor(inv, audited.error).trim()}`,
        },
        json,
        exitCode(audited.error),
      );
    }

    // BR-987: enforce with no armed branch is accepted (exit 0, not a refusal) but reported as refusing nothing.
    const refusesNothing = next.mode !== null && isEnforceRefusingNothing(next.mode, next.armed_branches);
    if (json) {
      const warnings = refusesNothing ? { warnings: [ENFORCE_REFUSES_NOTHING_WARNING] } : {};
      console.log(JSON.stringify({ ok: true, data: { changed: true, old, new: next, ...warnings } }, null, 2));
    } else {
      console.log(`Adopted: mode ${old.mode ?? "(unset)"} -> ${next.mode ?? "(unset)"}; armed branches [${next.armed_branches.join(", ")}]`);
      if (refusesNothing) process.stderr.write(`Warning: ${ENFORCE_REFUSES_NOTHING_WARNING}\n`);
    }
  } finally {
    store.close();
    app.close();
  }
}

/** The `lore baseline adopt` subcommand (registered by `commands/baseline.ts`). */
export const adoptCommand = defineCommand({
  meta: { name: "adopt", description: "Set the AC citation gate's mode and armed branches (audited; one audit row per change)" },
  args: {
    mode: { type: "string", description: "report | enforce" },
    arm: { type: "string", description: "Arm a baseline branch slug for enforcement (repeatable)" },
    disarm: { type: "string", description: "Disarm a branch slug (repeatable)" },
    json: { type: "boolean", description: "Output result as JSON" },
  },
  async run(context) {
    await runAdopt(context.args as Record<string, unknown>, invocationOf(context));
  },
});
