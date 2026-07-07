---
id: KN-004
type: knowledge
role: knowledge
title: "Assess usage patterns: scoping bugfix plans and attaching diffs"
status: approved
priority: medium
created: 2026-07-02
updated: 2026-07-03
tags: [assess, usage, judge]
parent: SPEC-026
---
# lore assess usage patterns (learned from first three real runs)

1. **Bugfix/hardening plans inherit the parent spec's full AC surface.** getPlanBundle feeds the linked spec verbatim; a narrow plan hanging off a large spec (e.g. plan-spec-021-hardening under SPEC-021) gets judged against ALL AC-EXPORT-1..10, scoring conservatively on ACs outside its scope (observed: 63/100 despite complete in-scope delivery). Remedy: narrow plans should declare their own acceptance list in plan content — the judge weighs plan goals alongside spec ACs.
2. **Attach --diff for structural claims.** Without a diff, the judge can only score from evidence tails; allocator/schema-shape claims stay in conservative territory (observed in runs 1 and 3). Use lore assess <plan> --diff <merge-base>..HEAD after merging.
3. **Evidence tails should name test files/cases.** Named refs (run 2) lifted AC scores vs generic 'suite green' claims (run 1: 72 → run 2: 80).
4. **Spec truncation is routine** — SPEC-sized docs exceed the 12k budget; judgment.truncated: [spec] is expected, not an error. Raise ai.assess.max_spec_chars in config if full-spec judging matters.


## Closeout convention additions (SPEC-027 self-hosted loop, 2026-07-03)

5. **Pre-flight the diff budget before assessing.** `git diff <range> | wc -c` vs `ai.assess.max_diff_chars` (default 24000). SPEC-027 round 1 sent a 204k diff against the 24k budget — 88% silently dropped, judge explicitly scored AC-DH-5/7 from tests alone. Over budget → curate with `--diff-file` (source-only, tests attested via evidence instead) or raise the budget in `.lore/config.yaml`.
6. **Controlled rerun quantifies truncation cost.** Same plan, untruncated curated diff: source-blind ACs rose (AC-DH-5 88→90, AC-DH-7 85→87) while total held at 88 because the judge, seeing more source, surfaced deeper real gaps — both effects are informative; keep both assessments.
7. **Evidence output-tails carry scenario/case NAMES, not bare counts.** Judge round 2 flagged "coverage depth taken on evidence" when only aggregate pass counts were visible.
8. **Assess AFTER all evidence is recorded** (including `lore ready` terminal state). Round 1 ran assess before the ready-state evidence existed; the judge listed it as a gap.
9. **Score stability check.** Two independent runs on the same materials both returned 88/met — treat ±2 per-AC drift as judge noise, larger shifts as signal.

10. **Self-referential ACs need evidence-then-reassess.** An AC whose proof IS the assess run itself (e.g. "assess succeeds without workarounds") scores near-zero on the first run — the run cannot appear in its own materials. Record the run as task evidence, then re-assess: SPEC-030's AC-HJ-6 went 30 → 84 (verdict partially_met 77 → met 90).
11. **Pre-flight the diff budget in CHARS, not bytes.** `wc -c` counts bytes; the budget compares JS string length (chars). A diff with multi-byte UTF-8 measured 82,597 bytes but 79,915 chars — under budget, no truncation. Use `wc -m` or accept that `wc -c` overestimates for non-ASCII content.
