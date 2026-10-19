/**
 * edit-scope.ts — decides, BEFORE a helper edits a file, whether the file is inside the scope its claimed task
 * declares, and declares it (one corpus write) when it is outside but free.
 *
 * Purpose: `lore anchor scope` (the claims a working copy holds, with anchors) and `lore anchor declare` (add one
 * out-of-anchor path to a claimed task unless another live claim holds it) — the two verbs the shipped
 * PreToolUse hook `pre-edit-anchor-gate.mjs` calls.
 *
 * Public surface: {@link readEditScope}, {@link declareEditPath}, {@link EditScopeDeps}, the verdict types.
 * Side-effect class: IO through injected ports only (claims read, task reads, one anchor write, one git probe).
 *
 * @invariant The overlap test is `findAnchorOverlapConflict`, the SAME function the task-claim gate runs
 *   (`noAnchorOverlap` calls it); this module never restates the rule. The candidate is the claim's own holder
 *   (its `by`, `harness_run`, `session_id`), so the verdict answers "could THIS claim hold this path", not "who is
 *   asking". Siblings are every OTHER task holding a claim, in any plan (the claim gate sees only one plan's
 *   siblings; an edit-time declare must not miss a holder in another plan).
 * @invariant Every undecidable input is a `denied` verdict or an error, never a permit (fail-closed).
 * @invariant The anchor write is `TaskWorkflowService.addAnchors`, the normal corpus write route: one version row
 *   and one audit row, attributed to the caller.
 * @invariant Race: two helpers declaring one free path at the same instant can both pass the scan; the second
 *   write is then a plain anchor overlap that the next declare or the claim gate reports. The window is one
 *   store read-modify-write; closing it would need a cross-task lock this module does not own.
 */

import { posix, relative, resolve, sep } from "node:path";
import {
  anchorsOverlap,
  extractFileAnchors,
  extractHeldClaim,
  ok,
  type DocRecord,
  type LoreError,
  type Result,
} from "@lore/core";
import { findAnchorOverlapConflict, type AnchorOverlapConflict } from "./gate-predicates.js";
import type { IgnoreProbeFn } from "./helper-scope-review.js";
import type { OpenClaimsOfWorkingCopy } from "./run-service.js";
import type { buildAnchorGateContext } from "./checkpoint-registry.js";

/** One open claim of a working copy, as `lore anchor scope --json` prints it. */
export interface EditScopeClaim {
  readonly task: string;
  readonly anchors: readonly string[];
  /** The holding run (`harness_run`); `null` = the claim carries no attested run. */
  readonly holder_run: string | null;
}

/** The `data` of `lore anchor scope --json`. */
export interface EditScopeReport {
  readonly working_copy: string;
  readonly claims: readonly EditScopeClaim[];
  /** Claims whose worktree could not be resolved; the hook denies on a non-empty list rather than guess. */
  readonly not_measured: readonly string[];
}

/** Ports `declareEditPath` / `readEditScope` need; `anchor.ts` wires them from the App. */
export interface EditScopeDeps {
  openClaimsOfWorkingCopy(workingCopy: string): Promise<Result<OpenClaimsOfWorkingCopy, LoreError>>;
  getTask(slug: string): Promise<Result<DocRecord, LoreError>>;
  /** Every task document (the sibling universe). */
  listTasks(): Promise<Result<DocRecord[], LoreError>>;
  /** `TaskWorkflowService.buildAnchorGateContext`: held siblings with run-aware staleness. */
  buildSiblingContext(
    by: string,
    candidate: DocRecord,
    siblings: readonly DocRecord[],
    nowIso: string,
    candidateSessionId?: string,
  ): Promise<Result<ReturnType<typeof buildAnchorGateContext>, LoreError>>;
  addAnchors(slug: string, anchors: string[], opts: { by: string; source?: string }): Promise<Result<DocRecord, LoreError>>;
  ignoreProbe: IgnoreProbeFn;
  /** `realpath` of an existing path; throws ENOENT otherwise. */
  realpath(path: string): string;
  now(): string;
  /** True when `<workingCopy>/.lore-scope.json` exists. */
  hasScopeFile(workingCopy: string): boolean;
  /** Atomically writes `<workingCopy>/.lore-scope.json`, first making sure git ignores it there. Throws on failure. */
  writeScopeFile(workingCopy: string, text: string): void;
  /** Deletes `<workingCopy>/.lore-scope.json` (absent is fine). Throws on failure. */
  removeScopeFile(workingCopy: string): void;
}

/** The scope file the hook reads in the claiming worktree: `{schema, working_copy, claims, not_measured}`. */
export const SCOPE_FILE_NAME = ".lore-scope.json";
/** Version of the scope file's JSON shape; the hook falls back to the lore read for any other value. */
export const SCOPE_FILE_SCHEMA = 1;

/** Why a declare was refused. */
export type EditScopeDenialReason =
  | "no-claim"
  | "claim-not-in-working-copy"
  | "outside-working-copy"
  | "held-by-other-claim"
  | "ignore-status-not-measured"
  | "claim-unreadable";

