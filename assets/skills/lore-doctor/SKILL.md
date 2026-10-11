---
name: lore-doctor
description: "Diagnose and repair lore corpus health issues. Detects tree drift, code-anchor drift, orphans, stale drafts, stale knowledge/ADRs, stuck reviews, stale claim leases, and tasks without evidence. Supports fix mode. Use when user says 'doctor', 'corpus health', 'doc health', 'check the corpus', 'health check', '文档健康', '语料体检'."
---

# Lore Doctor — Corpus Health Diagnostics & Repair

You are in **doctor mode**. Systematically diagnose the health of the project's lore corpus
(`.lore/`) and offer targeted fixes. Everything runs through the lore CLI — the corpus is the
SSOT; never edit `.lore/` files directly.

## Arguments: $ARGUMENTS

- Empty or `check` → **Diagnose only** (default; read-only, zero corpus writes, zero AI probe calls)
- `fix` → **Diagnose + repair**: apply `--fix`-able drift and run rendered repair commands — ALWAYS after showing them to the user
- `<doc-id-or-slug>` → **Targeted diagnosis** of one doc (`lore get`, `lore log`, its links/validity/judgments)

No `.lore/` in the project → stop and suggest `lore init`.
Keep `CLAUDECODE=1` exported so no diagnostic step triggers nested AI assist (SPEC-024).

## Exit-code semantics (branch on these, from the CLI map)

`0` ok · `3` **check failed** (`--check-tree` / `--check-drift` drift found, `--fail-on-candidate` hit) · `4` **validation/structural** (e.g. `lore.tree.yaml` blueprint missing or invalid — a setup problem, not drift) · `6` AI provider error.

---

## Phase 1 — Health Snapshot (read-only)

Run these and aggregate:

1. `lore status --json` — doc/type/status counts, `open_stale_candidates`, `invalidated_feeding_source_warnings[]`, armed gates, declared code-anchor spec count.
2. `lore status --check-tree` — tree drift vs the `lore.tree.yaml` blueprint. Exit 3 = drift rows; exit 4 = blueprint missing/invalid (report as setup issue, not drift). Not armed (no blueprint) → note "tree check unarmed".
3. `lore status --check-drift` — code-anchor drift (deterministic, zero LLM). Exit 3 = drift; each row names `spec-slug → anchor (kind)` plus the rendered repair hint.
4. `lore pending --json` and `lore pending --escalated` — review-queue depth, `[unreviewed]` vs `[AI: approve/escalate]` badges, fresh escalations with blocking questions, `(stale)` judgments.
5. `lore review --staleness --list` — docs whose latest staleness judgment is a fresh `stale_candidate` (pure read, no AI call).
6. `lore tree --orphans` — orphan docs (null/dangling parent).
7. Lifecycle sweep:
   - Stuck drafts: `lore list --status draft --json` → drafts unchanged >30 days (compare `updated_at`).
   - Active plans: `lore list --type plan --status active --json`; per plan `lore ready <plan> --json` → `sessions[]` with `(stale)` claim leases, `anchor_conflicts[]`, tasks archived/near-done without any `verification_evidence` (spot-check via `lore get <task> --json`).

Output:

```
**[DOCTOR] Health Snapshot**
| Check | Result | Status |
|-------|--------|--------|
| Docs total / by status | {counts} | — |
| Tree conformance | {consistent / N drift rows / unarmed / blueprint invalid} | {OK/CRIT/INFO/WARN} |
| Code-anchor drift | {consistent / N drifts / disabled} | {OK/CRIT/INFO} |
| Review queue | {N pending, N escalated, N unreviewed} | {OK <5, WARN 5-15, CRIT >15} |
| Open stale candidates | {N} | {OK 0, WARN ≥1} |
| Invalidated feeding sources | {N warnings} | {OK 0, CRIT ≥1} |
| Orphans | {N} | {OK 0, WARN 1-5, CRIT >5} |
| Stuck drafts (>30d) | {N} | {OK 0, WARN ≥1} |
| Stale claim leases | {N} | {OK 0, WARN ≥1} |
```

## Phase 2 — Issue Report (by severity)

- **CRIT**: tree drift (exit 3), code-anchor drift (exit 3), invalidated feeding-source skill docs (gates feeding stale rules), orphaned PRD/spec/ADR, anchor conflicts between fresh claims.
- **WARN**: stuck drafts, fresh staleness escalations, stale claim leases, escalated reviews awaiting a human, completed-looking tasks with zero evidence, blueprint invalid (exit 4).
- **INFO**: unarmed checks (no `lore.tree.yaml`, drift disabled), unreviewed queue depth, archive candidates.

```
**[DOCTOR] Issues: {total}**
🔴 CRIT ({n}): - [{type}] {slug} — {description}
🟡 WARN ({n}): ...
🔵 INFO ({n}): ...
```

