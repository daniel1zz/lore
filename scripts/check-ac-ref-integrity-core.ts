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
 *   - resolveGoverningSpec(task, docsById, allSpecs) — governing-spec resolution for BOTH
 *     plan-bound tasks (structural task -> plan -> plan's parent spec walk) AND
 *     `--adhoc` tasks (SPEC-069 D2, no plan/spec structural link at all) — the adhoc
 *     branch delegates to the SAME `resolveGoverningSpecByAcScope` (`@lore/core`)
 *     that `TaskWorkflowService.addEvidence`/`CorpusService.resolveDeclaredAcIdsForAdhocTask`/
 *     `VerifyRunnerService.verifyAdhocTask` already use, so this detector can never
 *     disagree with the write path about which spec governs a given ad-hoc task
 *     (task-check-ac-ref-integrity-re-implements-governing-spec — this file's OWN
 *     prior re-implementation was strictly narrower than the write path: it walked
 *     ONLY task -> plan -> spec, so it returned null for every ad-hoc task
 *     regardless of `ac_scope`, reporting six real, correctly-accepted evidence
 *     rows as dangling). Returns a {@link GoverningSpecResolution} — a resolved
 *     `spec` XOR a named {@link GoverningSpecFailureReason} — never a bare
 *     `DocRecord | null`, so a caller can distinguish WHY resolution failed
 *     instead of collapsing every non-resolution into one bucket.
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
import {
  extractEvidence,
  extractDeclaredAcScope,
  resolveGoverningSpecByAcScope,
  specAcceptanceCriteriaSchema,
  type DocRecord,
  type DocId,
} from "@lore/core";

/** Script-layer clock: the one wall-clock read feeding core's `nowIso` parameter. */
const defaultNow = (): string => new Date().toISOString();

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
  /**
   * WHY {@link resolveGoverningSpec} could not name a governing spec — `null`
   * iff `specSlug !== null` (a spec WAS resolved; this ref is dangling only
   * because that spec doesn't declare `acRef`). Kept as a NAMED, distinct
   * value rather than collapsing every non-resolution into "no governing spec
   * resolvable" (task-check-ac-ref-integrity-re-implements-governing-spec —
   * an ad-hoc task's zero-match vs ambiguous-match `ac_scope` refusals are
   * different facts an auditor needs to tell apart: one means "declare a
   * scope that actually matches a spec", the other means "narrow the scope,
   * it currently matches more than one").
   */
  readonly failureReason: GoverningSpecFailureReason | null;
}

// ─── Governing-spec resolution (plan-bound walk, or ad-hoc ac_scope search) ──

/**
 * Every distinct way {@link resolveGoverningSpec} can fail to name a governing
 * spec. Never collapsed into one bucket — see {@link DanglingRef.failureReason}.
 *
 *   - `structural-walk-failed` — task is NOT `--adhoc`
 *     (`task.extra.adhoc !== true`) and the task -> plan -> spec walk broke at
 *     either hop (missing parent, wrong doc type at either hop).
 *   - `adhoc-scope-absent` — task IS `--adhoc` but declares no `ac_scope` at
 *     all (`extractDeclaredAcScope` returns `undefined`) — nothing to search with.
 *   - `adhoc-scope-empty` — task IS `--adhoc` and its `ac_scope` is the
 *     explicit EMPTY array (`[]`, `--ac-scope ""` — "this task claims
 *     nothing", distinct from omitting the flag). An empty scope is
 *     vacuously "covered" by every candidate spec, so it must be refused
 *     BEFORE reaching {@link resolveGoverningSpecByAcScope} (see that
 *     function's own `@param declaredAcScope` doc: callers must never pass
 *     an empty array in) — never silently resolved to whichever spec is
 *     scanned first.
 *   - `adhoc-scope-no-match` — task IS `--adhoc`, `ac_scope` is non-empty, but
 *     `resolveGoverningSpecByAcScope` found ZERO specs whose declared
 *     `acceptance_criteria` fully cover it.
 *   - `adhoc-scope-ambiguous` — task IS `--adhoc`, `ac_scope` is non-empty,
 *     but `resolveGoverningSpecByAcScope` found MORE THAN ONE covering spec —
 *     never guessed, so this detector can never silently pick the wrong one.
 */
