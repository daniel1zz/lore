---
id: KN-427
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-11
updated: 2026-10-10
tags: []
parent: PLAN-122
links:
  - {id: KN-429, type: supersedes}
  - {id: KN-428, type: supersedes}
---
# Handoff — agent:main-orchestrator

## ⛔ READ THIS FIRST — this is the SINGLE ENTRY POINT for the session of 2026-08-11

Three handoffs were written as this session progressed. They are chronological, they OVERLAP, and one
carries a claim a later measurement REFUTED. Read them in this order, and apply the corrections below
BEFORE acting on anything in the earlier two:

1. `knowledge-handoff-agent-main-orchestrator-91` — the main thread: GAP-25, `.lore/config.yaml` not being
   git-tracked, seven rounds of AC tightening, the original 9 open items.
2. `knowledge-handoff-agent-main-orchestrator-92` — AC-JV-5 close-out: the `check:test-budgets` red on
   `main` (fixed), the stale-comment finding, AC-JV-6.
3. **THIS document** — final state, and the authority wherever the three disagree.

### ⛔ Corrections to the earlier two — do not act on the superseded versions

- **`-91` NS3 says the mirror was "re-exported and committed on `main`". That is FALSE and I retracted it
  later the same session.** `bun run mirror:export` exits 0 and reports parity OK but does NOT rewrite an
  existing file's content — proven by an identical before/after md5 across a rename that changed 65 tokens.
  It writes NEW files only, and `check:spec-mirror` compares count+slug while stating outright that CONTENT
  is not compared. ⛔ Treat every `docs/requirements/*.md` as possibly superseded. Full entry: `GAP-25` in
  `knowledge-five-governance-tooling-gaps-measured-while-resuming`.
- **`-91` and `-92` both list agents as "still running". None are.** All five finished, all ten worktrees
  and branches were removed after an UNCONDITIONAL `git log main..<branch>` scan showed zero unmerged
  commits on every one. Do not go looking for in-flight work.
- **`-92` says `ai-provider-service.ts` has FOUR stale comments. It has SIX** — the four `diffSource` ones
  (`:87 :89 :1193 :1199`) plus two `default 24000` ones near `:616` and `:663` that AC-GD-1's raise
  falsified. Widen AC-JV-6 accordingly.

### Start here, in this order — the ordering is load-bearing

1. **`task-re-baseline-the-compiled-migrate-ordinals-e2e-to-the`** — ready, undispatched, and it fixes a
   LIVE RED on `main` (verified after a fresh `bun run build`: exit 1, 2 of 5 cases). ⛔ Do NOT fix it by
   reverting the padded composition — AC-MIS-1/2/4 are attested against it; the pins are stale, not the code.
2. **Then the full suite** — never run this session. It is finally safe (no agents, `dist/lore` freshly
   built). Running it BEFORE step 1 gives you a baseline you cannot read, because those 2 failures are
   expected until step 1 lands and anything else is new.
3. Then everything in the Next Steps table below.

⛔ One measured caution about this session's own output: I twice pinned an AC's oracle to something I had
not measured — the second time immediately after adding a CLAUDE.md lesson warning against exactly that.
Both were caught by implementers, not by me. If a judgment in these three handoffs names a field, a path,
or an exit code, machine-check it before relying on it.


SCOPE: 7 decisions + 6 next steps = 13 items to account for

## Plan

01KZRA6287

## Task Refs

(none)

## Modified Files

(none)

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | All five S4/S3 tasks landed and are archived; all 10 worktrees and branches removed after an UNCONDITIONAL git log main..<branch> scan showed zero unmerged commits on every one | 97 |
| KD2 | ⛔ I pinned a SECOND unmeasured oracle after adding the CLAUDE.md lesson warning against exactly that: AC-GD-1 named workflow.gates.capture_timeout_ms, but the real field is workflow.EVIDENCE.capture_timeout_ms (config.ts:472) | 98 |
| KD3 | Worse, bare loadConfig does NOT fill Zod defaults for an absent top-level section — measured on a mkdtemp lore init corpus, workflow and ai are both undefined. My pinned assertion could never have passed. The implementer built the correct seams and flagged it | 98 |
| KD4 | ⛔ LIVE RED on main, verified myself after a fresh build: migrate-ordinals-compiled.bun.test.ts exits 1, 2 of 5 failing on brandedHumanId(SPEC-1). Commit 63164c20 re-baselined the unit test and left its compiled sibling pinned to the unpadded form | 98 |
| KD5 | That is the THIRD anchor-design defect this session — one test file anchored, its sibling invisible. The other two: comment sites not anchored beside the gap they record (twice) | 97 |
| KD6 | ⛔ Implemented the config cleanup and PROVED the effective values survive it: removed max_diff_chars/capture_timeout_ms/verify.default_timeout_ms overrides after measuring all three code defaults are now 80000/1200000/900000. report-issue --list still exits 0 | 96 |
| KD7 | ⛔ And .lore/config.yaml's untracked-shared danger got demonstrated live: I edited it and git status stayed EMPTY. No diff, no review, no possible merge conflict — exactly what GAP-25's sibling finding predicted | 97 |

## Failing Oracle

(none)

## Next Steps

- NS1: NS-COMPILED-RED: task-re-baseline-the-compiled-migrate-ordinals-e2e-to-the is ready and undispatched, and it fixes a LIVE RED on main. ⛔ Do NOT fix it by reverting the padded composition — AC-MIS-1/2/4 are attested against it. The pins are stale, not the code
- NS2: NS-GD4-DISPATCH: task-replace-the-false-git-tracked-mechanism-in-the is ready and undispatched (AC-GD-4). ⛔ AC-GD-2 keeps its attested pass against the pin it had; supersede forward, never retro-edit
- NS3: NS-COMMENT-CURRENCY-2: ai-provider-service.ts now carries SIX stale comments, not four — the diffSource ones at :87 :89 :1193 :1199 plus two 'default 24000' ones near :616 and :663 that AC-GD-1's raise falsified. AC-JV-6 is declared but its task creation was refused (anchor file absent, expected); re-create and widen it to all six
- NS4: NS-GAP11: flip GAP-11 to half-closed in the ledger with this spec owning its VALUE half only, ⛔ leaving open_half_carried_by ABSENT so the 8-member unowned set AC-GD-3(f) pins still holds. defaults has now merged, so the precondition is satisfied
- NS5: NS-FULL-SUITE-3: dist/lore is now freshly built and NO agents are running, so the full suite is finally safe to run. Expect the 2 known compiled-e2e failures above until NS-COMPILED-RED lands; anything else is new
- NS6: NS-PLAN-CLOSE-2: S1/S3/S4 all have every task archived except the newly-created ones; four older plans from earlier sessions are also open with all children terminal. Assess before closing, and machine-check every finding naming a path
