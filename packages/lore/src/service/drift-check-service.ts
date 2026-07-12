/**
 * DriftCheckService — orchestrates the doc-code drift oracle (SPEC-045 §Design
 * Decisions D4, D6, D9 — memory hygiene part 3, doc-code drift oracle H3). Loads
 * every non-deleted spec's declared `extra.code_anchors`, probes each DISTINCT path
 * exactly once via an injected `FsProbe` port, and delegates classification to the
 * pure `computeDrift` (`@lore/core`, code-anchors.ts). ALSO owns the code_anchors
 * authoring RMW verbs (`addCodeAnchors`/`removeCodeAnchors`/`setCodeAnchors`) — the
 * spec-target half of `lore anchor` dispatch (D6; the task-target half stays on
 * `TaskWorkflowService`, unchanged).
 *
 * Public surface:
 *   checkDrift(probe)                          → scan every armed spec, report drift
 *   addCodeAnchors(specIdOrSlug, anchors)      → incremental CAS RMW union
 *   removeCodeAnchors(specIdOrSlug, anchors)   → incremental CAS RMW difference
 *   setCodeAnchors(specIdOrSlug, anchors)      → declarative CAS REPLACE (MCP shape)
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
 *   ONCE per DISTINCT declared path, regardless of how many specs (or how many
 *   anchors on the SAME spec) declare that path — a separate, later concern from
 *   `parseCodeAnchor`'s per-entry validation (D4, D1).
 * @invariant `checkDrift` performs ZERO store writes, bumps no doc version, writes no
 *   audit rows — a REPORT, never a mutation (D9). Paired with the positive-detection
 *   ACs (AC-DR-1/AC-DR-4) — read-only-ness alone is no-op-satisfiable (D9 note).
 * @invariant `addCodeAnchors`/`removeCodeAnchors`/`setCodeAnchors` are CAS-guarded
 *   (`store.update`'s `expected_version`, resolved from the SAME read within the
 *   call) and produce exactly one `insertVersion` snapshot + one `appendAuditEntry`
 *   (action "update", actor "system") — same shape as `AcService.writeCriteria`, so
 *   `AuditService.verify`'s completeness oracle needs no special case for these
 *   writes. Every sibling `extra` key (spec_kind, acceptance_criteria, ...) is
 *   preserved verbatim via `{...spec.extra, code_anchors: ...}`.
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
  type AnchorProbe,
  type DriftRow,
} from "@lore/core";
import type { DocRecord } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

// ─── FsProbe Port (D4) ───────────────────────────────────────────────────────

/**
 * Filesystem probe port — the ONLY way `DriftCheckService` touches the filesystem.
 * The real implementation (node:fs sync, repo root = `process.cwd()`, same
 * assumption as `lore status --check-tree`) is built in the CLI adapter (T2) and
 * passed to {@link DriftCheckService.checkDrift} per call. Every method MAY throw —
 * `checkDrift` wraps each call individually and turns a throw into a `probe_error`
 * drift row rather than aborting the scan (D4).
 */
export interface FsProbe {
  /** Classifies `path` on the working tree. MAY throw on an unexpected IO failure. */
  stat(path: string): "file" | "dir" | "missing";
  /** Reads full file content. Returns `null` when unreadable; MAY throw. */
  readFile(path: string): string | null;
  /** Lists immediate (non-recursive) children, UNFILTERED (dotfiles included — filtering happens in `computeDrift`). Returns `null` when unlistable; MAY throw. */
  listDir(path: string): string[] | null;
}

// ─── Public Types ──────────────────────────────────────────────────────────

/** Result of {@link DriftCheckService.checkDrift}. */
export interface DriftCheckResult {
  /** `true` iff at least one non-deleted spec declares ≥1 `code_anchors` entry. */
  armed: boolean;
  /** `true` iff `drifts` is empty (armed:false ⇒ always consistent, vacuously). */
  consistent: boolean;
  /** Count of specs that declare ≥1 code_anchors entry — the scanned population (U7). */
  specs_checked: number;
  /** `specs_checked`'s population, broken down by doc status. */
  status_breakdown: Record<string, number>;
  /** Every anchor that failed to verify, sorted by spec_slug then anchor (D5 — adapter's job to sort; this returns scan order). */
  drifts: DriftRow[];
}

const defaultNow = (): string => new Date().toISOString();

// ─── DriftCheckService ───────────────────────────────────────────────────────

export class DriftCheckService {
  constructor(private readonly store: StoreInterface) {}

  // ── checkDrift ──────────────────────────────────────────────────────────

