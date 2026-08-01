/**
 * Pure algorithm + exemption-ledger layer for `scripts/check-ac-ref-integrity.ts`
 * (`spec-lore-ac-set-in-place-edit-of-a-declared-acceptance` D7, AC-ACS-7).
 *
 * SPLIT RATIONALE (mirrors the established `*-render.ts`/`*-input.ts` convention
 * documented in `packages/lore/src/adapters/cli/CLAUDE.md`: "Vitest-unsafe commands
 * get a sibling split ... the command file transitively imports loader.ts
 * (bun:sqlite); the split module imports only @lore/core + utils.ts so unit tests
 * can exercise the pure rendering/parsing logic. Apply this pattern to any new
 * command needing vitest coverage."):
 *
 * `check-ac-ref-integrity.ts` (the sibling IO shell) imports `createApp` from
 * `packages/lore/src/app.ts`, which has a top-level `import { Database } from
 * "bun:sqlite"`. Empirically verified (this task, 2026-08-01): importing that
 * chain from a `vitest`-executed `.test.ts` file fails at module-resolve time —
 * `vitest.config.ts` marks `bun:sqlite` as an SSR-external/optimizeDeps-excluded
 * specifier for Vite's dependency pre-bundling, but under vite-node's transform
 * pipeline (what `bunx vitest run` actually uses to load every module, static OR
 * dynamically imported) that specifier still fails to resolve — confirmed with a
 * throwaway smoke test hitting `Error: Cannot find package 'bun:sqlite' imported
 * from '.../app.ts'` even behind a lazy `await import(...)`. So THIS file (no
 * `app.ts`/`bun:sqlite` import anywhere, transitively) is the one
 * `scripts/tests/check-ac-ref-integrity.test.ts` imports directly for algorithmic
 * (pure, no-IO) coverage; the real-corpus end-to-end proof runs the IO shell as a
 * subprocess instead (same pattern `packages/lore/tests/integration/cli/*.test.ts`
 * already use for exactly this reason).
 *
 * Public surface:
 *   - resolveGoverningSpec(task, docsById)     — task -> plan -> plan's parent spec walk
 *   - extractDeclaredAcIds(spec)               — spec.extra.acceptance_criteria -> Set<id>
 *   - findDanglingRefs(tasks, docsById)        — the corpus-wide scan, deduped by (task, ac_ref)
 *   - AcRefLedgerEntrySchema / AcRefLedgerFileSchema / parseAcRefLedgerFile / loadLedgerFromDisk
 *     — the auditable exemption ledger (modeled on `scripts/check-test-budgets.ts`'s
 *     baseline-ledger shape per `adr-a-newly-armed-structural-oracle-enforces-from-a-baseline`
 *     — same {id/spec/date/reason} row shape, same "ledger is DATA the oracle reads"
 *     discipline, same completeness assertion via `orphanedEntries` below)
 *   - checkAcRefLedger(dangling, entries)      — partitions a scan into new/exempted/orphaned
 *   - findLedgerEntryForRef(ref, entries)      — looks up the ONE ledger entry that exempts a
 *     given dangling ref, reusing `checkAcRefLedger`'s own `(spec, id)` matching key (never a
 *     second, independently-maintained matching rule) — the IO shell uses this to recover the
 *     `date`/`reason` that `checkAcRefLedger`'s `exempted: DanglingRef[]` return deliberately
 *     drops (see that function's own doc comment), so an exemption's justification can be
 *     echoed to stdout instead of just its count
 *     (task-check-ac-ref-integrity-prints-an-exemption-count-not-its)
 *   - formatExemptionReasonForDisplay(reason)  — truncates a ledger entry's (long,
 *     paragraph-length) `reason` for direct stdout display, with an explicit pointer back to
 *     the ledger file — never a bare silent cut (see `MAX_REASON_DISPLAY_CHARS`'s doc comment
 *     for why the threshold was measured against the real ledger's own reasons, not guessed)
 *
 * Side-effect class: `resolveGoverningSpec`/`extractDeclaredAcIds`/`findDanglingRefs`/
 * `parseAcRefLedgerFile`/`checkAcRefLedger` are pure (no IO). `loadLedgerFromDisk` reads
 * one file from disk (the ledger) — the only IO in this module.
 *
 * Source: spec-lore-ac-set-in-place-edit-of-a-declared-acceptance §D7, AC-ACS-7;
 *   adr-a-newly-armed-structural-oracle-enforces-from-a-baseline (ledger shape precedent)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { extractEvidence, specAcceptanceCriteriaSchema, type DocRecord, type DocId } from "@lore/core";

// ─── Dangling ref shape ────────────────────────────────────────────────────

/**
 * One offending `(task, ac_ref)` pair: a task's evidence entry whose `ac_ref`
 * does not resolve to a criterion still declared on the task's governing spec
 * (spec D6/D7). `specSlug` is `null` only when NO governing spec could be
 * resolved at all (task's parent isn't a live `plan`, or that plan's parent
 * isn't a live `spec`) — a fact worth reporting distinctly from "spec resolved
 * but doesn't declare this id".
 */
