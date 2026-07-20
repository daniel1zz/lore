---
name: lore-session-capture
description: "Session reflection and knowledge persistence orchestrator. Captures decisions, patterns, and learnings from the current session and persists them into the lore corpus (per-project .lore/) via the lore CLI — including invalidating knowledge the session proved wrong, and writing a handoff doc for the next session. Use when: 'save session knowledge', 'persist what we learned', 'session handoff', 'prepare for next session', 'what did we decide', '记录会话知识', '会话交接', '保存决策', end of a productive session, or before context gets compressed."
---

# Session Knowledge → lore

All persistence flows through the **lore CLI** (`lore <cmd> --json`). Keep `CLAUDECODE=1` exported so lore's AI-assist defaults OFF (agent surface). Project has no `.lore/` → skip persistence entirely and tell the user (`lore init` once per project if they want it).

> **Sibling skill — `lore-session-review`**: this skill captures WHAT the session learned (knowledge posture). It does NOT judge HOW the session executed the workflow (claim/evidence discipline, worktree hygiene, gate compliance). For a complex or multi-agent session — especially one with incidents — run `lore-session-review` FIRST (it produces process-violation findings you can reference in the retro), then this skill to persist. The two are complementary, not substitutes.

## Workflow

```
REFLECT → EXTRACT → DEDUP → PERSIST → LINK → INVALIDATE → HANDOFF → VERIFY
```

### 1. Reflect

Review the session transcript yourself (no bootstrap tool — reflection is your job):

- A. What was accomplished / what remains?
- B. Key decisions: what, why, alternatives considered, confidence
- C. Problems: encountered, resolved, root causes, reusable patterns
- D. What did this session PROVE WRONG that the corpus still asserts?

### 2. Extract — scan for knowledge signals

| Signal | lore persistence |
|---|---|
| Technical / architecture decision | `lore create adr --title "..." --decision-status accepted` (or `proposed` if not yet ratified) |
| Business rule / domain invariant | `lore create adr` (decision framing: context, constraint, reason) |
| Bug pattern / retro learning | `lore create knowledge --sub-type retro` |
| Research finding / benchmark | `lore create knowledge --sub-type research` |
| SDK gotcha / reusable reference | `lore create knowledge --sub-type reference` |
| Feature requirements discovered | Real spec: `lore feed spec-create --parent <prd>` first, then `lore create spec --parent <prd> --kind feature` + `lore ac add` |
| Existing doc now inaccurate | UPDATE it: `lore set <doc> --content ...` (approved doc auto-resets to draft) |
| Superseded / disproven knowledge | INVALIDATE — see step 5 |

What is NOT a signal (noise — do not persist): routine command output, restating existing docs, one-off environment quirks, anything a fresh agent could rediscover in <1 min from code. A decision needs a *rejected alternative*; a learning needs a *surprise*.

No signals and no WIP → report "nothing to persist" and stop.

See [references/knowledge-types.md](references/knowledge-types.md) for detection signals and content templates per type.

### 3. Dedup

Before EVERY create: `lore search "<topic>" [--type adr|knowledge] --json`.
- Exists and still correct → `lore set <doc>` to extend it; never create a duplicate.
- Exists but now wrong → supersede path (step 5), not a silent parallel doc.

### 4. Persist

Use the mapping from step 2. Body via `--content "..."` or `--content-file <path>` (mutually exclusive). Keep each doc atomic: one decision / one learning per doc.

### 5. Invalidate — memory hygiene is part of capture

Never leave superseded docs standing. For each thing the session proved wrong:

```bash
# Replacement doc already created this session:
lore invalidate <old-slug> --superseded-by <new-slug> --reason "..." [--by <actor>]

# Or create + invalidate in ONE command:
lore create adr --title "..." --decision-status accepted --supersedes <old-slug>
# Half-failure (create ok, invalidate failed) exits nonzero and prints the exact
# repair command — run it, never leave the old doc un-invalidated silently.

# Wrong with no replacement:
lore invalidate <old-slug> --reason "disproven: <evidence>"
```

Invalidation is report-marked, not deleted — `lore get` still shows the doc with an INVALIDATED banner; `lore search`/`lore list` exclude it by default.

### 6. Link

Wire every new doc into the graph — an unlinked doc is invisible to future feeds:

```bash
lore link <new-doc> <plan-or-spec> --type=informs     # knowledge that informed the work
lore link <new-doc> <related-doc> --type=relates-to   # loose association
```

Valid types: `parent | implements | informs | supersedes | relates-to | blocks | governs`.

### 7. Handoff (if WIP exists)

Unfinished work → write a handoff knowledge doc:

```bash
lore create knowledge --sub-type handoff --title "Handoff — <actor>" --content-file <tmp.md>
```

Body MUST contain: active plan slug, task refs (claimed/ready/blocked), modified files, key decisions made this session, concrete next steps. Link it: `lore link <handoff> <plan> --type=informs`.

**Consumption path — state this explicitly in your output**: the NEXT session picks the handoff up via `lore feed session-resume [--by <actor>]` (newest-wins; `--plan <slug>` to scope, `--handoff <slug>` to target directly). Also release stale task leases you hold: `lore release <task> --by <actor>`.

### 8. Verify

- `lore get <slug>` each created doc; `lore tree` to confirm linkage.
- Output summary: docs created (type, slug, action), docs updated, docs invalidated (old → new), links established, handoff slug + the `lore feed session-resume` consumption command, or "no handoff needed".
