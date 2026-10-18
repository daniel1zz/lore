---
id: SPEC-126
type: spec
role: spec
title: "Resume-coverage floor — the satisfaction boundaries: a deferral must carry its reason, and a sidechain chain cannot discharge"
status: approved
priority: high
created: 2026-08-01
updated: 2026-10-10
tags: []
links:
  - {id: SPEC-123, type: relates-to}
  - {id: ADR-025, type: relates-to}
  - {id: KN-241, type: relates-to}
  - {id: SPEC-207, type: implements}
---
# Resume-coverage floor — the satisfaction boundaries: a deferral must carry its reason, and a sidechain chain cannot discharge

## Overview

`spec-resume-ticket-coverage-floor-blocking-channel-arming` (approved v41, all
eight `AC-RCH-*` verified, its plan archived) fixed the resume-coverage floor's
DELIVERY channel and its ARMING predicate. It left the SATISFACTION side —
which disposition lines actually close an item, and which transcript chain they
may come from — with one measured hole and one undefined rule. This spec closed
both, and a 2026-08-25 amendment adds a THIRD (Hole 3, below), so it now closes
three. Its decisions are labelled `S1`–`S4` so they never collide with SPEC-112's
`D`-series or the arming spec's `H`-series.

**Hole 1 — an empty deferral reason closes an item. Measured 2026-08-01 by
probing the shipped verb with a live control arm.** `parseDispositionedIds`
accepts a disposition when `disposition.startsWith(RESUME_DISPOSITION_DEFERRED_PREFIX)`,
so a bare `deferred:` with nothing after the colon satisfies its own prefix
check. Four payload classes against one arming fixture carrying 2 items:

| payload | expected | measured |
|---|---|---|
| both items `deferred:` (no reason) | block | **no block** — items closed |
| both items `deferred:out of scope` | no block | no block ⚠️ **superseded by S4** |
| both items `done` | no block | no block |
| no disposition lines at all | block | block |

⚠️ Row 2 records the state of the world BEFORE S4. That payload carries a
non-empty reason and no destination, which S4 makes a BLOCK; the row is kept
verbatim because it is the measurement S1 was derived from, and annotated
because a stale intent baseline is exactly the "verdict that does not carry the
state it describes" this repo's first corpus property forbids.

