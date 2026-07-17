# Mode: Accessibility Testing

**Purpose**: WCAG 2.2 AA compliance verification

## Loop Specialization

| Step | Accessibility specifics |
|------|------------------------|
| ANALYZE | Component inventory, interaction patterns, ARIA usage, form flows |
| DESIGN | Automated scan coverage + manual test plan for keyboard, screen reader, zoom |
| SETUP | axe-core/Lighthouse configured, screen reader available (VoiceOver on macOS) |
| EXECUTE | Automated first → fix → manual keyboard → screen reader → zoom/reflow |
| GATE | 0 WCAG AA violations (automated). Manual findings classified by severity |
| CLEANUP | Collect audit reports, screenshot violations |
| PERSIST | Update test-plan with: compliance status, violation list, remediation plan |

## Test Layers

| Layer | Coverage | Tools |
|-------|----------|-------|
| Automated (~30-40%) | Contrast, alt text, ARIA roles, heading structure, form labels | axe-core, Lighthouse, Pa11y |
| Keyboard (manual) | Tab order, focus indicators, no traps, skip nav, all actions reachable | Manual testing |
| Screen reader (manual) | Content announced correctly, live regions, form instructions | VoiceOver, NVDA |
| Visual (manual) | Zoom 200%+, reflow at 320px, high contrast mode, motion reduction | Browser dev tools |

## WCAG 2.2 AA Quick Checklist

**Perceivable**
- [ ] All images have meaningful alt text (decorative → `alt=""`)
- [ ] Video/audio has captions and transcripts
- [ ] Color contrast ≥ 4.5:1 (text), ≥ 3:1 (large text, UI components)
- [ ] Text resizable to 200% without loss of content
- [ ] Content reflows at 320px width (no horizontal scroll)

**Operable**
- [ ] All interactive elements reachable via keyboard (Tab, Enter, Space, Arrow keys)
- [ ] No keyboard traps
- [ ] Skip navigation link present
- [ ] Visible focus indicators on all interactive elements
- [ ] Touch targets ≥ 24×24px (WCAG 2.2), recommend ≥ 44×44px
- [ ] No content requires specific timing (or adjustable)

**Understandable**
- [ ] Page language declared (`<html lang="...">`)
- [ ] Form inputs have visible labels (not just placeholder)
- [ ] Error messages identify the field and suggest correction
- [ ] Consistent navigation across pages

**Robust**
- [ ] Valid HTML (no duplicate IDs, proper nesting)
- [ ] ARIA attributes correct (roles, states, properties)
- [ ] Name, role, value exposed to assistive technology

## Severity Classification

| Severity | Definition | Action |
|----------|-----------|--------|
| Critical | Blocks access for a user group (e.g., no keyboard access to primary action) | Must fix before release |
| Major | Significant barrier but workaround exists | Fix within sprint |
| Minor | Inconvenience, not a barrier | Backlog with timeline |
| Advisory | Best practice, not a WCAG violation | Consider for next iteration |

## Retest Protocol
- After fix: rerun automated scan + manual verify the specific issue
- Regression check: ensure fix didn't break other a11y features
- Update compliance status: `violation → fixed → verified`

## Assistive Technology Matrix
| AT | Platform | Priority | Notes |
|----|----------|----------|-------|
| VoiceOver | macOS/iOS | P0 | Default for macOS dev |
| NVDA | Windows | P0 | Free, most popular |
| JAWS | Windows | P1 | Enterprise standard |
| TalkBack | Android | P1 | Mobile coverage |

Tools: agent-browser (snapshot -i for a11y tree), axe-core CLI, Lighthouse CI
