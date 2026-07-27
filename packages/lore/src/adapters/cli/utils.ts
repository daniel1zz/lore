/**
 * Shared CLI utilities — error formatting and output helpers.
 * No business logic here; only terminal I/O concerns.
 *
 * Public surface:
 *   - exitCode() / formatError() — error presentation
 *   - formatTable() / formatTree() / formatNavigation() / relativeTime() — output helpers
 *
 * Note: DB discovery and App construction live in `loader.ts` to avoid
 * importing bun:sqlite into this module (vitest cannot resolve bun:sqlite).
 * CLI commands that need an App instance should import from `loader.ts`.
 *
 * Side-effect class: pure (no IO, no process.exit)
 *
 * Source: SPEC-003 §5
 */

import { existsSync } from "fs";
import { join, dirname, resolve as resolvePath } from "path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import {
  evidenceEntrySchema,
  taskClaimSchema,
  isClaimStale,
  isInvalidated,
} from "@lore/core";
import { resolveActorWithSource } from "@lore/core/node";
import type { DocRecord, LoreError, ReviewJudgment, ValidityCarrier } from "@lore/core";
import type { TreeNode } from "../../service/corpus-service.js";
import type { DocWithNavigation } from "../../service/corpus-service.js";

const evidenceArraySchema = z.array(evidenceEntrySchema);

// ─── DB Discovery (used only by loader.ts) ──────────────────────────────────

/**
 * Resolves the MAIN checkout's `.lore/lore.db` when `dir` sits inside a
 * LINKED git worktree (SPEC M4 —
 * spec-workflow-hardening-evidence-red-vocabulary-claim-worktree §M4,
 * AC-WH-4). A fresh `git worktree add` tree never materializes `.lore/`
 * (gitignored, untracked, never checked out into a linked worktree) — the
 * primary walk-up in {@link findLoreDbPath} / `findLoreDbPathQuiet`
 * (`gate-bypass-audit.ts`) always misses there. This is the fallback of
 * last resort, consulted ONLY after that walk-up already failed.
 *
 * Shells `git rev-parse --git-common-dir` and `--git-dir` from `dir` — in a
 * linked worktree these differ (`--git-common-dir` points at the MAIN repo's
 * shared `.git`, `--git-dir` at this worktree's own
 * `.git/worktrees/<name>`); in a primary checkout (or a non-worktree repo)
 * they resolve to the SAME path, so no fallback root exists distinct from
 * the one the primary walk-up already tried. Mirrors the identical
 * git-common-dir-vs-git-dir differencing fact
 * `commands/verify.ts#gatherVerifyGitFacts` gathers for SPEC-063's execution-
 * root resolution — same two-command probe, different consumer.
 *
 * ANY probe failure (not a git repo, `git` missing, nonzero exit, empty/
 * whitespace-only stdout, a thrown `spawnSync` error) degrades to
 * `undefined` — this function never throws, so callers can treat "no
 * fallback available" identically to "not a linked worktree at all".
 *
 * @param dir - Directory the primary walk-up already failed to resolve
 *   `.lore/lore.db` from (`process.cwd()` in production).
 * @returns The main checkout's `.lore/lore.db` absolute path, when that
 *   checkout's `.lore/` directory actually contains one; otherwise `undefined`.
 */
export function findMainCheckoutLoreDb(dir: string): string | undefined {
  try {
    const commonDirRaw = spawnSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 5000,
    });
    const gitDirRaw = spawnSync("git", ["rev-parse", "--git-dir"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 5000,
    });
    if (
      commonDirRaw.status !== 0 ||
      gitDirRaw.status !== 0 ||
      !commonDirRaw.stdout?.trim() ||
      !gitDirRaw.stdout?.trim()
    ) {
      return undefined;
    }

    const commonDirAbs = resolvePath(dir, commonDirRaw.stdout.trim());
    const gitDirAbs = resolvePath(dir, gitDirRaw.stdout.trim());
    if (commonDirAbs === gitDirAbs) {
      // Primary checkout (or a non-worktree repo) — not a linked worktree,
      // no distinct fallback root to try.
      return undefined;
    }

    // Linked worktree confirmed: commonDirAbs is the MAIN repo's shared
    // `.git` directory — its parent is the main checkout root.
    const mainCheckoutRoot = dirname(commonDirAbs);
    const candidate = join(mainCheckoutRoot, ".lore", "lore.db");
    return existsSync(candidate) ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Walk up from cwd looking for .lore/lore.db. When that walk-up misses AND
 * cwd is inside a linked git worktree, falls back to the MAIN checkout's
 * `.lore/lore.db` via {@link findMainCheckoutLoreDb} (SPEC M4, AC-WH-4) —
 * still absent there too → the existing loud failure, unchanged.
 * Exits with code 1 if not found (suggests `lore init`).
 *
 * @returns absolute path to the lore.db file
 */
