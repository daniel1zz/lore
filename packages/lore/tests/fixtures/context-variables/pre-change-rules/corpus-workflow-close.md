<!-- lore:managed fragment=corpus-workflow-close hash=43feeb78 -->
## CLOSE — feedback loop + memory hygiene

- Plan fully done → `lore assess <plan>`.
- Spec implementation landed → `lore anchor add <spec> <impl-path[#Symbol]>` (a test file also takes `<test-path>#"describe or it title"`); declare anchors after landing, not during planning.
- Superseded knowledge → `lore invalidate <doc> --superseded-by <new> --reason "<why>"`; never leave it stale.
- Session interrupted or ending with open work → `lore handoff [--plan <plan>] --decision "<judgment>[@confidence]" --next "<next step>"`, NOT `lore create knowledge --sub-type handoff`.
- After writing a handoff, ALWAYS report its ticket to the user: the handoff slug plus the paste-ready resume command `lore feed session-resume --handoff <slug>`. This ticket is the ONLY sanctioned resumption path.
- Maintenance cadence: `lore pending` (review queue) / `lore review --staleness --list` (stale candidates) / `lore status --check-tree --check-drift` (structure and code-anchor drift) / `lore archive --sweep` (execution-scoped docs due for archival; apply with `lore archive --apply`).
- Suspect a lore defect itself (gate false-deny, wrong/misleading output, a crash)? Re-verify your own input first; if confirmed, check `lore report-issue --list` for a prior filing before re-reporting the same symptom, then `lore report-issue --title <t> --expected <e> --actual <a>` (needs `feedback.upstream`).
- CLAUDE.md holds only permanent static discipline (rules, prohibitions, thresholds, paths, commands); events, state, history, retros and pending items belong in the corpus. Never let CLAUDE.md carry state narrative that will go stale.
