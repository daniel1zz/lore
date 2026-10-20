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
 *   the grammar's per-entry validation (D4, D1). The dedup spans BOTH scanned
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
  classifyCodeAnchor,
  type DriftInputEntry,
  collectAnchorProbes,
  type FsProbe,
  type DriftRow,
} from "@lore/core";
import type { DocRecord, DocType } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";
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

/** One stored `code_anchors` value the grammar rejects (BR-416): shown raw, with the reason it cannot be read. */
interface UnreadableAnchor {
  raw: string;
  reason: string;
}

/** One armed document: it declares ≥1 `code_anchors` entry, readable or not. */
interface ArmedDoc {
  doc: DocRecord;
  anchors: DriftInputEntry["anchor"][];
  unreadable: UnreadableAnchor[];
}

const defaultNow = (): string => new Date().toISOString();

// ─── DriftCheckService ───────────────────────────────────────────────────────

export class DriftCheckService {
  constructor(
    private readonly store: StoreInterface,
    // reason: AC-DCL-5 — the ONE write route (`CorpusService`); `app.ts` passes the composed one, a bare test gets a
    // bare writer. This service never calls `store.update` / `insertVersion` / `appendAuditEntry` itself.
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store);
  }

  private readonly writer: DocWritePort;

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
    const armedResult = await this.loadArmedDocsByType();
    if (!armedResult.ok) return armedResult;
    const armedByType = armedResult.value;

    const declared: DriftInputEntry[] = [];
    const unreadableRows: DriftRow[] = [];
    const statusBreakdown: Record<string, number> = {};
    let armedTotal = 0;
    for (const [type, armedDocs] of armedByType) {
      armedTotal += armedDocs.length;
      for (const { doc, anchors, unreadable } of armedDocs) {
        statusBreakdown[doc.status] = (statusBreakdown[doc.status] ?? 0) + 1;
        for (const anchor of anchors) {
          declared.push({ doc_id: doc.id, doc_slug: doc.slug, doc_type: type, doc_status: doc.status, anchor });
        }
        for (const { raw, reason } of unreadable) {
          unreadableRows.push({
            doc_id: doc.id,
            doc_slug: doc.slug,
            doc_type: type,
            doc_status: doc.status,
            anchor: raw,
            kind: "anchor_unreadable",
            detail: reason,
          });
        }
      }
    }

    const probes = collectAnchorProbes(declared.map((entry) => entry.anchor), probe);
    const computed = computeDrift(declared, probes);
    // reason: BR-416 — an unreadable stored anchor is a finding of its own kind, never a skipped entry.
    const drifts = [...computed.drifts, ...unreadableRows];
    const consistent = drifts.length === 0;

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

  /**
   * Every declared `code_anchors` entry of every non-deleted spec and knowledge doc, in the
   * shape `computeDrift` consumes. The reverse index (`lore refs`) reads anchors through this
   * single read, so it can never disagree with the drift check about what is declared.
   *
   * @returns One entry per declared anchor, labeled with its owning document.
   * @throws STORE_ERROR (findMany failure).
   */
  async listDeclaredAnchors(): Promise<Result<DriftInputEntry[], LoreError>> {
    const armedResult = await this.loadArmedDocsByType();
    if (!armedResult.ok) return armedResult;
    const declared: DriftInputEntry[] = [];
    for (const [type, armedDocs] of armedResult.value) {
      for (const { doc, anchors } of armedDocs) {
        for (const anchor of anchors) {
          declared.push({ doc_id: doc.id, doc_slug: doc.slug, doc_type: type, doc_status: doc.status, anchor });
        }
      }
    }
    return ok(declared);
  }

  private async loadArmedDocsByType(): Promise<Result<Map<DocType, ArmedDoc[]>, LoreError>> {
    const armedByType = new Map<DocType, ArmedDoc[]>();
    for (const type of ANCHOR_SCANNED_DOC_TYPES) {
      const docsResult = await this.store.findMany({ type });
      if (!docsResult.ok) return docsResult;
      armedByType.set(type, collectArmedDocs(docsResult.value));
    }
    return ok(armedByType);
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

    const existing = extractCodeAnchorStrings(doc);
    // reason: an unreadable stored value (BR-416) cannot pass the grammar, yet the drift report tells the author
    // to remove it — a candidate equal to a stored string verbatim is therefore removable without parsing.
    const toRemove = new Set(anchors.filter((candidate) => existing.includes(candidate)));
    const unmatched = anchors.filter((candidate) => !existing.includes(candidate));
    const normalizedRemovalResult = normalizeCodeAnchorEntries(unmatched);
    if (!normalizedRemovalResult.ok) return normalizedRemovalResult;
    for (const normalized of normalizedRemovalResult.value) toRemove.add(normalized);

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
   * Shared write path for addCodeAnchors/removeCodeAnchors/setCodeAnchors: ONE `CorpusService.writeDoc` (CAS on
   * the doc's version, version row + audit row naming the CALLER, foreign-corpus refusal, no-op writes nothing).
   * Mirrors `AcService.writeCriteria`. Target-type admission already happened in
   * {@link DriftCheckService.resolveAnchorableDoc}; this path is type-agnostic.
   */
  private async writeCodeAnchors(
    doc: DocRecord,
    anchors: string[],
    operation: "add" | "remove" | "set",
    now: () => string,
  ): Promise<Result<string[], LoreError>> {
    const changeVerb = operation === "add" ? "updated" : operation === "remove" ? "updated (removal)" : "replaced";
    const written = await this.writer.writeDoc({
      doc,
      patch: { extra: { ...doc.extra, code_anchors: anchors } },
      action: "update",
      changeSummary: `Code anchors ${changeVerb} — ${anchors.length} entries`,
      auditAction: "update",
      auditDetails: { operation, anchor_count: anchors.length },
      lock: "none",
      now: now(),
    });
    if (!written.ok) return written;
    return ok(anchors);
  }
}

// ─── Module-scope Helpers ────────────────────────────────────────────────────

/**
 * Narrows a fetched population to the ARMED subset — the docs that store ≥1 `code_anchors`
 * entry, readable or not (an unreadable one is a finding, so it arms the doc, BR-416).
 * `store.findMany` already excludes soft-deleted docs, so the armed population is
 * non-deleted by construction.
 *
 * @param docs - Every non-deleted doc of one type, as returned by `store.findMany`
 * @returns One {@link ArmedDoc} per doc with at least one stored anchor value
 */
function collectArmedDocs(docs: readonly DocRecord[]): ArmedDoc[] {
  const armed: ArmedDoc[] = [];
  for (const doc of docs) {
    const { anchors, unreadable } = extractStoredCodeAnchors(doc);
    if (anchors.length > 0 || unreadable.length > 0) armed.push({ doc, anchors, unreadable });
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
 * Reads a document's stored `code_anchors` into the anchors the grammar accepts and the
 * values it rejects. Nothing is dropped (BR-416): a rejected string, a non-string entry and
 * a `code_anchors` that is not a list each come back as an {@link UnreadableAnchor}, so the
 * drift scan reports them. Grammar is enforced at every write seam (D6a), but a hand-edited,
 * imported or legacy row still reaches this read.
 */
function extractStoredCodeAnchors(doc: DocRecord): {
  anchors: DriftInputEntry["anchor"][];
  unreadable: UnreadableAnchor[];
} {
  const stored = doc.extra["code_anchors"];
  if (stored === undefined || stored === null) return { anchors: [], unreadable: [] };
  if (!Array.isArray(stored)) {
    return {
      anchors: [],
      unreadable: [{ raw: JSON.stringify(stored), reason: "code_anchors is not a list of anchor strings" }],
    };
  }
  const anchors: DriftInputEntry["anchor"][] = [];
  const unreadable: UnreadableAnchor[] = [];
  for (const entry of stored) {
    if (typeof entry !== "string") {
      unreadable.push({ raw: JSON.stringify(entry), reason: "stored entry is not a string" });
      continue;
    }
    const classified = classifyCodeAnchor(entry);
    if (classified.kind === "valid") anchors.push(classified.anchor);
    else unreadable.push({ raw: entry, reason: classified.message });
  }
  return { anchors, unreadable };
}
