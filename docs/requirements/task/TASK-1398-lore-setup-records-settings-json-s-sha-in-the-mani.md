---
id: TASK-1398
type: task
role: plan
title: "lore setup records settings.json's sha in the manifest BEFORE applyLanguageProjections writes language into it, so the first install's manifest is wrong and the next run silently rewrites it"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"setup-manifest","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"e635d845-36b5-41f7-b8c4-2e2ad387585b"}
---

adapters/cli/commands/setup.ts writes the manifest entry for settings.json, then applyLanguageProjections (setup.ts:1000) writes the configured language into that file. With a user config setting language (e.g. ~/.config/lore/config.yaml language: zh), the first install records sha 7e91… while the file on disk is 0a3e…; a second --dry-run then reports a change instead of 'would skip', and the next real run rewrites the manifest. Reproduced in a temp dir on 2026-10-16 (triage of main's full suite). Two tests (setup.test.ts AC-046-E.R1, setup-manifest-fields AC-076-6.S1) fail on any machine with a language set, and isolating XDG in the tests alone would hide this product bug.

**Expected:** The manifest sha of every file setup writes equals the file's final on-disk bytes after the same run; a second dry-run right after install reports every file as would-skip regardless of user config
**Actual:** first-run manifest sha differs from the on-disk settings.json when a language is configured

Reported by: agent:session-c1ffea04
