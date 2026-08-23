---
id: KN-505
type: knowledge
role: knowledge
title: "lore evidence --capture now clears the attested floor, and AC-CT-2 asserts a corpus-wide property that is false by 440 rows"
status: approved
priority: critical
created: 2026-08-23
updated: 2026-08-23
tags: [attestation, capture-source, lore-done-floor, ac-ct-2, anchor-gap, spec-143]
parent: PRD-001
links:
  - {id: ADR-027, type: informs}
  - {id: SPEC-143, type: informs}
  - {id: KN-507, type: relates-to}
---
Measured 2026-08-23 by `agent:ct-t1-green-attest` and independently re-measured by `agent:main-orchestrator` while landing SPEC-143 AC-CT-2's GREEN stage (`task-skill-test-evidence-capture-attestation-red-test-scenarios`, merged into main). The first finding CHANGES A GATE'S BEHAVIOUR and invalidates a standing rule, so it is written first.

## 1. `lore evidence --capture` now clears the attested floor — the standing "`--capture` ≠ attested" rule is FALSE as of this commit

`hasAttestedPass` is `result === "pass" && attestation !== undefined`. Before this change a `--capture` row carried the `runner` label and NO attestation block, so only `lore verify` could clear the floor. The change makes the capture path write the attestation it already measured, so a `lore evidence --capture --result pass` row now clears it too.

**This is SPEC-143 C5's stated intent, not a weakening slipped past review.** C5's own "Upstream effect" clause says `deriveAcCoverageState`'s `attested_pass` / `fail_superseded` branches "are starved today precisely because captures never attest". Feeding them was the point.

**Why the implementation is not a renamed bypass** — worth recording, because "a public write path may now reach `attestation`" is exactly the shape a bypass would take:

- The excluded key is still excluded: `attestation` remains refused on `addEvidence`, including a runtime check against the raw input object so an `as EvidenceInput` cast cannot smuggle it.
- The new channel is a DISTINCT key, `capture_attestation`, whose only producer is `adapters/evidence-capture.ts::captureOracleCommand` — the code that actually spawned the command in this process.
- The label and the measurement are returned INSEPARABLY as one `CapturedProvenance` object that both adapters splat whole, so a caller cannot keep the `runner` label and drop the numbers. Field types derive from `EvidenceInput` on purpose: TypeScript exempts spread properties from excess-property checking, so a rename would otherwise silently drop the attestation with no error anywhere.
- `appendEvidenceEntry` already forces `capture_source: "runner"` for any row carrying an attestation, so the incoherent pair (self-report label + measured attestation) is UNREPRESENTABLE rather than merely refused.
- Promotion happens in ONE function called by both `TaskWorkflowService` and `PhaseWorkflowService`, not a check-then-copy pair either caller could half-run.

**What still differs from `lore verify`**, and why the old rule was not simply wrong: a `--capture` attestation carries `exit_code`, `duration_ms`, `timed_out`, `runner`. A `lore verify` attestation additionally carries `completeness`, `executed_files`, `execution_root`, `execution_mode`. So the honest new statement is NOT "`--capture` is now equivalent to verify" but "`--capture` now attests with a narrower field set, and the floor does not currently distinguish the two". **Whether the floor OUGHT to require the verify-only fields is an open governance question this commit does not answer.**

Documents now standing on the old premise:

- `~/.claude/CLAUDE.md`'s standing line "⛔ `lore evidence --capture` ≠ attested … attested 只来自 `lore verify`" — FALSE for rows written after this commit, still TRUE for the 440 legacy rows in §2.
- `adr-lore-done-requires-a-runner-attested-pass-the-sixth-false` (approved v2, accepted, live) — its core holds; what changed is WHICH paths can produce a runner-attested pass.
- A code comment asserting a self-report is "the ONLY shape any CLI/MCP `lore evidence` write can produce" became an expired assertion; the implementer corrected it in the same commit, which is the "fix the gap and update the note recording it in one acceptance unit" rule working as intended.

## 2. AC-CT-2's prose asserts a corpus-wide property that is FALSE and unreachable, while its oracle only tests newly-written rows

AC-CT-2 reads: "Zero evidence rows may carry `capture_source` runner without an attestation block."

Read-only census of this repo's live corpus (`file:.lore/lore.db?mode=ro`), run by the main agent independently of the implementer's identical count:

| shape | rows |
|---|---|
| total evidence rows | 4570 |
| `runner` WITHOUT attestation | **440** ← the AC says ZERO |
| `runner` WITH attestation | 252 |
| self-report | 273 |
| `capture_source` absent | 3605 |

Those 440 are pre-fix `--capture` rows. They cannot retroactively grow a measurement — nothing observed those spawns. The declared oracle runs against a throwaway corpus and proves the property for NEW rows only, so an ATTESTED pass on AC-CT-2 certifies a corpus-wide claim that is false by 440 rows and always will be.

This is the standing "an AC proves only the point it explicitly asserts" failure, with the gap owned by the AC's author rather than its implementer — the implementer narrowed its own guarantee honestly in the JSDoc ("no PRODUCTION CAPTURE PATH can mint one") while the criterion's prose stayed absolute.

