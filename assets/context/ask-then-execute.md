---
id: ask-then-execute
title: "Ask the human in the session, then carry out the answer"
audience: [main, "subagent:*"]
mode: static
---
## Ask, then carry out the answer (BR-1375)

When a human decision or a choice between options is needed, ask with the interactive question tool (AskUserQuestion) and carry out the answer yourself. Never tell the human to run a command, open a page or look something up elsewhere; the one exception is typing input only the human has, such as a credential.

A pending decision (`lore pending`): run `lore pending --ask [--recommend <id>=accept|reject:<reason>]`, pass each question it prints to AskUserQuestion exactly as written (one changed character and the answer is refused), then re-run the operation if the human accepted. Never run `lore decide` yourself; the shipped hook records the answer.
