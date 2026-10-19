/**
 * TreeCheckService — checks structural conformance, fixes drift, reconciles
 * parent_id field vs. link table for the Lore corpus tree.
 *
 * Spec: TECH-01KV4W88GZF74B98BHCBBV9GHD §4.3 + §4.4 + §10
 *
 * SPEC-069 §Design Decisions D2 exception: a `task` with `extra.adhoc ===
 * true` parented to the corpus root PRD is a sanctioned deviation from
 * `PARENT_TYPE_CONTRACT` (see `isAdhocTaskUnderRoot`, below) and never
 * reports `misplaced` — a non-adhoc task under a PRD still does.
 *
 * BR-400 / BR-2 (baseline-slice-3b): a PARENTLESS type (`spec`, see `isParentlessType`) with no
 * parent is neither an orphan nor misplaced — it belongs to the trees through criterion citations.
 * A spec that still HAS a parent is `misplaced` (the contract has no legal parent for it), and
 * `fix()` never re-parents one: its blueprint slot lives at "no parent", so it yields no candidate.
 */

import type { StoreInterface } from "../store/store-interface.js";
import type { TreeBlueprint, TreeNodeSpec } from "@lore/core";
import type { DocType, DocId, DocRecord, DocStatus } from "@lore/core";
import { err, ok, type LoreError, type Result } from "@lore/core";
import { isParentlessType, isValidParentType, ROOT_TYPES } from "@lore/core";
import { ancestorChainWalk } from "@lore/core";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";

// ─── Public Types ──────────────────────────────────────────────────────────

/**
 * `"plan-terminality"` (spec-plan-closure-must-be-loud-terminality-divergence-
 * silent DD-1) is deliberately EXCLUDED from `fix()`'s fixable-kind filter
 * below — auto-transitioning a plan to `archived` would fire the `plan-close`
 * governance gate from inside a repair command. It is reported only; the
 * remediation command is left for a human/agent to run deliberately.
 */
export type DriftKind =
  | "missing"
  | "extra"
  | "misplaced"
  | "cycle"
  | "orphan"
  | "plan-terminality";

export interface TreeDrift {
  kind: DriftKind;
  expected?: { type: DocType; min: number; max: number | null; at: string };
  actual?: { id: DocId; slug: string; type: DocType; parent_id: DocId | null };
  blocked_by_cycles?: DocId[];
  detail: string;
}

export interface TreeReport {
  consistent: boolean;
  drifts: readonly TreeDrift[];
}

export interface FixedItem {
  id: DocId;
  fromParentId: DocId | null;
  toParentId: DocId;
  newVersion: number;
}

export interface SkippedItem {
  id: DocId;
  reason: "0-or-many candidates" | "would-create-cycle";
  candidates: DocId[];
}

export interface FixReport {
  fixed: FixedItem[];
  skipped: SkippedItem[];
  stillInconsistent: boolean;
}

export interface ReconcileInconsistency {
  doc_id: DocId;
  link_table_parent: DocId | null;
  parent_id_field: DocId | null;
  detail: string;
}

export interface ReconcileReport {
  inconsistencies: ReconcileInconsistency[];
}

// ─── TreeCheckService ──────────────────────────────────────────────────────

export class TreeCheckService {
  constructor(
    private readonly store: StoreInterface,
    /** The one write route (`CorpusService`, AC-DCL-3); `app.ts` passes the composed one, a bare test gets a bare writer. */
    writer?: DocWritePort,
  ) {
    this.writer = writer ?? bareDocWriter(store);
  }

  private readonly writer: DocWritePort;

  // ── checkTree ─────────────────────────────────────────────────────────────

