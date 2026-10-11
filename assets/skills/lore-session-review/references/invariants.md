# Invariant Catalog — lore-governed session process quality

Each invariant states WHY it exists (the failure it prevents), what counts as evidence, and known false-positive traps. Verdicts: `PASS` (evidence of compliance), `VIOLATION` (evidence of breach), `N/A` (not exercised this session — say why). Never grade on vibes; every verdict cites evidence.

**Scope — Lore-governance only.** This catalog judges adherence to Lore's workflow, not general engineering quality. I4/I5/I10 (commit / merge-verify / orchestration) read like generic git discipline but are IN scope because they are lore's own prescribed worktree-dispatch protocol (SPEC-042 + CLAUDE.md 主 Agent 分发制 / Worktree 并发安全) — the operational half of the corpus model. Genuinely general discipline is NOT here: I6 red-before-green was retired for exactly that reason (below). Every VIOLATION must, in the report, reach a **root cause + a mechanization proposal** (prompt → gate/hook/CLI); a corrective command alone is symptom-level and against CLAUDE.md 根因优先于表象.

## I1 — feed-before-produce
Before producing a governed artifact (spec/plan/task), the checkpoint feed (`lore feed <checkpoint>`) or equivalent upstream reading happened. **Why**: gates catch violations at write time, but feeding first avoids the deny-retry churn and produces upstream-consistent artifacts.
- Evidence: transcript shows feed/search/get calls before `lore create`; or gate denials followed by correction.
- N/A when: session produced no governed artifacts.

## I2 — claim-before-work
Implementation work on lore-tracked scope was claimed (`lore claim`, by the implementer, from its own worktree, with distinct actor identity) before code was written. **Why**: unclaimed work is invisible to the session registry and the anchor-overlap gate — concurrent sessions can silently collide (the gate only protects declared work).
- Evidence: claim audit rows matching the session's actors; `--worktree` declared; each concurrent agent's writes carry an attested run (distinct harness run per agent).
- VIOLATION pattern (real incident 2026-07-20): an entire multi-agent fix batch ran with zero claims — the orchestrator hand-partitioned files instead. Functional, but every safety mechanism was voluntarily dark.
- N/A when: no lore corpus, or work was outside lore-tracked scope (say which).

## I3 — evidence-before-done / external-oracle-only
Every "done" claim is backed by an external oracle (command + exit code: tsc/test/lint/build/e2e), recorded (`lore evidence` when a task exists; the completion report otherwise). LLM self-assessment is NOT an oracle. **Why**: Self-Verification Paradox — the author's own judgment of the author's work has correlated blind spots.
- VIOLATION patterns: evidence entry reading "reviewed the code and it looks correct"; a report claiming tests pass with no command/exit code; oracle run in the WRONG directory (worktree work verified against the main checkout — real incident class: missing `bun install` makes worktree tests silently test stale main-checkout source).
- Red-flag to check: exit codes measured through pipes (`cmd | tail` then `$?` — measures tail).
- **Provenance sub-check**: the evidence row must be written by the actor that RAN the oracle, from where the work happened — not transcribed by the orchestrator from a subagent's prose report ("evidence-by-proxy"). An orchestrator relabeling an implementer's self-narration into a corpus evidence row launders unverified claims through the audit trail, even when the oracle KIND looks legitimate. Evidence: the attested run on the evidence row matches the claim's holder and the worktree the oracle ran in.

## I4 — commit-before-done
A subagent's completion report on file-modifying work includes the commit hash, and the work IS committed. **Why (real incident 2026-07-20)**: an implementer reported STATUS: DONE with full oracle evidence but never committed; the worktree was later cleaned and the tree destroyed (recovered only via `git fsck` stash archaeology).
- Evidence: completion reports carry `git log --oneline -1` output; branches non-empty at merge time.

## I5 — merge-verify-before-cleanup
Before merging an agent branch and removing its worktree, the orchestrator verified the branch actually carries the commits ("Already up to date" on a supposedly-work-carrying branch = STOP). `--force` worktree removal on an unmerged/unverified tree is a violation by itself. **Why (same 2026-07-20 incident)**: the blind `merge → cleanup` sequence is what turned a missing commit into data loss.
- Evidence: transcript shows `git log <branch>` before merge, or merge diffstats consistent with the reported work.

## I6 — RETIRED (2026-07-20)
Was "red-before-green (failure-first verification)". Retired from THIS catalog: it is general test-design discipline, not Lore-governance — it invokes no lore CLI verb, corpus mechanism, or gate. Test-validity review belongs to `lore-test` / `lore-tdd` (methodology) and `~/.claude/skills/shared/verification-discipline.md`. The ID is kept as a tombstone so prior retros referencing "I6" don't silently re-map to a different invariant. Do NOT judge test-design here — if a red-green gap is glaring, record it in the report's **Out-of-scope observations** section as `[out-of-scope → lore-tdd]`, never as a Lore-discipline VIOLATION.

