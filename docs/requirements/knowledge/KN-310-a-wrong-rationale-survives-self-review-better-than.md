---
id: KN-310
type: knowledge
role: knowledge
title: "A wrong rationale survives self-review better than a missing one — four blind spots an independent review exposed"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: SPEC-118
links:
  - {id: SPEC-117, type: informs}
---
# A wrong rationale survives self-review better than a missing one — and four self-review blind spots it exposed

Measured 2026-07-31. Two commits were self-verified (red-green, mutation probes, reverse controls, full suite on a clean tree, a live end-to-end dispatch), then handed to an independent read-only reviewer. It found three real defects. The most important one had survived **two** of my own passes.

## The headline: a wrong rationale is more durable than an omission

`git branch --contains HEAD` emits git's own synthetic display row `(HEAD detached at <sha>)` in a detached worktree, and `rev-parse --abbrev-ref HEAD` returns the literal `HEAD` there — so a filter on the current branch name does not remove it. The diagnostic printed that row as a ref "strictly BEHIND", inside a message instructing the agent to `git merge --ff-only <that>`, which cannot work because the row is not a ref.

I had already looked at this code twice. On the second pass I *noticed* detached HEAD, reasoned about it, and wrote a comment concluding: "`--abbrev-ref` yields `HEAD`, which matches no branch name, so nothing is filtered out and every containing branch is reported — correct for that case." Every clause of that sentence is true except the last, and the last one is the whole claim.

**Root cause.** An omission leaves a blank that a checklist pass can still catch. A wrong rationale leaves something that *looks* like the output of having checked, so the next pass reads the reasoning, finds it coherent, and moves on. Self-review re-reads its own conclusions; it does not re-derive them. The reviewer caught it by **running the command** in a real detached worktree instead of reading the comment.

**Mechanization.** Any comment asserting what a command outputs in a specific state must be accompanied by a test that produces that state, or it is a hypothesis wearing the costume of a finding. The fix is now pinned by a regression test that builds a real temporary repo detached onto an earlier commit, with a control assertion that the diagnostic actually fired (AC-DI-4). Also: prefer `git for-each-ref --contains <c> refs/heads refs/remotes` over `git branch --contains` whenever the output is consumed programmatically — `branch` is a *porcelain* command whose output includes display artifacts, and including `refs/remotes` additionally covers a local branch behind its upstream, which a heads-only scan reports as no diagnostic at all.

## Blind spot 2 — "fixed" meant "fixed one of the two copies"

`RealSetupFsWriter.remove` was hardened against symlink reach-through. `removeProjectPath`, a standalone sync twin **in the same file, 100 lines below**, kept the byte-identical `existsSync` + `rmSync` shape and is live-wired to `lore setup --project --uninstall`. I found this one myself, but only on a deliberate second sweep of the same file — the first pass was structured around "fix the class the incident came from" and the incident had come through the machine-install path.

**Root cause.** A defect class is defined by its *shape* (`existsSync` guard + `rmSync`), not by the entry point that exposed it. Fixing per-entry-point leaves the shape live wherever else it occurs.

**Mechanization.** After fixing a defect, grep the shape — not the symbol — across the file and package, and state the hit count in the commit. Two consumers, two call-site families (six + three), one shape.

## Blind spot 3 — `try/catch` does not catch a hang

The gate wrapped its git calls and the spec claimed "any failure falls through to exit 0". `execFileSync`'s default timeout is `0` (disabled). A PreToolUse hook sits in front of the dispatch, so a stalled git — `index.lock` contention, which this repo's own concurrent-worktree workflow makes routine — would have wedged the tool call with no error to catch. Both the code and the spec sentence read as complete; neither covered the failure mode with no exception.

**Mechanization.** Every subprocess call in a hook needs an explicit `timeout` and `maxBuffer`. "Wrapped in try/catch" is not a liveness argument — enumerate hang separately from throw.

## Blind spot 4 — a syntactic pin silently narrows its own claim

The call-site pin scanned for `await this.writer.remove(` and its test was named "no removal call site omits the boundary option". A fire-and-forget `void this.writer.remove(...)` matches the name's claim but not the regex. (The reviewer confirmed the pattern *does* span multi-line reformatted calls, which was the risk I had tested for — I had verified the case I thought of and not the case I hadn't.)

**Mechanization.** A source-scanning assertion overclaims by default. Keep the matched prefix as short as the call itself allows, and read the test's own name as a specification of what it must catch.

## Blind spot 5 — tolerating a behaviour is not pinning it

`removeDirIfEmpty`'s symlink branch was asserted only via "does not throw". Nothing checked whether the link survived, so the behaviour could have drifted in either direction — including into unlinking a link lore never created — with the suite still green. Relatedly, the spec's D6 claimed the code "unlinks a symlink found at the directory position", which it never did: an SSOT drift where the decision log described a MORE destructive behaviour than the implementation. Nothing caught the disagreement because nothing pinned either side.

**Mechanization.** When a decision says what happens to a resource, the test asserts the resource's state afterwards, not merely the absence of an exception. A `resolves`/`not.toThrow` assertion pins liveness, never semantics.

## What self-review DID catch, for calibration

Not everything needed the reviewer. Self-review found and fixed the missing timeout, the unbounded branch list, and the sync twin before the review returned; it also correctly verified multi-line regex robustness and correctly diagnosed a manifest-freshness failure as a dirty-tree artifact rather than a defect. The pattern in what it missed is specific: **it re-read its own reasoning instead of re-running the command**, and it verified the failure modes it had thought of. The reviewer's advantage was not diligence — it was not having authored the rationale.
