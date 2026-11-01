/**
 * Module: done-contract — the task kinds and the shape of the done contract stored at `extra.done_contract`.
 *
 * Purpose: one source for the three task kinds (`code`, `check`, `corpus`), the zod schema of the contract that `lore approve`
 *   compiles, and the message every creation surface prints when a task has no (or an unknown) kind.
 * Public surface: {@link TASK_KINDS}, {@link TaskKind}, {@link isTaskKind}, {@link TASK_KIND_LIST_TEXT},
 *   {@link formatTaskKindRequiredMessage}, {@link doneContractSchema}, {@link DoneContract}, {@link DoneContractOracle},
 *   {@link DONE_CONTRACT_LANDING_ROUTES}.
 * Invariants: the kind list has exactly these three members; the contract is written only by the compile at approve (and, later,
 *   the writers named in spec-done-contract-compiled-at-approve-task-kinds-write-sets); `lore set` never writes it.
 * Side-effect class: pure.
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-4, AC-DCS1-9), ledger D28.
 */

import { z } from "zod";

/** The kinds a task can have: `code` changes files, `check` proves something at main's head, `corpus` changes the corpus only. */
export const TASK_KINDS = ["code", "check", "corpus"] as const;

/** One of {@link TASK_KINDS}. */
export type TaskKind = (typeof TASK_KINDS)[number];

/** The three kinds as one readable list, for refusal messages: `code, check and corpus`. */
export const TASK_KIND_LIST_TEXT = "code, check and corpus";

/**
 * Whether `value` is one of the three task kinds.
 *
 * @param value - any raw input (a flag value, a request field)
 * @example
 * isTaskKind("check"); // => true
 * isTaskKind("Code"); // => false
 */
export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === "string" && (TASK_KINDS as readonly string[]).includes(value);
}

/**
 * The message a creation surface prints when the task kind is missing or not one of the three.
 *
 * @param received - the raw value that was given; `undefined` or an empty string means "not given"
 * @param flagName - how the surface names the input (`--kind` on the command line, `kind` on HTTP)
 * @returns one message naming all three kinds
 */
export function formatTaskKindRequiredMessage(received: unknown, flagName: string): string {
  const given = typeof received === "string" && received !== "";
  return given
    ? `${flagName} '${received}' is not a task kind — a task needs exactly one of: ${TASK_KIND_LIST_TEXT}.`
    : `${flagName} is required for a task — pick one of: ${TASK_KIND_LIST_TEXT} (code changes files, check proves something at main's head, corpus changes the corpus only).`;
}

/** Where a landed task's work goes: the plan's integration branch, main, or nowhere (check and corpus tasks change no files). */
export const DONE_CONTRACT_LANDING_ROUTES = ["main", "integration-branch", "none"] as const;

/** One oracle of a contract: its id (`ac:<AC-id>`, `test:<path>`, `typecheck`, `corpus:files-unchanged`) and the command that runs it. */
export const doneContractOracleSchema = z
  .object({
    id: z.string().min(1),
    // reason: `corpus:files-unchanged` is proved by `lore finish` itself and has no command of its own.
    command: z.string().min(1).optional(),
  })
  .strict();

/** One removal record: a test file the landing deleted leaves the oracle set with a recorded reason (AC-DCS1-30). */
export const doneContractRemovedOracleSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    reason: z.string().min(1),
    landed_commit: z.string().min(1),
  })
  .strict();

/** The done contract stored at `extra.done_contract` (fields: spec-done-contract-compiled-at-approve-task-kinds-write-sets, Design). */
export const doneContractSchema = z
  .object({
    compiled_at_commit: z.string().min(1),
    kind: z.enum(TASK_KINDS),
    base_branch: z.string().min(1),
    oracles: z.array(doneContractOracleSchema),
    install: z.string().min(1).optional(),
    red_required: z.boolean(),
    red_waiver_reason: z.string().min(1).optional(),
    landing_route: z.enum(DONE_CONTRACT_LANDING_ROUTES),
    new_symbols: z.array(z.string()),
    added_oracles: z.array(doneContractOracleSchema),
    removed_oracles: z.array(doneContractRemovedOracleSchema).optional(),
  })
  .strict();

/** The contract, derived from {@link doneContractSchema}. */
export type DoneContract = z.infer<typeof doneContractSchema>;

/** One oracle of a contract, derived from {@link doneContractOracleSchema}. */
export type DoneContractOracle = z.infer<typeof doneContractOracleSchema>;
