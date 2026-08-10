---
id: SPEC-112
type: spec
role: spec
title: "Resume-ticket coverage: a shipped upper bound left the lower bound unrepresented"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-07-31
tags: []
parent: PRD-001
links:
  - {id: SPEC-110, type: relates-to}
---
## Overview

`spec-context-provenance-injected-corpus-global-state-and-a` gave the resume ticket an **upper** bound: `RESUME_SCOPE_CLOSURE` (`packages/core/src/session.ts:732`) declares that the ticket's scope is exactly the plan / modified files / next steps it printed, and is NOT any corpus-global injection field. That declaration shipped and works.

It has no **lower** bound. Nothing in the system asserts that a consumer accounted for every item the ticket printed, and nothing can: the render path prints a prose projection from which the item count is absent.

This is the shared root cause of `knowledge-root-cause-synthesis-the-eight-dogfooding-findings` applied to the ticket-consumption pipe:

| | |
|---|---|
| Invariant | the consumer accounts for EVERY item of the ticket, and adds nothing unlabelled |
| Proxy shipped | the ticket declares its upper bound |
| Delta unrepresented | the lower bound — per-item coverage — exists nowhere: not in the render, not in a predicate, not in a hook |

Once the upper-bound declaration shipped it inherited the invariant's authority. A consumer that reads `RESUME_SCOPE_CLOSURE`, obeys it, and still drops half the ticket produces no detectable signal.

**Measured 2026-07-30, this repo.** The user pasted `knowledge-handoff-agent-main-orchestrator-40` (`extra.key_decisions` = 4, `extra.next_steps` = 6 → 10 items). The assistant's root-cause report covered KD3, NS1, NS2, NS3, NS4 and **silently dropped KD4, NS5, NS6**, while adding five findings from its own this-turn git queries without the per-item source labelling `SOURCE_CATEGORY_TOKENS` requires. `RESUME_SCOPE_CLOSURE` was present in the consumed output and was obeyed — the assistant did not self-resume and did not attribute any injection field to the ticket. **Compliant and still wrong**, because the declaration constrains trespass while the failure was under-coverage: orthogonal directions.

Two properties of the drop make it mechanizable rather than a one-off lapse:

- **The dropped items were the tails of both arrays** — `key_decisions[4/4]`, `next_steps[5/6]` and `[6/6]`. Not a random sample: a position effect. The one dropped decision was the array's most heavily worded entry (`concrete proof that scoped selection under-covers integration tests … full-suite-by-main-agent is not ceremony`), so author emphasis did not survive it.
- **The user detected it, with the same question as last time.** SPEC-CP's own Overview records that the handoff-38 incident was caught "only by the user asking 'is this everything, or only the handoff's?'". Here the user asked "只包含 Handoff 中的，不包含其他的对吗". Same pipe, same detector-of-last-resort, opposite direction: handoff-38 was trespass (over-inclusion), this was under-coverage. **The first repair fixed the over-inclusion side only.**

**Root cause, mechanically.** `renderResumeRecord` (`packages/lore/src/flows/feed-flow.ts:269-283`) pushes a header, then `record.content` — a markdown prose projection. The SSOT is structured: `handoffExtraSchema` carries `key_decisions: z.array(...).default([])` and `next_steps: z.array(z.string().min(1)).min(1)` (`packages/core/src/session.ts:209,211`), and that file's own JSDoc states `extra is SSOT, content is a projection`. Ordinal and cardinality are discarded at projection time, so "which item did I drop" is **not expressible** in the text the consumer reads, and coverage is not assertable by anyone — leaving the consumer to self-grade, which is the self-verification paradox this repo forbids by rule.

**Prior art that does NOT cover this.** All of SPEC-CP's D1/D3/D4 constrain the trespass direction. The governance §FEED source-labelling duty (`SOURCE_CATEGORY_TOKENS`) names three source categories but imposes no per-item obligation, so a report may label its sources correctly and still omit ticket items. `knowledge-root-cause-synthesis-…` Mechanization #3 lifts scope-declaration to verdicts — a different tier, and still one-sided.

