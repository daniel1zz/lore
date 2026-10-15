---
id: PLAN-123
type: plan
role: plan
title: "Land judgment verification: path-checked assess findings, a mirror-free diff, a worktree-rooted falsifier, and a close gate that asks about reds"
status: deprecated
priority: high
created: 2026-08-11
updated: 2026-10-10
tags: []
parent: SPEC-137
phases:
  - {name: "assess-verify", description: "AC-JV-1, AC-JV-2: declared finding paths verified against the assessed commit, unverifiable findings withdrawn not dropped, score untouched, mirror excluded from the diff"}
  - {name: "falsifier-root", description: "AC-JV-3: verifyFalsifier resolves through SPEC-063 resolveVerifyExecutionRoot so a worktree falsifier sees its own uncommitted code"}
  - {name: "close-gate", description: "AC-JV-4: attestationFloor gains a scoped falsifier clause. DISPATCH LAST — it blocks every sibling plan carrying a falsifier-declaring AC"}
---
# Goal

Land the three ACs (AC-JV-1 … AC-JV-3) of
`spec-judgment-surfaces-must-verify-before-they-certify-machine`. Each exists because a governance
surface certified something it never checked, and the check it skipped was mechanically decidable.

## Phases

**Dispatch 1 — `assess-verify` (AC-JV-1, AC-JV-2).** Findings declare their paths, every declared path
is verified against the commit resolved from `extra.diff_source`, an unverifiable finding is withdrawn
into `unverifiable_findings[]` rather than dropped silently, the judge's `overall_score` is left
byte-identical, and the generated mirror leaves the diff before truncation.

Dispatch 1 also owns the THIRD verification state: `paths_verified` is
`{ checked, unverifiable, unchecked }`. `unchecked` is the `explicit_diff_text` case — no range and no
`commits[]`, therefore no referent — where verification is SKIPPED, ⛔ never hard-failed, ⛔ never
silently counted as verified, and ⛔ never resolved against `HEAD` (which would be the original defect).
`unchecked` MUST render distinctly from `checked`: the entire point is that a reader cannot mistake "we
did not look" for "we looked and it was fine".

The per-mode referent is pinned by the spec's D2 and is not an implementer choice: `explicit_diff` /
`explicit_diff_file` with range `A..B` → **`B`**; `auto_derived` with `commits[]` → the **newest** entry
(⛔ not every commit — a file added mid-range exists at the tip and not at the earliest commit);
`explicit_diff_text` → `unchecked`.

**Dispatch 2 — `falsifier-root` (AC-JV-3).** `verifyFalsifier` resolves through SPEC-063's
`resolveVerifyExecutionRoot`, so a falsifier run from a linked worktree sees that worktree's uncommitted
code instead of the main checkout's. Independent of Dispatch 1 — no anchor intersects — so the two run
CONCURRENTLY, each in its own linked worktree.

**Dispatch 3 — `close-gate`: ⛔ DEFERRED, NOT dispatched, and its task has been withdrawn.** The
`attestationFloor` falsifier clause and its exemption ledger are split out of this spec entirely; the
spec's `## Deferred` section carries the full reasoning. In short: six review rounds each exposed a real
hole in the exemption design, and the last reached one that is not fixable by wording — the corpus does
not record when an acceptance criterion was authored (`lore ac add` does not demote, so a criterion can
be appended today to a spec whose plan archived last month), so no arming-window predicate over criteria
is decidable; the ledger would be an ordinary editable file while ledger PRESENCE is sufficient for
exemption; and the arming plan would self-exempt its own criteria. The `close-gate` phase remains
declared but empty. ⛔ Do not re-add a task to it in this plan — the successor spec owns it.

## Sequencing Risks

- **AC-JV-3's reverse control is mandatory.** Asserting only that the worktree-rooted falsifier sees the
  uncommitted change cannot distinguish "resolved correctly" from "happened to pass"; the
  `config.repoRoot` path must be shown NOT to see it, in the same oracle.
- **`paths` must default to `[]`.** A required field would make every stored assessment fail to parse.
  `@lore/core`'s default barrel must stay browser-safe — the dashboard imports it and a Node import
  there blanks the SPA — so the git-based verification lives in `packages/lore/**`, never in the schema
  module.
- **A missing commit must fail LOUD**, naming the commit. Treating "cannot resolve the commit" as "path
  absent" would silently convert an environment problem into a withdrawn finding, which is the same
  false-negative class this plan exists to remove.
- **Dispatch 2 changes what `lore verify` accepts.** It must not merge while another plan is
  mid-attestation.
- **`bun run typecheck` exits 2 for ANY compile error under `--noEmit`** (measured against this repo's
  `node_modules/.bin/tsc` 5.9.3; `TS18003` "nothing was checked" also exits 2). So a typecheck oracle
  discriminates by the ERROR CODE in the output, never by the exit code, and ⛔ never by "nonzero".

## Out of Scope

`max_diff_chars`'s non-shipping default (code 24000 vs this repo's 80000) — a distribution defect owned
by the governance-distribution spec. The `--capture` mislabel at
`packages/lore/src/adapters/cli/commands/evidence.ts:429`. Re-scoring or re-authoring any existing
assessment: the spec's D3 changes what future assessments record and does not rewrite history. And the
whole of the deferred falsifier close-gate above.
