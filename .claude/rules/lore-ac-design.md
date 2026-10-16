<!-- lore:managed fragment=ac-design hash=bd520f06 -->
## AC design

- After writing an oracle, name the simplest case where the goal fails yet it stays green, and assert it. Assert the exit code EXACTLY plus the rule name in the output, never "non-zero". A probe outside the linted tree proves nothing; three green runs do not clear a flaky oracle; an SSOT AC must check residual duplicates are gone, not only that the new function exists. Make every oracle go red once.
- Editing an oracle after it went red is a spec change: record in place, on the AC itself, the original command, its exact failure, and why this corrects rather than weakens.
- Read a shared field back before `set`.
- A capability and its production wiring are ONE acceptance unit: same-phase wiring task, an AC asserting the live call site, file anchors covering both the implementation and the wiring point.
- Fixing a gap and updating the comment that records it are ONE unit: anchors cover every comment naming the gap (grep its wording); write the new comment checkable (file:line or symbol), never just "fixed".
- `lore ac add|set` demotes an approved spec to draft whoever runs it (even a statement-only edit re-validates command paths, hence `--allow-missing-path`). In the same session run `lore review` + `lore approve` (approve needs a review of the CURRENT version); if implementers ran `ac set`, the main agent resets after ALL their merges.
- A rubric AC at 0 pass / 0 fail silently archives with its tasks: evaluate it before archiving a plan. Never paste a governance tool's printed write command (archive/close especially) without confirming its gate fires; never test an irreversible action on a real object.
