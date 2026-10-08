/**
 * Module: rule-state-service — read-time verification state of baseline rules.
 *
 * Purpose: answer "is this baseline rule backed by evidence that still holds?" by joining
 *   baseline leaf rules -> citing script-mode ACs (`cites`) -> runner-attested evidence
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

import { err, extractEvidence, ok, parseCodeAnchor } from "@lore/core";
import type { DocRecord, DocType, EvidenceEntry, LoreError, Result, RuleLifecycle } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";

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

export interface RuleStateEntry {
  rule_id: string;
  leaf: string;
  lifecycle: RuleLifecycle;
  state: RuleVerification;
  /** Present iff `state === "unknown"`. */
  unknown_reason?: UnknownReason;
  /** Sorted by (spec, ac_id). */
  inputs: RuleStateInput[];
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
  cites: string[];
}

function declaredAcsOf(spec: DocRecord): DeclaredAc[] {
  const raw = spec.extra["acceptance_criteria"];
  if (!Array.isArray(raw)) return [];
  const out: DeclaredAc[] = [];
  for (const c of raw as unknown[]) {
    if (typeof c !== "object" || c === null) continue;
    const { id, verify, cites } = c as { id?: unknown; verify?: unknown; cites?: unknown };
    if (typeof id !== "string") continue;
    const mode = typeof verify === "object" && verify !== null ? (verify as { mode?: unknown }).mode : undefined;
    out.push({
      id,
      isScript: mode === "script",
      cites: Array.isArray(cites) ? [...new Set((cites as unknown[]).filter((x): x is string => typeof x === "string"))] : [],
    });
  }
  return out;
}

function isConclusiveAttested(e: EvidenceEntry): e is EvidenceEntry & { result: "pass" | "fail" } {
  return e.attestation !== undefined && (e.result === "pass" || e.result === "fail");
}

/** Index of rules in leaf docs: first occurrence of an id wins (same rule as `buildRuleIndex`). */
function collectRules(leaves: readonly DocRecord[]): Array<{ id: string; leaf: string; lifecycle: RuleLifecycle }> {
  const seen = new Map<string, { id: string; leaf: string; lifecycle: RuleLifecycle }>();
  for (const leaf of leaves) {
    const rules = leaf.extra["rules"];
    if (!Array.isArray(rules)) continue;
    for (const r of rules as unknown[]) {
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
    if (doc.type === "baseline" && doc.extra["node"] === "leaf") leaves.push(doc);
    else if (doc.type === "spec") specs.push(doc);
    else if (doc.type === "plan") plans.set(doc.id, doc);
    else if (doc.type === "task") tasks.push(doc);
  }

  const specById = new Map(specs.map((s) => [s.id, s]));
  const specsByAcId = new Map<string, string[]>();
  const declared = new Map<string, DeclaredAc[]>();
  for (const spec of specs) {
    const acs = declaredAcsOf(spec);
    declared.set(spec.id, acs);
    for (const ac of acs) specsByAcId.set(ac.id, [...(specsByAcId.get(ac.id) ?? []), spec.id]);
  }

  // Latest attested conclusive run per (spec, AC); ambiguous ad-hoc rows are counted and dropped.
  const latest = new Map<string, EvidenceEntry>();
  let ambiguousAcRef = 0;
  const offer = (specId: string, entry: EvidenceEntry): void => {
    const key = `${specId}\u0000${entry.ac_ref}`;
    const current = latest.get(key);
    if (current === undefined || entry.recorded_at >= current.recorded_at) latest.set(key, entry);
  };
  for (const task of tasks) {
    const planId = task.extra["plan_id"];
    const lineageSpecId =
      typeof planId === "string" ? plans.get(planId)?.parent_id ?? null : null;
    const hasLineage = typeof planId === "string";
    for (const entry of extractEvidence(task)) {
      if (entry.ac_ref === undefined || !isConclusiveAttested(entry)) continue;
      if (hasLineage) {
        if (lineageSpecId !== null && specById.has(lineageSpecId)) offer(lineageSpecId, entry);
        continue;
      }
      const owners = specsByAcId.get(entry.ac_ref) ?? [];
      if (owners.length > 1) ambiguousAcRef += 1;
      else if (owners.length === 1) offer(owners[0] as string, entry);
    }
  }

  const citing = new Map<string, CitingInput[]>();
  for (const spec of specs) {
    const anchorPaths = anchorPathsOf(spec);
    for (const ac of declared.get(spec.id) ?? []) {
      if (!ac.isScript) continue;
      const run = latest.get(`${spec.id}\u0000${ac.id}`) ?? null;
      for (const ruleId of ac.cites) {
        const input: RuleStateInput = {
          spec: spec.slug,
          ac_id: ac.id,
          evidence_recorded_at: run?.recorded_at ?? null,
          evidence_result: run === null ? null : (run.result as "pass" | "fail"),
          head_sha: run?.attestation?.head_sha ?? null,
          anchor_paths: anchorPaths,
        };
        citing.set(ruleId, [...(citing.get(ruleId) ?? []), { specId: spec.id, input, run }]);
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

type PassVerdict = { kind: "verified" } | { kind: "stale" } | { kind: "unknown"; reason: UnknownReason };

/** Memoised, budget-respecting view over the GitPort for ONE `full()` call. */
class GitEvaluator {
  private head: Result<string, LoreError> | undefined;
  private readonly ancestor = new Map<string, Result<boolean, LoreError>>();
  private readonly changed = new Map<string, Result<boolean, LoreError>>();

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
    return changed.value ? { kind: "stale" } : { kind: "verified" };
  }
}

/** Verdict of one passing input before any git call: unknown for an unrecorded / dirty run. */
function preGitUnknown(run: EvidenceEntry): UnknownReason | null {
  const att = run.attestation;
  if (att?.head_sha === undefined || att.worktree_dirty === undefined) return "no-commit-recorded";
  if (att.worktree_dirty) return "dirty";
  return null;
}

function decideRule(rule: RuleModel, git: GitEvaluator): { state: RuleVerification; reason?: UnknownReason } {
  let stale = false;
  let verified = false;
  let unknownReason: UnknownReason | undefined;
  for (const { run, input } of rule.inputs) {
    if (run === null) continue;
    if (run.result === "fail") return { state: "contradicted" };
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
    if (v.kind === "stale") stale = true;
    else if (v.kind === "verified") verified = true;
    else unknownReason ??= v.reason;
  }
  if (stale) return { state: "stale" };
  if (verified) return { state: "verified" };
  if (unknownReason !== undefined) return { state: "unknown", reason: unknownReason };
  return { state: "unverified" };
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
          message: `rule '${opts.rule}' is not held by any live baseline leaf`,
          value: opts.rule,
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
    return ok(buildSnapshot(all));
  }
}
