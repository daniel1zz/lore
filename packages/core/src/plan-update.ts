/**
 * Update-plan domain — the pure five-state freshness classifier behind
 * `lore setup --check` and update-mode `lore setup` (SPEC-076 §C3,
 * Downstream Handoff). Sibling of `setup-manifest.ts::planInstall`, NOT a
 * wrapper around it — install and update carry different invariants (a
 * fresh install has no "diverged" concept at all; Domain ruling, SPEC-076
 * §C7/D3). Pure, browser-safe module: no IO, no `Date.now()`/`Math.random()`
 * calls.
 *
 * Public surface:
 *   - FileFreshness / FILE_FRESHNESS_STATES — the closed five-state union
 *   - UpdateProbe — the injected read port `planUpdate` consults for on-disk
 *     truth (per-path sha lookup + managed-dir enumeration)
 *   - EmbeddedAssetsManifest / EmbeddedAssetEntry — the shape `planUpdate`
 *     expects for its `embedded` argument (see Invariants below for why this
 *     is a LOCAL structural mirror, not an import of the real generated type)
 *   - UpdatePlannedWrite / UpdatePlannedMerge / UpdatePlannedMarkerRewrite — one action-bucket
 *     row each
 *   - UpdatePlan — the full classification + action-plan output
 *   - planUpdate(embedded, installed, probe) — the pure decision function
 *
 * Invariants:
 *   - PURE — `planUpdate` takes only in-memory parameters. All on-disk truth
 *     (per-file sha256, managed-dir enumeration) arrives through the
 *     caller-injected `UpdateProbe` port; this module never touches the
 *     filesystem itself. Mirrors `drift-check-service.ts`'s `FsProbe` port
 *     precedent — "pure classifier + real fs behind a port" — chosen over a
 *     bare `(path) => sha|missing` function specifically because `orphaned`
 *     (disk has an untracked file) is undiscoverable from per-path lookups
 *     alone; `listManagedPaths()` is the enumeration half of the port. This
 *     design decision — and the full HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/
 *     REGRESSION coverage matrix it must satisfy — is recorded in the paired
 *     RED test file's header comment
 *     (`packages/lore/tests/unit/core/plan-update.test.ts`), which is this
 *     module's authoritative contract.
 *   - `EmbeddedAssetsManifest`/`EmbeddedAssetEntry` declared HERE are a
 *     STRUCTURAL MIRROR of `packages/lore/src/generated/assets-manifest.ts`'s
 *     same-named types, not an import of them — `@lore/core` has zero
 *     dependency on `@lore/lore` (the generated file lives in the CONSUMING
 *     package, wrong direction for `@lore/core` to import from). The
 *     Downstream Handoff in SPEC-076 itself declares these types as
 *     "`@lore/core` — 新增类型" for exactly this reason. `kind` is typed as a
 *     bare `string` here (not a closed union) because the generated file's
 *     `AssetEntryKind` (`skill|agent|hook|governance|project`) and this
 *     package's own `SetupEntryKind` (`skill|agent|hook|governance|
 *     settings-hook|mcp`) are DIFFERENT closed unions (the former lacks
 *     `settings-hook`/`mcp`, the latter lacks `project`) — narrowing to
 *     either would make real `EmbeddedAssetsManifest` values non-assignable
 *     to this module's parameter type. `kind` is carried through to
 *     `UpdatePlannedWrite`/`UpdatePlannedMerge` for the service-layer
 *     consumer's benefit but is NOT read by any classification decision in
 *     this module.
 *   - Update-planner output types carry an `Update` prefix
 *     (`UpdatePlannedWrite`/`UpdatePlannedMerge`/`UpdatePlannedMarkerRewrite`)
 *     to avoid a same-package export collision with `setup-manifest.ts`'s
 *     OWN `PlannedWrite`/`PlannedSkip` (the install-time planner's output
 *     rows) — both modules are re-exported from this package's single flat
 *     barrel (`index.ts`), so the names must be distinct even though the two
 *     planners are conceptually siblings, not variants of one shape.
 *   - Ownership for action-bucket assignment is read from the EMBEDDED
 *     entry, never the installed manifest entry (SPEC-076 C1: "ownership 在
 *     AssetSource 装载时声明" — the embedded/target definition is the
 *     declaring source; a stale installed-manifest copy of `ownership` is
 *     migration-fallback data, `setup-manifest.ts::deriveOwnershipFromKind`'s
 *     concern, not this module's).
 *   - `user_once` ownership NEVER lands in any action bucket, regardless of
 *     classified state — including `missing` (C1: "永不再碰" / "never
 *     touched again" overrides even the restore-on-missing default every
 *     other ownership zone gets). `merged` ownership routes both `outdated`
 *     and `missing` states to `merges`, never `writes`.
 *   - `markerRewrites` is ALWAYS EMPTY in this module. CLAUDE.md's
 *     marker-section special case (SPEC-076 C1's fourth, unnamed-ownership
 *     row) is SPEC-076 T6's exclusive concern (a distinct claimed task, out
 *     of this task's anchors) — the field exists here only because the
 *     Downstream Handoff's `UpdatePlan` shape requires it, and the paired RED
 *     test file exercises zero populated-markerRewrites scenarios. A future
 *     T6 change wires real detection; this module does not guess at it.
 *   - Digest short-circuit: `installed.assets_digest === embedded.tree_digest`
 *     (both present, exact string equality — never a prefix/substring check,
 *     the paired RED test's REGRESSION case guards this) skips per-file
 *     comparison entirely and returns `summary: "sync"` with ZERO probe
 *     calls. A missing `assets_digest` (legacy manifest) or a missing
 *     `installed` manifest (fresh target) always forces full per-entry
 *     expansion.
 *   - `summary` on the full-expansion path is derived from the ACTUAL
 *     classified states (`"sync"` iff every embedded entry classifies as
 *     `sync`), never from the digest mismatch alone — a full expansion that
 *     happens to find every entry byte-identical still reports `"sync"`.
 *     `orphaned` entries never affect `summary` (SPEC-076 §C3: "orphaned 不
 *     影响 exit code").
 *   - A throwing probe (either port member) aborts the WHOLE call with
 *     `err(STORE_ERROR)` — never a partial/ok plan (mirrors
 *     `fs-walk.ts`'s "any throw during an injected IO-like read converts to
 *     STORE_ERROR" convention, the established precedent for wrapping a
 *     caller-injected port's exceptions in this codebase).
 *
 * Source: SPEC-076 §C1 (ownership three-zone model), §C3 (five-state
 *   classification table + digest short-circuit), Downstream Handoff (type
 *   contract) — task-skill-implement-t3-planupdate-five-state-pure-classifier.
 */

