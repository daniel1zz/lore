---
id: TASK-737
type: task
role: plan
title: "Arm pass_unfalsified as a blocking gate, and first declare the criterion that observes it"
status: draft
priority: medium
phase: "backlog-and-arm"
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-079
plan: PLAN-079
---
# Task Objective

Arm `pass_unfalsified` as a BLOCKING gate — the final act of M6.4 and of this plan.

# Spec Reference

`spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a` §M6.4 ("THEN arm `pass_unfalsified` as a blocking gate") and D6 ("Arm the gate now or after
the backlog → After. Arming at zero red removes the motive to synthesize a red").

# ⛔ This task has NO acceptance criterion, and that is the first thing to fix

Declared `--ac-scope ""`. Measured 2026-08-21: the spec carries `AC-OX-1` … `AC-OX-11` and
**none of them observes the gate being armed or refusing anything**. `AC-OX-6` measures the
backlog reaching zero; that is the PRECONDITION for arming, not the arming.

So M6.4's final deliverable is a declared property with no measuring oracle — the exact
shape `knowledge-a-declared-property-with-no-measuring-oracle` names. The first act of this
task is therefore to DECLARE the criterion, once the gate's shape is known:

    lore ac add spec-oracle-executability-a-runner-s-discovery-refusal-is-not-a AC-OX-12 …

⛔ Do not author that AC before reading the gate implementation you are about to write —
pinning an oracle to a field or command that does not exist is how an AC ends up with no
runnable oracle at all (measured: `knowledge-five-governance-tooling-gaps-measured-while-resuming`).
MEASURE the field, then pin it.

⛔ `lore ac add` does NOT demote an approved spec (unlike `lore ac set`) — the asymmetry is
measured and documented in the root CLAUDE.md. So adding AC-OX-12 will not freeze descendant
claims. But it also means the spec's existing `approved` stamp certifies the AC set as of
approval time, not the set including AC-OX-12. Re-run `lore review` + `lore approve` anyway
so the approval covers what a reader now sees.

What the criterion must be able to observe going red, at minimum:
1. With one `pass_unfalsified` criterion present, the gate REFUSES (exit 4) and its refusal
   NAMES that criterion — not just a count. An unaddressable refusal cannot be acted on.
2. With zero present, the same path passes AND is distinguishable from a VACUOUS pass. ⛔ An
   armed gate that vacuously passes lends its authority to everything it waves through
   (`spec-governance-visibility-an-armed-gate-that-vacuously-passes` §B1.1) — "satisfied"
   and "no applicable data" MUST NOT render alike, in human output and in `--json`.
3. The gate runs in the SERVICE layer, so CLI / MCP / HTTP writes are gated identically —
   a CLI-only gate is not armed for two of three surfaces.

# Dependency — hard, not advisory

Blocked on `task-clear-the-29-criterion-pass-unfalsified-backlog-across` reaching an
attested `AC-OX-6` pass. D6's reasoning is the whole point: arming while 29 criteria are red
gives every future session a motive to manufacture a synthetic falsifier to get past the
gate. ⛔ Re-measure `lore status --json | pass_unfalsified_count` immediately before arming;
do not trust a sibling task's report or a batch-start snapshot.

# Context Digest

- Per-checkpoint knob: `workflow.gates.<checkpoint>.enabled`, resolved by
  `resolveGateEnabled` in `packages/core/src/config.ts` — it returns
  `gates?.[checkpoint]?.enabled !== false`, i.e. **enabled unless explicitly disabled**. So
  a newly named checkpoint is live the moment code reads it, for every consumer, including
  projects that never edited their config. That is the arming mechanism and also its risk.
- ⛔ Arming retroactively invalidates the back-catalogue. The root CLAUDE.md's standing
  lesson requires the sweep AND a written exemption in the SAME slice. The sweep is the
  sibling task; the exemption channel is `extra` on the exempted doc (see `exempt_plans` in
  `lore status --json`, 5 as of 2026-08-21) — read how the existing exemptions are stored
  before inventing a new field.
- ⛔ Verify from a FRESH consumer install, not only from this repo: "would a project that
  just ran `lore init` + `lore setup` still hit this?" A gate wired only in this repo's
  `.lore/config.yaml` is not shipped.

# File Anchors

Not yet determinable — the gate's implementation site depends on the design decision above.
⛔ Declare anchors with `lore set` BEFORE claiming, once the site is chosen; claiming an
unanchored task that will edit service-layer config resolution makes the anchor-overlap gate
blind to the widest-blast-radius change in this plan.

Expected neighbourhood (read first, do not assume):
- `packages/core/src/config.ts` (`resolveGateEnabled`)
- `packages/lore/src/service/` (gates run in the service layer, per the cross-cutting rule)

# ⛔ CROSS-THREAD BLOCKER — this gate cannot be armed on `pass_unfalsified_count`

Added 2026-08-21 by the session resuming handoff 109, after finding that another session had
closed `knowledge-handoff-agent-main-orchestrator-110` minutes earlier. Source:
`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a`.

`pass_unfalsified_count` is structurally blind to 692 of 769 script-mode criteria:
`deriveAcCoverageState` (`packages/core/src/acceptance.ts:676`) returns `attested_pass`
before `pass_unfalsified` can ever be reached, so every attested criterion is invisible to
the field. The precedence is correct and specified (`AC-FALS-3`) — the field is simply not a
measure of discriminating power. **A gate armed on it inherits the blind spot and would
certify 90% of the corpus as fine while measuring nothing about it.** That is the
"armed gate that vacuously passes" failure this repo already has a spec for.

Two hard constraints carried over from handoff 110 NS1, both measured:

- **(a) The new coverage signal MUST be an ORTHOGONAL field**, never a widening of the
  7-state enum — `AC-FALS-3` deliberately ranks `attested_pass` above `pass_unfalsified`, so
  widening the enum would contradict a specified, tested precedence. Discriminating power and
  evidence strength are independent dimensions and must be reported as two numbers.
- **(b) The gate and the back-catalog sweep MUST land in the SAME slice.** 821 existing
  criteria would violate the gate on day one.

And one prerequisite that is NOT a follow-up: a **plan-independent falsifier execution path**
must exist first. `lore verify --falsify` needs a live plan, so all 8 existing falsifier
declarations are already unrunnable (their plans are archived). Arming a gate that merely
requires a DECLARATION therefore mints dead declarations — green at spec-promote time,
unrunnable one archive later. Shape named by 110: a repo ratchet script invoked from
`hooks/pre-push`, as `scripts/check-anchor-coverage.ts` already is.

⇒ This task is BLOCKED behind handoff 110's tech spec (110 NS1: open it via `/lore-design`).
⛔ Do not arm anything on `pass_unfalsified_count`. If the eventual design keeps this task at
all, its AC must pin the ORTHOGONAL field, and only after measuring that the field exists.
