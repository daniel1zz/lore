/**
 * DriftCheckService — orchestrates the doc-code drift oracle (SPEC-045 §Design
 * Decisions D4, D6, D9 — memory hygiene part 3, doc-code drift oracle H3). Loads
 * every non-deleted SPEC's and KNOWLEDGE doc's declared `extra.code_anchors`, probes
 * each DISTINCT path
 * exactly once via an injected `FsProbe` port, and delegates classification to the
 * pure `computeDrift` (`@lore/core`, code-anchors.ts). ALSO owns the code_anchors
 * authoring RMW verbs (`addCodeAnchors`/`removeCodeAnchors`/`setCodeAnchors`) — the
 * spec/knowledge-target half of `lore anchor` dispatch (D6; the task-target half
 * stays on `TaskWorkflowService`, unchanged).
 *
 * Public surface:
 *   checkDrift(probe)                         → scan every armed spec + knowledge doc
 *   addCodeAnchors(docIdOrSlug, anchors)      → incremental CAS RMW union
 *   removeCodeAnchors(docIdOrSlug, anchors)   → incremental CAS RMW difference
 *   setCodeAnchors(docIdOrSlug, anchors)      → declarative CAS REPLACE (MCP shape)
 *
 * @invariant This module NEVER imports the Node filesystem builtin — every probe
 *   call goes through the caller-injected `FsProbe` port (D4). `checkDrift`'s `probe`
 *   parameter is supplied PER CALL by the adapter layer (T2), never constructor-bound
 *   — mirrors D4's "built in the adapter and passed per call" placement. Verified by
 *   a source-text grep oracle in this service's test file (`sync-docs-service.test.ts`
 *   precedent) — 0 hits expected against this file's own import statements.
 * @invariant EVERY probe call (`stat`/`listDir`/`readFile`) is individually wrapped in
 *   its own try/catch — a THROWN error becomes a `probe_error` drift row for every
 *   anchor sharing that path, and the scan CONTINUES for every other path (D4, G11 —
 *   never a batch-abort silent false-negative).
 * @invariant Probe-level dedup: `stat`/`listDir`/`readFile` are each called AT MOST
 *   ONCE per DISTINCT declared path, regardless of how many documents (or how many
 *   anchors on the SAME document) declare that path — a separate, later concern from
 *   `parseCodeAnchor`'s per-entry validation (D4, D1). The dedup spans BOTH scanned
 *   populations: a path anchored by a spec AND by a knowledge doc is probed once.
 * @invariant TWO populations are scanned and reported SEPARATELY (`specs_checked`,
 *   `knowledge_checked`), while `armed`/`consistent` are computed over their UNION —
 *   so a drift report can never imply it covered knowledge when it did not, and can
 *   never call a corpus consistent because only the spec half was clean. Every
 *   emitted `DriftRow` carries its own `doc_type` (M2 of
 *   spec-a-write-side-fact-with-no-read-side-address-counts-with-no).
 * @invariant `checkDrift` performs ZERO store writes, bumps no doc version, writes no
 *   audit rows — a REPORT, never a mutation (D9). Paired with the positive-detection
 *   ACs (AC-DR-1/AC-DR-4) — read-only-ness alone is no-op-satisfiable (D9 note).
 * @invariant `addCodeAnchors`/`removeCodeAnchors`/`setCodeAnchors` are CAS-guarded
 *   (`store.update`'s `expected_version`, resolved from the SAME read within the
 *   call) and produce exactly one `insertVersion` snapshot + one `appendAuditEntry`
 *   (action "update", actor "system") — same shape as `AcService.writeCriteria`, so
 *   `AuditService.verify`'s completeness oracle needs no special case for these
 *   writes. Every sibling `extra` key (spec_kind, acceptance_criteria, knowledge's
 *   own REQUIRED sub_type, ...) is preserved verbatim via
 *   `{...doc.extra, code_anchors: ...}` — a knowledge doc losing `sub_type` here
 *   would fail its own create-schema on the next validated write.
 *
 * Side-effect class: IO (reads/writes via StoreInterface; `checkDrift` additionally
 *   invokes the injected FsProbe port, but issues no store WRITES).
 *
 * Source: SPEC-045 §Design Decisions D4, D6, D9; §Acceptance Criteria AC-DR-2, AC-DR-3, AC-DR-8
 */

