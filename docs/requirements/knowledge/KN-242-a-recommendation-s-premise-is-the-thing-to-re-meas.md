---
id: KN-242
type: knowledge
role: knowledge
title: "A recommendation's PREMISE is the thing to re-measure, not its reasoning — the sidechain rule was designed against a transcript layout this harness does not have"
status: approved
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: SPEC-126
links:
  - {id: KN-241, type: relates-to}
  - {id: ADR-025, type: relates-to}
---
# A recommendation's PREMISE is the thing to re-measure, not its reasoning — the sidechain rule was designed against a transcript layout this harness does not have

## What happened

`knowledge-two-gaps-t1-surfaced-a-change-selector-blind-to-spawn` §2 identified
that the resume-coverage floor's arming/satisfaction predicates said nothing
about `isSidechain`, enumerated three candidate rules, and recommended option
(c) — arm from any chain, satisfy only from the main chain — as "a follow-up
slice with its own AC". `knowledge-handoff-agent-main-orchestrator-55` NS1
carried that forward as the next slice to open, and its KD4 recorded the
asymmetric shape at confidence 75.

The reasoning was sound. Its stated PREMISE was not:

> Claude Code writes subagent turns into the SAME transcript file as the main
> chain, flagged `isSidechain: true`.

Nobody had measured that. It was inherited unexamined through two documents and
one handoff, and it was the load-bearing sentence: the whole shadow-discharge
consequence ("a subagent's disposition lines also COUNT toward satisfying it")
follows from it and from nothing else.

## Measured, 2026-08-01

Across **3,928** transcript files under `~/.claude/projects/`:

| observation | count |
|---|---|
| `"isSidechain":true` occurrences | 427,493 |
| files carrying at least one, under `<session-id>/subagents/agent-<id>.jsonl` | 2,914 |
| files carrying at least one, NOT under `subagents/` | **0** |
| `"isSidechain":false` occurrences (main-chain files) | 240,615 |

Subagent turns go to a SEPARATE file per subagent. The main-chain
`<session-id>.jsonl` — the only path a Stop hook hands to
`lore handoff coverage-check` as `transcript_path` — carries `isSidechain:false`
exclusively.

A second, independent barrier also held: `scanTranscript` collects dispositions
only from `type:"assistant"` entries, while a subagent's report re-enters the
main chain inside a `type:"user"` `tool_result` block, which that loop never
reads for dispositions. Shadow-discharge was **doubly unreachable**.

Independently probed the same day and found REAL: the sibling half of the same
handoff item, the empty deferral reason — `parseDispositionedIds` accepted a
bare `deferred:` because it satisfies its own prefix check. That one was
reproduced against the shipped verb with a live control arm before any code was
written.

## Why the recommendation still produced a change worth making

The fix that landed is NOT the one recommended, and not merely a narrowed
version of it. What the measurement changes is the JUSTIFICATION, and therefore
the oracle:

- Recommended-as-written, the AC would have claimed to prevent a live vector.
  Its fixtures would have been synthetic, and nothing would have revealed that
  they modelled a transcript layout that does not exist. A green AC would have
  been evidence of nothing.
- What was built instead states the rule as a strict tightening whose value is
  explicit: today's safety rests on an UNSTATED environment assumption, and if a
  future harness merges the chains, unchanged code would satisfy the obligation
  from subagent output with no signal at all. The AC pins the intended asymmetry
  directly, converting "currently unreachable" into "rejected even if
  reachable".
- The environment fact itself is deliberately NOT an AC
  (`spec-resume-coverage-floor-the-satisfaction-boundaries-a` S3): an assertion
  about where the harness writes its transcripts tests the harness, and would go
  red on a harness change that is not a lore regression.

## The other half of the same handoff item was REFUSED

NS1 also filed the arming predicate's last-segment MCP tool-name comparison as a
collision to close. Measurement killed that one outright:
`grep -rln "mcpServers" assets/` returns zero files, so `lore setup` writes no
MCP registration and the server alias is CONSUMER-chosen. A full-name match
would silently disarm every alias-registered consumer — precisely the
silent-inertness failure mode the arming spec's own H4 exists to avoid — while
defending only against a foreign server that reproduces lore's tool name, its
argument name, its checkpoint value, its cardinality-line prose AND its floor
marker. Recorded as
`adr-the-coverage-floor-s-mcp-arming-compares-the-tool-name-s` so the next
session does not re-file it.

## Standing lesson

**A recommendation inherited across documents carries two things — its reasoning
and its premise — and only the reasoning gets re-read.** Before opening a slice
that a prior session recommended, restate the premise as a measurable claim and
measure it. The cost is one grep; the cost of skipping it is a mechanism whose
AC can only ever be satisfied by fixtures that model a world the code does not
run in, which is indistinguishable from a working oracle for as long as nobody
checks.

Corollary for handoff-driven work: a ticket item's confidence number rates the
JUDGMENT, not the FACTS under it (KD4 was 75 — honestly hedged — and the
hedging was about which of three rules to pick, not about whether the layout
claim was true). Re-measure premises even behind a high-confidence
recommendation, and especially behind one whose reasoning you agree with.
