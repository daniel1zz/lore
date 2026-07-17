# Mode: E2E

**Purpose**: End-to-end test implementation via browser automation — verifying full user journeys against a real running application.

## Loop Specialization

| Step | E2E specifics |
|------|---------------|
| ANALYZE | User journeys (from PRD/feature-spec), page inventory, user roles, API dependencies, SPA vs SSR routing |
| DESIGN | Journey-driven: critical paths first, then edge cases. Cross-browser matrix if needed |
| SETUP | Dev server startup, seed data, auth tokens/login state, test user accounts |
| EXECUTE | Playwright (primary), agent-browser (AI-driven exploration), or Cypress |
| GATE | All journeys pass, no console errors, no network failures, visual regression within threshold |
| CLEANUP | Browser cleanup, test data teardown, screenshot/trace collection on failure |
| PERSIST | Update test-plan with journey coverage matrix |

## Tool Selection

| Tool | Best For | Use When |
|------|----------|----------|
| **Playwright** | Deterministic scripted flows, CI/CD, cross-browser | Repeatable regression, known journeys, PR gates |
| **agent-browser** | AI-driven exploration, complex UI interaction, visual verification | New feature validation, exploratory E2E, hard-to-script flows |
| **Cypress** | Component + E2E hybrid, existing Cypress codebase | Project already uses Cypress |

## Playwright Patterns

### Page Object Model (POM)

```typescript
// pages/checkout.page.ts
export class CheckoutPage {
  constructor(private page: Page) {}

  readonly itemList = this.page.getByTestId('cart-items');
  readonly totalPrice = this.page.getByTestId('total-price');
  readonly payButton = this.page.getByRole('button', { name: 'Pay Now' });
  readonly successBanner = this.page.getByRole('alert', { name: /order confirmed/i });

  async fillShipping(address: ShippingAddress) {
    await this.page.getByLabel('Street').fill(address.street);
    await this.page.getByLabel('City').fill(address.city);
    await this.page.getByLabel('ZIP').fill(address.zip);
  }

  async submitPayment(card: TestCard) {
    await this.page.getByLabel('Card number').fill(card.number);
    await this.payButton.click();
    await this.successBanner.waitFor();
  }
}
```

### Custom Fixtures for Auth Roles

```typescript
// fixtures.ts
import { test as base } from '@playwright/test';

type Fixtures = {
  adminPage: Page;
  userPage: Page;
};

export const test = base.extend<Fixtures>({
  adminPage: async ({ browser }, use) => {
    const ctx = await browser.newContext({ storageState: 'auth/admin.json' });
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
  userPage: async ({ browser }, use) => {
    const ctx = await browser.newContext({ storageState: 'auth/user.json' });
    const page = await ctx.newPage();
    await use(page);
    await ctx.close();
  },
});
```

### API-Based Setup (Bypass UI for Preconditions)

```typescript
test.beforeEach(async ({ request }) => {
  await request.post('/api/test/seed', {
    data: { users: testUsers, products: testProducts },
  });
});

test.afterEach(async ({ request }) => {
  await request.post('/api/test/cleanup');
});
```

### Locator Strategy (Priority Order)

1. `getByRole()` — accessible name (best: mirrors how users find elements)
2. `getByLabel()` — form inputs
3. `getByText()` — visible text content
4. `getByTestId()` — when semantic locators aren't possible
5. Never: CSS selectors or XPath (fragile, implementation-coupled)

## agent-browser Integration

Use agent-browser for AI-driven E2E verification — especially for:
- Features with complex visual output (charts, dashboards, rich editors)
- Flows requiring human-like judgment ("does this look right?")
- New feature smoke tests before writing scripted Playwright tests

```
# Typical agent-browser E2E flow
1. Start dev server → verify healthy
2. Navigate to target page
3. Perform user journey actions
4. Take screenshots at key states
5. Verify: visible results match expected behavior
6. Check console for errors
7. Report findings with screenshot evidence
```

