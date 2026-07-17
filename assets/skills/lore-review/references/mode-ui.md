# Mode: ui - Visual UI/UX Verification

**Purpose**: Runtime visual verification of UI/UX changes using agent-browser CLI

## Scope

```yaml
scope:
  - Visual rendering correctness (layout, spacing, alignment)
  - Responsive design across breakpoints
  - Dark/light mode theme verification
  - A11y tree semantic structure (runtime)
  - Console errors and warnings on page load
  - Visual regression detection (AI-powered screenshot analysis)
  - Design system token compliance (spacing, color, typography, sizing)

out_of_scope:
  - Full e2e user flow testing (use test skill instead)
  - Performance profiling (use diagnose performance instead)
  - Static code quality (use review code instead)
```

## Prerequisites

```yaml
prerequisites:
  required:
    - "Dev server must be running (e.g., npm run dev)"
    - "agent-browser must be installed and accessible (npm i -g agent-browser)"
    - "User must provide: base URL + page path(s) to verify"
  optional:
    - "Design spec or mockup for comparison (lore spec --kind design)"
    - "Feature-spec with UI acceptance criteria"
```

## Supplementary References

- **CONDITIONAL**: If a design-kind spec is found in the lore corpus, load it as visual reference for comparison.
- **CONDITIONAL**: If feature-spec found, extract UI-related acceptance criteria.

## Workflow

