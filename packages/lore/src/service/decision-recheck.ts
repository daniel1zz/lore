/**
 * Decision re-check: the deterministic half of the milestone check of recorded decisions.
 *
 * Purpose: select the decisions that belong to a plan, re-verify each file / command source they rest on against git
 *   and a read-only re-run, and report findings; a wrong-when-written finding fails `snapshot_accuracy`.
 * Public surface: selectPlanDecisions, recheckDecision, recheckPlanDecisions, isRerunnableCommand,
 *   applyDecisionFindings, createWorktreeCommandRunner, CommandRunnerPort, DecisionRecheckDeps.
 * Invariants:
 *   - Finding kinds: `wrong-when-written` (the source never said what the premise claims), `stale-since` (it said so
 *     at its commit, no longer on main), `unverifiable` (the commit or the answer cannot be had), `not-rerunnable`
 *     (a command outside the read-only allowlist; it is NEVER run).
 *   - File lines are compared by content against the quote, never by line number alone: an unrelated edit that only
 *     shifts the quoted lines is not a finding.
 *   - Only a wrong-when-written finding changes a verdict; the other kinds are listed on the review.
 *   - Weight tables are never selection targets (spec D4).
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
  type DecisionRecord,
  type DocId,
  type DocRecord,
  type LlmMilestoneOutput,
  type LoreError,
  type PlanBundle,
  type Result,
  type VersionRecord,
} from "@lore/core";
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
    "listDecisionVersions" | "queryAudit" | "findBySlug" | "find" | "findLinks" | "findVersions" | "listRuleRegistry"
  >;
  readonly git: GitPort;
  readonly runner: CommandRunnerPort;
}

/** A decision version row with the address the findings name. */
export interface SelectedDecision {
  readonly address: string;
  readonly record: DecisionRecord;
}

const SHELL_META = /[;&|<>`$(){}\\\n\r]/;
const LORE_READ_VERBS = new Set(["get", "list", "search", "tree", "log"]);
const GIT_READ_VERBS = new Set(["show", "log", "grep", "diff"]);
// reason: these flags make an otherwise read-only command write a file or run another program.
const FORBIDDEN_FLAG = /^--(output|pre|exec|ext-diff|textconv)\b/;

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
  const words = command.trim().split(/\s+/);
  if (words.some((w) => FORBIDDEN_FLAG.test(w))) return false;
  const [program, first, second] = words;
  if (program === "grep" || program === "rg") return true;
  if (program === "git") return first !== undefined && GIT_READ_VERBS.has(first);
  if (program === "lore") {
    if (first === undefined) return false;
    if (LORE_READ_VERBS.has(first)) return true;
    return (first === "rule" && (second === "show" || second === "find")) || (first === "ac" && second === "list");
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

/** A gate / score `evidence` string that is itself a `file:` or `cmd:` source is checked like a premise source. */
async function checkEvidence(deps: DecisionRecheckDeps, evidence: string): Promise<{ kind: string; fact: string } | undefined> {
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
export async function recheckDecision(deps: DecisionRecheckDeps, decision: SelectedDecision): Promise<DecisionFinding[]> {
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
  for (const gate of decision.record.gates ?? []) add(`gate ${gate.id}`, await checkEvidence(deps, gate.evidence));
  for (const score of decision.record.scores ?? []) add(`score ${score.option}/${score.dimension}`, await checkEvidence(deps, score.evidence));
  return findings;
}

/** The docs whose writes are the plan's targets: its spec, the leaves of its rule change set, the ADR it implements. */
async function targetDocIds(deps: DecisionRecheckDeps, spec: DocRecord): Promise<Result<DocId[], LoreError>> {
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
  deps: DecisionRecheckDeps,
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
export async function selectPlanDecisions(deps: DecisionRecheckDeps, bundle: PlanBundle): Promise<Result<SelectedDecision[], LoreError>> {
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
    selected.push({ address: `${slug.value}@${row.version}`, record: row.decision });
  }
  return ok(selected);
}

async function slugOf(deps: DecisionRecheckDeps, row: VersionRecord, cache: Map<string, string>): Promise<Result<string, LoreError>> {
  if (row.slug !== undefined) return ok(row.slug);
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