## I7 — gate compliance
Gate denials were handled by correcting the input (per feeding pack), never by bypass (`LORE_GATE_BYPASS`, `--no-verify`, `CLAUDE_SUBAGENT_GATE_BYPASS`) without explicit user authorization IN THE TRANSCRIPT. Safety-gate blocks (e.g. a blocked `git branch -D`) were respected — deferred to the user, not chained around. **Why**: gates are the corpus's mechanized discipline; silent bypass converts every downstream guarantee into an assumption.

## I7b — vacuity accounting (gate applicability)
For every gate the session DROVE, count denials versus `gate_not_applicable` / `notApplicable` outcomes, and report the pair. **Why**: I7 only asks whether denials were bypassed — it has no question for *"no denial was possible"*. A gate whose predicate short-circuits to inapplicable never measured anything, so every downstream guarantee it was supposed to supply is an assumption, and I1–I11 can all PASS while the gate that was meant to judge the work was dark. **Real incident 2026-07-31**: four plans closed against thirteen `gate_not_applicable` rows and zero denials; the review scored 7/7 on deterministic artifact checks in the same breath.
- Evidence: the audit rows for each transited checkpoint, counted by outcome; `lore gate <checkpoint> --explain` for what the predicate's inapplicable branch means.
- VIOLATION pattern: N plans closed with N inapplicable floors, reported as a clean run. "Zero denials" is a signature to explain, never a result to celebrate.
- Trap: inapplicable is legitimate when the session genuinely did not exercise the gated shape (no plan closed → plan-close is honestly N/A). The violation is an inapplicable verdict on work the gate was DESIGNED to judge.
- N/A when: the session transited no checkpoint.

## I8 — doc-sync honesty
Session-end doc-sync claims match reality: docs listed as updated were updated; "no update needed" reasons are true; knowledge the session DISPROVED was invalidated or corrected, not left standing. **Why (real incident)**: a CLAUDE.md row claimed a fix landed in "BOTH copies" when the SSOT copy still carried the defect — an unverifiable claim that survived 205 green conformance tests for two days.
- VIOLATION pattern: stating "fixed in both copies"/"synced" without a diff/hash oracle backing it.

## I9 — handoff on unfinished work
Session ended with unfinished lore-tracked work → a handoff doc exists (`lore handoff` / knowledge sub-type handoff) naming the WIP, or the final message explicitly enumerates the unfinished state. **Why**: Cross-Session Amnesia — un-handed-off WIP is rediscovered at full cost or silently dropped.
- N/A when: everything closed.

## I10 — orchestration hygiene
Concurrent dispatch respected: rebase/HEAD-freshness before worktree creation; file-anchor mutex between parallel agents (declared anchors, or explicit disjoint partitions when working outside lore tasks); `bun install` (or ecosystem equivalent) as first command in fresh worktrees; dispatch bundles carried objective/AC/anchors; stalled agents recalled rather than abandoned; retry ≤2 then re-dispatch with failure summary.
- Evidence: dispatch prompts, merge order, recall messages.

## I11 — CLOSE-phase hygiene
When work LANDED (spec implemented, plan finished, knowledge disproven), the CLOSE-phase steps ran — these are the most-skipped discipline because the session "feels done" once code is merged and tests are green, so the feedback-loop/memory-hygiene steps get dropped silently. **Why**: an un-armed drift oracle, a stale spec status, and un-invalidated wrong knowledge each rot the corpus for every future session, invisibly. This invariant is the one most likely to be MISSED by a reviewer mechanically checking I1–I10 and stopping — a clean execution can still have a dirty close.
- Sub-checks (each PASS/VIOLATION/N/A on its own):
  - **spec landed → `lore anchor add <spec> <impl-path[#Symbol]>`** declared, arming the doc-code drift oracle (a merged spec impl with no anchor add is a VIOLATION, not N/A).
  - **spec implemented → the SPEC DOC's own status updated** to reflect the landing (living-snapshot discipline). ⛔ This is a corpus write, NEVER a CLAUDE.md edit — spec close-outs write NOTHING to CLAUDE.md, not even an index line (`adr-claude-md-specs-section-is-pointer-only-per-spec-index`). A reviewer that flags a missing CLAUDE.md entry here is enforcing a retired rule.
  - **plan fully done → `lore assess <plan>`** ran (LLM-as-judge feedback loop closed).
  - **knowledge the session DISPROVED → `lore invalidate`d** (not left standing to mislead) — overlaps I8's honesty axis but I11 is about the corpus-hygiene ACTION, not the doc-sync claim.
