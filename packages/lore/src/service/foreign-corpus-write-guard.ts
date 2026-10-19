/**
 * ForeignCorpusWriteGuard — the service-layer predicate that refuses a corpus
 * write reached via the §M4 git-common-dir fallback (a nested/linked
 * worktree writing into its MAIN checkout's `.lore/`) unless intent to write
 * there was DECLARED — and intent is a LEASE FACT, never an argv flag re-read
 * on every call.
 *
 * Root cause this closes: `resolveCorpus()` (`adapters/cli/corpus-
 * resolution.ts`) can silently resolve a corpus OUTSIDE the caller's own
 * working tree (`provenance: "git_common_dir"`) — legitimate for the
 * worktree-dispatch protocol (`lore claim`/`evidence`/`release` from a fresh
 * `git worktree add` tree, which never materializes its own `.lore/`), but
 * measured to ALSO silently accept an accidental `lore create knowledge`
 * from the same location, polluting the parent corpus with zero signal that
 * a boundary was crossed. This module is the decision + wiring half of the
 * fix; `resolveCorpus`/`resolveCorpusProvenance` (already landed) are the
 * fact-gathering half.
 *
 * Public surface:
 *   - FOREIGN_CORPUS_WRITE_TOKEN — the exact literal every refusal's `field`
 *     AND `message` carry (`gate:corpus-write:foreign-provenance`), pinned
 *     once here so CLI stderr and AC-CP-5's MCP equality assertion read the
 *     SAME string.
 *   - ForeignCorpusWriteContext — the two AMBIENT facts (per-process for CLI,
 *     per-call for a future MCP wiring) a caller resolves ONCE and threads
 *     through: which route the corpus was reached by, and whether the guard
 *     is even enabled.
 *   - checkForeignCorpusWrite(context, intentDeclared) — the PURE decision.
 *     No IO, no doc lookups, no config reads — every fact arrives as a
 *     parameter, mirroring `resolveCorpusProvenance`'s own "decision vs
 *     fact-gathering" split.
 *   - foreignCorpusWriteRefusalError(verdict) — translates a refused verdict
 *     into the `LoreError` shape every CorpusService write method already
 *     returns (`VALIDATION_ERROR`, CLI exit code 4 via the existing
 *     `utils.ts::exitCode` mapping — no new error code).
 *   - checkCorpusScopedWrite(context, scopeAuthorizesTarget) — the PURE decision for a
 *     baseline write (rule/cite/map) from a linked worktree: claim-scoped corpus
 *     authoring (spec-baseline-slice-2 §C8, AC-BLS2-8, issue #39).
 *   - CorpusWriteAuthority — the IO half of that decision: finds the caller's fresh
 *     claim lease carrying `corpus_scope`, resolves the target's branch through the
 *     baseline parent chain, and records the authorization in the audit log.
 *   - guardTaskLifecycleWrites(taskWorkflow, readExistingClaim, context) —
 *     the ONE non-pure piece: wires the SAME predicate into
 *     `TaskWorkflowService.claim`/`.addEvidence`/`.release` from OUTSIDE
 *     that class (see "Why external wrapping" below).
 *
 * Design Decision — declared intent is READ FROM THE LEASE, never argv
 * (spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5).
 * Measured: `--worktree` exists on `lore claim` (`commands/claim.ts:80`) and
 * on NO other lifecycle verb — `evidence`/`release`/`verify`/`done` all lack
 * it. A design that demanded a repeated flag on every foreign write would
 * therefore refuse the dispatch protocol's OWN evidence/release writes —
 * exactly the outcome the spec's own "what this spec must NOT do" section
 * forbids. So: `claim(idOrSlug, opts, now)` declares intent ONLY via
 * `opts.worktree !== undefined` on THAT SAME call (this is the one call
 * where declaring intent as a flag genuinely means something — the flag and
 * the lease-write happen atomically together); every later verb operating on
 * the SAME task reads intent back from `taskClaimSchema.worktree`
 * (`task-workflow.ts:597`), persisted by that claim.
 *
 * Design Decision — a claim REFRESH must keep declaring `--worktree`
 * explicitly; this module does NOT replicate `_claimImpl`'s same-holder
 * carry-forward inheritance (SPEC-042 D2) to infer a refresh's intent from a
 * PRIOR call. Two reasons: (1) inferring "this refresh secretly inherits
 * intent from three calls ago" is exactly the confident GUESS the pure
 * resolver's own "fail-safe, never guess" principle (`corpus-provenance.ts`)
 * rejects for provenance itself — extending that guess to intent would be
 * the same mistake one layer up; (2) this project's own documented dispatch
 * discipline already states `--worktree` is ALWAYS explicit on `lore claim`
 * (root CLAUDE.md, "Implementation Status") — every real dispatch bundle
 * already passes it on every claim call, refresh included, so requiring it
 * again on a refresh costs nothing in the real protocol and closes a
 * silent-inference path a mechanized guard should not open.
 *
 * Design Decision — WHY EXTERNAL WRAPPING for the three TaskWorkflowService
 * verbs, instead of an internal edit to that class (the way `_claimImpl`
 * already calls `this.gateEnforcer.enforce("task-claim", ctx)`). This task's
 * declared file anchors are `foreign-corpus-write-guard.ts` /
 * `corpus-service.ts` / `loader.ts` / this module's own test file —
 * `task-workflow-service.ts` is NOT one of them, and
 * `TaskWorkflowService.claim`/`.addEvidence`/`.release` write DIRECTLY via
 * `this.store.update` (service/CLAUDE.md: "Task/Phase workflow services
 * write extra.claim/extra.verification_evidence/status directly via the
 * store, never through CorpusService.update"), so there is no existing
 * CorpusService seam these three verbs already pass through. `loader.ts` — a
 * file this task DOES own, and the ONE composition point EVERY CLI command
 * passes through (`loadLoreApp()`) — reassigns `claim`/`addEvidence`/
 * `release` on the CONSTRUCTED `TaskWorkflowService` instance to a wrapper
 * that consults this module's pure predicate FIRST, then delegates to the
 * ORIGINAL (captured via `.bind()` before reassignment, so the wrapper can
 * never recurse into itself). This is decoration at the composition root —
 * the same place `loader.ts` already assigns `app.callerSurface` post-
 * construction — not a patch buried in business logic.
 *
 * ⛔ KNOWN RESIDUAL of that choice, disclosed rather than hidden: this
 * wrapping is CLI-ONLY. A caller that reaches `TaskWorkflowService.claim`/
 * `.addEvidence`/`.release` WITHOUT going through `adapters/cli/loader.ts`
 * (an MCP tool call, a direct service test, `PhaseWorkflowService`'s
 * separate claim/evidence/release trio) is NOT gated by this module. MCP's
 * own wiring is AC-CP-5's task, not this one — its `caller_cwd` parameter
 * gives it a genuinely different provenance-supply mechanism, so it cannot
 * simply reuse a CLI-composition-root decoration anyway. `PhaseWorkflowService`
 * and `TaskWorkflowService.verify`/`.done`/`.addAnchors`/`.removeAnchors` are
 * OUT OF SCOPE for this task (untested by AC-CP-3, and each is materially
 * more complex than a same-shaped read-then-decide check) — left ungated
 * rather than gated-and-unverified.
 *
 * ⛔ `createHandoffDoc`/`createUatDoc` (CorpusService's two internal
 * sole-injection-site creation seams, SPEC-041/SPEC-054) are DELIBERATELY
 * EXEMPT from the `_createImpl`-level check this module wires — session
 * continuity (`lore handoff`) and UAT recording (`lore uat record`) are
 * exactly the kind of write an implementer's OWN worktree legitimately needs
 * to make at end-of-session, and NEITHER has any mechanism to declare
 * intent (no task-claim-lease concept applies to a handoff/UAT doc). Gating
 * them would refuse the dispatch protocol's own session-continuity writes —
 * the same class of self-defeating rule the spec's own "what this spec must
 * NOT do" section warns against for provenance itself.
 *
 * Invariants:
 *   - `checkForeignCorpusWrite` is PURE — no IO, no doc lookups, no
 *     `process.env`/`process.cwd()` reads. Every fact is a parameter.
 *   - `provenance: null` (an adapter with no per-call caller directory, e.g.
 *     HTTP's `serve.ts` boot-once composition) is ALWAYS inert — never a
 *     refusal — regardless of `enabled`. Distinguishing "the adapter cannot
 *     know" from "the adapter measured and it's fine" is AC-CP-5's job; this
 *     predicate treats both as "nothing to refuse here."
 *   - `provenance: "undetermined"` is ALSO always inert, by the SAME "never
 *     guess" reasoning `corpus-provenance.ts` uses for the resolver itself:
 *     refusing a write because an UNRELATED git probe merely could not run
 *     (no `git` on PATH, a spawn timeout) would punish ordinary own-corpus
 *     availability for a signal that proves nothing about crossing a
 *     boundary. Only a CONFIRMED `"git_common_dir"` crossing can trigger a
 *     refusal. In the CLI adapter this branch is structurally unreachable in
 *     practice (`findLoreDbPath()` already treats `"undetermined"` as a
 *     total miss and exits 1 before `loader.ts` ever reaches this module's
 *     wiring), but the predicate still defines and tests the case explicitly
 *     rather than leaving it to fall through unexamined.
 *
 * Side-effect class: `checkForeignCorpusWrite`/`foreignCorpusWriteRefusalError`
 *   are pure. `guardTaskLifecycleWrites` performs ONE mutation (reassigning
 *   three properties on the `taskWorkflow` object passed to it) and its
 *   returned wrapper functions perform IO (the injected `readExistingClaim`
 *   port, and whatever the delegated original methods do).
 *
 * Source: spec-corpus-resolution-carries-provenance-and-a-foreign-write §D5,
 * AC-CP-3.
 */

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { err, extractHeldClaim, isClaimStale, ok, type LoreError, type Result } from "@lore/core";
import type { CorpusProvenance } from "@lore/core";
import type { DocRecord, TaskClaim } from "@lore/core";
import type { StoreInterface } from "../store/store-interface.js";
import { bareDocWriter, type DocWritePort } from "./corpus-service.js";
import type { ClaimOpts, EvidenceInput, ReleaseOpts, TaskWorkflowService } from "./task-workflow-service.js";

