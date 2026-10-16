<!-- lore:managed fragment=corpus-workflow-produce hash=3c5c0efb -->
## PRODUCE — output follows the corpus type chain

- prd → spec (`--kind feature|tech|design`, AC-as-code via `lore ac add`) → plan (`lore phase add`) → task (`--anchor <path>` file anchors).
- Gates (spec-create / spec-promote / plan-promote / task-claim, plus phase-claim) enforce at the hook and service layer: on a deny, fix per the feeding pack and retry; never bypass with `LORE_GATE_BYPASS=1` without explicit user consent. A legacy `workflow.gates."task-claim"` config is honored for phase-claim too (one deprecation warning per process).
- Decisions go to `lore create adr`; learnings/retros/references go to `lore create knowledge --sub-type <ideation|retro|research|reference>`.
