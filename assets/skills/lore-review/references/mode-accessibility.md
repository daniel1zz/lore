# Mode: accessibility - WCAG 2.1 AA Audit

**Purpose**: Accessibility audit for changed code — structural + behavioral verification

## Supplementary References
- **MANDATORY**: Read `references/a11y-checklist.md` for WCAG criteria quick reference.

## Workflow

```yaml
workflow:
  1_automation:
    action: "Check if a11y tools ran. Recommend: axe-core, Lighthouse, jest-axe, cypress-axe"
    note: "Automated tools catch ~30-50% of issues. Manual review covers the rest."

  2_doc_check:
    action: "Check UI component library a11y docs"
    tools: [context7 query-docs for Radix/MUI/shadcn/Headless UI a11y patterns]

  3_semantic_verification:
    action: "Verify HTML semantics in changed components"
    procedure: "See §1 below"

  4_keyboard_verification:
    action: "Verify keyboard accessibility for changed interactive elements"
    procedure: "See §2 below"

  5_aria_verification:
    action: "Verify ARIA usage correctness"
    procedure: "See §3 below"

  6_output:
    action: "Report with WCAG criterion refs"
```

## §1 Semantic Structure Verification

```yaml
semantic_verification:
  step_1_heading_hierarchy:
    action: "Trace heading levels in changed components"
    check:
      - "h1 → h2 → h3 without skipping levels"
      - "Only one h1 per page (unless sectioning elements used)"
    tool: "serena search_for_pattern — search for <h1-h6 or heading components"
    violation: "Skipped heading level → MAJOR (WCAG 1.3.1)"

  step_2_landmark_regions:
    action: "Verify landmark structure"
    check:
      - "main, nav, header, footer landmarks present"
      - "All page content within a landmark"
      - "Landmarks not nested inappropriately"
    tool: "serena search_for_pattern — <main, <nav, <header, <footer, role="
    violation: "Content outside landmarks → MINOR (WCAG 1.3.1)"

  step_3_semantic_elements:
    action: "Verify semantic HTML over div/span"
    check:
      - "Lists use <ul>/<ol>/<dl>, not styled divs"
      - "Tables use <table> with <th scope>, not CSS grid for tabular data"
      - "Buttons use <button>, not <div onClick>"
      - "Links use <a href>, not <span onClick>"
    tool: "serena search_for_pattern — div.*onClick, span.*onClick"
    violation: "Interactive div/span without button/link role → BLOCKER (WCAG 4.1.2)"

  step_4_form_labels:
    action: "Verify all form inputs have associated labels"
    check:
      - "Explicit label with for= matching input id"
      - "Or wrapping <label> around input"
      - "Or aria-label/aria-labelledby on input"
      - "Required fields indicated beyond just color"
    tool: "serena search_for_pattern — <input, <select, <textarea without label association"
    violation: "Input without label → BLOCKER (WCAG 1.3.1, 4.1.2)"

  step_5_image_alt:
    action: "Verify image alt text"
    check:
      - "All <img> have alt attribute"
      - "Decorative images have alt='' (empty, not missing)"
      - "Alt text is descriptive, not 'image' or filename"
      - "Complex images (charts, diagrams) have extended description"
    tool: "serena search_for_pattern — <img, <Image without alt"
    violation: "Missing alt → BLOCKER (WCAG 1.1.1)"
```

## §2 Keyboard Accessibility Verification

```yaml
keyboard_verification:
  step_1_focusability:
    action: "Verify all interactive elements are keyboard focusable"
    check:
      - "Custom interactive elements have tabIndex=0 or use native elements"
      - "tabIndex > 0 is NOT used (disrupts natural tab order)"
      - "Disabled elements are removed from tab order (tabIndex=-1 or disabled attr)"
    tool: "serena search_for_pattern — tabIndex, tabindex"
    violation: "Positive tabIndex → MAJOR (WCAG 2.4.3)"

  step_2_focus_management:
    action: "Verify focus management in dynamic UI"
    check:
      - "Modal: focus trapped inside, returned to trigger on close"
      - "Dropdown/menu: focus moves into menu on open, returns on close"
      - "Route change: focus moves to main content or heading"
      - "Dynamic content: focus not lost when DOM updates"
    tool: "serena search_for_pattern — focus(), focusTrap, FocusTrap, createFocusTrap, useFocusTrap"
    violation: "Modal without focus trap → BLOCKER (WCAG 2.4.3)"

  step_3_keyboard_handlers:
    action: "Verify keyboard event handling for custom widgets"
    check:
      - "onClick also has onKeyDown/onKeyUp (Enter/Space for buttons, Enter for links)"
      - "Custom widgets follow WAI-ARIA APG keyboard patterns (tabs, accordion, combobox)"
      - "Escape closes overlays/modals/dropdowns"
    tool: "serena search_for_pattern — onKeyDown, onKeyUp, onKeyPress, handleKey"
    violation: "onClick without keyboard handler on non-native element → BLOCKER (WCAG 2.1.1)"

  step_4_focus_visibility:
    action: "Verify visible focus indicators"
    check:
      - "focus-visible styles defined (outline or equivalent)"
      - "outline: none/0 only paired with alternative focus style"
      - "Focus indicator has 3:1 contrast ratio"
    tool: "serena search_for_pattern — :focus, focus-visible, outline.*none, outline.*0"
    violation: "Removed focus indicator without replacement → MAJOR (WCAG 2.4.7)"

  step_5_skip_navigation:
    action: "Verify skip link exists for page-level components"
    check:
      - "Skip to main content link present (first focusable element)"
      - "Skip link visible on focus"
    tool: "serena search_for_pattern — skip.*main, skip.*content, skip-link"
    violation: "No skip link in layout component → MINOR (WCAG 2.4.1)"
```