import { err, ok } from "./errors.js";
import type { Result, LoreError } from "./errors.js";
import type { AssetOwnership, SetupManifest } from "./setup-manifest.js";

// ─── Freshness states ───────────────────────────────────────────────────────

/** The closed five-state freshness classification (SPEC-076 §C3). */
export const FILE_FRESHNESS_STATES = ["sync", "outdated", "diverged", "missing", "orphaned"] as const;

/** One entry's freshness relative to the embedded (target) and installed (recorded) manifests. */
export type FileFreshness = (typeof FILE_FRESHNESS_STATES)[number];

// ─── Injected probe port ────────────────────────────────────────────────────

/**
 * Injected read port `planUpdate` consults for on-disk truth. Two members
 * because a bare per-path lookup can only answer questions about paths the
 * caller already knows to ask about — it can never surface a genuinely
 * unknown on-disk path, which `orphaned` detection requires. Both members are
 * synchronous (mirrors `drift-check-service.ts::FsProbe`); the real
 * filesystem-backed implementation is a service-layer concern, entirely out
 * of this module's scope.
 */
export interface UpdateProbe {
  /** Per-path sha256 lookup. Returns `"missing"` when the path does not exist on disk. */
  resolve(path: string): { sha256: string } | "missing";
  /** Sync enumeration of every path currently on disk under lore-managed directories (POSIX-relative). */
  listManagedPaths(): string[];
}

