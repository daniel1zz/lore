---
name: lore-design
description: "Use when making architecture decisions, defining APIs, designing data models, or planning module structure before implementation. NOT for visual UI/UX specs, design tokens or prototypes (use lore-design-ui). Args: '<mode> [context]' — the FIRST token is the mode, one of: api|architecture|database|module|system."
---

# Design — Skill (Level 0, self-executing)

Self-executing skill. Reads mode reference, runs all phases directly (including parallel agent dispatch described in mode files).
No named agent needed — all modes share the same tool requirements.

## Mode: $0

⛔ **Validate the mode BEFORE any file read.** `$0` must be EXACTLY one of: `architecture | api | database | system | module`. If `$0` is empty, a prose sentence, or any other word (a natural-language task string makes `$0` its first token, e.g. "Produce" → `mode-Produce.md` 404) → do NOT read `references/mode-$0.md` — use AskUserQuestion to pick a mode from the table below. When invoking this skill, pass the mode name as the FIRST token (e.g. `/lore-design module <context>`), never a prose sentence.

Only after validation passes: Read `references/mode-$0.md`.

| Mode | Reference | Focus |
|------|-----------|-------|
| `architecture` | `references/mode-architecture.md` | Layered, clean, DDD, C4 diagrams |
| `api` | `references/mode-api.md` | REST, GraphQL, gRPC patterns |
| `database` | `references/mode-database.md` | Schema, indexing, migrations |
| `system` | `references/mode-system.md` | Scalability, reliability, caching |
| `module` | `references/mode-module.md` | Decomposition, boundaries |

UI/UX design is NOT a mode of this skill — there is no `references/mode-ui.md`. For visual direction, component specs, design tokens, prototypes → use the dedicated `design-ui` skill. (The UI-specific gates/sections further down this file apply only when the design-ui flow delegates back here.)

## Pre-Design Steps (all modes)

1. **Upstream check**: Search the lore corpus for PRD/requirements -> extract as design constraints
   ```
   lore search "<topic>" --type spec --json / lore get <prd-slug> -> look for spec (--kind feature), PRD
   ```
2. **Existing design check**: `lore search "<topic>" --type spec --json` for an existing spec on same topic, then decide by its `Standing:` line in `lore get <spec>` (a spec is a record, locked once approved): not locked -> edit it in place; locked, no criterion has evidence -> `lore reopen <spec> --reason "..."` then edit; locked with evidence -> create a NEW spec and `lore link <new> <old> --type relates-to` (a genuine typo/factual fix: `lore set <spec> --correction "<reason>"`). Living docs (baseline, prd, reference/skill/prompt knowledge, open plans) are edited in place
3. **Benchmark study**: Identify top 1-3 benchmark products in the same domain/scenario -> study their design patterns, interaction flows, and feature implementations -> borrow proven designs as baseline. Never design from scratch when market-validated references exist.
4. **Analyze existing system**: Use Serena for codebase understanding before designing

## Workflow

- Follow mode-specific reference for design methodology (phases, parallel agent dispatch, scoring)
- >= 3 options or multi-dimension tradeoffs -> use Sequential Thinking (`mcp__sequential-thinking__sequentialthinking`)
- Query official docs (context7/deepwiki) before proposing any technology choice

## Quality Gates (HARD BLOCK — all modes)

**REFUSE to finalize** design output unless ALL required gates for the mode pass.
Report gate status as a checklist in the design document footer.

| Mode | Required Gates |
|------|---------------|
| `architecture` | (1) Every NFR has architectural response with measurable target (2) All tension points have decision + rationale (3) High-severity risks have mitigations (4) Migration phases defined with rollback |
| `api` | (1) Every endpoint has error responses documented (2) Auth matrix: every endpoint has auth requirement (3) All security issues resolved or accepted with rationale (4) Pagination + rate limiting specified |
| `database` | (1) All FKs indexed (2) Every table has access pattern justification (3) Zero-downtime migration strategy for every schema change (4) Data type rules followed (no float for money, tz on timestamps) |
| `system` | (1) SLA targets defined (throughput, p99 latency, availability %) (2) No unmitigated single points of failure (3) Every component has failure mode + degradation strategy (4) Capacity plan at 1x/10x/100x |
| `module` | (1) No circular dependencies (2) Every module has single clear responsibility (3) Public API sufficient for black-box testing (4) Dependencies injectable |
| `ui` | (1) Design doc check passed — REFUSE if missing (2) Live HTML preview generated and verified (not markdown-only) (3) Responsive verified at 375/768/1024/1440px via viewport switcher (4) Dark mode works via `html.dark` toggle (5) Contrast ratios WCAG AA (4.5:1 body, 3:1 large) (6) Touch targets >= 44px (7) Product prototype covers ALL major screens from PRD (multi-screen products only) (8) Cross-screen consistency verified (nav, tokens, typography, spacing) |

## Exit Criteria (Definition of Done)

