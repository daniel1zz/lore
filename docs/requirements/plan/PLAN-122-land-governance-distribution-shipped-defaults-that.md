---
id: PLAN-122
type: plan
role: plan
title: "Land governance distribution: shipped defaults that actually ship, one remedy for an unconfigured upstream, and a gap namespace that resolves"
status: draft
priority: high
created: 2026-08-11
updated: 2026-08-11
tags: []
parent: SPEC-138
phases:
  - {name: "defaults", description: "AC-GD-1: raise the two code defaults and build the shipped-default drift checker (absence-only predicate)"}
  - {name: "remedy", description: "AC-GD-2: one shared unconfigured-upstream builder, disclosure of the git-tracked write, and the feedback stanza landed so --list exits 0 on main. AFTER defaults"}
  - {name: "namespace", description: "AC-GD-3: gap-namespace checker plus the unowned-gap report. Concurrent with defaults"}
---
# Goal

Land the three ACs (AC-GD-1 … AC-GD-3) of
`spec-governance-defaults-must-ship-and-every-recorded-gap-must`. Each exists because a governance
surface works in this repo and nowhere else.

⛔ **Label convention, adopted because this plan's own subject is a namespace collision:** phases are
named (`defaults`, `remedy`, `namespace`), never numbered. A bare `D<n>` in this document ALWAYS means a
decision in the parent spec and is always written as "spec D<n>". An earlier draft numbered its phases
`Dispatch 1…3` and a reader could not tell `D2` (spec decision) from `Dispatch 2` (phase) — exactly the
defect this plan exists to fix, reproduced in the plan describing it.

## Phases

All three phases are CONCURRENT. No anchor intersects, and — see the note under `remedy` — there is no
sequencing dependency between them either. Each runs in its own linked worktree.

**`defaults` (AC-GD-1) — spec D1 + spec D2.** Raise the two code defaults to the values this repo proved
it needs (`capture_timeout_ms` → `1_200_000`, `max_diff_chars` → `80_000`) and build the shipped-default
drift checker. The checker's predicate is ABSENCE only: a repo override that merely DUPLICATES a shipped
value is redundant but harmless, and failing on that would force churn every time a default catches up.

⛔ The checker MUST ship with an explicit `PROJECT_SPECIFIC_KEYS` allowlist, authored in THIS phase even
though one of its entries belongs to a key `remedy` adds. `project.name`, `project.author`,
`audit.verify_since` and `feedback.upstream` are inherently per-project and can never appear in a shipped
surface — without the allowlist the checker flags `project.name` immediately, and it would turn `main` red
the moment `remedy`'s `feedback:` stanza merges. This is a shared constant `defaults` authors, ⛔ NOT a
sequencing dependency: `defaults` may merge before, after, or concurrently with `remedy` provided the
allowlist anticipates the key. Every entry carries a one-line rationale and the checker FAILS on an entry
without one, so the allowlist cannot become the place overrides go to hide.

⛔ This phase does NOT touch `.lore/config.yaml`. Its third AC clause — that a fresh-install
materialisation reports `1200000` / `80000` — must be satisfied by reading the SHIPPED surface (code
defaults + `assets/project/lore-config-template.yaml`) **explicitly**, never the effective merged config.
That is a test-authoring requirement, not a reason to delete anything: a test that reads the effective
config would pass while proving nothing.

**`remedy` (AC-GD-2) — spec D3.** Collapse the two divergent unconfigured-upstream messages into one
shared builder (asserted by builder IDENTITY, not two string literals that match today), disclose in that
text that the remedy writes the git-tracked team-shared `.lore/config.yaml`, and land the `feedback:`
stanza in this repo so `lore report-issue --list` exits 0 on `main` instead of the measured exit 4.