export function findLoreDbPath(): string {
  const startDir = process.cwd();
  let dir = startDir;

  // Walk up to filesystem root
  while (true) {
    const candidate = join(dir, ".lore", "lore.db");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached root
    dir = parent;
  }

  const mainCheckoutDb = findMainCheckoutLoreDb(startDir);
  if (mainCheckoutDb !== undefined) {
    return mainCheckoutDb;
  }

  process.stderr.write(
    "Error: No Lore database found in this directory or any parent.\n" +
    "  Run `lore init` to initialise a new Lore project here.\n",
  );
  process.exit(1);
}

// ─── Error Formatting ───────────────────────────────────────────────────────

/**
 * Map a LoreError code to a CLI exit code per SPEC-003 §5.
 *
 * @param error - LoreError from a service call
 * @returns numeric exit code (1 | 3 | 4 | 5 | 6 | 7)
 */
export function exitCode(error: LoreError): number {
  switch (error.code) {
    case "DOC_NOT_FOUND":
    case "SLUG_NOT_FOUND":
      return 3;
    case "VALIDATION_ERROR":
    case "SCHEMA_VIOLATION":
    case "LINK_CYCLE":
    case "DUPLICATE_SLUG":
    case "DUPLICATE_LINK":
    case "DELETE_REQUIRES_CONFIRM":
    case "INVALID_TRANSITION":
    case "PARENT_REQUIRED":
    case "INVALID_PARENT_TYPE":
      return 4;
    case "STALE_VERSION":
    // reason: CLAIM_CONFLICT is a write-contention error like STALE_VERSION — both mean
    // "someone else won the race, re-read and retry" — mapped to the same exit code.
    // Source: SPEC-025 §4 AC-WF-3
    case "CLAIM_CONFLICT":
      return 5;
    case "AI_PROVIDER_ERROR":
      // reason: exit 6 reserved for AI provider failures — distinct from generic store/validation
      // errors so callers can detect AI-specific failures without parsing stderr (SPEC-017 §3.4)
      return 6;
    case "NEEDS_APPROVAL":
      // reason: exit 7 reserved for the SPEC-039 M2 command-provenance approval gate —
      // distinct from validation (4) and AI (6) errors so a CI wrapper can detect
      // "a verify command needs review" without parsing stderr.
      return 7;
    case "STORE_ERROR":
      return 1;
    default: {
      // exhaustive check — TypeScript should warn if a code is missing
      const _exhaustive: never = error;
      void _exhaustive;
      return 1;
    }
  }
}

/**
 * Human-readable error message with contextual suggestions.
 *
 * @param error - LoreError from a service call
 * @param opts.aiHasNoFallback - Pass `true` from a caller whose command has NO non-AI mode
 *   (currently only `lore assess`, SPEC-026 §3 D5). When set, an AI_PROVIDER_ERROR renders
 *   assess-specific recovery guidance instead of the default "Retry with --no-ai" hint —
 *   suggesting `--no-ai` to a command that always exits 2 on it is actively misleading
 *   (SPEC-029 AC-AR-5). Every other caller (create/set/link) DOES have a non-AI editor
 *   fallback, so they omit this option and keep the original hint.
 * @returns formatted string for stderr output
 */
