---
id: KN-205
type: knowledge
role: knowledge
title: "D5 re-scope: 35 open tasks against the named-consumer criterion — 0 blocking, 14 must-fix, 8 onboarding-only, 13 descheduled"
status: archived
priority: medium
created: 2026-08-03
updated: 2026-10-10
tags: []
parent: PRD-001
links:
  - {id: ADR-029, type: relates-to}
---
# The re-scope pass D5 asked for — 35 open tasks against a named-consumer criterion

Decided 2026-08-03 by the user: ADR
`adr-a-guard-does-not-exist-until-it-runs-against-the-real-tree` D5's external termination
criterion is **the two existing named consumers, `babyai` and `guyin`, completing the
prd→spec→plan→task→evidence→done chain on the shipped binary.**

Both consumers are real and measured (read-only queries against their own `.lore/lore.db`,
2026-08-03):

| consumer | docs | archived plans | archived tasks | tasks carrying evidence | last write |
|---|---|---|---|---|---|
| `babyai` | 495 | 61 | 23 | 26 | 2026-07-31 |
| `guyin` | 202 | 4 | **93** | **115** | **2026-08-03 08:49** |

Both run the SAME binary this repo builds — the global `lore` is a symlink into
`/Users/apple/Projects/zz/lore/dist/lore`. Every binary-side defect is live for them today.

## The first filter failed, and that is the finding

The predicted prune was "dev-repo-only items drop out wholesale". Classifying all 35 open tasks
by their declared `file_anchors`:

    SHIPS (packages/lore/src, packages/core/src, assets/)   17
    no anchors declared                                     16
    MIXED                                                    2
    DEV-REPO-ONLY                                            0

**Zero.** The dev-repo-only population (`scripts/check-*` arming, `test:changed` blind spots,
the CLAUDE.md byte budget) was already closed — this session and earlier. What remains is
almost entirely binary-side or shipped-asset-side. Note `assets/hooks/**` SHIPS: `lore setup`
installs it into consumer projects, so a defect there reaches consumers too.

So "does it fire on a consumer's install" prunes nothing. A sharper filter is required.

## ⛔ The criterion is met, and that is not reassuring

D5 is satisfied: `guyin` closed 93 tasks with 115 evidence-carrying tasks and is writing today.
But "the consumers work" is itself measured THROUGH the layer Tier 1 below describes:

- `capture_source` is OPTIONAL at the evidence write boundary with a silent `?? "self-report"`
  default — a caller that never stated a source is recorded as if it had.
- A `-t` filter is a REGEX, so an AC title containing `(`, `)` or `+` matches ZERO tests and
  still exits 0 — green oracle, nothing executed.
- `lore evidence --capture` has a hard-coded 600s window; a legitimately-scoped oracle that
  exceeds it terminates in a self-report row.
- An ad-hoc task (the dominant task shape) can never reach the attestation path, so
  `lore done`'s attested-pass floor is INERT for it and `--override-attestation` is routine.

**Tier 1 is therefore not hardening. It is the confidence interval on the criterion itself** —
the false-oracle vector this corpus catalogues, appearing at the top level, on the very
measurement used to declare the product working. Nothing here says `guyin`'s 93 closures are
wrong; it says the corpus cannot currently distinguish "proven" from "asserted" for them.

# Tier 1 — the chain runs and silently produces wrong or unproven data (~14)

Fix these. They are the criterion's own evidence strength.

- `task-capture-source-is-optional-at-the-evidence-write-boundary` — the root of the four
  bullets above; make it required, delete the self-report fallback.
- `task-phaseworkflowservice-claim-captures-no-session-id-so-every` — CRITICAL, shipped:
  `noAnchorOverlap` reads a field only one of its two claim writers sets, so a same-actor phase
  overlap lands in an unsatisfiable fail-safe refusal.
