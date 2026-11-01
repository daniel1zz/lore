/**
 * The ledger of one review's judged units: looks stored verdicts up before a call and settles each fresh answer after it
 * (BR-1535, spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit, S3-S5).
 *
 * Purpose: the one place a milestone review touches the `judge_verdicts` store. A unit with a stored, parsable verdict is
 *   `reused`; every other unit is asked, and its answer is stored insert-if-absent (the first writer wins and every review
 *   records that one answer). A stored row that does not parse is replaced by compare-and-swap on its exact stored text.
 * Public surface: JudgeVerdictStorePort, UnitDescriptor, ReusedUnit, SettledUnit, UnitLedger, REUSE_WINDOW_DAYS,
 *   fileAnswerSchema, criterionAnswerSchema, rawFileAnswer, rawCriterionAnswer.
 * Invariants:
 *   - Reuse is on only with a store AND a judge identity that names its model; otherwise every unit is asked and `cause` says why.
 *   - A store read, write, swap or prune failure is `VALIDATION_ERROR` (exit 4) naming the `judge_verdicts` store, never a
 *     swallowed error and never a silent re-ask: the review stops and no review document is written.
 *   - Expired rows are those not READ for 30 days; the prune runs once, before the review's first write, and reads only that age.
 * Side-effect class: IO through the injected store port.
 */

import {
  err,
  judgedDimensionAnswerSchema,
  ok,
  type LoreError,
  type Result,
} from "@lore/core";
import { z } from "zod";
import type { JudgeVerdictRow } from "../store/store-shared.js";
import { sha256Hex, templateHashOf, type JudgeIdentity } from "./judge-unit-keys.js";

/** The four store operations the ledger needs; the real stores implement them (`StoreInterface`). */
export interface JudgeVerdictStorePort {
  readonly getJudgeVerdict: (key: string, readAt: string) => Promise<Result<JudgeVerdictRow | null, LoreError>>;
  readonly insertJudgeVerdictIfAbsent: (row: JudgeVerdictRow) => Promise<Result<JudgeVerdictRow, LoreError>>;
  readonly replaceJudgeVerdictIfEquals: (key: string, expectedRawAnswer: string, row: JudgeVerdictRow) => Promise<Result<JudgeVerdictRow, LoreError>>;
  readonly pruneJudgeVerdictsNotReadSince: (cutoff: string) => Promise<Result<number, LoreError>>;
}

/** Rows not read by any review for this many days are deleted when a review writes (spec S4). */
export const REUSE_WINDOW_DAYS = 30;

/** A file unit's stored answer: both gate dimensions of that file. */
export const fileAnswerSchema = z.object({ security: judgedDimensionAnswerSchema, concurrency_safety: judgedDimensionAnswerSchema });
export type FileAnswer = z.infer<typeof fileAnswerSchema>;

/** A criterion unit's stored answer. */
export const criterionAnswerSchema = z.object({ verdict: z.enum(["pass", "fail"]), reason: z.string().trim().min(1) });
export type CriterionAnswer = z.infer<typeof criterionAnswerSchema>;

/** The raw text stored for a file answer (compact JSON; key order fixed). */
export function rawFileAnswer(answer: FileAnswer): string {
  const norm = (j: FileAnswer["security"]) => ({ verdict: j.verdict, reason: j.reason, reference: j.reference, cites: j.cites ?? [] });
  return JSON.stringify({ security: norm(answer.security), concurrency_safety: norm(answer.concurrency_safety) });
}

/** The raw text stored for a criterion answer. */
export function rawCriterionAnswer(answer: CriterionAnswer): string {
  return JSON.stringify({ verdict: answer.verdict, reason: answer.reason });
}

/** One unit as the judgment layer describes it to the ledger. */
export interface UnitDescriptor {
  readonly kind: "file" | "criterion";
  /** The file's path or `<spec slug>:<ac id>`. */
  readonly id: string;
  readonly key: string;
}

/** What a lookup found for one unit. */
export type UnitLookup =
  | { readonly state: "reused"; readonly row: JudgeVerdictRow }
  | { readonly state: "corrupt"; readonly row: JudgeVerdictRow }
  | { readonly state: "absent" };

/** A unit's recorded outcome after settling. */
export interface SettledUnit {
  readonly source: "fresh" | "reused";
  readonly key: string;
  /** The review token the recorded answer was first produced in. */
  readonly first_review: string;
  /** The recorded raw answer (the stored one, which may be another review's). */
  readonly raw_answer: string;
  readonly answer_sha256: string;
}

/** A reused unit: its stored row, already checked to parse. */
export type ReusedUnit = SettledUnit & { readonly source: "reused" };

function storeFailure(operation: string, cause: LoreError): LoreError {
  const detail = "message" in cause ? cause.message : cause.code;
  return {
    code: "VALIDATION_ERROR",
    field: "judge_verdicts",
    message: `the judge verdict store (table judge_verdicts) could not be ${operation}: ${detail}. The review was not written; fix the store and run the review again.`,
    rule: "BR-1535",
  };
}

/** Whether `raw` is a parsable stored answer of `kind`. */
export function parsesAs(kind: "file" | "criterion", raw: string): boolean {
  try {
    const json: unknown = JSON.parse(raw);
    return (kind === "file" ? fileAnswerSchema : criterionAnswerSchema).safeParse(json).success;
  } catch {
    return false;
  }
}

