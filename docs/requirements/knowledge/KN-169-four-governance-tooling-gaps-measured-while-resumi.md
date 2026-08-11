---
id: KN-169
type: knowledge
role: knowledge
title: "Four governance-tooling gaps measured while resuming handoff-82: a silent pass, an undecomposable count, three unfeedable gates, and the eighth false-oracle vector"
status: approved
priority: medium
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PRD-001
---
# What this records

Four governance-tooling gaps measured while resuming handoff-82 on 2026-08-10. Each is logged
because an EXTRA ACTION was required to work around it — per the standing rule, the workaround
itself is the trigger, not a later audit. Two are already absorbed by specs created this
session; two are NOT covered anywhere and need a home.

# G1 (HALF-CLOSED by AC-FR-1 — mechanism only) — three of the four deterministic gates cannot be fed proactively

⛔ Measured 2026-08-10 AFTER AC-FR-1 landed: an unregistered name now exits 2 (fixed), but 7 of the 8 REGISTERED checkpoints still return `no approved governing skill` at exit 0 — the feeding-source documents do not exist. The mechanism is closed; the content half is open and unowned. See `knowledge-attestation-is-structurally-one-sided-lore-verify-can` §G17. ⛔ Do not record this gap as resolved.

⛔ Re-measured 2026-08-10 on the merged tree: the three unreachable checkpoints do not merely refuse — they print `unknown checkpoint: <name>` and EXIT 0, so `lore feed spec-promote && <next>` proceeds as if fed. AC-FR-1 requires BOTH the derived checkpoint set AND an exact exit 2 for an unregistered name; fixing only the coverage would leave every future unregistered name silently successful.

The workflow discipline says: *"主动 PULL，别等 gate 拒了才看"* — pull the feeding pack BEFORE
producing, never wait for a denial. Measured:

```
$ lore feed spec-promote
unknown checkpoint: spec-promote
```

`lore feed --help` accepts only `spec-create`, `session-resume`, `phase-start`, `task-start`.
The four deterministic gates are `spec-create` / `spec-promote` / `plan-promote` / `task-claim`.
So **three of four gates can only be read by being denied by them.** The prescribed discipline
is unreachable for 75% of the gates it governs.

**Reverse control**: `lore feed spec-create` returns a full, sourced, trust-labelled pack — so
the mechanism exists and works; only the checkpoint coverage is missing. This is not a design
limitation, it is an unfinished registration.

**Root**: the `feed` CLI's checkpoint set was never reconciled against
`checkpointRegistry`'s. Mechanization: derive `feed`'s accepted values FROM the registry rather
than maintaining a parallel list, so a newly registered checkpoint is feedable by construction.

# G2 (NOW COVERED by spec-falsifiability-reachability-…, AC-FR-5) — the corpus reports a violation COUNT but never the member list

`lore status --json` exposes `pass_unfalsified_count: 29`. Nothing in the CLI enumerates WHICH
29. `lore ac list` is per-spec only, so producing the member list required a throwaway script
iterating all 138 specs (`lore ac list <slug> --json` × 138, tallying `coverage[].state`).

This is not a convenience gap. The human decision this session was *"clear the backlog, then
arm the gate"* — and the tool that reports the backlog's size cannot say what is in it. A
number you cannot decompose is not actionable, and it is exactly the shape of defect that
produced the retracted `574/700` figure the governing spec had to correct: an aggregate nobody
could check member-by-member.

**Reverse control**: the 138-spec iteration reproduced `29` exactly, and also produced the full
distribution (`attested_pass` 590 / `fail_superseded` 58 / `none` 38 / `pass_unfalsified` 29 /
`pass` 5 / `fail` 4). So the data is all present in the store — only the projection is missing.

**Mechanization**: every corpus-wide count `lore status` reports needs a
`--list <bucket>` sibling. ⛔ A count with no enumeration invites exactly the precedence
conflation that produced the 20x-wrong figure.

# G3 (COVERED by spec-governance-visibility-…, AC-GV-1) — a passing gate is indistinguishable from an absent one

