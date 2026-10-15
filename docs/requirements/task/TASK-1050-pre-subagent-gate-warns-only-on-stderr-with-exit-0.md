---
id: TASK-1050
type: task
role: plan
title: "pre-subagent-gate warns only on stderr with exit 0, which Claude Code never shows the model, so the 'main agent must not write code' gate reaches nobody"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: PRD-001
---
---
{"severity":"medium","category":"hooks","tags":[],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"58f3e1b8-479c-4dc1-bfaf-33fb41f28df6"}
---

assets/hooks/pre-subagent-gate.mjs (PreToolUse on Edit|Write|MultiEdit, registered in .claude/settings.json; byte-identical installed copy at ~/.claude/hooks/pre-subagent-gate.mjs) is documented as an ADVISORY gate: every path exits 0 and the warning is written with process.stderr.write (line ~128). Claude Code's hook contract (https://code.claude.com/docs/en/hooks, exit-code-0 section, verbatim): 'Claude never sees stderr from a hook that exits 0. To read it yourself on events such as PreToolUse, enable debug logging.' So the warning reaches neither the model nor the transcript; it is visible only under --debug. The user-level rule lore-user-15-dispatch says the main-agent no-code rule is 'Hook 强制' (hook-enforced), which is false on two counts: it does not block, and its advisory text is not delivered. The documented non-blocking channel is hookSpecificOutput.additionalContext on stdout (JSON), which PreToolUse inserts next to the tool result. Not enforced = should be counted as not enforced (North Star: 'What refuses this when it is violated?').

**Expected:** Either the warning is delivered to the model (stdout JSON hookSpecificOutput.additionalContext with hookEventName PreToolUse, exit 0), or the gate blocks (exit 2 / permissionDecision deny) per its rule; and the rule text describing it matches what it actually does.
**Actual:** Warning goes to stderr with exit 0; Claude Code discards it for the model. Measured: payload Edit on packages/lore/src/app.ts, file not read -> stderr '⚠️ [SUBAGENT_GATE] WARNING: Edit on .../app.ts Reason: file not Read this turn', stdout 0 bytes, exit 0.
**Repro command:** `printf '%s' '{"tool_name":"Edit","tool_input":{"file_path":"'$PWD'/packages/lore/src/app.ts","old_string":"a\\nb\\nc\\nd\\ne","new_string":"x\\ny\\nz\\nw\\nv"}}' | node assets/hooks/pre-subagent-gate.mjs 2>/dev/null; echo "exit $? (stdout above is empty; warning was stderr only)"`

Reported by: agent:main-orchestrator
