---
id: KN-199
type: knowledge
role: knowledge
title: "Retired from root CLAUDE.md — the 19 dogfooding standing lessons, verbatim"
status: draft
priority: medium
created: 2026-08-04
updated: 2026-08-04
tags: []
parent: PRD-001
links:
  - {id: ADR-013, type: relates-to}
---
# Retired from root CLAUDE.md — the 19 dogfooding "standing lessons", verbatim

Retired 2026-08-04 by `agent:main-orchestrator` during the contract-conformance slim-down.

**Why**: `lore governance claude-md`'s Index-Entry Contract is explicit — every list-like section
(it names "a standing-lessons list" specifically) follows **one line per item, scope keywords
only**: *"State what the item covers, not what it concluded or how it got there — that belongs in
the corpus doc the line points to. An index entry that grows past a line is no longer an index
entry; split the detail out and leave the pointer."*

Measured at retirement: **7569 bytes / 31 lines = 31.5%** of a 24526-byte / 207-line file, i.e.
~500 bytes per "one-line" entry, every one of them carrying its conclusion and its history. The
file stood 7 lines over the official 200-line target with 50 bytes of headroom left, which had
already blocked ADR D1's own standing lesson from landing across two sessions.

**What survives where**: root CLAUDE.md keeps a compressed index — scope keywords plus a corpus
slug where one exists — under Architecture. The full text of every lesson is below. The
pre-2026-07-22 33-row history remains FROZEN at
`docs/claude-md-archive/dogfood-eval-log.md`.

⛔ Several lessons below have NO corpus doc of their own yet; this document is their SSOT until
one is written. Do not delete it, and do not treat a compressed index line in CLAUDE.md as the
full statement of the rule.

---

## Verbatim text as retired

**Standing lessons** (full 33-row history: `docs/claude-md-archive/dogfood-eval-log.md`; several
also as lore knowledge docs):

- **False oracles** — exit-code-true ≠ measured-the-right-thing. Six known vectors; four
  mechanized in `lore verify`, two NOT: a silently-inert flag (only the AC can assert its SIDE
  EFFECT, plus a live-interceptor control) and the self-report path. Standing residual: a
  same-runner unfiltered multi-file pass records unproven.
  `knowledge-retro-a-silently-inert-cli-flag-is-the-fifth-false`,
  `spec-evidence-output-tail-integrity-a-self-reported-non-pass`,
  `task-vitest-run-silently-drops-a-bun-test-ts-named-alongside-a`
- **Contiguous-substring assumption**: matchers/filters built from remembered phrases silently
  degrade to no-match ("no match + exit 0" is indistinguishable from "passed"); key on lone
  tokens + independent negative conditions.
- **SSOT↔installed asset pairs** need content-parity or content-invariant assertions — manifest
  presence alone makes "fixed in both copies" unverifiable (bidirectional divergence observed).
- **Consumer/end-to-end audits**: a writer whose reader was retired, a reader without a writer, a
  roster map with renamed types — all fail SILENT. Every distribution pipe and every gate-read
  field needs an install→visible / author→trip end-to-end oracle.
- **Worktree dispatch**: `bun install` FIRST in any fresh worktree (module resolution silently
  walks up into the main checkout — oracles test stale source); verify `git log` on the branch
  BEFORE merge+cleanup ("Already up to date" on a branch that should carry work = STOP, recover
  first).
- **The global `lore` is a symlink into the MAIN CHECKOUT's `dist/`** — `bun run build`
  hot-swaps the CLI under every live agent (⛔ never rebuild while one runs), and until it IS
  rebuilt every CLI fix stays inert for agents, hooks, and its own author (merging ≠ releasing).
  Rebuild exactly once, after the last agent, before the authoritative full-suite run.
  `knowledge-the-global-lore-is-a-symlink-into-the-main-checkout-s`
- **`subagent-stop-commit-guard.mjs` has ONE known gap**: a LIVE background child at hook-fire
  time can slip past it (harness timing, not guard logic — probed sound; do NOT "fix" it), so the
  git-log-before-merge backstop above stays necessary.
