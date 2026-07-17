# UI/UX Design Reference

> For business scenario style decisions, see [ui-style-guide.md](ui-style-guide.md)
>
> Dynamic design system: `python3 ~/.claude/plugins/.../search.py "<keywords>" --design-system`

## Component Design Patterns

### Atomic Design Hierarchy
Atoms (Button, Input, Icon) → Molecules (FormField, SearchBox, Card) → Organisms (Header, Form, DataTable) → Templates (DashboardLayout) → Pages

### Component API Conventions
- Variants: `variant='primary'|'secondary'|'ghost'|'danger'`
- Sizes: `size='sm'|'md'|'lg'`
- States: `disabled`, `loading`
- Content slots: `children`, `leftIcon`, `rightIcon`
- Polymorphic: `as='button'|'a'|Component`
- Compound components: `Card.Header`, `Card.Content`, `Card.Footer`

## Design Tokens (Tailwind Defaults)

### Spacing Scale
`0=0, 1=4px, 2=8px, 3=12px, 4=16px, 5=20px, 6=24px, 8=32px, 10=40px, 12=48px, 16=64px`

### Usage Guidelines
- Button: `px-4 py-2`, Card: `p-6`, Input: `px-3 py-2`, Modal: `p-6`
- Gap: tight=`gap-2`, normal=`gap-4`, loose=`gap-6`, section=`gap-8`

### Breakpoints
`sm=640px, md=768px, lg=1024px, xl=1280px, 2xl=1536px`

Mobile-first: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4`

### Semantic Typography Classes
```
h1: text-4xl font-bold tracking-tight
h2: text-3xl font-semibold tracking-tight
h3: text-2xl font-semibold
h4: text-xl font-semibold
body: text-base
caption: text-xs text-gray-500
code: font-mono text-sm
```

## Interaction Patterns

### Required States for Every View
- **Loading**: Skeleton placeholders (`animate-pulse`), button spinner, inline spinner
- **Empty**: Icon + title + description + CTA button
- **Error**: Inline (alert box + retry) or full-page (status code + refresh)

### Animation Defaults
- Fade: 200ms ease-out / 150ms ease-in
- Modal: 200ms ease-out, scale 0.95→1
- Dropdown: 150ms ease-out
- Tooltip: 100ms opacity
- **Always respect** `prefers-reduced-motion`
- **Avoid** `transition-all`; explicitly transition needed properties only

### Framer Motion Patterns
- Staggered list: `staggerChildren: 0.1`, items `opacity: 0, y: 20 → 1, 0`
- AnimatePresence for mount/unmount animations

## Pre-Delivery Checklist

### Visual Quality
- [ ] Icons follow project icon policy (svg_only / emoji_allowed / hybrid)
- [ ] All icons from consistent icon set; brand logos from Simple Icons
- [ ] Hover states don't cause layout shift
- [ ] Neutral family (slate/zinc/neutral/gray) used consistently
- [ ] Surfaces create depth (background/surface-1/2/3); no arbitrary grays
- [ ] Semantic Tailwind tokens preferred (`bg-primary`, `text-text-primary`)

### Interaction
- [ ] All clickable elements have `cursor-pointer`
- [ ] Hover states provide clear feedback
- [ ] Transitions 150-300ms, no `transition-all`
- [ ] Focus states visible for keyboard nav

### Light/Dark Mode
- [ ] Text contrast 4.5:1 minimum
- [ ] Glass/transparent elements visible in light mode
- [ ] Borders visible in both modes

### Layout
- [ ] Floating elements spaced from edges
- [ ] No content behind fixed navbars
- [ ] Responsive at 375px, 768px, 1024px, 1440px
- [ ] Consistent max-width strategy + stable gutters
- [ ] Z-index follows tokenized layering (no ad-hoc values)
- [ ] No horizontal scroll on mobile

### Accessibility
- [ ] All images have alt text
- [ ] Form inputs have labels
- [ ] `focus-visible` (not permanent focus rings on mouse)
- [ ] Color is not the only indicator
- [ ] `prefers-reduced-motion` respected
- [ ] Touch targets >= 44px