  async checkTree(blueprint: TreeBlueprint): Promise<Result<TreeReport, LoreError>> {
    const allR = await this.store.findMany({ exclude_deleted: true });
    if (allR.ok === false) return allR;
    const allDocs = allR.value;

    const byId = new Map<DocId, DocRecord>(allDocs.map((d) => [d.id, d]));
    const getParent = (id: DocId): DocId | null => byId.get(id)?.parent_id ?? null;

    // Step 1: detect cyclic nodes
    const cyclic = detectCyclicNodes(allDocs, getParent);

    const drifts: TreeDrift[] = [];

    // Step 2: cycle drifts (one per unique cycle, deduped by sorted path key)
    const emittedCycleKeys = new Set<string>();
    for (const d of allDocs) {
      if (!cyclic.has(d.id)) continue;
      const walk = ancestorChainWalk(d.id, getParent);
      if (walk.hasCycle) {
        const key = [...walk.path].sort().join(",");
        if (!emittedCycleKeys.has(key)) {
          emittedCycleKeys.add(key);
          drifts.push({
            kind: "cycle",
            blocked_by_cycles: walk.path as DocId[],
            detail: `Cycle detected: ${walk.path.join(" → ")}`,
          });
        }
      }
    }

    // Step 3: orphan drifts (non-cyclic docs with missing/unknown parent)
    for (const d of allDocs) {
      if (cyclic.has(d.id)) continue;

      const isOrphan =
        (d.parent_id === null && !ROOT_TYPES.includes(d.type) && !isParentlessType(d.type)) ||
        (d.parent_id !== null && !byId.has(d.parent_id));

      if (isOrphan) {
        drifts.push({
          kind: "orphan",
          actual: { id: d.id, slug: d.slug, type: d.type, parent_id: d.parent_id },
          detail: d.parent_id === null
            ? `${d.type} has no parent but is not a root type`
            : `${d.type} parent_id ${d.parent_id} not found in store`,
        });
      }
    }

    // Step 4: misplaced drifts (non-cyclic, parent exists, but wrong parent type)
    const misplacedIds = new Set<DocId>();
    for (const d of allDocs) {
      if (cyclic.has(d.id)) continue;
      if (d.parent_id === null) continue;
      if (!byId.has(d.parent_id)) continue; // already orphan

      const parent = byId.get(d.parent_id)!;
      if (!isValidParentType(d.type, parent.type)) {
        if (isAdhocTaskUnderRoot(d, parent)) continue; // SPEC-069 D2 sanctioned exception
        misplacedIds.add(d.id);
        drifts.push({
          kind: "misplaced",
          actual: { id: d.id, slug: d.slug, type: d.type, parent_id: d.parent_id },
          detail: `${d.type} under ${parent.type} (id=${d.parent_id}) violates parent-type contract`,
        });
      }
    }

    // Step 4.5: plan-terminality drifts (DD-1, spec-plan-closure-must-be-loud-
    // terminality-divergence-silent) — a `plan` doc whose OWN status is not
    // yet terminal while every child `task` doc IS terminal. This is the
    // "work finished but the plan was never walked through VALID_TRANSITIONS
    // to close it" signal that let a session report a plan closed while its
    // own doc sat in `draft` and the `plan-close` gate never fired.
    //
    // ⛔ Vacuous guard: a plan with ZERO child tasks is never flagged — "no
    // evidence of non-terminality" is not "proof the plan is done". A
    // detector that fired on every freshly-created plan would be strictly
    // worse than shipping no detector at all.
    for (const d of allDocs) {
      if (d.type !== "plan") continue;
      if (cyclic.has(d.id)) continue; // cyclic tree state is already reported via `cycle`
      if (isTerminalDocStatus(d.status)) continue; // nothing to announce — already closed

      const childTasks = allDocs.filter((c) => c.type === "task" && c.parent_id === d.id);
      if (childTasks.length === 0) continue; // vacuous guard — DD-1 boundary case
      if (!childTasks.every((c) => isTerminalDocStatus(c.status))) continue;

      drifts.push({
        kind: "plan-terminality",
        actual: { id: d.id, slug: d.slug, type: d.type, parent_id: d.parent_id },
        // reason: this used to read "The plan-close gate never evaluated it" —
        // false under the default config. `corpus-service.ts:2029` reads
        // `this.gateEnforcer.isEnabled("plan-close")`, and `resolveGateEnabled`
        // (packages/core/src/config.ts:1115) returns `!== false`, so the
        // `plan-close` checkpoint DOES evaluate on the very command this
        // message tells you to run — measured 2026-08-10,
        // spec-governance-visibility-an-armed-gate-that-vacuously-passes §B1.
        // The command below is deliberately unchanged; only the justification
        // for it is corrected.
        detail:
          `Plan ${d.slug} has all ${childTasks.length} child task(s) terminal ` +
          `(archived/deprecated) but the plan itself is still "${d.status}" — ` +
          `it was never walked through VALID_TRANSITIONS to close. Run: ` +
          `lore set ${d.slug} --status archived (the plan-close gate WILL ` +
          `evaluate this transition unless explicitly disabled in config; the ` +
          `archival cascade that follows is a separate, deliberately ungated ` +
          `data-integrity mechanism).`,
      });
    }

    // Step 5: blueprint walk — missing/extra
    walkBlueprint(blueprint.root, null, allDocs, byId, cyclic, misplacedIds, drifts);

    return ok({ consistent: drifts.length === 0, drifts });
  }

