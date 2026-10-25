---
id: KN-763
type: knowledge
role: knowledge
title: "Assessment: Bind prose to code: resolver and reverse index, edit-time notice, stable generated sections (2026-10-19)"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-23
tags: []
parent: PLAN-231
links:
  - {id: PLAN-231, type: informs}
---
# Assessment: met (83/100)

Scope: plan `01M59E47ZEMQB36KPM9RRPQH2W`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-BIND-1 | 88 | Four attested passes, each going red first. The diff sends memory-file references through computeDrift, the resolver spec anchors already use, and emits a deterministic reference_unresolved finding. A consumer-repo test checks exit code 3 under enforce. Under the default warn mode the finding is do… | 01M59E7K2XP2PWVBGHBFDK1V26 (evidence [1],[4],[9],[14]-[18],[23]) |
| AC-BIND-2 | 85 | Attested red, then green. script_missing was added to DRIFT_KINDS. The bun/npm run invocation regex skips file-run forms. Fragments are wired in through referenceDocuments. A bare script name binds only when the script exists, as the plan note requires. The hard-coded assets/context fragment dir is… | 01M59E7K2XP2PWVBGHBFDK1V26 (evidence [2],[5],[11],[19],[24]) |
| AC-BIND-3 | 84 | Eight tests pass after going red, covering the exact bindings, an unbound path returning an empty list with exit 0, folder anchors and read-only behaviour. listDeclaredAnchors shares one read with the drift check. refs.ts and code-reference-index.ts are not in the shown diff. MCP parity is unverifi… | 01M59E7K2XP2PWVBGHBFDK1V26 (evidence [3],[6],[12],[20],[25]) |
| AC-BIND-4 | 80 | Red first, then nine hook tests pass: a bound file is named, an unbound file returns nothing, and an unrelated script change returns nothing. The hook is registered as PostToolUse. The hook source is not shown. There is no attested proof that it was verified from a fresh consumer install (throwaway… | 01M59E7NKYMX4E10VE76RDA424 (evidence [1],[2],[5]) |
| AC-BIND-5 | 80 | The diff removes the count line from the module index, moves it to refresh --check output, and turns documentedScripts into a validated map of name to description rendered in the table. AC-BIND-5 passed once after going red. No evidence that the AC-MI-1 count-clause change was recorded or reported. | 01M59E7R4E1NAY4RKBBRFPKE5V (evidence [1],[3],[6]) |

## Gaps

- The task requires recording the AC-MI-1 count-clause change according to the AC-change rules. No evidence or diff shows it was recorded or reported.
- No MCP tool parity for the lore refs verb is shown. Only the CLI loader in packages/lore/src/adapters/cli/index.ts is visible.
- There is no attested evidence that the hook was verified from a fresh consumer install with a throwaway HOME, which the task asked for.

## Recommendations

- Require an evidence entry or a linked note whenever a task changes an existing AC clause, such as the AC-MI-1 count clause.
- Make the implement skill confirm CLI/MCP parity explicitly, with a test or a recorded exemption, whenever it adds a new CLI verb.

## Judgment

- Provider: claude-cli
- Prompt version: 8
- Reproducible: yes (this prompt_version's rendering is guaranteed byte-identical)
- Duration: 34590ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/integration/context/generated-sections-stable.test.ts, diff:CLAUDE.md, diff:package.json, diff:packages/lore/tests/integration/context-module-index.test.ts, diff:packages/lore/tests/unit/service/context-facts.test.ts, diff:packages/lore/tests/integration/hooks/post-edit-bindings.test.ts, diff:assets/hooks/post-edit-bindings.mjs, diff:packages/lore/tests/unit/adapters/real-setup-ports.test.ts, diff:packages/lore/tests/unit/assets-ssot.test.ts, diff:packages/lore/tests/unit/core/distribution-hooks.test.ts, diff:packages/lore/tests/integration/hooks/post-edit-bindings.test.ts, diff:packages/lore/tests/integration/claude-md-wiring.test.ts, diff:packages/lore/tests/unit/service/claude-md-admission.test.ts, diff:packages/lore/tests/unit/service/claude-md-reference-grammar.test.ts, diff:packages/lore/tests/unit/service/claude-md-reference-shim.ts, diff:packages/dashboard/CLAUDE.md, diff:packages/lore/src/store/CLAUDE.md, diff:packages/lore/src/adapters/cli/commands/refs.ts, diff:packages/lore/src/service/claude-md-admission.ts, diff:packages/lore/src/service/code-reference-index.ts, diff:packages/lore/tests/integration/cli/lore-refs.test.ts, diff:packages/lore/tests/unit/service/bind-script-reference.test.ts, diff:packages/lore/tests/unit/service/bind-symbol-reference.test.ts, diff:packages/lore/src/service/claude-md-admission.ts, diff:packages/lore/tests/integration/claude-md-wiring.test.ts, diff:packages/lore/tests/unit/service/bind-script-reference.test.ts, diff:packages/lore/tests/unit/service/claude-md-reference-grammar.test.ts, diff:packages/lore/tests/unit/service/claude-md-reference-shim.ts, diff:packages/core/src/CLAUDE.md, diff:packages/core/src/fragment-fingerprint.ts, diff:packages/core/src/index.ts, diff:packages/lore/src/adapters/cli/commands/setup.ts, diff:packages/lore/src/adapters/cli/memory-file-health.ts, diff:packages/lore/src/adapters/real-memory-file-probe.ts, diff:packages/lore/src/flows/context-flow.ts, diff:packages/lore/src/flows/setup-project-flow.ts, diff:packages/lore/src/service/claude-md-admission.ts, diff:packages/lore/src/service/code-reference-index.ts, diff:packages/lore/src/service/context-fragments/section.ts, diff:packages/lore/tests/integration/cli/context-refresh-check-references.test.ts, diff:packages/lore/tests/unit/service/bind-symbol-reference.test.ts, diff:packages/lore/tests/unit/flows/setup-project-claudemd.test.ts, diff:packages/lore/tests/integration/cli/consumer-repo-reference-check.test.ts, diff:packages/lore/tests/integration/cli/consumer-repo-reference-check.test.ts, diff:packages/core/src/code-anchors.ts, diff:packages/lore/src/service/claude-md-admission.ts, diff:packages/lore/tests/integration/cli/malformed-anchor-token.test.ts
- Reasoning clipped for: AC-BIND-1, AC-BIND-2, AC-BIND-3, AC-BIND-4

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.7 | evidence | All five ACs have attested passes and the diff shows a shared resolver, a reverse index, the hook and stable generated sections. The AC-MI-1 recording and MCP parity are unconfirmed. |
| evidence_integrity | 85 | 0.75 | evidence | Every record is attested, each AC went red first, and tsc passed. AC-BIND-5 has only one AC-referenced pass. The Vite close timeouts are noise. |
| scope_fidelity | 80 | 0.65 | evidence | Changes stay inside D1-D5. The CLAUDE.md reference fixes were required by the task. Adding assets/context and the ancestor-relative resolution goes slightly beyond the plan. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-BIND-5 | The task requires recording the AC-MI-1 count-clause change according to the AC-change rules. No evidence or diff shows it was recorded or reported. |
| outcome | minor | AC-BIND-3 | No MCP tool parity for the lore refs verb is shown. Only the CLI loader in packages/lore/src/adapters/cli/index.ts is visible. |
| evidence_integrity | minor | AC-BIND-4 | There is no attested evidence that the hook was verified from a fresh consumer install with a throwaway HOME, which the task asked for. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| process | Require an evidence entry or a linked note whenever a task changes an existing AC clause, such as the AC-MI-1 count clause. | Otherwise AC changes go untracked. |
| skill | Make the implement skill confirm CLI/MCP parity explicitly, with a test or a recorded exemption, whenever it adds a new CLI verb. | Parity for lore refs is currently unverifiable. |

## Unverifiable Materials

- packages/lore/src/adapters/cli/commands/refs.ts and packages/lore/src/service/code-reference-index.ts: Omitted from the diff, so the reverse-index logic cannot be inspected.
- assets/hooks/post-edit-bindings.mjs: Hook source omitted, so the git pre-edit content handling and the script-diff logic cannot be checked.
- AC-MI-1 change record: No evidence or diff shows the AC update.

## Finding Path Verification

- Checked (confirmed present at the assessed commit): 1
- Unverifiable (confirmed absent — finding withdrawn): 0
- Not shown to the judge (omitted from the diff by truncation — finding withdrawn, NOT judged): 1
- Unchecked (NO assessed-commit referent — NOT verified; do not read as "fine"): 0

## Withdrawn Findings (Path Verification)

1 finding(s) below were EXCLUDED from ac_scores/typed_gaps/gaps because a path they declared was never shown to the judge or does not exist at the assessed commit. overall_score above is NOT recomputed to account for their removal.

- [minor] discoverFragmentDocuments in packages/lore/src/adapters/real-memory-file-probe.ts hard-codes assets/context, the shipped layer of this repo, so consumer repos with an unrelated assets/context directory get their prose checked. — "packages/lore/src/adapters/real-memory-file-probe.ts" was never shown to the judge (omitted from the truncated diff)

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=1.00
