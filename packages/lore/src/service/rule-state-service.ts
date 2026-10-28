/**
 * Module: rule-state-service — read-time verification state of baseline rules.
 *
 * Purpose: answer "is this baseline rule backed by evidence that still holds?" by joining
 *   baseline rules (business leaf BR-n and architecture standard AS-n; AD-n debt entries are not citable and are excluded) -> citing script-mode ACs (`cites`) -> runner-attested evidence
 *   (resolved to (spec, AC) through plan lineage) -> git staleness of the citing spec's
 *   code anchors. State is computed on read and never stored.
 * Public surface: {@link RuleStateService} (`counts`, `full`), {@link GitPort}, and the
 *   result types {@link RuleStateFull} / {@link RuleStateCounts} / {@link RuleStateEntry}.
 * Invariants:
 *   - `counts()` never touches git (not even `headSha`) and never emits a `verified` key —
 *     staleness is not evaluated there, so a pass is `passing_staleness_unchecked`.
 *   - `full()` precedence: contradicted > stale > verified > unknown > unverified. A pass
 *     with no head_sha / a dirty run / a non-ancestor sha / unavailable git is `unknown`
 *     (with a reason), NEVER verified. A latest attested FAIL contradicts without git.
 *   - Per-input verdict, then rule state: contradicted if any input's latest run failed; else
 *     stale if any input is stale; else verified if >= 1 input is verified; else
 *     unknown(reason of the FIRST unknown input, in (spec, ac_id) order) if any; else unverified.
 *     A pass whose citing spec declares no `code_anchors` is unknown(`no-code-anchors`), never
 *     verified (vacuous truth is not truth); it still yields to any verifiable input. `counts()`
 *     does not evaluate staleness, so such a pass stays `passing_staleness_unchecked` there.
 *   - Only runner-attested (`attestation` present), conclusive (pass|fail) rows count; the
 *     latest per (spec, AC) wins. Self-reported rows neither verify nor contradict.
 *   - Evidence -> AC: a plan-member task resolves to its plan's parent spec; a task with no
 *     plan lineage resolves a row's `ac_ref` only when exactly ONE spec declares that AC id,
 *     otherwise the row is counted in `ambiguous_ac_ref` and attributed to nothing.
 *   - Git budget in `full`: `headSha` once; `isAncestor` once and `changedSince` once per
 *     distinct evidence sha (path set = union of the anchors of every passing input at that
 *     sha, so one sha's verdict is independent of which rules were selected).
 *   - Output is a pure function of (corpus, HEAD, git answers): identical inputs, identical bytes.
 * Side-effect class: reads the store; git only through the injected {@link GitPort}.
 * Source: spec-baseline-slice-1-rules-with-permanent-ids-ac-citations §C6, QA-3/4/5.
 */

import { err, isAcSuperseded, ok, parseCodeAnchor, ruleIdPrefixOfNode } from "@lore/core";
import type { DocRecord, DocType, EvidenceEntry, LoreError, Result, RuleLifecycle, SupersededByRef } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { attestedRunKey, indexLatestAttestedRuns } from "./attested-ac-runs.js";
import { approvedRulesOf } from "./baseline-items.js";

// ─── Public contract ────────────────────────────────────────────────────────────────────────

/**
 * Git reached only through this port. All methods are synchronous; an `err` from any means
 * "git unavailable / shallow" and degrades the affected rules to `unknown(git-unavailable)`.
 */
export interface GitPort {
  /** Full 40-hex HEAD. */
  headSha(): Result<string, LoreError>;
  /** Is `sha` an ancestor of HEAD. */
  isAncestor(sha: string): Result<boolean, LoreError>;
  /** `true` = `git diff --quiet <sha> HEAD -- <paths>` exits 1 (something changed). */
  changedSince(sha: string, paths: string[]): Result<boolean, LoreError>;
  /** The subset of `paths` that `git diff --name-only <sha> HEAD -- <paths>` lists; sorted; empty = unchanged. */
  changedPaths(sha: string, paths: string[]): Result<string[], LoreError>;
  /** `git show <rev>:<path>`, telling a commit git does not hold from a path the commit does not have. */
  showFile(rev: string, path: string): Result<ShownFile, LoreError>;
}

/**
 * What `git show <rev>:<path>` found. `unreachable` = `rev` names no commit in this repository (never fetched, or
 * pruned); `path-absent` = the commit exists but holds no such path. Only an `err` means git itself could not answer.
 */
