# Design Mode: UI/UX

**Purpose**: UI/UX design for components, interactions, and user experience
→ See [ui-design.md](ui-design.md) for technical reference
→ See [ui-style-guide.md](ui-style-guide.md) for business scenario style decisions
→ Uses `ui-ux-pro-max` plugin for design system generation

```yaml
defaults:
  write_mode: auto
  stack: html-tailwind
  icon_policy: svg_only  # svg_only | emoji_allowed | hybrid
  neutral_family: zinc
  prefer_css_variable_tokens: true
  density: comfortable  # comfortable | compact
  z_index: { dropdown: 50, sticky: 60, overlay: 70, modal: 80, popover: 90, toast: 100 }
  avoid_transition_all: true
  a11y: { body_text_contrast: 4.5:1, large_text_contrast: 3:1, touch_target: 44px }
```

## Mandatory Design Document Check

**REFUSE EXECUTION if violated.** Before ANY UI work:

```yaml
check_paths:
  primary: ["docs/design-system/ui-standards.md", "docs/design-system/**"]
  fallback: [".claude/design-system.md", "DESIGN_SYSTEM.md", "**/design-tokens.*", "**/theme.config.*", "**/tailwind.config.*"]

behavior:
  if_exists: "MUST READ and comply with existing standards"
  if_not_exists_with_ui_code: "BLOCK → Generate design system first via this skill"
  if_not_exists_new_project: "Generate design system FIRST via this skill"

override:
  user_says_redesign: "User explicitly says 'redesign' / '重新设计' / 'start fresh' / 'ignore existing' → skip compliance check, proceed with fresh Multi-Option Visual Comparison, and replace ui-standards.md at Token Crystallization step"
```

## Workflow

1. **Design doc check** (REFUSE if skipped)
2. **Benchmark study**: Identify top 1-3 benchmark products in the same domain → study their UI patterns, interaction flows, layout, and micro-interactions → use as design baseline. Never design from scratch.
3. **Analyze requirements**: product_type, industry, style_keywords, stack, target_users
4. **Style decision**: Industry profile → Brand personality → Demographics → Tone calibration (3 scales)
5. **Generate design system** (if needed): `python3 .../search.py "<keywords>" --design-system`
6. **Design components**: Apply tokens, magicuidesign for examples, a11y checklist, responsive breakpoints
7. **⛔ Multi-Option Visual Comparison** (HARD — see below)
8. **⛔ Token Crystallization** (HARD — see below): Extract tokens from selected variant → create/update project design system
9. **⛔ Product Prototype Generation** (HARD — see below): Apply confirmed style to ALL major screens → produce navigable multi-page prototype
10. **Responsive viewport verification**: Test ALL prototype screens at ALL 4 breakpoints (375/768/1024/1440px) — REFUSE to proceed if any screen at any breakpoint is broken
11. **Multi-Perspective UI Review** (see below): Review the FULL prototype, not just individual screens
12. **Persist decisions** (MANDATORY): `lore create spec --title ... --parent <prd> --kind design --content ...` or update existing (`lore set <spec> ...`)

## Phase: Multi-Option Visual Comparison (HARD)

⛔ **REFUSE to finalize any layout/component design** without presenting ≥3 live HTML options to the user.

For every **non-trivial UI decision**, generate ≥3 complete HTML files and preview them side-by-side via variant tabs:

1. **Main agent**: Use Sequential Thinking to select ≥3 benchmark products from different lineages and fill the decomposition table (see Style Differentiation Rules below)
2. **Main agent**: Dispatch ≥3 **parallel `ui-variant-builder` subagents** — one per variant, each receiving its decomposition row and UI requirements. Send ALL in a single message for true parallel execution:
   ```
   Agent(subagent_type="ui-variant-builder", model="sonnet", prompt="
     Benchmark: Apple Health | Lineage: Apple Ecosystem
     Decomposition: {color: ..., typography: ..., shape: ..., density: ..., signature: ..., hover: ...}
     UI requirements: {page content, data structure, features}
     Output path: /tmp/option-a.html
     Design system constraints: {if any}
   ")
   // + Agent for variant B (Linear) + Agent for variant C (Duolingo) — all in same message
   ```
