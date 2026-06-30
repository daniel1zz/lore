---
id: SPEC-019
type: spec
role: spec
title: "AI assistance in lore set and lore link"
status: draft
priority: medium
phase: P10
created: 2026-06-30
updated: 2026-06-30
tags: [cli, ai, mutation, set, link, phase-10, stub]
parent: PRD-001
links:
  - {id: SPEC-017, type: extends, note: "Reuses AIProvider interface from create-path"}
  - {id: SPEC-003, type: extends, note: "Adds AI flags to existing set/link commands"}
---

# SPEC-019: AI assistance in `lore set` and `lore link`

> **Status: stub.** Goal of this draft is to enumerate the design space and resolve open questions before a v1 implementation SPEC is written.

## 1. Purpose

SPEC-017 introduced an AI provider for `lore create` (one-shot doc generation from title + template). Two adjacent mutating commands remain manual:

- `lore set <id> --content "..."` — replacing or refining existing content
- `lore link <from> <to> --type <link_type>` — declaring relationships between docs

This SPEC extends the AI provider surface to those two commands so that an existing doc's content can be regenerated or refined, and link types can be inferred from doc bodies without the user looking up the six allowed types every time.

## 2. Goals & Non-Goals

### 2.1 Goals

- `lore set <id> --regenerate` — re-run the AI template for the doc's current type/title, replacing content. Reuses `SPEC-017` templates and provider config.
- `lore set <id> --refine "<prompt>"` — pass a user instruction + the current content to the AI provider, write the response back.
- `lore link <from> <to> --infer` — ask the AI provider to choose a link type (one of `parent | implements | informs | supersedes | relates-to | blocks`) from the bodies of both docs.
- Fail-loud on AI errors (binary missing / non-zero exit / empty output / timeout) — identical exit code 6 to SPEC-017.
- Six-dimension test coverage (HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION).

### 2.2 Non-Goals

- ❌ **Streaming UI** — output is sync, same as SPEC-017.
- ❌ **Multi-pass agent loops** — one prompt, one response per command.
- ❌ **MCP / HTTP surface** — CLI-only for v1. MCP tools (`lore_set_ai`, `lore_link_infer`) follow as a separate SPEC.
- ❌ **AI in `lore delete` / `lore approve`** — destructive / lifecycle ops stay manual.
- ❌ **Auto-link** — `--infer` never *creates* the link without explicit `lore link from to --infer`; it just chooses the type. No background "AI suggests links you should make".
- ❌ **Diff preview** — the new content lands directly via `lore set`, producing a new version. User uses `lore diff` after the fact.

## 3. Open Design Questions

### Q1 — `--regenerate` vs `--refine` orthogonality

Are they mutually exclusive flags, one CLI flag with two modes (`--ai=regenerate|refine`), or two separate subcommands (`lore regenerate <id>`, `lore refine <id> --prompt`)?

**Recommendation**: two flags on `lore set`, mutually exclusive — keeps surface small and consistent with SPEC-017's `--no-ai` pattern.

### Q2 — `--refine` prompt source

- Inline: `lore set <id> --refine "tighten section 3"`
- Stdin: `echo "tighten section 3" | lore set <id> --refine-stdin`
- $EDITOR: `lore set <id> --refine` opens editor, user writes prompt, exits, content gets refined

**Recommendation**: inline + stdin. Editor adds latency without value.

### Q3 — `--infer` confidence threshold

The model picks one of six types. What if it returns `relates-to` as a low-confidence default? Should we:

- Trust the model unconditionally (v1 simplest)
- Require the model to return JSON `{type, confidence}`, error if confidence < 0.6
- Print the chosen type and ask `y/N` interactively

**Recommendation**: v1 trust. Confidence + interactive can be a later SPEC.

### Q4 — Template extensibility for refine

`lore set --refine` needs a different prompt template than `lore create`. Add `ai.templates.refine` to config, or hardcode the wrapper template in the service?