  // ── fix ───────────────────────────────────────────────────────────────────

  /**
   * @invariant SPEC-079 G1 + AC-DCL-3 — every APPLIED repair (an entry landing in `FixReport.fixed`, never a
   *   `skipped` one) is ONE write on the one write route (`CorpusService.writeDoc`): the `parent_id` update,
   *   its version row (#276) and its audit entry (`action: "tree-fix"`, `doc_id` = the fixed doc,
   *   `details: {kind, doc_id, old_parent_id, new_parent_id}`) in one transaction, attributed to the caller.
   * @param opts.by - Optional explicit actor (no adapter currently threads
   *   one — `lore status --check-tree --fix` is this method's sole
   *   production caller and passes none); omitted falls back to the store
   *   write context's claimed name, the same chain every `CorpusService` write uses.
   */
  async fix(
    blueprint: TreeBlueprint,
    opts?: { by?: string },
  ): Promise<Result<FixReport, LoreError>> {
    const checkR = await this.checkTree(blueprint);
    if (checkR.ok === false) return checkR;

    const { drifts } = checkR.value;
    // ⛔ `"plan-terminality"` is deliberately absent from this allow-list — see
    // the `DriftKind` JSDoc. Auto-transitioning a plan here would fire the
    // `plan-close` governance gate from inside a repair command; it is
    // reported by `checkTree()` above but never auto-fixed.
    const fixableDrifts = drifts.filter(
      (d) => (d.kind === "orphan" || d.kind === "misplaced") && d.actual !== undefined,
    );

    if (fixableDrifts.length === 0) {
      return ok({ fixed: [], skipped: [], stillInconsistent: false });
    }

    const allR = await this.store.findMany({ exclude_deleted: true });
    if (allR.ok === false) return allR;
    const allDocs = allR.value;
    const byId = new Map<DocId, DocRecord>(allDocs.map((d) => [d.id, d]));

    // Collect all blueprint positions (childType → actual parent docs of required parent type)
    const blueprintPositions = collectBlueprintPositions(blueprint.root, null, allDocs);

    // Pre-compute dangling phantom parents using the ORIGINAL byId (pre-fix) state.
    // When a drift's actual.parent_id references a doc not in the store, that phantom ID
    // may form a cycle if placed per blueprint (children still point to the phantom).
    // Must be checked before applying any fixes that would sever the cycle evidence.
    const phantomSkips = detectPhantomParentCycles(fixableDrifts, byId, blueprintPositions);

    const fixed: FixedItem[] = [];
    // Start skipped with phantom cycles detected in pre-fix state
    const skipped: SkippedItem[] = [...phantomSkips];


    for (const drift of fixableDrifts) {
      const doc = drift.actual!;

      // Find candidates: blueprint positions where this doc's type fits, with existing parent docs
      const candidates = blueprintPositions
        .filter((pos) => pos.childType === doc.type && pos.parentDoc !== null)
        .map((pos) => pos.parentDoc!);

      if (candidates.length !== 1) {
        skipped.push({
          id: doc.id,
          reason: "0-or-many candidates",
          candidates: candidates.map((c) => c.id),
        });
        continue;
      }

      const candidate = candidates[0]!;

      // Cycle guard: simulate moving doc → candidate
      const simulatedGetParent = (id: DocId): DocId | null => {
        if (id === doc.id) return candidate.id;
        return byId.get(id)?.parent_id ?? null;
      };

      const cycleCheck = ancestorChainWalk(doc.id, simulatedGetParent);
      if (cycleCheck.hasCycle) {
        skipped.push({
          id: doc.id,
          reason: "would-create-cycle",
          candidates: [candidate.id],
        });
        continue;
      }

      const currentDoc = byId.get(doc.id);
      if (currentDoc === undefined) return err({ code: "DOC_NOT_FOUND", id: doc.id });

      // reason: AC-DCL-3 / #276 — a repair that moves `parent_id` is a document write: it goes through the one
      // write route so the version bump has its version row (it used to write only an audit row), the audit row
      // names the calling actor, and the write is refused from a foreign-resolved corpus. SPEC-079 G1 keeps the
      // relationship-provenance audit action `tree-fix`.
      const writtenR = await this.writer.writeDoc({
        doc: currentDoc,
        patch: { parent_id: candidate.id },
        action: "update",
        changeSummary: `tree-fix: parent_id ${doc.parent_id ?? "none"} -> ${candidate.id} (${drift.kind})`,
        auditAction: "tree-fix",
        auditDetails: {
          kind: drift.kind,
          doc_id: doc.id,
          old_parent_id: doc.parent_id,
          new_parent_id: candidate.id,
        },
        lock: "none",
        ...(opts?.by !== undefined ? { by: opts.by } : {}),
      });
      if (writtenR.ok === false) return writtenR;
      const updateR = { ok: true as const, value: writtenR.value.doc };

      fixed.push({
        id: doc.id,
        fromParentId: doc.parent_id,
        toParentId: candidate.id,
        newVersion: updateR.value.version,
      });

      // Update local byId so subsequent cycle checks reflect the fix
      byId.set(doc.id, updateR.value);
    }

    const stillInconsistent = skipped.length > 0 || fixed.length < fixableDrifts.length;
    return ok({ fixed, skipped, stillInconsistent });
  }