/**
 * The literal refusal token every refused case's `LoreError.field` AND
 * `LoreError.message` carry — pinned here ONCE (spec §D5's re-baseline log:
 * "fixed once here because AC-CP-5(a) asserts it equal across CLI and MCP").
 * Never paraphrase this string at a call site; import the constant instead.
 */
export const FOREIGN_CORPUS_WRITE_TOKEN = "gate:corpus-write:foreign-provenance";

/**
 * The two facts {@link checkForeignCorpusWrite} needs about the CALLING
 * process/request — resolved ONCE per CLI process (`adapters/cli/loader.ts`,
 * since a CLI invocation's `cwd` and config never change mid-process) or, for
 * a future per-call adapter (MCP's `caller_cwd`), once per call.
 */
export interface ForeignCorpusWriteContext {
  /**
   * Which route the ACTIVE corpus was resolved by
   * (`resolveCorpus()`/`resolveCorpusProvenance`, `@lore/core`) — `null` when
   * the calling adapter has no per-call caller directory at all (HTTP's named
   * exemption, §D5's adapter matrix). `null` is ALWAYS inert, never treated
   * as evidence of anything.
   */
  readonly provenance: CorpusProvenance | null;
  /**
   * `resolveForeignCorpusWriteGateEnabled(config)` (`@lore/core`,
   * `workflow.gates."corpus-write".foreign_corpus_write.enabled`) — resolved
   * by the caller from the SAME project config every other gate reads,
   * never re-derived here.
   */
  readonly enabled: boolean;
}

