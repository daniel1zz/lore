---
id: TASK-703
type: task
role: plan
title: "A captured evidence row observes the exit code, validates against it, then discards it — so runner-captured passes cannot archive their own task"
status: draft
priority: high
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Carried forward as NS3 from `knowledge-handoff-agent-main-orchestrator-98` (finding 9 of that session's retro), then RE-MEASURED on 2026-08-12 by agent:main-orchestrator — which corrected the inherited description before filing it. Read the correction first; acting on NS3 as written would have produced a fix for a defect that no longer exists.

## What NS3 claimed, and what is actually true

NS3 said: *"`--capture` requires `--result` although it knows the spawned exit code, so a captured row's verdict is still typed by the recorder and can contradict its own tail."*

**The contradiction half is FALSE today.** Measured in a throwaway `mktemp` corpus (never this repo's):

```
lore evidence <task> --oracle test --command "echo 'fake summary: 5 passed'; exit 1" --result pass --capture
→ exit 4
Error: Validation failed on field 'result': --capture ran --command and observed exit
code 1 — declared --result "pass" does not match (pass requires exit 0;
fail/expected-fail requires nonzero). Recorded nothing; fix --result or --command and retry.
```

A control in the same corpus (`exit 0` + `--result pass`) was accepted, so the refusal tracks the mismatch rather than refusing every capture. `evidence-capture.ts`'s module header states this contract explicitly (Q1: "the declared/observed exit-code agreement (cross-checked below, mismatch → refusal, nothing recorded)"). A captured verdict CANNOT contradict its own run.

The 600s-window half of the old complaint is also already fixed — `task-lore-evidence-capture-has-a-hard-coded-600s-window-that-a` replaced the module constant with `resolveCaptureTimeoutMs`, and a timeout is now a distinct measured outcome naming the window, the elapsed time, and the config knob, rather than being rendered as a spawn failure.

## The real defect: the exit code is OBSERVED, USED, and then DISCARDED

Measured shape of an accepted captured row (all fields, same probe corpus):

```
keys: [capture_source, command, oracle, output_tail, recorded_at, recorded_by, result]
result: "pass" | capture_source: "runner" | attestation: absent | exit_code: ABSENT
```

The runner spawned the command, observed exit 0, and validated the declared result against it — then persisted neither the exit code nor an attestation block. So the strongest fact `--capture` establishes exists only for the duration of one validation and is never written down.

The downstream consequence is not theoretical. Measured on `task-the-http-exemption-is-conditional-on-where-lore-serve-was` after a full implementer cycle: 9 evidence rows, **6 of them `result: pass` with `capture_source: "runner"`, zero attestation blocks**. `lore done`'s attested-pass floor accepted none of them, so the orchestrator had to run a separate `lore verify --task` purely to mint one attested row. The implementer did everything right — real runner output, cross-checked verdicts — and still produced nothing that could archive their own task.

## Why this is a mechanism defect, not a discipline one

The information is already in the runner's hands at the moment of the write. No amount of recorder discipline can persist a field the write path does not carry, and no wording of a guidance document changes what `lore done` reads. This repo has already recorded that a defect covered by existing prose is proof the prose layer is the wrong layer.

## What must land

1. A captured row PERSISTS the observed exit code — as an `attestation` block if that is what `lore done` reads, so a `--capture` row can satisfy the attested-pass floor on its own. If there is a deliberate reason capture must NOT count as attestation while `lore verify` does, that reason belongs in the spec as a named exemption with its argument, exactly as §D5's two exemptions are written — currently it is neither asserted nor argued anywhere.
2. Decide and record whether `--result` should remain REQUIRED once the exit code is persisted. It is no longer a correctness risk (mismatches are refused), so this is an ergonomics call, not a safety one — argue it rather than assuming either way.
3. Oracle, two-sided: (a) a captured row carries the observed exit code and `lore done` accepts it with no separate `lore verify` run; (b) the mismatch refusal still fires — construct `--result pass` against a nonzero-exit command and assert exit 4 with NOTHING recorded. ⛔ Half (b) is not optional: a fix that persists the exit code by relaxing the cross-check would pass (a) while destroying the property this task just confirmed works.
4. ⛔ Update the standing lesson that says a captured verdict is "still typed by the recorder". That is now false and is the reason NS3 was carried forward in the wrong shape for a full session. Whatever replaces it must name the surviving gap precisely: the exit code is observed and validated but not persisted.
