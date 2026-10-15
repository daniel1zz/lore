---
id: BASE-042
type: baseline
role: intent
title: "Launch the dashboard"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-046
links:
  - {id: SPEC-015, type: supersedes}
  - {id: SPEC-016, type: supersedes}
  - {id: SPEC-022, type: supersedes}
  - {id: SPEC-027, type: supersedes}
  - {id: SPEC-037, type: supersedes}
---
## Launch the dashboard

> A person starts the local web interface over the nearest project corpus, and over every project registered in the machine settings, and gets a signed-in browser.

Scope: launching, signing in and stopping, and multi-project serving: which projects one launch serves, which project each request reaches, and how one project's failure is kept from the others. What the interface's routes do to a document, a setting or a report once a request has reached its project belongs to the branch of each object they touch; this leaf keeps only what every dashboard write shares on this surface: which project it reaches (BR-996) and how the edit page carries and checks the version it was based on (BR-1015).

### Behaviour

**Command.** Launch the dashboard, packaged (default) or in development mode. Packaged, it is one process serving the built interface and the API on the API port; it prints the sign-in link as a machine-readable line before opening the browser, unless told not to open one (BR-858). Development mode adds a separate interface server on the chosen interface port (BR-865).

**Constraint.** Needs a corpus at or above the current directory (BR-861). Packaged mode needs the built interface (BR-860). The port must be valid (BR-866) and free (BR-865 in development mode, BR-1006 in packaged mode). Sign-in links are single-use and short-lived (BR-862); when the machine's sign-in store is unavailable the pages are still served signed out and a sign-in link answers a named unavailable error, status 503 (BR-863). The server listens on the local machine only (BR-859) and accepts browser requests only from its own address, plus the chosen interface port in development mode (BR-864). Failing to open a browser is meant to be harmless, but a missing opener may stop the process (BR-870, suspected defect, Q5).

**Multi-project serving.** Projects registered in the machine settings are served by the same launch, beside the launch directory's project (BR-868, BR-994). With none registered, the dashboard is the single-project dashboard (BR-998). Each registered project's pages reach only that project, and writes stay in the project they name (BR-995, BR-996, BR-999). A dashboard edit carries the version it was based on and a stale one is refused with 409 and a view of what changed (BR-996, BR-1015), with two exceptions: a save the person chooses to overwrite skips the check, and a web edit sent with no version is not checked at all (BR-1015, Q7). One sign-in covers every project (BR-997). A project that fails after launch fails alone (BR-1000).

**Event.** `DashboardLaunched`: a running local server, a printed sign-in link and, with registered projects, one printed line per project giving its state; on stop, everything closed (BR-869). No corpus document or audit entry; the machine-wide dashboard key and sessions are kept outside the corpus (BR-867).

### Terms used here

- **Packaged dashboard**, **sign-in link**: defined in the branch glossary.
- **Registered project**: a project named in the machine settings' dashboard project list, served by the dashboard under its own name.

### Boundary notes

- Request authentication of every API call is shared with the standalone web server: sync ("Serve the corpus over HTTP").
- Settings edits, document writes, approvals, issue decisions and plan progress seen through the interface: their own branches. This leaf owns only that such a write reaches the project it names and behaves there as in a single project (BR-996); the gate, audit and out-of-date rules of each write stay with its branch.
- BR-1015 is held here, beside BR-996, because it describes what the dashboard's edit control sends and shows (the carried version, the conflict view, the overwrite choice) and how the shared web service treats a web edit without a version; what a version check means for a document in general stays with corpus.
- Multi-project serving is here, not in sync, because the set of served projects is fixed when the dashboard launches and lasts until it stops; the plain web server serves one corpus.
- Duplicate names in the project list make the machine settings unreadable, and an unreadable settings file is the case BR-868 already records (BR-994 points to it).

### Current values

| What can be adjusted | Value | Who may change it | Read at |
|---|---|---|---|
| API port | 8787 | the caller | 2026-10-09 |
| Interface port in development mode | 5173 | the caller | 2026-10-09 |
| Sign-in link lifetime | 60 seconds | product | 2026-10-09 |
| Address served | the local machine only | product | 2026-10-09 |
| Registered projects | none | the user (machine settings) | 2026-10-10 |

### Depends on

