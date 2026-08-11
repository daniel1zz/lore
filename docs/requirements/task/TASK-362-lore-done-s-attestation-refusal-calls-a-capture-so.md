---
id: TASK-362
type: task
role: plan
title: "lore done's attestation refusal calls a capture_source:runner row SELF-REPORTED, misdirecting the reader to the wrong field"
status: archived
priority: medium
created: 2026-08-03
updated: 2026-08-06
tags: []
parent: PRD-001
---
# Defect — `lore done`'s attestation refusal calls a `capture_source: "runner"` row "SELF-REPORTED"

`lore done`'s refusal when no evidence row carries `attestation`
(`packages/lore/src/service/task-workflow-service.ts:2295-2298`):

```
Task "<slug>" holds only SELF-REPORTED result:pass evidence (no runner attestation) —
lore done requires a runner-attested pass before archiving; run `lore verify <plan>` to
attest it, or use the audited --override-attestation "<reason>" escape hatch for
verification lore verify structurally cannot perform
```

Measured 2026-08-03 on `main @ f100663`, `task-a-test-s-green-depends-on-an-ambient-claude-code-session`:
7 evidence rows, **every one `capture_source: "runner"`**, written by `lore evidence --capture`,
which spawns the command itself and REFUSES to record when the declared `--result` disagrees with
the observed exit code (`packages/lore/src/adapters/evidence-capture.ts:329-340`). None carries
`attestation`, so `done()` refuses — correctly.

The refusal tells the operator they hold "only SELF-REPORTED evidence". The corpus says
`capture_source: "runner"` on all seven. Both statements use "runner" and "self-report" as the
same axis, and they contradict each other.

Measured cost, same session: the orchestrator read the refusal, believed `capture_source` was
broken or the shipped binary stale, and spent two full investigation rounds (dumping every row's
`capture_source`, then checking `dist/lore` mtime against every source file) before finding that
the predicate reads a DIFFERENT field. The refusal named the wrong thing to look at.

# Mechanism root — two orthogonal axes collapsed into one word

There are two independent properties, and the message conflates them:

| axis | field | what it proves | who sets it |
|---|---|---|---|
| capture | `capture_source: "runner" \| "self-report"` | lore spawned this command and cross-checked its exit code against the declared result | `lore evidence --capture` |
| provenance | `attestation: {runner, exit_code, duration_ms, timed_out}` | the command itself was APPROVED — SPEC-039's trusted-runner boundary (command-provenance gate + env allowlist) | `verify-runner-service.ts:758` only |

⛔ **The distinction is load-bearing and MUST NOT be removed.** `--capture` proves an exit code;
it does not prove the command was the right one, because the caller supplies the command and can
supply one that necessarily exits 0. `lore verify` derives the command from declared scope
instead. `appendEvidenceEntry` already encodes the one-way implication — it FORCES
`capture_source: "runner"` whenever `attestation !== undefined` (an attested row is
runner-captured by construction), and never the converse.

⛔ **Chesterton's Fence, explicit**: this task must NOT make `--capture` write `attestation`, must
NOT relax `done()`'s floor, and must NOT add a config knob to weaken it. A previous reading of
this same refusal reached exactly that (wrong) conclusion before reading the invariant. **Scope is
the message text only.**

# Required fix — the refusal names the field it actually read

Rewrite the refusal so that an operator holding runner-captured rows is pointed at the real gap:

1. Do NOT describe existing rows as "self-reported" when they are not. State what the task HOLDS
   (e.g. "N result:pass rows, M runner-captured") and what is MISSING (`attestation` — the
   trusted-runner provenance record).
2. State WHY runner-captured is insufficient in one clause: `--capture` proves the exit code of a
   command the caller chose; attestation proves the command's provenance.
3. Keep both existing remedies (`lore verify <plan>`, the audited `--override-attestation`), and
   keep the existing note that `lore verify` is structurally unrunnable for some tasks — an ad-hoc
   task has no plan, which is the case that produced this report.
4. Apply the same treatment to the sibling refusal at `:2304` if it shares the wording defect —
   check it rather than assuming.

# Acceptance criteria

- **AC-1** for a task whose rows are ALL `capture_source: "runner"` with no `attestation`, the
  refusal does NOT describe the evidence as self-reported, and DOES name `attestation` as the
  missing element. Assert two independent lone tokens; ⛔ never assert one whole remembered
  sentence (contiguous-substring rule).
- **AC-2** for a task whose rows are genuinely `capture_source: "self-report"`, the refusal is
  still accurate for THAT case. Both populations must be asserted — a rewrite that simply deletes
  the word "self-reported" would pass AC-1 while losing information here.
- **AC-3** BOUNDARY: a task mixing runner-captured and self-reported rows, none attested, produces
  a refusal accurate about the mix.
- **AC-4** REGRESSION — behaviour is byte-identical: same `LoreError` code, same field, same exit
  code, same archival outcomes. Only the message string changes. Assert the code/field explicitly,
  not merely that it still refuses.
- **AC-5** STATE — the three independent `done()` floors are untouched: the `result:pass`
  attestation floor, the `red_first` floor, and the unfiltered-test-file-anchor floor still fire
  independently and none masks another.
- **AC-6** the audited `--override-attestation` path still archives and still records its reason.
- **AC-7** `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection (loud-zero rule).
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** The refusal text is a proxy for "what the operator must fix". Concrete input satisfying
the proxy while violating the property: the measured case — the message was emitted correctly by a
correct predicate, and sent a competent reader to inspect the wrong field twice. A refusal that
misdirects is a defect even when the refusal itself is right.

**Silence.** Not a silence — a MISDIRECTION, which is worse: a silent failure invites
investigation, while a confident wrong pointer terminates it. The operator here stopped
investigating `attestation` precisely because the message said the problem was self-reporting.

**Opt-in.** None; the message is unconditional. ⛔ No flag, no verbosity level — a refusal that is
only accurate under `--verbose` is the same defect with an extra step.
