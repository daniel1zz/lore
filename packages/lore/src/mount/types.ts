/**
 * SPEC-078 D2/D7 — pure type contracts for the dashboard multi-project mount
 * layer. Deliberately TYPES-ONLY (a single `import type` from `@lore/core`,
 * fully erased at build time, zero runtime code) so this file stays reachable
 * from vitest — the bun-only `MountRegistry` RUNTIME implementation (T5,
 * `packages/lore/src/mount/registry.ts`) satisfies the interfaces declared
 * here but is NOT itself importable outside a `bun test`/CLI context (it
 * transitively pulls in `bun:sqlite` via `createApp`).
 *
 * Public surface:
 *   - MountEntry — one registry entry's post-classification/mount state
 *   - MountRegistryDeps — the injected `createApp` port (IoC — lets AC-078-10's
 *     throwing-stub-App test substitute a fake without touching bun:sqlite)
 *   - MountRegistry — the public contract T5's runtime class implements and
 *     T8 (path shim + `/api/projects` route) consumes
 *   - ProjectsResponse / ProjectsResponseEntry — `GET /api/projects` wire
 *     shape (D7): one entry per registry item + the serving instance identity
 *
 * Side-effect class: pure (types only, zero runtime code)
 *
 * Source: SPEC-078 §Components (`MountRegistry` row), §Decisions D2/D7
 */

import type { DashboardConfig, MountState } from "@lore/core";

/**
 * One `dashboard.projects` registry entry after classify-then-mount (SPEC-078
 * D2). `TApp` is left generic (default `unknown`) rather than concretely
 * typed to `packages/lore/src/app.ts`'s `App` interface — importing that
 * module transitively reaches `bun:sqlite` (via `createApp`), which this
 * types-only file must never do even at the type layer, to keep it trivially
 * safe for any consumer (vitest, `@lore/dashboard`-adjacent tooling) to
 * resolve without a bun runtime. The bun-only runtime (T5) narrows `TApp` to
 * the real `App` type locally.
 *
 * @invariant `app` is present if and only if `state === "mounted"` — every
 *   other state carries `diagnosis` instead (the human-readable reason this
 *   entry didn't mount, e.g. "path does not exist" / "schema version 3 &gt;
 *   supported 2" / the caught `createApp` error message).
 */
export interface MountEntry<TApp = unknown> {
  /** Registry name — switcher label, `/p/:name` route segment, Map key. */
  name: string;
  /** Project root path this entry was declared with. */
  path: string;
  /** Classification result (SPEC-078 D7). */
  state: MountState;
  /** Human-readable reason, present whenever `state !== "mounted"`. */
  diagnosis?: string;
  /** The mounted `App` instance, present only when `state === "mounted"`. */
  app?: TApp;
}

/**
 * Injected construction dependencies for a {@link MountRegistry} (IoC — mirrors
 * this codebase's `FsProbe`-style injected-port convention, e.g.
 * `packages/core/src/config-drift.ts`). Keeping `createApp` a swappable port
 * (rather than the registry importing `createApp` from `app.ts` directly) is
 * what lets AC-078-10's runtime-isolation test substitute a throwing stub for
 * ONE registry entry without any real `bun:sqlite` file, and is also the seam
 * D8's empirical liveness spike / stub-injection CI regression relies on.
 */
export interface MountRegistryDeps<TApp = unknown> {
  /**
   * Constructs the per-project `App` instance for one classified-mountable
   * entry (D2 eager parallel mount — the caller `Promise.all`s over every
   * entry). Rejecting (or throwing) demotes that single entry to the
   * `"error"` state (AC-078-1 "all-error registry yields a running
   * MountRegistry with 0 mounted entries and no throw") — it must never
   * propagate out of {@link MountRegistry.init}.
   */
  createApp: (dbPath: string) => Promise<TApp>;
}

/**
 * Public `MountRegistry` contract (SPEC-078 D2, §Components). Implemented by
 * the bun-only runtime class in `packages/lore/src/mount/registry.ts` (T5);
 * consumed by the path-rewrite shim + `/api/projects` route (T8) and by unit
 * tests that only need this interface (never the concrete bun-only class).
 */
export interface MountRegistry<TApp = unknown> {
  /**
   * Loads `config.dashboard`, probes + classifies + mounts every registry
   * entry IN PARALLEL (`Promise.all`, D2 "eager parallel mount"). Never
   * throws — a registry where every entry fails classification/mount still
   * yields a running instance with zero `"mounted"` entries (AC-078-1).
   * Idempotent-by-construction: called exactly once per process lifetime
   * (D6 restart-only registry — no hot reload).
   */
  init(config: DashboardConfig, deps: MountRegistryDeps<TApp>): Promise<void>;
  /**
   * Resolves a registered project name to its {@link MountEntry}.
   * `undefined` for an unregistered name — the path shim's 404 case (R-12).
   */
  resolve(name: string): MountEntry<TApp> | undefined;
  /** All registry entries in declaration order (`GET /api/projects`, D7). */
  listEntries(): MountEntry<TApp>[];
  /**
   * Flips a previously-`"mounted"` entry to the `"error"` state at runtime
   * (D8/AC-078-10 — a per-request dispatch failure demotes just this one
   * entry's future routing/health-projection without throwing or touching
   * any other mount). Idempotent — marking an already-`"error"` entry again
   * just replaces `diagnosis`.
   */
  markError(name: string, error: Error): void;
  /**
   * Ordered `close()` fan-out over every `"mounted"` entry's `App` (shutdown,
   * D2). Entries that never reached `"mounted"` have nothing to close.
   */
  closeAll(): Promise<void>;
}

/** One `GET /api/projects` entry (D7) — the switcher's per-project badge data. */
export interface ProjectsResponseEntry {
  /** Registry name (switcher label / `/p/:name` segment). */
  name: string;
  /** Classification state (SPEC-078 D7). */
  state: MountState;
  /** Human-readable reason, present whenever `state !== "mounted"`. */
  diagnosis?: string;
}

/**
 * `GET /api/projects` response shape (SPEC-078 D7). Ships alongside the
 * per-entry classification the serving INSTANCE identity (port + a registry
 * identity label) — the debug surface for the "two instances, one corpus"
 * risk (§Risk registry): if two separate `lore dashboard` processes both
 * claim to serve the same corpus, comparing this field across both
 * processes' responses is how an operator tells them apart.
 */
export interface ProjectsResponse {
  /** One entry per registered project (declaration order). */
  projects: ProjectsResponseEntry[];
  /** The serving instance's identity (D7 "two instances, one corpus" debug aid). */
  instance: {
    /** TCP port this dashboard process is listening on. */
    port: number;
    /** Identity label for this process's loaded registry (T5-populated). */
    registry_name: string;
  };
}
