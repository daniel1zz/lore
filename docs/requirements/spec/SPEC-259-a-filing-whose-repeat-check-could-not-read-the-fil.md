---
id: SPEC-259
type: spec
role: spec
title: "A filing whose repeat check could not read the filing log says so"
status: approved
priority: medium
created: 2026-10-27
updated: 2026-10-27
tags: []
---
# A filing whose repeat check could not read the filing log says so

## Overview/Goal

BR-500 records a suspected defect: when the local filing log cannot be read, repeat recognition is skipped without any message and the filing goes ahead, so a repeat can create a second issue. The code does exactly that (`report-issue-wiring.ts` `fileGithubIssue`: the repeat check runs only `if (priorReadResult.ok)`), and it also skips corrupt log lines silently (`ReceiptLogV2.read` returns them in `corrupt_lines`, which the filing never reads). Issue #287 was closed as "by design", but its closing comment says both "fails loud" and "a read error is treated as no prior filing", and the project forbids silent fallbacks (CLAUDE.md: a missing required input fails loud). No test asserts any of this.

Goal: the filing still goes ahead (a defect report is worth more than a possible duplicate, which the duplicate hint and repeat check try to catch), but it is never silent. When the log cannot be read, or some of its lines cannot be parsed, the result says repeat recognition was degraded and why, on the command line and through the agent tool, the same way a failed duplicate search already does (BR-501, `dedup_degraded`).

## Scope

- `fileGithubIssue` takes the receipt log through an injected reader (default `ReceiptLogV2`), so a test can make it fail without file permissions (a root-run CI reads a mode-000 file anyway).
- An unreadable log sets `repeat_check_degraded: { reason: "unreadable", detail, skipped_lines: 0 }` on the result; a log with corrupt lines sets `{ reason: "corrupt_lines", detail, skipped_lines: <n> }` and the repeat check still runs over the readable entries. Both the filed result and the early "already filed" result carry the field.
- CLI `lore report-issue` prints, like the existing duplicate-check line (`report-issue.ts`, stdout, `Warning:` prefix): `Warning: repeat check degraded (<detail>) — filed anyway.` (or `— recognised from the readable entries.` on the early return). MCP `lore_report_issue` returns the field.
- Relation to BR-497: an unreadable log usually also cannot take the filing's intent record, and then the filing is refused by BR-497 (nothing sent). This spec covers the case where reading fails but recording the intent succeeds, and the corrupt-lines case.
- BR-500 rewritten (modify) to state this as intended behaviour.

Out: refusing the filing (rejected, D1); the duplicate hint (BR-501, unchanged).

## Design Decisions

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| D1 | Unreadable log | file, and report the degradation | refuse with a storage error, as BR-497 does when the intent cannot be recorded | BR-497 protects the filing's own record; here only the duplicate guard is lost, and a lost defect report costs more than a possible duplicate, which the duplicate hint (BR-501) still names |
| D2 | Corrupt lines | check the readable entries, report the count | treat as unreadable | the readable entries still recognise most repeats |
| D3 | Shape | a result field beside `dedup_degraded`, and a stdout `Warning:` line like the duplicate-check one | a stderr line only | MCP callers read the result; the CLI keeps one warning style (BR-501 precedent) |

Benchmark: Sentry SDK transport and npm's cache both continue on a corrupt local cache while logging the degradation, rather than failing the user's action or hiding it.

## Acceptance Criteria

AC-RL-1 (BR-500, unit), AC-RL-2 (BR-500, CLI line and MCP field).

## Structure

```
packages/lore/src/adapters/cli/report-issue-wiring.ts   (degradation field)
packages/lore/src/adapters/cli/commands/report-issue.ts (stdout Warning line)
packages/lore/src/adapters/mcp/tools.ts                 (result field)
packages/lore/tests/unit/service/github-filing-split-write.test.ts
packages/lore/tests/unit/adapters/mcp-github-filing.test.ts
```


## Acceptance Criteria (structured)

- [⚑] [script] AC-RL-1: Unit (fileGithubIssue with an injected log reader): a failing read files the issue with repeat_check_degraded.reason 'unreadable'; a log with corrupt lines still recognises a repeat of an open issue among its readable entries and the early result carries reason 'corrupt_lines' with skipped_lines equal to the count; a clean log sets no degradation.
  script: test — bun run test:file packages/lore/tests/unit/service/github-filing-split-write.test.ts -t 'AC-RL-1' && echo 'AC-RL-1 PASS: repeat-check degradation is reported, never silent'
- [⚑] [script] AC-RL-2: The report-issue result formatter prints exactly one 'Warning: repeat check degraded' line for a degraded result, ending 'filed anyway.' for a new filing and 'recognised from the readable entries.' for a recognised repeat, and none for a clean result.
  script: test — bun run test:file packages/lore/tests/unit/adapters/report-issue-repeat-warning.test.ts -t 'AC-RL-2' && echo 'AC-RL-2 PASS: the repeat-check degradation warning is printed, never silent'
  other_command=5
