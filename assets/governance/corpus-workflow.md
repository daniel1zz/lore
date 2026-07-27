<!-- lore corpus-workflow governance snippet · versioned with the lore binary · installed by lore setup -->
<corpus-workflow>

# Corpus-Governed Workflow (IoC · lore-native)

Discipline lives in the corpus, not in the prompt: deterministic gates intercept writes automatically (exit 4 + a feeding pack), an AI judge is always advisory only. Projects with a `.lore/` directory follow the loop below; projects without one work normally (native plan mode + task tracking) — consider suggesting `lore init`.

## FEED — pull governance before you produce

- Session bootstrap is hook-injected where configured (`latest_handoffs` / `my_claims` / `armed_gates` / `active_sessions`) — consume it directly, do not re-fetch it yourself. `latest_handoffs` is a NEUTRAL directory of open threads across every plan, not a pointer to "the" thread — the user is the router. NEVER start resuming work from an injected handoff pointer on your own initiative; resume ONLY on the user's pasted ticket (`lore feed session-resume --handoff <slug>`) or an explicit instruction.
- Resuming interrupted work: `lore feed session-resume [--by <actor>] [--plan <plan>]`.
- Before producing any artifact: `lore feed <checkpoint>` (e.g. `spec-create --parent <prd>`) pulls the governing rules slice plus upstream summaries — pull proactively, do not wait for a gate to reject you first.
- Search first: `lore search "<topic>" --json` / `lore get <slug>` / `lore tree [<plan>]` — link to an existing doc with `lore link` instead of duplicating it.

## PRODUCE — output follows the corpus type chain

- prd → spec (`--kind feature|tech|design`, AC-as-code via `lore ac add`) → plan (`lore phase add`) → task (`--anchor <path>` file anchors).
- Deterministic gates (spec-create / spec-promote / plan-promote / task-claim, plus the additive phase-claim — the `phase` doc-type generalization of task-claim; a legacy `workflow.gates."task-claim"` config is honored for phase-claim too, one deprecation warning per process) enforce at both the hook and service layer: a deny means fix per the feeding pack and retry — never bypass with `LORE_GATE_BYPASS=1` without explicit user consent.
- Decisions go to `lore create adr`; learnings/retros/references go to `lore create knowledge --sub-type <ideation|retro|research|reference>`.

## EXECUTE — claim before you work, evidence over assertion

- `lore ready <plan> --json` to see readiness / sessions / anchor_conflicts, then pick a ready task.
- `lore claim <task> --by <actor>`. For concurrent worktree dispatch, give every agent a distinct identity (`LORE_ACTOR=agent:<branch-or-slug>`) and have each implementer claim from inside its own worktree (`--worktree` declared explicitly).
- External oracles only (tsc / test / browser, etc.) — never let an LLM self-grade its own work.
- Shared mutable state must be re-evidenced in the turn you assert it: claims, readiness, sessions, and sibling-plan progress drift under concurrent sessions — an earlier-in-context query result is a snapshot ("as of then"), never current state. Re-query before any progressive-tense claim ("still open", "currently claimed").
- Oracle passes → `lore evidence <task> --oracle <tsc|test|lint|build|e2e|manual> --command "<cmd>" --result pass`. For script-bound ACs, prefer `lore verify <plan>` (attested: the exit code decides pass/fail, never self-reported).
- Done → `lore release <task>`. Readiness is always computed, never hand-marked by anyone.

## CLOSE — feedback loop + memory hygiene

- Plan fully done → `lore assess <plan>` (LLM-as-judge review against the spec's ACs, persisted as an assessment doc).
- Spec implementation landed → `lore anchor add <spec> <impl-path[#Symbol]>` to arm the doc-code drift oracle (declare anchors after landing, not during planning — an undeclared path reads as an instant false `file_missing`).
- Superseded knowledge → `lore invalidate <doc> --superseded-by <new> --reason "<why>"` — never leave it quietly stale.
- Session interrupted or ending with open work → `lore handoff --by <actor> [--plan <plan>] --decision "<judgment>[@confidence]" --next "<next step>"` (NOT `lore create knowledge --sub-type handoff` — the writer-identity guard rejects that path, naming `lore handoff` as the sole writer). The next session consumes it via `lore feed session-resume`.
- After writing a handoff, ALWAYS report its ticket to the user: the handoff slug plus the paste-ready resume command `lore feed session-resume --handoff <slug>` — the user hands that ticket to the next session for exact context pickup. This ticket is the ONLY sanctioned resumption path; session-start injection never selects a thread for you.
- Maintenance cadence: `lore pending` (review queue) / `lore review --staleness --list` (stale candidates) / `lore status --check-tree --check-drift` (structure and code-anchor drift) / `lore archive --sweep` (execution-scoped docs due for archival — apply with `lore archive --apply`).
- Suspect a lore defect itself (gate false-deny, wrong/misleading output, a crash)? Re-verify your own input first. Still confirmed → `lore report-issue --title <t> --expected <e> --actual <a>` (needs `feedback.upstream` configured). Check `lore report-issue --list` for a prior filing before re-reporting the same symptom.

</corpus-workflow>
