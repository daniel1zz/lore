/**
 * Deterministic (non-LLM) pre-checks for the review-judgment pipeline — the mechanical
 * checks a reviewing service runs BEFORE handing a document to the AI judge. Pure,
 * browser-safe module: no IO, no Date.now()/Math.random() calls, no StoreInterface
 * dependency (the caller assembles a ReviewBundle first; this module only reads it).
 *
 * Public surface:
 *   - ReviewBundle — {doc, parent?, links, brokenLinkTargets?, blueprint?}, the contract
 *     between CorpusService.getReviewBundle (assembly) and this module + AIProviderService
 *     .judgeDoc (consumption)
 *   - runDeterministicChecks(bundle) — runs all five mechanical checks and returns one
 *     CheckResult per check, always in a fixed order
 *
 * Invariants:
 *   - Referentially transparent: same ReviewBundle in → same CheckResult[] out, always.
 *   - Every check reports "skipped" (never a silent pass) when its prerequisite data is
 *     absent from the bundle — see each check's own doc comment below for its specific
 *     skip condition. A caller-visible "skipped" outcome is a compromise on completeness,
 *     never a compromise on honesty about what was actually verified.
 *   - "tree_position" is doc-local: it checks whether THIS doc's (type, parent-type) pair
 *     matches a modeled position anywhere in the supplied TreeBlueprint. It does NOT walk
 *     the corpus (that full-tree drift detection is TreeCheckService.checkTree's job —
 *     a different granularity for a different caller).
 *
 * Side-effect class: pure
 *
 * Source: SPEC-034 §1, §4
 */

import type { CheckResult } from "./review-judgment.js";
import type { DocId, DocRecord, DocType, LinkRecord } from "./types.js";
import type { TreeBlueprint, TreeNodeSpec } from "./tree-blueprint.js";
import { isValidParentType, ROOT_TYPES } from "./doc-type-rules.js";
import {
  adrExtraSchema,
  knowledgeExtraSchema,
  planExtraSchema,
  prdExtraSchema,
  specExtraSchema,
  taskExtraSchema,
} from "./schemas.js";

// ─── Review Bundle ──────────────────────────────────────────────────────────

/**
 * Everything `runDeterministicChecks` and `AIProviderService.judgeDoc` need to evaluate
 * one document, assembled by `CorpusService.getReviewBundle`. Mirrors `PlanBundle`'s role
 * for `assessPlan` (SPEC-026 §3 D1).
 *
 * @invariant `parent` is `undefined` (not `null`) when the doc has no parent_id, or its
 *   parent_id points at a doc that no longer exists — the latter case degrades to
 *   "no parent modeled" rather than throwing; `parent_contract`/`tree_position` checks
 *   treat an absent parent the same way regardless of which case produced it.
 * @invariant `brokenLinkTargets` is present ONLY when at least one of `links`' from_id/to_id
 *   (whichever isn't `doc.id`) no longer resolves to a live doc — absent means "checked,
 *   all links resolve", not "not checked" (see `link_integrity`'s own skip semantics: it
 *   never skips, since links + resolution are always computable once the bundle exists).
 * @invariant `blueprint` is `undefined` when `lore.tree.yaml` is absent from the repo —
 *   `tree_position` degrades to "skipped" in that case, never a silent pass.
 */
export interface ReviewBundle {
  doc: DocRecord;
  parent?: DocRecord;
  links: LinkRecord[];
  brokenLinkTargets?: DocId[];
  blueprint?: TreeBlueprint;
}

// ─── Check: schema ──────────────────────────────────────────────────────────

/**
 * Validate `doc.extra` against its type-specific Zod schema — reuses the same six
 * schemas `createDocInputSchema` delegates to (schemas.ts), never a duplicated shape.
 * A `switch` (not a lookup table) sidesteps TS method-bivariance friction between the
 * six schemas' distinct `Output` generics.
 */
function safeParseExtraForType(doc: DocRecord): { success: boolean; issues: { path: (string | number)[]; message: string }[] } {
  switch (doc.type) {
    case "prd": {
      const r = prdExtraSchema.safeParse(doc.extra);
      return { success: r.success, issues: r.success ? [] : r.error.issues };
    }
    case "spec": {
      const r = specExtraSchema.safeParse(doc.extra);
      return { success: r.success, issues: r.success ? [] : r.error.issues };
    }
    case "adr": {
      const r = adrExtraSchema.safeParse(doc.extra);
      return { success: r.success, issues: r.success ? [] : r.error.issues };
    }
    case "plan": {
      const r = planExtraSchema.safeParse(doc.extra);
      return { success: r.success, issues: r.success ? [] : r.error.issues };
    }
    case "task": {
      const r = taskExtraSchema.safeParse(doc.extra);
      return { success: r.success, issues: r.success ? [] : r.error.issues };
    }
    case "knowledge": {
      const r = knowledgeExtraSchema.safeParse(doc.extra);
      return { success: r.success, issues: r.success ? [] : r.error.issues };
    }
  }
}