```yaml
workflow:
  0_prerequisites:
    action: "Verify browser access and get target pages from user"
    steps:
      - "Run `agent-browser open about:blank` to confirm browser launches"
      - "Ask user for dev server URL if not provided (e.g., http://localhost:3000)"
      - "Ask user for page path(s) to review (e.g., /dashboard, /settings)"
    tools: [agent-browser open, agent-browser session list]
    gate: "STOP if agent-browser not installed — inform user to run `npm i -g agent-browser && agent-browser install`"

  1_context:
    action: "Gather design context for comparison"
    steps:
      - "`lore search \"<q>\" --type spec --json` for a design-kind spec related to the UI changes"
      - "`lore search \"<q>\" --type spec --json` for a feature-kind spec with UI acceptance criteria"
      - "If PR context: read PR description for UI change details"
    tools: [lore search, github pull_request_read]
    output: "Design reference loaded (or 'No design-spec found — reviewing against best practices')"

  2_visual_inspection:
    action: "Run visual inspection suite for each target page"
    for_each_page:
      2a_navigate:
        action: "Navigate to target page"
        tool: "agent-browser open {base_url + page_path}"
        wait: "agent-browser wait --load networkidle"

      2b_desktop:
        action: "Desktop viewport verification (1440x900)"
        steps:
          - "agent-browser set viewport 1440 900"
          - "agent-browser screenshot --full"
          - "Analyze: layout, spacing, alignment, typography, visual hierarchy"
        label: "Desktop (1440px)"

      2c_tablet:
        action: "Tablet viewport verification (768x1024)"
        steps:
          - "agent-browser set viewport 768 1024"
          - "agent-browser screenshot --full"
          - "Analyze: responsive layout, touch targets (min 44x44px), content reflow"
        label: "Tablet (768px)"

      2d_mobile:
        action: "Mobile viewport verification (375x812)"
        steps:
          - "agent-browser set viewport 375 812 3"
          - "agent-browser screenshot --full"
          - "Analyze: mobile layout, no horizontal overflow, readable text, tap targets"
        label: "Mobile (375px)"

      2e_dark_mode:
        action: "Dark mode verification"
        steps:
          - "agent-browser set viewport 1440 900 && agent-browser set media dark"
          - "agent-browser screenshot --full"
          - "Analyze: contrast ratios, no invisible text, theme token consistency"
          - "agent-browser set media light"  # Reset to default so subsequent steps are unaffected
        label: "Dark Mode"

      2f_a11y_tree:
        action: "Runtime accessibility tree — structural quick check (not a full a11y audit)"
        steps:
          - "agent-browser set viewport 1440 900"
          - "agent-browser snapshot -i"
          - "Analyze: semantic structure, heading hierarchy, ARIA roles, form labels, landmark regions"
        label: "A11y Tree"
        note: "For comprehensive WCAG 2.1 audit, use Skill(\"review\",\"accessibility\")"

      2g_console_check:
        action: "Console error and warning detection"
        steps:
          - "agent-browser eval --stdin <<'EVALEOF'\n              JSON.stringify(window.__console_errors || 'No console capture — check browser devtools manually')\n              EVALEOF"
          - "Flag: any errors or warnings related to the UI changes"
          - "Ignore: known third-party warnings unrelated to the change"
        label: "Console Errors"
        note: "agent-browser does not have native console capture; use eval with JS or check browser devtools"

      2h_design_system:
        action: "Design system token compliance audit via runtime CSS inspection"
        steps:
          - "agent-browser set viewport 1440 900"
          - step_1_discover_tokens: |
              agent-browser eval --stdin — extract all CSS custom properties from :root / html:
              ```sh
              agent-browser eval --stdin <<'EVALEOF'
              (() => {
                const root = getComputedStyle(document.documentElement);
                const sheets = [...document.styleSheets];
                const vars = new Set();
                for (const sheet of sheets) {
                  try {
                    for (const rule of sheet.cssRules) {
                      if (rule.selectorText === ':root' || rule.selectorText === 'html') {
                        for (const prop of rule.style) {
                          if (prop.startsWith('--')) vars.add(prop);
                        }
                      }
                    }
                  } catch {}
                }
                return { count: vars.size, tokens: [...vars].sort().slice(0, 100) };
              })()
              ```
          - step_2_classify_tokens: |
              Classify discovered tokens into categories by naming convention:
                color:   --color-*, --*-fg, --*-bg, --*-border, --primary, --secondary, --accent, --muted, --destructive
                spacing: --spacing-*, --space-*, --gap-*, --radius-*
                typography: --font-*, --text-*, --leading-*, --tracking-*
                sizing:  --size-*, --width-*, --height-*, --*-sm, --*-md, --*-lg
                shadow:  --shadow-*
                z-index: --z-*
              If < 5 tokens found → likely no CSS custom property design system.
              Fallback: check for Tailwind (look for 'tailwindcss' in stylesheets or class patterns like 'text-sm', 'p-4', 'bg-primary')
          - step_3_sample_elements: |
              agent-browser eval --stdin — sample key UI elements and check computed styles against tokens:
              ```js
              (() => {
                const root = getComputedStyle(document.documentElement);
                const tokenValues = {};
                // Collect all token values
                for (const prop of [...root]) {
                  if (prop.startsWith('--')) tokenValues[prop] = root.getPropertyValue(prop).trim();
                }
                // Build reverse lookup: value → token name(s)
                const valueToToken = {};
                for (const [k, v] of Object.entries(tokenValues)) {
                  (valueToToken[v] ??= []).push(k);
                }
                // Sample elements changed by PR (or all interactive/content elements)
                const selectors = 'h1,h2,h3,h4,p,a,button,input,select,textarea,[class*="card"],[class*="modal"],[class*="dialog"],[class*="badge"],[class*="alert"]';
                const elements = [...document.querySelectorAll(selectors)].slice(0, 30);
                const violations = [];
                for (const el of elements) {
                  const cs = getComputedStyle(el);
                  const tag = el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : '');
                  // Check color
                  for (const prop of ['color', 'background-color', 'border-color']) {
                    const val = cs.getPropertyValue(prop).trim();
                    if (val && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent') {
                      const usesToken = el.style.getPropertyValue(prop)?.includes('var(--') ||
                        Object.values(tokenValues).some(tv => tv === val);
                      if (!usesToken) violations.push({ el: tag, prop, value: val, type: 'color' });
                    }
                  }
                  // Check font-size
                  const fs = cs.fontSize;
                  if (!Object.values(tokenValues).some(tv => tv === fs)) {
                    violations.push({ el: tag, prop: 'font-size', value: fs, type: 'typography' });
                  }
                  // Check spacing (padding, margin, gap)
                  for (const prop of ['padding', 'margin', 'gap']) {
                    const val = cs.getPropertyValue(prop).trim();
                    if (val && val !== '0px') {
                      const segments = val.split(/\s+/);
                      for (const seg of segments) {
                        if (seg !== '0px' && seg !== 'auto' && !Object.values(tokenValues).some(tv => tv === seg)) {
                          violations.push({ el: tag, prop, value: seg, type: 'spacing' });
                          break;
                        }
                      }
                    }
                  }
                }
                return { total_tokens: Object.keys(tokenValues).length, sampled: elements.length, violations: violations.slice(0, 50) };
              })()
              ```
          - step_4_analyze: |
              Analyze violations:
                - Group by type (color, typography, spacing, sizing)
                - Identify pattern: is it a one-off hardcode or a systemic bypass?
                - Cross-reference with design-spec (if loaded) to determine if the value SHOULD exist as a token
                - Severity mapping:
                    hardcoded color bypassing theme → MAJOR (breaks dark mode / theming)
                    hardcoded spacing not matching any scale step → MINOR (visual inconsistency)
                    hardcoded font-size not matching type scale → MINOR
                    one-off override with documented reason → NIT
                    no design tokens found at all → report as INFO, not a violation
        label: "Design System"
        note: "If no CSS custom properties or Tailwind detected, report 'No design system tokens found — skipping compliance check' and move on."

  3_cross_reference:
    action: "Cross-reference findings with code"
    steps:
      - "For visual issues found: use Serena to locate relevant CSS/component code"
      - "Provide specific file:line references for each finding"
    tools: [serena find_symbol, serena search_for_pattern]

  4_output:
    action: "Provide structured visual review report using output format below"