export interface DanglingRef {
  readonly taskId: DocId;
  readonly taskSlug: string;
  readonly acRef: string;
  readonly specSlug: string | null;
}

// ─── Governing-spec resolution (task -> plan -> plan's parent spec) ───────

/**
 * Walks a task's `parent_id` (must resolve to a live `plan` doc) to that plan's
 * own `parent_id` (must resolve to a live `spec` doc) — the SAME two-hop
 * relationship `CorpusService.resolveDeclaredAcIds`/`_resolveDeclaredAcIdsForParent`
 * establish as this corpus's one AC `ac_ref`-validation locus (`PARENT_TYPE_CONTRACT`:
 * task's only legal parent type is `plan`; a plan's legal parents are `prd`/`spec`).
 * Re-implemented here (not imported) because that service method lives behind
 * `bun:sqlite`-tainted `CorpusService`/`app.ts` (see module header) and only returns
 * an id `Set`, discarding which spec it came from — this detector needs the spec's
 * OWN identity (slug, for reporting + ledger keying), not just its declared ids.
 *
 * @returns The governing spec `DocRecord`, or `null` when either hop fails
 *   (missing doc, or a doc of the wrong type at either hop) — a fact, never a throw.
 * @example
 * const docsById = new Map([[plan.id, plan], [spec.id, spec]]);
 * resolveGoverningSpec(task, docsById); // => spec (when task.parent_id === plan.id)
 */
export function resolveGoverningSpec(
  task: DocRecord,
  docsById: ReadonlyMap<DocId, DocRecord>,
): DocRecord | null {
  if (task.parent_id === null) return null;
  const plan = docsById.get(task.parent_id);
  if (plan === undefined || plan.type !== "plan") return null;
  if (plan.parent_id === null) return null;
  const spec = docsById.get(plan.parent_id);
  if (spec === undefined || spec.type !== "spec") return null;
  return spec;
}

/**
 * Declared acceptance-criterion ids on `spec`, per `specAcceptanceCriteriaSchema`
 * (the SAME shared shape `AcService`/`computeAcCoverage` validate against — never a
 * second parse convention). Absent `extra.acceptance_criteria`, or a value failing
 * schema validation, both degrade to an empty `Set` (no structured AC declared) —
 * a fact, never a throw, matching `CorpusService._resolveDeclaredAcIdsForParent`'s
 * documented "null is a fact" precedent one layer up.
 */
export function extractDeclaredAcIds(spec: DocRecord): Set<string> {
  const parsed = specAcceptanceCriteriaSchema.safeParse(spec.extra["acceptance_criteria"]);
  if (!parsed.success) return new Set();
  return new Set(parsed.data.map((c) => c.id));
}

