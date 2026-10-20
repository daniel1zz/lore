/**
 * AuditService — read/verify surface over the already-LIVE `audit` table
 * (SPEC-035 §2, §5; chain-integrity + anchor surface added SPEC-079 G3).
 * Zero audit-storage schema changes beyond migration-009's additive
 * `prev_hash`/`entry_hash` columns: this service adds a query pass-through,
 * a versions⋈audit completeness oracle, a tamper-evident hash-chain walk,
 * and an external-anchor cross-check on top of `StoreInterface.queryAudit` /
 * `listVersionKeys` / `listAuditChain`. The HTTP and MCP servers run `verify` off their event loop through
 * `audit-verify-runner.ts`; this class is what the worker (and the CLI) run, unchanged.
 *
 * Public surface:
 *   query(filters)        → thin delegation to store.queryAudit
 *   verify(opts?)          → versions⋈audit completeness oracle (D5, D9) PLUS
 *                            a whole-table chain-integrity walk and an
 *                            optional external-anchor cross-check (SPEC-079 G3)
 *   getChainHead()         → `(head_id, head_hash, entry_count)` for `lore audit
 *                            anchor` to persist — VALIDATION_ERROR on an empty
 *                            audit table (SPEC-079 G3, never a silent empty anchor)
 *
 * @invariant Stateless — holds only a StoreInterface. No telemetry (audit reads are
 *   a CLI-invoked oracle, not a hot instrumented path — mirrors VersionService, which
 *   is also un-instrumented).
 * @invariant SPEC-079 G3 — `verify()`'s chain-integrity walk covers the ENTIRE
 *   `audit` table in `id` ASC order via `store.listAuditChain()`. A hash chain is
 *   only meaningful end-to-end. The external anchor (`.lore/audit-anchor.json`, written by
 *   `lore audit anchor`, read and passed in by the CLI as `opts.anchor`) is
 *   the ONLY thing that pins the chain against a full-history rewrite/rewind —
 *   see `checkAuditAnchor`'s doc comment.
 * @invariant verify()'s join key is `(doc_id, version)` PLUS an action-family check —
 *   NOT a literal string-equality match on `audit.action === versions.action`, and NOT
 *   "any audit entry carrying this version satisfies any versions row at that version"
 *   either. A versions row with action X is satisfied only by an audit entry whose
 *   action is in X's producing family (`VERSION_ACTION_AUDIT_FAMILY`): `create`→`create`;
 *   `update`→{`update`,`claim`,`release`,`evidence`} (TaskWorkflowService's shared
 *   `writeTaskExtra` helper writes versions rows under the generic action "update" but
 *   audit entries under the more specific "claim"/"release"/"evidence" (SPEC-035 §2) —
 *   this family membership is what lets those entries satisfy the oracle despite the
 *   label divergence, a DELIBERATE tolerance, not a gap); `approve`→`approve`;
 *   `reject`→`reject`; `restore`→`restore`. Critically, `judge` (SPEC-034's AI-judgment
 *   audit action) is NOT in ANY family — judgments never bump a doc's version, so an
 *   audit entry stamped `action: "judge"` must never be able to satisfy a missing
 *   create/update/approve/reject/restore audit entry merely because it happens to carry
 *   the same `details.version`. D9's "exact join" refers to replacing timestamp-tolerance
 *   fuzzy matching with an exact version number — not to requiring the audit action
 *   string to replicate the versions-row action string, but it does NOT mean "any action
 *   at all" either.
 * @invariant verify() only considers versions rows whose `action` is one of
 *   create/update/approve/reject/restore (VERIFIABLE_VERSION_ACTIONS) — `delete`
 *   is excluded (SPEC-035 §2 lists it out of the anchor set) even though
 *   CorpusService.delete also stamps `details.version` on its audit entry.
 * @invariant NO date bounds the join: every versions row is checked, however old. History that predates
 *   the audit writers is made explicit once by `lore migrate audit-backfill`, which appends hash-chained
 *   {@link AUDIT_BACKFILL_ACTION} entries marked `reconstructed`; verification then reports each versions row as
 *   audited (an original entry), reconstructed (only a backfill entry) or missing. Supersedes SPEC-035 D5's
 *   `audit.verify_since` cut-off.
 *
 * Side-effect class: IO (reads via StoreInterface only — never writes)
 *
 * Source: SPEC-035 §2, §5
 */

