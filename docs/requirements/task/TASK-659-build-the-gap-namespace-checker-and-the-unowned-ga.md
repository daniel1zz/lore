---
id: TASK-659
type: task
role: plan
title: "Build the gap-namespace checker and the unowned-gap report so a GAP reference resolves without guessing which document was meant"
status: archived
priority: medium
phase: "namespace"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-122
plan: PLAN-122
---
AC-GD-3 / D4+D5. PRD-001 §3 numbers PRODUCT GOALS G1-G16; knowledge-attestation-is-structurally-one-sided-lore-verify-can numbers GOVERNANCE GAPS G1-G19. Same tokens, different things: PRD G11 is 'Memory hygiene live' while gap G11 is 'capture window is a shared-config knob'; PRD G15 is 'Dashboard console first batch' while gap G15 is 'the message-overstates-mechanism family has TWO subclasses'. This is not hypothetical: a read-only explorer agent asked this session to enumerate gap-ledger entries resolved G15/G16 against PRD-001 and returned dashboard product goals as governance gaps. Build scripts/check-gap-namespace.ts with an exported main() returning an exit code and never calling process.exit: it exits EXACTLY 3 naming any entry in the gap ledger still using a bare G<n> token, and 0 when every entry uses GAP-<n>. Also parse the ledger's structured entries (id, status, owning_spec) and print a report of open gaps with no owning_spec, exiting 0 — a REPORT deliberately, ⛔ NOT a gate: a sibling spec this session tried to arm a retroactive gate over the existing corpus and failed six review rounds, because the corpus records no authorship timestamp per entry so no cutoff predicate over the back-catalogue is decidable. The same trap applies here. ⛔ Do NOT edit the gap ledger itself — the rename, the structured fields, marking GAP-11 closed, and correcting GAP-19's scope line are ORCHESTRATOR-owned corpus edits. Your checker must therefore be testable against INJECTED fixture content, not only against the live doc.
