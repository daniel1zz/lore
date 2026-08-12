---
id: TASK-701
type: task
role: plan
title: "The mirror export silently skips a changed knowledge doc and every parity check reports OK"
status: draft
priority: high
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Measured 2026-08-12 on `main` at 44d3ada7, with a discriminating control.

## The defect

`bun run mirror:export` does not rewrite an existing mirror file when the corpus doc's CONTENT changes, at least for `knowledge` docs. Every available check reports OK, so the divergence is invisible.

Measured on `knowledge-eight-findings-from-landing-corpus-resolution` (`status: approved`, `sub_type: retro`, corpus version 9):

| | mirror file | corpus |
|---|---|---|
| bytes | 10521 | 17989 |
| occurrences of `## 9.` | 0 | 1 |
| occurrences of `## 10.` | 0 | 1 |
| occurrences of `## 11.` | 0 | 1 |
| occurrences of `SECOND CORRECTION` | 0 | 1 |

The mirror is frozen at the doc's v1 content while the corpus is at v9 — the body grew 71% and none of it landed.

Reproducibility: `md5` of `docs/requirements/knowledge/KN-441-eight-findings-from-landing-corpus-resolution.md` is byte-identical before and after a fresh `bun run mirror:export` (`1acbde2a2c329a2a80ba797a305a6e70` both times), and the export exits 0 reporting OK.

## CONTROL — the export is not globally broken

`spec-corpus-resolution-carries-provenance-and-a-foreign-write` was edited in the same session, is also `approved`, and its mirror file `SPEC-141-...md` DOES carry the new `Post-landing corrections` section. So specs are re-rendered and this knowledge doc is not. Without this control the report would be indistinguishable from "the export never rewrites anything", which is false.

## Why nothing caught it

Three independent checks all pass over the divergence:

1. `bun run mirror:export` exits 0 and prints OK.
2. `bun run check:spec-mirror` exits 0 and states outright: "count and slug parity; file CONTENT is not compared."
3. `git status --short .lore docs/requirements` is CLEAN — the stale file matches its last commit, so the repo-pollution guard in `spec-loop-e2e.bun.test.ts` sees nothing either.

A stale mirror is therefore not "dirty"; it is quietly wrong, and the pre-push corpus gate cannot distinguish it from a correct one. This is the failure shape this repo already names: an outcome the tool renders identically whether or not it is sound.

## What must land

1. Find why this doc is skipped and fix it at that root. Candidate hypotheses to measure, NOT to assume: content-digest tracking in `.lore/export-index.json`; a type/sub-type filter that treats ledger knowledge sub-types (`assessment | retro | handoff | uat`) differently; an incremental write path keyed on something other than the content.
2. Extend `check:spec-mirror` to compare CONTENT, not just count and slug parity. The current message is honest about the limit, which is exactly why the limit needs closing rather than documenting.
3. The oracle must go red on a constructed divergence: edit a corpus doc's body, export, and assert the mirror file changed. A test that only exports and checks counts passes over this defect today.
4. Re-export the whole mirror once the fix lands — this defect means an unknown number of back-catalogue mirror files may already be stale in content while reporting parity.


## Widened after filing — it is not one doc, and probably not one type

Three further measurements on `main` at `bf477336`, all with a clean `git status` and an exporter exiting 0:

| doc | change made this session | mirror carries it |
|---|---|---|
| `spec-corpus-resolution-carries-provenance-and-a-foreign-write` → `SPEC-141` | new `Post-landing corrections` section | YES |
| `knowledge-eight-findings-from-landing-corpus-resolution` → `KN-441` | body grew 10521 → 17989 bytes | NO |
| `knowledge-handoff-agent-main-orchestrator-98` → `KN-442` | new `Addendum written after...` section | NO |
| `task-merged-tree-broad-suite-run-after-the-corpus-provenance` → `TASK-694` | two `verification_evidence` rows added | NO |

So the one type that re-renders is `spec`, and `knowledge` and `task` both do not. The exporter's own name (`export-spec-mirror.ts`) is a hint worth following: the spec path may be the only one with a content-update branch, with the others writing on first sight only.