```

## Breakpoint Defaults

```yaml
breakpoints:
  mobile:
    width: 375
    height: 812
    hasTouch: true
    isMobile: true
    deviceScaleFactor: 3
    label: "Mobile (375px)"
  tablet:
    width: 768
    height: 1024
    hasTouch: true
    isMobile: true
    label: "Tablet (iPad)"
  desktop:
    width: 1440
    height: 900
    label: "Desktop (standard)"

customization:
  note: "User may override breakpoints. Ask if the project has specific breakpoints defined."
```

## Visual Analysis Criteria

```yaml
analysis_criteria:
  layout:
    - "Elements properly aligned (no unexpected shifts)"
    - "Consistent spacing (margins, padding follow design system)"
    - "No overlapping elements"
    - "Content does not overflow containers"

  responsive:
    - "Layout adapts appropriately at each breakpoint"
    - "No horizontal scrollbar on any viewport"
    - "Images scale correctly (no distortion)"
    - "Navigation transforms for mobile (e.g., hamburger menu)"
    - "Touch targets >= 44x44px on mobile/tablet"

  dark_mode:
    - "All text readable against background"
    - "No hardcoded colors bypassing theme tokens"
    - "Icons and images visible in dark mode"
    - "Form inputs and borders visible"
    - "Shadows and elevation adapted for dark theme"

  a11y_tree:
    - "Logical heading hierarchy (h1 > h2 > h3, no skips)"
    - "All interactive elements have accessible names"
    - "Form inputs associated with labels"
    - "Landmark regions present (main, nav, banner, contentinfo)"
    - "Images have alt text (or marked decorative)"
    - "ARIA roles used correctly (not overriding native semantics)"

  console:
    - "No JavaScript errors on page load"
    - "No React/framework warnings (key prop, deprecated API)"
    - "No failed network requests for UI assets (404 for images, fonts)"

  design_system:
    - "Colors use design tokens (CSS custom properties or Tailwind classes) — no raw hex/rgb hardcodes"
    - "Font sizes follow the type scale defined by tokens — no arbitrary px values"
    - "Spacing (padding, margin, gap) uses scale steps — no magic numbers"
    - "Border radius uses token values — consistent rounding across components"
    - "Shadows use elevation tokens — no inline box-shadow with raw values"
    - "Z-index uses layering tokens — no arbitrary large numbers (e.g., z-index: 9999)"
    - "Component sizing (width, height) uses size tokens where applicable"
    - "Token naming conventions are consistent (e.g., --color-primary not mixed with --primary-color)"
