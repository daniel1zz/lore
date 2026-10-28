/**
 * WeightTableService: the ONLY writer of a reference document's `extra.weight_table` (`lore weights set`), and the store-backed
 * {@link WeightTableLookup} the decision gate uses to validate a decision's scores.
 *
 * Purpose: a weight table is the scale every scored decision is weighed on (BR-1482); this service keeps it well-formed
 *   (weights > 0 summing to 1 within 1e-9), unique per kind, and changeable only by a decision citing a drill-down.
 * Public surface: {@link WeightTableService} (`set`, `setDecisionGate`), {@link buildWeightTableLookup}, {@link SetWeightTableInput}.
 * Invariants:
 *   - The target is a live knowledge document with `extra.sub_type: "reference"`; anything else is `VALIDATION_ERROR` (exit 4).
 *   - One live document per kind: another live (not deleted, not archived) holder is refused, naming it.
 *   - Changing an existing table of a non-draft document is decision-carrying for an agent run (the gate's own rule) and its
 *     decision must hold a premise whose source is a milestone-review document or an issue (a traced drill-down).
 *   - A write to an approved table demotes the document to `draft`: the new weights are not the approved version until a
 *     review approves them, so scored decisions cannot cite them before then.
 *   - Writes go through the one write route (`DocWritePort`); nothing is written on a refusal.
 * Side-effect class: IO (store reads; one `writeDoc`).
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, "Weight tables", D8; BR-1482.
 */

import { isDeepStrictEqual } from "node:util";
import {
  err,
  ok,
  weightTableSchema,
  WEIGHT_TABLE_KINDS,
  type DecisionRecord,
  type DocRecord,
  type LoreError,
  type Premise,
  type Result,
  type WeightTable,
} from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { findWriteSourceFor } from "../store/write-context-store.js";
import { DECISION_FIELD, writeCarriesDecision, type DecisionDraft, type DecisionGate, type WeightTableFacts, type WeightTableLookup } from "./decision-gate.js";
import type { DecisionGated } from "./decision-wiring.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";
import { resolveDoc } from "./resolve.js";

const WEIGHT_RULE = "BR-1482";

/** What `lore weights set` hands the service. */
export interface SetWeightTableInput {
  /** The reference document: id, slug or id prefix. */
  readonly doc: string;
  /** Untrusted kind text (checked against the closed kinds). */
  readonly kind: string;
  /** Untrusted dimension weights (checked: each > 0, sum 1 within 1e-9). */
  readonly dimensions: Readonly<Record<string, number>>;
  /** The writer's decision, when it supplied one. */
  readonly decision?: DecisionDraft;
}

function refuse(field: string, message: string, value?: unknown): LoreError {
  return { code: "VALIDATION_ERROR", field, message, ...(value !== undefined ? { value } : {}), rule: WEIGHT_RULE };
}

/** Whether `doc` is a live reference document. */
function isReference(doc: DocRecord): boolean {
  return doc.type === "knowledge" && doc.extra["sub_type"] === "reference";
}

