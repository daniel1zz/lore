# pytest Testing Conventions

## Configuration
- `pyproject.toml` `[tool.pytest.ini_options]` for config
- `pytest-asyncio` for async tests (`asyncio_mode = "auto"`)
- `pytest-cov` for coverage

## Test Structure
```python
class TestOrderService:
    class TestCreateOrder:
        async def test_creates_order_with_valid_items(self, order_service, sample_cart):
            """Happy path"""
            ...

        async def test_raises_on_empty_cart(self, order_service):
            """Negative"""
            ...

        async def test_handles_max_quantity(self, order_service, max_quantity_cart):
            """Boundary"""
            ...

        async def test_rolls_back_on_payment_failure(self, order_service, failing_payment):
            """Error"""
            ...
```

## Coverage Dimensions
- **HAPPY**: Golden path with valid inputs
- **NEGATIVE**: Invalid inputs, missing required fields, unauthorized
- **BOUNDARY**: Empty collections, max values, zero, None
- **ERROR**: Network failures, timeouts, concurrent modifications
- **STATE**: State transitions, race conditions, idempotency
- **REGRESSION**: Specific bugs that were fixed (reference issue)

## Fixtures
- `conftest.py` at each test directory level for shared fixtures
- `@pytest.fixture` with appropriate scope (function/class/module/session)
- Factory fixtures returning callables for parameterized test data
- `tmp_path` for file system tests, `monkeypatch` for env vars

## Patterns
- Mirror `src/` structure in `tests/`: `src/modules/auth/` → `tests/modules/auth/`
- `@pytest.mark.parametrize` for data-driven tests
- `pytest.raises(ExactException)` — never bare `Exception`
- `freezegun` or `time_machine` for time-dependent tests
- `factory_boy` or manual factories for complex test data

## CLAUDE.md Section Template

```markdown
## Testing (pytest)
- Tests in tests/ mirroring src/ structure
- Six dimensions: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
- conftest.py fixtures per directory, factory functions for test data
- pytest-asyncio (auto mode), pytest.mark.parametrize for data-driven
- Coverage target: statements 80%+, branches 75%+
```
