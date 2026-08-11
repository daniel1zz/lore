---
id: KN-283
type: knowledge
role: knowledge
title: "Measured: rmSync unlinks a symlink it is pointed at, while statSync selects on the target's mtime"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: PRD-001
links:
  - {id: SPEC-117, type: informs}
---
# Measured: rmSync unlinks a symlink it is pointed AT, while statSync selects on the TARGET's mtime

## Why this exists

Three separate decisions in this corpus turn on Node's link-vs-follow semantics — `spec-lore-setup-deletes-repo-source-through-dev-symlinks` D1 (`lstat`, never `exists`), D2 (a link target is unlinked, not recursed into) and D6 (`ENOTDIR` at the directory position) — and the same class has been mis-reasoned in this repo more than once. A fourth decision, the deliberate NON-fix of `assets/hooks/session-start-resume.mjs:169,184`, rested on an **asserted** version of the same claim. This doc replaces the assertion with a measurement so the next session neither re-derives it nor restates it wrongly.

## What was measured (2026-07-31, Node on darwin 25.1.0)

A throwaway tree: `sessions/linked-session` → symlink → `real/precious/` containing `file.txt` with a unique sentinel. The TARGET directory's mtime was backdated to 2020 so an mtime cutoff would select it.

```
statSync('sessions/linked-session').mtime   → 2019-12-31T16:00:00.000Z   (the TARGET's)
lstatSync('sessions/linked-session').mtime  → 2026-07-31T07:12:33.053Z   (the LINK's own)

rmSync('sessions/linked-session', { recursive: true, force: true })

link still present    → false     (the link was unlinked)
TARGET FILE SURVIVES  → true      (sentinel content read back byte-intact)
```

## The two facts, stated separately because they point opposite ways

1. **`rmSync` with `recursive: true, force: true`, applied to a path that IS a symlink, unlinks the link and does NOT recurse into the target.** The far-side data survives. This is the reassuring half, and it is why a recursive sweep over a directory of links is not a data-loss path by itself.

2. **`statSync` follows the link, so an mtime-based selection judges the TARGET's age, not the link's.** A symlinked entry therefore IS selected by an "idle > N days" cutoff whenever its target is old — even though the link itself was created seconds ago. The selection basis is wrong; by fact (1) the consequence is harmless.

Fact (2) is the same `exists`/`stat`-follows-links trap that D1 was written to close in the setup writer. The asymmetry between the two facts is exactly why "is this shape dangerous?" cannot be answered by pattern-matching the shape — the danger depends on which call decides and which call acts.

## Disposition of the session-start-resume non-fix

`assets/hooks/session-start-resume.mjs` lines 169 (`existsSync(lockFile)` then `rmSync`) and 184 (`statSync(dir)` then `rmSync(dir, { recursive: true, force: true })`) carry the shape that caused the `lore setup` data loss, and remain deliberately unfixed. The reasoning now stands on the measurement above rather than on an assertion:

- The targets are the hook's own privately created state directories under `SESSION_STATE_BASE`; no developer workflow symlinks them (unlike `~/.claude/skills/**`, where 41 dev links exist by design).
- Even if one were a link, fact (1) says the sweep unlinks it and the far side survives.
- Fact (2) means such an entry could be selected on its target's age — a wrong selection basis with no destructive consequence.

Re-evaluate if that directory's ownership semantics ever change — specifically, if anything outside the hook starts creating entries under `SESSION_STATE_BASE/sessions/`.

## What this does NOT license

It does not make `existsSync`-then-delete safe in general. The setup incident destroyed repo source because the deleted path's **ANCESTOR** was a link and the target was a real file on the far side — `rmSync` acted through a real directory entry, not on a link. Fact (1) covers only the case where the path handed to `rmSync` is ITSELF the link.