Promoting three specs with `lore set <spec> --status approved` printed **zero** gate output. The
only way to establish that `spec-promote` had in fact evaluated was to read
`corpus-service.ts:1979` in the source. A silent pass, a vacuous pass, and no gate at all render
identically at the surface.

This is the same failure that produced the FALSE diagnosis this session had to correct: two
independent records (handoff-82 NS3-a, and a ⛔-level rule in the root CLAUDE.md) both concluded
`lore set <plan> --status archived` "evaluates NO gate", when `corpus-service.ts:2029` shows it
does and has since `6d1b25f0` (2026-07-26). They were reading behaviour, and behaviour cannot
distinguish the three cases.

# G4 (COVERED by spec-oracle-executability-…) — the eighth false-oracle vector

A script-mode AC whose `verify.command` names a path that never existed records a permanent
`fail`. `git log --diff-filter=DR --all` returns nothing for `AC-061-7`'s and `AC-062-3/5`'s
declared paths: mistyped at authoring, never once measuring what they claimed.

⛔ The sharpest part is that the OBVIOUS fix is a measured no-op — see the spec's §M6.1. All
three runners' discovery refusals carry no summary line, so `parseExecutedUnits` returns `null`
and `judgeCompleteness` answers `unknown_runner`, never `zero_match`. Two independent routes
confirmed this (direct read of the pattern constants plus captured runner output; and an
independent extension review). ⛔ Anyone "fixing" this by relaxing the `executedSuccessfully`
gate alone will ship a change that measures nothing and reports success.

# G5 (NOW COVERED by spec-falsifiability-reachability-…, AC-FR-6/AC-FR-7) — the exported spec mirror has silently drifted 29%

The root CLAUDE.md tells readers: *"exported mirrors live under `docs/requirements/spec/`"*.
Measured 2026-08-10:

- `docs/requirements/spec/` — **100** files
- corpus — **141** specs (`lore list --type spec`)

So **41 specs (29%) are absent from the mirror**, and root `package.json` has **no export script**
at all, so nothing regenerates it. The three specs created this session are likewise unmirrored —
which is consistent with the status quo, not a regression this session introduced.

**Why this is a real defect and not housekeeping**: CLAUDE.md names the mirror as a place to read
specs. A reader who trusts that sentence and finds nothing concludes the spec does not exist —
absence in a directory advertised as a mirror is a POSITIVE (and false) signal. This is the same
shape as the other four gaps: an outcome the tool renders identically whether it is complete or not.

**Reverse control**: `lore get <slug>` returns all 141, so the corpus side is intact; only the
projection is stale. And the drift is not uniform — it is unclear which 100 were exported or when,
because nothing records the export's provenance.

**Mechanization options**: (a) drop the sentence from CLAUDE.md and let the corpus be the sole
index, deleting the mirror; (b) make export a pre-push check so mirror ≠ corpus fails loud.
⛔ What must NOT happen is the current middle state, where a partial mirror is advertised as
authoritative. A `lore export-docs` command exists (`adapters/cli/commands/export-docs.ts`), so
option (b) is a wiring task, not new capability — which makes it the same
"capability implemented ≠ wired into production" pattern this session hit four other times.

## Amended standing lesson

A gate that passes silently, a count without its member list, a checkpoint that cannot be fed, and
a mirror advertised as complete while 29% is missing are the same defect wearing four costumes:
**an outcome the tool renders identically whether or not it is sound.**

# A self-demonstration worth keeping

⛔ While writing the task that declares this very defect, the author mistyped a `--anchor` path
(`packagesity/placeholder-unused`) and caught it only by running `test -f` on it before
dispatch. The defect being specified reproduced itself inside the act of specifying it. Nothing
about this class of error requires carelessness — it requires only that no mechanism checks the
path, which is precisely what the spec adds.

# Standing lesson (one line, for CLAUDE.md scope only)

A gate that passes silently, a count without its member list, and a checkpoint that cannot be
fed are the same defect wearing three costumes: **an outcome the tool will not let you
decompose**.