The last row is the live control: the detector was armed and capable of
blocking on the same fixture, so the first row is a true negative rather than a
vacuous pass. The empty-reason accept contradicts three independent statements
of intent — SPEC-112 D5 ("a ticket whose items are all legitimately out of this
session's scope still closes cleanly **once every item carries its own deferral
reason**"), `RESUME_DISPOSITION_DEFERRED_PREFIX`'s own doc comment ("Requiring a
reason, rather than accepting a bare `deferred`, costs one line and leaves the
reason visible in the transcript"), and the block reason the verb itself prints
("a deferral must carry its reason after the colon"). Three prose assertions and
no mechanism: this is the prose-layer-is-the-wrong-layer shape.

**Hole 2 — the disposition-source rule was undefined for sidechain entries, and
the premise behind the recommended fix does not hold on this harness.**
`knowledge-two-gaps-t1-surfaced-a-change-selector-blind-to-spawn` §2 recommended
an asymmetric rule (arm from any chain, satisfy only from the main chain) on the
stated premise that "Claude Code writes subagent turns into the SAME transcript
file as the main chain, flagged `isSidechain: true`". **Measured 2026-08-01
across 3,928 transcripts under `~/.claude/projects/`: that premise is false on
this harness version.** All 427,493 `"isSidechain":true` occurrences live in
2,914 files under `<session-id>/subagents/agent-<id>.jsonl`; **zero** appear in
any main-chain `<session-id>.jsonl` file, which carry `"isSidechain":false`
(240,615 occurrences) exclusively. A second, independent barrier also holds
today: `scanTranscript` collects dispositions only from `type:"assistant"`
entries, while a subagent's report re-enters the main chain inside a
`type:"user"` `tool_result` block, which that loop never reads for dispositions.

Shadow-discharge is therefore **doubly unreachable today**, and building a
mechanism against an unreachable vector would be a mechanism whose oracle can
only ever be a synthetic fixture. What IS worth mechanizing is the opposite: the
current safety rests on an UNSTATED environment assumption, and if a future
harness merges the chains, today's code satisfies the obligation from subagent
output with no signal at all. So the rule is stated and enforced as a
one-predicate tightening whose test fixtures pin the intended asymmetry
directly, converting "currently unreachable" into "rejected even if reachable".

**Not a defect: the MCP namespace comparison.**
`knowledge-handoff-agent-main-orchestrator-55` NS1 also filed the arming
predicate's last-segment tool-name comparison as a collision to close. That is
refused with its reasoning recorded in
`adr-the-coverage-floor-s-mcp-arming-compares-the-tool-name-s`: `lore setup`
writes no MCP registration (`grep -rln "mcpServers" assets/` → zero files), so
the server alias is consumer-chosen, and a full-name match would silently
disarm every alias-registered consumer — the exact silent-inertness failure mode
the arming spec's H4 exists to avoid — while defending only against a foreign
server that reproduces lore's tool name, argument name, checkpoint value,
cardinality-line prose AND floor marker.

**Delivery surface.** Binary-side only:
`packages/lore/src/adapters/cli/commands/handoff.ts` and its `@lore/core`
constants. No `assets/` edit, no manifest regeneration, no `lore setup` — a
consumer who ran `lore init` + `lore setup` at any earlier version gets both
fixes by upgrading the binary alone.

**Hole 3 — a deferral reason closes an item while parking the work nowhere.
Measured 2026-08-25 over this corpus's own handoff population.** S1 made a
deferral carry a REASON. It did not make the reason carry a DESTINATION, so
`deferred:out of scope for this session` closes an item and the deferred work
enters no queue: it crosses the session boundary as prose and arrives at the next
session as undifferentiated "work" rather than as a filed defect with an owner.
Measured across all 139 handoff docs (`extra.handoff.next_steps`): **696
next-step items, 238 (34.2%) carrying a resolvable slug or issue reference and
458 (65.8%) bare prose that parks nothing anywhere** — 39 handoffs carry ONLY
bare items, 88 are mixed, 12 are fully referenced. S4 closes this.

## Scope

In scope:

- `packages/lore/src/adapters/cli/commands/handoff.ts` — `parseDispositionedIds`
  (the accepted-disposition predicate) and `scanTranscript` (the
  disposition-source filter).
- `packages/core/src/session.ts` — MANDATORY, not conditional, since the
  2026-08-25 amendment: S4's destination grammar and its distinct refusal-prefix
  constant are both exported from here, because the verb must compose from
  exports, never literals (SPEC-112 D7/D9). The original wording ("only if the
  non-empty-reason rule needs a new exported constant") described the S1-only
  slice and did not authorize S4's edit.
- `packages/lore/tests/unit/handoff-coverage-check.test.ts` — the oracle for
  every AC below.

Out of scope:

- `isSessionResumeFeedToolUse`'s MCP name comparison — decided against in
  `adr-the-coverage-floor-s-mcp-arming-compares-the-tool-name-s`, and no AC here
  touches it.
- The ARMING side generally: which calls arm, the cardinality-sum check, and the
  SPEC-112 D10 multi-actor exemption are unchanged, and the eight `AC-RCH-*`
  criteria remain their oracle. AC-RCS-3 pins that they stay green rather than
  restating them.
- The ticket render itself (ordinals, cardinality line, floor declaration).
- `assets/hooks/stop-handoff-coverage.mjs` — not edited; it is a blind relay.
- `assets/governance/corpus-workflow.md` prose — already states that a deferral
  carries a reason; this spec makes the implementation match the prose rather
  than rewriting the prose to excuse the implementation.

## Design Decisions

**S1 — an accepted deferral requires a non-empty reason after the prefix, and
whitespace is not a reason.** `parseDispositionedIds` accepts a deferral only
when the text following `RESUME_DISPOSITION_DEFERRED_PREFIX`, trimmed, is
non-empty. A bare `deferred:` and a whitespace-only `deferred:   ` are both
UNRECOGNIZED dispositions, which the existing parser contract already routes to
the loud path: the id stays in `missing`, surfaces on stderr, and appears in the
block reason. Rejected alternative — accept the bare form and warn: the parser
has exactly one output channel (the id set), a warning would need a second
channel the Stop contract does not read, and "accepted but warned" is
indistinguishable from "accepted" to the operator who has to trust the verdict.

**S2 — dispositions are satisfied only from main-chain entries; arming is
satisfied from any chain.** `scanTranscript` skips a disposition-bearing
`assistant` entry whose `isSidechain` field is exactly `true`; ticket detection
is NOT filtered on that field. The asymmetry is the whole point: a subagent that
consumes a ticket obliges the main agent to account for it in output the
operator actually reads, and no subagent output can discharge that obligation.
`last_assistant_message` continues to be read unfiltered — it is main-chain by
the Stop contract, which fires only for the main chain. The comparison is
`=== true` rather than truthiness so an absent field (every pre-existing
transcript, and any harness that never writes it) keeps today's behaviour
instead of silently disarming the whole disposition source.

**S3 — the environment assumption S2 rests on is recorded as a measurement, not
mechanized as an AC.** That main-chain transcript files carry no sidechain
entries is a fact about the harness, not about lore; an AC asserting it would
test the harness and would go red on a harness change that is not a lore
regression. It is recorded in this spec's Overview and in the accompanying
retro. S2's tightening is what protects lore if that fact changes, and AC-RCS-2
is its oracle.

**S4 — an accepted deferral must also name WHERE the deferred work went; a
reason alone is not a destination.** `parseDispositionedIds` accepts a deferral
only when the text after `RESUME_DISPOSITION_DEFERRED_PREFIX`, having already
satisfied S1's non-empty check, ALSO contains at least one destination token:
an issue reference (`#<digits>`, or a `/issues/<digits>` URL path) or a corpus
slug (`prd|spec|adr|plan|task|knowledge` followed by `-` and a kebab tail). A
deferral carrying a reason and no destination is an UNRECOGNIZED disposition on
the same loud path S1 uses, but behind its OWN stderr prefix: "no reason given"
and "a reason that parks the work nowhere" are different operator mistakes with
different fixes, and a shared prefix would make the verdict non-injective
against this repo's own first corpus property.

Measured baseline, 2026-08-25, over all 139 handoff docs in this corpus (`extra.handoff.next_steps`):
696 next-step items, of which 238 (34.2%) carry a resolvable slug or issue
reference and **458 (65.8%) are bare prose that parks nothing anywhere**. 39
handoffs carry ONLY bare items, 88 are mixed, 12 are fully referenced. That
population is the propagation vector this decision closes: unfiled work has been
crossing session boundaries as prose, entering no queue, and arriving at the next
session as undifferentiated "work" rather than as a filed defect with an owner.

**Known false pass, recorded rather than papered over:** the check is GRAMMAR
ONLY — it does not resolve the destination against the corpus or the issue
tracker, so a slug-shaped string naming a document that does not exist satisfies
it. That is deliberate for this slice: the check must stay a pure function of
the transcript text, because resolution would give the Stop-path verb store IO
and a network dependency, and would false-block a legitimate GitHub issue number
that no corpus row carries. The measured dominant failure is ABSENCE (458 of
696), not fabrication; fabricating a destination is a distinct and rarer defect
whose oracle would have to live somewhere with corpus access.

**Re-baseline of AC-RCS-1, recorded because modifying a criterion that already
carries evidence is indistinguishable from covering up a failure unless the
record is explicit.** AC-RCS-1 (state `fail_superseded`, 1 attested pass, 1
falsified at the time of this amendment) pinned a control arm asserting that
"the same lines carrying a non-empty reason yield EMPTY stdout" — i.e. that a
bare non-empty reason CLOSES its item. S4 makes that exact payload a block, so
the two were mutually unsatisfiable: no implementation could turn both green.
Caught by `lore review` on v11, not by the author. The correction is to
respecify AC-RCS-1's non-empty-reason control payload to carry a destination
token. **Why this is a correction and not a weakening:** the control payload
becomes STRICTER (it must now satisfy S1 and S4 rather than S1 alone), no
assertion is dropped, and AC-RCS-1's blocking halves are untouched. Because its
statement's meaning changed while `verify.command` did not — and
`oracle_generation` bumps only on a command change — AC-RCS-1's pre-amendment
attestation certifies the OLD assertion and does not carry forward: the task
claiming AC-RCS-4 must re-attest AC-RCS-1 in the same run.

Rejected alternative — refuse at handoff WRITE time instead (make `lore handoff`
reject a bare `--next`): it attacks the same vector one step earlier, but by the
measurement above it would have refused 127 of 139 historical handoffs, so it
needs a back-catalogue exemption designed first. Recorded here as the intended
follow-up, not as this spec's work.


## Acceptance Criteria

Structured criteria are declared on this spec (`lore ac list`); each asserts an
observable outcome of the shipped verb, and each carries a live control arm so
that a negative half cannot pass by failing to detect anything at all.

- **AC-RCS-1** — a bare and a whitespace-only deferral both leave their items
  unaccounted, with non-empty-reason and `done` control arms that do close.
- **AC-RCS-2** — sidechain-only dispositions do not satisfy, a sidechain-produced
  ticket still arms, and the byte-identical main-chain fixture does satisfy.
- **AC-RCS-3** — the eight pre-existing `AC-RCH-*` oracles stay green, pinning
  that the tightening is additive.
- **AC-RCS-4** — a deferral whose reason names no destination leaves its item
  unaccounted behind a stderr prefix DISTINCT from the bare-deferral one, with
  three live control arms that do close: the same reason plus an issue
  reference, the same reason plus a corpus slug, and `done`. Falsifier: deleting
  the destination-token requirement makes the negative arm pass, and collapsing
  the two stderr prefixes into one makes the distinctness assertion red.


## Acceptance Criteria (structured)

- [⊘] [script] AC-RCS-1: Against one arming fixture carrying N>=2 items, iterating over a structured array of last_assistant_message payload classes: a payload dispositioning EVERY item with the deferred prefix and nothing after the colon, and a payload dispositioning every item with the deferred prefix followed only by whitespace, BOTH yield a stdout payload parsing as a block decision whose named id set is SET-EQUAL to the full item set, so an empty reason closes no item and naming extra or fewer ids fails; paired with three live control arms on the same fixture — the same lines carrying a non-empty reason THAT ALSO CARRIES AN S4 DESTINATION TOKEN yield EMPTY stdout, the same lines carrying the done token yield EMPTY stdout, and a payload with no disposition lines at all yields a block decision — so the blocking halves cannot pass by a detector that blocks unconditionally nor the control halves by a parser that accepts everything; the deferred prefix and done token are referenced by identity from their @lore/core exports rather than typed as literals; the run reports exactly 1 matched test file. ⚠️ RE-BASELINED 2026-08-25: the non-empty-reason control arm formerly carried NO destination token, which S4 makes a block — the two were mutually unsatisfiable. The re-baseline record, including why this is a strengthening rather than a weakening, is in S4; this criterion's pre-amendment attestation certifies the OLD assertion and must be re-attested.
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "deferral reason"
- [⊘] [script] AC-RCS-2: Iterating over a structured fixture array that pins the intended asymmetry in three cases: (i) a transcript whose ONLY post-ticket disposition-bearing assistant entries carry isSidechain exactly true yields a stdout block decision whose named id set is SET-EQUAL to the full item set, proving a sidechain chain cannot discharge the obligation; (ii) the byte-identical transcript with those same entries carrying isSidechain false yields EMPTY stdout, so the negative half cannot pass by a parser that stopped reading transcript dispositions at all; (iii) a ticket whose producing tool_use and tool_result entries BOTH carry isSidechain true still ARMS, yielding a block decision when nothing dispositions it, proving arming is unfiltered by chain while satisfaction is filtered; a fourth case with the isSidechain field entirely ABSENT from the disposition-bearing entries yields EMPTY stdout, pinning that the comparison is strict equality to true and that a harness which never writes the field keeps working; the run reports exactly 1 matched test file
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t "sidechain"
- [⚑] [script] AC-RCS-3: The pre-existing handoff-coverage-check suite that is the oracle for all eight AC-RCH criteria of spec-resume-ticket-coverage-floor-blocking-channel-arming passes in full and unfiltered after ALL THREE tightenings land (S1, S2, S4), with zero failing tests and a reported passing-test count strictly greater than the SUM OF THE CASE COUNTS of the three describe blocks this spec adds — 'deferral reason' (AC-RCS-1), 'sidechain' (AC-RCS-2), 'deferral destination' (AC-RCS-4). The floor is mechanically derived, not a stated integer: run each of the three titles under -t, sum their reported passing counts, require the unfiltered run to exceed that sum. GUARD ON THE DERIVATION ITSELF: -t matches substrings against full test names, so an addend inflated by a same-named case elsewhere would raise the floor above what the unfiltered run can reach and make this criterion unsatisfiable for a reason unrelated to regression. Each of the three titles MUST therefore be substring-unique across the whole suite, asserted by a repo grep reporting exactly 1 occurrence per title before the sum is taken. The run reports exactly 1 matched test file. RE-BASELINED 2026-08-25: the former threshold summed only AC-RCS-1 and AC-RCS-2, silently excluding AC-RCS-4's five fronts and making the anti-vacuity guard weaker than its own intent; adding the third addend and the uniqueness guard both raise the floor, so this is a strengthening.
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts
- [·] [script] AC-RCS-4: A DEFERRAL WHOSE REASON NAMES NO DESTINATION DOES NOT CLOSE ITS ITEM, AND ITS REFUSAL IS DISTINGUISHABLE FROM THE BARE-DEFERRAL REFUSAL. Five fronts in describe 'deferral destination' of packages/lore/tests/unit/handoff-coverage-check.test.ts: (a) NEGATIVE — a one-item ticket dispositioned 'deferred:out of scope for this session' (non-empty S1-satisfying reason, no destination token) leaves its id unaccounted and blocks. (b) INJECTIVITY, ASSERTED ON THE EMITTED BYTES, NOT ON THE CONSTANTS — the stderr the verb ACTUALLY EMITS for (a) startsWith the destination-refusal prefix exported from @lore/core, AND that constant is not byte-equal to the bare-deferral prefix S1 routes to. Both required. Constants-only comparison proves only that they differ and stays green if the verb mis-routes a destination failure through S1's prefix — the exact failure this front catches. Never assert containment. (c) CONTROL 1 — the same reason plus an issue reference ('... see issue #5') closes and does not block. (d) CONTROL 2 — the same reason plus a corpus slug ('... tracked in task-some-filed-thing') closes and does not block. (e) CONTROL 3 — 'done' on the same fixture closes and does not block. Controls exist because a negative-only oracle passes vacuously when the detector detects nothing. IMPLEMENTATION CONTRACT (pins the falsifier): the predicate is reached via EXACTLY ONE call site written literally as '!hasDeferralDestination(' in packages/lore/src/adapters/cli/commands/handoff.ts, and both the grammar and the refusal prefix come from constants exported by packages/core/src/session.ts, never literals inlined in the verb (SPEC-112 D7/D9). The describe title must be substring-unique across the suite so -t selects exactly this block, asserted by a repo grep reporting exactly 1 occurrence. GRAMMAR ONLY: nothing is resolved against the corpus, so a slug-shaped string naming no real document satisfies it — S4's recorded known false pass.
  script: test — bunx vitest run packages/lore/tests/unit/handoff-coverage-check.test.ts -t 'deferral destination' > "${TMPDIR:-/tmp}/ac-rcs-4.log" 2>&1; cat "${TMPDIR:-/tmp}/ac-rcs-4.log"; grep -qE 'Tests +[1-9][0-9]* passed' "${TMPDIR:-/tmp}/ac-rcs-4.log" && ! grep -qE 'Tests +[0-9]+ failed' "${TMPDIR:-/tmp}/ac-rcs-4.log" && echo 'AC-RCS-4 PASS: the deferral-destination arm ran with a positive pass count and zero failures'

## Code anchors

- packages/lore/src/adapters/cli/commands/handoff.ts
