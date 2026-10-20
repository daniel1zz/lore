---
name: lore
description: "Use when the user says \"记到 lore\" / \"存到知识库\" / \"查一下团队知识库\" / \"save this decision\", when capturing decisions or learnings worth sharing across sessions or teammates, or before work that earlier PRDs, specs or ADRs may already cover. Operates the lore CLI: a shared corpus of PRDs, specs, ADRs, plans and knowledge docs."
---

# Lore — Team Knowledge Base

Single binary `lore`, data lives in `.lore/lore.db` (per-directory corpus; run commands from the project root that owns the corpus).

Not installed? `ln -sf <lore-repo>/dist/lore /usr/local/bin/lore`, then `lore init --name <corpus> --author <name>` once in the corpus directory.

## Quick start

```bash
lore search "optimistic locking" --limit 5   # FTS5 full-text, BEFORE writing something new
lore get <id-or-slug>                        # read one doc (slug format: {type}-{kebab-title})
lore create prd --title "Payment module" --content "..." --tags payments,p0
lore link spec-payment-api prd-payment-module --type=implements
```

Every command supports `--json` for machine-readable output. Errors print to stderr with non-zero exit — never parse stdout on failure.

## AI defaults (SPEC-024)

Lore detects the caller surface: human CLI → AI assist on; agent contexts (`CLAUDECODE=1` / `CI=true` / `LORE_AI_DEFAULT=off`) and MCP → AI off, so `lore create` never triggers a nested Claude call. Override per call with `--ai` / `--no-ai` (mutually exclusive; both → exit 2). Exception: `lore assess` and `lore review` ARE the AI intent — they default AI-on on every surface and have no non-AI mode (`--no-ai` always exits 2).

## Retrieval (do this before creating)

```bash
lore search "<topic>" [--type adr] [--limit N]   # content search
lore list --type adr                             # browse by type
lore tree                                        # hierarchy view
lore status                                      # corpus stats / health
lore status --check-tree [--fix]                 # tree drift vs lore.tree.yaml blueprint (SPEC-032)
```

Always search first — duplicating an existing doc fragments team knowledge. Link instead.

## Creating documents

| Type | Required besides --title |
|---|---|
| prd, plan | — |
| spec | no parent (a spec takes none; it relates to the trees by criteria citing rules, `lore ac add ... --cite BR-<n>`); optional `--kind feature\|tech\|design`, defaults `feature` |
| task | `--parent <plan>` + `--plan-id <plan>` (+ optional `--phase <name>`, must be declared on the plan) |
| adr | `--decision-status proposed\|accepted\|deprecated\|superseded` |
| knowledge | `--sub-type ideation\|retro\|research\|reference\|assessment` |

All six types are CLI-creatable. The MCP interface (`lore --mcp-server`) remains the path for arbitrary `extra` fields beyond these flags.

Flags: `--title --parent --content --content-file <path> --priority critical|high|medium|low --tags a,b --json`.

## Plans with phases (SPEC-023)

```bash
lore phase add <plan> <name> [--description]   # declare a phase (exit 4 on duplicate)
lore phase list <plan> | rm | rename           # manage phases
lore create task --parent <plan> --plan-id <plan> --phase <name> --title "..."
lore tree <plan>                               # tasks grouped under phase headers
```

## Task execution workflow (SPEC-025)

Advisory lease + append-only oracle evidence, for agents executing plan tasks:

```bash
lore claim <task> [--branch <b>] [--steal]   # acquire/refresh lease; fresh claim held by someone else → exit 5 unless --steal
lore evidence <task> --oracle tsc|test|lint|build|e2e|manual|other \
  --command "<cmd>" --result pass|fail --capture   # --capture: runner spawns --command and records its output; pass needs it (manual: --output-tail instead)
lore release <task> [--reason "why"] [--force]   # non-holder needs --force
lore ready <plan> [--json]     # computed readiness over blocks links — never stored
```

A recorded `--output-tail` is bounded: only the last {{lore:capture_tail_chars}} characters are kept.

