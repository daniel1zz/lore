---
id: KN-475
type: knowledge
role: knowledge
title: "Governance gaps measured while resuming handoff 107, and why most are recorded here instead of in the defect channel"
status: approved
priority: medium
created: 2026-08-18
updated: 2026-08-20
tags: []
parent: PRD-001
links:
  - {id: TASK-723, type: relates-to}
---
Governance-tool gaps measured 2026-08-18 while resuming
`knowledge-handoff-agent-main-orchestrator-107`. Gap 4 is why the others are here
rather than in the defect channel where they belong.

⛔ This doc's title deliberately carries NO count, and its slug's "four" is a frozen
creation-time artifact, not a claim — the list grew to six within the same session,
which is exactly how a counted title becomes a lie.

## 4. The defect channel refuses new reports, and its own blocking root cause is one of the ten entries holding it shut

`lore report-issue` caps a project at 10 OPEN upstream reports. That cap is full:
ten reports, all filed 2026-08-12/13, all still `open`, all still `draft`. So every
attempt to file a NEW gap now exits 4 with
`reporter project 'lore' already has 10 open report(s) upstream (cap 10)`.

The reason they never drain is already filed, as report `01KZWMWFN9VXRDNJMKFAW0Y7GF`:
*"The defect channel has no adopt verb: a filed report can be closed but never given
an owner, so every accepted defect stays plan-less forever."* A report can only be
closed or left open — there is no transition that turns it into owned work. So the
queue is monotonic, it reached the cap, and the cap now refuses the channel's own
input.

### The obvious escape was TESTED and it is not available

Before concluding this, two of the ten were checked for staleness rather than assumed
stale — the two claiming the mirror exporters disagree
(`01KZVAXZQAT4S9F4HGQT45YTT9`, `01KZWF5EFFNWW673QYEEPNCMVT`). AC-BFI-8 had since landed
a mirror CONTENT check, so it was plausible they had been fixed and could be honestly
closed to free slots.

Measured 2026-08-20: injected a two-line body drift into a mirror file, ran
`bun run mirror:export` with NO `--force`, and the drift survived untouched
(`git diff` still dirty). Only `lore export-docs --force` converges it. Both reports are
therefore STILL VALID. Closing them would have been a false closure — and it would have
looked exactly like a legitimate one afterwards.

⛔ So there is no honest way to free a slot. Closing a report to make room marks an
unresolved defect resolved, which is exactly the lie the corpus must not carry —
and it would be indistinguishable afterwards from a real fix. The cap is doing its
job; the missing adopt verb is the defect. Until it exists, gaps land in knowledge
docs like this one, which no `--check` reads, so the reporting discipline degrades
from enforced to advisory without anything announcing the change.

## 1. plan-terminality drift prints a remedy that is an ILLEGAL transition for a draft plan

The drift appends the same paste-ready command to every finding regardless of the
plan's status: `Run: lore set <plan> --status archived`. For a plan in `draft` that
edge does not exist — `VALID_TRANSITIONS` allows `draft -> in-review | approved`
only — so the printed command exits 4:

    Cannot transition from 'draft' to 'archived'.
      Allowed transitions from 'draft': in-review, approved

Measured on three of the six plans then in drift
(`plan-land-falsifiability-reachability-…`, `plan-close-two-typecheck-blind-spots-…`,
`plan-make-three-governance-outcomes-…`). A legal path does exist and each of the
three pre-flighted `gate: pass` on `lore gate plan-promote --plan <slug>`, so the
sequence is `draft -> approved -> archived`. The message names none of it.

The cost is not a wrong command. `hooks/pre-push` runs `--check-tree` and exits 3,
so the repo was red for EVERY session with no single-step legal path to green, and
the only visible instruction was one that cannot succeed. Expected: name the full
legal sequence, or name the transition constraint instead of an unrunnable command.

## 2. The orphan drift is addressable in `--json` and NOT in the text output

`lore status --check-tree` printed four consecutive, byte-identical lines:

    - orphan: knowledge has no parent but is not a root type

Four different documents, no slug, no id, no distinguishing field. The `--json`
form carries `actual.{id,slug,type,parent_id}` for each. So the finding is fully
addressable on the surface a script reads and NOT on the surface a human or an
agent reads first — and the text form cannot even establish that the four lines are
four documents rather than one repeated.

This is the North Star's third property (every assertion locatable and
re-verifiable) failing on the drift reporter itself. Expected: the text line names
the slug, as `plan-terminality` already does.

## 3. `lore set --status archived` on an ALREADY-archived doc is neither refused nor a no-op

Probed directly on `plan-land-bootstrap-fixpoint-integrity-binary-provenance-the`,
already `archived` at v3: the command exited 0, printed `Updated … → v4`, and
appended a real version whose content is identical to v3.

So `archived -> archived` is an allowed self-transition that silently grows version
history. Two consequences: a retry loop or a re-run of a drift-repair script inflates
a document's version count with content-free entries, and `Updated … → vN` cannot be
read as evidence that anything changed. Expected: either refuse the self-transition,
or report it as a no-op rather than as an update.

This one was measured because a wrong inference was being tested — the probe existed
to check whether an earlier `Updated → v3` had been a phantom write. It had not been;
the version numbering is honest. The finding is the self-transition's silence, not a
lost write.

## 5. An AC can be declared in a shape that is structurally unattestable, and nothing says so until the work is already done