3. **Main agent**: After all subagents return, launch preview with variant tabs:
   ```bash
   python3 $HOME/.claude/skills/lore-design/scripts/preview.py design.md \
     --variant "Apple Health 风格:/tmp/option-a.html" \
     --variant "Linear 风格:/tmp/option-b.html" \
     --variant "Duolingo 风格:/tmp/option-c.html" \
     --title "Stats Layout Comparison" --mode ui
   ```
4. User switches tabs to visually compare, can annotate each option
5. Ask user which option to proceed with:
   ```
   AskUserQuestion: "Which design direction do you prefer?"
   Options: Option A / Option B / Option C / Combine elements
   ```
6. Iterate on the selected option; discard the rest

### Style Differentiation Rules (HARD — Benchmark Product Driven)

⛔ Variants that only differ in layout but share the same visual style are **NOT** distinct options — they are layout tweaks of ONE option.

**Every variant MUST be anchored to a real benchmark product** — a shipped product whose design language you are borrowing wholesale. The benchmark carries all visual dimensions at once (color, type, spacing, interaction, density). This replaces abstract dimension tweaking.

#### Step 1: Product Positioning → Lineage Filtering → Benchmark Selection

⛔ **NEVER pick benchmarks purely for visual diversity.** Every benchmark MUST be a product that the target user would actually use or find natural. A parenting app should NEVER get a "Linear style" variant — Linear's audience is developers, not parents.

**1a. Product Positioning Analysis** (fill first):

```
| Dimension       | Value                                                    |
|-----------------|----------------------------------------------------------|
| Product type    | ___ (consumer app / B2B SaaS / content platform / ...)   |
| Target users    | ___ (age, tech literacy, context of use, emotional state) |
| Core emotion    | ___ (trust / delight / calm / urgency / empowerment)     |
| Usage context   | ___ (on-the-go mobile / focused desktop / lean-back)     |
| Content type    | ___ (data-heavy / media-rich / text / mixed)             |
```

**1b. Filter Compatible Lineages** — only lineages whose audience profile and emotional tone match the product positioning:

| Design Lineage | Audience Profile | Core Emotion | Compatible When |
|----------------|-----------------|--------------|-----------------|
| **Apple Ecosystem** | Premium consumer, health/wellness, creative | Calm, premium, trusted | Consumer apps valuing polish + simplicity |
| **Precision Tool** | Developers, power users, knowledge workers | Efficiency, speed, control | B2B tools, dev tools, productivity for tech-savvy users |
| **Warm Consumer** | General public, families, students, casual users | Delight, encouragement, belonging | Social, education, wellness, family, entertainment |
| **Data Dense / Enterprise** | Analysts, admins, ops teams | Mastery, oversight, confidence | Dashboards, admin panels, monitoring, internal tools |
| **Editorial / Content** | Readers, creators, researchers | Inspiration, focus, discovery | Blogs, docs, news, portfolios, knowledge bases |
| **Bold / Expressive** | Creators, youth, early adopters | Excitement, identity, wow | Marketing sites, creative tools, social/community |
| **Fintech / Trust** | Finance-aware consumers, business users | Security, trust, clarity | Payments, banking, investment, insurance |
| **Asian Super-App** | Mass-market mobile users, convenience-driven | Convenience, speed, everything-in-one | Super-apps, mini-programs, O2O platforms |

Example filtering:
- **育儿 App** → target: parents (non-technical, emotional, on-the-go) → ✅ Warm Consumer, ✅ Apple Ecosystem, ✅ Editorial → ❌ Precision Tool, ❌ Data Dense, ❌ Bold/Expressive, ❌ Fintech
- **开发者 CLI Dashboard** → target: developers (technical, efficiency-driven) → ✅ Precision Tool, ✅ Data Dense, ✅ Apple Ecosystem → ❌ Warm Consumer, ❌ Editorial
- **医疗健康平台** → target: patients + doctors (mixed literacy, trust critical) → ✅ Apple Ecosystem, ✅ Warm Consumer, ✅ Fintech (trust cues) → ❌ Bold/Expressive, ❌ Precision Tool

⛔ **Rule**: ONLY select benchmarks from compatible lineages. Visual diversity is a constraint WITHIN the compatible set, not across all lineages.

**1c. Select ≥3 Benchmark Products** from the filtered compatible lineages:

- MUST come from **≥2 different compatible lineages** (for visual diversity)
- MUST be products whose **target audience overlaps** with the user's product
- PREFER products in the **same or adjacent domain** (a parenting app → other parenting/family/wellness/health apps first, then broaden to compatible lineages)
- Use `WebSearch "<domain> best app UI design"` to discover domain-specific benchmarks beyond the examples below

