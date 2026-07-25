/**
 * `MountRegistry` runtime (SPEC-078 D2) — classifies every `dashboard.projects`
 * registry entry against a real filesystem/corpus, probes its schema version
 * readonly BEFORE ever constructing a real `App`, mounts every classified-
 * mountable entry in parallel, and holds the resulting `Map<name, MountEntry>`
 * for the lifetime of the process (restart-only, D6 — no hot reload).
 *
 * Public surface:
 *   - `createMountRegistry<TApp>()` — factory producing a `MountRegistry<TApp>`
 *     (the interface contract lives in `./types.js`, T3). Factory (not a
 *     class export) so callers never depend on this module's internal state
 *     shape — mirrors this codebase's other `create*` service constructors.
 *
 * Invariants:
 *   - NO registry entry reaches `deps.createApp` unprobed — `probeUpstreamDb`
 *     (readonly `PRAGMA user_version` open) runs first for every entry whose
 *     `.lore/lore.db` file exists; a probe failure OR a version mismatch
 *     structurally can never call `createApp` (R-11 "never auto-migrates" —
 *     `SQLiteStore`'s constructor unconditionally runs migrations, so this
 *     module must never hand it a file this process hasn't already vetted).
 *   - Duplicate registry names are rejected BEFORE any probe/createApp call —
 *     a structural config error, not a per-entry mount failure (mirrors the
 *     `DashboardConfigSchema` superRefine's own duplicate check one layer up;
 *     this is a second, code-level checkpoint because callers may construct
 *     `DashboardConfig` values directly in tests without going through Zod).
 *   - `init()` NEVER throws for a per-entry failure — only the duplicate-name
 *     precondition rejects the whole call. Every entry whose `createApp` call
 *     rejects lands in the `"error"` state; an all-error registry still
 *     resolves to a running instance with zero mounted entries (AC-078-1).
 *   - `init()` is intended to run exactly once per process lifetime (D6) —
 *     calling it twice on the same registry instance is undefined behavior
 *     (not guarded here; the dashboard command path (T8) owns "construct
 *     once" discipline, same division of labor as `probeUpstreamDb` owning
 *     only the probe itself, not call-once discipline).
 *
 * bun-only module: imports `probeUpstreamDb`, which imports `bun:sqlite`
 * transitively. Must NEVER be imported by `routes.ts` or any vitest-reachable
 * module — mirrors the CLI `loader.ts` bun-only discipline (root CLAUDE.md
 * "`bun:sqlite` is external to vitest"). `./types.ts` stays the vitest-safe
 * surface for consumers that only need the interface shape.
 *
 * Side-effect class: IO (readonly probe opens/closes a file handle per
 * entry; `deps.createApp` performs real corpus construction IO for every
 * classified-mountable entry; `closeAll` closes every mounted `App`).
 *
 * Source: SPEC-078 D2, D6, D7, R-11; `packages/lore/src/mount/types.ts` (T3);
 * `packages/lore/src/flows/upstream-probe.ts` (readonly-probe precedent).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import type { DashboardConfig } from "@lore/core";

import { probeUpstreamDb } from "../flows/upstream-probe.js";
import { LATEST_SCHEMA_VERSION } from "../store/sqlite-store.js";
import type { MountEntry, MountRegistry, MountRegistryDeps } from "./types.js";

/**
 * Thrown by {@link createMountRegistry}'s `init()` when `config.projects`
 * contains two entries sharing the same `name` — a structural config error
 * (AC-078-1 NEGATIVE scenario), not a per-entry mount failure, so it rejects
 * the WHOLE `init()` call before any probe/createApp runs. Named-class +
 * `context` payload convention mirrors this codebase's other thrown (not
 * `Result`-wrapped) error, `InvalidStalenessLimitError`
 * (`packages/core/src/staleness.ts`) — `MountRegistry.init` is a
 * promise-rejecting boundary by its own interface contract (`types.ts`, T3),
 * not a `Result`-returning service method, so `LoreError`/`err()` do not apply
 * here.
 */
export class DuplicateMountNameError extends Error {
  readonly context: { name: string };

  constructor(context: { name: string }) {
    super(`dashboard.projects[].name must be unique — duplicate registry name "${context.name}"`);
    this.name = "DuplicateMountNameError";
    this.context = context;
  }
}

/**
 * Computes the corpus database path a registry entry's project root resolves
 * to. Mirrors the `join(root, ".lore", "lore.db")` convention used throughout
 * the CLI (`adapters/cli/utils.ts::findLoreDbPath` and siblings) — this
 * module does not reuse that function directly because it lives in a
 * vitest-reachable file and must not gain a `bun:sqlite`-transitive import.
 */
function resolveDbPath(projectRoot: string): string {
  return join(projectRoot, ".lore", "lore.db");
}

