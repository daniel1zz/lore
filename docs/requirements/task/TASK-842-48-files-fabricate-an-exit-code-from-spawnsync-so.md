---
id: TASK-842
type: task
role: plan
title: "48 files fabricate an exit code from spawnSync so every ENOBUFS reads as exit 1: the spawnSync audit needs a ratcheted check script"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: [silent-fallback, oracle-design, enobufs, ratchet]
parent: PRD-001
links:
  - {id: KN-528, type: relates-to}
---
MEASURED 2026-08-25 by agent:main-orchestrator on main @ 4aad2e1c. This is ticket 121's NS-item "spawnSync audit needs a check script", carried unfiled through tickets 127 and 131. It is filed now because the population is measured rather than suspected.

## Why a check script and not 48 edits

`spawnSync` reports a `maxBuffer` overflow as `status: null` plus `error.code: "ENOBUFS"` — never as a nonzero exit code. So `result.status ?? 1` (or `?? -1`) does not "default"; it FABRICATES an exit code the child process never returned, and the accompanying `stdout`/`stderr` are truncated or empty. The caller then reports an infrastructure failure as a command that ran and exited 1.

That is not hypothetical. It cost this repo a full diagnosis pass on 2026-08-24 (`knowledge-corpus-growth-crossed-three-hard-coded-thresholds-in`, Failure 1) and again on 2026-08-25, where `scripts/tests/spec-mirror-export.test.ts` reported `test setup: lore list --type knowledge --json --include-invalid failed (exit 1):` with a completely empty stderr while the real cause was a 23,180,068-byte payload against a 20,971,520-byte cap. The approved doc names `?? 1` as "the repo's own banned pattern" — `⛔ 禁止无声 fallback` — sitting in a helper whose own comment claims it obeys the anti-truncation discipline. **Obeying a discipline is not the same as being safe**, and prose has now failed to prevent this three times.

## The census

Lexical scan over every `*.ts` / `*.mjs` under `packages/`, `scripts/`, `hooks/` containing `spawnSync(`:

| | files |
|---|---|
| contain `spawnSync(` | 220 |
| **A. fabricate an exit code via `status ?? N` with NO `ENOBUFS` / `.error` / `status === null` guard anywhere in the file** | **48** |
| B. fabricate one but DO also guard | 22 |
| C. neither pattern | 150 |

⛔ **48 is a LOWER BOUND, not the total, and this census is LEXICAL, not semantic.** Category C is not a clean bill: a file that reads `result.status` directly with no fallback lets `null` propagate into a numeric comparison, which is arguably worse than a fabricated 1 because `null === 0` is false and `null !== 0` is true — a truncated run reads as a FAILURE in one comparison and as a non-success in the other, with no diagnostic either way. Any check script must decide category C deliberately rather than inherit this scan's blind spot.

⛔ Do NOT treat the 48 as a list to sweep and close. The scan cannot see a spawn wrapped behind an indirection, and `spec-a-test-case-s-timeout-budget-must-be-declared-when-its` D1 already accepted exactly that limitation for its own structural oracle ("lexical counting cannot see a spawn hidden behind an indirection; accepted, because the threshold only needs to catch the DIRECT shape that actually caused this"). Same accepted trade, same reasoning — but it must be STATED in the script, not discovered by the next reader.

One measured irony worth keeping, because it is the argument against prose: `packages/lore/tests/integration/cli-stdout-truncation.test.ts` — a test file about stdout truncation — is itself in category A.

## Scope

- A repo script with its own npm-script entry, alongside `check:test-budgets` (whose D3 settled this hosting question: `lore status` checks corpus facts; this is a source-structure fact about this repo's own code, and lore's binary must not grow a check only its own repo can use).
- ⛔ It must FAIL LOUD on a file it cannot parse, naming the path. `spec-a-test-case-s-timeout-budget-must-be-declared-when-its` D5: "a silently skipped file is indistinguishable from a clean one."
- A ratchet, not a cliff: 48 pre-existing instances mean a check that demands zero is unlandable. Pin the current count as a baseline that may only decrease — and ⛔ budget the sweep plus a written exemption list in the SAME slice, per `knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`, which records that a new deterministic gate retroactively invalidates the whole back-catalogue.

## Falsifier

⛔ Not "the script exits non-zero on a bad file" — a script that crashes on startup also does that. Three conjuncts:
(a) a file with `status ?? 1` and no guard is REPORTED, naming the file and the line;
(b) GREEN CONTROL in the same run: a file with `status ?? 1` that DOES check `error`/ENOBUFS is NOT reported — otherwise the script is just a `status ??` grep with no discriminating power;
(c) the ratchet holds: adding one new category-A instance makes the count exceed the pinned baseline and the script exits non-zero naming the new file.
Smallest mutation that turns it red: delete the guard-detection branch — (b) then fails. ⛔ Assert the exit code EQUALS the script's documented code, never merely "non-zero": a parse crash also exits non-zero and has zero discriminating power.