import { err, ok, type LoreError, type Result } from "@lore/core";
import type { DocId, VersionAction } from "@lore/core";
import type { AuditChainEntry, AuditFilters, StoreInterface, VersionKey } from "../store/store-interface.js";
import type { AuditEntry } from "@lore/core";
import { computeAuditEntryHash } from "../store/store-shared.js";

// ─── Public Types ────────────────────────────────────────────────────────────

/**
 * Versions-row actions the completeness oracle reconciles against audit entries
 * (SPEC-035 §2). `delete` is deliberately excluded from this set — see
 * {@link AuditService.verify}'s JSDoc @invariant.
 */
/**
 * The audit action `lore migrate audit-backfill` writes for a version that predates the audit writers. It satisfies
 * every verifiable family (see {@link VERSION_ACTION_AUDIT_FAMILY}) but is counted as RECONSTRUCTED, never audited.
 */
export const AUDIT_BACKFILL_ACTION = "audit-backfill";

const VERIFIABLE_VERSION_ACTIONS: ReadonlySet<VersionAction> = new Set([
  "create",
  "update",
  "approve",
  "reject",
  "restore",
]);

/**
 * Maps each {@link VERIFIABLE_VERSION_ACTIONS} entry to the set of audit `action`
 * strings that may satisfy it (SPEC-035 §2, §5 D9 follow-up). A versions row is only
 * "explained" by an audit entry whose action is a member of its family — an audit
 * entry with an action OUTSIDE every family (e.g. `"judge"`, which stamps the doc's
 * CURRENT version but never produces a versions row itself) must never incidentally
 * satisfy a family it isn't part of, even if it happens to share `(doc_id, version)`.
 *
 * `update` intentionally maps to a 6-action family, not just `"update"` — this
 * PRESERVES the intentional TaskWorkflowService/ValidityService divergence documented
 * on {@link AuditService.verify}: `TaskWorkflowService`'s shared `writeTaskExtra`
 * helper inserts every claim/release/evidence/anchors versions row under the generic
 * action `"update"` but audits under the more specific
 * `"claim"`/`"release"`/`"evidence"`/`"anchors"` (`"anchors"` added SPEC-042 D3);
 * `ValidityService.invalidate`'s `commitValidityExtra` mirrors the SAME pattern —
 * versions row `action: "update"`, audit entry `action: "invalidate"` (`"invalidate"`
 * added SPEC-043 D7, same shared-helper precedent).
 *
 * `"archive-cascade"`/`"archive-sweep"` (spec-lifecycle-archival-plan-close-cascade-deterministic
 * §Design Decisions D2/D3) are the SAME precedent applied a third time:
 * `CorpusService.cascadeArchiveOnPlanClose`/`archiveSweepCandidate` both write a
 * versions row under `action: "update"` (VersionAction has no "cascade"/"sweep"
 * member) but audit under the more specific action so the R1 cascade and the
 * `lore archive --apply` sweep are each independently distinguishable in the audit
 * log from a plain `lore set --status archived`.
 *
 * Keyed over the FULL `VersionAction` union (not just `VERIFIABLE_VERSION_ACTIONS`) so
 * the lookup at the call site never needs an `as`-cast; `delete`/`undelete` map to an empty set
 * since it's excluded from the reconcile walk upstream and is never looked up in
 * practice, but the type stays total rather than partial.
 */