export function formatError(error: LoreError, opts?: { aiHasNoFallback?: boolean }): string {
  switch (error.code) {
    case "DOC_NOT_FOUND": {
      const lines = [`Error: Document not found: ${error.id}`];
      if (error.suggestions && error.suggestions.length > 0) {
        lines.push(`  Suggestion: Did you mean one of: ${error.suggestions.join(", ")}?`);
      }
      lines.push("  Run `lore list` to see available documents.");
      return lines.join("\n");
    }
    case "SLUG_NOT_FOUND": {
      const lines = [`Error: Slug not found: ${error.slug}`];
      if (error.suggestions && error.suggestions.length > 0) {
        lines.push(`  Suggestion: Did you mean one of: ${error.suggestions.join(", ")}?`);
      }
      return lines.join("\n");
    }
    case "STALE_VERSION":
      return (
        `Error: Version conflict for ${error.id}.\n` +
        `  Expected version ${error.expected} but current is ${error.actual}.\n` +
        `  Run \`lore get ${error.id}\` to see the latest version.`
      );
    case "VALIDATION_ERROR":
      return `Error: Validation failed on field '${error.field}': ${error.message}`;
    case "SCHEMA_VIOLATION":
      return (
        `Error: Schema violation for type '${error.type}'.\n` +
        `  Missing required fields: ${error.missing.join(", ")}` +
        (error.extra && error.extra.length > 0
          ? `\n  Unknown fields: ${error.extra.join(", ")}`
          : "")
      );
    case "LINK_CYCLE":
      return `Error: Link would create a cycle: ${error.path.join(" → ")}`;
    case "DUPLICATE_SLUG":
      return (
        `Error: Slug '${error.slug}' already exists (used by ${error.existing_id}).\n` +
        "  Use a different title or pass a unique slug."
      );
    case "DUPLICATE_LINK":
      return `Error: Link ${error.from} → ${error.to} (${error.type}) already exists.`;
    case "DELETE_REQUIRES_CONFIRM":
      return (
        `Error: Deletion requires confirmation.\n` +
        `  Run: lore delete ${error.id} --confirm`
      );
    case "INVALID_TRANSITION":
      return (
        `Error: Cannot transition from '${error.from}' to '${error.to}'.\n` +
        `  Allowed transitions from '${error.from}': ${error.allowed.join(", ")}`
      );
    case "PARENT_REQUIRED":
      return (
        `Error: Documents of type '${error.type}' require a parent.\n` +
        "  Pass --parent <id-or-slug> to specify the parent document."
      );
    case "INVALID_PARENT_TYPE":
      return (
        `Error: Invalid parent type for '${error.child}'.\n` +
        `  Parent type '${error.parent}' is not allowed. Allowed parent types: ${error.allowed.join(", ")}`
      );
    case "AI_PROVIDER_ERROR": {
      // Multi-line format per SPEC-017 §3.4: provider name, exit code, stderr excerpt, retry hint
      const lines = [
        `Error: AI provider${error.provider ? ` "${error.provider}"` : ""} failed.`,
        `  ${error.message}`,
      ];
      if (error.exit_code !== undefined) {
        lines.push(`  exit code: ${error.exit_code}`);
      }
      if (error.stderr) {
        lines.push(`  stderr: ${error.stderr}`);
      }
      if (opts?.aiHasNoFallback) {
        // reason: assess has no non-AI mode (SPEC-026 §3 D5) — suggesting --no-ai here would
        // send the user straight into another exit-2 contradiction (SPEC-029 AC-AR-5).
        lines.push("  This command has no non-AI fallback. To recover:");
        lines.push("    1. Retry the command — the failure may be transient.");
        lines.push(
          "    2. Check `ai.provider` in .lore/config.yaml and that the configured provider " +
            "(e.g. the `claude` binary) is installed and reachable.",
        );
        lines.push("    3. Inspect the raw AI output above (already included in the message) for clues.");
      } else {
        lines.push("  Retry with --no-ai to use the editor instead.");
      }
      return lines.join("\n");
    }
    case "STORE_ERROR":
      return `Error: Storage failure: ${error.message}`;
    case "CLAIM_CONFLICT":
      return (
        `Error: Task ${error.id} is claimed by '${error.holder}' (claimed ${error.age_minutes}m ago).\n` +
        "  Pass --steal (claim) or --force (release) to override, or wait for the lease to expire."
      );
    case "NEEDS_APPROVAL":
      return (
        `Error: ${error.message}\n` +
        `  AC: ${error.ac_id}\n` +
        `  Command: ${error.command}\n` +
        "  Pass --allow-new-commands to approve automatically, or run interactively (TTY, no --json) to confirm."
      );
    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return "Error: An unexpected error occurred.";
    }
  }
}

// ─── Actor Resolution ───────────────────────────────────────────────────────

/**
 * `resolveActorWithSource` / `ActorSource` / `ResolvedActor` — relocated to
 * `@lore/core/node` verbatim (SPEC-079 G2) so `CorpusService` can apply the
 * IDENTICAL `--by`/`$LORE_ACTOR`/session-tier/OS-username fallback chain
 * without a service reaching backwards into this adapter module. Re-exported
 * here so every pre-existing import of this symbol from
 * `adapters/cli/utils.js` keeps resolving unchanged — see
 * `actor-resolution-node.ts`'s module header for the full precedence
 * contract and rationale.
 */
