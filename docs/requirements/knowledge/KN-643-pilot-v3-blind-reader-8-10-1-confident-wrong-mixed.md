---
id: KN-643
type: knowledge
role: knowledge
title: "Pilot v3 blind reader: 8/10, 1 confident-wrong (mixed-runner guard absent from baseline)"
status: archived
priority: medium
created: 2026-10-08
updated: 2026-10-23
tags: []
parent: PLAN-174
---
# Pilot v3 W2b: blind reader on probe v3 — answers, independent grading, orchestrator check

Reader: independent agent given only the 10 questions and the 19 exported baseline documents (both populated branches). Grader: a second independent agent given the frozen key (`knowledge-pilot-v3-frozen-probe-set-10-questions-specification`), the reader's sheet and the baseline files.

## Score: 8.0 / 10, confident-wrong 1 (Q2) — bars >= 9/10 and 0 confident-wrong: BOTH NOT MET.

7 CORRECT (Q1, Q4, Q5, Q6, Q7, Q8, Q9), 2 PARTIAL (Q3, Q10 — one part each NOT ANSWERABLE), 1 WRONG (Q2).

Scoring rule added in the grader brief before grading (not in the plan's pre-registration): a part whose outcome matches the key but whose stated reason contradicts it counts as wrong. It decides Q2 part 1. Without it Q2 part 1 would be correct-outcome and Q2 would still be WRONG on part 2 (MED), so the score is unchanged at 8.0 and confident-wrong would be 0. Both readings are reported; the stricter one is the verdict because it was fixed before the grader saw the answers.

## Causes
- **Q2 (confident-wrong)**: the baseline has no rule for the evidence command's mixed-runner guard — the refusal of a single-runner command naming an ordinary test file under the Bun runner. The reader attributed the refusal to BR-150 (captured-pass requirement) at HIGH and stated the runner was irrelevant. That guard is itself a filed defect (issue #46: this repository's two-runner convention imposed on consumer projects). So the miss is a product defect absent from a baseline that describes intended business behaviour — a case the baseline method cannot catch by construction unless defects are also recorded as rules.
- Q3 part 3 (byte-exact command matching for approval) and Q10 part 3 (the printed success line omits the starting status): baseline silent; reader correctly said NOT ANSWERABLE.
- **Grader's suspected baseline defect BR-150 — refuted by the orchestrator against code**: `task-workflow-service.ts:1372-1379` keeps self-reported passes only for the manual oracle; every other oracle kind must be captured. BR-150 matches code. BR-204/BR-207's "a self-reported pass counts" concern historical rows the archival floor still accepts; they do not contradict BR-150 (they could be worded to say so).

## Comparison
| | v1 | v2 | v3 |
|---|---|---|---|
| Score | 8/10 | 4.5/10 (5 questions out of branch) | 8/10 |
| Confident-wrong | 2 | 0 | 1 |
| Baseline content found false | 0 (v1 claim refuted) | 0 | 0 |

## Grading (verbatim)
# Grade — blind baseline reader v3

Inputs: probe-v3.md (key), reader-out/answers.md, reader-in/baseline-*.md. No lore/repo access.
Scoring rule: a part labelled NOT ANSWERABLE neither scores nor counts as wrong. Any lean given after that label is ignored for scoring but noted. A part with the right outcome but a reason that contradicts the key counts as wrong.

## Score: 8.0 / 10 — confident-wrong questions: 1 (Q2)

