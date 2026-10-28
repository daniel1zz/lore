/**
 * Decision re-check: the deterministic half of the milestone check of recorded decisions.
 *
 * Purpose: select the decisions that belong to a plan, re-verify each file / command source they rest on against git
 *   and a read-only re-run, and report findings; a wrong-when-written finding fails `snapshot_accuracy`.
 * Exemption decisions (#481, BR-1492) are selected beside version rows: the exemptions of the plan's spec, and those a
 *   plan task's claim run granted within its window; address `<spec slug>#exempt:<AC id>@<granted_at>`.
 * Public surface: selectPlanDecisions, exemptionDecisionAddress, recheckDecision, recheckPlanDecisions, isRerunnableCommand,
 *   applyDecisionFindings, createWorktreeCommandRunner, CommandRunnerPort, DecisionRecheckDeps; the judged half:
 *   buildJudgedDecisionInputs, judgedFindingsOf, rerunCitingCriteria, CriterionRerunPort.
 * Invariants:
 *   - Finding kinds: `wrong-when-written` (the source never said what the premise claims), `stale-since` (it said so
 *     at its commit, no longer on main), `unverifiable` (the commit or the answer cannot be had), `not-rerunnable`
 *     (a command outside the read-only allowlist; it is NEVER run).
 *   - File lines are compared by content against the quote, never by line number alone: an unrelated edit that only
 *     shifts the quoted lines is not a finding.
 *   - Only a wrong-when-written finding changes a verdict; the other kinds are listed on the review.
 *   - Weight tables are never selection targets (spec D4).
 *   - Gate / score evidence that carries a stored `evidence_source` quote is compared with that quote exactly like a
 *     premise (so a wrong-when-written evidence is detectable); only evidence with no stored quote derives the quote
 *     from the pinned commit.
 *   - The judged half (spec D6) adds findings of kinds `premise-not-supported`, `meaning-changed`, `better-option`
 *     (the judge's objections) and `criterion-fails` (a criterion citing a reworded rule fails when re-run); like
 *     the other non-wrong-when-written kinds they are listed and change no verdict.
 * Command allowlist (CLOSED, issue #482): an agent-written `cmd:` premise is re-run at the milestone, so a flag that
 *   runs a program or writes a file is code execution at review time. Only these are re-run; argv is parsed without a
 *   shell (shell metacharacters rejected), every flag must be listed, anything else is `not-rerunnable`:
 *   - grep: -n -i -l -c -w -F -E -r -R -h -H -o -q, -e <p>, --include=<glob>
 *   - rg: -n -i -l -c -w -F --fixed-strings --no-heading --line-number, -e <p>, -g/--glob <g>, -t/--type <t>
 *     (no --pre, --pre-glob, -z, --search-zip)
 *   - git show|log|diff: --stat --name-only --name-status --oneline --no-color --no-ext-diff --no-textconv, -n/--max-count <k>
 *   - git grep: -n -i -w -F -E -l -c --no-color, -e <p> (no -O, --open-files-in-pager, --no-index)
 *   - git: NO option before the subcommand (-c, -C, --git-dir, --exec-path, --work-tree)
 *   - lore get|list|search|tree|log|rule show|rule find|ac list: --json, --limit/--offset/--type <v>
 * Side-effect class: reads the store and git; the command runner (injected) is the only process spawner.
 *
 * Source: spec-a-decision-carrying-write-records-its-decision-on-its, Scope "Milestone re-check", D4, D5; BR-1480.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  err,
  ok,
  parseDecisionSource,
  specRuleChangesSchema,
  type DecisionFinding,
  type DecisionGate,
  type DecisionRecord,
  type DecisionScore,
  type DocId,
  type DocRecord,
  type LlmMilestoneOutput,
  type LoreError,
  type PlanBundle,
  type Result,
  type VersionRecord,
} from "@lore/core";
import { judgedDecisionsAnswerSchema, type JudgedDecisionInput } from "../ai/milestone-review-template.js";
import type { StoreInterface } from "../store/store-interface.js";
import type { GitPort } from "./rule-state-service.js";
import { resolveVerifyEnv } from "./verify-spawn.js";

/** Re-runs one allowlisted command; an `err` means the run itself could not happen (not that the output differs). */
export interface CommandRunnerPort {
  readonly run: (command: string) => Promise<Result<{ readonly exitCode: number; readonly output: string }, LoreError>>;
}