export type { ActorSource, ResolvedActor } from "@lore/core/node";
export { resolveActorWithSource };

// reason: module-level once-per-process guard (retro `knowledge-session-process-review-2026-07-22-spec-062-064-continu`,
// AC-AUDIT-ACTOR-1) — a batch command (e.g. `lore review --pending`) calling
// resolveActor once per doc must warn exactly once per process, not once per call.
let warnedActorFallback = false;

/**
 * Test-only: reset the once-per-process OS-fallback advisory guard so a test
 * can assert the advisory fires again in a fresh "process" (vitest runs all
 * cases in one real process, so the guard would otherwise leak across tests).
 * Never called from production code.
 */
export function resetActorFallbackWarningForTests(): void {
  warnedActorFallback = false;
}

/**
 * Resolve the acting user identity for `claim` / `release` / `evidence` commands.
 * Resolution order (first non-empty wins):
 *   1. --by flag (explicit, always wins)
 *   2. $LORE_ACTOR environment variable
 *   3. session tier (`$CLAUDE_CODE_SESSION_ID` / `$CLAUDE_SESSION_ID` — SPEC-069
 *      F1 — mapped to `agent:session-<8-char sanitized id prefix>`; a value
 *      that sanitizes to empty falls through to the OS-username tier instead
 *      of throwing, see the try/catch in `resolveActorWithSource` above)
 *   4. OS username (os.userInfo().username)
 *
 * When resolution falls all the way to the OS-username tier — no --by, no
 * $LORE_ACTOR — emits a ONCE-PER-PROCESS non-blocking advisory to stderr
 * naming the fix (retro `knowledge-session-process-review-2026-07-22-spec-062-064-continu`:
 * OS-username actors were landing silently in the corpus audit trail, untraceable
 * to any agent). Deliberately does NOT fire on an explicit --by or $LORE_ACTOR
 * value, even one that looks like a bare human name ("daniel") — that is a
 * DELIBERATE choice by the caller, not the untraceable default this advisory
 * targets. The advisory is a pure side effect; the returned string and every
 * caller's exit code are unaffected.
 *
 * @param explicit - Value of the --by flag, if the user passed one
 * @returns Resolved actor identity string (never empty — OS username is always available)
 * @example
 *   resolveActor(undefined) // => "$LORE_ACTOR" or OS username (warns once if OS-fallback)
 *   resolveActor("alice")   // => "alice" (never warns)
 */
export function resolveActor(explicit?: string): string {
  const resolved = resolveActorWithSource(explicit);
  if (resolved.source === "os-fallback" && !warnedActorFallback) {
    warnedActorFallback = true;
    process.stderr.write(
      `⚠ actor resolved to OS username "${resolved.actor}" — corpus writes under this identity ` +
        "aren't traceable to an agent. Pass --by <id> or export LORE_ACTOR=agent:<slug> " +
        "(or ai:<...>) for a traceable actor.\n",
    );
  }
  return resolved.actor;
}

// ─── Actor Flag Alias Resolution (SPEC-051 D2) ─────────────────────────────

/**
 * Result of reconciling two possibly-aliased CLI actor flags into the ONE
 * value {@link resolveActor} should receive as its `explicit` argument.
 * Discriminated on `ok` rather than a boolean-flag pair — the two branches
 * carry genuinely different payloads (a value vs. an error message), so a
 * union is the correct shape here (not `{value?, error?}`).
 */
export type ActorAliasResolution =
  | { readonly ok: true; readonly value: string | undefined }
  | { readonly ok: false; readonly error: string };

