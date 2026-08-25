---
id: TASK-862
type: task
role: plan
title: "Eight of nine red-first rows on an archived plan are self-reported, because the dispatch template prescribed a flag that forecloses attestation"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"attestation-floor","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"1da9d1bf-b1ce-42e8-9ecd-fcaffaf5323c"}
---

From handoff knowledge-handoff-agent-main-orchestrator-133, NS1, unfiled until now.

plan-land-the-two-mirror-command-surfaces-one-row-contract-for required a runner-ATTESTED expected-fail per criterion. It got one of nine. The other eight are capture_source:self-report because the orchestrator's dispatch bundles prescribed --output-tail-file, which satisfies the tail requirement but writes no attestation. The single attested red came from the one agent that ignored the template.

Root cause is a bundle-template defect, not agent laziness: --capture and --output-tail-* are MUTUALLY EXCLUSIVE, so prescribing the latter silently forecloses attestation. The reds are real and each names its observed failure, but none is runner-attested and the plan is now archived, so the record cannot be repaired in place.

**Expected:** Either the eight mutations are re-run with --capture against the archived tasks so the red-first record becomes attested, or the shortfall is recorded as an explicit, typed exemption on the plan. A third acceptable outcome: `lore evidence` refuses --output-tail-file for --result expected-fail, so the mutually-exclusive pair cannot be chosen wrongly by a bundle author again.
**Actual:** Eight of nine expected-fail rows on an archived plan carry capture_source:self-report with no attestation block, and nothing refused them at write time.

Reported by: agent:main-orchestrator
