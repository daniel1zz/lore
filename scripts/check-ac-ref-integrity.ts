#!/usr/bin/env bun
/**
 * Corpus-wide dangling-`ac_ref` detector (`bun run check:ac-ref-integrity`) —
 * `spec-lore-ac-set-in-place-edit-of-a-declared-acceptance` D7, AC-ACS-7.
 *
 * `spec.extra.acceptance_criteria[]` is read by three oracles (`lore verify`, the
 * SPEC-052 lexical AC lint, `lore ac list`) but until this task had NO corpus-wide
 * integrity check over the evidence -> criterion edge: `lore ac rm --force` (or a
 * historical `rm`+`add` re-declare cycle that drops an id) can leave a task's
 * `extra.verification_evidence[].ac_ref` pointing at an id no longer declared on its
 * governing spec, and nothing reported it. Measured 2026-08-01 (D7's own probe): THREE
 * such dangling refs already exist in this corpus, all on
 * `spec-context-provenance-injected-corpus-global-state-and-a` — so a first run of
 * this detector against the repo corpus is EXPECTED to be RED until a separate task
 * (T3) dispositions them (D7's "Retroactive policy for the three measured dangling
 * refs"). A green run alone would be indistinguishable from a detector that measures
 * nothing (AC-ACS-7) — see `scripts/tests/check-ac-ref-integrity.test.ts` for the
 * negative-control fixture that proves this detector actually fails when it should.
 *
 * Algorithm (pure half, `./check-ac-ref-integrity-core.ts`): for every task's
 * `extra.verification_evidence[].ac_ref`, resolve the task's governing spec (its
 * parent `plan`'s own parent `spec`) and assert the id is still declared on that
 * spec's `extra.acceptance_criteria[]`. See that module's header for the file SPLIT
 * rationale — this file imports `createApp` (`packages/lore/src/app.ts`), which
 * transitively imports `bun:sqlite`; the pure algorithm module deliberately does not,
 * so `scripts/tests/check-ac-ref-integrity.test.ts` (a vitest-run `.test.ts` file) can
 * import it directly for algorithmic coverage without hitting vitest's bun:sqlite
 * resolution failure (empirically confirmed this task — see that module's header).
 *
 * Exemption ledger (`adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`,
 * modeled on `scripts/check-test-budgets.ts`'s established shape): a dangling ref
 * whose `(spec, id)` is listed in `scripts/ac-ref-exemption-ledger.json` is reported
 * for audit visibility but never fails the run — D7 option 2, for a criterion that
 * was genuinely retired/merged rather than accidentally orphaned. A ledger entry that
 * no longer matches any REAL dangling ref (fixed, or drifted) fails loud on its own
 * (completeness criterion 3) — it must never silently outlive the debt it names.
 * Each applied exemption's `(spec, id)` AND justification (the ledger row's `date` +
 * `reason`, truncated-with-pointer via `formatExemptionReasonForDisplay` when long)
 * are echoed to stdout on the OK path — an exemption is auditable only if the reason
 * an auditor needs reaches them without opening the ledger file separately; printing
 * only a COUNT was the exact defect this echo fixes
 * (task-check-ac-ref-integrity-prints-an-exemption-count-not-its).
 *
 * Public surface: `collectCorpusData` (IO — fetches every `task`/`plan`/`spec` doc,
 * unbounded, via `CorpusService.listFull` — no `limit`/`offset`, so this NEVER
 * truncates regardless of corpus size; see the `spawnSync`-maxBuffer caution this
 * task's context digest raised — using the service layer in-process sidesteps that
 * whole failure class, there is no subprocess boundary here to truncate), `runCheck`
 * (IO — the scan + ledger check over an already-constructed `App`, injectable for
 * tests that build their own fixture `App`), `main` (IO — resolves the corpus + ledger
 * paths, runs the check, prints a report, returns the process exit code; never calls
 * `process.exit` itself, so it stays testable — mirrors `check-test-budgets.ts::main`).
 *
 * Exit codes:
 *   0 — zero dangling refs after ledger exemptions, and the ledger itself is clean
 *       (every entry still matches a real dangling ref).
 *   2 — >=1 dangling `ac_ref` found, not covered by the exemption ledger.
 *   4 — the ledger file is missing/malformed/schema-invalid, or the scan itself
 *       failed (corpus unreadable).
 *   5 — the exemption ledger is unsound: >=1 entry no longer matches a real dangling
 *       ref (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline criterion 3).
 *
 * Usage:
 *   bun scripts/check-ac-ref-integrity.ts
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { extractEvidence, type DocId, type DocRecord, type LoreError } from "@lore/core";
import { ambientOfInvocation, createApp, type App } from "../packages/lore/src/app.js";
import { resolveEntryInvocation } from "../packages/lore/src/adapters/cli/run-cli.js";
import { findLoreDbPath } from "../packages/lore/src/adapters/cli/utils.js";
import {
  findDanglingRefs,
  checkAcRefLedger,
  loadLedgerFromDisk,
  findLedgerEntryForRef,
  formatExemptionReasonForDisplay,
  LEDGER_RELATIVE_PATH,
  LEDGER_ORPHAN_RULE,
  AcRefLedgerError,
  type AcRefLedgerFile,
  type AcRefLedgerCheckResult,
  type DanglingRef,
} from "./check-ac-ref-integrity-core.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(__filename, "..", "..");

/**
 * Thrown when a `listFull` corpus read fails (store-level error, e.g. an
 * unreadable/corrupt `.lore/lore.db`) — a config/IO-level failure distinct from
 * `AcRefLedgerError`, carrying which doc type was being listed plus the underlying
 * `LoreError` verbatim (never stringified into an opaque message only).
 */
