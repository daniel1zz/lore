---
id: KN-557
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: approved
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PLAN-145
---
# Handoff — agent:main-orchestrator

SCOPE: 4 decisions + 6 next steps = 10 items to account for

## Plan

plan-close-the-read-side-a-github-filed-defect-becomes

## Task Refs

(none)

## Modified Files

- /tmp/claude-501/-Users-apple-Projects-zz-lore/8d78972a-28cf-4fae-8699-80dab5bf1b31/scratchpad/handoff-detail.md

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | Addendum's 'restore never runs on timeout' is FALSE, probe-measured: a synchronous vitest body cannot be interrupted, so finally ALWAYS runs. Real mechanism is cross-worker concurrency over the shared real mirror. Both filed defects are ONE root cause; a faster file only makes the race rarer.@0.97 | — |
| KD2 | 90951390 absorbed the content probe into --check and re-measured no caller. Split measured by importing both halves: runCheck 302ms, runContentCheck 11457ms, 97% content. Anchors byte-identical across the 251 commits since, so the read-side slice is exonerated by measurement.@0.96 | — |
| KD3 | All three defects were approved prior art from 2026-08-24; my retrieval never searched ENOBUFS so a day-old finding was re-derived. The false 'not previously recorded' heading is RETRACTED in place. Read the correcting CHILD doc before citing the parent.@0.98 | — |
| KD4 | ⛔ CORRECTED — original read "neither refused nor attributable" and that OVERSTATED it. Unrefused: yes, gate spec-create never receives an actor and no hook references LORE_ACTOR/role/subagent. But FULLY ATTRIBUTABLE: `lore audit` carries the real actor; only `lore log` and `created_by` print the literal `system`.@0.95 | — |

## Failing Oracle

(none)

## Next Steps

- NS1: NS1/NS3 are IN FLIGHT, not landed: two lore-implementer worktrees (mirror-oracle-budget-isolation on the three test-file defects; duplicate-slug-existing-id on the store false label). On return merge with the task slug in the message, then run git branch -a AND git log --oneline main..<branch> UNCONDITIONALLY — a sub-subagent's branch never appears in the parent's return.
- NS2: dist/lore is ~2h stale against HEAD. bun run build is part of landing the batch, after the last agent returns, never mid-wave: pre-push --check-binary-provenance exits 3 on a dist older than HEAD and runs FIRST, blocking every later check.
- NS3: P5 stays unarchived until its criteria are met. Verification protocol is KD3's: mirror:export does NOT reconcile bodies (measured again — parity printed OK while --check still exited 2; lore export-docs --force converged the two files), so converge, commit, then run BOTH halves with ZERO lore writes in between.
- NS4: ⛔ RETRACTED AND REPLACED. The original said spec-the-mirror-oracles-two-command-surfaces-are-o-corpus-by was "authored out-of-authority by the implementer I dispatched". THAT WAS FALSE. `lore audit` on it: 25 entries — agent:main-orchestrator x11, system x10, the AI judge x4, and agent:mirror-oracle-budget-isolation x0. The writer was a DIFFERENT CONCURRENT SESSION using the same agent:main-orchestrator actor string; that session held no claim, so it never appeared in bootstrap's active_sessions (every row there is keyed to a CLAIM). I reached the false conclusion from `lore log`'s Author column plus active_sessions, sent the agent two accusatory course-correction messages, and recorded the accusation here. The agent refuted it with `lore audit` and I reproduced its result. ⇒ The spec, plan-land-the-two-mirror-command-surfaces-one-row-contract-for, task-one-row-contract-for-every-lore-list-json-emit-branch and branch worktree-agent-ab5158ece8d960bf0 are ANOTHER SESSION'S IN-FLIGHT PLANNED WORK. ⛔ Do not merge, retract, or quarantine them — they are not this session's to dispose of. The one substantive concern that stands on its own merits: narrowing `lore list --json` from 18 keys to 10 removes `content`/`extra` from a SHIPPED CLI output shape, and the spec's "no in-repo consumer reads a full-record field" census cannot see out-of-repo consumers.
- NS5: Four new adhoc tasks filed, all draft and unclaimed: task-the-mirror-check-absorbed-the-content-probe-in-90951390; task-one-unknown-key-discards-the-whole-lore-config-yaml-and; task-lore-create-by-is-accepted-and-ignored-cli-content-writes; task-48-files-fabricate-an-exit-code-from-spawnsync-so-every (48 is a lexical LOWER bound, not a sweep list).
- NS6: The authority-plus-attribution composition finding has no home yet. Its right SSOT is knowledge-the-nine-unenforced-standing-lessons-evicted-from, NOT a new root CLAUDE.md line: the root file is 202/220 lines and 23761/24576 bytes with BOTH metrics on advisory warning, so any addition must evict first.


## ⛔ CORRECTION APPENDED AFTER THIS HANDOFF WAS FIRST WRITTEN

