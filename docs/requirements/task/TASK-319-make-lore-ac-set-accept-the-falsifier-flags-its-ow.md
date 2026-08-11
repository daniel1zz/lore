---
id: TASK-319
type: task
role: plan
title: "Make lore ac set accept the --falsifier-* flags its own error message prescribes, and scan every error message's suggested command for executability"
status: archived
priority: medium
phase: "evidence-integrity"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-076
plan: PLAN-076
---
Make `lore ac set` actually accept the `--falsifier-*` flags its own error message tells users to
run, and add the scanner that stops this class of defect from recurring.

⛔ Measured 2026-08-10, on the freshly-built release binary:

```
$ lore verify <plan> --falsify AC-TC-1 --task <task>
Error: ... AC "AC-TC-1" declares no falsifier — declare one first
  ('lore ac add/set <spec> <id> --falsifier-path <path> --falsifier-find <text>
    --falsifier-replace <text> --falsifier-exit-code <n>')          # verify-runner-service.ts:1472

$ lore ac set <spec> AC-TC-2 --falsifier-path ... --falsifier-find ... --falsifier-exit-code 1
Error: Unknown option: --falsifier-path                              # exit 2
```

`ac set --help` mentions `falsifier` ZERO times; `ac add --help` mentions it four times. The message
names a path that does not exist.

⛔ **This is G4's exact shape recurring within hours of G4 being closed** — a message promising more
than the implementation delivers. It passed every AC, was attested, and was archived, because
nothing asserted that a message's own instructions are executable. Do not treat it as a typo.

Deliver:

1. **`ac set --falsifier-path/-find/-replace/-exit-code`**, implemented in `ac-service.ts` and wired
   in `commands/ac.ts`. ⛔ Implement the capability — do NOT "fix" this by deleting `set` from the
   error message. Editing a declared falsifier is a real need, and the only current alternative is
   `ac rm --force` + `ac add`, which is a destructive round-trip on a governance object. The
   orchestrator declined to dogfood the attested-red path on a real AC for exactly this reason, so
   the missing verb has already cost a verification.
2. **A partial-update contract.** ⛔ Read the standing rule first: governance `set` commands that
   replace a field wholesale silently swallow what another agent appended. Specify and test what
   happens when only SOME `--falsifier-*` flags are passed — either require all four together, or
   merge onto the stored falsifier. Either is defensible; an undocumented half-write is not.
3. **`scripts/tests/error-message-commands-executable.test.ts`** (AC-FR-9) — scan the source for
   command-shaped strings inside error/refusal messages and confirm every named subcommand exists
   and every named flag is accepted by THAT subcommand. ⛔ Record BOTH reds: point a message at a
   bogus flag (must fail, naming file:line) and at a valid one (must pass, proving the scanner is
   not always-failing).

⛔ Expect the scanner to find MORE than this one. Report every offender it surfaces, and fix them in
this task — a scanner shipped alongside a known-failing corpus of messages is a gate armed against
a back-catalogue nobody swept, which has already cost this repo a full round.
