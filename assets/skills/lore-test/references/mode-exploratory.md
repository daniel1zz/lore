# Mode: Exploratory Testing

**Purpose**: Structured discovery of unknown issues through charter-based exploration (Agile Testing Quadrant Q3)

## Loop Specialization

| Step | Exploratory specifics |
|------|---------------------|
| ANALYZE | Inventory app surfaces, identify high-risk areas, select exploration strategy (SFDPOT/tours) |
| DESIGN | Write charters (3-5), assign heuristic focus, define oracles (HICCUPPS), set time-box |
| SETUP | Dev server running, auth prepared, agent-browser connected, session notes template ready |
| EXECUTE | Execute charters sequentially. Per charter: explore → observe → judge (oracle) → document |
| GATE | All charters completed, findings classified by severity, no Critical unresolved |
| CLEANUP | Collect screenshots, session notes, bug reports |
| PERSIST | Update test-plan with session notes, findings, coverage areas |

## Charter Format (SBTM)

```
CHARTER: Explore [target] with [resources/technique] to discover [information]
TIME-BOX: [Light: 5min | Standard: 15min | Deep: 30min]
HEURISTIC: [SFDPOT focus or Tour name]
```

**Examples**:
- `Explore checkout flow with boundary-value payment data to discover validation gaps` (15min, Data)
- `Explore settings page with keyboard-only navigation to discover accessibility barriers` (15min, Operations)
- `Explore user profile with concurrent edits in two tabs to discover state conflicts` (30min, Operations+Data)

## SFDPOT Heuristics

| Heuristic | AI Agent Actions |
|-----------|-----------------|
| **Structure** | Crawl DOM, find all links/forms/interactive elements, verify structural consistency across pages |
| **Function** | Exercise every button, form submit, CRUD op — verify each does what it claims |
| **Data** | Input boundaries, empty/null/unicode/XSS strings, file upload edge cases, overflow values |
| **Platform** | Vary viewport sizes, test with/without JS, check responsive breakpoints, browser differences |
| **Operations** | Rapid repeated actions, back/forward navigation, multi-tab state, session timeout behavior |
| **Time** | Test during loading states, interrupt async ops, check stale cache, time-dependent features |

## Oracle Heuristics (HICCUPPS)

How the agent judges "is this a bug?":

| Oracle | AI Application |
|--------|---------------|
| **History** | Compare against previous screenshot baselines — has behavior changed unexpectedly? |
| **Image** | Does UI match design system? Check alignment, spacing, visual consistency |
| **Comparable** | Compare to industry conventions (404 pages, login flows, error patterns) |
| **Claims** | Button says "Delete" — does it delete? Tooltip claims X — is it true? |
| **User Expectations** | Back button returns, form preserves input on error, undo works |
| **Product** | Internal consistency: same action in different places behaves identically |
| **Purpose** | Does feature fulfill its stated goal from spec/PRD? |
| **Standards** | WCAG, HTTP status codes, HTML validity |

## Tour-Based Exploration (FCC CUTS VIDS)

| Tour | Agent Actions |
|------|--------------|
| **Feature** | Navigate every menu item, click every button — breadth-first |
| **Complexity** | Find most complex feature, stress-test it |
| **Claims** | Read every tooltip, help text, error message — verify accuracy |
| **Configuration** | Change every setting, verify effect persists |
| **User** | Complete end-to-end journeys (signup → use → delete account) |
| **Testability** | Look for logging, debug modes, hidden panels |
| **Scenario** | Real-world multi-step workflows with realistic data |
| **Variability** | Do the same thing multiple different ways |
| **Interoperability** | Test data flow between features (export → import) |
| **Data** | Follow single entity through full lifecycle |
| **Structure** | Inspect network calls, local storage, cookies, URL patterns |

## Session Notes Template

```markdown
## Session: {charter}
**Duration**: {time-box} | **Heuristic**: {SFDPOT focus}
**Areas covered**: [list of pages/features explored]

### Findings
| # | Type | Severity | Description | Oracle Violated | Screenshot |
|---|------|----------|-------------|-----------------|------------|
| 1 | Bug/Question/Risk | Critical/Major/Minor | ... | Claims/Product/... | path |

### Coverage
- Explored: [areas covered]
- Not explored: [areas skipped, why]
- Surprises: [unexpected behavior worth investigating]
```

## AI-Native Exploration Patterns

| Pattern | What AI Does Better |
|---------|-------------------|
| **Systematic negative input** | Generate exhaustive invalid inputs per field type — humans skip from fatigue |
| **Cross-page consistency** | Screenshot every page, compare header/footer/nav automatically |
| **Error recovery** | Trigger errors deliberately (offline, invalid data, expired session), verify recovery |
| **State explosion** | Rapid permutation of multi-step flows (A→B→C, A→C→B, B→A→C) |
| **Interrupt testing** | Navigate away mid-form, close modal during async op, hit back during submission |
| **Accessibility sweep** | Check every interactive element for aria-labels, focus order, contrast |

## Tool Integration

- **agent-browser**: Primary tool for web exploration. Use `snapshot -i` for accessibility tree.
- **Playwright**: For scripted follow-up tests derived from exploration findings.
- **Screenshots**: Capture at each finding for evidence.
