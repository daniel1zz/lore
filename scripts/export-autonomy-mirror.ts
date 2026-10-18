/**
 * Autonomy mirror — the git-tracked projection of the governed threshold record (AC-AU-9, ADR D8).
 *
 * Purpose: `bun run mirror:export` writes `.lore/autonomy-mirror.json` (the record text, its sha256, its integrity
 * state and the decision-chain head as of the export) and `bun run check:spec-mirror` reports drift between that file
 * and the database. The file is git-tracked, so a deliberate rewrite of the record shows up in git history, and the
 * export itself refuses to mirror a record that fails its integrity check or a log that no longer reproduces a head
 * already pushed (see packages/lore/src/adapters/cli/autonomy-heads.ts).
 * Public surface: AUTONOMY_MIRROR_RELATIVE, exportAutonomyMirror, checkAutonomyMirror, AutonomyMirrorVerdict.
 * Invariants:
 *   - `exportAutonomyMirror` is the ONLY writer; it seeds the record when it was never governed (recorded initial
 *     governance write) and rewrites the file only when its content changed (idempotent).
 *   - `checkAutonomyMirror` NEVER writes, seeds or opens anything for write: it compares the record's hash only. The
 *     decision-chain head is deliberately NOT compared — it advances with every decision, so a head comparison would
 *     report drift on every routine operation; head integrity is the pushed-heads ledger's job.
 *   - A database that was never seeded has nothing to mirror: no file is written and none is required.
 * Side-effect class: IO (the corpus database through a store handle, one file under `<repoRoot>/.lore/`).
 *
 * Source: spec-autonomy-phase-1-decision-function-human-channel-lore AC-AU-9;
 *   adr-autonomy-is-decided-by-measured-facts-one-decision-function D8.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pushedHeadsPath, readPushedHeads, verifyPushedHeads } from "../packages/lore/src/adapters/cli/autonomy-heads.js";
import { DecisionService } from "../packages/lore/src/service/decision-service.js";
import { parseMirror } from "../packages/lore/src/service/autonomy-threshold-service.js";
import { SQLiteStore } from "../packages/lore/src/store/sqlite-store.js";

/** Repo-relative path of the git-tracked mirror file. */
export const AUTONOMY_MIRROR_RELATIVE = ".lore/autonomy-mirror.json";

export type AutonomyMirrorVerdict =
  | { readonly ok: true; readonly message: string }
  | { readonly ok: false; readonly kind: "drift" | "refused"; readonly message: string };

/** A LoreError's message when it carries one, else its code. */
function errorText(error: { readonly code: string; readonly message?: string }): string {
  return error.message ?? error.code;
}

async function withService<T>(dbPath: string, fn: (service: DecisionService) => Promise<T>): Promise<T> {
  const store = new SQLiteStore(dbPath);
  try {
    return await fn(new DecisionService({ store, executorRun: null }));
  } finally {
    store.close();
  }
}

/** Writes the mirror file for the corpus at `dbPath` under `repoRoot`. `refused` = nothing was written. */
export async function exportAutonomyMirror(dbPath: string, repoRoot: string): Promise<AutonomyMirrorVerdict> {
  return withService(dbPath, async (service) => {
    const thresholds = service.thresholds();
    const seeded = await thresholds.ensureSeeded();
    if (!seeded.ok) return { ok: false, kind: "refused", message: `autonomy mirror: cannot read the threshold record: ${seeded.error.code}` };
    const integrity = seeded.value.integrity;
    if (integrity.state === "broken") {
      return { ok: false, kind: "refused", message: `autonomy mirror: REFUSED — the threshold record fails its integrity check (${integrity.reason}: ${integrity.detail}); resolve the threshold-integrity decision first` };
    }
    const heads = readPushedHeads(pushedHeadsPath(dbPath));
    if (!heads.ok) return { ok: false, kind: "refused", message: `autonomy mirror: REFUSED — ${errorText(heads.error)}` };
    const rows = await service.chainRows();
    if (!rows.ok) return { ok: false, kind: "refused", message: `autonomy mirror: cannot read the decision log: ${rows.error.code}` };
    const verdict = verifyPushedHeads(rows.value, heads.value);
    if (!verdict.clean) {
      return { ok: false, kind: "refused", message: `autonomy mirror: REFUSED — the decision log does not reproduce ${verdict.failures.length} head(s) already pushed (lore autonomy verify-pushed-heads names them)` };
    }
    const mirror = await thresholds.buildMirror();
    if (!mirror.ok) return { ok: false, kind: "refused", message: `autonomy mirror: cannot build the mirror: ${mirror.error.code}` };
    const path = join(repoRoot, AUTONOMY_MIRROR_RELATIVE);
    const text = `${JSON.stringify(mirror.value, null, 2)}\n`;
    if (existsSync(path) && readFileSync(path, "utf8") === text) return { ok: true, message: `autonomy mirror: ${AUTONOMY_MIRROR_RELATIVE} already current` };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
    return { ok: true, message: `autonomy mirror: wrote ${AUTONOMY_MIRROR_RELATIVE}` };
  });
}

/** Read-only drift check between the mirror file and the database's record. */
export async function checkAutonomyMirror(dbPath: string, repoRoot: string): Promise<AutonomyMirrorVerdict> {
  return withService(dbPath, async (service) => {
    const mirror = await service.thresholds().buildMirror();
    if (!mirror.ok) return { ok: false, kind: "refused", message: `autonomy mirror: cannot read the threshold record: ${mirror.error.code}` };
    const path = join(repoRoot, AUTONOMY_MIRROR_RELATIVE);
    if (mirror.value.integrity === "unseeded") return { ok: true, message: "autonomy mirror: record not yet governed (nothing to mirror)" };
    if (mirror.value.integrity === "broken") {
      return { ok: false, kind: "refused", message: "autonomy mirror: the threshold record fails its integrity check (lore status --check-autonomy-thresholds)" };
    }
    if (!existsSync(path)) return { ok: false, kind: "drift", message: `autonomy mirror: ${AUTONOMY_MIRROR_RELATIVE} is missing — run bun run mirror:export` };
    const onDisk = parseMirror(readFileSync(path, "utf8"));
    if (!onDisk.ok) return { ok: false, kind: "drift", message: `autonomy mirror: ${AUTONOMY_MIRROR_RELATIVE} is unusable (${errorText(onDisk.error)}) — run bun run mirror:export` };
    if (onDisk.value.thresholds_hash !== mirror.value.thresholds_hash) {
      return { ok: false, kind: "drift", message: `autonomy mirror: ${AUTONOMY_MIRROR_RELATIVE} holds a different threshold record than the database — run bun run mirror:export` };
    }
    return { ok: true, message: "autonomy mirror: current" };
  });
}
