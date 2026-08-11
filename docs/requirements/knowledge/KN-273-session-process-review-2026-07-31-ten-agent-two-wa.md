---
id: KN-273
type: knowledge
role: knowledge
title: "Session process review — 2026-07-31 ten-agent two-wave run: 7/7 deterministic clean, four plans closed through a self-disabled gate"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
links:
  - {id: PLAN-095, type: informs}
---
# Lore-Governed Session Performance Review — 2026-07-31 ten-agent two-wave declared-scope / decision-status / test-budget / report-issue-concurrency run

**Mode**: live   **Judge**: independent (`lore-reviewer`, Opus, read-only, given a facts-only dossier and instructed to verify rather than trust it)

## Verdict summary

6 PASS / 4 VIOLATION / 0 N/A over the ten catalogued invariants (I6 skipped — retired tombstone) · I11 sub-checks 2 PASS / 2 VIOLATION · **10 findings total, 6 of them uncatalogued** · deterministic checks: **7/7 clean**

The headline is the inversion: **every deterministic check passed, the corpus chain was clean end-to-end, and the session still closed four plans through a gate it had itself just disabled.** A 7/7 artifact score and a dark gate are not mutually exclusive — that is what this review exists to surface.

## Violations (most severe first)

### V1 [uncatalogued] — The session merged the change that removed plan-close's only applicable blocking conjunct, then closed its own four plans through the hole

**Severity: high**

- **Evidence.** At the session's own base commit `d373654`:
  `meetsFloor = zeroAttestedTasks.length === 0 && claimedAcCoverage.meets_coverage && (minRatio === null || ratio >= minRatio)` (`evidence-panel.ts`), and `attestationFloor` returns `{ok:false, ATTESTATION_FLOOR_NOT_MET}` on `!meets_floor` (`gate-predicates.ts:879-881`). Its `notApplicable` branch fires ONLY on `total_evidence === 0`. These four plans carried 53 evidence rows with 0 attested, so all 10 tasks fell into `zeroAttestedTasks` → **plan-close would have DENIED all four archivals**. The base revision's own JSDoc `@example` documents this exact case. The session's VS T3 (`c082662`, merged `afdaf81`) reduced `meets_floor` to the ratio conjunct alone; `DEFAULT_ATTESTATION_MIN_RATIO` is `null` and the repo config sets no `min_ratio`, so it is vacuous, while the replacement conjunct reads `extra.ac_scope` — absent on all 10 tasks → `notApplicable("scope-undeclared")`. Audit confirms the outcome rather than an inference: four rows `action=gate_not_applicable {"checkpoint":"plan-close","kind":"attestation-not-applicable"}` at `08:32:25.082/.492/25.896/26.306Z`. The session filed a HIGH task naming this hole at `07:16:19Z` — **76 minutes before the first archival**.
  Contemporaneous disproof of any "no choice" reading: a co-resident session, same window and binary, declared `ac_scope` and earned attestation (`task-t1-argument-aware-probes…`: 24 evidence / 15 attested); its plan close had an APPLICABLE floor and passed it.
- **Consequence.** Four plans and 21 script ACs are permanently archived with a corpus record that cannot distinguish "verified by a trusted runner" from "an agent typed a command and a result". `lore assess` — the permanent quality record — carries 0.00 on all four. Worse, the hole is general: plan-close will keep passing every future plan whose tasks omit `ac_scope`, silently, exit 0.
- **Root cause.** Not "nobody ran `lore verify`". Two structural causes: (1) the slice shipped a gate weakening plus a verify-time refusal **without the authoring-time requirement that would populate the field the replacement conjunct reads** — the replacement is inert until `extra.ac_scope` exists, and nothing requires it; (2) `plan-close` does not distinguish "predicate passed" from "predicate was inapplicable" at the exit-code level, so a plan closing with every blocking conjunct inapplicable is indistinguishable from one that passed them.
- **Fix**: re-earn attested evidence per evidence-bearing task (`lore verify <plan> --ac <id>` — the absent-scope escape; empirically proven possible against archived tasks by the 2026-07-28 review). → **Mechanization**: filed as `task-plan-close-must-block-when-the-coverage-conjunct-is-scope` (critical) — block when the coverage conjunct is `scope-undeclared` AND ≥1 task carries evidence, keeping the no-evidence case advisory; plus a vacuity signal so a checkpoint whose every blocking conjunct was inapplicable says so. Paired with the already-filed `task-spec-first-require-ac-scope-at-task-creation-so-the-runner`.

