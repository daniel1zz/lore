# Accessibility (A11y) Checklist (Quick Reference)

Target: **WCAG 2.1 AA** for most applications.

## Contrast Ratios
- Normal text: **4.5:1** (AA), 7:1 (AAA)
- Large text (18pt+ or 14pt+ bold): **3:1** (AA)
- UI components/focus indicators: **3:1** (AA)

## Perceivable
- [ ] All `<img>` have `alt` (decorative: `alt=""`)
- [ ] Video: captions, audio descriptions, transcript, no autoplay with sound
- [ ] Color NOT sole indicator (add text/icon)
- [ ] Text resizable to 200%, no horizontal scroll at 320px
- [ ] Use `rem`/`em` not `px` for font sizes; `line-height: 1.5`

## Operable
- [ ] All functionality via keyboard (Tab, Enter, Space, Arrows, Escape)
- [ ] Visible focus indicator: `:focus-visible { outline: 2px solid #005fcc; }`
- [ ] Logical tab order, no keyboard traps
- [ ] Skip link: `<a href="#main" class="skip-link">Skip to main content</a>`
- [ ] Focus trapped in modals, returned to trigger on close
- [ ] `prefers-reduced-motion` respected
- [ ] No content flashes > 3/sec

## Understandable
- [ ] All inputs have associated `<label>` (explicit `for=` or wrapping)
- [ ] Required fields indicated (not just color)
- [ ] Error messages identify field AND error, linked via `aria-describedby`
- [ ] `<html lang="en">`, language changes marked with `lang=`

## Robust
- [ ] Semantic HTML: `<nav>`, `<main>`, `<article>`, `<aside>`, `<header>`, `<footer>`
- [ ] Heading hierarchy: h1 -> h2 -> h3 (no skipping)
- [ ] Tables: `<caption>`, `<th scope="col/row">`
- [ ] ARIA: Don't use if native HTML works. All interactive ARIA must be keyboard accessible

## Key ARIA Patterns
- **Live regions**: `aria-live="polite"` (updates), `role="alert"` (urgent)
- **Tabs**: `role="tablist/tab/tabpanel"`, `aria-selected`, `aria-controls`
- **Icon buttons**: `aria-label="Close"` or `.sr-only` text
- **Loading**: `aria-busy="true"`, `aria-disabled="true"`

## `.sr-only` CSS
```css
.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
```

## Testing
- **Automated** (~30-50%): axe DevTools, Lighthouse, jest-axe, cypress-axe
- **Manual**: Keyboard-only navigation, screen reader (VoiceOver/NVDA), zoom 200%+
