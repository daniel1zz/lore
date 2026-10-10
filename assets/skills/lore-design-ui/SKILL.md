---
name: lore-design-ui
description: "Use when designing UI/UX before implementation — visual direction, component specs, design tokens, responsive layouts, accessibility, and full product prototypes. Triggers on 'design the UI', 'UI/UX spec', 'design system', 'mockup', 'prototype the screens', '界面设计', 'UI 方案'. NOT for writing production component code (use frontend-design) and NOT for looking up style/color/font references (use ui-ux-pro-max)."
---

# Design UI — Skill (Level 0, self-executing)

Self-executing skill for the **pre-implementation UI/UX design stage**: produce a UI spec + a full, live HTML product prototype that downstream implementation turns into code.

Read `references/mode-ui.md` before starting — it holds all phase mechanics (benchmark decomposition, style differentiation rules, token extraction, prototype generation, review perspectives).

## Boundary with adjacent skills

| Skill | Stage | Relationship |
|-------|-------|--------------|
| **design-ui** (this) | Pre-implementation: visual direction → spec → HTML prototype | Produces the spec + prototype |
| `ui-ux-pro-max` | All-stage reference library (57 font pairings, color palettes, 99 UX rules, anti-patterns) | **Call it** during Token Crystallization to confirm fonts/colors/styles — never hand-roll a design DB |
| `frontend-design` | Implementation: production HTML/CSS/React/Vue code | **Downstream** — hand off the approved prototype + tokens to it |

For architecture / API / database / system / module design, use the separate `design` skill. This skill is UI/UX only.

## Pre-Design Steps

1. **Upstream check**: Search the lore corpus for PRD/requirements → extract screens, user flows, and constraints
   ```
   lore search "<topic>" --type spec --json / lore get <prd-slug> → look for spec (--kind design), PRD
   ```
2. **Existing design check**: `lore search "<topic>" --type spec --json` for an existing UI spec on the same topic → update or extend rather than restart
3. **Design system check**: Does `docs/design-system/ui-standards.md` exist? If yes, all new UI MUST comply with its tokens (see `references/mode-ui.md` → Mandatory Design Document Check). If no, it will be created during Token Crystallization
4. **Surface inventory + change-class determination (MANDATORY)**: Read `references/design-system-inheritance.md` — inventory existing surfaces the new design will touch (container / interaction pattern / state model / content slots), default to **minimal additive change**, and use `AskUserQuestion` BEFORE drawing any variant that is **destructive** (replaces layout primitive, swaps interaction pattern, adds new top-level mechanism, promotes/demotes surface roles)
5. **Benchmark study (MANDATORY)**: Identify top 2-3 benchmark products in the same domain/scenario from **≥2 different design lineages** → study their visual language, interaction flows, component patterns → borrow market-validated designs as baseline. REFUSE to design from memory alone

## ⛔ Cross-Cutting References (read for every UI-bearing design)

| Topic | File | Read when |
|---|---|---|
| **Design system inheritance + surface preservation** | `references/design-system-inheritance.md` | Pre-Design step 4. Token inventory + existing surface inventory + destructive-change gate. Prevents "tokens correct but layout re-imagined" drift. |
| **Prototype fidelity** | `references/prototype-fidelity.md` | When the design phase produces HTML prototypes → implementation MUST achieve pixel-level fidelity. Defines: line-range refs in tasks, verbatim copy of canonical components, 4 oracles per UI task (visual parity / token-drift / a11y / markup parity), prototype-parity-check terminal task. |

## Workflow

Follow `references/mode-ui.md` for the full methodology. The phase sequence is:

1. **Multi-Option Visual Comparison** → ≥3 visually distinct, benchmark-anchored HTML variants (parallel `ui-variant-builder` subagents)
2. **Token Crystallization** → extract tokens from the selected variant → persist as `docs/design-system/ui-standards.md` (SSOT for all future UI)
3. **Product Prototype Generation** → full product UI covering ALL major screens (parallel `ui-variant-builder` subagents, one per screen)
4. **Multi-Perspective UI Review** → parallel review (UX / accessibility / visual consistency)

