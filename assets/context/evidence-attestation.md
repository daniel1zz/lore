---
id: evidence-attestation
title: "Evidence attestation: --capture versus verify"
inject: [launch, subagent-start]
agents: [lore-implementer]
---
## Evidence attestation

- `lore evidence --capture` attests only that the CALLER's chosen command exited 0 (clears the `lore done` attested floor). `lore verify` attests the AC's declared command and adds completeness / executed_files / execution_root / execution_mode. AC evidence goes through verify; `--capture` is auxiliary. A fix applies only after the writing binary is rebuilt.
- `lore finish` runs every oracle of the task's contract itself and records the attested rows; `lore land` (through `lore integrate`) re-runs them once on the tree that becomes main, and `lore start` / `lore dispatch` print the contract.
- `--capture` and `lore verify` record stdout and stderr as ONE stream, stdout and stderr merged in terminal order; the {{lore:capture_tail_chars}}-char tail keeps the runner's final summary line.
- A script-mode AC command must print a checkable summary on success (`... && echo '<AC-ID> PASS: <fact proved>'`) and its tail must carry the runner summary (`N passed` / `Done`); fix a silent oracle (a `grep -q` chain) in the declared AC command, never in the recorder.
