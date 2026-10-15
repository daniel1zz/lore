<!-- lore:managed fragment=evidence-attestation hash=ca0a3d20 -->
## Evidence attestation

- `lore evidence --capture` attests only that the CALLER's chosen command exited 0 (clears the `lore done` attested floor). `lore verify` attests the AC's declared command and adds completeness / executed_files / execution_root / execution_mode. AC evidence goes through verify; `--capture` is auxiliary. A fix applies only after the writing binary is rebuilt.
- `--capture` and `lore verify` record stdout and stderr as ONE merged stream; the 4000-char tail keeps the runner's final summary line.
- A script-mode AC command must print a checkable summary on success (`... && echo '<AC-ID> PASS: <fact proved>'`) and its tail must carry the runner summary (`N passed` / `Done`); never declare a silent oracle (a `grep -q` chain).
