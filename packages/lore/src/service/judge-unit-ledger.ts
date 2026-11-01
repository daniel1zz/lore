/**
 * The ledger of one review's judged units: looks stored verdicts up before a call and settles each fresh answer after it
 * (BR-1535, spec-a-re-review-reuses-the-judge-s-verdict-for-every-unit, S3-S5).
 *
 * Purpose: the one place a milestone review touches the `judge_verdicts` store. A unit with a stored, parsable verdict is
 *   `reused`; every other unit is asked, and its answer is stored insert-if-absent (the first writer wins and every review
 *   records that one answer). A stored row that does not parse is replaced by compare-and-swap on its exact stored text.
 * Public surface: JudgeVerdictStorePort, UnitDescriptor, UnitLookup, SettledUnit, UnitLedger, REUSE_WINDOW_DAYS,
 *   fileAnswerSchema, criterionAnswerSchema, rawFileAnswer, rawCriterionAnswer, parsesAs.
 * Invariants:
 *   - Lookups key by the CONFIGURED model (`ai.assess.model`); stores key by the model the reply NAMED. They agree only when the
 *     configured value is a full model id, so a configured alias finds nothing and the review records why (`note`), with no extra call.
 *   - Reuse is on only with a store, a configured model and a provider whose replies name their model; otherwise lookup AND storing are
 *     off from the start and `disabledCause` says what to configure. A reply that names no model is never stored.
 *   - `--rejudge` ignores stored verdicts for the review: every unit is asked, the fresh answer is stored insert-if-absent (replacing
 *     nothing) and THIS review records its own fresh answer, not an older stored one.
 *   - A store read, write, swap or prune failure is `VALIDATION_ERROR` (exit 4) naming the `judge_verdicts` store, never a swallowed
 *     error and never a silent re-ask: the review stops and no review document is written.
 *   - Expired rows are those not READ for 30 days; the prune runs once, before the review's first write, and reads only that age.
 * Side-effect class: IO through the injected store port.
 */