**A measured constraint that rules out cross-process shared state.** An earlier draft of this spec routed the item set through `assets/hooks/lib/turn-state.mjs`. Verified 2026-07-30, that is unbuildable as specified: `resolveSessionId()` reads `CLAUDE_SESSION_ID`, which is **UNSET** in this harness (the field actually provided is `CLAUDE_CODE_SESSION_ID`), so every caller falls through to the `ppid-$PPID` branch — `~/.claude/session-state/sessions/` holds 73 directories, **0** of them non-`ppid-` named. A Stop hook is spawned by the Claude Code process while `lore` runs under a Bash-tool shell, so the two resolve DIFFERENT ppids: state written by one is invisible to the other. Under D6's "no recorded ticket → exit 0" rule that failure is **silent inertness** — the gate would ship and never fire. This spec therefore carries no cross-process state at all (D8). The `CLAUDE_SESSION_ID` mismatch is a real pre-existing defect in a shipped asset, recorded separately; it is NOT fixed here.

**Precedent for the enforcement shape.** `assets/hooks/stop-doc-sync.mjs` is a Stop-hook gate that blocks on an unmet per-turn obligation, and it is measured effective in this very session: it blocked the assistant and forced a `[DOC_SYNC]` line. It also establishes the two authoritative read channels this spec reuses: `payload.last_assistant_message` is a probe-verified field whose verdict is final, while `payload.transcript_path` is a fallback whose NEWEST entry may not be flushed yet (an observed flush race caused a false block).

**Delivery constraint (CLAUDE.md dogfooding rule).** A fresh `lore init` + `lore setup` project must not be able to hit this. The render change and the coverage-check verb are binary-side (ship with every upgrade). The new Stop hook is an `assets/hooks/` file installed by `lore setup`, so the assets manifest must be regenerated for its digest to ship — the same two-surface discipline SPEC-CP D5 established.

## Scope

**In scope**

- `packages/core/src/session.ts` — new exported constants: the coverage-floor declaration `RESUME_COVERAGE_FLOOR`, the item-id prefixes, the disposition-line grammar (marker literal plus the `done` / `deferred:` tokens), and a pure cardinality-line renderer taking the two array lengths. Existing `RESUME_SCOPE_CLOSURE` text is UNCHANGED.
- `packages/core/src/session.ts` — `renderHandoffContent(extra: HandoffExtra)` gains the ordinal tags and the cardinality line. **This is the ONLY rendering site.** It already receives the SSOT and pushes all seven sections line by line with zero parsing, and `ResumeHandoffRecord.content`'s own JSDoc names it "the SSOT projection, not `doc.content` read verbatim".
- `packages/lore/src/flows/feed-flow.ts` — ONE change: append `RESUME_COVERAGE_FLOOR` on the single-record path (never on `multi_actor`, D10). It renders no items; `renderResumeRecord` keeps printing `record.content`, which by then already carries the ordinals.
- **No separate MCP change, and none is in scope.** `renderResumeFeed` is already the single weave point that both `commands/feed.ts` (CLI stdout) and `adapters/mcp/tools.ts` (the MCP `feed` field) render through — pinned by that module's own invariant, written precisely because the two-surface drift was measured on this very path before. AC-RC-4 therefore asserts that the invariant still HOLDS for the new fields; it does not license a second implementation.
- A new coverage-check verb (`packages/lore/src/adapters/cli/`) that takes the Stop payload's two read channels and decides coverage, exiting non-zero and naming the undispositioned ids. It is the SOLE parser of both the ticket render and the disposition line.
- `assets/hooks/stop-handoff-coverage.mjs` (new) — a blind pipe: reads the Stop payload from stdin, forwards the two channels to the verb, relays stdout/stderr and the exit code. Contains no grammar and no parsing.
- `assets/governance/corpus-workflow.md` §FEED — the per-item disposition obligation.
- Assets manifest regeneration (new hook + edited governance asset).

