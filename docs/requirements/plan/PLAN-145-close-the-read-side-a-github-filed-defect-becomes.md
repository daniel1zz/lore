---
id: PLAN-145
type: plan
role: plan
title: "Close the read side: a GitHub-filed defect becomes claimable, on every surface"
status: approved
priority: critical
created: 2026-08-24
updated: 2026-08-24
tags: [defect-channel, github, read-side, claimable]
parent: SPEC-150
phases:
  - {name: "P0: Convergence primitive"}
  - {name: "P1: Pure modules"}
  - {name: "P2: Filing-time wiring"}
  - {name: "P3: Read surface"}
  - {name: "P4: Adopt + MCP"}
  - {name: "P5: Verification"}
---
## Goal

Close the read side of the GitHub defect channel so the everyday flow works: **list an open defect → CLAIM it to fix → change its state**. Governing spec: `spec-a-github-filed-defect-must-be-claimable-one-ingest-seam` (approved, 12 script-mode ACs).

Measured starting point (2026-08-24, `c27e021c`): `lore issues` exit 4, `lore report-issue --list` exit 4, MCP `lore_report_issue` refuses the GitHub shape, and `fileGithubIssue` makes no corpus write — so a GitHub-filed defect has no claimable corpus object at all. `GitHubIntakePort.listIssues`, `parseIssueBody`, `computeIssueResolution` and the whole `lore issue resolve` → `ResolutionProjector` label round-trip already exist and are attested.

## Phases

| Phase | Scope | Why this order |
|---|---|---|
| P0: Convergence primitive | verbatim `slug` on `createDocInputSchema` + `CorpusService.create` honours it | Everything downstream mints a deterministic slug; without the store's UNIQUE index as the arbiter, every later task races |
| P1: Pure modules | `issue-task-shaping.ts`, `github-issue-listing.ts`, plus the numeric-repo-id plumbing through `verifyTarget` and `GithubIssueRef` | Both adapters consume these; they are store-free and total, so they land before any wiring |
| P2: Filing-time wiring | `fileGithubIssue` mints the corpus task; split-write error names the filed issue; `resolveGithubIssueListing` port seam | Makes a report filed from this machine claimable with no new command — the shortest path to the user's bar |
| P3: Read surface | `commands/issues.ts` GitHub branch; `report-issue --list` delegation | Needs P1's joiner and P2's port seam |
| P4: Adopt + MCP | `lore issue adopt <n>`; MCP `lore_report_issue` onto the same `fileGithubIssue` | Adopt closes defects filed elsewhere; MCP closes the last surface with no path to a defect record |
| P5: Verification | run all 12 ACs attested, declare structured falsifiers, re-approve, rebuild `dist/lore`, full suite on main | AC-GR-8 can only go green after P3 AND P4 delete their refusals |

## AC → phase map

Declared mechanically as each task's `extra.ac_scope`, and restated here so the plan is legible without opening seven tasks. ⛔ No phase merges without an oracle of its own — `lore review` flagged the absence of this table on v1 and was right that the prose did not say so.

| Phase | ACs it turns green | Where |
|---|---|---|
| P0 | AC-GR-4 | the two-process race over one db file |
| P1 | AC-GR-5, AC-GR-6 | `github-issue-listing.ts` (rename-proof join), `issue-task-shaping.ts` (total + injective slug) |
| P2 | AC-GR-7, AC-GR-9 | split-write naming; filing alone makes a defect claimable |
| P3 | AC-GR-1, AC-GR-2, AC-GR-10, AC-GR-12 | listing reaches GitHub; injective rendering (spec **G3**, held here in `joinListing`'s row kinds and asserted at the CLI, never as a 10th resolution state — D6); the `--local` boundary; the read writes nothing |
| P4 | AC-GR-3, AC-GR-11 | adopt → claim → resolve label round-trip; the MCP filing surface |
| P5 | AC-GR-8 | the tree-wide refusal scan, green only once P3 AND P4 have both deleted theirs |

## Invariants

1. ⛔ Every surface AC drives the REAL compiled `dist/lore` (or, for MCP, the real `registerTools` registration path) and measures an exit code / payload. A service-layer unit test may never stand in for a surface claim — `AC-GI-12` is green on a `GitHubIntakePort` unit test while `lore issues` exits 4, and that is the defect this plan exists to fix.
2. ⛔ Surface tests need a NEW payload-serving `gh` stub. `healthyGhStubDir()` is `exit 0` with EMPTY stdout by design; reusing it makes `listIssues()` fail parsing — a FALSE red. Do not widen the memoized helper.
3. ⛔ Every surface test seeds a throwaway corpus (`mkdtemp` + `lore init`). ⛔ Never write to this repo's own `.lore/`.
4. ⛔ `assertFreshBinary` runs before any `dist/lore` spawn — a stale binary yields a verdict about code not under test.
5. ⛔ Red-first evidence is recorded by the agent that produced the red, at the moment it was red (`lore evidence --result expected-fail`), never transcribed afterwards.
6. ⛔ The read path never writes (AC-GR-12). Ingest happens only inside `fileGithubIssue` and the `adopt` verb.
7. ⛔ Worktree oracles are scoped (`bun run test:changed <base>`); the full suite runs once on main after the last merge.

## Exit Criteria

- All 12 spec ACs carry an attested pass from `lore verify` — exit code decides, never self-report.
- All four `--falsifier-*` fields are declared on every script-mode AC, and each declared mutation actually produces its declared exit code (impossible to declare before the code exists; that is P5's own work).
- The spec is re-reviewed and re-approved after P5's `ac set` writes demote it.
- `lore issues`, `lore report-issue --list` and MCP `lore_report_issue` all reach GitHub; the AC-GR-8 scan is 0.
- `dist/lore` rebuilt after the final merge; both runners green on the full suite on `main`; the pre-push chain exit 0.
- `lore assess` run and every finding triaged.
