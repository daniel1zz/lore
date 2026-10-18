---
id: SPEC-123
type: spec
role: spec
title: "Resume-ticket coverage floor — blocking channel, arming provenance, cross-turn idempotence"
status: approved
priority: medium
created: 2026-08-01
updated: 2026-10-17
tags: []
links:
  - {id: SPEC-112, type: relates-to}
---
# Resume-ticket coverage floor — blocking channel, arming provenance, cross-turn idempotence

## Overview

`spec-resume-ticket-coverage-a-shipped-upper-bound-left-the` (SPEC-112, approved v38, all 14 ACs verified, its plan archived) shipped the resume-ticket LOWER bound: ordinal `KD<n>`/`NS<n>` ids, a per-record cardinality line, the `RESUME_COVERAGE_FLOOR` declaration, a coverage-check verb, and a blind-pipe Stop hook. The detector works — it produces true positives. **What shipped does not change assistant behaviour at all**, and two arming faults make it fire when nothing was consumed and re-fire after the obligation was already met.

This spec's own decisions are labelled `H1`–`H6` so they never collide with SPEC-112's `D`-series; every reference to a SPEC-112 decision below names it in full (`SPEC-112 D5`, etc.).

**Measured 2026-08-01, session `2f45e6d9-2567-4d7b-9c68-2a739282301a`.** A ticket rendered at 04:38:56 (4 key decisions + 5 next steps = 9 items). Over the following 7h46m the session produced **130** assistant text turns. Two Stop hooks were armed the whole time, with the SAME model at the SAME Stop moments:

| hook | delivery channel | fires | turns that complied |
|---|---|---|---|
| `stop-doc-sync.mjs` | stdout `{"decision":"block","reason":<instruction + Required-output template>}`, exit 0 | 10 | **10** (`[DOC_SYNC]` emitted) |
| `stop-handoff-coverage.mjs` | exit 1 + one stderr symptom line | 10 | **0** (`[RESUME_DISPOSITION]` never emitted) |

10 versus 0, one variable: the delivery channel. Under the Stop-hook contract, exit 1 is a NON-blocking status — it surfaces to the user as a `hook_non_blocking_error` attachment carrying a bare symptom (`Undispositioned resume ticket item: KD1`) with no statement of the required output. The model is not compelled, and is not even told what to write. The 9 items went unaccounted through 130 turns and the operator had to hand-carry the error into a later session to get it looked at. This is not a discipline failure: the control arm proves the same model complies 10/10 when the obligation arrives through the block channel with a template.

**Two arming faults, both measured 2026-08-01 by direct probe of the shipped verb.**

1. *Reading a ticket arms the floor.* SPEC-112 D6 claims the gate arms "only when a ticket was actually rendered into this session's transcript". The implemented predicate is weaker: the most recent tool_result whose text carries a cardinality line plus `RESUME_COVERAGE_FLOOR`, with no notion of which tool produced it. Probe: a synthetic transcript that never ran `lore feed session-resume` and merely holds `cat docs/archive/old-handoff.md` output → the verb named all 9 ids and exited 1. Auditing, grepping, or quoting an archived handoff therefore imposes a fabricated 9-item accounting duty. Observed in the wild while investigating this very defect: the assistant had to deliberately withhold the cardinality line from its own output to avoid self-arming.

2. *An accounted ticket re-arms every turn.* The verb reads dispositions only from `last_assistant_message`, so accounting done in turn N is invisible at turn N+1. `RESUME_COVERAGE_FLOOR` and the governance prose both say "before the session ends"; the implementation demands the full item set in EVERY terminal message for the rest of the session (measured: re-fired 10 times across 7h46m). SPEC-112 D5 asserts the gate "can be armed unconditionally without becoming noise" — under per-turn semantics that does not hold. The root cause is SPEC-112 D8's zero-cross-process-state rule (forced, and correctly so, by the measured `CLAUDE_SESSION_ID` mismatch), which left the verb no memory of prior turns. The transcript itself supplies that memory without reintroducing side-written state.

This spec closes the behaviour gap and both arming faults. It supersedes SPEC-112's AC-RC-7 exit-status half and SPEC-112 D6's arming predicate; every other SPEC-112 decision — D5 (account, not complete), D8 (zero cross-process state), D9 (hook holds no grammar), D10 (multi-actor render exempt) — is preserved and re-asserted here.

