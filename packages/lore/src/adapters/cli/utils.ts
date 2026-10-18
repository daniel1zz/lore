/**
 * Shared CLI utilities — error formatting/output helpers, actor-identity
 * resolution, and misc CLI-adapter helpers (retry-command reconstruction,
 * numeric flag validation).
 *
 * ⛔ This header formerly asserted that no business logic lived here and that
 * this module performed no IO — both were already false before this comment
 * was corrected: `resolveActor`/`resolveActorWithSource`/
 * `detectWorktreeDerivedActor` (SPEC-104) encode genuine actor-resolution
 * PRECEDENCE RULES (a decision, not terminal I/O), and that same trio
 * performs real filesystem IO (`existsSync`/`readFileSync`/`statSync`) plus
 * `process.stderr.write` advisories. DB discovery (`findLoreDbPath` et al.)
 * ALSO used to live in this file — genuinely relocated now (see below), not
 * merely re-described — but its departure does not by itself make the
 * remaining claims true, which is why they are corrected rather than just
 * trimmed (spec-corpus-resolution-carries-provenance-and-a-foreign-write §D6:
 * a header recording a property that stopped being true is the failure class
 * this correction closes).
 *
 * Public surface:
 *   - exitCode() / formatError() — error presentation
 *   - buildRetryCommandLine() — the `Retry:` line of the declared write-contention
 *     message, built from the Invocation's argv by the caller and passed to
 *     formatError as `opts.retryCommand`
 *   - resolveActor() / resolveActorWithSource() / resolveActorWithIdentitySource()
 *     / detectWorktreeDerivedActor() — actor-identity
 *     resolution (SPEC-051, SPEC-104)
 *   - parsePositiveIntArg() — numeric CLI flag validation
 *   - formatTable() / formatTree() / formatNavigation() / relativeTime() — output helpers
 *   - formatShortId() — the ONE shared ULID short-id renderer (head+tail,
 *     git-style); every human-readable id display in this adapter routes
 *     through it (see its own doc comment for the rationale and the
 *     collision-probability derivation)
 *
 * DB discovery no longer lives in this file at all — it now lives in
 * `corpus-resolution.ts` (spec-corpus-resolution-carries-provenance-and-a-
 * foreign-write §D3/§D6), which this module re-exports `findLoreDbPath` from
 * so its five pre-existing importers (`loader.ts` ×2, `commands/context.ts`,
 * `report-issue-wiring.ts`, `scripts/check-ac-ref-integrity.ts`,
 * `scripts/export-spec-mirror.ts`) keep byte-identical import statements.
 * `findLoreDbPathQuiet` (`gate-bypass-audit.ts`) and `findMainCheckoutLoreDb`
 * relocated there too; neither is re-exported from here because nothing
 * imports either of them from this module.
 *
 * Side-effect class: MIXED, not pure — most of this module (the format-
 * prefixed renderers, relativeTime, exitCode, formatError) is pure
 * presentation, but actor resolution performs real filesystem IO and stderr
 * advisories (see above). No `process.exit` anywhere in this
 * file — that left with DB discovery.
 *
 * Source: SPEC-003 §5, SPEC-051, SPEC-104
 */

import { existsSync, readFileSync, statSync } from "fs";
import { basename, join, dirname, resolve as resolvePath } from "path";
import { z } from "zod";
import {
  evidenceEntrySchema,
  formatWriteContentionStderr,
  taskClaimSchema,
  isClaimStale,
  isInvalidated,
} from "@lore/core";
import { resolveActorWithSource as resolveActorWithSourceCore } from "@lore/core/node";
import { readOsUsername } from "../../os-username.js";
import type { ActorSource as CoreActorSource } from "@lore/core/node";
import type { DocRecord, LoreError, ReviewJudgment, ValidityCarrier } from "@lore/core";
import type { TreeNode } from "../../service/corpus-service.js";
import type { DocWithNavigation } from "../../service/corpus-service.js";

/** `Retry:` line of the write-contention message when the caller supplied none: names the action, reads nothing ambient. */
const WRITE_CONTENTION_GENERIC_RETRY = "re-run the same lore command";

const evidenceArraySchema = z.array(evidenceEntrySchema);

