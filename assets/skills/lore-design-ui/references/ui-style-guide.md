# Business Scenario Style Guide

> For technical implementation, see [ui-design.md](ui-design.md)
>
> Dynamic design system generation:
> ```bash
> python3 ~/.claude/plugins/marketplaces/ui-ux-pro-max-skill/.codex/skills/ui-ux-pro-max/scripts/search.py \
>   "<industry> <product_type> <personality>" --design-system
> ```

## Brand Personality → Visual Language (Aaker 5-Dimension)

| Dimension | Traits | Colors | Typography | Border Radius | Icons |
|-----------|--------|--------|------------|---------------|-------|
| **Sincerity** | honest, warm, authentic | Warm earth tones, soft pastels | Friendly sans (Nunito, Lato, Poppins) | 12-16px | Filled, friendly |
| **Excitement** | daring, energetic, innovative | Vibrant, high saturation, gradients ok | Dynamic display, varied weights | Varies (0-24px) | Dynamic, motion |
| **Competence** | reliable, professional, efficient | Professional blues, neutral grays | Geometric sans (Inter, SF Pro) | 4-8px | Line, consistent stroke |
| **Sophistication** | elegant, premium, refined | Muted mono, black/white/gold | Elegant serif (Playfair, Didot) | 0-4px or 24px+ | Thin stroke, minimal |
| **Ruggedness** | tough, outdoor, athletic | Earthy (olive, brown, rust, charcoal) | Bold industrial (Oswald, Bebas Neue) | 0-4px | Bold stroke, solid |

## Tone Calibration Scales

```
Serious ←─── -3 -2 -1 0 +1 +2 +3 ───→ Playful
Traditional ← -3 -2 -1 0 +1 +2 +3 ──→ Modern
Minimal ←──── -3 -2 -1 0 +1 +2 +3 ──→ Expressive
```

| Scale Value | Border Radius | Animation | Saturation | Typography |
|-------------|---------------|-----------|------------|------------|
| -3 | 0-4px | None/Subtle | Low | Serif, formal |
| 0 | 8px | Standard | Medium | Clean sans |
| +3 | 16-24px | Rich | High | Display, varied |

## Industry Style Profiles