/**
 * {@link checkForeignCorpusWrite}'s decision — a discriminated union so a
 * refused verdict's `reason` can never be read on an allowed one, or vice
 * versa.
 */
export type ForeignCorpusWriteVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Convenience narrowing for the refused half of {@link ForeignCorpusWriteVerdict}.
 */
export type ForeignCorpusWriteRefusal = Extract<ForeignCorpusWriteVerdict, { allowed: false }>;

/**
 * THE CENTRAL PREDICATE (spec §D5). Decides whether a corpus write may
 * proceed from ALREADY-RESOLVED facts — never reads a filesystem, a doc, or
 * `process.env` itself.
 *
 * Decision table:
 *   1. `!context.enabled` → allowed (the config knob disables this predicate
 *      entirely, `resolveForeignCorpusWriteGateEnabled`'s own default-ON
 *      polarity applies upstream of this function).
 *   2. `context.provenance !== "git_common_dir"` → allowed. Covers THREE
 *      cases uniformly: `"own"` (no crossing happened), `"undetermined"`
 *      (an unresolved crossing question — never treated as evidence of
 *      foreign provenance, see this module's header), and `null` (the
 *      calling adapter has no per-call caller directory at all).
 *   3. `intentDeclared` → allowed (a declared-intent lifecycle write).
 *   4. Otherwise → refused, carrying {@link FOREIGN_CORPUS_WRITE_TOKEN} in
 *      `reason`.
 *
 * @param context - The two ambient facts — see {@link ForeignCorpusWriteContext}.
 * @param intentDeclared - Whether THIS specific write already carries
 *   declared intent — `opts.worktree !== undefined` for a fresh `lore claim`
 *   call, or `readClaimRecord(task)?.worktree !== undefined` for every later
 *   lifecycle verb reading the persisted lease; always `false` for a
 *   non-lifecycle write (`lore create`/`set`/`link`/`unlink`/`delete` — none
 *   of these have any lease to read intent from).
 * @returns `{allowed: true}` or `{allowed: false, reason}` — never throws.
 * @example
 * checkForeignCorpusWrite({ provenance: "git_common_dir", enabled: true }, false);
 *   // => { allowed: false, reason: "gate:corpus-write:foreign-provenance: ..." }
 * @example
 * checkForeignCorpusWrite({ provenance: "git_common_dir", enabled: true }, true);
 *   // => { allowed: true }
 * @example
 * checkForeignCorpusWrite({ provenance: "undetermined", enabled: true }, false);
 *   // => { allowed: true } — never guess that an unresolved crossing is foreign
 * @example
 * checkForeignCorpusWrite({ provenance: "git_common_dir", enabled: false }, false);
 *   // => { allowed: true } — the config knob disables the predicate
 */
