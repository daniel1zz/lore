---
id: BASE-031
type: baseline
role: intent
title: "Attribute work to a run"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-15
tags: []
parent: BASE-027
---
## Attribute work to a run

> Every write in the corpus says which run did it — vouched for by the agent integration, never self-reported — and keeps the name the writer was known by, with its source, as a separate label.

**Built in three steps.** Slice 1 (`plan-run-identity-slice-1-harness-attested-runs`, 2026-10-11) built runs and attestation: BR-1027 to BR-1032 and BR-1034 to BR-1039 are cited by criteria of `spec-run-identity-slice-1-harness-attested-runs-attested`. On 2026-10-12 `spec-run-only-write-identity-and-run-end-claim-release` made the run the only identity and removed the flag and the environment setting as identity sources: BR-1055 (cited by AC-ROI-1 and AC-ROI-2) replaced BR-1033. On 2026-10-15 `spec-interception-moves-off-every-tool-call-one-turn-end-review` made attribution independent of the name the lore tool server is registered under: BR-1093 (cited by AC-TE-6). Every live rule on this leaf is held at established: each is cited by a criterion of one of these specs that passed a runner-attested run. BR-1032's list of name sources still names the flag, the environment setting and the working copy, which BR-1055 and the retirement of BR-1022 removed; its citations prove the recording of attestation and of a name with its source, not that list, so the list is held as an open question (Q1) until the rule is reworded.

### Behaviour

**Command.** Implicit: a run is registered when a session or a helper agent starts, and every write made by that run carries it. One explicit read: look up a run by its id.

**Constraint.** Attestation comes only from the agent integration, never from the caller. No flag and no environment setting can supply or override a write's identity, and writing on behalf of another actor is not supported (BR-1055). With no run, the identity is derived from the session, otherwise from the computer's user name, and the write is marked unattested. Every lore tool call routed to the run-attribution hook is rewritten to carry the session's run, whatever name the lore tool server is registered under; tool calls of other servers are left untouched (BR-1093). A write without attestation is kept and marked unattested, never refused and never filled in with a guessed name. Missing integration or a failed registration never blocks work.

**Event.** `RunRegistered`, `WriteAttested`, `WriteUnattested`.

### Terms used here

- **Run**: one main session, or one helper agent it started, doing work. The main session and each helper are different runs; a helper's run names the run that started it.
- **Attested**: the agent integration vouched for which run made the write.
- **Unattested**: no integration vouched for the write, or it named a run the corpus does not know.
- **Name and its source**: the name lore resolves for a writer, stored with where it came from. Shown, never trusted as identity; the label calls it `claimed`. Since BR-1055 a flag or an environment setting no longer supplies it, and with no run the identity comes from the session, else the computer's user name. Which of the other sources BR-1032 lists (tool argument, working copy) can still supply the shown name is not settled by any live rule (Q1).
- **Composition record**: the agent type of a run and the context fragments it was given, by name and content fingerprint.

### Boundary notes

- Which run holds a task, and how claims between runs conflict: execution, leaf "Claim a task".
- Installing the hooks that register runs and vouch for writes: distribution, leaf "Install the agent integration".
- Session snapshot, handoff and resume read runs but were left unchanged by slice 1, and neither later spec changed them; re-keying handoff supersession on runs is still a later slice.
- The attribution share is defined here (BR-1039); printing it in the status report belongs to the hygiene branch's status reporting.
- Other places that show an author (feed, snapshot, list, status) kept their rendering in slice 1 and neither later spec changed it; only the document view and the version history show the attested run (BR-1037).
- Role templates and choosing fragments by task context: `knowledge-role-templates-with-role-bound-and-context-bound` (separate initiative).

### Superseded on landing

Three earlier rules described the behaviour these rules replaced; each was deprecated when its replacement landed (the first two by tasks done 2026-10-11, the third on 2026-10-12):

| Today's rule | Replaced by | Deprecated in |
|---|---|---|
| BR-125 (same name = same holder) | BR-1040 | the claim-by-run task of `plan-run-identity-slice-1-harness-attested-runs` |
| BR-135 (agents are asked by instructions to use distinct identities) | BR-1045 | the text-purge task of the same plan |
| BR-1033 (a caller-supplied name by flag or environment setting is kept as the claimed name) | BR-1055 | `spec-run-only-write-identity-and-run-end-claim-release`, 2026-10-12 |

On "Claim a task", BR-131 and BR-134 stay live and BR-1022 (the working-copy-derived name) is retired. BR-134 depends on the computer-user-name fallback, which BR-1055 keeps; BR-131 compares recorded sessions, not names.

### Threat model

Cooperative but error-prone agents (ADR decision U1): the integration overwrites any caller-supplied run on every lore tool call routed to its run-attribution hook, under any registered server name (BR-1093); calls that never reach the hook are unattested. A deliberately malicious agent on the same machine is out of scope.

### Depends on

- Claim a task (execution): claim conflicts by run.
- Install the agent integration (distribution): the hooks that register runs.
- Choose which fragments apply (context): the fragments recorded in a run's composition record.

### Open questions

| # | Question | Kind | Owner |
|---|---|---|---|
| Q1 | BR-1032 still lists flag, environment setting, tool argument and working copy as sources of the recorded name, while BR-1055 says no flag or environment setting supplies identity and derives it from the session or the computer's user name only. Should BR-1032 be reworded to the sources BR-1055 leaves, and can a tool argument still supply the shown name? Until then BR-1032 stays as stored; changing a rule's text or level is outside a prose update. | undecided | engineering |