### Fintech & Banking
- **Personality**: Competence + Sophistication
- **Colors**: Blue (#1E40AF-#3B82F6) for trust; green for growth; gold for premium; avoid dominant red
- **Typography**: Geometric sans (Inter, Circular), tabular figures for numbers, monospace for codes
- **Components**: radius 8-12px, subtle layered shadows, inline validation, right-aligned numbers
- **Anti-patterns**: Hiding fees, jargon without explanation, inconsistent number formatting
- **References**: Revolut, Stripe, Mercury

### Healthcare & Medical
- **Personality**: Sincerity + Competence
- **Colors**: Calming blue/teal (#0EA5E9-#14B8A6), gentle green; red ONLY for emergencies
- **Typography**: Humanist sans (Source Sans Pro, Lato), 16-18px base, line-height 1.6-1.8
- **Components**: radius 12-16px, spacious density, 48px+ touch targets, WCAG AAA
- **Anti-patterns**: Medical jargon, alarming language for non-emergencies, small text
- **References**: Oscar Health, Headspace, Zocdoc

### Gaming & Entertainment
- **Personality**: Excitement + Ruggedness
- **Colors**: Vibrant/neon, colored shadows ok, dark mode often default
- **Typography**: Custom display fonts (Orbitron, Rajdhani), stylized scores
- **Components**: Varies by context, glassmorphism, rich micro-interactions
- **Anti-patterns**: Corporate aesthetic, slow interactions, aggressive monetization
- **References**: Discord, Twitch, Steam

### Education & EdTech
- **Personality**: Sincerity + Excitement
- **Colors**: Friendly warm (teal, green, orange), gold for achievements, high contrast (7:1 preferred)
- **Typography**: Friendly sans (Quicksand, Nunito, Poppins), 16-18px min, dyslexia-friendly option
- **Components**: radius 16-24px, encouraging feedback, progress/streaks/badges
- **Anti-patterns**: Punishing failure, overwhelming info, inaccessible content
- **References**: Duolingo, Khan Academy, Coursera

### E-commerce & Retail
- **Personality**: Varies by brand
- **Colors**: Brand-driven; high-contrast CTAs (orange/green); limited red/orange for urgency
- **Typography**: Brand-appropriate headers, readable descriptions, tabular prices
- **Components**: radius 4-12px, dense listings / spacious detail pages, quick add-to-cart
- **Anti-patterns**: Hidden costs, forced account creation, dark patterns, slow images
- **References**: Shopify, Nike, Glossier, Allbirds

### Enterprise & B2B SaaS
- **Personality**: Competence
- **Colors**: Professional blues/teals/purples, neutral grays, colorblind-safe data palette
- **Typography**: Clean geometric sans (Inter, SF Pro), monospace for code, tabular for data
- **Components**: radius 4-8px, sidebar nav, sortable/filterable tables, keyboard shortcuts essential
- **Anti-patterns**: Consumer-style playful design, excessive animations, hidden keyboard nav
- **References**: Salesforce Lightning, Atlassian, Linear, Figma

## Decision Flow

1. **Industry** → Load profile above
2. **Brand Personality** → Select from 5 dimensions
3. **Product Type modifier**: Dashboard=compact+data | Mobile=spacious+touch | Marketing=expressive+conversion | Internal=compact+efficient | Consumer=personality+delight
4. **User demographic modifier**: Senior=+2px font, 48px+ touch, WCAG AAA | Technical=compact option, shortcuts | Casual=progressive disclosure
5. **Tone calibration**: Rate on 3 scales above

## Color Psychology Quick Ref

| Color | Best For | Avoid For |
|-------|----------|-----------|
| Blue | Finance, healthcare, enterprise | Entertainment, food |
| Green | Wellness, finance, eco | Luxury, gaming |
| Red | Sales, gaming, food | Healthcare, finance |
| Purple | Beauty, education, tech | Budget brands |
| Orange | Retail, education, social | Medical, legal |
| Black | Luxury, fashion, tech | Healthcare, children |

## Typography Pairings

| Style | Header | Body | Use Case |
|-------|--------|------|----------|
| Professional | Inter | Open Sans | B2B, Finance |
| Modern Tech | Circular | Roboto | Startups, SaaS |
| Elegant | Playfair Display | Source Sans Pro | Luxury, Fashion |
| Friendly | Nunito | Lato | Education, Consumer |
| Bold | Bebas Neue | Inter | Sports, Gaming |
| Minimal | SF Pro | SF Pro | Apple-like, Premium |

## Component Style Presets

| Preset | Radius | Shadows | Animation | Suits |
|--------|--------|---------|-----------|-------|
| Conservative | 4px | Minimal | Subtle | Enterprise, finance, legal |
| Balanced | 8px | Standard | Standard | SaaS, productivity |
| Friendly | 12-16px | Soft | Playful | Education, healthcare, consumer |
| Bold | 16-24px or 0 | Dramatic | Rich | Gaming, entertainment, youth |

## Style Recommendation Output Template

```markdown
## Style Recommendation for {Product Name}

### Context Analysis
| Factor | Value |
|--------|-------|
| Industry | {industry} |
| Product Type | {product_type} |
| Target User | {demographic} |
| Personality | {dimension} |
| Tone | Serious/Playful: {-3 to +3}, Traditional/Modern: {-3 to +3} |

### Color Palette
| Role | Hex | Usage |
|------|-----|-------|
| Primary | {hex} | Main actions |
| Secondary | {hex} | Supporting |
| Accent | {hex} | Highlights |

### Typography / Components / Patterns / Anti-Patterns / References
[Fill per industry profile]
```