/** The verdict of {@link declareEditPath}. `declared` wrote one anchor; the others wrote nothing. */
export type EditScopeVerdict =
  | { readonly kind: "covered"; readonly task: string; readonly path: string }
  | { readonly kind: "ignored"; readonly path: string }
  | { readonly kind: "declared"; readonly task: string; readonly path: string; readonly version: number }
  | {
      readonly kind: "denied";
      readonly reason: EditScopeDenialReason;
      readonly path: string;
      readonly message: string;
      /** Present for `held-by-other-claim`: the claim in the way. */
      readonly holder?: { readonly task: string; readonly by: string; readonly run: string | null; readonly paths: readonly string[] };
    };

/**
 * Canonical path: symlinks resolved on the deepest existing ancestor, the not-yet-existing tail appended.
 * (A `/var` vs `/private/var` spelling must compare equal to the working copy.)
 */
function canonicalize(path: string, realpath: (p: string) => string): string {
  const absolute = resolve(path);
  let probe = absolute;
  const tail: string[] = [];
  for (;;) {
    try {
      return [realpath(probe), ...tail.reverse()].join(sep).replace(/\/\/+/g, "/");
    } catch {
      const parent = resolve(probe, "..");
      if (parent === probe) return absolute;
      tail.push(probe.slice(parent.length).replace(/^\/+/, ""));
      probe = parent;
    }
  }
}

/** The working-copy-relative POSIX path of `target`, or `undefined` when it is not inside `workingCopy`. */
function relativeInside(workingCopy: string, target: string, realpath: (p: string) => string): string | undefined {
  const root = canonicalize(workingCopy, realpath);
  const abs = canonicalize(resolve(root, target), realpath);
  if (abs === root || !abs.startsWith(root + sep)) return undefined;
  return relative(root, abs).split(sep).join(posix.sep);
}

/**
 * Judges one `git check-ignore --stdin -z -v --non-matching` run for one asked path.
 * @returns `true` ignored, `false` not ignored, `string` the reason it could not be measured.
 */
function judgeIgnore(path: string, run: ReturnType<IgnoreProbeFn>): boolean | string {
  if (run.error !== undefined) return `git check-ignore could not run: ${run.error}`;
  if (run.status !== 0 && run.status !== 1) return `git check-ignore exited ${String(run.status)}`;
  const fields = run.stdout.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (fields.length !== 4) return `git check-ignore answered ${fields.length / 4} records for 1 path`;
  const [source, , pattern, answered] = fields;
  if (answered !== path) return `git check-ignore answered ${String(answered)} where ${path} was asked`;
  // reason: a `!pattern` record is a negation — the path is NOT ignored (same reading as helper-scope-review).
  return source !== "" && !(pattern ?? "").startsWith("!");
}

/**
 * The open claims of `workingCopy`, each with its CURRENT anchors and holder run.
 *
 * @param deps - Ports.
 * @param workingCopy - Absolute working-copy directory.
 * @returns ok(report); the port's error when a claim cannot be read.
 */
export async function readEditScope(deps: EditScopeDeps, workingCopy: string): Promise<Result<EditScopeReport, LoreError>> {
  const open = await deps.openClaimsOfWorkingCopy(workingCopy);
  if (!open.ok) return open;
  const claims: EditScopeClaim[] = [];
  for (const claimed of open.value.tasks) {
    const doc = await deps.getTask(claimed.slug);
    if (!doc.ok) return doc;
    const held = extractHeldClaim(doc.value);
    claims.push({ task: claimed.slug, anchors: [...extractFileAnchors(doc.value)], holder_run: held?.harness_run ?? null });
  }
  return ok({ working_copy: workingCopy, claims, not_measured: open.value.not_measured });
}

/**
 * Rewrites the scope file of each of `workingCopies` that either already has one or holds an open claim of `task`.
 *
 * Why those two: a claim creates the file (the copy now holds `task`); an anchor change, a declare, a release
 * refresh a file that exists. A copy that has neither is not this task's. Per copy, a failure to read the claims
 * or write the file deletes the file (a stale file would wrongly allow a removed path) and is reported, never
 * swallowed: the hook then falls back to the `lore anchor scope` read, which is correct, only slower.
 *
 * @returns One line per copy whose file could not be refreshed (empty = every file is current).
 */
export async function refreshScopeFiles(deps: EditScopeDeps, task: string, workingCopies: readonly string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const workingCopy of new Set(workingCopies)) {
    try {
      const scope = await readEditScope(deps, workingCopy);
      if (!scope.ok) throw new Error(`${scope.error.code}: ${"message" in scope.error ? String(scope.error.message) : ""}`);
      if (!deps.hasScopeFile(workingCopy) && !scope.value.claims.some((c) => c.task === task)) continue;
      // reason: the file is lore's derived state; with no open claim left (and none unmeasured) it describes nothing,
      // and a leftover copy would be unknown ignored data that keeps a finished worktree alive at `lore done`.
      if (scope.value.claims.length === 0 && scope.value.not_measured.length === 0) {
        deps.removeScopeFile(workingCopy);
        continue;
      }
      deps.writeScopeFile(workingCopy, JSON.stringify({ schema: SCOPE_FILE_SCHEMA, ...scope.value }, null, 2) + "\n");
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      try {
        deps.removeScopeFile(workingCopy);
        problems.push(`scope file of ${workingCopy} not refreshed (${reason}); removed it, the hook reads claims through lore instead`);
      } catch (removeCause) {
        problems.push(`scope file of ${workingCopy} not refreshed (${reason}) AND could not be removed (${removeCause instanceof Error ? removeCause.message : String(removeCause)}); it may be stale`);
      }
    }
  }
  return problems;
}