**Delivery surface.** All three fixes land in the compiled binary (`packages/lore/src/adapters/cli/commands/handoff.ts` and its `@lore/core` constants). `assets/hooks/stop-handoff-coverage.mjs` needs NO edit: it already relays child stdout byte-for-byte and relays the child exit status, so a verb that writes a block decision to stdout and exits 0 becomes a blocking Stop decision with no asset change and no assets-manifest regeneration. A consumer who ran `lore init` + `lore setup` at any earlier version gets all of this by upgrading the binary alone.

## Scope

In scope:

- `packages/lore/src/adapters/cli/commands/handoff.ts` — the `coverage-check` verb: its verdict channel, its arming predicate, and its disposition-source set.
- `packages/core/src/session.ts` — any new exported constant the verdict template needs (the verb must compose the template from exported constants, never from literals, per SPEC-112 D7/D9).
- `packages/lore/tests/unit/handoff-coverage-check.test.ts` and the compiled-path e2e test — the oracles for every AC below.

Out of scope:

- The ticket render itself (ordinals, cardinality line, `RESUME_COVERAGE_FLOOR` placement) — unchanged.
- `assets/hooks/stop-handoff-coverage.mjs` — deliberately NOT edited; AC-RCH-3 pins that its unmodified relay carries a block decision.
- `assets/governance/corpus-workflow.md` prose — deliberately NOT edited. Its "before the session ends" wording is currently a false description of the implementation; AC-RCH-6 makes the implementation match the prose rather than rewriting the prose to excuse the implementation.
- SPEC-112 D10's multi-actor exemption — preserved unchanged, and NOT left to incidental coverage: because H4 replaces the arming predicate wholesale, AC-RCH-5 carries an explicit multi-actor fixture that must stay non-arming even when produced by a genuine feed call.
- A separate defect observed while writing this spec: `lore create spec --help` trips the armed spec-create PreToolUse gate (a help request is not a write). Recorded separately; not fixed here.

## Design Decisions

**H1 — the verdict travels the block channel, and the hook does not change.** On an incomplete accounting the verb writes a single JSON object to stdout — `{"decision":"block","reason":<text>}` — and exits 0. The hook already writes child stdout through unchanged and relays the child status, so the Stop contract sees a structured block. Rejected alternative: teach the hook to wrap the verb's stderr in a block decision — that would put the disposition grammar and the reason template into an installed `.mjs`, which is exactly the second implementation SPEC-112 D8/D9 exist to prevent, and would additionally require an assets-manifest regeneration for every consumer.

**H2 — stderr keeps the human diagnostic; the exit status stops carrying ANY verdict.** The per-id `Undispositioned resume ticket item: <id>` lines remain on stderr, so an operator watching the terminal still sees exactly which ids are missing. The exit status becomes 0 for a verdict of "incomplete", because a non-zero status is precisely the channel measured to change nothing. After this change the verb's exit status is uninformative BY DESIGN: "incomplete accounting", "complete accounting", "no ticket", and the SPEC-112 D6 degradations (malformed stdin, unreadable transcript) are all exit 0, and stdout is the ONLY channel that distinguishes them — AC-RCH-8 pins that indistinguishability so a future change cannot quietly re-load the verdict onto the status. The verb retains no deliberate non-zero path of its own; the surviving non-zero statuses belong to the hook (`FAULT_EXIT_CODE`, unchanged) and to an internal-invariant crash such as the cardinality-template shape check, which is a fault report and not a verdict. SPEC-112 AC-RC-10's relay assertion (stub exits 3 → hook exits 3) stays green because the relay path itself is untouched.

**H3 — the reason text is composed from exported constants and names the exact output required, in a form that round-trips.** It must state the marker, both accepted dispositions, and one line per missing id which, when fed back through the verb's OWN disposition parser, is recognised as dispositioning exactly that id. Round-tripping rather than mere substring presence is what makes "ready to copy" a measurable property instead of a wish. Rationale for carrying a template at all is the measured control arm: doc-sync's reason carries a `Required output` template and earns 10/10 compliance, while a bare symptom line earns 0/130. Composed from `RESUME_DISPOSITION_MARKER` / `RESUME_DISPOSITION_DONE` / `RESUME_DISPOSITION_DEFERRED_PREFIX` — a hand-typed template in the verb would be the remembered-wording vector SPEC-112 D7 forbids.

