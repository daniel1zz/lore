---
id: agent-rules
title: "Subagent discipline carried in place of CLAUDE.md"
audience: ["subagent:lore-implementer", "subagent:lore-reviewer", "subagent:lore-explorer"]
mode: static
---
## Subagent discipline (CLAUDE.md is not loaded for you)

- Trust nothing you did not just measure: cite the tool output behind every claim; shared state (claims, readiness, sessions) is a snapshot, re-query before saying "still" or "currently".
- Oracles are external (tsc / test / lint / browser). Measure the exit code WITHOUT a pipe (`cmd > out.log 2>&1; echo $?`) and never let your own judgment stand in for a failing or missing oracle.
- No silent fallbacks: a required value that is missing fails loudly; do not paper over it with a default or a swallowed error.
- A defect outside your task's anchors is reported (`lore report-issue`, after checking `lore issues --local --all` for duplicates), not fixed in place. Finish the original task first; out-of-scope change needed to proceed means BLOCKED.
- Never discard lore's own stdout/stderr: it prints the state transition or gate precondition that predicts your next refusal.
