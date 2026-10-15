---
id: BASE-044
type: baseline
role: intent
title: "Serve the corpus over HTTP"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-068
links:
  - {id: SPEC-010, type: supersedes}
  - {id: SPEC-011, type: supersedes}
  - {id: SPEC-016, type: supersedes}
  - {id: SPEC-022, type: supersedes}
  - {id: SPEC-027, type: supersedes}
  - {id: SPEC-037, type: supersedes}
---
## Serve the corpus over HTTP

> An operator starts a web service so agents with a key, and people with a browser session, can read and write the corpus from other processes.

Scope: starting the server and deciding, for each request, who is calling and whether they may. What each route then does belongs to the leaf of its verb.

### Behaviour

**Command.** An operator starts the server, optionally on a given port and host.

**Constraint.** A valid port (BR-942). For every request under the API: a valid browser session or a valid, unrevoked agent key, except the health checks and the dashboard's local sign-in exchange (BR-943, BR-944, BR-945). Dashboard write routes accept browser sessions only (BR-946).

**Event.** None of its own; each request's verb records its own events. Who a write is attributed to is fixed here (BR-947, BR-948); how a refusal is answered is BR-949.

### Terms used here

- **HTTP server**, **agent key**, **browser session**, **revoked key**: defined in the branch glossary.

### Boundary notes

- The server answers from the local corpus even when sync is on (BR-925).
- The dashboard's local sign-in, packaged pages and multi-project mode are distribution's ("Launch the dashboard"); the plain server starts without them. The rules for writing on a registered project and for one sign-in covering every registered project (BR-996, BR-997) are kept there.
- Writes are kept in this checkout's corpus whatever directory the server was started from; that guard is corpus's ("Keep writes in this checkout's corpus").

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| Port | 3456 | operator (option) | 2026-10-09 |
| Host | localhost | operator (option) | 2026-10-09 |
| Browser session lifetime | 30 days, extended on each use | not adjustable | 2026-10-09 |
| Stored per-key write limit | 60 per minute (never applied) | not adjustable | 2026-10-09 |

### Depends on

- Issue an agent key, Revoke an agent key: the set of valid keys.
- corpus, review, specification, execution: the verbs behind each route.
- distribution, "Launch the dashboard": opening browser sessions.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Approvals and rejections over HTTP record no reviewer: the version history says "system" even when an agent key made them. Should they be attributed to the key? | unconfirmed | product |
| Q2 | Each key stores a write limit of 60 per minute that nothing applies. Apply it, or drop it? | undecided | product |
| Q3 | A port written with trailing letters ("3456abc") is accepted as 3456. Refuse it? | unconfirmed | engineering |
| Q4 | A request carrying an unknown or expired browser session is refused even when it also carries a valid agent key. Should it fall through to the key instead? | unconfirmed | product |


#### Rules held below established

No live check-decided criterion would fail if a rule below were false. Following the branch method (BR-623), a rule whose behaviour is measured in code, with the file and line recorded in its row, is held at observed; a rule with a written question about intent is held at unconfirmed or undecided. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). Every rule of this leaf held below established is listed here or in the note under the table.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-942 | unconfirmed | established | Q3. Held whole at unconfirmed on purpose: the default port and host and the 1-65535 refusal are measured at adapters/cli/commands/serve.ts:36-39 and have no question, but the same check is what accepts trailing letters, so the rule moves as one once Q3 is decided. |
| BR-944 | unconfirmed | established | Q4 |
| BR-945 | observed | established | No question about intent. Measured at adapters/http/auth.ts:310-330 (form, stored key, revocation) and adapters/http/index.ts:211-214, 387-390 (one 401 message for every reason); waiting for a check-decided criterion. |
| BR-947 | observed | established | No question about intent. Measured at adapters/http/auth.ts:464-470 (resolveDocWriteOpts: key name for an agent key, the server's identity for a browser session); waiting for a check-decided criterion. |
| BR-948 | unconfirmed | established | Q1 |
| BR-949 | observed | established | No question about intent. Measured at adapters/http/middleware.ts:51-110 (loreErrorToStatus); waiting for a check-decided criterion. |
| BR-950 | undecided | established or rewritten once Q2 is decided | Q2 |


**BR-943 held at unconfirmed after the post-arming fidelity sample (AC-BLS2-14, 2026-10-09):** its only citation was judged unfaithful. Open question: which criterion, with a test that fails if the rule is false, should establish it?