/** What {@link recheckPlanDecisions} needs: a narrow store, git, and the command runner. */
export interface DecisionRecheckDeps {
  readonly store: Pick<
    StoreInterface,
    "listDecisionVersions" | "listDecisionExemptions" | "queryAudit" | "findBySlug" | "find" | "findLinks" | "findVersions" | "listRuleRegistry" | "listAcCites"
  >;
  readonly git: GitPort;
  readonly runner: CommandRunnerPort;
}

/** What selection and the judged inputs need: the store only (git and the runner belong to the deterministic re-check). */
export type DecisionStoreDeps = Pick<DecisionRecheckDeps, "store">;

/** A decision version row with the address the findings name. */
export interface SelectedDecision {
  readonly address: string;
  readonly record: DecisionRecord;
  /** The document the decision's write changed, and the version it created (absent for an exemption decision: no version row). */
  readonly docId: DocId;
  readonly version?: number;
}

/**
 * The address an exemption decision's findings name: `<spec slug>#exempt:<AC id>@<granted_at>` (granted_at is the ISO grant
 * instant, so a renewed exemption of the same criterion is a different address). It is not a `<slug>@<version>` address, so
 * `lore decision trace` cannot name it; `lore decision rates` and the milestone re-check use it as the decision's identity.
 */
export function exemptionDecisionAddress(specSlug: string, acId: string, grantedAt: string): string {
  return `${specSlug}#exempt:${acId}@${grantedAt}`;
}