- **Static discipline belongs in CLAUDE.md layers, never in a hook** — a hook carries only
  dynamic, computed state.
- **Escalation ≠ build**: a twice-recommended mechanization triggers a VERIFICATION pass first,
  not a build pass — check whether the underlying tool already enforces the invariant (verify
  found the guard already built — wired only to `--force`).
- **`spawnSync` capturing a growing `--json` payload MUST set explicit `maxBuffer`** (1 MiB
  default silently truncates); never discard stderr on batch corpus writes; pass multi-arg lore
  calls as explicit quoted args, never pair-strings. **`set -e` is INERT in the agent shell**
  (measured: a bare `false` aborts nothing, subshell or top level) — a multi-command batch runs
  to completion past any failure, so a corpus-write batch is silently partial. Chain with `&&`,
  or assert the resulting state (e.g. the AC id set) after every batch.
- **`mode-$0.md` skill pattern**: pass the mode name as the FIRST token; skills must validate the
  mode against the known set BEFORE any `Read`.
- **Checklists are a floor, not a ceiling**: after judging every listed invariant, ask what
  uncatalogued problem this session has (structured-checklist tunnel vision underperforms an
  unstructured reviewer on unlisted omissions).
- **`lore assess --diff`**: derive the range from the plan's own first task commit — a too-wide
  range silently converts unrelated work into false scope-drift findings.
- **Main-checkout oracle runs need actor identity** (`LORE_ACTOR=agent:main-orchestrator`) — the
  resolveActor OS-fallback warning is ADVISORY only (exit stays 0, actor still resolves), and
  SPEC-104's worktree tier structurally cannot fire in a main checkout, so nothing enforces this.
- **Distribution-first fixes** — an improvement landed only on a machine-local surface
  (`~/.claude/*`, installed copies, a dev symlink) does not exist for consumers; every
  discipline/hook/skill/prose/number change MUST name its delivery surface before it counts as
  done. `adr-distribution-first-every-improvement-names-its-consumer`
- **Spec close-outs write NOTHING to CLAUDE.md** — not even one-line index entries (a measured
  bloat attractor); the corpus is the only spec index.
  `adr-claude-md-specs-section-is-pointer-only-per-spec-index`
- **In a shared checkout, commit PATH-SCOPED** (`git commit -- <paths>`) — a bare `git commit`
  after a targeted `git add` also commits whatever ANOTHER live session has staged (observed: a
  one-line CLAUDE.md edit carried in a co-resident session's file rename under this session's
  message). No lore invariant catches this: it is neither an anchor collision nor a
  worktree-dispatch fault.
- **A full-suite verdict requires a CLEAN tree at a named commit** — `git status --porcelain`
  empty (or run it in an isolated worktree). A dirty concurrent checkout turns another session's
  in-flight edits and a missing/stale `dist/lore` into phantom regressions of your own: same
  commit measured 20+ failures dirty vs 4 (all foreign RED tests) clean.
- **A new deterministic gate retroactively invalidates the whole back-catalog** — its predicate
  evaluates at close time against data authored under the old rules. Budget the one-time sweep
  AND an explicit retroactive policy in the SAME slice; prefer a written exemption over
  synthesizing the artifact the predicate looks for.
  `knowledge-retro-a-newly-built-gate-leaves-every-pre-existing`

---

## Added 2026-08-04, never carried in CLAUDE.md (no headroom existed)

- **A backgrounded oracle's completion notice reports the SHELL's exit code, not the oracle's** —
  persist `$?` to a file on the next statement and read it back; a foreground kill at the tool
  ceiling reports 143, not a test failure.
  `knowledge-a-backgrounded-command-s-completion-notice-reports`
- **`lore get`'s human render omits structured `extra`** — a reporter's measured refutation in
  `extra.issue_report` is invisible to a spec author reading the doc the documented way.
  `knowledge-lore-get-s-human-view-hides-extra-issue-report-so-a`
- **A human-rendered list column truncates** — determining presence/absence by grepping a title
  gives false readings; key on the ID column.
