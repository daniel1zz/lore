---
id: SPEC-147
type: spec
role: spec
title: "lore issues falls through to the LOCAL corpus on a retired-shape upstream while report-issue refuses it"
status: approved
priority: high
created: 2026-08-24
updated: 2026-08-25
tags: [defect-channel, silent-fallback, issues, report-issue, config-shape]
parent: PRD-001
---
## Overview

`lore issues` (READ) and `lore report-issue` (WRITE) give OPPOSITE verdicts on the SAME
`feedback.upstream` config shape. Measured 2026-08-24 on a throwaway corpus (`lore init`,
never this repo's live `.lore/`), upstream deliberately pointed at a DIFFERENT corpus so the
consumer-harm case is the one under test:

| config shape | verb | exit | behaviour |
|---|---|---|---|
| retired `{corpus_path, root_prd}` | `lore issues` | **0** | reads the LOCAL cwd corpus; stdout's `Corpus:` line names the local path, never the configured upstream |
| retired | `lore issues --local` | 0 | stdout BYTE-IDENTICAL to the row above (`diff` exit 0) |
| retired | `lore report-issue` | 4 | refuses, names the retired shape AND the remedy |
| GitHub `{repo}` | `lore issues` | **0** | reads GitHub and prints the listing — ⛔ was `4 / refuses` until spec-a-github-filed-defect-must-be-claimable-one-ingest-seam deleted that refusal (2026-08-25) |
| GitHub | `lore issues --local` | 0 | reads local — the flag's legitimate use |

The defect is exactly ONE cell: retired shape + `lore issues` + no `--local`. Both of its
neighbours — the same verb on the GitHub shape, and the write verb on the same shape —
refuse correctly. That is why it survived: nothing about the read path looks unguarded.

### Root cause

`packages/lore/src/adapters/cli/commands/issues.ts:318` branches on
`isGithubUpstreamCfg(upstreamCfg)` only. A retired-shape upstream therefore falls through to
the local reader, where it is indistinguishable from "nothing configured".

The shared module `report-issue-wiring.ts` exports only two primitives —
`resolveFeedbackUpstreamCfg` (returns `UpstreamCfg | undefined`) and `isGithubUpstreamCfg`
(a type guard). Neither classifies the THREE states (unconfigured / retired / GitHub) nor
carries a per-state policy, so each verb re-derives the policy in its own `if` chain and the
two drifted. The retired-shape refusal exists in `commands/report-issue.ts:144-158` and has
no counterpart in the reader.

`--local`'s only observable effect on a retired-shape corpus is suppressing one stderr
deprecation line. The line says the value "parses but is ignored"; it never says a fallback
occurred, never names the upstream that was skipped, and exit stays 0 — so for any consumer
reading stdout or the exit code (every agent surface), the fallback is invisible.

This is the governance-layer twin of the silent fallback the store-selection path explicitly
refuses (root `CLAUDE.md`, Store selection D-007: missing credentials must
`err(VALIDATION_ERROR)`, never fall back). Same class, opposite handling, one binary.

## Design

**D1 — One shared classifier, returning `Result`, consumed by BOTH verbs.**
`report-issue-wiring.ts` gains ONE exported function, named `classifyFeedbackUpstream`, that
maps a parsed `LoreConfig` to the three upstream states — unconfigured / retired / GitHub —
and, for the retired state, to a `LoreError` (`VALIDATION_ERROR`) carrying the refusal
message. It returns a discriminated union so a GitHub-shape caller reaches `.repo` without a
separate type guard.

Both `commands/issues.ts` and `commands/report-issue.ts` consume THAT function's verdict.
Two consequences are load-bearing and are what AC-IS-4 measures:

- ⛔ Neither verb may re-derive shape policy in its own branch. `isGithubUpstreamCfg` must
  have ZERO call sites left in either command file (today: 2 in each). An inlined ad-hoc
  shape check satisfies that negative alone, so AC-IS-4 ALSO asserts the positive:
  `classifyFeedbackUpstream` is referenced in BOTH command files.
- ⛔ The refusal message's STRING LITERAL lives ONLY inside the classifier. Neither command
  file may hold its own copy — so AC-IS-4's message assertion is a CLI-SURFACE probe (what
  the two verbs EMIT on stderr), never a source grep of the command files, where the correct
  end state is zero occurrences.

