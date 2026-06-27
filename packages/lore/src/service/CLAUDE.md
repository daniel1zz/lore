# Module: service

## Purpose

Business logic layer. Six stateless services orchestrate `StoreInterface` calls and apply domain rules (lifecycle, parent-type, MDX placeholders, version snapshots, drift checks). All public methods return `Promise<Result<T, LoreError>>` — no thrown exceptions cross this boundary.

## Key Invariants

- **Stateless** — every service holds only a `StoreInterface` (and optionally a `Telemetry` for `CorpusService`). All persistent state lives in the store.
- **`Promise<Result<T, LoreError>>` everywhere** — public methods never throw. Internal helpers may throw, but every public surface catches and maps to `Result`.
- **`resolveDoc` / `resolveDocId`** in `resolve.ts` is the single helper for ID-or-slug lookup. Detects ULID via `^[0-9A-HJKMNP-TV-Z]{26}$/i` and dispatches to `store.find` vs `store.findBySlug`.
- **Approval edits content reset → `draft`** — `CorpusService.update` automatically reverts an `approved` doc to `draft` when title or content changes (lifecycle invariant from SPEC-002 §3).
- **Migration is idempotent** — `MigrationService` distinguishes `imported` from `already_existed`; re-running the same import does not duplicate docs.
- **Version log is append-only** — `VersionService.restore(id, version)` does not delete newer entries; it inserts a new version with `action: "restore"` containing the historical content snapshot.
- **OutlineService is regex-based** — no `remark` / `unified` / `mdx` dependency. Self-closing tags only; props limited to `key="string"` and `key={literal}` (`COMPONENT_REGEX` + `PROP_REGEX`). Unknown components are stripped with a warning, not an error.

## Patterns

- **Service per concern, no cross-service calls** — services do not import each other. Composition lives in `src/app.ts`. If a workflow spans two services (e.g. `approve` produces a `versions` entry), the calling layer (CLI / MCP / HTTP) sequences them.
- **`CorpusService` is the only service wired to telemetry** — constructor takes `Telemetry`; other services don't record events.
- **Stable public types live next to the service that owns them** — `PendingDoc`, `ApproveOpts` in `review-service.ts`; `Diff`, `FieldChange` in `version-service.ts`; `MigrationReport`, `SecretWarning` in `migration-service.ts`; `TreeDrift`, `FixReport`, `ReconcileReport` in `tree-check-service.ts`. Don't move them to `core/types.ts`.
- **TreeCheckService is the only service that may modify the link table directly** — it reconciles the `parent_id` column on `docs` against the parent links in the link table. Other services treat them as synchronised.

## Service Map

- `CorpusService` — CRUD, list, search, tree, link/unlink, status (telemetry-wired).
- `ReviewService` — pending queue, approve, reject; consumes `isValidTransition`.
- `VersionService` — log, unified diff (`diff` package), restore (append-only).
- `OutlineService` — MDX placeholder resolution (whitelisted components: `ChildrenOf`, `RecentDecisions`, `ActivePlans`, `ModuleTree`, `RelatedOf`, `Embed`, `HealthStats`).
- `MigrationService` — one-shot v1→v2 import; reads YAML-frontmatter MD files, maps types, inserts via store.
- `TreeCheckService` — drift detection (`missing | extra | misplaced | cycle | orphan`), auto-fix, parent_id ↔ link-table reconciliation.

## Links

- Depends on: [`src/core`](../core/CLAUDE.md), [`src/store`](../store/CLAUDE.md).
- Used by: [`src/adapters/cli`](../adapters/cli/CLAUDE.md), [`src/adapters/mcp`](../adapters/mcp/CLAUDE.md), [`src/adapters/http`](../adapters/http/CLAUDE.md), [`src/eval`](../eval/CLAUDE.md) (read-only), and `src/app.ts`.