import { err, ok, type Result } from "@lore/core";
import type { LoreError } from "@lore/core";
import {
  computeDrift,
  normalizeCodeAnchorEntries,
  parseCodeAnchor,
  type DriftInputEntry,
  collectAnchorProbes,
  type FsProbe,
  type DriftRow,
} from "@lore/core";
import type { DocRecord, DocType } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

// FsProbe (D4) is the core port; re-exported so existing importers keep their path.
export type { FsProbe };


// ─── Public Types ──────────────────────────────────────────────────────────

/** Result of {@link DriftCheckService.checkDrift}. */
export interface DriftCheckResult {
  /** `true` iff at least one non-deleted spec OR knowledge doc declares ≥1 `code_anchors` entry. */
  armed: boolean;
  /** `true` iff `drifts` is empty (armed:false ⇒ always consistent, vacuously). */
  consistent: boolean;
  /** Count of non-deleted SPECS that declare ≥1 code_anchors entry (U7). */
  specs_checked: number;
  /**
   * Count of non-deleted KNOWLEDGE docs that declare ≥1 code_anchors entry — mirrors
   * {@link DriftCheckResult.specs_checked} exactly, reported separately so a caller can
   * tell "knowledge was scanned and clean" from "knowledge was never scanned".
   */
  knowledge_checked: number;
  /**
   * The UNION of both scanned populations, broken down by doc status. Statuses are
   * shared vocabulary across doc types, so this histogram does NOT attribute per type
   * — `specs_checked`/`knowledge_checked` and each row's own `doc_type` do that.
   */
  status_breakdown: Record<string, number>;
  /** Every anchor that failed to verify, sorted by doc_slug then anchor (D5 — adapter's job to sort; this returns scan order). */
  drifts: DriftRow[];
}

/**
 * The doc types whose `extra.code_anchors` `checkDrift` scans and whose anchors the
 * RMW verbs may write — the SINGLE definition of that set, read by both the scan and
 * the target-type refusal, so the two can never disagree about what is anchorable.
 *
 * `knowledge` is here because a team files a domain FACT as knowledge (a fact has no
 * implementation plan), and an unanchored fact's assertions about code had zero drift
 * detection — M2 of
 * `spec-a-write-side-fact-with-no-read-side-address-counts-with-no`. All 9 knowledge
 * sub_types are eligible: a retro's claim about code is exactly as falsifiable as a
 * reference table's.
 */
export const ANCHOR_SCANNED_DOC_TYPES: readonly DocType[] = ["spec", "knowledge"];

/** One armed document: it declares ≥1 parseable `code_anchors` entry. */
interface ArmedDoc {
  doc: DocRecord;
  anchors: DriftInputEntry["anchor"][];
}

const defaultNow = (): string => new Date().toISOString();

// ─── DriftCheckService ───────────────────────────────────────────────────────

export class DriftCheckService {
  constructor(private readonly store: StoreInterface) {}

  // ── checkDrift ──────────────────────────────────────────────────────────

  /**
   * Scans every non-deleted SPEC's and KNOWLEDGE doc's declared `extra.code_anchors`
   * against the working tree via `probe`, returning a full drift report. Never mutates
   * anything (D9).
   *
   * @param probe - Filesystem probe port, injected per call (D4).
   * @returns {@link DriftCheckResult} — `specs_checked`/`knowledge_checked` report the
   *   two populations separately; `armed`/`consistent` span their union.
   * @throws STORE_ERROR (findMany failure) — probe failures never abort the scan,
   *   only become `probe_error` rows.
   */
  async checkDrift(probe: FsProbe): Promise<Result<DriftCheckResult, LoreError>> {
    const armedByType = new Map<DocType, ArmedDoc[]>();
    for (const type of ANCHOR_SCANNED_DOC_TYPES) {
      const docsResult = await this.store.findMany({ type });
      if (!docsResult.ok) return docsResult;
      armedByType.set(type, collectArmedDocs(docsResult.value));
    }

    const declared: DriftInputEntry[] = [];
    const statusBreakdown: Record<string, number> = {};
    let armedTotal = 0;
    for (const [type, armedDocs] of armedByType) {
      armedTotal += armedDocs.length;
      for (const { doc, anchors } of armedDocs) {
        statusBreakdown[doc.status] = (statusBreakdown[doc.status] ?? 0) + 1;
        for (const anchor of anchors) {
          declared.push({ doc_id: doc.id, doc_slug: doc.slug, doc_type: type, doc_status: doc.status, anchor });
        }
      }
    }

    const probes = collectAnchorProbes(declared.map((entry) => entry.anchor), probe);
    const { consistent, drifts } = computeDrift(declared, probes);

    return ok({
      // reason: `armed` counts the UNION, derived from the scanned map rather than
      // from the two named fields below — so a third anchor-declaring doc type added
      // to ANCHOR_SCANNED_DOC_TYPES cannot leave `armed` silently false for it.
      armed: armedTotal > 0,
      consistent,
      specs_checked: armedByType.get("spec")?.length ?? 0,
      knowledge_checked: armedByType.get("knowledge")?.length ?? 0,
      status_breakdown: statusBreakdown,
      drifts,
    });
  }

