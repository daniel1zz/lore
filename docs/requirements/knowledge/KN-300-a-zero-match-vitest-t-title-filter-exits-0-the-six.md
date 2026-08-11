---
id: KN-300
type: knowledge
role: knowledge
title: "A zero-match vitest -t title filter exits 0 — the sixth false-oracle face"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
---
## What was measured

Verifying a returning implementer's AC oracle on `main` at f1b03e4, a deliberately
non-matching vitest `-t` title filter was run as an independent control:

```
bunx vitest run packages/lore/tests/unit/cli/decision-status-validation.test.ts \
  -t 'zzz-no-such-title-zzz' > out 2>&1; echo $?
EXIT=0
 Test Files  1 skipped (1)
      Tests  17 skipped (17)
```

**A zero-match `-t` title filter exits 0.** Every test in the file is reported
`skipped` and the process succeeds. Exit code carries no information about
whether anything was measured.

The control run for the same file with the real filter:

```
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

## Why this matters — it refines a standing lesson that is currently imprecise

The repo's CLAUDE.md "five false-oracle vectors" lesson states, for vector (1):
*"vitest silently drops non-matching path filters, PARTIAL match exits 0
(zero-match exits 1, loud)"*.

That parenthetical is true for **path** filters and **false for `-t` title
filters**. The two behave differently:

| filter | zero match | consequence |
|---|---|---|
| path (`vitest run <file>`) | exit 1 — LOUD | a mistyped path is caught |
| title (`-t '<phrase>'`) | **exit 0, all skipped — SILENT** | a mistyped/drifted title reads as PASS |

Since essentially every AC in this corpus pins its oracle as
`... -t '<title>'`, the silent variant is the one that actually governs
acceptance. A drifted, renamed, or remembered-not-copied `describe`/`it` title
therefore produces an oracle that exits 0 having executed nothing — and
`lore evidence --result pass` derived from that exit status is a fabricated
pass, indistinguishable in the corpus from a real one.

This compounds the already-recorded **contiguous-substring assumption**: `-t`
matches a substring of the concatenated describe+it name, so a filter built
from a remembered phrase rather than a copied literal degrades to zero-match,
which is exactly the silent case.

## The rule that follows

For any `-t`-filtered oracle, the verdict is the **matched count**, never the
exit code:

- assert `Tests N passed (N)` with N > 0, and that no line reads `skipped`;
- treat `Tests 0 passed` / `N skipped` as FAIL regardless of exit status;
- pair every filtered run with a deliberately non-matching control ONLY to
  demonstrate the filter is live — but note the control exits 0 too, so the
  control's signal is the `skipped` count, not its exit code.

## Where the mechanization reaches — and where it does not

Measured, not assumed. `lore verify`'s runner DOES guard this:
`packages/lore/src/service/verify-runner-service.ts` carries a
`--testNamePattern` matched-CASE count guard (`hasCaseFilter`, ~:586) and
downgrades the AC when `completeness === "zero_match" || "under_match"` (~:602),
alongside the declared-test-path completeness check (~:190-191) and the
build-freshness precheck (~:108, AC-061-9). So a scripted AC executed
**through `lore verify`** is protected — the exit-code-derived verdict
(`deriveVerifyResult(exitCode, timedOut)`, :545) is not the last word.

The gap is the OTHER path, which is the one an implementer subagent actually
takes:

```
agent runs:  bunx vitest run <file> -t '<title>'   →  exit 0, 17 skipped
agent runs:  lore evidence <task> --result pass --command "<that command>"
```

`lore evidence` records what the caller asserts. Nothing between the runner's
exit status and the corpus row re-derives the matched count. The verify-layer
guard is therefore not reachable from hand-recorded evidence, and hand-recorded
evidence is how every dispatched implementer reports.

Consequence for orchestration, applied immediately in this session: a returning
agent's `-t`-filtered `--result pass` is NOT accepted on its exit code. The
orchestrator re-runs the oracle on the merge target and reads the matched count
itself. That is a manual compensating control, not a mechanism — the mechanism
would be `lore evidence` refusing (or flagging) a `--result pass` whose
`--command` carries a `-t`/`--testNamePattern` filter without an accompanying
matched-count assertion, reusing the completeness classifier the verify runner
already owns.

## Provenance

Measured 2026-07-31 by agent:main-orchestrator on main at f1b03e4 while
merge-verifying task-t1-pure-decision-status-value-restriction-module (AC-DS-8).
Not inferred from documentation — both runs are reproducible with the commands
quoted above.