| Mode | Required Sections | Optional |
|------|------------------|----------|
| `architecture` | Overview, C4 diagram, Components, Trade-off Decisions, Risk Registry, Migration Plan | ADR per decision, quality attribute utility tree |
| `api` | Endpoints (all with req/res/errors), Design Decisions, Auth matrix, Error format, Pagination | OpenAPI spec file, SDK examples |
| `database` | ER diagram, Schema (Prisma/DDL), Index plan, Migration strategy, Access patterns | Capacity estimates, partitioning strategy |
| `system` | Overview, Requirements table (SLA), Architecture diagram, Technology choices, Failure modes, Capacity plan | Cost analysis, runbook drafts |
| `module` | Module boundary (public/internal/deps), Structure (file tree), Public interface (TS types), Dependency graph, Design decisions | Perspective tension log |
| `ui` | Design system compliance check, Component specs, Responsive behavior, A11y checklist, State patterns (loading/empty/error), **Product prototype** (all major screens with shared nav) | Animation specs, dark mode mapping, interaction flow diagram |

## Cross-Cutting Concerns (apply to ALL modes)

Evaluate these for EVERY design. Skip only with explicit justification.

| Concern | Trigger | Action |
|---------|---------|--------|
| Security | Any user input, auth, data storage, external API | STRIDE-lite threat analysis on data flow -> document threats + mitigations |
| Performance | Latency-sensitive path, large data, real-time | Define performance budget (target latency, throughput) -> verify design meets it |
| Observability | Any new component or service | Define metrics, logs, traces -> specify what to instrument |
| Data Privacy | PII, user data, analytics | Classify data sensitivity -> encryption at rest/transit, retention policy, audit trail |

## Downstream Handoff Protocol

Design output MUST include these contracts for consuming skills:

| Consumer | Contract |
|----------|----------|
| `implement` | (1) All interfaces as TypeScript types (2) Dependency list with versions (3) File structure recommendation (4) Any non-obvious implementation notes (5) **UI mode**: Product prototype HTML files as pixel-level reference for each screen |
| `test` | (1) Invariants to verify (2) Error scenarios (3) Performance targets (4) Edge cases |
| `deploy` | (1) Infrastructure requirements (2) Environment variables (3) Migration ordering (4) Health check endpoints |

## HTML Preview (all modes)

After completing the design (post-synthesis, pre-approval), generate a browser preview. The preview server starts via HTTP so ESM imports work reliably.

### Doc modes (architecture, api, database, system, module)

1. Write design markdown to `/tmp/design-preview.md`
2. Run:
   ```bash
   python3 $HOME/.claude/skills/shared/scripts/preview.py /tmp/design-preview.md \
     --title "<title>" --mode "<mode>"
   ```
3. Browser opens with: rendered **Mermaid diagrams**, styled **tables**, syntax-highlighted **code**, auto **TOC** with scroll spy, mode-specific **accent color** (architecture=indigo, api=emerald, database=amber, system=blue, module=violet, ui=rose).

### UI mode — Multi-Option Visual Comparison

UI designs MUST present ≥3 **visually distinct** design options as live HTML. Each variant MUST be **anchored to a real benchmark product** (e.g., Apple Health / Linear / Duolingo) from **≥2 different design lineages** (see mode-ui.md Style Differentiation Rules). Name variants by benchmark product, not layout:

1. Write design markdown to `/tmp/design-preview.md`
2. Select ≥3 benchmark products from different design lineages → fill the **benchmark decomposition table** (mode-ui.md) using screenshots/research — REFUSE to proceed on memory alone
3. Dispatch ≥3 **parallel `ui-variant-builder` subagents** (Sonnet) — one per variant, each receives its decomposition row + UI requirements + output path. Send ALL in a single message for parallel execution
4. After all subagents return, run with `--variant` for each option:
   ```bash
   python3 $HOME/.claude/skills/shared/scripts/preview.py /tmp/design-preview.md \
     --variant "Apple Health 风格:/tmp/option-a.html" \
     --variant "Linear 风格:/tmp/option-b.html" \
     --variant "Duolingo 风格:/tmp/option-c.html" \
     --title "<title>" --mode ui
   ```
5. Browser opens with:
   - **Tab bar**: Switch between design options (A/B/C...)
   - **Preview area**: Live UI in iframe with viewport controls (375/768/1024/1440px), dark mode, fullscreen
   - **Below**: Design spec document
6. User compares options visually, annotates feedback, selects preferred direction
7. Iterate on selected option only (use `--ui-html` for single-file mode after selection)

For single-option iteration after user selection:
```bash
python3 $HOME/.claude/skills/shared/scripts/preview.py /tmp/design-preview.md \
  --ui-html /tmp/selected-option.html --title "<title>" --mode ui
```

### Token Crystallization (after variant selection)

After user selects a variant, extract its concrete design tokens and persist as the project's design system:

1. **First UI design** (no `ui-standards.md` exists): Fill `~/.claude/skills/lore-design-ui/templates/ui-standards-template.md` with tokens extracted from the selected variant HTML → write to `docs/design-system/ui-standards.md`
2. **Subsequent UI designs** (`ui-standards.md` exists): Verify selected variant complies with existing system → add new tokens if needed → flag conflicts for user decision

