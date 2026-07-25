/**
 * GET /api/projects (SPEC-078 D7) — the dashboard multi-project switcher's
 * health/identity projection: one entry per `dashboard.projects` registry
 * item (name + classification state + diagnosis) alongside the SERVING
 * INSTANCE's own identity (port + a per-process registry label) — the debug
 * surface for the "two instances, one corpus" risk (§Risk registry): an
 * operator comparing this field across two `lore dashboard` processes'
 * responses can tell them apart even if both happen to mount the same path.
 *
 * Public surface: handleGetProjects, ProjectsRouteInstance
 *
 * Invariants:
 *   - Pure render — this module never mutates the registry, never performs
 *     auth (the caller, `index.ts`, resolves the actor via the SAME
 *     cookie-or-bearer duality every other v1 GET route uses BEFORE this
 *     function is ever called), and never does IO of its own.
 *   - `diagnosis` is included on the wire ONLY when the source `MountEntry`
 *     carries one (mirrors `MountEntry`'s own "`app` iff `state === "mounted"`,
 *     `diagnosis` otherwise" invariant, `mount/types.ts`) — never an empty
 *     string placeholder for a `"mounted"` entry.
 *   - Entries render in registry declaration order (`MountRegistry.listEntries`'s
 *     own contract) — the switcher's project order is stable across requests.
 *
 * Side-effect class: pure.
 *
 * Source: SPEC-078 D7; `packages/lore/src/mount/types.ts` (ProjectsResponse
 * wire shape, T3); `packages/lore/src/mount/mount-registry.ts` (MountRegistry
 * runtime, T5).
 */

import type { MountRegistry, ProjectsResponse, ProjectsResponseEntry } from "../../mount/types.js";
import { jsonOk } from "./middleware.js";

/**
 * The serving instance's own identity (D7's "two instances, one corpus"
 * debug aid) — supplied by the caller (`index.ts`), which alone knows the
 * REAL bound port (`Bun.serve`'s returned `server.port`, not the requested
 * `config.port` — a `port: 0` request resolves to an OS-assigned ephemeral
 * port only once `Bun.serve` returns) and this process's registry label.
 */
export interface ProjectsRouteInstance {
  /** TCP port this dashboard process is actually listening on. */
  port: number;
  /** Identity label for this process's loaded registry (`index.ts`-generated, one per process). */
  registryName: string;
}

/**
 * Render `GET /api/projects` (SPEC-078 D7). Read-only — the caller has
 * already authenticated the request (cookie OR bearer, same duality as every
 * other v1 GET route) before invoking this function.
 *
 * @param registry - The live `MountRegistry` this dashboard process mounted.
 * @param instance - This serving process's own identity (port + registry label).
 */
export function handleGetProjects(
  registry: MountRegistry<unknown>,
  instance: ProjectsRouteInstance,
): Response {
  const projects: ProjectsResponseEntry[] = registry.listEntries().map((entry) => {
    const rendered: ProjectsResponseEntry = { name: entry.name, state: entry.state };
    if (entry.diagnosis !== undefined) rendered.diagnosis = entry.diagnosis;
    return rendered;
  });

  const body: ProjectsResponse = {
    projects,
    instance: { port: instance.port, registry_name: instance.registryName },
  };

  return jsonOk(body);
}
