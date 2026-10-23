---
id: TASK-1612
type: task
role: plan
title: "F1b the recommended option comes first with a (Recommended) label; no boilerplate reject line; question in the user's language"
status: archived
priority: medium
phase: "F"
created: 2026-10-23
updated: 2026-10-23
tags: []
parent: PLAN-212
plan: PLAN-212
---
Owner feedback 2026-10-23: 'when you ask me to judge, tell me which one you recommend'. In lore pending --ask: (1) when --recommend <id>=accept|reject:<reason> is given, that option is FIRST and its label ends with the recommendation marker in the question language (en '(Recommended)', zh '（推荐）'), its description starts with the reason; the other option follows. (2) Remove 'Lore's measured recommendation: reject (human-always class: no measured factor recommends accepting)' for human-always classes (it reads as a reject recommendation; it is boilerplate); keep lore's measured line only for classes it actually scores. (3) Drop the 'Details: start the dashboard ...' line (BR-1375: never send the human elsewhere). (4) Question language: --lang <en|zh> (default from config ui.language, else en); the hash covers the rendered text, so --from-harness still verifies. Test: recommended option first + marker for both languages; hash verification still passes; no 'start the dashboard' text; human-always question has no measured-reject line.