const VERSION_ACTION_AUDIT_FAMILY: Readonly<Record<VersionAction, ReadonlySet<string>>> = {
  create: new Set(["create", AUDIT_BACKFILL_ACTION]),
  update: new Set([
    AUDIT_BACKFILL_ACTION,
    "update",
    "claim",
    "release",
    "evidence",
    "anchors",
    "invalidate",
    "archive-cascade",
    "archive-sweep",
    // reason: AC-DCL-3 — tree-check --fix (#276) and the ordinal backfill now write a version row (action
    // "update") like every other version bump; their specific audit actions join that family.
    "tree-fix",
    "ordinal-backfill",
  ]),
  approve: new Set(["approve", AUDIT_BACKFILL_ACTION]),
  reject: new Set(["reject", AUDIT_BACKFILL_ACTION]),
  restore: new Set(["restore", AUDIT_BACKFILL_ACTION]),
  delete: new Set(),
  undelete: new Set(),
};

/** One versions row with no matching audit entry — itemized in {@link AuditVerifyResult}. */
export interface AuditMiss {
  doc_id: DocId;
  version: number;
  action: VersionAction;
  created_at: string;
}

// ─── Tamper-evident chain walk + external anchor (SPEC-079 G3) ─────────────

/**
 * The FIRST chain-integrity break found by {@link walkAuditChain}, in `id` ASC
 * order — later breaks (if any) are never reported in the same pass; a fixed
 * break must be re-verified to surface the next one. `reason` is exhaustive:
 *   - `"unchained_row"` — `prev_hash`/`entry_hash` is NULL on this row. Legal
 *     ONLY on the contiguous pre-migration-009 prefix of a not-yet-migrated
 *     DB; post-migration (every corpus this service ever runs against) it is
 *     always a tamper/corruption finding.
 *   - `"prev_link_mismatch"` — this row's stored `prev_hash` does not equal
 *     the immediately preceding chain entry's `entry_hash` (or, for the very
 *     first row, is not the genesis value `""`). Produced by a DELETED row
 *     (the next surviving row's `prev_hash` now points at a hash that's no
 *     longer the walker's current head) or an APPENDED forged row with a
 *     fabricated `prev_hash`.
 *   - `"hash_mismatch"` — this row's own `entry_hash` does not equal
 *     {@link computeAuditEntryHash} recomputed over its (unchanged) `prev_hash`
 *     and content fields. Produced by an in-place UPDATE of a row's content
 *     (actor/action/details/etc.) without recomputing its stored hash.
 */
export interface AuditChainBreak {
  id: number;
  reason: "hash_mismatch" | "prev_link_mismatch" | "unchained_row";
}

/**
 * Result of {@link walkAuditChain} — the whole-table hash-chain-integrity walk
 * folded into {@link AuditVerifyResult.chain}. `checked` counts every row the
 * walk examined, INCLUDING the breaking row when `clean` is `false` (so
 * `checked` is always the 1-based position of `break.id` within the chain on
 * a dirty result, and the total chain length on a clean one).
 */
export interface AuditChainVerifyResult {
  clean: boolean;
  checked: number;
  break?: AuditChainBreak;
}

/**
 * The `(head_id, head_hash)` pair `lore audit anchor` persists to
 * `.lore/audit-anchor.json` (plus `entry_count`/`anchored_at`, irrelevant to
 * the cross-check itself) — passed into {@link AuditService.verify} as
 * `opts.anchor` by the CLI when that file is present. This service never
 * reads the file itself (services have no fs access, SPEC-079 G3 design) —
 * the CLI adapter reads/parses it, mirroring how `lore.tree.yaml` is loaded
 * by the CLI and handed to `getReviewBundle` as an already-parsed value.
 */
export interface AuditAnchorRef {
  head_id: number;
  head_hash: string;
}

/**
 * Result of {@link checkAuditAnchor} — folded into
 * {@link AuditVerifyResult.anchor}. Three states, never a boolean, so a
 * caller can never mistake "no anchor was ever set" for "the anchor was
 * checked and found clean" — an absent anchor is a FACT about this corpus's
 * configuration, not a passing check:
 *   - `"absent"` — no anchor file was supplied (`opts.anchor` omitted). No
 *     anchor cross-check ran; this is NEVER folded into `clean: true` as if
 *     it were a pass.
 *   - `"clean"` — a chain entry with `id === head_id` exists and its stored
 *     `entry_hash` equals `head_hash`.
 *   - `"anchor_mismatch"` — the anchored row is gone (`"row_missing"` — the
 *     chain was rewound/truncated past the anchor point) or its hash no
 *     longer matches (`"hash_mismatch"` — the anchored row was rewritten
 *     in place after being anchored).
 */
