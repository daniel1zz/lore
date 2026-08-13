---
id: TASK-719
type: task
role: plan
title: "The --cwd blind spot is a CLASS, not one function: lore done's unfiltered-run floor also strips only a 'cd' prefix, so obeying this repo's own no-cd discipline makes a task un-archivable"
status: draft
priority: medium
created: 2026-08-12
updated: 2026-08-13
tags: []
parent: PRD-001
---
Second confirmed site of the same defect filed as 01KZV3XFFY7SEZ9E11NZDC81W8, with a worse consequence.

packages/core/src/attestation-completeness.ts::commandRunsFileUnfiltered:

    const { offset, rest } = stripCdPrefix(command);
    const target = normalizeForComparison(filePath);
    for (const token of tokenizeCommand(rest)) {
      if (token.length === 0 || token.startsWith('-')) continue;
      const joined = offset.length > 0 ? `${offset}/${token}` : token;
      if (normalizeForComparison(joined) === target) return true;
    }

The only recognised root-shifting form is a literal 'cd <dir> &&' prefix. With 'bun test --cwd packages/lore tests/integration/x.bun.test.ts', offset is empty and the token is 'tests/integration/x.bun.test.ts', which never equals the anchor 'packages/lore/tests/integration/x.bun.test.ts'. The '--cwd' flag token is skipped by the startsWith('-') guard and its VALUE is compared as an unrelated token.

Measured 2026-08-13: task-ac-own-5-s-oracle-exercises-only-the-pure-verdict-function carries TWO attested, unfiltered, result:pass rows whose command is exactly 'bun test --cwd packages/lore tests/integration/territory-replay.bun.test.ts 2>&1 && echo ...' against the declared anchor 'packages/lore/tests/integration/territory-replay.bun.test.ts'. lore done refused with exit 4, reporting no attested unfiltered pass for that anchor.

Why this is worse than the first site. This repo's CLAUDE.md forbids putting a 'cd' in front of a measurement, because zoxide shims 'cd' and the following '&&' can short-circuit silently - a documented false-oracle vector. The only command shape this floor understands is that forbidden one. An author who follows the discipline produces a task that cannot be archived, and the tool's own remediation text points at 'lore evidence --result pass', which is a SELF-REPORT and produces no attestation block, so pasting it cannot satisfy the very floor that printed it.

A third form works and is understood by both: 'bun test packages/lore/tests/integration/x.bun.test.ts' run from the repo root - measured exit 0 on the same 6 tests. Nothing documents that this is the only shape that satisfies both gates.

---

## ADJUDICATION 2026-08-13 — the sibling fix closes the FIRST form, NOT this one

`task-the-cwd-blind-spot-is-one-defect-at-two-call-sites-both` landed in main as
`804360d2` (merge `41354aa2`) with AC-OX-4 attested green. It deleted
`commandRunsFileUnfiltered`'s private `stripCdPrefix` and delegated to
`oracle-file-existence.ts::extractCdPrefixTarget`, which scans the WHOLE `&&`/`;` chain
instead of only a leading segment. That fixed a real regression this report did not name:
this repo's own mandated compiled-e2e shape (`bun run build && cd packages/lore && bun
test <file>`) carries its `cd` in the SECOND segment, so the floor returned false for it.
One shared cd-prefix mechanism now serves both call sites.

⛔ THE FORM THIS REPORT NAMES IS STILL UNRESOLVED. `bun test --cwd packages/lore
tests/integration/x.bun.test.ts` remains unrecognised, and the implementer's reasoning for
declining it is sound and should not be silently overturned: the offset exists ONLY inside
a `--cwd` flag's value in the command text. No caller-held fact — the claim's `worktree`,
`attestation.execution_root`, `corpusRoot` — can produce it, so recognising it means
parsing another command-embedded flag, i.e. re-introducing exactly the guess the fix
removed. Widening the parser is therefore the WRONG fix and is explicitly out of scope.

## What remains, restated as the actual defect

Two discipline-compliant shapes already satisfy the floor today, both verified by the
implementer: a plain repo-root-relative path with no embedded `cd`/`--cwd`, and
`lore verify --execution-root <dir>` for an AC command that genuinely needs a
subdirectory root — an explicit, caller-held fact.

So the live defect is NOT the parser. It is the REMEDIATION TEXT, which this report
already identified and which nothing has changed: when the floor refuses, it points the
author at `lore evidence --result pass`, a SELF-REPORT that produces no `attestation`
block and therefore structurally cannot satisfy the floor that just printed it. An author
following the printed advice cannot succeed. The fix is to make the refusal name the two
shapes that DO work — root-relative path, or `--execution-root` — and never name a
self-report path.

⛔ Do not close this report against `804360d2`. Its parser half is resolved and its
remediation half is untouched.
