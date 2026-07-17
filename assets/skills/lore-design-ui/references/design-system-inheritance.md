# UI / Design Context

> Layer 2 cross-skill rule. Any task that produces UI mockups, prototypes, or visual specs MUST first inventory BOTH (a) the project's existing design system (tokens, components) AND (b) the project's existing surface architecture (layouts, interaction patterns) — and MUST default to minimal additive change.

## Failure mode this prevents

Drawing a generic dark-mode (or any off-brand) mockup in `visual-companion` for a project that has an established design system (e.g. Kickresume-anchored teal tokens). User reaction: "this assistant doesn't know my project." Damage: rebuild trust, redo all mockups, design doc divergence from existing prototypes.

Observed instance: `gankjob` project has `docs/design-system/ui-standards.md` + 10 approved prototype HTMLs + `app/globals.css` @theme tokens. Brainstorming drew 3 dark-mode mockups in `.superpowers/brainstorm/.../content/` before any token inventory. User caught it; rule introduced.

## Inventory checklist (MUST run before first mockup)

⛔ Before writing the first `.html` to `screen_dir` (visual companion) OR proposing any visual spec, run:

```bash
ls docs/design-system/ 2>/dev/null                                  # design tokens dir
find . -maxdepth 3 -name 'ui-standards.md' -not -path './node_modules/*' 2>/dev/null
find . -maxdepth 3 -name 'globals.css' -not -path './node_modules/*' 2>/dev/null  # check for @theme
find . -maxdepth 3 -name 'tailwind.config*' -not -path './node_modules/*' 2>/dev/null
ls components/ui/ 2>/dev/null                                       # existing component lib
find docs -type f \( -name '*ui-ux*' -o -name '*design-spec*' -o -name '*prototype*' \) 2>/dev/null
```

ANY hit → MUST:
1. Read the canonical token source (usually `globals.css` @theme block or `ui-standards.md`)
2. Sample at least one existing prototype to absorb visual language
3. Use those tokens in EVERY companion HTML (colors, fonts, radii, shadows, spacing)

NO hits → free to use companion's default styling.

## Skill routing (decide BEFORE drawing)

| Stage | Skill | Why |
|---|---|---|
| Conceptual / upstream visual decisions (which surfaces? what UX paradigm? cross-surface architecture?) | `brainstorming` | Right tool for "what" and "shape" questions |
| The moment work shifts to "draw the actual mockup that anchors implementation" | `design-ui` | Has MANDATORY "Design system check" pre-step (see `~/.claude/skills/design-ui/SKILL.md` Pre-Design Steps §3) + Token Crystallization + benchmark decomposition |
| Production component code | `frontend-design` | Downstream from design-ui |

⛔ `brainstorming` MUST NOT draw `visual-companion` mockups intended to anchor implementation when the project has an existing design system. Defer that phase to `design-ui`.

`brainstorming`'s `visual-companion` is for **rough comparative sketches** during conceptual decisions (e.g. "4 UX paradigm options"). Once a paradigm is picked and we move to "what does the actual Today screen look like in our brand?", that's `design-ui` territory.

## ⛔ Existing surface preservation (CRITICAL — distinct from token reuse)

> Token inventory is necessary but NOT sufficient. UI work also reuses existing **layout structure** and **interaction patterns**. Designing variants that visually use project tokens BUT structurally re-imagine existing surfaces is still off-brand.

### Failure mode this prevents

Designing 3 "UI variants" that all use the project's design tokens correctly BUT each variant relocates primary content to a different surface (Variant B: sidebar→canvas-dominant; Variant C: in-app→toast-stack-primary). User reaction: "this is breaking everything we have." Damage: redo all variants after multi-perspective review cycle was already spent.

Observed instance: `coincoco` project — 3 UI variants drawn for "trigger brief" feature; tokens correct, but Variant B promoted right canvas to 800px reading panel and Variant C introduced toast stack that didn't exist in the app. User caught it; rule introduced.

### Mandatory pre-design surface inventory

⛔ For ANY UI task that ADDS content to existing features (i.e. anything except a brand-new isolated screen), BEFORE proposing layout / interaction strategy, inventory the surfaces the new design will touch:

```bash
find src/features -type d -maxdepth 3                                # existing features
ls src/features/<feature>/                                           # entry points
find src/features/<feature> -type d                                  # layout / sections / timeline / canvas etc.
```

For EACH surface the new design will touch, read the existing component(s) and identify:
- **Container**: where does the surface render? (sidebar section / timeline row / canvas panel / overlay?)
- **Interaction pattern**: how does it currently expand / collapse / focus / dismiss? (Inline accordion? Sheet? Popover? Modal? Side panel? Hover?)
- **State model**: how does it track focus / open state? (Zustand store key? Local state? URL param?)
- **Content slots already present**: what slots already accept "extra content" or "metadata"? (`children` prop? `secondary` field? `meta` slot? `detail` prop?)

### Default = minimal additive change

⛔ Default output is to ADD content to existing surface slots without changing layout / interaction.

Examples:
- "Inline brief in approval row" → add to existing `SectionRow`'s metadata/secondary slot if present; do NOT redesign the row
- "Brief on timeline" → add a new event type to the existing timeline event renderer pattern; do NOT re-architect timeline
- "Settings for brief" → add a new section using the existing settings section pattern; do NOT redesign settings layout
- "Status chip in top bar" → add to existing top bar chip cluster; do NOT redesign the bar