export class CorpusReadError extends Error {
  constructor(
    public readonly docType: "task" | "plan" | "spec",
    public readonly loreError: LoreError,
  ) {
    super(`check-ac-ref-integrity: failed to list ${docType}s — ${JSON.stringify(loreError)}`);
    this.name = "CorpusReadError";
  }
}

// ─── Corpus collection ─────────────────────────────────────────────────────

/**
 * Fetches every `task`, `plan`, and `spec` doc from the corpus `app` is wired to —
 * three `listFull` calls, each with NO `limit`/`offset` (per `StoreFilters.limit`'s
 * documented contract: omitted means no `LIMIT` clause, ALL matching rows returned).
 * Reading through the service layer in-process like this — rather than shelling out
 * to `lore list --json` per type and parsing captured `spawnSync` output — sidesteps
 * the truncation failure class entirely: there is no subprocess boundary, so no
 * `maxBuffer` default to silently truncate a large `--json` payload into (this
 * corpus is well past the 1MiB default, per this task's context digest).
 *
 * @throws {CorpusReadError} if any `listFull` call fails (corpus unreadable) — fail
 *   loud, never a partial/silent scan.
 */
export async function collectCorpusData(
  app: App,
): Promise<{ tasks: DocRecord[]; docsById: Map<DocId, DocRecord> }> {
  const tasksResult = await app.corpusService.listFull({ type: "task" });
  if (!tasksResult.ok) {
    throw new CorpusReadError("task", tasksResult.error);
  }
  const plansResult = await app.corpusService.listFull({ type: "plan" });
  if (!plansResult.ok) {
    throw new CorpusReadError("plan", plansResult.error);
  }
  const specsResult = await app.corpusService.listFull({ type: "spec" });
  if (!specsResult.ok) {
    throw new CorpusReadError("spec", specsResult.error);
  }

  const docsById = new Map<DocId, DocRecord>();
  for (const doc of plansResult.value.docs) docsById.set(doc.id, doc);
  for (const doc of specsResult.value.docs) docsById.set(doc.id, doc);

  return { tasks: tasksResult.value.docs, docsById };
}

