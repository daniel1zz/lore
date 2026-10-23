---
id: SPEC-234
type: spec
role: spec
title: "Human decisions are asked in the session and recorded by the harness"
status: approved
priority: high
created: 2026-10-23
updated: 2026-10-23
tags: []
---
# Human decisions are asked in the session and recorded by the harness

## Overview/Goal

A human decision is asked inside the agent session with Claude Code's interactive question tool. The harness, not the agent, records the answer into lore. The agent then carries out what was decided. The human never has to open another terminal, read a decision id or type a nonce.

This applies `adr-ai-decision-standard-four-checks-references-from-excellent`, where humans decide only three kinds of thing, and the owner's instruction of 2026-10-23: "let me choose in an interactive component, then you execute; the same in other scenarios; never send me elsewhere to look things up or operate".

Reference: GitHub Actions deployment approval. The reviewer clicks Approve in the platform UI, and the platform records who approved. The workflow being approved cannot write that record itself. The difference here is that the platform is the Claude Code harness and its PostToolUse hook, and the record is lore's decision log.

## Scope

### The channel

- When an operation needs a human (`lore pending` lists it), the agent asks with the AskUserQuestion tool, one question per pending decision and up to 4 per call.
- **Lore writes the question, not the agent.** `lore pending --ask [--recommend <id>=accept|reject:<reason>]... --json` returns, for each decision, the complete question object to pass to AskUserQuestion verbatim:
  - the question text: decision id, what the operation does, its facts and its consequence, written by lore from the decision record;
  - a header;
  - the options Accept and Reject, each with a description of what happens on that choice.

  An agent recommendation appears only through `--recommend`, embedded by lore in a line labelled "Agent recommendation:". The nonce is bound to a hash of the whole question object.
- A PostToolUse hook on AskUserQuestion is shipped in `assets/hooks`. It reads the user's answers from the tool response, which is harness data and not agent text. For each question carrying a decision id, it records the answer through one lore call: `lore decide --from-harness`. That call takes the hook's stdin payload and is attested by the hook's run, not the agent's.
- `lore decide --from-harness` accepts an answer only when all of these hold:
  1. **Payload shape.** stdin is a PostToolUse payload for AskUserQuestion, with `tool_use_id` and `session_id`, and the question text for that answer carries the decision id and its nonce.
  2. **Nonce and text validity.** The nonce is the one `lore pending --ask` issued for this decision, and it has not been used. The answered question's full text and options hash to the value bound to that nonce, so a question the agent reworded is refused. A nonce is single-use and bound to one decision id and to that decision's subject version. A superseded decision voids it.
- **Agent shell calls.** The git-safety gate refuses an agent Bash call that contains `lore decide`, with or without `--from-harness`, with exit 2. A hook's command is run by the harness, not through the agent's Bash tool, so the gate does not apply to it. The registered hook is therefore the only caller of `--from-harness`.
- **Residual, stated honestly.** An agent that can run arbitrary code as the same OS user could still get around the gate, for example from a script that it writes and runs. Its integrity bound against a forged answer equals the terminal `lore decide` path, which relies on the same gate. What the human reads is lore's own text in both paths, because the text hash refuses a reworded question. So BR-1374 is enforced_by `both`, not `guaranteed`. No transcript cross-check is added, because it would not raise this bound: the same agent could also write the transcript.
- **Answers that are not accept or reject.**
  - A free-text "Other" answer, a dismissed question, or a question without a valid nonce records nothing. The decision stays pending, and the hook prints which ids it left pending.
  - Questions in one call are handled independently, and the hook prints one line per question.
  - Exit code: 4 when any question carried a nonce that fails validation (missing from the record, stale, used, another decision's, or text-hash mismatch), because that signals tampering; the valid questions in the same call are still recorded. Otherwise 0, including when some questions record nothing (Other, dismissed, or no lore nonce at all).
  - If the hook fails, the decision stays pending. The agent sees that in `lore pending` and asks again.
- After the hook records the answer, the agent re-runs the operation, as `lore pending` instructs.
- The terminal `lore decide` path stays, for a human without an agent session.

### The rule shipped to every agent

The always-loaded lore context gains one rule. When a human decision or a choice between options is needed, ask with the interactive question tool and then carry out the answer yourself. Never tell the human to run a command, open a page or look something up elsewhere. The only exception is input the agent cannot obtain at all, such as typing a credential.

### Out of scope

- Changing which classes need a human. That stays the three classes in the ADR.

## Acceptance Criteria

AC-ASK-1..3 (`lore ac add`):

- **AC-ASK-1, the harness records the answer.** `lore pending --ask --json` returns ready-to-ask questions. Feeding the shipped hook an Accept payload records the answer, and the re-run operation applies. A Reject keeps it refused.
- **AC-ASK-2, no forgery through lore.** `--from-harness` refuses an answer, naming BR-1374, when the payload has the wrong shape, or the nonce is missing, stale, already used, belongs to another decision, or the question text or options differ from what lore issued. Any such question makes the call exit 4, and the valid questions in the same call are still recorded. Other, dismissed and nonce-less answers record nothing and are printed as still pending. The gate refuses an agent Bash call containing `lore decide` with exit 2.
- **AC-ASK-3, the rule ships.** The rendered always-loaded fragments carry BR-1375. No shipped asset tells the human to run `lore decide` in a terminal.


## Acceptance Criteria (structured)

- [⚑] [script] AC-ASK-1: HARNESS RECORDS THE ANSWER. On a throwaway corpus with a pending governance-loosen decision: lore pending --ask --json returns AskUserQuestion-ready questions (decision id + issued nonce in the question text, options Accept/Reject, the agent's recommendation in the description). Feeding the shipped PostToolUse hook a payload whose tool_response answers Accept records the decision as accepted via lore decide --from-harness (exit 0), and re-running the original lore autonomy set applies the change. Reject records rejected and the re-run stays refused.
  script: test — bun run test:file packages/lore/tests/integration/decide-from-harness.test.ts -t 'harness records the answer' && echo 'AC-ASK-1 PASS: in-session answer recorded by the hook applies the decision'
  other_command=3
- [⚑] [script] AC-ASK-2: NO FORGERY THROUGH LORE. lore decide --from-harness refuses an answer naming BR-1374 and records nothing for it when stdin is not a PostToolUse AskUserQuestion payload, or the answered question's nonce is missing, stale, already used, another decision's, or the question text/options differ from what lore pending --ask issued (one changed character in the text is refused); any such question makes the call exit exactly 4 while valid questions in the same call are recorded. A free-text Other answer, a dismissed question or a question with no lore nonce records nothing, prints the id as still pending, and leaves exit 0. The git-safety gate refuses (exit 2) an agent Bash call containing lore decide, with or without --from-harness.
  script: test — bun run test:file packages/lore/tests/integration/decide-from-harness.test.ts -t 'agent cannot forge' && echo 'AC-ASK-2 PASS: forged, stale or agent-typed answers are refused'
  other_command=1
- [⚑] [script] AC-ASK-3: THE RULE SHIPS. The always-loaded lore context fragments rendered by lore context refresh contain the BR-1375 rule text (ask with the interactive question tool, then carry out the answer; never send the human elsewhere), and no shipped asset under assets/ (context, skills, agents, hooks messages) instructs the human to run lore decide in a terminal; lore pending's human-facing text points at the in-session path.
  script: test — bun run test:file packages/lore/tests/integration/decide-from-harness.test.ts -t 'rule ships' && echo 'AC-ASK-3 PASS: the ask-then-execute rule ships and no asset sends the human elsewhere'
  other_command=1