  // ── reconcile ─────────────────────────────────────────────────────────────

  async reconcile(): Promise<Result<ReconcileReport, LoreError>> {
    const allR = await this.store.findMany({ exclude_deleted: true });
    if (allR.ok === false) return allR;
    const allDocs = allR.value;

    // Batch: ONE findLinksByFromIds over every doc's id instead of one
    // findLinks(doc.id, "out") call per doc (SPEC review M7).
    const allDocIds = allDocs.map((doc) => doc.id);
    const linksByFromIdR = await this.store.findLinksByFromIds(allDocIds, "out");
    if (linksByFromIdR.ok === false) return linksByFromIdR;
    const linksByFromId = linksByFromIdR.value;

    const inconsistencies: ReconcileInconsistency[] = [];

    for (const doc of allDocs) {
      const outLinks = linksByFromId.get(doc.id) ?? [];

      const parentLinks = outLinks.filter((l) => l.link_type === "parent");
      const linkParent = parentLinks.length > 0 ? (parentLinks[0]!.to_id as DocId) : null;

      if (doc.parent_id !== null && linkParent === null) {
        inconsistencies.push({
          doc_id: doc.id,
          link_table_parent: null,
          parent_id_field: doc.parent_id,
          detail: "field set, link missing",
        });
      } else if (doc.parent_id !== null && linkParent !== null && linkParent !== doc.parent_id) {
        inconsistencies.push({
          doc_id: doc.id,
          link_table_parent: linkParent,
          parent_id_field: doc.parent_id,
          detail: "field/link mismatch",
        });
      } else if (doc.parent_id === null && linkParent !== null) {
        inconsistencies.push({
          doc_id: doc.id,
          link_table_parent: linkParent,
          parent_id_field: null,
          detail: "link exists but field null",
        });
      }
    }

    return ok({ inconsistencies });
  }
}

// ─── Private Helpers ───────────────────────────────────────────────────────

/**
 * Detect phantom parents — dangling parent_id references in orphan drifts —
 * and determine if placing them per blueprint would create a cycle.
 *
 * Uses the ORIGINAL byId (pre-fix) state so that children's parent_id fields
 * still point to the phantom, allowing ancestorChainWalk to detect the cycle.
 *
 * Scenario: spec.parent_id = planId (planId not in store). Blueprint: plan under spec.
 * Simulate planId.parent = specId → walk(planId): planId → specId → planId = CYCLE.
 */