/** One `runCheck` invocation's full result — scan counts (for the "did I truncate?" sanity floor) plus the dangling-ref/ledger verdict. */
export interface AcRefCheckReport {
  readonly scannedTasks: number;
  /** Total evidence rows scanned that carry an `ac_ref` (across ALL tasks) — the sanity-floor number this task's context digest asks callers to compare against the 2026-08-01 probe (2164). */
  readonly scannedAcRefRows: number;
  readonly dangling: readonly DanglingRef[];
  readonly ledgerCheck: AcRefLedgerCheckResult;
}

/**
 * Runs the full check against an already-constructed `App` and an already-loaded
 * ledger — the seam tests inject a fixture `App` + ledger through (mirrors
 * `seed-write-spec-rule.ts`'s `seedWriteSpecRule(app)` testability pattern).
 */
export async function runCheck(app: App, ledger: AcRefLedgerFile): Promise<AcRefCheckReport> {
  const { tasks, docsById } = await collectCorpusData(app);

  let scannedAcRefRows = 0;
  for (const task of tasks) {
    for (const entry of extractEvidence(task)) {
      if (entry.ac_ref !== undefined) scannedAcRefRows += 1;
    }
  }

  const dangling = findDanglingRefs(tasks, docsById);
  const ledgerCheck = checkAcRefLedger(dangling, ledger.entries);

  return { scannedTasks: tasks.length, scannedAcRefRows, dangling, ledgerCheck };
}

// ─── CLI / IO shell ─────────────────────────────────────────────────────────

/**
 * Resolves the corpus (`findLoreDbPath({ cwd: process.cwd(), env: process.env })`, unless `dbPathOverride` is given — tests
 * pass a throwaway `mkdtemp` + `lore init` corpus path here, NEVER the repo's own
 * `.lore/`) and the ledger (`<repoRoot>/${LEDGER_RELATIVE_PATH}`, unless
 * `repoRootOverride` is given), runs {@link runCheck}, prints a human-readable
 * report, and returns the process exit code. Never calls `process.exit` itself —
 * the `import.meta.main` block below is the only place that does — so this stays
 * directly callable/testable.
 */
