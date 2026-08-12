---
id: TASK-705
type: task
role: plan
title: "The undetermined provenance value has no policy: fail-open vs fail-closed on detector disagreement is unoracled"
status: draft
priority: high
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Raised by `lore review` on v30 of `spec-corpus-resolution-carries-provenance-and-a-foreign-write` as two BLOCKING questions (decision: escalate, confidence 0.62), while the four deterministic pre-checks all passed. Recorded here rather than answered in place, because both answers are design decisions, not corrections.

## Gap 1 — the third provenance value has no policy

D2 introduces a THREE-value union — `own`, `git_common_dir`, `undetermined` — and justifies `undetermined` explicitly on no-silent-fallback grounds: when the git detectors disagree or cannot run (git off PATH, the 5000 ms spawn timeout), the resolver must NOT pick a crossing story it cannot support.

But nothing in the design or in ANY of the five declared ACs says what the `foreign_corpus_write` predicate DOES with that value:

- AC-CP-1(c) pins only that the pure RESOLVER returns `undetermined` for that input shape.
- AC-CP-3's four cells are all `own` / `git_common_dir` situations — lifecycle × lease-intent, plus the seam exemption. No cell constructs a detector failure.
- AC-CP-4 and AC-CP-5 do not touch it.

So fail-open versus fail-closed on detector disagreement is currently unoracled. Either behaviour passes every AC this spec declares. That is precisely the class of implicit safety decision this spec refuses to leave implicit everywhere else — and the failure is asymmetric: fail-open means a foreign write lands whenever `git` is slow or absent, which is also exactly when a nested-worktree agent is most likely to be running.

## Gap 2 — `ResolvedCorpus.path` is non-optional but undefined in that state

`ResolvedCorpus` declares `readonly path: string` as NON-optional. D1 states the walk halts at the caller's own working-tree boundary. So when provenance is `undetermined` — meaning no hit inside the caller's tree and the crossing story unknown — it is unstated which `path` the record carries: an out-of-boundary walk hit, the unverified common-dir candidate, or something else. AC-CP-1(c) asserts only the provenance member, so no oracle disambiguates it.

A caller that reads `.path` off an `undetermined` result gets a string that means nothing in particular, with no type-level signal that it is untrustworthy.

## What must land

1. DECIDE the predicate's `undetermined` policy and argue it in D4/D5 — fail-closed (refuse) is the presumptive answer given this spec's own no-silent-fallback stance, but it MUST be argued, because refusing on every `git` hiccup is a real availability cost with no lease-based remedy for a non-lifecycle write.
2. Add an AC cell that CONSTRUCTS a detector failure (e.g. `git` unavailable on PATH, or the spawn timing out) against the same nested-worktree fixture AC-CP-3 uses, and asserts the chosen behaviour with the pinned exit code and token. ⛔ A cell that merely asserts the resolver returned `undetermined` re-tests AC-CP-1 and leaves this gap exactly where it is — the oracle must drive the PREDICATE.
3. Make the `path`-in-`undetermined` question unrepresentable rather than documented: either the union carries no `path` in that arm, or the field becomes optional with the type forcing callers to handle its absence. ⛔ Prose telling future callers not to read it is the layer this repo has already recorded as the wrong one.
4. Whatever is decided, the same session updates D2's union commentary — the current text explains why the value EXISTS without saying what anyone does with it, and that silence is what made this gap invisible to five ACs.
