---
id: SPEC-201
type: spec
role: spec
title: "Design-necessity rule v5: separate what a design needs from what patches it"
status: approved
priority: high
created: 2026-10-18
updated: 2026-10-18
tags: [review, design, governance]
links:
  - {id: SPEC-200, type: relates-to}
---
## Overview/Goal

Refines spec-the-approval-judge-rejects-patch-shaped-designs-design D1. Validation of its AC-DN-3 on the real judge (2026-10-18) showed the v4 design_necessity rule rejects the patch-shaped spec reliably (4 findings, 2 of 2 runs) but over-applies: it also rejected an end-state control spec, calling product semantics, a port contract and the acceptance test's own safety "guards", with findings that varied run to run and contradicted each other (a throwaway test HOME was a "guard" in one run; its absence made the test "unsafe" in the next). Part of that was real: the control still carried a transitional `legacy_skip` state and justified two necessary items with guard-style reasons.

Goal: the judge separates what a design needs from what patches it, so that its verdict is stable and a correctly justified end-state design passes.

v4 is frozen (one real judgment already recorded under it); the refined rule ships as prompt v5.

## Scope

In scope: `packages/lore/src/ai/review-template.ts` (v5 = v4 with the refined rule replacing the v4 design_necessity block; registered and current; v1–v4 frozen), the version-pinning tests, the AC-DN-3 control fixture `packages/lore/tests/fixtures/design-necessity/end-state-spec.md` (corrected justifications, no transitional state).

Also in scope: `lore rule propose <spec> amend <BR-n>` (packages/lore/src/service/rule-change-service.ts and the rule CLI). Today a locked spec's proposed `add` entry cannot be corrected at all (`modify` names only live rules, `rule set` cannot see a proposed id), so BR-1237 proposed by the parent spec cannot take the refined wording, and the parent spec cannot land because its own validation criterion failed on the old wording.

Out of scope: any deterministic detector; changing BR-281 (plans judged by default stays as landed).

## Design

**D1 — What is and is not a finding.** NOT a finding when the document states it: (i) product semantics a user relies on (e.g. a tool manages only files it wrote and leaves a hand-edited file to its owner); (ii) a contract of an interface or port (what it accepts and refuses); (iii) validation of input that comes from outside the system (user files, network, environment) at the boundary where it enters; (iv) what an acceptance test needs to be safe and meaningful when the design is violated (e.g. the test runs where a failure cannot damage real data). A finding is: (a) a check, scanner, ledger or allowlist whose only purpose is to catch a violation of the document's OWN design invariant that the design itself already rules out; (b) a temporary seam or stopgap; (c) a fallback that silently substitutes for a missing required input; (d) a transitional or phased state (a skip/compat/legacy mode, a ratchet, an intermediate phase) that the end state would not have. For each finding the judge names the item, why it is (a)–(d), and the end-state alternative; it must not raise an item the document justifies under (i)–(iv) unless the justification is false.

**D2 — Stability.** The rule instructs the judge to classify each candidate item explicitly as (i)–(iv) or (a)–(d) before deciding, so the same document yields the same classification across runs.

**D3 — Amend a proposed rule.** `lore rule propose <spec> amend <BR-n> [--statement] [--example…] [--enforced-by] [--correction <reason>]` rewrites a proposed `add` entry of that spec's change set in place, keeping its id and leaf; on a locked spec it requires `--correction` and writes one audited version with status kept (BR-1069, same as other change-set corrections). It refuses (exit 4, naming the id) when the id is not a proposed entry of that spec — a live rule is changed with `modify`.

**Landing order.** After D3 ships: (1) amend BR-1237 on spec-the-approval-judge-rejects-patch-shaped-designs-design to the D1 wording (`--correction`); (2) correct that spec's AC-DN-3 to validate under v5 with the corrected control fixture (same intent, recorded correction); (3) run it; when it passes, `lore rule apply` lands BR-1237 and the BR-281 modify; (4) this spec's criteria then add BR-1237 to their cites (report-only).

## Acceptance Criteria

AC-DN5-1 (v5 current, v1–v4 byte-frozen, rule text carries both lists), AC-DN5-3 (amend a proposed rule on a locked spec; refuse a non-proposed id), AC-DN5-2 (real judge, pinned fixtures, two runs each: patch-shaped spec rejected on design_necessity naming the ledger/ratchet, seam and transitional bridge; corrected end-state spec raises no design_necessity finding).


## Acceptance Criteria (structured)

- [·] [script] AC-DN5-1: The current review prompt version is v5; its design_necessity rule lists the four non-findings (product semantics, interface contract, outside-input validation, acceptance-test safety) and the four findings (own-invariant guard check/scanner/ledger/allowlist, stopgap seam, silent fallback, transitional or phased state) and requires an explicit per-item classification; v1-v4 builders are byte-identical to before.
  script: test — bunx --bun vitest run packages/lore/tests/unit/ai/review-template-v5.test.ts && echo 'AC-DN5-1 PASS: v5 current, v1-v4 frozen'
  other_command=2
- [·] [script] AC-DN5-3: On an approved spec, lore rule propose <spec> amend <BR-n> --statement <s> --correction <r> rewrites that spec's proposed add entry in place (same id and leaf), keeps the spec approved and writes one version carrying the correction reason; without --correction it exits 4 naming the record-edit gate; for an id that is live or proposed by another spec it exits 4 naming the id.
  script: test — bunx --bun vitest run packages/lore/tests/integration/rule-propose-amend.test.ts && echo 'AC-DN5-3 PASS: proposed rule amended on a locked spec; non-proposed id refused'
  other_command=2
- [·] [human] AC-DN5-2: Under prompt v5 the real judge rejects the patch-shaped fixture on design_necessity and raises no design_necessity finding on the corrected end-state fixture, two runs each.
  human: Fixtures packages/lore/tests/fixtures/design-necessity/{patch-shaped-spec.md,end-state-spec.md}, end-state corrected per D1 (no legacy/skip state, necessity stated). Throwaway corpus, dist/lore with v5, lore review twice each. Expect patch-shaped: reject with design_necessity naming ledger/ratchet, seam, transitional bridge; end-state: no design_necessity finding in either run.
