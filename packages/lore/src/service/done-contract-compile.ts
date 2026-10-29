/**
 * Module: done-contract-compile — the PURE compile of a task's done contract.
 *
 * Purpose: turn the facts `lore approve <task>` gathers (the task, the criteria of every governing spec, the three
 *   `workflow.done_contract.*` commands, the base branch and its tip, the falsifier files at that commit) into the stored
 *   {@link DoneContract}, or into one refusal that names EVERY cause that stops it (invariant I3: no partial contract).
 * Public surface: {@link compileDoneContract}, {@link liveScriptCriteriaOf}, {@link DoneContractCompileInput},
 *   {@link DoneContractConfigCommands}, {@link UncompilableCause}, {@link DONE_CONTRACT_UNCOMPILABLE}, {@link contractAlreadyStored}, {@link RED_WAIVER_NOT_CODE}, {@link redWaiverNotCode}.
 * Invariants:
 *   - one copy of each done predicate (I1): the anchored test files and the live script-mode ACs come from `definitionOfDone`
 *     (`task-workflow-service.ts`) by import; this module re-derives neither.
 *   - every cause is collected before the result returns; the refusal never stops at the first one (AC-DCS1-2).
 *   - a non-resolving anchor is never a cause (anchors are declared before the work): the only existence check is the falsifier
 *     literal, exempt when the AC is marked `--falsifier-new-symbol`.
 * Side-effect class: pure (no store, no git, no fs; the service gathers every input).
 *
 * Source: spec-done-contract-compiled-at-approve-task-kinds-write-sets (AC-DCS1-1, AC-DCS1-2, AC-DCS1-5), ledger D28 to D43.
 */

import { err, extractFileAnchors, isAcSuperseded, ok, type AcceptanceCriterion, type DocRecord, type DoneContract, type DoneContractOracle, type LoreError, type Result, type TaskKind } from "@lore/core";
import { definitionOfDone } from "./task-workflow-service.js";

/** The stable name every uncompilable-contract refusal prints first. */
export const DONE_CONTRACT_UNCOMPILABLE = "done-contract-uncompilable";

/** The three commands the contract runs, as `.lore/config.yaml` `workflow.done_contract` holds them (each may be absent). */
export interface DoneContractConfigCommands {
  readonly install?: string | undefined;
  readonly typecheck?: string | undefined;
  /** Template with the placeholder `{file}`. */
  readonly test_file?: string | undefined;
}

/** The base branch a contract compiles against. */
export interface DoneContractBase {
  readonly branch: string;
  /** `true` when the plan declares this integration branch (so its absence names the command that creates it). */
  readonly declaredByPlan: boolean;
  /** Tip commit of the branch; `undefined` when the branch does not exist. */
  readonly tip: string | undefined;
  /** The commit the falsifier files were read at (the tip, or main's tip when the base branch is absent); `undefined` when none. */
  readonly readCommit: string | undefined;
}

/** Every fact the compile needs, gathered by `DoneContractService`. */
export interface DoneContractCompileInput {
  readonly task: DocRecord;
  readonly kind: TaskKind;
  /** The reason of `--red-waiver`, already trimmed and non-blank; `undefined` when the red run is not waived. */
  readonly redWaiverReason: string | undefined;
  /** Every criterion of every spec the plan is parented to or implements (an `--adhoc` task: its recorded governing spec). */
  readonly criteria: readonly AcceptanceCriterion[];
  readonly config: DoneContractConfigCommands;
  readonly base: DoneContractBase;
  /** Content of each falsifier path at `base.readCommit`; a missing key or `undefined` means the file is absent there. */
  readonly falsifierFiles: ReadonlyMap<string, string | undefined>;
}

/** The causes a contract can fail to compile for (AC-DCS1-2). */
export type UncompilableCauseCode =
  | "no-typecheck"
  | "no-install"
  | "no-test-command"
  | "base-branch-absent"
  | "no-oracle"
  | "kind-anchor"
  | "ac-unresolved"
  | "falsifier-literal-absent";

