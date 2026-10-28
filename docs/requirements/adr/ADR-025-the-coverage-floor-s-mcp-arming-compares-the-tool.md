---
id: ADR-025
type: adr
role: decision
title: "The coverage floor's MCP arming compares the tool name's LAST segment deliberately — a full-name match would silently disarm alias-registered consumers"
status: approved
priority: high
created: 2026-08-01
updated: 2026-10-28
tags: []
parent: PRD-001
---
> ⚠ INVALIDATED 2026-10-28T09:53:36.740Z — superseded by adr-retire-the-lore-mcp-server-the-cli-and-http-are-the-only; The lore MCP server is deleted (bba93a16); no lore_feed MCP tool exists, so the MCP-shaped arming half of the resume coverage floor has no tool name to compare.

# The coverage floor's MCP arming compares the tool name's LAST segment deliberately — a full-name match would silently disarm alias-registered consumers

## Context

`spec-resume-ticket-coverage-floor-blocking-channel-arming` H4 arms the resume
coverage floor only when a candidate `tool_result` is paired by `tool_use_id`
with a `lore feed session-resume` call. Its MCP-shaped half
(`isSessionResumeFeedToolUse`, `packages/lore/src/adapters/cli/commands/handoff.ts`)
splits the tool name on `__` and compares only the LAST segment to `lore_feed`:

```ts
const nameSegments = name.split(MCP_TOOL_NAME_SEGMENT_SEPARATOR);
if (nameSegments[nameSegments.length - 1] === FEED_MCP_TOOL_NAME) {
  return isPlainRecord(input) && input.checkpoint === SESSION_RESUME_CHECKPOINT;
}
```

`knowledge-handoff-agent-main-orchestrator-55` NS1 filed this as a defect —
"the MCP namespace collision where `mcp__other__lore_feed` arms because only
the last `__` segment is compared" — and recommended tightening it in the same
slice as the sidechain rule. This decision records why that tightening is
REFUSED, so the next session does not re-file it.

## Measured, 2026-08-01

**1. The MCP server's registration name is chosen by the CONSUMER, not by lore.**
`lore setup` writes no MCP registration at all: `grep -rln "mcpServers" assets/`
returns zero files. The server name lives in the consumer's own
`.mcp.json` / `~/.claude.json`. On this machine it happens to be `lore`
(so calls arrive as `mcp__lore__lore_feed`), but that string is hand-authored
by the user and any alias — `mcp__team-lore__lore_feed`,
`mcp__lore-prod__lore_feed` — is equally valid and equally supported.

**2. Arming is a THREE-part compound predicate, not a name check.** A
`tool_result` arms only when all three hold (`handoff.ts` `scanTranscript` +
`runCoverageCheck`):

- its producing `tool_use` passes `isSessionResumeFeedToolUse` — for the MCP
  shape that additionally requires `input.checkpoint === SESSION_RESUME_CHECKPOINT`;
- its text matches `renderResumeCoverageCardinalityLine`'s own runtime-derived
  matcher AND the two captured counts sum to the captured total;
- its text contains `RESUME_COVERAGE_FLOOR` (the SPEC-112 D10 multi-actor
  exemption check).

## Decision

**The last-segment comparison stays.** The MCP arming predicate keys on the
tool-name segment plus the `checkpoint` argument shape, and deliberately does
NOT constrain the server namespace.

## Rationale — the two failure modes are not symmetric

| Option | What it prevents | What it costs |
|---|---|---|
| **(a) Full-name match** (`lore_feed` or `mcp__lore__lore_feed` only) | A foreign MCP server whose tool is ALSO named `lore_feed`, ALSO accepts `checkpoint: "session-resume"`, AND ALSO returns lore's own cardinality line plus `RESUME_COVERAGE_FLOOR` | Every consumer who registered the lore MCP server under any other alias silently loses arming |
| **(b) Namespace must contain the token `lore`** | The same impersonation, unless the impersonator also puts `lore` in its server name | Still breaks a consumer whose alias omits `lore` (e.g. `mcp__knowledge__lore_feed`); adds a rule with no crisp boundary |
| **(c) Last-segment match — status quo, CHOSEN** | Nothing beyond what the compound predicate already blocks | Nothing |

Option (a)'s cost is not a hypothetical inconvenience — it is **precisely the
failure mode H4 names as the reason it matches on lone tokens rather than a
contiguous phrase**: a predicate that stops recognizing a legitimate call
degrades silently to "no ticket → no block", and the operator sees a clean exit
0 instead of an accounting duty. Trading a real silent-disarm risk against an
impersonation that requires a foreign server to reproduce lore's tool name, its
argument name, its checkpoint value, its cardinality-line prose AND its floor
marker is a net loss of safety.

What option (a) would actually defend against is impersonation, and a name
comparison is the wrong instrument for impersonation: an attacker free to name
its tool `lore_feed` is equally free to name its server `lore`.

## Consequences

- `isSessionResumeFeedToolUse` is NOT changed by
  `spec-resume-ticket-coverage-floor-satisfaction-boundaries`; that slice
  carries only the satisfaction-side rules.
- The invariant to protect is the COMPOUND predicate, not the name: any future
  change that drops the `checkpoint` check, the cardinality-sum check, or the
  `RESUME_COVERAGE_FLOOR` check turns the last-segment comparison from
  sufficient into insufficient. AC-RCH-5's fixture array is the standing oracle
  for the first; AC-RCH-4 and the D10 multi-actor fixture for the rest.
- Two INDEPENDENT supersession triggers, deliberately not conjoined — they are
  the two hazards this decision trades against, and either one alone reopens it
  (with the observation attached) rather than being quietly patched:
  1. **Impersonation observed** — any foreign MCP server observed satisfying the
     full compound predicate (tool-name segment, `checkpoint` value,
     cardinality line with a consistent sum, and `RESUME_COVERAGE_FLOOR`) and
     thereby arming a floor nothing handed the session.
  2. **A namespace constraint would have been load-bearing** — any observed
     false arm where constraining the server namespace was the ONLY thing that
     would have prevented it. This is strictly weaker than (1): it fires even
     when the compound predicate was not fully satisfied, e.g. if a future
     change relaxes one of its other conjuncts.

  The cost side has its own trigger, tracked separately: an alias-registered
  consumer silently losing arming is what option (a) would CAUSE, so it is
  evidence AGAINST revisiting, not for it — if it is ever observed under the
  status quo, the fault lies elsewhere in the predicate and this ADR is not the
  place to look.