  // ── Authoring RMW (D6) ────────────────────────────────────────────────────

  /**
   * Read-modify-write UNION: normalizes `existing + anchors` together (re-parsing
   * BOTH — mirrors `TaskWorkflowService.addAnchors`'s shape), rejecting the whole
   * call loud on the first grammar violation.
   *
   * @param docIdOrSlug - Spec or knowledge document ULID or slug
   * @param anchors - Candidate raw anchor strings to add
   * @param now - Time seam (mirrors `TaskWorkflowService`'s `now: () => string`
   *   convention) — lets a test deterministically inject a concurrent writer
   *   between the read and the CAS write (SPEC-025 §7 sequential-CAS recipe).
   * @returns Updated `code_anchors` array after the union
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec/knowledge doc, or a bad anchor entry), STALE_VERSION
   */
  async addCodeAnchors(
    docIdOrSlug: string,
    anchors: string[],
    now: () => string = defaultNow,
  ): Promise<Result<string[], LoreError>> {
    const docResult = await this.resolveAnchorableDoc(docIdOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;

    const existing = extractCodeAnchorStrings(doc);
    const normalizedResult = normalizeCodeAnchorEntries([...existing, ...anchors]);
    if (!normalizedResult.ok) return normalizedResult;

    return this.writeCodeAnchors(doc, normalizedResult.value, "add", now);
  }

  /**
   * Read-modify-write DIFFERENCE: normalizes the removal candidates, then strips
   * any matching entry from the spec's existing (as-stored) list.
   *
   * @param docIdOrSlug - Spec or knowledge document ULID or slug
   * @param anchors - Candidate raw anchor strings to remove
   * @param now - Time seam (see {@link addCodeAnchors}).
   * @returns Updated `code_anchors` array after removal
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec/knowledge doc, or a bad anchor entry), STALE_VERSION
   */
  async removeCodeAnchors(
    docIdOrSlug: string,
    anchors: string[],
    now: () => string = defaultNow,
  ): Promise<Result<string[], LoreError>> {
    const docResult = await this.resolveAnchorableDoc(docIdOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;

    const normalizedRemovalResult = normalizeCodeAnchorEntries(anchors);
    if (!normalizedRemovalResult.ok) return normalizedRemovalResult;
    const toRemove = new Set(normalizedRemovalResult.value);

    const existing = extractCodeAnchorStrings(doc);
    const remaining = existing.filter((a) => !toRemove.has(a));

    return this.writeCodeAnchors(doc, remaining, "remove", now);
  }

  /**
   * Declarative REPLACE — the `lore_anchor_set` MCP spec-target shape (D7). UNLIKE
   * the CLI's `addCodeAnchors`/`removeCodeAnchors`, this OVERWRITES the whole
   * `code_anchors` array with `anchors` (normalized).
   *
   * @param docIdOrSlug - Spec or knowledge document ULID or slug
   * @param anchors - The FULL replacement anchor list
   * @param now - Time seam (see {@link addCodeAnchors}).
   * @returns The new `code_anchors` array
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec/knowledge doc, or a bad anchor entry), STALE_VERSION
   */
  async setCodeAnchors(
    docIdOrSlug: string,
    anchors: string[],
    now: () => string = defaultNow,
  ): Promise<Result<string[], LoreError>> {
    const docResult = await this.resolveAnchorableDoc(docIdOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;

    const normalizedResult = normalizeCodeAnchorEntries(anchors);
    if (!normalizedResult.ok) return normalizedResult;

    return this.writeCodeAnchors(doc, normalizedResult.value, "set", now);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /**
   * Resolves idOrSlug and validates it is a document type this service may anchor —
   * gated by {@link ANCHOR_SCANNED_DOC_TYPES}, the same set `checkDrift` scans, so a
   * doc can never be anchorable-but-unscanned (or scanned-but-unanchorable).
   */
  private async resolveAnchorableDoc(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    if (!ANCHOR_SCANNED_DOC_TYPES.includes(doc.type)) {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a ${ANCHOR_SCANNED_DOC_TYPES.join(" or ")} document; got type '${doc.type}'`,
        value: doc.type,
      });
    }
    return ok(doc);
  }

  /**
   * Shared CAS-guarded write path for addCodeAnchors/removeCodeAnchors/
   * setCodeAnchors — bumps the document's version, writes one insertVersion snapshot,
   * then one audit entry (action "update", actor "system"). Mirrors
   * `AcService.writeCriteria` exactly. Target-type admission already happened in
   * {@link DriftCheckService.resolveAnchorableDoc}; this path is type-agnostic.
   */
  private async writeCodeAnchors(
    doc: DocRecord,
    anchors: string[],
    operation: "add" | "remove" | "set",
    now: () => string,
  ): Promise<Result<string[], LoreError>> {
    const nowIso = now();
    const newVersion = doc.version + 1;
    const newExtra: Record<string, unknown> = { ...doc.extra, code_anchors: anchors };

    const updateResult = await this.store.update(
      doc.id,
      { extra: newExtra, updated_at: nowIso, version: newVersion },
      { expected_version: doc.version },
    );
    if (!updateResult.ok) return updateResult;

    const changeVerb = operation === "add" ? "updated" : operation === "remove" ? "updated (removal)" : "replaced";
    const versionResult = await this.store.insertVersion({
      doc_id: doc.id,
      version: newVersion,
      content: updateResult.value.content,
      extra: updateResult.value.extra,
      status: updateResult.value.status,
      title: updateResult.value.title,
      action: "update",
      created_at: nowIso,
      created_by: "system",
      change_summary: `Code anchors ${changeVerb} — ${anchors.length} entries`,
      // SPEC-072 D1/D2 — this write path only touches `extra`; carry the
      // current (unchanged) slug.
      slug: updateResult.value.slug,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: nowIso,
      actor: "system",
      session_id: doc.id,
      action: "update",
      doc_id: doc.id,
      details: { operation, anchor_count: anchors.length, version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(anchors);
  }
}

// ─── Module-scope Helpers ────────────────────────────────────────────────────

/**
 * Narrows a fetched population to the ARMED subset — the docs that declare ≥1
 * parseable `code_anchors` entry. `store.findMany` already excludes soft-deleted
 * docs, so the armed population is non-deleted by construction.
 *
 * @param docs - Every non-deleted doc of one type, as returned by `store.findMany`
 * @returns One {@link ArmedDoc} per doc with at least one parseable anchor
 */
function collectArmedDocs(docs: readonly DocRecord[]): ArmedDoc[] {
  const armed: ArmedDoc[] = [];
  for (const doc of docs) {
    const anchors = extractParsedCodeAnchors(doc);
    if (anchors.length > 0) armed.push({ doc, anchors });
  }
  return armed;
}

/**
 * Extracts a document's raw stored `code_anchors` strings, defensively (untyped
 * `extra` storage — mirrors `AcService`'s `extractCriteria`/`TaskWorkflowService`'s
 * `extractFileAnchors` shape).
 */
function extractCodeAnchorStrings(doc: DocRecord): string[] {
  const raw = doc.extra["code_anchors"];
  return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : [];
}

/**
 * Extracts and PARSES a document's stored `code_anchors` into `ParsedCodeAnchor[]`,
 * silently skipping any entry that fails `parseCodeAnchor` — grammar is guaranteed
 * at every write seam (D6a), so a parse failure here means a hand-edited/legacy row;
 * this scan-time defensive skip is intentionally OUT of the six documented drift
 * kinds (grammar policing is a WRITE-time concern, not this read-only scan's job).
 */
function extractParsedCodeAnchors(doc: DocRecord): DriftInputEntry["anchor"][] {
  const raw = extractCodeAnchorStrings(doc);
  const parsed: DriftInputEntry["anchor"][] = [];
  for (const entry of raw) {
    const result = parseCodeAnchor(entry);
    if (result.ok) parsed.push(result.value);
  }
  return parsed;
}