export function checkForeignCorpusWrite(
  context: ForeignCorpusWriteContext,
  intentDeclared: boolean,
): ForeignCorpusWriteVerdict {
  if (!context.enabled) return { allowed: true };
  if (context.provenance !== "git_common_dir") return { allowed: true };
  if (intentDeclared) return { allowed: true };
  return {
    allowed: false,
    reason:
      `${FOREIGN_CORPUS_WRITE_TOKEN}: this write resolved a corpus OUTSIDE the caller's ` +
      "own working tree (the linked-worktree git-common-dir fallback), and no declared-" +
      "intent claim lease authorizes writing there. Declare intent once with " +
      "'lore claim <task> --worktree <path>' — every later evidence/release call on the " +
      "SAME task then inherits it from the lease. A non-lifecycle write (create/set/link/" +
      "unlink/delete) has no lease to declare intent on and is always refused here.",
  };
}

/**
 * Translates a REFUSED {@link ForeignCorpusWriteVerdict} into the `LoreError`
 * shape every CorpusService/TaskWorkflowService write method already
 * returns — `VALIDATION_ERROR`, mapped to CLI exit code 4 by the existing
 * `adapters/cli/utils.ts::exitCode` table (no new error code, no new exit
 * code — mirrors `GateEnforcer.enforce`'s identical choice for its own
 * checkpoint denials).
 *
 * @param verdict - A verdict with `allowed: false` (call only on that half —
 *   the type parameter statically forbids passing an allowed verdict).
 * @returns A `VALIDATION_ERROR` LoreError whose `field` is EXACTLY
 *   {@link FOREIGN_CORPUS_WRITE_TOKEN} and whose `message` CONTAINS it too
 *   (AC-CP-3 asserts the token in stderr; `formatError`'s VALIDATION_ERROR
 *   branch renders both `field` and `message`).
 * @example
 * foreignCorpusWriteRefusalError({ allowed: false, reason: "gate:corpus-write:foreign-provenance: ..." });
 *   // => { code: "VALIDATION_ERROR", field: "gate:corpus-write:foreign-provenance", message: "..." }
 */