function checkSchema(doc: DocRecord): CheckResult {
  const parsed = safeParseExtraForType(doc);
  if (parsed.success) {
    return { check: "schema", outcome: "pass" };
  }
  const issue = parsed.issues[0];
  const detail = issue
    ? `${issue.path.join(".") || "(root)"}: ${issue.message}`
    : `extra fields do not match the ${doc.type} schema`;
  return { check: "schema", outcome: "fail", detail };
}

// ─── Check: parent_contract ─────────────────────────────────────────────────

function checkParentContract(bundle: ReviewBundle): CheckResult {
  const { doc, parent } = bundle;

  if (parent === undefined) {
    if (ROOT_TYPES.includes(doc.type)) {
      return { check: "parent_contract", outcome: "pass" };
    }
    return {
      check: "parent_contract",
      outcome: "fail",
      detail: `${doc.type} has no resolvable parent, but '${doc.type}' is not a root type`,
    };
  }

  if (isValidParentType(doc.type, parent.type)) {
    return { check: "parent_contract", outcome: "pass" };
  }
  return {
    check: "parent_contract",
    outcome: "fail",
    detail: `parent type '${parent.type}' is not a valid parent for '${doc.type}'`,
  };
}

// ─── Check: tree_position ───────────────────────────────────────────────────

/**
 * Doc-local walk of a TreeBlueprint: does `targetType` appear anywhere in the modeled
 * tree, and if so, under which parent type(s)? `null` in `allowedParentTypes` means
 * "modeled as the root — expects no parent."
 */
function collectModeledPositions(
  blueprint: TreeBlueprint,
  targetType: DocType,
): { modeled: boolean; allowedParentTypes: Set<DocType | null> } {
  const allowedParentTypes = new Set<DocType | null>();
  let modeled = false;

  function walk(node: TreeNodeSpec, parentType: DocType | null): void {
    if (node.type === targetType) {
      modeled = true;
      allowedParentTypes.add(parentType);
    }
    for (const child of node.children) {
      walk(child, node.type);
    }
  }
  walk(blueprint.root, null);

  return { modeled, allowedParentTypes };
}

function checkTreePosition(bundle: ReviewBundle): CheckResult {
  if (bundle.blueprint === undefined) {
    return { check: "tree_position", outcome: "skipped", detail: "no lore.tree.yaml" };
  }

  const { doc, parent } = bundle;
  const { modeled, allowedParentTypes } = collectModeledPositions(bundle.blueprint, doc.type);

  if (!modeled) {
    return {
      check: "tree_position",
      outcome: "fail",
      detail: `'${doc.type}' is not modeled anywhere in lore.tree.yaml`,
    };
  }

  const actualParentType: DocType | null = parent?.type ?? null;
  if (allowedParentTypes.has(actualParentType)) {
    return { check: "tree_position", outcome: "pass" };
  }
  return {
    check: "tree_position",
    outcome: "fail",
    detail: `doc's parent type '${actualParentType ?? "(none)"}' does not match any modeled position for '${doc.type}' in lore.tree.yaml`,
  };
}

// ─── Check: link_integrity ───────────────────────────────────────────────────

function checkLinkIntegrity(bundle: ReviewBundle): CheckResult {
  if (bundle.brokenLinkTargets === undefined || bundle.brokenLinkTargets.length === 0) {
    return { check: "link_integrity", outcome: "pass" };
  }
  return {
    check: "link_integrity",
    outcome: "fail",
    detail: `broken link target(s): ${bundle.brokenLinkTargets.join(", ")}`,
  };
}

// ─── Check: evidence_completeness ───────────────────────────────────────────

function checkEvidenceCompleteness(doc: DocRecord): CheckResult {
  if (doc.type !== "task") {
    return { check: "evidence_completeness", outcome: "skipped", detail: "not a task doc" };
  }
  const raw = doc.extra["verification_evidence"];
  if (Array.isArray(raw) && raw.length > 0) {
    return { check: "evidence_completeness", outcome: "pass" };
  }
  return {
    check: "evidence_completeness",
    outcome: "fail",
    detail: "task has no verification_evidence entries",
  };
}

// ─── Public entry point ─────────────────────────────────────────────────────

/**
 * Run all five mechanical (non-LLM) review pre-checks against a ReviewBundle, in a fixed
 * order: schema, parent_contract, tree_position, link_integrity, evidence_completeness.
 *
 * @param bundle - Assembled by `CorpusService.getReviewBundle`
 * @returns One `CheckResult` per check, always five entries in the fixed order above
 *
 * @example
 * const checks = runDeterministicChecks(bundle);
 * const anyFailed = checks.some((c) => c.outcome === "fail");
 */
export function runDeterministicChecks(bundle: ReviewBundle): CheckResult[] {
  return [
    checkSchema(bundle.doc),
    checkParentContract(bundle),
    checkTreePosition(bundle),
    checkLinkIntegrity(bundle),
    checkEvidenceCompleteness(bundle.doc),
  ];
}
