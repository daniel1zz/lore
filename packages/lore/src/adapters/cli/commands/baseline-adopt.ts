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
 *   - Authority is decided first (a foreign refusal leaves the config untouched); then the config is written and the row second; a failed row append is reported loudly and leaves the config
 *     changed but unaudited, which `lore status` then (truthfully) reports as `unaudited`.
 *
 * Side-effect class: IO (config file write, one audit append).
 */

import { dirname, join } from "node:path";

import { defineLoreCommand } from "../cli-exit.js";
import { CITE_GATE_MODES, err, ok } from "@lore/core";
import type { CiteGateMode, Invocation, LoreError, Result } from "@lore/core";
import { invocationOf } from "../command-invocation.js";
import { loadLoreApp } from "../loader.js";
import { exitCode, formatError, formatErrorFor, resolveActor } from "../utils.js";
import { resolveTrackedWriteRoot, resolveWorkingTreeRoot } from "../working-tree-root.js";
import { resolveDoc } from "../../../service/resolve.js";
import { bareDocWriter, type DocWritePort } from "../../../service/corpus-service.js";
import { SQLiteStore } from "../../../store/sqlite-store.js";
import { readAcCiteStored, seedAcCiteModeIfAbsent, writeAcCiteStored } from "../../ac-cite-config-file.js";
import type { AcCiteSeedOutcome, AcCiteStored } from "../../ac-cite-config-file.js";
import { ENFORCE_REFUSES_NOTHING_WARNING, isEnforceRefusingNothing } from "../../../service/ac-cite-status.js";
import { printLine } from "../output.js";
import type { ExitReport } from "../cli-exit.js";

/** The audit `action` of an adopt row; `lore status` provenance reads it back. SSOT for both sides. */
export const BASELINE_ADOPT_AUDIT_ACTION = "baseline_adopt";

/** The modes `adopt` may set (`off` is the absence of adoption, not an adoption). */
const ADOPT_MODES = CITE_GATE_MODES.filter((m): m is Exclude<CiteGateMode, "off"> => m !== "off");

const ADOPT_AUDIT_SESSION_ID = "baseline-adopt";

/** Appends the ONE `baseline_adopt` audit row (the single provenance mechanism, BR-987) for `old` -> `next`. */
export async function appendAdoptAuditRow(
  writer: DocWritePort,
  actor: string,
  old: AcCiteStored,
  next: AcCiteStored,
  foreignIntent = false,
): Promise<Result<void, LoreError>> {
  // reason: AC-DCL-5 — the row goes through the ONE write route (foreign-corpus refusal, caller actor), never a bare store append.
  const appended = await writer.appendAudit({
    by: actor,
    sessionId: ADOPT_AUDIT_SESSION_ID,
    action: BASELINE_ADOPT_AUDIT_ACTION,
    details: { old, new: next },
    foreignIntent,
  });
  return appended.ok ? ok(undefined) : err(appended.error);
}

/** What {@link applyAuditedAdoption} needs: the write route, the tree the config lives in, and the settings change. */
export interface AuditedAdoptionRequest {
  readonly writer: DocWritePort;
  readonly actor: string;
  /** Toplevel of the tree whose `.lore/config.yaml` is rewritten. */
  readonly repoDir: string;
  /** `true` when `repoDir` is the invoking working tree itself (the adopt declares intent on its own config). */
  readonly ownTree: boolean;
  readonly old: AcCiteStored;
  readonly next: AcCiteStored;
  /** `false` = the stored settings already equal `next` (hand-edited state): only the audit row is written. */
  readonly writeConfig: boolean;
}

/** Where {@link applyAuditedAdoption} stopped: `unwritten` = nothing changed; `config-unaudited` = config changed, row missing. */
export interface AuditedAdoptionFailure {
  readonly stage: "unwritten" | "config-unaudited";
  readonly error: LoreError;
}

/**
 * Authority first, then config, then audit: the config write and its audit row are ONE unit. The foreign-corpus
 * decision is taken BEFORE the config is touched, so a refused adopt leaves `.lore/config.yaml` byte-identical
 * and writes no row; an adopt that targets the invoking tree's own config declares that intent for the row.
 *
 * @returns `ok` when everything requested landed; otherwise the failing stage and error.
 */