**Out of scope**

- The `CLAUDE_SESSION_ID` / `CLAUDE_CODE_SESSION_ID` mismatch in `assets/hooks/lib/turn-state.mjs`. Real, measured (73/0), and shipped — but a distinct defect with its own blast radius (every hook relying on per-turn state) and its own fix. Recorded separately. **`turn-state.mjs` is not edited by this spec.**
- Extending `ResumeHandoffRecord` or any part of `packages/lore/src/service/session-service.ts`. See D1 for why widening that narrow projection is the wrong repair. **`session-service.ts` is not edited by this spec.**
- Corpus-side per-item acknowledgement (`lore handoff --ack`) and a cross-session coverage ledger. Explicitly rejected by the user on cost: 10 items = 10 corpus writes, most dispositions being "not this session", so the audit value does not repay the write noise.
- Changing `RESUME_SCOPE_CLOSURE`'s text or the upper-bound mechanism in any way.
- `degraded` handoff semantics (git-only capture, `key_decisions: []`) — counted by actual array length, no special branch.
- Every other item of handoff-40 (branch ownership, `AC-CP-10` evidence write-back, `plan-terminality` drift, SPEC-073's AC revision path — the last is already designed as `lore ac supersede` in `knowledge-root-cause-synthesis-…` Mechanization #4 and must NOT be re-invented here).

## Design Decisions

**D1 — items are rendered at the SSOT projection point, and never recovered by parsing text.** Item ids and counts derive from `extra.key_decisions[]` / `extra.next_steps[]` lengths and order (`KD<n>` / `NS<n>`, 1-based). Parsing a rendered body to recover items is forbidden: text-derived matching is exactly the contiguous-substring false-oracle vector this repo has already measured — a heading rename would silently yield zero items, and "0 of 0 covered" is indistinguishable from success.

**The rendering site is `renderHandoffContent`, not the consumer.** An earlier draft of this spec put it in `feed-flow.ts::renderResumeRecord`, which is unbuildable: that function's parameter is `ResumeHandoffRecord`, a narrow projection carrying `content: string` as its only body data — `key_decisions`, `next_steps`, `task_refs`, `modified_files` and `failing_oracle` never reach it (verified: they appear in `session-service.ts` only inside a JSDoc `@example`). The T2 implementer hit this and correctly reported BLOCKED rather than widening its anchors.

The fix is NOT to widen the narrow projection. Doing so would oblige the consumer to re-render all seven sections that `renderHandoffContent` already renders — a second rendering implementation of the same SSOT, which is the duplication D8 rejects one tier down for the parser. Rendering at the single existing projection point instead means the ordinals reach every consumer of `content` at once, with no interface change and no new data path.

**D2 — the cardinality line sits between the header and the data.** Same first-position argument SPEC-CP D1 makes for the scope declaration: a consumer reading top-down meets the count before the items, and a lost-in-middle truncation of later content cannot strip it. It is the one line whose absence makes the item list look complete.

**D3 — the lower bound is a SEPARATE exported constant from the upper bound.** `RESUME_COVERAGE_FLOOR` is not merged into `RESUME_SCOPE_CLOSURE`. The two constrain opposite directions; merged into one string, the absence of either half is undetectable by an identity assertion, and the measured failure mode is precisely "one direction present, the other absent".

**D4 — what is externally enforced is the EXISTENCE of an accounting, not the accuracy of each verdict.** The consumer still authors its own `done` / `deferred:<reason>` judgments; the hook cannot know whether a `done` is truthful. The guarantee is narrower and worth stating exactly: **no item may leave the session unmentioned.** That converts a silent omission — the measured failure, undetectable by anyone — into an explicit claim that is visible in the transcript and challengeable by the user. Claiming more than this would be the same proxy-for-invariant substitution this spec exists to name.

**D5 — the obligation is to ACCOUNT, not to complete.** Accepted dispositions are `done` and `deferred:<reason>`. Requiring completion would make any multi-session ticket unclosable and would push consumers toward bypass; requiring an explicit deferral costs one line and leaves the reason in the transcript. This is why the gate can be armed unconditionally without becoming noise: a ticket whose items are all legitimately out of this session's scope closes with six deferrals.

**D6 — the gate arms only when a ticket was actually rendered into this session's transcript.** No ticket found → exit 0, no ambient obligation on sessions that never ran `lore feed session-resume`. Because arming is derived from the transcript rather than from side-written state (D8), an armed gate cannot silently disarm through a state-path mismatch.

**D7 — no AC asserts against remembered wording.** Every AC pins to one of: identity against an exported constant, a zero-hit search for a named literal at a named path, or exhaustive iteration over a structured array. Additionally every blocking AC carries a control assertion proving the detector is live — a hook that exits 0 because it crashed early is indistinguishable from one that exits 0 because coverage was complete.

**D8 — zero cross-process state: the transcript is the only fact source, and each channel is used only where it is reliable.** The verb reconstructs the item-id set by reading back the ticket the binary itself printed, from `payload.transcript_path`; it reads the disposition line from `payload.last_assistant_message`. The split is not stylistic — it follows the measured reliability of each channel: the transcript's newest entry may be unflushed at Stop time (`stop-doc-sync.mjs`'s recorded false-block race), which is fatal for reading the CURRENT turn's disposition line but irrelevant for a ticket rendered in an EARLIER turn; conversely `last_assistant_message` carries only the final message and cannot reach the ticket. Using the wrong channel for either half reintroduces a race or a blind spot.

