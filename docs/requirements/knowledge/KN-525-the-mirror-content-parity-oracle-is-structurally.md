---
id: KN-525
type: knowledge
role: knowledge
title: "The mirror content-parity oracle is structurally unsatisfiable on a corpus still being written, and its links_broken=2 was a line-vs-title misattribution"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: [mirror, oracle, false-oracle, concurrency, diagnosis]
parent: SPEC-145
---
# The mirror content-parity oracle is structurally unsatisfiable on a corpus that is still being written

Measured 2026-08-24 on `main` at `da1d0b91`. This retires the open gap recorded in commit
`79219bf2` and carried forward by `knowledge-handoff-agent-main-orchestrator-117`, both of
which named the residual `links_broken === 2` and honestly recorded it as NOT diagnosed.

## The recorded gap was a misattribution, not an unknown

`79219bf2` states: *"spec-mirror-export still reports links_broken === 2. Three separate
probes of mine failed to locate those two links, so the cause is NOT diagnosed."*

`links_broken` was never 2. It was never measured at all. The failing assertion is:

```
FAIL scripts/tests/spec-mirror-export.test.ts > ... > HAPPY (c): the migration-coverage eval
     over the REAL docs/requirements reports links_broken === 0
AssertionError: expected 2 to be +0
 ❯ scripts/tests/spec-mirror-export.test.ts:294:33
   294|       expect(baseline.exitCode).toBe(0);
```

Line **294** is `expect(baseline.exitCode).toBe(0)` — the exit code of
`runMirrorScript(["--check"])`. The `links_broken` assertion is line **301**, and the test
never reaches it. The number 2 is a MIRROR-CHECK EXIT CODE.

The misattribution came from reading the failure's identity off the test's TITLE (which ends
`... reports links_broken === 0`) instead of off its line number. Three probes then correctly
reported zero dangling links, and a fourth (written independently on 2026-08-24, plus a fifth
run against the historical tree at `79219bf2`) also returned zero. All five were right:
`links_broken` is 0. **A failing number must be attributed by LINE, never by test title** —
a title that names a different quantity than the assertion that actually tripped will send
every subsequent probe after the wrong thing.

## The real mechanism

`bun run check:spec-mirror` exits 2 because of one row:

```
export-spec-mirror (content): 1 corpus prd(s) whose mirror body no longer matches the corpus:
  prd-lore-internal-first-ai-team-knowledge-platform
```

Byte-compared directly:

| side | bytes | `<ChildrenOf />` |
|---|---|---|
| corpus `content` | 15311 | present, verbatim |
| mirror body (`docs/requirements/prd/PRD-001-lore-positioning.md`) | 91745 | EXPANDED into the child list |

`lore export-docs` writes the **MDX-RESOLVED** body. The content-parity check compares that
against the corpus's **UNRESOLVED SOURCE**. For any doc carrying a placeholder these two can NEVER be equal by construction — the check is not detecting drift, it is detecting that
resolution happened.

Worse, the resolved text encodes the corpus's GLOBAL CURRENT STATE: the expansion carries each
child's live status, so this session's own writes appear inside it —
`... (deprecated)` rows for the two SPEC-072 specs deprecated minutes earlier. Therefore:

**every corpus write anywhere in the tree re-reddens this oracle**, and the only window in
which it is green is between an `export-docs --force` and the next write of any kind.

Measured causal chain, same session:
1. `mirror:export` + `lore export-docs --force` → `check:spec-mirror` **EXIT=0**
2. one unrelated `lore link` (parenting an orphan knowledge doc) → `check:spec-mirror` **EXIT=2**
3. re-export → **EXIT=0** again

This also explains why `79219bf2`'s force-rebuild of ADR-037 and PLAN-138 did not clear it:
the rebuild itself was a corpus-state-changing operation, and more writes followed.

## Why this is a North Star violation, not a bug to patch

The oracle's green state requires an EXCLUSIVE corpus — no other writer between export and
check. The standing brief names that exact shape as disqualifying: *"An answer that relies on
exclusivity — clean tree, exclusive corpus, single-writer file — is a refusal of the target
state, not a design."* Under MANY CONCURRENT SESSIONS the green window does not exist.

It also fails "it must not lie": the check reports `content: N corpus doc(s) whose mirror body
no longer matches`, which reads as staleness. The mirror is not stale. It is resolved, and the
comparison is between two different representations.

## What the fix has to change (none of it done here)

⛔ Re-exporting is NOT a fix — it moves the red to the next write. Three candidate designs,
none evaluated here beyond naming the trade:

1. Compare resolved-vs-resolved: resolve the corpus source through `OutlineService` before
   diffing. Makes the check honest but keeps it corpus-state-dependent, so it still reddens on
   unrelated writes.
2. Compare unresolved-vs-unresolved: store the unresolved source in the mirror and resolve only
   at read time. Removes the state dependence entirely; changes what the mirror IS.
3. Exclude placeholder-bearing docs from content parity, and say so in the count so the
   exclusion is not silent ("it must not go silent" — a filtered doc must leave a trace).

## Operational consequence, effective immediately

Because export must be the last write, **corpus writes have to be batched**: do every
`lore set` / `anchor` / `link` / `evidence` / `assess` / `handoff` write first, then
`mirror:export` + `export-docs --force`, then verify. Interleaving a single corpus write with
a suite run reddens `spec-mirror-export.test.ts` on parity grounds — measured this session,
3 of 23 tests, self-inflicted and initially mistaken for a real regression.

## Second-order finding: the `&&` chain hides half the verdict

`package.json`'s `test` script is
`check:ac-state-renderers && test:vitest && test:bun && check:spec-mirror`.
`test:vitest` failing means `test:bun` AND `check:spec-mirror` NEVER RUN. Across two full-suite
runs this session, the bun half was never executed and the mirror check never reached — the
very check whose exit code was being investigated. This is the already-recorded
`knowledge-a-gate-at-the-end-of-a-chain-is-never-invoked-while` lesson, now measured a second
time on a different chain position.
