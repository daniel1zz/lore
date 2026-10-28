/**
 * Test fixture helper: make a filed document parentless, the legacy-data shape the orphan checks exist to find.
 *
 * Purpose: spec-documents-that-need-a-parent-are-refused-without-one-an-ad D6 — a knowledge record, decision record or plan can no
 *   longer be created without a parent, so suites ABOUT orphans file the document under a parent and detach it here.
 * Public surface: {@link detachParentInDb}.
 * Invariants: writes only the throwaway corpus file it is given; fails loud when the slug names no single document. Kept apart
 *   from `parented-create.ts` because it imports `bun:sqlite`, which the Node-runner suites cannot load.
 * Side-effect class: IO (one UPDATE on the given corpus file).
 */

import { Database } from "bun:sqlite";

/**
 * Make an existing document parentless by clearing `parent_id` in the corpus file: the legacy-data shape (written before a
 * parent was required) that the orphan checks exist to find. A knowledge record, decision record or plan can no longer be
 * CREATED parentless, so suites about orphans file the document under a parent first and detach it here.
 *
 * @param dbPath - Absolute path of a throwaway test corpus's `lore.db`.
 * @param slug - Slug of the document to detach.
 * @throws Error when no document carries `slug` (a fixture fault).
 */
export function detachParentInDb(dbPath: string, slug: string): void {
  const db = new Database(dbPath);
  try {
    const found = db.query("SELECT COUNT(*) AS n FROM docs WHERE slug = ?").get(slug) as { n: number };
    if (found.n !== 1) throw new Error(`detachParentInDb: expected one document with slug ${slug}, found ${found.n}`);
    db.query("UPDATE docs SET parent_id = NULL WHERE slug = ?").run(slug);
  } finally {
    db.close();
  }
}
