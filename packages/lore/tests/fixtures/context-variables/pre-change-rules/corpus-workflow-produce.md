<!-- lore:managed fragment=corpus-workflow-produce hash=cc4ed9f3 -->
## PRODUCE — output follows the corpus type chain

- prd → spec (`--kind feature|tech|design`, AC-as-code via `lore ac add`) → plan (`lore phase add`) → task (`--anchor <path>` file anchors).
- Deterministic gates (spec-create / spec-promote / plan-promote / task-claim, plus the additive phase-claim — the `phase` doc-type generalization of task-claim; a legacy `workflow.gates."task-claim"` config is honored for phase-claim too, one deprecation warning per process) enforce at both the hook and service layer: a deny means fix per the feeding pack and retry — never bypass with `LORE_GATE_BYPASS=1` without explicit user consent.
- Decisions go to `lore create adr`; learnings/retros/references go to `lore create knowledge --sub-type <ideation|retro|research|reference>`.