Query `ui-ux-pro-max` for fonts/colors/UX rules during step 2. Use Sequential Thinking when ≥3 visual directions trade off against each other.

## Quality Gates (HARD BLOCK)

**REFUSE to finalize** UI design unless ALL pass. Report as a checklist in the design footer.

1. Design system check passed — REFUSE if `ui-standards.md` exists and the design ignores it
2. Live HTML preview generated and verified (not markdown-only)
3. Responsive verified at 375 / 768 / 1024 / 1440px via viewport switcher
4. Dark mode works via `html.dark` toggle
5. Contrast ratios WCAG AA (4.5:1 body, 3:1 large text)
6. Touch targets ≥ 44px
7. Product prototype covers ALL major screens from PRD (multi-screen products)
8. Cross-screen consistency verified (nav, tokens, typography, spacing)

## Cross-Cutting Concerns

Evaluate for every UI design. Skip only with explicit justification.

| Concern | Trigger | Action |
|---------|---------|--------|
| Accessibility | Always | WCAG AA: contrast, keyboard nav, focus order, screen-reader semantics, reduced-motion |
| Performance | Image-heavy, animation, large lists | Define a perf budget (LCP, bundle, image strategy); verify the design respects it |
| Empty/Loading/Error states | Any data-driven screen | Specify loading, empty, and error states — not just the happy path |
| Data Privacy (display) | PII shown on screen | Masking/redaction rules, consent surfaces, what is shown to whom |

## Exit Criteria (Definition of Done)

**Required**: Design system compliance check, Component specs, Responsive behavior, A11y checklist, State patterns (loading/empty/error), **Product prototype** (all major screens with shared nav)
**Optional**: Animation specs, dark mode mapping, interaction flow diagram

## HTML Preview

The preview server starts via HTTP (Vite) so ESM imports work reliably. The preview backend is the shared Vite project at `~/.claude/design`.

### Multi-Option Visual Comparison

UI designs MUST present ≥3 **visually distinct** options as live HTML, each **anchored to a real benchmark product** (e.g. Apple Health / Linear / Duolingo) from **≥2 different design lineages** (see `references/mode-ui.md` → Style Differentiation Rules). Name variants by benchmark product, not layout.

1. Write design markdown to `/tmp/design-preview.md`
2. Select ≥3 benchmark products from different lineages → fill the **benchmark decomposition table** (`references/mode-ui.md`) using screenshots/research — REFUSE to proceed on memory alone
3. Dispatch ≥3 **parallel `ui-variant-builder` subagents** (Sonnet) — one per variant, each receives its decomposition row + UI requirements + output path. Send ALL in a single message for parallel execution
4. After all subagents return, run with `--variant` for each option:
   ```bash
   python3 $HOME/.claude/skills/shared/scripts/preview.py /tmp/design-preview.md \
     --variant "Apple Health 风格:/tmp/option-a.html" \
     --variant "Linear 风格:/tmp/option-b.html" \
     --variant "Duolingo 风格:/tmp/option-c.html" \
     --title "<title>" --mode ui
   ```
5. Browser opens with a **tab bar** (switch options A/B/C…), a **preview area** (live UI in iframe with viewport controls 375/768/1024/1440px, dark mode, fullscreen), and the **design spec** below
6. User compares options visually, annotates feedback, selects preferred direction
7. Iterate on the selected option only (use `--ui-html` for single-file mode after selection):
   ```bash
   python3 $HOME/.claude/skills/shared/scripts/preview.py /tmp/design-preview.md \
     --ui-html /tmp/selected-option.html --title "<title>" --mode ui
   ```

### Token Crystallization (after variant selection)

After the user selects a variant, extract its concrete design tokens and persist as the project's design system:

1. **First UI design** (no `ui-standards.md`): Fill `~/.claude/skills/design-ui/templates/ui-standards-template.md` with tokens extracted from the selected variant HTML → write to `docs/design-system/ui-standards.md`
2. **Subsequent UI designs** (`ui-standards.md` exists): Verify the selected variant complies → add new tokens if needed → flag conflicts for user decision

