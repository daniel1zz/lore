---
id: TASK-471
type: task
role: plan
title: "lore evidence's oracle-file precheck resolves against the main checkout, so a worktree implementer's brand-new test file reads as missing"
status: archived
priority: high
created: 2026-07-31
updated: 2026-08-01
tags: []
parent: PRD-001
---
## Task

`lore evidence`'s oracle-file existence precheck refuses a worktree implementer's
evidence for a test file it just created, because the precheck resolves the
command's path tokens against the MAIN checkout's corpus root rather than the
invoking worktree's cwd. Every dispatched implementer recording evidence for a
NEW test file hits this — which is the normal case, not an edge case.

## Measured, 2026-07-31/08-01

A dispatched implementer (worktree `agent-a1844592aabce8e02`) reported:

> AC-069-13's declared command needed adjusting: `cd packages/lore && bun test
> tests/…` fails the evidence guard's file-existence check (it resolves from repo
> root, blind to the `cd`). I ran and recorded the root-relative equivalent.

The orchestrator ran the **identical command string** from the main checkout
after merging that work, and it recorded cleanly:

```
lore evidence <task> --oracle e2e --result pass \
  --command "cd packages/lore && bun test tests/e2e/plan-exempt-attestation-compiled.bun.test.ts" \
  --output-tail-file …
→ exit 0   Recorded e2e evidence (pass) on … (v14)
```

So the `cd` prefix is NOT the variable — `extractCdPrefixTarget` exists in
`evidence-precheck.ts` and handles it. The variable is WHERE the path resolves.

Supporting measurement — a worktree's `.lore/` is a partial directory containing
only the git-TRACKED members:

```
$ ls -la .claude/worktrees/agent-a1844592aabce8e02/.lore
audit-anchor.json
export-index.json          # no config.yaml, no DB

$ ls -la .lore              # main checkout
.gitignore  audit-anchor.json  config.yaml  export-index.json
```

Because `audit-anchor.json` and `export-index.json` are tracked, git materializes
a `.lore/` directory inside every worktree that is a corpus root by appearance and
not by content. Corpus/DB resolution already survives this (worktree agents' rows
did land in the shared corpus — see `worktree-corpus-resolution.bun.test.ts`,
SPEC-063). The precheck's own path resolution apparently does not.

## Hypothesis, explicitly UNCONFIRMED

`commands/evidence.ts` owns the filesystem resolution (`evidence-precheck.ts`'s
module header states this deliberately: the pure module takes an injected
`fileExists`, and "which path is cwd, which is corpus root" is left to the CLI
layer). The suspicion is that it anchors on the discovered corpus root rather
than `process.cwd()`. **This has not been reproduced under controlled
conditions** — both observations above are single runs in different environments,
and per `knowledge-a-control-that-shares-the-load-with-the-observation` a
difference observed across two environments is not yet a diagnosis. Reproduce
before fixing.

## Oracle

- RED first: from a git worktree whose `.lore/` is the partial tracked-files
  shape, `lore evidence --result pass --command "<runner> <a test file that
  exists ONLY in that worktree>"` is refused; the same call for a file that
  exists in BOTH checkouts succeeds. Two runs, one variable — that pair is the
  diagnosis, and it is what is missing today.
- After the fix: the worktree-only file records cleanly, and a genuinely
  nonexistent file is STILL refused (the control — the fix must not degrade the
  precheck into always-pass, which would silently retire the guard that
  `task-lore-evidence-self-reported-pass-lacks-oracle-file` exists to provide).
- The refusal message, when it does fire from a worktree, names which root it
  resolved against — today an author cannot tell "your file is missing" from
  "I looked in the wrong tree".

## Why it matters beyond the friction

The failure direction is safe (a false REFUSAL, loud, exit 4 — not a false pass).
But it trains dispatched agents to rewrite their declared AC command to whatever
shape the guard accepts, which silently decouples the recorded command from the
AC's declared command. The implementer above did exactly that, correctly and
transparently. The next one may not report it.

## Source

Orchestrator verification of `task-escalated-recommended-2026-07-24-still-unbuilt-attestation`,
2026-08-01. Related: `spec-spec-063-verify-execution-root-correctness-under-linked-wor`
(the same class, already solved for `lore verify`'s execution root).
