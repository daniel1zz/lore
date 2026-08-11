---
id: TASK-326
type: task
role: plan
title: "Promote the oracle-file-existence primitives into @lore/core and wire declaration-time validation with the audited allow-missing-path escape"
status: archived
priority: medium
phase: "mechanism"
created: 2026-08-10
updated: 2026-08-10
tags: []
parent: PLAN-079
plan: PLAN-079
---
Move `extractTestFileTokens` / `computeCandidateRoots` / `findMissingOracleFiles` / `FileExistsPort` out of `adapters/cli/evidence-precheck.ts` into a new `packages/core/src/oracle-file-existence.ts`, mirroring `attestation-completeness.ts`'s precedent (pure + injected port). Keep `evidence-precheck.ts`'s existing consumers working.

⛔ DO NOT widen `isSelfReportedPassInScope`. It is shared by guards 1/2/3/5; widening it silently arms the pipe guard, whose premise ("a claimed pass's $? may be lying") is meaningless for a fail. The fail-direction check gets its OWN narrow predicate.

⛔ `evidence-precheck.ts`'s module header currently claims all five guards *"share ONLY the scope gate"*. That sentence becomes FALSE in this diff and must be corrected IN THIS DIFF.

Then wire declaration-time validation into `AcService.addCriterion`/`setCriterion` with the D8 escape: `--allow-missing-path` REQUIRES a non-empty reason, and `lore status --json` reports the count of UNREDEEMED declarations (declared path still absent). Creating the file must make the count drop with no further command — AC-OX-9's red is exactly that.

⛔ MEASURED SCOPE LIMIT you must assert, not hide: 5 of the 19 script-mode `pass_unfalsified` commands carry NO path token at all (`bun run test`, `bun run typecheck`, a `test $(grep -rln ...)` form, a `bun run dev -- setup --dry-run` form, and a `diff <(shasum ...) <(shasum ...)` pair). AC-OX-4 requires those five be accepted UNCHANGED. That half is load-bearing: it pins the guard's blind spot instead of letting green imply full coverage.