export const GOVERNING_SPEC_FAILURE_REASONS = [
  "structural-walk-failed",
  "adhoc-scope-absent",
  "adhoc-scope-empty",
  "adhoc-scope-no-match",
  "adhoc-scope-ambiguous",
] as const;

/** Derived TypeScript union for a governing-spec resolution failure — see {@link GOVERNING_SPEC_FAILURE_REASONS}. */
export type GoverningSpecFailureReason = (typeof GOVERNING_SPEC_FAILURE_REASONS)[number];

/**
 * {@link resolveGoverningSpec}'s return: the resolved spec XOR a named failure
 * reason. `failureReason` is `null` exactly when `spec` is non-null (never
 * both null, never both set) — enforced by construction at every return site
 * in {@link resolveGoverningSpec}, not re-validated here.
 */
export interface GoverningSpecResolution {
  readonly spec: DocRecord | null;
  readonly failureReason: GoverningSpecFailureReason | null;
}

/**
 * Resolves a task's governing spec — the ONE locus this detector uses to
 * decide whether an evidence row's `ac_ref` is dangling. Branches on
 * `task.extra.adhoc === true` (the SAME branch
 * `TaskWorkflowService.addEvidence` already takes at write time,
 * `packages/lore/src/service/task-workflow-service.ts`), so this read-side
 * detector and the write-side acceptor can never disagree about which spec
 * governs a given task:
 *
 *   - NOT `--adhoc`: the structural `task.parent_id` (must be a live `plan`)
 *     -> `plan.parent_id` (must be a live `spec`) walk — the SAME two-hop
 *     relationship `CorpusService.resolveDeclaredAcIds`/
 *     `_resolveDeclaredAcIdsForParent` establish as this corpus's one
 *     plan-bound AC `ac_ref`-validation locus (`PARENT_TYPE_CONTRACT`: a
 *     task's only legal parent type is `plan`; a plan's legal parents are
 *     `prd`/`spec`). Re-implemented here (not imported) because that service
 *     method lives behind `bun:sqlite`-tainted `CorpusService`/`app.ts` (see
 *     module header) and only returns an id `Set`, discarding which spec it
 *     came from — this detector needs the spec's OWN identity (slug, for
 *     reporting + ledger keying), not just its declared ids.
 *   - `--adhoc` (SPEC-069 D2 — parent is structurally the root PRD, so the
 *     walk above can NEVER succeed for it): delegates to the SHARED
 *     `resolveGoverningSpecByAcScope` (`@lore/core`) — the EXACT search
 *     `CorpusService.resolveDeclaredAcIdsForAdhocTask` and
 *     `VerifyRunnerService.verifyAdhocTask` already run. Never re-implemented
 *     here (task-check-ac-ref-integrity-re-implements-governing-spec: a
 *     private copy of this search is what drifted narrower than the write
 *     path in the first place).
 *
 * @returns A {@link GoverningSpecResolution} — never a bare `DocRecord | null`,
 *   so a caller can report WHY resolution failed instead of one collapsed fact.
 * @example
 * const docsById = new Map([[plan.id, plan], [spec.id, spec]]);
 * resolveGoverningSpec(task, docsById, [spec]);
 * // => { spec, failureReason: null } (when task.parent_id === plan.id)
 * @example
 * resolveGoverningSpec(adhocTaskWithEmptyScope, new Map(), [spec]);
 * // => { spec: null, failureReason: "adhoc-scope-empty" }
 */
export function resolveGoverningSpec(
  task: DocRecord,
  docsById: ReadonlyMap<DocId, DocRecord>,
  allSpecs: readonly DocRecord[],
  now: () => string = defaultNow,
): GoverningSpecResolution {
  if (task.extra["adhoc"] === true) {
    return resolveGoverningSpecForAdhocTask(task, allSpecs, now());
  }
  return resolveGoverningSpecForPlanBoundTask(task, docsById);
}

/** The structural task -> plan -> spec walk — see {@link resolveGoverningSpec}'s non-adhoc branch. */
function resolveGoverningSpecForPlanBoundTask(
  task: DocRecord,
  docsById: ReadonlyMap<DocId, DocRecord>,
): GoverningSpecResolution {
  const unresolved: GoverningSpecResolution = { spec: null, failureReason: "structural-walk-failed" };
  if (task.parent_id === null) return unresolved;
  const plan = docsById.get(task.parent_id);
  if (plan === undefined || plan.type !== "plan") return unresolved;
  if (plan.parent_id === null) return unresolved;
  const spec = docsById.get(plan.parent_id);
  if (spec === undefined || spec.type !== "spec") return unresolved;
  return { spec, failureReason: null };
}