| Design Lineage | Example Products |
|----------------|-----------------|
| **Apple Ecosystem** | Apple Health, Apple Fitness+, Apple Music, Apple Notes, iCloud.com |
| **Precision Tool** | Linear, Raycast, Arc, Warp, Superhuman, Figma |
| **Warm Consumer** | Duolingo, Headspace, Notion, Spotify, Airbnb, Calm, BabyCenter, Hatch |
| **Data Dense / Enterprise** | Grafana, Datadog, Salesforce Lightning, Retool, Metabase |
| **Editorial / Content** | Medium, Stripe Docs, Linear Changelog, Apple Newsroom, Substack |
| **Bold / Expressive** | Vercel, Framer, Lottie, Pitch, Discord |
| **Fintech / Trust** | Mercury, Revolut, Stripe Dashboard, Wise, Robinhood |
| **Asian Super-App** | WeChat, Alipay, Meituan, Grab, LINE |

**If the user's domain doesn't fit any lineage above**: Use `WebSearch "<domain> best app UI"` to discover benchmark products, then classify them into lineages by their visual signature. The 8 lineages are archetypes, not an exhaustive list.

#### Step 2: Benchmark Decomposition (fill BEFORE writing HTML)

For each benchmark, extract its concrete visual DNA using research tools. DO NOT rely on memory — use `agent-browser` screenshot, `gitmcp`/`deepwiki` for open-source products, or `WebSearch` for design teardowns:

```
| Trait              | Variant A: [Product]   | Variant B: [Product]   | Variant C: [Product]   |
|--------------------|------------------------|------------------------|------------------------|
| Benchmark product  | e.g. Apple Health      | e.g. Linear            | e.g. Duolingo          |
| Color system       | ___                    | ___                    | ___                    |
| Typography         | ___                    | ___                    | ___                    |
| Shape language     | ___                    | ___                    | ___                    |
| Spacing & density  | ___                    | ___                    | ___                    |
| Signature element  | ___                    | ___                    | ___                    |
| Hover & transition | ___                    | ___                    | ___                    |
```

**"Signature element"** = the ONE visual element that makes this product instantly recognizable and can be adapted to the user's domain (Apple Health's ring charts, Linear's minimal status badges, Duolingo's streak flame card).

**"Hover & transition"** = CSS-implementable interaction style (Apple: subtle scale + shadow lift; Linear: instant background swap, no bounce; Duolingo: playful bounce + color pop).

#### Step 3: Adapt, Don't Clone

Each variant borrows the benchmark's **design language** but applies it to the user's actual content and domain:
- ✅ "This dashboard uses Apple Health's ring-chart visual language and SF-style whitespace"
- ❌ "This is a copy of Apple Health"

The benchmark is the **style anchor**, not the feature set.

#### Research Protocol for Benchmarks

**Layer 1 — Benchmark product visual DNA extraction** (MUST for each variant):

| Source | Tool | When |
|--------|------|------|
| Live product screenshots | `agent-browser` → navigate + screenshot | Best for current visual state — captures exact colors, spacing, typography |
| Design teardowns & case studies | `WebSearch "X app design teardown"` or `WebSearch "X app UI analysis"` | Paid products without public repos |
| Open-source design systems | `gitmcp` / `context7` | Radix, shadcn, Ant Design, Carbon, Chakra — extract actual token values |
| Component examples | `magicuidesign` (searchRegistryItems) | Specific UI patterns from benchmark |

**Layer 2 — Token generation shortcuts** (use to accelerate variant HTML production):

| Resource | Path / Command | What it gives |
|----------|---------------|---------------|
| **ui-ux-pro-max styles DB** | `python3 $HOME/.claude/plugins/marketplaces/ui-ux-pro-max-skill/.codex/skills/ui-ux-pro-max/scripts/search.py "<style_keyword>" --design-system` | Complete design token set (palette, type, radius, shadow, spacing) from 58 named styles |
| **ui-ux-pro-max colors DB** | Search `color` domain — 96 product-type palettes with hex codes | Context-specific palette (fintech, healthcare, gaming, etc.) |
| **ui-ux-pro-max typography DB** | Search `typography` domain — 57 font pairings with Google Fonts URLs | Ready-to-use `@import` + Tailwind font config |
| **DaisyUI themes** | `<link href="https://cdn.jsdelivr.net/npm/daisyui@4/dist/full.min.css" rel="stylesheet">` + `data-theme="synthwave"` | 32 complete themes — swap `data-theme` attribute for instant visual switch |
| **Open Props** | `<link rel="stylesheet" href="https://unpkg.com/open-props">` | 18 color families × 13 shades, 30 gradients, 6 shadow levels as CSS custom properties |
| **Style Tiles methodology** | Define fonts/colors/textures per variant FIRST (as a "tile"), then build layout on top | Forces style-first thinking — prevents layout-only differentiation |

