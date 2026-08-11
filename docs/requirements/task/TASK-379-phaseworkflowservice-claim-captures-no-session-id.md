---
id: TASK-379
type: task
role: plan
title: "PhaseWorkflowService.claim captures no session_id, so every same-actor phase-anchor overlap now hits a fail-safe refusal it can never satisfy"
status: archived
priority: critical
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Defect — a shipped channel now lands in a fail-safe refusal it cannot escape

`task-two-concurrent-orchestrators-both-resolve-to-agent-main` (merged 2026-08-03) taught
`noAnchorOverlap` to exempt a same-`by` sibling ONLY on a proven-equal `extra.claim.session_id`,
and to REFUSE with `ANCHOR_OVERLAP_SESSION_UNMEASURED` when either side lacks one. The capture
was implemented in `TaskWorkflowService.claim`.

**`PhaseWorkflowService.claim` was out of that task's declared anchors and captures no
`session_id`.** The predicate is shared verbatim by the `phase-claim` checkpoint. So every
same-actor overlapping PHASE claim now hits the not-measured refusal — permanently, because
nothing on that path can ever supply the field.

Reported by `agent:fix-actor-session-split` as concern (h)(1); it pinned the behaviour with a
test stating exactly this and deliberately left `runPhaseClaimGate` unthreaded so the phase
pre-flight and the phase claim stay in parity rather than disagreeing.

⛔ Fail-safe is the CORRECT default here (a gate that cannot measure must refuse, not permit).
The defect is that one of the two claim paths can never satisfy it.

# Mechanism root

The session-instance capture was added at ONE of the two claim seams. `noAnchorOverlap` is a
shared predicate but the fact it now reads is written by only one of its callers — a
writer/reader asymmetry across a service boundary, which is exactly the silent-failure shape
this repo has already catalogued (root CLAUDE.md, *Consumer/end-to-end audits*: "a reader
without a writer … fail SILENT"). Here it fails LOUD instead of silent, which is why it was
caught in the same session — but the asymmetry is the same.

# Required fix

1. `PhaseWorkflowService.claim` captures `session_id` by the SAME mechanism as
   `TaskWorkflowService.claim` — read from the env inside the service, no flag, no
   `ClaimOpts` field (the Opt-in answer the merged task already settled; do not re-open it).
2. Reuse the sanitize/validate SSOT already extracted at `packages/core/src/session-actor.ts`.
   ⛔ Do not re-implement the prefix/sanitize rule — a second copy is how the two paths
   diverge again.
3. An env var present but sanitizing to empty must fail LOUD
   (`VALIDATION_ERROR`, `field: claim.session_id`, nothing written), matching the task path.
4. Do NOT thread `runPhaseClaimGate` differently from the phase claim — parity between
   pre-flight and claim is deliberate.

Distribution surface: binary-side (`packages/lore/**` + `@lore/core`).

# Acceptance criteria

- **AC-1** RED first: today, two phase claims with the same `by` and intersecting anchors are
  refused with `ANCHOR_OVERLAP_SESSION_UNMEASURED` even when made from ONE session. After the
  fix, same-session is exempted. Assert the reason token, not just ok/not-ok.
- **AC-2** CONTROL: same `by`, DIFFERENT session id on the phase path is still FOREIGN
  (refused). Without this, AC-1 is satisfiable by restoring a blanket same-`by` exemption —
  the exact proxy the merged task retired.
- **AC-3** CONTROL: absent session id on either side still refuses with the not-measured
  reason. Fail-safe must survive the fix.
- **AC-4** the phase pre-flight (`runPhaseClaimGate`) and the phase claim agree on every
  case in AC-1..AC-3 — assert both surfaces, not one.
- **AC-5** legacy phase claims without the field parse unchanged and never read as
  "same session".
- **AC-6** empty-after-sanitize fails loud on the phase path (assert the error code AND that
  nothing was written).
- **AC-7** `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection count (loud-zero rule).
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

⚠ **Anchor mutex**: this file is also claimed by
`task-three-byte-identical-copies-of-isplanmember-survive` and by the `capture_source`
write-boundary task. These three MUST be sequenced, never run concurrently.

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** Unchanged from the merged task: `session_id` is the captured fact, not a proxy.
What this task fixes is a MISSING WRITER, so the proxy question is inherited, not re-asked.

**Silence.** Inverted from the usual case — the current behaviour is loud (a refusal), and the
risk of the FIX is re-introducing silence: if item 1 is implemented as "treat absent as same
session on the phase path only", the gate goes quiet exactly where it was just made to speak.
AC-3 exists to make that regression un-passable.

**Opt-in.** None, deliberately. The merged task already ruled out a flag or `ClaimOpts` field;
re-introducing one here would let an operator opt out of the mutual exclusion the gate exists
to provide.
