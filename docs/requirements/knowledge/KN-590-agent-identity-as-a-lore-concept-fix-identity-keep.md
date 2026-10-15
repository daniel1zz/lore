---
id: KN-590
type: knowledge
role: knowledge
title: "Agent identity as a lore concept — fix identity, keep composition dynamic, derive the agent"
status: approved
priority: medium
created: 2026-10-11
updated: 2026-10-11
tags: [identity, actor, claim, session, agent]
parent: PRD-001
links:
  - {id: BASE-021, type: informs}
  - {id: BASE-027, type: informs}
  - {id: SPEC-025, type: informs}
  - {id: SPEC-104, type: informs}
  - {id: SPEC-090, type: informs}
  - {id: TASK-384, type: informs}
  - {id: KN-272, type: informs}
  - {id: TASK-379, type: informs}
  - {id: TASK-841, type: informs}
---
# Agent identity as a lore concept — fix identity, keep composition dynamic, derive "the agent"

Ideation, 2026-10-11. Not a decision. Input for `/lore-product validate` and a later ADR; no spec until then.

## Problem

Lore has no "agent" entity. Who did something is a self-reported string (`by` / `recorded_by` / `actor`), resolved per invocation by precedence `--by` > `$LORE_ACTOR` > session tier (`agent:session-<8>` from `CLAUDE_CODE_SESSION_ID`) > worktree-derived `agent:<branch>` > OS username (`packages/core/src/actor-resolution-node.ts:89`, `packages/lore/src/adapters/cli/utils.ts:571`). Every consumer that needs identity (claim conflicts, session derivation, handoff supersession, audit) re-guesses it from that string.

Three disjoint identity notions exist and none is complete:

| Notion | Nature | Gap |
|---|---|---|
| actor string | self-reported, unregistered, unverified | mixes role (`agent:main-orchestrator`), run (`agent:session-21d0be70`) and location (`agent:<branch>`) in one field |
| agent key (`lore agent create`) | HTTP credential, issued and revocable | HTTP only; unrelated to CLI/MCP actors |
| session (baseline branch SESS) | derived from fresh claims, never stored | an agent without a claim does not exist; subagents share the parent's session id |

## Evidence (measured 2026-10-11)

1. **Identity is fragmented, so nothing can be aggregated per agent.** 5,657 evidence rows on tasks carry 775 distinct `recorded_by` values; one role appears as `agent:main-orchestrator`, `main-agent`, `claude-main`, `autopilot`, `apple`, `daniel-via-agent-proxy`, `agent:main-orchestrator-82242b77`, ... Re-verify:
   `sqlite3 -readonly .lore/lore.db "select count(*), count(distinct json_extract(e.value,'\$.recorded_by')) from docs d, json_each(json_extract(d.extra,'\$.verification_evidence')) e where d.type='task'"`
2. **Distinct runs collapse into one name.** 1,789 of those rows (32%) are under the single literal `agent:main-orchestrator`, used by concurrent sessions.
3. **Subagents cannot be told apart from the environment.** A subagent's Bash env carries the SAME `CLAUDE_CODE_SESSION_ID` as its parent session and no per-subagent variable; the only per-subagent discriminator is `agent_id` / `agent_type` in hook stdin (https://code.claude.com/docs/en/hooks, common input fields).
4. **OS environment identity leaks globally.** A stale `export LORE_ACTOR=agent:task-retraction` (and `export WT=<an old worktree>`) in the user's shell profile was inherited by the main session, the MCP server, every hook and every subagent, outranking the session tier. Environment variables have no isolation: any process reads them, any profile line sets them, nothing records who set them.
5. **The same defect class has been patched consumer by consumer:**
   - 2026-07-31 — handoff supersession keyed on (plan, actor) archived a concurrent session's live ticket (`knowledge-handoff-supersession-keys-on-plan-actor-concurrent`).
   - 2026-08-02 — two orchestrators both resolved to `agent:main-orchestrator`; `active_sessions` under-reported and a live agent's worktree was removed, twice (`task-two-concurrent-orchestrators-both-resolve-to-agent-main`). Fixed only inside `noAnchorOverlap`.
   - 2026-08-03 — `session_id` was captured on the task-claim path only; the phase-claim path hit a permanent fail-safe refusal (`task-phaseworkflowservice-claim-captures-no-session-id-so-every`).
   - Open now — on the SAME task, a second claim by the same actor from a different session is a refresh, not a conflict (`baseline-claim-a-task` BR-125, code `task-workflow-service.ts` `sameHolder = existingClaim.by === opts.by`), although BR-131 states "the same actor name is not proof of the same worker" and the session id is already recorded on the claim (BR-138). CLAM Q2 ("should identity sharing itself be refused?") is undecided and does not mention the same-task case.

6. **The same write reports different authors on different surfaces.** Creating THIS document with `LORE_ACTOR=agent:main-orchestrator` recorded `actor = agent:main-orchestrator` in the `audit` table, while `lore get` prints `Created: ... by system` and `lore log` prints `Author system` — the known, still-draft `task-lore-create-by-is-accepted-and-ignored-cli-content-writes` (2026-08-25). The `audit.session_id` column of those rows holds the document id (`01M4MVK5734SGXF4TGF0EJWP9X`), not a session. Re-verify:
   `sqlite3 -readonly .lore/lore.db "select actor, session_id, action from audit where doc_id='01M4MVK5734SGXF4TGF0EJWP9X'"`

