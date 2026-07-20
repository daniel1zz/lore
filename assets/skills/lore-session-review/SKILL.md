---
name: lore-session-review
description: "Session PROCESS-quality review for lore-governed work — judges how a session executed the workflow (claim/evidence discipline, subagent protocol, git worktree hygiene, gate compliance, oracle usage), not the code it produced. Runs deterministic artifact checks (corpus + git) plus an independent-judge pass over an invariant catalog, and persists findings as a knowledge retro. Use when the user says 'review this session', 'session 质量', '复盘这次会话的过程', 'audit the agent's behavior', 'how disciplined was this run', after an autopilot run finishes, or after any session with multi-agent orchestration or incidents. NOT for persisting session learnings/decisions (that is lore-session) and NOT for reviewing code changes (that is lore-review)."
---

# Session Process-Quality Review

Judge the session's **process**, not its product. A session can ship green code while violating every discipline that makes the next session safe (unclaimed work, unverified merges, self-judged evidence). Those violations are invisible to code review and to `lore assess` (which needs a plan's evidence chain — precisely what an undisciplined session fails to produce). This skill closes that gap.

Complementary skills: `lore-session` persists knowledge (capture posture); this skill finds violations (adversarial posture). Run this BEFORE lore-session's handoff step so the retro can reference the findings.

## Inputs

Default: the **live session** — gather evidence from the current environment (git repo, `.lore/` corpus, your own transcript memory). Alternative: the user provides a **dossier** (a directory or file with transcript excerpts and captured command outputs, e.g. for retrospective review of a past/foreign session) — then read the dossier INSTEAD of running live commands, and say so in the report header.

If the project has no `.lore/`, corpus checks are N/A (not failures) — note it and continue with the git/process checks.

## Phase 1 — Deterministic artifact checks (zero LLM, run every one)

Each check is a command with a mechanical pass criterion. Run them yourself; record command + observed output per check. These catch the violation classes that have ACTUALLY occurred (each check below traces to a real incident).

| ID | Check | Command | FAIL when |
|---|---|---|---|
| D1 | Empty-branch merge (agent reported DONE but never committed; orchestrator merged anyway) | For each merge commit in the session window: `git log --oneline <merge>^1..<merge>^2` | A merged branch contributed 0 commits, or a merge printed "Already up to date" for a branch that was supposed to carry work |
| D2 | Worktree remnants | `git worktree list` + `git branch --no-merged main` | Leftover agent worktrees/branches with no live agent attached, or an unmerged branch whose worktree was removed |
| D3 | Dangling agent work | `git fsck --dangling \| head -30`, inspect `On worktree-*`/WIP subjects | Dangling commits from THIS session's agents whose content never reached main |
| D4 | Corpus chain usage | `lore ready <plan> --json` / `lore list --type task --json` for the session's plan; `lore audit --json` for the session window | Implementation work happened with NO task claim and NO evidence rows for the session's actors (the anchor-overlap gate never protected anything) |
| D5 | Evidence oracle quality | Read the session's `verification_evidence` entries (`lore get <task>`) | An evidence entry's oracle is a self-assessment ("reviewed the code, looks correct") rather than an external command with an exit code |
| D6 | Gate bypass | `lore audit` + transcript: any `LORE_GATE_BYPASS=1` / `--no-verify` / `CLAUDE_SUBAGENT_GATE_BYPASS` usage | A bypass was used without explicit user authorization in the transcript |
| D7 | Uncommitted repo state | `git status --short` at session end | Tracked-file modifications or untracked source files left dangling with no handoff mentioning them |

Read `references/invariants.md` §Deterministic checks for per-check interpretation guidance and known false-positive patterns before marking any FAIL.

## Phase 2 — Invariant judgment (independent judge, never self-graded)

Dispatch a **read-only reviewer subagent** (e.g. `lore-reviewer`) as the judge — the session's own agent judging its own discipline is the Self-Verification Paradox this skill exists to counter. If subagent dispatch is unavailable (claude.ai), state that the review is self-graded and mark every verdict `confidence: low`.

Give the judge: (a) a factual session summary you write (what was asked, what was dispatched, what merged — facts, not self-assessment), (b) Phase 1 results, (c) the invariant catalog `references/invariants.md`. The judge returns one verdict per invariant: `PASS | VIOLATION | N/A` + a one-line evidence quote. An invariant without evidence either way is `N/A (not exercised)`, never a silent PASS.

The catalog (I1–I11, full definitions in the reference file): feed-before-produce · claim-before-work · evidence-before-done · commit-before-done · merge-verify-before-cleanup · red-before-green · gate compliance · doc-sync honesty · handoff on unfinished work · orchestration hygiene (actor identity, anchor mutex, watermarks) · CLOSE-phase hygiene (anchor add, spec status, assess, invalidate).

**The catalog is a floor, not a ceiling.** After judging every listed invariant, ask explicitly: "what discipline problem does THIS session have that the catalog does not name?" A structured checklist creates tunnel vision — a reviewer who checks I1–I11 and stops will pass a session that violated something uncatalogued. CLOSE-phase omissions (I11) and anything downstream of a green merge are the usual blind spots, because the session looks finished. Report an uncatalogued finding as `V? [uncatalogued] — <title>` with the same evidence/consequence/correction shape, and note that the catalog may need a new invariant (a real gap found this way is more valuable than any checklist verdict).

## Phase 3 — Report

ALWAYS use this exact structure:

```markdown
# Session Process Review — <date> <short session descriptor>
**Mode**: live | dossier   **Judge**: independent (<agent type>) | self-graded (low confidence)

## Verdict summary
<N> PASS / <N> VIOLATION / <N> N/A  ·  deterministic checks: <N>/<7> clean

## Violations (most severe first)
### V1 [<invariant or check id>] — <title>
- **Evidence**: <quote/command output>
- **Consequence**: <what this made unsafe>
- **Correction**: <the literal command or protocol change>

## Deterministic check table
| ID | Result | Evidence |

## What went well
<2-4 bullets — disciplined behaviors worth reinforcing, only if genuinely observed>

## N/A invariants
<list with one-line reasons>
```

No violations found is a valid outcome — report it plainly; never manufacture findings.

## Phase 4 — Persist

If the project has `.lore/`: write the report as `lore create knowledge --sub-type retro --title "Session process review — <date> <descriptor>" --content-file <report>` and `lore link` it to the session's plan (if one exists, kind `informs`). Export `CLAUDECODE=1` so AI-assist stays off. No `.lore/` → offer the report as a file and suggest `lore init`.

If the same violation class appears in a PRIOR session-review retro (search: `lore search "session process review" --json`), say so — a repeat finding is a systemic gap that belongs in CLAUDE.md or a hook/gate, not just another retro. Recommend the mechanization explicitly (this project's pattern: prompt discipline → deterministic gate).
