/**
 * The per-corpus arming step for state-binding (SPEC-143 AC-CT-3, C1, R13): reports how many
 * existing evidence rows would become `unbound` if the corpus were armed NOW, and writes the one
 * `state-binding-armed` audit row that makes the cutoff real.
 *
 * Public surface:
 *   - StateBindingService.reportImpact()  — read-only legacy-row report (R13: shown BEFORE arming)
 *   - StateBindingService.arm(opts)       — idempotent: writes the arming row once per corpus
 *   - ArmingImpactReport / ArmingResult
 *
 * Invariants:
 *   - ⛔ Never arm before the runner writes stamps (CT-2, merged): a corpus armed earlier would
 *     refuse every new row. This service cannot check that, so `arm` is reachable only through an
 *     explicit operator step (`lore audit arm --confirm`), never from startup. A FRESH `lore init` corpus is armed by init itself (zero rows affected).
 *   - Idempotent: a second `arm` writes nothing and reports the existing cutoff.
 *   - The arming row is a NON-doc audit row (`doc_id` absent) on the append-only, hash-chained
 *     audit table, so it cannot be backdated or renumbered (G3).
 *   - The clock is injected (`nowIso`); this service never reads it.
 *   - The report counts exactly what the classifier would decide: it reuses
 *     `resolveRecordedAuditIds`, not a second derivation.
 *
 * Side-effect class: stateful (one audit append, only from `arm`).
 *
 * Source: spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-3 / C1 / R13.
 */

