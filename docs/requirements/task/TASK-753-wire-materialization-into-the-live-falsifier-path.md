---
id: TASK-753
type: task
role: plan
title: "Wire materialization into the live falsifier path and prove it from the CLI, without disarming the green control"
status: draft
priority: medium
phase: "P3-production-wiring"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-135
plan: PLAN-135
---
Capability implemented is not production wiring. The P1 module can be perfect and the falsifier still record inconclusive forever if nothing calls it — this repo has measured that shape three times, so this task is the same acceptance unit as P1, split out only because its oracle is an integration test.

AC-SD-6 (integration test file): call the materializer from _runFalsifier in verify-runner-service.ts, BEFORE the green control runs, so the control measures the materialized environment. Then prove it at the surface: a real lore verify --falsify invocation, driven as the CLI against a THROWAWAY corpus (mkdtemp + lore init, cwd inside it — ⛔ NEVER this repo .lore/), over a fixture AC whose falsifier declares --falsifier-exit-code 1, must PERSIST an evidence row with result expected-fail whose attestation exit_code is EXACTLY 1, read back OUT of the throwaway corpus rather than from a spy, with the CLI exiting EXACTLY 0. RED (i): disable materialization and the row must become inconclusive with no attestation — that is what proves materialization is the cause and that the control still works.

AC-SD-7 (describe "green control still fires", in the unit test file): materialization must NOT disarm AC-FR-11. A command naming a test file that exists in the working tree but is UNTRACKED — so git stash create omits it — must still record inconclusive with NO attestation and never expected-fail. RED (ii) is a scope guard: making materialization also stage untracked files must FAIL this criterion, because that is a scope change needing its own spec, not a silent widening.

Read both criteria verbatim via lore get on the spec first. Record each RED direction with lore evidence --result expected-fail at the moment it is red, from this worktree.