The original purpose of claims (SPEC-025 §1 gap 3: "Two concurrent sessions will duplicate work") therefore fails in its most direct case.

## Model discussed

Human analogy: agent = employee, subagent definition = job template, subagent instance = one run; an agent is composed of **norms** (rules, context fragments), **capabilities** (tools, skills, permission limits) and **memory**.

Where the analogy breaks: a human's composition is fixed to the person, so identity must attach to the person. An AI's composition can be re-assembled per task, and fixing it ex ante would constrain exactly the flexibility that makes AI execution cheap. So the two concerns separate:

- **Fixed: identity and provenance of each run.** Required for the corpus not to lie.
- **Dynamic: composition.** Which norms, capabilities and memory a run carries is assembled per task.

Proposed shape:

1. **Run is the only identity lore issues.** Each run gets a lore-issued id and an append-only composition manifest: template + version, injected norm fragments (by content hash), capabilities, injected memory (handoff / knowledge slugs), model + harness, parent run (lineage), worktree. The main session is a run too.
2. **"The agent" is derived, never stored** — the same principle as sessions (SPEC-042 D1) and readiness. "How does the implementer role perform" = aggregate runs by template; "what is the AC pass rate of runs carrying norm fragment X" = aggregate by a manifest element. The second query is impossible under a fixed-employee model and is what makes compositions comparable (A/B on norms and capabilities).
3. **Learning attaches to composition elements, not to an individual.** A testing lesson updates the testing norm; a module lesson goes to that module's knowledge. Any future composition can then use it.
4. **Solidifying is optional and after the fact.** A composition that keeps proving itself can be saved as a template or a named role. A persistent individual is warranted only when accountability must be continuous across runs (long-lived module ownership, permissions earned over time); add it then, not now.
5. **The harness attests, it does not define.** Claude Code's `agent_id` is ephemeral and harness-specific; lore must stay usable from other harnesses (Codex delegation, a human on the CLI, HTTP keys). Each harness gets an adapter that proves which run an invocation belongs to: for Claude Code, SessionStart / SubagentStart register a run and PreToolUse injects the run into that one call via `updatedInput` (per-invocation, not inherited). `CLAUDE_ENV_FILE` is not usable for this: it exists only for SessionStart, Setup, CwdChanged and FileChanged, not SubagentStart.
6. **Templates in lore's own format, rendered per harness** — the same pattern context fragments already use (`lore fragments render --outlet hook:subagent-start --agent-type <t>` already selects norms per agent type, keyed today on Claude Code's type name). Today the templates are `assets/agents/lore-*.md` in Claude Code format, and capability limits ("reviewer is read-only") live only in that harness's config.

Boundary: lore records and attests who did what — provenance of knowledge, consistent with the knowledge-platform positioning (SPEC-025: "keeps Lore a knowledge platform, not a project-management tool"). Lore does not run or schedule agents and does not add authorization beyond existing agent keys.

## Counter-arguments recorded

- Scope risk: an identity layer can drift into agent runtime / IAM. Mitigated only by the boundary above.
- Every write path gains a run reference; the 5,657 historical rows cannot be back-filled with a run and must be marked unattributable rather than guessed.
- Smaller alternative: fix BR-125 alone by comparing the already-recorded `session_id` / `agent_id` on claims. Solves the claim conflict; does not solve aggregation, attribution or lineage, and continues the consumer-by-consumer patching in Evidence item 5.

## Open questions

1. Where runs live: a store-level append-only table (small rows, syncable) vs corpus documents (addressable but grows the corpus faster than it self-checks). Leaning store table.
2. Spoofing: if the injected value is the plain `agent_id`, an agent can type it. A registration-time nonce injected by the hook and verified by lore is stronger. Not verified: whether the model sees the command rewritten by `updatedInput`.
3. How multiple PreToolUse hooks returning `updatedInput` combine is undocumented; Bash already carries two gate sets plus git-safety.
4. Whether SubagentStart's own input carries `agent_id` (documented for tool events inside a subagent; not measured for SubagentStart).
5. Fate of `$LORE_ACTOR`: demote to a human-readable label or retire.
6. MCP calls do not pass through Bash; PreToolUse also fires for MCP tools, so `updatedInput` can set their identity argument — to be measured.

## Next steps (not started)

- `/lore-product validate` on this, using the evidence above.
- ADR: run as the issued identity, composition manifest, derived agent, harness attestation, retirement of environment-based identity.
- Baseline: an identity leaf/branch (CLAM lists "session (not yet written): identity resolution" as a dependency), fix BR-125 and answer CLAM Q2.

## Related

`baseline-claim-a-task`, `baseline-session`, `spec-task-execution-workflow-metadata-evidence-claim-ready` (SPEC-025), `spec-worktree-derived-actor-identity-agent-branch-as`, `spec-claim-time-actor-identity-guard-zero-evidence-release-advis`, `task-two-concurrent-orchestrators-both-resolve-to-agent-main`, `knowledge-handoff-supersession-keys-on-plan-actor-concurrent`, `task-phaseworkflowservice-claim-captures-no-session-id-so-every`.
