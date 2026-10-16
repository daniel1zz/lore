---
id: KN-696
type: knowledge
role: knowledge
title: "Always-loaded lore fragments: verbatim source before the rule-wording compression (2026-10-15)"
status: approved
priority: medium
created: 2026-10-15
updated: 2026-10-15
tags: [fragments, content-tiers, eviction]
parent: PRD-001
---
Verbatim source of every lore fragment rendered into this repo's always-loaded project rules (`.claude/rules/lore-*.md`), as of commit b049f0ab (2026-10-15), before the rule-wording compression. Tier 1 keeps the rule only; the reasoning below is tier 2, read only by whoever changes a rule. Edit the fragments, never this record.

## `assets/context/ac-design.md`

````markdown
---
id: ac-design
title: "Designing acceptance criteria that cannot go falsely green"
audience: [main]
mode: static
---
## AC design

- An AC proves only what it asserts; the gap between "goal met" and "AC green" is the AC author's job. After writing an oracle, name the simplest case where the goal fails yet the oracle stays green, and assert it. Assert the exit code EXACTLY plus the rule name in the output, never "non-zero"; a probe outside the linted tree proves nothing; three green runs do not clear a flaky oracle; an SSOT AC must check that residual duplicates are gone, not only that the new function exists. Make every oracle go red once (weaken the rule, build a tie) — a green-only run is not verification.
- Editing an oracle after it went red is a spec change, indistinguishable in audit from hiding the failure. Record in place the original command, its exact failure, and why this corrects rather than weakens. The pattern itself lowers the assess evidence_integrity score.
- Read a shared field back before `set`: whole-field replacement swallows what other agents appended.
- A capability and its production wiring are ONE acceptance unit: same-phase wiring task, an AC asserting the live call site, file anchors covering both the implementation and the wiring point.
- Fixing a gap and updating the comment that records it are ONE unit: anchors must cover every comment naming the gap (grep its wording); write the new comment checkable (file:line or symbol), never just "fixed".
- `lore ac add|set` demotes an approved spec to draft whoever runs it (even a statement-only edit re-validates command paths; needs `--allow-missing-path`). In the same session run `lore review` + `lore approve` (approve needs a review of the CURRENT version); if a bundle had implementers run `ac set`, the main agent resets after ALL their merges.
- A rubric AC at 0 pass / 0 fail silently archives with its tasks — evaluate it before archiving a plan. Never paste a governance tool's printed write command (archive/close especially) without confirming its gate fires; never test an irreversible action on a real object.
````

## `assets/context/corpus-workflow-4-close.md`

````markdown
---
id: corpus-workflow-close
title: "CLOSE — feedback loop + memory hygiene"
audience: [main]
mode: static
---
## CLOSE — feedback loop + memory hygiene

