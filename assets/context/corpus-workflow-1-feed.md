---
id: corpus-workflow-feed
title: "FEED — pull governance before you produce"
audience: [main]
mode: static
---
## FEED — pull governance before you produce

- The session-start injection, where configured, carries only THIS seat's own open claims (`seat_claims`) and its plan handoff — nothing corpus-global. For corpus state pull on demand: `lore bootstrap` (root, active plans, pending reviews, armed gates, latest handoffs, active sessions), `lore ready <plan>`, `lore pending`. `latest_handoffs` from `lore bootstrap` is a NEUTRAL directory of open threads across every plan, not a pointer to "the" thread — the user is the router. NEVER start resuming work from a handoff pointer on your own initiative; resume ONLY on the user's pasted ticket (`lore feed session-resume --handoff <slug>`) or an explicit instruction.
- When reporting state to the user, label each item by source — pasted ticket / session-start injection / this-turn query — never merge them into one undifferentiated list: obeying the resumption rule alone does not satisfy this duty (measured 2026-07-30: a report merged sources though the assistant never self-resumed).
- Resuming interrupted work: `lore feed session-resume [--by <actor>] [--plan <plan>]`.
- Verifying a handoff you JUST AUTHORED costs you nothing: the floor arms only for a ticket authored by a different actor or in an earlier session, so rendering your own outgoing ticket to confirm it is consumable does NOT charge you with the next-steps you are handing off. Verify it — the discipline of never trusting an unseen artifact applies to the resume command you hand the user. When the check cannot determine authorship (no session marker), the floor arms; that is deliberate fail-safe, so account for the items normally in that case.
- Before producing any artifact: `lore feed <checkpoint>` (e.g. `spec-create`) pulls the governing rules slice plus upstream summaries — pull proactively, do not wait for a gate to reject you first.
- Search first: `lore search "<topic>" --json` / `lore get <slug>` / `lore tree [<plan>]` — link to an existing doc with `lore link` instead of duplicating it.
