---
id: KN-468
type: knowledge
role: knowledge
title: "The nine UNENFORCED standing lessons, evicted from CLAUDE.md with the mechanism each one still needs"
status: draft
priority: medium
created: 2026-08-17
updated: 2026-08-17
tags: []
parent: PRD-001
---
Nine standing lessons were evicted from the root CLAUDE.md on 2026-08-17, not because they
stopped being true, but because **each one is enforced by nothing**. They were classified by a
single question: *what would refuse this if it were violated?* When the answer is "an agent is
supposed to remember", the lesson is not a rule — it is an unfilled work item wearing a rule's
clothes, and leaving it in CLAUDE.md makes the file look like it is protecting something it is
not.

⛔ These remain NORMATIVE. Evicting a lesson does not repeal it. What changed is where it lives:
CLAUDE.md now carries decision-time criteria, and this ledger carries the enforcement backlog.

## Why this classification is load-bearing

Measured 2026-08-17, in the session that wrote this doc: the orchestrator put a **bold, explicit
prohibition** in a dispatch bundle ("never write this repo's live corpus"), and then violated it
itself, in the same turn, while that implementer was still running — reddening 9 of its tests and
causing it to misattribute the cause. Same agent, same turn, wrote the rule and broke it.

That is the whole argument. A rule that exists only as prose produces **zero** resistance at the
moment an agent's attention is elsewhere. Humans are backstopped by muscle memory and
embarrassment; an agent has neither. So the count below — 9 — is not a documentation statistic.
It is the number of known failure modes this system is currently defenceless against, and it is
the most honest available answer to "how far is this from running unattended".

## The nine, with the mechanism each one needs

### 1. The global `lore` is a symlink into the main checkout's `dist/`
⛔ Never rebuild while an agent runs; merging ≠ releasing.
**Needs**: a rebuild command that refuses while any live session is detected. Blocked on #9 —
the occupancy signal does not exist yet.
Source: `knowledge-the-global-lore-is-a-symlink-into-the-main-checkout-s`

### 2. A backgrounded oracle's completion notice reports the SHELL's exit code
Persist `$?` and read it back; a ceiling kill reports 143.
**Needs**: the runner captures and surfaces the real exit code itself, so no discipline is
required of the caller.
Source: `knowledge-a-backgrounded-command-s-completion-notice-reports`

### 3. `lore list` silently drops invalidated docs behind a self-consistent total
1475 vs 1495 under `--include-invalid`; per-type sums agree with the filtered total, so every
internal check passes. A census built on the default read 21 orphans against a true 1.
**Needs**: any filtered listing must emit the filtered-out count in the same payload. A census
that cannot see what it excluded is unsound by construction, not by misuse.
Source: `knowledge-eleven-findings-from-resuming-handoff-102-with-three`

### 4. An armed threshold is calibrated against ITS base
A concurrent peer merge invalidates it, so every armed gate must be re-run on the merged tree.
**Needs**: thresholds record the commit they were calibrated at; the gate refuses (or re-derives)
when HEAD is no longer that commit. This is the same "verdict must carry the state it describes"
invariant as #8, and `ASSESSMENT_STALE` is the working prior art.
Source: `knowledge-a-newly-armed-threshold-is-calibrated-against-the`

### 5. An EMPTY output artifact has the same shape as a clean one
Assert a positive trace of execution; never put a `cd` in front of a measurement (zoxide shims it
and `&&` then short-circuits silently). Seventh false-oracle vector.
**Needs**: `lore verify` refuses a pass whose captured output contains no runner summary line —
the check exists as prose in the evidence rules but nothing enforces it at write time.
Source: `knowledge-three-of-lore-s-own-outputs-misled-this-session-a`

### 6. `lore verify <plan>` with no `--ac`/`--task` runs EVERY declared script-mode AC
It mints fresh `fail` rows for criteria whose implementation has not landed yet.
**Needs**: refuse an unfiltered `verify` on a plan with any non-archived task, or mark rows minted
against unimplemented ACs as inapplicable rather than `fail`.
Source: `knowledge-four-governance-tooling-gaps-measured-while-resuming`

### 7. The anchor mutex is PLAN-SCOPED, and so is `lore ready`'s `anchor_conflicts`
A cross-plan collision is invisible to BOTH the gate and the pre-dispatch check, so
`anchor_conflicts: []` with more than one active plan is NOT evidence of safety.
**Needs**: corpus-global anchor intersection. Fix the gate and the report together, asserted by one
oracle spanning two plans — either half alone looks complete. Measured again 2026-08-17: the
orchestrator had to compare anchors against a peer plan BY HAND.
Source: `knowledge-five-findings-from-planning-the-bootstrap-fixpoint`

### 8. After ANY corpus write, converge the mirror
`bun run mirror:export` repairs status/frontmatter unconditionally; BODY drift needs
`lore export-docs --force`; `--check` catches a MISSING file, never a wrong one.
**Needs**: a pre-push mirror-convergence check. Verified 2026-08-17 — `hooks/pre-push` runs five
checks (`--check-binary-provenance`, `--check-tree --check-drift`, `audit --verify`,
`--check-prd-budget`, `--check-claude-md`) and **not one of them looks at mirror convergence**.
Cost of its absence, same day: `lore done` ran before the mirror converged, AC-OX-6 went red for
61 seconds, and that red is now permanently rendered as `[✘]` on a closed spec (see
`knowledge-the-ac-coverage-badge-ignores-fail-superseded-so-a`).
Source: `knowledge-eleven-findings-from-resuming-handoff-102-with-three`

### 9. `active_sessions` measures CLAIM LEASES, not machine occupancy
A session that runs the suite, exports the mirror, or rebuilds the binary without claiming a task
produces no row. Measured empty while the main checkout was 15 minutes into `bun run test` and had
rewritten `dist/lore` 19 seconds earlier.
**Needs**: feed `oracle-lock.ts`'s occupancy truth into the session projection. It already knows.
Source: `knowledge-five-governance-gaps-measured-while-landing-the`

## One lesson was evicted for the opposite reason

The `plan-close` note ("`lore set <plan> --status archived` DOES evaluate the gate") was dropped
because it IS enforced — `corpus-service.ts::isPlanClosing` runs the predicates, and on 2026-08-17
that gate refused a real close with `ASSESSMENT_STALE` and was correct to. A prose copy of a rule
the machine already enforces adds bytes and adds a second thing to keep in sync. The gate is the
SSOT; read it with `lore gate plan-close --explain`.
