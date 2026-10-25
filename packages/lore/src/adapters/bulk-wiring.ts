/**
 * The one guard the CLI (`lore bulk`) and MCP (`lore_bulk`) adapters read `App.bulkLifecycleService` through.
 *
 * `App.bulkLifecycleService` is optional so hand-built App test stubs stay valid; both production composition roots
 * (`createApp`) always wire it, so this never fires in the CLI or MCP binaries — it fails loud (never a silent
 * no-op) for a stub that forgot it.
 * Side-effect class: pure.
 */

import type { App } from "../app.js";
import type { BulkLifecycleService } from "../service/bulk-lifecycle-service.js";

/** @returns the wired service; @throws when the App was hand-built without it. */
export function requireBulkLifecycleService(app: App): BulkLifecycleService {
  if (app.bulkLifecycleService === undefined) {
    throw new Error("Internal error: BulkLifecycleService not wired on App");
  }
  return app.bulkLifecycleService;
}