/** See the module header. */
export class UnitLedger {
  /** Why reuse is off for this review; absent when it is on. */
  readonly disabledCause: string | undefined;
  private pruned = false;
  private readonly corrupt = new Map<string, JudgeVerdictRow>();

  /**
   * @param store - the verdict store; `undefined` = none wired (reuse off)
   * @param identity - the judge's identity; its `model` must be known for reuse
   * @param reviewToken - names this review in `first_review` of the rows it writes
   * @param now - the clock (read-time stamps and the 30-day cutoff)
   * @param templateText - the unit-instruction template source (hashed into each row)
   */
  constructor(
    private readonly store: JudgeVerdictStorePort | undefined,
    private readonly identity: JudgeIdentity | undefined,
    readonly reviewToken: string,
    private readonly now: () => Date,
    private readonly templateText: string,
  ) {
    if (store === undefined) this.disabledCause = "no judge verdict store is wired into this review";
    else if (identity === undefined) this.disabledCause = "the judge port names no provider identity, so a verdict cannot be keyed to its judge";
    else if (identity.model === undefined || identity.model.trim() === "") {
      this.disabledCause =
        `the model that answers is unknown for provider "${identity.provider}", so a stored verdict cannot be tied to it` +
        (identity.modelHint !== undefined ? `; ${identity.modelHint}` : "");
    } else this.disabledCause = undefined;
  }

  /** Whether stored verdicts are used by this review. */
  get enabled(): boolean {
    return this.disabledCause === undefined;
  }

  /**
   * Looks one unit up (and refreshes its `last_read_at`).
   *
   * @returns the lookup; `err` (VALIDATION_ERROR naming the store) when the read fails
   */
  async lookup(unit: UnitDescriptor): Promise<Result<UnitLookup, LoreError>> {
    if (!this.enabled || this.store === undefined) return ok({ state: "absent" });
    const found = await this.store.getJudgeVerdict(unit.key, this.now().toISOString());
    if (!found.ok) return err(storeFailure("read", found.error));
    if (found.value === null) return ok({ state: "absent" });
    if (parsesAs(unit.kind, found.value.raw_answer)) return ok({ state: "reused", row: found.value });
    this.corrupt.set(unit.key, found.value);
    return ok({ state: "corrupt", row: found.value });
  }

  /** The settled record of a unit taken from its stored row. */
  reused(row: JudgeVerdictRow): ReusedUnit {
    return { source: "reused", key: row.key, first_review: row.first_review, raw_answer: row.raw_answer, answer_sha256: sha256Hex(row.raw_answer) };
  }

  /**
   * Records a fresh answer: insert-if-absent, or compare-and-swap over a stored row that did not parse. With reuse off the
   * answer is recorded only on the review.
   *
   * @param unit - the unit
   * @param rawAnswer - the judge's answer for this unit, as `rawFileAnswer` / `rawCriterionAnswer` made it
   * @returns the recorded answer (the first writer's when another review stored this key first); `err` on a store failure
   */
  async settle(unit: UnitDescriptor, rawAnswer: string): Promise<Result<SettledUnit, LoreError>> {
    const own: SettledUnit = { source: "fresh", key: unit.key, first_review: this.reviewToken, raw_answer: rawAnswer, answer_sha256: sha256Hex(rawAnswer) };
    if (!this.enabled || this.store === undefined || this.identity === undefined) return ok(own);
    if (!this.pruned) {
      this.pruned = true;
      const cutoff = new Date(this.now().getTime() - REUSE_WINDOW_DAYS * 86_400_000).toISOString();
      const pruned = await this.store.pruneJudgeVerdictsNotReadSince(cutoff);
      if (!pruned.ok) return err(storeFailure("pruned", pruned.error));
    }
    const stamp = this.now().toISOString();
    const row: JudgeVerdictRow = {
      key: unit.key,
      unit_kind: unit.kind,
      unit_id: unit.id,
      raw_answer: rawAnswer,
      provider: this.identity.provider,
      model: this.identity.model as string,
      template_hash: templateHashOf(this.templateText),
      first_review: this.reviewToken,
      created_at: stamp,
      last_read_at: stamp,
    };
    const known = this.corrupt.get(unit.key);
    let stored: Result<JudgeVerdictRow, LoreError> =
      known !== undefined ? await this.store.replaceJudgeVerdictIfEquals(unit.key, known.raw_answer, row) : await this.store.insertJudgeVerdictIfAbsent(row);
    if (!stored.ok) return err(storeFailure("written", stored.error));
    if (!parsesAs(unit.kind, stored.value.raw_answer)) {
      // reason: a row another review stored that does not parse is replaced once by compare-and-swap on its exact text, so the first replacement wins.
      stored = await this.store.replaceJudgeVerdictIfEquals(unit.key, stored.value.raw_answer, row);
      if (!stored.ok) return err(storeFailure("replaced", stored.error));
    }
    this.corrupt.delete(unit.key);
    // reason: when another writer's unparsable row won the swap race too, this review records its own answer rather than an unreadable one.
    const winner = parsesAs(unit.kind, stored.value.raw_answer) ? stored.value : row;
    return ok({ source: "fresh", key: unit.key, first_review: winner.first_review, raw_answer: winner.raw_answer, answer_sha256: sha256Hex(winner.raw_answer) });
  }
}