**H4 — arming keys on the tool that PRODUCED the ticket, not on text that merely contains one.** The verb pairs each candidate `tool_result` with its originating `tool_use` (by `tool_use_id`) and arms only when that call is a `lore feed session-resume` invocation — Bash-shaped (`command` carries the lone tokens `feed` and `session-resume`) or MCP-shaped (`lore_feed` with a `session-resume` checkpoint). Matching is on independent lone tokens, never a contiguous phrase, because a remembered contiguous substring that stops matching degrades silently to "no ticket → exit 0" (this repo's measured contiguous-substring vector, and SPEC-112 D6's exact silent-inertness failure mode). Non-contiguity is not left as an implementation claim: AC-RCH-5 fixes it with fixtures that interleave unrelated flags between the two tokens and that reverse their order, both of which must still arm. This keeps SPEC-112 D8 intact: the transcript remains the only fact source and nothing is side-written.

**H5 — dispositions accumulate across the whole post-ticket transcript.** Expected ids are satisfied by the union of the dispositions found in every assistant text message after the ticket AND those in `last_assistant_message`. Reading earlier turns from the transcript is race-free for the same reason SPEC-112 D8 already reads the ticket there: the flush race only ever threatens the CURRENT turn's final message, which continues to be read from `last_assistant_message`. This makes `RESUME_COVERAGE_FLOOR`'s own "before this session ends" wording true as written — one accounting closes the item permanently — and restores the noise-free property SPEC-112 D5 claimed but per-turn re-arming had voided.

**H6 — every AC pins the BLOCKING SEMANTICS, not merely a non-zero status.** SPEC-112's AC-RC-7 asserted "exits non-zero", which exit 1 satisfies while delivering nothing; that AC passed for eight days over a mechanism with zero measured effect. This is the same false-oracle class this repo has recorded five times (an oracle that confirms a command ran, not that it measured the right thing — most recently a silently-inert CLI flag). So ACs here assert the parsed stdout `decision` value, constant-identity and round-trip properties of `reason`, and — for both arming faults — a control arm proving the detector was live when it declined to fire.

## Acceptance Criteria

Seven structured criteria are declared on this spec (`lore ac list`); each summarised here in declaration order:

- **AC-RCH-1** — an incomplete accounting yields exit 0 with a parsed stdout `decision` of `block`, stderr still naming exactly the missing ids, plus a full-coverage control proving the block is conditional.
- **AC-RCH-2** — the `reason` text is built from the three exported disposition constants (identity-asserted, not typed literals) and its per-id lines round-trip through the verb's own disposition parser.
- **AC-RCH-3** — the UNMODIFIED hook asset relays a stdout block decision byte-for-byte at exit 0, and still carries zero grammar.
- **AC-RCH-4** — ticket text transported by a non-feed tool call does not arm, paired with a byte-identical control where a real feed call does arm.
- **AC-RCH-5** — exhaustive iteration over originating-call shapes: bare / dist-path-with-flags / MCP arm; `cat` and `grep` do not; flag-interleaved and token-order-reversed fixtures still arm, pinning non-contiguous matching as an observable; and a multi-actor-render fixture stays non-arming even from a genuine feed call, pinning SPEC-112 D10 against regression under the replaced predicate.
- **AC-RCH-6** — an accounting made in an earlier post-ticket turn keeps the floor closed later, paired with a partial-accounting control that still blocks on exactly the remainder.
- **AC-RCH-7** — the consumer-visible compiled path: freshly built `dist/lore` plus the real hook resolving it through `PATH` produces the block decision, and empty stdout on complete accounting.
- **AC-RCH-8** — the exit status carries no verdict: incomplete, complete, no-ticket, malformed-stdin and unreadable-transcript inputs all exit 0, and only stdout separates them.


## Acceptance Criteria (structured)

