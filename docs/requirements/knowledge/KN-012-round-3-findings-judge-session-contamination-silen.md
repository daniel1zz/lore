---
id: KN-012
type: knowledge
role: knowledge
title: "Round-3 findings: judge session contamination + silent ai-config fallback (SPEC-030 candidates)"
status: approved
priority: medium
created: 2026-07-03
updated: 2026-07-03
tags: [assess, reliability, backlog]
parent: SPEC-029
---
Three defects observed while closing the SPEC-029 loop (2026-07-03): (1) JUDGE SESSION CONTAMINATION — the claude-cli provider spawns 'claude -p' inheriting the caller's cwd and env, so the judge session loads the host machine's Claude Code global hooks + project CLAUDE.md; a user Stop-hook that demands marker-formatted final messages replaced the judge's JSON (claude -p returns only the LAST assistant message), failing assess nondeterministically (4 clean runs, then 3 polluted). Workaround used: CLAUDE_STATE_BASE_OVERRIDE + CLAUDE_PROMPT_FILE_OVERRIDE env pointing at nonexistent paths disarms this specific hook. Real fix: hermetic judge spawn — neutral cwd (tmpdir), sanitized env, or prefer the SPEC-020 http provider for judging. (2) SILENT AI-CONFIG FALLBACK — an unknown key under 'ai:' (strict Zod) makes the whole ai block fail parse and lore silently reverts to ALL defaults (observed: max_diff_chars back to 24000, timeout back to 60s) with zero warning — violates the project's own fail-loud principle (D-007 precedent). Fix: config parse failure should fail loud naming the offending key. (3) PROVIDER TIMEOUT UNDER LOAD — 60s default killed judge calls at load-average ~10; correct knob is ai.providers.claude-cli.timeout_ms (entry REPLACES built-in so command+args must be restated) — discoverability is poor, one wrong shape triggers finding #2. Positive validations same session: pre-flight diff warning fired correctly (24000-default case), AC-AR-5 hint shown during real timeout, prompt v2 + clip resilience ran retried=false twice, diff-curation效应第三次复现（diluted 84 vs clean 88）.