This ensures all future UI work is constrained by the same visual language — the Mandatory Design Document Check at workflow step 1 enforces compliance on every invocation. See mode-ui.md "Token Crystallization" for the full extraction table.

### Product Prototype Generation (after Token Crystallization)

Once style is confirmed and tokens crystallized, the skill MUST directly produce a full product prototype covering ALL major screens — not just the single comparison page. See mode-ui.md "Product Prototype Generation" for the full process.

1. Extract all screens from PRD/requirements → confirm scope with user
2. Extract shared navigation component from selected variant
3. Dispatch **parallel `ui-variant-builder` subagents** (Sonnet) — one per screen, each receives the crystallized design tokens + screen-specific requirements + shared nav. ALL in a single message for parallel execution
4. After all subagents return, launch preview with screen tabs:
   ```bash
   python3 $HOME/.claude/skills/shared/scripts/preview.py /tmp/design-preview.md \
     --variant "Dashboard:/tmp/prototype-dashboard.html" \
     --variant "Detail:/tmp/prototype-detail.html" \
     --variant "Settings:/tmp/prototype-settings.html" \
     --title "<product> Prototype" --mode ui
   ```
5. Cross-screen consistency check (nav, tokens, typography, spacing, dark mode)
6. User reviews full product experience → iterate or approve

**Skip conditions**: Single-page product or user says "just this page" → selected variant IS the prototype.

### Annotation Workflow

The preview page has a built-in annotation tool. Users can mark up the design directly:

1. Click **"Annotate"** button (top-right) or press **`A`** to enter annotation mode
2. **Click anywhere** on the page to place numbered pins with comments
3. Press **`Esc`** to exit annotation mode
4. Click **"Export annotations.json"** in the side panel to download

Annotations are **per-variant** — switching tabs automatically saves/restores each variant's pins. The panel title shows which variant's annotations are active.

When the user says "check my annotations" or provides `annotations.json`:
1. Read the JSON — it's organized by variant: `{ variants: { "a": { label, pins }, "b": { label, pins } } }`
2. Process each variant's annotations separately — address feedback for each design direction
3. Take screenshots via `npx playwright screenshot` to see pin positions visually
4. Update the relevant variant(s), regenerate preview
5. User re-annotates if needed → iterate

### Cleanup

The preview starts a Vite dev server (HMR-enabled). It auto-replaces previous instances. To stop manually: `kill $(cat ~/.claude/design/.dev-server.pid)`

> Headless: add `--no-open`, provide the file path to user.

## Governance — batched (the only flow)

⛔ Read `~/.claude/skills/shared/batched-governance.md` first. This skill runs inside its four stages; it has NO approval stop of its own:

- **S1** — the design's preference questions (trade-offs that turn on preference, not evidence) join the ONE decision interview. In UI mode the style pick (Multi-Option Visual Comparison) is the one S1 question that needs rendered variants: generate them, ask, then continue — Token Crystallization and the Product Prototype follow without another stop.
- **S2** — design EVERY slice of the initiative in this run, not only the next one; a slice that depends on an earlier slice's measurement carries a pre-registered branch instead of being deferred. Mode-internal parallel agent dispatch and scoring still run — they are design methodology, not review. ≥2-option choices are made by the AI and recorded with the rejected options.
- **S3 / S4** — the mode's Quality Gates above become one lens of the single bundle review; the HTML preview and design summary go into the single S4 approval. No `lore review` / `lore approve` / `AskUserQuestion` here.

## Living vs record

Enforced by the locked-record write refusal (exit 4):

- Living vs record: prd, baseline, reference/skill/prompt knowledge and open plans are living (edit in place); spec, adr, task and ideation/retro/research/assessment/handoff/uat knowledge are records, locked once settled. Read the `Standing:` line in `lore get <doc>` before changing a spec: not locked → edit it; locked, no criterion evidence → `lore reopen <spec> --reason` then edit; locked with evidence → new spec + `lore link <new> <old> --type relates-to`. A body/title change, `lore restore` or `lore ac add|set|rm` on a locked record is refused (exit 4); only a genuine small fix goes through `lore set --correction "<reason>"`, or for ONE criterion `lore ac set <spec> <AC> --correction "<reason>"` (`ac add|rm` have no correction exit).

## Persist

- Persist as DRAFT during S2 — never wait for approval to write: `lore create spec --title ... --kind design --content ...` (run `lore feed spec-create` first) or `lore create adr --title ... --decision-status proposed --content ...` for decision records; declare every AC (`lore ac add`) before S3, and cite the baseline rules each AC implements (`lore ac add ... --cite BR-<n>` or `lore ac cite <spec> <AC> BR-<n>`) — a spec takes no parent and cannot be approved without a citing criterion (BR-1007)
- Link to upstream PRD and related ADRs via `lore link <from> <to> --type=relates-to|implements|informs`; a slice spec ALSO links to the spec it slices (`lore link <slice-spec> <parent-spec> --type=implements`) — that link is the only record of the relation, since a spec has no parent
