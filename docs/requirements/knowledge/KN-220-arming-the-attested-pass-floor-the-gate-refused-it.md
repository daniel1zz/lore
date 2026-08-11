---
id: KN-220
type: knowledge
role: knowledge
title: "Arming the attested-pass floor: the gate refused its own task, and the retroactive count was 2 not 3"
status: approved
priority: high
created: 2026-08-01
updated: 2026-08-01
tags: []
parent: PRD-001
links:
  - {id: ADR-027, type: relates-to}
---
Discharges AC-5 of `task-lore-done-accepts-an-unattested-self-reported-pass-as` (the written
retroactive exemption the ADR calls the only honest disposition) and records two verification
shapes this arming produced that are worth reusing.

## The retroactive sweep, measured AFTER the gate armed

Counted on the live corpus at merge `2e0f06c`, from `lore list --type task --json`, over the 32
open (non-archived) tasks:

| Bucket | Count | Blocked by |
|---|---|---|
| `result:"pass"` present, `attestation` absent | **2** | the NEW attested-pass floor |
| zero evidence rows | 30 | the PRE-EXISTING no-passing-evidence floor (unchanged) |

The two:

- `task-ac-ic-1-harness-runs-out-of-sampling-budget-under-load` (adhoc, draft, 4 evidence rows)
- `task-lore-setup-de-hook-ji-que-yi-tiao-zhuang-tai-zhuan-huan` (adhoc, draft, 1 evidence row)

**EXEMPTION**: both are hereby exempt from the attested-pass floor at close time, dischargeable via
the audited `lore done --override-attestation "<reason>"` hatch. Grounds: both are `--adhoc` — no
plan, therefore no script-mode AC for `lore verify` to bind an attestation to. This is structural,
not a shortcut: attestation is runner-issued only (`EvidenceInput` structurally `Omit`s it and
`_addEvidenceImpl` rejects the key's mere presence), so no public path can back-fill it. Per the ADR
we do NOT synthesize attestation and do NOT weaken the predicate to accommodate the back-catalog.
Each owner supplies its own reason at close time; this exemption authorizes the hatch, it does not
pre-write anyone's justification.

## The implementer's count was 3, the real count is 2 — snapshots drift

The implementing agent reported 3 blocked tasks. By the time the orchestrator merged and re-counted,
one of them (`task-test-changed-s-fourth-invisible-edge-a-tree-scanning`) had already been archived
in the same session. Neither number was wrong when taken; a retroactive-impact count is
shared mutable state and MUST be re-measured in the turn it is asserted, never carried forward from
the implementer's report — which is exactly the discipline this repo already requires for claims and
readiness, applied to a new surface.

## Two verification shapes worth reusing

**1. The gate that refuses its own task is the strongest liveness proof available.** This task's own
evidence rows were all self-reported (`lore evidence`), so once merged and rebuilt, `lore done` on
the very task that implemented the floor was refused exit 4 with the repair named. No constructed
fixture can match that: the artifact under test rejected the act of shipping itself. Generalizable
rule — when arming a gate, check FIRST whether the closing move for the arming work is itself
gated; if it is, that is the control run, and taking the escape hatch afterwards proves the hatch
too. Both directions were then measured: a whitespace-only reason → exit 2.

**2. `~/.local/bin/lore` is a symlink to this repo's `dist/lore`.** So `bun run build` does not merely
refresh a local artifact — it arms the new predicate for EVERY concurrent session on the machine at
that instant. Corollary with teeth: skipping the rebuild would have let the orchestrator archive the
task under the OLD binary, producing a green close that the shipped code forbids. Rebuild BEFORE
closing anything the change gates, precisely so the gate applies to its own author.

## The audit side effect was asserted, not inferred

The hatch's exit 0 proves nothing on its own (this repo's measured fifth false-oracle face: a flag an
oracle passes but never proves took effect). `lore audit --json` was read afterwards: 3 rows for the
one archival (one per `approved → active → archived` step), each carrying
`details.attestation_overridden: true` plus the reason verbatim.

## Standing structural finding — the CLAUDE.md layer is at capacity

Landing this slice's doc-sync took three separate byte-budget negotiations. Ending state: root
CLAUDE.md 24544/24576 bytes (32 free) and 206/220 lines — already OVER the contract's advisory
200-line target; `packages/lore/src/service/CLAUDE.md` 16342/16384 (42 free). Space was found twice
by moving event narrative into the corpus doc that already held it, and once by rewriting a section
as a pointer to a module header. Both moves are correct per the content contract, but the supply of
such candidates is finite. The next slice that needs CLAUDE.md space should relocate a whole standing
lesson into the corpus and leave a pointer — NOT raise the ceiling numbers, which would be a
symptom-level fix to an authoring-discipline problem.