- Plan fully done → `lore assess <plan>` (LLM-as-judge review against the spec's ACs, persisted as an assessment doc).
- Spec implementation landed → `lore anchor add <spec> <impl-path[#Symbol]>` (a test file also takes `<test-path>#"describe or it title"`) to arm the doc-code drift oracle (declare anchors after landing, not during planning — an undeclared path reads as an instant false `file_missing`).
- Superseded knowledge → `lore invalidate <doc> --superseded-by <new> --reason "<why>"` — never leave it quietly stale.
- Session interrupted or ending with open work → `lore handoff [--plan <plan>] --decision "<judgment>[@confidence]" --next "<next step>"` (NOT `lore create knowledge --sub-type handoff` — the writer-identity guard rejects that path, naming `lore handoff` as the sole writer). The next session consumes it via `lore feed session-resume`.
- After writing a handoff, ALWAYS report its ticket to the user: the handoff slug plus the paste-ready resume command `lore feed session-resume --handoff <slug>` — the user hands that ticket to the next session for exact context pickup. This ticket is the ONLY sanctioned resumption path; session-start injection never selects a thread for you.
- Maintenance cadence: `lore pending` (review queue) / `lore review --staleness --list` (stale candidates) / `lore status --check-tree --check-drift` (structure and code-anchor drift) / `lore archive --sweep` (execution-scoped docs due for archival — apply with `lore archive --apply`).
- Suspect a lore defect itself (gate false-deny, wrong/misleading output, a crash)? Re-verify your own input first. Still confirmed → `lore report-issue --title <t> --expected <e> --actual <a>` (needs `feedback.upstream` configured). Check `lore report-issue --list` for a prior filing before re-reporting the same symptom.
- CLAUDE.md holds only permanent static discipline (rules, prohibitions, thresholds, paths, commands); events, state, history, retros and pending items belong in the lore corpus. Never let CLAUDE.md carry state narrative that will go stale.
````

## `assets/context/corpus-workflow-3-execute.md`

````markdown
---
id: corpus-workflow-execute
title: "EXECUTE — claim before you work, evidence over assertion"
audience: [main]
mode: static
---
## EXECUTE — claim before you work, evidence over assertion

- `lore ready <plan> --json` to see readiness / sessions / anchor_conflicts, then pick a ready task.
- External oracles only (tsc / test / browser, etc.) — never let an LLM self-grade its own work.
- Shared mutable state must be re-evidenced in the turn you assert it: claims, readiness, sessions, and sibling-plan progress drift under concurrent sessions — an earlier-in-context query result is a snapshot ("as of then"), never current state. Re-query before any progressive-tense claim ("still open", "currently claimed").
- Never discard lore's own output. `lore set|approve|reject|claim|release|evidence|invalidate|archive` print state transitions and gate preconditions on stdout — most critically, editing an approved doc's content demotes it back to `draft`, which silently freezes every downstream `task-claim` until you re-review and re-approve. Writing `lore set ... >/dev/null 2>&1` for terser logs discards the one signal that predicts the next gate denial, and you will misread the resulting `UPSTREAM_NOT_APPROVED` as a tool defect rather than your own muted warning. Need less noise? Pipe through `| tail -3` — never redirect the stream away.
- Oracle passes → `lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual> --command "<cmd>" --result pass`. Give every row a REAL captured tail via `--output-tail-file <the file you redirected the run into>` — a hand-typed summary satisfies the record's form while carrying none of its content, and an empty tail makes the row unverifiable by anyone but you. Record your RED runs too, as `--result expected-fail`, so red-first survives in the corpus instead of only in a transcript. For script-bound ACs, prefer `lore verify <plan>` (attested: the exit code decides pass/fail, never self-reported).
- Measure every oracle's exit code WITHOUT a pipe — `<cmd> > out.log 2>&1; echo $?`. A piped `$?` is the pipe's status, not the command's, and it silently converts a gate denial or a failing suite into an apparent success.
- `lore release <task>` drops the advisory lease only — it does not archive the task and does not remove it from the ready set. Readiness is always computed, never hand-marked by anyone.
- `lore done <task>` is the sole command that walks `approved → active → archived`; it belongs to whoever can assert the work is merged into main. An implementer working inside its own worktree structurally cannot make that assertion, so its own sequence stops at `release` — archival is a separate step, run later by whoever can.
````

## `assets/context/corpus-workflow-1-feed.md`

````markdown
---
id: corpus-workflow-feed
title: "FEED — pull governance before you produce"
audience: [main]
mode: static
---
## FEED — pull governance before you produce

- The session-start injection, where configured, carries only THIS seat's own open claims (`seat_claims`) and its plan handoff — nothing corpus-global. For corpus state pull on demand: `lore bootstrap` (root, active plans, pending reviews, armed gates, latest handoffs, active sessions), `lore ready <plan>`, `lore pending`. `latest_handoffs` from `lore bootstrap` is a NEUTRAL directory of open threads across every plan, not a pointer to "the" thread — the user is the router. NEVER start resuming work from a handoff pointer on your own initiative; resume ONLY on the user's pasted ticket (`lore feed session-resume --handoff <slug>`) or an explicit instruction.
- When reporting state to the user, label each item by source — pasted ticket / session-start injection / this-turn query — never merge them into one undifferentiated list: obeying the resumption rule alone does not satisfy this duty (measured 2026-07-30: a report merged sources though the assistant never self-resumed).
- Resuming interrupted work: `lore feed session-resume [--by <actor>] [--plan <plan>]`.
- Verifying a handoff you JUST AUTHORED costs you nothing: the floor arms only for a ticket authored by a different actor or in an earlier session, so rendering your own outgoing ticket to confirm it is consumable does NOT charge you with the next-steps you are handing off. Verify it — the discipline of never trusting an unseen artifact applies to the resume command you hand the user. When the check cannot determine authorship (no session marker), the floor arms; that is deliberate fail-safe, so account for the items normally in that case.
- Before producing any artifact: `lore feed <checkpoint>` (e.g. `spec-create`) pulls the governing rules slice plus upstream summaries — pull proactively, do not wait for a gate to reject you first.
- Search first: `lore search "<topic>" --json` / `lore get <slug>` / `lore tree [<plan>]` — link to an existing doc with `lore link` instead of duplicating it.
````

## `assets/context/corpus-workflow-0-overview.md`

````markdown
---
id: corpus-workflow-overview
title: "Corpus-governed workflow overview"
audience: [main]
mode: static
---
Discipline lives in the corpus, not in the prompt: deterministic gates intercept writes automatically (exit 4 + a feeding pack), an AI judge is always advisory only. Projects with a `.lore/` directory follow the loop below; projects without one work normally (native plan mode + task tracking) — consider suggesting `lore init`.
````

## `assets/context/corpus-workflow-2-produce.md`

````markdown
---
id: corpus-workflow-produce
title: "PRODUCE — output follows the corpus type chain"
audience: [main]
mode: static
---
## PRODUCE — output follows the corpus type chain

- prd → spec (`--kind feature|tech|design`, AC-as-code via `lore ac add`) → plan (`lore phase add`) → task (`--anchor <path>` file anchors).
- Deterministic gates (spec-create / spec-promote / plan-promote / task-claim, plus the additive phase-claim — the `phase` doc-type generalization of task-claim; a legacy `workflow.gates."task-claim"` config is honored for phase-claim too, one deprecation warning per process) enforce at both the hook and service layer: a deny means fix per the feeding pack and retry — never bypass with `LORE_GATE_BYPASS=1` without explicit user consent.
- Decisions go to `lore create adr`; learnings/retros/references go to `lore create knowledge --sub-type <ideation|retro|research|reference>`.
````

## `assets/context/dispatch-bundle.md`

````markdown
---
id: dispatch-bundle
title: "Subagent dispatch bundle and context watermarks"
audience: [main]
mode: static
---
## Subagent dispatch

- Bundle five sections: Task Objective / Spec Reference / AC / Context Digest / File Anchors.
- Watermarks: dispatch under 15k tokens, subagent peak under 40k, main peak under 150k.
````

## `assets/context/evidence-attestation.md`

````markdown
---
id: evidence-attestation
title: "Evidence attestation: --capture versus verify"
audience: [main, "subagent:lore-implementer"]
mode: static
---
## Evidence attestation

- `lore evidence --capture` writes a real attestation (with exit_code) that clears the `lore done` attested floor, but it only proves the command the CALLER chose exited 0. `lore verify` attests a command derived from the AC's declared scope and adds completeness / executed_files / execution_root / execution_mode. AC evidence goes through verify; `--capture` is auxiliary. A fix applies only after the writing binary is rebuilt.
- `--capture` and `lore verify` record stdout and stderr as ONE merged stream in terminal order; the {{lore:capture_tail_chars}}-char tail keeps the runner's final summary line.
- A script-mode AC command must print a checkable summary on success (`... && echo '<AC-ID> PASS: <fact proved>'`); a tail must carry the runner summary (`N passed` / `Done`). verify runs the AC's declared command, so a silent oracle (a `grep -q` chain) leaves an attested pass with an empty tail — fix the declared command, not the recorder.
````

## `.lore/context/scoped-oracles-in-worktrees.md`

````markdown
---
id: project-scoped-oracles-in-worktrees
title: "Scoped oracles in worktrees, full suite only on main"
audience: [main, "subagent:lore-implementer"]
mode: static
---
## Scoped oracles in worktrees

- In a worktree run only scoped oracles: prefer `bun run test:changed <base>` (deterministic cross-runner selection; `--list` previews); otherwise your AC test files with `-t` plus `vitest --changed <base>`, the `.bun.test.ts` files matching your anchors, and `bun run typecheck`.
- The full suite (`bun run test`) is run once on main by the orchestrator after merge — N concurrent full suites starve spawn-type tests into 30s timeouts that read as fake regressions.
- `test:changed` UNDER-selects (tree-scanning tests naming no literal path; consumers reached via dynamic `await import()`; `.bun.test.ts` via `vitest --changed`), so hand-pick direct consumers and run the blind ones by hand.
- A monorepo package (`packages/*`) with new or changed exports must be built before its dependents are verified, else tsc cannot see the new exports.
````

## `assets/context/worktree-dispatch.md`

````markdown
---
id: worktree-dispatch
title: "Worktree dispatch: lore protocol for parallel implementers"
audience: [main]
mode: static
---
## Worktree dispatch

- Actor discipline: identity is per run (`lore run show <id>`); the implementer claims inside its own worktree, the main agent never claims on its behalf; claim conflicts are judged per run (BR-1040), not by name.
- Merge each returned branch at once with `git merge <branch> --no-ff`; put the task slug in the merge message (`lore assess`'s fallback). Run `lore done` BEFORE `git branch -d`: done records the task's commit range from the claim's branch tip, which assess uses first. After the merge is confirmed (`git branch --merged main`), `git worktree remove <path>` and `git branch -d <branch>`; never delete an unmerged worktree.
- After EVERY merge run `git branch -a` and `git log --oneline main..<branch>` per branch, unconditionally: a sub-agent's own sub-agent opens a branch the parent's reply never names (726 lines of tests once sat on an orphan branch).
- Failures: retry at most twice via SendMessage with the failure text; then discard the worktree and redo with a fresh agent, the failure summary injected as an anti-pattern.
- Acceptance split: the subagent records `lore evidence` and `lore release` and stops; after the merge verifies, the main agent runs `lore done <task>` (else the task stays in the ready set) and, for script-bound ACs, `lore verify <plan>`. At phase end `git diff` in full and `lore ready --json` read through `counts.ready` (`.records` also holds archived rows); plan done means `lore assess`.
- Scoped-oracle floor: every file importing the changed module, not just the task's anchors.
- Verify after a merge with the build cache bypassed (`--force`): turbo/nx caches are shared across worktrees, so a rerun printing `Cached: N cached` replays the agent's own result.
````