const SHELL_META = /[;&|<>`$(){}\\\n\r]/;
/** A permitted flag set: `bare` flags take no value, `valued` flags consume one (`--flag=v`, `--flag v`, `-e v`). */
interface FlagSpec {
  readonly bare: ReadonlySet<string>;
  readonly valued: ReadonlySet<string>;
}

const flagSpec = (bare: readonly string[], valued: readonly string[] = []): FlagSpec => ({ bare: new Set(bare), valued: new Set(valued) });

// reason: closed per-command flag lists (issue #482); a flag not listed here is never run, because many read-only
// commands have flags that run a program or write a file (rg --pre, git grep -O, git diff --output).
const GREP_FLAGS = flagSpec(["-n", "-i", "-l", "-c", "-w", "-F", "-E", "-r", "-R", "-h", "-H", "-o", "-q"], ["-e", "--include"]);
const RG_FLAGS = flagSpec(["-n", "-i", "-l", "-c", "-w", "-F", "--fixed-strings", "--no-heading", "--line-number"], ["-e", "-g", "-t", "--glob", "--type"]);
const GIT_LOG_FLAGS = flagSpec(["--stat", "--name-only", "--name-status", "--oneline", "--no-color", "--no-ext-diff", "--no-textconv"], ["-n", "--max-count"]);
const GIT_GREP_FLAGS = flagSpec(["-n", "-i", "-w", "-F", "-E", "-l", "-c", "--no-color"], ["-e"]);
const LORE_FLAGS = flagSpec(["--json"], ["--limit", "--offset", "--type"]);
const GIT_FLAGS: Readonly<Record<string, FlagSpec>> = { show: GIT_LOG_FLAGS, log: GIT_LOG_FLAGS, diff: GIT_LOG_FLAGS, grep: GIT_GREP_FLAGS };
const LORE_READ_VERBS = new Set(["get", "list", "search", "tree", "log"]);

/** Whether every word of `args` is a positional or a flag of `spec` (a valued flag consumes the next word). */
function argsWithinSpec(args: readonly string[], spec: FlagSpec): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i] as string;
    if (!word.startsWith("-") || word === "-") continue;
    const eq = word.indexOf("=");
    const name = eq === -1 ? word : word.slice(0, eq);
    if (spec.valued.has(name)) {
      if (eq === -1) {
        i += 1;
        if (i >= args.length) return false;
      }
      continue;
    }
    if (eq === -1 && spec.bare.has(name)) continue;
    // A cluster of bare short flags (`-rn`): every letter must itself be a permitted bare flag.
    if (eq === -1 && /^-[A-Za-z]{2,}$/.test(word) && [...word.slice(1)].every((letter) => spec.bare.has(`-${letter}`))) continue;
    // `-<k>` (git log -1) is a count, not a program-running flag.
    if (spec === GIT_LOG_FLAGS && /^-\d+$/.test(word)) continue;
    return false;
  }
  return true;
}

function describeError(error: LoreError): string {
  return "message" in error && typeof error.message === "string" ? error.message : error.code;
}

function storeFailure(message: string): LoreError {
  return { code: "STORE_ERROR", message: `decision re-check: ${message}` };
}

/**
 * Whether `command` is on the read-only allowlist: `lore get|list|search|tree|rule show|rule find|ac list|log`,
 * `git show|log|grep|diff`, `grep`, `rg`, with no shell metacharacter and no flag that writes or executes.
 *
 * @param command - the premise's command as recorded
 */
export function isRerunnableCommand(command: string): boolean {
  if (SHELL_META.test(command)) return false;
  const [program, ...args] = command.trim().split(/\s+/);
  const [first, second] = args;
  if (program === "grep") return argsWithinSpec(args, GREP_FLAGS);
  if (program === "rg") return argsWithinSpec(args, RG_FLAGS);
  if (program === "git") {
    // reason: any option before the subcommand (-c, -C, --git-dir, --exec-path) makes `first` not a subcommand name.
    const spec = first === undefined ? undefined : GIT_FLAGS[first];
    return spec !== undefined && argsWithinSpec(args.slice(1), spec);
  }
  if (program === "lore") {
    if (first === undefined) return false;
    if (LORE_READ_VERBS.has(first)) return argsWithinSpec(args.slice(1), LORE_FLAGS);
    const twoWord = (first === "rule" && (second === "show" || second === "find")) || (first === "ac" && second === "list");
    return twoWord && argsWithinSpec(args.slice(2), LORE_FLAGS);
  }
  return false;
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return true;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    if (needle.every((line, j) => haystack[i + j] === line)) return true;
  }
  return false;
}

const linesOf = (text: string): string[] => text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

interface FileSource {
  readonly path: string;
  readonly lines: readonly [number, number];
  readonly sha: string;
}

/** Check one pinned file source; `quote` absent = derive it from the pinned commit (gate / score evidence). */
function checkFileSource(git: GitPort, source: FileSource, quote: string | undefined): { kind: string; fact: string } | undefined {
  const at = `${source.path}:${source.lines[0]}-${source.lines[1]}@${source.sha}`;
  const written = git.showFile(source.sha, source.path);
  if (!written.ok) return { kind: "unverifiable", fact: `git could not answer for ${at}: ${describeError(written.error)}` };
  if (written.value.state === "unreachable") return { kind: "unverifiable", fact: `commit ${source.sha} is not reachable, so ${at} cannot be read` };
  if (written.value.state === "path-absent") return { kind: "wrong-when-written", fact: `${source.path} does not exist at ${source.sha}` };
  const atCommit = linesOf(written.value.content);
  if (source.lines[1] > atCommit.length) {
    return { kind: "wrong-when-written", fact: `${source.path} has ${atCommit.length} lines at ${source.sha}, the premise cites ${source.lines[0]}-${source.lines[1]}` };
  }
  const actual = atCommit.slice(source.lines[0] - 1, source.lines[1]);
  const quoted = quote === undefined ? actual : linesOf(quote);
  if (quote !== undefined && actual.join("\n") !== quoted.join("\n")) {
    return { kind: "wrong-when-written", fact: `${at} read "${actual.join(" / ")}" when written, the premise quotes "${quoted.join(" / ")}"` };
  }
  const now = git.showFile("HEAD", source.path);
  if (!now.ok) return { kind: "unverifiable", fact: `git could not answer for ${source.path} on main: ${describeError(now.error)}` };
  if (now.value.state !== "present") return { kind: "stale-since", fact: `${source.path} no longer exists on main` };
  if (!containsRun(linesOf(now.value.content), quoted)) {
    return { kind: "stale-since", fact: `the quoted lines of ${at} (${quoted.join(" / ")}) are no longer in ${source.path} on main` };
  }
  return undefined;
}

async function checkCommandSource(
  runner: CommandRunnerPort,
  command: string,
  expect: string,
): Promise<{ kind: string; fact: string } | undefined> {
  if (!isRerunnableCommand(command)) return { kind: "not-rerunnable", fact: `\`${command}\` is not on the read-only allowlist and was not run` };
  const ran = await runner.run(command);
  if (!ran.ok) return { kind: "unverifiable", fact: `\`${command}\` could not be re-run: ${describeError(ran.error)}` };
  if (!ran.value.output.includes(expect)) return { kind: "stale-since", fact: `\`${command}\` no longer prints "${expect}" on main` };
  return undefined;
}

