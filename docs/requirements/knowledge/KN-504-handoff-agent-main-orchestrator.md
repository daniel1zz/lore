---
id: KN-504
type: knowledge
role: knowledge
title: "Handoff — agent:main-orchestrator"
status: archived
priority: medium
created: 2026-08-23
updated: 2026-10-10
tags: []
parent: PLAN-135
---
# Handoff — agent:main-orchestrator

SCOPE: 3 decisions + 8 next steps = 11 items to account for

## Plan

plan-make-a-falsifier-s-scratch-worktree-runnable-and

## Task Refs

(none)

## Modified Files

- packages/lore/src/service/falsifier-dep-materialization.ts
- packages/lore/src/service/verify-runner-service.ts
- packages/lore/tests/unit/service/falsifier-dep-materialization.test.ts
- packages/lore/tests/integration/cli/verify-falsify-dep-materialization.test.ts
- scripts/falsifier-negative-control.ts

## Key Decisions

| ID | Judgment | Confidence |
|---|---|---|
| KD1 | NS1 closed by MEASUREMENT: the predecessor's four options were the wrong choice space. The hybrid layout is landed and wired before the green control, producing the first 8 genuine attested reds this mechanism ever emitted. spec approved v30, plan archived, 5/5 tasks, pre-push exit 0. @high | — |
| KD2 | Vector 8: for a harness run against a COPY of a tree, 'the harness starts' and 'it observes the copy' are INDEPENDENT. A plain node_modules symlink keeps the green control green while cross-package mutations go invisible — measured exit 0 / 77 passed on a broken packages/core. @high | — |
| KD3 | lore assess is load-bearing, not advisory: 3 real defects over 2 rounds that no oracle caught, each machine-checked first. Sharpest: AC-SD-1's RED(i) control was VACUOUS and survived attestation — a -t <describe> oracle attests the DESCRIBE, not each test in it. @high | — |

## Failing Oracle

(none)

## Next Steps

- NS1: NS-A (MAJOR, open): AC-SD-1 RED(iii)/(iv) plus all four AC-SD-4 controls are in-test SIMULATIONS. Measured by disabling nested-link creation in the materializer: those six stayed GREEN and only 'hybrid layout: HAPPY' went red. The criterion keeps discriminating power; six named controls have none. Decide whether the permanently-pinned pattern must assert against production behaviour instead of a hand-simulated defect.
- NS2: NS-B (MINOR, open): AC-SD-1(e)'s nested enumeration runs against a fixture with exactly ONE nested node_modules (packages/extra), so a bug linking only the FIRST discovered nested tree passes. Needs a two-nested-tree fixture.
- NS3: NS-C (structural): a refused falsify run records NOTHING, so the control proving discriminating power is unprovable from the corpus. scripts/falsifier-negative-control.ts closes it for THIS mechanism — verified it catches a real mechanism regression by disabling the declared-vs-observed guard, which made it fail 'expected 4, observed 0'. Generalizable: when a tool's correct response to bad input is to record nothing, proving its discriminating power needs a SEPARATE oracle that records the refusal.
- NS4: NS-D (concurrency, informational): a peer session merged SPEC-143 AC-CT-2 into main as a deliberate RED-FIRST test (evidence-capture-attestation.test.ts, commit 32143dc2, 4 failing). Verified NOT mine — none of my 5 merges touch evidence-capture. So 'bun run test' on main is 4 failed / 9160 passed, and the pre-push hook runs no tests, which is why it landed unnoticed.
- NS5: NS-E (tooling gap, unfiled): the git-safety-gate's assessment is cwd-blind across worktrees. 'git checkout -- <path>' with cwd INSIDE a scratch worktree, on a file with a real uncommitted mutation there, printed 'the named path(s) have NO uncommitted changes — nothing would be lost' — it read the MAIN checkout. It still blocked (fail-closed) but the false assessment invites a hand re-run. Same family as filed defect 01KZVPHGEMFYWRW3JYB8RYP8F1.
- NS6: NS-F (governance root cause): creating a spec is itself a gate-invalidating act. The new spec had no code_anchors and no ledger row from creation until I noticed, so check-anchor-coverage exited 1 and main was unpushable through the middle of the session — I had scheduled the disposition into the LAST phase. It MUST land in the same slice as the spec: a debt row at creation, or real anchors once the implementation exists.
- NS7: NS-G (defect channel): a genuinely FIXED defect keeps occupying cap quota until someone draws the resolves edge BY HAND. 01M0H8XP5JZTR8Q7BH6HV6YRM4 was closed by an archived plan whose body literally says 'Closes defect 01M0H8XP...', yet its computed resolution stayed open and the channel stayed write-blocked at cap. One 'lore link <plan> <issue> --type resolves' flipped it to fixed. Deserves an automatic edge or a plan-close advisory.
- NS8: NS-H (filed this session): 01M0P5ET63P3TBPP1283ZDJD21 — lore done's test-anchor refusal demands an ATTESTED unfiltered pass while findMissingUnfilteredTestFileRuns (task-workflow-service.ts:937) filters only on oracle==='test' && result==='pass' and inspects NO attestation field. Verified at the predicate, not inferred from behaviour.
