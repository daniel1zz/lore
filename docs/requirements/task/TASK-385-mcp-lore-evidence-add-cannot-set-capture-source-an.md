---
id: TASK-385
type: task
role: plan
title: "MCP lore_evidence_add cannot set capture_source and has no --capture equivalent, so an agent using lore through MCP is structurally unable to produce a runner-captured evidence row"
status: archived
priority: medium
created: 2026-08-03
updated: 2026-08-03
tags: []
parent: PRD-001
links:
  - {id: TASK-391, type: relates-to}
---
Residual of `task-a-non-empty-output-tail-can-be-hand-authored-prose-and-the` (merged `82157f3`),
flagged by its implementer and left undone because `tools.ts` was off-limits at the time.

## The gap

The CLI's `lore evidence` now always stamps `capture_source` explicitly — `"runner"` when it spawned
the command itself via `--capture`, `"self-report"` otherwise. `appendEvidenceEntry` additionally
FORCES `"runner"` whenever `attestation !== undefined`.

The MCP `lore_evidence_add` tool has no way to set it. Rows written through MCP therefore arrive with
the field absent. Absence is read as `"self-report"` (deliberate, and the safe direction) — but MCP
callers also have no `--capture` equivalent, so an agent using lore through MCP cannot produce a
runner-captured row at all. It gets the pass-tail requirement for free (shared service guard) while
being structurally unable to satisfy the stronger form.

⛔ Note the schema field is `.optional()` by necessity, not by choice: making it required broke the
MCP tool's compilation, which is how the gap was discovered. That is the same optional-parameter
shape that silently left an adapter unwired twice earlier in the same session — here it is at least
NAMED rather than discovered later.

## Required

- Give `lore_evidence_add` a way to supply captured output as runner-sourced. Decide between: (a) a
  `capture_source` input the caller sets — weak, an agent can simply claim `"runner"`; (b) a
  `capture` boolean plus a command the SERVER spawns, mirroring the CLI — strong, but the MCP server
  runs in its own cwd and may not be where the command should execute (the same constraint that
  forced `caller_cwd` to exist); (c) accept that MCP is self-report-only and make that explicit and
  auditable rather than merely absent.
  ⛔ (a) is the proxy option — it lets the field assert what nothing verified. Prefer (b) if the cwd
  problem is solvable with the existing `caller_cwd`, else (c) with the limitation written down.
- Once both adapters can set it, make the field required at the write boundary (not in the persisted
  schema — legacy rows must stay readable), so a third adapter cannot omit it silently.

## Proxy / Silence / Opt-in

- **Proxy** — option (a) above is the trap: a caller-supplied `capture_source` proxies "this output
  was captured" with nothing behind it, which is precisely the substitution the parent task closed on
  the CLI side. Do not reintroduce it through the MCP door.
- **Silence** — today MCP rows are indistinguishable from CLI self-report rows, which is *correct* by
  the absence-reads-as-self-report rule, so nothing is currently mis-recorded. The silence is about
  CAPABILITY, not provenance: nothing tells an MCP caller that the stronger path is unavailable to it.
- **Opt-in** — `capture_source` is optional in the schema by compilation necessity; that optionality
  is the hole this task closes at the write boundary.

## Oracle

- RED first: an MCP `lore_evidence_add` with a passing result and a supplied tail currently stores no
  `capture_source`; after the fix it stores the chosen explicit value. Assert the stored VALUE.
- CONTROL: the CLI's two paths keep stamping `"runner"` / `"self-report"` byte-identically.
- CONTROL: `appendEvidenceEntry` still FORCES `"runner"` for any row carrying an `attestation`,
  regardless of what the adapter passed — assert by passing `"self-report"` alongside an attestation
  and observing `"runner"` stored.
- CONTROL: legacy rows with no `capture_source` still read as `"self-report"` and do not fail schema
  parsing.
- If option (b): the spawned command's working directory is asserted explicitly, not assumed.