// ─── DB Discovery (relocated to corpus-resolution.ts) ──────────────────────
//
// findLoreDbPath now lives in corpus-resolution.ts
// (spec-corpus-resolution-carries-provenance-and-a-foreign-write §D3/§D6),
// re-exported here so the five pre-existing importers of this module
// (loader.ts ×2, commands/context.ts, report-issue-wiring.ts,
// scripts/check-ac-ref-integrity.ts, scripts/export-spec-mirror.ts) keep
// byte-identical import statements. findLoreDbPathQuiet (gate-bypass-audit.ts)
// and findMainCheckoutLoreDb relocated there too, but are NOT re-exported
// from here — nothing imports either of them from this module.
export { findLoreDbPath } from "./corpus-resolution.js";

// ─── Error Formatting ───────────────────────────────────────────────────────

/**
 * Map a LoreError code to a CLI exit code per SPEC-003 §5.
 *
 * @param error - LoreError from a service call
 * @returns numeric exit code (1 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10)
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
    // reason: WRITE_CONTENTION is the SAME family one layer down — SQLite refused the
    // write because another process held the corpus past the declared bound. 5 is the
    // DECLARED code for it (spec-report-issue-has-no-specified-concurrency-contract-ac-072
    // §Contract Details), deliberately joining this family rather than minting a new code.
    case "WRITE_CONTENTION":
    // reason: CONFLICT is the SAME family for a plain-file compare-and-swap write (CLAUDE.md
    // changed between read and write): re-read and retry, so it joins exit 5 rather than
    // minting a new code. Source: spec-context-fragments D8, AC-CF-13.
    case "CONFLICT":
      return 5;
    // reason: AC_WRITE_NOT_VIA_AC_VERB is an input rejected by a dedicated-writer guard — same
    // bucket as the VALIDATION_ERROR it parallels (exit 4). Source: spec-baseline-slice-2 §C3.
    case "AC_WRITE_NOT_VIA_AC_VERB":
    // reason: AC_CITE_REQUIRED — input rejected by the citation gate, same bucket (exit 4). Source: spec-baseline-slice-2 §C4.
    case "AC_CITE_REQUIRED":
      return 4;
    case "BUDGET_EXCEEDED":
      // reason: exit 3 — a failed budget CHECK on well-formed input, matching the `--check-*`
      // failure convention (`lore status --check-*` exits 3), not 4: 4 means the input itself
      // is invalid (VALIDATION_ERROR), whereas here every fragment is valid and only their sum
      // is over the cap. 3 is shared with DOC_NOT_FOUND as an existing "lookup/check failed"
      // bucket; callers needing the distinction read `error.code` from `--json`.
      // Source: spec-context-fragments D6, AC-CF-3.
      return 3;
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
    case "AUTH_REQUIRED":
      // reason: exit 8 reserved for GhRunner's auth taxonomy (gh missing or unauthenticated) —
      // distinct from every other bucket so a caller can detect "fix your local gh install/login"
      // without parsing stderr. Never retryable, unlike the two codes below.
      // Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github, AC-GI-2
      return 8;
    case "TRANSPORT_UNAVAILABLE":
      // reason: exit 9 — GhRunner's network/transport failure, retryable and distinct from
      // AUTH_REQUIRED (risk R2's oracle requires the two be observably different).
      return 9;
    case "RATE_LIMITED":
      // reason: exit 10 — GhRunner's rate-limit failure, carries a `reset` epoch a caller can
      // use to back off; distinct from both AUTH_REQUIRED and TRANSPORT_UNAVAILABLE.
      return 10;
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
export function formatError(error: LoreError, opts?: { aiHasNoFallback?: boolean; retryCommand?: string }): string {
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
      // "used by <id>" is a claim about a doc the reader can look up, and it
      // is only true because every store resolves the WINNER's id into
      // `existing_id` (`store/sqlite-store.ts::findSlugConflictIdSync`,
      // `store/turso-store.ts::findSlugConflictId`,
      // `store/in-memory-store.ts::findSlugConflict`). It was FALSE for both
      // SQL-backed stores until
      // task-skill-implement-duplicate-slug-existing-id-names-the: they
      // reported the rejected doc's own never-persisted id, so this line named
      // a doc that did not exist. Pinned from this render surface by the
      // `AC-4 SURFACE` case in `tests/unit/store/sqlite-store.bun.test.ts`,
      // which drives a real SQLiteStore conflict through THIS function.
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
    case "WRITE_CONTENTION":
      // reason: the wording lives in ONE place — `@lore/core`'s
      // `formatWriteContentionStderr` — because the 50-run e2e harness matches
      // against that same module's `matchesWriteContentionTemplate`. Rendering
      // the three lines inline here would let the enforcement and the oracle
      // drift apart silently (spec-report-issue-has-no-specified-concurrency-
      // contract-ac-072 D6). The retry line is the ONLY part not carried on the
      // error: it is this process's own invocation, which only the adapter
      // layer can see.
      return formatWriteContentionStderr({
        operation: error.operation,
        corpusPath: error.corpus_path,
        boundMs: error.bound_ms,
        source: error.source,
        // reason: the retry line is this process's own argv, which only the entry knows (AS-26): a caller that holds the
        // Invocation passes `buildRetryCommandLine(...)` as `opts.retryCommand`. No `WRITE_CONTENTION` producer exists in
        // `src/` today (the code is only rendered), so no caller supplies it yet; when none does the line names the
        // action instead of an argv this module may not read.
        retryCommand: opts?.retryCommand ?? WRITE_CONTENTION_GENERIC_RETRY,
      });
    case "CLAIM_CONFLICT":
      return (
        `Error: Task ${error.id} is claimed by '${error.holder}'` +
        (typeof error.holder_run === "string" ? ` (run ${error.holder_run})` : "") +
        ` (claimed ${error.age_minutes}m ago).\n` +
        "  Pass --steal (claim) or --force (release) to override, or wait for the lease to expire."
      );
    case "NEEDS_APPROVAL":
      return (
        `Error: ${error.message}\n` +
        `  AC: ${error.ac_id}\n` +
        `  Command: ${error.command}\n` +
        "  Pass --allow-new-commands to approve automatically, or run interactively (TTY, no --json) to confirm."
      );
    case "AUTH_REQUIRED":
      // reason: error.message already names the exact remedy literal (constructed once,
      // inside gh-runner.ts, per AC-GI-7's single-source requirement — this module never
      // re-derives or duplicates it). This renderer only echoes it back out.
      return `Error: ${error.message}\n  This will not succeed on retry until the local machine's gh install/login state is fixed.`;
    case "TRANSPORT_UNAVAILABLE":
      return `Error: ${error.message}\n  This is a transient network condition — retrying may succeed.`;
    case "CONFLICT":
      return `Error: ${error.message}\n  Nothing was written to ${error.path}; re-run the command to retry against its current bytes.`;
    case "BUDGET_EXCEEDED":
      return `Error: ${error.message}`;
    case "AC_WRITE_NOT_VIA_AC_VERB":
      return `Error [${error.code}]: ${error.message}`;
    case "AC_CITE_REQUIRED":
      return renderAcCiteRefusal(error);
    case "RATE_LIMITED":
      return `Error: ${error.message}\n  Rate limit resets at epoch ${String(error.reset)} — wait before retrying.`;
    default: {
      const _exhaustive: never = error;
      void _exhaustive;
      return "Error: An unexpected error occurred.";
    }
  }
}

/**
 * Renders the citation gate's refusal: the message, then (when the service attached one) its feeding
 * pack — up to 5 candidate rules, the paste-ready `lore ac cite` line and the exemption headroom.
 */
