---
id: KN-520
type: knowledge
role: knowledge
title: "Evicted from root CLAUDE.md 2026-08-24 — the 16 standing dogfooding lessons, verbatim, plus the three Same-doc pointers resolved"
status: approved
priority: medium
created: 2026-08-24
updated: 2026-08-24
tags: []
parent: SPEC-095
---
## Why this doc exists

The root `CLAUDE.md` "Standing lessons" list had grown into the exact defect the
CLAUDE.md content contract names: index entries carrying their own restated
conclusions and measurements instead of scope keywords plus a resolving pointer
(`lore governance claude-md` -> Index-Entry Contract, and the Eviction Rule's
point 5: "The stub IS an index entry"). Measured 2026-08-24 before this
eviction: the root file was 23820/24576 bytes, 18 bytes short of its
`eviction_required` floor (24576 x evict_threshold_fraction 0.97 = 23838), with
this one section holding 6718 bytes = 28% of the whole file.

This doc holds the evicted list VERBATIM, so the compression in `CLAUDE.md` is
lossless: every lesson below stays NORMATIVE, and each names the corpus doc that
carries its full text. The root file now keeps a scope-keyword line per lesson
plus its slug.

## Three pointers that did not resolve

The evicted list ended three entries with the bare words "Same doc." — a
POSITIONAL pointer, not an addressable one. Resolved by search + content match
on 2026-08-24, and written back into the root file as real slugs:

| Evicted entry | "Same doc." actually resolved to |
|---|---|
| `lore ac set` drops the spec to draft and hard-blocks descendant claims | `knowledge-three-of-lore-s-own-outputs-misled-this-session-a` |
| A literal corpus count inside a governance doc is a claim with no oracle (`pass_unfalsified` off 20x) | `knowledge-three-of-lore-s-own-outputs-misled-this-session-a` |
| An `assess` MAJOR can be exactly BACKWARDS (inverted rename side) | `knowledge-nine-findings-from-landing-the-mirror-id-unify-merge` |

The third one was pointing at the WRONG document: read positionally it names the
preceding bullet's `knowledge-an-attested-pass-is-not-evidence-of-production-wiring`,
which contains no such finding (measured: zero matches for "backward", "rename",
"path existence"); the finding actually lives in the mirror-id-unify retro under
its "Mechanization" heading. A positional pointer is not merely terse - it can be
silently false, which is the addressability property the North Star asks for.

## The evicted list, verbatim (as of root CLAUDE.md 2026-08-24, pre-compression)

**Standing lessons** — one line each, scope only. Full text: `knowledge-retired-from-root-claude-md-the-19-dogfooding`, `knowledge-retired-from-root-claude-md-2026-08-13-three-standing`; pre-2026-07-22 history: `docs/claude-md-archive/dogfood-eval-log.md` (FROZEN).

- False oracles — exit-code-true ≠ measured-the-right-thing; V7 pair a GREEN control; V8 it proves the harness STARTED, never that it SEES the copy it runs. `knowledge-a-symlinked-node-modules-makes-the-green-control-pass`
- Eight pointer-less lessons were evicted VERBATIM and remain normative — substring matchers, SSOT↔asset parity, distribution oracles, worktree dispatch order, `spawnSync`/`set -e`, main-checkout actor, path-scoped commits, clean-tree verdicts: `knowledge-retired-from-root-claude-md-eight-pointer-less`
- ⛔ NINE lessons were evicted as UNENFORCED — nothing refuses them if violated. They stay NORMATIVE, and each names the mechanism it still needs: `knowledge-the-nine-unenforced-standing-lessons-evicted-from`. That count is the honest distance to unattended operation. A `plan-close` prose copy was also dropped: the gate enforces it (`lore gate plan-close --explain` is the SSOT).
- Distribution-first: name the delivery surface or it does not exist for consumers. `adr-distribution-first-every-improvement-names-its-consumer`
- Spec close-outs write NOTHING to this file. `adr-claude-md-specs-section-is-pointer-only-per-spec-index`
- A new deterministic gate retroactively invalidates the back-catalog — budget the sweep + a written exemption in the SAME slice. `knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`
- Marker censuses over a self-documenting corpus over-match: anchor structurally + require a second independent condition. `knowledge-the-substring-matcher-lesson-has-a-mirror-face-over`
- Before blaming a red suite on the diff: timeouts ≠ assertion mismatches, check isolation, read MEMORY not load average. `knowledge-load-average-is-the-wrong-instrument-for-is-this-red`
- ⛔ Tightening an AC via `lore ac set` drops the spec to `draft` and hard-blocks EVERY descendant claim (`ac add` does not demote — see the asymmetry above) — re-read the spec's status immediately before each dispatch, never from a batch-start snapshot. Same doc.
- ⛔ A literal corpus count inside a governance doc is a claim with no oracle — cite the `lore status --json` field instead. A `pass_unfalsified` figure justifying a decision was off 20x. Same doc.
- ⛔ The tool FIELD lies too: `lore feed`/`bootstrap` count RETRACTED tasks as ready (two sites skip `isInvalidated`), `lore ready` excludes them — quoting the raw count can quote a wrong one. `knowledge-lore-feed-s-readiness-line-counts-retracted-tasks`
- ⛔ An ATTESTED pass is not evidence of production wiring: if the AC's command exercises the implementation layer while its prose promises a user-facing surface, attestation certifies an unreachable capability with the corpus's strongest evidence tier. Split any AC whose prose names two layers; a surface AC's oracle MUST drive the surface. Measured: 2 of 3 found by `lore assess`, all AFTER attestation — assess is load-bearing, not advisory-in-practice. `knowledge-an-attested-pass-is-not-evidence-of-production-wiring`
- ⛔ An `assess` MAJOR can be exactly BACKWARDS — one read a rename's SOURCE side as the result and indicted a filename that same commit FIXED. Machine-check every finding that names a path before scoring it; path existence is decidable, never a judgment. Same doc.
- ⛔ MEASURE a field/command before pinning an AC's oracle to it, and never pair that pin with a clause REFUSING the alternative in the same round: pinning `lore status --json` (which surfaces `ai_defaults` but NOT arbitrary resolved config) while forbidding a hand-rebuilt merge left an AC with no runnable oracle at all. Tightening an oracle can DESTROY it. `knowledge-five-governance-tooling-gaps-measured-while-resuming`
- ⛔ `lore ac list`'s count is scoped by the recording task's PLAN LINEAGE and IGNORES `ac_scope` — polarity inverted from the flag's own help. Attested rows from a task that declared the AC go uncounted; a task declaring none is counted. And `oracle_generation` bumps only when `verify.command` changes, so a stable command over a rewritten test file reads green forever. `knowledge-ac-coverage-counts-evidence-by-plan-lineage-and`
- ⛔ `--capture` NOW ATTESTS (SPEC-143 C5) and clears `lore done`'s attested floor, so the old "≠ attested" rule is FALSE for new rows — but it proves only that a CALLER-SUPPLIED command exited 0, where `verify` proves the command came from declared scope. The floor asks presence, not provenance. `knowledge-lore-evidence-capture-now-clears-the-attested-floor`
