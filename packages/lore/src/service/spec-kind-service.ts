/**
 * SpecKindService — heuristic audit for mistyped `spec.extra.spec_kind`.
 *
 * Backs `lore migrate spec-kind [--dry-run]` (SPEC-032 §3.4). Mirrors
 * `PhaseService.migratePhases` (packages/lore/src/service/phase-service.ts)
 * structurally: a small, stateless, `StoreInterface`-only service holding a
 * single one-shot audit/migration method, wired directly into `App` (never
 * folded into `CorpusService`, which already owns spec-kind's DEFAULT-on-create
 * materialization — this is a distinct, occasional-use operational sweep, not
 * everyday CRUD).
 *
 * @invariant migrateSpecKind is idempotent — a doc whose `extra.spec_kind` is
 *   already `"tech"` or `"design"` is always skipped, so a second run over an
 *   already-applied corpus reports zero candidates.
 * @invariant dryRun performs ZERO writes — candidates are computed and
 *   returned, `this.store.update` is never called.
 * @invariant Never invokes an AI provider — the heuristic
 *   (`detectSpecKindSignal` in `@lore/core`) is pure regex matching. This
 *   command has no `--ai` mode; SPEC-032 §3.4 requires the report to be
 *   100% reproducible and transparent (fired signal always shown).
 *
 * Side-effect class: IO (reads and writes via StoreInterface).
 * Source: SPEC-032 §3.4
 */

import { detectSpecKindSignal, ok, type LoreError, type Result } from "@lore/core";
import type { SpecKindHeuristicField, SpecKindHeuristicKind } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/** One spec doc flagged as a likely `tech`/`design` mistype. */
export interface SpecKindCandidate {
  id: string;
  slug: string;
  title: string;
  /** Current effective spec_kind — always "feature" (candidates are drawn only from that pool). */
  from: "feature";
  /** Heuristic-suggested reclassification. */
  to: SpecKindHeuristicKind;
  /** The literal substring that fired the pattern (transparency over cleverness). */
  signal: string;
  /** Which field (title wins over content) supplied the signal. */
  matchedIn: SpecKindHeuristicField;
}

/**
 * Result of a `lore migrate spec-kind [--dry-run]` invocation.
 * @example { touched: 2, skipped: 8, dryRun: true, candidates: [...] }
 */
export interface SpecKindMigrationReport {
  /** Number of spec rows flagged (and, when not dryRun, updated). */
  touched: number;
  /** Number of spec rows left alone (already tech/design, or no signal fired). */
  skipped: number;
  /** When true, no writes were performed — report shows what would happen. */
  dryRun: boolean;
  /** Full detail per flagged doc, in scan order. */
  candidates: SpecKindCandidate[];
}

// ─── SpecKindService ───────────────────────────────────────────────────────

export class SpecKindService {
  /**
   * @param store - Storage abstraction (same instance passed to CorpusService)
   */
  constructor(
    private readonly store: StoreInterface,
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer. This service never calls `store.update` / `insertVersion` / `appendAuditEntry` itself.
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store);
  }

  private readonly writer: DocWritePort;

  // ── migrateSpecKind ───────────────────────────────────────────────────────

  /**
   * One-shot audit sweep: scans every `spec` doc still classified as
   * `"feature"` (explicit or defaulted — pre-SPEC-032 rows may have no
   * `extra.spec_kind` at all, which is treated the same as `"feature"`),
   * and heuristically flags those whose title/content suggests `tech` or
   * `design`. Docs already classified as non-`"feature"` are always skipped
   * — this is what makes re-running the sweep idempotent.
   *
   * @param opts.dryRun - When true, reports candidates without writing.
   * @returns SpecKindMigrationReport with touched/skipped counts + candidate detail.
   * Source: SPEC-032 §3.4
   */
  async migrateSpecKind(
    opts: { dryRun?: boolean } = {},
  ): Promise<Result<SpecKindMigrationReport, LoreError>> {
    const dryRun = opts.dryRun ?? false;

    const specsResult = await this.store.findMany({ type: "spec" });
    if (!specsResult.ok) return specsResult;

    let touched = 0;
    let skipped = 0;
    const candidates: SpecKindCandidate[] = [];

    for (const spec of specsResult.value) {
      const currentKind = spec.extra["spec_kind"];
      // Already explicitly classified as tech/design → already handled, skip.
      // reason: undefined (pre-SPEC-032 row) and "feature" (default or explicit)
      // are both treated as "still in the feature pool" — the audit's whole job
      // is to catch mistyped members of that pool regardless of how they got there.
      if (currentKind === "tech" || currentKind === "design") {
        skipped++;
        continue;
      }

      const signal = detectSpecKindSignal(spec.title, spec.content);
      if (!signal) {
        skipped++;
        continue;
      }

      touched++;
      candidates.push({
        id: spec.id,
        slug: spec.slug,
        title: spec.title,
        from: "feature",
        to: signal.kind,
        signal: signal.signal,
        matchedIn: signal.matchedIn,
      });

      if (!dryRun) {
        const newExtra: Record<string, unknown> = { ...spec.extra, spec_kind: signal.kind };
        // reason: a classification migration is a sanctioned metadata edit (lock "none"); it now bumps the version
        // and leaves its version + audit rows (before AC-DCL-5 it was a bare `store.update` that left neither).
        const written = await this.writer.writeDoc({
          doc: spec,
          patch: { extra: newExtra },
          action: "update",
          changeSummary: `spec_kind classified as ${signal.kind} (${signal.signal})`,
          auditAction: "update",
          auditDetails: { operation: "spec-kind-migration", spec_kind: signal.kind, signal: signal.signal },
          lock: "none",
        });
        if (!written.ok) return written;
      }
    }

    return ok({ touched, skipped, dryRun, candidates });
  }
}
