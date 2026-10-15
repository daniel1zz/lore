---
name: lore-session-review
description: "Use when the user says 'review this session', 'session 质量', '复盘这次会话的过程', 'how disciplined was this run', after an autopilot run, or after any session with multi-agent orchestration or incidents, to judge adherence to the workflow lore governs. NOT for persisting learnings (use lore-session-capture) or reviewing code changes (use lore-review)."
---

# Lore-Governed Session Performance Review

Judge how the session performed against the **Lore-governed workflow** — the corpus chain (feed → claim → evidence → release → assess → invalidate → handoff), the gates, and lore's own prescribed worktree-dispatch protocol (SPEC-042 + CLAUDE.md 主 Agent 分发制 / Worktree 并发安全). A session can ship green code while violating every discipline that makes the NEXT session safe (unclaimed work, unverified merges, self-judged evidence). Those violations are invisible to code review and to `lore assess` (which needs a plan's evidence chain — precisely what an undisciplined session fails to produce). This skill closes that gap.

**Scope — Lore performance ONLY.** This review judges adherence to Lore's governance model, nothing else. The worktree/dispatch invariants (I4/I5/I10, D1–D3) look like generic git discipline but are IN scope because they ARE lore's prescribed operational protocol — the execution half of the corpus model. But code quality, style, and general test-design discipline (red-before-green TDD) are OUT: if you observe one, note it inline as `[out-of-scope → lore-review / lore-test / lore-tdd]` and do NOT fold it into a Lore-discipline verdict. A finding that cannot be traced to a lore rule (a CLI verb, a corpus mechanism, a gate, or the dispatch protocol) does not belong in this report.