This constrains all future UI work to the same visual language. The Mandatory Design Document Check (`references/mode-ui.md`) enforces compliance on every invocation. See `references/mode-ui.md` → Token Crystallization for the full extraction table. Confirm fonts/colors/styles against `ui-ux-pro-max` during extraction.

### Product Prototype Generation (after Token Crystallization)

Once style is confirmed and tokens crystallized, produce a full product prototype covering ALL major screens — not just the comparison page. See `references/mode-ui.md` → Product Prototype Generation.

1. Extract all screens from PRD/requirements → confirm scope with user
2. Extract the shared navigation component from the selected variant
3. Dispatch **parallel `ui-variant-builder` subagents** (Sonnet) — one per screen, each receives the crystallized tokens + screen-specific requirements + shared nav. ALL in a single message
4. Launch preview with screen tabs:
   ```bash
   python3 $HOME/.claude/skills/shared/scripts/preview.py /tmp/design-preview.md \
     --variant "Dashboard:/tmp/prototype-dashboard.html" \
     --variant "Detail:/tmp/prototype-detail.html" \
     --variant "Settings:/tmp/prototype-settings.html" \
     --title "<product> Prototype" --mode ui
   ```
5. Cross-screen consistency check (nav, tokens, typography, spacing, dark mode)
6. User reviews the full product experience → iterate or approve

**Skip conditions**: Single-page product or user says "just this page" → the selected variant IS the prototype.

### Annotation Workflow

The preview page has a built-in annotation tool (per-variant pins):

1. Click **"Annotate"** (top-right) or press **`A`** → click anywhere to place numbered pins with comments → **`Esc`** to exit
2. Click **"Export annotations.json"** to download

When the user says "check my annotations" or provides `annotations.json`:
1. Read the JSON — organized by variant: `{ variants: { "a": { label, pins }, "b": { label, pins } } }`
2. Process each variant's annotations separately
3. Screenshot via `npx playwright screenshot` to see pin positions
4. Update the relevant variant(s), regenerate preview → iterate

### Cleanup

The Vite dev server auto-replaces previous instances. To stop manually: `kill $(cat ~/.claude/design/.dev-server.pid)`

> Headless: add `--no-open`, provide the file path to the user.

## Governance — batched (the only flow)

⛔ Read `~/.claude/skills/shared/batched-governance.md` first. This skill has NO approval stop of its own:

- **S1** — the style pick (Multi-Option Visual Comparison) is the one S1 question that needs rendered variants: generate them, ask, then continue. Token Crystallization and Product Prototype Generation follow without another stop.
- **S2** — the full product prototype (all screens) is produced and persisted as draft design artifacts without asking.
- **S3 / S4** — this skill's Quality Gates are one lens of the single bundle review; the prototype preview and design summary (key decisions, trade-offs, screen list) go into the single S4 approval, where "adjust" names the screens to change.

## Downstream Handoff

| Consumer | Contract |
|----------|----------|
| `frontend-design` / `implement` | (1) Product prototype HTML files as pixel-level reference for each screen (2) Crystallized design tokens (`docs/design-system/ui-standards.md`) (3) Component specs (4) Responsive + a11y requirements |
| `test` | (1) Visual states to verify (loading/empty/error) (2) Responsive breakpoints (3) A11y checks (contrast, keyboard, focus) |

## Persist

- ⛔ **Prototype HTML persistence (HARD — NOT optional)**: after Stage-2 approval, ALL prototype screens + the selected variant MUST be copied into the project at `docs/design-system/prototype/<screen>.html` and committed. `/tmp` is volatile AND shared across sessions (collision-prone) — it is scratch space for preview only, never the artifact home. The design-spec MUST reference these project paths as the pixel-level implementation reference.
- ⛔ **/tmp collision safety**: all scratch paths MUST be project-prefixed (`/tmp/<project>-proto-*.html`, `/tmp/<project>-design-preview.md`) — bare `/tmp/option-a.html` / `/tmp/design-preview.md` collide with concurrent sessions.
- Create design output via `lore create spec --title ... --kind design --content ...`
- Link to upstream PRD via `lore link <spec> <prd> --type=implements`
- UI design decisions are logged in `decisions/` (see `decisions/` log — maintained by this skill to prevent style drift)