/**
 * Reconcile `--by` (canonical) and `--reviewer` (accepted alias) for
 * `approve`/`reject` (SPEC-051 D2). `approve`/`reject` deliberately declare
 * `by` and `reviewer` as TWO INDEPENDENT citty args (no citty-level `alias`
 * link between them) — citty's own bidirectional alias merge silently picks
 * whichever value was inserted first into the parsed-args object when two
 * differently-aliased flags collide (an insertion-order-dependent citty
 * internal, not a documented contract), which would make a `--by X
 * --reviewer Y` conflict resolve unpredictably rather than fail loud. This
 * function is the explicit, deterministic reconciliation the command's own
 * `run` calls instead.
 *
 * @param byFlag - value of `--by`, if the caller passed one
 * @param reviewerFlag - value of `--reviewer`, if the caller passed one
 * @returns `{ok: true, value}` — `value` is whichever single flag was
 *   passed (or `undefined` if neither was; both branches feed straight into
 *   {@link resolveActor}) — or `{ok: false, error}` when BOTH were passed
 *   with DIFFERING values (same value on both is not a conflict)
 * @example
 *   resolveActorAlias("daniel", undefined) // {ok: true, value: "daniel"}
 *   resolveActorAlias(undefined, "daniel") // {ok: true, value: "daniel"}
 *   resolveActorAlias("daniel", "daniel")  // {ok: true, value: "daniel"}
 *   resolveActorAlias("daniel", "alice")   // {ok: false, error: "..."}
 */
export function resolveActorAlias(
  byFlag: string | undefined,
  reviewerFlag: string | undefined,
): ActorAliasResolution {
  if (byFlag !== undefined && reviewerFlag !== undefined && byFlag !== reviewerFlag) {
    return {
      ok: false,
      error:
        `--by and --reviewer were both provided with different values ` +
        `('${byFlag}' vs '${reviewerFlag}'). Pass only one, or use matching values.`,
    };
  }
  return { ok: true, value: byFlag ?? reviewerFlag };
}

// ─── Numeric Flag Validation (BUG-006/007/008/012 audit) ───────────────────

/**
 * Result of validating a numeric CLI flag via {@link parsePositiveIntArg}.
 * Discriminated on `ok` — the failure branch carries a ready-to-print stderr
 * message naming the offending flag and raw value, never a bare `NaN`/negative
 * number that silently propagates into `Array.prototype.slice()` (yielding an
 * always-empty or tail-truncated result, BUG-006/012) or a `bun:sqlite`
 * `LIMIT ?` bind (a raw "datatype mismatch" throw, BUG-007).
 */
export type ParsedIntArg =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly message: string };

/**
 * Validate a numeric CLI flag's raw string value as a bounded integer.
 *
 * Rejects — never silently coerces — three failure classes `parseInt` alone
 * lets through: non-numeric strings (`parseInt("abc", 10)` → `NaN`, which then
 * satisfies neither `<= 0` nor `> 0` comparisons and passes every naive guard
 * silently), fractional strings (`parseInt("3.5", 10)` truncates to `3` with no
 * signal to the caller), and out-of-bound integers (below `opts.min`, or beyond
 * `Number.isSafeInteger` range).
 *
 * Call this only once `raw` is known to be present — this function has no
 * opinion on "flag omitted → use a default"; callers resolve their own default
 * (often a citty `args.<flag>` declared `default`) before reaching here.
 *
 * @param raw - The flag's raw string value (e.g. citty `args.limit`)
 * @param flagName - The flag's display name for the error message, e.g. `"--limit"`
 * @param opts.min - Inclusive lower bound (default `1` — "positive"; pass `0` for
 *   flags like `--offset`/`--min-age-days` where zero is a legal value)
 * @returns `{ok: true, value}` on success, or `{ok: false, message}` — the
 *   caller prints `message` to stderr and sets `process.exitCode = 2` (this
 *   codebase's CLI usage-error convention, SPEC-051)
 * @example
 *   parsePositiveIntArg("10", "--limit")            // {ok: true, value: 10}
 *   parsePositiveIntArg("abc", "--limit")            // {ok: false, message: "..."}
 *   parsePositiveIntArg("3.5", "--limit")            // {ok: false, message: "..."}
 *   parsePositiveIntArg("-1", "--offset", {min: 0})  // {ok: false, message: "..."}
 *   parsePositiveIntArg("0", "--offset", {min: 0})   // {ok: true, value: 0}
 */
export function parsePositiveIntArg(
  raw: string,
  flagName: string,
  opts?: { min?: number },
): ParsedIntArg {
  const min = opts?.min ?? 1;
  const trimmed = raw.trim();
  // reason: a strict integer-literal regex rejects "abc" (NaN) AND "3.5" (parseInt
  // silently truncates fractional strings to their integer prefix) in one check,
  // before parseInt ever runs on the value.
  if (!/^-?\d+$/.test(trimmed)) {
    return { ok: false, message: `Error: ${flagName} must be an integer, got '${raw}'.` };
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(value)) {
    return { ok: false, message: `Error: ${flagName} is out of range, got '${raw}'.` };
  }
  if (value < min) {
    return { ok: false, message: `Error: ${flagName} must be >= ${min}, got '${raw}'.` };
  }
  return { ok: true, value };
}

