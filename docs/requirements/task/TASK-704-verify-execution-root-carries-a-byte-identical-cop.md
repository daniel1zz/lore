---
id: TASK-704
type: task
role: plan
title: "verify-execution-root carries a byte-identical copy of the isWithin bare-root defect just fixed in the shared resolver"
status: draft
priority: medium
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Disclosed by the implementer of `task-the-pure-resolver-s-iswithin-rejects-everything-at-the` while fixing the first instance, and confirmed by direct inspection on merged main.

## The defect

`packages/core/src/verify-execution-root.ts` carries a private `isWithin` whose body is byte-for-byte the shape just fixed in `packages/core/src/corpus-provenance.ts`:

```
function isWithin(root: string, candidate: string): boolean {
  const normalizedRoot = stripTrailingSlash(root);
  const normalizedCandidate = stripTrailingSlash(candidate);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}
```

When `root` is the bare filesystem root `"/"`, `stripTrailingSlash` leaves it `"/"` and the final test degrades to `startsWith("//")`, which no real path satisfies — so the boundary rejects every candidate instead of containing them all.

It is LATENT today, and only by luck of its caller: the root it receives comes from `gitFacts.worktreeRoot`, i.e. `git rev-parse --show-toplevel`, which never returns `/`. Nothing in the function, its name, or its doc comment says the caller must guarantee that. The next caller will not know either.

## Why this is not "the same fix twice"

The task that fixed the first instance was justified on SSOT grounds: §D1's point is that the containment policy has exactly ONE attachment site, and a trap each caller must route around is the opposite of that. That argument applies verbatim here — and a second private copy of the predicate IS the residual duplication the SSOT criterion was meant to eliminate. Fixing instance one while leaving instance two standing satisfies the letter of that AC and defeats its purpose.

This repo has already measured this exact failure mode: an SSOT-shaped acceptance criterion that asserts the new function exists and is referenced, without checking that the residual copy is gone, so the main body converges while one copy survives untouched.

## What must land

1. ONE containment predicate, exported from `packages/core/src/corpus-provenance.ts` (which now owns the corrected `childPrefix` bare-root rule), consumed by `verify-execution-root.ts`. ⛔ Not a second corrected copy — the point is that there is one.
2. `grep -rn "function isWithin" packages/ scripts/` returns exactly ONE hit afterwards. Assert the count, do not assume it: the first fix's implementer re-introduced a stale identifier into a replacement comment and caught it only by running the grep.
3. A test pins `verify-execution-root`'s behaviour at a bare-root boundary directly, with a control that goes red in BOTH degenerate directions (reject-everything and accept-everything). A test that only asserts the fixed value stays green under accept-everything.
4. ⛔ Guard the control against hangs. In the sibling module an accept-everything mutation made a caller loop forever rather than fail, because `parentDirectory` saturates at `"/"`; a synchronous infinite loop cannot be interrupted by the test runner's timeout. Bound the probe by call count so a regression FAILS instead of hanging the suite. Check whether `verify-execution-root`'s own walk has the same saturation property before assuming it does not.
5. Check the empty-string root too. In the sibling module an empty `callerTreeRoot` did not merely miss — it hung (measured: SIGALRM, exit 142). The corrected predicate refuses an empty root rather than silently reading it as `/`; whatever this module does must be equally explicit, never a guess.