## Phase 3 — Repair Plan

Map every issue to its lore-native repair. ⛔ Show the FULL command list to the user before
executing anything (fix mode included):

| Issue | Repair |
|---|---|
| Tree drift (orphan/misplaced) | `lore status --check-tree --fix` (auto-fixes orphan/misplaced classes; residual rows need manual re-parenting via `lore link`/`lore set`) |
| Code-anchor drift | Per row, EITHER the rendered `lore anchor rm <spec-slug> '<anchor>'` (anchor is truly dead) OR update the path/export in the spec via `lore anchor add`/`rm` (code moved). Decide per row from git history — removing an anchor silently un-arms the drift oracle. |
| Stale candidate (from `--list` or probes) | The probe-rendered literal command: `lore invalidate <slug> --reason "..." [--superseded-by <ref>]` — report-only escalations, doctor runs them only in fix mode after user sees them |
| Invalidated feeding source | Author a replacement skill doc (`lore create knowledge ... --supersedes <old>`) or `lore invalidate <old> --undo` if the invalidation was wrong |
| Orphan doc | `lore link <parent> <orphan> --type=<relates|governs|implements>` per blueprint, then `lore status --check-tree --fix` reconciles parent_id ↔ link table; never delete |
| Stuck draft | Triage: `lore review <doc>` (AI judgment) then human `lore approve <doc>` / `lore reject <doc>` — doctor NEVER auto-approves |
| Stale claim lease | `lore release <task> --force --reason "doctor: stale lease"` — ONLY when the lease is computed stale AND no session is actually working (check `sessions[]` first) |
| Task without evidence | Flag to owner; optionally `lore verify <plan> --task <task>` if the spec declares script-mode ACs (attested evidence) |

Deeper staleness sweep (optional, AI spend): `lore review --staleness --limit 5` — bounded
probes, top-N by in-degree×age priority. Report-only: each escalation renders its exact
`lore invalidate ...` repair command. In check mode, offer it; run it only on user consent or in
fix mode.

### If mode = `check` (default)
Print the repair plan and stop: "Run `/lore-doctor fix` to apply."

### If mode = `fix`
1. Show the complete command list (above) — then execute, in severity order (CRIT → WARN):
   - `lore status --check-tree --fix` first (structural), re-run `--check-tree` to confirm exit 0.
   - Code-anchor repairs per-row as decided.
   - Rendered `lore invalidate` commands verbatim (they came from the probe/list output — do not rewrite them).
   - Stale-lease releases.
2. Log each: `**[FIX]** {command} → exit {code}`. Nonzero exit → report loud, do not retry blindly, continue with remaining fixes.
3. ⛔ Judgment calls stay human: no auto-`approve`/`reject`, no duplicate merging, no doc deletion (lore has none — invalidate/archive is the model), no `--steal`, no gate bypass.

## Phase 4 — Post-Fix Verification (fix mode only)

Re-run Phase 1 and diff:

```
**[DOCTOR] Post-Fix Verification**
| Check | Before | After |
| Tree drift | {n} | {n} |
| Code-anchor drift | {n} | {n} |
| Stale candidates | {n} | {n} |
| Orphans | {n} | {n} |

**[DOCTOR] {HEALTHY ✅ / IMPROVED ⬆️ / NEEDS ATTENTION ⚠️}**
```

Both `--check-tree` and `--check-drift` exiting 0 is the oracle for "structurally clean" —
never claim health from your own reading of the report.

## Phase 5 — Recurrence Analysis

For each issue class found, say whether lore already prevents recurrence:

- **PREVENTED ✅** — gate/oracle exists: gates intercept bad writes at create/promote/claim; `--check-tree`/`--check-drift` are CI-runnable (exit 3) — recommend wiring them into CI if drift recurred; staleness probes bound knowledge rot.
- **PARTIAL ⚠️** — detectable, not auto-prevented: stuck drafts and unreviewed queues need a periodic `lore pending` habit; stale leases expire read-side but need a release.
- **UNPREVENTED ❌** — no mechanism (e.g. semantic duplicates): name it and suggest the workflow change; do not promise a tool that does not exist.

## Rules

- **Read-only by default** — check mode makes zero corpus writes and zero AI probe calls.
- **Show before run** — every repair command is printed to the user before fix mode executes it.
- **Never delete** — invalidate (`lore invalidate`, undoable) or archive; history is append-only.
- **Never auto-approve** — review verdicts are human/AI-judge territory, not doctor's.
- **Exit codes are the oracle** — 3 = drift/candidates found, 4 = blueprint/validation problem, 0 = clean; report what the tool says, not what you infer.
- Targeted mode (`<doc>`): diagnose only that doc — `lore get --json` (validity_state, evidence, claim), `lore log <doc>`, its link neighborhood via `lore tree <doc>`.
