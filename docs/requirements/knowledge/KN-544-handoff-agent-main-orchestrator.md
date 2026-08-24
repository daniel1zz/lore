---
id: KN-544
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: PLAN-138
---
# Handoff — agent:main-orchestrator

SCOPE: 6 decisions + 6 next steps = 12 items to account for

## Plan

plan-land-the-github-intake-defect-channel-runner-cap-removal

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | USER DIRECTIVE, top priority next session: lore MUST be able to READ BACK GitHub issues. Without it the defect channel is a one-way hole — an agent cannot pick up a filed defect to fix. | 99 |
| KD2 | Measured asymmetry (feedback.upstream.repo = daniel1zz/lore): report-issue FILES to GitHub, but 'lore issues' exits 4 and 'report-issue --list' exits 4. Only 'lore issues --local' works, showing 27 open legacy local reports. | 98 |
| KD3 | The read side is ALREADY SPECIFIED: the spec lists GitHubIntakePort as verifyTarget/searchDuplicates/fileIssue/listIssues, and AC-GI-12 exists. But listIssues is ABSENT from github-intake-port.ts and AC-GI-12 has no evidence rows. | 96 |
| KD4 | Ticket 120 NS1 rests on a FALSE premise. Measured dry-run: 34 of 34 migration candidates SKIPPED, each for missing extra.issue_report fields (reporter_corpus, reporter_root_prd, tags). Zero migratable as-is. | 97 |
| KD5 | report-issue shape work is DONE and pushed (06aa81cb): SPEC-147 + SPEC-149 closed, both plans archived, typecheck EXIT=0, bun test EXIT=0, vitest 1 failed of 9348 (deferred ENOBUFS only). Detail in handoff 126. | 98 |
| KD6 | Efficiency retro: about half this session was waste, not discipline. Four causes, all avoidable — a stale worktree baseline stalled an agent 600s; a merge without typecheck forced a repair round; false byte-identical/CLOSED claims forced document sweeps; 9 of 10 red tests were self-inflicted. | 95 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS-A: implement GitHubIntakePort.listIssues and wire it into 'lore issues' (drop the exit-4 refusal for the GitHub shape) plus 'lore report-issue --list'. AC-GI-12 already states the batching invariant (call count for 50 == call count for 1) and names packages/lore/tests/unit/service/issue-read-batching.test.ts — CHECK whether that file exists before assuming the AC is merely unevidenced. Ticket 120 NS5 flags AC-GI-12's oracle as a vitest unit file while its statement promises CLI-surface behaviour: re-anchor onto a CLI-level probe.
- NS2: NS-B: the acceptance bar is 'an agent can list open GitHub-filed defects and CLAIM one to fix' — the user's stated purpose — not merely that a listing renders. Design the AC around that outcome, not around the API call.
- NS3: NS-C: 34 of 34 legacy local reports cannot migrate (missing reporter_corpus / reporter_root_prd / tags). Decide explicitly: backfill the fields, migrate a subset, or leave them local-only and say so in the spec. Undecided keeps 27 open reports invisible to the GitHub read path once it exists.
- NS4: NS-D: plan-land-the-github-intake-defect-channel-runner-cap-removal still has 1 READY task — task-skill-test-final-verification-full-suite-attested-ac, draft, ac_scope=[] — so 'lore verify' is structurally inapplicable while assess counts its absence as an undischarged exit criterion. Give it a real ac_scope or retire it (ticket 120 NS3, still open).
- NS5: NS-E: ticket 121's NS1/NS2/NS3 (lore list --fields for the ENOBUFS; --type scoping for the two drift-check timeouts; runLore surfacing result.error) remain deferred with decisions recorded. The spawnSync audit needs a check script, not a manual sweep over 200+ files.
- NS6: NS-F: a CONCURRENT session's worktree remains — worktree-agent-ab25e8547e82af95f, LOCKED, 1 unmerged commit b1916362. Not mine; only its owner may remove it. My own four worktrees and branches are cleaned up; tree clean, origin in sync.