// ─── Task Workflow Badges (SPEC-025 AC-WF-9) ────────────────────────────────

/**
 * Render a `[claimed:by@branch(stale) ✔n]`-style badge for a task row in
 * `lore list` / `lore tree`. Reads task.extra.claim / task.extra.
 * verification_evidence directly (no service round trip — this is
 * presentation, not a domain query) and validates each via the same Zod
 * schemas the store enforces, so malformed extra silently renders no badge
 * rather than throwing.
 *
 * `@branch` is appended when `claim.branch` is present (SPEC-042 D7, review
 * U9) — branch, not machine, is the discriminating field on a single-machine
 * team; machine/worktree stay JSON-only surfaces (`lore ready --json` /
 * `lore_ready`), never rendered in this compact text badge.
 *
 * Evidence-count segment classification (spec-workflow-hardening-evidence-
 * red-vocabulary-claim-worktree §M1, AC-WH-1): the LAST evidence entry's
 * `result` decides the glyph — `pass` → `✔n`, `fail` → `✘n`, and anything
 * else (`expected-fail` / `inconclusive`) → a DISTINCT non-green marker.
 * Reusing plain `✔n` for those two would render a deliberate RED-phase pin or
 * an inconclusive oracle run as if it had actually passed — the bug this task
 * fixes. Glyphs are deliberately the SAME ones `commands/ac.ts::coverageBadge`
 * already uses for the identical two states (`⚑R` expected-fail, `⚑?`
 * inconclusive, SPEC-061 §Scope D5 / this spec §M1) so a reader learns one
 * vocabulary across both badge renderers — only the numeral placement differs
 * (`⚑R{n}`/`⚑?{n}` suffix here, vs. `⚑R({n})`/`⚑?({n})` parenthetical there),
 * matching this function's own pre-existing `✔{n}`/`✘{n}` suffix convention
 * rather than ac.ts's separate aggregate-count parenthetical shape (this
 * function counts the total evidence array length, not distinct pass/fail
 * tallies, so the two shapes were never rendering the same quantity).
 *
 * @param doc - Full task DocRecord (must include `extra` — DocSummary lacks it)
 * @param nowIso - Current time (ISO 8601) for claim staleness computation
 * @param ttlMinutes - Claim TTL in minutes — pass `app.taskWorkflowService.claimTtlMinutes`
 * @returns `""` when the task has neither a claim nor evidence; otherwise a
 *   bracketed badge string with a leading space, ready to append to a row label
 * @example
 *   formatWorkflowBadge(task, new Date().toISOString(), 120)
 *   // " [claimed:alice@b1 ✔3]" or " [claimed:bob (stale) ✘1]" or
 *   // " [⚑R1]" (last result expected-fail) or " [⚑?1]" (last result inconclusive) or ""
 */
export function formatWorkflowBadge(doc: DocRecord, nowIso: string, ttlMinutes: number): string {
  const parts: string[] = [];

  const claimRaw = doc.extra["claim"];
  if (claimRaw !== undefined && claimRaw !== null) {
    const parsedClaim = taskClaimSchema.safeParse(claimRaw);
    if (parsedClaim.success) {
      const stale = isClaimStale(parsedClaim.data, nowIso, ttlMinutes);
      const branchPart = parsedClaim.data.branch !== undefined ? `@${parsedClaim.data.branch}` : "";
      parts.push(`claimed:${parsedClaim.data.by}${branchPart}${stale ? " (stale)" : ""}`);
    }
  }

  const evidenceRaw = doc.extra["verification_evidence"];
  if (Array.isArray(evidenceRaw) && evidenceRaw.length > 0) {
    const parsedEvidence = evidenceArraySchema.safeParse(evidenceRaw);
    if (parsedEvidence.success && parsedEvidence.data.length > 0) {
      const last = parsedEvidence.data[parsedEvidence.data.length - 1];
      if (last !== undefined) {
        const count = parsedEvidence.data.length;
        let glyph: string;
        switch (last.result) {
          case "pass":
            glyph = `✔${count}`;
            break;
          case "fail":
            glyph = `✘${count}`;
            break;
          case "inconclusive":
            glyph = `⚑?${count}`;
            break;
          case "expected-fail":
            glyph = `⚑R${count}`;
            break;
          default: {
            // exhaustive check — TypeScript should warn if a new result value is added
            const _exhaustive: never = last.result;
            glyph = `⚑?${count}`;
            void _exhaustive;
          }
        }
        parts.push(glyph);
      }
    }
  }

  return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
}