// ─── Embedded manifest shape (structural mirror — see module Invariants) ──

/**
 * One embedded-manifest entry, as `planUpdate` needs it. Structurally
 * compatible with `packages/lore/src/generated/assets-manifest.ts`'s
 * `EmbeddedAssetEntry` — see module-level Invariants for why this is a local
 * mirror rather than an import.
 */
export interface EmbeddedAssetEntry {
  readonly path: string;
  readonly kind: string;
  readonly ownership: AssetOwnership;
  readonly sha256: string;
}

/** The embedded (target) asset manifest `planUpdate` classifies against. */
export interface EmbeddedAssetsManifest {
  readonly binary_version: string;
  /** sha256 over sorted (path, sha256) pairs — the digest-short-circuit comparison value. */
  readonly tree_digest: string;
  readonly entries: readonly EmbeddedAssetEntry[];
}

// ─── Planner output ─────────────────────────────────────────────────────────

/** One managed-ownership file `planUpdate` decided must be (re)written. */
export interface UpdatePlannedWrite {
  readonly path: string;
  readonly kind: string;
}

/** One merged-ownership file (outdated or missing) routed to the merge machinery instead of a plain write. */
export interface UpdatePlannedMerge {
  readonly path: string;
  readonly kind: string;
}

/** One CLAUDE.md-style marker-section rewrite. Always empty in this module — see Invariants (T6 owns population). */
export interface UpdatePlannedMarkerRewrite {
  readonly path: string;
}

/**
 * The full pure decision output of {@link planUpdate}.
 *
 * @invariant `files` always has all five {@link FileFreshness} keys present
 *   (empty arrays where nothing classified into that state).
 * @invariant `writes`, `merges`, and `markerRewrites` are mutually exclusive
 *   over `path` — a path appears in at most one action bucket.
 */
export interface UpdatePlan {
  /** Digest-short-circuit result: `"sync"` iff every non-orphaned embedded entry classifies as `sync`. */
  readonly summary: "sync" | "stale";
  readonly files: Record<FileFreshness, string[]>;
  readonly writes: UpdatePlannedWrite[];
  readonly merges: UpdatePlannedMerge[];
  readonly markerRewrites: UpdatePlannedMarkerRewrite[];
}

// ─── Classifier ─────────────────────────────────────────────────────────────

function emptyFileBuckets(): Record<FileFreshness, string[]> {
  return { sync: [], outdated: [], diverged: [], missing: [], orphaned: [] };
}

/**
 * Classifies one embedded entry's freshness given its on-disk probe result
 * and the installed manifest's recorded sha (`undefined` when the installed
 * manifest has no entry for this path at all — treated as "no provenance
 * signal", which falls through to `diverged` for any present-but-differing
 * disk content, or `missing` when disk has nothing either).
 */
function classifyEntry(
  diskResult: { sha256: string } | "missing",
  manifestSha: string | undefined,
  embeddedSha: string,
): FileFreshness {
  if (diskResult === "missing") {
    return "missing";
  }
  const diskSha = diskResult.sha256;
  if (diskSha === manifestSha) {
    return diskSha === embeddedSha ? "sync" : "outdated";
  }
  return "diverged";
}

