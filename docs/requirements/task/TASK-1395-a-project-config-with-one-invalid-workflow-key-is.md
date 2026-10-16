---
id: TASK-1395
type: task
role: plan
title: "A project config with one invalid workflow key is silently dropped whole by the CLI loader, disabling every workflow setting (gates included) for all lore commands"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"no-silent-fallback","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"7f0ff4e2-e1b1-4c06-a224-3407dda1dabd"}
---

packages/lore/src/adapters/cli/loader.ts:21-26 documents that every config parse failure other than the ai block (malformed YAML, bad sync/telemetry/workflow section, unknown key) silently falls back to undefined. Each new workflow key (e.g. workflow.turn_end.co_change, added by spec-session-trail-a-session-local-record-of-what-each-run-4) widens the blast radius: one typo in any list entry turns off workflow.gates, review settings and turn_end for every CLI verb, with no message. The session-trail trail-review verb bypasses the loader for its own key, but nothing protects the other settings. CLAUDE.md: no silent fallback, a missing required input fails loud.

**Expected:** An invalid workflow (or any non-ai) section fails loud on every command that loads the config — exit 4 naming the key path — or at minimum prints one stderr warning naming the key path and the settings that fell back to defaults
**Actual:** loadLoreApp parses .lore/config.yaml, and on a schema failure outside 'ai' uses undefined config silently (loader.ts:21-26 'keeps the pre-existing silent fallback-to-undefined behaviour — a documented non-goal of SPEC-030'); a co_change rule missing 'require' therefore disables the project's gates config without any output

Reported by: agent:session-2f964849