`lore ac add` accepted this command without a warning:

    test -f <new> && test ! -e <old> && ! git grep -qI <literal> -- ':(exclude)docs/requirements' && lore status --check-drift && bun test <new>

The implementer ran it: exit 0, suite 13 pass / 0 fail. Then `lore verify` returned

    ⚠ AC-BFI-11 inconclusive (ran 1 of 3 declared paths) (12491ms, exit 0)

exit 3. `countExplicitPathArgs` (`packages/core/src/attestation-completeness.ts`)
tokenizes the ENTIRE `&&` chain and counts every `.test.ts`-shaped token, so the two
shell-builtin existence checks inflated `declared_paths` to 3 while only 1 path ever
reached a runner. Its own doc comment scopes it to "plain `bun run <script> <paths…>`
/ `bunx vitest run <paths…>` invocations" — a compound chain is outside the shape it
was designed for.

Because no `attestation` was issued, `lore done` then refused to archive the task on
the attestation floor. So the sequence is: the AC is accepted, the work is done
correctly, the oracle passes, and only THEN does the corpus refuse to record it.

Two distinct defects, and the second is the more important:
- `countExplicitPathArgs` under-matches on a compound command. It should either scope
  its count to the runner invocation segment, or refuse to classify a shape it was not
  designed for instead of silently under-matching.
- `lore ac add` performs no attestability check at declaration time. An AC whose
  command can never produce an attestation is accepted as readily as one that can,
  and the cost lands on the implementer who already finished.

Reproduced independently by the orchestrator on `main`, not taken on the
implementer's report. Remedy applied here was to re-baseline the AC to a single-runner
command and move the four checks INTO the test file as cases — assertions preserved,
shape made attestable. ⛔ The remedy is NOT `lore done --override-attestation`: that
escape is scoped to verification `lore verify` structurally cannot perform, and this
was verification it could perform but mis-classified.

## 6. `lore ac set` refuses `--mode` even when the value passed is the CURRENT one

Passing `--mode script` to an AC whose mode is already `script` exits 2:

    Error: --mode cannot be changed via `lore ac set` — mode reinterprets every
    historical evidence row attributed to this id.

The guard's reasoning is right, but it fires on equality rather than on a change. A
caller reconstructing an AC's full flag set — the natural way to edit a criterion
without accidentally dropping a field — is refused for supplying the value that is
already stored, and the message asserts a change the caller did not make. Expected: a
no-op when the passed mode equals the stored one; refuse only an actual transition.

## 7. The same naive tokenizer under-matches a SECOND way: two chained runners credit one

Gap 5 was a compound chain whose non-runner path tokens inflated `declared_paths`. This is the
mirror case, measured 2026-08-19 on AC-BFI-12's declared command:

    bunx vitest run <ratchet file> 2>&1 && bun test <trip file> 2>&1 && echo '…'

Both paths ARE runner arguments, and both files genuinely ran green (vitest 16/16, bun 18/18). Yet:

    "result": "inconclusive", "exit_code": 0, "completeness": "under_match",
    "executed_files": 1, "declared_paths": 2

`lore verify` exit 3. The checker credits only ONE runner invocation per chain. Consequence, stated
plainly: **an AC whose oracle needs two runners cannot be attested at all** — and this repo has two
runners BY DESIGN (`.bun.test.ts` under `bun test`, everything else under vitest), so any criterion
spanning both is structurally unattestable.

The remedy that works is to SPLIT the criterion by runner: AC-BFI-12 kept the vitest file, AC-BFI-13
took the bun file, and both then attested on the first try (`2 passed, 0 failed`). That is the same
shape as the CLAUDE.md rule about splitting an AC whose prose names two layers — here it is two
RUNNERS, and the tooling enforces the split whether or not the author intended it.

⛔ Note the asymmetry that makes this dangerous: the command exits 0 and every assertion inside it
passes. Nothing about the run looks wrong. The refusal arrives later, from `lore done`, as an
attestation-floor denial on work that is already finished and merged.

## 8. `lore ac add`'s path precheck reads a basename inside the success-echo PROSE as a missing path

Measured 2026-08-19. This declaration was refused:

    --command "bun test packages/lore/tests/integration/pre-push-trip.bun.test.ts 2>&1 && echo '… names pre-push-trip.bun.test.ts …'"

    Error: Declared script-mode command names path(s) that do not exist yet: pre-push-trip.bun.test.ts

The real path — `packages/lore/tests/integration/pre-push-trip.bun.test.ts` — exists and is the
command's actual argument. The bare basename inside the human-readable echo message was tokenized as
a second path and reported missing.

Same root as gaps 5 and 7: a naive path tokenizer applied to a whole shell command string, including
its prose. Third distinct manifestation, in a third code path (declaration precheck, not attestation
completeness). ⛔ The available workaround — reword the echo so it spells no basename — makes the
success line LESS informative, which is the opposite of what the "verdict must be legible in the
evidence tail" rule wants. Fixing the tokenizer once would remove all three.

## What the pattern in 5, 7 and 8 actually is

Three independent code paths each parse an AC's command string as if it were a path list. Each is
correct for the narrow shape it was written against and silently wrong outside it. None of them
refuses the shape it cannot handle — they all produce a confident, specific, wrong answer instead:
`declared_paths: 3`, `executed_files: 1`, `path does not exist`. That is the failure mode the North
Star's first property names: a verdict that does not carry the state it describes. An agent has no
second source to catch it with, which is why all three were found by accident, after the work.