export async function main(dbPathOverride?: string, repoRootOverride?: string): Promise<number> {
  const repoRoot = repoRootOverride ?? REPO_ROOT;
  const inv = await resolveEntryInvocation(process.argv.slice(2));
  const dbPath = dbPathOverride ?? findLoreDbPath(inv.io, inv);
  const app = createApp(dbPath, undefined, ambientOfInvocation(inv), { identity: inv.identity });
  try {
    const ledger = loadLedgerFromDisk(repoRoot);
    const report = await runCheck(app, ledger);

    console.log(
      `check-ac-ref-integrity: scanned ${report.scannedTasks} task(s), ${report.scannedAcRefRows} evidence row(s) carrying an ac_ref.`,
    );

    if (report.ledgerCheck.orphanedEntries.length > 0) {
      console.error(
        `\ncheck-ac-ref-integrity: ${report.ledgerCheck.orphanedEntries.length} ledger entry(ies) in ${LEDGER_RELATIVE_PATH} ${LEDGER_ORPHAN_RULE}:\n`,
      );
      for (const e of report.ledgerCheck.orphanedEntries) {
        console.error(`  spec="${e.spec}" id="${e.id}" — recorded ${e.date} — ${e.reason}`);
      }
      console.error(
        `\nRetire this row from ${LEDGER_RELATIVE_PATH} — an exempt entry must keep matching a REAL ` +
          `dangling reference (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline criterion 3), ` +
          `it must never silently outlive the debt it describes.`,
      );
    }

    if (report.ledgerCheck.newDangling.length > 0) {
      console.error(
        `\ncheck-ac-ref-integrity: ${report.ledgerCheck.newDangling.length} dangling ac_ref(s) found, not covered by ${LEDGER_RELATIVE_PATH}:\n`,
      );
      for (const ref of report.ledgerCheck.newDangling) {
        const specNote = ref.specSlug !== null ? `governing spec: ${ref.specSlug}` : "no governing spec resolvable";
        console.error(`  task="${ref.taskSlug}" (${ref.taskId}) ac_ref="${ref.acRef}" — ${specNote}`);
      }
      console.error(
        `\nEvery evidence row's ac_ref must resolve to a criterion still declared on its governing spec ` +
          `(spec-lore-ac-set-in-place-edit-of-a-declared-acceptance D6/D7). Either re-declare the criterion ` +
          `under its original id (if it was lost, not retired), or record a typed exemption in ` +
          `${LEDGER_RELATIVE_PATH} (id/spec/date/reason) if it was genuinely retired/merged — never ` +
          `synthesize a criterion just to satisfy this check.`,
      );
    }

    if (report.ledgerCheck.newDangling.length === 0 && report.ledgerCheck.orphanedEntries.length === 0) {
      console.log(
        `check-ac-ref-integrity: OK — 0 dangling ac_ref(s); ${report.ledgerCheck.exempted.length} pre-existing exemption(s) via ${LEDGER_RELATIVE_PATH}.`,
      );

      if (report.ledgerCheck.exempted.length > 0) {
        console.log(
          `\ncheck-ac-ref-integrity: applied exemption(s) — each converts a detector failure into an audited, justified pass:\n`,
        );
        for (const ref of report.ledgerCheck.exempted) {
          const entry = findLedgerEntryForRef(ref, ledger.entries);
          // `checkAcRefLedger` only places a ref into `exempted` when a ledger entry
          // actually matched it (see that function's doc comment), and
          // `findLedgerEntryForRef` re-derives the SAME (spec, id) key — so `entry`
          // is always found here. The `undefined` branch is unreachable by
          // construction; it is handled explicitly (never a silent skip) so a future
          // change to either matching rule fails loud instead of quietly dropping
          // an exemption's justification from the audit trail.
          if (entry === undefined) {
            console.log(
              `  spec="${ref.specSlug}" id="${ref.acRef}" — exempted but no matching ledger entry found (this is a bug: report it, do not ignore).`,
            );
            continue;
          }
          console.log(`  spec="${entry.spec}" id="${entry.id}" — recorded ${entry.date}`);
          console.log(`    ${formatExemptionReasonForDisplay(entry.reason)}`);
        }
      }

      return 0;
    }

    if (report.ledgerCheck.orphanedEntries.length > 0) return 5;
    return 2;
  } finally {
    app.close();
  }
}

if (import.meta.main) {
  try {
    // `LORE_AC_REF_LEDGER_REPO_ROOT` finishes wiring the `repoRootOverride` seam
    // `main()` already exposes (see its doc comment) to this real CLI entrypoint.
    // Never set by production callers — production always resolves the ledger
    // from THIS script's own repo (REPO_ROOT above). It exists because this
    // script's own E2E fixture (`scripts/tests/check-ac-ref-integrity.test.ts`)
    // MUST spawn this exact file as a subprocess (bun:sqlite in its import graph
    // makes an in-process vitest call impossible — see check-ac-ref-integrity-core.ts's
    // header) against a throwaway `mkdtemp` corpus, while still needing an
    // isolated, empty ledger for that unrelated corpus — otherwise every REAL
    // entry in the repo's shipped ledger (scripts/ac-ref-exemption-ledger.json)
    // reports as "orphaned" (criterion 3: an entry with no matching real dangling
    // ref in THIS scan fails loud) purely because the fixture corpus is a
    // different corpus, not because the ledger is actually unsound. Diagnosed
    // 2026-08-01 (task-t3) the moment the ledger gained its first 3 real rows.
    const code = await main(undefined, process.env.LORE_AC_REF_LEDGER_REPO_ROOT);
    process.exit(code);
  } catch (e) {
    if (e instanceof AcRefLedgerError) {
      console.error(`check-ac-ref-integrity: ${e.message}`);
      if (e.context) console.error(JSON.stringify(e.context));
      process.exit(4);
    }
    console.error(`check-ac-ref-integrity: scan failed — ${e instanceof Error ? e.message : String(e)}`);
    process.exit(4);
  }
}
