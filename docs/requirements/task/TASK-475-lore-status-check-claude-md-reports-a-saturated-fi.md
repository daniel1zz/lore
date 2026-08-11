---
id: TASK-475
type: task
role: plan
title: "lore status --check-claude-md reports a saturated file as healthy: 5 bytes of headroom prints as 'within budget (0 findings)', so the standing-lessons layer is silently closed"
status: archived
priority: high
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Task

`lore status --check-claude-md` reports a saturated file as healthy. The repo's
CLAUDE.md sits at **24571 of 24576 bytes — five bytes of headroom** — and the
check prints:

```
CLAUDE.md: within budget (0 findings).
```

A binary pass/fail on a ceiling gives an author no way to distinguish "plenty of
room" from "the next character breaches". Both render identically.

## Measured, 2026-08-01

An orchestrator read `within budget (0 findings)`, treated it as headroom, and
appended one ~410-byte standing lesson to an existing bullet. The
`claude-md-guard.sh` PostToolUse hook caught it immediately and loudly:

```
CLAUDE.md: BREACHED (1 finding(s)):
  - CLAUDE.md is 24978 bytes, exceeding the root max_bytes ceiling of 24576
```

The guard worked exactly as designed — this is not a guard defect. The defect is
upstream: the *status* surface that an author consults BEFORE editing gave no
signal that the layer was full, so the breach was discovered by the write rather
than predicted by the check.

## The consequence, which is structural and not cosmetic

CLAUDE.md is this repo's standing-lessons layer — the discipline surface that
reaches every session. It is now **closed to new lessons**: any addition
breaches. Two lessons discovered in this session alone had nowhere to land and
live only as corpus knowledge docs:

- `knowledge-grep-in-the-agent-shell-is-ugrep-ignore-files-and-its`
- `knowledge-a-control-that-shares-the-load-with-the-observation`

The corpus is the SSOT and both are searchable there, but a standing lesson's
whole value is that it is injected without being searched for. A full ceiling
converts every future lesson into one that must be looked up by someone who does
not yet know it exists.

The tempting fix — quietly shaving a peer lesson to make room — is worse: it
evicts a lesson without any record of the eviction decision, and it is exactly
the pressure that produces silent deletion of hard-won discipline. It was
declined here for that reason.

## Mechanism required

1. **Report headroom, not a verdict.** `--check-claude-md` should print the
   used/ceiling numbers and remaining bytes on every run, so an author sees
   `24571/24576 (5 bytes)` and knows before writing. A pass that hides the margin
   is a pass that mispredicts the next write.
2. **Warn on a near-ceiling band** (some configured fraction) as a finding, not
   silence — the file crossed from "roomy" to "saturated" with no event anywhere.
3. **Decide and record the eviction policy.** A fixed-ceiling layer that only ever
   grows needs a written rule for what leaves when something enters — promotion of
   an aging lesson into the corpus, a per-lesson byte budget, or an explicit
   "this layer is closed; new lessons go to the corpus and are surfaced via
   session-start injection instead". Any of these is defensible; the current state
   (no rule, so the last writer improvises under a hook denial) is not.

## Oracle

- RED first: a config/fixture at N-5 bytes of a ceiling passes `--check-claude-md`
  today with no margin shown — assert the CURRENT silent output verbatim as the
  starting point.
- After: the same fixture reports its remaining headroom as a parseable number,
  and a fixture inside the warning band produces a finding while still exiting 0.
- CONTROL: a comfortably-small file still reports zero findings and does NOT
  warn — the band must not degrade into "always warns", which is the same
  information loss in the other direction.

## Source

Orchestrator attempted to land the `grep`-wrapper standing lesson during the
2026-08-01 remediation session; the edit was reverted rather than resolved by
trimming a peer lesson. Related: `adr-claude-md-specs-section-is-pointer-only-per-spec-index`
and the CLAUDE.md content contract (`lore governance claude-md`), whose own text
already warns that "passing the ceiling check is not the same as meeting the
target" — advice the check itself does not operationalize.
