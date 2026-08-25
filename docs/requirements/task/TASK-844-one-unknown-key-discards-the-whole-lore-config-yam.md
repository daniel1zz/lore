---
id: TASK-844
type: task
role: plan
title: "One unknown key discards the whole .lore/config.yaml and the error then claims nothing was configured: silence, not the non-abort, is the defect"
status: draft
priority: high
created: 2026-08-25
updated: 2026-08-25
tags: [silent-fallback, config, north-star]
parent: PRD-001
---
MEASURED 2026-08-25 by agent:main-orchestrator, from source (not the binary — `dist/lore` was 2h stale and was checked and rejected as an instrument first). This began as ticket 131's NS4, which recorded "loader.ts silently treats a schema-invalid .lore/config.yaml as config: undefined, so feedback.upstream reads as unconfigured — reported by an implementer, NOT independently re-verified". It is now independently verified, and the finding is WIDER than the report.

## The discriminating control — this is the whole finding

Throwaway corpus (`mkdtemp` + `lore init`, never this repo's `.lore/`). `lore init` generates:

```yaml
project:
  name: <dir>
  author: owner
```

**A2** — that pristine file plus a valid appended block:

```yaml
feedback:
  upstream:
    repo: someorg/somerepo
```

→ `Error: Validation failed on field 'gh': gh exited with code 1: gh: Not Found (HTTP 404)`

The config WAS consumed: the command reached GitHub and failed on a repo that genuinely does not exist. That 404 is the positive control — it proves the read path works.

**B2** — byte-identical to A2 plus ONE unknown top-level key:

```yaml
totally_unknown_key: 42
```

→ `Error: Validation failed on field 'feedback.upstream': 'feedback.upstream' is not configured — set feedback.upstream.repo ... to file and read issue reports via GitHub.`

⛔ One unknown key discards the ENTIRE config, and the message tells the user they never configured an upstream. It names neither the offending key, nor the fact that a config file exists at all, nor that anything was discarded. Byte-identical (verified with `cmp`) to the message for a corpus with NO `.lore/config.yaml` whatsoever.

Corollary measured on the way in, worth stating because it is how this trap actually bites: a config consisting of ONLY a correct `feedback:` block — i.e. the user hand-writes the block the error message asks for, into a file whose `project:` key they did not know was required — also reports "not configured". The error message asks for exactly the edit that reproduces the error.

## Mechanism

`packages/lore/src/adapters/cli/loader.ts::loadProjectConfig()`:

```ts
const configResult = resolveProjectConfigResult(dbPath);
if (!configResult.ok) return undefined;
```

Whole-file parse, one Result, discarded on failure with no diagnostic on any surface.

⛔ Do NOT file this as an undocumented oversight — it is partially documented, and the documentation is where the fix must start. `loader.ts`'s own header invariant says: "Every OTHER config parse failure (malformed YAML, bad sync/telemetry/workflow section, unknown top-level key, etc.) keeps the pre-existing silent fallback-to-undefined behaviour — this is a documented non-goal of SPEC-030, not an oversight." And `loadProjectConfig`'s docstring justifies not aborting: "a live MCP server's per-call config re-read must never abort the process mid-request."

That justification is sound and is NOT what this task disputes. **Not aborting and emitting no diagnostic are two different decisions, and only the first one was ever argued.** The sibling paths prove the asymmetry is not principled: the global config warns to stderr on malformed input, and an invalid `ai` block exits LOUD at CLI startup (SPEC-030 AC-HJ-3). The project-config path on this route does neither. `spec-the-retired-shape-refusal-message-has-two-byte-identical`'s standing lesson is the same shape: "a refusal branch on one config shape and absent on its neighbour reads as guarded everywhere."

## Blast radius

Every consumer of `loadProjectConfig()` silently reverts to defaults on one typo, with no trace: `workflow.verification_profiles` oracle floors, `workflow.gates.*` enablement, `context.memory_files` budgets, `ai.providers`, `feedback.*`. A gate that silently reads as disabled is worse than one that refuses — this repo's own North Star: "It must not go silent... 'Vacuously true' must be distinguishable from 'true'." A verification floor that vacuously passes because a neighbouring key was misspelled certifies whatever it was supposed to block.

## Scope

Required: a parse failure must leave a TRACE, on every surface, without aborting a live server. At minimum the discarded-config fact plus the offending path (Zod already carries it) must reach stderr, and "config present but unusable" must be RENDERED DIFFERENTLY from "no config" everywhere the distinction is reachable — including the `feedback.upstream is not configured` message, which currently asserts something false.

⛔ Out of scope, deliberately: making `loadProjectConfig` abort. The docstring's reason stands.

Open design question for whoever takes it, not to be resolved by picking the first option: whether the fix is a diagnostic-only change, or whether `resolveProjectConfigResult` should return per-section Results so ONE bad section cannot discard the valid remainder. The second is the real SSOT-shaped answer and is a bigger change; the first is not a stopgap if it makes the lie impossible.

## Falsifier

⛔ Not "an invalid config prints a warning" — that passes with a warning nobody can act on. The oracle is the A2/B2 PAIR: construct BOTH ends, assert the two outputs DIFFER, and assert the B2 output names the offending key path. Smallest mutation that turns it red: emit the same generic message for both. A single-ended probe (invalid config only) vacuously passes — the same trap as `knowledge-retro-a-fresh-install-probe-vacuously-passes`.