### Destructive change requires explicit user approval

⛔ A **destructive change** is ANY of:
- Replacing an existing layout primitive (3-column → 4-column; sidebar-dominant → canvas-dominant)
- Changing the primary interaction pattern of an existing surface (inline expand → overlay sheet; click-to-focus → hover-popover)
- Adding a new top-level UI mechanism not present in the current app (toast stack, command palette, notification center — when they don't exist yet)
- Replacing an existing component's role (showing Approval content primarily in the Canvas instead of the Sidebar)
- Promoting a previously-secondary surface to primary (or demoting primary to secondary)

⛔ Destructive changes MUST be proposed via `AskUserQuestion` with explicit "this changes existing X to Y" framing BEFORE drawing the variant / spec / mockup.

⛔ Multi-variant exploration MUST keep interaction architecture STABLE across variants; variants differ in visual / density / micro-interaction — NOT in WHERE primary content lives. If you want to offer cross-architecture variants, EACH destructive delta MUST be a separate `AskUserQuestion` option that the user explicitly opts into.

| 🚩 AI rationalization | Reality |
|---|---|
| "Multi-variant is the skill's standard step" | Multi-variant = visual / density / micro-interaction alternatives within the SAME interaction architecture. Cross-architecture variants need explicit opt-in per delta. |
| "Bloomberg / Linear / Slack are valid inspiration anchors" | Inspirations inform tokens / micro-interactions, NOT interaction architecture. If the project doesn't have a toast stack, "inspired by Slack toasts" = introducing a new mechanism that needs approval. |
| "Detail-First is a more thoughtful UX so the user will appreciate it" | Until approved, it's still a destructive change. Build the additive version first; offer destructive variants explicitly. |
| "The user said 'show me 3 variants'" | "3 variants" defaults to visual density alternatives over the same architecture. Cross-architecture deltas still need confirmation. |

### ⛔ Out-of-scope surface freeze (prototype frame rule)

> Scoped feature prototypes render MORE than the designed region (surrounding sidebar / canvas / nav for context). Those out-of-scope regions MUST be a **frozen frame**, not an invitation to design.

#### Failure mode this prevents

Dispatching variant builders with "两侧栏可用简化占位" — each builder then INVENTS its own sidebar/canvas (fake sections, loading skeletons, simulated data), so (a) out-of-scope UI gets visually redesigned, and (b) the frame differs across variants, polluting the comparison. User reaction: "我只想让你设计引导,你把 chat 两边其他模块也改了。"

Observed instance: `coincoco` composer-guide feature (2026-07) — 3 variants each invented different sidebar/canvas placeholders; variant C added a 900ms loading-skeleton simulation to the canvas. User caught it; rule introduced.

#### Rule

When building a prototype for a SCOPED feature inside an existing app:
1. **Default = blank frame (留白)**: out-of-scope regions keep ONLY their real geometry (column widths, breakpoints, extracted from source) and are otherwise EMPTY — a dashed inner border + centered muted label 「既有 UI 区域 · 非本次设计范围」. No content, no replication. This is cheaper than faithful replication and makes the designed region unambiguous. (User-validated preference: "索性直接留白…让用户知道真正设计的区域", coincoco 2026-07.)
2. **Faithful replication only on request**: replicate real surrounding UI only when the user asks for in-context fidelity — and then source it from a live screenshot/DOM of the running app, NEVER from a text description of the source code (text-derived frames were caught as "两边不是现在的设计").
3. **One canonical frame, verbatim**: whichever mode, the main agent writes ONE frame spec and every variant builder receives it verbatim. Never say "简化占位" / "placeholder OK" without the exact frame — builders WILL invent content.
4. **Identical across variants**: the frame is identical across all variants; only the designed region differs.

## Trigger checkpoints

| About to do | Stop and check |
|---|---|
| Write first visual companion HTML | Did I run the inventory? Did I extract tokens? |
| Offer visual companion | Does this project have a design system? If yes, am I going to handoff to design-ui at the right moment? |
| Propose component / layout in any form | Is there an existing prototype in `docs/design-system/prototype/` to base on? |
| Use any color / radius / shadow / font in mockup | Is it in the @theme block or ui-standards.md? |
| Recommend UI changes in a code review or design review | Did I check the canonical design system first? |
| Propose a UI variant that uses an existing surface (sidebar / timeline / canvas / settings) differently than current implementation | Is this destructive? If yes, AskUserQuestion before drawing. |
| Add a new top-level UI mechanism (toast / palette / new column) | Always destructive — AskUserQuestion before drawing. |
| Use language like "re-imagine" / "primary surface becomes" / "promote X to main canvas" | Inflection point — stop and AskUserQuestion. |
| Dispatch a variant builder with "占位/placeholder" for out-of-scope regions | Provide the canonical frozen frame spec instead — see "Out-of-scope surface freeze". |

## When in doubt

```
| 🚩 AI rationalization | Reality |
|---|---|
| "It's just a rough sketch, I'll polish later" | Rough sketches anchor expectations. Wrong anchor = wrong design doc. |
| "The user didn't say to use the existing system" | Existing design system is the default; deviation needs explicit reason. |
| "I'll just use the companion's default theme" | Default theme is generic. Generic ≠ neutral when project has a brand. |
| "Inventorying takes time" | 30 seconds of `ls + cat globals.css` saves redoing every mockup. |
```
