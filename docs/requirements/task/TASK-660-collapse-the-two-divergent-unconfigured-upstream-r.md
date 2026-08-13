---
id: TASK-660
type: task
role: plan
title: "Collapse the two divergent unconfigured-upstream remedies into one builder and land the feedback stanza so report-issue works in lore's own repo"
status: archived
priority: high
phase: "remedy"
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: PLAN-122
plan: PLAN-122
---
AC-GD-2 / D3. lore report-issue --list exits 4 in lore's own repo (measured: 318 bytes, feedback.upstream is not configured) — the canonical channel for reporting a lore defect is dead where lore's defects are found. Worse, the SAME condition has two divergent remedies: report-issue.ts:101 via buildAutoConfigRequiredError prescribes lore report-issue --auto-config, while issue-report-service.ts:315 via buildUnconfiguredUpstreamError (:274-287) prescribes a hand-edited YAML stanza. Collapse both onto ONE shared builder so the prescribed remedy cannot drift between layers, and assert sameness by builder IDENTITY, not by two string literals that happen to match today. The text MUST disclose that the remedy writes .lore/config.yaml, which is git-tracked and team-shared (verified: git check-ignore reports no match). Then land the feedback: stanza in this repo's own .lore/config.yaml so lore report-issue --list exits 0 on main — the upstream configuring itself is legitimate, not circular, because feedback.upstream names WHERE REPORTS GO and for the upstream that is its own corpus. ⛔ Read the file's current contents back before writing and add only the feedback key; a whole-field replacement silently discards what another session appended. Also remove the now-redundant capture_timeout_ms and max_diff_chars overrides (the sibling defaults task raises the code defaults): while they remain, a test reading this repo's config instead of the shipped surface would still see 1200000/80000 and AC-GD-1's third clause would pass vacuously. Provisioning is exercised against a THROWAWAY corpus; only the final --list exit-code clause reads this repo, and that path is read-only.
