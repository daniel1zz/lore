---
id: TASK-739
type: task
role: plan
title: "Clear the 29-criterion pass_unfalsified backlog across twelve specs, with a RUN falsifier for each"
status: draft
priority: high
phase: "backlog-and-arm"
created: 2026-08-21
updated: 2026-08-21
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