export function foreignCorpusWriteRefusalError(verdict: ForeignCorpusWriteRefusal): LoreError {
  return {
    code: "VALIDATION_ERROR",
    field: FOREIGN_CORPUS_WRITE_TOKEN,
    message: verdict.reason,
  };
}

/**
 * The narrow slice of `TaskWorkflowService`'s public surface
 * {@link guardTaskLifecycleWrites} needs to wrap — a structural `Pick`
 * rather than the whole class, so this module's coupling to
 * `task-workflow-service.ts` stays limited to exactly three method
 * signatures (type-only; zero runtime import of that class).
 */
export type GuardableTaskLifecycle = Pick<TaskWorkflowService, "claim" | "addEvidence" | "release">;

/**
 * {@link guardTaskLifecycleWrites}'s `readExistingClaim` port result — a
 * discriminated union so a doc-lookup FAILURE (task not found, wrong doc
 * type) can never be confused with a doc-lookup SUCCESS that simply found no
 * (or a malformed) claim. This distinction is load-bearing: a lookup
 * failure must fall through to the real `addEvidence`/`release` call so IT
 * surfaces its own, more specific error (e.g. `DOC_NOT_FOUND`) — the guard
 * must never manufacture a foreign-provenance refusal out of its OWN lookup
 * breaking.
 */
export type TaskClaimLookup =
  | { readonly found: true; readonly claim: TaskClaim | undefined }
  | { readonly found: false };

const defaultNowSeam = (): string => new Date().toISOString();

/**
 * Wires {@link checkForeignCorpusWrite} into `claim`/`addEvidence`/`release`
 * on an ALREADY-CONSTRUCTED `TaskWorkflowService` instance — see this
 * module's header ("Why external wrapping") for why this happens here
 * instead of inside that class. Called exactly once, from
 * `adapters/cli/loader.ts`, right after `createApp()` returns.
 *
 * Mutates `taskWorkflow` in place (reassigns its `claim`/`addEvidence`/
 * `release` OWN properties, shadowing the prototype methods) and returns
 * nothing — the SAME "decorate the constructed instance" shape
 * `loader.ts` already uses for `app.callerSurface`.
 *
 * @param taskWorkflow - The instance to wrap (`app.taskWorkflowService`).
 * @param readExistingClaim - Reads the CURRENT persisted claim lease for a
 *   task id-or-slug — see {@link TaskClaimLookup}. A lookup FAILURE
 *   (`{found: false}`) NEVER manufactures a refusal; the wrapper falls
 *   through to the real method, which surfaces its OWN, more specific error
 *   (e.g. `DOC_NOT_FOUND`) instead.
 * @param context - See {@link ForeignCorpusWriteContext}. Resolved ONCE by
 *   the caller (a CLI process's `cwd`/config never change mid-invocation).
 * @example
 * guardTaskLifecycleWrites(
 *   app.taskWorkflowService,
 *   (idOrSlug) => readTaskClaimLease(app, idOrSlug),
 *   { provenance: resolveCorpus(process.cwd())?.provenance ?? null, enabled },
 * );
 */