- Evidence: `lore anchor list`, `lore assess` audit row, spec doc version bump, `lore invalidate` audit row.
- N/A when: nothing landed this session (pure research/review/planning with no implementation to close out).

## I12 — no self-weakening
The session did not merge a change to the enforcement layer (`gate-predicates.ts`, `checkpoint-registry.ts`, or any predicate a checkpoint reads) and then transit that same checkpoint under the weakened predicate. **Why**: gates are the only mechanized discipline the corpus has; a session that edits the judge and is then judged by its own edit has no external oracle left — it graded its own work through a surface that merely looks external. This is the Self-Verification Paradox wearing a gate's uniform.
- Evidence: for every checkpoint the session transited, diff the predicate at the session's BASE commit against the version in effect at transit time (`git show <base>:<predicate-path>` vs the closing input). Unchanged → PASS.
- VIOLATION pattern (real incident 2026-07-31): the session merged a task removing the declared-scope conjunct from the plan-close floor, then closed four plans through the resulting hole — 76 minutes after itself filing a HIGH task naming that hole. A co-resident session in the same window declared `ac_scope` and earned attestation, proving the strict path was reachable and not merely inconvenient.
- Remediation shape, not a defence: if the weakening is legitimate, the transit must happen under a TYPED, audited exemption (`lore plan exempt-attestation` and siblings), never by riding the newly-widened predicate. An exemption stays auditable forever; a transit through a self-authored hole is afterwards indistinguishable from a clean one.
- N/A when: the session touched no enforcement-layer file, or touched one but transited no checkpoint that reads it (say which).

## I13 — orchestrator-tier identity
The orchestrator's own corpus writes (evidence rows, verify runs, closes, archives) carry an actor that is distinguishable from any concurrent session's orchestrator. **Why**: identity is assigned by the agent integration, so every write must carry an attested run: a write whose audit row shows `attested: unattested` (or only a claimed name such as the constant `agent:main-orchestrator`) cannot be told apart from a concurrent session's write in the same checkout, and every attribution question downstream ("who closed this plan?") is unanswerable. A VIOLATION is an unattested write; the fix is the agent-integration hook, not a self-chosen label.
- Evidence: the `by` field on orchestrator-authored audit rows; whether concurrent sessions were live (`lore bootstrap` `active_sessions`, `git worktree list`, foreign commits landing on main mid-session).
- VIOLATION pattern: two sessions co-resident in one checkout, both writing `agent:main-orchestrator`, with no session-scoped discriminator in any audit row.
- N/A when: provably no concurrent session (single checkout, no foreign commits, no live worktrees) — state the evidence for the "no concurrency" claim rather than assuming it.

---

## Deterministic checks — interpretation guidance

- **D1 (empty-branch merge)**: A merge of a branch with 0 commits is only a FAIL if that branch was SUPPOSED to carry work (an agent's completion report exists). An intentionally-empty merge (e.g. already-cherry-picked) needs transcript support to pass.
- **D2 (worktree remnants)**: A live in-progress agent's worktree is not a remnant. An orphan worktree whose branch IS an ancestor of main (verify `git merge-base --is-ancestor`) is cleanup debt (low severity); an orphan with unmerged content is high severity.
- **D3 (dangling)**: `git stash`-shaped dangling commits (`WIP on`/`On <branch>`) from red-green isolation are NORMAL if the final work merged; they only matter when they are the ONLY surviving copy of reported work.
- **D4 (corpus chain)**: Check against what the session actually did — a pure-research session legitimately has no claims. The FAIL case is file-modifying implementation with zero claims/evidence in a lore-governed repo.
- **D5 (oracle quality)**: `--oracle manual` is legal for genuinely-manual verification (a human looked at a screen); it is a FAIL only when the "manual" text is an LLM's own opinion of its own code.
- **D6 (bypass)**: Absence of bypass strings in audit/transcript is a PASS signal, not proof — note the confidence limit.
- **D7 (dirty end-state)**: Scratchpad/temp files outside the repo don't count. Untracked files INSIDE the repo that tests depend on (fixture pollution) are a real FAIL (real incident: a foreign sync process deposited an excluded personal fixture into `assets/`, breaking 3 manifest tests — surfaced only because a full suite ran).

## Severity ordering for the report

critical = violation that caused or nearly caused irreversible loss (data loss, silent overwrite, unauthorized bypass) · high = a safety mechanism was dark for real work (no claims, no commit verification) · medium = discipline skipped with recovery available (missing red-run, missing handoff) · low = hygiene debt (remnants, stale docs).
