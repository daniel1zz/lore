---
id: KN-478
type: knowledge
role: knowledge
title: "Three mechanism facts that lived only in source comments: the /$bunfs/ compiled-binary discriminator, the sibling exporter that rewrites the mirror mid-test-run, and why a verdict line must print last"
status: approved
priority: medium
created: 2026-08-18
updated: 2026-08-18
tags: []
parent: PRD-001
links:
  - {id: SPEC-134, type: informs}
---
Three mechanism facts that existed ONLY as source comments after
plan-land-bootstrap-fixpoint-integrity-binary-provenance-the closed. A comment is
readable by whoever opens that file; it is not addressable from the corpus, so a
session that never opens the file cannot find it. Each is recorded here with the
file:line that carries the full argument, so this doc stays a pointer and never
becomes a second, divergent copy.

## 1. The compiled-vs-source discriminator is `Bun.main.startsWith("/$bunfs/")`

SSOT: `packages/lore/src/service/binary-provenance.ts` §D2 (module header, and
`BUN_COMPILED_ENTRY_PREFIX` / `isCompiledBinary` around line 190).

`/$bunfs/` is Bun's virtual filesystem root for a `bun build --compile` binary's
embedded entry. Measured 2026-08-17 on Bun 1.3.x, three-way:

- compiled WITH `define` → `Bun.main = /$bunfs/root/entry.js`, provenance present
- the SAME source compiled WITHOUT `define` → `/$bunfs/root/entry.js`, provenance
  ABSENT (a `typeof` guard on an unsubstituted identifier yields `"undefined"`,
  never a ReferenceError)
- `bun run entry.ts` → `Bun.main` is the real on-disk path

The load-bearing property: the prefix separates compiled from source WITHOUT
depending on whether the injection happened. That independence is exactly what
lets "no provenance" split in two — a source run with no provenance is legitimate
(`bun run dev` never goes through `scripts/build.ts`) and exits 0 with `skipped`,
while a COMPILED binary with no provenance is a build defect and fails loud as
`provenance-missing`, exit 4.

⛔ Bun 1.3.x exposes no public `isStandaloneExecutable`. Do not go looking for one
and do not invent a second discriminator: the same prefix is already this
codebase's established signal at
`packages/lore/src/adapters/cli/report-issue-wiring.ts::InstalledBinaryContext.isCompiled`.

## 2. An ordinary `bun run test` rewrites this repo's own mirror, concurrently

SSOT: `scripts/tests/spec-mirror-content-drift.test.ts` module header, condition (ii).

Measured on `main` at `cedb29db`: one full `bun run test` moved the mirror
fingerprint `45ea1381 -> 4c84f428`. The cause is not a bug — the sibling suite
`scripts/tests/spec-mirror-export.ts` drives the REAL exporter against the REAL
production corpus BY DESIGN (AC-FR-6/7/10 require it), and vitest runs files
concurrently.

Consequences for anyone writing a mirror-drift oracle:

- An export-free setup in your own test does NOT establish isolation. A sibling
  file in the same vitest run can move the artifact under you.
- Inspecting the npm script chain misses this entirely: `check:spec-mirror` is
  `--check` only and `mirror:export` is chained from nothing. The chain is clean;
  the concurrency is not.
- The mechanism that actually holds is a `mkdtempSync` directory serving as BOTH
  the throwaway corpus and the `repoRoot`, plus a hash taken immediately after the
  mutation and re-read immediately before the assertion. The hash equality is the
  PROOF the isolation held on that run. Prose reasoning about why no other process
  can name the path is not the proof — the assertion is.

## 3. A verdict line must be printed LAST, or a tail-keeping consumer loses it

SSOT: `scripts/check-anchor-coverage.ts` around line 727 (the comment above the
final `console.log`).

Measured while landing that checker: with the verdict emitted FIRST, ahead of the
60-row-and-growing dispositioned-spec echo, `lore evidence --capture`'s 4000-byte
output-tail window kept only the trailing rows and dropped the verdict entirely —
an evidence record proving a run happened but not what it concluded.

Any consumer that keeps a TAIL sees the verdict only if the verdict is last:
`lore evidence --capture`, `lore verify`'s attested tail, a CI log excerpt, a
shell `| tail`. This generalises past this one script: it is a constraint on every
oracle whose output is longer than the evidence window, and it is why
script-mode ACs are required to end in
`… && echo '<AC-ID> PASS: <the specific fact proven>'` rather than open with it.

⛔ Do not "tidy" the verdict back up next to the census line.