/**
 * Classifies + mounts one registry entry. Never throws — every failure
 * (missing corpus, probe failure, schema skew, `createApp` rejection) is
 * captured into the returned {@link MountEntry}'s `state`/`diagnosis`, per
 * `init()`'s "never throws for a per-entry failure" invariant.
 */
async function classifyAndMount<TApp>(
  name: string,
  path: string,
  deps: MountRegistryDeps<TApp>,
): Promise<MountEntry<TApp>> {
  const dbPath = resolveDbPath(path);

  if (!existsSync(dbPath)) {
    return {
      name,
      path,
      state: "missing",
      diagnosis: `no corpus found at '${path}' — expected a database at '${dbPath}'`,
    };
  }

  const probeResult = probeUpstreamDb(dbPath);
  if (!probeResult.ok) {
    // reason: a readonly-probe failure (corrupt file, permissions, not a
    // SQLite file) is indistinguishable from "no usable corpus here" at this
    // layer — classified as "missing" rather than "error" because it never
    // reached createApp and carries no createApp-specific diagnosis.
    // `probeUpstreamDb` only ever constructs a STORE_ERROR-shaped failure in
    // practice, but its signature is the full `LoreError` union — the `"message"
    // in error` narrow keeps this correct even if that ever changes, rather
    // than asserting the narrower shape.
    const { error } = probeResult;
    return {
      name,
      path,
      state: "missing",
      diagnosis: "message" in error ? error.message : `probe failed: ${error.code}`,
    };
  }

  const { user_version } = probeResult.value;
  if (user_version !== LATEST_SCHEMA_VERSION) {
    return {
      name,
      path,
      state: "schema-skew",
      diagnosis: `corpus schema version ${user_version} does not match this binary's supported version ${LATEST_SCHEMA_VERSION} — never auto-migrated (R-11); run this corpus's own migration path directly, not via the dashboard mount registry`,
    };
  }

  try {
    const app = await deps.createApp(dbPath);
    return { name, path, state: "mounted", app };
  } catch (error) {
    return {
      name,
      path,
      state: "error",
      diagnosis: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Constructs a fresh, empty `MountRegistry`. Call `init()` exactly once
 * (D6 restart-only) before using `resolve`/`listEntries`/`closeAll`.
 *
 * @example
 *   const registry = createMountRegistry<App>();
 *   await registry.init(config.dashboard ?? {}, { createApp });
 *   const entry = registry.resolve("proj-a");
 */
export function createMountRegistry<TApp = unknown>(): MountRegistry<TApp> {
  const entries = new Map<string, MountEntry<TApp>>();
  let declarationOrder: string[] = [];

  async function init(config: DashboardConfig, deps: MountRegistryDeps<TApp>): Promise<void> {
    const projects = config.projects ?? [];

    // reason: duplicate-name rejection MUST happen before any probe/createApp
    // call (AC-078-1 NEGATIVE scenario) — a name collision is a structural
    // config error, not a per-entry mount failure, so it rejects the WHOLE
    // init() call rather than demoting one entry to an error state.
    const seen = new Set<string>();
    for (const project of projects) {
      if (seen.has(project.name)) {
        throw new DuplicateMountNameError({ name: project.name });
      }
      seen.add(project.name);
    }

    declarationOrder = projects.map((project) => project.name);

    const mounted = await Promise.all(
      projects.map((project) => classifyAndMount<TApp>(project.name, project.path, deps)),
    );

    for (const entry of mounted) {
      entries.set(entry.name, entry);
    }
  }

  function resolve(name: string): MountEntry<TApp> | undefined {
    return entries.get(name);
  }

  function listEntries(): MountEntry<TApp>[] {
    const result: MountEntry<TApp>[] = [];
    for (const name of declarationOrder) {
      const entry = entries.get(name);
      if (entry !== undefined) result.push(entry);
    }
    return result;
  }

  function markError(name: string, error: Error): void {
    const existing = entries.get(name);
    if (existing === undefined) return;
    entries.set(name, {
      name: existing.name,
      path: existing.path,
      state: "error",
      diagnosis: error.message,
    });
  }

  async function closeAll(): Promise<void> {
    for (const name of declarationOrder) {
      const entry = entries.get(name);
      if (entry === undefined || entry.state !== "mounted" || entry.app === undefined) continue;
      // reason: App.close() (app.ts) is synchronous; the ordered fan-out
      // itself is what's async (sequential over declarationOrder, mirroring
      // the interface doc's "ordered close() fan-out" contract) — a future
      // App variant with an async close() would still be awaited here since
      // `Promise.resolve(x)` is a no-op for non-thenable return values.
      await Promise.resolve((entry.app as { close: () => void }).close());
    }
  }

  return { init, resolve, listEntries, markError, closeAll };
}
