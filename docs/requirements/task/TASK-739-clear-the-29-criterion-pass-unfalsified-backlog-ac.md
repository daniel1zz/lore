---
id: TASK-739
type: task
role: plan
title: "Clear the 29-criterion pass_unfalsified backlog across twelve specs, with a RUN falsifier for each"
status: deprecated
priority: high
phase: "backlog-and-arm"
created: 2026-08-21
updated: 2026-10-10
tags: []
parent: PLAN-079
plan: PLAN-079
---
# Task Objective

Drive `pass_unfalsified_count` from 29 to 0 so `AC-OX-6` can be satisfied. A
`pass_unfalsified` criterion is GREEN but was never observed able to fail — the state exists
precisely because "the oracle passed" and "the oracle can discriminate" are different claims.

# Spec Reference

`spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a` §M6.4 (second half),
D6 ("clear the backlog first, THEN arm"), `AC-OX-6`.

`AC-OX-6`'s oracle reads the JSON field itself:

    lore status --json > /tmp/ox6.json; test "$(python3 -c 'import json;print(json.load(open("/tmp/ox6.json"))["data"]["pass_unfalsified_count"])')" = 0

⛔ A literal count typed into any document is NOT acceptable evidence. The 29 below is a
measurement with a timestamp, not a constant — RE-ENUMERATE before starting and after
finishing.

# The population — enumerated, not counted

Measured 2026-08-21 via `lore status --enumerate pass_unfalsified_count` (exit 0, 29
members). ⛔ Use that command, not this list, as the working set — this list is a snapshot
for scoping only.

| Spec | Criteria | n |
|---|---|---|
| `spec-spec-038-ac-as-code-structured-acceptance-criteria-oracle-b` | AC-ACODE-1 … AC-ACODE-11 | 11 |
| `spec-spec-064-dashboard-settings-ui-two-scope-config-editing-wit` | AC-064-1, -2, -3, -5, -6 | 5 |
| `spec-spec-046-distribution-part-1-asset-ssot-local-safe-installe` | AC-046-SG1, -SG2, -SG3 | 3 |
| `spec-spec-045-memory-hygiene-part-3-doc-code-drift-oracle-h3` | AC-DR-9 | 1 |
| `spec-spec-040-assessment-dimension-framework-v2-facts-judgment-s` | AC-ADF-9 | 1 |
| `spec-spec-041-session-layer-part-1-bootstrap-pointer-set-lossles` | AC-SL-8 | 1 |
| `spec-spec-042-session-layer-part-2-session-registry-file-anchor` | AC-S3-12 | 1 |
| `spec-spec-043-memory-hygiene-part-1-bi-temporal-invalidation-h1` | AC-MH-11 | 1 |
| `spec-spec-044-memory-hygiene-part-2-staleness-probes-h2` | AC-SP-13 | 1 |
| `spec-spec-047-session-seat-auto-briefing-worktree-aware-sessions` | AC-047-D | 1 |
| `spec-spec-049-gate-denials-carry-the-feeding-pack-gateenforcer-e` | AC-049-4 | 1 |
| `spec-spec-050-gate-hooks-cross-corpus-false-deny-fix-cd-prefix-t` | AC-050-4 | 1 |
| `spec-spec-051-cli-strict-flags-unknown-flag-rejection-actor-flag` | AC-051-4 | 1 |

Twelve specs. The distribution matters for sequencing: SPEC-038 alone is 11 of 29.

M6.4 declares the split as "19 script-mode via reverse-control falsification, 10 human-mode
via a hand-recorded reverse observation". ⛔ VERIFY that split per criterion with
`lore ac list <spec>`; do not assume it.

# Acceptance Criteria

`AC-OX-6` — `lore status --json` reports `pass_unfalsified_count` 0.

⛔ This AC has a known weakness and you must not exploit it: the count reaching 0 is also
satisfied by declaring a falsifier that cannot discriminate. `lore assess` caught exactly
that twice in a prior slice, BOTH times after attestation and after the task was archived.
For every falsifier you declare, answer in writing: **what is the smallest mutation that
turns this oracle red, and did you RUN it?** A falsifier never executed is a claim, not a
measurement.

# Context Digest

- ⛔ `lore ac set` DEMOTES its spec to `draft` and hard-blocks every descendant claim.
  This task touches TWELVE specs. Demoting SPEC-038 or SPEC-064 mid-flight can freeze
  another session's claims. Work spec-by-spec, and return each to `approved` via
  `lore review` + `lore approve` in the SAME session before moving to the next. ⛔ Do not
  demote all twelve and then batch-approve.
- ⛔ Check `lore ac set --help` for the falsifier flags before writing any command; the
  `--falsifier-*` family is what makes discriminating power machine-checkable. Read the
  real flag names from the binary, never from this document.
