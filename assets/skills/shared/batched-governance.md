# Batched Governance — one interview, one production run, one review, one approval

The ONLY governance flow for `lore-product` (prd), `lore-design`, `lore-plan` (create / update / replan) and `lore-autopilot`. There is no attended/unattended split and no per-artifact variant: every per-artifact user stop, per-doc AI review and per-plan assess those skills used to run is replaced by the four stages below. A skill that still describes its own stop defers to this file.

## Why batch

- **Per-artifact review cannot see across artifacts.** A spec that passed every gate and repeated per-doc AI review still contradicted an approved spec three times; all three were caught only by an implementer's tests (`knowledge-gates-and-the-review-judge-validate-a-spec-against`). A reviewer that sees the whole bundle at once is the only review placement that can catch a cross-document contradiction.
- **Per-artifact stops multiply.** One slice used to cost 5–6 user stops (PRD key decisions, PRD approval, design approval, plan clarification, plan strategy pick, task-tree confirmation, plus one per phase transition), and every edit to an approved doc re-armed a review (`knowledge-redeeming-three-advisories-produced-two-more-rounds`: v19 → v33, seven revision rounds, zero code).

## S1 — Decision interview (the only user stop before production)

1. Collect EVERY question that is genuinely the user's before producing anything — from all downstream skills at once: PRD key decisions (scope, framing, priority, exclusions), P0 requirements whose value risk is unvalidated (demote / validation task / `🎲 accepted bet`), design trade-offs that turn on preference rather than evidence, plan clarification dimensions, decomposition-strategy preference, kill lines and success bars.
2. A question answerable from code, corpus, docs or measurement is NOT asked — answer it yourself and record the source.
3. Ask in ONE sitting: consecutive `AskUserQuestion` calls (up to 4 questions each), closed-form options with a recommended first option, no production work between calls.
4. A question whose answer depends on a FUTURE measurement (a pilot result, a benchmark) is never deferred to a later stop. Write it as a **pre-registered branch** — `trigger (measurable) → path A | path B` — and have the user approve the branch table in this sitting. Bars and kill lines are fixed here, before any measurement.
5. Record every answer in a decisions ledger that every artifact carries forward (PRD "decided by user" marks, spec Decisions, plan Decisions Log).

## S2 — Uninterrupted production

1. Produce the WHOLE initiative as drafts in one run: PRD/requirement update (if any) → every spec, for every slice (not only the next one) → every AC, final → every plan, its phases, tasks and `blocks` links.
2. During S2 there is NO `AskUserQuestion`, NO `lore review`, NO `lore approve`, NO reviewer dispatch. Where a skill demands "≥2 options", the AI decides with Sequential Thinking and records the chosen and rejected options with rationale; the user sees them in S4.
3. Deterministic self-checks that cost no review run as you go and are not reviews: `lore gate spec-promote --spec <spec>`, `lore ready <plan> --json` structure, spec-AC → task `Covers:` coverage.
4. A slice whose design depends on an earlier slice's measured outcome is still produced now, with that dependency written as a pre-registered branch from S1 — never left undesigned "until we know".
5. ⛔ Finalize ACs before S3. A judgment covers one doc version; `lore ac set` (and any content edit) after S3 voids it and costs a fresh review.

## S3 — One bundle review

1. ONE review round over the WHOLE bundle — every new or changed PRD/spec/ADR/plan/task at once, plus the approved specs it claims to extend. First dimension, always: cross-document contradiction.
2. Several lenses are allowed (PRD stakeholder lenses, the design mode's quality gates, the plan's 5-dimension `lore-reader` audit), but all are dispatched in ONE message and every one of them reads the same full bundle — never one reviewer per artifact, never sequentially.
3. Apply every finding in ONE edit pass. At most one re-review, limited to what changed. Two rounds maximum; anything still open goes to S4 as a named open item, not into a third round.
4. Then the binary's per-version judgment, exactly once per judgment-required doc (`workflow.review.judgment_required_types`, default spec + adr), on the FINAL version: `lore review <doc>` for each, issued in parallel. A reject/escalate → fix that doc → re-run `lore review` for that doc only. Plans and tasks need no judgment.

## S4 — One user approval

1. One `AskUserQuestion`. The summary lists: each artifact in one line; every AI-made decision with its rejected options; the pre-registered branch table; top risks; reviewer verdicts and any open items. Options: approve all / adjust (names the items) / redo.
2. "Adjust" → change only the named items → re-review only those (S3 rules) → ask again.
3. Approve → `lore approve` in dependency order in one batch: PRD → specs and ADRs → plans. Gate denials are fixed per the feeding pack, not escalated.
4. Earlier "继续" / "go on" is never approval of a document.

## Execution and closure

- **Phase transitions auto-proceed.** An Invariant violation is a hard block; fix it (autopilot Fix Loop) and continue.
- **The user is consulted during execution ONLY when:** a measured result falls outside every pre-registered branch; one of `lore-autopilot`'s M1–M5 applies; or an Invariant violation cannot be fixed. A result that lands on a pre-registered path proceeds along that path without asking and is recorded in the plan's Decisions Log.
- **Replan** inside the pre-registered branches → no stop. Outside → run S1–S4 again, scoped to the affected artifacts only.
- **`lore assess` runs once per plan, batched at the END of the initiative**: after the last plan's tasks are done, assess every plan in parallel and triage all findings in one pass. Never per phase, never as each plan closes. Exception: a plan that a pre-registered branch reads as its trigger (a pilot) is assessed when it closes, because its verdict is that branch's input. Assessing last also satisfies `plan-close`'s `assessment-freshness` field (an assessment must not predate later task activity).
- `lore verify` (attested oracle runs) and the post-merge test suite are oracles, not reviews — they stay per merge as `lore-autopilot` prescribes.
