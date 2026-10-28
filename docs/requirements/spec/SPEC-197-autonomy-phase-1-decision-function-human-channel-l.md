---
id: SPEC-197
type: spec
role: spec
title: "Autonomy phase 1: decision function, human channel, lore-executed cleanup, self-grantable overrides escalate"
status: approved
priority: medium
created: 2026-10-18
updated: 2026-10-28
tags: []
links:
  - {id: ADR-049, type: relates-to}
---
## Overview/Goal

Phase 1 of adr-autonomy-is-decided-by-measured-facts-one-decision-function: one pure decision function over lore-measured facts decides whether an operation runs unattended or reaches the human; the human answers only through a channel the agent cannot use; lore itself performs the cleanup operations that today fall to the human (stash, orphan processes), after making them recoverable; agents stop producing that mess; and the overrides an agent can self-grant today go through the same function.

Measured 2026-10-18: 28 stashes (8 provably contained in main), an orphan `npm pack` alive 25 h, two self-matching `pgrep -f` loops holding an agent alive 16 h (its run never ended, its worktree stayed locked), 170 leaked lore-attested-red-* temp dirs (3 still registered worktrees), 28 runs with no end; approve --override-judgment, done --override-attestation, ac exempt and verify --yes all executable by the agent with no human.

## Scope

In scope (phase 1, ADR D9):
1. decide() in @lore/core: operation-class registry, measured factors R/B/E/C/J, hard rules then weakest-link score, unmeasured = 0.
2. Append-only hash-chained decision log; worst-of per (class, subject, version).
3. Human channel `lore decide` (TTY + nonce; denied from agent tool calls; agent-asserted consent never resolves).
4. `lore stash prune`: archive every stash to refs/lore/archive/stash/<sha> first, then drop when decide() says auto.
5. `lore run reap`: runs record pid + start time; processes inside an ended run's worktree are reaped only when provably that run's or orphaned within its lifetime.
6. Agent hygiene: no stash steer in shipped assets; no self-matching pgrep waits; test helpers reap their own children on signals; verify --falsify removes its temp worktrees.
7. The four self-grantable overrides consult decide(); below threshold they escalate to a pending decision.
8. Calibration from outcomes tightens a class automatically; loosening is a human-always decision; a threshold record edited outside lore fails safe (every class escalates).

Initial class table (governed data, AC-AU-9; numbers are starting points, tightened by outcomes, loosened only by the human):

| Class | Tier | R | Threshold | Prior C |
|---|---|---|---|---|
| stash-drop | normal | loss-free-by-proof | 0.8 | 0.95 |
| worktree-remove | normal | loss-free-by-proof (clean, merged, no ignored path outside the regenerable set) | 0.8 | 0.97 |
| process-reap | normal | loss-free-by-proof (process of an ended run, tied by ancestry or start time) | 0.85 | 0.97 |
| override-judgment, override-attestation, ac-exempt | normal | reversible | 0.8 | 0.5 (escalates until outcomes accumulate) |
| verify-new-command | normal | reversible | 0.8 | 0.95 |
| run-end-stale | normal | reversible (metadata) | 0.8 | 0.97 |
| governance-loosen, report-issue, push-force, archive-ref-prune | human-always | — | — | — |

Required factors: every class requires R, B, E, C; J is optional (present only for classes that ask for an LLM review; absent J is left out of the minimum).

B (blast radius), from run/claim/worktree/session facts:

| Touches | B |
|---|---|
| only the calling run's own objects, or objects of an ENDED run | 1.0 |
| objects with no provable owner (e.g. a stash naming main or no branch), made recoverable first | 0.9 |
| the calling session's objects | 0.9 |
| shared state other actors read live (main's working tree, config, the corpus database) | 0.6 |
| an object owned by another LIVE run or session | 0.2 |
| anything outside this machine | 0 |

E (evidence for the safety predicate):

| How established | E |
|---|---|
| lore evaluated the predicate itself in this call | 1.0 |
| a runner-attested oracle row on the current subject version | 0.8 |
| self-report | 0.1 |
| none | 0 |

J (optional): the worst current-version LLM review decision mapped approve 1.0, escalate 0.4, reject 0.

Sampling floor (ADR D6, PRD I2): 1 in 10 auto decisions per class is queued for non-blocking human audit; a `wrong` audit counts as a reversed outcome.

Measured 2026-10-18 for stash attribution: of 28 stashes, 17 name a worktree-agent-* branch (attributable to that agent's run), 10 name main, 1 names no branch; none belongs to a live run, so the 17 agent stashes score B = 1.0 and the 11 naming main or no branch score B = 0.9 (AC-AU-4); all clear the 0.8 threshold once archived (R = loss-free-by-proof) and can be dropped automatically, each archived first.

Out of scope: migrating the remaining gates (later phases); changing the git-safety hook's refusal of agent-typed destructive commands (kept absolute); report-issue (already human-always by class).

## Acceptance Criteria

AC-AU-1..11 (`lore ac add`).


## Acceptance Criteria (structured)

- [⚑] [script] AC-AU-1: ONE PURE DECISION FUNCTION OVER MEASURED FACTS. decide(class, subject, facts) in @lore/core (no Node builtin in the default barrel) returns {verdict: auto|escalate|refuse, score, factors, reasons} (decide() itself returns refuse only for an invariant violation: unknown class or malformed facts — exit 4, nothing recorded as auto; a human-tty reject later sets the EFFECTIVE verdict of that subject version to refuse, AC-AU-2) from a registry of operation classes (each declares its recoverability path, importance tier and threshold). Rules in order: tier human-always -> escalate; R = irreversible-external -> escalate; R = irreversible-local with blast radius beyond own session -> escalate; else score = min over the class's required factors (R,B,E,C) plus J when J is present, and auto iff score >= threshold. R measures what could be lost beyond recovery: reversible 1.0, loss-free-by-proof 0.9, irreversible-local 0.2, irreversible-external 0; B and E use the tables in this spec's Scope. A REQUIRED factor the caller could not measure scores 0; J is optional per class — absent, it is left out of the minimum; present, it can only lower the score. Mandatory halves, table-driven, exact verdicts asserted: (1) all factors 1.0 on a human-always class -> escalate; (2) irreversible-external with every other factor 1.0 -> escalate; (3) a case where a weighted mean would pass but min fails (R=0.2, others 1.0, threshold 0.5) -> escalate; (4) same facts with J absent vs J=1.0 -> identical score (J never raises it), and with J=0.3 below the others -> score 0.3; (4b) a class without J and all required factors 1.0 -> auto (an absent optional J is not 'unmeasured'); (5) B unmeasured -> score 0 -> escalate; (6) control: every factor at or above threshold on a normal class -> auto.
  script: test — bunx --bun vitest run packages/core/tests/unit/autonomy-decide.test.ts && echo 'AC-AU-1 PASS: decide() applies hard rules then the weakest-link score over measured factors; unmeasured scores 0'
  other_command=2
- [⚑] [script] AC-AU-2: EVERY DECISION IS A RECORD; RE-SCORING CANNOT CROSS THE THRESHOLD. Each decide() call through the service layer appends a decision record (class, subject ids, subject version or sha, facts snapshot, factor values, score, threshold, verdict, executor run, channel) to an append-only log whose rows are hash-chained. The effective verdict for (class, subject, version) is the latest human-tty decision when one exists, else the WORST over its machine records; a new version is a new subject. Mandatory halves, throwaway corpus: (1) escalate then a second call with better facts on the SAME version -> effective verdict stays escalate; (2) the same improvement on a NEW version -> auto; (3) tampering one stored row's verdict breaks chain verification with exit 1 naming the row; (3b) after a human-tty accept on that subject version, the effective verdict is auto (channel human-tty) although an escalate record exists, and after a human-tty reject it is refuse; (4) concurrent decide() from two processes on one subject both land, chain intact.
  script: test — bunx --bun vitest run packages/lore/tests/integration/autonomy-decision-log.test.ts && echo 'AC-AU-2 PASS: decision records are append-only, hash-chained, and the worst verdict per subject version wins'
  other_command=2
- [⚑] [script] AC-AU-3: THE HUMAN ANSWERS THROUGH A CHANNEL THE AGENT CANNOT USE. An escalation is a pending decision with an id and a nonce. lore decide <id> --accept|--reject generates a fresh nonce per invocation, shows it only on the controlling terminal, and resolves only when stdin and stdout are a TTY, the typed nonce matches, no ancestor process is the agent harness and the environment carries no agent run identity; the nonce never appears in any agent-readable output (the escalating command's output, lore pending, --json); the record carries channel=human-tty. Mandatory halves: (1) non-TTY stdin -> exit 4 naming the TTY requirement, decision still pending; (2) TTY with a wrong nonce -> exit 4, still pending; (3) the shipped PreToolUse hook denies a Bash tool call containing 'lore decide' (exit 2, rule name in output) — hook test with a stubbed tool-call payload; (4) HTTP exposes no decide route (registry assertion); (5) a decision record written with channel agent-asserted does not resolve the pending decision; (5b) a pseudo-terminal spawned from a process whose ancestry or environment carries an agent run identity -> exit 4 naming the agent-ancestry rule, still pending; (5c) grep of the escalating command's stdout/stderr and lore pending --json finds no nonce; (6) control: TTY (pseudo-terminal in test) + correct nonce -> exit 0, decision resolved, the escalated operation then proceeds when re-run. lore pending lists open decisions with score, factors and the recommended answer.
  script: test — bunx --bun vitest run packages/lore/tests/integration/autonomy-human-channel.test.ts && echo 'AC-AU-3 PASS: only lore decide on an interactive TTY with the nonce resolves an escalation; agent paths and agent-asserted consent never do'
  other_command=2
- [⚑] [script] AC-AU-4: STASHES BECOME RECOVERABLE, THEN LORE DROPS THEM. lore stash prune [--apply] lists every stash with its facts (created-on branch, whether that branch is merged, whether the creating run is ended or unknown, whether its tracked and untracked content is contained in main by blob equality) and, with --apply, first writes each stash commit to refs/lore/archive/stash/<sha> (verified readable), then drops it only when decide(class stash-drop) is auto; a stash is attributed to a run through the branch named in its message (On <branch>) and that branch's claim or run; a stash whose attributed run is live escalates (B 0.2); a stash attributed to an ended run scores B 1.0; an open task claim recording the stash's branch counts as an owner too, and a claim with no run proving it ended is treated as live (B 0.2, escalate) — this covers main, where live sessions hold claims; a branch with no run and no open claim behind it (main with no open claim, a deleted feature branch, no branch) has no provable owner and scores B 0.9 (the archive ref printed by prune keeps it recoverable for any session). Output counts dropped / kept-with-reason / escalated (AS-17). Mandatory halves, throwaway repo: (1) a stash whose content is in main -> archived + dropped, git stash list shorter by one, archive ref resolves to the same commit; (2) a stash created by a live run -> kept, escalated, reason named; (3) archive write failure (read-only refs dir) -> nothing dropped, exit non-zero; (4) restore: git stash store from the archive ref brings it back byte-identical; (5) the git-safety hook still refuses an agent-typed git stash drop (unchanged).
  script: test — bunx --bun vitest run packages/lore/tests/integration/autonomy-stash-prune.test.ts && echo 'AC-AU-4 PASS: lore stash prune archives every stash under refs/lore/archive/stash before dropping, and drops only on an auto verdict'
  other_command=4
- [⚑] [script] AC-AU-5: LORE REAPS WHAT ENDED RUNS LEFT BEHIND, NEVER A LIVE ONE'S. Run registration records the harness pid and process start time. lore run reap [--apply] considers processes whose cwd is inside an ended run's worktree; it reaps (SIGTERM; SIGKILL only if the process is still alive 5 s later; then a final rescan) only when decide(class process-reap) is auto; R for this class is loss-free-by-proof (0.9) only when the following hold, otherwise irreversible-local (0.2): the run is ended and its recorded pid is dead, AND either the process's ancestry reaches that run's pid, or its PPID is 1, its start time lies between the run's registration and end, no other run or session whose lifetime overlaps that start time has a worktree containing the process's cwd, and the process start time read at kill time equals the one read at decision time (no pid reuse). A process whose ancestry reaches any live run or session is never touched. Mandatory halves: (1) orphan (PPID 1) started inside an ended run's lifetime -> reaped; (2) same orphan started after the run ended -> kept, escalated; (3) a process descending from a live run -> kept, no signal sent; (4) two concurrent reaps -> one kill, the other sees ESRCH and reports already-gone, both exit 0; (5) after reaping, lore worktree check reports the worktree unoccupied. (6) A run with no end recorded whose recorded harness pid is dead (start time checked against reuse) is ended by lore run reap --apply through decide(class run-end-stale; R reversible — metadata only; B 1.0) with reason dead-pid; a legacy run with no recorded pid cannot be proven dead (B unmeasured -> 0) and escalates, all such runs in ONE pending decision; a run whose pid is alive is never ended.
  script: test — bunx --bun vitest run packages/lore/tests/integration/autonomy-run-reap.test.ts && echo 'AC-AU-5 PASS: lore run reap kills only processes provably owned by an ended run or orphaned within its lifetime'
  other_command=1
- [✘] [script] AC-AU-6: AGENTS STOP CREATING THE MESS. (1) Shipped assets (assets/agents, assets/skills, assets/hooks safe-hints, assets/context) contain no line matching /git stash (push|save|pop|apply)/ except lines listed with a reason in scripts/agent-hygiene-allowlist.json (e.g. the hook's own refusal patterns) (scan exits 0; a fixture asset with such a line exits 1 naming file:line); the red-first route named instead is commit-the-test-first or lore verify --falsify. (2) lore-implementer.md forbids pgrep -f polling and names waiting on a recorded pid; the scan flags 'until .*pgrep -f' / 'while .*pgrep -f' in assets (fixture exits 1). (3) run-process-group.ts reaps its detached child groups on SIGTERM and SIGINT as well as exit: a worker killed by SIGTERM leaves no orphan (test spawns a child group, signals the parent, asserts the group is gone). (4) [moved to AC-AU-11 half 3: verify --falsify temp-worktree cleanup]. (5) `bun run build && bunx --bun vitest run packages/lore/tests/unit/service/worktree-cleanup.test.ts` in a fresh worktree leaves git status --porcelain empty (tracked files are not dirtied by mirror export or manifest regeneration).
  script: test — bunx --bun vitest run scripts/tests/agent-hygiene.test.ts && echo 'AC-AU-6 PASS: no stash steer, no self-matching waits, helpers and verify reap what they spawn'
  other_command=3
- [⊖] [script] AC-AU-7: AN OVERRIDE THE ACTOR CAN SET IS DECIDED, NOT GRANTED. lore approve --override-judgment/--override-no-judgment, lore done --override-attestation/--override-attestation-cite, lore ac exempt, and lore verify --yes for a command with no attested evidence row on the same task (the existing SPEC-039 §M2 approval scope) each call decide() with their class; when the verdict is escalate the command exits 4, writes nothing else, creates a pending decision and prints its id and the lore decide line. Mandatory halves, throwaway corpus: (1) approve --override-judgment by an agent run on a spec whose judgment is reject -> exit 4, pending decision named, spec still draft; (2) after a human-tty accept of that decision, the same approve command -> exit 0; (3) done --override-attestation with no attested pass -> exit 4 pending; (4) control: in a throwaway corpus whose override-judgment class prior was raised above threshold through a human-tty governance decision (pseudo-terminal, no agent identity in the test process), approve --override-judgment -> exit 0 with an auto decision record.
  script: test — bunx --bun vitest run packages/lore/tests/integration/autonomy-overrides-escalate.test.ts && echo 'AC-AU-7 PASS: self-grantable overrides consult decide() and escalate when below threshold'
  other_command=1
- [⚑] [script] AC-AU-8: CALIBRATION TIGHTENS BY ITSELF AND LOOSENS ONLY BY THE HUMAN. Lore observes outcomes of auto decisions: reversed (object restored from its archive ref, reopen/restore/correction/invalidate of the subject, a reverted merge) or stood. C for a class is the Wilson lower bound (z = 1.96) over its last 50 observed outcomes plus 50 pseudo-outcomes at the class prior from this spec's initial class table (a new class starts near its prior; each real reversal moves it). Mandatory halves: (1) seed a class whose computed C (Wilson bound over the pseudo-outcomes at its prior) is just above its threshold; record reversed outcomes until the bound drops below -> the next decide() of that class escalates; (2) lore autonomy set <class> --threshold lower -> escalates as class governance-loosen (human-always) and changes nothing until human-tty accept; (3) raising a threshold (tightening) applies at once with an auto record; (3b) a class that auto-escalated returns to auto only through a human-tty governance-loosen decision, which empties the class's real-outcome window (pseudo-outcomes stay); (4) BR-1005's statistics surface now reads the outcome-based bound (lore calibration --stats shows outcome counts per class).
  script: test — bunx --bun vitest run packages/lore/tests/integration/autonomy-calibration.test.ts && echo 'AC-AU-8 PASS: a reversed auto decision lowers the calibration of its class and escalates the class; loosening is human-always'
  other_command=4
- [⚑] [script] AC-AU-9: THRESHOLDS ARE GOVERNED DATA AND FAIL SAFE. Class thresholds, priors and tiers live in one corpus record written only through lore (D8). If its content no longer matches its audit chain (edited outside lore), decide() treats every factor as unmeasured: every class escalates, and lore status names the integrity break. Mandatory halves: (1) edit the stored thresholds directly in the database -> next decide() of a normally-auto class escalates with reason threshold-integrity; (2) lore status exits with the integrity finding named; (3) human-tty re-confirmation (lore decide on the integrity decision) restores auto; (4) control: thresholds changed through lore keep the chain valid.
  script: test — bunx --bun vitest run packages/lore/tests/integration/autonomy-threshold-integrity.test.ts && echo 'AC-AU-9 PASS: a threshold record edited outside lore makes every class escalate until the human re-confirms'
  other_command=3
- [⊖] [script] AC-AU-10: THE HUMAN SAMPLING FLOOR IS PERMANENT (PRD I2). For each class, 1 in 10 auto decisions (deterministic: every decision whose sequence number within its class is divisible by 10, so it cannot be steered by re-rolling) is queued for non-blocking human audit; lore pending lists the audit queue separately from blocking escalations. A human-tty audit answer 'wrong' records a reversed outcome for that decision and feeds C (AC-AU-8); 'right' records stood. Mandatory halves: (1) 20 auto decisions of one class -> exactly 2 audit items; (2) the audited operation was not blocked (it already ran); (3) an audit 'wrong' lowers C by the same amount as an observed reversal; (4) an agent-asserted audit answer changes nothing.
  script: test — bunx --bun vitest run packages/lore/tests/integration/autonomy-sampling-floor.test.ts && echo 'AC-AU-10 PASS: 1 in 10 auto decisions per class is queued for human audit and a wrong audit counts as a reversal'
  other_command=2
- [⚑] [script] AC-AU-11: WORKTREE REMOVAL GOES THROUGH decide() AND NEVER LOSES IGNORED DATA. lore done, lore worktree sweep --apply and lore verify --falsify's temp-worktree cleanup all call decide(class worktree-remove) after the existing removal test; R is loss-free-by-proof only when git status --ignored inside the worktree lists no ignored path outside the class's declared regenerable set (node_modules/, dist/, .turbo/, coverage/, *.tsbuildinfo); otherwise R is irreversible-local and the removal escalates naming the paths. Mandatory halves, throwaway repo: (1) clean merged worktree with only node_modules/ ignored -> removed, auto record; (2) same with an ignored .env -> kept, escalated, .env named; (3) lore verify --falsify on a run that fails mid-way leaves no lore-attested-red-* worktree registered or on disk (its cleanup is an auto worktree-remove decision); (4) sweep --apply removes a registered orphan lore-attested-red-* worktree from an ended run.
  script: test — bunx --bun vitest run packages/lore/tests/integration/autonomy-worktree-remove.test.ts && echo 'AC-AU-11 PASS: worktree removal is decided, never loses ignored data outside the regenerable set'
  other_command=2
