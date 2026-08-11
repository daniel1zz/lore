---
id: TASK-380
type: task
role: plan
title: "A -t filter is a regex, so this repo's own AC titles containing parens or plus silently match zero and exit 0 in the pre-recording window"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
---
# Defect — a `-t` filter is a REGEX, so a test title containing `(`, `)` or `+` silently matches zero and exits 0

Measured twice in one session by `agent:fix-mcp-claim-capture` while self-verifying, on two
different titles:

    -t 'AC-2.H1 (GREEN)'            → parentheses are a regex group  → 0 matched, exit 0
    -t '…all + caller_cwd'          → `+` is a quantifier            → 0 matched, exit 0

Both read as a passing run. The agent caught them only because it cross-checked the reported
test count against what it expected.

This is the catalogued no-match/exit-0 family (root CLAUDE.md, *Contiguous-substring
assumption*) with a **specific, mechanizable cause**: the filter argument is interpreted as a
regular expression, and this repo's own AC-naming convention (`AC-2.H1 (GREEN)`,
`AC-VS-9 (BOUNDARY)`) puts regex metacharacters in almost every test title an author would
paste. The convention and the filter are in direct conflict.

⛔ Note what is NOT the defect: `lore evidence` ALREADY refuses a `-t` filter matching nothing
(root CLAUDE.md, *False oracles*). That check fires when the run is being RECORDED. Both
instances above happened while the agent was verifying its own work BEFORE recording — the
window where nothing watches. So the existing mechanism is correct and insufficient in scope.

# Mechanism root

Two independent facts, each harmless alone: (a) `-t` is a regex, (b) the project's AC titles
contain `()` and `+`. Their intersection produces a filter that cannot match its own intended
target, and the runner reports that as success because "zero selected" is not an error
condition per invocation. Nothing warns, because no component knows both facts.

# Required fix — decide the mechanism, then build it

⛔ Do NOT resolve this by a CLAUDE.md line telling authors to escape metacharacters. Prose that
should have been followed is not a mechanism, and the two measured instances were produced by
an agent that had already read the contiguous-substring lesson.

Evaluate BOTH candidates before implementing; record the rejected one and why:

1. **Extend `lore evidence`'s precheck** to refuse a `--command` whose `-t`/`--testNamePattern`
   argument contains unescaped regex metacharacters (`( ) + [ ] { } | ^ $ ? *`) — a
   *lexical* check, no execution needed, and it fires at the recording boundary that already
   exists. Cheap, but does not cover the pre-recording window that actually bit us.
2. **A runner-level guard**: make zero-selection non-zero. `bun run test:changed` already
   implements exactly this (the loud-zero rule) and it is the proven pattern in this repo. The
   equivalent for an ad-hoc `-t` run has no natural home — the author invokes `bunx vitest`
   directly.

Whichever is chosen, the AC must assert the REFUSAL fires on both measured strings above and
does NOT fire on a metacharacter-free filter.

# Acceptance criteria

- **AC-1** RED first: reproduce zero-match-exit-0 with `-t 'AC-2.H1 (GREEN)'` against a test
  file that DOES contain a test by that literal name. The literal-vs-regex gap is the whole
  defect; a synthetic name proves nothing.
- **AC-2** the chosen mechanism refuses/flags both measured strings (`(GREEN)` and `+`).
- **AC-3** CONTROL: a metacharacter-free filter that matches ≥1 test is unaffected.
- **AC-4** CONTROL: a metacharacter-free filter matching ZERO tests is still handled by the
  pre-existing zero-match refusal — this task must not weaken it.
- **AC-5** the rejected candidate is recorded with its reason (in the task's evidence or a
  corpus doc), so the next reader does not re-derive it.
- **AC-6** `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection count.
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** A metacharacter scan is a proxy for "this filter cannot match what its author
meant". Input satisfying the proxy while violating the property: a filter that *deliberately*
uses regex syntax (`-t 'AC-(1|2)'`) — legitimate, and it would be refused. This is the central
design tension: the fix MUST NOT make deliberate regex use impossible. State how (an explicit
opt-out flag, or refusing only when the pattern also matches zero) and justify it.

**Silence.** The current state is pure silence: zero-match is reported as success. The fix must
make it speak. ⚠ A refusal that authors route around by dropping `-t` entirely (running the
whole file) is an acceptable outcome; one that routes them to `--oracle manual` is not — the
same escape-hatch pressure already recorded for the precheck's false refusals.

**Opt-in.** If a deliberate-regex opt-out is added, it is an opt-out from a safety check and
must be recorded in the evidence row, not merely accepted silently.