export type AuditAnchorVerifyResult =
  | { status: "absent" }
  | { status: "clean"; head_id: number; head_hash: string }
  | {
      status: "anchor_mismatch";
      head_id: number;
      head_hash: string;
      reason: "row_missing" | "hash_mismatch";
    };

/**
 * `(head_id, head_hash, entry_count)` for the current chain head — the
 * value {@link AuditService.getChainHead} resolves for `lore audit anchor`
 * to persist (plus its own `anchored_at` timestamp, which is an adapter
 * concern, not a service one).
 */
export interface AuditChainHead {
  head_id: number;
  head_hash: string;
  entry_count: number;
}

/**
 * Walks a full `id`-ASC audit chain (as returned by
 * `StoreInterface.listAuditChain()`) and reports the FIRST break, if any.
 * Pure — no IO, no store access; `AuditService.verify` is its only caller.
 * See {@link AuditChainBreak}'s doc comment for the three break reasons and
 * the precedence between them (checked in the order below: a NULL hash pair
 * is checked before either comparison, since a missing hash can't be
 * compared against anything; a bad `prev_hash` link is checked before
 * recomputing THIS row's own hash, since a chain sample gathered under a
 * DIFFERENT `prev_hash` context — content is identical but predecessor
 * changed — would otherwise spuriously report `hash_mismatch` on a row that
 * is not itself the rewritten one).
 */
export function walkAuditChain(chain: readonly AuditChainEntry[]): AuditChainVerifyResult {
  let expectedPrevHash = "";
  for (let i = 0; i < chain.length; i++) {
    const entry = chain[i] as AuditChainEntry;
    const checked = i + 1;

    if (entry.entry_hash === null || entry.prev_hash === null) {
      return { clean: false, checked, break: { id: entry.id, reason: "unchained_row" } };
    }
    if (entry.prev_hash !== expectedPrevHash) {
      return { clean: false, checked, break: { id: entry.id, reason: "prev_link_mismatch" } };
    }
    if (computeAuditEntryHash(entry, expectedPrevHash) !== entry.entry_hash) {
      return { clean: false, checked, break: { id: entry.id, reason: "hash_mismatch" } };
    }
    expectedPrevHash = entry.entry_hash;
  }
  return { clean: true, checked: chain.length };
}

/**
 * Cross-checks an optional external anchor against the current chain. Pure —
 * no IO. See {@link AuditAnchorVerifyResult}'s doc comment for the three
 * states.
 */
export function checkAuditAnchor(
  chain: readonly AuditChainEntry[],
  anchor: AuditAnchorRef | undefined,
): AuditAnchorVerifyResult {
  if (anchor === undefined) return { status: "absent" };

  const anchoredRow = chain.find((entry) => entry.id === anchor.head_id);
  if (anchoredRow === undefined) {
    return { status: "anchor_mismatch", head_id: anchor.head_id, head_hash: anchor.head_hash, reason: "row_missing" };
  }
  if (anchoredRow.entry_hash !== anchor.head_hash) {
    return { status: "anchor_mismatch", head_id: anchor.head_id, head_hash: anchor.head_hash, reason: "hash_mismatch" };
  }
  return { status: "clean", head_id: anchor.head_id, head_hash: anchor.head_hash };
}

/** How every verifiable versions row stands against the audit table: audited, reconstructed or missing. */
export interface VersionReconciliation {
  /** Versions rows explained by an original audit entry of their action family. */
  audited: number;
  /** Versions rows explained ONLY by an {@link AUDIT_BACKFILL_ACTION} entry (`lore migrate audit-backfill`). */
  reconstructed: number;
  /** Versions rows no audit entry explains. */
  misses: AuditMiss[];
}

