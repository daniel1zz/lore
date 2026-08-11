---
id: TASK-442
type: task
role: plan
title: "SPEC-050 does not carry the g1 help-guard rule (it lives only in hook comments), and knowledge 01KY95H6 is now partly superseded — record per-finding status, do not invalidate"
status: draft
priority: medium
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Origin

Two doc-sync items escalated by the implementer of `task-g1-spec-create-gate-denies-lore-create-spec-help-with` (2026-08-01) rather than silently edited — both fall outside that task's declared file anchors, and both are corpus-owned writes an implementer must not make.

## Item 1 — SPEC-050's D4 neighbourhood gained a rule that lives only in hook comments

The g1 gate now short-circuits to `allow` when the matched segment carries a bare `--help` / `-h` token. That rule sits in `assets/hooks/lore-gate-g1-spec-create.sh` and its parity-pinned `hooks/g1-spec-create.sh`, documented in their own comments — and nowhere in SPEC-050, which governs the D4 command-position matching the guard hooks into.

The measured facts a spec write must carry, so the next session does not re-derive them:

- The defect was g1-ONLY. g2/g3/g4 never denied their own `--help`. Verified by direct payload probe of the shipped asset copies.
- The reason is NOT "the other gates fail open on an unresolvable doc id" — that was the orchestrator's hypothesis and the implementer measured it false. Their patterns require a following token, so `--help` IS captured as the doc id; the real immunity is the doc-TYPE pre-check, because `lore get --help --json` is answered by citty's usage block at exit 0, so the resolved type is empty and never equals spec/plan/task.
- The guard blanks quoted values before testing, so a help spelling inside a flag VALUE (`--title "--help"`) cannot disarm the gate, and it is scoped to the matched segment so a help flag in a neighbouring chain segment cannot either.
- `--help=1` is rejected by citty as an unknown option (exit 2, no write), so the guard deliberately accepts only the two token forms citty honours.
- Unparseable input (unbalanced quote) keeps the pre-existing DENY — fail-closed, unlike the file's other anomaly paths.

Expect the spec edit to demote SPEC-050 to draft and require a re-review plus `lore approve`. That is the designed path.

## Item 2 — knowledge 01KY95H6 is now partly superseded, and only partly

Its finding 1 (the g1 `--help` false deny) is FIXED and verified end-to-end post-merge. Its findings 2 and 3 remain OPEN:

- finding 2 — the unparseable-`--content` defect.
- finding 3 — backtick/heredoc blindness: the backtick is normalised to a segment separator, so command-message PROSE becomes a command position. This fired LIVE during the same session: the implementer's `git commit -m` was denied because its message quoted the trigger phrase in backticks, and it had to commit with `git commit -F <file>`.

⛔ Do NOT `lore invalidate` the whole doc — two of its three findings are live, and invalidating it would hide them. The correct write is a per-finding status inside the doc (finding 1 fixed, naming the commit and the verifying oracle), leaving 2 and 3 as open debt.

## Oracle

- SPEC-050 names the help-guard rule, and a fresh reader can tell from the spec alone why g1 needed it and why g2/g3/g4 did not — including the doc-type mechanism, not the refuted fail-open story.
- SPEC-050 ends `approved` via `lore approve` after a real review, never `set --status approved`.
- `lore get` on knowledge 01KY95H6 shows finding 1 as fixed with its commit and oracle, and findings 2/3 still open. The doc is NOT invalidated.
- CONTROL against over-correction: findings 2 and 3 must still be discoverable by the search a future session would run for the backtick/heredoc defect.
