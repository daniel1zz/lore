# Mode: Frontend / Component Testing

**Purpose**: Component-level testing for UI frameworks — the middle layer between unit tests (pure logic) and E2E (full browser journeys). Tests components in isolation with realistic user interaction patterns.

## Loop Specialization

| Step | Frontend specifics |
|------|-------------------|
| ANALYZE | Component tree, props/state interfaces, user interaction flows, accessibility requirements |
| DESIGN | Component behavior coverage: render states, user events, async effects, error boundaries |
| SETUP | JSDOM/happy-dom, Testing Library, mock providers (router, store, i18n, theme) |
| EXECUTE | `vitest` (preferred) or `jest` with `@testing-library/*` |
| GATE | All component behaviors verified, no console warnings, accessibility assertions pass |
| CLEANUP | Cleanup auto-handled by Testing Library; verify no leaked timers/subscriptions |
| PERSIST | Update test-plan with component coverage matrix |

## Core Principle: Test Like a User

Testing Library philosophy: test what users see and do, not implementation details.

| Do | Don't |
|----|-------|
| Query by role, label, text | Query by class name, test ID (last resort) |
| Simulate user events (`userEvent`) | Call component methods directly |
| Assert on visible output | Assert on internal state/hooks |
| Test behavior ("click submit → see success") | Test implementation ("setState was called") |

## React Testing Library Patterns

### Basic Component Test

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserProfile } from './UserProfile';

describe('UserProfile', () => {
  const user = userEvent.setup();

  describe('happy path', () => {
    it('displays user name and email', () => {
      render(<UserProfile name="Alice" email="alice@test.com" />);
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('alice@test.com')).toBeInTheDocument();
    });
  });

  describe('negative cases', () => {
    it('shows placeholder when name is empty', () => {
      render(<UserProfile name="" email="a@test.com" />);
      expect(screen.getByText('Anonymous')).toBeInTheDocument();
    });
  });

  describe('boundary values', () => {
    it('truncates name exceeding 50 characters', () => {
      const longName = 'A'.repeat(60);
      render(<UserProfile name={longName} email="a@test.com" />);
      expect(screen.getByText(/\.\.\.$/)).toBeInTheDocument();
    });
  });
});
```

### Async Component (Data Fetching)

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import { server } from '../mocks/server'; // msw
import { http, HttpResponse } from 'msw';

describe('UserList', () => {
  it('renders fetched users', async () => {
    render(<UserList />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });
  });

  it('shows error state on API failure', async () => {
    server.use(
      http.get('/api/users', () => HttpResponse.json(null, { status: 500 }))
    );
    render(<UserList />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/failed/i);
    });
  });
});
```

### Form Testing

```typescript
describe('LoginForm', () => {
  const user = userEvent.setup();

  it('submits valid credentials', async () => {
    const onSubmit = vi.fn();
    render(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'secure123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(onSubmit).toHaveBeenCalledWith({
      email: 'test@example.com',
      password: 'secure123',
    });
  });

  it('shows validation errors for empty fields', async () => {
    render(<LoginForm onSubmit={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('disables submit button while submitting', async () => {
    const onSubmit = vi.fn(() => new Promise(r => setTimeout(r, 100)));
    render(<LoginForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText('Email'), 'test@example.com');
    await user.type(screen.getByLabelText('Password'), 'secure123');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled();
  });
});
```

## Hook Testing

```typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { useDebounce } from './useDebounce';
import { useLocalStorage } from './useLocalStorage';

describe('useDebounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces value updates', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value, 300),
      { initialProps: { value: 'initial' } }
    );
    expect(result.current).toBe('initial');

    rerender({ value: 'updated' });
    expect(result.current).toBe('initial'); // not yet

    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe('updated');
  });
});

describe('useLocalStorage', () => {
  beforeEach(() => localStorage.clear());

  it('persists value to localStorage', () => {
    const { result } = renderHook(() => useLocalStorage('key', 'default'));
    act(() => result.current[1]('new-value'));
    expect(localStorage.getItem('key')).toBe('"new-value"');
  });

  it('reads existing value from localStorage', () => {
    localStorage.setItem('key', '"existing"');
    const { result } = renderHook(() => useLocalStorage('key', 'default'));
    expect(result.current[0]).toBe('existing');
  });
});
```

## Provider Wrappers