## §3 ARIA Verification

```yaml
aria_verification:
  step_1_necessity:
    action: "Check if ARIA is used when native HTML would suffice"
    rule: "First rule of ARIA: don't use ARIA if native HTML works"
    check:
      - "role='button' on <div> → should be <button>"
      - "role='link' on <span> → should be <a>"
      - "role='heading' → should be <h1-h6>"
      - "aria-required → should be required attribute"
    tool: "serena search_for_pattern — role=.button, role=.link, role=.heading"
    violation: "ARIA over native HTML → MINOR (best practice)"

  step_2_completeness:
    action: "Verify ARIA attributes are complete"
    check:
      - "aria-expanded paired with aria-controls"
      - "aria-selected only on items within role='tablist' or role='listbox'"
      - "aria-label or aria-labelledby on icon-only buttons"
      - "role='alert' or aria-live on dynamic status messages"
    tool: "serena search_for_pattern — aria-expanded, aria-selected, aria-live, role=.alert"
    violation: "Incomplete ARIA → MAJOR (WCAG 4.1.2)"

  step_3_live_regions:
    action: "Verify dynamic content announcements"
    check:
      - "Toast/notification uses role='alert' or aria-live='assertive'"
      - "Loading states use aria-busy='true'"
      - "Form validation errors announced via aria-live or aria-describedby"
      - "Polite live regions for non-urgent updates"
    tool: "serena search_for_pattern — aria-live, aria-busy, role=.alert, role=.status"
    violation: "Dynamic content without announcement → MAJOR (WCAG 4.1.3)"

  step_4_reduced_motion:
    action: "Verify motion/animation respects user preference"
    check:
      - "prefers-reduced-motion media query used for animations"
      - "No auto-playing animations without user control"
      - "Transitions can be disabled"
    tool: "serena search_for_pattern — prefers-reduced-motion, @keyframes, animation, transition"
    violation: "Animation ignoring prefers-reduced-motion → MINOR (WCAG 2.3.3)"
```

## Tools
- Code: serena (search_for_pattern, find_symbol — trace component structure)
- Docs: context7 (component library a11y docs — Radix, MUI, shadcn, Headless UI)
- PR: github (get_diff, get_files, add_comment_to_pending_review)

## §4 Runtime Verification (when agent-browser available)

```yaml
runtime_verification:
  prerequisite: "agent-browser installed and dev server running"
  skip_if: "No browser access — static analysis from §1-§3 is sufficient for PR review"

  step_1_axe_core:
    action: "Run axe-core audit via agent-browser"
    steps:
      - "agent-browser open {dev_url + page_path}"
      - "agent-browser wait --load networkidle"
      - |
        agent-browser eval --stdin <<'EVALEOF'
        (async () => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.9.1/axe.min.js';
          document.head.appendChild(script);
          await new Promise(r => script.onload = r);
          const results = await axe.run();
          return { violations: results.violations.length, passes: results.passes.length,
            issues: results.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description,
              nodes: v.nodes.slice(0,3).map(n => n.html) })) };
        })()
        EVALEOF
    output: "axe-core violation count + categorized issues"
    note: "axe-core catches ~30-50% of WCAG issues automatically — supplements static analysis"

  step_2_keyboard_test:
    action: "Tab through interactive elements and verify focus behavior"
    steps:
      - "agent-browser press Tab (repeat 10-15 times)"
      - "agent-browser screenshot after each Tab — verify focus indicator visible"
      - "Verify: focus order is logical, no focus traps, skip link works"
    tool: "agent-browser press Tab, agent-browser screenshot"

  step_3_screen_reader_tree:
    action: "Capture and analyze accessibility tree"
    steps:
      - "agent-browser snapshot -i"
      - "Analyze: heading hierarchy, landmark completeness, interactive element labels"
    note: "More reliable than static code analysis — reflects actual rendered DOM"
```

## Exit Criteria

```yaml
a11y_exit_gates:
  semantic_complete: "All changed components checked for heading/landmark/label/alt"
  keyboard_complete: "All interactive elements in changed code verified for keyboard access"
  aria_complete: "All ARIA usage in changed code verified for correctness"
  wcag_refs: "Every finding cites specific WCAG criterion (e.g., 1.1.1, 2.1.1)"
  no_unresolved: "No BLOCKER without fix suggestion"
```