export function guardTaskLifecycleWrites(
  taskWorkflow: GuardableTaskLifecycle,
  readExistingClaim: (idOrSlug: string) => Promise<TaskClaimLookup>,
  context: ForeignCorpusWriteContext,
): void {
  // reason: captured BEFORE reassignment below, and always invoked via this
  // captured reference (never via `taskWorkflow.claim(...)`) — reassigning
  // `taskWorkflow.claim` a few lines down must never cause the wrapper to
  // recurse into itself.
  const originalClaim = taskWorkflow.claim.bind(taskWorkflow);
  const originalAddEvidence = taskWorkflow.addEvidence.bind(taskWorkflow);
  const originalRelease = taskWorkflow.release.bind(taskWorkflow);

  taskWorkflow.claim = async (
    idOrSlug: string,
    opts: ClaimOpts,
    now: () => string = defaultNowSeam,
  ): Promise<Result<DocRecord, LoreError>> => {
    // reason: intent for THIS call is `opts.worktree !== undefined` — see the
    // module header's "claim REFRESH" design decision for why this does NOT
    // also inspect an EXISTING lease's carried-forward worktree.
    const verdict = checkForeignCorpusWrite(context, opts.worktree !== undefined);
    if (!verdict.allowed) return err(foreignCorpusWriteRefusalError(verdict));
    return originalClaim(idOrSlug, opts, now);
  };

  // reason: shared by addEvidence/release below — both read intent the SAME
  // way (the task's CURRENT persisted claim lease), never from their own
  // argv (neither verb even defines a --worktree flag, per D5).
  const checkLeaseDeclaresIntent = async (idOrSlug: string): Promise<ForeignCorpusWriteVerdict> => {
    // reason: `enabled`/`provenance` pre-check avoids the readExistingClaim
    // IO round-trip when the guard could not possibly refuse anyway —
    // `checkForeignCorpusWrite` still makes the actual ALLOW/REFUSE decision
    // below; this is an IO-avoidance short-circuit, not a second decision.
    if (!context.enabled || context.provenance !== "git_common_dir") return { allowed: true };
    const lookup = await readExistingClaim(idOrSlug);
    // reason: a lookup FAILURE must fall through to the real call rather than
    // being refused here — see this function's own `readExistingClaim` doc.
    if (!lookup.found) return { allowed: true };
    return checkForeignCorpusWrite(context, lookup.claim?.worktree !== undefined);
  };

  taskWorkflow.addEvidence = async (
    idOrSlug: string,
    entry: EvidenceInput,
    now: () => string = defaultNowSeam,
  ): Promise<Result<DocRecord, LoreError>> => {
    const verdict = await checkLeaseDeclaresIntent(idOrSlug);
    if (!verdict.allowed) return err(foreignCorpusWriteRefusalError(verdict));
    return originalAddEvidence(idOrSlug, entry, now);
  };

  taskWorkflow.release = async (
    idOrSlug: string,
    opts: ReleaseOpts,
    now: () => string = defaultNowSeam,
  ): Promise<Result<DocRecord, LoreError>> => {
    const verdict = await checkLeaseDeclaresIntent(idOrSlug);
    if (!verdict.allowed) return err(foreignCorpusWriteRefusalError(verdict));
    return originalRelease(idOrSlug, opts, now);
  };
}

// ─── Claim-scoped corpus authoring (spec-baseline-slice-2 §C8, AC-BLS2-8, #39) ───

/**
 * PURE decision for a BASELINE write (rule / cite / site map) reached from a linked
 * worktree. Same shape as {@link checkForeignCorpusWrite}, but intent is not a boolean
 * on the call: it is the ONE fact the caller measured from the lease —
 * `scopeAuthorizesTarget` is true only when the caller's fresh claim declares a
 * `corpus_scope` that is the target's branch (or an ancestor branch of it).
 *
 * Decision table: disabled / not-a-crossing → allowed (the write is not foreign);
 * otherwise allowed iff `scopeAuthorizesTarget`. An UNSCOPED worktree session is
 * refused — before this existed, rule/cite writes never consulted the guard at all.
 *
 * @example
 * checkCorpusScopedWrite({ provenance: "git_common_dir", enabled: true }, false);
 *   // => { allowed: false, reason: "gate:corpus-write:foreign-provenance: ..." }
 */
export function checkCorpusScopedWrite(
  context: ForeignCorpusWriteContext,
  scopeAuthorizesTarget: boolean,
): ForeignCorpusWriteVerdict {
  if (!context.enabled) return { allowed: true };
  if (context.provenance !== "git_common_dir") return { allowed: true };
  if (scopeAuthorizesTarget) return { allowed: true };
  return {
    allowed: false,
    reason:
      `${FOREIGN_CORPUS_WRITE_TOKEN}: this baseline write resolved a corpus OUTSIDE the caller's ` +
      "own working tree, and no fresh claim lease held from THIS worktree declares a corpus scope " +
      "covering the target's branch. Declare it on the claim: " +
      "'lore claim <task> --worktree <path> --corpus-scope <baseline-branch>' — scope is a lease " +
      "fact, re-declared on every refresh, and covers only that branch's subtree.",
  };
}

