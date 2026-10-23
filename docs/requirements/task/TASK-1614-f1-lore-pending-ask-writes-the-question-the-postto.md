---
id: TASK-1614
type: task
role: plan
title: "F1 lore pending --ask writes the question; the PostToolUse hook records the answer via lore decide --from-harness; the ask-then-execute rule ships"
status: archived
priority: medium
phase: "F"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-212
plan: PLAN-212
---
Spec: spec-human-decisions-are-asked-in-the-session-and-recorded-by (read Scope + AC-ASK-1..3 + BR-1374/BR-1375 via lore rule changes). Reference: GitHub Actions deployment approval. The service behind lore decide is the existing autonomy decision path (lore decide human-channel, AC-AU-3); add --from-harness reading the PostToolUse JSON on stdin; nonce single-use, bound to decision id + subject version + sha256 of the exact question object lore pending --ask issued (store it with the pending decision; migration if needed = next free number). New hook assets/hooks/post-ask-decide.mjs registered for PostToolUse matcher AskUserQuestion in distribution-hooks.ts; it calls lore decide --from-harness once with the payload and prints one line per question. The git-safety gate's LORE_DECIDE_PAT (assets/hooks/pre-bash-git-safety-gate.mjs ~904) also covers --from-harness. Ship BR-1375 as an always-loaded fragment in assets/context; remove every shipped text telling the human to run lore decide in a terminal (lore pending output, skills, context). Verify the PostToolUse payload shape for AskUserQuestion against Claude Code docs (ask the claude-code-guide agent or docs) before relying on field names. Regenerate the assets manifest; verify from a fresh consumer install (mkdtemp + lore setup) that the hook is registered.
