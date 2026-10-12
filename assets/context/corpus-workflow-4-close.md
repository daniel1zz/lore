---
id: corpus-workflow-close
title: "CLOSE — feedback loop + memory hygiene"
audience: [main]
mode: static
---
## CLOSE — feedback loop + memory hygiene

- Plan fully done → `lore assess <plan>` (LLM-as-judge review against the spec's ACs, persisted as an assessment doc).
- Spec implementation landed → `lore anchor add <spec> <impl-path[#Symbol]>` to arm the doc-code drift oracle (declare anchors after landing, not during planning — an undeclared path reads as an instant false `file_missing`).
- Superseded knowledge → `lore invalidate <doc> --superseded-by <new> --reason "<why>"` — never leave it quietly stale.
- Session interrupted or ending with open work → `lore handoff [--plan <plan>] --decision "<judgment>[@confidence]" --next "<next step>"` (NOT `lore create knowledge --sub-type handoff` — the writer-identity guard rejects that path, naming `lore handoff` as the sole writer). The next session consumes it via `lore feed session-resume`.
- After writing a handoff, ALWAYS report its ticket to the user: the handoff slug plus the paste-ready resume command `lore feed session-resume --handoff <slug>` — the user hands that ticket to the next session for exact context pickup. This ticket is the ONLY sanctioned resumption path; session-start injection never selects a thread for you.
- Maintenance cadence: `lore pending` (review queue) / `lore review --staleness --list` (stale candidates) / `lore status --check-tree --check-drift` (structure and code-anchor drift) / `lore archive --sweep` (execution-scoped docs due for archival — apply with `lore archive --apply`).
- Suspect a lore defect itself (gate false-deny, wrong/misleading output, a crash)? Re-verify your own input first. Still confirmed → `lore report-issue --title <t> --expected <e> --actual <a>` (needs `feedback.upstream` configured). Check `lore report-issue --list` for a prior filing before re-reporting the same symptom.
- CLAUDE.md holds only permanent static discipline (rules, prohibitions, thresholds, paths, commands); events, state, history, retros and pending items belong in the lore corpus. Never let CLAUDE.md carry state narrative that will go stale.
