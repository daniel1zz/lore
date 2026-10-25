---
id: corpus-workflow-close
title: "CLOSE — feedback loop + memory hygiene"
inject: [launch]
---
## CLOSE — feedback loop + memory hygiene

- Plan fully done → `lore assess <plan>`.
- Spec implementation landed → `lore anchor add <spec> <impl-path[#Symbol]>` (a test file also takes `<test-path>#"describe or it title"`); declare anchors after landing, not during planning.
- Superseded knowledge → `lore invalidate <doc> --superseded-by <new> --reason "<why>"`; never leave it stale.
- A lesson (an incident, a correction, a near miss) is finished only when it changes a mechanism: in the same turn, create or link the spec, plan, task or rule whose end-state design makes it unable to recur — not a guard on the old design — or say why none fits. "Noted for next time" is not a disposition, and a retro is not one either (it is read only when searched). Whether you do this is not enforced; the design you produce is (the approval judge's design_necessity).
- Session interrupted or ending with open work → `lore handoff [--plan <plan>] --decision "<judgment>[@confidence]" --next "<next step>"`, NOT `lore create knowledge --sub-type handoff`.
- After writing a handoff, ALWAYS report its ticket to the user: the handoff slug plus the paste-ready resume command `lore feed session-resume --handoff <slug>`. This ticket is the ONLY sanctioned resumption path.
- Maintenance cadence: `lore pending` (review queue) / `lore review --staleness --list` (stale candidates) / `lore status --check-tree --check-drift` (structure and code-anchor drift) / `lore archive --sweep` (execution-scoped docs due for archival; apply with `lore archive --apply`).
- Suspect a lore defect itself (gate false-deny, wrong/misleading output, a crash)? Re-verify your own input first; if confirmed, check `lore report-issue --list` for a prior filing before re-reporting the same symptom, then `lore report-issue --title <t> --expected <e> --actual <a>` (needs `feedback.upstream`, lore's own repository). Any other problem you do not fix in place (a test already red on the baseline, a stale ledger, an oversized doc, a missing anchor) → file it as an issue in this project's own issue tracker, never through `lore report-issue`; each report is one root cause, reproducible and closable alone, never bundled. The two routes are one repository when the project is lore itself: problems are filed as issues there too, including in the tool's own repository. Create a task only when you start the fix: a task names the issues it resolves, never a task whose subject is the problem.
- CLAUDE.md holds only permanent static discipline (rules, prohibitions, thresholds, paths, commands); events, state, history, retros and pending items belong in the corpus. Never let CLAUDE.md carry state narrative that will go stale.