export async function applyAuditedAdoption(request: AuditedAdoptionRequest): Promise<Result<void, AuditedAdoptionFailure>> {
  const authority = await request.writer.assertWritable(request.ownTree);
  if (!authority.ok) return { ok: false, error: { stage: "unwritten", error: authority.error } };
  if (request.writeConfig) {
    const written = writeAcCiteStored(request.repoDir, {
      ...(request.next.mode !== null ? { mode: request.next.mode } : {}),
      armed_branches: request.next.armed_branches,
    });
    if (!written.ok) return { ok: false, error: { stage: "unwritten", error: written.error } };
  }
  const audited = await appendAdoptAuditRow(request.writer, request.actor, request.old, request.next, request.ownTree);
  if (audited.ok) return ok(undefined);
  return { ok: false, error: { stage: request.writeConfig ? "config-unaudited" : "unwritten", error: audited.error } };
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
      bareDocWriter(store),
      resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user),
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

function fail(inv: Invocation, error: LoreError, json: boolean, code: number): ExitReport {
  if (json) printLine(inv.io.stdout, JSON.stringify({ ok: false, error }, null, 2));
  else inv.io.stderr.write(formatErrorFor(inv, error));
  return code;
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

async function runAdopt(args: Record<string, unknown>, inv: Invocation): Promise<ExitReport> {
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

    // reason: INT-T10 — .lore/config.yaml is tracked, so it is read-modified-written in the invoking working
    // tree (same file for the read and the write), not the corpus checkout; the audit row stays in the corpus DB.
    const rootResolved = resolveTrackedWriteRoot(inv.cwd, dirname(dirname(dbPath)));
    if (!rootResolved.ok) return fail(inv, rootResolved.error, json, exitCode(rootResolved.error));
    const repoDir = rootResolved.value;
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
        if (json) printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { changed: false, old, new: next } }, null, 2));
        else printLine(inv.io.stdout, "no change");
        return 0;
      }
    }

    // reason: the target is the invoking working tree's own config (resolveTrackedWriteRoot) unless cwd is outside
    // any git tree, where the root falls back to the corpus root and no own-tree intent exists.
    const invokingTree = resolveWorkingTreeRoot(inv.cwd);
    if (!invokingTree.ok) return fail(inv, invokingTree.error, json, exitCode(invokingTree.error));
    const applied = await applyAuditedAdoption({
      writer: app.corpusService,
      actor: resolveActor(inv.io, undefined, inv.env, inv.cwd, inv.user),
      repoDir,
      ownTree: invokingTree.value === repoDir,
      old,
      next,
      writeConfig: !unchanged,
    });
    if (!applied.ok) {
      const { stage, error } = applied.error;
      if (stage === "unwritten") return fail(inv, error, json, exitCode(error));
      return fail(
        inv,
        {
          code: "STORE_ERROR",
          message: `config was changed but the audit row was NOT written (status will report the mode as unaudited): ${formatErrorFor(inv, error).trim()}`,
        },
        json,
        exitCode(error),
      );
    }

    // BR-987: enforce with no armed branch is accepted (exit 0, not a refusal) but reported as refusing nothing.
    const refusesNothing = next.mode !== null && isEnforceRefusingNothing(next.mode, next.armed_branches);
    if (json) {
      const warnings = refusesNothing ? { warnings: [ENFORCE_REFUSES_NOTHING_WARNING] } : {};
      printLine(inv.io.stdout, JSON.stringify({ ok: true, data: { changed: true, old, new: next, ...warnings } }, null, 2));
    } else {
      printLine(inv.io.stdout, `Adopted: mode ${old.mode ?? "(unset)"} -> ${next.mode ?? "(unset)"}; armed branches [${next.armed_branches.join(", ")}]`);
      if (refusesNothing) inv.io.stderr.write(`Warning: ${ENFORCE_REFUSES_NOTHING_WARNING}\n`);
    }
  } finally {
    store.close();
    app.close();
  }
  return 0;
}

/** The `lore baseline adopt` subcommand (registered by `commands/baseline.ts`). */
export const adoptCommand = defineLoreCommand({
  meta: { name: "adopt", description: "Set the AC citation gate's mode and armed branches (audited; one audit row per change)" },
  args: {
    mode: { type: "string", description: "report | enforce" },
    arm: { type: "string", description: "Arm a baseline branch slug for enforcement (repeatable)" },
    disarm: { type: "string", description: "Disarm a branch slug (repeatable)" },
    json: { type: "boolean", description: "Output result as JSON" },
  },
  async run(context) {
    return await runAdopt(context.args as Record<string, unknown>, invocationOf(context));
  },
});