/**
 * A gate / score `evidence` string that is itself a `file:` or `cmd:` source is checked like a premise source. A stored
 * `evidence_source` (lore read the quote at write time) is compared with that quote; without one the quote is derived
 * from the pinned commit, which can only show the evidence went stale, never that it was wrong when written.
 */
async function checkEvidence(
  deps: DecisionRecheckDeps,
  part: Pick<DecisionGate | DecisionScore, "evidence" | "evidence_source">,
): Promise<{ kind: string; fact: string } | undefined> {
  if (part.evidence_source !== undefined) return checkFileSource(deps.git, part.evidence_source, part.evidence_source.quote);
  const evidence = part.evidence;
  const parsed = parseDecisionSource(evidence.trim());
  if (!parsed.ok) return undefined;
  const source = parsed.source;
  if (source.kind === "cmd") return checkCommandSource(deps.runner, source.command, source.expect);
  if (source.kind !== "file") return undefined;
  if (source.sha === undefined) return { kind: "unverifiable", fact: `file evidence ${source.path}:${source.lines[0]}-${source.lines[1]} names no commit` };
  return checkFileSource(deps.git, { path: source.path, lines: source.lines, sha: source.sha }, undefined);
}

/**
 * Re-check one decision: every file and command premise, and the evidence of every gate and score.
 *
 * @param deps - git and the command runner
 * @param decision - the decision and its `<slug>@<version>` address
 * @returns the findings, in premise, gate, score order; empty when everything still holds
 */
export async function recheckDecision(deps: DecisionRecheckDeps, decision: Pick<SelectedDecision, "address" | "record">): Promise<DecisionFinding[]> {
  const findings: DecisionFinding[] = [];
  const add = (part: string, found: { kind: string; fact: string } | undefined): void => {
    if (found !== undefined) findings.push({ decision: decision.address, part, ...found });
  };
  for (const [i, premise] of decision.record.premises.entries()) {
    const part = `premise ${i + 1}`;
    const source = premise.source;
    if (source.kind === "file") add(part, checkFileSource(deps.git, source, source.quote));
    else if (source.kind === "cmd") add(part, await checkCommandSource(deps.runner, source.command, source.expect));
  }
  for (const gate of decision.record.gates ?? []) add(`gate ${gate.id}`, await checkEvidence(deps, gate));
  for (const score of decision.record.scores ?? []) add(`score ${score.option}/${score.dimension}`, await checkEvidence(deps, score));
  return findings;
}

/** The docs whose writes are the plan's targets: its spec, the leaves of its rule change set, the ADR it implements. */
async function targetDocIds(deps: DecisionStoreDeps, spec: DocRecord): Promise<Result<DocId[], LoreError>> {
  const ids = new Set<DocId>([spec.id]);
  const changes = specRuleChangesSchema.safeParse(spec.extra["rule_changes"] ?? []);
  if (!changes.success) return err(storeFailure(`${spec.slug} has an unreadable rule change set: ${changes.error.message}`));
  const registry = await deps.store.listRuleRegistry();
  if (!registry.ok) return registry;
  const leafOfRule = new Map(registry.value.map((row) => [row.id, row.leaf_doc_id]));
  for (const change of changes.data) {
    if (change.op === "add") {
      const leaf = await deps.store.findBySlug(change.leaf);
      if (!leaf.ok) return leaf;
      if (leaf.value !== null) ids.add(leaf.value.id);
    } else {
      const leaf = leafOfRule.get(change.id);
      if (leaf !== undefined) ids.add(leaf);
    }
  }
  const links = await deps.store.findLinks(spec.id, "out");
  if (!links.ok) return links;
  for (const link of links.value) {
    if (link.link_type !== "implements") continue;
    const target = await deps.store.find(link.to_id);
    if (!target.ok) return target;
    if (target.value?.type === "adr") ids.add(target.value.id);
  }
  return ok([...ids]);
}