function renderAcCiteRefusal(error: Extract<LoreError, { code: "AC_CITE_REQUIRED" }>): string {
  const lines = [`Error [${error.code}]: ${error.message}`];
  const pack = error.feeding_pack;
  if (pack !== undefined) {
    if (pack.candidates.length > 0) {
      lines.push("  Candidate rules:");
      for (const c of pack.candidates) lines.push(`    ${c.id}  ${c.statement}`);
    }
    lines.push(`  Cite one:  ${pack.cite_line}`);
    lines.push(`  Exemption headroom: ${String(pack.exemption_headroom)}`);
  }
  return lines.join("\n");
}

// ─── Retry command line (write-contention template's third part) ────────────

/**
 * Shell-quotes ONE argv entry for a copy-pasteable retry line: bare when it
 * contains only characters no shell interprets, single-quoted otherwise (with
 * embedded single quotes closed-escaped-reopened, the POSIX-portable form).
 *
 * @param arg - a raw `process.argv` entry
 * @returns the same text, safe to paste into a POSIX shell
 * @example
 *   shellQuoteArg("--title")        // "--title"
 *   shellQuoteArg("a b")            // "'a b'"
 *   shellQuoteArg("it's")           // "'it'\\''s'"
 */
function shellQuoteArg(arg: string): string {
  if (arg.length > 0 && /^[A-Za-z0-9_,.:/=@+-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Reconstructs the command line to RE-RUN this invocation — the `Retry:` part
 * of the declared write-contention message
 * (spec-report-issue-has-no-specified-concurrency-contract-ac-072
 * §Contract Details). Pure: every ambient fact is a parameter, mirroring
 * `report-issue-wiring.ts`'s `InstalledBinaryContext` split.
 *
 * Both numbers below are MEASURED, not assumed (probe: a `bun build --compile`
 * binary invoked as `./probe report-issue --title 'a b'`):
 *   - `process.argv` is `["bun", "/$bunfs/root/<entry>", ...userArgs]` in a
 *     COMPILED binary and `[<bunPath>, <scriptPath>, ...userArgs]` from source,
 *     so `slice(2)` is the user's own arguments in BOTH modes (the same slice
 *     citty's `runMain` parses).
 *   - `argv[0]` is the literal string `"bun"` even in a compiled binary, so it
 *     can never supply the program name; `process.execPath` IS the compiled
 *     binary's own path, so its basename is the installed command name.
 *
 * @param argv - `process.argv`
 * @param execPath - `process.execPath`
 * @returns e.g. `lore report-issue --title 'a b'`. Running from SOURCE (no
 *   `/$bunfs/` entry) renders the canonical `lore` name rather than `bun`,
 *   because the retry advice must name the command a caller can actually
 *   re-run, not this process's dev-mode launcher.
 * @example
 *   buildRetryCommandLine(["bun", "/$bunfs/root/index.js", "report-issue"], "/usr/local/bin/lore")
 *   // "lore report-issue"
 */
export function buildRetryCommandLine(argv: readonly string[], execPath: string): string {
  const isCompiledBinary = argv[1]?.startsWith("/$bunfs/") === true;
  const programName = isCompiledBinary ? basename(execPath) : "lore";
  const userArgs = argv.slice(2).map(shellQuoteArg);
  return [programName, ...userArgs].join(" ");
}

// ─── Actor Resolution ───────────────────────────────────────────────────────

/**
 * `@lore/core/node`'s `resolveActorWithSource` (SPEC-079 G2 relocation) covers
 * three precedence tiers: explicit `--by` > SPEC-071 session tier > OS
 * username. The environment never supplies a name (BR-1055). SPEC-104 adds a
 * CLI-adapter-ONLY tier between session and OS username: when every named
 * tier is exhausted (core falls all the way to its own `"os-fallback"`
 * result) AND the caller's `cwd` sits inside a LINKED worktree with a
 * resolvable branch HEAD, the actor derives deterministically as
 * `agent:<branch>` (source `"worktree-derived"`) instead of the untraceable
 * OS username.
 *
 * ⛔ Actor resolution answers WHO, never WHICH RUN: the session INSTANCE is
 * captured as its own claim field (`TaskClaim.session_id`,
 * `TaskWorkflowService.claim` → `resolveClaimSessionId`), never smuggled into
 * the identity string. Do NOT "fix" a session-collapse report by reordering
 * these tiers.
 *
 * This module now defines its OWN `resolveActorWithSource` (shadowing, not
 * re-exporting, `@lore/core/node`'s function of the same name) plus its OWN
 * wider `ActorSource`/`ResolvedActor` types (a superset of the core module's,
 * adding `"worktree-derived"`). Deliberately scoped here: `CorpusService`,
 * `gate-bypass-audit.ts`, and MCP's `tools.ts` import `resolveActorWithSource`
 * directly from `@lore/core/node` and are UNCHANGED by this addition
 * (SPEC-104 §Scope: "MCP surface unaffected" — MCP tools require an explicit
 * `by` already; the other two callers are out of scope). Only the CLI's own
 * `resolveActor` / `resolveActorWithIdentitySource` (and every command built
 * on them, including `claim.ts`) gain the new tier.
 *
 * `@lore/core/node`'s narrower `ActorSource` (the type `ClaimOpts.identitySource`
 * is declared against, in `packages/lore/src/service/task-workflow-service.ts`)
 * is intentionally left unwidened here: SPEC-104 T1's declared file anchors
 * are `adapters/cli/utils.ts` + `adapters/cli/commands/claim.ts` only —
 * widening a shared core type is a separate, deliberately out-of-anchor
 * concern. `commands/claim.ts` bridges the gap with a single documented cast
 * at its one call site — functionally inert, since
 * `gate-predicates.ts::actorIdentityGuard` only ever compares
 * `candidateIdentitySource` against the `"os-fallback"` literal; every OTHER
 * string (this one included) is already an automatic pass, identical to
 * `"explicit"`/`"env"`/`"session"` today.
 */
export type ActorSource = CoreActorSource | "worktree-derived";

/** This module's own `ResolvedActor` — see the `ActorSource` doc above. */
export interface ResolvedActor {
  readonly actor: string;
  readonly source: ActorSource;
}

/**
 * Filesystem-only linked-worktree detector (SPEC-104 D2) — NEVER spawns a
 * `git` subprocess. Walks `startDir` upward looking for a `.git` entry:
 *   - a DIRECTORY marks the MAIN checkout (git never uses a `.git` FILE at a
 *     primary checkout root) — not a linked worktree, returns `undefined`.
 *   - a regular FILE holds git's own `gitdir: <path>` linked-worktree pointer
 *     (a stable, documented git internal contract) — read that path's own
 *     `HEAD` file; `ref: refs/heads/<branch>` → `agent:<branch>` (branch
 *     VERBATIM, including `/` — e.g. `feature/x` → `agent:feature/x`, no
 *     sanitization: matches the existing `agent:<branch-or-slug>` convention
 *     other tooling already assumes, SPEC-104 §Scope).
 *
 * Fails OPEN — returns `undefined`, NEVER throws (D3) — on every anomaly: no
 * `.git` found before the filesystem root, a `.git` file that isn't
 * `gitdir: `-prefixed, a `gitdir:` pointer whose `HEAD` is missing/unreadable,
 * or a DETACHED HEAD (`HEAD` holds a bare SHA, not a `ref: refs/heads/...`
 * line) — every one of these is the caller's cue to fall through to the
 * existing OS-username tier, unchanged.
 *
 * @param startDir - directory to start the upward walk from (the invocation's
 *   `cwd`; tests pass a fixture directory instead of mutating global cwd)
 * @returns `agent:<branch>` when a linked worktree with a resolvable branch
 *   HEAD is found; `undefined` otherwise (never throws)
 * @example
 *   detectWorktreeDerivedActor("/repo/.worktrees/trace-layer") // => "agent:trace-layer"
 *   detectWorktreeDerivedActor("/repo")                        // => undefined (main checkout)
 */
export function detectWorktreeDerivedActor(startDir: string): string | undefined {
  try {
    let dir = startDir;
    for (;;) {
      const gitPath = join(dir, ".git");
      if (existsSync(gitPath)) {
        const stat = statSync(gitPath);
        if (!stat.isFile()) {
          // A directory (main checkout) — or some other non-file shape git
          // never produces here. Either way, not a linked worktree.
          return undefined;
        }
        const pointerLine = readFileSync(gitPath, "utf8").trim();
        const gitdirMatch = /^gitdir:\s*(.+)$/.exec(pointerLine);
        if (gitdirMatch === null) return undefined;
        const gitDirRaw = gitdirMatch[1]?.trim();
        if (gitDirRaw === undefined || gitDirRaw === "") return undefined;
        const gitDirPath = resolvePath(dir, gitDirRaw);
        const headPath = join(gitDirPath, "HEAD");
        if (!existsSync(headPath)) return undefined;
        const headLine = readFileSync(headPath, "utf8").trim();
        const branchMatch = /^ref:\s*refs\/heads\/(.+)$/.exec(headLine);
        if (branchMatch === null) return undefined; // detached HEAD, or malformed
        const branch = branchMatch[1]?.trim();
        return branch !== undefined && branch !== "" ? `agent:${branch}` : undefined;
      }
      const parent = dirname(dir);
      if (parent === dir) return undefined; // reached filesystem root, no .git found
      dir = parent;
    }
  } catch {
    // reason: D3 — actor resolution must never crash a lore command; any
    // unexpected IO failure (permission error, a race with a concurrent
    // `git worktree remove`, etc.) degrades to "not a linked worktree".
    return undefined;
  }
}

/**
 * This module's OWN `resolveActorWithSource` — see the header doc above for
 * why it shadows (rather than re-exports) `@lore/core/node`'s function of the
 * same name. Delegates every named tier (explicit/env/session/os-fallback) to
 * the core function unchanged (AC-ACTOR-2); ONLY when core falls all the way
 * to `"os-fallback"` does this wrapper attempt worktree derivation,
 * overriding the result on a hit (AC-ACTOR-1) and returning the core result
 * byte-identical on a miss (AC-ACTOR-3, AC-ACTOR-4).
 *
 * @param explicit - Value of the --by flag, if the user passed one
 * @param env - Environment map (the invocation's `env`); tests pass a
 *   literal object, matching the core function's own testing seam
 * @param cwd - Directory to detect worktree membership from (the
 *   invocation's `cwd`); tests pass a fixture directory instead of mutating
 *   global cwd
 * @returns `{actor, source}` — `source: "worktree-derived"` only when every
 *   named tier was exhausted AND `cwd` resolved to a linked worktree with a
 *   resolvable branch HEAD
 * @example
 *   resolveActorWithSource(undefined, {}, "/repo/.worktrees/trace-layer")
 *   // => {actor: "agent:trace-layer", source: "worktree-derived"}
 * @example
 *   resolveActorWithSource(undefined, {}, "/repo") // main checkout
 *   // => {actor: "<OS username>", source: "os-fallback"}
 */
export function resolveActorWithSource(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): ResolvedActor {
  const core = resolveActorWithSourceCore(explicit, env, readOsUsername);
  if (core.source !== "os-fallback") {
    return core;
  }
  const worktreeActor = detectWorktreeDerivedActor(cwd);
  return worktreeActor !== undefined ? { actor: worktreeActor, source: "worktree-derived" } : core;
}

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
 *   2. session tier (`$CLAUDE_CODE_SESSION_ID` / `$CLAUDE_SESSION_ID` — SPEC-069
 *      F1 — mapped to `agent:session-<8-char sanitized id prefix>`; a value
 *      that sanitizes to empty falls through to the OS-username tier instead
 *      of throwing, see the try/catch in `resolveActorWithSource` above.
 *      session distinctness is also captured separately as
 *      `TaskClaim.session_id`)
 *   3. worktree-derived `agent:<branch>` (SPEC-104 — see
 *      `detectWorktreeDerivedActor`'s doc above)
 *   4. OS username (os.userInfo().username)
 *
 * When resolution falls all the way to the OS-username tier — no --by,
 * no session id, and cwd is NOT inside a linked worktree with a
 * resolvable branch HEAD — emits a ONCE-PER-PROCESS non-blocking advisory to
 * stderr naming the fix (retro `knowledge-session-process-review-2026-07-22-spec-062-064-continu`:
 * OS-username actors were landing silently in the corpus audit trail, untraceable
 * to any agent). Deliberately does NOT fire on an explicit --by,
 * or worktree-derived value — those are traceable identities, not the
 * untraceable default this advisory targets (SPEC-104 AC-ACTOR-1). The
 * advisory is a pure side effect; the returned string and every caller's exit
 * code are unaffected.
 *
 * @param explicit - Value of the --by flag, if the user passed one
 * @param env - the Invocation's environment (`inv.env`)
 * @param cwd - the Invocation's working directory (`inv.cwd`)
 * @returns Resolved actor identity string (never empty — OS username is always available)
 * @example
 *   resolveActor(undefined, inv.env, inv.cwd) // => session actor, worktree-derived agent:<branch>, or OS username
 *   resolveActor("alice", inv.env, inv.cwd) // => "alice" (never warns)
 */
export function resolveActor(explicit: string | undefined, env: Readonly<Record<string, string | undefined>>, cwd: string): string {
  return resolveActorWithIdentitySource(explicit, env, cwd).actor;
}

/**
 * `resolveActor`'s full-fidelity sibling (spec claim-time-actor-identity-
 * guard-zero-evidence-release-advis, AC-IDENTITY-REJECT) — same resolution
 * chain, same once-per-process OS-fallback advisory, but returns the FULL
 * `{actor, source}` pair instead of discarding `source`. `commands/claim.ts`
 * uses this (not bare `resolveActor`) to thread `ClaimOpts.identitySource`
 * into the claim-time actor-identity-collision guard — every OTHER caller
 * (`release`/`evidence`/`anchor`/etc.) keeps calling plain `resolveActor`
 * unchanged, since only `claim` needs the resolution tier.
 *
 * @param explicit - Value of the --by flag, if the user passed one
 * @param env - Environment map (SPEC-104; the invocation's `env`); tests
 *   pass a literal object, matching `resolveActorWithSource`'s own testing seam
 * @param cwd - Directory to detect worktree membership from (SPEC-104; the
 *   invocation's `cwd`; tests pass a fixture directory)
 * @returns `{actor, source}` — `actor` matches `resolveActor(explicit)` exactly
 * @example
 *   resolveActorWithIdentitySource(undefined) // => {actor: "<OS username>", source: "os-fallback"} (warns once)
 *   resolveActorWithIdentitySource("alice")   // => {actor: "alice", source: "explicit"} (never warns)
 */
export function resolveActorWithIdentitySource(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
): ResolvedActor {
  const resolved = resolveActorWithSource(explicit, env, cwd);
  if (resolved.source === "os-fallback" && !warnedActorFallback) {
    warnedActorFallback = true;
    process.stderr.write(
      `⚠ actor resolved to OS username "${resolved.actor}" — corpus writes under this identity ` +
        "aren't traceable to an agent. Install the agent integration (`lore setup`) so writes " +
        "carry an attested run.\n",
    );
  }
  return resolved;
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

// ─── Short ID Rendering (task-short-id-rendering-truncates-ulids-to-8-chars-a-1024ms) ──

/**
 * Render a document id as a git-style short id: head (8 chars) + `…` + tail
 * (5 chars). The ONE shared formatter for every human-readable id display in
 * this adapter — every call site below that used to hand-roll its own
 * `id.slice(0, 8)` now routes through this function instead (nine sites, three
 * files: `utils.ts`'s `formatTree`/`formatTreeChildren`/`formatNavigation`,
 * `commands/get.ts`'s document header, `commands/link.ts`'s two `Linked <from>
 * → <to>` operands). `--json` output on every one of those surfaces is
 * UNCHANGED — it always serializes the full, untruncated id; only the
 * human-readable text path renders through this function.
 *
 * ⛔ Do NOT fold `context-projection.ts`'s `sha256Hash8` into this function —
 * that is a sha256 CONTENT-hash truncation (a different concept, different
 * collision math: a deliberately short fingerprint over section *bodies*, not
 * a document identifier), left byte-identical by this change.
 *
 * ## Why the previous rendering (`.slice(0, 8)`) was broken
 *
 * A ULID is 26 Crockford-base32 characters: the first 10 encode the 48-bit
 * millisecond timestamp, the remaining 16 encode 80 bits of randomness.
 * `.slice(0, 8)` kept only the HIGH 40 bits of the timestamp and ZERO bits of
 * randomness — any two docs created inside the same 1024ms window (32^2, the
 * resolution an 8-char timestamp prefix carries) printed a BYTE-IDENTICAL
 * short id. This was not a rare same-millisecond fluke: it was a near-
 * certainty for this corpus's normal write pattern (batch doc creation), and
 * is the defect this function fixes.
 *
 * ## Options weighed (task §Required — recorded here per its explicit
 * "state the collision probability, do not assert it is enough" instruction)
 *
 *   (a) REJECTED — lengthen the prefix. All 10 timestamp characters are
 *       already the FULL 48-bit timestamp and still carry zero randomness;
 *       same-millisecond writes would still collide byte-for-byte. Any fix by
 *       lengthening the prefix alone buys nothing — it must reach INTO the
 *       random half to work at all, which is exactly what (b) does.
 *   (b) CHOSEN — head (8 chars) + tail (5 chars), git-style. The 5-char tail
 *       is drawn entirely from the ULID's 80-bit random half — specifically
 *       its LOWEST 25 bits (string positions 21-25 of the 26-char id; the
 *       random half itself spans positions 10-25). Two rendered ids collide
 *       under this scheme only if BOTH halves match: the same 40-bit
 *       timestamp prefix (i.e. the same 1024ms window — the ONLY condition
 *       under which the old 8-char form ever collided) AND the same 25-bit
 *       tail. Conditioned on "same window" (the worst case), the residual
 *       collision probability is exactly the tail-match probability:
 *       1 / 32^5 = 1 / 33,554,432 ≈ 2.98 × 10⁻⁸ — roughly 1 in 33.5 million,
 *       assuming the random half is drawn from a uniform CSPRNG (true for a
 *       spec-compliant ULID generator; this codebase's generator (`ulidx`'s
 *       `ulid()`) is not itself monotonic, so this is the applicable case —
 *       a MONOTONIC generator that increments the random part on a same-ms
 *       collision would make same-window collisions rarer still).
 *   (c) REJECTED — print the slug instead of the id. Every one of the nine
 *       call sites already prints the title (slug-derived) right next to the
 *       id, so a slug here would be redundant AND roughly double the line
 *       width. The slug is also editable while the id is immutable — a worse
 *       invariant for a short-id-as-identifier use case.
 *   (d) REJECTED — shortest-unique-prefix, computed against the corpus
 *       (git-style ambiguous-abbreviation growth). Requires a corpus-wide id
 *       lookup PER RENDER, plus new prefix-matching production surface inside
 *       `resolve()` — cost this task's anchors (pure presentation-layer files)
 *       cannot absorb.
 *
 * ⛔ NOT RESOLVABLE: unlike a full id or a full slug, this head+tail string is
 * NOT accepted by `lore get <short>` — `resolve()` only matches a full id, a
 * full slug, or a unique id PREFIX (contiguous from the start); this
 * non-contiguous head…tail form matches neither. A reader wanting to open a
 * doc from its printed short id must use the title/slug printed alongside it,
 * or `lore search`. This is a deliberate trade (option (d) above, which WOULD
 * have been resolvable, was rejected for its cost) — stated here rather than
 * left implicit.
 *
 * @param id - Full document id (a ULID in production; tests may pass any
 *   string). Ids no longer than `headLen + tailLen` (malformed/legacy data —
 *   e.g. a 6-char or empty string) render WHOLE, unsliced, with no `…`
 *   separator — never throws, never produces an overlapping/nonsensical
 *   substring.
 * @returns The rendered short id, ready to interpolate into a display line.
 * @example
 *   formatShortId("01KYYDXH4SBSHGHAXNPKEY9SMB") // "01KYYDXH…Y9SMB"
 *   formatShortId("abcdef")                      // "abcdef" (6 <= 13, whole)
 *   formatShortId("")                             // "" (boundary: empty)
 */
export function formatShortId(id: string): string {
  const headLen = 8;
  const tailLen = 5;
  if (id.length <= headLen + tailLen) return id;
  return `${id.slice(0, headLen)}…${id.slice(-tailLen)}`;
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
  const lines: string[] = [treeLabel(node, badges)];
  for (const line of formatTreeDescendants(node, badges)) lines.push(prefix + line);
  return lines.join("\n");
}

function treeLabel(node: TreeNode, badges: ReadonlyMap<string, string>): string {
  return `${formatShortId(node.doc.id)} ${node.doc.title} (${node.doc.status})${badges.get(node.doc.id) ?? ""}`;
}

/**
 * The rows BELOW `node`, indented relative to `node`'s own column. Each level adds ONE connector
 * (`├── `/`└── `) to its own row and ONE indent (`│   `/`    `) to the rows of its descendants, so the
 * rule is identical at every depth: a caller never re-applies an ancestor's prefix (the old
 * absolute-prefix recursion did, which doubled the indent from depth 3 on).
 */
function formatTreeDescendants(node: TreeNode, badges: ReadonlyMap<string, string>): string[] {
  const lines: string[] = [];
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (!child) continue;
    const isLast = i === node.children.length - 1;
    lines.push((isLast ? "└── " : "├── ") + treeLabel(child, badges));
    const indent = isLast ? "    " : "│   ";
    for (const line of formatTreeDescendants(child, badges)) lines.push(indent + line);
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
    lines.push(`Parent:   ${formatShortId(nav.parent.id)} ${nav.parent.title}`);
  } else {
    lines.push("Parent:   (none)");
  }

  if (nav.siblings.length > 0) {
    const sibStr = nav.siblings
      .slice(0, 5)
      .map((s) => `${formatShortId(s.id)} ${s.title}`)
      .join(", ");
    lines.push(`Siblings: ${sibStr}`);
  } else {
    lines.push("Siblings: (none)");
  }

  if (nav.children.length > 0) {
    const childStr = nav.children
      .slice(0, 5)
      .map((c) => `${formatShortId(c.id)} ${c.title}`)
      .join(", ");
    lines.push(`Children: ${childStr}`);
  } else {
    lines.push("Children: (none)");
  }

  if (nav.related.length > 0) {
    const relStr = nav.related
      .slice(0, 5)
      .map((r) => `${formatShortId(r.id)} ${r.title} (${r.link_type})`)
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
