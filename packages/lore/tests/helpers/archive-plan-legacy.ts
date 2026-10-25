/**
 * Test fixture helper: put a plan into the LEGACY shape "archived plan whose member tasks are still open" without the
 * write path. Since BR-1379 (archived is terminal) the write path no longer lets a task be created under an archived
 * plan, and `lore set <plan> --status archived` cascades its tasks; an archive sweep's R4 straggler can therefore only
 * exist in a corpus written before that rule. This helper writes that old state directly (one raw status UPDATE on a
 * throwaway corpus) so the sweep and its floors stay testable.
 *
 * Side-effect class: IO (writes the given throwaway corpus; never call it on the repo's own `.lore/`).
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";

/**
 * Mark the plan `slug` archived in the corpus under `cwd` without cascading to its tasks.
 *
 * @param cwd - the throwaway corpus directory (contains `.lore/lore.db`)
 * @param planSlug - slug of the plan to archive
 * @throws when no plan with that slug exists (fail loud: a typo must not read as success)
 */
export function archivePlanWithoutCascade(cwd: string, planSlug: string): void {
  const db = new Database(join(cwd, ".lore", "lore.db"));
  try {
    const changed = db.query("UPDATE docs SET status = 'archived' WHERE slug = ? AND type = 'plan' RETURNING id").all(planSlug);
    if (changed.length !== 1) throw new Error(`archivePlanWithoutCascade: expected exactly one plan '${planSlug}', matched ${changed.length}`);
  } finally {
    db.close();
  }
}
