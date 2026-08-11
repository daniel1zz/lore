---
id: KN-266
type: knowledge
role: knowledge
title: "2>&1 | jq is >/dev/null wearing a parser: asking for --json does not license discarding lore's advisory stream"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## The finding

`<lore-cmd> --json 2>&1 | jq …` is a self-inflicted output-discard. It merges the
advisory stream into the JSON stream, which (a) corrupts the parse and (b) hides
the advisory — and the resulting `jq: parse error` reads like a cosmetic tooling
hiccup rather than like the warning it actually is.

The corpus-workflow governance snippet already forbids the obvious form of this
("never `lore set … >/dev/null 2>&1`"). This is the same prohibition in a shape
that looks like careful engineering: asking for machine-readable output and
parsing it.

## Measured, 2026-07-31 (orchestrator's own error, not the tool's)

Creating a retro:

```
lore create knowledge --sub-type retro … --json 2>&1 | jq -r '(.data.doc // .data) | …'
→ jq: parse error: Invalid numeric literal at line 26, column 4
→ created=knowledge-a-control-that-shares-the-load-with-the-observation status=approved
```

The doc was created, the slug printed, and the run was treated as fine. Forty
minutes later `lore status --check-tree` reported `orphan: knowledge has no
parent but is not a root type` — that doc, missing `--parent`.

**lore had said so at the time.** `adapters/cli/commands/create.ts:597-599`:

```ts
const orphanAdvisory = (doc as { orphan_advisory?: string }).orphan_advisory;
if (typeof orphanAdvisory === "string") {
  process.stderr.write(`⚠ ${orphanAdvisory}\n`);
```

with the in-place comment `Loud orphan (D11, never silent)` and its own
originating task (`task-create-time-orphan-advisory-warn-or-default-…`). The
mechanism worked exactly as designed. `2>&1` folded the `⚠` line into jq's input,
jq died on it, and the advisory scrolled past as a parse error.

## The sharper half

The parse error WAS diagnosed correctly in the moment — reasoned at the time as
"the jq parse error is because lore printed a warning line before JSON; the doc
exists" — and then not acted on. Recognising that output was discarded is not the
same as recovering it. A correct diagnosis that terminates in "moving on" leaves
exactly the same hole as no diagnosis at all, and costs more, because it retires
the suspicion.

## Mechanization

1. **Never `2>&1 | jq`** on a lore command. Route the two streams separately:
   `lore … --json 2>/tmp/err > /tmp/out; jq … /tmp/out; cat /tmp/err` — or at
   minimum `2>/dev/tty`. The streams are separate BECAUSE one is data and one is
   advisory; merging them destroys both properties.
2. **A `jq: parse error` on lore output is an unread advisory until proven
   otherwise.** It is never "just a shape mismatch" — re-run without the pipe
   and read what came out. Treat it the way a failing oracle is treated, not the
   way a typo is.
3. When a `--json` consumer must exist, prefer `lore … --json > file` then parse
   the file, so the raw payload survives for inspection after the parse fails.

## Standing form

> Asking for `--json` does not license discarding stderr. `2>&1 | jq` is
> `>/dev/null` wearing a parser.

## Source

Orchestrator self-audit during the 2026-07-31 remediation session, caught by
`lore status --check-tree` (drift repaired with `lore link … --type parent`).
Related: the corpus-workflow "never discard lore's own output" rule, which this
violates in an unlisted form.
