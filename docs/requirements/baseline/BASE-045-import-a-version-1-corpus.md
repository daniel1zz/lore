---
id: BASE-045
type: baseline
role: intent
title: "Import a version-1 corpus"
status: approved
priority: medium
created: 2026-10-09
updated: 2026-10-10
tags: []
parent: BASE-066
links:
  - {id: SPEC-007, type: supersedes}
---
## Import a version-1 corpus

> A maintainer brings the documents of the product's predecessor into the corpus. Running the import again skips what it already brought in, so a repeated run is safe (BR-794).

Scope: the version-1 action of the migrate command. Its other actions are "Upgrade the corpus in place".

### Behaviour

**Command.** A maintainer imports a folder of version-1 Markdown files, or asks for a dry run that writes nothing and reports the type mapping, the links and the suspected secrets (BR-795). Each file's type, status and priority are mapped, and each document gets a new permanent id or keeps its old one when asked (BR-794).

**Constraint.** Suspected secrets stop the import with exit 4 and nothing written, unless explicitly skipped (BR-795). Documents already imported, recognised by their old id, are skipped (BR-794). A file that cannot be parsed or has malformed criteria (BR-797), or whose document name is already held in the corpus (BR-978), is listed as an error and skipped while the other files are imported; the import still ends with exit 0. An unknown version-1 type becomes a knowledge record with a warning; an unreadable folder ends with exit 1 (BR-797).

**Event.** `DocImported` for each imported document (a version entry, no audit entry, BR-796; a failure to write that version entry is ignored), then parents and links are restored (BR-794).

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | Imported documents skip the creation rules and the audit trail (BR-796). Should they pass the same creation rules and leave an audit entry like any other creation? | unconfirmed | product |
| Q2 | Listed file errors, including duplicate names, end with exit code 0 here (BR-797, BR-978) and with 4 in the spec import. Should they end with 4 here too? | unconfirmed | engineering |
| Q3 | A failure to write an imported document's version entry is ignored, so the document can exist with no history (BR-796). Should that failure be listed as an error for the file? | unconfirmed | engineering |


#### Rules held below established

No live check-decided criterion would fail if a rule below were false. Following the branch method (BR-623), a rule whose behaviour is measured in code, with the file and line recorded in its row, is held at observed; a rule with a written question about intent is held at unconfirmed. Method v2 (`adr-an-acceptance-criterion-is-placed-by-the-business-outcome`).

| Rule | Held at | Would be | Open question |
|---|---|---|---|
| BR-794 | observed | established | No question about intent. Measured at service/migration-service.ts:274-401 (type and status mapping, id choice, skip of documents already imported) and :430-500 (links and parents restored); waiting for a check-decided criterion. |
| BR-795 | observed | established | No question about intent. Measured at service/migration-service.ts:209-236 (dry run writes nothing; suspected secrets refuse with exit 4 unless skipped); waiting for a check-decided criterion. |
| BR-796 | unconfirmed | rewritten if imports are made to pass the creation rules and audit; established if the current behaviour is kept | Q1 (creation rules and audit trail) and Q3 (the ignored version-entry failure, service/migration-service.ts:385). |
| BR-797 | unconfirmed | established if exit 0 is kept; rewritten if listed errors end with 4 | Q2. |
| BR-978 | unconfirmed | established if exit 0 is kept; rewritten if listed errors end with 4 | Q2. Added 2026-10-10; matches the code (service/migration-service.ts:374-378, adapters/cli/commands/migrate.ts:473-499), and no criterion cites it yet. |
