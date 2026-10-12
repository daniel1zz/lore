---
id: lore-ac-design
title: "Designing acceptance criteria that cannot go falsely green"
audience: [main]
mode: static
---
## AC design

- An AC proves only what it asserts; the gap between "goal met" and "AC green" is the AC author's job. After writing an oracle, name the simplest case where the goal fails yet the oracle stays green, and assert it. Assert the exit code EXACTLY plus the rule name in the output, never "non-zero"; a probe outside the linted tree proves nothing; three green runs do not clear a flaky oracle; an SSOT AC must check that residual duplicates are gone, not only that the new function exists. Make every oracle go red once (weaken the rule, build a tie) — a green-only run is not verification.
- Editing an oracle after it went red is a spec change, indistinguishable in audit from hiding the failure. Record in place the original command, its exact failure, and why this corrects rather than weakens. The pattern itself lowers the assess evidence_integrity score.
- Read a shared field back before `set`: whole-field replacement swallows what other agents appended.
- A capability and its production wiring are ONE acceptance unit: same-phase wiring task, an AC asserting the live call site, file anchors covering both the implementation and the wiring point.
- Fixing a gap and updating the comment that records it are ONE unit: anchors must cover every comment naming the gap (grep its wording); write the new comment checkable (file:line or symbol), never just "fixed".
- `lore ac add|set` demotes an approved spec to draft whoever runs it (even a statement-only edit re-validates command paths; needs `--allow-missing-path`). In the same session run `lore review` + `lore approve` (approve needs a review of the CURRENT version); if a bundle had implementers run `ac set`, the main agent resets after ALL their merges.
- A rubric AC at 0 pass / 0 fail silently archives with its tasks — evaluate it before archiving a plan. Never paste a governance tool's printed write command (archive/close especially) without confirming its gate fires; never test an irreversible action on a real object.
