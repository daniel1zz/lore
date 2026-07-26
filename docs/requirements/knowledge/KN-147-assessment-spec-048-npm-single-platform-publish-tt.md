---
id: KN-147
type: knowledge
role: knowledge
title: "Assessment: SPEC-048 npm single-platform publish + TTY postinstall (2026-07-17)"
status: approved
priority: medium
created: 2026-07-17
updated: 2026-07-18
tags: []
parent: PLAN-034
links:
  - {id: PLAN-034, type: informs}
  - {id: KN-148, type: supersedes}
---
# Assessment: partially_met (79/100)

Scope: plan `01KXPZYTFENWNNS4VVS9NP9KMR`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-048-A | 90 | Unit oracles green: 81 tests across platform-map, assemble, postinstall, publish-pipeline all pass (evidence [1],[5]). 7 pass / 0 fail, 2 attested. Assembler/postinstall/setup-args diffs visible and coherent with the AC (bin/os/cpu pin, decide() matrix, zero-dep contract). | 01KXQ02KRY2714HBXXF6PEQ70N (vitest distribution suite 81 pass) |
| AC-048-B | 86 | Bare dry-run pipeline exits 0, staged binary version=0.1.0, 26 files, tarball ~27MB (<150MB), published=false (INV-1 held). 3 pass / 0 fail, 2 attested. Publisher port + stages a-c evidenced via e2e run [2],[6]. | 01KXQ02KDDKBVX0NJCXNA7XG3D (publish-npm.ts dry-run pass) |
| AC-048-C | 87 | Registry-free npm-i simulation green: 8 tests, symlink --version, dry-run asset resolution, non-TTY nudge, exec-bit retained, exit 0. 4 pass / 0 fail, 2 attested. Test asserts realpath fix through a real symlink (B1) proving R2 mitigation. | 01KXQ51BRBMH5D07NX9FQNDWFY (install-sim 8 tests pass) |
| AC-048-D | 74 | Repo-wide gate initially FAILED (evidence [4]: 1 test file failed — CLI stdout truncation) then remediated by an added stdio-sync.ts follow-up task; final typecheck+test attested pass (evidence [8]). Honest fail-then-fix, but the fix expanded production scope beyond plan INV-6. | 01KXQ02KRY2714HBXXF6PEQ70N ([4] fail then [8] pass) |
| AC-048-E | 45 | Human owner beta install — 0 pass / 0 fail, explicitly deferred to owner and tracked as open per plan exit criteria. Not an agent task, so no evidence exists; scored conservatively for absence of any acceptance receipt. | — |

## Gaps

- AC-048-E (owner real beta install from packed tarball) is unevidenced and open. It is explicitly deferred to the human owner per plan exit criteria, so not an agent failure, but the spec is not fully accepted until the receipt is recorded.
- INV-6 states the sole production-code diff is setup-args.ts realpath hardening. Execution added a second production module (adapters/cli/stdio-sync.ts) plus an index.ts wiring change to fix a stdout non-blocking-fd1 truncation regression exposed by AC-048-D. Justified and documented as a follow-up task, but it deviates from the declared scope invariant.
- AC-048-D carries both an attested fail (evidence [4]) and an attested pass (evidence [8]); overall attested_evidence_ratio is 0.32, so most oracle results rest on agent self-report rather than independent attestation.

## Recommendations

- Update INV-6 (or add an invariant) to record stdio-sync.ts + index.ts as an accepted second production diff arising from the AC-048-D regression, so the scope statement matches reality.
- Require the owner's AC-048-E beta-install receipt to be attached before archiving the spec as fully met.
- Increase attestation of e2e/build oracle runs (raise ratio above 0.32) rather than relying on agent-recorded results.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 55558ms
- Retried: false
- Truncated sections: diff:packages/lore/tests/unit/distribution/assemble.test.ts, diff:packages/lore/tests/unit/distribution/platform-map.test.ts, diff:packages/lore/tests/unit/distribution/postinstall.test.ts, diff:packages/lore/tests/unit/distribution/publish-pipeline.test.ts, diff:scripts/platform-map.ts, diff:scripts/publish-npm.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 83 | 0.8 | evidence | AC-048-A/B/C fully green; D failed then remediated to attested pass. Only E (human) remains open — deferred by design, not a delivery gap. |
| evidence_integrity | 76 | 0.75 | evidence | Fail was surfaced honestly (evidence [4]) then fixed with a documented task; final passes present. But attested ratio 0.32 leaves most runs agent-self-reported. |
| scope_fidelity | 69 | 0.7 | evidence | Plan INV-6 declared setup-args.ts the SOLE production diff; a new stdio-sync.ts + index.ts change was added. Explained as a D-driven regression fix, so drift is justified but real. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | minor | AC-048-E | AC-048-E (owner real beta install from packed tarball) is unevidenced and open. It is explicitly deferred to the human owner per plan exit criteria, so not an agent failure, but the spec is not fully accepted until the receipt is recorded. |
| scope_fidelity | major | AC-048-D | INV-6 states the sole production-code diff is setup-args.ts realpath hardening. Execution added a second production module (adapters/cli/stdio-sync.ts) plus an index.ts wiring change to fix a stdout non-blocking-fd1 truncation regression exposed by AC-048-D. Justified and documented as a follow-up task, but it deviates from the declared scope invariant. |
| evidence_integrity | minor | AC-048-D | AC-048-D carries both an attested fail (evidence [4]) and an attested pass (evidence [8]); overall attested_evidence_ratio is 0.32, so most oracle results rest on agent self-report rather than independent attestation. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Update INV-6 (or add an invariant) to record stdio-sync.ts + index.ts as an accepted second production diff arising from the AC-048-D regression, so the scope statement matches reality. | The declared 'sole diff = setup-args.ts' invariant is now contradicted by the merged tree. |
| process | Require the owner's AC-048-E beta-install receipt to be attached before archiving the spec as fully met. | AC-048-E is the only end-user acceptance signal and remains open. |
| process | Increase attestation of e2e/build oracle runs (raise ratio above 0.32) rather than relying on agent-recorded results. | Low attestation weakens confidence in otherwise-green oracles. |

## Unverifiable Materials

- AC-048-E owner beta-install receipt: Human-mode AC deferred to owner; no evidence produced or recordable by the agent.
- scripts/publish-npm.ts, scripts/platform-map.ts, and the 4 distribution unit test files: Present in diff per truncation manifest but contents omitted for budget; judged from oracle results and task ACs, not source inspection.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 1 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.32
