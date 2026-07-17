# Mode: Android

**Purpose**: Android app testing via emulator/device automation using maestro (structured flows) + mobile-mcp (low-level device control)

## Tool Strategy

| Layer | Tool | Use When |
|-------|------|----------|
| **Primary** | maestro | Structured test flows, semantic UI selectors (text/id), view hierarchy inspection, flow file execution |
| **Complement** | mobile-mcp | Coordinate-based gestures (swipe, long_press, double_tap), APK install/uninstall, screen recording, orientation control, URL navigation |

**Rule**: Prefer maestro semantic selectors (`tap_on` by text/id) over mobile-mcp coordinate clicks. Fall back to coordinates only when no semantic selector is available.

## Loop Specialization

| Step | Android specifics |
|------|-------------------|
| ANALYZE | App screens inventory, user flows (from PRD/feature-spec), gesture interactions, deep links, permission dialogs |
| DESIGN | Flow-driven: critical user journeys first, then edge cases. Include orientation changes, back navigation, app lifecycle (background/foreground) |
| SETUP | Start emulator, install APK, seed test data (via API or adb), prepare auth state, set locale/orientation |
| EXECUTE | maestro flows (primary) for structured tests; mobile-mcp for gesture-heavy or coordinate-dependent scenarios |
| GATE | All flows pass, no ANR/crashes, no unexpected permission dialogs, visual regression within threshold |
| CLEANUP | Stop app, uninstall if needed, stop screen recording, collect screenshots/recordings on failure |
| PERSIST | Update test-plan with flow coverage matrix and device/emulator info |

## Setup Checklist

- [ ] Emulator running: `mcp__maestro__start_device(platform="android")` or `mcp__mobile-mcp__mobile_list_available_devices`
- [ ] APK installed: `mcp__mobile-mcp__mobile_install_app(path="*.apk")`
- [ ] App launched: `mcp__maestro__launch_app(appId="com.example.app")`
- [ ] View hierarchy accessible: `mcp__maestro__inspect_view_hierarchy` returns elements
- [ ] Test data seeded (API-based or adb shell)
- [ ] Environment variables set for test mode

## Test Execution Patterns

### Pattern 1: Maestro YAML Flow (preferred for repeatable tests)

```yaml
appId: com.example.app
---
- launchApp
- tapOn: "Login"
- inputText: "user@test.com"
- tapOn: "Password"
- inputText: "test123"
- tapOn: "Submit"
- assertVisible: "Welcome"
```

Use `mcp__maestro__run_flow` for ad-hoc execution, `mcp__maestro__run_flow_files` for saved test suites.
Always `mcp__maestro__inspect_view_hierarchy` before writing selectors — never guess element text/id.

### Pattern 2: mobile-mcp Direct Interaction (for gestures and coordinates)

When maestro selectors insufficient:
1. `mobile_list_elements_on_screen` → find element coordinates
2. `mobile_swipe_on_screen` / `mobile_long_press` / `mobile_double_tap` → perform gesture
3. `mobile_take_screenshot` → verify result

### Pattern 3: Hybrid (flow + gesture)

Complex scenarios: use maestro flow for navigation, pause, switch to mobile-mcp for gesture, then back to maestro for assertions.

## Android-Specific Test Dimensions

```
[] App lifecycle (launch, background, foreground, kill, restore)
[] Orientation changes (portrait/landscape state preservation)
[] Back button navigation (hardware back via mobile_press_button BACK)
[] Permission dialogs (runtime permissions, deny/allow flows)
[] Deep links / URL schemes (mobile_open_url)
[] Gesture interactions (swipe, long press, double tap, pinch)
[] Keyboard handling (soft keyboard show/hide, input types)
[] Locale/i18n (launch_app with locale parameter)
[] Network conditions (offline/slow — if adb available)
[] Large font / display scaling (accessibility)
```

## Failure Artifacts (collected automatically on failure)

- Screenshot at failure point: `mcp__maestro__take_screenshot` or `mcp__mobile-mcp__mobile_take_screenshot`
- Screen recording: `mobile_start_screen_recording` → `mobile_stop_screen_recording`
- View hierarchy dump: `mcp__maestro__inspect_view_hierarchy`
- Element list: `mcp__mobile-mcp__mobile_list_elements_on_screen`

## Flaky Test Handling

- Rerun failed maestro flows 3x before marking as failed
- Common flaky sources on Android: animation timing, emulator boot race, keyboard show/hide delay
- Mitigation: add `waitForAnimationToEnd` in maestro flows, verify element visible before interaction
- Use `inspect_view_hierarchy` to confirm UI state before assertions

## Official Docs (MANDATORY before writing flows)

- `mcp__maestro__cheat_sheet` → maestro command syntax reference
- `mcp__maestro__query_docs` → specific maestro features and patterns
- Fallback: context7/deepwiki for maestro framework docs

Do NOT hardcode maestro YAML syntax in tests without first checking `cheat_sheet` for current syntax.