/**
 * Pure five-state freshness classifier + update action planner (SPEC-076
 * §C3, Downstream Handoff). See module-level doc comment for the full
 * invariant set (digest short-circuit, ownership-driven action routing,
 * probe-throw error handling).
 *
 * @param embedded - The embedded (target) asset manifest — what SHOULD be on
 *   disk, per the currently-running binary.
 * @param installed - The installed manifest from the target's last
 *   successful `lore setup` run, or `null` on a fresh target (no prior
 *   state — every embedded entry then classifies as `missing`).
 * @param probe - Caller-injected on-disk read port (never touched directly
 *   by this module).
 * @returns `ok(UpdatePlan)` on success; `err({code: "STORE_ERROR", ...})`
 *   if the probe throws for any path — never a partial plan.
 * @throws Never — probe exceptions are caught and converted to a `Result`.
 * @example
 * planUpdate(embeddedManifest, installedManifest, fsProbe);
 * // => { ok: true, value: { summary: "stale", files: {...}, writes: [...], merges: [], markerRewrites: [] } }
 */
export function planUpdate(
  embedded: EmbeddedAssetsManifest,
  installed: SetupManifest | null,
  probe: UpdateProbe,
): Result<UpdatePlan, LoreError> {
  // Digest short-circuit (SPEC-076 §C3 "整树 digest 相等 → 短路返回 sync") — exact
  // string equality only; a near-miss digest MUST fall through to full expansion.
  if (installed?.assets_digest !== undefined && installed.assets_digest === embedded.tree_digest) {
    const files = emptyFileBuckets();
    for (const entry of embedded.entries) {
      files.sync.push(entry.path);
    }
    return ok({ summary: "sync", files, writes: [], merges: [], markerRewrites: [] });
  }

  const files = emptyFileBuckets();
  const writes: UpdatePlannedWrite[] = [];
  const merges: UpdatePlannedMerge[] = [];
  let allSync = true;

  for (const entry of embedded.entries) {
    const manifestEntry = installed?.entries.find((e) => e.path === entry.path);

    let diskResult: { sha256: string } | "missing";
    try {
      diskResult = probe.resolve(entry.path);
    } catch (caught) {
      return err({
        code: "STORE_ERROR",
        message: `planUpdate: probe.resolve threw for "${entry.path}": ${caught instanceof Error ? caught.message : String(caught)}`,
        ...(caught instanceof Error ? { cause: caught } : {}),
      });
    }

    const state = classifyEntry(diskResult, manifestEntry?.sha256, entry.sha256);
    files[state].push(entry.path);

    if (state !== "sync") {
      allSync = false;
    }

    // Action-bucket routing: user_once is NEVER actioned (C1 "永不再碰"),
    // regardless of state — including missing. diverged/sync/orphaned never
    // route to an action bucket at all.
    if (entry.ownership === "user_once") {
      continue;
    }
    if (state === "outdated" || state === "missing") {
      if (entry.ownership === "merged") {
        merges.push({ path: entry.path, kind: entry.kind });
      } else {
        writes.push({ path: entry.path, kind: entry.kind });
      }
    }
  }

  // Orphan discovery (SPEC-076 §C3: disk has a lore-managed-dir file, neither
  // manifest tracks it). Only reached on the full-expansion path — the
  // digest short-circuit above returns before this line, so listManagedPaths
  // is never called when the tree digests already match (HAPPY test pin).
  const knownPaths = new Set<string>(embedded.entries.map((e) => e.path));
  for (const e of installed?.entries ?? []) {
    knownPaths.add(e.path);
  }

  let managedPaths: string[];
  try {
    managedPaths = probe.listManagedPaths();
  } catch (caught) {
    return err({
      code: "STORE_ERROR",
      message: `planUpdate: probe.listManagedPaths threw: ${caught instanceof Error ? caught.message : String(caught)}`,
      ...(caught instanceof Error ? { cause: caught } : {}),
    });
  }

  for (const path of managedPaths) {
    if (!knownPaths.has(path)) {
      files.orphaned.push(path);
    }
  }

  return ok({
    summary: allSync ? "sync" : "stale",
    files,
    writes,
    merges,
    markerRewrites: [],
  });
}
