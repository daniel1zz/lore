---
id: TASK-743
type: task
role: plan
title: "Force AC-BFI-13's red inside a throwaway corpus that owns its own spec and anchor"
status: draft
priority: high
phase: "two-follow-ups"
created: 2026-08-21
updated: 2026-08-21
tags: []
parent: PLAN-133
plan: PLAN-133
---
# Task Objective

Turn `AC-BFI-13`'s red from declared debt into a machine-measured fact, by giving the
anchor-value assertion a throwaway corpus that owns its own spec and anchor.

# Spec Reference

`spec-bootstrap-fixpoint-integrity-binary-provenance-an-anchor`, `AC-BFI-15`.
Read the statement with `lore ac list` — it is the contract.

`AC-BFI-13` (already `⚑✔`, 1 attested, measured 2026-08-21) requires case (d) of
`packages/lore/tests/integration/pre-push-trip.bun.test.ts` to assert the spec's stored
`code_anchors` VALUE, not merely that `lore status --check-drift` exits 0. It does. What was
never done is prove that assertion can FAIL: forcing it would mean repointing an anchor in
this repo's live corpus, which is a destructive edit to the team's knowledge base.

# Why this is not just discipline paperwork

Measured corpus-wide 2026-08-21
(`knowledge-the-falsifier-mechanism-is-shipped-but-inert-a` §F3): 279 evidence rows carry
`result: "expected-fail"` and exactly **2** carry an `attestation` block. So across this
corpus, "a red is recorded" and "the oracle was machine-proven to discriminate" differ by
138x. Almost every red is self-reported. This task closes that gap for one criterion by
construction, which is worth more than another prose reminder.

# What to build

A fixture-driven pair of cases inside the existing trip suite, under a describe block whose
name contains `fixture-forced-anchor-red`:

1. Create a corpus with `mkdtemp` + `lore init`, cwd inside it. ⛔ Never this repo's `.lore/`.
   The canonical throwaway-corpus pattern is `packages/dashboard/tests/e2e/global-setup.ts`;
   sibling suites in `packages/lore/tests/e2e/` show the compiled-binary variant.
2. In that corpus, create a spec that declares a `code_anchors` entry pointing at a file the
   fixture also creates.
3. GREEN direction: assert the stored anchor value names that file AND `--check-drift` exits 0.
4. RED direction: repoint the fixture spec's anchor to a DIFFERENT existing file, then assert
   the SAME assertion path exits nonzero and its message NAMES the anchor it actually found.
   ⛔ Asserting only that drift is clean is what AC-BFI-13 already does and is insufficient —
   a clean drift is consistent with the anchor having been repointed to any existing file,
   which is precisely the hole AC-BFI-13 was written to close and could not demonstrate.
5. ⛔ Resolve the binary through the freshness-asserted `DIST_BINARY` constant the sibling
   suites already use. A bare `lore` on `PATH` resolves to this machine's global symlink, not
   this build, and would make the test assert something about a different binary.

⛔ Assert the exit code is EXACTLY the expected value, never merely "non-zero". A tool that
dies early for an unrelated reason also exits non-zero, and that is how a reverse-control
probe ends up with zero discriminating power.

# Verification discipline

- ⛔ Red first, recorded by YOU in this worktree at the moment it is red:
  `lore evidence <this task> --oracle test --command "<cmd>" --result expected-fail`.
- ⛔ The AC pass must be ATTESTED: `lore verify plan-close-the-two-bootstrap-fixpoint-follow-ups-one-anchored --task <this task>`.
  `lore evidence --capture` is NOT attested and does not count for an AC.
- ⛔ Run AC-BFI-15's own declared red: delete the repoint step and confirm the failing-direction
  case stops failing. Then restore it.
- ⛔ Do NOT run `lore ac set` — it demotes the governing spec and would freeze your sibling
  task's claim. The orchestrator declares falsifiers after both tasks merge.
- ⛔ This file is `.bun.test.ts`: it runs under `bun test` only, never vitest.
  `bun run test:changed` is structurally blind to `.bun.test.ts` via `vitest --changed`, so run
  it explicitly.
- ⛔ `AC-BFI-11` and `AC-BFI-13` both live in this same file and must stay green — run the
  WHOLE file unfiltered, not just your new block.
- ⛔ The suite drives the compiled binary, so `bun run build` must be current before you
  measure. Check `lore status --check-binary-provenance` (exit 0 = built from HEAD) and rebuild
  in your worktree if it is stale.

# File Anchors

- `packages/lore/tests/integration/pre-push-trip.bun.test.ts`
