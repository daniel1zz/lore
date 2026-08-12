---
id: TASK-707
type: task
role: plan
title: "AC ids are not globally unique, so an ad-hoc task scoped to a colliding id cannot reach the attested path the predecessor task built"
status: draft
priority: high
created: 2026-08-12
updated: 2026-08-12
tags: []
parent: PRD-001
---
Measured 2026-08-12 by agent:main-orchestrator while archiving the corpus-provenance follow-ups. This is the RESIDUAL of `task-an-ad-hoc-task-can-never-reach-the-attestation-path-that` (archived): that task built the ad-hoc runner path so `lore verify --task <adhoc>` works without a PLAN positional. It does work — and then this defect closes it again for a subset of tasks.

## The defect

For an ad-hoc task there is no plan lineage, so `extra.ac_scope` is the ONLY signal `lore verify --task` has for finding the governing spec. AC ids are not globally unique, so that signal is ambiguous whenever two specs declare the same id:

```
lore verify --task task-the-pure-resolver-s-iswithin-rejects-everything-at-the
→ exit 4
Validation failed on field 'ac_scope': ad-hoc task's declared ac_scope (AC-CP-1)
matches 2 specs (spec-corpus-resolution-carries-provenance-and-a-foreign-write,
spec-context-provenance-injected-corpus-global-state-and-a) — ambiguous. Never
guess which spec governs a task; narrow the declared ac_scope to AC ids unique
to a single spec.
```

Refusing to guess is CORRECT. The problem is that the remedy it prescribes is unavailable: `AC-CP-1` IS the criterion that task implements. Narrowing means dropping the only true scope declaration, which trades a refusal for a lie.

Measured declared-id sets for the two colliding specs:

| spec | declared AC ids |
|---|---|
| `spec-corpus-resolution-carries-provenance-and-a-foreign-write` | 1, 2, 3, 4, 5 |
| `spec-context-provenance-injected-corpus-global-state-and-a` | 1, 2, 4, 6, 9, 10, 11 |

So `AC-CP-1/2/4` are structurally unarchivable-by-verify, while `AC-CP-3/5` happen to work. Which of your ACs are usable is an accident of what some unrelated spec declared.

## Two measured consequences, both already paid

1. `task-the-pure-resolver-s-iswithin-rejects-everything-at-the` could only be archived via `--override-attestation`, despite its implementer having run the full `test:changed` sweep green. The audited escape hatch became the routine path again — exactly the outcome the archived predecessor task set out to end.
2. It constrains DESIGN, not just archival. Adding an AC for the D5 seam exemption could not use `AC-CP-6`, because the other spec declares it and any future ad-hoc task scoped to it would inherit this refusal. The seam assertion was therefore folded into `AC-CP-3` as a fourth cell. That was a defensible outcome here, but the forcing function was id scarcity, not design.

Choosing a new AC id now requires auditing every other spec's declared set by hand. Nothing warns you at `lore ac add` time.

## What must land

1. Make the reference UNAMBIGUOUS rather than making authors avoid collisions. The natural fix is a qualified scope — spec slug plus AC id — so `ac_scope` names a criterion ON A SPEC instead of a bare string. ⛔ Do not "fix" this by mandating globally unique id prefixes in prose: nothing enforces it, and the 700-doc back catalogue already violates it.
2. Whatever the representation, `lore ac add` REFUSES (or warns loudly at) an id that collides with another spec's declared set — the collision is decidable at authoring time, which is the only moment it is cheap to fix.
3. Migration is part of this task, not a follow-up: existing ad-hoc tasks carry bare ids. State what happens to them, and make the old form either keep working or fail with the qualified form named in the message.
4. Two-sided oracle: (a) an ad-hoc task scoped to a COLLIDING id resolves its governing spec and `lore verify --task` runs; (b) a genuinely unresolvable scope is STILL refused rather than guessed. ⛔ Half (b) is the property the current refusal gets right — a fix that resolves by picking the first match has replaced an honest refusal with a silent wrong answer, which is strictly worse.
5. ⛔ Do not measure success by "the error no longer appears". Assert that the task ARCHIVES through the attested path with no `--override-attestation`, which is the outcome the archived predecessor task was closed on and which this defect silently reopened.
