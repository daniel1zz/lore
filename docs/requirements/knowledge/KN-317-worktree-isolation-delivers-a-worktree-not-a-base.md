---
id: KN-317
type: knowledge
role: knowledge
title: "Worktree isolation delivers a worktree, not a base — and evidence must be recorded from the execution root that ran the oracle"
status: approved
priority: medium
created: 2026-07-30
updated: 2026-07-30
tags: []
parent: PLAN-100
links:
  - {id: PLAN-100, type: informs}
---
# Worktree isolation delivers a worktree, not a base — and evidence must be recorded from the execution root that ran the oracle

Two mechanism findings measured 2026-07-30 while resuming `knowledge-handoff-agent-main-orchestrator-42` and closing T3 of `plan-implementation-resume-ticket-coverage-floor-ordinal-render`.

## Finding 1 — `isolation: 'worktree'` guarantees isolation, NOT a correct base

**Measured.** The predecessor session's recorded error was omitting `isolation: 'worktree'` from three Agent dispatches, so no worktrees were created. The obvious repair — always pass the parameter — is insufficient here, and the reason is structural.

The harness creates the worktree from the **current HEAD of the shared checkout**. In this repo the integration line is `fix/governance-never-discard-lore-output` (tip `8227dd1`), while the shared checkout sits on `main` (`60de416`): `main..fix` = 60 commits, `fix..main` = 0. Every symbol T5 depends on — the `lore handoff coverage-check` verb, `RESUME_COVERAGE_FLOOR`, the item-id prefixes — exists ONLY on the fix line. A dispatch that correctly passes `isolation: 'worktree'` therefore still hands the agent a tree in which the target code is **absent**.

The governing plan already carried this as a declared risk ("Every worktree must branch from that tip or the target code is absent"), and it still nearly repeated, because the isolation parameter *looks* like it settles the base question. Two orthogonal properties, one parameter: `isolation` decides WHERE the agent works, nothing decides FROM WHAT.

**Root cause.** Isolation and base-correctness are independent axes, and only one of them has a mechanism. A worktree on the wrong base fails in the most expensive direction available: the agent finds files missing, and its most natural recovery is to write them itself, producing a plausible reimplementation of already-merged work that passes its own scoped oracles.

**Mechanization.** The planned dispatch-isolation gate (OPEN SPEC 1) must assert BOTH conjuncts, not just the first:
1. writing `subagent_type` ⇒ `isolation === 'worktree'` (its original scope), and
2. the dispatch declares an explicit base commit, OR the shared checkout's HEAD is an ancestor of the declared integration tip.

Conjunct 2 is the one measured to be missing. Until that gate exists, every dispatch bundle must carry base correction as a **deterministic command plus an assertion the agent cannot satisfy by judgment** — `git reset --hard <tip>` followed by `git log --oneline -1` whose output MUST equal the tip, with an instruction to report blocked rather than proceed on mismatch. That is what the T5 dispatch used.

Corollary: `git branch -v` marks a branch checked out by another worktree with `+`. When concurrent sessions hold the integration branch (three were live here, all with running processes), it cannot be checked out or merged into. Branch a private integration line from its tip instead of waiting or evicting — evicting a live session's worktree is the failure mode this repo already records as "never delete an unmerged worktree".

## Finding 2 — `lore evidence` validates `--command` oracle paths against the CWD, so evidence must be recorded from the execution root that ran the oracle

**Measured.** T3's oracles ran inside a worktree detached at `8227dd1`. Recording the evidence from the shared checkout (on `main`) was **rejected**: `Oracle file(s) not found: packages/lore/tests/unit/handoff-coverage-check.test.ts`. The file exists on the fix line only. Re-running the identical `lore evidence` call from inside the worktree succeeded.

This is the tool working correctly, and it is worth recording precisely because the rejection is easy to misread as a lore defect and "fix" with `--oracle manual` — which would convert an attested test oracle into an unfalsifiable self-report, exactly the false-oracle class SPEC-061/063 mechanized against.

**Root cause.** An evidence record asserts "this command, in this tree, exited zero". The command string alone under-determines that claim; the execution root is part of it. The path check is the only thing tying the two together, and it can only bind against the CWD it runs in.

**Mechanization.** Already mechanized in the tool — the discipline is to record evidence from the same execution root that ran the oracle, never from the orchestrator's checkout on behalf of a worktree run. The corpus DB resolves to the same instance from either root (verified: `lore status` from the worktree reported the identical `total_docs` 988 and `last_updated`), so there is no reason to prefer the shared checkout.

Adjacent: the `--oracle` enum is `tsc | test | lint | build | e2e | manual | other`. `typecheck` is rejected — loud and correct, but the natural spelling of the npm script is not the enum member.

## Also confirmed this session (no new mechanism)

- The `~/.claude/skills/lore-init-context` dev symlink pointing into `assets/skills/` — a path inside lore's own `RETIRED_FROM_INSTALL_PATHS` — was unlinked to stop the recurring SSOT deletion (the file died twice in the predecessor session). 41 repo-pointing symlinks remain; hardening `lore setup`'s removal path to `lstat` and unlink the LINK rather than resolve through it is still unbuilt (OPEN SPEC 2).
- `git commit -F <file> -- <paths>` is order-sensitive: everything after `--` is a pathspec, so `git commit -- <paths> -m <msg>` feeds the message to git as a filename and fails with "did not match any file(s) known to git". Loud, but it joins the existing family of argument-shape traps in this repo (`--flag=<value>` for values starting with `-`).