/** Input of {@link declareEditPath}. */
export interface DeclareEditPathInput {
  readonly workingCopy: string;
  readonly task: string;
  /** Absolute, or relative to the working copy. */
  readonly path: string;
  /** The caller's actor — recorded on the version and audit rows of the anchor write. */
  readonly by: string;
  readonly source?: string;
}

/**
 * Declares `path` as an anchor of `task` when it is free, or says why not.
 *
 * Order: inside the working copy -> the task is an open claim of it -> already covered -> git-ignored ->
 * overlap against every other live claim (`findAnchorOverlapConflict`) -> one `addAnchors` write.
 *
 * @returns ok(verdict) for every decided outcome (a refusal is a `denied` verdict); err for a store or port
 *   failure, which the caller must treat as a refusal too.
 * @example
 * // free path -> { kind: "declared", task: "t-a", path: "src/x.ts", version: 7 }
 * // path in another live claim -> { kind: "denied", reason: "held-by-other-claim", holder: { task: "t-b", ... } }
 */
export async function declareEditPath(deps: EditScopeDeps, input: DeclareEditPathInput): Promise<Result<EditScopeVerdict, LoreError>> {
  const rel = relativeInside(input.workingCopy, input.path, (p) => deps.realpath(p));
  if (rel === undefined) {
    return ok({
      kind: "denied",
      reason: "outside-working-copy",
      path: input.path,
      message: `${input.path} is not inside the working copy ${input.workingCopy}; an anchor names a repository path.`,
    });
  }
  const scope = await readEditScope(deps, input.workingCopy);
  if (!scope.ok) return scope;
  const own = scope.value.claims.find((c) => c.task === input.task);
  if (own === undefined) {
    const held = scope.value.claims.map((c) => c.task);
    return ok({
      kind: "denied",
      reason: held.length === 0 ? "no-claim" : "claim-not-in-working-copy",
      path: rel,
      message:
        held.length === 0
          ? `no open claim records the working copy ${input.workingCopy}; run \`lore claim <task> --worktree <branch>\` first.`
          : `task ${input.task} is not an open claim of ${input.workingCopy} (open here: ${held.join(", ")}).`,
    });
  }
  if (anchorsOverlap([rel], [...own.anchors]).overlaps) return ok({ kind: "covered", task: input.task, path: rel });

  const ignored = judgeIgnore(rel, deps.ignoreProbe(input.workingCopy, [rel]));
  if (typeof ignored === "string") {
    return ok({ kind: "denied", reason: "ignore-status-not-measured", path: rel, message: `cannot tell whether ${rel} is git-ignored: ${ignored}` });
  }
  if (ignored) return ok({ kind: "ignored", path: rel });

  const taskDoc = await deps.getTask(input.task);
  if (!taskDoc.ok) return taskDoc;
  const holder = extractHeldClaim(taskDoc.value);
  if (holder === undefined) {
    return ok({ kind: "denied", reason: "claim-unreadable", path: rel, message: `task ${input.task} carries no readable open claim.` });
  }
  const all = await deps.listTasks();
  if (!all.ok) return all;
  // reason: the candidate carries ONLY the new path, so a sibling's overlap with the task's EXISTING anchors (already
  // vetted at claim time) is not re-reported as this declare's conflict.
  const candidate: DocRecord = { ...taskDoc.value, extra: { ...taskDoc.value.extra, file_anchors: [rel] } };
  const context = await deps.buildSiblingContext(holder.by, candidate, all.value, deps.now(), holder.session_id);
  if (!context.ok) return context;
  const conflict: AnchorOverlapConflict | undefined = findAnchorOverlapConflict(
    holder.by,
    [rel],
    context.value.siblingClaims,
    holder.session_id,
    holder.harness_run ?? null,
  );
  if (conflict !== undefined) {
    const { sibling } = conflict;
    const run = sibling.harness_run ?? null;
    return ok({
      kind: "denied",
      reason: "held-by-other-claim",
      path: rel,
      message:
        `${rel} is held by the live claim of task ${sibling.slug} (holder ${sibling.by}${run === null ? "" : `, run ${run}`}; ` +
        `overlap ${conflict.pairs.map(([a, b]) => `${a} x ${b}`).join(", ")}). Do not edit it; report BLOCKED naming that task.`,
      holder: { task: sibling.slug, by: sibling.by, run, paths: sibling.anchors },
    });
  }

  const written = await deps.addAnchors(input.task, [rel], { by: input.by, ...(input.source !== undefined ? { source: input.source } : {}) });
  if (!written.ok) return written;
  return ok({ kind: "declared", task: input.task, path: rel, version: written.value.version });
}

