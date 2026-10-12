/**
 * Core error model and Result type for the Lore service layer.
 * All service methods return Result<T, LoreError> — no thrown exceptions crossing service boundary.
 * Source: SPEC-001 §5
 */

/** Discriminated union of all service-layer errors; the variants below are the SSOT for the code list. */
export type LoreError =
  | { code: "DOC_NOT_FOUND"; id: string; suggestions?: string[] }
  | { code: "SLUG_NOT_FOUND"; slug: string; suggestions?: string[] }
  | { code: "STALE_VERSION"; id: string; expected: number; actual: number }
  | {
      code: "VALIDATION_ERROR";
      field: string;
      message: string;
      value?: unknown;
      /** Machine-readable refusal facts. `floor` = the `lore done` floor id that refused (never parse `message`). */
      details?: { floor?: string };
    }
  | { code: "SCHEMA_VIOLATION"; type: string; missing: string[]; extra?: string[] }
  | { code: "LINK_CYCLE"; path: string[] }
  | { code: "DUPLICATE_SLUG"; slug: string; existing_id: string }
  | { code: "DUPLICATE_LINK"; from: string; to: string; type: string }
  | { code: "DELETE_REQUIRES_CONFIRM"; id: string }
  | { code: "INVALID_TRANSITION"; from: string; to: string; allowed: string[] }
  | { code: "PARENT_REQUIRED"; type: string }
  | { code: "INVALID_PARENT_TYPE"; child: string; parent: string; allowed: string[] }
  | { code: "STORE_ERROR"; message: string; cause?: Error }
  /**
   * AI provider failed to generate content. Occurs when the spawned binary is missing,
   * exits with non-zero, produces empty stdout, or exceeds timeout_ms.
   * CLI exit code: 6 (SPEC-017 §3.4). Fail loud — no silent fallback to editor.
   * Source: SPEC-017 §3.4
   */
  | {
      code: "AI_PROVIDER_ERROR";
      message: string;
      /** Provider name as registered in the registry (e.g. "claude-cli") */
      provider?: string;
      /** Exit code of the spawned process (-1 if killed / unknown) */
      exit_code?: number;
      /** First 1024 chars of provider stderr for diagnosis */
      stderr?: string;
    }
  /**
   * A `lore claim` or `lore release` write was rejected because the task's advisory
   * lease is held by someone else and neither the fresh-claim exemption (stale lease)
   * nor an explicit override (--steal / --force) applies.
   * CLI exit code: 5 (mapped alongside STALE_VERSION — both are write-contention errors).
   * Source: SPEC-025 §3 D2, §4 AC-WF-3, AC-WF-6
   */
  | {
      code: "CLAIM_CONFLICT";
      id: string;
      /** Current claim holder's actor identity */
      holder: string;
      /** Current claim age in minutes at the time of the conflicting request */
      age_minutes: number;
      /**
       * The run holding the lease (spec-run-identity-slice-1 D6, BR-1040/BR-1043). Absent on a legacy
       * claim (no `harness_run` key); `null` on a claim by an unattested caller.
       */
      holder_run?: string | null;
    }
  /**
   * `lore verify` refused to execute a script-mode AC's command because it is NEW or
   * CHANGED relative to the target task's recorded evidence history (SPEC-039 M2
   * trust-hardening, command-provenance approval gate) and neither an interactive
   * confirmation nor `--allow-new-commands` / `allow_new_commands` approved it.
   * CLI exit code: 7 (distinct from every other bucket — this is neither a store
   * failure nor a generic validation error, it's "the runner refused to trust an
   * unreviewed command").
   * Source: SPEC-039 §M2 (env allowlist + command-provenance approval hardening)
   */
  | {
      code: "NEEDS_APPROVAL";
      message: string;
      /** The exact command string that was rejected. */
      command: string;
      /** The acceptance criterion id the rejected command belongs to. */
      ac_id: string;
    }
  /**
   * A corpus write was refused because ANOTHER WRITER held the database
   * longer than the DECLARED bounded wait (`PRAGMA busy_timeout` expiry —
   * SQLite's `SQLITE_BUSY` / errno 5 / "database is locked"). Contention, never
   * validation: the write itself was well-formed and nothing was written.
   *
   * Distinct from `STORE_ERROR` (which maps to exit 1 and reads as "the store
   * is broken") because the caller's correct response is different — re-run
   * the command — and because a nondeterministic outcome needs a code a CI
   * wrapper can branch on without parsing stderr.
   *
   * CLI exit code: 5, joining `STALE_VERSION`/`CLAIM_CONFLICT`'s
   * write-contention family ("someone else won the race, re-read and retry").
   * HTTP status: 409, same family. Rendered by
   * `@lore/core`'s `formatWriteContentionStderr` — the SSOT for the declared
   * 3-part message (path + declared bound, contending source or the
   * `unknown-source` literal, retry command line).
   *
   * Source: spec-report-issue-has-no-specified-concurrency-contract-ac-072
   *   §Contract Details (declared exit code + declared stderr template), D2, D4, D5
   */
  | {
      code: "WRITE_CONTENTION";
      /** The refusing operation, rendered as the message's subject (e.g. `"report-issue"`). */
      operation: string;
      /** Absolute path of the corpus file whose write lock could not be acquired. */
      corpus_path: string;
      /** The declared wait bound (ms) that expired — surfaced VERBATIM, never re-derived. */
      bound_ms: number;
      /** Contending session/PID/host, or the literal `unknown-source` when unresolvable. */
      source: string;
    }
  /**
   * `GhRunner` (the single `gh` subprocess seam, spec-the-defect-channel-
   * reaches-no-machine-but-its-own-github, Scope entry "GhRunner") could not
   * authenticate with GitHub — either the `gh` binary itself is missing
   * (child `execFile` rejected with `.code === "ENOENT"`) or it is installed
   * but has no logged-in account (the child's stderr names `gh`'s own
   * remedy). The two remedy literals (`cli.github.com` for the missing-binary
   * case, `gh auth login` for the unauthenticated case) are constructed ONLY
   * inside `gh-runner.ts` — never here — so a repo-wide scan for those
   * literals has exactly one legitimate source (AC-GI-7).
   *
   * NEVER retryable: retrying the identical call cannot succeed until an
   * operator fixes the local machine's `gh` install/login state, unlike
   * `TRANSPORT_UNAVAILABLE` below.
   * CLI exit code: 8 (distinct from every other bucket, including the other
   * two new GhRunner codes).
   * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github, Scope "GhRunner", AC-GI-2
   */
  | {
      code: "AUTH_REQUIRED";
      /** Names the exact remedy (`cli.github.com` or the literal `gh auth login`), verbatim from `gh-runner.ts`. */
      message: string;
      retryable: false;
    }
  /**
   * `GhRunner`'s child `gh` process failed at the network/transport layer
   * (its stderr named a DNS/connectivity failure reaching GitHub's API) —
   * never an auth or a generic validation problem.
   *
   * RETRYABLE: a transient network condition, distinct from `AUTH_REQUIRED`
   * (risk R2's oracle, AC-GI-2, requires this distinction to be observable).
   * CLI exit code: 9.
   * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github, Scope "GhRunner"
   */
  | {
      code: "TRANSPORT_UNAVAILABLE";
      message: string;
      retryable: true;
    }
  /**
   * GitHub's API rate limit rejected a `GhRunner` call. Carries the parsed
   * `X-RateLimit-Reset` epoch-seconds value verbatim (from the child's
   * stderr) so a caller can decide how long to back off, rather than
   * blindly retrying immediately.
   * CLI exit code: 10.
   * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github, Scope "GhRunner"
   */
  | {
      code: "RATE_LIMITED";
      message: string;
      /** Epoch seconds parsed from `gh`'s `X-RateLimit-Reset` response header. */
      reset: number;
      retryable: true;
    }
  /**
   * A compare-and-swap file write was refused because the file's bytes changed between
   * the writer's read and its pending write (another writer interleaved). Nothing was
   * written; the file holds the other writer's bytes, so a plain re-run is safe.
   * Distinct from `STALE_VERSION` (corpus doc versions) and `WRITE_CONTENTION` (SQLite
   * lock) because the contended resource is a plain file (CLAUDE.md).
   * CLI exit code: 5 — same "someone else won the race, re-read and retry" family.
   * Source: spec-context-fragments-config-driven-layered-rule-injection D8, AC-CF-13
   */
  | {
      code: "CONFLICT";
      /** Path of the file whose on-disk bytes no longer matched the writer's read. */
      path: string;
      message: string;
    }
  /**
   * A rendered context-fragment block exceeds its outlet's character cap (hook strings
   * over 10,000 chars are silently truncated by Claude Code, GH #20). Nothing is emitted.
   * `perFragment` lists every contributing fragment id with its body length so the
   * offender is addressable.
   * CLI exit code: 3 — a failed budget check on well-formed input.
   * Source: spec-context-fragments-config-driven-layered-rule-injection D6, AC-CF-3
   */
  | {
      code: "BUDGET_EXCEEDED";
      /** Outlet id whose cap was exceeded (an `OutletId` from context-fragments.ts). */
      outlet: string;
      cap: number;
      chars: number;
      perFragment: ReadonlyArray<{ readonly id: string; readonly chars: number }>;
      message: string;
    }
  /**
   * A write that would change `extra.acceptance_criteria` did not come through an `AcService`
   * verb (`lore ac add|set|rm|cite`). The AC array is judge-consumed, id-bearing data owned by
   * those verbs; `CorpusService.create`/`set` (hence CLI `lore set`, MCP `lore_set`, HTTP PATCH)
   * refuse any change to it. Nothing was written. A byte-identical echo of the stored array passes.
   * CLI exit code: 4 (input rejected); HTTP 422.
   * Source: spec-baseline-slice-2-completeness-census-per-branch-citation §C3, AC-BLS2-1 (issue #36)
   */
  | {
      code: "AC_WRITE_NOT_VIA_AC_VERB";
      /** The doc whose criteria the refused write would have changed (absent on create — no id yet). */
      id?: string;
      message: string;
    }
  /**
   * The citation gate (`workflow.gates."ac-cite"`, mode `enforce`, armed branch) refused an AC add or
   * revise: the criterion cites no live baseline rule, or cites a missing / deprecated / retired id.
   * Nothing was written (spec extra, version, status and version log are unchanged). `feeding_pack`
   * says how to satisfy the gate. CLI exit code: 4 (input rejected); HTTP 422.
   * Source: spec-baseline-slice-2-completeness-census-per-branch-citation §C4, AC-BLS2-2, AC-BLS2-3
   */
  | {
      code: "AC_CITE_REQUIRED";
      /** The spec whose write was refused (absent on create — no id yet). */
      id?: string;
      message: string;
      /** One entry per offending (criterion, rule) — `rule_id` absent when the criterion cites nothing. */
      violations: AcCiteViolation[];
      /** Present on every refusal the service raises; absent only on the store's bare in-transaction refusal. */
      feeding_pack?: AcCiteFeedingPack;
    };

/** Why one criterion fails the citation gate; `rule_id` names the offending id when it cites one. */
export interface AcCiteViolation {
  ac_id?: string;
  rule_id?: string;
  reason: "uncited" | "missing" | "deprecated" | "retired" | "debt";
}

/** What a refused citation write tells the author (spec C4: top 5 candidates, a paste-ready cite line, headroom). */
export interface AcCiteFeedingPack {
  /** At most 5 LIVE rules, anchor-matched first, then the spec's branch. */
  candidates: Array<{ id: string; statement: string }>;
  /** `lore ac cite <spec-slug> <ac-id> <BR-id>` for the first candidate. */
  cite_line: string;
  /** `floor(10% x live ACs) - exemptions granted`, never negative. */
  exemption_headroom: number;
}

/** Result type — success or failure. Use ok()/err() helpers to construct. */
export type Result<T, E = LoreError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Wrap a successful value in a Result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Wrap an error in a Result. */
export function err<E extends LoreError>(error: E): Result<never, E> {
  return { ok: false, error };
}