**D2 — `--local` keeps its meaning under every shape.** `--local` means "read this corpus,
deliberately"; it stays exit 0 on retired AND GitHub shapes. The refusal applies only to the
UPSTREAM-reading path the user did not opt out of.

**D3 — The GitHub-shape refusal is unchanged and serves as the green control.** It already
exits 0 and prints the listing under a payload gh stub — ⛔ it exited 4 with a remedy when this was written, and that refusal has since been deleted by spec-a-github-filed-defect-must-be-claimable-one-ingest-seam; the control's discriminating role is unchanged and AC-IS-2 carries the new exact form. An AC asserting only "retired now exits non-zero" could be satisfied
by breaking the whole command; pairing it with the still-green GitHub assertion is what gives
the new assertion discriminating power.

**D4 — Comment sync is part of this change, not follow-up.** `issues.ts`'s header comment
(lines ~26-37) currently documents retired-shape-to-local as intended behaviour
("a legacy-shaped `feedback.upstream` is now indistinguishable, HERE, from 'unconfigured'"),
and the reason comment at ~331-340 justifies `resolveIssueReadSource`'s unreachable
`"upstream"` variant by that same fallback. Both become STALE ASSERTIONS the moment the
refusal lands. They are inside this change's file anchors and MUST be rewritten in the same
task. `packages/core/src/config.ts` and `issue-report.ts`'s "retired (parses-but-ignored)"
notes describe the CONFIG SCHEMA (the field still parses) and remain true — do not touch.

## Scope

Wiring a GitHub-backed read surface (`GitHubIntakePort.listIssues`) is a later phase of
`spec-the-defect-channel-reaches-no-machine-but-its-own-github` and stays out of scope. This
spec only makes the retired shape refuse as loudly as its two neighbours already do.

In scope: the retired-shape refusal in the reader, and the shared classifier both verbs
consume. Out of scope: any GitHub-backed read surface.

## Acceptance Criteria

Structured, oracle-verifiable ACs are declared via `lore ac add` (see `lore ac list` on this
spec). Every one is a CLI-surface probe against a throwaway corpus built by `lore init` —
never this repo's live `.lore/` — with the config shape as the only varied input.

- AC-IS-1 asserts the defect cell refuses (retired shape, `lore issues`, no `--local`).
- AC-IS-2 is its green control (GitHub shape reaches the GitHub read path; ⛔ it *refused* when this line was written) — without it AC-IS-1 is
  satisfiable by breaking the command outright.
- AC-IS-3 keeps `--local` exit 0 under both shapes.
- AC-IS-4 asserts the shared classifier is LIVE-CALLED from both verbs, not merely present.
- AC-IS-5 asserts the stale comments naming the old fallback are gone.


## Acceptance Criteria (structured)

