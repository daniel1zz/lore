---
id: PLAN-140
type: plan
role: plan
title: "Make lore issues refuse a retired-shape upstream as loudly as report-issue already does"
status: approved
priority: high
created: 2026-08-24
updated: 2026-08-24
tags: [defect-channel, silent-fallback, issues]
parent: SPEC-147
phases:
  - {name: "P1: Red"}
  - {name: "P2: Fix"}
---
## Goal

Close the one cell in the 5-cell shape/verb matrix where `lore issues` falls through to the
LOCAL corpus on a retired-shape `feedback.upstream`, by routing BOTH verbs' shape policy
through one shared `Result`-returning classifier. Governing spec:
`spec-lore-issues-falls-through-to-the-local-corpus-on-a-retired` (AC-IS-1 … AC-IS-5).

## Phases

**P1 Red** — author `packages/lore/tests/integration/cli/issues-upstream-shape-refusal.bun.test.ts`
against a throwaway `lore init` corpus, run it, and record the failure with
`lore evidence --result expected-fail` AT THE MOMENT it is red. FOUR describes, one each for
**AC-IS-1, AC-IS-2, AC-IS-3, AC-IS-4**. AC-IS-5 has no describe — it is a pure `grep` lint on
source comments, attested in P2. No implementation in this phase.

**P2 Fix** — add the shared classifier, make both verbs consume it, and rewrite the two stale
`issues.ts` comments in the SAME task (spec D4 — a comment documenting the gap becomes a stale
assertion the moment the gap closes). Attests **AC-IS-1 … AC-IS-5**.

## Sequencing

P1 → P2 strictly. P2's ACs name the test file P1 creates, so they cannot attest before it
exists. Anchors do not intersect (P1 owns the test file, P2 owns the three source files), so
the ordering is a data dependency, not a mutex.

## Measured baseline (2026-08-24, HEAD ccb6ac33)

⛔ Two DIFFERENT kinds of red are separated below, because conflating them would misreport a
green-by-construction control as a defect probe.

**Behaviourally RED at HEAD — these are the defect, and the fix must flip them:**

| AC | probe | at HEAD | required |
|---|---|---|---|
| AC-IS-1 | retired shape + `lore issues`, no `--local` | exit **0** | exit 4 |
| AC-IS-4 (b) STRUCTURAL | `isGithubUpstreamCfg` occurrences in `commands/issues.ts` / `commands/report-issue.ts` | **2** / **2** | 0 / 0 |
| AC-IS-4 (a) CLI-SURFACE | stderr of `lore issues` (retired shape, no `--local`) contains `'configured with the retired SQLite shape'` | **absent** (the verb does not refuse at all) | present, emitted from the shared classifier. ⛔ NOT a source grep of `commands/issues.ts` — a D1-conformant fix leaves that literal's count there at **0** |
| AC-IS-4 (c) STRUCTURAL-POSITIVE | `classifyFeedbackUpstream` occurrences in `commands/issues.ts` / `commands/report-issue.ts` | **0** / **0** | >=1 / >=1 — (b) alone would pass an inlined ad-hoc check that never calls the classifier |
| AC-IS-5 | `'indistinguishable, HERE, from'` and `'resolves to the LOCAL (cwd) corpus for'` in `commands/issues.ts` | **1** each | 0 each |

**Behaviourally GREEN at HEAD — controls and guards, NOT defect probes.** Their oracle
commands fail at HEAD for ONE reason only: the P1 test file does not exist yet. The behaviour
each asserts is already correct and must STAY correct:

| AC | probe | at HEAD | role |
|---|---|---|---|
| AC-IS-2 | GitHub shape + `lore issues`, no `--local` | exit **4** (already correct) | GREEN CONTROL for AC-IS-1 (spec D3) — proves AC-IS-1 was not satisfied by breaking the command outright |
| AC-IS-3 | `--local` on retired shape AND on GitHub shape | exit **0** both (already correct) | REGRESSION GUARD — proves the new refusal did not eat the legitimate opt-out (spec D2) |

Every row above was executed against HEAD before this plan was written. No AC is vacuously
satisfied, and no green-at-HEAD control is misrepresented as a failing probe.