import { err, judgedDimensionAnswerSchema, ok, type LoreError, type Result } from "@lore/core";
import { z } from "zod";
import type { JudgeVerdictRow } from "../store/store-shared.js";
import { sha256Hex, templateHashOf, unitKeyOf, type JudgeIdentity } from "./judge-unit-keys.js";

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
  /** The unit's canonical input (`fileUnitInput` / `criterionUnitInput`). */
  readonly canonical: string;
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
  private noteText: string | undefined;
  private answering: string | undefined;

  /**
   * @param store - the verdict store; `undefined` = none wired (reuse off)
   * @param identity - the judge's identity; its configured `model` must be set and its provider must report the answering model
   * @param reviewToken - names this review in `first_review` of the rows it writes
   * @param now - the clock (read-time stamps and the 30-day cutoff)
   * @param templateSource - the unit-instruction template source with the dimension guide (hashed into each key and row)
   * @param rejudge - ignore stored verdicts for this review (`lore assess --rejudge`)
   */
  constructor(
    private readonly store: JudgeVerdictStorePort | undefined,
    private readonly identity: JudgeIdentity | undefined,
    readonly reviewToken: string,
    private readonly now: () => Date,
    private readonly templateSource: string,
    private readonly rejudge = false,
  ) {
    if (store === undefined) this.disabledCause = "no judge verdict store is wired into this review";
    else if (identity === undefined) this.disabledCause = "the judge port names no provider identity, so a verdict cannot be keyed to its judge";
    else if (!identity.reportsAnsweringModel) {
      this.disabledCause = `provider "${identity.provider}" does not report the model that answered, so a stored verdict cannot be tied to it${identity.modelHint !== undefined ? `; ${identity.modelHint}` : ""}`;
    } else if (identity.model === undefined || identity.model.trim() === "") {
      this.disabledCause = `no model is configured for provider "${identity.provider}", so lookups have no model to match${identity.modelHint !== undefined ? `; ${identity.modelHint}` : ""}`;
    } else this.disabledCause = undefined;
  }

  /** Whether stored verdicts are looked up and written by this review. */
  get enabled(): boolean {
    return this.disabledCause === undefined;
  }

  /** Why nothing could be reused although reuse is on: an alias, `--rejudge`, a reply that named no model. Absent when there is nothing to say. */
  get note(): string | undefined {
    if (this.rejudge && this.enabled) return this.noteText === undefined ? "--rejudge: stored verdicts were ignored" : `--rejudge: stored verdicts were ignored; ${this.noteText}`;
    return this.noteText;
  }

  /** The model the replies named (the one stored verdicts are keyed by); absent before a call or when none was named. */
  get answeringModel(): string | undefined {
    return this.answering;
  }

  private keyUnder(unit: UnitDescriptor, model: string): Result<string, LoreError> {
    return unitKeyOf(unit.kind, unit.canonical, this.templateSource, this.identity as JudgeIdentity, model);
  }

  /** The key a unit's recorded answer carries when nothing is stored for it (reuse off, or no model named). */
  private unkeyed(unit: UnitDescriptor): string {
    return `unkeyed:${sha256Hex(JSON.stringify([unit.kind, unit.id, unit.canonical]))}`;
  }

  /**
   * Looks one unit up under the CONFIGURED model (and refreshes its `last_read_at`). With reuse off, or under `--rejudge`, nothing
   * is looked up.
   *
   * @returns the lookup; `err` (VALIDATION_ERROR naming the store) when the read fails
   */
  async lookup(unit: UnitDescriptor): Promise<Result<UnitLookup, LoreError>> {
    if (!this.enabled || this.rejudge || this.store === undefined) return ok({ state: "absent" });
    const key = this.keyUnder(unit, (this.identity as JudgeIdentity).model as string);
    if (!key.ok) return key;
    const found = await this.store.getJudgeVerdict(key.value, this.now().toISOString());
    if (!found.ok) return err(storeFailure("read", found.error));
    if (found.value === null) return ok({ state: "absent" });
    if (parsesAs(unit.kind, found.value.raw_answer)) return ok({ state: "reused", row: found.value });
    this.corrupt.set(key.value, found.value);
    return ok({ state: "corrupt", row: found.value });
  }

  /** The settled record of a unit taken from its stored row. */
  reused(row: JudgeVerdictRow): SettledUnit & { readonly source: "reused" } {
    return { source: "reused", key: row.key, first_review: row.first_review, raw_answer: row.raw_answer, answer_sha256: sha256Hex(row.raw_answer) };
  }

  /**
   * Records a fresh answer under the model the REPLY named: insert-if-absent, or compare-and-swap over a stored row that did not
   * parse. With reuse off, or when the reply named no model, the answer is recorded only on the review.
   *
   * @param unit - the unit
   * @param rawAnswer - the judge's answer for this unit, as `rawFileAnswer` / `rawCriterionAnswer` made it
   * @param answeringModel - the model the reply named (`undefined` = none)
   * @returns the recorded answer (the first writer's when another review stored this key first); `err` on a store failure
   */
  async settle(unit: UnitDescriptor, rawAnswer: string, answeringModel: string | undefined): Promise<Result<SettledUnit, LoreError>> {
    const ownAt = (key: string): SettledUnit => ({ source: "fresh", key, first_review: this.reviewToken, raw_answer: rawAnswer, answer_sha256: sha256Hex(rawAnswer) });
    if (!this.enabled || this.store === undefined || this.identity === undefined) return ok(ownAt(this.unkeyed(unit)));
    if (answeringModel === undefined || answeringModel.trim() === "") {
      this.noteText ??= `the reply named no answering model, so its verdicts were not stored`;
      return ok(ownAt(this.unkeyed(unit)));
    }
    this.answering = answeringModel;
    if (answeringModel !== this.identity.model) {
      this.noteText ??=
        `the configured model "${String(this.identity.model)}" is not the model that answered ("${answeringModel}"); verdicts are stored under the answering model, ` +
        `so nothing is reused until ai.assess.model is set to "${answeringModel}"`;
    }
    const storeKey = this.keyUnder(unit, answeringModel);
    if (!storeKey.ok) return storeKey;
    if (!this.pruned) {
      this.pruned = true;
      const cutoff = new Date(this.now().getTime() - REUSE_WINDOW_DAYS * 86_400_000).toISOString();
      const pruned = await this.store.pruneJudgeVerdictsNotReadSince(cutoff);
      if (!pruned.ok) return err(storeFailure("pruned", pruned.error));
    }
    const stamp = this.now().toISOString();
    const row: JudgeVerdictRow = {
      key: storeKey.value,
      unit_kind: unit.kind,
      unit_id: unit.id,
      raw_answer: rawAnswer,
      provider: this.identity.provider,
      model: answeringModel,
      template_hash: templateHashOf(this.templateSource),
      first_review: this.reviewToken,
      created_at: stamp,
      last_read_at: stamp,
    };
    const known = this.corrupt.get(storeKey.value);
    let stored: Result<JudgeVerdictRow, LoreError> =
      known !== undefined ? await this.store.replaceJudgeVerdictIfEquals(storeKey.value, known.raw_answer, row) : await this.store.insertJudgeVerdictIfAbsent(row);
    if (!stored.ok) return err(storeFailure("written", stored.error));
    if (!parsesAs(unit.kind, stored.value.raw_answer)) {
      // reason: a row another review stored that does not parse is replaced once by compare-and-swap on its exact text, so the first replacement wins.
      stored = await this.store.replaceJudgeVerdictIfEquals(storeKey.value, stored.value.raw_answer, row);
      if (!stored.ok) return err(storeFailure("replaced", stored.error));
    }
    this.corrupt.delete(storeKey.value);
    // reason: --rejudge exists to replace a verdict suspected wrong IN THIS REVIEW; the stored row stays (insert-if-absent), this review records its own answer.
    if (this.rejudge) return ok(ownAt(storeKey.value));
    // reason: when another writer's unparsable row won the swap race too, this review records its own answer rather than an unreadable one.
    const winner = parsesAs(unit.kind, stored.value.raw_answer) ? stored.value : row;
    return ok({ source: "fresh", key: storeKey.value, first_review: winner.first_review, raw_answer: winner.raw_answer, answer_sha256: sha256Hex(winner.raw_answer) });
  }
}
