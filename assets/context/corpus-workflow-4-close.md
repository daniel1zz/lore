---
id: corpus-workflow-close
title: "CLOSE — feedback loop + memory hygiene"
audience: [main]
mode: static
---
## CLOSE — feedback loop + memory hygiene

- Plan fully done → `lore assess <plan>`.
- Spec implementation landed → `lore anchor add <spec> <impl-path[#Symbol]>` (a test file also takes `<test-path>#"describe or it title"`); declare anchors after landing, not during planning.
- Superseded knowledge → `lore invalidate <doc> --superseded-by <new> --reason "<why>"`; never leave it stale.
- Session interrupted or ending with open work → `lore handoff [--plan <plan>] --decision "<judgment>[@confidence]" --next "<next step>"`, NOT `lore create knowledge --sub-type handoff` (rejected; `lore handoff` is the sole writer).
- After writing a handoff, ALWAYS report its ticket to the user: the handoff slug plus the resume command `lore feed session-resume --handoff <slug>`. This ticket is the ONLY sanctioned resumption path.
- Maintenance: `lore pending` / `lore review --staleness --list` / `lore status --check-tree --check-drift` / `lore archive --sweep` (apply with `lore archive --apply`).
- Suspect a lore defect? Re-verify your own input first; if confirmed, check `lore report-issue --list` for a prior filing, then `lore report-issue --title <t> --expected <e> --actual <a>` (needs `feedback.upstream`).
- CLAUDE.md holds only permanent static discipline; events, state, history, retros and pending items belong in the corpus.