⛔ **Workflow**: Layer 1 (research) → fill decomposition table → Layer 2 (token shortcuts) → generate HTML. Never skip Layer 1 — token libraries are for acceleration, not a substitute for understanding the benchmark's design DNA.

⛔ **Self-check**: If you cover the browser tab labels and cannot immediately tell which variant you're looking at — the benchmarks are too similar. Pick from different lineages.

### Variant Naming Convention

Name variants by their **benchmark product**, not by layout or abstract style:
- ✅ "Apple Health 风格" / "Linear 风格" / "Duolingo 风格"
- ⚠️ OK but weaker: "Minimal Corporate" / "Warm Friendly" / "Bold Futuristic"
- ❌ "Card Grid" / "List View" / "Two Column"

**What counts as "non-trivial" (MUST present ≥3 options):**
- Layout structure (2-column vs 3-column vs stacked)
- Component hierarchy (dashboard-first vs card-list-first)
- Visual emphasis (hero number vs distributed cards vs chart-first)
- Interaction model (expandable vs tabbed vs inline)
- Navigation pattern (bottom tab vs sidebar vs hamburger)

**What is trivial (skip options):**
- Token compliance (use design system values)
- Accessibility requirements (WCAG AA is non-negotiable)
- Platform constraints (forced by ADR)

> | AI rationalization | Reality |
> |---|---|
> | "Layout C is clearly the best" | "Clearly best" to the AI ≠ preferred by the user. Live comparison in browser prevents a redesign. |
> | "The benchmark already shows the answer" | Benchmark is a starting point. User's product has different constraints. |
> | "One option with adjust/redesign escape" | A single option is not a choice — users anchor to what they see. ≥3 genuine live alternatives required. |
> | "The variants look different enough" | Same lineage = same vibe. Fill the decomposition table. If benchmarks are from the same lineage, redo. |
> | "Three variants is too much work" | Token budget is not a valid objection. Three HTML files take <2 min each. Users deserve real choice. |
> | "I know what Apple Health looks like" | Training data ≠ current product. Screenshot it or search a teardown. Evidence over memory. |

## Phase: Token Crystallization (HARD — Design System as SSOT)

⛔ After user selects a variant, the selected design's tokens MUST be extracted and persisted as the project's authoritative design system. This ensures all subsequent UI work is constrained by the same visual language.

### When to crystallize

| Scenario | Action |
|----------|--------|
| **No `ui-standards.md` exists** (first UI design) | Create from template: `~/.claude/skills/lore-design/templates/ui-standards-template.md` → fill ALL `{PLACEHOLDER}` values with selected variant's tokens → write to `docs/design-system/ui-standards.md` |
| **`ui-standards.md` exists** (subsequent UI design) | Read existing system → verify selected variant complies → if new tokens are introduced (e.g., a new accent color), update the document with additions |
| **Selected variant conflicts with existing system** | STOP — present the conflict to user: "The selected variant uses X, but your existing design system specifies Y. Update the design system, or redesign the variant to comply?" |
| **User says "redesign" / "重新设计" / override** | User explicitly overrides the existing design system. Proceed with the new variant's tokens, replace `ui-standards.md` entirely, and note the override in the changelog section |

### Token extraction process

From the selected variant's HTML file, extract concrete values for:

```
| Token Category      | Extract From                                   | Write To (ui-standards.md)      |
|---------------------|------------------------------------------------|---------------------------------|
| Primary color       | Most-used accent/brand color in CSS             | §1.1 Colors → primary scale     |
| Neutral family      | Gray/slate/zinc scale used                      | §1.1 Colors → neutral scale     |
| Surface hierarchy   | Background → card → elevated bg colors          | §1.1 Colors → surfaces          |
| Font families       | Google Fonts @import or font-family declarations | §1.2 Typography → fontFamily    |
| Font scale          | Heading/body/caption sizes used                 | §1.2 Typography → fontSize      |
| Spacing rhythm      | Most common padding/gap/margin values           | §1.3 Spacing                    |
| Border radius       | Predominant radius values (cards, buttons, inputs)| §1.5 Border Radius             |
| Shadow system       | Box-shadow values used                          | §1.6 Shadows                    |
| Transition style    | Hover/transition durations and easing            | §5 Animation & Transitions      |
| Dark mode mapping   | `html.dark` / `.dark` color overrides           | §7 Dark Mode                    |
```

### Downstream enforcement

Once `ui-standards.md` exists, the **Mandatory Design Document Check** (top of this file) guarantees:
- Every future `design:ui` invocation MUST read and comply with it
- New components inherit the selected variant's visual language automatically
- Deviations trigger a conflict prompt, not silent drift

### What gets persisted WHERE

