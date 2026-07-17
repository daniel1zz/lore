# Product Design Patterns

> Pattern selection guide for PM decisions. UI implementation details → `design` skill.

## Onboarding Patterns

| Pattern | When | Key Principle |
|---------|------|---------------|
| Progressive | Complex product, many features | Reveal gradually: welcome → setup → first win → tips |
| Empty state | Content-driven, empty initial state | Turn empty states into teaching moments with CTAs |
| Checklist | Multi-step setup, gamification fits | Progress indicator + tasks + completion reward |

## Auth Patterns

| Pattern | When | Trade-off |
|---------|------|-----------|
| Magic link | Simplicity > speed, security-conscious | Better security, slower login |
| Social login | Consumer, reduce friction | Max 2-3 providers + email fallback |
| Progressive auth | Exploration-first, conversion optimization | Delay signup until value demonstrated |

## Form Patterns
- **Inline validation**: Validate on blur, not on change; don't validate empty until submit
- **Smart defaults**: Country from IP, date=today, common choices pre-selected
- **Progressive disclosure**: Start essential, reveal based on answers

## Navigation Patterns
Breadcrumbs (deep hierarchy), Tabs (3-5 same-level items), Sidebar (many sections, frequent switching), Command palette (power users, Cmd+K)

## PM-Level Interaction Decisions

| Topic | Guidelines |
|-------|-----------|
| Loading | <1s: spinner/skeleton; >1s: progress; >10s: cancel+status |
| Notifications | Success: auto-dismiss 3-5s+undo; Error: persist+how-to-fix; Info: auto-dismiss 5-7s |
| Destructive actions | Always confirm dialog. Avoid: dialog fatigue, vague "Are you sure?" |
| Data display | Infinite scroll (feeds), pagination (reference data), load-more (hybrid) |
| Mobile | Bottom sheet (actions/filters), tab bar (3-5 sections), FAB (1 per screen), gestures (always provide non-gesture alt) |
| Animation | Purpose: feedback/orientation/focus/delight. Never block user. Provide reduced-motion. 100-300ms. |