  /**
   * Scans every non-deleted spec's declared `extra.code_anchors` against the
   * working tree via `probe`, returning a full drift report. Never mutates
   * anything (D9).
   *
   * @param probe - Filesystem probe port, injected per call (D4).
   * @returns {@link DriftCheckResult}
   * @throws STORE_ERROR (findMany failure) — probe failures never abort the scan,
   *   only become `probe_error` rows.
   */
  async checkDrift(probe: FsProbe): Promise<Result<DriftCheckResult, LoreError>> {
    const specsResult = await this.store.findMany({ type: "spec" });
    if (!specsResult.ok) return specsResult;

    const armedSpecs: Array<{ doc: DocRecord; anchors: DriftInputEntry["anchor"][] }> = [];
    for (const doc of specsResult.value) {
      const anchors = extractParsedCodeAnchors(doc);
      if (anchors.length > 0) armedSpecs.push({ doc, anchors });
    }

    const declared: DriftInputEntry[] = [];
    const statusBreakdown: Record<string, number> = {};
    for (const { doc, anchors } of armedSpecs) {
      statusBreakdown[doc.status] = (statusBreakdown[doc.status] ?? 0) + 1;
      for (const anchor of anchors) {
        declared.push({ spec_id: doc.id, spec_slug: doc.slug, spec_status: doc.status, anchor });
      }
    }

    const probes = collectProbes(declared, probe);
    const { consistent, drifts } = computeDrift(declared, probes);

    return ok({
      armed: armedSpecs.length > 0,
      consistent,
      specs_checked: armedSpecs.length,
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
   * @param specIdOrSlug - Spec document ULID or slug
   * @param anchors - Candidate raw anchor strings to add
   * @param now - Time seam (mirrors `TaskWorkflowService`'s `now: () => string`
   *   convention) — lets a test deterministically inject a concurrent writer
   *   between the read and the CAS write (SPEC-025 §7 sequential-CAS recipe).
   * @returns Updated `code_anchors` array after the union
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / bad anchor entry), STALE_VERSION
   */
  async addCodeAnchors(
    specIdOrSlug: string,
    anchors: string[],
    now: () => string = defaultNow,
  ): Promise<Result<string[], LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    const existing = extractCodeAnchorStrings(spec);
    const normalizedResult = normalizeCodeAnchorEntries([...existing, ...anchors]);
    if (!normalizedResult.ok) return normalizedResult;

    return this.writeCodeAnchors(spec, normalizedResult.value, "add", now);
  }

  /**
   * Read-modify-write DIFFERENCE: normalizes the removal candidates, then strips
   * any matching entry from the spec's existing (as-stored) list.
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param anchors - Candidate raw anchor strings to remove
   * @param now - Time seam (see {@link addCodeAnchors}).
   * @returns Updated `code_anchors` array after removal
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / bad anchor entry), STALE_VERSION
   */
  async removeCodeAnchors(
    specIdOrSlug: string,
    anchors: string[],
    now: () => string = defaultNow,
  ): Promise<Result<string[], LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    const normalizedRemovalResult = normalizeCodeAnchorEntries(anchors);
    if (!normalizedRemovalResult.ok) return normalizedRemovalResult;
    const toRemove = new Set(normalizedRemovalResult.value);

    const existing = extractCodeAnchorStrings(spec);
    const remaining = existing.filter((a) => !toRemove.has(a));

    return this.writeCodeAnchors(spec, remaining, "remove", now);
  }