- [⚑] [script] AC-IS-1: Under a throwaway corpus (lore init, never this repo's live .lore/) whose feedback.upstream carries ONLY the retired {corpus_path, root_prd} shape, 'lore issues' with NO --local exits EXACTLY 4, and its stderr contains BOTH verbatim substrings: 'retired SQLite shape' (names the shape) and 'feedback.upstream.repo' (names the remedy). Covered by describe 'AC-IS-1 retired-shape upstream refuses the upstream read'.
  script: test — cd packages/lore && bun test tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts -t 'AC-IS-1' 2>&1 && echo 'AC-IS-1 PASS: lore issues exits exactly 4 with stderr containing both retired SQLite shape and feedback.upstream.repo'
- [⚑] [script] AC-IS-2: GREEN CONTROL for AC-IS-1 (spec D3). ⛔ AMENDED 2026-08-25: the original asserted 'exits EXACTLY 4 naming the later-phase gap', and spec-a-github-filed-defect-must-be-claimable-one-ingest-seam DELETED that refusal. Measured on main after it landed: Expected 4 / Received 8 — with no reachable gh the command exits the transport code. The PURPOSE is unchanged: AC-IS-1 must not be satisfiable by breaking the command outright. New form, with exact-value discriminating power on BOTH halves: with a payload gh stub on PATH serving ONE seeded issue, a GitHub-shape feedback.upstream and NO --local makes lore issues exit EXACTLY 0, and its stdout contains (i) the fixed 'Corpus: ' line prefix and (ii) the seeded issue's number, and does NOT contain the retired-shape refusal 'configured with the retired SQLite shape'. ⛔ Two forms were considered and REJECTED for the SAME reason — a negative-only clause, and a positive clause reading merely 'prints its listing': a command emitting nothing, a blank line, or a bare header would satisfy either. Naming the seeded number is what closes that hole on the positive side. Covered by describe 'AC-IS-2 green control: GitHub-shape upstream reaches the GitHub read path'.
  script: test — cd packages/lore && bun test tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts -t 'AC-IS-2' 2>&1 && echo 'AC-IS-2 PASS: a GitHub-shape upstream exits exactly 0 under a payload gh stub, prints the Corpus line and the seeded issue number, and never the retired refusal'
- [⚑] [script] AC-IS-3: 'lore issues --local' exits EXACTLY 0 under BOTH the retired shape and the GitHub shape, and in both cases stdout's FIRST line starts with the literal prefix 'Corpus: ' followed by the throwaway corpus's own absolute path — the flag's legitimate opt-out is not collateral damage of AC-IS-1 (spec D2). Covered by describe 'AC-IS-3 --local stays exit 0 under both shapes'.
  script: test — cd packages/lore && bun test tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts -t 'AC-IS-3' 2>&1 && echo 'AC-IS-3 PASS: --local exits exactly 0 on both shapes with stdout first line naming the local corpus path'
- [⚑] [script] AC-IS-4: LIVE WIRING via ONE classifier — THREE independent conditions (spec D1), because each alone is satisfiable by the drift D1 closes. (a) CLI-SURFACE BEHAVIOUR: under a retired-shape upstream, BOTH 'lore issues' and 'lore report-issue' emit stderr containing the VERBATIM substring 'configured with the retired SQLite shape'. This is a probe of what the two verbs EMIT, never a source grep of the command files — a D1-conformant fix keeps that literal ONLY in the classifier, so its correct occurrence count inside commands/issues.ts is ZERO. (b) STRUCTURAL-NEGATIVE: identifier 'isGithubUpstreamCfg' has ZERO occurrences in BOTH commands/issues.ts and commands/report-issue.ts (today: 2 in each), so neither verb re-derives shape policy in its own if-chain. (c) STRUCTURAL-POSITIVE: identifier 'classifyFeedbackUpstream' occurs at least ONCE in BOTH command files (today: 0 in each), which (b) alone cannot enforce — an inlined ad-hoc shape check would pass (b) while leaving the classifier merely present and never called. Covered by describe 'AC-IS-4 both verbs source the retired refusal from one classifier'.
  script: test — grep -q 'classifyFeedbackUpstream' packages/lore/src/adapters/cli/commands/issues.ts && grep -q 'classifyFeedbackUpstream' packages/lore/src/adapters/cli/commands/report-issue.ts && ! grep -q 'isGithubUpstreamCfg' packages/lore/src/adapters/cli/commands/issues.ts && ! grep -q 'isGithubUpstreamCfg' packages/lore/src/adapters/cli/commands/report-issue.ts && cd packages/lore && bun test tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts -t 'AC-IS-4' 2>&1 && echo 'AC-IS-4 PASS: classifyFeedbackUpstream live-called in both verbs, zero isGithubUpstreamCfg call sites, and both verbs emit the canonical retired-shape substring'
- [⚑] [script] AC-IS-5: COMMENT SYNC (spec D4): issues.ts no longer documents retired-shape-to-local as intended behaviour. The stale phrases 'indistinguishable, HERE, from' and 'resolves to the LOCAL (cwd) corpus for' are absent from commands/issues.ts, mechanically greppable.
  script: lint — ! grep -q 'indistinguishable, HERE, from' packages/lore/src/adapters/cli/commands/issues.ts && ! grep -q 'resolves to the LOCAL (cwd) corpus for' packages/lore/src/adapters/cli/commands/issues.ts && echo 'AC-IS-5 PASS: both stale fallback-as-by-design phrases are gone from commands/issues.ts'

## Code anchors

- packages/lore/src/adapters/cli/report-issue-wiring.ts#classifyFeedbackUpstream
- packages/lore/src/adapters/cli/commands/issues.ts
- packages/lore/src/adapters/cli/commands/report-issue.ts
- packages/lore/tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts
