---
id: PLAN-026
type: plan
role: plan
title: "SPEC-042 Implementation — session registry + file-anchor claim safety"
status: archived
priority: high
created: 2026-07-11
updated: 2026-07-11
tags: [spec-042, session, implementation]
parent: SPEC-042
---
# PLAN — SPEC-042 implementation: session registry + file-anchor claim safety

Two serial worktree tasks (T2 depends on T1's core/service APIs; SPEC-041 dual-worktree
precedent). All 11 script ACs runner-attested via `lore verify` post-merge; AC-S3-12 is a
live dual-session script executed against a throwaway corpus at closeout.

## T1 — core + services
`@lore/core`: new `file-anchors.ts` (normalizeFileAnchors + anchorsOverlap, D3/D4 pinned
model), `task-workflow.ts` (taskClaimSchema + machine/worktree, carry-forward claim build),
`session.ts` (sessions projection pure fn + schemas, bootstrapReportSchema.active_sessions),
config (`workflow.gates.task-claim.anchor_overlap.enabled`). Services: checkpoint-registry
(unconditional noAnchorOverlap + restructured checkTaskClaim + claim-ctx builder +
anchor-overlap feed w/ recovery command + field discriminator), task-workflow-service
(nowIso-before-gate, enforceClaimGate(task, by, nowIso), capture + carry-forward,
setAnchors/addAnchors/removeAnchors via writeTaskExtra), corpus-service (create-time
file_anchors validation), session-service (active_sessions). Covers AC-S3-1..6, 10, 11.

## T2 — adapters + docs
CLI: `create --anchor`, new `anchor add|rm|list` command group, `claim --machine/--worktree`
+ hostname auto-capture (machine only), ready sessions/anchor_conflicts/anchorless
rendering, tree `@branch` badge, `gate task-claim` ctx parity. MCP: lore_claim
machine/worktree/branch, lore_create file_anchors, new lore_anchor_set (26→27), payload
passthrough. Docs: root CLAUDE.md worktree-dispatch section per D10. Covers AC-S3-7, 8, 9.
