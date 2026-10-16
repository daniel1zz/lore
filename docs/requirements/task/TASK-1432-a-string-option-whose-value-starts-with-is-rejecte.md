---
id: TASK-1432
type: task
role: plan
title: "A string option whose value starts with -- is rejected as an unknown option"
status: draft
priority: medium
created: 2026-10-16
updated: 2026-10-16
tags: []
parent: PRD-001
---
---
{"severity":"low","category":"cli-dash-leading-option-value","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"209f1199-4316-46ea-a426-be341e7b61a7"}
---

Split from #225 (BR-1153). Every citty command reads a value that begins with '--' as a new flag; the value becomes empty and the error names the value as an unknown option.

**Expected:** The value is taken as the option's argument, or the error names the option missing a value and suggests --opt=value
**Actual:** Error: Unknown option: --leading dash
**Repro command:** `T=$(mktemp -d) && cd $T && git init -q && lore init >/dev/null && lore create knowledge --title "--leading dash" --sub-type reference --content x --no-ai`

Reported by: agent:session-c1ffea04