```typescript
// test-utils.tsx — shared wrapper for all component tests
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from './theme';

function createWrapper(options?: { route?: string }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[options?.route ?? '/']}>
          <ThemeProvider>{children}</ThemeProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

// Usage: render(<MyComponent />, { wrapper: createWrapper({ route: '/settings' }) });
```

## State Management Testing

### Zustand Store

```typescript
import { renderHook, act } from '@testing-library/react';
import { useCartStore } from './cartStore';

beforeEach(() => useCartStore.setState({ items: [], total: 0 }));

describe('cart store', () => {
  it('adds item and recalculates total', () => {
    const { result } = renderHook(() => useCartStore());
    act(() => result.current.addItem({ id: '1', name: 'Widget', price: 9.99 }));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.total).toBe(9.99);
  });

  it('removes item', () => {
    useCartStore.setState({ items: [{ id: '1', name: 'X', price: 5 }], total: 5 });
    const { result } = renderHook(() => useCartStore());
    act(() => result.current.removeItem('1'));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.total).toBe(0);
  });
});
```

## Visual Regression (Storybook + Chromatic)

| Tool | Purpose | When |
|------|---------|------|
| **Storybook** | Component catalog + visual stories | Development + documentation |
| **Chromatic** | Cloud visual diff on PR | CI/CD visual regression gate |
| **Playwright screenshots** | Inline visual assertions | Lightweight, no extra service |
| **Percy** | Cross-browser visual diff | Multi-browser visual coverage |

```typescript
// Component-level visual test with Playwright component testing
test('button variants render correctly', async ({ mount }) => {
  const component = await mount(<Button variant="primary">Click</Button>);
  await expect(component).toHaveScreenshot('button-primary.png');
});
```

## Component Accessibility Testing

```typescript
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

it('has no accessibility violations', async () => {
  const { container } = render(<Navigation />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

## Framework-Specific Notes

### Next.js (App Router)

- Mock `next/navigation`: `vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }))`
- Server Components: test as pure functions (they return JSX, no hooks)
- Client Components: standard Testing Library approach
- API Routes: test with `NextRequest` / `NextResponse` constructors

### Vue (Vue Test Utils + Testing Library)

- `@testing-library/vue` preferred over raw Vue Test Utils
- Mount with plugins: `render(Component, { global: { plugins: [pinia, router] } })`
- `v-model` testing: `await user.clear(input); await user.type(input, 'new')`

### Svelte

- `@testing-library/svelte` with `render` / `fireEvent`
- Reactive stores: test via component render output, not store internals

## Query Priority (Testing Library)

| Priority | Query | When |
|----------|-------|------|
| 1 | `getByRole` | Interactive elements (button, link, textbox, heading) |
| 2 | `getByLabelText` | Form fields |
| 3 | `getByPlaceholderText` | Input without visible label (fix the label instead) |
| 4 | `getByText` | Non-interactive text content |
| 5 | `getByDisplayValue` | Current value of form field |
| 6 | `getByAltText` | Images |
| 7 | `getByTitle` | Tooltips |
| 8 | `getByTestId` | Last resort — no semantic way to query |

## Common Pitfalls

| Pitfall | Fix |
|---------|-----|
| Using `fireEvent` instead of `userEvent` | `userEvent` simulates real user interaction (focus, keydown, input, keyup) |
| `waitFor` with side effects inside | Only put assertions inside `waitFor`, not actions |
| Not wrapping state updates in `act()` | Required for hook tests; RTL's render/userEvent handle this automatically |
| Testing internal state with `container.querySelector` | Use semantic queries; if you can't query it, the component has an accessibility gap |
| Snapshot testing entire components | Snapshots are fragile; prefer behavioral assertions. Use snapshots only for stable output (serialized data, small markup) |

## Preferred Libraries

**Core**: `@testing-library/react` (or vue/svelte), `@testing-library/user-event`, `@testing-library/jest-dom`, `msw` (API mocking), `vitest` (runner)

**Utilities**: `@testing-library/react-hooks` (legacy; use `renderHook` from RTL 14+), `jest-axe` (a11y assertions), `@faker-js/faker` + `fishery` (test data)

## Official Docs (MANDATORY before writing)

- context7: resolve-library-id for testing-library → query-docs for queries, userEvent, async utilities
- context7: resolve-library-id for msw → query-docs for handlers, server setup
- Fallback: gitmcp or mcp-deepwiki
