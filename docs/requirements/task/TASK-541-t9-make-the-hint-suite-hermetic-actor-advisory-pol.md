---
id: TASK-541
type: task
role: plan
title: "[T9] Make the hint suite hermetic — actor advisory pollutes exact-stderr-line assertions"
status: archived
priority: medium
phase: "GREEN"
created: 2026-07-29
updated: 2026-07-29
tags: []
parent: PLAN-105
plan: PLAN-105
---
AC-OOB-6 passes when run by hand but FAILS under lore verify. Root cause (established by direct reproduction, not inference): lore verify spawns AC commands through DEFAULT_VERIFY_ENV_ALLOWLIST (verify-spawn.ts, 12 vars: PATH HOME USER LOGNAME SHELL LANG TZ TMPDIR TEMP TMP TERM PWD) which does NOT include LORE_ACTOR. Without it, every spawned lore command emits the SPEC-035 resolveActor OS-fallback advisory to stderr ('actor resolved to OS username ... aren't traceable to an agent'), so stderr carries 2 non-empty lines and the assertion nonEmptyLineCount(unconfigured.stderr) === 1 fails with Expected 1 / Received 2. Reproduced deterministically via: env -i PATH=... HOME=... USER=... SHELL=... LANG=... bun test <file> -t 'AC-OOB-6' -> 0 pass / 1 fail. The runLore helper (line ~81) already pins HOME/EDITOR/CLAUDECODE but not LORE_ACTOR; the sibling provision suite (line ~149) has the same gap but survives only because its assertions are exit-code and token-containment based, not exact line counts. Fix: add LORE_ACTOR to the hint suite's runLore env so the advisory never fires, making every exact-stderr-line assertion environment-independent. Do NOT weaken nonEmptyLineCount to a containment check — that structural assertion is deliberate (it defeats a stub that merely emits the token somewhere). ALSO SWEEP: grep both this file and the wider tests/ tree for other exact-stderr-line or byte-identical-stderr assertions around spawned lore commands and report (do not fix outside your anchor) any that carry the same latent fragility. Exit condition: bun run build first, then BOTH (a) bun test tests/unit/adapters/report-issue-hint.bun.test.ts -> 8 pass / 0 fail AND (b) the same file under a stripped env -- env -i PATH=$PATH HOME=$HOME USER=$USER SHELL=$SHELL LANG=en_US.UTF-8 bun test ... -t 'AC-OOB-6' -> 1 pass / 0 fail. Condition (b) is the real oracle: it is what lore verify actually does.
