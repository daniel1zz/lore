---
id: KN-846
type: knowledge
role: knowledge
title: "Retiring a fragment header landed before its migrator and broke the local install"
status: approved
priority: medium
created: 2026-10-24
updated: 2026-10-24
tags: []
links:
  - {id: SPEC-235, type: relates-to}
---
## What happened

Plan plan-fragment-injection-timing-inject-enum-per-turn-hook split the work into I1 (schema: the old audience/mode/delivery keys are refused) and I4 (lore migrate fragments + setup auto-migration). I1 landed first. In this repo ~/.local/bin/lore links to the shared checkout's dist/lore, which lore integrate rebuilds on every landing without running setup, so the owner's 14 old-format user fragments were refused at once and every helper start received only the failure banner. The main agent migrated them by hand (bodies byte-identical, backup kept) about 20 minutes later.

## Why

1. The plan ordered a refusal before the path that clears it, assuming 'build and install' was a separate later step (plan After-landing step 1).
2. integrate's rebuild of the shared checkout is an install but runs only the corpus schema migration, not setup's upgrade migrations.

## Mechanism

- Issue #364: integrate's post-landing rebuild runs the same upgrade migrations as lore setup (end-state: an install is an upgrade wherever it happens).
- For consumers the end state already holds: BR-1376, lore setup migrates old-format fragments itself.
- Not enforced: a plan that retires a format and ships its migrator in a later task. No deterministic gate fits (format retirement is not machine-visible at plan time); with #364 fixed the ordering no longer matters.
