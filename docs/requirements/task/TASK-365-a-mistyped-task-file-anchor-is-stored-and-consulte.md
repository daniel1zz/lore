---
id: TASK-365
type: task
role: plan
title: "A mistyped task file_anchor is stored and consulted exactly like a correct one, so the mutual exclusion it declares is silently absent — advisory, never a refusal"
status: archived
priority: medium
created: 2026-08-02
updated: 2026-08-06
tags: []
parent: PRD-001
---
# Defect

A task's `extra.file_anchors` entries are never checked against the filesystem, so a
mistyped path is stored, displayed, and consulted by the `noAnchorOverlap` gate exactly like
a correct one. Because it can intersect nothing, the mutual exclusion it was declared to
provide is simply absent — and nothing anywhere says so.

Measured 2026-08-02: `normalizeFileAnchors` (`packages/core/src/file-anchors.ts:73`)
validates and normalizes only — dedup, `../`-escape refusal, absolute-path refusal, backslash
refusal, empty refusal, length cap. No existence probe, and by design it cannot have one:
`@lore/core` is browser-safe and must never top-level-import `fs`.

The asymmetry with the spec tier is real: a spec's `extra.code_anchors` ARE probed, and
`lore status --check-drift` reports `file_missing` (SPEC-045).

# Why the obvious fix is wrong

⛔ Do NOT add existence validation to `normalizeFileAnchors`, and do NOT make a missing path
a refusal at any layer. The asymmetry with `code_anchors` is JUSTIFIED, not accidental:

- Spec code anchors are declared AFTER the implementation lands ("declare anchors after
  landing, not during planning — an undeclared path reads as an instant false
  `file_missing`"). Their referent is required to exist already.
- Task file anchors are declared BEFORE the work. A task that creates a new module
  legitimately anchors a path that does not yet exist. Refusing it would make the mutex
  unusable for exactly the highest-risk case — two agents both creating the same new file.

So "the path exists" is not the property. The property is "this anchor names the file this
task will touch", and the filesystem can only ever speak to part of it.

# Required fix — a loud advisory at declaration, plus a dispatcher-facing read

1. A non-blocking advisory emitted at every `file_anchors` WRITE surface — `lore create task
   --anchor`, `lore anchor add`, MCP `lore_create.file_anchors`, `lore_anchor_set` — naming
   each declared anchor that does not resolve on disk. Non-blocking; exit code unchanged.
2. The same computation surfaced read-only in `lore ready <plan> --json`, beside the
   existing `anchor_conflicts[]`, so a dispatcher sees non-resolving anchors BEFORE assigning
   concurrent work. This is the half that addresses the actual failure mode — the write-time
   advisory is seen by the author, who is not the party the mutex protects.
3. IO lives in the adapter/service layer, never in `@lore/core`. Reuse the fs port
   `code-anchors`/`--check-drift` already probes through rather than opening a second one;
   if that port is not injectable from the task path, injecting it is part of this task.

# Proxy / Silence / Opt-in (binding — adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the)

**Proxy.** "The path resolves on disk" is a proxy for "the anchor names the file this task
will touch". Two named gaps, both ACCEPTED:

- Satisfies the proxy, violates the property: a typo that lands on a DIFFERENT real file
  (`session-service.ts` → `sessions.ts`, both present). The advisory stays silent and the
  mutex still protects the wrong file. Not detectable from the path alone.
- Violates the proxy, satisfies the property: a task creating a new file. This is why the
  mechanism is an advisory and not a refusal — see above.

**Silence.** This is the whole defect. Today a non-resolving anchor produces no signal at
any surface, and "the gate found no conflict" is indistinguishable from "the gate could not
have found one". The advisory must therefore be emitted even when the anchor list is
otherwise fine, and the `lore ready` field must distinguish *no non-resolving anchors* from
*not probed* — an empty array and an absent probe must not be the same value.

**Opt-in.** ⛔ The deeper residual, named here and deliberately NOT fixed by this task:
anchors are themselves opt-in. An undeclared anchor is invisible to `noAnchorOverlap`
entirely, so this advisory constrains only authors who already declared something. Probing
declared anchors makes the declared set more trustworthy; it does nothing about the
undeclared set, and manual intersection queueing stays necessary as defense-in-depth.
Anything claiming this task closes the anchor-mutex hole is overclaiming.

Related and load-bearing: a peer session's review concluded that anchor-SCOPED predicates
are the wrong shape for verifying worktree state (its NS3/NS4 fix was re-specified from
anchor-scoped to whole-worktree porcelain). That conclusion is about trusting anchors as a
SCOPE; this task is about improving the anchors themselves. They do not conflict, but a
future reader must not cite this task as evidence that anchor-scoped predicates are safe.

# Oracle

- Declaring `--anchor packages/lore/src/does-not-exist.ts` emits an advisory naming that
  exact path AND exits 0, and the anchor IS stored — asserting the advisory alone would pass
  against an implementation that refused the write.
- CONTROL: declaring an anchor that DOES resolve emits no advisory, so a blanket-advisory
  regression cannot pass as green.
- Directory-scope anchors (trailing `/`) resolve against a directory, not a file — one
  existing-dir case and one missing-dir case.
- `lore ready <plan> --json` reports the non-resolving anchor for a claimed task, and the
  field is structurally distinct when no probe was performed.
- REGRESSION: `packages/core/tests/file-anchors.test.ts` passes unmodified — `@lore/core`
  gains no IO. Assert `@lore/core`'s browser-safety source scan still passes
  (`packages/core/tests/browser-safety.test.ts`).