⛔ **Rule**: User-facing features (message → response, form → result, UI state changes) MUST have agent-browser E2E against real dev server. Mock-based tests are supplementary, not a substitute.

## Framework-Specific Strategies

### SPA (React/Vue/Angular)

- Wait for client-side routing: `await page.waitForURL('**/dashboard')`
- Hydration: wait for interactive state, not just DOM presence
- State management side effects: verify store updates reflect in UI
- Code splitting: ensure lazy-loaded routes render correctly

### SSR / SSG (Next.js / Nuxt)

- Test both initial server render AND client hydration
- Verify `<head>` metadata (SEO-critical pages)
- Test ISR revalidation: stale content → fresh content after trigger
- API routes: test via `request.get()` alongside UI tests

### Form-Heavy Apps

- Multi-step wizard: test forward/backward navigation, data persistence
- Validation: test inline errors, submit errors, field-level + form-level
- File upload: test valid files, oversized, wrong type, empty
- Autosave: verify draft persistence on navigation away

## Visual Regression

```typescript
// Screenshot comparison
test('dashboard layout', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('dashboard.png', {
    maxDiffPixelRatio: 0.01,
  });
});

// Component-level visual test
test('chart renders correctly', async ({ page }) => {
  await page.goto('/analytics');
  const chart = page.getByTestId('revenue-chart');
  await expect(chart).toHaveScreenshot('revenue-chart.png');
});
```

**Threshold tuning**: Start with `maxDiffPixelRatio: 0.01`, increase for dynamic content (timestamps, avatars).

## Mobile / Responsive Testing

```typescript
// playwright.config.ts
projects: [
  { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
  { name: 'tablet', use: { viewport: { width: 768, height: 1024 } } },
  { name: 'mobile', use: { ...devices['iPhone 14'] } },
]
```

Test: hamburger menu, touch gestures, viewport-dependent layouts, bottom sheets.

## CI/Browser Matrix

```yaml
# Minimum: chromium on PR, full matrix on main
browsers: [chromium, firefox, webkit]
viewports: [desktop (1280×720), mobile (375×667)]
# PR: chromium + desktop only → fast feedback
# Main: full matrix → comprehensive coverage
```

## Failure Artifacts (Collected Automatically)

| Artifact | Purpose | Config |
|----------|---------|--------|
| Screenshot at failure | Visual state at crash | `use: { screenshot: 'only-on-failure' }` |
| Trace file (.zip) | Full replay with timeline | `use: { trace: 'on-first-retry' }` |
| Video recording | Full test recording | `use: { video: 'on-first-retry' }` |
| Console log | JS errors, warnings | Custom reporter or `page.on('console')` |
| Network log | Failed API calls | `page.on('requestfailed')` |

## Flaky Test Handling

1. **Rerun**: Retry failed tests 2× before marking failed (`retries: 2` in config)
2. **Tag**: Intermittent failures → `test.describe.configure({ retries: 3 })` with issue link
3. **Quarantine**: Persistent flaky tests → separate CI job, don't block merge
4. **Root cause**: Common causes → race conditions (add `waitFor`), animation timing (disable or wait), network instability (mock unstable endpoints)
5. **Prevention**: Prefer `waitFor` over `setTimeout`, use `networkidle` carefully (prefer specific request waits)

## Environment Checklist

- [ ] Dev server running and healthy (`curl localhost:3000/api/health`)
- [ ] Database seeded with deterministic test data
- [ ] Auth tokens/sessions prepared (use `storageState` files)
- [ ] External services mocked (msw) or stable test environment
- [ ] Environment variables set for test mode (`NODE_ENV=test`)
- [ ] CI: headless mode, adequate `--workers` for runner capacity

## Official Docs (MANDATORY before writing)

- context7: resolve-library-id for playwright → query-docs for POM, fixtures, locators, assertions, network mocking
- Fallback: gitmcp or mcp-deepwiki

⛔ Do NOT embed framework-specific API patterns in skill files. Query official docs at runtime.
