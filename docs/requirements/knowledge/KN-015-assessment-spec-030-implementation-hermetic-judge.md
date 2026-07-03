---
id: KN-015
type: knowledge
role: knowledge
title: "Assessment: SPEC-030 Implementation — hermetic judge + fail-loud config (2026-07-03)"
status: draft
priority: medium
created: 2026-07-03
updated: 2026-07-03
tags: []
parent: PLAN-010
links:
  - {id: PLAN-010, type: informs}
---
# Assessment: met (90/100)

Scope: plan `01KWKDC4JTNX1SQEK2G5XSZQXP`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-HJ-1 | 92 | hermetic-spawn.ts adds pure buildHermeticSpawnSpec/sanitizeSpawnEnv/isClaudeCliCommand: neutral tmpdir cwd, denylist strips CLAUDECODE+CLAUDE_*, official --setting-sources "" for claude (--bare rejected, documented). Bun.spawn callsite consumes builder; vitest unit tests + wiring test present. | task-hermetic-judge-spawn-timeout-error-guidance-ac-hj-1-2-4-ac (hermetic-spawn.ts + tests) |
| AC-HJ-2 | 88 | stdin pipe, timeout kill, stdout/stderr collection, error taxonomy untouched; only cwd/env added and args extended additively (user -p preserved ahead of injected flags). REGRESSION test pins arg order. Full generate() body not shown but diff scope is minimal/additive. | task-hermetic-judge-spawn-timeout-error-guidance-ac-hj-1-2-4-ac |
| AC-HJ-3 | 92 | describeConfigIssue reconstructs dotted path (ai.cli) + did-you-mean hint; isAiConfigValidationError classifies ai-scoped errors; loader fails loud via exitCode/formatError, non-ai blocks keep silent fallback. Absent ai block stays valid. Live check exit=4 + integration tests. | task-fail-loud-ai-config-parsing-r3-housekeeping-assertions-ac-h, task-closeout-030-oracles-rebuild-no-workaround-self-assess-ac-h (live AC-HJ-3 check) |
| AC-HJ-4 | 92 | Timeout message names configured timeout_ms value, ai.providers.<name>.timeout_ms knob, REPLACES-built-in semantics, and restate command/args example. 5 bun tests pin substrings incl. dynamic value (200 vs 350) proving not hardcoded. | task-hermetic-judge-spawn-timeout-error-guidance-ac-hj-1-2-4-ac (ai-timeout.bun.test.ts) |
| AC-HJ-5 | 92 | hermetic-spawn.test.ts and config.test.ts both carry explicitly labeled HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/REGRESSION blocks. ERROR (never-throws: empty-string kept, undefined dropped) deliberately separated from NEGATIVE per round-3 feedback. | task-fail-loud-ai-config-parsing-r3-housekeeping-assertions-ac-h |
| AC-HJ-6 | 84 | Closeout evidence [5] reports lore assess PLAN-030 with workaround env vars UNSET on the contamination machine: clean JSON, retried=false, 36.9s, zero pollution vs 3/7 baseline. Detailed but self-reported by main-agent, not independently verifiable here — scored conservatively. | task-closeout-030-oracles-rebuild-no-workaround-self-assess-ac-h (root-cure run) |
| AC-HJ-7 | 92 | New assess test feeds a REAL computed assessPlan result (not a literal) through renderAssessmentContent and asserts persisted content contains 'Reasoning clipped for:' + AC-ASSESS-1, plus a negative regression when nothing clipped. Closes round-3 AC-AR-3 rendering gap. | task-fail-loud-ai-config-parsing-r3-housekeeping-assertions-ac-h (ai-provider-service-assess.test.ts) |

## Gaps

- AC-HJ-6 root-cure success is self-reported by the implementing agent; no independent artifact (e.g. raw judge transcript) is included for verification.
- AC-HJ-2 relies on the diff being minimal; the full generate() body (timeout watchdog, stdout collection) is not shown, only the changed spawn callsite.

## Recommendations

- Attach the raw clean-JSON judge output / run log from the AC-HJ-6 root-cure run as a durable artifact so the contamination-free result is independently auditable.
- Consider an assertion pinning that the sanitized env passed to Bun.spawn preserves auth vars (ANTHROPIC_API_KEY/HOME) in the wiring test, not just the unit test, to fully close AC-HJ-1's authenticate-preservation clause end-to-end.

## Judgment

- Provider: claude-cli
- Prompt version: 2
- Duration: 42197ms
- Retried: false
- Truncated sections: (none)