### V2 [uncatalogued] — `agent:main-orchestrator` is a shared constant, so the orchestrator tier has no session-distinguishable identity

**Severity: high**

- **Evidence.** In the session window, `agent:main-orchestrator` carries 46 `evidence` / 39 `create` / 16 `approve` / 80 `update` rows spanning **two concurrent sessions**. Resolving every orchestrator-written `evidence` doc_id in the window: all land on the OTHER session's tasks (`task-t1-argument-aware-probes…`, `task-t2-defer-libsql-native-load…`, `task-t1-boundary-required-on-removal-ports…`); 0 on this session's 10. Already harmful once: a co-resident `lore handoff` under the same actor archived handoffs `-46/-47/-48/-49`; this session's live `-50` survived only because the `(plan, actor)` supersession key happened to differ.
- **Consequence.** `lore audit --actor agent:main-orchestrator` — the natural "what did this orchestrator decide/attest" query — is unanswerable for a single session. And a concurrent session can archive this session's live resume ticket, the one artifact the cross-session-amnesia defence rests on. In the project's stated target mode (multi-session AI-driven iteration) this is the normal case, not an edge case.
- **Root cause.** The prescribed identity scheme is per-ROLE at the orchestrator tier (a literal constant) and per-BRANCH at the implementer tier. It needs to be per-SESSION at both. The existing mechanization in this area (the resolveActor OS-fallback advisory) detects a bare OS username, not a shared constant, so it cannot fire here.
- **Fix**: none available retroactively — the rows are already ambiguous. → **Mechanization**: derive the orchestrator actor as `agent:main-orchestrator:<session-id>` from `lore bootstrap`'s session id, exported by a `lore setup`-installed session-start hook (distribution-first: a CLAUDE.md string is not a delivery surface); key handoff supersession on `(plan, actor, machine, session)`.

### V3 [I7] — A spec's material rewrite was re-promoted through the write path carrying only half the gate

**Severity: medium — bypass of an existing mechanism** (no flag used; the gate-bearing verb was replaced by a gate-lighter one)

- **Evidence.** IC spec content patch + `lore ac rm`/`add` at `06:31:43–06:32:26Z` (auto-demoted approved→draft), then `06:33:52Z update {"patch":{"status":"approved"}}`. No `approve` action, and no `judge` row after `03:13:58Z` (previous session). `CorpusService.set`'s draft→approved branch runs `spec-promote` **only**; `ReviewService.enforceJudgmentRequiredGate` (which covers `judgment_required_types = ["spec","adr"]`) exists solely on the `approve` path. Contrast: the ADR this same session authored went the correct route — `judge` → revise → `judge` → `approve`.
- **Consequence.** An approved spec-tier doc whose Contract Details and one AC were rewritten now carries a judgment describing the pre-rewrite text. Its as-built numbers rest on the orchestrator's own re-verification (real and disclosed) with no independent round. A future reader cannot tell reviewed content from re-promoted content.
- **Root cause.** Two sanctioned doors to `approved` with different locks. Same shape the 2026-07-28 review already named for plan closure.
- **Fix**: run `lore review` on the IC spec's current version. → **Mechanization**: move `enforceJudgmentRequiredGate` behind the shared checkpoint both write paths already call (exactly as `spec-promote` is), so `set --status approved` / HTTP `PATCH` / `lore_set` cannot be the weaker door. A second door with a lighter lock should not exist.

