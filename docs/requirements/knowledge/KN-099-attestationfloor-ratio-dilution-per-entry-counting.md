---
id: KN-099
type: knowledge
role: knowledge
title: "attestationFloor ratio dilution: per-entry counting lets self-reported bulk force repeat verify runs"
status: approved
priority: medium
created: 2026-07-24
updated: 2026-07-24
tags: [spec-069, attestation, gate-calibration, dogfood]
parent: SPEC-069
---
Observed 2026-07-24 closing plan-072/073 (both blocked twice): SPEC-069's plan-close attestationFloor computes attested/total over individual evidence ENTRIES. A diligent subagent that records many self-reported entries (tsc + per-AC test + regression sweeps: 8-10 entries/task) dilutes the ratio below 0.5 even after every declared AC has an attested pass — the orchestrator must then re-run lore verify purely to mint additional attested entries (each pass appends 4+), a ratio-farming loop with no new information. Both per-task floors were already satisfied; only the plan-wide entry ratio blocked. Suggestion for SPEC-069 owner: compute the plan-wide ratio over TASKS (share of evidence-bearing tasks having >=1 attested entry) or cap self-reported entries' weight, instead of raw entry counts. Not a defect — the gate correctly forced attestation twice today (SPEC-068 tester, 072 fixture task) before this friction appeared; this is a calibration observation from the first two days of live enforcement.