```

## Output Format

> Extends the base SKILL.md output format with visual-specific sections.

```markdown
## Visual Review Summary

| Check | Status | Issues |
|-------|--------|--------|
| Desktop (1440px) | pass/warn/fail | N |
| Tablet (768px) | pass/warn/fail | N |
| Mobile (375px) | pass/warn/fail | N |
| Dark Mode | pass/warn/fail | N |
| A11y Tree | pass/warn/fail | N |
| Console Errors | pass/warn/fail | N |
| Design System | pass/warn/fail/skipped | N |

**Verdict**: approve / approve with comments / request changes

**Pages Reviewed**: [list of URLs checked]

## Findings

### 🚫 BLOCKER: [title]
**Check**: Desktop / Tablet / Mobile / Dark Mode / A11y Tree / Console
**Issue**: [visual description of the problem]
**Expected**: [what it should look like, referencing design-spec if available]
**Code Reference**: `path/to/file.ts:42` — [relevant CSS/component code]
**Suggestion**: [CSS/component fix]

### ⚠️ MAJOR: [title]
...

### 💡 MINOR: [title]
...

### 🔍 NIT: [title]
...

## Responsive Behavior Matrix

| Element/Component | Desktop | Tablet | Mobile | Notes |
|-------------------|---------|--------|--------|-------|
| [component name] | ok/issue | ok/issue | ok/issue | [detail] |

## Positive Highlights
- [Good visual patterns worth noting]

## Design Spec Comparison
- **Spec found**: Yes/No
- **Deviations**: [list any differences from design spec]
- **Matches**: [confirmations of spec compliance]

## Design System Compliance

**Token System**: [CSS custom properties / Tailwind / None detected]
**Tokens Discovered**: [N total — color: N, spacing: N, typography: N, sizing: N, other: N]

### Token Violations

| Element | Property | Hardcoded Value | Nearest Token | Severity |
|---------|----------|----------------|---------------|----------|
| `button.primary` | background-color | `#3b82f6` | `--color-primary` | MAJOR |
| `h2.title` | font-size | `18px` | `--text-lg (18px)` — match | OK |
| `div.card` | padding | `13px` | `--spacing-3 (12px)` or `--spacing-4 (16px)` | MINOR |

### Compliance Summary
- **Elements sampled**: N
- **Token-compliant**: N ({pct}%)
- **Violations**: N (MAJOR: N, MINOR: N, NIT: N)
- **Systemic patterns**: [e.g., "All card components use hardcoded padding — suggests missing card spacing token"]

### Recommendations
- [e.g., "Add --spacing-card token to design system for consistent card padding"]
- [e.g., "Replace hardcoded #3b82f6 with var(--color-primary) across 5 components"]
```

## Primary Tools

```yaml
tools:
  browser_interaction:
    - agent-browser: open (navigate), wait (--load/--url/selector)
  visual_capture:
    - agent-browser: screenshot --full (viewport screenshots)
    - agent-browser: snapshot -i (a11y tree with interactive refs)
    - agent-browser: screenshot --annotate (numbered element labels)
  environment_control:
    - agent-browser: set viewport <w> <h> [scale] (viewport + DPR)
    - agent-browser: set media dark/light (color scheme)
    - agent-browser: set device "<name>" (device emulation)
  runtime_inspection:
    - agent-browser: eval --stdin (JS evaluation for CSS computed values, DOM checks)
  code_cross_reference:
    - serena: find_symbol, search_for_pattern
  context:
    - lore: `lore search`, `lore get` (design-kind spec, feature-kind spec)
  pr_interaction:
    - github: pull_request_read (get_diff, get_files)
    - github: add_comment_to_pending_review
```