### V4 [I11b] — Implementation diverged from the spec's pinned contract and the spec was not updated

**Severity: medium**

- **Evidence.** VS spec line 42 pins "**All three** refusal paths are `VALIDATION_ERROR`"; `verify-runner-service.ts` ships **four** (`:457` absent-scope, `:470` empty-scope, `:485` out-of-scope `--ac`, `:502` zero-matching-scope). The fourth has no spec text and no AC. VS/DS/TB spec audits show no content write after implementation — only `anchors add` at `08:26Z`. The IC spec WAS updated as-built: 1 of 4.
- **Consequence.** The spec is the read-first artifact for the next session touching `lore verify`'s selection path, and it now under-describes the shipped refusal surface by 25%. The drift oracle cannot see it — anchors detect missing *paths*, not divergent *contracts* — so `--check-drift` is green over exactly this divergence.
- **Root cause.** The living-snapshot rule is prose-only. `lore anchor add` is mechanized at close (and ran on 4/4, correctly); "update the contract" is not, and the compliance gap is 4/4 vs 1/4 in the same session.
- **Fix**: amend the VS spec's refusal count and add an AC for the fourth path. → **Mechanization**: a `plan-close` predicate mirroring `prdOutlineSynced` — the closing plan's ancestor spec must carry ≥1 content-differing version inside the plan's execution window, with the same dedicated-verb exemption shape. The prd-sync predicate proves the pattern; the spec tier was never wired.

### V5 [I11d + I3] — A disproven acceptance criterion was left standing, and the plan archived over its `fail` row

**Severity: medium**

- **Evidence.** `lore ac list spec-a-test-case-s-timeout-budget-must-be-declared-when-its` → `✘(0/1) AC-TB-1`. Its only oracle row is `lint | fail | bun run check:test-budgets`; no AC-TB-1 pass row exists anywhere. Its task was `lore done`d and the plan archived at `08:32:25.066Z`. The AC's premise (one violation) was measured false (55). No `lore ac rm/add`, no `lore invalidate`, no spec correction — while the same session DID use `lore ac rm`+`add` on AC-IC-5.
- **Consequence.** An approved spec asserts a repo state that is false, under an archived plan that reads as complete. The corrective policy exists only in a sibling ADR that nothing links from the AC. The next session reading the TB spec is told the oracle passes on the repo tree; it exits 2 with 55 violations.
- **Root cause.** `_doneImpl` requires only `evidence.some(e => e.result === "pass")` — a task archives on ANY passing row regardless of which of its ACs failed — and `plan-close` has no predicate on AC-level `fail` at all. `attestationFloor` counts *attested*, never *failed*. A recorded `fail` is inert at both terminals. Structurally the same defect class as V1: the floor measures attestation and nothing measures **outcome**.
- **Fix**: correct AC-TB-1 to the ADR's criteria (`lore ac rm`+`add`), re-promote the spec. → **Mechanization**: a `plan-close` conjunct — no AC of the closing plan's spec may have `fail` as its latest result among the plan's evidence rows without a typed exemption (reusing `computeAcCoverage`, which already carries per-AC pass/fail); paired with `lore done` refusing when an `ac_ref`'d criterion's latest result on that task is `fail`.

### V6 [I8] — The retro and the resume ticket asserted a comparative claim about the gate that was false

**Severity: medium** · **CORRECTED during this review**