⛔ **This phase's `.lore/config.yaml` edit is ADDITIVE ONLY** — read the current contents back, add the
`feedback:` key, change nothing else. That matches spec D3 verbatim. An earlier draft of this plan also
assigned it the deletion of the now-redundant `capture_timeout_ms` / `max_diff_chars` overrides, which
contradicted spec D3 and manufactured a false dependency on `defaults`. Those deletions are
orchestrator-owned (below) and are pure cleanliness — spec D1's absence-only predicate does not require
them.

**`namespace` (AC-GD-3) — spec D4 + spec D5.** The gap-namespace checker (`G<n>` in the ledger → exit
exactly 3 naming the entry; `GAP-<n>` → 0) plus the unowned-gap report (prints open gaps with no
`owning_spec`, exits 0 — a REPORT deliberately, ⛔ not a gate).

⛔ **Both deliverables must be driven from INJECTED fixture content, and that is a hard requirement, not
a convenience.** The ledger's `GAP-<n>` rename and its structured `id`/`status`/`owning_spec` fields are
orchestrator-owned corpus edits (below), so a checker asserted only against the LIVE ledger would be red
until those land — which is why the concurrency claim holds for fixtures and would not hold for the live
doc. A live-tree clause may be asserted only after the orchestrator's rename is in; the orchestrator runs
that clause during verification.

## Orchestrator-owned — outside every phase

1. The gap-ledger edits in `knowledge-attestation-is-structurally-one-sided-lore-verify-can`: the
   `G<n>` → `GAP-<n>` rename, the structured `id`/`status`/`owning_spec` fields, and correcting `GAP-19`'s
   scope line (it names a branch that does not exist while the defect is on `main`). A shared knowledge
   doc is not rewritten from a worktree. ⛔ The rename MUST leave the old tokens findable — cite both
   forms once at the ledger head — or every existing `G<n>` reference in this session's own handoffs and
   retros silently dangles.
2. Marking `GAP-11` closed with this spec as its `owning_spec`. ⛔ Ordering: only AFTER `defaults` merges,
   because spec D2's default raise IS the fix that closes it. Marking it closed before that would be a
   claim with no landed mechanism.
3. Removing the now-redundant `capture_timeout_ms` / `max_diff_chars` overrides from
   `.lore/config.yaml`, after `defaults` merges. Pure cleanliness; no AC depends on it.

## Sequencing Risks

- **⛔ `.lore/config.yaml` is shared team state in a shared checkout.** Read its current contents back
  before writing and add only the keys named; a whole-field replacement silently discards what another
  session appended. `remedy` is the ONLY phase that may touch it, and only additively.
- **Spec D2 raises two defaults every consumer inherits on upgrade.** A larger capture timeout is a
  ceiling and costs nothing extra; a larger `max_diff_chars` DOES cost tokens on every assess. The comment
  beside each value must state that trade-off, so the next reader can revisit it with the reason in hand
  rather than re-deriving it.
- **The `defaults` checker will flag pre-existing overrides beyond the two named.** Enumerate what it
  finds and fix or record each in the same slice — a newly armed check that invalidates the back-catalogue
  without a stated disposition has already cost this repo a round.
- **AC-GD-2's provisioning test must use a throwaway corpus.** Only its final `--list` exit-code clause
  reads this repo, and that path is read-only.
- **`bun run typecheck` exits 2 for ANY compile error under `--noEmit`** (measured against this repo's
  `node_modules/.bin/tsc` 5.9.3; the "nothing was checked" `TS18003` also exits 2). Discriminate by the
  ERROR CODE in the output, never by the exit code, and ⛔ never by "nonzero".

## Out of Scope

Fixing the gaps themselves, except `GAP-11`, which spec D2's default raise closes. `GAP-7`, `GAP-8`,
`GAP-15`, `GAP-16`, `GAP-18` and `GAP-19` are made referenceable and visibly unowned; each still needs its
own spec. Also out of scope: the deferred `attestationFloor` falsifier clause
(`spec-judgment-surfaces-must-verify-before-they-certify-machine` `## Deferred`), and SPEC-072's
rate-limiting / identity-pin / version-skew rails, which are live and untouched.
