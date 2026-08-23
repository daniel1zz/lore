---
id: TASK-773
type: task
role: plan
title: "Make the falsifier's negative control a permanent runnable oracle, and stop a stray packages/ directory from aborting materialization"
status: archived
priority: medium
phase: "P5-close-assess-findings"
created: 2026-08-23
updated: 2026-08-23
tags: []
parent: PLAN-135
plan: PLAN-135
---
Closes the two REAL findings lore assess raised on this plan (verdict partially_met 78/100). Both were machine-checked by the orchestrator before this task was written; neither is a judge artifact.

FINDING 1 (MAJOR, evidence_integrity) — the negative control left NO queryable evidence. The plan mandates one: declare a throwaway criterion whose falsifier mutation is deliberately inert and show lore verify --falsify REFUSES it instead of recording a red. It WAS run: an AC with find-text replaced by ITSELF and --falsifier-exit-code 1 produced exit 4 with "the mutated command actually exited 0 — the declaration does not match reality. Nothing recorded." ⛔ And that is exactly the problem: a refused falsify run records NOTHING, so the control is structurally unprovable from the corpus. Eight affirmative attested reds cannot be distinguished from a mechanism that says yes to everything.

Deliverable: scripts/falsifier-negative-control.ts — a self-contained oracle that builds a THROWAWAY corpus (mkdtemp + lore init, cwd inside it, ⛔ NEVER this repo .lore/), declares one AC with an INERT falsifier, drives the real lore verify --falsify, and asserts exit EXACTLY 4 AND that the output names the exit-code mismatch AND that no evidence row was persisted. It MUST print a one-line summary on the success path. Pair it with a positive control in the SAME script: a genuinely discriminating falsifier on the same throwaway corpus must reach exit 0 and persist an attested expected-fail row — otherwise the script cannot tell "refuses everything" from "refuses correctly".

FINDING 2 (MINOR, outcome) — AC-SD-1(e) prose says nested trees are found by "enumerating packages/*/node_modules", but the code iterates the DERIVED member list, and deriveWorkspaceMembers returns err on any directory under a workspace base dir with no readable package.json (verified: the `if (!memberJsonResult.ok) return memberJsonResult;` branch). So one stray directory under packages/ aborts materialization for the whole repo, and a nested node_modules under a non-member directory is invisible. Decide and implement ONE of: (a) skip non-member directories instead of failing loud, keeping the loud failure only for a directory that HAS a package.json which fails to parse; or (b) enumerate nested trees independently of member derivation. Whichever you pick, add a test in the existing describe "hybrid layout" or "derived workspace set" that constructs a fixture with a stray directory under packages/ and asserts the chosen behaviour, plus its RED. ⛔ Do not silently widen: if you choose (a), state in the code comment why a parse failure stays loud while an absent package.json does not.

ALSO FOR THE RECORD, already fixed by the orchestrator, do NOT redo: AC-SD-1 RED(i) was VACUOUS — findEscapingScopeEntries realpaths the entry but not the base, and /var is a symlink to /private/var, so an un-resolved base reported EVERY scope entry as escaping. Measured: a CORRECT hybrid layout returned ["core","dashboard","lore"] with the un-resolved base and [] with the realpath base. Fixed in commit "fix(test): AC-SD-1 RED(i) control was vacuous". A related cosmetic vacuity is left UNFIXED and is yours only if it is cheap: line ~607 asserts isInside(mutatedCorePath, scratch.worktreeDir) where mutatedCorePath was CONSTRUCTED by joining onto scratch.worktreeDir — always true, zero information.

Record every RED with lore evidence --result expected-fail at the moment it is red, from your worktree. Record an unfiltered --capture pass per declared test-file anchor. Stop at lore release.