/** One cause: its stable name and a message that says what to do. */
export interface UncompilableCause {
  readonly code: UncompilableCauseCode;
  readonly message: string;
}

/**
 * The criteria of `task`'s ac_scope that are live (not superseded) and script-mode, in scope order, with each id resolved
 * to its criterion. The one place the scope is read for oracles AND for the falsifier check, via `definitionOfDone`.
 *
 * @param task - the task
 * @param criteria - every criterion of every governing spec
 * @returns the live script-mode criteria of the scope
 */
export function liveScriptCriteriaOf(task: DocRecord, criteria: readonly AcceptanceCriterion[]): AcceptanceCriterion[] {
  const resolved: AcceptanceCriterion[] = [];
  for (const id of definitionOfDone(task, [...criteria]).verify_acs) {
    const criterion = criteria.find((candidate) => candidate.id === id);
    if (criterion !== undefined && !isAcSuperseded(criterion)) resolved.push(criterion);
  }
  return resolved;
}

/** Stable refusal name for `--red-waiver` on anything but a code task. */
export const RED_WAIVER_NOT_CODE = "red-waiver-not-code";

/**
 * The refusal for `--red-waiver` on a task that is not a code task (a check or corpus task has no red run to waive).
 *
 * @param subject - the slug of the document the waiver was given for
 * @param kind - what it is (`check`, `corpus`, or the document type)
 */
export function redWaiverNotCode(subject: string, kind: string): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "red-waiver",
    message: `${RED_WAIVER_NOT_CODE}: --red-waiver waives the red run of a code task; ${subject} is ${kind}, which never needs one.`,
    value: { refusal: RED_WAIVER_NOT_CODE },
  };
}

function buildUncompilable(slug: string, causes: readonly UncompilableCause[]): LoreError {
  const lines = causes.map((cause) => `  - ${cause.code}: ${cause.message}`);
  return {
    code: "VALIDATION_ERROR",
    field: "done_contract",
    message:
      `${DONE_CONTRACT_UNCOMPILABLE}: the done contract of ${slug} cannot be compiled (${causes.length} cause${causes.length === 1 ? "" : "s"}); ` +
      `nothing was written, fix every cause and approve again:\n${lines.join("\n")}`,
    value: { refusal: DONE_CONTRACT_UNCOMPILABLE, causes: causes.map((cause) => cause.code) },
  };
}

/**
 * The refusal for a task that already holds a contract: the contract is compiled once, at approve, and never recompiled.
 *
 * @param task - the task that holds `extra.done_contract`
 */
export function contractAlreadyStored(task: DocRecord): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: "done_contract",
    message: `done-contract-already-stored: ${task.slug} already holds a done contract; it is compiled once, at approve, and only the verbs named in its spec change it afterwards.`,
    value: { refusal: "done-contract-already-stored" },
  };
}

/**
 * Compiles the done contract of one task.
 *
 * @param input - the gathered facts, see {@link DoneContractCompileInput}
 * @returns the contract, or a `VALIDATION_ERROR` (refusal {@link DONE_CONTRACT_UNCOMPILABLE}) naming every cause
 * @example
 * compileDoneContract({ task, kind: "code", redWaiverReason: undefined, criteria, config, base, falsifierFiles });
 */
