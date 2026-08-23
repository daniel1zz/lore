---
id: TASK-755
type: task
role: plan
title: "lore done's test-anchor refusal demands an ATTESTED unfiltered pass, but its predicate never checks attestation — an unattested --capture row satisfies it"
status: draft
priority: medium
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PRD-001
---
Measured 2026-08-21 while landing plan-close-the-falsify-green-control-gap-an-unrunnable-scratch; recorded as F3 of knowledge-the-green-control-pattern-and-its-cost-a-falsifier. When a task declares test-file anchors, lore done refuses with text that contains two mutually contradictory claims in one message: it demands 'no attested UNFILTERED result:pass run' for each declared test-file anchor, and then prescribes 'record one via lore evidence ... --result pass'. lore evidence has NO flag that can produce an attestation block — --capture stamps capture_source: runner and nothing more (this asymmetry is itself already documented: attested rows come only from lore verify). An agent reading the refusal literally concludes the only attestation-producing path is lore verify, which runs only the AC's DECLARED command, and every declared command on the governing spec carries a -t case filter, i.e. is BY DEFINITION filtered. That reads as an unbreakable deadlock and can strand a finished task. Measured resolution: it is NOT a deadlock — a lore evidence --capture row with an unfiltered command satisfied the gate and lore done succeeded. So the predicate checks (unfiltered AND result:pass) and does NOT check attestation; the word 'attested' in the refusal is simply false. This is the third distinct occurrence of the same shape (a refusal/label promising a stronger evidence tier than the implementation checks) after AC-FR-9 and capture_source: runner without an attestation block; one instance is a typo, three is a missing check. Severity is about corpus truthfulness, not availability: the strongest-sounding word in the gate's vocabulary is being applied to a predicate that cannot observe it, so an agent that trusts the message over-reads the evidence tier of every task lore done let through.