/** One window per recorded claim of a plan task: the claiming run, from the claim to the task's archive (open if not archived). */
async function claimWindows(
  deps: DecisionStoreDeps,
  tasks: readonly DocRecord[],
): Promise<Result<{ run: string; from: string; to?: string }[], LoreError>> {
  const windows: { run: string; from: string; to?: string }[] = [];
  for (const task of tasks) {
    const claims = await deps.store.queryAudit({ doc_id: task.id, action: "claim" });
    if (!claims.ok) return claims;
    const versions = await deps.store.findVersions(task.id, { limit: 1000 });
    if (!versions.ok) return versions;
    const archivedAt = versions.value
      .filter((v) => v.status === "archived")
      .map((v) => v.created_at)
      .sort()[0];
    for (const claim of claims.value) {
      if (claim.harness_run == null) continue;
      windows.push({ run: claim.harness_run, from: claim.timestamp, ...(archivedAt !== undefined ? { to: archivedAt } : {}) });
    }
  }
  return ok(windows);
}

/**
 * The plan's decisions (spec D4): version rows with a recorded decision that wrote one of the plan's targets, or that
 * a run recorded in a `claim` audit row of one of the plan's tasks wrote between that claim and the task's archive.
 *
 * @param deps - the narrow store
 * @param bundle - the plan, its spec and tasks
 */
export async function selectPlanDecisions(deps: DecisionStoreDeps, bundle: PlanBundle): Promise<Result<SelectedDecision[], LoreError>> {
  const docIds = bundle.spec !== undefined ? await targetDocIds(deps, bundle.spec) : ok<DocId[]>([]);
  if (!docIds.ok) return docIds;
  const windows = await claimWindows(deps, bundle.tasks);
  if (!windows.ok) return windows;
  const rows = await deps.store.listDecisionVersions({ docIds: docIds.value, windows: windows.value });
  if (!rows.ok) return rows;
  const slugs = new Map<string, string>();
  const selected: SelectedDecision[] = [];
  const seen = new Set<string>();
  for (const row of rows.value) {
    const key = `${row.doc_id}@${row.version}`;
    if (seen.has(key) || row.decision == null) continue;
    seen.add(key);
    const slug = await slugOf(deps, row, slugs);
    if (!slug.ok) return slug;
    selected.push({ address: `${slug.value}@${row.version}`, record: row.decision, docId: row.doc_id, version: row.version });
  }
  // Exemption decisions (#481): the exemptions of the plan's spec, and those a plan task's claim run granted within its window.
  const exemptions = await deps.store.listDecisionExemptions({
    docIds: bundle.spec !== undefined ? [bundle.spec.id] : [],
    windows: windows.value,
  });
  if (!exemptions.ok) return exemptions;
  for (const row of exemptions.value) {
    if (row.decision === undefined) continue;
    const slug = await slugOfDoc(deps, row.doc_id, slugs);
    if (!slug.ok) return slug;
    const address = exemptionDecisionAddress(slug.value, row.ac_id, row.granted_at);
    if (seen.has(address)) continue;
    seen.add(address);
    selected.push({ address, record: row.decision, docId: row.doc_id });
  }
  return ok(selected);
}

async function slugOf(deps: DecisionStoreDeps, row: VersionRecord, cache: Map<string, string>): Promise<Result<string, LoreError>> {
  if (row.slug !== undefined) return ok(row.slug);
  return slugOfDoc(deps, row.doc_id, cache);
}

