---
id: TASK-856
type: task
role: plan
title: "One unknown key discards the whole .lore/config.yaml and the error then claims nothing was configured: silence, not the non-abort, is the defect"
status: draft
priority: medium
created: 2026-08-25
updated: 2026-08-25
tags: []
parent: PRD-001
---
---
{"severity":"high","category":"config-silent-fallback","tags":["config","silent-fallback","false-label","fresh-install"],"reporter_corpus":"~/Projects/zz/lore","reporter_root_prd":"prd-lore-internal-first-ai-team-knowledge-platform","idempotency_key":"71a0e4bb-dc5b-4a8c-ad6a-4f1215f357c8"}
---

One unrecognised key anywhere in `.lore/config.yaml` causes the ENTIRE config to be discarded, and the resulting message tells the user they never configured the thing they just configured.

MEASURED 2026-08-25 from source, in a throwaway corpus (`mkdtemp` + `lore init`). A stale `dist/lore` was checked and rejected as an instrument first.

## The discriminating control — the whole finding is the A/B pair

`lore init` generates:

```yaml
project:
  name: <dir>
  author: owner
```

**A — that pristine file plus a valid appended block:**

```yaml
feedback:
  upstream:
    repo: someorg/somerepo
```

→ `Error: Validation failed on field 'gh': gh exited with code 1: gh: Not Found (HTTP 404)`

The config WAS consumed: the command reached GitHub and failed on a repo that genuinely does not exist. That 404 is the POSITIVE CONTROL — it proves the read path works.

**B — byte-identical to A plus ONE unknown top-level key:**

```yaml
totally_unknown_key: 42
```

→ `Error: Validation failed on field 'feedback.upstream': 'feedback.upstream' is not configured — set feedback.upstream.repo ... to file and read issue reports via GitHub.`

Byte-identical (verified with `cmp`) to the message for a corpus with NO `.lore/config.yaml` at all.

## Why this is worse than a bad error message

The whole file is parsed as one unit and one `Result`; a failure discards everything. So a single typo silently reverts EVERY consumer of the project config to defaults, with no trace on any surface: `workflow.gates.*` enablement, `workflow.verification_profiles` oracle floors, `context.memory_files` budgets, `ai.providers`, `feedback.*`.

⛔ A gate that silently reads as DISABLED is worse than one that refuses. A verification floor that vacuously passes because a neighbouring key was misspelled certifies whatever it was supposed to block, and the operator has no way to notice.

Corollary measured on the way in, because it is how this actually bites a new user: a config containing ONLY a correct `feedback:` block — i.e. the user hand-writes exactly the block the error message asks for, into a file whose `project:` key they did not know was required — ALSO reports "not configured". **The error message asks for precisely the edit that reproduces the error.**

## What is already documented, and why it does not cover this

`packages/lore/src/adapters/cli/loader.ts`'s header says every non-`ai` parse failure "keeps the pre-existing silent fallback-to-undefined behaviour — this is a documented non-goal of SPEC-030, not an oversight", and `loadProjectConfig`'s docstring justifies not aborting: "a live MCP server's per-call config re-read must never abort the process mid-request."

⛔ That justification is sound and is NOT what this report disputes. **Not aborting and emitting no diagnostic are two different decisions, and only the first was ever argued.** The sibling paths prove the asymmetry is not principled: the GLOBAL config warns to stderr on malformed input, and an invalid `ai` block exits LOUD at CLI startup (SPEC-030 AC-HJ-3). The project-config path on this route does neither.

## Scope

- A parse failure must leave a TRACE on every surface, without aborting a live server. At minimum: the discarded-config fact plus the offending key path (Zod already carries it).
- "Config present but unusable" must RENDER DIFFERENTLY from "no config", everywhere the distinction is reachable — including the `feedback.upstream is not configured` message, which currently asserts something false.
- Open design question, not to be resolved by taking the first option: diagnostic-only, versus making `resolveProjectConfigResult` return per-section Results so ONE bad section cannot discard the valid remainder. The second is the SSOT-shaped answer and is the larger change.

⛔ Out of scope: making `loadProjectConfig` abort. The docstring's reason stands.

## Falsifier

⛔ Not "an invalid config prints a warning" — that passes with a warning nobody can act on, and a single-ended probe (invalid config only) passes vacuously. Construct BOTH ends: assert the A and B outputs DIFFER, and that B's output names the offending key path. Smallest mutation that turns it red: emit the same generic message for both.

**Expected:** A schema-invalid .lore/config.yaml leaves a diagnostic naming the offending key path, and 'config present but unusable' renders differently from 'no config' on every surface where the distinction is reachable — without aborting a long-lived process mid-request.
**Actual:** The whole file is one parse and one Result; any failure discards everything silently. One unknown top-level key makes 'lore report-issue' emit a 'feedback.upstream is not configured' message byte-identical (cmp-verified) to a corpus with no config file at all, while the same file minus that key reaches GitHub and fails with a real 404. Every other consumer of the project config — workflow.gates, verification_profiles, context.memory_files, ai.providers — silently reverts to defaults with no trace. A config containing only the correct feedback: block also reports 'not configured', because project: is required: the error message asks for the exact edit that reproduces it.
**Repro command:** `T=$(mktemp -d) && cd $T && lore init >/dev/null && printf 'project:\n  name: p\n  author: o\nfeedback:\n  upstream:\n    repo: someorg/somerepo\n' > .lore/config.yaml && lore report-issue --list > a.txt 2>&1; printf 'project:\n  name: p\n  author: o\nfeedback:\n  upstream:\n    repo: someorg/somerepo\ntotally_unknown_key: 42\n' > .lore/config.yaml && lore report-issue --list > b.txt 2>&1; diff a.txt b.txt && echo 'DEFECT: invalid config is indistinguishable from valid'`

Reported by: agent:main-orchestrator
