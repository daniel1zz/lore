---
id: PLAN-212
type: plan
role: plan
title: "In-session human decisions: lore writes the question, the harness records the answer"
status: archived
priority: high
created: 2026-10-23
updated: 2026-10-25
tags: []
parent: SPEC-234
phases:
  - {name: "F", description: "In-session decisions"}
---
# In-session human decisions

## Goal

Land spec-human-decisions-are-asked-in-the-session-and-recorded-by: lore writes the question, the agent asks it in the session, the harness hook records the answer, the agent carries it out; ship the ask-then-execute rule.

## Preconditions

Spec approved (v16).

## Tasks

- F1 lore pending --ask, lore decide --from-harness, the PostToolUse hook, the gate update, the shipped rule (AC-ASK-1..3).
