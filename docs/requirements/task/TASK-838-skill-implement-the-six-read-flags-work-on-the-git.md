---
id: TASK-838
type: task
role: plan
title: "[Skill:implement] the six read flags work on the GitHub path instead of refusing"
status: archived
priority: critical
phase: "P5: Verification"
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PLAN-145
plan: PLAN-145
---
MEASURED 2026-08-25 on main, and confirmed by lore assess as a MAJOR: commands/issues.ts:482 still refuses --verify/--open/--resolved/--all/--severity/--category against a GitHub-configured upstream with exit 4. 'lore issues --open' — the most natural invocation of the flow this whole plan exists to open — FAILS.

⛔ AC-GR-8 reported 0 the entire time. Its scan pins two literals; the surviving refusal reads 'are not yet supported by' (plural) and cites 'a later phase of spec-a-github-filed-defect-must-be-claimable' — a DIFFERENT spec name — so it matched neither needle. A substring scan can only falsify the wordings its author imagined. AC-GR-8 now carries a BEHAVIOURAL conjunct that measures the property instead, and that conjunct is RED as of this task's creation (--all exit 4, --severity exit 4, measured).

⛔ The refusal cites 'a later phase' of THIS spec, which declares no such phase — the precise falsehood this spec's own Overview condemns in three other places. Either the behaviour lands or the phase gets declared; leaving the sentence standing is the one option ruled out.

SCOPE: make all six work on the GitHub read path.
- --open / --resolved / --all: filter by COMPUTED resolution, the same semantics the local path already uses (TERMINAL_ISSUE_RESOLUTIONS is the SSOT member set — import it, never re-list).
- --severity / --category: filter on the front-matter fields parseIssueBody already decodes.
- --verify: the resolution-label drift check. GitHub's issues REST payload already carries a labels array, so GithubIntakePort.listIssues can surface labels with NO extra network call — that is why github-intake-port.ts is anchored here. Keep the batching invariant AC-GI-12 pins: call count for 50 issues equals call count for 1.

⛔ Do NOT satisfy this by deleting the flags or by making them silent no-ops. ⛔ Do NOT reword the refusal — rewording is exactly what defeated the previous oracle.
