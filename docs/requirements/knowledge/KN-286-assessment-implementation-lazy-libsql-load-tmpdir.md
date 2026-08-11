---
id: KN-286
type: knowledge
role: knowledge
title: "Assessment: Implementation — lazy libsql load + TMPDIR diagnostic (2026-07-31)"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PLAN-094
links:
  - {id: PLAN-094, type: informs}
---
# Assessment: met (82/100)

Scope: plan `01KYVEW6VKQZA7S1483TM4CQ1M`

## AC Scores

| AC | Score | Reasoning | Evidence |
|---|---|---|---|
| AC-LL-1 | 92 | T1 recorded expected-fail on the pre-fix binary, T2 pass, and the orchestrator independently attested a filtered pass (1 matched, 3 skipped). Red→green flip on the same subprocess oracle is strong liveness evidence. Diff shows the eager value import removed from turso-store.ts. | 01KYVEYBA4R6M8QCP55M0D89RG (T1 evidence[1] expected-fail, 1 matched), 01KYVEYBZ3BVM767HRFSVNPXW7 (T2 evidence[12] attested pass) |
| AC-LL-2 | 90 | Combined-channel negative assertions (`dlopen`, `$bunfs`) exist verbatim in the test file; RED pre-fix (T1 evidence[2]) and attested pass post-fix (T2 evidence[13], 1 matched). Narrow `$bunfs` literal avoids self-tripping prose, as the spec requires. | 01KYVEYBZ3BVM767HRFSVNPXW7 (evidence[13] attested) |
| AC-LL-3 | 90 | Control passes both pre-fix (T1 evidence[3]) and post-fix (attested T2 evidence[11], 1 matched). Asserts exit 0 plus literal `Total documents`, which is exactly the anti-vacuity role the spec assigns it. | 01KYVEYBZ3BVM767HRFSVNPXW7 (evidence[11] attested pass) |
| AC-LL-4 | 90 | All four pinned substrings plus exit-code 1 are asserted in the test; RED pre-fix (T1 evidence[4]) → attested pass (T2 evidence[14], 1 matched). Diff shows probe placed after credential resolution in performPush and before loadLibsqlClientModule. | 01KYVEYBZ3BVM767HRFSVNPXW7 (evidence[14] attested) |
| AC-LL-5 | 72 | Two attested passes. But T1's RED (evidence[5]) failed only on an error-code mismatch (STORE_ERROR vs VALIDATION_ERROR); the oracle's expectation and title were then changed to match measured behaviour, so this AC is a control, not defect evidence. Anti-downgrade branch is conditional and only reac… | 01KYVEYBZ3BVM767HRFSVNPXW7 (evidence[15] title says STORE_ERROR, evidence[17] says VALIDATION_ERROR — file changed between runs) |
| AC-LL-7 | 75 | Three cases present and attested pass twice (T2 evidence[16],[18]). Same post-hoc error-code correction as AC-LL-5 for case (c). Store identity read through a private-field cast (`corpusService.store`), a fragile channel, though a sanity fence guards against a vacuous always-false instanceof read. | 01KYVEYBZ3BVM767HRFSVNPXW7 (evidence[18] attested, cases a/b/c) |
| AC-LL-6 | 78 | `bun run typecheck` exits 0, attested twice with per-project tsc invocations visible in output tails. Score capped because the AC (by its own text) proves only exit 0 — it cannot show the sync-vs-async contract was kept, and createApp remains synchronous per the diff. | 01KYVEYBZ3BVM767HRFSVNPXW7 (evidence[9],[10] attested tsc) |
| AC-LL-8 | 66 | Attested pass, 1 matched. But the guard only exercises the loader.ts-routed `lore status` path; a NEW createApp call site passing a sync-bearing config (the exact hazard T3 named) would not turn it red. T3 stated the source-scanning call-site pin was preferred; the weaker option shipped. | 01KYVNQT1HQCWENM2QVDCK9AXP (evidence[2] attested pass) |
| AC-LL-9 | 85 | Attested pass, 1 matched. Test genuinely distinguishes credential-first from probe-first: asserts non-zero exit, stderr names the missing env var, and first line lacks TMPDIR. Only one evidence record, no independent second run. | 01KYVNQT1HQCWENM2QVDCK9AXP (evidence[3] attested pass) |

