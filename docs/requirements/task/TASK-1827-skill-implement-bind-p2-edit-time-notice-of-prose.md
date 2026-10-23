---
id: TASK-1827
type: task
role: plan
title: "[Skill:implement] BIND-P2 edit-time notice of prose bound to the edited file"
status: archived
priority: medium
phase: "P2"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-231
plan: PLAN-231
---
Implements spec-prose-about-code-is-bound-to-what-it-describes-one D3 (plan plan-bind-prose-to-code-resolver-and-reverse-index-edit-time phase P2), over the P1 reverse index. Read the spec and plan notes (Write pre-edit content from git; untracked new file reports nothing).

A shipped PostToolUse hook (assets/hooks/, next to post-edit-mark.mjs) for Write/Edit/NotebookEdit queries the P1 index for the edited path and returns additional context listing each binding doc:line and reference; never blocks. Script bindings trigger only when that script's command text changed. Oracle AC-BIND-4 red first; verify from a fresh consumer install (throwaway HOME + lore setup --yes), never the real HOME.