- [⚑] [script] AC-RCH-1: Given a transcript with a produced ticket and a last_assistant_message dispositioning a strict subset of ids, the coverage-check verb exits 0, its stdout parses as one JSON object whose decision field equals the string block, and its stderr still carries one Undispositioned line per missing id whose id set is SET-EQUAL to the omitted subset so naming extra or fewer ids fails; paired with a full-coverage control on the same fixture where stdout is empty and no block is emitted, proving the block is conditional rather than unconditional; the run reports exactly 1 matched test file
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "block decision"
- [⚑] [script] AC-RCH-2: The reason string of the block decision is composed from the @lore/core exports RESUME_DISPOSITION_MARKER, RESUME_DISPOSITION_DONE and RESUME_DISPOSITION_DEFERRED_PREFIX, asserted by identity against those exported values rather than against typed literals, and for every missing id it carries a line which, when fed back through the same disposition-line parser the verb uses to read dispositions, is recognised as dispositioning exactly that id and no other — so substring presence alone cannot satisfy this criterion; paired with a zero-hit search over the verb source for a hand-typed marker literal; the run reports exactly 1 matched test file
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "reason template"
- [⚑] [script] AC-RCH-3: With a stub binary earlier on PATH that writes a known JSON block decision to stdout and exits 0, the UNMODIFIED assets/hooks/stop-handoff-coverage.mjs reproduces that stdout byte-for-byte and exits 0, proving the shipped relay carries a block decision with no asset edit; paired with a control asserting the same hook source still yields zero hits for every exported item-id prefix and disposition token so it gained no grammar; the run reports exactly 1 matched test file
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "hook relays block"
- [⚑] [script] AC-RCH-4: Given a transcript whose ticket text appears in a tool_result produced by a tool call that is NOT a lore feed session-resume invocation, the verb exits 0 and writes nothing to stdout; paired with a control where the byte-identical ticket text is paired by tool_use_id with a lore feed session-resume call and the verb DOES emit a block decision, so the negative half cannot pass by failing to find any ticket at all; the run reports exactly 1 matched test file
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "arming provenance"
- [⚑] [script] AC-RCH-5: Iterating exhaustively over a structured fixture array of originating tool calls, every shape that IS a session-resume feed yields a stdout payload parsing as a block decision — a bare lore invocation, a dist-path invocation carrying extra flags, an MCP lore_feed shape with a session-resume checkpoint, one whose command line interleaves unrelated flags BETWEEN the two required tokens, and one that reverses the order of those tokens — while every shape that merely transports the same ticket text yields EMPTY stdout at exit 0 (cat and grep), so non-contiguous token matching is pinned as an observable outcome rather than left as an implementation claim; the array additionally includes a multi-actor-render fixture carrying ordinals but NOT RESUME_COVERAGE_FLOOR which yields empty stdout even when produced by a genuine session-resume feed call, pinning the SPEC-112 D10 exemption against regression under the replaced arming predicate; the run reports exactly 1 matched test file
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "provenance shapes"
- [⚑] [script] AC-RCH-6: Given a transcript in which an assistant message AFTER the ticket already carries the complete disposition set while the current last_assistant_message carries none, the verb exits 0 and writes nothing to stdout, proving one accounting closes the item for the rest of the session; paired with a control on the same transcript where that earlier message carries only a proper subset and the verb DOES emit a block decision whose named id set is SET-EQUAL to the still-missing remainder, so the exit-0 half cannot come from ignoring the transcript entirely; the run reports exactly 1 matched test file
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "cross-turn"
- [⚑] [script] AC-RCH-7: Against a freshly built dist/lore binary and the real unmodified assets/hooks/stop-handoff-coverage.mjs resolving that binary through PATH, an incomplete-accounting Stop payload yields hook exit 0 with a stdout JSON block decision naming the missing ids, and a complete-accounting payload yields hook exit 0 with empty stdout — proving the consumer-visible compiled path and not only the in-process verb; the run reports exactly 1 matched test file
  script: e2e — bun run build && bunx --bun vitest run packages/lore/tests/e2e/resume-coverage-compiled.bun.test.ts
  other_command=1
- [⚑] [script] AC-RCH-8: Over a structured array of five payload classes — incomplete accounting, complete accounting, no ticket present, malformed stdin, and an unreadable transcript path — the verb exits 0 for EVERY class, so the exit status is proven to carry no verdict at all; the classes are told apart solely by stdout, which is a parsed block decision for the incomplete class and empty for the other four; this pins the H2 indistinguishability so a later change cannot re-load the verdict onto the exit status without failing here; the run reports exactly 1 matched test file
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "exit status carries no verdict"