## Gaps

- AC-LL-8 asserts only that `lore status` (a loadLoreApp-routed command) survives a sync-enabled corpus under a hostile TMPDIR. It therefore guards the loader.ts strip, not the invariant T3 named: that NO createApp call site passes a sync-bearing config. Adding such a call site in dashboard.ts/init.ts/init-corpus.ts/mount-registry.ts would leave every AC green while the compiled binary throws 'Cannot find module' at runtime. T3 explicitly preferred a source-scanning pin for this reason.
- T2 evidence[15] shows the AC-LL-5 test passing with a title asserting err(STORE_ERROR); evidence[17] shows it passing with err(VALIDATION_ERROR). The oracle T1 authored was thus modified during/after the GREEN task, contrary to T2's constraint not to edit T1's files to make them pass. The change is disclosed in code comments and the spec, and the anti-downgrade invariant survives, but the recorded RED for AC-LL-5/AC-LL-7 was an error-code mismatch — meaning both ACs would have passed pre-fix in…
- turso-store.ts intentionally keeps loadLibsqlClientModuleSync (createRequire), documented as throwing 'Cannot find module' from a compiled binary even inside the source repo. Its safety depends wholly on loader.ts stripping config.sync — a file absent from the diff, so the load-bearing premise is unverifiable from these materials.
- No oracle record for `bun run build` precedes any dist/lore-measuring run, though the plan names stale-binary measurement as a known false-oracle vector. Mitigated only inferentially by AC-LL-1/2/4 flipping from expected-fail to pass.
- T1 has 9 self-reported and 0 attested evidence records, and one of them (entry [8]) mis-recorded a failing command as pass before being retracted by entry [9]. All RED-state claims for AC-LL-1/2/4 rest on that unattested set.

## Recommendations