async function slugOfDoc(deps: DecisionStoreDeps, docId: DocId, cache: Map<string, string>): Promise<Result<string, LoreError>> {
  const row = { doc_id: docId };
  const cached = cache.get(row.doc_id);
  if (cached !== undefined) return ok(cached);
  const doc = await deps.store.find(row.doc_id);
  if (!doc.ok) return doc;
  if (doc.value === null) return err(storeFailure(`version row of ${row.doc_id} names a document that does not exist`));
  cache.set(row.doc_id, doc.value.slug);
  return ok(doc.value.slug);
}

/**
 * Select the plan's decisions and re-check each.
 *
 * @returns all findings; empty when no decision is recorded or every one still holds
 */
export async function recheckPlanDecisions(deps: DecisionRecheckDeps, bundle: PlanBundle): Promise<Result<DecisionFinding[], LoreError>> {
  const selected = await selectPlanDecisions(deps, bundle);
  if (!selected.ok) return selected;
  const findings: DecisionFinding[] = [];
  for (const decision of selected.value) findings.push(...(await recheckDecision(deps, decision)));
  return ok(findings);
}

// ─── the judged half (spec D6) ───────────────────────────────────────────────────────────────────────

/** Re-runs one acceptance criterion of a spec; an `err` means it could not run (not that it failed). */
export interface CriterionRerunPort {
  readonly rerun: (spec: { readonly slug: string }, acId: string) => Promise<Result<{ readonly passed: boolean; readonly detail: string }, LoreError>>;
}

