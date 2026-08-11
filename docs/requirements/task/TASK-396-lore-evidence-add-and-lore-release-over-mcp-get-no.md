---
id: TASK-396
type: task
role: plan
title: "lore_evidence_add and lore_release over MCP get no callerCwd, so the uncommitted-worktree guard is silently absent on the surface AI agents actually use — the second optional-param-hides-an-unwired-adapter instance this session"
status: archived
priority: high
created: 2026-08-02
updated: 2026-08-02
tags: []
parent: PRD-001
links:
  - {id: TASK-399, type: relates-to}
  - {id: ADR-028, type: relates-to}
  - {id: TASK-398, type: relates-to}
---
Residual of `task-lore-evidence-and-lore-release-accept-an-attestation-from` (merged `9a34739`),
carved out because `packages/lore/src/adapters/mcp/tools.ts` was owned by a sibling agent at the
time. Flagged by that task's implementer and confirmed by the orchestrator.

## The gap

The uncommitted-worktree attestation guard landed on the CLI path: `commands/evidence.ts` and
`commands/release.ts` populate the new `EvidenceInput.callerCwd` / `ReleaseOpts.callerCwd` with
`process.cwd()`, which is what lets the service (a) measure the claim's recorded worktree and
(b) close the `--worktree`-was-never-passed hole by noticing the caller is inside a git repo.

The MCP tools `lore_evidence_add` and `lore_release` do not pass `callerCwd`. Both fields are
optional and additive — deliberately, so existing direct-service unit tests stay unaffected — so
everything compiles and every existing test passes. Consequence: an agent recording evidence through
MCP gets NO worktree measurement and NO Q3 close, i.e. exactly the pre-fix behaviour, silently.

MCP is not a minority surface here: it is the path AI agents use.

## ⛔ This is the SECOND instance of one pattern in a single session

| CLI gained | MCP left behind | why it compiled |
|---|---|---|
| convention-mismatch detection + forced `scope_fidelity` suppression (`ad14b7e`) | `tools.ts` kept the 2-arg `deriveCommitSetForPlan` call | both new params optional |
| uncommitted-worktree attestation guard (`9a34739`) | `tools.ts` passes no `callerCwd` | both new fields optional |

The mechanism is identical each time: **making a new parameter optional so existing call sites keep
compiling is what allows one adapter to be silently left behind.** "It compiles" proxies "it is
wired", and the omission is invisible because the type checker was deliberately told not to care.

So this task is not only "wire up MCP". It is the second data point arguing for the structural fix
already proposed in the sibling MCP task: once BOTH adapters pass the argument, make it REQUIRED and
delete the default, so a third adapter cannot repeat this. Do that here too.

## Proxy / Silence / Opt-in

- **Proxy** — "the build compiles and the suite is green" proxies "every adapter is wired". Concrete
  violating input: `tools.ts` as it stands today, which compiles and passes 12 existing assess tests
  plus all evidence/release tests while providing none of the new behaviour. Not accepted.
- **Silence** — total: the MCP path degrades to `not-measured-no-worktree` (or skips the Q3 check
  entirely), which is a LEGAL value, so no error, no warning, no failing test anywhere.
- **Opt-in** — the optionality of `callerCwd` is itself the opt-in. Closing it (required param) is
  the mechanization; wiring alone leaves the next adapter free to repeat this.

## Required

- Pass `callerCwd` from `lore_evidence_add` and `lore_release` in `tools.ts`. ⛔ Note MCP has no
  `process.cwd()` meaning the caller's directory — the MCP server's cwd is its own. Check whether an
  existing `caller_cwd` input exists on these tools (the evidence-precheck module header mentions an
  "MCP `caller_cwd` escape hatch"); if so, thread that. If there is genuinely no caller-supplied cwd,
  say so explicitly and record `not-measured-no-caller-cwd` as a DISTINCT value rather than reusing
  the CLI's — conflating "MCP cannot know" with "the claim had no worktree" is the same silence bug
  one level down.
- Then make the parameter required at its definition and fix all call sites, per the pattern above.

## Oracle

- RED first: an MCP `lore_evidence_add --result pass` against a claimed task whose recorded worktree
  is DIRTY currently succeeds; after the fix it is refused with the same message the CLI produces.
  Must fail before the change.
- CONTROL: the CLI path's behaviour is byte-identical (`packages/lore/tests/unit/service/task-workflow-uncommitted-worktree-guard.test.ts`, 21 tests, stays green).
- CONTROL: MCP calls with a CLEAN worktree, and with no claim at all, are accepted — no fabricated
  refusal (the CLI's Q3 close targets a claim that recorded no worktree, NOT the absence of a claim;
  do not widen that).
- CONTROL after making the param required: delete the argument at ONE call site, run
  `bun run typecheck`, observe the failure, restore it. Report the exact compiler error — an
  "enforced by typecheck" claim with no observed red is not evidence.
- Fixture corpora are throwaway (`mkdtemp` + `lore init`). ⛔ Never this repo's `.lore/`.