| Artifact | Format | Location | Purpose |
|----------|--------|----------|---------|
| **Design system tokens** | Filled `ui-standards.md` | `docs/design-system/ui-standards.md` | Cross-session SSOT for all UI work |
| **Design spec** (this page's design) | lore spec (`--kind design`) | `lore create spec` | Records what was designed and why |
| **Selected variant HTML** | Self-contained HTML | Project assets (referenced from the spec) | Reference implementation |
| **Benchmark decomposition** | Markdown table | Inside design-spec | Records which products were referenced |
| **Product prototype** (all screens) | Self-contained HTML per screen | `/tmp/prototype-*.html` + project assets | Full product UI/UX prototype |

## Phase: Product Prototype Generation (HARD — Full Product UI/UX)

⛔ After Token Crystallization, the confirmed design tokens and visual language MUST be applied to ALL major screens to produce a navigable product prototype. Do NOT stop at a single component/page preview.

### Skip conditions

| Condition | Action |
|-----------|--------|
| Single-page product (landing page, single dashboard) | Selected variant IS the prototype — skip to review |
| User explicitly says "just this page" / "只做这个页面" | Skip prototype, proceed to review |
| PRD/requirements specify multiple screens | MUST build all screens |

### Prototype generation process

1. **Screen inventory**: Extract all screens/pages from upstream PRD/feature-spec. If no PRD exists, ask user to enumerate key screens:
   ```
   | # | Screen         | Purpose           | Key content                | Priority |
   |---|----------------|-------------------|----------------------------|----------|
   | 1 | Dashboard      | Main landing      | KPIs, recent activity      | P0       |
   | 2 | Detail view    | Item deep dive    | Charts, metadata, actions  | P0       |
   | 3 | Settings       | User preferences  | Form fields, toggles       | P1       |
   | 4 | Onboarding     | First-run flow    | Stepper, illustration      | P1       |
   ```

2. **Confirm scope**: Present screen inventory → `AskUserQuestion`: "以下页面将纳入产品原型，确认或调整？" — options: "确认" / "增减页面" / "只做 P0"

3. **Extract shared navigation**: From the selected variant, extract or define the shared navigation component (header/sidebar/bottom nav/tab bar). This component MUST be identical across all prototype screens. Write as a reusable HTML snippet for subagents.

4. **Dispatch parallel subagents**: For each confirmed screen, dispatch a `ui-variant-builder` subagent (Sonnet). ALL dispatches in a single message for true parallel execution. Each receives:
   ```
   Agent(subagent_type="ui-variant-builder", model="sonnet", prompt="
     ## Prototype Screen Build
     **Mode**: prototype-screen (NOT style comparison — style is already locked)
     **Screen**: {screen_name} — {purpose}
     **Output path**: /tmp/prototype-{screen-slug}.html

     ## Confirmed Design Language
     **Benchmark**: {selected_benchmark_product}
     **Design tokens**: {paste relevant sections from ui-standards.md}
     **Selected variant reference**: {path to the selected variant HTML from step 7}

     ## Shared Navigation
     {shared nav HTML snippet — MUST include exactly as-is}
     **Active screen**: {this screen's nav item should have active state}

     ## Screen Requirements
     **Content**: {what this screen shows — data structure, features, interactions}
     **User flow**: {how users arrive at this screen, what they do here, where they go next}
     **Related screens**: {screens this one links to — use # hrefs for prototype}

     ## Rules
     - MUST use the exact design tokens from ui-standards.md — do NOT introduce new colors/fonts
     - MUST include the shared navigation component at the same position
     - MUST highlight this screen as active in navigation
     - All inter-screen links use '#' href (prototype navigation)
     - Realistic content — NEVER lorem ipsum
     - Include loading/empty/error state for at least one data component
   ")
   ```

5. **Assemble prototype preview**: After all subagents return, launch preview with screen tabs:
   ```bash
   python3 $HOME/.claude/skills/lore-design/scripts/preview.py /tmp/design-preview.md \
     --variant "Dashboard:/tmp/prototype-dashboard.html" \
     --variant "Detail:/tmp/prototype-detail.html" \
     --variant "Settings:/tmp/prototype-settings.html" \
     --title "<product> Product Prototype" --mode ui
   ```

6. **Cross-screen consistency check** (HARD BLOCK — fix before proceeding):
   - [ ] Navigation component identical across all screens (position, content, styling)
   - [ ] Active screen highlighted correctly in each screen's nav
   - [ ] Color tokens consistent — no screen uses off-palette colors
   - [ ] Typography scale consistent across screens
   - [ ] Spacing rhythm consistent (padding, gaps, margins)
   - [ ] Dark mode works on ALL screens simultaneously
   - [ ] Shared components (buttons, cards, inputs) look identical across screens

### What makes this different from Multi-Option Visual Comparison

| Multi-Option Visual Comparison (step 7) | Product Prototype Generation (step 9) |
|------------------------------------------|---------------------------------------|
| ≥3 variants of the SAME screen | ALL screens in ONE confirmed style |
| Purpose: explore visual direction | Purpose: validate full product UI/UX |
| User picks a style | User reviews the complete experience |
| Output: selected variant + tokens | Output: navigable multi-screen prototype |

> | AI rationalization | Reality |
> |---|---|
> | "The single variant preview is enough" | One screen ≠ a product. Navigation, consistency, and flow issues only surface across screens. |
> | "Building all screens is too much work" | Token budget is not a valid objection. Parallel subagents build N screens in the same wall-clock time as 1. |
> | "The user can imagine the other screens" | Users can't imagine a product from a single page. Show, don't describe. |
> | "Screens are just variants of the same layout" | Each screen has different content, data density, and interaction patterns. They need individual attention. |

## Phase: Multi-Perspective UI Review

After generating the full product prototype, launch **4 parallel subagents** to review from competing UX concerns.
Use `Agent` tool — send ALL 4 in a single message for true parallel execution.
Use `Agent` tool — send ALL 4 in a single message for true parallel execution.

### Perspective Matrix

| # | Perspective | Identity Prompt | Review Focus |
|---|------------|----------------|-------------|
| 1 | **UX Researcher** | "You evaluate designs from the user's perspective — task completion, cognitive load, discoverability." | User flow completeness? Information hierarchy clear? Progressive disclosure where needed? Cognitive load manageable? Error recovery intuitive? Onboarding friction? |
| 2 | **Accessibility Specialist** | "You audit designs for WCAG AA compliance and inclusive design." | Color contrast ratios? Keyboard navigation flow? Screen reader experience? Focus management? Touch targets? Reduced motion support? Semantic HTML structure? |
| 3 | **Performance Engineer** | "You evaluate UI performance impact — bundle size, render cost, perceived speed." | Image optimization? Component lazy loading? Animation GPU-accelerated? Bundle impact of component library? Skeleton/placeholder strategy? Critical rendering path? |
| 4 | **Brand Consistency Reviewer** | "You ensure the design aligns with the established design system and brand identity." | Token compliance (colors, spacing, typography)? Component pattern consistency? Tone/voice alignment? Icon system consistency? Dark/light mode parity? Cross-page consistency? |

### Subagent Prompt Template

Each subagent receives:

```
## UI Review Perspective
{Identity Prompt}

## Design Under Review
**Product**: {product type, industry}
**Design System**: {link or summary of established tokens}
**Components**: {component specs being reviewed}
**User Flow**: {key user journey}
**Target Users**: {demographics, accessibility needs}

## Your Task
Review this UI design from your perspective.

Provide:
1. **Assessment** (3-5 points): What's good/bad from your lens?
2. **Issues** (2-3): Specific problems, citing components/screens
3. **Recommendations** (2-3): Concrete changes
4. **Quality Score**: 1-10 from your perspective

200 words max. Be specific about components, not abstract.
```

### Synthesis
After all 4 agents return:
1. **A11y blockers** — any accessibility issue = must fix
2. **Cross-perspective issues** — flagged by 2+ perspectives (must fix)
3. **Brand drift** — any token non-compliance = must fix
4. **Performance optimizations** — apply if low cost

## Live Preview Rules (HARD BLOCK)

UI mode MUST produce a **self-contained, renderable HTML file** — not just a markdown spec. This file is previewed live in the browser via `preview.py --ui-html`.

| Rule | Requirement |
|------|------------|
| **Self-contained** | HTML file MUST include all styles inline (Tailwind CDN or `<style>`) — no external CSS files, no build step |
| **Realistic content** | Use realistic placeholder data (names, numbers, dates) — NEVER "Lorem ipsum" or "placeholder text" |
| **Responsive** | MUST render correctly at 375px, 768px, 1024px, 1440px — verify via viewport switcher before proceeding |
| **Dark mode** | MUST support `html.dark` class toggle — the preview Dark button adds this class to the iframe |
| **Semantic HTML** | Use `<nav>`, `<main>`, `<section>`, `<header>`, `<footer>` — not div soup |
| **Interactive states** | Show hover, focus, active states where applicable (CSS `:hover`, `:focus-visible`) |
| **Loading/Empty/Error** | Include at least one component variant showing loading skeleton, empty state, or error state |

### Preview Chrome Sizing (HARD — verify before declaring preview ready)

The preview iframe IS the design. If the iframe is rendered in a small box (e.g. 300px tall) the comparison is meaningless — half the variant's content sits below the fold and the user only sees a header strip. **Verify before reporting "preview ready":**

| Check | Threshold | Failure mode |
|---|---|---|
| Preview iframe rendered height | ≥ 80% of viewport height (≥ `calc(100vh - 200px)`) | iframe collapses to its `min-height` because the panel chain doesn't propagate height — fix preview infra, not the variant |
| Preview iframe rendered width | matches the active viewport pill (375/768/1024/1440) | width controls don't apply — JS or CSS missing |
| Scroll behavior | iframe content scrolls INSIDE the iframe, not the page | iframe lacks `height: 100%` or parent is missing `flex:1; min-height:0` |

**Root cause when the iframe is small**: `~/.claude/design/src/preview.css` — `.preview-panel` (when UI mode active) MUST be `display: flex; flex-direction: column; height: calc(100vh - var(--header-h))`; `.preview-viewport` MUST be `flex: 1; min-height: 0; align-items: stretch`; iframe MUST be `height: 100%; min-height: 0`. A hard-coded `min-height: 300px` on the iframe is a smell — remove it.

**Do NOT** work around a too-small preview by zooming the variant HTML down. The user is judging visual hierarchy at the actual rendered size — distortion at the chrome level invalidates the comparison.

### Responsive Verification Checklist

Before advancing to Multi-Perspective Review, cycle through ALL breakpoints in the preview and verify:

```
375px  (Mobile)  → [ ] Single column layout, hamburger menu, touch-friendly targets
768px  (Tablet)  → [ ] Appropriate grid collapse, readable without horizontal scroll
1024px (Desktop) → [ ] Full layout rendered, sidebar/main split working
1440px (Wide)    → [ ] Content constrained (max-width), no stretched elements
```

REFUSE to proceed if any breakpoint shows: overflow, overlapping elements, unreadable text, broken grid, or touch targets < 44px.

## Enforcement Rules

1. MUST run design doc check FIRST
2. All new designs MUST align with existing standards
3. MUST persist new decisions to docs/design-system/
4. BLOCK if UI code exists but no design docs
5. MUST generate live HTML preview file — markdown-only UI specs are REJECTED
6. MUST pass responsive verification at all 4 breakpoints before review phase
7. MUST support dark mode via `html.dark` class

## Tools

| Tool | Purpose |
|------|---------|
| ui-ux-pro-max | Design system generation |
| magicuidesign | Component examples (getUIComponents, getButtons, etc.) |
| context7 | UI framework component APIs (shadcn/ui, Ant Design, etc.) |
| mcp-deepwiki | UI framework architecture understanding |
| gitmcp | Official repo examples and source code |
| agent-browser | Visual verification (screenshot, snapshot -i) |