export function compileDoneContract(input: DoneContractCompileInput): Result<DoneContract, LoreError> {
  const { task, kind, redWaiverReason, criteria, config, base, falsifierFiles } = input;
  const causes: UncompilableCause[] = [];
  const uncompilable = (found: readonly UncompilableCause[]): LoreError => buildUncompilable(task.slug, found);

  if (kind === "code") {
    if (config.typecheck === undefined) causes.push({ code: "no-typecheck", message: "set workflow.done_contract.typecheck in .lore/config.yaml (for example `bun run typecheck`)." });
    if (config.install === undefined) causes.push({ code: "no-install", message: "set workflow.done_contract.install in .lore/config.yaml (for example `bun install --frozen-lockfile`)." });
    if (config.test_file === undefined) causes.push({ code: "no-test-command", message: "set workflow.done_contract.test_file in .lore/config.yaml, a template containing {file} (for example `bun run test:file {file}`)." });
  }

  if (base.tip === undefined) {
    causes.push({
      code: "base-branch-absent",
      message: base.declaredByPlan
        ? `the plan declares integration branch ${base.branch} and it does not exist; create it with \`git branch ${base.branch} main\`, or declare another with \`lore plan integration-branch\`.`
        : `the base branch ${base.branch} does not exist in this repository.`,
    });
  }

  if (kind !== "code" && extractFileAnchors(task).length > 0) {
    causes.push({ code: "kind-anchor", message: `a ${kind} task changes no files, so it cannot anchor one; remove its file anchors (\`lore anchor rm\`) or make it a code task (\`lore set ${task.slug} --kind code\`).` });
  }

  // ac_scope ids that no governing spec declares.
  const declaredIds = new Set(criteria.map((criterion) => criterion.id));
  const scope = Array.isArray(task.extra["ac_scope"]) ? (task.extra["ac_scope"] as unknown[]).filter((id): id is string => typeof id === "string") : [];
  for (const id of scope) {
    if (!declaredIds.has(id)) {
      causes.push({ code: "ac-unresolved", message: `ac_scope names ${id}, which no spec this task's plan is parented to or implements declares; remove it (\`lore scope rm\`) or declare the criterion.` });
    }
  }

  const liveScript = liveScriptCriteriaOf(task, criteria);
  if (kind === "check" && liveScript.length === 0) {
    causes.push({ code: "no-oracle", message: "a check task proves something with at least one live script-mode criterion in its ac_scope, and its ac_scope gives none." });
  }

  // The falsifier literals of the script oracles: present at the compile commit, unless the AC says the task creates them.
  const newSymbols: string[] = [];
  for (const criterion of liveScript) {
    if (criterion.verify.mode !== "script" || criterion.verify.falsifier === undefined) continue;
    const { path, find, new_symbol: marked } = criterion.verify.falsifier;
    const content = falsifierFiles.get(path);
    if (content !== undefined && content.includes(find)) continue;
    if (marked === true) {
      newSymbols.push(criterion.id);
      continue;
    }
    const at = base.readCommit === undefined ? "the base branch" : `commit ${base.readCommit.slice(0, 12)}`;
    causes.push({
      code: "falsifier-literal-absent",
      message: `${criterion.id} declares a falsifier whose find-literal ${JSON.stringify(find)} is absent from ${path} at ${at}; correct the falsifier (\`lore ac set\`), or mark it \`--falsifier-new-symbol\` when this task creates the literal.`,
    });
  }

  if (causes.length > 0) return err(uncompilable(causes));
  // reason: only reachable with a tip (a missing one is a cause above); the guard keeps the types honest without a cast.
  if (base.tip === undefined) return err(uncompilable(causes));

  const oracles: DoneContractOracle[] = liveScript.map((criterion) => ({
    id: `ac:${criterion.id}`,
    command: criterion.verify.mode === "script" ? criterion.verify.command : "",
  }));
  if (kind === "code") {
    const template = config.test_file ?? "";
    for (const file of definitionOfDone(task, [...criteria]).unfiltered_pass_files) {
      oracles.push({ id: `test:${file}`, command: template.split("{file}").join(file) });
    }
    oracles.push({ id: "typecheck", command: config.typecheck ?? "" });
  }
  if (kind === "corpus") oracles.push({ id: "corpus:files-unchanged" });

  return ok({
    compiled_at_commit: base.tip,
    kind,
    base_branch: base.branch,
    oracles,
    ...(config.install !== undefined ? { install: config.install } : {}),
    red_required: kind === "code" && redWaiverReason === undefined,
    ...(redWaiverReason !== undefined ? { red_waiver_reason: redWaiverReason } : {}),
    landing_route: kind !== "code" ? "none" : base.declaredByPlan ? "integration-branch" : "main",
    new_symbols: newSymbols,
    added_oracles: [],
  });
}
