<!-- lore:managed fragment=corpus-workflow-feed hash=76b8f203 -->
## FEED — pull governance before you produce

- The session-start injection carries only THIS seat's open claims (`seat_claims`) and its plan handoff. Pull corpus state on demand: `lore bootstrap`, `lore ready <plan>`, `lore pending`. NEVER resume from a handoff pointer on your own initiative; resume ONLY on the user's pasted ticket (`lore feed session-resume --handoff <slug>`) or an explicit instruction.
- When reporting state, label each item by source (pasted ticket / session-start injection / this-turn query); never merge sources into one list.
- `latest_handoffs` is a neutral directory, not a pointer to "the" thread.
- Resume interrupted work: `lore feed session-resume [--by <actor>] [--plan <plan>]`.
- The handoff-verification floor arms only for a ticket authored by a different actor or in an earlier session; verify a handoff you JUST AUTHORED. When authorship cannot be determined (no session marker), the floor arms (fail-safe): account for its items normally.
- Before producing any artifact: `lore feed <checkpoint>` (e.g. `spec-create`) pulls the governing rules slice plus upstream summaries; pull before a gate rejects you.
- Search first: `lore search "<topic>" --json` / `lore get <slug>` / `lore tree [<plan>]`; link an existing doc with `lore link` instead of duplicating it.
