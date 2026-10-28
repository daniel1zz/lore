---
id: TASK-2016
type: task
role: plan
title: "I2 user-prompt-fragments.mjs UserPromptSubmit hook, registration and setup wiring"
status: archived
priority: medium
phase: "W"
created: 2026-10-23
updated: 2026-10-26
tags: []
parent: PLAN-274
plan: PLAN-274
---
Covers: AC-IT-4. Spec section hook:user-prompt outlet: Hook (fast path over the user and project context dirs, spawn lore from PATH with a 3 s timeout, failure banner), Registration (HOOK_REGISTRATIONS, HOOK_DENY_CAPABILITY, hook-count pins in distribution-hooks.test.ts, assets-ssot.test.ts, real-setup-ports.test.ts), regenerate the assets manifest. user-prompt-turn-start.mjs stays stdout-silent. The render side (outlet, '{}' answer) already landed in I1. New compiled test carries // @spawns dist/lore and puts the dist dir first on PATH.
