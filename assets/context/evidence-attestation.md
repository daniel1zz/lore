---
id: evidence-attestation
title: "Evidence attestation: --capture versus verify"
audience: [main, "subagent:lore-implementer"]
mode: static
---
## Evidence attestation

- `lore evidence --capture` writes a real attestation (with exit_code) that clears the `lore done` attested floor, but it only proves the command the CALLER chose exited 0. `lore verify` attests a command derived from the AC's declared scope and adds completeness / executed_files / execution_root / execution_mode. AC evidence goes through verify; `--capture` is auxiliary. A fix applies only after the writing binary is rebuilt.
- `--capture` and `lore verify` record stdout and stderr as ONE merged stream in terminal order; the 4000-char tail keeps the runner's final summary line.
- A script-mode AC command must print a checkable summary on success (`... && echo '<AC-ID> PASS: <fact proved>'`); a tail must carry the runner summary (`N passed` / `Done`). verify runs the AC's declared command, so a silent oracle (a `grep -q` chain) leaves an attested pass with an empty tail — fix the declared command, not the recorder.