function readTable(doc: DocRecord): WeightTable | undefined {
  const parsed = weightTableSchema.safeParse(doc.extra["weight_table"]);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The store-backed lookup the decision gate asks.
 *
 * @param store - the corpus store
 */
export function buildWeightTableLookup(store: StoreInterface): WeightTableLookup {
  return {
    async find(slug: string): Promise<Result<WeightTableFacts | null, LoreError>> {
      const found = await store.findBySlug(slug);
      if (!found.ok) return found;
      const doc = found.value;
      if (doc === null || doc.deleted_at != null) return ok(null);
      return ok({ status: doc.status, currentVersion: doc.version, table: isReference(doc) ? readTable(doc) : undefined });
    },
  };
}

export class WeightTableService implements DecisionGated {
  private decisionGate: DecisionGate | undefined;
  private readonly writer: DocWritePort;

  /**
   * @param store - the corpus store
   * @param writer - the one write route; a bare test construction gets a bare writer
   */
  constructor(private readonly store: StoreInterface, writer?: DocWritePort) {
    this.writer = writer ?? bareDocWriter(store);
  }

  /** Armed by `app.ts`; absent (a bare test construction) = a changed approved table owes no decision. */
  setDecisionGate(gate: DecisionGate): void {
    this.decisionGate = gate;
  }

  /**
   * Write a reference document's weight table.
   *
   * @param input - see {@link SetWeightTableInput}
   * @returns the document as written (unchanged when the table is identical), or `VALIDATION_ERROR` (exit 4) for: a target
   *   that is not a reference, an unknown kind, weights that are not > 0 or do not sum to 1, a kind another live document
   *   holds, or a missing/incomplete decision (or one without a milestone-review or issue premise) on an approved table.
   */
  async set(input: SetWeightTableInput): Promise<Result<DocRecord, LoreError>> {
    const resolved = await resolveDoc(this.store, input.doc);
    if (!resolved.ok) return resolved;
    const doc = resolved.value;
    if (!isReference(doc)) {
      return err(refuse("doc", `${doc.slug} is not a reference document (type ${doc.type}); a weight table lives on a knowledge document of sub_type reference.`, doc.slug));
    }
    if (!(WEIGHT_TABLE_KINDS as readonly string[]).includes(input.kind)) {
      return err(refuse("kind", `unknown weight-table kind "${input.kind}"; one of: ${WEIGHT_TABLE_KINDS.join(", ")}.`, input.kind));
    }
    const parsed = weightTableSchema.safeParse({ kind: input.kind, dimensions: input.dimensions });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return err(refuse("weight_table", `${issue ? issue.path.join(".") || "weight_table" : "weight_table"}: ${issue ? issue.message : "invalid weight table"}.`));
    }
    const table = parsed.data;

    const holder = await this.findOtherHolder(doc, table.kind);
    if (!holder.ok) return holder;
    if (holder.value !== undefined) {
      return err(refuse("kind", `the "${table.kind}" weight table is already held by ${holder.value.slug}; one live document per kind. Change that table, or archive it first.`, holder.value.slug));
    }

    const existing = readTable(doc);
    if (existing !== undefined && isDeepStrictEqual(existing, table)) return ok(doc);

    const decided = await this.resolveDecision(doc, input.decision, existing !== undefined);
    if (!decided.ok) return decided;

    const written = await this.writer.writeDoc({
      doc,
      patch: { extra: { ...doc.extra, weight_table: table }, ...(doc.status === "approved" ? { status: "draft" as const } : {}) },
      action: "update",
      changeSummary: `Weight table set — kind ${table.kind}, ${Object.keys(table.dimensions).length} dimensions`,
      auditAction: "update",
      auditDetails: { operation: "weights-set", kind: table.kind },
      lock: "none",
      ...(decided.value !== undefined ? { decision: decided.value } : {}),
    });
    if (!written.ok) return written;
    return ok(written.value.doc);
  }

  /** Another live reference document holding a table of `kind`. */
  private async findOtherHolder(doc: DocRecord, kind: string): Promise<Result<DocRecord | undefined, LoreError>> {
    const candidates = await this.store.findMany({ type: "knowledge", sub_type: "reference" });
    if (!candidates.ok) return candidates;
    const holder = candidates.value.find(
      (other) => other.id !== doc.id && other.status !== "archived" && other.deleted_at == null && readTable(other)?.kind === kind,
    );
    return ok(holder);
  }

  /** The decision of this write: required of an agent when changing a non-draft table, with a drill-down premise. */
  private async resolveDecision(
    doc: DocRecord,
    draft: DecisionDraft | undefined,
    changesExistingTable: boolean,
  ): Promise<Result<DecisionRecord | undefined, LoreError>> {
    const gate = this.decisionGate;
    if (gate === undefined) return ok(undefined);
    const required = writeCarriesDecision({ writerSource: findWriteSourceFor(this.store), targetIsDraft: doc.status === "draft", changesMoreThanStatus: true });
    const judged = await gate.judgeChecked({ required, draft, kind: "document revision" });
    if (!judged.ok || judged.value === undefined) return judged;
    // reason: ADR — weights change only by a decision citing a drill-down; checked only when a decision is owed (an agent
    // changing an existing table of a non-draft document), a human party owes none.
    if (required && changesExistingTable) {
      const cited = await this.hasDrillDownPremise(judged.value.premises);
      if (!cited.ok) return cited;
      if (!cited.value) {
        return err({
          code: "VALIDATION_ERROR",
          field: DECISION_FIELD,
          message: "changing an approved weight table needs a premise whose source is a milestone review (doc:<milestone-review slug>) or a traced issue (issue:#<n>). Nothing was written.",
          rule: WEIGHT_RULE,
        });
      }
    }
    return judged;
  }

  /** Whether some premise cites an issue or a milestone-review document. */
  private async hasDrillDownPremise(premises: readonly Premise[]): Promise<Result<boolean, LoreError>> {
    for (const premise of premises) {
      if (premise.source.kind === "issue") return ok(true);
      if (premise.source.kind !== "doc") continue;
      const found = await this.store.findBySlug(premise.source.slug);
      if (!found.ok) return found;
      const cited = found.value;
      if (cited !== null && cited.deleted_at == null && cited.type === "knowledge" && cited.extra["sub_type"] === "milestone-review") return ok(true);
    }
    return ok(false);
  }
}