function describeSource(source: DecisionRecord["premises"][number]["source"]): string {
  switch (source.kind) {
    case "file":
      return `${source.path}:${source.lines[0]}-${source.lines[1]}@${source.sha} reads "${source.quote}"`;
    case "cmd":
      return `\`${source.command}\` printed "${source.expect}"`;
    case "issue":
      return `issue #${String(source.number)}`;
    case "doc":
      return `document ${source.slug}${source.version !== undefined ? `@${String(source.version)}` : ""}`;
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

/** The rule a decision's `before` replaced: the rule of the written version whose statement changed from `before`. */
async function locateReworded(
  deps: DecisionStoreDeps,
  decision: SelectedDecision & { readonly version: number },
  before: string,
): Promise<Result<{ readonly id: string; readonly after: string } | undefined, LoreError>> {
  const versions = await deps.store.findVersions(decision.docId, { limit: 1000 });
  if (!versions.ok) return versions;
  const statements = (version: number): Map<string, string> => {
    const row = versions.value.find((v) => v.version === version);
    const rules = row?.extra["rules"];
    const found = new Map<string, string>();
    if (!Array.isArray(rules)) return found;
    for (const rule of rules as unknown[]) {
      const candidate = rule as { id?: unknown; statement?: unknown };
      if (typeof candidate.id === "string" && typeof candidate.statement === "string") found.set(candidate.id, candidate.statement);
    }
    return found;
  };
  const prior = statements(decision.version - 1);
  for (const [id, after] of statements(decision.version)) {
    if (prior.get(id) === before && after !== before) return ok({ id, after });
  }
  return ok(undefined);
}

/** The live criteria that cite `ruleId`, with their spec slug. */
async function citingCriteria(deps: DecisionStoreDeps, ruleId: string): Promise<Result<{ spec: string; ac: string }[], LoreError>> {
  const cites = await deps.store.listAcCites();
  if (!cites.ok) return cites;
  const found: { spec: string; ac: string }[] = [];
  for (const row of cites.value) {
    if (row.rule_id !== ruleId) continue;
    const spec = await deps.store.find(row.doc_id);
    if (!spec.ok) return spec;
    if (spec.value === null) continue;
    const criteria = spec.value.extra["acceptance_criteria"];
    const declared = Array.isArray(criteria) ? (criteria as { id?: unknown; superseded_by?: unknown }[]).find((c) => c.id === row.ac_id) : undefined;
    // reason: a superseded criterion no longer speaks for the rule (adr-an-acceptance-criterion-retires-with-the-feature-it).
    if (declared?.superseded_by !== undefined) continue;
    found.push({ spec: spec.value.slug, ac: row.ac_id });
  }
  return ok(found);
}

/**
 * The judge's view of the plan's decisions: each selected decision with its premises' stored quotes, its alternatives,
 * and (for a rule statement change) the old and new statement and the criteria citing the rule.
 *
 * @param deps - the narrow store
 * @param bundle - the plan, its spec and tasks
 * @returns one input per selected decision (the SAME selection as the deterministic re-check); empty when none is recorded
 */
export async function buildJudgedDecisionInputs(deps: DecisionStoreDeps, bundle: PlanBundle): Promise<Result<JudgedDecisionInput[], LoreError>> {
  const selected = await selectPlanDecisions(deps, bundle);
  if (!selected.ok) return selected;
  const inputs: JudgedDecisionInput[] = [];
  for (const decision of selected.value) {
    const base = {
      address: decision.address,
      reason: decision.record.reason,
      premises: decision.record.premises.map((p) => ({ claim: p.claim, tier: p.tier, evidence: describeSource(p.source) })),
      alternatives: decision.record.alternatives,
    };
    const before = decision.record.before;
    if (before === undefined) {
      inputs.push({ ...base, citing: [] });
      continue;
    }
    // reason: an exemption decision has no version row to compare against, so a `before` on it can never be located.
    const located = decision.version === undefined ? ok(undefined) : await locateReworded(deps, { ...decision, version: decision.version }, before);
    if (!located.ok) return located;
    if (located.value === undefined) {
      inputs.push({ ...base, unlocatedBefore: before, citing: [] });
      continue;
    }
    const citing = await citingCriteria(deps, located.value.id);
    if (!citing.ok) return citing;
    inputs.push({ ...base, rule: { id: located.value.id, before, after: located.value.after }, citing: citing.value });
  }
  return ok(inputs);
}

function problem(message: string): { readonly ok: false; readonly error: string } {
  return { ok: false, error: message };
}

/**
 * Turn the judge's `decisions` answer into findings.
 *
 * @param inputs - what the judge was shown
 * @param answer - the raw `decisions` value of the judge's JSON (undefined when it sent none)
 * @returns the findings; `err(problem)` (a sentence shown to the judge on the retry) when a decision is unanswered or an answer is malformed
 */
export function judgedFindingsOf(inputs: readonly JudgedDecisionInput[], answer: unknown): Result<DecisionFinding[], string> {
  if (inputs.length === 0) return ok([]);
  const parsed = judgedDecisionsAnswerSchema.safeParse(answer);
  if (!parsed.success) {
    return problem(`\`decisions\` must be an array answering every recorded decision: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  const findings: DecisionFinding[] = [];
  for (const input of inputs) {
    const given = parsed.data.find((a) => a.decision === input.address);
    if (given === undefined) return problem(`\`decisions\` has no answer for ${input.address}`);
    if (given.premises_supported.length !== input.premises.length) {
      return problem(`${input.address}: premises_supported has ${String(given.premises_supported.length)} entries for ${String(input.premises.length)} premises`);
    }
    if (input.rule !== undefined && given.meaning_unchanged == null) return problem(`${input.address}: meaning_unchanged is required for the reworded rule ${input.rule.id}`);
    const why = given.reason != null && given.reason.length > 0 ? `: ${given.reason}` : "";
    for (const [i, supported] of given.premises_supported.entries()) {
      if (supported) continue;
      findings.push({ decision: input.address, part: `premise ${String(i + 1)}`, kind: "premise-not-supported", fact: `the judge found premise ${String(i + 1)} ("${input.premises[i]?.claim ?? ""}") not supported by its source${why}` });
    }
    if (input.rule !== undefined && given.meaning_unchanged === false) {
      findings.push({ decision: input.address, part: `rule ${input.rule.id}`, kind: "meaning-changed", fact: `the judge found the meaning of ${input.rule.id} changed by its rewording${why}` });
    }
    const better = given.better_option?.trim();
    if (better !== undefined && better.length > 0) {
      findings.push({ decision: input.address, part: "alternatives", kind: "better-option", fact: `the judge named a better option: ${better}${why}` });
    }
  }
  return ok(findings);
}

/**
 * Spec D6 re-run: for each reworded rule, run every criterion citing it and report a failing one (or one that cannot run).
 *
 * @param inputs - the judged inputs (only those with a located `rule` are re-run)
 * @param port - runs one criterion in the milestone's execution context
 * @returns findings in decision, criterion order; empty when every citing criterion passes
 */
export async function rerunCitingCriteria(inputs: readonly JudgedDecisionInput[], port: CriterionRerunPort): Promise<DecisionFinding[]> {
  const findings: DecisionFinding[] = [];
  for (const input of inputs) {
    if (input.unlocatedBefore !== undefined) {
      findings.push({ decision: input.address, part: "rule statement", kind: "unverifiable", fact: `no rule of the document replaced the statement "${input.unlocatedBefore}" at this version, so its citing criteria could not be found` });
      continue;
    }
    if (input.rule === undefined) continue;
    for (const criterion of input.citing) {
      const part = `rule ${input.rule.id} / ${criterion.ac}`;
      const ran = await port.rerun({ slug: criterion.spec }, criterion.ac);
      if (!ran.ok) {
        findings.push({ decision: input.address, part, kind: "unverifiable", fact: `${criterion.spec} ${criterion.ac} could not be re-run: ${describeError(ran.error)}` });
      } else if (!ran.value.passed) {
        const detail = ran.value.detail.length > 0 ? `: ${ran.value.detail}` : "";
        findings.push({ decision: input.address, part, kind: "criterion-fails", fact: `${criterion.spec} ${criterion.ac} cites ${input.rule.id} and fails when re-run after its statement changed${detail}` });
      }
    }
  }
  return findings;
}

/**
 * A wrong-when-written finding fails `snapshot_accuracy` (a premise the writer got wrong is a document that never
 * matched the code); every other kind leaves the dimension alone. The judge cannot waive it.
 *
 * @param dimensions - the judgments after the other measured rules
 * @param findings - the re-check's findings
 */
export function applyDecisionFindings(
  dimensions: LlmMilestoneOutput["dimensions"],
  findings: readonly DecisionFinding[],
): LlmMilestoneOutput["dimensions"] {
  const wrong = findings.filter((f) => f.kind === "wrong-when-written");
  if (wrong.length === 0) return dimensions;
  const judged = dimensions.snapshot_accuracy;
  const named = wrong.map((f) => `${f.decision} ${f.part}: ${f.fact}`).join("; ");
  return {
    ...dimensions,
    snapshot_accuracy: {
      verdict: "fail",
      reason: judged.verdict === "fail" ? `${judged.reason}; recorded decision wrong when written: ${named}` : `recorded decision wrong when written: ${named} (judge said: ${judged.reason})`,
      reference: judged.reference.length > 0 ? judged.reference : "Bazel action cache",
    },
  };
}

/**
 * The real runner: each command runs in a throwaway detached worktree at main's HEAD, with the verify env allowlist.
 * The worktree is removed after every run.
 *
 * @param repoRoot - the repository whose HEAD the command sees
 * @param env - the process environment to filter
 */
export function createWorktreeCommandRunner(repoRoot: string, env: Readonly<Record<string, string | undefined>>): CommandRunnerPort {
  return {
    run: async (command) => {
      const parent = mkdtempSync(join(tmpdir(), "lore-recheck-"));
      const tree = join(parent, "tree");
      try {
        const added = spawnSync("git", ["worktree", "add", "--detach", tree, "HEAD"], { cwd: repoRoot, encoding: "utf8" });
        if (added.status !== 0) return err(storeFailure(`could not create the detached worktree: ${(added.stderr ?? "").trim()}`));
        const resolved = resolveVerifyEnv(env, { allowlist: [], passthroughAll: false });
        const ran = spawnSync("sh", ["-c", command], { cwd: tree, encoding: "utf8", timeout: 60_000, ...(resolved !== undefined ? { env: resolved } : {}) });
        if (ran.error !== undefined) return err(storeFailure(`\`${command}\` failed to start: ${ran.error.message}`));
        return ok({ exitCode: ran.status ?? -1, output: `${ran.stdout ?? ""}${ran.stderr ?? ""}` });
      } finally {
        spawnSync("git", ["worktree", "remove", "--force", tree], { cwd: repoRoot });
        rmSync(parent, { recursive: true, force: true });
        spawnSync("git", ["worktree", "prune"], { cwd: repoRoot });
      }
    },
  };
}
