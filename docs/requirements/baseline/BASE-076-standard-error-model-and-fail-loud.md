---
id: BASE-076
type: baseline
role: intent
title: "Standard: error model and fail-loud"
status: approved
priority: medium
created: 2026-10-10
updated: 2026-10-10
tags: []
parent: BASE-094
links:
  - {id: SPEC-008, type: supersedes}
  - {id: SPEC-001, type: supersedes}
  - {id: SPEC-011, type: supersedes}
  - {id: SPEC-030, type: supersedes}
---
# Standard: error model and fail-loud

Rules on how failures travel: as Result values across service boundaries, as isError / JSON envelopes / exit codes across adapter boundaries, and never as a silent default.

Each rule is an AS-n in four parts. The rule records (`extra.rules`) are the source of truth; the section below renders all 4 of them (AS-5, AS-6, AS-7, AS-23) as stored on 2026-10-10 so a reader of this body sees all four parts. Edit rules with `lore rule set`, then re-render.

Confidence uses the baseline vocabulary (core baseline.ts RULE_CONFIDENCES): established, undecided, unconfirmed, observed. Observed means what the code does today, measured on the date given, with the owner's intent not yet confirmed; it is the value used for rules recorded from the code. As used in this node, enforced by guaranteed means a mechanism or test in the code refuses a violation, both means a mechanism covers part and written guidance the rest, and prompt-only means written guidance only.

AS-23 (unknown options) belongs here because an option the parser silently ignores or mis-reads is a silent fallback on the caller's input; refusing it with exit 2 is this standard's fail-loud rule applied to the CLI surface.

## AS-5: No exception crosses a service boundary: every public service method returns Promise<Result<T, LoreError>>, built with ok() and err() from @lore/core.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: Stated as an invariant in the service, store, ai and eval module docs and followed by the service map; there is no source scan that refuses a throwing public method, so conformance is by convention and review. Not exhaustively re-verified method by method on 2026-10-10.
- **Target Rule**: Every public method of a service, store or AI provider returns a Result; thrown values are caught at that public surface and mapped to a LoreError code.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None known. If a throwing public method is found, register an AD entry naming its issue before fixing it.
- **Examples**:
  - A store failure inside CorpusService.get returns err({code: STORE_ERROR}) to the adapter instead of throwing.
  - An internal helper may throw, but the public method that calls it catches and maps the error to a Result.

## AS-6: Adapters never let a failure escape their boundary: CLI maps every LoreError to an exit code, MCP returns isError, HTTP returns the JSON error envelope; every switch over LoreError is exhaustive.

- Confidence: established; enforced by: both; lifecycle: live
- **Current Reality**: Measured 2026-10-10: adapters/cli/utils.ts (two switches) and adapters/http/middleware.ts carry 'const _exhaustive: never' defaults, so tsc refuses an unmapped code; MCP handlers map service errors to isError by convention (module doc invariant), not by a compile-time check.
- **Target Rule**: Every adapter maps every LoreError member explicitly, with a never-typed default wherever it switches over the union; no raw Error stack reaches a caller.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None known; keep the never-typed defaults and add one wherever a new switch over LoreError appears.
- **Examples**:
  - A new LoreError code fails to compile in adapters/cli/utils.ts and adapters/http/middleware.ts until each maps it (never-typed default).
  - An MCP tool whose service call fails returns { content: [text], isError: true }, not a thrown error.

## AS-7: No silent fallback: a required value that is missing or invalid fails loud with a named error; it is never replaced by a default, an empty value, or a narrower behaviour without saying so.

- Confidence: established; enforced by: prompt-only; lifecycle: live
- **Current Reality**: createApp and resolveSyncCredentials fail loud on missing credentials and construction failure. Two CLI-loader paths still degrade silently: loadLoreApp strips the sync section so CLI writes stay local-only, and a config parse failure drops the whole project config to undefined.
- **Target Rule**: Every required input and every configured mode either takes effect or produces a loud, named error or warning; degrading to defaults is never silent.
- **Current Exceptions**: AD-8, AD-9
- **Migration**: Issue #84: the CLI either opens the configured replica or refuses with a named error when sync.enabled is set. Issue #2: a config parse failure is reported with the offending key and the CLI refuses to run on silently-dropped settings.
- **Examples**:
  - createApp with sync.enabled but no LORE_SYNC_TOKEN returns err(VALIDATION_ERROR) instead of opening a local-only store.
  - Refused in review: catch { return null } around a required config read.

## AS-23: Every command refuses an option it does not declare, written with two dashes or as one dash followed by several letters (such as -json), with exit 2 and a message naming the option as typed; for a one-dash spelling of a declared option it suggests the two-dash form. Declared one-letter aliases, negative numbers and anything after -- are accepted. A refused call reads and writes nothing. Usage output shows long options with two dashes.

- Confidence: observed; enforced by: guaranteed; lifecycle: live
- **Current Reality**: Measured 2026-10-10: all 64 commands in adapters/cli/index.ts are wrapped by wrapDefault (index.ts:26-27) -> wrapCommandStrict (cli/strict-flags.ts:379), which recurses into subcommands and, before the command's run, calls findUnknownFlag (:167; stops at --, accepts declared names, aliases, --no-<bool>) then findSingleDashViolation (:278; accepts one-letter alias clusters and negative numbers, suggests the two-dash form). A violation prints 'Error: Unknown option: <token>' and exits 2 (:402, :417) before the app opens, so nothing is read or written. renderUsageDoubleDash (cli/usage-render.ts), wired at runMain (src/index.ts:41-42), renders long aliases with two dashes. Tests: tests/unit/adapters/cli-strict-flags.test.ts, strict-flag-single-dash.test.ts.
- **Target Rule**: Every command refuses an option it does not declare, written with two dashes or as one dash followed by several letters (such as -json), with exit 2 and a message naming the option as typed; for a one-dash spelling of a declared option it suggests the two-dash form. Declared one-letter aliases, negative numbers and anything after -- are accepted. A refused call reads and writes nothing. Usage output shows long options with two dashes.
- **Current Exceptions**: none (no registered debt entry violates this standard)
- **Migration**: None needed: the code already meets the target. Recorded from the 2026-10-10 uncited-spec mapping (slice 3b); it sits under fail-loud because a silently mis-parsed or ignored option is a silent fallback on the caller's input.
- **Examples**:
  - Given lore list -json; when it runs; then it exits 2 naming -json and suggesting --json, and prints no table.
