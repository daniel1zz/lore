---
id: TASK-1049
type: task
role: plan
title: "session-start-fragments injects a false 'render failed' banner every session when hook:session-start has zero fragments"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hooks","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"2756333b-52e3-4e35-bc46-a6f45f86eea5"}
---

assets/hooks/session-start-fragments.mjs relays 'lore fragments render --outlet hook:session-start'. Its D12 contract is 'never empty output': when the render's additionalContext is empty it substitutes banner('render emitted no additionalContext'), producing '[session-start-fragments] lore fragments render failed: render emitted no additionalContext'. But an empty additionalContext is the render's NORMAL, successful result whenever the outlet has no fragments and there is no rules drift — and 'lore fragments check --json' reports hook:session-start with chars 0 and fragmentIds [] in this repo's current configuration. So in the steady state every session (and every /compact, via the compact matcher) starts with an injected line telling the model a lore component failed, although render exited 0. This violates the corpus 'must not lie' property and trains the model to ignore the banner, which then also hides real failures. The hook cannot tell 'nothing to say' from 'failed' because the render gives it no distinct signal.

**Expected:** A successful render with no fragments and no drift produces no injection (or an explicitly non-failure line); the 'render failed' banner appears only on a spawn error, non-zero exit, or non-hook stdout.
**Actual:** render exits 0 with {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":""}} and the hook emits additionalContext '[session-start-fragments] lore fragments render failed: render emitted no additionalContext'.
**Repro command:** `d=$(mktemp -d); lore fragments render --outlet hook:session-start --cwd $d; echo " exit $?"; echo '{"cwd":"'$d'"}' | node assets/hooks/session-start-fragments.mjs`

Reported by: agent:main-orchestrator
