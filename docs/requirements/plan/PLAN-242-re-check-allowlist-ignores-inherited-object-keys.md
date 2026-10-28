---
id: PLAN-242
type: plan
role: plan
title: "Re-check allowlist ignores inherited object keys"
status: archived
priority: medium
created: 2026-10-28
updated: 2026-10-28
tags: []
parent: SPEC-258
phases:
  - {name: "G", description: "Own-key lookups"}
---
# Re-check allowlist ignores inherited object keys

## Goal

The follow-ups milestone review (knowledge-milestone-review-decision-records-follow-ups-2, security fail) found that decision-recheck.ts looks commands and subcommands up in plain object literals (e.g. GIT_FLAGS[first]), so inherited keys such as constructor, __proto__, toString pass: `git constructor x` is re-run (git may dispatch it to an alias or a git-<name> program), and `git constructor -x` throws inside isRerunnableCommand and crashes the re-check. Fix with own-key lookups (Map or Object.hasOwn) for every table, and report such commands as not-rerunnable.

## Tasks

- G1: own-key lookups and AC-DR-7 cases.

## After landing

lore verify; lore done; lore assess.