function detectPhantomParentCycles(
  fixableDrifts: Array<{ actual?: { id: DocId; slug: string; type: DocType; parent_id: DocId | null } }>,
  byId: Map<DocId, DocRecord>,
  blueprintPositions: Array<{ childType: DocType; parentDoc: DocRecord | null }>,
): SkippedItem[] {
  // Collect all dangling parent IDs (parent_id values that are not in the store)
  const danglingParentIds = new Set<DocId>();
  for (const drift of fixableDrifts) {
    const doc = drift.actual;
    if (doc !== undefined && doc.parent_id !== null && !byId.has(doc.parent_id as DocId)) {
      danglingParentIds.add(doc.parent_id as DocId);
    }
  }

  if (danglingParentIds.size === 0) return [];

  const phantomSkips: SkippedItem[] = [];

  for (const phantomId of danglingParentIds) {
    // Try placing phantomId under each blueprint candidate parent.
    // With ORIGINAL byId, children still have parent_id = phantomId,
    // so the cycle appears as: phantomId → candidateParent → ... → phantomId.
    let found = false;
    for (const pos of blueprintPositions) {
      if (found) break;
      if (pos.parentDoc === null) continue; // skip root positions

      const candidateParentId = pos.parentDoc.id;

      const simGetParent = (id: DocId): DocId | null => {
        if (id === phantomId) return candidateParentId;
        return byId.get(id)?.parent_id ?? null;
      };

      const cycleCheck = ancestorChainWalk(phantomId, simGetParent);
      if (cycleCheck.hasCycle) {
        phantomSkips.push({
          id: phantomId,
          reason: "would-create-cycle",
          candidates: [candidateParentId],
        });
        found = true;
      }
    }
  }

  return phantomSkips;
}

/**
 * A doc's status is terminal — `VALID_TRANSITIONS[status]` is empty
 * (`packages/core/src/schemas.ts`) — iff it is `archived` or `deprecated`.
 * Local to this module (mirrors the same inline check in
 * `packages/core/src/task-workflow.ts`'s `evaluateReadiness`); not imported
 * from `archive-candidates.ts`'s private `TERMINAL_STATUSES`, which is not
 * exported from `@lore/core`.
 */
function isTerminalDocStatus(status: DocStatus): boolean {
  return status === "archived" || status === "deprecated";
}

/**
 * Detect all cyclic node IDs using ancestorChainWalk.
 * Returns a Set of all node IDs that are part of any cycle.
 */
function detectCyclicNodes(
  allDocs: DocRecord[],
  getParent: (id: DocId) => DocId | null,
): Set<DocId> {
  const cyclic = new Set<DocId>();

  for (const d of allDocs) {
    const walk = ancestorChainWalk(d.id, getParent);
    if (walk.hasCycle) {
      for (const nodeId of walk.path) {
        cyclic.add(nodeId as DocId);
      }
    }
  }

  return cyclic;
}

/**
 * SPEC-069 §Design Decisions D2 exception to the misplaced-drift check.
 *
 * `lore create task --adhoc` (and every issue report, which also sets
 * `extra.adhoc: true` — see `packages/core/src/issue-report.ts`) is
 * deliberately auto-parented to the corpus root PRD by `CorpusService`
 * "for tree reachability", bypassing `PARENT_TYPE_CONTRACT.task` (whose
 * only declared parent is `plan`) on purpose — see the design-decision
 * comment at `corpus-service.ts`'s ad-hoc auto-parenting block. Widening
 * `PARENT_TYPE_CONTRACT.task` itself would legalize task→prd for EVERY
 * task (including a non-adhoc caller forcing `--parent` to a PRD), which
 * is a real drift and must keep tripping `misplaced` — see
 * AC-TREE-NEG-05 in the test suite. `TreeNodeSpec` (the `lore.tree.yaml`
 * blueprint shape) has no way to key a slot on `extra.adhoc`, so this
 * carve-out lives here, not in the YAML contract.
 *
 * @returns true iff `doc` is a `task` with `extra.adhoc === true` whose
 *   resolved parent is a ROOT_TYPES doc (i.e. the corpus root PRD).
 */
function isAdhocTaskUnderRoot(doc: DocRecord, parent: DocRecord): boolean {
  return (
    doc.type === "task" &&
    doc.extra?.["adhoc"] === true &&
    ROOT_TYPES.includes(parent.type)
  );
}

/**
 * Glob match: pattern `prd-*` matches any slug starting with `prd-`.
 * `*` alone matches everything. Literal match otherwise.
 */
function globMatch(slug: string, pattern: string | undefined): boolean {
  if (pattern === undefined || pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return slug.startsWith(pattern.slice(0, -1));
  }
  return slug === pattern;
}