Two things in the version above were wrong, both mine, both from using `lore log` where `lore audit` was the right instrument:

1. **The authorship accusation (see NS4).** Retracted in full above. `task-lore-create-by-is-accepted-and-ignored-cli-content-writes` has been rewritten from scratch with the corrected mechanism and now carries this incident as its measured cost.
2. **"Attribution is not recorded" is FALSE.** It is recorded, in the audit trail. The defect is that `lore log`'s Author column and `doc.created_by` print the literal `system` for the SAME write whose `lore audit` entry names the actor correctly — two surfaces, one fact, two answers, and the misleading one is the discoverable one.

⛔ Standing instruction for the next session, the only durable output of this mistake: **for "who wrote this", use `lore audit <slug> --json` and read `entries[].actor`. NEVER `lore log`'s Author column, and NEVER infer a writer from `bootstrap`'s `active_sessions` — that field is claim-keyed, so a session doing pure planning writes is invisible in it, and AN UNLISTED SESSION IS NOT PROVEN ABSENT.**

## FINAL STATE at 16:37 — both dispatched tasks landed; main was advanced concurrently by a PEER SESSION

Both agents returned and both fixes are on `main`. ⛔ Note who merged what, because it matters for anyone reasoning about this session's actions:

- `eb59448f` — I merged `worktree-agent-a525bfda1b5b84b4c` (DUPLICATE_SLUG). Independently re-verified on main by me: 102 pass / 0 fail (sqlite bun suite), 126 passed (the three vitest DUPLICATE_SLUG constructors), `bun run typecheck` exit 0, and my own census confirming 1 construction site per store / 3 total / 0 residual literals (the single remaining `existing_id: doc.id` is inside a JSDoc describing the historical bug — legitimate). `lore done` run: archived.
- `7051f7e4` — **a PEER SESSION merged my agent's mirror-oracle branch, not me.** My own `git merge` reported "Already up to date". The same peer had merged its own `worktree-agent-ab5158ece8d960bf0` at 16:21 (`7751b798`) and committed SPEC-153/PLAN-148 plus mirror convergence at 16:24 (`1de6e97b`).

⇒ The quarantine decision taken earlier in this session is MOOT for the code: the `lore list --json` row-contract change was already on main before it could be applied, merged by the session that owns it. ⛔ Reverting a peer session's merge is not this session's call and was not done.

### The deepest finding: two ACs demand an exclusive corpus

Post-merge, mirror converged and committed, tree clean, run one AC at a time: AC-FR-6 4 passed exit 0; AC-FR-10 5 passed exit 0; AC-FR-7 green only after reconverging one file. Then `lore verify --task ... --yes` (attested): AC-FR-6 pass, AC-FR-7 pass, **AC-FR-10 fail**.

Both reds were caused by the peer session writing mid-run, each attributed by measurement:
- AC-FR-7: the chosen target's mirror BODY drifted again (peer still editing SPEC-153); reconverging that one file turned it green.
- AC-FR-10: `"task: 844 mirror file(s) on disk vs 845 live corpus doc(s)"`. ⛔ My first hypothesis — that `lore verify`'s own evidence writes invalidated it — is WRONG and recorded as wrong: evidence writes drift a BODY, never the COUNT. The peer created two new tasks during the run.

⇒ AC-FR-6's and AC-FR-10's count-parity clauses are exclusive-corpus verdicts, the exact form the North Star calls unobtainable. The fix removed the exclusivity it could (7 of 9 baselines → deltas, mutations sandboxed); the rest is written into the AC statements and cannot be fixed from the test file. Restating them as deltas ("no doc created before time T lacks a mirror file") is the direction.

### Open, precisely

- `task-skill-test-the-mirror-end-to-end-oracles-cost-o-corpus` is **NOT archived**, deliberately: AC-FR-10 carries an attested `fail`. Archiving it would make `lore ready` and every census over it lie. The work is landed and verified; the CRITERION is unverifiable under concurrency.
- **Worktree cleanup pending the safety gate's 30-minute quiet window.** `worktree-agent-a525bfda1b5b84b4c` and `worktree-agent-a144d78ebad2afefe` are merged, 0 commits ahead, and clean, but their last reflog entries were 16:12 and 16:17 against a 16:37 check — under 30 minutes. ⛔ I did not use `--force`. Remove them WITHOUT `--force` once quiet. ⛔ `worktree-agent-ab5158ece8d960bf0` is the PEER'S — do not touch it.
- `dist/lore` still stale; `bun run build` still required before any push.
- Two things measured that change how evidence should be recorded: `lore evidence --capture` DOES accept `--result expected-fail` and produces `capture_source: runner` with a real attestation (so a red can be attested — my dispatch bundles were wrong to omit `--capture`), and `lore evidence --result pass --output-tail-file` is now REFUSED outright, demanding `--capture`. Both belong in the bundle template.
