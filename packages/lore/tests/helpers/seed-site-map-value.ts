/**
 * Test helper: store a raw `site_map` value on a leaf of a throwaway corpus, straight into its sqlite db.
 *
 * Purpose: the write verb refuses everything but unretired BR-n ids of the leaf, so a fixture that needs a corrupt value
 *   (free text left over from before the excuse grammar was retired) must bypass it. A `bun -e` subprocess does the write,
 *   because bun:sqlite is not loadable under the vitest runner.
 * Public surface: {@link seedSiteMapValue}.
 * Side-effect class: IO (writes the throwaway corpus's db; never the repository's own `.lore/`).
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import type { MiniCorpus } from "./coverage-mini-corpus";

/**
 * Set `value` (one string, or the whole value list of a mixed entry) as the `site_map` entry of `site` on `leaf` (slug), in the throwaway corpus of `c`.
 *
 * @throws Error when the subprocess fails (a missing leaf slug included).
 */
export function seedSiteMapValue(c: MiniCorpus, leaf: string, site: string, value: string | readonly string[]): void {
  const code = `
    import { Database } from "bun:sqlite";
    const [dbPath, slug, site, value] = process.argv.slice(1);
    const db = new Database(dbPath);
    const row = db.query("SELECT extra FROM docs WHERE slug = ?").get(slug);
    if (!row) throw new Error("no doc " + slug);
    const extra = JSON.parse(row.extra);
    extra.site_map = { ...(extra.site_map ?? {}), [site]: JSON.parse(value) };
    db.query("UPDATE docs SET extra = ? WHERE slug = ?").run(JSON.stringify(extra), slug);
    db.close();
  `;
  const r = spawnSync("bun", ["-e", code, join(c.dir, ".lore", "lore.db"), leaf, site, JSON.stringify(Array.isArray(value) ? value : [value])], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`seeding failed: ${r.stderr}${r.stdout}`);
}