This also makes the reader and the writer the same component: the binary parses a format the binary emitted, so there is no second implementation to drift. Both consumption surfaces are covered without a per-surface capture point, because a ticket rendered through CLI stdout and a ticket rendered through the MCP `lore_feed` response both land in the transcript carrying the same constants and the same cardinality-line format (AC-RC-4).

**D9 — the hook is a blind pipe; the binary owns the entire grammar.** `stop-handoff-coverage.mjs` parses stdin JSON only far enough to forward two fields, then relays the verb's exit code and stderr verbatim. It holds no id format, no disposition tokens, no matching logic. Rationale: the grammar must be identity-assertable against exported constants (D7), which an installed `.mjs` copy cannot be — it drifts from the binary independently, the exact defect class SPEC-083 retired for governance prose. A `.mjs` re-implementation of the matcher would also be the second implementation D8 exists to avoid.

**D10 — the floor binds on a single-ticket render only; the multi-actor view is a divergence display, not a work unit.** `renderResumeFeed`'s `multi_actor` branch joins N actors' tickets so divergent state is surfaced rather than silently collapsed (that module's stated invariant). Ordinals and a PER-RECORD cardinality line are still rendered there — the information value is unchanged — but `RESUME_COVERAGE_FLOOR` is NOT emitted and the coverage check exits 0 for that output.

Two reasons, both structural rather than preferential. Item ids are per-record and 1-based, so N records collide on `KD1`; namespacing them would fork the grammar T3 parses into two shapes, and a parser with two shapes is the second implementation D8 exists to prevent. And demanding disposition of 10×N items from one session would make the gate noise and push consumers toward bypass — precisely what D5 is constructed to avoid. The single-record render is the executable work unit and the only place the floor binds.

This boundary was missed by the first draft of this spec and found while dispatching the render task. Recording it here rather than leaving the implementer to infer it: an unstated boundary is how the two cross-spec contradictions in SPEC-CP reached implementers, and in both cases the spec text — not the implementation — was the defect.

## Acceptance Criteria

Structured, machine-checkable ACs are registered via `lore ac add`; the prose here is the rationale, not the executable list.

- The rendered ticket's ordinal-tagged line count equals the SSOT array cardinality for both arrays, and each line carries its `KD<n>` / `NS<n>` id.
- The cardinality line matches the exported renderer's output by identity and appears before the first item line.
- Both boundary constants appear, are asserted independently by identity, and are proven distinct strings.
- CLI stdout and the MCP `lore_feed` session-resume response each carry the ordinals, the cardinality line, and the coverage floor.
- A `degraded` handoff with zero decisions renders a zero-decision cardinality line and does not fail.
- Item rendering does not leak into the consumer: `feed-flow.ts` contains no item-id prefix and no traversal of the handoff arrays, pinned as a zero-hit search — so no second rendering implementation can appear beside `renderHandoffContent`.
- The verb round-trips its own output: given a transcript containing a ticket it rendered, it recovers exactly the id set it emitted.
- The verb exits non-zero naming exactly the undispositioned ids (set equality on a named channel), with control runs for full coverage and for no-ticket-present.
- The hook contains no grammar: zero hits for the id prefixes and disposition tokens in its source, and it relays a non-zero verb exit code unchanged.
- After `lore setup` into a throwaway claude-dir, the new hook is byte-identical to its `assets/` SSOT, and the manifest digests for both changed assets are current.
- The multi-actor render carries ordinals and a per-record cardinality line but NOT the coverage floor, and the coverage check exits 0 for it — paired with a control assertion that the same fixture rendered as a single record DOES carry the floor, so the negative half cannot pass vacuously.


## Acceptance Criteria (structured)

- [✔] [script] AC-RC-3: The rendered ticket contains both RESUME_SCOPE_CLOSURE and RESUME_COVERAGE_FLOOR, each asserted by identity against its own exported constant in a separate assertion, and the two constants are proven distinct strings so a merged single-string implementation fails
  script: test — bunx vitest run packages/lore/tests/unit/feed-resume-coverage.test.ts -t "both bounds"
- [✔] [script] AC-RC-4: The compiled binary CLI stdout for lore feed session-resume AND the MCP lore_feed response for checkpoint session-resume each contain the ordinal tags, the cardinality line, and RESUME_COVERAGE_FLOOR, asserted per surface so passing on one surface alone fails
  script: e2e — cd packages/lore && bun test tests/e2e/resume-coverage-compiled.bun.test.ts -t "both surfaces"
- [✔] [script] AC-RC-8: After running lore setup against a throwaway claude-dir the installed stop-handoff-coverage hook is byte-identical to its assets SSOT path, and the embedded assets manifest sha256 entries for the new hook and the edited governance asset both equal the on-disk file digests
  script: e2e — cd packages/lore && bun test tests/e2e/resume-coverage-compiled.bun.test.ts -t "install parity"
- [✔] [script] AC-RC-7: Given three synthetic Stop payloads the coverage-check verb behaves as follows: with a transcript carrying a rendered ticket and a last_assistant_message disposition line that omits a subset of ids it exits non-zero and the id set parsed from its stderr is SET-EQUAL to the omitted subset so naming extra or fewer ids fails; with every id dispositioned it exits 0; with a transcript containing no ticket it exits 0
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "three-way"
- [✔] [script] AC-RC-9: Round-trip identity: given a transcript whose entries carry a ticket this build rendered from a handoff fixture, the coverage-check verb recovers an id set SET-EQUAL to the ids derived from that fixture extra.key_decisions and extra.next_steps array lengths, computed from the arrays rather than compared against a literal list
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "round-trip"
- [✔] [script] AC-RC-10: The hook source at assets/hooks/stop-handoff-coverage.mjs yields zero hits for every exported item-id prefix and every exported disposition token, proving it carries no grammar, AND with a stub binary earlier on PATH that exits 3 while writing a known stderr string the hook exits 3 and reproduces that stderr verbatim, proving it relays rather than decides
  script: test — bunx vitest run packages/lore/tests/unit/stop-handoff-coverage.test.ts -t "blind pipe"
- [✔] [script] AC-RC-11: The multi-actor render output contains the ordinal tags and one cardinality line per record but does NOT contain RESUME_COVERAGE_FLOOR, and the coverage-check verb exits 0 for that output, paired with a control assertion that the same handoff fixture rendered as a single record DOES contain RESUME_COVERAGE_FLOOR so the negative half cannot pass vacuously
  script: test — bunx vitest run packages/lore/tests/unit/feed-resume-coverage.test.ts -t "multi-actor no floor"
- [✔] [script] AC-RC-1: renderHandoffContent emits exactly one ordinal-tagged line per member of extra.key_decisions and extra.next_steps, tagged KD<n> and NS<n> 1-based in array order, asserted by comparing the rendered ordinal line count to the SSOT array lengths rather than to a literal number
  script: test — bunx vitest run packages/core/tests/unit/handoff-content-ordinals.test.ts -t "ordinal cardinality"
- [✔] [script] AC-RC-2: The cardinality line in renderHandoffContent output is strictly identical to the exported pure renderer applied to the two array lengths, and its line index is lower than the index of the first ordinal-tagged item line
  script: test — bunx vitest run packages/core/tests/unit/handoff-content-ordinals.test.ts -t "cardinality line position"
- [✔] [script] AC-RC-5: A degraded HandoffExtra whose key_decisions array is empty renders a cardinality line reporting zero decisions plus the actual next_steps count, emits no KD-tagged lines, and does not throw
  script: test — bunx vitest run packages/core/tests/unit/handoff-content-ordinals.test.ts -t "degraded zero decisions"
- [✔] [script] AC-RC-6: Reading packages/lore/src/flows/feed-flow.ts source, there are zero occurrences of the exported item-id prefixes and zero traversals of key_decisions or next_steps, proving item rendering did not leak into the consumer beside renderHandoffContent, plus a control assertion that the file IS non-empty and does reference RESUME_COVERAGE_FLOOR so an unread file cannot pass vacuously
  script: test — bunx vitest run packages/lore/tests/unit/feed-resume-coverage.test.ts -t "no item rendering in consumer"
- [✔] [script] AC-RC-12: The coverage-check verb exits 0 when handed a transcript whose ticket came from the multi-actor render path — this is the deferred verb half of AC-RC-11, which T2 could only satisfy on the render side because the verb did not yet exist; paired with a control assertion that the same verb exits non-zero for a single-record transcript with an incomplete disposition set, so the exit-0 result cannot come from the verb failing to find any ticket at all
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "multi-actor exits zero"
- [✔] [script] AC-RC-13: After lore setup against a throwaway --claude-dir the resulting settings.json contains a Stop hook registration whose command names stop-handoff-coverage.mjs, asserted by deriving the expected entry from the exported HOOK_REGISTRATIONS rather than a hand-written command string, so a rename that misses the registry fails; paired with a control assertion that the same parsed settings.json DOES carry the already-registered stop-doc-sync Stop entry, so the positive half cannot pass vacuously against an unparsed or empty settings file
  script: e2e — cd packages/lore && bun test tests/e2e/resume-coverage-compiled.bun.test.ts -t "stop hook registered"
- [✔] [script] AC-RC-14: The new stop-handoff-coverage hook asset is declared in every hardcoded asset roster that cross-checks RealAssetSource's directory enumeration, proving the tripwire those rosters exist to be was answered by declaring the asset rather than by loosening the check: both assets-ssot.test.ts and real-setup-ports.test.ts pass, and the run reports exactly 2 matched test files so a mistyped path cannot produce a partial-match exit 0
  script: test — bunx vitest run packages/lore/tests/unit/assets-ssot.test.ts packages/lore/tests/unit/adapters/real-setup-ports.test.ts

## Code anchors

- packages/core/src/session.ts#renderHandoffContent
- packages/lore/src/flows/feed-flow.ts#renderResumeFeed
- packages/lore/src/adapters/cli/commands/handoff.ts
- assets/hooks/stop-handoff-coverage.mjs
- packages/core/src/distribution-hooks.ts#HOOK_REGISTRATIONS
