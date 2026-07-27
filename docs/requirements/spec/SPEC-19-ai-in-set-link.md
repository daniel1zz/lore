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

## 7. Outstanding Decisions (block implementation)

~~Resolved — see §8 below.~~

## 8. Resolved Decisions (ratified 2026-07-02)

| Question | Ratified Answer |
|---|---|
| Q1 `--regenerate` vs `--refine` shape | **Two mutually-exclusive flags on `lore set`**: `--regenerate` (re-render type template) and `--refine "<prompt>"` (refine current content with user prompt). Passing both → exit 2. |
| Q2 `--refine` prompt source | **Inline + stdin**. `lore set <id> --refine "prompt"` OR `echo "prompt" \| lore set <id> --refine-stdin`. No editor. |
| Q3 `lore link --infer` confidence | **Trust the model unconditionally** in v1. No JSON `{type,confidence}` shape. Interactive `y/N` deferred. |
| Q4 Template extensibility | **`ai.templates.refine` config slot with hardcoded default** (in service). Symmetric with `ai.templates.<type>`. |
| Q5 Lifecycle side-effect | **AI-edited content demotes approved → draft** — same service-layer bypass as SPEC-022 AC-DASH-WRITE-5. Handled inside `CorpusService.update`, not `isValidTransition()`. |
| Q6 Telemetry granularity | **Unified `ai.generation` event with `kind: create \| regenerate \| refine \| infer` discriminator** and optional `target_doc_id` (null for `create`). Extends existing schema; SPEC-020's `usage` field remains orthogonal. |

## 9. Architecture Notes (implementation-ready)

### 9.1 File touch list

| File | Change |
|---|---|
| `packages/core/src/telemetry.ts` | Extend `aiGenerationEventSchema` with `kind: z.enum(["create","regenerate","refine","infer"]).default("create")` and `target_doc_id: z.string().nullable().optional()`. SPEC-017's existing events default to `kind: "create"` at emit time (backward compat). |
| `packages/core/src/ai.ts` (or wherever `AiConfigSchema` lives) | Add `ai.templates.refine?: string` and `ai.templates.link_inference?: string`. Both optional; service supplies defaults. |
| `packages/lore/src/service/ai-provider-service.ts` (or SPEC-017 service module) | New methods: `regenerateContent(doc, opts)`, `refineContent(doc, userPrompt, opts)`, `inferLinkType(from, to, opts)`. All return `Promise<Result<{content?: string, linkType?: LinkType}, LoreError>>` shape. Each emits an `ai.generation` event with the correct `kind` + `target_doc_id`. |
| `packages/lore/src/adapters/cli/commands/set.ts` | Add `--regenerate` / `--refine <prompt>` / `--refine-stdin` flags. Mutual exclusion: passing more than one → exit 2. Wire to `AIProviderService.regenerateContent` / `refineContent`. Route via `resolveAiDefault(--ai / --no-ai)` from SPEC-024. |
| `packages/lore/src/adapters/cli/commands/link.ts` | Add `--infer` flag. Wire to `AIProviderService.inferLinkType`. Validate returned type ∈ `linkTypeSchema` set; invalid → exit 6, no link created. |
| `packages/lore/src/ai/templates.ts` (or wherever SPEC-017 templates live) | Add default `refine` template (`{{current_content}}` + `{{user_prompt}}` interpolation) and `link_inference` template (`{{from_title}}`, `{{from_body_head}}`, `{{to_title}}`, `{{to_body_head}}` — bodies truncated to 500 chars per SPEC-019 §6). |
| `packages/core/src/text-normalise.ts` | (Already exists from SPEC-021.) No change needed — `canonicaliseBody` applied on write via CorpusService.set from SPEC-021 FU covers AI-edited content transparently. |
| `CLAUDE.md` (root) | Add SPEC-019 to Specs list. |
| **Tests** (dispatch tester) | Unit: template rendering, kind-discriminator on telemetry events, mutual-exclusion flag validation. Integration: `lore set <id> --regenerate` uses fake AIProvider fixture, verify demoted-to-draft transition. `lore link --infer` with fake provider returning valid/invalid types. Regression: existing SPEC-017 `lore create --ai` path unchanged (kind=create default). |

### 9.2 Refine prompt shape

```
Below is the current content of a document titled "{{title}}":

<content>
{{current_content}}
</content>

The user requests the following refinement:
{{user_prompt}}

Please output the revised full document content (markdown). Do NOT explain your changes; just emit the revised markdown.
```

### 9.3 Link inference prompt shape

```
Two documents in a knowledge corpus need a relationship classified.

DOC A: "{{from_title}}"
<body_head>
{{from_body_head}}
</body_head>

DOC B: "{{to_title}}"
<body_head>
{{to_body_head}}
</body_head>

Choose EXACTLY ONE relationship type from this list:
- parent
- implements
- informs
- supersedes
- relates-to
- blocks

Respond with only the single word — no explanation.
```

Response parsing: `trim() → lowercase → validate against linkTypeSchema`. Invalid → `AI_PROVIDER_ERROR`.

### 9.4 Refine truncation

`--refine` sends current_content up to `ai.refine.max_input_chars` (config, default 8000). If body longer, truncate and warn user. Prevent runaway prompt cost on huge docs.

### 9.5 Test layout

- Unit (vitest): template renderer with fake docs; kind-discriminator telemetry; mutual-exclusion flag validator.
- Integration (vitest subprocess): fake `AIProvider` implementation (in-memory) that returns canned responses; `lore set --regenerate` writes new content + demotes approved→draft; `lore link --infer` picks correct type from mock.
- Regression: `lore create --ai` still emits `kind: "create"` event; existing SPEC-017 tests unchanged.

### 9.6 Failure mode matrix

| Failure | Behaviour |
|---|---|
| `--regenerate` + `--refine` passed together | Exit 2 (usage error), no service call. |
| `--refine` without prompt (empty string) | Exit 2 (usage), reject. |
| `--refine-stdin` with EOF / empty stdin | Exit 2, reject. |
| AI provider returns empty content | Exit 6, no update, telemetry with `error: "empty output"`. |
| `--infer` returns non-linkType word | Exit 6, no link created, error names the invalid word. |
| `--infer` returns valid type but link would cycle | Exit 4 (validation), no link (CorpusService.link enforces). |

### 9.7 Out of §9 scope (still SPEC-019)

- MCP tools `lore_set_ai` / `lore_link_infer` — separate SPEC.
- Dashboard AI buttons — separate SPEC after both SPEC-019 and SPEC-022 mature.
- Confidence threshold on `--infer` — deferred.
- Streaming refine output — deferred.
- Per-doc-type refine templates (`ai.templates.refine_<type>`) — deferred.
