/**
 * Module: dispatch-service — `lore dispatch <code task>`: builds the whole subagent prompt of one approved code task from its stored
 * done contract and the shipped standing rules (AC-DCS2-6).
 *
 * Purpose: the dispatcher stops retyping the implementer's rules and contract into each prompt; one verb prints a prompt that holds
 * the locked task body, the contract (base branch, every oracle command, red requirement, landing route), the three commands the
 * implementer runs (`lore start`, `lore finish`, `lore land`) and the standing rules, byte for byte as shipped.
 * Public surface: {@link DispatchService}, {@link DispatchAssets}, {@link DISPATCH_REFUSALS},
 * {@link buildDispatchPrompt}.
 * Invariants:
 *   - the prompt is a pure function of the stored task, its stored contract and the shipped rules file ({@link buildDispatchPrompt});
 *     nothing is written and the contract is never recompiled (a task with no stored contract is refused, no fallback).
 *   - the standing rules are read through the injected {@link DispatchAssets} port (the binary's assets root), never inlined here.
 *   - a check or corpus task has no worktree and no dispatch: it is refused naming `lore finish`.
 * Side-effect class: IO (one read of the store, one read of the shipped asset).
 *
 * Source: spec-integrate-proves-and-lands-evidence-at-landing-the-merge (AC-DCS2-6), ledger D28, D29.
 */

import { doneContractSchema, err, ok, type DoneContract, type DocRecord, type LoreError, type Result } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { resolveDoc } from "./resolve.js";

/** The named refusals of `lore dispatch`, each stated once. */
export const DISPATCH_REFUSALS = ["contract-missing", "use-finish", "dispatch-assets-unreadable"] as const;

/** One of {@link DISPATCH_REFUSALS}. */
export type DispatchRefusal = (typeof DISPATCH_REFUSALS)[number];

/** Reads a file shipped at the binary's assets root (a port; `adapters/real-asset-source.ts` binds it). */
export interface DispatchAssets {
  read(name: string): Promise<Result<string, LoreError>>;
}

/** The services `lore dispatch` composes; `app.ts` binds the store, the command binds the assets root. */
export interface DispatchDeps {
  readonly store: StoreInterface;
  readonly assets: DispatchAssets;
}

function refusal(name: DispatchRefusal, message: string): LoreError {
  return { code: "VALIDATION_ERROR", field: name, message: `${name}: ${message}`, value: { refusal: name } };
}

/**
 * Renders the prompt of one code task. Pure: the same task, contract and rules always give the same text.
 *
 * @param task - the approved code task (its slug, title and locked body)
 * @param contract - the stored done contract of the task
 * @param rules - the shipped standing rules, verbatim
 * @returns the prompt, ending with the rules file's own bytes
 */
export function buildDispatchPrompt(task: Pick<DocRecord, "slug" | "title" | "content">, contract: DoneContract, rules: string): string {
  const oracles = [...contract.oracles, ...contract.added_oracles];
  const lines = [
    `# Task ${task.slug}: ${task.title}`,
    "",
    "## Task body (locked at approve)",
    "",
    task.content.trimEnd(),
    "",
    "## Contract",
    "",
    `- base branch: ${contract.base_branch}`,
    `- landing route: ${contract.landing_route}`,
    `- red_required: ${contract.red_required}${contract.red_required ? "" : ` (waived: ${contract.red_waiver_reason ?? "no reason recorded"})`}`,
    ...(contract.install !== undefined ? [`- install: ${contract.install}`] : []),
    "- oracles (`lore finish` runs every one of them):",
    ...oracles.map((oracle) => `  - ${oracle.id}${oracle.command !== undefined ? `: ${oracle.command}` : ""}`),
    "",
    "## Commands",
    "",
    `- \`lore start ${task.slug}\` from the shared checkout: creates your worktree and branch on ${contract.base_branch}, installs, claims and prints this contract.`,
    `- \`lore finish ${task.slug}\` from inside your worktree: runs every oracle above and records the evidence.`,
    `- \`lore land ${task.slug}\`: lands the finished task by the route above.`,
    "",
  ];
  return `${lines.join("\n")}\n${rules}`;
}

export class DispatchService {
  private readonly store: StoreInterface;
  private readonly assets: DispatchAssets;

  constructor(deps: DispatchDeps) {
    this.store = deps.store;
    this.assets = deps.assets;
  }

  /**
   * Builds the prompt of an approved code task from its stored contract.
   *
   * @param taskRef - task id or slug
   * @returns the prompt, or a refusal (exit 4): `contract-missing` (no stored contract), `use-finish` (a check or corpus task),
   *   `dispatch-assets-unreadable` (the shipped rules cannot be read)
   */
  async dispatch(taskRef: string): Promise<Result<string, LoreError>> {
    const resolved = await resolveDoc(this.store, taskRef);
    if (!resolved.ok) return resolved;
    const task = resolved.value;
    if (task.type !== "task") return err({ code: "VALIDATION_ERROR", field: "type", message: `Expected a task document; got type '${task.type}'`, value: task.type });
    const stored = doneContractSchema.safeParse(task.extra["done_contract"]);
    if (!stored.success) {
      return err(refusal("contract-missing", `${task.slug} holds no stored done contract; it is compiled at approve (\`lore approve ${task.slug}\`), never at dispatch.`));
    }
    const contract = stored.data;
    if (contract.kind !== "code") {
      return err(refusal("use-finish", `${task.slug} is a ${contract.kind} task: it has no worktree and needs no dispatch. Run \`lore finish ${task.slug}\` from the shared checkout.`));
    }
    const rules = await this.assets.read("dispatch-standing-rules.md");
    if (!rules.ok) return err(refusal("dispatch-assets-unreadable", "message" in rules.error ? rules.error.message : JSON.stringify(rules.error)));
    return ok(buildDispatchPrompt(task, contract, rules.value));
  }
}
