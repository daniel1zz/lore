---
id: TASK-858
type: task
role: plan
title: "Nothing stops one session overwriting another's in-flight shared state, and exclusivity-dependent ACs make the overwrite the only route to a green verdict"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"concurrency-safety","tags":["concurrency","cross-session","exclusive-corpus","gate-blindness","north-star"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"61e9e0b8-c5c5-4bd4-ba35-49889038da3f"}
---

Nothing in lore prevents one session from overwriting another session's in-flight shared state, and the failure is not a discipline problem — it is three independent gaps that COMPOSE into making the overwrite a NECESSARY step to pass verification.

MEASURED 2026-08-25 during a real two-session collision on this repo. I am the session that did the overwriting; this report is against the mechanism, not the peer.

## Layer 1 — an active peer session can be structurally INVISIBLE

`lore bootstrap`'s `active_sessions` rows are keyed to a CLAIM (every row carries `task_slugs`). A session doing pure planning writes — `create spec`, `create plan`, `phase add`, `ac add`, `approve` — holds no claim and therefore does not appear at all.

Measured: at 07:45Z `active_sessions` listed exactly two sessions. A third session had written a spec to v10 between 07:41Z and 07:44Z and was still active. It was absent from the field. I concluded "only one other session is live" from that field, and acted on the conclusion.

⛔ Consequence: "no other session is active" is NOT derivable from `active_sessions`, but the field's name and shape invite exactly that reading. AN UNLISTED SESSION IS NOT PROVEN ABSENT.

## Layer 2 — the shared mutable files are anchored by NO task, so every gate is blind to them

The `task-claim` anchor-overlap gate only arbitrates between tasks that (a) are claimed and (b) declared `--anchor` paths. `docs/requirements/**` and `.lore/export-index.json` are declared by nobody, so `lore export-docs --force` and `bun run mirror:export` — which rewrite hundreds of shared files — are entirely outside every deterministic gate.

Measured: I ran `lore export-docs --force` three times and committed the results to `main`. One run printed `Overwrote 1 drifted file (--force): SPEC-153-....md` — that was the peer session's spec, mid-edit. No gate, hook, or warning fired at any point.

## Layer 3 — and this is the one that makes it inevitable: the ACs demand an exclusive corpus

`spec-falsifiability-reachability-a-feedable-checkpoint-an` AC-FR-6 requires the on-disk mirror file count to EQUAL the live corpus count, and AC-FR-10 requires per-type count parity against the production corpus. Those are exclusive-corpus verdicts.

So to verify my own task I had to make a globally shared artifact match a snapshot of the corpus — i.e. overwrite whatever a peer had in flight. Measured twice in one session: AC-FR-7 went red because the peer was still editing the doc the test picked (green after I reconverged that one file), and AC-FR-10 went red mid-`lore verify` with `task: 844 mirror file(s) on disk vs 845 live corpus doc(s)` because the peer created two tasks while it ran.

⛔ This is the load-bearing layer. Layers 1 and 2 make the overwrite possible and unseen; layer 3 makes it the ONLY route to a green verdict. Fixing 1 and 2 while leaving 3 leaves an executor correctly choosing to overwrite.

This repo's own North Star already names the shape — "An answer that relies on exclusivity — clean tree, exclusive corpus, single-writer file — is a refusal of the target state, not a design" — and `knowledge-the-mirror-content-parity-oracle-is-structurally` recorded the CONTENT-parity half on 2026-08-24. The COUNT half is now measured too, and the cross-session territory half is not recorded anywhere.

## What else went wrong downstream of layer 1, worth reporting because it is the same instrument gap

`lore log`'s Author column and `doc.created_by` print the literal `system` for a write whose `lore audit` entry names the actor correctly. Using `lore log` plus `active_sessions`, I misattributed the peer's spec to a subagent I had dispatched, sent that agent two accusatory course-correction messages, and asked my user to decide whether to quarantine or discard the peer's plan chain. `lore audit` had the correct answer the whole time — 25 entries, the subagent's actor appearing zero times. I made the same instrument error three times in one session.

⛔ So attribution IS recorded; the defect is that the discoverable surface prints a placeholder that reads like an identity. Filed separately as `task-lore-create-by-is-accepted-and-ignored-cli-content-writes`.

## Scope of a real fix, in the order the layers actually bind

1. Restate exclusivity-dependent criteria as DELTAS (e.g. "no doc created before time T lacks a mirror file"), so a concurrent write cannot redden a verdict and an executor is never rewarded for clearing shared state. Without this, 2 and 3 below are advisory.
2. Bring globally-shared write surfaces (`docs/requirements/**`, `.lore/export-index.json`, the mirror as a whole) inside a gate — either an implicit system-owned anchor, or a refusal when another live session's lease covers them.
3. Make `active_sessions` state its claim-keyed scope, or include claimless writing sessions. A consumer must be able to distinguish "no peer is active" from "no peer holds a claim".

⛔ Not a fix: prose telling agents not to touch other sessions' work. Root CLAUDE.md has the concurrency design question and no such prohibition, and even with one, layer 3 would still make overwriting the correct move for a session trying to pass its own AC. Prose already covered the role-authority half of this and did not bind — an agent violated a bold prohibition in its own dispatch bundle the same turn it read it.

## Falsifier for whichever fix lands

⛔ Not "a second session gets refused" — a refusal that fires on every write is not a fix. Two sessions, one run: session A holds an edit in flight on doc D; session B runs the verification path that previously required convergence. Assert BOTH that B reaches a verdict WITHOUT rewriting D, AND that B's verdict is not vacuous (it still fails when a genuine pre-existing drift is seeded). Smallest mutation that turns it red: let B converge the tree first — the assertion that D's bytes are unchanged must then fail.

**Expected:** A session verifying its own work must be able to reach a verdict without rewriting globally shared artifacts another live session is editing. Concretely: (a) exclusivity-dependent criteria are stated as deltas so a concurrent write cannot redden a verdict; (b) globally-shared write surfaces (docs/requirements/**, .lore/export-index.json) are inside some gate rather than outside every one; (c) a consumer can distinguish 'no peer session is active' from 'no peer session holds a claim'.
**Actual:** All three fail together, measured in one real collision. active_sessions omitted a live peer session entirely because it held no claim, so I read 'only one other session is live' off it and acted on that. lore export-docs --force then rewrote that peer's in-flight SPEC-153 mirror body and I committed it to main, three times, with no gate, hook, or warning firing — because 0 of 846 tasks declare docs/requirements or .lore/export-index.json as an anchor, putting the whole mirror outside the anchor-overlap gate's view. And AC-FR-6/AC-FR-10 require on-disk mirror counts to EQUAL live corpus counts, so converging that shared tree was not carelessness, it was the only way to make my own declared criteria pass. Downstream of the same instrument gap, lore log's Author column reads 'system' where lore audit names the actor, so I misattributed the peer's spec to a subagent I had dispatched and sent it two accusatory messages.
**Repro command:** `bun run packages/lore/src/index.ts list --type task --json --include-invalid | python3 -c "import json,sys; d=json.load(sys.stdin)['data']['docs']; print('tasks:', len(d), '| anchoring docs/requirements or export-index:', sum(1 for x in d if any('docs/requirements' in a or 'export-index' in a for a in ((x.get('extra') or {}).get('file_anchors') or []))))"`

Reported by: agent:main-orchestrator