**Recommendation**: config slot for symmetry with `ai.templates.<type>`, default value hardcoded in service.

### Q5 — Status side-effects

Editing content of an `approved` doc resets it to `draft` (CLAUDE.md doc lifecycle). Does `--regenerate` / `--refine` follow the same rule?

**Recommendation**: yes. AI-edited content is still an edit; lifecycle rules don't bifurcate by provenance.

### Q6 — Cost / telemetry

SPEC-017 emits one `ai.generation` event per `create`. Per-command type:

- `ai.regeneration` event for `set --regenerate`?
- `ai.refinement` event for `set --refine`?
- `ai.link_inference` event for `link --infer`?

Or one unified `ai.generation` event with a `kind: create|regenerate|refine|infer` discriminator?

**Recommendation**: unified event, `kind` discriminator. Simpler dashboards.

## 4. Acceptance Criteria (early draft)

**AC-SET-AI-1** `lore set <id> --regenerate` calls AIProvider with `templates[doc.type]`, replaces `doc.content`, writes new version.

**AC-SET-AI-2** `lore set <id> --refine "<prompt>"` calls AIProvider with `templates.refine` interpolating `{{current_content}}` and `{{user_prompt}}`, replaces `doc.content`.

**AC-SET-AI-3** `--regenerate` and `--refine` are mutually exclusive — passing both exits code 2 with usage error.

**AC-SET-AI-4** `--regenerate` / `--refine` on an `approved` doc transitions it to `draft`.

> **Note on lifecycle SSOT**: `VALID_TRANSITIONS` in `schemas.ts:196-203` has no `approved → draft` edge — this auto-reset is a deliberate **service-layer bypass** (the same one used by the existing `CorpusService.update` path per CLAUDE.md "Editing content/title on an approved doc resets it to draft automatically"). Implementors MUST NOT route this through `isValidTransition()`; the demotion happens inside `CorpusService.update` as a content-edit side effect, not as a lifecycle move.

**AC-LINK-AI-1** `lore link <from> <to> --infer` calls AIProvider with `templates.link_inference` interpolating both doc titles + first 500 chars of body, parses single-word stdout, validates against the 6 link types.

**AC-LINK-AI-2** AI returns an invalid type → exit 6, no link created.

**AC-AI-FAIL-1** Binary missing / non-zero exit / timeout / empty output → exit code 6, no doc/link mutation, telemetry event emitted with `error`.

**AC-AI-TEL-1** Telemetry emits a single `ai.generation` event with `kind: create | regenerate | refine | infer` discriminator (extending the existing SPEC-017 schema; `create` is the SPEC-017 default) and `target_doc_id` (null for `create`).

## 5. Out-of-scope rejections

- "Auto-suggest links across the whole corpus" — separate SPEC, not bolted onto `lore link`.
- "Visual diff before write" — `lore diff` already exists post-write.
- "AI in dashboard write UI" — covered by SPEC-022 (Dashboard write UI), not duplicated here.

## 6. Risks

| Risk | Mitigation |
|---|---|
| `--regenerate` destroys human-curated content silently | Version history (SPEC-006) makes restoration `lore restore`-easy; document this prominently in `--help`. |
| `--refine` prompts can leak corpus content to remote AI providers (future HTTP provider) | Per SPEC-020 (HTTP AI provider) include explicit content-redaction config. Out of scope here. |
| `--infer` picks `relates-to` for everything (low-info default) | Telemetry tracks chosen-type distribution; if skewed, raise confidence threshold in v2. |
| Token budget for `--refine` on large docs | Truncate content to N chars (config: `ai.refine.max_input_chars`, default 8000), warn user when truncated. |

## 7. Out-standing Decisions (block implementation)

- Q1-Q6 above each need a final answer before this SPEC moves to `in-review`.
- Recommendations are owner's first instinct; do not treat as decided.