- `task-a-t-filter-is-a-regex-so-this-repo-s-own-ac-titles` — measured live a THIRD time on
  2026-08-03 (a `-t "real repo tree + real corpus"` filter matched zero tests, exit 0).
- `task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a`
- `task-an-ad-hoc-task-can-never-reach-the-attestation-path-that` — arms BOTH the attested-pass
  floor and the red-first floor for the dominant task shape.
- `task-the-eleventh-plan-member-site-found-by-enumeration` — `lore bootstrap` under-reports a
  plan's tasks, and `bootstrap` is the session-start injection every consumer session reads.
- `task-the-tenth-plan-member-site-is-a-write-path-create-time`
- `task-active-sessions-derives-only-over-active-plans-` — with ad-hoc tasks dominant,
  `active_sessions` is empty, so consumers get no concurrency visibility before claiming.
- `task-a-mistyped-task-file-anchor-is-stored-and-consulted-exactly` — the anchor mutex is
  silently ineffective for a typo'd path.
- `task-corpus-workflow-injection-labels-lore-release-as-done` — a SHIPPED governance snippet
  tells every consumer that `release` means done; `lore done` appears nowhere in it, so tasks
  are never archived and readiness stays permanently inflated. This is the mechanism behind the
  13/13-agent incident, and it ships.
- `task-lore-gate-bypass-honored-by-lore-gate-subcommands-but` — bypass semantics differ
  between the CLI verb and the embedded service-layer gate.
- `task-lore-uat-record-doc-type` — a verdict written to a `knowledge`/`adr` doc succeeds
  silently and the plan-close gate never sees it.
- `task-evidence-ac-gate-only-validates-against-the-plan-s-direct` — legitimate AC refs from
  domain-overview specs are rejected.
- `task-lore-evidence-ac-accepts-an-ac-ref-on-an-ad-hoc-task-that`

# Tier 2 — only fires on a NEW consumer's onboarding (~8)

Neither `babyai` nor `guyin` can hit these again; they are already installed. Defer to a
"third consumer" or "external install" milestone, whichever the user names next.

`task-lore-init-does-not-seed-the-verification-profiles-config`,
`task-spec-create-gate-s-missing-rule-doc-remediation-points-to`,
`task-design-setup-must-be-a-brownfield-aware-completeness`,
`task-multi-root-corpus-incoherence`, the "never suppress lore's own output" governance-asset
item, `task-the-git-safety-gate-s-worktree-rule-matches-only-force`,
`task-the-resume-coverage-verb-accepts-a-reason-after-deferred`,
`task-mcp-lore-create-supersedes-still-creates-then-fails`.

# Tier 3 — out of scope under D5 (~13), written exemption

These do not affect either consumer's ability to complete the chain, and by ADR D2 none of
their families is above the guard-building threshold. ⛔ Per ADR D4 this exempts the
MECHANIZATION and the scheduling, NOT the defect: each task stays open with its record intact.
Nothing here is archived, waived, or downgraded in truth — only descheduled.

New mechanisms below D2's threshold: the AC-statement-drift detector, the fifth
(dispatch-time) gate, a gate arming the doc-code drift oracle.
Peripheral surfaces: the MCP evidence-refusal `cd` target, `lore set --decision-status`.
This-repo methodology and doc-sync: task-scoped oracles vs integration reachability, SPEC-050's
g1 help-guard rule, the IC startup-write contention spec, the AC-IC-1 sampling-budget harness,
`AC-ACQ-7` vacuity, the root-CLAUDE.md contract pointer pin.

# What this answers

"How much work is left" under D5: **0 blocking, ~14 must-fix, ~8 deferred to a next
consumer, ~13 descheduled.** By file-anchor mutex at 4-6 concurrent implementers, Tier 1 is
roughly 3-4 dispatch waves.

⛔ Re-derive these tiers, do not inherit them: the tiering is a judgment over each task's
content, and a task's content changes. The two mechanical inputs — the anchor classification
and the consumer measurements — are both reproducible from the commands named above.
