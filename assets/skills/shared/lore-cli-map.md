# Lore CLI Map — DocMan → lore migration reference (SSOT)

> Global workflow runs on the **lore CLI** (single binary on PATH; per-project corpus in `.lore/`).
> No MCP registration globally — every surface is `lore <cmd> [--json]`. Agent environments keep
> `CLAUDECODE=1` exported so lore's AI-assist defaults OFF (SPEC-024). Projects without `.lore/`:
> skip lore steps entirely (suggest `lore init` once per project).

## Core loop (IoC — corpus governs, hooks are thin)

FEED → PRODUCE → EXECUTE → CLOSE. Deterministic gates intercept writes (exit 4 + feeding pack);
AI judges are advisory only. Never bypass a gate (`LORE_GATE_BYPASS=1`) without explicit user say-so.

## Command map

| DocMan (retired) | lore equivalent |
|---|---|
| `get_session_bootstrap` | hook-injected at SessionStart (`lore bootstrap --json`: root, active_plans, pending_reviews, my_claims, armed_gates, latest_handoffs, resume_hint, active_sessions) — consume, don't re-call |
| `search` | `lore search "<q>" [--type t] --json` |
| `get_doc` / `get_topic_context` | `lore get <id-or-slug>` (+ `--resolve-mdx`); `lore tree [<plan>]` |
| `create_intent` | `lore create prd --title ... --content ...` |
| `create_spec` | `lore feed spec-create --parent <prd>` FIRST, then `lore create spec --title ... --parent <prd> [--kind feature\|tech\|design]`; ACs via `lore ac add <spec> ...` |
| `create_decision` | `lore create adr --title ... --decision-status proposed` |
| `create_knowledge` | `lore create knowledge --sub-type ideation\|retro\|research\|reference\|assessment\|prompt\|skill\|handoff` |
| `create_architecture` / `init_*` / `get_module` / `update_module` | RETIRED — module context lives in layered CLAUDE.md files (`zz-init-context` skill) |
| `update_doc` | `lore set <doc> --title/--content/--status ...` (editing an approved doc auto-resets to draft) |
| `manage_links` | `lore link <from> <to> --type=parent\|implements\|informs\|supersedes\|relates-to\|blocks\|governs` / `lore unlink` |
| `create_plan` | `lore create plan --title ... --parent <spec>` |
| `create_plan_phases` / `decompose_phase` | `lore phase add <plan> <name>`; `lore create task --parent <plan> --plan-id <plan> --phase <name> --anchor <path>` |
| `get_next_tasks` / `get_plan_tasks` | `lore ready <plan> --json` (computed readiness + sessions + anchor_conflicts); `lore list --type task --plan-id <plan>` |
| `claim_plan` / `heartbeat_plan` / `release_plan` | task-level lease: `lore claim <task> --by <actor> [--worktree <br>]` / `lore release <task> --by <actor>` (TTL computed read-side, no heartbeat) |
| `update_task(in_progress)` | `lore claim <task> --by $LORE_ACTOR` |
| `update_task(completed)` + `verification_evidence` | `lore evidence <task> --oracle <tsc\|test\|lint\|build\|e2e\|manual> --command "<cmd>" --result pass\|fail [--ac <id>]` then `lore release <task>` |
| `verify_task_evidence` | `lore verify <plan> [--task <task>]` — trusted runner, attested evidence (exit code decides, never self-asserted) |
| `validate_plan` | pre-exec: `lore ready <plan> --json` + gates; post-exec: `lore assess <plan>` (LLM-as-judge vs spec ACs) |
| `assert_doc_chain` | `lore status --check-tree [--fix]` (blueprint `lore.tree.yaml`) + `--check-drift` (code anchors) |
| review queue / approve | `lore pending [--escalated]`; `lore review <doc>` (AI judgment); `lore approve <doc>` / `lore reject <doc>` |
| `session_retrospective` | `lore create knowledge --sub-type retro` |
| `prepare_for_next_session` / handoff | `lore create knowledge --sub-type handoff --title "Handoff — <actor>"`; next session consumes via `lore feed session-resume [--by <actor>]` |
| stale/wrong knowledge cleanup | `lore invalidate <doc> [--superseded-by <new>] [--reason "..."]`; probes: `lore review --staleness [--list]` |
| `reindex` / `think_about_docs` | n/a (FTS5 is automatic; no equivalent needed) |
| docman-hub cross-project aggregation / telemetry dashboards | RETIRED — no lore equivalent (per-corpus `lore status` only) |

## Concurrency discipline (SPEC-042)

- Each concurrent agent gets a distinct `LORE_ACTOR=agent:<branch-or-slug>` (exported in the dispatch bundle).
- Claims are made BY the implementer from INSIDE its worktree (`--worktree` explicit) — never pre-claimed by the orchestrator.
- Tasks declare `--anchor <path>` file anchors; overlapping fresh claims by different actors are REJECTED at `lore claim` (`gate:task-claim:anchor-overlap`). Legacy alias (SPEC-056 D7): the checkpoint that gates a `phase` doc's claim is `phase-claim` (same anchor-overlap predicate) — `task-claim` still gates legacy `task` docs unchanged until migration; a config still keyed under `workflow.gates."task-claim"` is honored for `phase-claim` too (one deprecation warning per process).
- Before dispatch: `lore ready <plan> --json` → check `sessions[]` / `anchor_conflicts[]`.

## Exit codes worth branching on

`0` ok · `2` usage/contradiction · `3` check failed (`--check-tree`/`--check-drift`/`--fail-on-candidate`) · `4` validation/gate fail · `5` claim conflict · `6` AI provider error · `7` needs approval (`lore verify` new command).
