---
id: BASE-031
type: baseline
role: intent
title: "Attribute work to a run"
status: draft
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: []
parent: BASE-027
---
## Attribute work to a run

> Every write in the corpus says which run did it — vouched for by the agent integration, never self-reported — and keeps any self-reported name separately as a claim.

**Built in slice 1** (`plan-run-identity-slice-1-harness-attested-runs`, 2026-10-11). Every rule on this leaf is held at established: each is cited by a criterion of `spec-run-identity-slice-1-harness-attested-runs-attested` that passed a runner-attested `lore verify` on main and would fail if the rule were false.

### Behaviour

**Command.** Implicit: a run is registered when a session or a helper agent starts, and every write made by that run carries it. One explicit read: look up a run by its id.

**Constraint.** Attestation comes only from the agent integration, never from the caller. A name the caller supplies is kept as a claim and never counts as attestation. A write without attestation is kept and marked unattested, never refused and never filled in with a guessed name. Missing integration or a failed registration never blocks work.

**Event.** `RunRegistered`, `WriteAttested`, `WriteUnattested`.

### Terms used here

- **Run**: one main session, or one helper agent it started, doing work. The main session and each helper are different runs; a helper's run names the run that started it.
- **Attested**: the agent integration vouched for which run made the write.
- **Unattested**: no integration vouched for the write, or it named a run the corpus does not know.
- **Name and its source**: the name lore already resolves for a writer (flag, environment setting, tool argument, session, working copy or computer user name), stored with where it came from. Shown, never trusted as identity; the label calls it `claimed`.
- **Composition record**: the agent type of a run and the context fragments it was given, by name and content fingerprint.

### Boundary notes

- Which run holds a task, and how claims between runs conflict: execution, leaf "Claim a task".
- Installing the hooks that register runs and vouch for writes: distribution, leaf "Install the agent integration".
- Session snapshot, handoff and resume read runs but are unchanged in slice 1; re-keying handoff supersession on runs is a later slice.
- The attribution share is defined here (BR-1039); printing it in the status report belongs to the hygiene branch's status reporting.
- Other places that show an author (feed, snapshot, list, status) keep today's rendering in slice 1; only the document view and the version history change (BR-1037).
- Role templates and choosing fragments by task context: `knowledge-role-templates-with-role-bound-and-context-bound` (separate initiative).

### Superseded on landing

Two earlier rules described the behaviour these rules replaced; each was deprecated by the task that landed its replacement (done 2026-10-11):

| Today's rule | Replaced by | Deprecated in |
|---|---|---|
| BR-125 (same name = same holder) | BR-1040 | the claim-by-run task of `plan-run-identity-slice-1-harness-attested-runs` |
| BR-135 (agents are asked by instructions to use distinct identities) | BR-1045 | the text-purge task of the same plan |

BR-131, BR-134 and BR-1022 stay live: the name tiers they rely on are kept (the name is still resolved as today; only attestation is new).

### Threat model

Cooperative but error-prone agents (ADR decision U1): the integration overwrites any caller-supplied run on every call it sees; calls it does not see are unattested. A deliberately malicious agent on the same machine is out of scope.

### Depends on

- Claim a task (execution): claim conflicts by run.
- Install the agent integration (distribution): the hooks that register runs.
- Choose which fragments apply (context): the fragments recorded in a run's composition record.
