---
id: KN-096
type: knowledge
role: knowledge
title: "lore verify -yes alias not honored in non-TTY --json mode (full --allow-new-commands works)"
status: approved
priority: medium
created: 2026-07-23
updated: 2026-07-24
tags: [dogfood, cli, verify, defect-suspect]
parent: SPEC-039
---
Observed 2026-07-23 during SPEC-068 verification: `lore verify <plan> --task <task> -yes --json` still aborted exit 7 NEEDS_APPROVAL at the first first-seen command, while the identical invocation with `--allow-new-commands` passed all 9 ACs. Help text lists `-yes, --allow-new-commands` as aliases. Hypotheses (unverified): citty short-flag parsing splits/mishandles `-yes`, or the alias registration only binds in interactive mode. Repro commands and outputs preserved in session scratchpad (verify2.json vs verify3.json). Next step per escalation!=build: VERIFY the alias wiring in packages/lore/src/adapters/cli (verify command definition + SPEC-051 strict-flag seam) before building anything; if real, it is a one-line alias fix + a flag-parsing regression test.
