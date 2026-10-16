---
id: corpus-workflow-feed
title: "FEED — pull governance before you produce"
audience: [main]
mode: static
---
## FEED — pull governance before you produce

- The session-start injection, where configured, carries only THIS seat's open claims (`seat_claims`) and its plan handoff; nothing corpus-global. Pull corpus state on demand: `lore bootstrap` (root, active plans, pending reviews, armed gates, latest handoffs, active sessions), `lore ready <plan>`, `lore pending`. NEVER resume from a handoff pointer on your own initiative; resume ONLY on the user's pasted ticket (`lore feed session-resume --handoff <slug>`) or an explicit instruction.
- When reporting state, label each item by source (pasted ticket / session-start injection / this-turn query); never merge sources into one list; the duty holds even if you never self-resumed.
- `latest_handoffs` from `lore bootstrap` is a neutral directory of open threads across every plan, not a pointer to "the" thread; the user is the router.
- Resume interrupted work: `lore feed session-resume [--by <actor>] [--plan <plan>]`.
- The handoff-verification floor arms only for a ticket authored by a different actor or in an earlier session; verify a handoff you JUST AUTHORED (rendering your own outgoing ticket does not charge you with its next-steps); never trust an unseen artifact, the resume command you hand the user included. When authorship cannot be determined (no session marker), the floor arms (fail-safe): account for its items normally.
- Before producing any artifact: `lore feed <checkpoint>` (e.g. `spec-create`) pulls the governing rules slice plus upstream summaries; pull before a gate rejects you.
- Search first: `lore search "<topic>" --json` / `lore get <slug>` / `lore tree [<plan>]`; link an existing doc with `lore link` instead of duplicating it.
