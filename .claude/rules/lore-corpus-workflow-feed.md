<!-- lore:managed fragment=corpus-workflow-feed hash=3d0875d3 -->
## FEED — pull governance before you produce

- The session-start injection carries only THIS seat's open claims (`seat_claims`) and its plan handoff. Pull corpus state on demand: `lore bootstrap`, `lore ready <plan>`, `lore pending`. `latest_handoffs` is a neutral directory, not a pointer. NEVER resume from a handoff pointer on your own initiative; resume ONLY on the user's pasted ticket (`lore feed session-resume --handoff <slug>`) or an explicit instruction.
- When reporting state, label each item by source (pasted ticket / session-start injection / this-turn query); never merge sources into one list.
- Resume interrupted work: `lore feed session-resume [--by <actor>] [--plan <plan>]`.
- Verifying a handoff you JUST AUTHORED is free; verify it. When authorship cannot be determined (no session marker), account for its items normally.
- Before producing any artifact: `lore feed <checkpoint>` (e.g. `spec-create`) pulls the governing rules slice plus upstream summaries; pull before a gate rejects you.
- Search first: `lore search "<topic>" --json` / `lore get <slug>` / `lore tree [<plan>]`; link an existing doc with `lore link` instead of duplicating it.