- **Evidence.** The retro's closing bullet and handoff `-48` KD3 both claimed the four plans closed "visible AS scope-undeclared **rather than silently passing** — the mechanism the wave built judged the wave itself, correctly." Ground truth (V1): the pre-change predicate **denied** the same input; the change converted a DENY into a not-applicable advisory. "Silently passing" describes the pre-existing coverage vacuity, not this shape.
- **Consequence.** The claim sat in an approved retro and in the resume ticket — the two artifacts a future session reads to decide whether this area is settled. It converted a net loss of gate coverage into a success story, precisely the belief that would deprioritise the follow-up tasks.
- **Root cause.** No oracle binds a comparative claim about gate behaviour to a measurement. The session had a cheap one and did not use it: run the closing input against the base commit's predicate — the same "build at the commit that excludes our merge and reproduce" method it had already applied correctly to the foreign-red attribution in the same document.
- **Fix**: DONE — the retro is corrected at v3 with the measured base-commit formula, and this review supersedes the handoff carrying the claim. → **Mechanization**: extend `lore assess`'s judge rubric (or a `lore review` predicate for `sub_type: retro`) to require that any claim of the form "the gate/predicate now X rather than Y" cite a measurement against the pre-change revision.

### V7 [uncatalogued] — 21 of 53 evidence rows carry no `ac_ref`

**Severity: medium**

- **Evidence.** Per-task gaps (VS T1 2, VS T3 3, DS T1 1, TB T1 2, IC T1 6, VS T2 3, DS T2 2, IC T2 2) = 21/53. Combined with `ac_scope` absent on all 10 tasks, the ONLY binding between this wave's oracle runs and its 21 script ACs is the orchestrator's manual re-run table, which lives in no artifact.
- **Consequence.** `computeAcCoverage`/`deriveClaimedAcCoverage` cannot see those rows; the per-claimed-AC conjunct silently narrows; a future re-verification cannot tell which criterion a row supported. It also permanently depresses the plan-wide ratio — the dilution already recorded in `knowledge-spec-072-autopilot-execution-retro-reverse-import` finding 4, whose fix is likewise unbuilt.
- **Root cause.** `lore evidence` accepts a row with no `--ac-ref` and no declaration of intent, so "development evidence" and "criterion evidence" are one indistinguishable class.
- **Fix**: none retroactively worth the churn. → **Mechanization**: `lore evidence` requires either `--ac-ref <id>` or an explicit `--ac-ref none` (recorded as a typed development-evidence class) when the task's plan's spec declares ≥1 script-mode AC — separable in every downstream ratio, and silence refused.

### V8 [uncatalogued] — Six load-bearing `manual` evidence rows cite probe scripts that exist nowhere

**Severity: low-medium** (materially mitigated by disclosure)