Identity: a write is attested by the agent integration's registered run alone — no write command takes `--by`, and no MCP write tool takes `by`. Lease expiry is computed read-side (`workflow.claim_ttl_minutes`, default 120) — no daemon. `lore tree` / `lore list --type task` render `[claimed:by (stale) ✔n/✘n]` badges. Record evidence as oracles run, not batched at the end.

## Review workflow

New docs start as `draft`. Lifecycle: draft → in-review → approved → active → archived (fast-track draft→approved allowed; approved→deprecated). Editing an approved doc's content/title resets it to draft.

```bash
lore pending [--escalated]            # triage queue with AI badges: [AI: approve 0.93] / [AI: escalate ✋NQ] / [unreviewed], (stale) suffix
lore review <doc> | --pending         # structured AI judgment (SPEC-034): deterministic pre-checks run first — a check failure short-circuits to a reject judgment WITHOUT invoking the LLM
lore approve <id>
lore reject <id> --reason "why"       # reason lands in audit log
lore set <id> --status active         # other transitions
```

Approve/reject implicitly capture a calibration record against the doc's latest AI judgment (version-pinned) — no extra step needed.

## Feedback loop (SPEC-026 / SPEC-035)

```bash
lore assess <plan> [--diff HEAD~3..HEAD | --diff-file <path>]   # LLM-as-judge: plan vs spec ACs + task evidence → knowledge doc (sub_type=assessment) linked informs→plan
lore audit [<doc>] [--actor <a>] [--action <act>] [--since <ISO>] [--limit N]   # decision trail (create|update|approve|reject|claim|release|evidence|judge|…)
lore audit --verify                   # completeness oracle: versions ⋈ audit reconcile
lore calibration --stats [--doc-type spec] [--prompt-version v1]   # human-vs-AI agreement per doc_type × prompt_version, Wilson lower bound
```

## Version history (append-only, non-destructive)

```bash
lore log <id>                         # all versions
lore diff <id> --from 2 --to 5        # unified diff between versions
lore restore <id> 3                   # rollback = creates a NEW version
```

Concurrent writes are protected by optimistic locking — a stale write returns STALE_VERSION; re-read the doc and retry your edit on the fresh version.

## Linking

`lore link <from> <to> --type=<t>` with types: `parent | implements | informs | supersedes | relates-to | blocks` (default relates-to). Direction is detailed→abstract for implements (spec→prd). `lore unlink <from> <to>` removes.

## Corpus ↔ files sync (SPEC-021)

```bash
lore export-docs [--dry-run] [--type spec]   # corpus → docs/requirements/<type>/*.md; .lore/export-index.json is git-tracked (team-shared ID map)
lore sync-docs [--from <dir>] [--dry-run]    # backfill disk .md spec files → corpus (default dir docs/requirements/spec)
```

## Agent/service integration

- MCP (preferred for agents): `lore --mcp-server` — {{lore:mcp_tool_count}} `lore_*` tools: full-field CRUD, review/judgment (`lore_review`, `lore_pending` with `include_judgments`), task workflow (`lore_claim` / `lore_release` / `lore_evidence_add` / `lore_ready` — `by` is required explicitly), `lore_assess`, `lore_audit`. 
- HTTP API: `lore serve` + `lore agent create --name <agent>` to issue API keys (`lore agent list|revoke`).

## Who can write

Every write is made by a known party; there are two ways to be one.

- An agent: its writes carry the run its integration attests. Install the integration with `lore setup`. A process inside an agent harness never starts a human session.
- A person working by hand: run `lore session start --human <name>` once per checkout. Writes from that checkout are then recorded as `<name>` until `lore session end`. `lore session show` (no id) names the open session; `lore session end` closes it (exit 3 if none is open). A second `start` while one is open is refused.

With neither, writes are refused (exit 4); reads still work.

## Conventions

- One corpus per team workspace; back up = copy `.lore/lore.db`.
- Capture decisions as they're made (don't batch at session end); prefer linking related docs over restating context.
- `lore delete <id>` is a soft delete (30-day recovery); status `archived` is preferred over deletion.
