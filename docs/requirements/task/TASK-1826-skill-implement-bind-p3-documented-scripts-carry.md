---
id: TASK-1826
type: task
role: plan
title: "[Skill:implement] BIND-P3 documented scripts carry descriptions; module index holds no unrelated count"
status: archived
priority: medium
phase: "P3"
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-231
plan: PLAN-231
---
Implements spec-prose-about-code-is-bound-to-what-it-describes-one D4 and D5 (plan plan-bind-prose-to-code-resolver-and-reverse-index-edit-time phase P3). Read the spec and plan.

Key code: packages/lore/src/flows/context-flow.ts (module-index :355-384, count line :359; command-table :386-402), packages/lore/src/service/context-facts.ts (:160-240 documentedScripts), spec-module-index-lists-only-folders-with-a-memory-file-managed AC-MI-1 and BR-882.

Done means: package.json lore.documentedScripts is a map name -> one-line description (validated; a name without a script fails loud as today); command-table renders name, command, description; root CLAUDE.md's hand-written Commands block is replaced by the generated table plus the non-derivable rules (read `lore governance claude-md` first; mark this repo's scripts with accurate descriptions verified against the scripts); the module-index section no longer contains the without-memory-file count, which moves to refresh/--check output; record the AC-MI-1 count-clause change on AC-MI-1 per the AC-change rules (`lore ac set ... --correction` only if it qualifies as a correction; otherwise report and the main agent decides). Oracle AC-BIND-5 red first.