**The fix is spec-level and SPEC-143 already invented the right shape for it once**: the stamp axis classifies pre-arming rows `legacy_unbound` and accepts them, precisely so arming retro-fails nothing. AC-CT-2 needs the same treatment — a distinct legacy class or a census field — so those 440 rows are COUNTED rather than either invisible or falsely asserted away. ⛔ Deliberately NOT edited during this wave: `lore ac set` demotes SPEC-143 to `draft` and would hard-block the concurrent T2 agent's claim.

## 3. A "write-through fix" needed four files outside its declared anchors

The task declared two anchors (the adapter + its test). Landing it touched six files: `evidence-capture.ts`, `task-workflow-service.ts`, `phase-workflow-service.ts`, `cli/commands/evidence.ts`, `mcp/tools.ts`, and one existing test's accessors. A pure capture function cannot persist anything, so the persistence path was always going to be involved.

The implementer checked every task in plan A first and confirmed none anchors those four paths, and deliberately avoided `packages/core/src/task-workflow.ts` (held by the concurrent T0 agent) and `verify-runner-service.ts` (a pending task's anchor). That diligence is the only thing that prevented a collision: **the anchor-overlap gate cannot see undeclared paths**, so two agents both reaching into an unanchored wiring file would both be admitted.

This is the capability-vs-wiring anchor gap in its exact documented form — the anchor set covered the capability and not the wiring — recurring after being recorded, which is evidence the prose layer is the wrong layer for it.

## 4. SPEC-143's own Scope table now contains a false row

Row: "`packages/lore/src/service/task-workflow-service.ts` | **NOT modified**: its `capture_source` read is the tail-guard exemption AC-CT-10 allowlists by SHAPE (zero accumulation targets)". The diff falsifies "NOT modified". The implementer kept the new logic free of any `capture_source === "runner"` comparison, so the future AC-CT-10 site scan should still need no new allowlist entry — but the row's factual claim is wrong and needs correcting. Same deferral reason as §2: correcting it demotes the spec mid-wave.

## 5. The worktree isolation Bash guard refuses compound commands, forcing every edit through a different tool

`$(pwd)`, `for` loops, command substitution and most heredocs were all refused inside the worktree, so `lore claim` needed a literal path and every file edit went through Write plus `python3 <script>`. Not a lore defect, but it means a dispatch bundle containing shell one-liners (this one contained `--worktree "$(pwd)"`) hands the agent instructions it cannot execute as written. Bundles should give literal paths.

## 6. `bun run test:changed` degenerated to the full suite AGAIN, independently

At this task's merge-base it selected 243 vitest + 173 bun = 416 files, 164 tagged `binary-consumer`. This is the second independent observation in one wave (the other: 623 files on a `packages/core/src/task-workflow.ts` edit). The dispatch bundle instructs the agent to run `test:changed` AND forbids the full suite, which is self-contradictory for any `src/`-touching task. Both agents substituted a computed direct-consumer set and said so rather than silently choosing one horn.


## ADDENDUM — `lore done`'s own refusal text names the distinction this doc under-stated

Measured after all three merges, archiving the T0 task. `lore done` refused it (exit 4) with wording that is the sharpest available statement of what `--capture` does and does not prove:

> ⛔ `attestation` is a DIFFERENT field from `capture_source` … `--capture` proves the exit code of a command the **CALLER supplied** (and a caller can supply one that necessarily exits 0), while `attestation` proves that command's **PROVENANCE** — `lore verify` derives the command from declared scope instead of accepting it.

§1 above recorded that the floor "does not currently distinguish the two" and called that an open question. The refusal text shows the question is sharper than that: **the two attestations answer different questions.** A `lore verify` attestation says *the command I ran is the one the spec declares*. A `--capture` attestation says only *the command I was handed exited 0* — and `true`, `echo ok`, or a `-t`-filtered subset all satisfy it.

So after this wave, a caller who supplies a necessarily-succeeding command gets `capture_source: "runner"` PLUS a measured attestation PLUS a cleared `hasAttestedPass` floor. Nothing in the floor asks where the command came from. That is a REAL widening of what clears the archival gate, and it is wider than §1's "narrower field set" framing implies — the missing fields (`completeness`, `executed_files`, `execution_root`, `execution_mode`) are not decoration, they are the evidence that a declared scope was executed.

⛔ This is NOT an argument that the C5 change should be reverted: C5's stated purpose was to stop the false `runner`-without-attestation label, and it does that. It is an argument that `hasAttestedPass` is now the wrong predicate — it should require provenance, not merely presence. The mechanism that would close it: have the floor demand the verify-only fields (or an explicit provenance discriminator on the attestation), so a caller-supplied command cannot satisfy an archival gate no matter how honestly its exit code was measured.

Recorded as the wave's most consequential open item. It was found by READING A GATE'S REFUSAL TEXT rather than by review — the refusal explained its own field better than either the spec or this doc's first draft did.