export type ShownFile =
  | { readonly state: "present"; readonly content: string }
  | { readonly state: "path-absent" }
  | { readonly state: "unreachable" };

/** Raw outcome of one git call, structurally the same as `OwnDiffGitOutcome`. */
export interface GitShowOutcome {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The single implementation of "file content at a revision" (shared by {@link GitPort.showFile} and the own-diff
 * judgment): probes the commit first so an unreachable commit is never read as an absent path.
 *
 * @param runGit - runs `git <args>` and never throws
 * @param rev - a commit-ish
 * @param path - repo-root-relative path
 * @returns the content, `path-absent`, or `unreachable`; `err` when the commit probe itself could not run
 */
export function showFileAtRevision(
  runGit: (args: readonly string[]) => GitShowOutcome,
  rev: string,
  path: string,
): Result<ShownFile, LoreError> {
  const commit = runGit(["cat-file", "-e", `${rev}^{commit}`]);
  if (commit.status === null) return err({ code: "STORE_ERROR", message: `git unavailable for ${rev}: ${commit.stderr.trim()}` });
  if (commit.status !== 0) return ok({ state: "unreachable" });
  const shown = runGit(["show", `${rev}:${path}`]);
  if (shown.status === null) return err({ code: "STORE_ERROR", message: `git unavailable for ${rev}:${path}: ${shown.stderr.trim()}` });
  if (shown.status !== 0) return ok({ state: "path-absent" });
  return ok({ state: "present", content: shown.stdout });
}

export type RuleVerification = "contradicted" | "stale" | "verified" | "unverified" | "unknown";
export type UnknownReason =
  | "no-commit-recorded"
  | "dirty"
  | "not-ancestor"
  | "git-unavailable"
  | "no-code-anchors";

/** One per citing script-mode AC — returned for EVERY state. */
export interface RuleStateInput {
  spec: string;
  ac_id: string;
  /** Latest attested conclusive run of the AC; `null` = none. */
  evidence_recorded_at: string | null;
  evidence_result: "pass" | "fail" | null;
  head_sha: string | null;
  /** Path part of the citing spec's `extra.code_anchors`, sorted. */
  anchor_paths: string[];
}

/** Where an offending run was recorded: the task holding the evidence row and that task's plan (each `null` when unknown). */
export interface RuleOffenceOrigin {
  task: string | null;
  plan: string | null;
}

/**
 * The input that makes a rule `contradicted` or `stale` (BR-984): one per such input, so a refusal can name
 * the citing criterion, the sha of its latest attested run, and what to re-run. Computed by `decideRule` from
 * the verdicts it already derives — consumers render it, never re-derive it.
 */
export type RuleOffence =
  | ({ kind: "stale"; spec: string; ac_id: string; run_sha: string; changed_paths: string[] } & RuleOffenceOrigin)
  | ({ kind: "contradicted"; spec: string; ac_id: string; run_sha: string | null } & RuleOffenceOrigin);

export interface RuleStateEntry {
  rule_id: string;
  leaf: string;
  lifecycle: RuleLifecycle;
  state: RuleVerification;
  /** Present iff `state === "unknown"`. */
  unknown_reason?: UnknownReason;
  /** Sorted by (spec, ac_id). */
  inputs: RuleStateInput[];
  /** Inputs behind a `contradicted` (failing runs) or `stale` (changed anchors) state, in input order; `[]` for every other state. */
  offences: RuleOffence[];
}

export interface RuleStateFull {
  /** `head_sha` is `null` only when git could not report HEAD (every git-dependent rule is then unknown). */
  computed_from: { head_sha: string | null; corpus_version: number };
  ambiguous_ac_ref: number;
  /** Numeric ascending by rule id (BR-2 before BR-10). */
  rules: RuleStateEntry[];
}

export interface RuleStateCounts {
  computed_from: { head_sha: null; corpus_version: number };
  ambiguous_ac_ref: number;
  rules_total: number;
  by_verification: {
    contradicted: number;
    passing_staleness_unchecked: number;
    unverified: number;
    stale: "not_computed";
  };
  stale_not_computed_reason: string;
}

const STALE_NOT_COMPUTED_REASON =
  "git-free counts mode does not evaluate staleness; run `lore baseline tree --states` for the full per-rule state";

// ─── Snapshot: store rows -> rule / citing-AC / latest-run model (pure) ─────────────────────

interface CitingInput {
  specId: string;
  input: RuleStateInput;
  /** Latest attested conclusive run, or null. */
  run: EvidenceEntry | null;
  /** Task + plan that recorded `run` (both null when `run` is null or lineage is unknown). */
  origin: RuleOffenceOrigin;
}

interface RuleModel {
  id: string;
  leaf: string;
  lifecycle: RuleLifecycle;
  /** Sorted by (spec, ac_id). */
  inputs: CitingInput[];
}

interface Snapshot {
  corpusVersion: number;
  ambiguousAcRef: number;
  rules: RuleModel[];
}

const LIFECYCLES: ReadonlySet<string> = new Set(["live", "deprecated", "retired"]);

function ruleNumber(id: string): number {
  const n = Number(id.slice(id.indexOf("-") + 1));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Path part of every code anchor, deduplicated and sorted. A grammar-invalid anchor keeps its raw path part. */
function anchorPathsOf(spec: DocRecord): string[] {
  const raw = spec.extra["code_anchors"];
  if (!Array.isArray(raw)) return [];
  const paths = new Set<string>();
  for (const anchor of raw as unknown[]) {
    if (typeof anchor !== "string") continue;
    const parsed = parseCodeAnchor(anchor);
    if (parsed.ok) {
      paths.add(parsed.value.path);
    } else {
      // reason: a stored anchor that fails today's grammar must still constrain staleness; dropping
      // it would let a change under that path read as "unchanged" (a false verified).
      const hash = anchor.lastIndexOf("#");
      paths.add(hash === -1 ? anchor : anchor.slice(0, hash));
    }
  }
  return [...paths].sort(compareText);
}

interface DeclaredAc {
  id: string;
  isScript: boolean;
  /** D15 supersession mark present (shared `isAcSuperseded` predicate); a superseded criterion never contributes to a rule's state. */
  superseded: boolean;
  cites: string[];
}

function declaredAcsOf(spec: DocRecord): DeclaredAc[] {
  const raw = spec.extra["acceptance_criteria"];
  if (!Array.isArray(raw)) return [];
  const out: DeclaredAc[] = [];
  for (const c of raw as unknown[]) {
    if (typeof c !== "object" || c === null) continue;
    const { id, verify, cites, superseded_by } = c as { id?: unknown; verify?: unknown; cites?: unknown; superseded_by?: unknown };
    if (typeof id !== "string") continue;
    const mode = typeof verify === "object" && verify !== null ? (verify as { mode?: unknown }).mode : undefined;
    out.push({
      id,
      isScript: mode === "script",
      superseded: isAcSuperseded({ superseded_by: superseded_by as SupersededByRef | undefined }),
      cites: Array.isArray(cites) ? [...new Set((cites as unknown[]).filter((x): x is string => typeof x === "string"))] : [],
    });
  }
  return out;
}

/** Index of rules in citable rule-holding docs (business leaf, architecture standard): first occurrence of an id wins (same rule as `buildRuleIndex`). */
function collectRules(leaves: readonly DocRecord[]): Array<{ id: string; leaf: string; lifecycle: RuleLifecycle }> {
  const seen = new Map<string, { id: string; leaf: string; lifecycle: RuleLifecycle }>();
  for (const leaf of leaves) {
    for (const r of approvedRulesOf(leaf)) {
      if (typeof r !== "object" || r === null) continue;
      const { id, lifecycle } = r as { id?: unknown; lifecycle?: unknown };
      if (typeof id !== "string" || typeof lifecycle !== "string" || !LIFECYCLES.has(lifecycle)) continue;
      if (!seen.has(id)) seen.set(id, { id, leaf: leaf.slug, lifecycle: lifecycle as RuleLifecycle });
    }
  }
  return [...seen.values()].sort((a, b) => ruleNumber(a.id) - ruleNumber(b.id) || compareText(a.id, b.id));
}

/** Build the model every mode reads. One pass over each doc type; no per-rule store reads. */
function buildSnapshot(docs: readonly DocRecord[]): Snapshot {
  let corpusVersion = 0;
  const leaves: DocRecord[] = [];
  const specs: DocRecord[] = [];
  const plans = new Map<string, DocRecord>();
  const tasks: DocRecord[] = [];
  for (const doc of docs) {
    if (doc.version > corpusVersion) corpusVersion = doc.version;
    // reason: a rule is citable (BR-980) on every node whose family is BR or AS; AD debt entries are not
    // citable, so they never get a verification state. Family comes from core's node-kind SSOT.
    const family = doc.type === "baseline" ? ruleIdPrefixOfNode(doc.extra) : undefined;
    if (family === "BR" || family === "AS") leaves.push(doc);
    else if (doc.type === "spec") specs.push(doc);
    else if (doc.type === "plan") plans.set(doc.id, doc);
    else if (doc.type === "task") tasks.push(doc);
  }

  const declared = new Map<string, DeclaredAc[]>();
  for (const spec of specs) declared.set(spec.id, declaredAcsOf(spec));

  // Latest attested conclusive run per (spec, AC); ambiguous ad-hoc rows are counted and dropped. The attribution
  // is the shared `attested-ac-runs` module (also the gate of `lore rule apply`) — never re-derived here.
  const { latest, originTasks, ambiguousAcRef } = indexLatestAttestedRuns({
    specs: specs.map((spec) => ({ id: spec.id, acIds: (declared.get(spec.id) ?? []).map((ac) => ac.id) })),
    plans: [...plans.values()],
    tasks,
  });

  const citing = new Map<string, CitingInput[]>();
  for (const spec of specs) {
    const anchorPaths = anchorPathsOf(spec);
    for (const ac of declared.get(spec.id) ?? []) {
      // reason: a superseded criterion is skipped by `lore verify` and immutable, so nothing can ever re-verify
      // it; counting it would pin its rule `stale` forever. Its id stays in the lineage set above (ac_ref
      // attribution), only its contribution to rule state is dropped.
      if (!ac.isScript || ac.superseded) continue;
      const run = latest.get(attestedRunKey(spec.id, ac.id)) ?? null;
      const originTask = originTasks.get(attestedRunKey(spec.id, ac.id));
      const originPlanId = originTask?.extra["plan_id"];
      const origin: RuleOffenceOrigin = {
        task: originTask?.slug ?? null,
        plan: typeof originPlanId === "string" ? (plans.get(originPlanId)?.slug ?? null) : null,
      };
      for (const ruleId of ac.cites) {
        const input: RuleStateInput = {
          spec: spec.slug,
          ac_id: ac.id,
          evidence_recorded_at: run?.recorded_at ?? null,
          evidence_result: run === null ? null : (run.result as "pass" | "fail"),
          head_sha: run?.attestation?.head_sha ?? null,
          anchor_paths: anchorPaths,
        };
        citing.set(ruleId, [...(citing.get(ruleId) ?? []), { specId: spec.id, input, run, origin }]);
      }
    }
  }

  const rules: RuleModel[] = collectRules(leaves).map((r) => ({
    ...r,
    inputs: [...(citing.get(r.id) ?? [])].sort(
      (a, b) => compareText(a.input.spec, b.input.spec) || compareText(a.input.ac_id, b.input.ac_id),
    ),
  }));
  return { corpusVersion, ambiguousAcRef, rules };
}

// ─── Git evaluation (full mode) ─────────────────────────────────────────────────────────────

type PassVerdict =
  | { kind: "verified" }
  | { kind: "stale"; changedPaths: string[] }
  | { kind: "unknown"; reason: UnknownReason };

/** Memoised, budget-respecting view over the GitPort for ONE `full()` call. */
class GitEvaluator {
  private head: Result<string, LoreError> | undefined;
  private readonly ancestor = new Map<string, Result<boolean, LoreError>>();
  private readonly changed = new Map<string, Result<boolean, LoreError>>();
  private readonly listed = new Map<string, Result<string[], LoreError>>();

  constructor(
    private readonly git: GitPort,
    private readonly pathsBySha: ReadonlyMap<string, string[]>,
  ) {}

  headSha(): Result<string, LoreError> {
    this.head ??= this.git.headSha();
    return this.head;
  }

  verdict(sha: string, ownAnchorPaths: readonly string[]): PassVerdict {
    if (!this.headSha().ok) return { kind: "unknown", reason: "git-unavailable" };
    let ancestor = this.ancestor.get(sha);
    if (ancestor === undefined) {
      ancestor = this.git.isAncestor(sha);
      this.ancestor.set(sha, ancestor);
    }
    if (!ancestor.ok) return { kind: "unknown", reason: "git-unavailable" };
    if (!ancestor.value) return { kind: "unknown", reason: "not-ancestor" };
    let changed = this.changed.get(sha);
    if (changed === undefined) {
      changed = this.git.changedSince(sha, this.pathsBySha.get(sha) ?? [...ownAnchorPaths]);
      this.changed.set(sha, changed);
    }
    if (!changed.ok) return { kind: "unknown", reason: "git-unavailable" };
    if (!changed.value) return { kind: "verified" };
    // reason: name the paths over the SAME pathspec set `changedSince` judged, so the listing is exactly
    // why this verdict is stale (an own-anchor-only listing could be empty when a peer spec's anchor moved).
    const pathspec = this.pathsBySha.get(sha) ?? [...ownAnchorPaths];
    const listKey = `${sha}\u0000${pathspec.join("\u0000")}`;
    let listed = this.listed.get(listKey);
    if (listed === undefined) {
      listed = this.git.changedPaths(sha, pathspec);
      this.listed.set(listKey, listed);
    }
    if (!listed.ok) return { kind: "unknown", reason: "git-unavailable" };
    return { kind: "stale", changedPaths: listed.value };
  }
}

/** Verdict of one passing input before any git call: unknown for an unrecorded / dirty run. */
function preGitUnknown(run: EvidenceEntry): UnknownReason | null {
  const att = run.attestation;
  if (att?.head_sha === undefined || att.worktree_dirty === undefined) return "no-commit-recorded";
  if (att.worktree_dirty) return "dirty";
  return null;
}

function decideRule(
  rule: RuleModel,
  git: GitEvaluator,
): { state: RuleVerification; reason?: UnknownReason; offences: RuleOffence[] } {
  const staleOffences: RuleOffence[] = [];
  const contradictedOffences: RuleOffence[] = [];
  let verified = false;
  let unknownReason: UnknownReason | undefined;
  for (const { run, input, origin } of rule.inputs) {
    if (run === null) continue;
    if (run.result === "fail") {
      contradictedOffences.push({
        kind: "contradicted",
        spec: input.spec,
        ac_id: input.ac_id,
        run_sha: run.attestation?.head_sha ?? null,
        ...origin,
      });
      continue;
    }
    const early = preGitUnknown(run);
    if (early !== null) {
      unknownReason ??= early;
      continue;
    }
    const sha = run.attestation?.head_sha as string;
    // reason: a spec with no code_anchors makes "anchored code unchanged since the pass" vacuously
    // true; vacuous must be distinguishable from true, so it is unknown, not verified. Checked
    // before any git call (nothing to diff).
    if (input.anchor_paths.length === 0) {
      unknownReason ??= "no-code-anchors";
      continue;
    }
    const v = git.verdict(sha, input.anchor_paths);
    if (v.kind === "stale") {
      staleOffences.push({
        kind: "stale",
        spec: input.spec,
        ac_id: input.ac_id,
        run_sha: sha,
        changed_paths: v.changedPaths,
        ...origin,
      });
    } else if (v.kind === "verified") verified = true;
    else if (v.reason === "git-unavailable") {
      // reason: BR-984 refuses a close on git-unavailable (a failed measurement) but only reports the other
      // reasons, so a git failure must not be masked by an earlier-seen reportable reason (first-wins would).
      unknownReason = v.reason;
    } else unknownReason ??= v.reason;
  }
  if (contradictedOffences.length > 0) return { state: "contradicted", offences: contradictedOffences };
  if (staleOffences.length > 0) return { state: "stale", offences: staleOffences };
  if (verified) return { state: "verified", offences: [] };
  if (unknownReason !== undefined) return { state: "unknown", reason: unknownReason, offences: [] };
  return { state: "unverified", offences: [] };
}

// ─── Service ────────────────────────────────────────────────────────────────────────────────

/** Doc types the rule-state snapshot depends on; any other type is never fetched. */
const SNAPSHOT_DOC_TYPES: readonly DocType[] = ["baseline", "spec", "plan", "task"];

/**
 * Read-time rule verification state (see the module header for the precedence and
 * evidence-resolution rules). Stateless: holds only the store and the git port.
 *
 * @example
 * const svc = new RuleStateService(store, new SpawnGitPort(repoRoot));
 * const counts = await svc.counts();          // git-free, for `lore status`
 * const full = await svc.full({ rule: "BR-7" }); // per-rule state with inputs
 */
export class RuleStateService {
  constructor(
    private readonly store: StoreInterface,
    private readonly git: GitPort,
  ) {}

  /**
   * Git-free rule counts by verification bucket (the `lore status` path): ZERO GitPort calls.
   *
   * @returns counts with `stale: "not_computed"` plus its reason; never a `verified` key.
   */
  async counts(): Promise<Result<RuleStateCounts, LoreError>> {
    const snapshot = await this.loadSnapshot();
    if (!snapshot.ok) return snapshot;
    const by = { contradicted: 0, passing_staleness_unchecked: 0, unverified: 0, stale: "not_computed" as const };
    for (const rule of snapshot.value.rules) {
      const results = rule.inputs.map((i) => i.run?.result);
      if (results.includes("fail")) by.contradicted += 1;
      else if (results.includes("pass")) by.passing_staleness_unchecked += 1;
      else by.unverified += 1;
    }
    return ok({
      computed_from: { head_sha: null, corpus_version: snapshot.value.corpusVersion },
      ambiguous_ac_ref: snapshot.value.ambiguousAcRef,
      rules_total: snapshot.value.rules.length,
      by_verification: by,
      stale_not_computed_reason: STALE_NOT_COMPUTED_REASON,
    });
  }

  /**
   * Full per-rule state with inputs. `opts.rule` narrows to one rule id; an id no live
   * baseline leaf holds is a `VALIDATION_ERROR` (fail loud).
   */
  async full(opts?: { rule?: string }): Promise<Result<RuleStateFull, LoreError>> {
    const snapshot = await this.loadSnapshot();
    if (!snapshot.ok) return snapshot;
    const { rules, corpusVersion, ambiguousAcRef } = snapshot.value;

    let selected = rules;
    if (opts?.rule !== undefined) {
      selected = rules.filter((r) => r.id === opts.rule);
      if (selected.length === 0) {
        return err({
          code: "VALIDATION_ERROR",
          field: "rule",
          message: `rule '${opts.rule}' is not held by any live business leaf or architecture standard`,
          value: opts.rule,
          rule: "BR-673",
        });
      }
    }

    // Path set per sha = union over EVERY rule's gittable pass, not only the selected ones, so
    // `full({rule})` and `full()` agree on a rule's state.
    const pathsBySha = new Map<string, Set<string>>();
    for (const rule of rules) {
      for (const { run, input } of rule.inputs) {
        if (run === null || run.result !== "pass" || preGitUnknown(run) !== null) continue;
        const sha = run.attestation?.head_sha as string;
        const set = pathsBySha.get(sha) ?? new Set<string>();
        for (const p of input.anchor_paths) set.add(p);
        pathsBySha.set(sha, set);
      }
    }
    const sortedPaths = new Map([...pathsBySha].map(([sha, set]) => [sha, [...set].sort(compareText)] as const));
    const git = new GitEvaluator(this.git, sortedPaths);

    const entries: RuleStateEntry[] = selected.map((rule) => {
      const decided = decideRule(rule, git);
      return {
        rule_id: rule.id,
        leaf: rule.leaf,
        lifecycle: rule.lifecycle,
        state: decided.state,
        ...(decided.reason !== undefined ? { unknown_reason: decided.reason } : {}),
        inputs: rule.inputs.map((i) => i.input),
        offences: decided.offences,
      };
    });
    const head = git.headSha();
    return ok({
      computed_from: { head_sha: head.ok ? head.value : null, corpus_version: corpusVersion },
      ambiguous_ac_ref: ambiguousAcRef,
      rules: entries,
    });
  }

  private async loadSnapshot(): Promise<Result<Snapshot, LoreError>> {
    // reason: rule state reads only these four types; an unfiltered findMany({}) parsed every
    // knowledge doc (~70% of extra bytes) and made `lore status --json` ~19 s (AC-BLS2-9, C6).
    const all: DocRecord[] = [];
    for (const type of SNAPSHOT_DOC_TYPES) {
      const docs = await this.store.findMany({ type });
      if (!docs.ok) return docs;
      all.push(...docs.value);
    }
    // reason: corpus_version keeps its "max version over ALL live docs" meaning (slice-1
    // AC-BLS1-3/4) without parsing the knowledge docs this snapshot no longer fetches.
    const maxVersion = await this.store.maxDocVersion();
    if (!maxVersion.ok) return maxVersion;
    const snapshot = buildSnapshot(all);
    return ok({ ...snapshot, corpusVersion: maxVersion.value });
  }
}
