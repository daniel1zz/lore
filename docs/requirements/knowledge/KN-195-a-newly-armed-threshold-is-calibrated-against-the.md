---
id: KN-195
type: knowledge
role: knowledge
title: "A newly-armed threshold is calibrated against the agent's base, and a concurrent peer merge invalidates that calibration silently"
status: approved
priority: high
created: 2026-08-06
updated: 2026-08-06
tags: [retro, concurrency, gate, threshold, stale-binary, doc-sync]
parent: PRD-001
---
# Retro — a newly-armed threshold is calibrated against the agent's BASE, and a concurrent peer merge invalidates that calibration silently

The repo already carries the lesson *"a new deterministic gate retroactively invalidates the back-catalog — budget the sweep + a written exemption in the SAME slice."* Measured 2026-08-06: that lesson is necessary but **not sufficient under concurrent dispatch**. The sweep can be budgeted correctly and still be wrong by the time it lands, because the agent calibrated against a tree its peer was concurrently moving.

## What happened, in numbers

Wave 5 dispatched two agents concurrently from base `074df1cd`, declared anchors disjoint, verified no mutex violation at merge. Agent B armed a new deterministic eviction floor for module CLAUDE.md files and had to pick its threshold fraction. It did exactly the right analysis, and recorded it:

> 0.95 was rejected because it would also breach `ai`, and **any value catching `adapters/cli` (14926) would block on a doc I'm forbidden to edit**.

It chose 0.97 — a value that, at its base, left `adapters/cli/CLAUDE.md` (14926 bytes) safely below the floor (15893).

Meanwhile agent A, whose anchors did NOT include that file, doc-synced it as part of its own change. That doc-sync itself hit the 16384-byte ceiling and had to be compressed — landing at **16018**.

| file | at wave base | after peer A merged | new floor | verdict |
|---|---|---|---|---|
| `adapters/cli/CLAUDE.md` | 14926 | **16018** | 15893 | **TRIPS** |

Merging B produced a RED `main`: `lore status --check-claude-md` exit **3**. Neither agent did anything wrong, neither could have observed the other, and the anchor mutex was never violated — the two never touched the same file.

## Why the existing safeguards all passed

- **Anchor mutex**: clean. A doc-sync is not an anchor, and `adapters/cli/CLAUDE.md` was explicitly declared FREE to agent A.
- **Per-agent scoped oracle**: both green. Each ran `test:changed` against its own base, where its own view was consistent.
- **Merge-tree conflict probe**: exit 0. There is no textual conflict — different files.
- **The back-catalog sweep lesson**: honoured. Agent B swept, and its sweep was correct *for the tree it could see*.

The gap is that a threshold is a claim about the WHOLE TREE, while every safeguard above is scoped to a diff.

## The rule this yields

**A wave that arms a new threshold, gate, or budget MUST re-run that gate on the fully-merged tree before the wave is declared closed — the arming agent's calibration is a statement about its base, not about main.** And re-running it requires the ONE post-merge rebuild first: this was caught only because the rebuild happened and the check was re-run with a current binary. The pre-rebuild run of the same command returned exit 0 and "0 findings", because the stale binary did not contain the floor it was being asked about.

Two corollaries worth stating separately:

- **A doc-sync is an unanchored write with tree-wide reach.** Agents are told to doc-sync, and the file they sync is frequently not among their anchors. So any tree-wide invariant over documentation files is exposed to concurrent doc-syncs that no mutex sees. Either the arming agent's threshold must be calibrated with headroom for concurrent peers, or the orchestrator must re-validate after merge. The second is cheaper and does not require anyone to predict the peer.
- **The verdict of a gate is a property of the BINARY, not of the source.** `lore status --check-claude-md` reported green from the pre-rebuild binary and exit 3 from the post-rebuild one, on a byte-identical tree. Any post-merge gate check on a compiled-binary CLI is meaningless until the rebuild.

## What was NOT the fix

⛔ Raising `evict_threshold_fraction` to accommodate the file. The threshold is correct and the file is genuinely over it; the calibration, not the rule, is what went stale. ⛔ Reverting the peer's doc-sync. ⛔ Recording the displaced content in a neighbouring module's doc — the precise defect the floor exists to prevent, and the gate's own message names it.

The fix was to evict from the over-budget file, which is what the gate asked for.

## Residual, named

This retro does not mechanize anything. The orchestrator-side rule above is prose, and prose is the layer this repo has repeatedly measured as the wrong one. A mechanized form would be a wave-close check that re-runs every armed deterministic gate against the merged tree after the rebuild and refuses to declare a wave closed on a non-zero exit — ⛔ but note the arming gate is discovered, not declared, so such a check would need the gate registry to know which checkpoints are newly armed in this wave. That is the open design question, and it is why this is recorded as a retro rather than filed as a task with a prescribed fix.