- ⛔ Record each spec's revisions in its re-baseline log: original text, the exact
  observation that prompted the change, and why it is a correction rather than a weakening.
- ⛔ Before starting, re-read each of the twelve specs' status. A spec already in `draft`
  from another session's edit cannot be approved on your review alone.
- ⛔ `--falsifier-*` declarations that name a file which does not exist yet need
  `--allow-missing-path` with a non-empty reason, and that increments
  `unredeemed_allow_missing_path_count` (9 as of 2026-08-21). A declaration that is never
  redeemed is a dangling promise and is counted as one.
- This is the sweep the root CLAUDE.md's standing lesson predicts: "a new deterministic gate
  retroactively invalidates the back-catalogue — budget the sweep + a written exemption in
  the SAME slice". If any of the 29 genuinely cannot be given a discriminating falsifier,
  the honest outcome is a WRITTEN EXEMPTION naming it, not a fabricated falsifier. Say so
  and stop; do not invent one.

# File Anchors

None declared — every write lands in the corpus (twelve specs' AC records), not on tracked
files. ⛔ Consequence: the `task-claim` anchor-overlap gate is BLIND to this task. It
touches twelve specs that many other plans descend from, which is the widest corpus blast
radius of any task in this plan. Check `lore ready --json` for concurrent sessions
immediately before claiming, and again before each spec's demote/approve cycle.

# ⛔ CROSS-THREAD BLOCKER — read this before declaring a single falsifier

Added 2026-08-21 by the session resuming handoff 109, after discovering that a DIFFERENT
session closed `knowledge-handoff-agent-main-orchestrator-110` four minutes earlier. That
thread measured two facts that break this task's obvious method. Both are reproduce-able;
neither was known when the phase table for M6.4 was written.

Source: `knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` (read it in full — every
figure there names the command that produced it).

**F1 — `pass_unfalsified_count` is blind to 692 of 769 script-mode criteria.**
`deriveAcCoverageState` (`packages/core/src/acceptance.ts:676`) returns `attested_pass`
BEFORE it can ever return `pass_unfalsified`. So any criterion holding a runner-attested
pass is structurally invisible to this field, no matter how many times it was never
falsified. Measured funnel: 769 distinct script-mode ids → 700 attested → 8 declaring a
falsifier → 2 machine-proven to discriminate. ⛔ That precedence is CORRECT and specified
(`AC-FALS-3`); it is not a defect to fix here. The consequence for THIS task is:
**driving `AC-OX-6`'s number to 0 does not achieve the goal AC-OX-6 was written for.** The
29 are a real subset worth fixing, but closing them leaves 692 criteria whose discriminating
power is still unproven, and the field will read 0 anyway.

**F2 — a falsifier is declared on a long-lived SPEC but executable only through a live PLAN.**
`lore verify --falsify` requires the plan positional and refuses the ad-hoc `--task` channel;
`resolveTargetTask` (`packages/core/src/task-workflow.ts:995`) then needs a fresh claim in
that plan. All 8 criteria that currently declare a falsifier have an ARCHIVED governing plan
(AC-TC-5, AC-TC-2, AC-BFI-10, AC-MIS-2, AC-MIS-6, AC-OX-1, AC-OX-7, AC-OWN-4), so not one of
them can be re-run today. ⛔ **Therefore declaring 29 falsifiers under this plan mints 29
DEAD declarations** — runnable while this plan is live, unrunnable the moment it archives.
They would look identical to live ones afterwards.

## What this changes, concretely

1. ⛔ Do NOT satisfy this task by adding `--falsifier-*` declarations to 29 criteria and
   archiving. That produces the exact artifact handoff 110's KD1 warns about.
2. The prerequisite is a **plan-independent falsifier execution path** — handoff 110 NS1
   names the shape: a repo ratchet script invoked from `hooks/pre-push`, the way
   `scripts/check-anchor-coverage.ts` already is. That work belongs to 110's thread, not
   this one. ⛔ It is a PREREQUISITE, not a follow-up.
3. So this task is BLOCKED on that path existing. Until then the honest options are: leave it
   unclaimed, or re-baseline `AC-OX-6` — and a re-baseline MUST be recorded in the spec's
   re-baseline log with the original text, this measurement, and why it is a correction
   rather than a weakening.
4. ⛔ Re-measure before acting. `pass_unfalsified_count` was 29 at 2026-08-21T02:45Z, and
   `unredeemed_allow_missing_path_count` moved 9 → 11 during this very session while only ONE
   declaration was added by it — the rest came from a concurrent session. Any figure in this
   document is a snapshot, and this repo has at least three peer sessions able to write.
