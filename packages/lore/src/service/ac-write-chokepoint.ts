/**
 * Module: ac-write-chokepoint — the ONE function every write that touches
 * `extra.acceptance_criteria` passes through (baseline slice 2a §C3, closes issue #36 for ACs).
 *
 * Public surface: {@link applyAcChange}, {@link admitAcWrite}, {@link decorateCiteRefusal},
 * {@link resolveCiteGateFor}, {@link AcWritePath}, {@link AC_WRITE_NOT_VIA_AC_VERB}.
 * Invariants:
 *   - A change is detected on the canonical JSON of the array (`JSON.stringify`; order and every
 *     field significant) — reordered, reworded, appended, dropped, added-from-absent all count.
 *   - `"ac-verb"` (the `AcService` verbs) is a sanctioned path: it always passes (the verb has
 *     already schema-validated and linted its candidate).
 *   - `"create"`, `"restore"`, `"import"` are the other sanctioned paths (spec amendment log,
 *     2026-10-08: refusing create deleted baseline rule BR-5). Their incoming array is treated
 *     as an addition and re-validated here with `specAcceptanceCriteriaSchema` (shape, unique
 *     ids, 50 cap); create's wording gate (`acQuantifiable` via GateEnforcer) runs in
 *     `_createImpl` on the same array. An invalid array is refused with VALIDATION_ERROR.
 *   - `"wholesale"` (CorpusService.set — hence CLI `lore set`, MCP `lore_set`, HTTP PATCH)
 *     passes only when the incoming array is byte-identical to the stored one (an echo).
 *   - {@link applyAcChange} is pure: no IO, no clock. Returns a Result; never throws.
 *   - {@link admitAcWrite} is the citation-gate half (spec C4, AC-BLS2-2): the SAME chokepoint decides, on
 *     every sanctioned path (`ac-verb`, `create`), whether an ADDED or REVISED criterion may be written. It
 *     reads the store (baseline docs; exemptions, which the gate honours — an unexpired one waives an uncited criterion, BR-959; on refusal also specs and `ac_cites`) but never writes;
 *     the decision itself is the pure `ac-cite-gate.ts::decideCiteGate`. The liveness re-check that closes
 *     the retire-vs-cite race happens in the write transaction (`ProvenanceWriteExtras.require_live_rules`),
 *     not here — a read here is only the early, friendly answer.
 * Side-effect class: `applyAcChange` pure; `admitAcWrite` store reads + one clock read.
 *
 * Source: spec-baseline-slice-2-completeness-census-per-branch-citation §C3, AC-BLS2-1.
 */