**Every finding reaches root cause — no symptom patches.** A violation is not resolved by "run this command next time" (symptom-level, and against CLAUDE.md 根因优先于表象). Each finding MUST name the ROOT cause — the missing mechanism / ambiguous prompt / absent gate that ALLOWED the breach — and propose the mechanization that prevents the whole class (this project's pattern: prompt discipline → deterministic gate/hook/CLI/config change). This applies on FIRST occurrence; root-cause analysis is never deferred to a repeat.

Complementary skills: `lore-session-capture` persists knowledge (capture posture); this skill finds Lore-discipline violations (adversarial posture). Run this BEFORE lore-session-capture's handoff step so the retro can reference the findings.

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

Dispatch a **read-only reviewer subagent** (e.g. `lore-reader`) as the judge — the session's own agent judging its own discipline is the Self-Verification Paradox this skill exists to counter. If subagent dispatch is unavailable (claude.ai), state that the review is self-graded and mark every verdict `confidence: low`.

Give the judge: (a) a factual session summary you write (what was asked, what was dispatched, what merged — facts, not self-assessment), (b) Phase 1 results, (c) the invariant catalog `references/invariants.md`. The judge returns one verdict per invariant: `PASS | VIOLATION | N/A` + a one-line evidence quote. An invariant without evidence either way is `N/A (not exercised)`, never a silent PASS.

The catalog (full definitions in the reference file), all Lore-governance invariants: I1 feed-before-produce · I2 claim-before-work · I3 evidence-before-done (external-oracle-only) · I4 commit-before-done · I5 merge-verify-before-cleanup · I7 gate compliance · I7b vacuity accounting (denials vs inapplicable, per gate) · I8 doc-sync honesty · I9 handoff on unfinished work · I10 orchestration hygiene (actor identity, anchor mutex, watermarks) · I11 CLOSE-phase hygiene (anchor add, spec status, assess, invalidate) · I12 no self-weakening (merged a predicate change, then transited that checkpoint) · I13 orchestrator-tier identity. (I6 red-before-green was RETIRED 2026-07-20 — general TDD discipline, not Lore-governance; the ID is kept as a tombstone so prior retros' "I6" references don't silently re-map.)

**I7b / I12 / I13 exist because I1–I11 all passed on a session that closed four plans through a gate hole it had merged itself** (2026-07-31). They are the checklist's own floor-not-ceiling lesson, mechanized: I7b asks whether any gate MEASURED anything, I12 whether the session edited its own judge, I13 whether the orchestrator writing the audit rows is even identifiable. Judge them on every session that transited a checkpoint — a 7/7 deterministic artifact score is exactly the state they were added to contradict.

**The catalog is a floor, not a ceiling — within the Lore-performance axis.** After judging every listed invariant, ask explicitly: "what LORE-discipline problem does THIS session have that the catalog does not name?" A structured checklist creates tunnel vision — a reviewer who checks the list and stops will pass a session that violated something uncatalogued. CLOSE-phase omissions (I11) and anything downstream of a green merge are the usual blind spots, because the session looks finished. Report an uncatalogued finding as `V? [uncatalogued] — <title>` with the same evidence / consequence / root-cause / mechanization shape, and note that the catalog may need a new invariant (a real gap found this way is more valuable than any checklist verdict). This floor-not-ceiling license is bounded by scope: an uncatalogued *Lore*-discipline gap is in; a general code/engineering issue is still `[out-of-scope]`, not a new invariant.

## Phase 3 — Report

ALWAYS use this exact structure:

```markdown
# Lore-Governed Session Performance Review — <date> <short session descriptor>
**Mode**: live | dossier   **Judge**: independent (<agent type>) | self-graded (low confidence)

## Verdict summary
<N> PASS / <N> VIOLATION / <N> N/A  ·  deterministic checks: <N>/<7> clean

## Violations (most severe first)
### V1 [<invariant or check id>] — <title>
- **Evidence**: <quote/command output>
- **Consequence**: <what this made unsafe for the next session>
- **Root cause**: <WHY the breach was possible — the absent gate / ambiguous prompt / missing mechanism / voluntarily-dark safety net. NOT the surface action ("forgot to claim" is the symptom; "claim is prompt-only discipline with no pre-work enforcement" is the root).>
- **Fix**: <immediate corrective command> → **Mechanization**: <the systemic change that prevents the whole CLASS — prompt discipline → deterministic gate/hook/CLI/config; or, if the mechanism already exists, name it and mark this "bypass of existing mechanism", which is a heavier finding>

## Deterministic check table
| ID | Result | Evidence |

## Out-of-scope observations (non-Lore, optional)
<any code-quality / general-engineering issues noticed but NOT judged here — one line each with the skill that owns it (lore-review / lore-test / lore-tdd). Omit the section if none.>

## What went well
<2-4 bullets — disciplined Lore behaviors worth reinforcing, only if genuinely observed>

## N/A invariants
<list with one-line reasons>
```

No violations found is a valid outcome — report it plainly; never manufacture findings. But every violation that IS reported must carry both Root cause and Mechanization — a violation block with only a corrective command is incomplete.

## Phase 4 — Persist

If the project has `.lore/`: write the report as `lore create knowledge --sub-type retro --title "Session process review — <date> <descriptor>" --content-file <report>` and `lore link` it to the session's plan (if one exists, kind `informs`). Export `CLAUDECODE=1` so AI-assist stays off. No `.lore/` → offer the report as a file and suggest `lore init`.

Every finding already carries its own Mechanization (Phase 3). Cross-check prior retros (`lore search "session process review" --json` / `lore search "session performance review" --json`): if a finding's mechanization was ALREADY recommended in an earlier retro and STILL not built, escalate its severity by one level and say so — a twice-recommended, un-built gate is itself a Lore-governance failure (the corpus flagged the class and nothing mechanized it). That escalation is the signal to stop writing retros about the class and actually land the gate/hook/CLAUDE.md change this session.

## Also use when

Other phrase that routes here: "audit the agent's behavior". The review judges Lore-workflow adherence only (corpus-chain discipline: feed / claim / evidence / gate / handoff / CLOSE, plus the worktree-dispatch protocol: actor identity, anchor mutex, merge-verify), not code quality or general engineering hygiene (red-green TDD, style and non-dispatch git habits belong to lore-review / lore-test / lore-tdd). It runs deterministic corpus and git artifact checks plus an independent-judge pass over the Lore-discipline invariant catalog, and persists findings, each with a root cause and a mechanization fix, as a knowledge retro.
