---
id: KN-373
type: knowledge
role: knowledge
title: "Product chain round two: worked examples, decomposition layer, interview instrument, anchored scoring"
status: approved
priority: medium
created: 2026-07-28
updated: 2026-07-28
tags: [product, skills, validation, workflow]
parent: PRD-001
links:
  - {id: ADR-016, type: relates-to}
---
# What was closed

A second-round audit (two parallel agents: one comparing against 5 leading community PM skill repos, one auditing internal consistency) found the first-round rebuild incomplete. This records the four capability gaps closed in round two, plus the class of self-inflicted breakage the first round left behind.

## Round-one breakage (root cause: a refactor that changes a chain must sweep every describer of that chain)

Changing the canonical product chain silently invalidated six documents that describe it from outside the changed files: `~/.claude/CLAUDE.md` still routed "Feature: PRD first" straight into the new gate's refusal; `lore-kickoff`'s Day-0 table sent "idea only" to PRD using dead `product:prd` syntax; `prd-guide.md` (the guide mode-prd.md itself links to) still taught the pre-change requirement format; both PRD templates lacked the now-mandatory `source`/`validation` fields, so the enforced fields had nowhere to land; `lore-product-to-prd` promised an `unvalidated` tag its template had no slot for.

Mechanization: when a chain/contract changes, grep for every file that NAMES the chain steps, not only the files that implement them. Conformance manifests catch file-set drift; nothing catches prose drift.

## The under-wiring that would have made the new benchmark skill inert

`lore-product-lens/references/competitive-lens.md` instructed its subagent to "infer from product category" and compare against "top 2-3 known competitors" — pure model recall (E6) — while the new Evidence-First gate forbade exactly that. A new evidence-producing skill does not take effect until the consumers that used to guess are rewired to consume it.

## Four capability gaps closed

1. **No worked examples.** Community skills (deanpeters) ship template + examples per skill; we shipped skeletons. Output granularity anchors on the exemplar the model has seen, so a skeleton exemplar produces skeletal output — the direct mechanism behind "AI product output is coarse". Added three worked examples threaded through ONE running case (B2B analytics SaaS, 7-day activation 23%->40%) so they interlock: feature matrix -> OST -> validation ledger. Each includes its own failure half: a deliberately bad OST, a ledger whose expensive experiment fails, a matrix-misuse table.

2. **Missing decomposition layer.** An OST leaf is one sentence; a PRD needs twenty decisions. Without a layer between them those decisions were invented during PRD drafting — the exact failure the upstream gates exist to prevent. Added `decompose` mode (Patton story mapping): backbone of user activities, tasks under each, four mandatory unhappy-path questions (fails / returns / empty / overloaded), vertical slice, requirements read off the map. Rows produced by unhappy-path questions are `unvalidated` by default — validation tested the happy path, and letting them inherit the parent's tick is how a ledger's credibility gets laundered onto untested scope.

3. **Evidence demanded without an instrument.** The E1-E4 ladder requires observed behaviour and past-behaviour quotes while nothing in the family contained a single interview question — a standing invitation to fabricate. Added `interview-protocol.md`: Mom Test rules, bad->good question pairs tagged by the tier each yields, a verbatim 30-minute script, the commitment-currency ladder (Time < Reputation < Access < Money < Behaviour change) mapped to tiers, and an explicit "cannot reach real users" section stating that self-interviewed personas are E6 and must be labelled `E6 · simulated`.

4. **Unreproducible prioritization.** Branch selection was prose. Replaced with anchored 1-5 scales (evidence strength / outcome leverage / disproof cost) and a forced Recommended / Alternative / Not-recommended trio, so a ranking can be argued with rather than merely asserted. Added assumption mapping (importance x evidence) to `validate` so the riskiest no-evidence assumption is tested first — a 3-day spike queued behind a 2-hour fake door is often never needed.

## Deliberately NOT adopted

Experiment statistics (sample size, MDE, significance), staged review boards (Miro P0/P1/P2, murder board), and weekly discovery rituals (product trio, exposure hours). Over-engineering for a solo operator working with AI agents; the chain gates and the >=3-solution rule already deliver what the review boards exist to force.