| Q | verdict | points | confident-wrong? | cause | note |
|---|---|---|---|---|---|
| 1 | CORRECT | 1 | no | — | (a) accepted, (b) refused; holder-only release with no stale exception. Matches key. |
| 2 | WRONG | 0 | **yes** (part 1, HIGH) | P1: (b), and BR-150 is a suspected (a); P2: (b); P3: NOT ANSWERABLE | P1: the outcome (refused) matches, but the stated reason contradicts the key. The reader says the refusal is BR-150's capture requirement and that "the Bun runner and the file naming play no part". The key says the refusal is the Mixed-runner guard (exit 4), triggered exactly by a plain `*.test.ts` file under `bun test`. P2: the reader's mechanism (MED) says capture records the row whenever the run exits 0. The key says the raw command exits 0, yet capture is still refused with exit 4 Mixed-runner. The reader marked only the Bun-specific behaviour as not answerable. That premise is resolved by the key, and the mechanism the reader stated is contradicted. P3: NOT ANSWERABLE. The key says it is accepted and the runner records an attested pass. The reader's lean (inconclusive if Bun skips the file) rests on a premise the key shows is false, so it is ignored. |
| 3 | PARTIAL | 0.5 | no | P3: (b) | P1 (exit 7, approval per target task, A's approval does not carry over) and P2 (an exact-text expected-fail row counts as approval) are right. P3 is NOT ANSWERABLE. The key says matching is byte-exact, so a one-space difference leads to exit 7. The reader's LOW lean (exact matching, so code 7) matches the key but does not score. |
| 4 | CORRECT | 1 | no | — | No in-place mode change. The refusal points to withdraw then re-declare. A field from another mode is refused, naming the actual mode. The reader does not state the exit-code split (2 for `--mode`, 4 for a field from another mode) or "spec unchanged". Nothing contradicts the key. |
| 5 | CORRECT | 1 | no | — | (a) refused, (b) refused as not unique, (c) accepted. |
| 6 | CORRECT | 1 | no | — | Exit code 0 is accepted (MED). The run records a runner-attested expected-fail row with observed exit code 0, and the run exits 0 (LOW lean, stated as an answer and not labelled NOT ANSWERABLE). The reader correctly saw the tension with BR-61's "can never confirm". |
| 7 | CORRECT | 1 | no | — | Refused. Archived tasks still block removal (BR-101). |
| 8 | CORRECT | 1 | no | — | All tasks show the new name, archived ones included. No task version row. The plan gets one version row. |
| 9 | CORRECT | 1 | no | — | Holder evidence renews the lease, so the takeover is refused. Non-holder evidence does not renew it, so the takeover is accepted. Evidence never needs or creates a claim. The side note on uncommitted pass rows is beyond the key and not contradicted. |
| 10 | PARTIAL | 0.5 | no | P3: (b) | Yes, draft goes to approved, active, archived as three recorded steps. Correct. The reported path is NOT ANSWERABLE. The key says it prints "approved -> active -> archived" and leaves out draft. The reader's LOW lean ("draft → approved → active → archived") contradicts the key but does not score, because the part is labelled NOT ANSWERABLE. The baseline has no rule on the success output (BR-197 states the walk only). |

Totals: CORRECT 7 (Q1, Q4–Q9), PARTIAL 2 (Q3, Q10), WRONG 1 (Q2), NOT-ANSWERED 0. Points 7 + 1.0 + 0 = **8.0 / 10**. Confident-wrong: **1** (Q2 part 1, HIGH).

## Causes for wrong or partial parts

- **Q2 P1 (wrong, HIGH)**: (b) The baseline does not mention the mixed-runner guard at all. A grep for `bun`, `mixed`, `two runners` and `.bun.test` across all 19 baseline files finds nothing outside questions.md. The reader therefore filled the reason from BR-150. BR-150 is also a **suspected (a)**. It says "A pass is accepted only when the product itself ran the check and captured its output. Typed-in output, however convincing, does not count." The baseline itself contradicts this. The archive-a-task examples record self-reported passes (BR-204: "Given a task whose second row is a self-reported pass with output"; BR-207: "Any passing row counts, including one the caller only reported"; archive leaf Q5: "a self-reported pass is accepted (BR-207)"). The key does not show which check fires first for this command, so BR-150 cannot be confirmed false from the key alone. Re-check it against code.
- **Q2 P2 (wrong, MED)**: (b) The baseline has no rule on the mixed-runner guard. The generic BR-150 example ("The same pass with capture; then recorded") and BR-152 led the reader to "exit 0 → recorded". Key fact: capture of `bun test tests/a.test.ts` is refused with exit 4 Mixed-runner, although the raw run exits 0.
- **Q2 P3 (not answerable)**: (b) The baseline does not say what verification does with a Bun command on a plain `.test.ts` file. Key: accepted at declaration, attested pass.
- **Q3 P3 (not answerable)**: (b) BR-171 ("A check command that has never appeared in the target task's recorded evidence needs approval") does not say whether command text is compared byte-exact. Key: byte-exact (`e.command === command`), so one extra space leads to exit 7.
- **Q10 P3 (not answerable)**: (b) BR-197 covers the walk and the per-step records, but no rule covers the printed success line. Key: it prints "approved -> active -> archived" without the starting status.

## Confirmed cause-(a) baseline defects

None confirmed by the key. One suspected:

- **BR-150** (record-evidence, established): "A pass is accepted only when the product itself ran the check and captured its output. Typed-in output, however convincing, does not count. The one exception is a manual check…". This contradicts the baseline's own BR-204, BR-207 and archive-leaf Q5, which describe self-reported pass rows being recorded and counted. The relevant key fact for Q2: a self-reported pass with `--output-tail-file` is refused by the Mixed-runner guard (exit 4), not by a capture requirement. Key Q2 does not settle whether a self-reported pass on a non-mixed command is accepted, so this stays unconfirmed.

## Baseline coverage gaps (cause b) worth adding

1. The mixed-runner guard on self-reported and captured test passes. It is triggered by `bun test` with any file not ending in `.bun.test.ts`, regardless of how the project's runners are set up. Add it to the record-evidence leaf, including the fact that verification does not apply it.
2. Approval matching in BR-171 is byte-exact on command text, and any row type counts.
3. The printed output of a successful `done` walk lists destination statuses only and leaves out the starting status.

## Reader answer sheet (verbatim)
# Answer sheet — blind baseline reader (v3)

Sources: only `reader-in/questions.md` and the 19 `baseline-*.md` files. No code, CLI or repository consulted.
Confidence policy: HIGH = an established/observed rule states it directly (ideally with a matching example); MED = stated by an unconfirmed rule, or needs one small inference; LOW = the baseline is silent or contradicts itself and only a lean is given.

### Q1
Answer:
- (a) Taking the stale claim for themselves: **ACCEPTED.** A claim older than the claim lifetime (120 min default) is stale; anyone may take it over without stealing, and the takeover starts a fresh lease that inherits nothing (no branch/machine/working copy carried over). — HIGH
- (b) Just clearing (releasing) the teammate's claim: **REFUSED.** Only the holder may release a claim unless the release is forced. The rule has no exception for stale claims. A forced release would work and would record the previous holder and any reason in the task's history, but the question rules out overrides. — HIGH (the rule is unconditional; the baseline names no stale exception)
- So only (a) is accepted.

Rules: BR-126 (stale takeover, inherits nothing), BR-128 (stale takeover inherits nothing), BR-142 (release holder-only unless forced); glossary "Stale claim", "Release" ("Holder only, unless forced"); Current values claim lifetime 120 min.
Rests on unconfirmed/undecided: no

### Q2
Answer:
- Part 1, self-reported pass: **REFUSED.** A pass is accepted only when the product ran the check and captured its output. Typed-in output is refused, pointing to capture. Only a manual check is exempt, and a test check is not manual. The Bun runner and the file naming play no part in this refusal. — HIGH
- Part 2, capture (the tool runs the command): the baseline says the product runs the command, keeps the last 4000 characters, and attaches an attestation with the measured exit code. A declared pass is recorded if the run exits 0 and refused, naming the real code, if it exits non-zero. A command not filtered by test name is not subject to the "at least one case ran" rule (BR-153), and "no tests found" is refused only for fail/expected-fail rows (BR-155). **Whether the Bun runner, given an ordinarily named file, actually runs it and exits 0 is NOT ANSWERABLE**: no baseline file mentions the Bun runner, its file suffix, or what it does with such a file. Conditional answer: exit 0 → row accepted as runner-captured with an attestation; non-zero → refused. — conditional mechanism MED (BR-152 is unconfirmed); Bun-specific outcome NOT ANSWERABLE
- Part 3, same command declared on a criterion and run by the verification runner: a test check is recorded as **inconclusive**, not pass or fail, when (i) it ends 0 but ran fewer of its named test files than declared, or (ii) it fails only because the runner found no matching test. A genuine failure stays fail, and a full run ending 0 is a pass. Usual preconditions also apply: the criterion must be in the target task's declared scope (BR-163), and a command new to the task needs approval (BR-171). **Which of these the Bun runner actually triggers on an ordinarily named file is NOT ANSWERABLE** from the baseline. If it skips the file, the result would be inconclusive either way (exit 0 with fewer files, or exit 1 with no tests found), and the run ends with outcome code 3 (BR-178). — mechanism HIGH (BR-176 established); Bun-specific outcome NOT ANSWERABLE; outcome code 3 LOW-MED (BR-178 unconfirmed)
- Implied contrast, if the Bun runner skips the file: capture could record an attested pass that the verification runner would call inconclusive. The baseline does not state this directly.

Rules: BR-150, BR-151, BR-152, BR-153, BR-155 (record-evidence); BR-163, BR-171, BR-176, BR-178 (run-verification); record-evidence Q3 (capture proves only the given command exited 0).
Rests on unconfirmed/undecided: yes (BR-152 unconfirmed for the capture branch; BR-178 unconfirmed for outcome code 3). The Bun-specific parts are not covered by any rule.

### Q3
Answer:
- Part 1, B has no prior row with that command: approval is judged against **the target task's own** recorded evidence. Task A's earlier run and approval do not carry over. The command has never appeared in B's evidence, so it needs approval. With no prompt (a non-interactive caller) and no advance approval, the run **stops at that criterion with "needs approval", outcome code 7**, naming the criterion, the command and any criteria already recorded. Nothing is run for it. (This assumes the project has not switched approval off; the default is on.) — HIGH
- Part 2, B already holds a self-reported expected-fail row with the exact same command text: the command "has already appeared" in B's evidence, so it **runs without asking for approval**, and its result is **not** marked first seen. The rule says "recorded evidence" and does not limit this to runner-attested or passing rows, so a self-reported expected-fail row should count. — MED (the baseline does not qualify row type; I take its wording literally)
- Part 3, the row's command differs only by one extra space: **NOT ANSWERABLE.** The baseline does not say whether command matching is exact text or whitespace-normalised. Lean: "never appeared" reads as exact matching, which would mean approval is needed again → stop with code 7. — LOW

Rules: BR-171 (approval for commands new to the target task, code 7), BR-172 (first-seen mark), BR-162 (target task); Current values "Approval of new commands: on".
Rests on unconfirmed/undecided: no for parts 1–2. Part 3 is unspecified by any rule.

### Q4
Answer:
- Can the verification mode be switched by revising in place? **No.** A criterion's id and verification mode cannot be revised. — MED (BR-31 is unconfirmed; the revise leaf's Constraint "its id and mode never change" and its boundary note say the same thing)
- What is reported: asking to change the mode is **refused, pointing at withdraw and declare**. If the caller supplies a part that belongs to another mode (e.g. a person's note or a rubric on a check-decided criterion), the refusal **names that part and the criterion's actual mode**. — MED (BR-31 unconfirmed; BR-32 observed)
- How it is meant to be done: **withdraw the criterion and declare a new one** with the new mode. This costs the criterion's existing evidence links. Withdrawal is refused while a task in a plan under the spec has evidence referring to it, unless the author insists. Insisting removes the criterion, leaves the evidence untouched, and the references become dangling. The criterion's citations go with it. Side effect: withdrawing and declaring both leave an approved spec approved, whereas a revision would return it to draft. — HIGH for the route (boundary note + BR-46/47 observed); the status side effect is MED (BR-48 is unconfirmed, BR-25 observed)

Rules: BR-31, BR-32, BR-46, BR-47, BR-48, BR-25, BR-92; revise-leaf boundary note ("Changing the way a criterion is decided means withdrawing it and declaring a new one; that costs the criterion's existing evidence links").
Rests on unconfirmed/undecided: yes (BR-31 and BR-48 unconfirmed)

### Q5
Answer:
- (a) Lowercase id: **REFUSED** with the expected shape. The id must be AC- followed by groups of capital letters and digits separated by hyphens; the example is 'ac-1'. — HIGH
- (b) Id already used by another criterion on the same spec: **REFUSED** as not unique. — HIGH
- (c) Id already used on a different spec: **ACCEPTED.** Ids are unique only within their own spec, so two specs may each declare the same id. — MED (BR-23 is unconfirmed; open question Q5 asks whether ids should become project-wide)

Rules: BR-16 (established), BR-23 (unconfirmed); declare-leaf Q5; cite leaf Q4 (a bare id found in two specs is counted as ambiguous).
Rests on unconfirmed/undecided: yes, part (c) only (BR-23)

### Q6
Answer:
- Is a declared expected outcome code of 0 accepted? **Yes, accepted** (also any number above 255). The only constraint is one exact whole number. — MED (BR-61 unconfirmed; declare-a-falsifier Q4 flags it)
- If the attested-red run is performed and the mutated check exits 0: **the baseline contradicts itself here, so I cannot answer with confidence.**
  - Literal reading of the execution rules: the control (the unchanged check) must first end 0 (BR-189). The changed check must then end with exactly the declared code and not by timing out (BR-191). 0 = 0 is an exact match, so BR-192 applies: **one expected-fail row with a runner record (observed code 0) is recorded against the target task, and the run ends with outcome code 0.** That "attested red" would then count as a red row (BR-205/BR-206).
  - But BR-61 says such a falsifier "can never confirm", which suggests the run would not produce a confirmation.
  - Lean: the literal BR-191/BR-192 outcome (an attested red recorded with code 0). — LOW

Rules: BR-53, BR-61 (specification); BR-189, BR-191, BR-192 (prove-a-red); declare-a-falsifier Q4.
Rests on unconfirmed/undecided: yes (BR-61 unconfirmed, and it conflicts with the literal reading of BR-191/192)

### Q7
Answer:
- **No.** A phase cannot be removed while any task of the plan still names it, **whatever that task's status, including archived tasks**. The refusal lists those tasks. Every task being archived does not help, unless the tasks stop naming the phase. — MED (BR-101 is unconfirmed, though its example is exactly this case: one archived task blocks removal; its open question asks whether this is intended)

Rules: BR-101; plan-the-work Constraint ("a phase still named by a task cannot be removed").
Rests on unconfirmed/undecided: yes (BR-101 unconfirmed)

### Q8
Answer:
- Which name do the tasks show? **The new name.** Renaming a phase also renames it on every task of the plan that names it. — MED (BR-102 unconfirmed)
- Including archived tasks? **Most likely yes.** BR-102 says "every task of the plan that names it" with no status exclusion, and BR-101 counts archived tasks as tasks that name a phase. The baseline never says "archived" explicitly for renames. — LOW-MED
- Does each affected task's own version history record the change? **No.** The task changes leave no entry in the tasks' own history and are not checked against concurrent edits. The baseline flags this as a suspected defect. — MED (BR-102 unconfirmed; plan-the-work Q3 is labelled "defect")
- By contrast, the **plan** gets exactly one version entry for the rename, and its status does not change. — HIGH (BR-100 established)

Rules: BR-102, BR-100, BR-101; plan-the-work Q3.
Rests on unconfirmed/undecided: yes (BR-102 unconfirmed)

### Q9
Answer:
- Holder records evidence after the lease has expired; can another actor then take the claim without an override? **No.** When the claim holder records evidence, the claim is renewed to that moment even if it had gone stale, in the same change as the evidence. The claim is fresh again, so another actor's plain claim is refused, naming the holder and the claim's age. They would need to steal it, which is an override. (This holds until the renewed claim passes its lifetime again.) — HIGH
- If the evidence row had been recorded by someone else: evidence recorded by anyone other than the holder **leaves the claim untouched and never acquires one**. The claim stays stale, so another actor **can** take it over without stealing. — HIGH
- Does recording evidence require holding the claim? **No.** Anyone can record evidence on any task, including archived tasks and tasks claimed by someone else (flagged as a suspected gap). One related point: a **pass** row is refused while the claim's recorded working copy has uncommitted changes, and with no claim at all a pass is accepted. — MED-HIGH (BR-160 is unconfirmed, but BR-141, which is established, has the example "when bob records evidence … bob holds nothing", which assumes a non-holder can record)

Rules: BR-141 (renewal by holder only), BR-125 (fresh claim blocks others), BR-126 (stale takeover), BR-127 (steal), BR-160, BR-159.
Rests on unconfirmed/undecided: part 3 partly (BR-160 unconfirmed; BR-159 unconfirmed for the side note). Parts 1–2: no.

### Q10
Answer:
- Can "done" archive a never-reviewed draft task directly? **Yes.** Archiving moves the task through every intermediate status to archived in one command. The archival requirements are evidence-based (attested pass or waiver, red-first, no-new-test, whole-file runs, no fresh foreign claim). No review or approval judgment is listed among them. — HIGH
- Which lifecycle steps are written: **draft → approved → active → archived** (three steps), **each its own recorded change with its own history/audit entry**. If the attested-pass requirement was waived, the reason and a waiver mark are stored on every step; a no-new-test reason is likewise recorded on every step. — HIGH (BR-197 established, whose example is exactly "a released draft task with an attested pass"; BR-203 established; BR-206 unconfirmed)
- What path the tool reports: **NOT ANSWERABLE** as to the exact printed output. The baseline states the walk and the per-step records, not the text the command prints for a successful walk. It specifies output only for the already-archived case (BR-198: reports nothing done, names the current status) and for the last-open-task notice (BR-211). Lean: it reports the walk draft → approved → active → archived. — LOW

Rules: BR-197, BR-199, BR-203, BR-206, BR-208, BR-209, BR-198, BR-211; contrast BR-212 (setting the status directly to archived skips all requirements, allowed straight from draft for tasks).
Rests on unconfirmed/undecided: no for the main answer (BR-197/203 established). Only the no-new-test side note uses unconfirmed BR-206.
