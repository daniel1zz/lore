---
id: PLAN-273
type: plan
role: plan
title: "Defect reports carry their own context"
status: archived
priority: medium
created: 2026-10-24
updated: 2026-10-25
tags: []
parent: SPEC-237
phases:
  - {name: "R", description: "Report fields, repro check, context attachment (sequential)"}
---
# Defect reports carry their own context

## Goal

Land spec-defect-reports-carry-their-own-context-a-checked-repro: repro command checked at filing, repro steps / suggested fix / refs as their own sections, the named test file's context attached, severity and category stated as required everywhere.

## Preconditions

- Spec approved.
- Base is current main (owner decision 2026-10-25); gs-integration's eventual lander resolves the overlap.

## Tasks

- R1 (phase R, first): checkReproCommand in the CLI and MCP input adapters; --repro-steps, --suggested-fix, --refs on CLI and MCP; body sections in order with a fenced repro block (and the BR-494 body-contract assertion updated to it); help, MCP describe() and hint state severity/category required. AC-RI-1, AC-RI-2, AC-RI-5.
- R2 (phase R, after R1): leading-comment boundary moved into packages/lore (scripts import it); parseGithubRemote; redactHomeInText; context builder (test-file pick, same-repo decision, @spec_ref lines, 40-line header for the same repo, symlink guard); wired into the filing body. AC-RI-3, AC-RI-4, AC-RI-6.

Sequential because both edit report-issue-wiring.ts.

## After landing (main agent)

1. `lore verify` the plan in a worktree of main (with the owner's approval for new commands); `lore rule apply` the change set (BR-491, BR-492, BR-494 modified; BR-1380, BR-1381 added).
2. Update baseline-file-a-defect-report prose (summary; current values for the 40-line cap and the builtin list; the agent-tool boundary note's list of exit-code rules gains BR-1381; the MCP note that says it "takes no tags" if still wrong) and review + approve it.
3. `lore assess` the plan.

## Decisions Log

- 2026-10-24 owner: front-matter block unchanged; context = header (≤40 lines) only when reporter is the upstream repo, else @spec_ref lines only.
- 2026-10-24 AI: "runnable" = one line, shell-lexable, program is lore / a builtin / on the caller's PATH / an existing path, checked at the input adapters only; fenced repro block; @spec_ref attached verbatim; MCP severity/category described as required, refused by the handler; same repo = parsed origin on github.com; home prefix in attached text becomes ~.
- 2026-10-24 bundle review: 13 findings applied in one pass (spec v13+, BR-1380/1381 amended, AC-RI-1..6, task anchors, this plan).
- 2026-10-25 owner: implement on current main now (gs-integration idle since 2026-10-19, unowned).