/** Maximum baseline parent-chain depth walked — a cycle guard, far above any real tree. */
const MAX_BASELINE_CHAIN_DEPTH = 32;

/**
 * What a successful scoped authorization proves — the claim the write rode on. Every
 * field comes from the lease, never from the write's own arguments.
 */
export interface CorpusScopeGrant {
  readonly task: string;
  readonly by: string;
  readonly worktree: string;
  readonly sessionId?: string;
  readonly scope: string;
}

/** Ambient facts {@link CorpusWriteAuthority} needs — resolved once per process by the composition root. */
export interface CorpusWriteAuthorityContext {
  readonly foreign: ForeignCorpusWriteContext;
  /** The CALLING process's cwd — matched against each lease's `worktree`. */
  readonly callerDir: string;
  /** `workflow.claim_ttl_minutes` — a stale lease authorizes nothing. */
  readonly claimTtlMinutes: number;
}

/** Realpath when the path exists, else the lexically resolved path (a lease may name a removed worktree). */
function canonicalDir(path: string): string {
  const abs = resolve(path);
  try {
    return realpathSync(abs);
  } catch {
    // reason: a lease may legitimately name a worktree that no longer exists; the lexical
    // path then simply fails to contain the caller's real cwd — a refusal, not a guess.
    return abs;
  }
}

