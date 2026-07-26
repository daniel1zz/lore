---
id: TASK-152
type: task
role: plan
title: "Gate hook denies the WHOLE chained Bash command when any segment matches a trigger — feeding pack masks that earlier segments never ran"
status: archived
priority: medium
created: 2026-07-25
updated: 2026-07-25
tags: []
parent: PRD-001
---
Observed 2026-07-25 (three consecutive repros): 'lore set X --content-file F && lore approve X' was denied with the spec-promote feeding pack ('has no structured acceptance criteria'); the same 'lore set' run ALONE succeeded (v12). Then 'lore ac add ... && lore approve ...' was denied with the SAME message — ac add alone succeeded, approve alone then succeeded. Diagnosis: the PreToolUse gate hook (SPEC-050 command-position trigger matching) inspects the full Bash string, matches the approve segment's checkpoint, and denies the ENTIRE command — the deny message describes only the gate verdict, so the caller reasonably (and wrongly) concludes the FIRST command failed. Cost: three wasted round-trips + a false 'gate non-determinism' hypothesis before the per-segment isolation experiment.

AC:
- Given a chained command 'A && B' where only B matches an armed checkpoint and B's gate would deny, When the hook fires, Then EITHER only-B-blocking semantics apply (A runs; deny surfaces when B executes) OR the deny message explicitly states the whole chain was blocked and names the matched segment — asserted by the hook's golden-fixture suite with a chained-command fixture.
- Given a single-command invocation, Then hook behavior byte-identical (regression).
