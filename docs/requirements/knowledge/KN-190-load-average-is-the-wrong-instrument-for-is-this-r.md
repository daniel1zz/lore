---
id: KN-190
type: knowledge
role: knowledge
title: "Load average is the wrong instrument for is-this-red-suite-my-fault: memory pressure fakes a code regression, and a failure COUNT is not a failure identity"
status: approved
priority: high
created: 2026-08-07
updated: 2026-08-07
tags: [retro, false-red, memory-pressure, diagnosis, timeout, starvation]
parent: PRD-001
links:
  - {id: KN-197, type: relates-to}
---
# Retro — load average is the WRONG instrument for "is this red suite my fault", and memory pressure fakes a code regression

Measured 2026-08-06/07 on `main @ 35ed6787`, clean tree. The bun runner went red twice at the same commit. It was not a code defect. Diagnosing it took two self-corrections, both worth recording because each was a plausible wrong turn.

## The signal, and why it looked like a regression

| run | commit | result | wall |
|---|---|---|---|
| baseline | `074df1cd` | 1825 pass / 0 fail | **584 s** |
| after Wave 5 | `35ed6787` | 1818 pass / **7 fail** | **6803 s** |
| re-run, same commit | `35ed6787` | 1818 pass / **7 fail** | **7074 s** |

A 11.6× slowdown appearing in the same wave that merged a validity refusal into the dispatch path and armed a new deterministic gate is an extremely inviting causal story. It was wrong.

## Self-correction 1 — "same count" is not "same failures"

I compared the two red runs by failure COUNT (7 and 7) and wrote that the failure "reproduced deterministically". Comparing the NAMES showed the two sets were **disjoint** — zero overlap across 14 failures. Seven is simply how many tests happened to exceed their timeout per run.

⛔ The lesson generalizes past this incident: a count is a hash with catastrophic collision behaviour. Two runs "failing 7 tests" says almost nothing; two runs failing THE SAME 7 says a great deal. Compare identities, never cardinalities — the same error this session made three other times, in matcher form (`grep -c` counting lines, an 8-char ULID prefix colliding, a marker matched inside a doc quoting it). `knowledge-the-substring-matcher-lesson-has-a-mirror-face-over` is the sibling lesson; this is its measurement-side twin.

## Self-correction 2 — load average said the machine was fine

`uptime` reported load averages of **2–10** throughout, on a machine where a code-caused slowdown would show saturation. That reading nearly closed the door on "environmental". It was the wrong instrument:

```
hw.memsize                16.0 GB
vm.swapusage              total 9216M   used 7920M   free 1295M
Pages free                5726  (= 94 MB)
Pages stored in compressor 1,658,758  (= 25.3 GB compressed)
Swapouts                  41,512,929
```

macOS load average counts **runnable** threads. Under memory pressure the processes are BLOCKED on page-in, so they are not runnable, so they do not appear in load — the machine can be catastrophically starved while `uptime` looks calm. The tell was elsewhere and it was blunt: a background sampler running `sleep 20` in a loop produced **24 samples across 118 minutes** — roughly one iteration per 295 s. A trivial sleep loop being starved 15× is not something a code regression can cause.

## The three measurements that actually settled it

1. **Spawn latency of the compiled binary**: 10 consecutive `./dist/lore --version` → 81 ms steady. If the merged code had made startup slow, this is where it would show. It did not.
2. **Isolation re-run of a failing file**: `cli-create-content-file.bun.test.ts` → **2.9 s, 5/5 pass, exit 0**, versus **898 s** for a single test inside the full run. A 300× gap between the same test in isolation and under load is a resource fact, not a logic fact.
3. **Failure mode**: every one of the 14 failures across both runs was `timed out after 30000ms` (one even exceeded a **600000 ms** timeout). Not one assertion mismatch. A code regression produces wrong VALUES; starvation produces missed DEADLINES.

## The rule

**Before attributing a red suite to the diff, measure whether the machine could have run it.** Three cheap checks, in this order, none of which requires re-running anything:

1. Are the failures **assertion mismatches or timeouts**? Timeouts across unrelated suites are a resource signal until proven otherwise.
2. Does a failing test **pass in isolation**, and how far apart are the two durations? An order-of-magnitude gap is decisive.
3. Read **memory**, not load: `sysctl vm.swapusage` + `vm_stat`'s free pages and compressor pages. ⛔ `uptime` alone will tell you the machine is idle while it thrashes.

## What must NOT be done about it

⛔ Raising the tests' timeouts. That is the textbook symptom-fix this repo forbids: the timeout is not wrong, the machine is oversubscribed, and a raised timeout would make the next genuine hang invisible.
⛔ Declaring it a "flake" and re-running until green. Two runs, disjoint failure sets, is exactly the shape that tempts this — and it would have shipped an unverified wave.
⛔ Retrying in a loop.

The legitimate responses are to lower peak concurrent memory (batch the runner — every file still runs, at the same commit, on the same clean tree; only whole-suite concurrency is given up) and to free memory at its source. On this machine the sources were long-lived residuals, not the suite: the suite leaked nothing (95 matching processes before and after, identical), while the box carried a `lore` process **8 days old**, several multi-day `node`/Chrome helpers, and **two live `agent-browser` sessions** — headless Chrome with swiftshader software rendering, which the operating discipline already names as a long-term CPU/memory drain that must be closed at task end.

## Residual, named

Nothing here is mechanized. A mechanized form would have the runner refuse to render a verdict when free memory is below a threshold at start — turning "my suite is red" into "this machine cannot render a verdict right now", which is a different and more honest claim. ⛔ But note the failure this would have to avoid: a memory precondition that merely WARNS is the advisory-nobody-acts-on shape this repo has already measured, and one that BLOCKS would make a constrained machine unable to test at all. That trade-off is unresolved, which is why this is a retro and not a task with a prescribed fix.
