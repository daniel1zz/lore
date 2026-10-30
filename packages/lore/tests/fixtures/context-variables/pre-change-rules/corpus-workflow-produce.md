<!-- lore:managed fragment=corpus-workflow-produce hash=e712357e -->
## PRODUCE — output follows the corpus type chain

- prd → spec (`--kind feature|tech|design`, AC-as-code via `lore ac add`) → plan (`lore phase add`) → task (`--anchor <path>` file anchors).
- An ad-hoc task with criteria names its governing spec: `lore create task --adhoc ... --spec <spec>`.
- Gates (spec-create / spec-promote / plan-promote / task-claim, plus phase-claim, the task-claim of the `phase` doc type) enforce at the hook and service layer: on a deny, fix per the feeding pack and retry; never bypass with `LORE_GATE_BYPASS=1` without explicit user consent. A legacy `workflow.gates."task-claim"` config is honored for phase-claim too (one deprecation warning per process).
- Decisions go to `lore create adr --parent <spec it governs>`; learnings/retros/references go to `lore create knowledge --parent <spec or prd it concerns> --sub-type <ideation|retro|research|reference>`.
- Design the end state: do not introduce stopgaps, guard checks, fallbacks or phased migrations that the end-state design would make unnecessary — the approval judge rejects them.
