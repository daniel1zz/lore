---
id: TASK-724
type: task
role: plan
title: "AC-GD-3(d) direction 2 borrows a real stale mirror instead of constructing one, so repairing the mirror reddens the suite"
status: archived
priority: high
phase: "namespace"
created: 2026-08-13
updated: 2026-08-13
tags: []
parent: PLAN-122
plan: PLAN-122
---
`check-gap-namespace.test.ts`'s AC-GD-3(d) direction-2 assertion proves the checker is
corpus-keyed rather than mirror-keyed by requiring a genuinely dirty exported mirror. It
does not CONSTRUCT that dirty mirror — it borrows one that happens to exist in this repo:

    const mirrorPath = join(REPO_ROOT, "docs/requirements/knowledge/KN-170-....md");
    const mirrorContent = readFileSync(mirrorPath, "utf8");
    // Control: confirm the exported mirror really is stale right now …
    expect(mirrorContent).toContain("## G1 (HALF-CLOSED");
    expect(mirrorContent).not.toContain("## GAP-1 (HALF-CLOSED");

That makes a DEFECT of this repo load-bearing for a passing suite. Measured 2026-08-13:
a force-export brought 31 drifted mirror files back into agreement with the corpus —
including KN-170, whose body was genuinely wrong — and this assertion went red at line
531. Nothing about the checker changed; the only thing that changed is that the repo got
less broken.

The failure mode this creates is worse than a flaky test: it applies pressure NOT to fix
the mirror, because fixing it reddens the suite. The correct response was very nearly to
revert the mirror repair.

This is the third member of a family this repo has already named twice, in the very
document the test reads (KN-170): "a check that regenerates what it is checking cannot
fail", and its sibling "a test that repairs the tree before asserting cannot fail
either". The third is: A TEST THAT REQUIRES THE DEFECT TO PERSIST. All three share one
root — the oracle does not own both ends of the comparison it claims to make.

## Scope

Rebuild direction 2 so the test owns BOTH ends, exactly as direction 1 already does at
line 465 (`initFixtureCorpus`, mkdtemp + `lore init`, never this repo's own `.lore/`):

1. Build a throwaway fixture corpus whose ledger doc is CLEAN (post-rename `GAP-1`).
2. Write, from the test itself, a mirror file under that fixture root that is
   deliberately stale (pre-rename `G1`) — the dirty end, constructed, not borrowed.
3. Control assertion: read that file back and confirm it really is stale. A constructed
   fixture still needs its control — an unwritten file is the same shape as a clean one.
4. Assert `main(fixtureRoot, ledgerSlug)` exits 0 — the checker read the corpus, not the
   mirror.

Then remove the REPO_ROOT staleness precondition (lines 529-532) from the real-tree test.
Keep the real-tree test itself: `expect(main()).toBe(0)` against this repo's live corpus
is the production-wiring oracle the module header describes, and it stays sound whether
or not any mirror is stale. Only the borrowed-dirt control goes.

⛔ Do NOT restore KN-170's mirror to its stale state, and do NOT weaken the assertion to
tolerate both spellings — either would keep the defect load-bearing in a quieter way.

## Why this is not a mirror-export task

The mirror repair itself is already filed separately
(01KZVAXZQAT4S9F4HGQT45YTT9, 01KZWF5EFFNWW673QYEEPNCMVT). This task changes ONLY the
test's fixture strategy. It must leave the checker script's behaviour byte-identical.