- Initialise a project corpus: a corpus must exist, for the launch directory and for each registered project.
- sync, "Serve the corpus over HTTP": request authentication.
- Edit project settings: the machine settings that hold the project list.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | In packaged mode the interface-port option is accepted but never checked (the code's own header says it is validated). Should it be refused, checked, or ignored? | unconfirmed | engineering |
| Q2 | A port that is already taken in packaged mode ends the launch with the runtime's own error rather than a named one (BR-1006). Should it be a named refusal, as in development mode? | unconfirmed | engineering |
| Q3 | Should launching check that the cached dashboard key is still present, and recreate it if not? | unconfirmed | engineering |
| Q4 | Should an unreadable machine settings file, including one with two projects of the same name, be reported at launch instead of silently serving no registered project? | unconfirmed | engineering |
| Q5 | Should the browser opener's failure be caught where it is reported, so a machine without a browser keeps serving? | unconfirmed | engineering |
| Q6 | The new-document control does not show the project's name, unlike every other write control (issue 124). Should it? | unconfirmed | product |
| Q7 | A web edit sent with no version is not checked against a newer one, so a caller that omits the version overwrites silently (BR-1015). Should the shared web service refuse an edit with no version instead? | undecided | engineering |

#### Rules held below established

Each rule below matches the code as read on 2026-10-09 (BR-994 to BR-1000, BR-1006 and BR-1015 read on 2026-10-10), but no live check-decided criterion would fail if it were false (including the exit code it states), or the owner has not decided it. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`). Every rule of this leaf held below established is listed here.

**Why these rules are unconfirmed, not observed.** BR-623 allows four confidence values (established, observed, undecided, unconfirmed), and the method ADR uses the same four. The parent branch (Distribution) states its choice for rules measured in code that no criterion cites yet: such a rule *may* be held at observed, and this branch's leaves keep it at unconfirmed with the measurement written in its question, which the parent names as equally valid. This leaf follows that choice, so BR-859, BR-860, BR-861, BR-865 to BR-870, BR-994 to BR-1000 and BR-1006 stay at unconfirmed; moving them to observed would say nothing new. The rules with a question about a suspected defect (Q1 to Q6) are unconfirmed in the ordinary sense as well.

**Why BR-1015 is undecided.** Its last sentence (a web edit sent with no version is not checked) is exactly what Q7 asks the owner to decide, and nothing the code shows can settle intent. Adding a criterion would not be enough to establish it, so it is held at undecided, the value the method uses when the owner has not decided. Its other two sentences (the 409 conflict view and the chosen overwrite) are not in question.

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-859 | unconfirmed | established | No question about intent: no test checks the listening address. |
| BR-860 | unconfirmed | established | No question about intent: the criterion checks a non-zero exit, not exit 1. |
| BR-861 | unconfirmed | established | No question about intent: no dashboard test launches outside a corpus. |
| BR-865 | unconfirmed | established | No question about intent: the development path is tested for the port it passes on, not for the taken-port exit. |
| BR-866 | unconfirmed | established | Q1 |
| BR-867 | unconfirmed | established | Q3 |
| BR-868 | unconfirmed | established | Q4 |
| BR-869 | unconfirmed | established | No question about intent: the shutdown is unit-tested in the lifecycle module, which no criterion names. |
| BR-870 | unconfirmed | established | Q5 |
| BR-994 | unconfirmed | established | Q4 for duplicate names; otherwise no question about intent: no live criterion cites it. |
| BR-995 | unconfirmed | established | No question about intent: an end-to-end isolation test exists, but no criterion cites this rule. |
| BR-996 | unconfirmed | established | Q6 |
| BR-997 | unconfirmed | established | No question about intent: no live criterion cites it. |
| BR-998 | unconfirmed | established | No question about intent: no live criterion cites it. |
| BR-999 | unconfirmed | established | No question about intent: no live criterion cites it. |
| BR-1000 | unconfirmed | established | No question about intent: no live criterion cites it. |
| BR-1006 | unconfirmed | established | Q2 |
| BR-1015 | undecided | established if the no-version path is kept; rewritten if the shared web service must refuse an edit with no version | Q7. Measured against commit 5e025ad2 and re-read at f67524d6 (`packages/lore/src/adapters/http/concurrency.ts:100-116`: the overwrite header bypasses the check, no version header skips it, a stale version gives 409 with the diff). No criterion cites it. |