// ─── Validity Badges (SPEC-043 D3/D4 — search/list/tree row marking) ───────

/**
 * Render a ` [invalid]`-style badge for a row whose doc is currently invalidated
 * (SPEC-043 §Design Decisions D3, D4). Presentation-only wrapper over the SSOT
 * predicate `isInvalidated` (`@lore/core`) — never a second derivation of
 * "invalidated" logic.
 *
 * @param doc - Any `isInvalidated`-compatible carrier (a full DocRecord, or a
 *   SearchHit — both accepted structurally, same union `isInvalidated` itself takes).
 * @param nowIso - Current time (ISO 8601), same seam convention as formatWorkflowBadge.
 * @returns `" [invalid]"` when invalidated, else `""`.
 * @example
 *   formatValidityBadge(knowledgeDoc, new Date().toISOString()) // " [invalid]" or ""
 */
export function formatValidityBadge(doc: ValidityCarrier, nowIso: string): string {
  return isInvalidated(doc, nowIso) ? " [invalid]" : "";
}

// ─── Review Judgment Badges (SPEC-034 §4 triage rendering) ─────────────────

/**
 * Render a `[AI: <decision> <confidence>]`-style badge for a `lore pending` row.
 * Pure presentation over an already-fetched `ReviewJudgment | null` — no store access
 * here (the caller, `pending.ts`, does one `judgmentService.latestFor` call per doc).
 *
 * @param judgment - The doc's latest review judgment, or `null` if never reviewed
 * @param docVersion - The doc's CURRENT version (`PendingDoc.version`) — compared
 *   against `judgment.doc_version` to detect staleness (the doc changed since the
 *   judgment was recorded)
 * @returns `"[unreviewed]"` when `judgment` is `null`; otherwise `"[AI: approve 0.93]"` /
 *   `"[AI: reject 0.87]"` / `"[AI: escalate ✋2Q]"` (Q-count = `blocking_questions.length`),
 *   with `" (stale)"` appended when `judgment.doc_version < docVersion`
 * @example
 *   formatJudgmentBadge(null, 1)                                    // "[unreviewed]"
 *   formatJudgmentBadge({decision: "approve", confidence: 0.93, doc_version: 2, ...}, 2)
 *   // "[AI: approve 0.93]"
 *   formatJudgmentBadge({decision: "escalate", blocking_questions: ["a", "b"], doc_version: 1, ...}, 2)
 *   // "[AI: escalate ✋2Q] (stale)"
 */
export function formatJudgmentBadge(judgment: ReviewJudgment | null, docVersion: number): string {
  if (judgment === null) return "[unreviewed]";

  const stale = judgment.doc_version < docVersion ? " (stale)" : "";
  if (judgment.decision === "escalate") {
    return `[AI: escalate ✋${judgment.blocking_questions.length}Q]${stale}`;
  }
  return `[AI: ${judgment.decision} ${judgment.confidence.toFixed(2)}]${stale}`;
}

/**
 * Render a `[stale? <confidence> ✋<n>Q]`-style badge for a `lore review --staleness
 * --list` row (SPEC-044 §Design Decisions D6/D9) — mirrors {@link formatJudgmentBadge}'s
 * shape but with the staleness-specific `stale?` marker. Never renders `[unreviewed]` or
 * a `(stale)` suffix — `--list` only ever surfaces FRESH `escalate` judgments by
 * construction (`listFreshStalenessEscalates`, `flows/staleness-flow.ts`), so both of
 * `formatJudgmentBadge`'s other branches are structurally unreachable here.
 *
 * @param judgment - A fresh `kind="staleness"`, `decision="escalate"` judgment
 * @returns `"[stale? 0.87 ✋2Q]"`
 * @example
 *   formatStalenessBadge({confidence: 0.87, blocking_questions: ["a", "b"], ...}) // "[stale? 0.87 ✋2Q]"
 */
export function formatStalenessBadge(judgment: ReviewJudgment): string {
  return `[stale? ${judgment.confidence.toFixed(2)} ✋${judgment.blocking_questions.length}Q]`;
}

// ─── Table Output ───────────────────────────────────────────────────────────