- Add an AC implementing the source-scanning createApp call-site pin (precedent: AC-SL-2's writer.remove boundary pin) that fails when any call site passes a config with a sync key, paired with a control assertion proving the scan matches something.
- Require a recorded build oracle (`bun run build`, exit 0, attested) immediately before any AC run that spawns dist/lore, in the same evidence batch.
- Forbid GREEN tasks from editing oracle expectations. When a RED run disproves a spec pin (here STORE_ERROR vs VALIDATION_ERROR), amend the spec first, then re-record RED against the corrected oracle before implementing.
- Either move probeTmpdirUsability inside syncPush/loadLibsqlClientModule, or add an AC pinning that every native-load entry point probes TMPDIR first, so the ordering rule is enforced at the load boundary rather than per caller.

## Judgment

- Provider: claude-cli
- Prompt version: 6
- Duration: 110301ms
- Retried: false
- Truncated sections: (none)
- Reasoning clipped for: AC-LL-5

## Dimension Scores

| Dimension | Score | Confidence (self-reported, uncalibrated) | Based On | Reasoning |
|---|---|---|---|---|
| outcome | 85 | 0.75 | evidence | All 9 ACs have at least one attested pass; AC-LL-1/2/4 flipped red→green on unchanged subprocess oracles. Deductions: retained known-broken sync fallback, and AC-LL-8's guard is narrower than T3 aske… |
| evidence_integrity | 74 | 0.7 | evidence | Matched counts reported, orchestrator attestation on 12 records, one self-corrected mis-record. Weakened by post-hoc oracle edit on AC-LL-5/7, 0.40 attested ratio, and no build oracle. |
| scope_fidelity | 88 | 0.8 | evidence | Diff touches exactly the four planned src files plus the two declared test files; createApp stayed synchronous as constrained; both other libsql import sites audited as required. AC-LL-8/9 added per … |

## Typed Gaps

| Dimension | Severity | AC Ref | Statement |
|---|---|---|---|
| outcome | major | AC-LL-8 | AC-LL-8 asserts only that `lore status` (a loadLoreApp-routed command) survives a sync-enabled corpus under a hostile TMPDIR. It therefore guards the loader.ts strip, not the invariant T3 named: that NO createApp call site passes a sync-bearing config. Adding such a call site in dashboard.ts/init.ts/init-corpus.ts/mount-registry.ts would leave every AC green while the compiled binary throws 'Cannot find module' at runtime. T3 explicitly preferred a source-scanning pin for this reason. |
| evidence_integrity | major | AC-LL-5 | T2 evidence[15] shows the AC-LL-5 test passing with a title asserting err(STORE_ERROR); evidence[17] shows it passing with err(VALIDATION_ERROR). The oracle T1 authored was thus modified during/after the GREEN task, contrary to T2's constraint not to edit T1's files to make them pass. The change is disclosed in code comments and the spec, and the anti-downgrade invariant survives, but the recorded RED for AC-LL-5/AC-LL-7 was an error-code mismatch — meaning both ACs would have passed pre-fix in… |
| outcome | minor | — | turso-store.ts intentionally keeps loadLibsqlClientModuleSync (createRequire), documented as throwing 'Cannot find module' from a compiled binary even inside the source repo. Its safety depends wholly on loader.ts stripping config.sync — a file absent from the diff, so the load-bearing premise is unverifiable from these materials. |
| evidence_integrity | minor | — | No oracle record for `bun run build` precedes any dist/lore-measuring run, though the plan names stale-binary measurement as a known false-oracle vector. Mitigated only inferentially by AC-LL-1/2/4 flipping from expected-fail to pass. |
| evidence_integrity | minor | — | T1 has 9 self-reported and 0 attested evidence records, and one of them (entry [8]) mis-recorded a failing command as pass before being retracted by entry [9]. All RED-state claims for AC-LL-1/2/4 rest on that unattested set. |

## Typed Recommendations

| Target | Action | Rationale |
|---|---|---|
| plan | Add an AC implementing the source-scanning createApp call-site pin (precedent: AC-SL-2's writer.remove boundary pin) that fails when any call site passes a config with a sync key, paired with a control assertion proving the scan matches something. | AC-LL-8 only covers loader.ts-routed commands; T3's Gap 1 named arbitrary new call sites as the hazard and preferred the scan. |
| process | Require a recorded build oracle (`bun run build`, exit 0, attested) immediately before any AC run that spawns dist/lore, in the same evidence batch. | Plan names stale-binary measurement as false-oracle vector #4, yet no build record exists in any task's evidence. |
| process | Forbid GREEN tasks from editing oracle expectations. When a RED run disproves a spec pin (here STORE_ERROR vs VALIDATION_ERROR), amend the spec first, then re-record RED against the corrected oracle before implementing. | AC-LL-5/AC-LL-7 lost their RED standing because the expectation changed after the fact, leaving them as controls only. |
| spec | Either move probeTmpdirUsability inside syncPush/loadLibsqlClientModule, or add an AC pinning that every native-load entry point probes TMPDIR first, so the ordering rule is enforced at the load boundary rather than per caller. | sync-push.ts::syncPush loads libsql with no probe of its own; compliance currently depends on caller discipline. |

## Unverifiable Materials

- packages/lore/src/adapters/cli/loader.ts (the unconditional config.sync strip): Not in the diff. The entire unreachability argument for the createRequire fallback, and AC-LL-8's rationale, rest on this code.
- A `bun run build` / dist/lore freshness oracle: No evidence record for the rebuild the plan makes a precondition of AC-LL-1/2/3/8/9.
- Full-suite regression run (T2 evidence[8]: 895 pass / 1 pre-existing unrelated fail): Self-reported, not attested, and the claimed pre-existing failure is described only in prose with no output tail.
- The 20 external createApp call sites named in the plan's risk section: Only asserted via T3's prose account of a one-time hand audit; none of those files appear in the diff.
- resolveSyncCredentials in @lore/core: Not in the diff, so the VALIDATION_ERROR mapping AC-LL-5/AC-LL-7(c) now pin cannot be confirmed at source.

## Facts Summary

- AC coverage: 9 declared criteria
- Task evidence: 3 tasks
- AC scope: 0 scoped, 0 dangling
- Knowledge capture: 2 docs (bundle)
- Regression: tests_touched=true, attested_evidence_ratio=0.40