  /**
   * Declarative REPLACE — the `lore_anchor_set` MCP spec-target shape (D7). UNLIKE
   * the CLI's `addCodeAnchors`/`removeCodeAnchors`, this OVERWRITES the whole
   * `code_anchors` array with `anchors` (normalized).
   *
   * @param specIdOrSlug - Spec document ULID or slug
   * @param anchors - The FULL replacement anchor list
   * @param now - Time seam (see {@link addCodeAnchors}).
   * @returns The new `code_anchors` array
   * @throws DOC_NOT_FOUND, VALIDATION_ERROR (not a spec / bad anchor entry), STALE_VERSION
   */
  async setCodeAnchors(
    specIdOrSlug: string,
    anchors: string[],
    now: () => string = defaultNow,
  ): Promise<Result<string[], LoreError>> {
    const specResult = await this.resolveSpec(specIdOrSlug);
    if (!specResult.ok) return specResult;
    const spec = specResult.value;

    const normalizedResult = normalizeCodeAnchorEntries(anchors);
    if (!normalizedResult.ok) return normalizedResult;

    return this.writeCodeAnchors(spec, normalizedResult.value, "set", now);
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  /** Resolves idOrSlug and validates it is a spec document. */
  private async resolveSpec(idOrSlug: string): Promise<Result<DocRecord, LoreError>> {
    const docResult = await resolveDoc(this.store, idOrSlug);
    if (!docResult.ok) return docResult;
    const doc = docResult.value;
    if (doc.type !== "spec") {
      return err({
        code: "VALIDATION_ERROR",
        field: "type",
        message: `Expected a spec document; got type '${doc.type}'`,
        value: doc.type,
      });
    }
    return ok(doc);
  }

  /**
   * Shared CAS-guarded write path for addCodeAnchors/removeCodeAnchors/
   * setCodeAnchors — bumps the spec's version, writes one insertVersion snapshot,
   * then one audit entry (action "update", actor "system"). Mirrors
   * `AcService.writeCriteria` exactly.
   */
  private async writeCodeAnchors(
    spec: DocRecord,
    anchors: string[],
    operation: "add" | "remove" | "set",
    now: () => string,
  ): Promise<Result<string[], LoreError>> {
    const nowIso = now();
    const newVersion = spec.version + 1;
    const newExtra: Record<string, unknown> = { ...spec.extra, code_anchors: anchors };

    const updateResult = await this.store.update(
      spec.id,
      { extra: newExtra, updated_at: nowIso, version: newVersion },
      { expected_version: spec.version },
    );
    if (!updateResult.ok) return updateResult;

    const changeVerb = operation === "add" ? "updated" : operation === "remove" ? "updated (removal)" : "replaced";
    const versionResult = await this.store.insertVersion({
      doc_id: spec.id,
      version: newVersion,
      content: updateResult.value.content,
      extra: updateResult.value.extra,
      status: updateResult.value.status,
      title: updateResult.value.title,
      action: "update",
      created_at: nowIso,
      created_by: "system",
      change_summary: `Code anchors ${changeVerb} — ${anchors.length} entries`,
    });
    if (!versionResult.ok) return versionResult;

    const auditResult = await this.store.appendAuditEntry({
      timestamp: nowIso,
      actor: "system",
      session_id: spec.id,
      action: "update",
      doc_id: spec.id,
      details: { operation, anchor_count: anchors.length, version: newVersion },
    });
    if (!auditResult.ok) return auditResult;

    return ok(anchors);
  }
}

// ─── Module-scope Helpers ────────────────────────────────────────────────────

/**
 * Extracts a spec's raw stored `code_anchors` strings, defensively (untyped
 * `extra` storage — mirrors `AcService`'s `extractCriteria`/`TaskWorkflowService`'s
 * `extractFileAnchors` shape).
 */
function extractCodeAnchorStrings(spec: DocRecord): string[] {
  const raw = spec.extra["code_anchors"];
  return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : [];
}

/**
 * Extracts and PARSES a spec's stored `code_anchors` into `ParsedCodeAnchor[]`,
 * silently skipping any entry that fails `parseCodeAnchor` — grammar is guaranteed
 * at every write seam (D6a), so a parse failure here means a hand-edited/legacy row;
 * this scan-time defensive skip is intentionally OUT of the six documented drift
 * kinds (grammar policing is a WRITE-time concern, not this read-only scan's job).
 */
function extractParsedCodeAnchors(spec: DocRecord): DriftInputEntry["anchor"][] {
  const raw = extractCodeAnchorStrings(spec);
  const parsed: DriftInputEntry["anchor"][] = [];
  for (const entry of raw) {
    const result = parseCodeAnchor(entry);
    if (result.ok) parsed.push(result.value);
  }
  return parsed;
}

/**
 * Probes every DISTINCT path referenced by `declared`, exactly once per method
 * (`stat` always; `listDir` only when some anchor on that path is a dir anchor;
 * `readFile` only when some anchor on that path carries a `#Symbol`) — the D4
 * probe-level dedup. Every call is individually try/catch-wrapped; a throw (or an
 * explicit `null` from `listDir`/`readFile`) sets `.error` on that path's probe
 * entry, which `computeDrift` turns into a `probe_error` row for every anchor
 * sharing that path.
 */
function collectProbes(declared: DriftInputEntry[], probe: FsProbe): Map<string, AnchorProbe> {
  const descriptors = new Map<string, { needsListDir: boolean; needsContent: boolean }>();
  for (const entry of declared) {
    const existing = descriptors.get(entry.anchor.path) ?? { needsListDir: false, needsContent: false };
    if (entry.anchor.isDir) existing.needsListDir = true;
    if (entry.anchor.symbol !== undefined) existing.needsContent = true;
    descriptors.set(entry.anchor.path, existing);
  }

  const probes = new Map<string, AnchorProbe>();
  for (const [path, descriptor] of descriptors) {
    const result: AnchorProbe = {};

    try {
      result.stat = probe.stat(path);
    } catch (caught) {
      result.error = describeCaught(caught);
      probes.set(path, result);
      continue;
    }

    if (result.stat === "dir" && descriptor.needsListDir) {
      try {
        const children = probe.listDir(path);
        if (children === null) {
          result.error = `listDir returned null for "${path}"`;
        } else {
          result.children = children;
        }
      } catch (caught) {
        result.error = describeCaught(caught);
      }
    }

    if (result.stat === "file" && descriptor.needsContent) {
      try {
        const content = probe.readFile(path);
        if (content === null) {
          result.error = `readFile returned null for "${path}"`;
        } else {
          result.content = content;
        }
      } catch (caught) {
        result.error = describeCaught(caught);
      }
    }

    probes.set(path, result);
  }

  return probes;
}

/** Renders any thrown value as a diagnostic string (never re-throws). */
function describeCaught(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