/**
 * The completeness join, pure: every verifiable versions row is looked up by `(doc_id, details.version)` in the audit
 * entries and its action family ({@link VERSION_ACTION_AUDIT_FAMILY}). No date bounds it. Shared by
 * {@link AuditService.verify} and the backfill (which reconstructs exactly the `misses`).
 *
 * @param versions - versions rows (any action; non-verifiable ones such as `delete` are skipped)
 * @param audit - every audit entry
 */
export function reconcileVersions(versions: readonly VersionKey[], audit: readonly AuditEntry[]): VersionReconciliation {
  // reason: build the (doc_id, version) -> {audit actions seen} index once — O(audit) — rather than querying per
  // versions row. The join key is (doc_id, version) PLUS the action family, never bare version equality (which would
  // let an unrelated action like "judge" satisfy a missing create/update/approve/reject/restore entry).
  const actionsByPair = new Map<string, Set<string>>();
  for (const entry of audit) {
    if (entry.doc_id === undefined) continue;
    const detailVersion = entry.details?.["version"];
    if (typeof detailVersion !== "number") continue;
    const key = `${entry.doc_id}::${detailVersion}`;
    const actions = actionsByPair.get(key) ?? new Set<string>();
    actions.add(entry.action);
    actionsByPair.set(key, actions);
  }

  let audited = 0;
  let reconstructed = 0;
  const misses: AuditMiss[] = [];
  for (const v of versions) {
    if (!VERIFIABLE_VERSION_ACTIONS.has(v.action)) continue;
    const seen = actionsByPair.get(`${v.doc_id}::${v.version}`);
    const family = VERSION_ACTION_AUDIT_FAMILY[v.action];
    const original = seen !== undefined && [...family].some((a) => a !== AUDIT_BACKFILL_ACTION && seen.has(a));
    if (original) audited++;
    else if (seen?.has(AUDIT_BACKFILL_ACTION) === true) reconstructed++;
    else misses.push({ doc_id: v.doc_id, version: v.version, action: v.action, created_at: v.created_at });
  }
  return { audited, reconstructed, misses };
}

/** Result of {@link AuditService.verify}. */
export interface AuditVerifyResult {
  clean: boolean;
  misses: AuditMiss[];
  /** Versions rows explained by an original audit entry. */
  audited: number;
  /** Versions rows explained only by a backfill entry — history reconstructed by `lore migrate audit-backfill`. */
  reconstructed: number;
  /** Whole-table hash-chain-integrity walk (SPEC-079 G3); backfill entries are chained like any audit row. */
  chain: AuditChainVerifyResult;
  /**
   * External-anchor cross-check (SPEC-079 G3) — `{status: "absent"}` when
   * `opts.anchor` was omitted (no `.lore/audit-anchor.json` on disk, or the
   * caller chose not to pass it). Never silently folded into a pass.
   */
  anchor: AuditAnchorVerifyResult;
}

/** Options for {@link AuditService.verify}. */
export interface VerifyOpts {
  /**
   * The parsed `.lore/audit-anchor.json` head ref, if the CLI found one on
   * disk — see {@link AuditAnchorRef}. Omitted → the anchor cross-check
   * reports `{status: "absent"}`, never a silent pass.
   */
  anchor?: AuditAnchorRef;
}

// ─── AuditService ────────────────────────────────────────────────────────────

export class AuditService {
  /** @param store - Storage abstraction (same instance passed to every other service) */
  constructor(private readonly store: StoreInterface) {}

  /**
   * Thin delegation to `store.queryAudit(filters)` — the query half of the audit
   * read surface (`lore audit --actor ... --action ... --since ...`, SPEC-035 §2).
   *
   * @param filters - See {@link AuditFilters} — doc_id/actor/action/since/limit
   * @returns Result<AuditEntry[], LoreError> — newest-first (store contract)
   */
  async query(filters: AuditFilters): Promise<Result<AuditEntry[], LoreError>> {
    return this.store.queryAudit(filters);
  }