/**
 * Corpus-wide dangling-`ac_ref` scan: for every task's `extra.verification_evidence[]`
 * entry carrying an `ac_ref`, resolves the task's governing spec ONCE (not once per
 * evidence row) and flags the ref when that spec doesn't currently declare it.
 *
 * @param tasks - Every `task` doc in scope (typically the WHOLE corpus — see the
 *   IO shell's `collectCorpusData`, which fetches ALL tasks with no `limit`/`offset`).
 * @param docsById - Every `plan` and `spec` doc in scope, keyed by `id` — used by
 *   {@link resolveGoverningSpec}. Tasks themselves need not be present in this map.
 * @returns One {@link DanglingRef} per DISTINCT `(task.id, ac_ref)` pair — a task
 *   with several evidence rows all naming the SAME dangling id is reported ONCE
 *   (spec: "naming each offending (task, ac_ref) pair", not each offending row).
 *   Sorted by `(taskSlug, acRef)` for deterministic report/test output.
 * @example
 * findDanglingRefs([taskWithDanglingEvidence], new Map([[plan.id, plan], [spec.id, spec]]));
 * // => [{ taskId: "...", taskSlug: "task-x", acRef: "AC-1", specSlug: "spec-y" }]
 */
export function findDanglingRefs(
  tasks: readonly DocRecord[],
  docsById: ReadonlyMap<DocId, DocRecord>,
): DanglingRef[] {
  const seen = new Set<string>();
  const results: DanglingRef[] = [];

  for (const task of tasks) {
    const spec = resolveGoverningSpec(task, docsById);
    const declaredIds = spec !== null ? extractDeclaredAcIds(spec) : new Set<string>();

    for (const entry of extractEvidence(task)) {
      if (entry.ac_ref === undefined) continue;
      if (declaredIds.has(entry.ac_ref)) continue;

      const key = `${task.id}::${entry.ac_ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        taskId: task.id,
        taskSlug: task.slug,
        acRef: entry.ac_ref,
        specSlug: spec?.slug ?? null,
      });
    }
  }

  return results.sort((a, b) => {
    const ka = `${a.taskSlug}::${a.acRef}`;
    const kb = `${b.taskSlug}::${b.acRef}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// ─── Exemption ledger (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline) ──

/**
 * Repo-relative path to the exemption ledger — DATA this oracle reads, never a
 * `--exclude` glob buried in a script (same discipline `check-test-budgets.ts`'s
 * `LEDGER_RELATIVE_PATH` documents).
 */
export const LEDGER_RELATIVE_PATH = "scripts/ac-ref-exemption-ledger.json";

/**
 * One recorded exemption: a `(spec, id)` pair whose evidence-referencing `ac_ref`
 * is dangling by DESIGN (the criterion was genuinely retired/merged — D7 option 2),
 * not by accident. `date`/`reason` make the exemption auditable — never a bare
 * suppression.
 */
export const AcRefLedgerEntrySchema = z.object({
  id: z.string().min(1),
  spec: z.string().min(1),
  date: z.string().min(1),
  reason: z.string().min(1),
});

/** Derived TypeScript type for one ledger row — see {@link AcRefLedgerEntrySchema} (Zod is the SSOT, this is inferred, never hand-duplicated). */
export type AcRefLedgerEntry = z.infer<typeof AcRefLedgerEntrySchema>;

/** The whole ledger file's shape: an optional human-readable `note` plus the `entries` this oracle actually reads. */
export const AcRefLedgerFileSchema = z.object({
  note: z.string().optional(),
  entries: z.array(AcRefLedgerEntrySchema),
});

/** Derived TypeScript type for the whole ledger file — see {@link AcRefLedgerFileSchema}. */
export type AcRefLedgerFile = z.infer<typeof AcRefLedgerFileSchema>;

/**
 * Thrown when the exemption ledger cannot be loaded or fails Zod validation — a
 * config-level failure, distinct from a per-row `orphanedEntries` finding (see
 * {@link checkAcRefLedger}), which is reported, never thrown.
 */
export class AcRefLedgerError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid_json" | "schema",
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AcRefLedgerError";
  }
}

/**
 * Parses and Zod-validates raw ledger file content. Pure (no IO) — the IO shell is
 * {@link loadLedgerFromDisk}, below.
 *
 * @throws {AcRefLedgerError} `code: "invalid_json"` if `raw` is not valid JSON;
 *   `code: "schema"` if it parses but fails {@link AcRefLedgerFileSchema} (e.g. a
 *   row missing `reason`).
 */
export function parseAcRefLedgerFile(raw: string): AcRefLedgerFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new AcRefLedgerError(
      "invalid_json",
      `ledger file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const parsed = AcRefLedgerFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new AcRefLedgerError(
      "schema",
      `ledger file failed schema validation: ${parsed.error.message}`,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

/**
 * Reads and validates the ledger file at `<repoRoot>/${LEDGER_RELATIVE_PATH}`. The
 * only IO wrapper around {@link parseAcRefLedgerFile}.
 *
 * @throws {AcRefLedgerError} `code: "not_found"` if the file cannot be read
 *   (missing, permissions); otherwise propagates {@link parseAcRefLedgerFile}'s errors.
 */
export function loadLedgerFromDisk(repoRoot: string): AcRefLedgerFile {
  const ledgerPath = join(repoRoot, LEDGER_RELATIVE_PATH);
  let raw: string;
  try {
    raw = readFileSync(ledgerPath, "utf8");
  } catch (e) {
    throw new AcRefLedgerError(
      "not_found",
      `ledger file not found at ${LEDGER_RELATIVE_PATH}: ${e instanceof Error ? e.message : String(e)}`,
      { path: ledgerPath },
    );
  }
  return parseAcRefLedgerFile(raw);
}

/** Result of cross-checking a scan's `DanglingRef[]` against the ledger's entries. */
export interface AcRefLedgerCheckResult {
  /** Dangling refs with NO matching ledger entry — new/undispositioned, always fails. */
  readonly newDangling: readonly DanglingRef[];
  /** Dangling refs covered by a matching ledger entry — reported for audit visibility, never a failure. */
  readonly exempted: readonly DanglingRef[];
  /**
   * Ledger rows whose `(spec, id)` no longer matches any REAL dangling ref found in
   * THIS scan — fixed (the criterion was re-declared), or drifted (typo/rename) —
   * always fails (adr-a-newly-armed-structural-oracle-enforces-from-a-baseline
   * criterion 3: an exempt entry must keep matching a real violation, or it silently
   * outlives the debt it describes and becomes an unaudited suppression list).
   */
  readonly orphanedEntries: readonly AcRefLedgerEntry[];
}

const exemptionKey = (spec: string, id: string): string => `${spec}::${id}`;

/**
 * Partitions a scan's dangling refs against the ledger's entries. A ledger entry
 * exempts a dangling ref iff `entry.spec === ref.specSlug && entry.id === ref.acRef`
 * (exact match — ids are only unique PER SPEC, so matching id alone would let one
 * spec's exemption silently cover another spec's same-named id). A ref with
 * `specSlug === null` (no governing spec resolvable at all) can never be exempted —
 * there is no `(spec, id)` pair to key an exemption on.
 *
 * @param dangling - Full scan result (ALL tasks, not pre-filtered) — see
 *   {@link findDanglingRefs}.
 * @param entries - The ledger's entry list (already Zod-validated).
 */
export function checkAcRefLedger(
  dangling: readonly DanglingRef[],
  entries: readonly AcRefLedgerEntry[],
): AcRefLedgerCheckResult {
  const newDangling: DanglingRef[] = [];
  const exempted: DanglingRef[] = [];
  const matchedKeys = new Set<string>();

  for (const ref of dangling) {
    const key = ref.specSlug !== null ? exemptionKey(ref.specSlug, ref.acRef) : null;
    const isExempt = key !== null && entries.some((e) => exemptionKey(e.spec, e.id) === key);
    if (isExempt) {
      exempted.push(ref);
      matchedKeys.add(key as string);
    } else {
      newDangling.push(ref);
    }
  }

  const orphanedEntries = entries.filter((e) => !matchedKeys.has(exemptionKey(e.spec, e.id)));

  return { newDangling, exempted, orphanedEntries };
}

// ─── Exemption echo (task-check-ac-ref-integrity-prints-an-exemption-count-not-its) ──

/**
 * Recovers the ONE ledger entry that exempts a given dangling ref — i.e. the entry
 * `checkAcRefLedger` matched when it placed this ref into its `exempted` bucket.
 * Reuses {@link exemptionKey} (the SAME `(spec, id)` matching rule `checkAcRefLedger`
 * uses internally) rather than re-deriving the match condition a second time — an
 * exemption is auditable only if its "is this ref exempted" and "which entry exempts
 * it" questions are answered by ONE rule, never two independently-maintained ones
 * that could silently drift apart.
 *
 * `checkAcRefLedger`'s own `exempted: DanglingRef[]` return deliberately does not
 * carry the matching entry's `date`/`reason` (see its doc comment) — this function
 * is how a caller that already knows a ref is exempted (via `checkAcRefLedger`)
 * recovers those fields for display, e.g. the IO shell echoing WHY the exemption
 * was granted instead of only counting it.
 *
 * @returns The matching entry, or `undefined` if none matches — a ref with
 *   `specSlug === null` never matches (mirrors {@link checkAcRefLedger}'s own rule:
 *   there is no `(spec, id)` pair to key a match on), and this function never throws
 *   for an unmatched ref (a fact for the caller to handle, not an error).
 * @example
 * const entries = [{ id: "AC-X", spec: "spec-a", date: "2026-08-01", reason: "merged" }];
 * findLedgerEntryForRef({ taskId: "t1", taskSlug: "task-1", acRef: "AC-X", specSlug: "spec-a" }, entries);
 * // => entries[0]
 */
export function findLedgerEntryForRef(
  ref: DanglingRef,
  entries: readonly AcRefLedgerEntry[],
): AcRefLedgerEntry | undefined {
  if (ref.specSlug === null) return undefined;
  const key = exemptionKey(ref.specSlug, ref.acRef);
  return entries.find((e) => exemptionKey(e.spec, e.id) === key);
}

/**
 * Max characters of a ledger entry's `reason` shown directly in the detector's
 * stdout before truncating with a pointer back to {@link LEDGER_RELATIVE_PATH}.
 * Measured, not guessed: the three real ledger reasons authored 2026-08-01 place
 * BOTH load-bearing facts this echo exists to surface — the spec-version citation
 * (`removed at vNN ... replaced ... at vMM`, ~330-420 chars in) and the
 * merged-vs-lost verdict sentence (`Genuinely superseded, not lost: ...`, ending
 * ~730-800 chars in) — within the first ~800 characters of all three; the
 * remaining ~270-410 trailing chars are elaboration (which evidence row this
 * superseded, why re-declaring would violate D7) an auditor can still reach via
 * the pointer, but does not need inline to trust the exemption. 850 leaves a
 * comfortable margin above the widest measured verdict-sentence end (794).
 */
export const MAX_REASON_DISPLAY_CHARS = 850;

/**
 * Formats one ledger entry's `reason` for direct stdout display: unchanged if it
 * already fits within {@link MAX_REASON_DISPLAY_CHARS}, otherwise truncated to that
 * length with an explicit pointer back to {@link LEDGER_RELATIVE_PATH} for the full
 * text. Never a bare silent cut — the pointer names exactly how many characters
 * were dropped and where to find them, so an auditor who needs the elided tail
 * knows it exists and where to look, rather than assuming the truncated line is
 * the whole reason.
 *
 * @example
 * formatExemptionReasonForDisplay("short"); // => "short" (unchanged)
 * formatExemptionReasonForDisplay("x".repeat(900));
 * // => "xxxx...xxxx… [truncated 50 more chars — see scripts/ac-ref-exemption-ledger.json for the full reason]"
 */
export function formatExemptionReasonForDisplay(reason: string): string {
  if (reason.length <= MAX_REASON_DISPLAY_CHARS) return reason;
  const cutChars = reason.length - MAX_REASON_DISPLAY_CHARS;
  const charWord = cutChars === 1 ? "char" : "chars";
  return (
    `${reason.slice(0, MAX_REASON_DISPLAY_CHARS)}… ` +
    `[truncated ${cutChars} more ${charWord} — see ${LEDGER_RELATIVE_PATH} for the full reason]`
  );
}
