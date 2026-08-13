---
id: KN-016
type: knowledge
role: knowledge
title: "Assessment: SPEC-030 Implementation — hermetic judge + fail-loud config (2026-07-03)"
status: approved
priority: medium
created: 2026-07-03
updated: 2026-07-08
tags: []
parent: PLAN-010
links:
  - {id: PLAN-010, type: informs}
---
# Assessment: partially_met (77/100)

Scope: plan `01KWKDC4JTNX1SQEK2G5XSZQXP`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-HJ-1 | 92 | buildHermeticSpawnSpec pure builder sets tmpdir cwd, sanitizes CLAUDECODE/CLAUDE_* denylist, injects --setting-sources "" only for claude basename; official flag probed/documented, --bare rejected with rationale. Vitest unit + bun wiring test both pass. | task-hermetic-judge-spawn-timeout-error-guidance-ac-hj-1-2-4-ac |
| AC-HJ-2 | 87 | Diff touches only cwd/env/args at spawn callsite; stdin pipe, timeout kill, stdout/stderr collection, error taxonomy untouched. REGRESSION test pins args as additive (-p ahead of injected flags). Full test suites pass. No direct assertion re-verifying stdin path but low risk. | task-hermetic-judge-spawn-timeout-error-guidance-ac-hj-1-2-4-ac |
| AC-HJ-3 | 90 | describeConfigIssue names dotted path + ai.providers.<name> hint; isAiConfigValidationError classifies ai-scoped errors; loader fails loud via exitCode/process.exit, non-ai blocks keep silent fallback. Absent ai: stays valid. config.test.ts + integration (exit 4, stderr checks) pass. | task-fail-loud-ai-config-parsing-r3-housekeeping-assertions-ac-h |
| AC-HJ-4 | 92 | Timeout message names configured timeout_ms, ai.providers.<name>.timeout_ms knob, REPLACES-built-in semantics with command/args restatement example. 5 bun tests pin substrings incl. value-not-hardcoded (200 vs 350). Passes. | task-hermetic-judge-spawn-timeout-error-guidance-ac-hj-1-2-4-ac |
| AC-HJ-5 | 89 | hermetic-spawn.test.ts and config.test.ts carry explicitly labeled HAPPY/NEGATIVE/BOUNDARY/ERROR/STATE/REGRESSION blocks; ERROR (never-throws) separated from NEGATIVE per round-3 feedback. Wiring test is single end-to-end proof deferring dims to unit suite, defensible. | task-fail-loud-ai-config-parsing-r3-housekeeping-assertions-ac-h |
| AC-HJ-6 | 30 | Closeout task is status=draft with NO evidence recorded. The required proof — a real `lore assess` succeeding without CLAUDE_STATE_BASE_OVERRIDE/CLAUDE_PROMPT_FILE_OVERRIDE on the contaminated machine — is absent. Root-cure verification unproven. | task-closeout-030-oracles-rebuild-no-workaround-self-assess-ac-h (draft, no evidence) |
| AC-HJ-7 | 88 | ai-provider-service-assess.test.ts feeds real assessPlan result through renderAssessmentContent, asserting persisted content contains 'Reasoning clipped for:' + AC id, plus regression that unclipped omits it. Config task evidence [2] shows it passing. | task-fail-loud-ai-config-parsing-r3-housekeeping-assertions-ac-h |

## Gaps

- AC-HJ-6 root-cure verification has no evidence: closeout task is draft, no recorded no-workaround `lore assess` run on the contaminated machine.
- AC-HJ-2 relies on diff inspection; no explicit test re-asserts stdin-piping/stdout-collection unchanged (low risk).
- Real `claude --setting-sources ""` isolation behavior verified only manually by implementer, not in automated tests (out of scope but unverifiable here).

## Recommendations

- Complete the closeout task: run `lore assess` on this plan with workaround env vars unset on the reproduction machine and record the run + oracle evidence for AC-HJ-6.
- Record the rebuild oracle result referenced in the closeout title to substantiate the root-cure claim.
- Optionally add a direct assertion that stdin/stdout handling is byte-identical to lock AC-HJ-2.

## Judgment

- Provider: claude-cli
- Prompt version: 2
- Duration: 36865ms
- Retried: false
- Truncated sections: (none)
