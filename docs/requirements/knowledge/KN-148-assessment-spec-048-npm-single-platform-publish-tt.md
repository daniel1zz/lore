---
id: KN-148
type: knowledge
role: knowledge
title: "Assessment: SPEC-048 npm single-platform publish + TTY postinstall (2026-07-17)"
status: archived
priority: medium
created: 2026-07-17
updated: 2026-10-23
tags: []
parent: PLAN-034
links:
  - {id: PLAN-034, type: informs}
---
> ⚠ INVALIDATED 2026-07-17T04:51:35.227Z — superseded by knowledge-assessment-spec-048-npm-single-platform-publish-tty--2; judge input error: --diff da0fdb1..HEAD included 4 interleaved commits from a parallel session (assets/hooks, vitest.config, package.json) — scope_fidelity 58/major finding reflected foreign work, not this plan's diff; re-assessed with anchor-scoped diff-file

# Assessment: partially_met (78/100)

Scope: plan `01KXPZYTFENWNNS4VVS9NP9KMR`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-048-A | 90 | Unit oracle green: 4 distribution suites, 81 tests pass; platform-map, assemble, postinstall, publish-pipeline covered. Two attested passes on the same vitest command. Fully evidenced. | 01KXQ02KRY2714HBXXF6PEQ70N (gate task ev[1]/[5] 81 tests pass) |
| AC-048-B | 87 | Bare dry-run publish pipeline exits 0 (published=false), staged binary + assets verified, 26 files, ~27MB <150MB. Two attested e2e passes of scripts/publish-npm.ts. | 01KXQ02KRY2714HBXXF6PEQ70N (ev[2]/[6] published=false) |
| AC-048-C | 88 | Registry-free npm-i simulation green (8 tests): symlink --version, dry-run asset resolution, exec-bit, non-TTY nudge. Two attested passes. Realpath fix proven through real symlink. | 01KXQ02KRY2714HBXXF6PEQ70N (ev[3]/[7]) |
| AC-048-D | 77 | Repo-wide gate ultimately green (attested ev[8]) after an attested failure (ev[4], stdout truncation) was diagnosed and fixed via a tracked follow-up task. Final state passes typecheck+both runners; INV-7 private=true asserted. | 01KXQ02KRY2714HBXXF6PEQ70N (ev[4] fail then ev[8] pass), 01KXQ51BRBMH5D07NX9FQNDWFY (stdout truncation fix) |
| AC-048-E | 48 | Human owner beta install explicitly deferred, tracked as open, not an agent task. Legitimate deferral with mitigation noted, but genuinely not performed — no receipt evidence exists. | — |

## Gaps

- assets/hooks/lore-gate-g1..g4.sh and stop-doc-sync.mjs receive behavioral edits (project-vendored dedupe, doc-sync short-circuit) unrelated to SPEC-048 and not owned by any task; contradicts INV-6 which asserts the sole production diff is setup-args.ts. session-seat-injection.test.ts env removal and package.json NODE_OPTIONS bump are similarly untracked.
- Owner real-machine beta install never executed; tracked open. Acceptable per plan (human posture) but leaves the end-to-end distribution claim unproven on a teammate-equivalent machine.
- Attested evidence ratio 0.32; core module tasks are agent self-reported. AC-048-D carries both an attested fail and an attested pass — final green is convincing but the regression surfaced late in the gate.

## Recommendations

- Split the assets/hooks and stop-doc-sync edits out of SPEC-048 into a dedicated tracked task/spec so the publish stream's diff matches INV-6.
- Require attested (non-self-reported) oracle runs for core-module tasks, not only the final gate, to raise the 0.32 attested ratio.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 67663ms
- Retried: false
- Truncated sections: diff:CLAUDE.md, diff:assets/hooks/session-start-resume.mjs, diff:assets/hooks/subagent-context.mjs, diff:npm-pkg/postinstall.mjs, diff:packages/lore/tests/unit/distribution/assemble.test.ts, diff:packages/lore/tests/unit/distribution/platform-map.test.ts, diff:packages/lore/tests/unit/distribution/postinstall.test.ts, diff:packages/lore/tests/unit/distribution/publish-pipeline.test.ts, diff:scripts/build.ts, diff:scripts/platform-map.ts, diff:scripts/publish-npm.ts, diff:vitest.config.ts

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 84 | 0.8 | evidence | AC-A/B/C/D all end green with attested final runs; E legitimately deferred. Spec's core npm-publish + TTY postinstall path delivered. |
| evidence_integrity | 70 | 0.7 | evidence | Final gate attested by human recorder, but 0.32 attested ratio overall and AC-D shows an attested fail preceding its pass; trail traceable but thin on independent attestation. |
| scope_fidelity | 58 | 0.75 | evidence | Diff includes hook (lore-gate/stop-doc-sync), package.json, and test-env edits outside any task and contradicting INV-6's sole-diff claim. |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| scope_fidelity | major | AC-048-D | assets/hooks/lore-gate-g1..g4.sh and stop-doc-sync.mjs receive behavioral edits (project-vendored dedupe, doc-sync short-circuit) unrelated to SPEC-048 and not owned by any task; contradicts INV-6 which asserts the sole production diff is setup-args.ts. session-seat-injection.test.ts env removal and package.json NODE_OPTIONS bump are similarly untracked. |
| outcome | minor | AC-048-E | Owner real-machine beta install never executed; tracked open. Acceptable per plan (human posture) but leaves the end-to-end distribution claim unproven on a teammate-equivalent machine. |
| evidence_integrity | minor | AC-048-D | Attested evidence ratio 0.32; core module tasks are agent self-reported. AC-048-D carries both an attested fail and an attested pass — final green is convincing but the regression surfaced late in the gate. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Split the assets/hooks and stop-doc-sync edits out of SPEC-048 into a dedicated tracked task/spec so the publish stream's diff matches INV-6. | Untracked prod edits bundled into a publish stream weaken invariant integrity and review traceability. |
| process | Require attested (non-self-reported) oracle runs for core-module tasks, not only the final gate, to raise the 0.32 attested ratio. | Most per-task evidence is agent self-reported; independent attestation strengthens the trail. |

## Unverifiable Materials

- AC-048-E owner beta-install receipt: Human criterion deferred; no evidence record exists to inspect.

## Facts Summary

- AC coverage: 5 declared criteria
- Task evidence: 8 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 0 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.32