  /**
   * Completeness oracle: for EVERY `versions` row whose action is in
   * {@link VERIFIABLE_VERSION_ACTIONS} (no date skips any), demand at least one audit
   * entry sharing `(doc_id, details.version)` WHOSE ACTION IS A MEMBER OF THE VERSIONS
   * ROW'S ACTION FAMILY (`VERSION_ACTION_AUDIT_FAMILY`, see {@link reconcileVersions}).
   * Order-independent — the join key is a version number, never a timestamp window (D9).
   * Each row is reported as audited, reconstructed (only a backfill entry) or missing.
   *
   * SPEC-079 G3: ALSO recomputes the whole-table hash chain ({@link walkAuditChain})
   * and, when `opts.anchor` is supplied, cross-checks it against the chain
   * ({@link checkAuditAnchor}). `clean` is the conjunction of all three:
   * `misses.length === 0 AND chain.clean AND anchor.status !== "anchor_mismatch"`.
   *
   * @param opts - `{ anchor? }` — the parsed `.lore/audit-anchor.json` head ref, if the
   *   CLI found one on disk.
   * @returns Result<AuditVerifyResult, LoreError>
   *
   * @example
   * const result = await auditService.verify();
   * if (result.ok && !result.value.clean) {
   *   for (const miss of result.value.misses) console.error(miss);
   *   if (!result.value.chain.clean) console.error(result.value.chain.break);
   *   if (result.value.anchor.status === "anchor_mismatch") console.error(result.value.anchor);
   * }
   */
  async verify(opts?: VerifyOpts): Promise<Result<AuditVerifyResult, LoreError>> {
    // reason: the join uses four columns of a versions row; `listVersionKeys` reads only those (from a covering
    // index), never the row's content/extra snapshot, so this step's cost does not grow with document size.
    const versionsResult = await this.store.listVersionKeys();
    if (!versionsResult.ok) return versionsResult;

    const auditResult = await this.store.queryAudit({});
    if (!auditResult.ok) return auditResult;
    const { audited, reconstructed, misses } = reconcileVersions(versionsResult.value, auditResult.value);

    // SPEC-079 G3 — the chain walk covers the WHOLE table (see this class's `@invariant`).
    const chainResult = await this.store.listAuditChain();
    if (!chainResult.ok) return chainResult;

    const chain = walkAuditChain(chainResult.value);
    const anchor = checkAuditAnchor(chainResult.value, opts?.anchor);

    const clean = misses.length === 0 && chain.clean && anchor.status !== "anchor_mismatch";

    return ok({ clean, misses, audited, reconstructed, chain, anchor });
  }

  /**
   * Resolves the current chain head for `lore audit anchor` to persist to
   * `.lore/audit-anchor.json` (SPEC-079 G3). This service never touches the
   * filesystem — the CLI adapter does the actual write; this method only
   * supplies the value.
   *
   * @returns `err(VALIDATION_ERROR)` when the audit table is empty (there is
   *   nothing to anchor — never a silent/degenerate anchor); otherwise the
   *   current `(head_id, head_hash, entry_count)`.
   */
  async getChainHead(): Promise<Result<AuditChainHead, LoreError>> {
    const chainResult = await this.store.listAuditChain();
    if (!chainResult.ok) return chainResult;

    const chain = chainResult.value;
    if (chain.length === 0) {
      return err({
        code: "VALIDATION_ERROR",
        field: "audit_chain",
        message: "Cannot anchor: the audit table is empty — nothing to pin a trust root to.",
        rule: "BR-479",
      });
    }

    const head = chain[chain.length - 1] as AuditChainEntry;
    if (head.entry_hash === null) {
      // reason: unreachable against a post-migration-009 corpus (D4 — every
      // row is backfilled with a real hash) but a broken chain must never
      // be silently anchored, so this is checked rather than asserted away.
      return err({
        code: "VALIDATION_ERROR",
        field: "audit_chain",
        message: `Cannot anchor: chain head (audit row id ${head.id}) has no entry_hash — run \`lore audit --verify\` to locate the break first.`,
        rule: "BR-479",
      });
    }

    return ok({ head_id: head.id, head_hash: head.entry_hash, entry_count: chain.length });
  }
}