- **Evidence.** IC T1's six rows cite `bun /tmp/scratchpad/probe-layer.ts`, `bun probe-createapp.ts`, `bun probe-forced.ts 10 upstream pair`, `bun probe-natural2.ts 100`, `bun probe-startup.ts 60 list`, `bun probe-natural.ts 50`. None resolves: the path is ENOENT, `find . -name "probe-*.ts"` is empty, `git log --all --diff-filter=A -- '*probe-*.ts'` is empty. The IC spec's Contract Details carries the numbers they produced (including the rate that sizes AC-IC-1's 50 runs).
- **Mitigation, and it is real**: that spec carries an explicit "Provenance split — read this before trusting any number below" paragraph naming which figures were re-verified at source and which rest on the agent's evidence alone. That disclosure is the correct pattern and should be kept.
- **Consequence.** The harness-sizing rationale in an approved spec cannot be re-derived, and the already-requested re-measurement has no reference implementation.
- **Root cause.** `lore evidence --command` accepts any string; nothing requires it to be resolvable from the repo at the recorded commit, and the dispatch bundle gave measurement-only probes no home in the tree.
- **Fix**: none retroactively (the scripts are gone). → **Mechanization**: `lore evidence` warns when `--command` references a path outside the repo root or under a temp dir; require probes whose output enters a spec to land under `scripts/probes/` with the commit recorded on the evidence row.

### V9 [uncatalogued] — The retro's anchor-class findings landed as prose with no delivery surface

**Severity: low**

- **Evidence.** The retro derives three repeatable anchor-insufficiency classes and closes "worth encoding these three classes wherever tasks are authored." None of the filed follow-up tasks covers anchor classes. Meanwhile two wave-2 agents edited 8 files outside their declared anchors during a 4-way concurrent wave, so the overlap gate was blind to them; no collision occurred, which is luck rather than mutex.
- **Consequence.** The next wave's anchors will be under-declared in the same three predictable ways, and the finding's own conclusion ("under-declaration silently weakens the concurrency guarantee") will hold again.
- **Root cause.** The retro is the terminal artifact for findings, so a finding whose owner is "wherever tasks are authored" has no consumer — the exact failure `adr-distribution-first-every-improvement-names-its-consumer` exists to prevent.
- **Fix**: file it. → **Mechanization**: require each finding in a `sub_type: retro` doc to carry either a task/spec ref or an explicit `prose-only, accepted` marker — the shape the PRD `validation` field already enforces upstream — checked by `lore review`/`lore status`.

### V10 [uncatalogued] — The ADR authorising the gate demotion is still `draft` while its decision ships in main

**Severity: low**

- **Evidence.** `adr-lore-verify-s-attested-evidence-scope-belongs-to-the-task`: `status: draft`, `extra.decision_status: accepted`, audit shows only `create` + `link`. Its decision ("demote the per-task attested floor to a reported fact") is merged and load-bearing (V1). Three other ADRs sit in the same state.
- **Consequence.** The rationale for a live gate weakening lives in a doc that never entered review, is excluded from `lore pending`'s loop once `decision_status` reads accepted, and can be edited without a judgment.
- **Root cause.** `decision_status` and doc `status` are independent fields with no coupling — and this session's own DS spec built `lore set --decision-status accepted` for one direction without coupling it to approval.
- **Fix**: run `lore review` + `lore approve` on it. → **Mechanization**: a `lore status` drift signal (later a predicate) — an ADR with `decision_status: accepted` that a spec `implements` may not remain `draft`.

## Deterministic check table

| ID | Result | Evidence |
|---|---|---|
| D1 empty-branch merge | **PASS** | All 9 merges: `git rev-list --count <m>^1..<m>^2` ≥1 (eight = 1, IC T2 = 3) |
| D2 worktree remnants | **PASS** (pre-existing debt noted) | 0 agent worktrees/branches from this session remain. One unmerged branch `worktree-agent-ada3640f23484b4b5`, tip dated 2026-07-28, whose deliberate exclusion is already documented in the 2026-07-28 review — pre-dates this session |
| D3 dangling agent work | **PASS** | 5 dangling commits dated 2026-07-31, all stash-shaped (`On worktree-agent-*: wip-…`); the 2 session-owned ones (VS T4 red-check, DS T2 red-check) have their real content on main; 3 belong to foreign agents |
| D4 corpus chain | **PASS** | All 10 tasks: exactly 1 `claim` + 1 `release` + ≥1 `evidence` under their own distinct implementer actor; claim payload records the worktree, so claims came from inside them |
| D5 evidence oracle quality | **PASS** | 53 rows: test 19 / e2e 18 / tsc 8 / lint 2 / manual 6 (the manual rows carry real `bun <probe>` commands, not opinions); 52 pass + 1 honest fail; `recorded_by` is the implementer on all 53 — **0 evidence-by-proxy** |
| D6 gate bypass | **PASS** | 0 rows mentioning `bypass` in the window; no `LORE_GATE_BYPASS` / `--no-verify` / `CLAUDE_SUBAGENT_GATE_BYPASS`. A git-safety hook blocked one `worktree remove --force`; the orchestrator re-ran without `--force` rather than chaining around it |
| D7 dirty end-state | **PASS** | `git status --porcelain` → 0 lines |

## The floor-not-ceiling answer

The catalog's blind spot: **every one of I1–I11 can pass while the gate that was supposed to judge the work is inapplicable.** I7 asks whether denials were bypassed; it has no question for "no denial was possible". I3 was explicitly ruled (2026-07-21 review) not to cover all-self-reported evidence. I11 asks whether the CLOSE actions ran — and they all did, cleanly. Nothing in the catalog asks the question that decided this session: **did any gate actually measure anything?** Thirteen `gate_not_applicable` rows and zero denials is a signature the catalog cannot read.

Three checks it should carry:
1. **I7b — vacuity accounting**: per gate a session drove, count denials vs `notApplicable`. N plans closed with N inapplicable floors is a dark gate, not a clean run.
2. **I12 — self-weakening**: did the session merge a change to `gate-predicates.ts`/`checkpoint-registry.ts` and then transit that same checkpoint? Compare the predicate at the base commit against the closing input.
3. **I13 — orchestrator-tier identity**: is the orchestrator actor distinguishable from a concurrent session's? Currently, by construction, no.

## Prior-retro escalation

`attestation_exempt` has **no writer verb**: `grep -r attestation_exempt packages/lore/src/adapters/cli` → 0 hits, while its structural sibling `prd_sync_exempt` has `lore outline exempt` (`commands/outline.ts`). This mechanization was already recommended in `knowledge-spec-072-autopilot-execution-retro-reverse-import` finding 3 (**2026-07-24**) and is still unbuilt — so it is **escalated** and filed as `task-escalated-recommended-2026-07-24-still-unbuilt-attestation`. Because the auditable opt-out did not exist as a command, riding the vacuous predicate was the path of least resistance: the missing writer is what made V1's hole load-bearing rather than merely present. This is the CLAUDE.md-recorded pattern verbatim — *a gate demanding a field no surface can author fails SILENT*.

Also still unbuilt from the same 2026-07-24 retro: finding 4's ratio-dilution fix (see V7).

## Out-of-scope observations

- VS T2 declined the prescribed worktree oracle (`bun run test:changed`, ~409 files, 5-min load 23.7) and substituted the affected consumer set, naming the substitution `[out-of-scope → lore-test]`.
- The fourth `lore verify` refusal path shipped with no acceptance criterion `[out-of-scope → lore-test]` (its spec half is V4, in scope).
- A background full-suite notification reported "exit code 0" over 2 real failures — the 0 belonged to a trailing `echo`. Caught only by the orchestrator's own appended `BUN_EXIT=` line. Worth promoting into `shared/verification-discipline.md` as a standing rule: **a backgrounded verification must append its own exit code and be judged on that, never on the completion notification** `[out-of-scope → shared/verification-discipline.md]`.

## What went well

- **Implementer-tier claim/actor discipline was real, not nominal**: 10/10 claims from inside their own worktree under distinct actors, `worktree` recorded in the claim payload, and **zero** orchestrator-written evidence rows on this session's tasks (no evidence-by-proxy).
- **Anchor disjointness proven programmatically before each wave** (19 then 15 anchors), including widening three under-declared sets after reading the code — 0 anchor-overlap denials and 0 merge conflicts across 10 branches touching central files.
- **The foreign-red attribution is a measurement, not a convenient story** — the judge independently reproduced its filters: `333b556` added both failing files new, `git merge-base --is-ancestor 333b556 4050f98` is false, and `0878d93` (has the red oracles, excludes the IC T2 merge) reproduces the identical failures.
- **The IC spec's explicit provenance split** — naming which numbers the orchestrator re-verified at source vs which rest on an agent's evidence alone — is the right answer to writing agent measurements into SSOT and should become the required shape.
- **The ADR took the full review route** (`judge` → revise on the reviewer's two substantive points → `judge` → `approve`) — precisely the route the IC spec re-promotion skipped (V3).

## N/A invariants

- **I6** — retired tombstone (red-before-green is general TDD discipline, owned by `lore-test`/`lore-tdd`); skipped, not re-mapped.
- The `git pull --rebase origin main` sub-rule of I10 — **N/A**: `git remote -v` is empty, this repo has no remote.
- No catalogued invariant was un-exercised this session; every one of I1–I11 had evidence in both directions available.