/**
 * The `--adhoc` branch — see {@link resolveGoverningSpec}'s adhoc branch.
 * Mirrors `CorpusService.resolveDeclaredAcIdsForAdhocTask`'s own
 * absent-vs-empty-vs-search sequencing exactly (same three refusal shapes,
 * same order), so a task that the write path would refuse an `ac_ref`
 * against is reported with the SAME named reason here.
 */
function resolveGoverningSpecForAdhocTask(
  task: DocRecord,
  allSpecs: readonly DocRecord[],
  nowIso: string,
): GoverningSpecResolution {
  const declared = extractDeclaredAcScope(task);
  if (declared === undefined) {
    return { spec: null, failureReason: "adhoc-scope-absent" };
  }
  if (declared.length === 0) {
    return { spec: null, failureReason: "adhoc-scope-empty" };
  }

  const resolved = resolveGoverningSpecByAcScope(declared, allSpecs, `task "${task.slug}"`, nowIso);
  if (!resolved.ok) {
    // `resolveGoverningSpecByAcScope`'s own documented contract (@lore/core
    // acceptance.ts `@throws`) names exactly these two refusal shapes and
    // spells out the distinguishing word for each: "matches no ... in full"
    // for zero candidates covering the scope, vs "... — ambiguous." for more
    // than one. Reading that documented word back out of the returned
    // LoreError is NOT re-deriving the search (this function never re-counts
    // covering specs itself) — it is reading the ONE search's own verdict.
    // `LoreError` is a wide discriminated union (most variants carry no
    // `message`); this function only ever returns `VALIDATION_ERROR` or
    // `STORE_ERROR` (both do), but the `in` guard keeps this correct even if
    // that ever changes, rather than asserting a shape TS cannot see.
    const message = "message" in resolved.error ? resolved.error.message : "";
    const failureReason: GoverningSpecFailureReason = message.includes("ambiguous")
      ? "adhoc-scope-ambiguous"
      : "adhoc-scope-no-match";
    return { spec: null, failureReason };
  }
  return { spec: resolved.value.spec, failureReason: null };
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
 *   {@link resolveGoverningSpec} (its `spec`-typed entries also become the
 *   `allSpecs` candidate list for an `--adhoc` task's `ac_scope` search — no
 *   separate parameter needed, `docsById` already carries every spec in scope).
 *   Tasks themselves need not be present in this map.
 * @returns One {@link DanglingRef} per DISTINCT `(task.id, ac_ref)` pair — a task
 *   with several evidence rows all naming the SAME dangling id is reported ONCE
 *   (spec: "naming each offending (task, ac_ref) pair", not each offending row).
 *   Sorted by `(taskSlug, acRef)` for deterministic report/test output.
 * @example
 * findDanglingRefs([taskWithDanglingEvidence], new Map([[plan.id, plan], [spec.id, spec]]));
 * // => [{ taskId: "...", taskSlug: "task-x", acRef: "AC-1", specSlug: "spec-y", failureReason: null }]
 */
export function findDanglingRefs(
  tasks: readonly DocRecord[],
  docsById: ReadonlyMap<DocId, DocRecord>,
  now: () => string = defaultNow,
): DanglingRef[] {
  const allSpecs = Array.from(docsById.values()).filter((doc) => doc.type === "spec");
  const seen = new Set<string>();
  const results: DanglingRef[] = [];

  for (const task of tasks) {
    const resolution = resolveGoverningSpec(task, docsById, allSpecs, now);
    const declaredIds = resolution.spec !== null ? extractDeclaredAcIds(resolution.spec) : new Set<string>();

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
        specSlug: resolution.spec?.slug ?? null,
        failureReason: resolution.failureReason,
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

/** Rule clause the detector prints (exit 5) when a ledger row matches no real dangling ac_ref. */
export const LEDGER_ORPHAN_RULE = "no longer match a real dangling ac_ref";

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
