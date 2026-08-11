---
id: TASK-366
type: task
role: plan
title: "lore get's default render silently omits structured extra (issue_report), with no marker that it did"
status: archived
priority: high
created: 2026-08-03
updated: 2026-08-06
tags: []
parent: PRD-001
---
# Defect — `lore get`'s default render silently omits structured `extra`, with no marker that it did

`lore get <slug>` prints the doc's `content` plus a Navigation block. For a task carrying
`extra.issue_report` — the reporter's `expected` / `actual` / `repro_command`, i.e. the measured
evidence the whole doc exists to convey — **none of it is printed, and nothing indicates that a
field was withheld.** A reader cannot distinguish a doc with no `extra` from a doc whose `extra`
was not shown.

Measured 2026-08-03 on `main @ 6788989`, `task-lore-uat-record-bu-jiao-yan-mu-biao-doc-lei-xing-verdict`:

| command | shows `extra.issue_report`? |
|---|---|
| `lore get <slug>` | NO — content + Navigation only |
| `lore get <slug> --json` | YES — under `data.doc.extra.issue_report` |

Real cost, same session: the orchestrator authored a full 5.6 KB implementation spec on a wrong
mechanism assumption. The refutation was sitting in `extra.issue_report.actual` ("传 ADR slug →
创建 knowledge-uat-adr-… 并 informs 该 ADR"), invisible to the read command. Three acceptance
criteria asserted against a field that does not exist; the spec required a full rewrite.
Full write-up: `knowledge-lore-get-s-human-view-hides-extra-issue-report-so-a`.

# Mechanism root — a projection presented as the document

The human render is a projection of the record, and a lossy projection with no loss marker is
indistinguishable from a complete one. This is the silent-omission shape lore polices everywhere
else: the failure is not that data is missing, but that its absence is unobservable. A reader who
DID run the documented read command, and read all of its output, still ends up with a false model
of the doc.

⛔ Note this is NOT fixed by telling authors to "always use `--json`" — that is prose, the layer
this repo has repeatedly measured as the wrong one. The render itself must stop hiding.

# Scope to decide (state the choice and its reasoning in the JSDoc)

- **Option A — render the structured `extra` fields** (at minimum `issue_report`) as a section in
  the default view. For: the read command shows the document. Against: `extra` is an open bag;
  decide precisely which shapes render and what happens to unknown keys, or the fix becomes a
  moving target.
- **Option B — keep the projection but make the omission LOUD**: a marker naming which structured
  fields exist and are not shown, plus the exact command that shows them. For: bounded, works for
  every current and future `extra` shape. Against: the reader still needs a second call.

⛔ Whichever is chosen, the invariant to satisfy: **no reader can consume `lore get`'s output and
be unable to tell that structured content exists.** Decide across all doc types with structured
`extra`, not just `issue_report` — verify which those are before choosing.

# Acceptance criteria

- **AC-1** for a doc carrying `extra.issue_report`, the default `lore get` output makes the
  field's existence observable (rendered under Option A, or announced under Option B). Assert on
  two independent lone tokens, never one remembered sentence.
- **AC-2** NEGATIVE control: for a doc with NO structured `extra`, no marker/section is emitted —
  a fix that always prints something would pass AC-1 vacuously.
- **AC-3** the sweep result IS part of this task's scope: enumerate every doc type with structured
  `extra` that the default render currently drops, and state per type whether it is covered.
  ⛔ Do not assume `issue_report` is the only one.
- **AC-4** REGRESSION: `--json` output is byte-identical to today; `--resolve-mdx` behaviour
  unchanged.
- **AC-5** STATE: an invalidated doc still shows its banner, and the new section/marker does not
  displace it.
- **AC-6** `bun run typecheck` clean; `bun run test:changed <base>` passes with a NON-ZERO
  selection (loud-zero rule).
- Six-dimension coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

# Proxy / Silence / Opt-in (binding — `adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the`)

**Proxy.** "I ran `lore get` and read all of it" is a proxy for "I read the document". Concrete
input satisfying the proxy while violating the property: the measured case above. The fix makes
the two coincide, or makes the gap announced.

**Silence.** Total: the omission produces no output at all, which is why a careful reader is
affected identically to a careless one.

**Opt-in.** None; the render is unconditional. ⛔ Do not put the fix behind a flag — an opt-in
loss-marker leaves the default read exactly as misleading as it is today.