/**
 * Render a simple fixed-width table with aligned columns.
 *
 * @param headers - column header labels
 * @param rows - data rows (arrays of strings matching header count)
 * @returns formatted multi-line string ready for console output
 */
export function formatTable(headers: string[], rows: string[][]): string {
  const allRows = [headers, ...rows];
  const widths = headers.map((_, colIdx) =>
    Math.max(...allRows.map((r) => (r[colIdx] ?? "").length)),
  );

  const separator = widths.map((w) => "─".repeat(w)).join("  ");
  const headerLine = headers.map((h, i) => h.padEnd(widths[i] ?? 0)).join("  ");
  const dataLines = rows.map((row) =>
    row.map((cell, i) => (cell ?? "").padEnd(widths[i] ?? 0)).join("  "),
  );

  return [headerLine, separator, ...dataLines].join("\n");
}

// ─── Tree Output ────────────────────────────────────────────────────────────

/**
 * Render a doc tree with Unicode box-drawing characters.
 *
 * @param node - root TreeNode from CorpusService.getTree()
 * @param prefix - indentation prefix (empty string for root)
 * @param badges - optional DocId → workflow badge string lookup (AC-WF-9); rows
 *   whose id is absent from the map render with no badge. Default empty (no
 *   badges) keeps this fully backward-compatible with pre-SPEC-025 callers.
 * @returns multi-line string with tree connectors
 */
export function formatTree(
  node: TreeNode,
  prefix: string = "",
  badges: ReadonlyMap<string, string> = new Map(),
): string {
  const label = `${node.doc.id.slice(0, 8)}… ${node.doc.title} (${node.doc.status})${badges.get(node.doc.id) ?? ""}`;
  const lines: string[] = [prefix === "" ? label : label];

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const isLast = i === node.children.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";
    const childLines = formatTreeChildren(child, childPrefix, badges);
    lines.push(prefix + connector + childLines[0]);
    for (let j = 1; j < childLines.length; j++) {
      lines.push(prefix + childLines[j]);
    }
  }

  return lines.join("\n");
}

function formatTreeChildren(
  node: TreeNode,
  prefix: string,
  badges: ReadonlyMap<string, string>,
): string[] {
  const label = `${node.doc.id.slice(0, 8)}… ${node.doc.title} (${node.doc.status})${badges.get(node.doc.id) ?? ""}`;
  const lines: string[] = [label];

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const isLast = i === node.children.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = prefix + (isLast ? "    " : "│   ");
    const childLines = formatTreeChildren(child, childPrefix, badges);
    lines.push(prefix + connector + childLines[0]);
    for (let j = 1; j < childLines.length; j++) {
      lines.push(prefix + childLines[j]);
    }
  }

  return lines;
}

// ─── Navigation Footer ──────────────────────────────────────────────────────

/**
 * Render the navigation footer section for `lore get` output.
 *
 * @param nav - navigation section from DocWithNavigation
 * @returns formatted multi-line string
 */
export function formatNavigation(nav: DocWithNavigation["navigation"]): string {
  const lines: string[] = ["── Navigation " + "─".repeat(50)];

  if (nav.parent) {
    lines.push(`Parent:   ${nav.parent.id.slice(0, 8)}… ${nav.parent.title}`);
  } else {
    lines.push("Parent:   (none)");
  }

  if (nav.siblings.length > 0) {
    const sibStr = nav.siblings
      .slice(0, 5)
      .map((s) => `${s.id.slice(0, 8)}… ${s.title}`)
      .join(", ");
    lines.push(`Siblings: ${sibStr}`);
  } else {
    lines.push("Siblings: (none)");
  }

  if (nav.children.length > 0) {
    const childStr = nav.children
      .slice(0, 5)
      .map((c) => `${c.id.slice(0, 8)}… ${c.title}`)
      .join(", ");
    lines.push(`Children: ${childStr}`);
  } else {
    lines.push("Children: (none)");
  }

  if (nav.related.length > 0) {
    const relStr = nav.related
      .slice(0, 5)
      .map((r) => `${r.id.slice(0, 8)}… ${r.title} (${r.link_type})`)
      .join(", ");
    lines.push(`Related:  ${relStr}`);
  }

  return lines.join("\n");
}

// ─── Relative Time ──────────────────────────────────────────────────────────

/**
 * Format ISO timestamp as relative time string ("2h ago", "3d ago").
 *
 * @param iso - ISO 8601 timestamp string
 * @returns human-readable relative time
 */
export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
