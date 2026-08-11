---
id: KN-314
type: knowledge
role: knowledge
title: "A binary-side mechanism is not delivered until someone rebuilds dist/lore — measured on the very ticket that carried the fix"
status: approved
priority: medium
created: 2026-07-31
updated: 2026-07-31
tags: []
parent: SPEC-112
links:
  - {id: PLAN-100, type: informs}
---
# A binary-side mechanism is not delivered until someone rebuilds dist/lore — measured on the very ticket that carried the fix

Measured 2026-07-30/31 closing `plan-implementation-resume-ticket-coverage-floor-ordinal-render`. Three findings, each with the mechanization it implies.

## Finding 1 — the resume ticket that handed off this work had NO coverage floor, because the global `lore` was a stale build

`lore` on this machine is a symlink: `~/.local/bin/lore → <repo>/dist/lore`. `dist/lore` is a gitignored local build artifact.

At session start the pasted ticket (`lore feed session-resume --handoff knowledge-handoff-agent-main-orchestrator-42`) rendered **no ordinal tags, no cardinality line, no `RESUME_COVERAGE_FLOOR`** — even though T1/T2 had been merged before that handoff was written, and the predecessor session had verified the mechanism live on handoff-40. Re-running the byte-identical command later produced all three, 59 lines, exit 0.

The cause is not the code and not the render path. `dist/lore`'s mtime was `Jul 30 22:39` — **after** the feed call. The predecessor session had verified the mechanism from inside its own worktree's build; the shared checkout's `dist/lore`, which IS the global `lore`, was never rebuilt at that point. Both feed paths (`--handoff <slug>` and bare `session-resume`) were confirmed correct once the binary was current, so the render logic was never at fault.

**Root cause.** For a binary-side mechanism, "merged" and "delivered" are different states, and the gap is invisible: the source contains the fix, every test passes against a freshly-built binary in a worktree, and the command the team actually runs keeps producing pre-fix output. Verification performed inside a worktree build cannot observe it — the worktree's `dist/lore` is not the one on `PATH`.

**Mechanization.** `bun run build` in the SHARED CHECKOUT is part of closing any plan whose delivery surface is binary-side output, not an optional afterthought — and the verification of last resort must run the binary that `PATH` resolves, not a worktree copy. A useful invariant: after landing a binary-side change, re-run the consumer-facing command through the global entry point and assert the new vocabulary appears. This is the same distribution-first rule already recorded for `~/.claude/*` copies, applied to the one artifact nobody thinks of as an install target because it lives in the repo.

## Finding 2 — the ⛔ "declare, don't loosen" constraint was verified, but the evidence was not in the audit bundle

`lore assess` correctly flagged AC-RC-14 as a **major** evidence-integrity gap: a green run of the two roster tests is equally consistent with the rosters having been rewritten to DERIVE from the directory enumeration — which would permanently disarm the tripwire — as with the one-line declaration the task required. A passing oracle cannot distinguish the fix from the cheat.

The constraint WAS respected, and it was checked before merge, by diffing every roster file for changes to comparison logic:

```
git diff 99da4d7..worktree-agent-a562eddc2631ef1cf -- \
  packages/lore/tests/unit/assets-ssot.test.ts \
  packages/lore/tests/unit/adapters/real-setup-ports.test.ts \
  packages/lore/tests/unit/service/setup-service.test.ts
```

Result: additive declarations only (`+ "hooks/stop-handoff-coverage.mjs"`, count comments `7 .mjs → 8`, `10 → 11`), zero changes to any comparison expression. The implementer additionally wrote the rule INTO the roster it touched ("Hardcoded on purpose … must be answered by DECLARING it here, never by deriving this list from the registry under test"), which strengthens the fence rather than removing it.

**Root cause.** Anti-cheat constraints are negative properties (do-not-loosen, zero-hit, do-not-touch). Evidence of a passing run is orthogonal to them. Recording only the exit code makes such a constraint unfalsifiable from the corpus, no matter how carefully it was actually checked — the check lived in the orchestrator's transcript, which is not an audit surface.

**Mechanization.** Any AC carrying a negative constraint needs the working diff (or a scoped grep with its command and zero-hit output) recorded as evidence alongside the oracle result. `lore assess`'s own process recommendation states this; it belongs in the AC's evidence, not in a reviewer's head.

## Finding 3 — "installed" was mistaken for "wired", and only a consumer-path audit caught it

T4's AC-RC-8 proved the new Stop hook lands byte-identically in a fresh install. It never fired: `HOOK_REGISTRATIONS` (`packages/core/src/distribution-hooks.ts`) — the SSOT for what `lore setup` writes into a consumer's `settings.json` — did not list it. `lore setup` copied the file and wrote no `Stop` entry. That module's own doc comment names this exact shape ("the settings.json wiring that makes a copied hook file actually RUN was left to the human, an inert-until-wired gap").

Found twice independently in one session (orchestrator reading the registry; T4's own consumer audit) — which is itself the signal: an install-parity AC and a registration AC are different assertions, and the first passing says nothing about the second.

Closed by T6 (AC-RC-13/AC-RC-14). Verified end-to-end afterwards through the REBUILT global binary against a throwaway `--claude-dir`: `Stop hooks installed: ['stop-doc-sync.mjs', 'stop-handoff-coverage.mjs']`, hook file present with the executable bit set, repo SSOT intact, tree clean.

**Mechanization.** Every shipped hook asset needs an `install → registered → fires` oracle, not an `install → present` one. The general rule already in CLAUDE.md ("every distribution pipe needs an install→visible end-to-end oracle") holds — the trap is that "visible" reads as "the file exists" when for a hook it must mean "the registration exists".

## Standing environment facts (recorded so they survive task archival)

- **A bare `lore setup` DELETES this repo's own source.** 41 dev symlinks point from `~/.claude/` into `assets/`; setup's removal path resolves THROUGH the symlink rather than unlinking the link. A 336-line `SKILL.md` was destroyed twice in the predecessor session. Mitigated this session by unlinking the one symlink whose target sits in `RETIRED_FROM_INSTALL_PATHS`; 41 remain and the hardening fix is specced but unbuilt. Until then every `lore setup` MUST pass `--claude-dir <throwaway>`, and it also requires `--yes` in a non-interactive session (correct, loud).
- **`CLAUDE_SESSION_ID` is UNSET in this harness** (the field provided is `CLAUDE_CODE_SESSION_ID`), so `assets/hooks/lib/turn-state.mjs::resolveSessionId()` always falls to its `ppid-$PPID` branch — 73/73 state dirs are `ppid-` named. A Stop hook and a Bash-tool `lore` resolve DIFFERENT ppids, so cross-process state between them is invisible in BOTH directions. This is why the spec carries no shared state (D8). Pre-existing defect in a shipped asset, not fixed here.
- **`git checkout -- <path>` is blocked by the git-safety gate**, correctly, even when the discarded content is provably byte-identical to a commit. `git stash push -- <path>` is the sanctioned route the gate itself names.
- **`lore evidence --oracle` does not accept `typecheck`** (enum: `tsc | test | lint | build | e2e | manual | other`), and it validates that the `--command`'s oracle FILE exists relative to the CWD — so evidence must be recorded from the execution root that ran the oracle. Both rejections are loud and correct.
- **`lore verify` accepts repeatable `--ac`**, which is what makes per-task attestation semantically honest: each task attests the ACs its own evidence references, instead of every task attesting all 14. The plan-close attestation floor requires at least one runner-attested entry per task carrying evidence, and `--task` + `--ac` together satisfy it without inventing coverage.