/**
 * Recursively walk blueprint, emitting missing/extra drifts.
 */
function walkBlueprint(
  node: TreeNodeSpec,
  actualParentId: DocId | null,
  allDocs: DocRecord[],
  byId: Map<DocId, DocRecord>,
  cyclic: Set<DocId>,
  misplacedIds: Set<DocId>,
  drifts: TreeDrift[],
): void {
  // Docs at this level: same parent, not cyclic. A parentless type's slot is "no parent" wherever
  // the blueprint draws it (the YAML nests `spec` under `prd` to show where it sits in the product
  // layout; the tree contract gives it no parent, BR-2) — so its matches are the parentless docs.
  const slotParentId = isParentlessType(node.type) ? null : actualParentId;
  const siblings = allDocs.filter(
    (d) => d.parent_id === slotParentId && !cyclic.has(d.id),
  );

  // Matched: siblings of this node's type that match the slug glob
  const matched = siblings.filter(
    (d) => d.type === node.type && globMatch(d.slug, node.slug),
  );

  // misSameType: misplaced docs of same type (anywhere in the tree, not just this level)
  // R4 dedupe: if they exist but are misplaced, count them as "would-be-here" to avoid
  // double-counting a missing drift for the same docs already reported as misplaced.
  const misSameTypeCount = allDocs.filter(
    (d) => d.type === node.type && misplacedIds.has(d.id) && !cyclic.has(d.id),
  ).length;

  // Missing check (R4 dedupe)
  const deficit = node.min - matched.length;
  const adjustedDeficit = Math.max(0, deficit - misSameTypeCount);
  if (adjustedDeficit > 0) {
    drifts.push({
      kind: "missing",
      expected: { type: node.type, min: node.min, max: node.max, at: String(slotParentId) },
      detail: `Expected at least ${node.min} ${node.type} under parent ${slotParentId ?? "root"}, found ${matched.length}`,
    });
  }

  // Extra check
  if (node.max !== null && matched.length > node.max) {
    drifts.push({
      kind: "extra",
      expected: { type: node.type, min: node.min, max: node.max, at: String(slotParentId) },
      detail: `Expected at most ${node.max} ${node.type} under parent ${slotParentId ?? "root"}, found ${matched.length}`,
    });
  }

  // Recurse into children for each matched parent doc
  for (const childSpec of node.children) {
    for (const parentDoc of matched) {
      walkBlueprint(childSpec, parentDoc.id, allDocs, byId, cyclic, misplacedIds, drifts);
    }
  }
}

// ─── Blueprint Position Collector ─────────────────────────────────────────

interface BlueprintPosition {
  childType: DocType;
  parentDoc: DocRecord | null;
}

/**
 * Collect all (childType, parentDoc) positions defined by the blueprint,
 * where parentDoc is any store doc of the required parent type.
 *
 * This enumerates what types are valid children of what parent types
 * per the blueprint, then materializes each parent slot to all actual
 * docs in the store of the required parent type.
 *
 * Example: blueprint `prd → spec → plan` means:
 *   - prd can be a root (parentDoc = null)
 *   - spec can live under any prd doc
 *   - plan can live under any spec doc
 *
 * This allows fix() to find candidate parents from ALL store docs of
 * the required type, regardless of their current placement.
 */
function collectBlueprintPositions(
  node: TreeNodeSpec,
  parentType: DocType | null,
  allDocs: DocRecord[],
): BlueprintPosition[] {
  const positions: BlueprintPosition[] = [];

  if (isParentlessType(node.type)) {
    // A parentless type has no parent slot to fill: contribute no position (so `fix()` finds no
    // candidate and never re-parents it), but still recurse so its own children keep their slots.
  } else if (parentType === null) {
    // Root node: parentDoc = null (this type lives at root)
    positions.push({ childType: node.type, parentDoc: null });
  } else {
    // Find all actual docs of the required parent type in the store
    const parentDocs = allDocs.filter((d) => d.type === parentType);
    for (const parentDoc of parentDocs) {
      positions.push({ childType: node.type, parentDoc });
    }
  }

  // Recurse into children — parent type for children is this node's type
  for (const childSpec of node.children) {
    const childPositions = collectBlueprintPositions(childSpec, node.type, allDocs);
    positions.push(...childPositions);
  }

  return positions;
}