Consequence for the whole corpus, stated plainly: **every task doc's mirror is a snapshot from its creation, so no evidence row this repo has ever recorded appears in `docs/requirements/task/`.** 700 task mirrors are affected by construction, not by accident. Anyone reading the mirror to answer "what evidence does this task carry" gets an empty answer that looks authoritative.

That also means correction 4 in the list above ("re-export the whole mirror once the fix lands") is not optional cleanup — it is the larger half of the work.

## Second measurement — the skip is NOT confined to `knowledge`

Measured 2026-08-12 by agent:main-orchestrator on `main` after merging the two corpus-provenance follow-up fixes, with a fresh `bun run mirror:export` that exited 0 and printed OK for every type.

`task-the-http-exemption-is-conditional-on-where-lore-serve-was` went `draft` v12 → `archived` v16 in this session (via `lore verify` + `lore done`). After the export:

| | mirror file | corpus |
|---|---|---|
| `status:` frontmatter | `draft` | `archived` |
| version | v12 content | v16 |
| listed by `git status --short` | NO | — |

File: `docs/requirements/task/TASK-698-the-http-exemption-is-conditional-on-where-lore-se.md`.

This narrows the hypothesis space in the section above:

- Hypothesis 2 (a type/sub-type filter singling out the ledger knowledge sub-types) is WEAKENED: a `task` is not a `knowledge` doc at all and has no `sub_type`, yet it is skipped identically. Whatever the mechanism is, it is not keyed on the knowledge ledger sub-types.
- The `spec` control still holds — specs re-render. So the split is not "nothing rewrites"; it is `spec` rewrites while at least `knowledge` and `task` do not. Any proposed root cause must explain that asymmetry, and a fix verified only on a `spec` doc would vacuously pass.

Also note the blast radius for correction 4: the same session created ONE new task (`TASK-702`), which the export DID write, while the status transition on an existing task did not land. So the export's new-file path works and its update path does not — the stale back-catalogue is therefore every doc that was ever EDITED after creation, not merely a handful.

## Third measurement — the `spec` CONTROL above is WRONG, and the blast radius is at least 171 files

Measured 2026-08-12 by agent:main-orchestrator, same session as the second measurement, after editing `spec-corpus-resolution-carries-provenance-and-a-foreign-write` from v27 to v33.

⛔ The CONTROL in the first section — "specs are re-rendered and this knowledge doc is not" — does NOT hold. After a fresh `bun run mirror:export` exiting 0:

| needle | mirror file | corpus (v33) |
|---|---|---|
| `A SECOND named exemption` | 0 | 1 |
| `RESOLVED 2026-08-12` | 0 | 1 |
| `FOUR-cell` | 0 | 1 |
| `does NOT yet deliver` | **1** | **0** |

The last row is the dangerous one: the mirror still carries a stale assertion that the SAME session had deliberately retired from the corpus. Since `.lore/lore.db` is gitignored, the mirror is the ONLY representation under version control — so git's copy of this spec kept asserting a defect that was already fixed, and any consumer reading the repo rather than the live corpus would have believed it.

So the split is not spec-vs-knowledge. The UPDATE path is broken for every type measured so far (`spec`, `knowledge`, `task`); only the NEW-FILE path works. Whatever the earlier spec observation was, it is not reproducible here and must not be used as a control.

### Blast radius, measured rather than estimated

Comparing the `status:` frontmatter of every mirror file against the live corpus by title (1294 files compared; 156 skipped as title-ambiguous, 7 with no corpus match):

**171 mirror files disagree with the corpus on `status` alone.**

That is a LOWER BOUND by construction — it detects only docs whose lifecycle state changed. A doc whose body was edited without a status transition is invisible to this probe, and the second measurement above showed those exist too. Correction 4's "unknown number" is therefore at least 171 and certainly larger.

### A working repair, and why it is a workaround not a fix

Deleting the stale file and re-exporting DOES produce correct content, because that routes the doc through the working new-file path:

```
rm docs/requirements/spec/SPEC-141-....md
bun run mirror:export     # exit 0
# recreated: 34802 -> 39033 bytes, all four needles now correct
```

⛔ Do NOT mistake this for the fix. It repairs one file per invocation and leaves the update path broken, so the very next edit re-introduces the drift. It is recorded here because it is what an operator can do TODAY, and because it independently confirms the root cause is in the update path rather than in rendering.