/** True when `dir` is `root` or sits beneath it. */
function isWithin(root: string, dir: string): boolean {
  const rel = relative(root, dir);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Authorizes baseline writes from a linked worktree against the caller's claim lease.
 *
 * The lease is looked up by WORKTREE (a fresh `extra.claim` whose `worktree` contains the
 * caller's cwd and whose `corpus_scope` is set), never by actor: the write's actor
 * resolves from `--by`/env/worktree and legitimately differs from the claiming `by`
 * (`ac cite` is typically run without `--by`). The claim's own by/session/worktree is
 * what the audit row carries.
 *
 * @invariant Inert (`ok(undefined)`) unless the context is a confirmed `git_common_dir`
 *   crossing with the gate enabled — own-corpus and main-checkout writes are untouched.
 * @invariant Every target must be a baseline doc whose ancestor-or-self chain contains the
 *   lease's scope branch; one uncovered target refuses the whole write.
 * @invariant On success appends ONE audit entry (`action: "corpus-scope-write"`, no
 *   `version` key so it can never satisfy or disturb `lore audit --verify`'s version join).
 */
export class CorpusWriteAuthority {
  constructor(
    private readonly store: StoreInterface,
    private readonly context: CorpusWriteAuthorityContext,
    // reason: AC-DCL-5 — the authorization row goes through the ONE write route, never a bare store append. The
    // composing service passes its own writer; a bare construction gets a bare one over the same store.
    private readonly writer: DocWritePort = bareDocWriter(store),
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * @param targets - The baseline docs this write mutates (a rule's leaf, both leaves of a move).
   * @param operation - Short verb recorded on the audit entry (`rule-add`, `ac-cite`, `baseline-map`, ...).
   * @param actor - The write's resolved actor (recorded beside the claim's own `by`).
   * @returns `undefined` when the guard is inert (no foreign crossing), the {@link CorpusScopeGrant}
   *   when a fresh scoped lease covers every target, or the foreign-write refusal.
   */
  async authorize(
    targets: readonly DocRecord[],
    operation: string,
    actor: string,
  ): Promise<Result<CorpusScopeGrant | undefined, LoreError>> {
    const decided = await this.decide(targets);
    if (!decided.ok) return decided;
    if (decided.value === undefined) return ok(undefined);
    const grant = { ok: true as const, value: decided.value };

    const first = targets[0];
    // reason: foreign "record" — this row IS the record of the scoped authorization just granted; applying the
    // refusal predicate to it would refuse the record of the very decision that allows the write.
    const audited = await this.writer.appendAudit({
      timestamp: this.now(),
      by: actor,
      sessionId: first?.id ?? grant.value.task,
      action: "corpus-scope-write",
      foreign: "record",
      ...(first !== undefined ? { docId: first.id } : {}),
      details: {
        operation,
        targets: targets.map((t) => t.slug),
        claim_task: grant.value.task,
        claim_by: grant.value.by,
        claim_worktree: grant.value.worktree,
        ...(grant.value.sessionId !== undefined ? { claim_session_id: grant.value.sessionId } : {}),
        corpus_scope: grant.value.scope,
      },
    });
    if (!audited.ok) return audited;
    return ok(grant.value);
  }

  /**
   * THE decision: may a write to `targets` proceed from this process? Inert (`ok(undefined)`) outside a foreign
   * crossing; otherwise the fresh scoped lease covering every target as a {@link CorpusScopeGrant}, or the
   * foreign-write refusal. Writes NOTHING — {@link authorize} adds the audit row, and the write route
   * (`CorpusService`) calls this directly, so the authorization report and the write it reports on read the SAME
   * decision and cannot disagree.
   */
  async decide(targets: readonly DocRecord[]): Promise<Result<CorpusScopeGrant | undefined, LoreError>> {
    // reason: inert short-circuit through the shared predicate — never re-derive the table here.
    if (checkForeignCorpusWrite(this.context.foreign, false).allowed) return ok(undefined);

    const grant = await this.findCoveringGrant(targets);
    if (!grant.ok) return grant;
    const verdict = checkCorpusScopedWrite(this.context.foreign, grant.value !== undefined);
    if (!verdict.allowed) return err(foreignCorpusWriteRefusalError(verdict));
    return ok(grant.value);
  }

  /** First fresh scoped lease from this worktree whose scope branch covers EVERY target. */
  private async findCoveringGrant(
    targets: readonly DocRecord[],
  ): Promise<Result<CorpusScopeGrant | undefined, LoreError>> {
    if (targets.length === 0) return ok(undefined);
    const chains: Array<Set<string>> = [];
    for (const target of targets) {
      const chain = await this.baselineChain(target);
      if (!chain.ok) return chain;
      chains.push(chain.value);
    }
    if (chains.some((c) => c.size === 0)) return ok(undefined); // a non-baseline target is never in scope

    const tasks = await this.store.findMany({ type: "task" });
    if (!tasks.ok) return tasks;
    const callerDir = canonicalDir(this.context.callerDir);
    const nowIso = this.now();
    for (const task of tasks.value) {
      const claim = extractHeldClaim(task);
      if (claim?.corpus_scope === undefined || claim.worktree === undefined) continue;
      if (isClaimStale(claim, nowIso, this.context.claimTtlMinutes)) continue;
      if (!isWithin(canonicalDir(claim.worktree), callerDir)) continue;
      const scope = claim.corpus_scope;
      if (chains.every((c) => c.has(scope))) return ok(grantOf(task, claim, scope));
    }
    return ok(undefined);
  }

  /**
   * The ids AND slugs of `doc` and every baseline ancestor (leaf, branch, root), so a lease
   * naming either spelling matches. Empty set for a non-baseline doc.
   */
  private async baselineChain(doc: DocRecord): Promise<Result<Set<string>, LoreError>> {
    const names = new Set<string>();
    if (doc.type !== "baseline") return ok(names);
    let cursor: DocRecord | null = doc;
    for (let depth = 0; cursor !== null && depth < MAX_BASELINE_CHAIN_DEPTH; depth += 1) {
      if (cursor.type !== "baseline") break;
      names.add(cursor.id);
      names.add(cursor.slug);
      if (cursor.parent_id === null) break;
      const parent = await this.store.find(cursor.parent_id);
      if (!parent.ok) return parent;
      cursor = parent.value;
    }
    return ok(names);
  }
}

function grantOf(task: DocRecord, claim: TaskClaim, scope: string): CorpusScopeGrant {
  return {
    task: task.slug,
    by: claim.by,
    worktree: claim.worktree ?? "",
    ...(claim.session_id !== undefined ? { sessionId: claim.session_id } : {}),
    scope,
  };
}