import {
  err,
  extractEvidence,
  ok,
  resolveRecordedAuditIds,
  STATE_BINDING_ARMED_ACTION,
  type LoreError,
  type Result,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { readArmingRev } from "./stamp-binding-reader.js";
import { isInsideGitRepository } from "./git-state-stamp.js";

/** What arming now would do to the existing back-catalogue (SPEC-143 R13). */
export interface ArmingImpactReport {
  /** Task/phase docs carrying at least one evidence row. */
  readonly docs_with_evidence: number;
  readonly evidence_rows: number;
  /** Rows carrying a runner `attestation` (the only rows with a stamp-axis reading). */
  readonly attested_rows: number;
  /** Evidence rows (any kind) with neither a `recorded_corpus_rev` nor an evidence audit row. */
  readonly unresolved_evidence_rows: number;
  /**
   * Attested, stamp-less rows with no resolvable audit id: these become `unbound` /
   * `audit_id_unresolved` and are refused by the floors the moment the corpus is armed.
   */
  readonly would_become_unbound_rows: number;
  readonly would_become_unbound_docs: number;
  /** Slugs of the docs holding those rows, sorted. */
  readonly would_become_unbound_slugs: readonly string[];
}

/** Outcome of {@link StateBindingService.arm}. */
export type ArmingResult =
  | { readonly status: "armed"; readonly arming_rev: number; readonly report: ArmingImpactReport }
  | { readonly status: "already_armed"; readonly arming_rev: number };

/** Options for {@link StateBindingService.arm}. */
export interface ArmOptions {
  readonly actor: string;
  readonly nowIso: string;
}

/**
 * Whether state binding is armed for a corpus, with the reason when it is not. Reported by
 * `lore init` and `lore status` (SPEC-143 AC-CT-3b) so an unarmed corpus is never silent.
 * `not_a_git_repo`: the corpus root is outside any git repository (nothing to stamp against);
 * `not_armed`: inside a repository but never armed (an existing corpus awaiting `lore audit arm`).
 */
export type StateBindingState =
  | { readonly armed: true; readonly arming_rev: number }
  | { readonly armed: false; readonly reason: "not_a_git_repo" | "not_armed" };

/**
 * Reads the arming state of `store`'s corpus rooted at `corpusRoot`.
 *
 * @returns the state; a store failure is returned, never read as unarmed.
 */
export async function readStateBindingState(
  store: StoreInterface,
  corpusRoot: string,
): Promise<Result<StateBindingState, LoreError>> {
  const rev = await readArmingRev(store);
  if (!rev.ok) return rev;
  if (rev.value !== undefined) return ok({ armed: true, arming_rev: rev.value });
  return ok({ armed: false, reason: isInsideGitRepository(corpusRoot) ? "not_armed" : "not_a_git_repo" });
}

/** Arming step for one corpus's store. */
export class StateBindingService {
  constructor(private readonly store: StoreInterface) {}

  /** Arming state of this corpus (see {@link readStateBindingState}). */
  async readState(corpusRoot: string): Promise<Result<StateBindingState, LoreError>> {
    return readStateBindingState(this.store, corpusRoot);
  }

  /**
   * Measures what arming now would do to existing rows. Read-only.
   *
   * @returns the {@link ArmingImpactReport}; a store failure is returned, never a zeroed report.
   */
  async reportImpact(): Promise<Result<ArmingImpactReport, LoreError>> {
    let docsWithEvidence = 0;
    let evidenceRows = 0;
    let attestedRows = 0;
    let unresolvedEvidence = 0;
    let unboundRows = 0;
    const unboundSlugs: string[] = [];

    for (const type of ["task", "phase"] as const) {
      const docs = await this.store.findMany({ type });
      if (!docs.ok) return docs;
      for (const doc of docs.value) {
        const evidence = extractEvidence(doc);
        if (evidence.length === 0) continue;
        docsWithEvidence += 1;
        evidenceRows += evidence.length;
        const audit = await this.store.listAuditRowsByAction("evidence", doc.id);
        if (!audit.ok) return audit;
        const ids = resolveRecordedAuditIds(
          evidence,
          audit.value.map((row) => row.id),
        );
        let docUnbound = 0;
        evidence.forEach((entry, index) => {
          const attested = entry.attestation !== undefined;
          if (attested) attestedRows += 1;
          if (ids[index] !== undefined) return;
          unresolvedEvidence += 1;
          if (attested && entry.attestation?.state_stamp === undefined) docUnbound += 1;
        });
        if (docUnbound > 0) {
          unboundRows += docUnbound;
          unboundSlugs.push(doc.slug);
        }
      }
    }

    return ok({
      docs_with_evidence: docsWithEvidence,
      evidence_rows: evidenceRows,
      attested_rows: attestedRows,
      unresolved_evidence_rows: unresolvedEvidence,
      would_become_unbound_rows: unboundRows,
      would_become_unbound_docs: unboundSlugs.length,
      would_become_unbound_slugs: [...unboundSlugs].sort(),
    });
  }

  /**
   * Arms the corpus: writes the single `state-binding-armed` audit row, recording the impact
   * report in its `details` so the cost of arming is on the permanent record. Idempotent.
   *
   * @returns `armed` with the new cutoff and the report, or `already_armed` with the existing cutoff.
   */
  async arm(opts: ArmOptions): Promise<Result<ArmingResult, LoreError>> {
    const existing = await readArmingRev(this.store);
    if (!existing.ok) return existing;
    if (existing.value !== undefined) return ok({ status: "already_armed", arming_rev: existing.value });

    const report = await this.reportImpact();
    if (!report.ok) return report;

    const appended = await this.store.appendAuditEntry({
      timestamp: opts.nowIso,
      actor: opts.actor,
      session_id: `${STATE_BINDING_ARMED_ACTION}`,
      action: STATE_BINDING_ARMED_ACTION,
      details: {
        docs_with_evidence: report.value.docs_with_evidence,
        evidence_rows: report.value.evidence_rows,
        attested_rows: report.value.attested_rows,
        would_become_unbound_rows: report.value.would_become_unbound_rows,
        would_become_unbound_docs: report.value.would_become_unbound_docs,
      },
    });
    if (!appended.ok) return appended;

    const armed = await readArmingRev(this.store);
    if (!armed.ok) return armed;
    if (armed.value === undefined) {
      return err({
        code: "STORE_ERROR",
        message: "state-binding-armed audit row was appended but cannot be read back",
      });
    }
    return ok({ status: "armed", arming_rev: armed.value, report: report.value });
  }
}