import {
  DEBT_RULE_ID_PATTERN,
  err,
  ok,
  specAcceptanceCriteriaSchema,
  type AcCiteViolation,
  type AcceptanceCriterion,
  type AuditEntry,
  type DocId,
  type LoreError,
  type Result,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import {
  buildCiteFeedingPack,
  changedCriteria,
  CiteGateConfigError,
  activeExemptedAcIds,
  decideCiteGate,
  indexBaseline,
  placeSpecInBranch,
  resolveCiteGateConfig,
  type CiteGateConfig,
  type CiteGateFinding,
} from "./ac-cite-gate.js";
import { loadRuleIndexData } from "./rule-index-loader.js";

/** The refusal code — also the `LoreError` discriminant in `@lore/core` errors.ts. */
export const AC_WRITE_NOT_VIA_AC_VERB = "AC_WRITE_NOT_VIA_AC_VERB" as const;
const AC_CITE_REQUIRED = "AC_CITE_REQUIRED" as const;

/** Who is writing: a sanctioned path (verb/create/restore/import) or a wholesale `extra` replace. */
export type AcWritePath = "ac-verb" | "create" | "restore" | "import" | "wholesale";

const KEY = "acceptance_criteria";

/**
 * BR-980: a debt entry `AD-n` is never citable. Every criterion in `incoming` that cites one yields
 * one violation; works on the raw (unvalidated) value, so it holds on every write path.
 */
function debtCiteViolations(incoming: unknown): AcCiteViolation[] {
  if (!Array.isArray(incoming)) return [];
  const found: AcCiteViolation[] = [];
  for (const criterion of incoming as unknown[]) {
    if (typeof criterion !== "object" || criterion === null) continue;
    const { id, cites } = criterion as { id?: unknown; cites?: unknown };
    if (!Array.isArray(cites)) continue;
    for (const cited of cites as unknown[]) {
      if (typeof cited === "string" && DEBT_RULE_ID_PATTERN.test(cited)) {
        found.push({ ...(typeof id === "string" ? { ac_id: id } : {}), rule_id: cited, reason: "debt" });
      }
    }
  }
  return found;
}

/** Canonical JSON of the criteria value; `undefined` (absent) is its own distinct token. */
function canonical(value: unknown): string {
  return value === undefined ? "<absent>" : JSON.stringify(value);
}

/**
 * Admit or refuse a write by whether it changes `extra.acceptance_criteria`.
 *
 * @param path - `"ac-verb"` always admits; `"wholesale"` admits only a byte-identical echo.
 * @param before - the stored `extra` (`undefined` on create — no stored doc yet).
 * @param after - the `extra` the write would persist (`undefined` = write carries no extra → no change).
 * @param docId - the doc being written, for the refusal (absent on create).
 *
 * @example
 * applyAcChange("wholesale", doc.extra, { acceptance_criteria: changed }, doc.id); // err AC_WRITE_NOT_VIA_AC_VERB
 */
export function applyAcChange(
  path: AcWritePath,
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined,
  docId?: string,
): Result<void, LoreError> {
  if (after === undefined) return ok(undefined);
  // reason: BR-980 is unconditional — it holds on every path, the sanctioned verbs included, and
  // needs no gate mode or armed branch; it runs before any write so a refusal leaves nothing behind.
  const debtViolations = debtCiteViolations(after[KEY]);
  if (debtViolations.length > 0) {
    const ids = [...new Set(debtViolations.map((v) => v.rule_id))].join(", ");
    return err({
      code: AC_CITE_REQUIRED,
      ...(docId !== undefined ? { id: docId } : {}),
      message:
        `${ids} is a debt entry: a criterion cites a business rule (BR-n) or an architecture standard (AS-n), ` +
        `never a debt entry. Debt ids are named only in a standard's current_exceptions.`,
      violations: debtViolations,
    });
  }
  if (path === "ac-verb") return ok(undefined);
  if (path !== "wholesale") {
    const incoming = after[KEY];
    if (incoming === undefined) return ok(undefined);
    const parsed = specAcceptanceCriteriaSchema.safeParse(incoming);
    if (parsed.success) return ok(undefined);
    const issue = parsed.error.issues[0];
    return err({
      code: "VALIDATION_ERROR",
      field: issue !== undefined ? `${KEY}.${issue.path.join(".")}` : KEY,
      message: `${path}: ${issue !== undefined ? issue.message : "invalid acceptance criteria"}`,
      value: incoming,
    });
  }
  if (canonical(before?.[KEY]) === canonical(after[KEY])) return ok(undefined);
  return err({
    code: AC_WRITE_NOT_VIA_AC_VERB,
    ...(docId !== undefined ? { id: docId } : {}),
    message:
      `extra.${KEY} is owned by \`lore ac add|set|rm|cite\` — \`lore set\`/\`lore_set\`/PATCH ` +
      `replace \`extra\` wholesale and must not add, drop, reword or reorder criteria. ` +
      `Use \`lore ac add|set|rm|cite\` instead, or pass the stored array byte-identical.`,
  });
}

// ─── Citation gate (spec-baseline-slice-2 §C4, AC-BLS2-2) ────────────────────────────────────────

/** The audit `details.operation` (and `action`) of a report-mode would-refuse decision. */
export const CITE_GATE_WOULD_REFUSE_OPERATION = "cite_gate_would_refuse" as const;

/** The doc a gated write targets, as the gate needs to know it. */
export interface AcWriteTarget {
  /** The spec's id (a create passes the id it has already allocated). */
  id: string;
  slug: string;
  /** The spec's `extra.code_anchors` (`path[#Symbol]`). */
  anchors: readonly string[];
}

/** Input of {@link admitAcWrite}. */
export interface AdmitAcWriteInput {
  /** Raw, untrusted `workflow.gates."ac-cite"` entry (`undefined` = not configured). */
  rawGateConfig: unknown;
  target: AcWriteTarget;
  /** The spec's criteria before the write (`[]` on create). */
  existing: readonly AcceptanceCriterion[];
  /** The spec's criteria after the write. */
  next: readonly AcceptanceCriterion[];
  /** Resolved actor, stamped on any would-refuse audit row. */
  actor: string;
}

/** What a passing gate hands the write. */
export interface AcWriteAdmission {
  /** Rule ids the write transaction must find live (enforce + armed only; empty otherwise). */
  requireLiveRules: string[];
  /** One would-refuse audit entry per refused criterion (report mode); appended in the write's transaction. */
  wouldRefuseAudit: AuditEntry[];
}

const NO_ADMISSION_CONSTRAINTS: AcWriteAdmission = { requireLiveRules: [], wouldRefuseAudit: [] };

function isConfiguredMode(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && (raw as Record<string, unknown>)["mode"] !== undefined;
}

/**
 * Resolve the gate configuration for this corpus: the raw entry plus whether baseline docs exist (probed
 * only when the entry does not pin a mode). A malformed entry is a loud `VALIDATION_ERROR`, never a default.
 */
export async function resolveCiteGateFor(
  store: StoreInterface,
  rawGateConfig: unknown,
): Promise<Result<CiteGateConfig, LoreError>> {
  let hasBaselineDocs = false;
  if (!isConfiguredMode(rawGateConfig)) {
    const found = await store.findMany({ type: "baseline", limit: 1 });
    if (!found.ok) return found;
    hasBaselineDocs = found.value.length > 0;
  }
  try {
    return ok(resolveCiteGateConfig(rawGateConfig, hasBaselineDocs));
  } catch (cause) {
    if (cause instanceof CiteGateConfigError) {
      return err({ code: "VALIDATION_ERROR", field: cause.field, message: cause.message, value: cause.value });
    }
    throw cause;
  }
}

function wouldRefuseEntry(
  target: AcWriteTarget,
  actor: string,
  nowIso: string,
  mode: CiteGateConfig["mode"],
  finding: CiteGateFinding,
): AuditEntry {
  return {
    timestamp: nowIso,
    actor,
    session_id: target.id,
    action: CITE_GATE_WOULD_REFUSE_OPERATION,
    doc_id: target.id as DocId,
    details: {
      operation: CITE_GATE_WOULD_REFUSE_OPERATION,
      ac_id: finding.ac_id,
      code: "AC_CITE_REQUIRED",
      mode,
      violations: finding.violations,
    },
  };
}

/**
 * Admit or refuse a write that adds or revises acceptance criteria — the citation gate at the chokepoint.
 * Call it AFTER {@link applyAcChange} on the `ac-verb` and `create` paths.
 *
 * @returns `ok(admission)` — the write may proceed; hand `admission.requireLiveRules` /
 *   `admission.wouldRefuseAudit` to the store's `updateWithProvenance` extras (a create appends the audit
 *   entries after its insert). `err(AC_CITE_REQUIRED)` with a feeding pack when mode is `enforce`, the
 *   spec's branch is armed and an added/revised criterion cites no live rule. `err(VALIDATION_ERROR)` for a
 *   malformed gate config; a store error is passed through.
 * @example
 * const gate = await admitAcWrite(store, { rawGateConfig, target, existing, next, actor });
 * if (!gate.ok) return gate;
 */
export async function admitAcWrite(
  store: StoreInterface,
  input: AdmitAcWriteInput,
): Promise<Result<AcWriteAdmission, LoreError>> {
  const config = await resolveCiteGateFor(store, input.rawGateConfig);
  if (!config.ok) return config;
  if (config.value.mode === "off") return ok(NO_ADMISSION_CONSTRAINTS);
  // reason: QA-1 — an untouched write (no added/revised criterion) costs one config probe and nothing else.
  if (changedCriteria(input.existing, input.next).length === 0) return ok(NO_ADMISSION_CONSTRAINTS);

  const baseline = await store.findMany({ type: "baseline" });
  if (!baseline.ok) return baseline;
  const index = indexBaseline(baseline.value);
  // reason: BR-959 / #105 — an unexpired exemption must be known BEFORE the decision. A failed read is
  // returned, never read as "no exemptions" (that would refuse a legitimately exempted write).
  const exemptions = await store.listAcExemptions();
  if (!exemptions.ok) return exemptions;
  const nowIso = new Date().toISOString();
  const exempted = activeExemptedAcIds(exemptions.value, input.target.id, nowIso);
  const decision = decideCiteGate(config.value, input.existing, input.next, index, exempted);

  if (decision.kind === "skip") return ok(NO_ADMISSION_CONSTRAINTS);
  if (decision.kind === "admit") {
    return ok({
      requireLiveRules: decision.requireLiveRules,
      wouldRefuseAudit: decision.findings.map((f) =>
        wouldRefuseEntry(input.target, input.actor, nowIso, config.value.mode, f),
      ),
    });
  }

  const violations: AcCiteViolation[] = decision.findings.flatMap((f) => f.violations);
  return err(
    await buildRefusal(store, input.target, input.existing, input.next, decision.message, violations, decision.findings[0]),
  );
}

async function buildRefusal(
  store: StoreInterface,
  target: AcWriteTarget,
  existing: readonly AcceptanceCriterion[],
  next: readonly AcceptanceCriterion[],
  message: string,
  violations: AcCiteViolation[],
  first: CiteGateFinding | undefined,
): Promise<LoreError> {
  const base = { code: "AC_CITE_REQUIRED" as const, id: target.id, message, violations };
  if (first === undefined) return base;
  // reason: a store failure while assembling the pack surfaces AS that failure — never a refusal that
  // silently lacks its pack (no silent fallback). Nothing was written either way.
  const data = await loadRuleIndexData(store);
  if (!data.ok) return data.error;
  const exemptions = await store.listAcExemptions();
  if (!exemptions.ok) return exemptions.error;
  const index = indexBaseline(data.value.baseline);
  const refused = next.find((c) => c.id === first.ac_id);
  return {
    ...base,
    feeding_pack: buildCiteFeedingPack({
      specId: target.id,
      specSlug: target.slug,
      acId: first.ac_id,
      acStatement: refused?.statement,
      specAnchors: target.anchors,
      branch: placeSpecInBranch(existing.length > 0 ? existing : next, index),
      data: data.value,
      exemptions: exemptions.value,
      nowIso: new Date().toISOString(),
    }),
  };
}

/**
 * Give the store's bare in-transaction refusal (`AC_CITE_REQUIRED` without a feeding pack, raised when a
 * concurrent retire committed between {@link admitAcWrite}'s read and the write) the same shape a gate
 * refusal has: the violations name the criteria that cited the non-live ids, and the pack is attached.
 * Any other error, and an `AC_CITE_REQUIRED` that already carries a pack, is returned unchanged.
 */
export async function decorateCiteRefusal(
  store: StoreInterface,
  error: LoreError,
  input: Pick<AdmitAcWriteInput, "target" | "existing" | "next">,
): Promise<LoreError> {
  if (error.code !== "AC_CITE_REQUIRED" || error.feeding_pack !== undefined) return error;
  const reasonOf = new Map<string, AcCiteViolation["reason"]>();
  for (const v of error.violations) if (v.rule_id !== undefined) reasonOf.set(v.rule_id, v.reason);
  const violations: AcCiteViolation[] = [];
  for (const candidate of changedCriteria(input.existing, input.next)) {
    for (const ruleId of candidate.cites) {
      const reason = reasonOf.get(ruleId);
      if (reason !== undefined) violations.push({ ac_id: candidate.ac_id, rule_id: ruleId, reason });
    }
  }
  const first = violations[0];
  return buildRefusal(
    store,
    input.target,
    input.existing,
    input.next,
    error.message,
    violations.length > 0 ? violations : error.violations,
    first?.ac_id !== undefined ? { ac_id: first.ac_id, violations } : undefined,
  );
}
