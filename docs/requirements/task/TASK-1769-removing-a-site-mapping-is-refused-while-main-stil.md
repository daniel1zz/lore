---
id: TASK-1769
type: task
role: plan
title: "Removing a site mapping is refused while main still reaches the site, so an unlanded branch cannot break everyone's coverage"
status: archived
priority: medium
created: 2026-10-19
updated: 2026-10-19
tags: []
parent: PLAN-206
plan: PLAN-206
---
Incident 2026-10-19 ~10:00 UTC: an implementer, from its unlanded branch, removed three site mappings on baseline-integrate-a-branch-into-main (`lore baseline map --remove-site`) because its branch had split IntegrateService.integrate and those site keys no longer existed in ITS tree. They still existed on main, so main's root coverage became incomplete and every other branch's integrate floor refused (`not_measured ... IntegrateService.integrate#dynamic:this.deps.runFloor` etc.) until the mappings were restored by hand from version 35 of the leaf.

This is the mirror of the pre-declared-command incident (refs, 07:38): the corpus is shared and un-branched, so a corpus edit made for one unlanded tree breaks every other tree. Additions are already safe (coverage ignores mappings for sites a tree does not reach; absent declared commands are reported, not failing). Removals are not.

End state: removing a site mapping is refused (exit 4) while MAIN's census still reaches that site from the leaf, naming the site and saying the removal must wait until the branch that drops it has landed; stale mappings for sites main no longer reaches are removable, and `lore status` (or coverage) lists them as removable so they are cleaned up after landing instead of before. One census predicate (main's tree, the leaf's own commands/owned sites) decides; a census failure refuses.

AC: red-first — removing a mapping for a site main still reaches exits 4 naming it and writes nothing; removing one for a site main no longer reaches succeeds; coverage/status lists stale removable mappings. Falsifier: today's removal succeeds and breaks main's coverage.

## Widened 2026-10-19 ~10:25 UTC (third incident of the class)
An implementer, before its branch (removing the `lore outline` write verbs) landed, removed the four outline command declarations from baseline-write-an-outline-section, removed 7 site rows, and retired BR-985/694/695/696. Main still had the commands: every session's floor reported `undeclared outline ...` and gaps until the declarations and rows were restored by hand (the retired rules could not be revived, so the rows became non-business notes). Same class as `refs` (07:38) and the integrate rows (10:00).

The end state therefore covers EVERY accountability-reducing corpus write, not only --remove-site: `--remove-site`, `--remove-command`, and `rule set --lifecycle retired` (and a rule move) are refused (exit 4) while MAIN's tree still reaches what they stop accounting for — a site main's census reaches from the leaf, a command main's registry still has, a rule some site mapping on main's reachable sites cites — naming the dependents and saying the change must wait until the branch that removes the behaviour lands. Restating a rule's text is not blocked but is reported. The refusal names how to see what still depends on it. One predicate over main's tree decides all three.
