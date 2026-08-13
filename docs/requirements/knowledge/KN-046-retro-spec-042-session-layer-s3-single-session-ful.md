---
id: KN-046
type: knowledge
role: knowledge
title: "Retro — SPEC-042 session layer S3 (single-session full cycle: 3-lens review + dual worktree + UAT parity catch)"
status: approved
priority: medium
created: 2026-07-11
updated: 2026-07-14
tags: [retro, spec-042, session, instrument]
parent: PLAN-026
---
## Context

Session 2026-07-11 (single-session full cycle under owner "one-shot" authorization): SPEC-042
(session layer S3 — session registry + file-anchor claim safety) drafted, 3-lens adversarially
reviewed, implemented via two serial worktree agents + one SendMessage fix loop, verified
(11/11 script ACs attested), live-UAT'd (AC-S3-12), assessed (v6: outcome 90 / evidence 85 /
scope 90). Cycle opened by the AC-SL-8 fresh-session test, which PASSED — the SPEC-041
bootstrap+resume pair fully re-briefed this session with zero human input, then SPEC-041's
plan was archived.

## What shipped
- Derived session registry: `deriveSessions` groups FRESH claims by (by, machine, worktree);
  `lore ready` sessions[]/anchor_conflicts[]/anchorless advisory; `lore bootstrap`
  active_sessions; tree badge @branch.
- Typed `task.extra.file_anchors` (normalizeFileAnchors/anchorsOverlap, (segments,isDir)
  model) via `create --anchor` + `lore anchor add/rm/list` (TaskWorkflowService
  read-modify-write — never CorpusService.set wholesale-extra).
- `noAnchorOverlap` predicate at task-claim, UNCONDITIONAL (not gated by hasSpecParent
  short-circuit), field discriminator `gate:task-claim:anchor-overlap`, feeding pack with
  literal recovery command; D6 sub-key `workflow.gates.task-claim.anchor_overlap.enabled`;
  claim carry-forward refresh + machine (auto hostname) / worktree (explicit-only) capture;
  MCP `lore_anchor_set` (28 tools); D10 actor-identity dispatch discipline in CLAUDE.md.

## Learnings (durable)
1. **Live UAT catches what green suites don't.** Both implementers' oracles were fully green,
   yet the first real dual-actor UAT exposed `lore gate task-claim` pre-flight saying "pass"
   while the enforcer blocked the same claim — gate.ts never called T1's
   buildAnchorGateContext. Suites test the layers they were written against; only an
   end-to-end pass through EVERY user-facing surface of a new predicate proves parity.
   (Fixed via SendMessage retry loop, +8 regression tests: gate-p2-cross-tier 5, D6 sub-key
   disable 3 — the assess judge's "add a parity regression test" recommendation was already
   satisfied pre-assess; its diff view was truncated.)
2. **3-lens adversarial review again outperformed the approve-judge** (0.78 approve): 6
   HIGH-class design faults found pre-implementation (identity-collapse topology dead-code,
   cwd auto-capture dishonesty, hasSpecParent short-circuit swallowing the new predicate —
   found independently by two lenses, wholesale-extra clobber via lore set, claim-refresh
   full-rebuild fragmenting sessions, missing now() seam). Every one would have shipped
   broken or destructive. Reviewer count × lens diversity, not judge confidence.
3. **AC statements are contracts, corrected with evidence BEFORE verify** (SPEC-041 learning
   re-applied): AC-S3-7's "exit 2" and stderr-feeding-pack claims contradicted the
   implemented (better) layering — corrected with rationale pre-verify, spec stayed approved.
4. **Spawn-heavy integration tests need explicit budgets.** Under load-44 (foreign Chrome
   processes × 4 cores) vitest's 5s default made spawn-9-subprocess tests rotating-timeout
   victims across DIFFERENT files each run; each passed in isolation. One targeted 15s
   budget on the heaviest (AC-VRF-10.N1) + constrained-worker rerun policy; full-suite green
   runs exist at 11:55 and in both worktrees on identical vitest-visible code. Root cause is
   environment, but the margin (tests at 90%+ of budget) is test-infra debt worth a sweep.
5. **MCP tool-count arithmetic in spec text drifted (26→27 stated, 27→28 actual)** — the
   baseline count in D9 was stale by one at draft time. Counts belong to oracles
   (mcp-tools.test.ts pins it), not prose; spec prose should reference, not restate.

## Open items
- v6 assess process recommendation: human-mode ACs (AC-S3-12 class) should be executed by an
  independent party (owner/CI), not self-recorded by the orchestrating agent — adopt for S4+.
- §16 memory hygiene specs (H1 bi-temporal, H2 staleness probes, H3 drift oracle) — next in
  the PRD sequence.
- Test-infra: sweep integration suites sitting at >80% of the 5s default budget.
